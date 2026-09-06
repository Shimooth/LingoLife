from copy import deepcopy
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest

from lingolife.practice import initial_practice, practice_view, reconcile, transition
from test_life_api import _auth, _client, _install_open_story
from test_onboarding_and_layout_api import _auth as new_auth, _ack, _profile

URL = "/api/v1/onboarding/practice"


def command(client, headers, event, **kwargs):
    response = client.post(URL, headers=headers, json={"event": event, **kwargs})
    assert response.status_code == 200, response.text
    return response.json()


def test_new_city_automatically_offers_guide_and_setup_retry_preserves_it(tmp_path):
    client = _client(tmp_path)
    headers = new_auth(client)
    assert client.get(URL, headers=headers).status_code == 409
    _ack(client, headers)
    body = {"residents": [_profile("Ana"), _profile("Bo")]}
    setup = client.post("/api/v1/onboarding/complete", headers=headers, json=body)
    assert setup.status_code == 201, setup.text
    progress = client.get(URL, headers=headers).json()["progress"]
    assert progress["status"] == "active" and progress["step"] == "discover"
    npc_id = setup.json()["npcs"][0]["id"]
    command(client, headers, "follow", npc_id=npc_id)
    client.post("/api/v1/onboarding/complete", headers=headers, json=body)
    assert client.get(URL, headers=headers).json()["progress"]["step"] == "participate"


def test_managed_guide_is_durable_isolated_and_does_not_repeat_world_effects(tmp_path):
    client = _client(tmp_path)
    headers, user = _auth(client, "practice-owner")
    story_id = _install_open_story(client, user["player_id"])
    assert client.get(URL, headers=headers).json()["progress"]["status"] == "not_started"
    command(client, headers, "start")
    bad = client.post(URL, headers=headers, json={"event": "follow", "npc_id": "not-mine"})
    assert bad.status_code == 409
    command(client, headers, "follow", npc_id="emma")
    selected = command(client, headers, "select_story", story_id=story_id)
    assert selected["progress"]["step"] == "participate"
    assert client.post(URL, headers=headers, json={"event": "acknowledge_result", "story_id": story_id}).status_code == 409
    db = client.app.state.db
    baseline = deepcopy(db.get_life_world_state(user["player_id"]))
    command(client, headers, "pause")
    assert client.get(URL, headers=headers).json()["progress"]["status"] == "paused"
    command(client, headers, "start")
    assert db.get_life_world_state(user["player_id"]) == baseline
    client.post(f"/api/v1/life-stories/{story_id}/observe", headers=headers)
    observed = client.get(URL, headers=headers).json()
    assert observed["progress"]["step"] == "participate"
    assert observed["progress"]["participation"] == "observed"
    result = client.post(f"/api/v1/life-stories/{story_id}/intervene", headers=headers,
                         json={"action": "comfort", "idempotency_key": "practice-comfort-1"})
    assert result.status_code == 200, result.text
    outcome = result.json()["outcome"]
    assert outcome["mode"] == "managed"
    assert outcome["selected_action_label"] and outcome["selected_action_label_zh"]
    assert db.update_city_practice(user["player_id"], lambda value: value)["receipt"]["outcome"] == outcome
    receipt = client.get(URL, headers=headers).json()
    assert receipt["progress"]["step"] == "result"
    assert receipt["story"]["outcome"] == outcome
    baseline = deepcopy(db.get_life_world_state(user["player_id"]))
    # Another authenticated device sees the same receipt, without localStorage.
    login = client.post("/api/v1/auth/login", json={"username": "practice-owner", "password": "test-password"}).json()
    second = {"Authorization": "Bearer " + login["session_token"]}
    assert client.get(URL, headers=second).json() == receipt
    for _ in range(2):
        completed = command(client, second, "acknowledge_result", story_id=story_id)
        assert completed["progress"]["status"] == "completed"
    assert db.get_life_world_state(user["player_id"]) == baseline
    outsider, _ = _auth(client, "practice-outsider")
    command(client, outsider, "start")
    command(client, outsider, "follow", npc_id="emma")
    assert client.post(URL, headers=outsider, json={"event": "select_story", "story_id": story_id}).status_code == 409
    assert client.get(URL).status_code == 401
    assert client.post(URL, headers=second, json={"event": "pretend_success"}).status_code == 422


def test_observation_waits_for_actual_autonomous_settlement(tmp_path, monkeypatch):
    client = _client(tmp_path)
    headers, user = _auth(client, "practice-autonomous")
    story_id = _install_open_story(client, user["player_id"])
    # The shared observe/intervene fixture reopens a previously settled moment;
    # autonomous scheduling additionally requires its open-story index entry.
    db = client.app.state.db
    state = db.get_life_world_state(user["player_id"])
    # Build a NEW pending collision from the public rule primitives. Reusing
    # the helper's old resolution would incorrectly apply its evidence twice.
    from lingolife.life_world import _collision_from_dict, _resolution_from_dict
    from lingolife.stories import story_from_collision
    record = state["stories"].pop(story_id)
    collision = replace(_collision_from_dict(record["collision"]), id="practice-new-collision")
    resolution = replace(_resolution_from_dict(record["resolution"]), id="practice-new-resolution",
                         collision_id=collision.id, requires_intervention=True)
    story = story_from_collision(collision, resolution, now=datetime.now(timezone.utc))
    story_id = story.id
    state["stories"][story_id] = {"story": story.to_dict(), "collision": collision.to_dict(),
                                 "resolution": resolution.to_dict()}
    state["open_story_ids"].append(story_id)
    db.save_life_world_state(user["player_id"], state, rules_version=state["rules_version"],
                             last_advanced_at=state["last_advanced_at"],
                             next_transition_at=state["next_transition_at"], expected_revision=state["revision"])
    command(client, headers, "start")
    command(client, headers, "follow", npc_id="emma")
    command(client, headers, "select_story", story_id=story_id)
    client.post(f"/api/v1/life-stories/{story_id}/observe", headers=headers)
    assert client.get(URL, headers=headers).json()["progress"]["step"] == "participate"
    # Advance the service clock beyond the real fixture deadline, without
    # editing history or asking the tutorial itself to settle anything.
    from lingolife import life_service
    original_utc = life_service._utc
    future = datetime.now(timezone.utc) + timedelta(minutes=16)
    monkeypatch.setattr(life_service, "_utc", lambda value=None: original_utc(value or future))
    result = client.get(URL, headers=headers).json()
    assert result["progress"]["step"] == "result"
    assert result["progress"]["participation"] == "observed"
    assert result["story"]["outcome"]["mode"] == "autonomous"


def test_missing_story_retargets_but_saved_receipt_survives_retention():
    progress = {**initial_practice("active"), "step": "participate", "story_id": "old", "npc_id": "a"}
    recovered = reconcile(progress, [])
    assert recovered["story_id"] is None and recovered["step"] == "participate"
    assert practice_view(recovered, [])["candidate"] is None
    receipt = {"id": "old", "level": "moment", "participant_ids": ["a", "b"],
               "status": "resolved_autonomously", "observed_at": "2026-09-06", "outcome": {"mode": "autonomous"}}
    saved = reconcile(progress, [receipt])
    assert saved["step"] == "result"
    assert practice_view(reconcile(saved, []), [])["story"] == receipt
    assert progress["step"] == "participate"  # pure transition


def test_candidates_prefer_live_interventions_without_inventing_a_story():
    progress = initial_practice("active")
    assert practice_view(progress, [])["candidate"] is None
    base = {"id": "recap", "level": "moment", "participant_ids": ["a", "b"], "status": "resolved_autonomously"}
    live = {**base, "id": "live", "status": "awaiting_management", "management": {"can_intervene": True}}
    assert practice_view(progress, [base, live])["candidate"]["id"] == "live"
    assert practice_view(progress, [{**live, "participant_ids": ["a"]}])["candidate"] is None
    with pytest.raises(ValueError):
        transition(progress, "acknowledge_result", story_id="live", resident_ids=["a", "b"], stories=[live])


def test_test_account_reset_also_resets_practice_without_requiring_an_invite(tmp_path):
    client = _client(tmp_path)
    headers, user = _auth(client, "onboarding-test-practice")
    command(client, headers, "start")
    command(client, headers, "follow", npc_id="emma")
    client.app.state.db.reset_user_game_progress(user["id"], "onboarding-test-practice")
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 200
    assert client.get(URL, headers=headers).status_code == 409
    _ack(client, headers)
    setup = client.post("/api/v1/onboarding/complete", headers=headers, json={"residents": [_profile("Ana"), _profile("Bo")]})
    assert setup.status_code == 201, setup.text
    assert client.get(URL, headers=headers).json()["progress"]["step"] == "discover"
