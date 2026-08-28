from __future__ import annotations

from datetime import datetime, timedelta, timezone

from lingolife.collisions import (
    COLLISION_KINDS,
    CollisionEngine,
    CollisionSnapshot,
    build_collision,
    detect_collisions,
    load_collision_catalog,
    resolve_collision_autonomously,
)
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
