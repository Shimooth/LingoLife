from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
import pytest

from lingolife.agent import compile_persona
from lingolife.app import create_app
from lingolife.db import Database
from lingolife.relationships import RelationshipPair, StructuralBond
from test_arrival import setup, create, command as arrival_command


def ready(tmp_path):
    client, headers, settings = setup(tmp_path)
    first, _ = create(client, headers)
    for action, food in (("welcome_done", None), ("buy", "toast"), ("feed", "toast"), ("finish", None)):
        result = arrival_command(client, headers, action, food)
        assert result.status_code == 200, result.text
    return client, headers, settings, first["npc_id"]


def do(client, headers, action, key=None, **fields):
    return client.post("/api/v1/neighborhood/command", headers=headers, json={
        "action": action, "idempotency_key": key or f"neighborhood-{action}-test", **fields})


def fund(client, headers, project="fountain"):
    result = do(client, headers, "fund_project", key=f"prepare-{project}-test", project_id=project)
    assert result.status_code == 200, result.text
    return result.json()


def more(client, headers, name, model="chibi", age=25):
    profile = deepcopy(client.get("/api/v1/arrival", headers=headers).json()["draft"]["profile"])
    profile.update(name=name, age=age)
    profile["avatar"]["model"] = model
    result = client.post("/api/v1/npcs", headers=headers, json=profile)
    assert result.status_code == 201, result.text
    return result.json()["id"]


def raw_world(client):
    db = client.app.state.db
    player = db._connection.execute("SELECT player_id FROM users").fetchone()[0]
    return db, player, db.get_life_world_state(player)


def save_world(db, player, world):
    world["next_transition_at"] = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    db.save_life_world_state(player, world, rules_version=world["rules_version"],
                             last_advanced_at=world["last_advanced_at"], next_transition_at=world["next_transition_at"])


def meet_and_talk(client, headers, a, b, key="first", text="books"):
    met = do(client, headers, "meet", key=f"meet-neighbors-{key}", npc_id=a, target_id=b)
    assert met.status_code == 200, met.text
    meeting_id = met.json()["meetings"][-1]["id"]
    talked = do(client, headers, "friendship", key=f"talk-neighbors-{key}", meeting_id=meeting_id,
                advice="encourage", topic={"text": text, "kind": "activity"})
    assert talked.status_code == 200, talked.text
    return meeting_id, talked.json()


def test_fountain_news_and_wish_gift_are_durable_actual_and_idempotent(tmp_path):
    client, headers, settings, npc = ready(tmp_path)
    first = client.get("/api/v1/neighborhood", headers=headers)
    assert first.status_code == 200, first.text
    state = first.json()
    assert state["wishes"] == {"available": 1, "earned": 1, "spent": 0}
    assert not state["unlocks"]["fountain"] and not state["unlocks"]["clothing_store"]
    assert len(state["news"]) == 1
    assert client.get("/api/v1/neighborhood", headers=headers).json() == state
    assert do(client, headers, "wish", item_id="warm_greeting").status_code == 409
    opened = fund(client, headers)
    assert opened["unlocks"]["fountain"] and opened["coins"] == 45
    read = do(client, headers, "read_news", news_id="fountain-open")
    assert next(n for n in read.json()["news"] if n["id"] == "fountain-open")["read"]
    wished = do(client, headers, "wish", item_id="warm_greeting")
    assert wished.status_code == 200 and wished.json()["gifts"]["warm_greeting"] == 1
    assert do(client, headers, "wish", item_id="warm_greeting").json()["gifts"]["warm_greeting"] == 1
    before = compile_persona(state["residents"][0]["profile"])["axes"]["warmth"]
    given = do(client, headers, "gift", item_id="warm_greeting", npc_id=npc)
    assert given.status_code == 200, given.text
    resident = given.json()["residents"][0]
    assert resident["care"]["xp"] == 28
    assert compile_persona(resident["profile"])["axes"]["warmth"] == min(100, before + 8)
    assert client.get("/api/v1/arrival", headers=headers).json()["care"]["xp"] == 28
    assert do(client, headers, "wish", key="wish-second-no-credit", item_id="plant").status_code == 409
    again = do(client, headers, "wish", item_id="warm_greeting").json()
    assert again["last_receipt"]["action"] == "wish"  # original receipt, latest balances
    assert again["residents"][0]["care"]["xp"] == 28
    restarted = TestClient(create_app(settings))
    latest = restarted.get("/api/v1/neighborhood", headers=headers).json()
    assert latest["wishes"]["available"] == 0 and len(latest["news"]) == 2


def test_gift_enters_real_personal_inventory_and_rollback_is_atomic(tmp_path, monkeypatch):
    client, headers, _, npc = ready(tmp_path)
    fund(client, headers)
    do(client, headers, "wish", item_id="sketchbook")
    before = client.get("/api/v1/neighborhood", headers=headers).json()
    original = Database._write_life_world_state
    def fail_after(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError("write failure")
    monkeypatch.setattr(Database, "_write_life_world_state", fail_after)
    with pytest.raises(RuntimeError):
        do(client, headers, "gift", item_id="sketchbook", npc_id=npc)
    monkeypatch.setattr(Database, "_write_life_world_state", original)
    assert client.get("/api/v1/neighborhood", headers=headers).json() == before
    result = do(client, headers, "gift", item_id="sketchbook", npc_id=npc)
    assert result.status_code == 200
    _, _, world = raw_world(client)
    assert any(x["label_zh"] == "小小速写本" for x in world["residents"][npc]["personal_inventory"])


def test_shop_reuses_wallet_persists_outfit_and_refuses_city_models(tmp_path):
    client, headers, _, first = ready(tmp_path)
    city = more(client, headers, "City neighbor", model="city-01")
    assert do(client, headers, "buy_clothing", item_id="traveller_blue").status_code == 409
    more(client, headers, "Third neighbor")
    state = client.get("/api/v1/neighborhood", headers=headers).json()
    assert not state["unlocks"]["clothing_store"]
    meet_and_talk(client, headers, first, city)
    state = fund(client, headers, "clothing_store")
    assert state["unlocks"]["clothing_store"]
    assert sum(n["id"] == "clothing-open" for n in state["news"]) == 1
    bought = do(client, headers, "buy_clothing", item_id="traveller_blue")
    assert bought.status_code == 200 and bought.json()["coins"] == 5
    assert client.get("/api/v1/arrival", headers=headers).json()["coins"] == 5
    denied = do(client, headers, "wear_clothing", item_id="traveller_blue", npc_id=city)
    assert denied.status_code == 409
    worn = do(client, headers, "wear_clothing", key="wear-first-traveller", item_id="traveller_blue", npc_id=first)
    assert worn.status_code == 200
    avatar = next(r["profile"]["avatar"] for r in worn.json()["residents"] if r["id"] == first)
    assert avatar["model"] == "chibi" and avatar["outfit"] == "traveller" and avatar["outfitColor"] == "#7a9cc6"
    # Rewearing an owned outfit is allowed, buying it twice is not.
    assert do(client, headers, "buy_clothing", key="rebuy-traveller", item_id="traveller_blue").status_code == 409


def test_meeting_evidence_is_real_and_same_topic_does_not_farm_rewards(tmp_path):
    client, headers, _, a = ready(tmp_path)
    b = more(client, headers, "Bo")
    meeting, first = meet_and_talk(client, headers, a, b)
    assert first["last_receipt"]["coins_awarded"] == 20
    db, player, world = raw_world(client)
    evidence = [e for e in world["relationship_evidence"] if e["fact_id"] == first["last_receipt"]["scene_id"]]
    assert len(evidence) == 2
    pair = world["relationships"][":".join(sorted((a, b)))]
    projection = db._connection.execute("SELECT familiarity FROM npc_social_edges WHERE player_id=? AND npc_a=? AND npc_b=?",
                                         (player, a, b)).fetchone()[0]
    assert projection == pair["a_to_b" if pair["a_to_b"]["owner_id"] == a else "b_to_a"]["familiarity"]
    _, second = meet_and_talk(client, headers, a, b, key="repeat", text="books")
    assert second["last_receipt"]["coins_awarded"] == 0 and second["coins"] == first["coins"]
    _, _, after = raw_world(client)
    assert after["relationships"][":".join(sorted((a, b)))]["applied_evidence_ids"] == pair["applied_evidence_ids"]
    assert do(client, headers, "nicknames", meeting_id=meeting, aliases={"a_to_b": "小波", "b_to_a": "小诺"}).status_code == 200
    assert db.get_npc_profile(player, a)["residentNicknames"][b] == "小波"
    reverse = do(client, headers, "meet", key="reverse-alias-greeting", npc_id=b, target_id=a).json()
    assert "小诺" in reverse["scenes"][-1]["beats"][0]["text"]


def test_unknown_resident_topic_and_idempotency_payload_are_rejected(tmp_path):
    client, headers, _, a = ready(tmp_path)
    b = more(client, headers, "Bo")
    assert do(client, headers, "meet", npc_id=a, target_id="foreign-npc").status_code == 409
    met = do(client, headers, "meet", npc_id=a, target_id=b).json()["meetings"][-1]["id"]
    response = do(client, headers, "friendship", meeting_id=met, advice="encourage",
                  topic={"kind": "person", "person_id": "foreign-npc", "text": "a friend"})
    assert response.status_code == 409
    fund(client, headers)
    assert do(client, headers, "wish", item_id="plant").status_code == 200
    assert do(client, headers, "wish", item_id="sketchbook").status_code == 409


def test_romance_encouragement_never_overrides_refusal(tmp_path):
    client, headers, _, a = ready(tmp_path)
    b = more(client, headers, "Bo")
    met, _ = meet_and_talk(client, headers, a, b)
    result = do(client, headers, "romance", meeting_id=met, advice="encourage")
    assert result.status_code == 200, result.text
    scene = result.json()["scenes"][-1]
    assert scene["result"]["outcome"] == "not_reciprocated"
    assert scene["result"]["romance"] != "dating"
    assert all(c["choice"] == "refuse" for c in scene["result"]["choices"])
    assert any("don't want to start dating" in beat["text"] for beat in scene["beats"])
    _, _, world = raw_world(client)
    assert len([c for c in world["relationship_choices"] if c["story_id"] == scene["id"]]) == 2


def test_romance_uses_both_engine_acceptances_and_persists_bond(tmp_path):
    client, headers, _, a = ready(tmp_path)
    b = more(client, headers, "Bo")
    met, _ = meet_and_talk(client, headers, a, b)
    db, player, world = raw_world(client)
    key = ":".join(sorted((a, b)))
    for direction in ("a_to_b", "b_to_a"):
        world["relationships"][key][direction].update(attraction=95, trust=95, affinity=95, comfort=95, tension=0)
    world["relationships"][key]["channels"]["romance"] = "mutual_interest"
    save_world(db, player, world)
    result = do(client, headers, "romance", meeting_id=met, advice="encourage")
    assert result.status_code == 200, result.text
    assert result.json()["scenes"][-1]["result"]["romance"] == "dating"
    assert all(c["choice"] == "accept" for c in result.json()["scenes"][-1]["result"]["choices"])
    assert any(bond["channel"] == "romance" and bond["kind"] == "dating" and bond["state"] == "active"
               for bond in db.list_relationship_bonds(player))


@pytest.mark.parametrize("restriction", ["minor", "disabled", "family"])
def test_romance_eligibility_enforced_on_server(tmp_path, restriction):
    client, headers, _, a = ready(tmp_path)
    b = more(client, headers, "Bo", age=16 if restriction == "minor" else 25)
    met, _ = meet_and_talk(client, headers, a, b)
    if restriction == "disabled":
        profile = next(p["profile"] for p in client.get("/api/v1/npcs", headers=headers).json()["npcs"] if p["id"] == b)
        profile["romanceEnabled"] = False
        assert client.put(f"/api/v1/npcs/{b}", headers=headers, json=profile).status_code == 200
    if restriction == "family":
        db, player, world = raw_world(client)
        key = ":".join(sorted((a, b)))
        pair = RelationshipPair.from_dict(world["relationships"][key])
        pair.structural_bonds.append(StructuralBond("family-test", "family", (a, b), {a: "sibling", b: "sibling"}))
        world["relationships"][key] = pair.to_dict()
        save_world(db, player, world)
    result = do(client, headers, "romance", meeting_id=met, advice="encourage")
    assert result.status_code == 409 and result.json()["error"]["code"] == "NEIGHBORHOOD_ROMANCE_INELIGIBLE"


def test_feeding_second_resident_earns_wish_and_money_never_duplicates(tmp_path):
    client, headers, settings, a = ready(tmp_path)
    b = more(client, headers, "Bo")
    bought = do(client, headers, "buy_food", item_id="rice")
    assert bought.status_code == 200, bought.text
    other = TestClient(create_app(settings))
    # Both workers reconcile their runtime/layout before installing a known
    # idle state. This fixture should not depend on the current time of day.
    assert other.get("/api/v1/neighborhood", headers=headers).status_code == 200
    assert client.get("/api/v1/neighborhood", headers=headers).status_code == 200
    db, player, world = raw_world(client)
    world["residents"][b]["runtime"]["needs"]["food"] = 30
    world["residents"][b]["current_action"]["status"] = "interrupted"
    save_world(db, player, world)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda c: do(c, headers, "feed", item_id="rice", npc_id=b), [client, other]))
    assert all(r.status_code == 200 for r in results), [(r.status_code, r.text) for r in results]
    current = client.get("/api/v1/neighborhood", headers=headers).json()
    assert current["wishes"]["earned"] == 2
    assert next(r["care"]["xp"] for r in current["residents"] if r["id"] == b) == 20
    assert current["coins"] == 70 and current["food_inventory"]["rice"] == 0
    assert db.state(player, b).english_xp == 0


def test_test_account_reset_includes_all_neighborhood_tables(tmp_path):
    client, headers, _, _ = ready(tmp_path)
    fund(client, headers)
    do(client, headers, "wish", item_id="plant")
    db = client.app.state.db
    user = db._connection.execute("SELECT id,username FROM users").fetchone()
    result = db.reset_user_game_progress(user["id"], user["username"])
    assert result["deleted"]["player_neighborhood"] == 1
    assert result["deleted"]["neighborhood_receipts"] == 2
