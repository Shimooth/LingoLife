from __future__ import annotations

from datetime import datetime, timezone
from dataclasses import replace

import pytest

from lingolife.development import (
    DevelopmentEvidence,
    action_development_evidence,
    apply_development_evidence,
    initial_development,
    public_development,
    thread_development_evidence,
)
from lingolife.life import LifeAction
from lingolife.life_world import LifeWorldEngine


NOW = datetime(2026, 9, 4, 12, tzinfo=timezone.utc)
PROFILE = {
    "name": "Mina",
    "occupation": "Musician",
    "longTermGoal": "Perform an original song in public",
    "interests": ["music", "writing"],
    "habits": ["practises guitar after lunch"],
}


def test_life_action_and_thread_share_one_idempotent_development_ledger():
    development = initial_development(PROFILE)
    action_facts = action_development_evidence(
        npc_id="mina", source_id="action-1", action_type="practice_hobby",
        desire={"source": "goal", "reason": "goal_relevance"},
        development=development, occurred_at=NOW,
    )
    assert {fact.kind for fact in action_facts} == {"completed_commitment", "goal_practice"}
    for fact in action_facts:
        development, changed = apply_development_evidence(development, fact, PROFILE)
        assert changed
    progress = development["goal"]["progress"]

    social = thread_development_evidence(
        npc_ids=("mina", "kai"), source_id="story-1", thread_id="thread-1",
        outcome_tags=("cooperation", "resolved"), occurred_at=NOW,
    )
    assert {fact.kind for fact in social["mina"]} == {
        "social_cooperation", "relationship_repair",
    }
    for fact in social["mina"]:
        development, changed = apply_development_evidence(development, fact, PROFILE)
        assert changed

    replayed, changed = apply_development_evidence(development, action_facts[-1], PROFILE)
    assert not changed
    assert replayed["goal"]["progress"] == progress
    assert len(replayed["applied_evidence"]) == 4


def test_reused_evidence_id_with_different_fact_is_rejected():
    initial = initial_development(PROFILE)
    first = DevelopmentEvidence(
        "growth-same", "mina", "life_action", "action-1", "goal_practice",
        NOW.isoformat(), action_type="practice_hobby",
    )
    updated, _ = apply_development_evidence(initial, first, PROFILE)
    conflicting = DevelopmentEvidence(
        "growth-same", "mina", "story_thread", "story-9", "relationship_repair",
        NOW.isoformat(), thread_id="thread-9",
    )
    with pytest.raises(ValueError, match="reused"):
        apply_development_evidence(updated, conflicting, PROFILE)


def test_habit_strength_requires_a_completed_habit_sourced_action():
    development = initial_development(PROFILE)
    unrelated = action_development_evidence(
        npc_id="mina", source_id="action-unrelated", action_type="eat",
        desire={"source": "need", "reason": "low_food"},
        development=development, occurred_at=NOW,
    )
    assert {fact.kind for fact in unrelated} == {"completed_commitment"}

    practiced = action_development_evidence(
        npc_id="mina", source_id="action-habit", action_type="practice_hobby",
        desire={"source": "habit", "reason": "habit"},
        development=development, occurred_at=NOW,
    )
    assert {fact.kind for fact in practiced} == {"completed_commitment", "habit_practice"}
    for fact in practiced:
        development, _ = apply_development_evidence(development, fact, PROFILE)
    assert development["habits"][0]["practice_count"] == 1
    assert development["habits"][0]["strength"] > 20


def test_habit_evidence_reinforces_the_declared_routine_that_matches_the_action():
    profile = {**PROFILE, "habits": [
        "drinks coffee before work", "practises guitar after lunch",
    ]}
    development = initial_development(profile)
    practiced = action_development_evidence(
        npc_id="mina", source_id="action-guitar", action_type="practice_hobby",
        desire={"source": "habit", "reason": "habit"},
        development=development, occurred_at=NOW, collision_hooks=("shared_hobby",),
    )
    fact = next(value for value in practiced if value.kind == "habit_practice")
    habit = next(value for value in development["habits"] if value["id"] == fact.habit_id)
    assert habit["label"] == "practises guitar after lunch"


def test_repeated_evidence_is_slow_bounded_and_public_projection_hides_ledger():
    development = initial_development(PROFILE)
    for index in range(40):
        evidence = DevelopmentEvidence(
            f"growth-{index}", "mina", "life_action", f"action-{index}",
            "goal_practice", NOW.isoformat(), action_type="practice_hobby",
        )
        development, _ = apply_development_evidence(development, evidence, PROFILE)
    assert development["goal"]["progress"] == 50
    assert development["goal"]["current_milestone"] == "step-3"
    assert development["confidence"]["value"] < 60

    public = public_development(development, PROFILE)
    assert public["goal"]["progress"] == 50
    assert public["confidence"] == "steady"
    assert "applied_evidence" not in public
    assert "practice_count" not in public["habits"][0]


def test_profile_goal_edit_starts_new_track_without_erasing_historical_confidence():
    development = initial_development(PROFILE)
    development["confidence"]["value"] = 58
    development["applied_evidence"]["old"] = "fingerprint"
    edited = {**PROFILE, "longTermGoal": "Open a neighborhood music school"}
    public = public_development(development, edited)
    assert public["goal"]["title"] == "Open a neighborhood music school"
    assert public["goal"]["progress"] == 0
    assert public["confidence"] == "steady"


def test_completed_world_action_updates_public_goal_from_a_private_evidence_ledger():
    engine = LifeWorldEngine(timezone_name="UTC")
    state = engine.initialize("player", {"mina": PROFILE}, now=NOW)
    resident = state["residents"]["mina"]
    original = LifeAction.from_dict(resident["current_action"])
    action = replace(
        original, id="goal-action", action_type="practice_hobby", status="completed",
        desire_id="goal-desire", commitment_id="goal-commitment",
        arrives_at=None, started_at=NOW, ends_at=NOW, completed_at=NOW,
    )
    resident["desire_stack"] = [{
        "id": "goal-desire", "source": "goal", "reason": "goal_relevance",
        "status": "committed",
    }]
    resources = engine._resource_map(state)
    engine._complete_action(state, resident, action, {}, resources, NOW, PROFILE)
    engine._complete_action(state, resident, action, {}, resources, NOW, PROFILE)

    assert resident["development"]["goal"]["progress"] == 1.25
    assert len(state["growth_evidence"]) == 2
    assert resident["runtime"]["growth"]["openness"] > 0
    public = engine.public_snapshot(state)
    public_resident = public["residents"][0]
    assert public_resident["development"]["goal"]["progress"] == 1.25
    assert "growth_evidence" not in public
    assert "applied_evidence" not in public_resident["development"]
