from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
import pytest

from lingolife.agent import compile_persona
from lingolife.app import create_app
from lingolife.db import Database
from lingolife.config import Settings
from lingolife.life_service import LifeWorldService


def setup(tmp_path, username="onboarding-test-arrival"):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'arrival.db'}",
                        web_root=str(tmp_path / "no-web"), life_simulation_v2=True)
    client = TestClient(create_app(settings))
    invite = client.app.state.db.create_invites(1, 30)[0]
    auth = client.post("/api/v1/auth/register", json={
        "username": username, "invite_code": invite, "password": "password",
    }).json()
    headers = {"Authorization": "Bearer " + auth["session_token"]}
    return client, headers, settings


def create(client, headers):
    state = client.get("/api/v1/arrival", headers=headers).json()
    draft = deepcopy(state["draft"])
    draft["profile"]["name"] = "Nora"
    draft["personality"].update(warmth=85, extraversion=15, assertiveness=22)
    draft["voice"].update(voice_uri="test-voice", pitch=1.2)
    draft["manager"].update(name="小岛管理员", birthday_month=2, birthday_day=29)
    body = {"expected_revision": state["revision"], "draft": draft, "idempotency_key": "arrival-create-1"}
    result = client.post("/api/v1/arrival/create", headers=headers, json=body)
    assert result.status_code == 201, result.text
    return result.json(), body


def command(client, headers, action, food=None, key=None):
    body = {"action": action, "idempotency_key": key or f"arrival-{action}-001"}
    if food:
        body["food_id"] = food
    return client.post("/api/v1/arrival/command", headers=headers, json=body)


def test_arrival_single_resident_complete_world_and_resume(tmp_path):
    client, headers, settings = setup(tmp_path)
    initial = client.get("/api/v1/arrival", headers=headers).json()
    assert initial["stage"] == "create" and initial["enabled"]
    assert initial["draft"]["manager"]["name"] == ""
    state, body = create(client, headers)
    assert state["stage"] == "welcome" and state["coins"] == 100
    assert state["manager"]["birthday_day"] == 29
    assert client.get("/api/v1/onboarding", headers=headers).json()["completed"]
    profiles = client.get("/api/v1/npcs", headers=headers).json()["npcs"]
    assert len(profiles) == 1 and profiles[0]["id"] == state["npc_id"]
    profile = profiles[0]["profile"]
    assert compile_persona(profile)["axes"]["extraversion"] == 15
    assert profile["voice"]["pitch"] == 1.2
    world = client.get("/api/v1/world", headers=headers)
    assert world.status_code == 200, world.text
    assert len(world.json()["households"]) == 1
    assert len(world.json()["households"][0]["members"]) == 1
    again = client.post("/api/v1/arrival/create", headers=headers, json=body)
    assert again.status_code == 201 and again.json()["npc_id"] == state["npc_id"]
    restarted = TestClient(create_app(settings))
    assert restarted.get("/api/v1/arrival", headers=headers).json() == state
    assert restarted.get("/api/v1/onboarding", headers=headers).json()["completed"]


def test_draft_compare_swap_across_connections_and_validates_birthday(tmp_path):
    client, headers, settings = setup(tmp_path)
    original = client.get("/api/v1/arrival", headers=headers).json()
    body = {"expected_revision": 0, "draft": original["draft"]}
    other = TestClient(create_app(settings))
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda c: c.put("/api/v1/arrival/draft", headers=headers, json=body), [client, other]))
    assert sorted(r.status_code for r in results) == [200, 409]
    saved = client.get("/api/v1/arrival", headers=headers).json()
    assert saved["revision"] == 1
    body["expected_revision"] = 1
    body["draft"]["manager"].update(birthday_month=2, birthday_day=30)
    saved_invalid_date = client.put("/api/v1/arrival/draft", headers=headers, json=body)
    assert saved_invalid_date.status_code == 200
    # The in-progress form survives, but no resident can be created with it.
    body.update(expected_revision=saved_invalid_date.json()["revision"], idempotency_key="invalid-final-date")
    body["draft"]["manager"]["name"] = "Mina"
    assert client.post("/api/v1/arrival/create", headers=headers, json=body).status_code == 422


def test_first_meal_atomic_real_need_no_english_xp_and_idempotent(tmp_path):
    client, headers, settings = setup(tmp_path)
    state, _ = create(client, headers)
    assert command(client, headers, "feed", "toast").status_code == 409
    assert command(client, headers, "welcome_done").status_code == 200
    assert command(client, headers, "feed", "toast").status_code == 409
    bought = command(client, headers, "buy", "toast")
    assert bought.json()["coins"] == 85 and bought.json()["inventory"]["toast"] == 1
    assert command(client, headers, "buy", "rice").status_code == 409  # same key, different item
    other = TestClient(create_app(settings))
    with ThreadPoolExecutor(max_workers=2) as pool:
        eaten = list(pool.map(lambda c: command(c, headers, "feed", "toast"), [client, other]))
    assert [r.status_code for r in eaten] == [200, 200]
    latest = client.get("/api/v1/arrival", headers=headers).json()
    assert latest["stage"] == "level_up" and latest["care"]["level"] == 2
    assert latest["care"]["xp"] == 20 and latest["care"]["satiety"] == 70
    assert latest["inventory"]["toast"] == 0
    assert latest["last_receipt"]["leveled_up"]
    db = client.app.state.db
    player = db._connection.execute("SELECT player_id FROM users").fetchone()[0]
    assert db.state(player, state["npc_id"]).english_xp == 0
    memory_rows = db.list_npc_memories(player, state["npc_id"])
    care_memories = [m for m in memory_rows if str(m.get("source_event_id") or "").startswith("arrival:")]
    assert len(care_memories) == 1 and "小岛管理员" in care_memories[0]["content"]
    raw = db.get_life_world_state(player)
    assert raw["residents"][state["npc_id"]]["runtime"]["needs"]["food"] == 70
    # Reloading or waiting cannot let autonomous eating run during teaching.
    held = LifeWorldService(db).load(player, db.list_npc_profiles(player), now=datetime.now(timezone.utc) + timedelta(days=2))
    assert held == raw
    finished = command(client, headers, "finish")
    assert finished.status_code == 200 and not finished.json()["enabled"]
    assert "arrival_hold" not in db.get_life_world_state(player)
    assert client.get("/api/v1/world", headers=headers).status_code == 200


def test_save_older_studio_profile_preserves_voice_and_sliders(tmp_path):
    client, headers, _ = setup(tmp_path)
    state, _ = create(client, headers)
    profile = deepcopy(state["draft"]["profile"])
    profile.pop("voice")
    profile.pop("personalityAxes")
    profile["name"] = "New Nora"
    result = client.put(f"/api/v1/npcs/{state['npc_id']}", headers=headers, json=profile)
    assert result.status_code == 200, result.text
    assert result.json()["profile"]["voice"]["voice_uri"] == "test-voice"
    assert result.json()["profile"]["personalityAxes"]["warmth"] == 85


def test_legacy_batch_still_available_and_not_forced_into_arrival(tmp_path):
    client, headers, _ = setup(tmp_path)
    draft = client.get("/api/v1/arrival", headers=headers).json()["draft"]
    assert client.put("/api/v1/arrival/draft", headers=headers,
                      json={"expected_revision": 0, "draft": draft}).status_code == 200
    first = deepcopy(draft["profile"])
    second = deepcopy(first)
    second.update(name="Bo", occupation="Chef", personality=["outgoing"], interests=["cooking"])
    second.update(householdRole="cook", chorePreferences=["cooking"], privateSpacePreference="low")
    client.post("/api/v1/onboarding/intro/acknowledge", headers=headers, json={"intro_version": 1})
    result = client.post("/api/v1/onboarding/complete", headers=headers, json={"residents": [first, second]})
    assert result.status_code == 201, result.text
    state = client.get("/api/v1/arrival", headers=headers).json()
    assert not state["enabled"] and state["stage"] == "complete"


def test_reset_removes_new_game_data_and_preserves_account(tmp_path):
    client, headers, _ = setup(tmp_path)
    create(client, headers)
    command(client, headers, "welcome_done")
    command(client, headers, "buy", "toast")
    db = client.app.state.db
    user = db._connection.execute("SELECT id,username FROM users").fetchone()
    result = db.reset_user_game_progress(user["id"], user["username"])
    assert result["deleted"]["player_arrival"] == 1
    assert result["deleted"]["arrival_receipts"] == 3
    reset = client.get("/api/v1/arrival", headers=headers).json()
    assert reset["coins"] == 100 and reset["stage"] == "create" and not reset["inventory"]


def test_create_retries_partial_world_initialization(tmp_path, monkeypatch):
    client, headers, _ = setup(tmp_path)
    original = LifeWorldService.load
    failures = [True]
    def fail_once(*args, **kwargs):
        if failures:
            failures.pop()
            raise RuntimeError("temporary world initialization failure")
        return original(*args, **kwargs)
    monkeypatch.setattr(LifeWorldService, "load", fail_once)
    state = client.get("/api/v1/arrival", headers=headers).json()
    state["draft"]["manager"]["name"] = "Mina"
    body = {"expected_revision": 0, "draft": state["draft"], "idempotency_key": "arrival-retry-001"}
    with pytest.raises(RuntimeError):
        client.post("/api/v1/arrival/create", headers=headers, json=body)
    assert not client.get("/api/v1/onboarding", headers=headers).json()["completed"]
    # A refreshed browser has a new key, while the durable draft stays exact.
    body["idempotency_key"] = "arrival-retry-new-tab"
    retried = client.post("/api/v1/arrival/create", headers=headers, json=body)
    assert retried.status_code == 201 and retried.json()["stage"] == "welcome"
    assert len(client.get("/api/v1/npcs", headers=headers).json()["npcs"]) == 1


def test_simultaneous_create_in_distinct_workers_returns_one_resident(tmp_path):
    client, headers, settings = setup(tmp_path)
    other = TestClient(create_app(settings))
    state = client.get("/api/v1/arrival", headers=headers).json()
    state["draft"]["manager"]["name"] = "Mina"
    def do_create(item):
        index, target = item
        return target.post("/api/v1/arrival/create", headers=headers, json={
            "expected_revision": 0, "draft": state["draft"], "idempotency_key": f"two-workers-create-{index}",
        })
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(do_create, enumerate([client, other])))
    assert [r.status_code for r in results] == [201, 201]
    assert results[0].json()["npc_id"] == results[1].json()["npc_id"]
    assert len(client.get("/api/v1/npcs", headers=headers).json()["npcs"]) == 1
    # Both keys stay bound to creation, even if one was a recovered alias.
    assert command(client, headers, "welcome_done", key="two-workers-create-0").status_code == 409
    assert command(client, headers, "welcome_done", key="two-workers-create-1").status_code == 409


def test_wallet_never_overdraws_with_concurrent_buys(tmp_path):
    client, headers, settings = setup(tmp_path)
    create(client, headers)
    command(client, headers, "welcome_done")
    other = TestClient(create_app(settings))
    def buy(index):
        return command(client if index % 2 else other, headers, "buy", "rice", key=f"purchase-rice-{index}")
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(buy, range(6)))
    assert sum(r.status_code == 200 for r in results) == 4
    state = client.get("/api/v1/arrival", headers=headers).json()
    assert state["coins"] == 0 and state["inventory"]["rice"] == 4


def test_feed_rolls_back_wallet_memory_and_world_on_write_failure(tmp_path, monkeypatch):
    client, headers, _ = setup(tmp_path)
    create(client, headers)
    command(client, headers, "welcome_done")
    command(client, headers, "buy", "toast")
    before = client.get("/api/v1/arrival", headers=headers).json()
    original = Database._write_life_world_state
    def fail_after_world_write(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError("injected failure after writing world")
    monkeypatch.setattr(Database, "_write_life_world_state", fail_after_world_write)
    with pytest.raises(RuntimeError):
        command(client, headers, "feed", "toast")
    assert client.get("/api/v1/arrival", headers=headers).json() == before
    db = client.app.state.db
    assert db._connection.execute("SELECT count(*) FROM npc_memories").fetchone()[0] == 0
    monkeypatch.setattr(Database, "_write_life_world_state", original)
    assert command(client, headers, "feed", "toast").json()["care"]["level"] == 2


def test_later_feeding_respects_busy_action_and_full_real_need(tmp_path):
    client, headers, _ = setup(tmp_path)
    state, _ = create(client, headers)
    command(client, headers, "welcome_done")
    command(client, headers, "buy", "toast")
    command(client, headers, "feed", "toast")
    command(client, headers, "finish")
    assert command(client, headers, "buy", "rice", "later-buy-rice").status_code == 200
    db = client.app.state.db
    player = db._connection.execute("SELECT player_id FROM users").fetchone()[0]
    world = db.get_life_world_state(player)
    resident = world["residents"][state["npc_id"]]
    resident["runtime"]["needs"]["food"] = 95
    resident["current_action"]["status"] = "interrupted"
    world["next_transition_at"] = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    def save():
        db.save_life_world_state(player, world, rules_version=world["rules_version"],
                                 last_advanced_at=world["last_advanced_at"], next_transition_at=world["next_transition_at"])
    save()
    full = command(client, headers, "feed", "rice", "later-feed-rice")
    assert full.status_code == 409 and full.json()["error"]["code"] == "ARRIVAL_RESIDENT_FULL"
    resident["runtime"]["needs"]["food"] = 40
    resident["current_action"].update(status="performing", action_type="eat", interruptible=True)
    save()
    busy = command(client, headers, "feed", "rice", "later-feed-rice")
    assert busy.status_code == 409 and busy.json()["error"]["code"] == "ARRIVAL_RESIDENT_BUSY"
    assert client.get("/api/v1/arrival", headers=headers).json()["inventory"]["rice"] == 1


def test_manager_partial_draft_autosaves_but_final_create_is_validated(tmp_path):
    client, headers, _ = setup(tmp_path)
    state = client.get("/api/v1/arrival", headers=headers).json()
    draft = state["draft"]
    # Walking through the early steps must work before asking the manager's name.
    draft["step"] = "voice"
    result = client.put("/api/v1/arrival/draft", headers=headers, json={"expected_revision": 0, "draft": draft})
    assert result.status_code == 200 and result.json()["draft"]["manager"]["name"] == ""
    draft["step"] = "manager"
    draft["manager"]["birthday_month"] = 2
    result = client.put("/api/v1/arrival/draft", headers=headers, json={"expected_revision": 1, "draft": draft})
    assert result.status_code == 200 and result.json()["draft"]["manager"]["birthday_day"] is None
    final = {"expected_revision": 2, "draft": draft, "idempotency_key": "partial-manager-create"}
    assert client.post("/api/v1/arrival/create", headers=headers, json=final).status_code == 422
    draft["manager"]["name"] = "Mina"
    assert client.post("/api/v1/arrival/create", headers=headers, json=final).status_code == 422
    draft["manager"]["birthday_day"] = 29
    assert client.post("/api/v1/arrival/create", headers=headers, json=final).status_code == 201
