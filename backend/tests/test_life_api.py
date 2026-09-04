from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json

import pytest
from fastapi.testclient import TestClient

from lingolife.app import DEFAULT_NPC_PROFILE, create_app
from lingolife.config import Settings
from lingolife.db import LifeWorldRevisionConflict
from lingolife.life import CORE_NEEDS
from lingolife.life_world import LifeWorldEngine
from lingolife.models import AIResult, EnglishFeedback


class ContextStub:
    def __init__(self):
        self.calls = 0
        self.contexts: list[dict] = []

    def reply(self, message, stats, history, context):
        self.calls += 1
        self.contexts.append(deepcopy(context))
        return AIResult(
            npc_reply="I feel better after talking with you.",
            npc_reply_zh="和你聊过之后，我感觉好多了。",
            relationship_change=2,
            mood_change=3,
            english_xp_change=1,
            english_feedback=EnglishFeedback(
                is_understandable=True,
                corrected_text=message,
                tip="This sounds natural.",
                tags=[],
            ),
            animation_cue="happy",
            semantic_signals=["empathy"],
        )


def _client(tmp_path, provider=None) -> TestClient:
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'life-api.db'}",
        web_root=str(tmp_path / "missing-web"),
        life_simulation_v2=True,
    )
    return TestClient(create_app(settings, provider or ContextStub()))


def _auth(client: TestClient, username: str) -> tuple[dict[str, str], dict]:
    invite = client.app.state.db.create_invites(1, 30)[0]
    response = client.post(
        "/api/v1/auth/register",
        json={"username": username, "invite_code": invite, "password": "test-password"},
    )
    assert response.status_code == 201, response.text
    token = response.json()["session_token"]
    user = client.app.state.db.authenticate(token)
    assert user is not None
    # These tests exercise the established single-Emma world contract rather
    # than first-run onboarding, so model a schema-v3-grandfathered account.
    client.app.state.db.get_or_create_npc_profile(
        user["player_id"], "emma", DEFAULT_NPC_PROFILE,
    )
    client.app.state.db.refresh_onboarding(user["player_id"], force_complete=True)
    return {"Authorization": f"Bearer {token}"}, user


def _profile(name: str, *, personality: list[str], interests: list[str]) -> dict:
    value = deepcopy(DEFAULT_NPC_PROFILE)
    value.update({
        "name": name,
        "age": 25,
        "personality": personality,
        "interests": interests,
        "romanceEnabled": True,
        "relationshipBoundaries": [],
    })
    return value


def _assert_safe_agent(agent: dict) -> None:
    runtime = agent["runtime_state"]
    assert set(runtime) == {"emotion", "needs"}
    assert set(runtime["needs"]) <= {"food", "rest", "social", "achievement", "fun"}
    assert runtime["needs"]
    assert set(runtime["needs"].values()) <= {"urgent", "strained", "steady", "comfortable"}
    assert set(runtime["emotion"].values()) <= {
        "subdued", "balanced", "bright", "radiant", "calm", "noticeable", "tense",
        "overwhelmed", "tired", "steady", "energetic", "lively",
    }
    development = agent["development"]
    assert development["version"] == "resident-development-v1"
    assert development["confidence"] in {"fragile", "growing", "steady", "grounded"}
    assert set(development["relationship_strategies"]) == {
        "cooperation", "repair", "boundary_setting", "reflection",
    }
    assert set(development["relationship_strategies"].values()) <= {
        "untried", "emerging", "practiced", "reliable",
    }
    assert all(set(habit) == {"id", "label", "strength", "last_practiced_at"}
               for habit in development["habits"])
    assert all(habit["strength"] in {"new", "forming", "established", "ingrained"}
               for habit in development["habits"])
    encoded = json.dumps(agent, ensure_ascii=False)
    for forbidden in (
        '"active_desire_ids"', '"current_commitment_id"', '"queued_commitment_id"',
        '"love"', '"privacy"', '"security"', '"attraction"', '"response_preview"',
        '"confidence":{"value"', '"successful_commitments"', '"setbacks"',
        '"practice_count"', '"applied_evidence"',
    ):
        assert forbidden not in encoded


def _install_open_story(client: TestClient, player_id: str) -> str:
    """Install a deterministic, still-open collision through the public core contract."""
    db = client.app.state.db
    emma = _profile("Emma", personality=["warm", "quiet"], interests=["music", "cooking"])
    alex = _profile("Alex", personality=["warm", "assertive"], interests=["music", "books"])
    db.ensure_npc(player_id, "emma")
    db.ensure_npc(player_id, "alex")
    db.save_npc_profile(player_id, "emma", emma)
    db.save_npc_profile(player_id, "alex", alex)

    now = datetime.now(timezone.utc)
    needs = {need: 100 for need in CORE_NEEDS}
    needs.update({"social": 0, "love": 0})
    runtime_seeds = {
        npc_id: {"needs": needs, "emotion": {"stress": 25, "energy": 80, "valence": 60}}
        for npc_id in ("alex", "emma")
    }
    shared_home = {
        npc_id: {"household_id": "household-shared", "location_id": "home-shared"}
        for npc_id in ("alex", "emma")
    }
    engine = LifeWorldEngine(timezone_name="UTC")
    state = engine.initialize(
        player_id,
        {"alex": alex, "emma": emma},
        shared_home,
        runtime_seeds,
        None,
        now,
    )
    story_id = next(
        (story_id for story_id, record in state["stories"].items() if record.get("collision")),
        None,
    )
    assert story_id is not None, "the deterministic shared-home fixture must create a collision"
    story = state["stories"][story_id]["story"]
    expires_at = now + timedelta(minutes=10)
    story.update({
        "status": "intervention_window",
        "resolution_id": None,
        "trouble_signal": True,
        "intervention_actions": ["ask", "comfort", "advise", "mediate", "give_space"],
        "auto_resolve_at": expires_at.isoformat(),
        "intervention_expires_at": expires_at.isoformat(),
    })
    # Keep the API adapter from advancing this purpose-built event before the
    # observe/intervene assertions execute.
    state["next_transition_at"] = expires_at.isoformat()
    saved = db.save_life_world_state(
        player_id,
        state,
        rules_version=state["rules_version"],
        last_advanced_at=state["last_advanced_at"],
        next_transition_at=state["next_transition_at"],
        expected_revision=0,
    )
    assert saved["revision"] == 1
    return story_id


def test_first_world_is_a_life_city_dto_and_repeated_read_keeps_revision(tmp_path):
    client = _client(tmp_path)
    headers, _ = _auth(client, "world-reader")

    first_response = client.get("/api/v1/world", headers=headers)
    assert first_response.status_code == 200, first_response.text
    first = first_response.json()

    assert first["map"] == {"width": 4800, "height": 3000}
    assert first["locations"]
    assert isinstance(first["world_version"], int) and first["world_version"] >= 1
    assert first["rules_version"] == "life-world-v1"
    assert first["server_time"]
    assert first["next_transition_at"]
    assert first["social_interactions"] == []
    assert isinstance(first["observable_moments"], list)
    assert isinstance(first["open_incidents"], list)
    assert isinstance(first["story_threads"], list)
    assert first["attention_budget"]["resident_count"] == len(first["npcs"])
    assert set(first["attention_budget"]["desktop"]) == {
        "incidents", "moments", "threads", "aftermath",
    }
    assert set(first["attention_budget"]["compact"]) == {
        "incidents", "moments", "threads", "aftermath",
    }
    assert set(first["attention_budget"]["suppressed"]) == {
        "incidents", "moments", "threads", "aftermath",
    }
    assert isinstance(first["relationships"], list)
    assert first["npcs"]
    assert first["households"]

    households = {value["id"]: value for value in first["households"]}
    for resident in first["npcs"]:
        assert resident["household_id"] in households
        assert resident["development"]["goal"]["title"]
        assert resident["development"]["confidence"] in {
            "fragile", "growing", "steady", "grounded",
        }
        assert "applied_evidence" not in resident["development"]
        assert resident["current_action"]["id"]
        assert resident["current_action"]["type"]
        assert resident["current_action"]["visible_intent"]
        assert resident["current_action"]["status"] in {
            "planned", "traveling", "performing", "blocked", "retrying",
        }
        assert resident["current_action"]["interruptibility"] in {"contextual", "private", "locked"}

    second = client.get("/api/v1/world", headers=headers)
    assert second.status_code == 200, second.text
    assert second.json()["world_version"] == first["world_version"]

    household_response = client.get("/api/v1/households", headers=headers)
    assert household_response.status_code == 200, household_response.text
    household_payload = household_response.json()
    assert household_payload["world_version"] == first["world_version"]
    assert {value["id"] for value in household_payload["households"]} == set(households)
    for household in household_payload["households"]:
        assert household["residence"]["location_id"]
        assert household["members"]
        assert {resource["kind"] for resource in household["resources"]} == {
            "kitchen", "television", "bathroom",
        }
        detail = client.get(f"/api/v1/households/{household['id']}", headers=headers)
        assert detail.status_code == 200, detail.text
        assert detail.json()["id"] == household["id"]


def test_service_retries_only_an_optimistic_conflict_and_commits_one_revision(tmp_path, monkeypatch):
    client = _client(tmp_path)
    headers, user = _auth(client, "world-retry")
    db = client.app.state.db
    original = db.save_life_world_state_and_projections
    calls = 0

    def conflict_once(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise LifeWorldRevisionConflict("life world revision conflict")
        return original(*args, **kwargs)

    monkeypatch.setattr(db, "save_life_world_state_and_projections", conflict_once)
    response = client.get("/api/v1/world", headers=headers)
    assert response.status_code == 200, response.text
    assert calls == 2
    authoritative = db.get_life_world_state(user["player_id"])
    assert authoritative and authoritative["revision"] == 1
    assert db.list_households(user["player_id"])


def test_service_does_not_misclassify_projection_failure_as_a_revision_conflict(tmp_path, monkeypatch):
    client = _client(tmp_path)
    headers, user = _auth(client, "projection-failure")
    db = client.app.state.db
    calls = 0

    def fail_projection(_player_id, _action):
        nonlocal calls
        calls += 1
        raise RuntimeError("projection storage unavailable")

    monkeypatch.setattr(db, "_upsert_life_action", fail_projection)
    with pytest.raises(RuntimeError, match="projection storage unavailable"):
        client.get("/api/v1/world", headers=headers)
    assert calls == 1
    assert db.get_life_world_state(user["player_id"]) is None
    assert db.list_households(user["player_id"]) == []


def test_city_projects_internal_household_rooms_to_home_without_losing_room_details(tmp_path):
    client = _client(tmp_path)
    headers, user = _auth(client, "room-location")
    initial = client.get("/api/v1/world", headers=headers).json()
    initial_resident = next(value for value in initial["npcs"] if value["id"] == "emma")
    home_id = initial_resident["home"]["id"]

    db = client.app.state.db
    state = deepcopy(db.get_life_world_state(user["player_id"]))
    resident = state["residents"]["emma"]
    internal_location = f"{resident['household_id']}:shared-kitchen"
    resident["current_location_id"] = internal_location
    resident["current_action"]["location_id"] = internal_location
    # Keep this fixture stable so the service presents rather than advances it.
    state["next_transition_at"] = "2099-01-01T00:00:00+00:00"
    db.save_life_world_state(
        user["player_id"], state, rules_version=state["rules_version"],
        last_advanced_at=state["last_advanced_at"],
        next_transition_at=state["next_transition_at"], expected_revision=state["revision"],
    )

    world = client.get("/api/v1/world", headers=headers).json()
    visible = next(value for value in world["npcs"] if value["id"] == "emma")
    assert visible["current_location_id"] == home_id
    assert visible["is_home"] is True
    assert visible["current_action"]["location_id"] == home_id
    assert visible["world_action"]["target_location_id"] == home_id
    household = next(value for value in world["households"]
                     if value["id"] == resident["household_id"])
    assert {resource["room_id"] for resource in household["resources"]} >= {
        "kitchen", "living_room", "bathroom",
    }


def test_city_redacts_private_household_actions_from_observer_status(tmp_path):
    client = _client(tmp_path)
    headers, user = _auth(client, "private-room-projection")
    initial = client.get("/api/v1/world", headers=headers).json()
    home_id = next(value for value in initial["npcs"] if value["id"] == "emma")["home"]["id"]

    db = client.app.state.db
    state = deepcopy(db.get_life_world_state(user["player_id"]))
    resident = state["residents"]["emma"]
    resident["current_location_id"] = f"{resident['household_id']}:shared-bathroom"
    resident["current_action"].update({
        "action_type": "shower", "status": "performing",
        "location_id": resident["current_location_id"],
        "target_resource_id": "shared-bathroom", "interruptible": False,
        "started_at": "2026-08-28T09:55:00+00:00",
        "ends_at": "2099-01-01T00:00:00+00:00",
    })
    state["next_transition_at"] = "2099-01-01T00:00:00+00:00"
    db.save_life_world_state(
        user["player_id"], state, rules_version=state["rules_version"],
        last_advanced_at=state["last_advanced_at"],
        next_transition_at=state["next_transition_at"], expected_revision=state["revision"],
    )

    world = client.get("/api/v1/world", headers=headers).json()
    visible = next(value for value in world["npcs"] if value["id"] == "emma")
    encoded = json.dumps(visible, ensure_ascii=False).casefold()
    assert visible["current_location_id"] == home_id
    assert visible["current_action"]["interruptibility"] == "private"
    assert visible["current_action"]["visible_context"]["visibility"] == "private"
    assert visible["visible_intent_zh"] == "正在家中处理私人事务，暂时不便打扰"
    assert "shower" not in visible["visible_intent"].casefold()
    assert "浴室" not in visible["visible_intent_zh"]
    assert "shared-bathroom" not in encoded


def test_expired_observed_moment_stays_in_history_but_leaves_live_city_surface(tmp_path):
    client = _client(tmp_path)
    headers, user = _auth(client, "moment-history")
    assert client.get("/api/v1/world", headers=headers).status_code == 200
    db = client.app.state.db
    state = deepcopy(db.get_life_world_state(user["player_id"]))
    story_id = "story-expired-presentation"
    old_time = "2000-01-01T00:00:00+00:00"
    state["stories"][story_id] = {
        "story": {
            "id": story_id, "story_key": "expired-presentation", "level": "moment",
            "status": "resolved_autonomously", "title_key": "collision.friendly_company",
            "participant_ids": ["emma"], "collision_ids": [], "location_id": "moonlight_cafe",
            "thread_id": None, "observable": True, "trouble_signal": False,
            "intervention_actions": [], "created_at": old_time, "updated_at": old_time,
            "auto_resolve_at": old_time, "intervention_expires_at": None,
            "observed_at": old_time, "presentation_expires_at": old_time,
            "resolution_id": "resolution-expired", "visible_facts": {"topic": "companionship"},
            "classification": {"level": "moment", "moment_score": 50,
                               "incident_score": 10, "reasons": ["observable_character_moment"]},
            "rules_version": "story-rules-v1",
        },
        "collision": None,
        "resolution": None,
    }
    state["next_transition_at"] = "2099-01-01T00:00:00+00:00"
    db.save_life_world_state(
        user["player_id"], state, rules_version=state["rules_version"],
        last_advanced_at=state["last_advanced_at"], next_transition_at=state["next_transition_at"],
        expected_revision=state["revision"],
    )

    history = client.get("/api/v1/life-stories", headers=headers).json()["stories"]
    historical = next(value for value in history if value["id"] == story_id)
    assert historical["presentable"] is False
    city = client.get("/api/v1/world", headers=headers).json()
    assert story_id not in {value["id"] for value in city["observable_moments"]}


def test_life_story_observation_intervention_idempotency_and_account_isolation(tmp_path):
    client = _client(tmp_path)
    owner_headers, owner = _auth(client, "story-owner")
    story_id = _install_open_story(client, owner["player_id"])

    listing_response = client.get("/api/v1/life-stories", headers=owner_headers)
    assert listing_response.status_code == 200, listing_response.text
    listing = listing_response.json()
    assert isinstance(listing["world_version"], int)
    assert listing["server_time"]
    assert "next_transition_at" in listing
    story = next(value for value in listing["stories"] if value["id"] == story_id)
    assert {
        "id", "level", "status", "title", "title_zh", "summary", "summary_zh",
        "participant_ids", "participants", "location_id", "created_at", "updated_at",
        "management", "presentation",
    } <= story.keys()
    assert story["status"] == "awaiting_management"
    assert story["management"]["can_intervene"] is True
    assert {value["id"] for value in story["management"]["actions"]} >= {"comfort", "advise"}
    assert story["management"]["prompt"] and story["management"]["prompt_zh"]
    assert all(value["description"] and value["description_zh"]
               for value in story["management"]["actions"])
    assert story["presentation"]["location"]["id"] == story["location_id"]
    assert [stage["id"] for stage in story["presentation"]["stages"]] == [
        "setup", "exchange", "reaction", "closure",
    ]
    assert story["presentation"]["stages"][2]["can_intervene_after"] is True
    assert all(value["text"] and value["translation_zh"]
               for value in story["presentation"]["beats"])
    assert all(value["duration_ms"] >= 900 and value["animation_cue"]
               for value in story["presentation"]["beats"])

    before_observe = deepcopy(client.app.state.db.get_life_world_state(owner["player_id"]))
    observed_response = client.post(f"/api/v1/life-stories/{story_id}/observe", headers=owner_headers)
    assert observed_response.status_code == 200, observed_response.text
    observed = observed_response.json()
    after_observe = client.app.state.db.get_life_world_state(owner["player_id"])
    assert observed["status"] == "awaiting_management"
    assert observed["observed_at"]
    assert after_observe["stories"][story_id]["story"]["status"] == \
        before_observe["stories"][story_id]["story"]["status"]
    assert after_observe["stories"][story_id]["story"]["resolution_id"] == \
        before_observe["stories"][story_id]["story"]["resolution_id"]
    assert after_observe["stories"][story_id]["collision"] == before_observe["stories"][story_id]["collision"]
    assert after_observe["stories"][story_id]["resolution"] == before_observe["stories"][story_id]["resolution"]

    stranger_headers, _ = _auth(client, "story-stranger")
    stranger_listing = client.get("/api/v1/life-stories", headers=stranger_headers)
    assert stranger_listing.status_code == 200, stranger_listing.text
    assert story_id not in {value["id"] for value in stranger_listing.json()["stories"]}
    foreign_observe = client.post(f"/api/v1/life-stories/{story_id}/observe", headers=stranger_headers)
    assert foreign_observe.status_code == 404
    assert foreign_observe.json()["error"]["code"] == "LIFE_STORY_NOT_FOUND"

    request = {"action": "comfort", "idempotency_key": "life-intervention-01"}
    first = client.post(
        f"/api/v1/life-stories/{story_id}/intervene",
        headers=owner_headers,
        json=request,
    )
    assert first.status_code == 200, first.text
    first_payload = first.json()
    assert first_payload["status"] == "resolved_with_management"
    assert first_payload["outcome"]["mode"] == "managed"
    assert first_payload["outcome"]["selected_action"] == "comfort"
    assert first_payload["participant_reactions"]
    assert {value["kind"] for value in first_payload["consequences"]} >= {"relationship", "wellbeing"}
    assert first_payload["aftermath"] and first_payload["aftermath_zh"]
    assert first_payload["presentation"]["beats"][-1]["phase"] == "aftermath"
    serialized = json.dumps(first_payload).casefold()
    assert all(term not in serialized for term in (
        "attraction", "crush", "mutual_interest", "response_preview", '"needs"',
    ))
    after_first = deepcopy(client.app.state.db.get_life_world_state(owner["player_id"]))

    replay = client.post(
        f"/api/v1/life-stories/{story_id}/intervene",
        headers=owner_headers,
        json=request,
    )
    assert replay.status_code == 200, replay.text
    assert replay.json() == first.json()
    assert client.app.state.db.get_life_world_state(owner["player_id"]) == after_first

    conflict = client.post(
        f"/api/v1/life-stories/{story_id}/intervene",
        headers=owner_headers,
        json={"action": "advise", "idempotency_key": request["idempotency_key"]},
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "LIFE_INTERVENTION_REJECTED"
    assert client.app.state.db.get_life_world_state(owner["player_id"]) == after_first


def test_room_uses_life_context_without_materializing_legacy_events(tmp_path):
    client = _client(tmp_path)
    headers, user = _auth(client, "room-reader")
    db = client.app.state.db

    before = {
        "daily": db._connection.execute(
            "SELECT COUNT(*) FROM active_events WHERE player_id=?", (user["player_id"],),
        ).fetchone()[0],
        "social": db._connection.execute(
            "SELECT COUNT(*) FROM npc_social_events WHERE player_id=?", (user["player_id"],),
        ).fetchone()[0],
    }
    response = client.get("/api/v1/room", headers=headers)
    assert response.status_code == 200, response.text
    room = response.json()

    assert room["active_event"] is None
    assert room["social_interactions"] == []
    assert room["life_context"]["current_action"]["type"]
    assert room["life_context"]["current_action"]["visible_intent"]
    assert room["life_context"]["household_id"]
    after = {
        "daily": db._connection.execute(
            "SELECT COUNT(*) FROM active_events WHERE player_id=?", (user["player_id"],),
        ).fetchone()[0],
        "social": db._connection.execute(
            "SELECT COUNT(*) FROM npc_social_events WHERE player_id=?", (user["player_id"],),
        ).fetchone()[0],
    }
    assert before == after == {"daily": 0, "social": 0}


def test_chat_receives_current_life_and_cached_replay_does_not_repeat_life_effects(tmp_path):
    provider = ContextStub()
    client = _client(tmp_path, provider)
    headers, user = _auth(client, "life-chatter")
    assert client.get("/api/v1/world", headers=headers).status_code == 200
    authoritative = client.app.state.db.get_life_world_state(user["player_id"])
    assert authoritative["residents"]["emma"]["runtime"]["active_desire_ids"]

    agent_response = client.get("/api/v1/npcs/emma/agent", headers=headers)
    assert agent_response.status_code == 200, agent_response.text
    _assert_safe_agent(agent_response.json())

    request_headers = {**headers, "Idempotency-Key": "life-chat-request-01"}
    first = client.post(
        "/api/v1/chat",
        headers=request_headers,
        json={"message": "You seem worried. Do you want to talk?", "npc_id": "emma"},
    )
    assert first.status_code == 200, first.text
    assert provider.calls == 1
    assert len(provider.contexts) == 1
    context = provider.contexts[0]
    assert context["current_event"] is None
    assert context["current_life"]["current_action"]["type"]
    assert context["current_life"]["current_action"]["visible_intent"]
    assert "recent_life_stories" in context["current_life"]
    assert "npc_relationships" in context["current_life"]
    _assert_safe_agent(context)
    assert set(context["relationship"]) == {"stage"}
    _assert_safe_agent(first.json()["agent"])

    after_first = deepcopy(client.app.state.db.get_life_world_state(user["player_id"]))
    assert len(after_first["processed_player_interaction_ids"]) == 1
    assert after_first["aftermath"][-1]["kind"] == "player_conversation"

    replay = client.post(
        "/api/v1/chat",
        headers=request_headers,
        json={"message": "You seem worried. Do you want to talk?", "npc_id": "emma"},
    )
    assert replay.status_code == 200, replay.text
    assert replay.json() == first.json()
    assert provider.calls == 1
    assert client.app.state.db.get_life_world_state(user["player_id"]) == after_first


def test_new_npc_automatically_joins_the_one_authoritative_shared_home(tmp_path):
    client = _client(tmp_path)
    headers, user = _auth(client, "home-checker")
    initial = client.get("/api/v1/world", headers=headers).json()
    emma_home = next(value for value in initial["npcs"] if value["id"] == "emma")["home"]["id"]

    profile = _profile("Milo", personality=["curious", "cheerful"], interests=["music", "games"])
    created_response = client.post("/api/v1/npcs", headers=headers, json=profile)
    assert created_response.status_code == 201, created_response.text
    npc_id = created_response.json()["id"]

    world_response = client.get("/api/v1/world", headers=headers)
    assert world_response.status_code == 200, world_response.text
    world = world_response.json()
    residents = {value["id"]: value for value in world["npcs"]}
    assert residents["emma"]["home"]["id"] == emma_home
    assert npc_id in residents
    assert residents[npc_id]["home"]["id"] == emma_home

    resident = residents[npc_id]
    household = next(value for value in world["households"] if value["id"] == resident["household_id"])
    member_ids = {value["npc_id"] for value in household["members"]}
    assert npc_id in member_ids
    assert household["residence"]["location_id"] == resident["home"]["id"]

    authoritative = client.app.state.db.get_life_world_state(user["player_id"])
    assert authoritative["residents"][npc_id]["home_location_id"] == resident["home"]["id"]
    assert authoritative["residents"][npc_id]["household_id"] == household["id"]


def test_profile_household_field_cannot_split_shared_home_and_family_is_preserved(tmp_path):
    client = _client(tmp_path)
    headers, user = _auth(client, "household-editor")
    assert client.get("/api/v1/world", headers=headers).status_code == 200

    profile = _profile("Milo", personality=["warm", "tidy"], interests=["cooking", "music"])
    profile.update({"householdWithIds": ["emma"], "familyIds": ["emma"]})
    created_response = client.post("/api/v1/npcs", headers=headers, json=profile)
    assert created_response.status_code == 201, created_response.text
    npc_id = created_response.json()["id"]
    assert created_response.json()["profile"]["householdWithIds"] == ["emma"]
    assert created_response.json()["profile"]["familyIds"] == ["emma"]

    shared = client.get("/api/v1/world", headers=headers).json()
    residents = {value["id"]: value for value in shared["npcs"]}
    assert residents[npc_id]["household_id"] == residents["emma"]["household_id"]
    assert residents[npc_id]["home"]["id"] == residents["emma"]["home"]["id"]
    household = next(
        value for value in shared["households"]
        if value["id"] == residents[npc_id]["household_id"]
    )
    assert {value["npc_id"] for value in household["members"]} == {"emma", npc_id}
    assert len(household["resources"]) == len({value["id"] for value in household["resources"]}) == 3
    relationship = next(
        value for value in shared["relationships"]
        if set(value["participant_ids"]) == {"emma", npc_id}
    )
    assert {value["kind"] for value in relationship["structural_bonds"]} == {
        "family", "household",
    }

    # Simulate a projection left by an older multi-household world. The next
    # authoritative save removes it while retaining the one shared home.
    stale_household_id = f"ghost-household-{npc_id}"
    client.app.state.db.upsert_household_projection(user["player_id"], {
        "id": stale_household_id, "name": "Former shared home", "members": [],
        "resources": [{
            "id": f"ghost-resource-{npc_id}", "kind": "television",
            "room_id": "living-room", "capacity": 1, "state": {},
        }],
    })
    assert client.app.state.db.get_household(user["player_id"], stale_household_id) is not None

    profile["householdWithIds"] = []
    update_response = client.put(f"/api/v1/npcs/{npc_id}", headers=headers, json=profile)
    assert update_response.status_code == 200, update_response.text
    split = client.get("/api/v1/world", headers=headers).json()
    residents = {value["id"]: value for value in split["npcs"]}
    assert residents[npc_id]["household_id"] == residents["emma"]["household_id"]
    assert residents[npc_id]["home"]["id"] == residents["emma"]["home"]["id"]
    assert len(split["households"]) == 1
    assert all(value["members"] for value in split["households"])
    assert {value["id"] for value in client.app.state.db.list_households(user["player_id"])} == {
        value["id"] for value in split["households"]
    }
    projected_response = client.get("/api/v1/households", headers=headers)
    assert projected_response.status_code == 200, projected_response.text
    assert {value["id"] for value in projected_response.json()["households"]} == {
        value["id"] for value in split["households"]
    }
    stale_response = client.get(
        f"/api/v1/households/{stale_household_id}", headers=headers,
    )
    assert stale_response.status_code == 404
    assert stale_response.json()["error"]["code"] == "HOUSEHOLD_NOT_FOUND"
    relationship = next(
        value for value in split["relationships"]
        if set(value["participant_ids"]) == {"emma", npc_id}
    )
    assert {value["kind"] for value in relationship["structural_bonds"]} == {
        "family", "household",
    }
