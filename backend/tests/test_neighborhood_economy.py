"""Economy and building progression exercised through real API transactions."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
import pytest

from lingolife import neighborhood
from lingolife.app import create_app
from lingolife.db import Database
from lingolife.arrival import _fingerprint
from test_neighborhood import ready, do, fund, more, meet_and_talk, raw_world, save_world


def state(client, headers):
    result = client.get("/api/v1/neighborhood", headers=headers)
    assert result.status_code == 200, result.text
    return result.json()


def project(current, project_id):
    return next(item for item in current["projects"] if item["id"] == project_id)


def stored_state(client, table):
    db, player, _ = raw_world(client)
    import json
    return json.loads(db._connection.execute(f"SELECT state_json FROM {table} WHERE player_id=?", (player,)).fetchone()[0])


def write_state(client, table, current):
    db, player, _ = raw_world(client)
    db._connection.execute(f"UPDATE {table} SET state_json=? WHERE player_id=?", (db._json(current), player))
    db._connection.commit()


def idle_and_hungry(client, npc):
    db, player, world = raw_world(client)
    world["residents"][npc]["runtime"]["needs"]["food"] = 30
    world["residents"][npc]["current_action"]["status"] = "interrupted"
    save_world(db, player, world)


def test_zero_coin_single_resident_can_recover_and_buy_a_real_gift(tmp_path):
    client, headers, settings, npc = ready(tmp_path)
    current = state(client, headers)
    wallet = stored_state(client, "player_arrival")
    wallet["coins"] = 0
    write_state(client, "player_arrival", wallet)
    assert len(current["residents"]) == 1 and not current["economy"]["care_reward"]["claimed"]
    claimed = do(client, headers, "claim_support", day=current["economy"]["day"])
    assert claimed.status_code == 200 and claimed.json()["coins"] == 30
    assert claimed.json()["economy"]["support"]["claimed"]
    assert len(claimed.json()["economy"]["ledger"]) == 1
    bought = do(client, headers, "buy_gift", item_id="sketchbook")
    assert bought.status_code == 200 and bought.json()["coins"] == 8
    assert bought.json()["gifts"]["sketchbook"] == 1
    retry = do(client, headers, "buy_gift", item_id="sketchbook").json()
    assert retry["coins"] == 8 and retry["gifts"]["sketchbook"] == 1
    assert do(client, headers, "gift", item_id="sketchbook", npc_id=npc).status_code == 200
    _, _, world = raw_world(client)
    assert any(item["label_zh"] == "小小速写本" for item in world["residents"][npc]["personal_inventory"])
    restarted = state(TestClient(create_app(settings)), headers)
    assert restarted["coins"] == 8 and restarted["economy"]["support"]["claimed"]
    assert [entry["delta"] for entry in restarted["economy"]["ledger"]] == [30, -22]
    assert [entry["balance"] for entry in restarted["economy"]["ledger"]] == [30, 8]


def test_daily_support_is_claimed_once_across_workers_and_different_keys(tmp_path):
    client, headers, settings, _ = ready(tmp_path)
    day = state(client, headers)["economy"]["day"]
    other = TestClient(create_app(settings))
    with ThreadPoolExecutor(max_workers=6) as pool:
        responses = list(pool.map(lambda i: do(client if i % 2 else other, headers, "claim_support",
                                               key=f"daily-support-race-{i}", day=day), range(6)))
    assert sum(response.status_code == 200 for response in responses) == 1
    assert all(response.status_code in {200, 409} for response in responses)
    current = state(client, headers)
    assert current["coins"] == 115 and len(current["economy"]["ledger"]) == 1


def test_midnight_retry_returns_original_receipt_and_cannot_claim_a_different_day(tmp_path, monkeypatch):
    client, headers, _, _ = ready(tmp_path)
    before_midnight = datetime(2026, 10, 3, 15, 59, 59, tzinfo=timezone.utc)
    monkeypatch.setattr(neighborhood, "now_utc", lambda: before_midnight)
    first = state(client, headers)
    assert first["economy"]["day"] == "2026-10-03"
    assert first["economy"]["reset_at"] == "2026-10-04T00:00:00+08:00"
    assert do(client, headers, "claim_support").status_code == 422
    paid = do(client, headers, "claim_support", day="2026-10-03").json()
    monkeypatch.setattr(neighborhood, "now_utc", lambda: before_midnight + timedelta(seconds=2))
    replay = do(client, headers, "claim_support", day="2026-10-03").json()
    assert replay["last_receipt"] == paid["last_receipt"]
    assert replay["coins"] == 115 and replay["economy"]["day"] == "2026-10-04"
    assert not replay["economy"]["support"]["claimed"]
    stale = do(client, headers, "claim_support", key="stale-unsubmitted-support", day="2026-10-03")
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "NEIGHBORHOOD_DAY_EXPIRED"
    assert do(client, headers, "claim_support", day="2026-10-04").status_code == 409  # Original key is bound to the old payload.
    today = do(client, headers, "claim_support", key="today-community-support", day="2026-10-04")
    assert today.status_code == 200 and today.json()["coins"] == 145


def test_only_the_first_valid_community_meal_per_day_rewards_care(tmp_path):
    client, headers, _, first = ready(tmp_path)
    second = more(client, headers, "Bo")
    current = state(client, headers)
    assert not current["economy"]["care_reward"]["claimed"]  # Tutorial meal is excluded.
    assert do(client, headers, "feed", item_id="toast", npc_id=first).status_code == 409
    assert do(client, headers, "buy_food", item_id="toast").status_code == 200
    idle_and_hungry(client, first)
    fed = do(client, headers, "feed", item_id="toast", npc_id=first)
    assert fed.status_code == 200 and fed.json()["coins"] == 80
    assert fed.json()["last_receipt"]["coins_awarded"] == 10
    assert fed.json()["economy"]["care_reward"]["claimed"]
    assert do(client, headers, "feed", item_id="toast", npc_id=first).json()["coins"] == 80
    assert do(client, headers, "buy_food", key="second-community-food", item_id="toast").status_code == 200
    idle_and_hungry(client, second)
    fed_again = do(client, headers, "feed", key="second-community-feed", item_id="toast", npc_id=second)
    assert fed_again.status_code == 200 and fed_again.json()["coins"] == 65
    assert fed_again.json()["last_receipt"]["coins_awarded"] == 0
    assert [entry["delta"] for entry in fed_again.json()["economy"]["ledger"]] == [-15, 10, -15]


def test_buildings_need_player_preparation_and_public_improvements_are_durable(tmp_path):
    client, headers, settings, _ = ready(tmp_path)
    before = state(client, headers)
    assert project(before, "fountain")["status"] == "proposed"
    assert project(before, "flower_beds")["status"] == "locked"
    assert do(client, headers, "fund_project", project_id="flower_beds").status_code == 409
    assert do(client, headers, "wish", item_id="plant").status_code == 409
    funded = fund(client, headers)
    assert funded["coins"] == 45 and funded["unlocks"]["fountain"]
    assert funded["wishes"]["available"] == 1  # Wishes accrued before construction remain.
    assert project(funded, "flower_beds")["status"] == "proposed"
    assert project(funded, "plaza_lights")["status"] == "proposed"
    assert do(client, headers, "fund_project", key="another-fountain-build", project_id="fountain").status_code == 409
    assert fund(client, headers)["coins"] == 45  # Successful request replay.
    flowers = fund(client, headers, "flower_beds")
    assert flowers["coins"] == 10 and project(flowers, "flower_beds")["status"] == "completed"
    assert any(item["id"] == "flower-beds-open" for item in flowers["news"])
    insufficient = do(client, headers, "fund_project", project_id="plaza_lights")
    assert insufficient.status_code == 409 and state(client, headers)["coins"] == 10
    assert project(state(TestClient(create_app(settings)), headers), "flower_beds")["completed_at"]


def test_three_residents_alone_do_not_open_a_shop_and_respectful_talk_counts(tmp_path):
    client, headers, _, first = ready(tmp_path)
    second = more(client, headers, "Bo")
    more(client, headers, "Cleo")
    before = state(client, headers)
    assert project(before, "clothing_store")["status"] == "locked"
    assert do(client, headers, "fund_project", project_id="clothing_store").status_code == 409
    _, talked = meet_and_talk(client, headers, first, second)
    assert project(talked, "clothing_store")["status"] == "proposed"
    assert not talked["unlocks"]["clothing_store"]
    funded = fund(client, headers, "clothing_store")
    assert funded["unlocks"]["clothing_store"] and funded["coins"] == 45
    assert sum(item["id"] == "clothing-open" for item in funded["news"]) == 1


def test_competing_workers_cannot_double_charge_a_project(tmp_path):
    client, headers, settings, _ = ready(tmp_path)
    state(client, headers)
    other = TestClient(create_app(settings))
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda pair: do(pair[1], headers, "fund_project",
                                                  key=f"fountain-race-{pair[0]}", project_id="fountain"), enumerate([client, other])))
    assert sorted(response.status_code for response in responses) == [200, 409]
    current = state(client, headers)
    assert current["coins"] == 45
    assert len(current["economy"]["ledger"]) == 1
    assert sum(item["id"] == "fountain-open" for item in current["news"]) == 1


def test_legacy_open_news_remain_open_without_charge_or_replayed_news(tmp_path):
    client, headers, settings, npc = ready(tmp_path)
    state(client, headers)
    stored = stored_state(client, "player_neighborhood")
    for field in ("projects", "ledger", "milestones"):
        stored.pop(field)
    previous_openings = [{"id": news_id, "kind": "building", "title": "Existing place", "title_zh": "原来的建筑",
                          "body": "Existing", "body_zh": "保留", "read": True, "created_at": "2026-09-01T00:00:00+00:00"}
                         for news_id in ("fountain-open", "clothing-open")]
    stored["news"] += previous_openings
    stored["gifts"] = {"plant": 2}
    stored["wardrobe"] = {"student_sage": 1}
    stored["aliases"] = {"legacy-pair": {"npc_id": npc, "target_id": "other", "a_to_b": "朋友", "b_to_a": "小伙伴"}}
    stored["wishes_spent"] = 1
    write_state(client, "player_neighborhood", stored)
    migrated = state(client, headers)
    assert migrated["coins"] == 85 and migrated["economy"]["ledger"] == []
    assert migrated["unlocks"]["fountain"] and migrated["unlocks"]["clothing_store"]
    assert migrated["gifts"] == {"plant": 2} and migrated["wardrobe"] == {"student_sage": 1}
    assert [item for item in migrated["news"] if item["id"] in {"fountain-open", "clothing-open"}] == previous_openings
    assert project(migrated, "clothing_store")["completed_at"] == "2026-09-01T00:00:00+00:00"
    assert state(TestClient(create_app(settings)), headers) == migrated
    assert stored_state(client, "player_neighborhood")["aliases"] == stored["aliases"]


def test_receipts_from_before_project_fields_were_added_still_replay(tmp_path):
    client, headers, _, _ = ready(tmp_path)
    purchased = do(client, headers, "buy_food", item_id="toast").json()
    # This exact shape is what the former NeighborhoodCommand model hashed.
    old_payload = {"action": "buy_food", "npc_id": None, "target_id": None, "item_id": "toast",
                   "news_id": None, "meeting_id": None, "advice": None, "topic": None, "aliases": None}
    db, player, _ = raw_world(client)
    db._connection.execute("UPDATE neighborhood_receipts SET fingerprint=? WHERE player_id=? AND idempotency_key=?",
                           (_fingerprint(old_payload), player, "neighborhood-buy_food-test"))
    db._connection.commit()
    replay = do(client, headers, "buy_food", item_id="toast")
    assert replay.status_code == 200, replay.text
    assert replay.json()["last_receipt"] == purchased["last_receipt"]
    assert replay.json()["coins"] == 70 and replay.json()["food_inventory"]["toast"] == 1


def test_only_item_gifts_are_buyable_and_wallet_cannot_overdraw(tmp_path):
    client, headers, settings, _ = ready(tmp_path)
    for item_id in ("warm_greeting", "little_joke"):
        rejected = do(client, headers, "buy_gift", item_id=item_id, key=f"buy-forbidden-{item_id}")
        assert rejected.status_code == 409 and rejected.json()["error"]["code"] == "NEIGHBORHOOD_GIFT_NOT_FOR_SALE"
    other = TestClient(create_app(settings))
    with ThreadPoolExecutor(max_workers=4) as pool:
        responses = list(pool.map(lambda i: do(client if i % 2 else other, headers, "buy_gift",
                                               key=f"plant-purchase-{i}", item_id="plant"), range(4)))
    assert sum(response.status_code == 200 for response in responses) == 3
    current = state(client, headers)
    assert current["coins"] == 1 and current["gifts"]["plant"] == 3
    assert len(current["economy"]["ledger"]) == 3


def test_project_wallet_news_and_ledger_all_rollback_together(tmp_path, monkeypatch):
    client, headers, _, _ = ready(tmp_path)
    before = state(client, headers)
    original = Database._write_life_world_state

    def fail_after(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError("project write failure")

    monkeypatch.setattr(Database, "_write_life_world_state", fail_after)
    with pytest.raises(RuntimeError, match="project write failure"):
        do(client, headers, "fund_project", project_id="fountain")
    monkeypatch.setattr(Database, "_write_life_world_state", original)
    assert state(client, headers) == before
    success = do(client, headers, "fund_project", project_id="fountain")
    assert success.status_code == 200 and success.json()["coins"] == 45


def test_social_income_has_a_daily_cap_and_complete_recent_ledger(tmp_path):
    client, headers, _, first = ready(tmp_path)
    neighbors = [more(client, headers, name) for name in ("Bo", "Cleo", "Dee", "Eli")]
    for index, npc in enumerate(neighbors):
        _, talked = meet_and_talk(client, headers, first, npc, key=f"pair-{index}")
        assert talked["last_receipt"]["coins_awarded"] == (20 if index < 3 else 0)
    assert talked["coins"] == 145 and talked["economy"]["social_reward"]["remaining_pairs"] == 0
    assert [item["delta"] for item in talked["economy"]["ledger"]] == [20, 20, 20]


def test_ledger_retains_the_last_40_entries_without_changing_existing_balances(tmp_path):
    client, headers, _, _ = ready(tmp_path)
    state(client, headers)
    current = stored_state(client, "player_neighborhood")
    current["ledger"] = [{"id": f"older-{i}", "delta": 1, "balance": i,
                          "label": "Earlier", "label_zh": "此前", "created_at": "2026-09-01T00:00:00+00:00"}
                         for i in range(40)]
    write_state(client, "player_neighborhood", current)
    day = state(client, headers)["economy"]["day"]
    result = do(client, headers, "claim_support", day=day).json()
    assert result["coins"] == 115 and len(result["economy"]["ledger"]) == 40
    assert result["economy"]["ledger"][0] == current["ledger"][1]
    assert result["economy"]["ledger"][-1]["balance"] == 115
