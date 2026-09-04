from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone

from lingolife.collisions import Collision, CollisionResolution
from lingolife.db import Database
from lingolife.life import CORE_NEEDS
from lingolife.life_service import LifeWorldService
from lingolife.life_world import LifeWorldEngine
from lingolife.relationships import RelationshipPair
from lingolife.stories import StoryContext, story_from_collision


NOW = datetime(2026, 9, 4, 12, 0, tzinfo=timezone.utc)


def _profile(name: str, *, open_to_player: bool = False) -> dict:
    return {
        "name": name,
        "age": 28,
        "occupation": "Designer",
        "personality": (["warm", "outgoing"] if open_to_player
                        else ["quiet", "introverted"]),
        "interests": ["art"],
        "privateSpacePreference": "low" if open_to_player else "high",
        "boundaries": ([] if open_to_player
                       else ["keep private matters private", "give me personal space"]),
    }


def _world() -> tuple[LifeWorldEngine, dict, dict]:
    profiles = {
        "ava": _profile("Ava", open_to_player=True),
        "bo": _profile("Bo"),
        "cy": _profile("Cy", open_to_player=True),
    }
    shared_home = {
        npc_id: {"household_id": "household-shared", "location_id": "home-shared"}
        for npc_id in profiles
    }
    needs = {need: 65 for need in CORE_NEEDS}
    runtime = {
        npc_id: {"needs": needs, "emotion": {"stress": 35, "energy": 70, "valence": 50}}
        for npc_id in profiles
    }
    engine = LifeWorldEngine(timezone_name="UTC")
    state = engine.initialize("player", profiles, shared_home, runtime, None, NOW)
    return engine, profiles, state


def test_live_collision_persists_who_tells_player_and_who_confides_elsewhere(monkeypatch):
    engine, profiles, state = _world()
    state["stories"] = {}
    state["open_story_ids"] = []
    state["processed_collision_ids"] = []
    state["active_collision_fact_ids"] = []
    state["collision_cooldowns"] = {}
    state["residents"]["ava"]["player_connection"] = {"trust": 82, "familiarity": 74}
    state["residents"]["bo"]["player_connection"] = {"trust": 4, "familiarity": 3}

    pair_key = "bo:cy"
    pair = RelationshipPair.from_dict(state["relationships"][pair_key])
    pair.edge("bo", "cy").trust = 88
    pair.edge("bo", "cy").comfort = 84
    state["relationships"][pair_key] = pair.to_dict()

    collision = Collision(
        "collision-disclosure", "person_boundary", "privacy_interruption", "privacy",
        ("ava", "bo"),
        tuple(state["residents"][npc_id]["current_action"]["id"] for npc_id in ("ava", "bo")),
        "privacy_boundary", NOW, "home-shared", None, 50,
        ("apologize_and_leave", "explain_urgency", "set_clear_boundary", "dismiss_concern"),
        "privacy-thread", {"household_id": "household-shared"},
    )
    resolution = CollisionResolution(
        "resolution-disclosure", collision.id, "autonomous",
        {"ava": "apologize_and_leave", "bo": "set_clear_boundary"},
        (), {}, (), 50, 48, True, ("conflict",), NOW,
    )
    monkeypatch.setattr(engine.collisions, "detect", lambda _snapshot: [collision])
    monkeypatch.setattr(engine.collisions, "resolve", lambda *_args, **_kwargs: resolution)

    engine._detect_and_record(state, profiles, "2026-09-04T12:00", NOW)

    record = next(iter(state["stories"].values()))
    assert record["story"]["trouble_signal"] is True
    assert record["disclosure"] == {
        "player_visible_npc_ids": ["ava"],
        "resident_confidants": {"bo": "cy"},
        "hidden_npc_ids": [],
    }
    assert LifeWorldService._trouble_recipients(
        record, record["story"]["participant_ids"],
    ) == ("ava",)

    encoded_public = str(engine.public_snapshot(state))
    assert "resident_confidants" not in encoded_public
    assert "player_connection" not in encoded_public


def test_committed_player_conversation_builds_disclosure_trust_once():
    engine, _profiles, state = _world()
    before = deepcopy(state["residents"]["bo"]["player_connection"])
    updated = engine.player_interaction(
        state, "bo", "chat-1", relationship_change=2,
        semantic_signals=["empathy", "support"], now=NOW + timedelta(minutes=1),
    )
    connection = updated["residents"]["bo"]["player_connection"]
    assert connection["trust"] > before["trust"]
    assert connection["familiarity"] > before["familiarity"]
    assert engine.player_interaction(
        updated, "bo", "chat-1", relationship_change=2,
        semantic_signals=["empathy", "support"], now=NOW + timedelta(minutes=1),
    ) == updated
    assert "player_connection" not in str(engine.public_snapshot(updated))


def test_city_projects_only_previous_week_resolved_aftermath(monkeypatch, tmp_path):
    engine, profiles, state = _world()
    action_ids = tuple(
        state["residents"][npc_id]["current_action"]["id"] for npc_id in ("ava", "bo")
    )
    collision = Collision(
        "collision-recap", "person_boundary", "privacy_interruption", "privacy",
        ("ava", "bo"), action_ids, "privacy_boundary", NOW - timedelta(days=1),
        "home-shared", None, 50,
        ("apologize_and_leave", "explain_urgency", "set_clear_boundary", "dismiss_concern"),
        "privacy-thread", {"household_id": "household-shared"},
    )
    resolution = CollisionResolution(
        "resolution-recap", collision.id, "autonomous",
        {"ava": "apologize_and_leave", "bo": "set_clear_boundary"},
        (), {}, (), 50, 48, True, ("conflict",), NOW - timedelta(days=1),
    )
    life_story = story_from_collision(
        collision, resolution, context=StoryContext(disclosure_allowed=True),
        now=NOW - timedelta(days=1),
    )
    previous = {
        "story": life_story.to_dict(), "collision": collision.to_dict(),
        "resolution": resolution.to_dict(),
        "disclosure": {"player_visible_npc_ids": ["ava"],
                       "resident_confidants": {}, "hidden_npc_ids": ["bo"]},
    }
    story = previous["story"]
    story["id"] = "story-yesterday"
    story["story_key"] = "story-key-yesterday"
    story["status"] = "resolved_autonomously"
    story["resolution_id"] = previous["resolution"]["id"]
    story["created_at"] = (NOW - timedelta(days=1)).isoformat()
    story["updated_at"] = (NOW - timedelta(hours=12)).isoformat()
    state["stories"] = {story["id"]: previous}

    db = Database(f"sqlite:///{tmp_path / 'recap.db'}")
    service = LifeWorldService(db, timezone_name="UTC")
    monkeypatch.setattr(service, "load", lambda *_args, **_kwargs: deepcopy(state))
    entries = [{"id": npc_id, "profile": profile} for npc_id, profile in profiles.items()]
    city = service.city("player", entries, now=NOW)

    assert [item["id"] for item in city["recent_aftermath"]] == ["story-yesterday"]
    assert city["recent_aftermath"][0]["outcome"]["aftermath"]

    today_story = deepcopy(city["recent_aftermath"][0])
    today_story["created_at"] = NOW.isoformat()
    stale_story = deepcopy(today_story)
    stale_story["created_at"] = (NOW - timedelta(days=8)).isoformat()
    open_story = deepcopy(today_story)
    open_story["status"] = "open"
    assert service._recent_story_aftermath(
        [today_story, stale_story, open_story], NOW,
    ) == []
