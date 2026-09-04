from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from lingolife.collisions import (
    COLLISION_KINDS,
    CollisionEngine,
    CollisionSnapshot,
    build_collision,
    detect_collisions,
    load_collision_catalog,
    resolve_collision_autonomously,
)
from lingolife.collisions import _response_score
from lingolife.life import (
    LifeAction,
    default_household_resources,
    reserve_resource,
)


NOW = datetime(2026, 8, 28, 10, tzinfo=timezone.utc)


def action(action_id: str, npc_id: str, action_type: str, *, target_npc_id=None,
           target_resource_id=None, location_id="h:living-room", interruptible=True):
    return LifeAction(
        id=action_id, player_id="p", npc_id=npc_id, action_type=action_type,
        status="performing", desire_id="d-" + action_id,
        commitment_id="c-" + action_id, location_id=location_id,
        target_resource_id=target_resource_id, target_npc_id=target_npc_id,
        planned_at=NOW, duration_seconds=120, interruptible=interruptible,
        animation_cue="talk" if action_type == "talk_to_resident" else "idle",
        collision_hooks=("person_availability",), need_deltas={}, emotion_deltas={},
        resource_deltas={}, started_at=NOW, ends_at=NOW + timedelta(seconds=120),
    )


def test_collision_content_covers_every_domain_with_response_variety():
    catalog = load_collision_catalog()
    assert {scenario.kind for scenario in catalog.scenarios.values()} == COLLISION_KINDS
    assert len(catalog.scenarios) >= 12
    assert all(len(scenario.responses) >= 3 for scenario in catalog.scenarios.values())
    assert all(scenario.thread_hook for scenario in catalog.scenarios.values())


def test_resource_queue_becomes_a_stable_person_resource_collision():
    kitchen = next(value for value in default_household_resources("h") if value.kind == "kitchen")
    first = reserve_resource(kitchen, npc_id="emma", action_id="cook-emma", now=NOW,
                             lease_seconds=180).resource
    queued = reserve_resource(first, npc_id="alex", action_id="cook-alex",
                              now=NOW + timedelta(seconds=1), lease_seconds=180).resource
    actions = (
        action("cook-emma", "emma", "prepare_food", target_resource_id=kitchen.id,
               location_id=kitchen.location_id),
        action("cook-alex", "alex", "prepare_food", target_resource_id=kitchen.id,
               location_id=kitchen.location_id),
    )
    snapshot = CollisionSnapshot("window-1", NOW, actions=actions, resources=(queued,))
    first_result = detect_collisions(snapshot)
    replay = detect_collisions(snapshot)
    assert first_result == replay and len(first_result) == 1
    collision = first_result[0]
    assert collision.kind == "person_resource"
    assert collision.scenario_id == "kitchen_capacity_collision"
    assert collision.participant_ids == ("emma", "alex")
    assert collision.facts["queue_depth"] == 1
    assert collision.thread_key


@pytest.mark.parametrize(
    ("scenario_id", "triggers", "resource_kind", "expected"),
    (
        (
            "kitchen_capacity_collision", ("resource_capacity", "kitchen_busy"),
            "kitchen", {"negotiate", "cook_together", "argue"},
        ),
        (
            "bathroom_wait_collision", ("resource_capacity", "bathroom_wait"),
            "bathroom", {"wait", "offer_quick_turn", "snap_at_other"},
        ),
        (
            "television_preference_collision", ("program_preference", "resource_capacity"),
            "television", {"choose_together", "yield_remote", "grab_remote"},
        ),
    ),
)
def test_each_shared_resource_has_three_persona_or_relationship_driven_reactions(
    scenario_id, triggers, resource_kind, expected,
):
    """The fact is fixed; only the resident/relationship context changes."""
    collision = build_collision(
        kind="person_resource", triggers=triggers,
        participant_ids=("a", "b"), action_ids=("action-a", "action-b"),
        occurred_at=NOW, source_key=f"fixed-{scenario_id}",
        location_id="h:shared-room", resource_kind=resource_kind,
        resource_id=f"h:{resource_kind}",
        facts={"household_id": "h", "queue_depth": 1},
    )
    assert collision is not None and collision.scenario_id == scenario_id
    contexts = {
        "patient": ({
            "axes": {"warmth": 45, "assertiveness": 10,
                     "emotional_stability": 100, "openness": 50},
            "emotion": {"stress": 0}, "behavior": {"conflict_style": "measured"},
            "householdRole": "mediator", "pride": 40,
        }, {"trust": 95, "affinity": 50, "tension": 0, "resentment": 0}),
        "warm": ({
            "axes": {"warmth": 100, "assertiveness": 25,
                     "emotional_stability": 70, "openness": 70},
            "emotion": {"stress": 5}, "behavior": {"conflict_style": "warm"},
            "householdRole": "caretaker", "pride": 30,
        }, {"trust": 80, "affinity": 100, "tension": 0, "resentment": 0}),
        "hostile": ({
            "axes": {"warmth": 0, "assertiveness": 100,
                     "emotional_stability": 0, "openness": 20},
            "emotion": {"stress": 100}, "behavior": {"conflict_style": "direct"},
            "householdRole": "free_spirit", "pride": 100,
        }, {"trust": 0, "affinity": 0, "tension": 100, "resentment": 100}),
    }
    responses = set()
    relationship_changes = []
    for profile, edge in contexts.values():
        resolution = resolve_collision_autonomously(
            collision,
            profiles={"a": profile, "b": profile},
            relationships={("a", "b"): edge, ("b", "a"): edge},
            settled_at=NOW,
        )
        responses.add(resolution.response_by_participant["a"])
        relationship_changes.append(resolution.relationship_changes)

    assert responses == expected
    assert len({str(value) for value in relationship_changes}) == 3


def test_busy_target_and_available_target_produce_different_person_collisions():
    invitation = action("talk-1", "emma", "talk_to_resident", target_npc_id="alex")
    asleep = action("sleep-1", "alex", "sleep", interruptible=False)
    busy = detect_collisions(CollisionSnapshot("w", NOW, actions=(invitation, asleep)))
    assert len(busy) == 1
    assert busy[0].scenario_id == "resident_unavailable"
    assert busy[0].facts["target_busy"] is True

    available = action("read-1", "alex", "read", interruptible=True)
    friendly = detect_collisions(CollisionSnapshot("w2", NOW, actions=(invitation, available)))
    assert len(friendly) == 1
    assert friendly[0].scenario_id == "friendly_company"
    assert friendly[0].facts["target_busy"] is False


def test_social_intention_waits_for_arrival_and_shared_hobby_can_become_rivalry_evidence():
    invitation = action("talk-trip", "emma", "talk_to_resident", target_npc_id="alex")
    invitation = LifeAction(**{**invitation.__dict__, "status": "traveling",
                               "arrives_at": NOW + timedelta(seconds=30),
                               "started_at": None, "ends_at": None})
    available = action("read-trip", "alex", "read")
    assert detect_collisions(CollisionSnapshot("travel", NOW, actions=(invitation, available))) == ()

    hobbies = (
        action("hobby-emma", "emma", "practice_hobby", location_id="music_hall"),
        action("hobby-alex", "alex", "practice_hobby", location_id="music_hall"),
    )
    collisions = detect_collisions(CollisionSnapshot("hobby", NOW, actions=hobbies))
    assert len(collisions) == 1
    assert collisions[0].scenario_id == "friendly_hobby_competition"
    resolution = resolve_collision_autonomously(collisions[0], settled_at=NOW)
    assert "competition" in resolution.outcome_tags


def test_seek_company_meets_an_arrived_resident_at_the_same_public_location():
    seeker = action("seek-emma", "emma", "seek_company", location_id="riverside_park")
    reader = action("read-alex", "alex", "read", location_id="riverside_park")

    collisions = detect_collisions(CollisionSnapshot("public-park", NOW, actions=(seeker, reader)))

    assert len(collisions) == 1
    assert collisions[0].scenario_id == "friendly_company"
    assert collisions[0].participant_ids == ("emma", "alex")
    assert collisions[0].facts["target_id"] == "alex"


def test_same_underlying_fact_has_the_same_id_across_polling_windows():
    seeker = action("seek-emma", "emma", "seek_company", location_id="riverside_park")
    reader = action("read-alex", "alex", "read", location_id="riverside_park")
    first = detect_collisions(CollisionSnapshot("poll-1", NOW, actions=(seeker, reader)))
    later = detect_collisions(CollisionSnapshot(
        "poll-2", NOW + timedelta(seconds=15), actions=(seeker, reader),
    ))

    assert len(first) == len(later) == 1
    assert first[0].id == later[0].id


def test_softmax_response_sampling_is_stable_but_not_always_the_top_response():
    profiles = {
        "emma": {"axes": {"warmth": 78, "assertiveness": 55,
                           "emotional_stability": 70, "openness": 65}},
        "alex": {"axes": {"warmth": 78, "assertiveness": 55,
                           "emotional_stability": 70, "openness": 65}},
    }
    outcomes = set()
    for index in range(40):
        collision = build_collision(
            kind="person_person", triggers=("quiet_company",),
            participant_ids=("emma", "alex"),
            action_ids=(f"emma-{index}", f"alex-{index}"), occurred_at=NOW,
            source_key=f"softmax-{index}", location_id="riverside_park",
        )
        assert collision is not None
        first = resolve_collision_autonomously(collision, profiles=profiles, settled_at=NOW)
        replay = resolve_collision_autonomously(collision, profiles=profiles, settled_at=NOW)
        assert first == replay
        outcomes.add(tuple(sorted(first.response_by_participant.items())))

    assert len(outcomes) >= 4


def test_responsibility_boundary_and_environment_facts_are_detected_together():
    snapshot = CollisionSnapshot(
        "window-facts", NOW,
        responsibilities=({
            "id": "dishes-1", "kind": "dishwashing", "created_by": "alex",
            "expected_npc_id": "alex", "responsible_npc_id": "emma",
            "trigger": "responsibility_overdue", "recurrence_count": 2,
            "household_id": "h", "location_id": "h:kitchen",
        },),
        boundary_events=({
            "id": "privacy-1", "kind": "privacy", "actor_id": "alex",
            "affected_id": "emma", "trigger": "private_space_entered",
            "household_id": "h", "location_id": "h:emma-room",
        },),
        environment_events=({
            "id": "closed-1", "kind": "location_closed", "npc_id": "emma",
            "trigger": "location_closed", "location_id": "city_library",
        },),
    )
    collisions = detect_collisions(snapshot)
    assert {value.kind for value in collisions} == {
        "person_responsibility", "person_boundary", "person_environment",
    }
    assert {value.scenario_id for value in collisions} == {
        "dirty_dishes_responsibility", "privacy_interruption", "facility_unavailable",
    }


def test_trash_private_food_and_shared_food_facts_reach_distinct_rule_scenarios():
    snapshot = CollisionSnapshot(
        "household-food-and-trash", NOW,
        responsibilities=({
            "id": "trash-1", "kind": "trash", "created_by": "alex",
            "expected_npc_id": "emma", "participant_ids": ["alex", "emma"],
            "trigger": "trash_bin_full", "household_id": "h",
            "location_id": "h:kitchen",
        },),
        boundary_events=({
            "id": "private-food-1", "kind": "private_food", "actor_id": "alex",
            "affected_id": "emma", "participant_ids": ["emma", "alex"],
            "trigger": "private_food_taken", "household_id": "h",
            "location_id": "h:kitchen", "consent": "not_given",
        },),
        social_events=({
            "id": "shared-food-1", "kind": "shared_food", "actor_id": "alex",
            "affected_id": "emma", "participant_ids": ["emma", "alex"],
            "trigger": "shared_food", "household_id": "h",
            "location_id": "h:kitchen",
        },),
    )

    collisions = detect_collisions(snapshot)

    assert {value.scenario_id for value in collisions} == {
        "trash_duty_responsibility",
        "private_food_taken_boundary",
        "shared_food_moment",
    }
    assert all(len(value.participant_ids) == 2 for value in collisions)
    assert all(len(value.response_candidates) >= 3 for value in collisions)


def test_autonomous_resolution_is_deterministic_directional_and_rule_owned():
    catalog = load_collision_catalog()
    collision = build_collision(
        kind="person_responsibility", triggers=("care_imbalance",),
        participant_ids=("emma", "alex"), action_ids=("clean-1", "idle-1"),
        occurred_at=NOW, source_key="care-1", location_id="h:kitchen",
        facts={"household_id": "h", "recurrence_count": 5}, catalog=catalog,
    )
    assert collision is not None
    profiles = {
        "emma": {"axes": {"warmth": 85, "assertiveness": 70,
                            "emotional_stability": 75, "openness": 70},
                 "emotion": {"stress": 55}},
        "alex": {"axes": {"warmth": 35, "assertiveness": 80,
                            "emotional_stability": 30, "openness": 30},
                 "emotion": {"stress": 88}},
    }
    edges = {
        ("emma", "alex"): {"trust": 55, "affinity": 55, "tension": 45, "resentment": 40},
        ("alex", "emma"): {"trust": 30, "affinity": 35, "tension": 70, "resentment": 65},
    }
    first = resolve_collision_autonomously(collision, profiles=profiles, relationships=edges,
                                           settled_at=NOW, catalog=catalog)
    replay = resolve_collision_autonomously(collision, profiles=profiles, relationships=edges,
                                            settled_at=NOW, catalog=catalog)
    assert first == replay
    assert set(first.response_by_participant) == {"emma", "alex"}
    assert {(value["npc_a"], value["npc_b"]) for value in first.relationship_changes} == {
        ("emma", "alex"), ("alex", "emma"),
    }
    assert set(first.action_instructions) == {"clean-1", "idle-1"}
    assert len(first.memory_seeds) == 2
    assert first.id.startswith("resolution-")


def test_subjective_memory_biases_but_does_not_lock_a_future_response():
    catalog = load_collision_catalog()
    collision = build_collision(
        kind="person_responsibility", triggers=("care_imbalance",),
        participant_ids=("emma", "alex"), action_ids=("clean-1", "idle-1"),
        occurred_at=NOW, source_key="remembered-care", location_id="h:kitchen",
        facts={"household_id": "h", "recurrence_count": 2}, catalog=catalog,
    )
    assert collision is not None
    response = catalog.scenarios[collision.scenario_id].responses[0]
    neutral = {"axes": {"warmth": 50, "assertiveness": 50,
                         "emotional_stability": 50, "openness": 50}}
    remembered = {**neutral, "memory_context": [{
        "npc_id": "emma", "other_npc_id": "alex", "topic": collision.topic,
        "response_id": response.id, "response_style": response.style,
    }]}
    base = _response_score(response, "emma", collision, neutral, {})
    influenced = _response_score(response, "emma", collision, remembered, {})
    assert influenced == base + 8
    # The bonus is bounded: a strong current relationship/personality signal
    # can still select another response through the softmax rule.
    assert influenced - base < 10


def test_high_severity_collision_opens_intervention_eligibility():
    collision = build_collision(
        kind="person_responsibility", triggers=("care_imbalance",),
        participant_ids=("emma", "alex"), action_ids=(), occurred_at=NOW,
        source_key="severe-care", facts={"recurrence_count": 8},
        profiles={"emma": {"emotion": {"stress": 100}}, "alex": {"emotion": {"stress": 100}}},
        relationships={("emma", "alex"): {"tension": 100},
                       ("alex", "emma"): {"tension": 100}},
    )
    assert collision and collision.severity >= 68
    resolution = resolve_collision_autonomously(collision, settled_at=NOW)
    assert resolution.requires_intervention


def test_collision_engine_facade_has_no_hidden_mutable_state():
    engine = CollisionEngine()
    snapshot = CollisionSnapshot(
        "w", NOW,
        environment_events=({"id": "noise", "kind": "noise", "npc_id": "emma",
                             "trigger": "environment_noise"},),
    )
    first = engine.detect(snapshot)
    second = engine.detect(snapshot)
    assert first == second
    assert engine.resolve(first[0], settled_at=NOW) == engine.resolve(first[0], settled_at=NOW)
