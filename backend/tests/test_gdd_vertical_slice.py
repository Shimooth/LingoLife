"""Executable acceptance contract for the GDD 12.2/12.4 vertical slice.

These tests intentionally use fixed instants and deterministic world ids.  A
failing assertion represents a product gap; it must not be made green by
sleeping, relaxing the ten-minute observation window, or injecting an LLM.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import replace
from datetime import datetime, timedelta, timezone
import json

import pytest
from fastapi.testclient import TestClient

from lingolife.app import DEFAULT_NPC_PROFILE, create_app
from lingolife.collisions import (
    Collision,
    CollisionResolution,
    CollisionScenario,
    CollisionSnapshot,
    build_collision,
    detect_collisions,
    load_collision_catalog,
    resolve_collision_autonomously,
)
from lingolife.config import Settings
from lingolife.life import (
    LifeAction,
    default_household_resources,
    reserve_resource,
)
from lingolife.life_world import LifeWorldEngine
from lingolife.layouts import SHARED_HOME_ACTIONS, shared_home_manifest
from lingolife.stories import (
    StoryContext,
    story_from_collision,
    update_unresolved_thread,
)


NOW = datetime(2026, 8, 28, 12, 0, tzinfo=timezone.utc)
HOUSEHOLD_ID = "household-shared"
RESIDENCE_ID = "residence-shared"
HOME_LOCATION_ID = "home-shared"


def _profiles(count: int) -> dict[str, dict]:
    """A stable, visibly varied cast without pre-writing relationship results."""
    archetypes = (
        ("warm", "assertive", "music", "cooking"),
        ("quiet", "thoughtful", "books", "art"),
        ("practical", "organized", "fitness", "cooking"),
        ("curious", "outgoing", "photography", "music"),
        ("sensitive", "creative", "art", "games"),
        ("independent", "direct", "books", "fitness"),
        ("playful", "messy", "games", "music"),
        ("patient", "private", "gardening", "photography"),
    )
    result: dict[str, dict] = {}
    for index in range(count):
        first, second, interest_a, interest_b = archetypes[index]
        npc_id = f"resident-{index + 1}"
        result[npc_id] = {
            "name": f"Resident {index + 1}",
            "age": 22 + index,
            "occupation": ("Designer", "Writer", "Chef", "Photographer")[index % 4],
            "longTermGoal": f"Complete personal goal {index + 1}.",
            "personality": [first, second],
            "interests": [interest_a, interest_b],
            "relationshipBoundaries": [],
            "romanceEnabled": True,
        }
    return result


def _shared_home(profiles: dict[str, dict]) -> dict[str, dict[str, str]]:
    return {
        npc_id: {
            "household_id": HOUSEHOLD_ID,
            "residence_id": RESIDENCE_ID,
            "home_location_id": HOME_LOCATION_ID,
            "current_location_id": HOME_LOCATION_ID,
        }
        for npc_id in profiles
    }


def _performing_action(
    action_id: str,
    npc_id: str,
    action_type: str,
    *,
    location_id: str = HOME_LOCATION_ID,
    target_resource_id: str | None = None,
    target_npc_id: str | None = None,
    duration_seconds: int = 3600,
) -> LifeAction:
    return LifeAction(
        id=action_id,
        player_id="gdd-player",
        npc_id=npc_id,
        action_type=action_type,
        status="performing",
        desire_id=f"desire-{action_id}",
        commitment_id=f"commitment-{action_id}",
        location_id=location_id,
        target_resource_id=target_resource_id,
        target_npc_id=target_npc_id,
        planned_at=NOW,
        duration_seconds=duration_seconds,
        interruptible=True,
        animation_cue="idle",
        collision_hooks=("resource_capacity",),
        need_deltas={},
        emotion_deltas={},
        resource_deltas={},
        started_at=NOW,
        ends_at=NOW + timedelta(seconds=duration_seconds),
    )


@pytest.mark.parametrize("resident_count", (2, 4, 8))
def test_two_four_and_eight_residents_share_one_home_and_survive_resource_pressure_and_offline_time(
    resident_count: int,
):
    """GDD 12.4: every supported cast size shares one authoritative home."""
    profiles = _profiles(resident_count)
    npc_ids = tuple(profiles)
    engine = LifeWorldEngine(timezone_name="UTC")
    initial = engine.initialize(
        f"gdd-shared-home-{resident_count}",
        profiles,
        _shared_home(profiles),
        now=NOW,
    )

    assert set(initial["households"]) == {HOUSEHOLD_ID}
    assert initial["households"][HOUSEHOLD_ID]["residence_id"] == RESIDENCE_ID
    assert set(initial["households"][HOUSEHOLD_ID]["members"]) == set(npc_ids)
    assert {resident["household_id"] for resident in initial["residents"].values()} == {
        HOUSEHOLD_ID
    }
    assert {resident["residence_id"] for resident in initial["residents"].values()} == {
        RESIDENCE_ID
    }
    assert {resident["home_location_id"] for resident in initial["residents"].values()} == {
        HOME_LOCATION_ID
    }
    bindings = initial["households"][HOUSEHOLD_ID]["resident_bindings"]
    assert [binding["npc_id"] for binding in bindings] == sorted(npc_ids)
    assert [binding["private_sleep_slot"] for binding in bindings] == list(
        range(1, resident_count + 1)
    )
    assert len({binding["private_room_id"] for binding in bindings}) == resident_count
    assert len({binding["private_sleep_anchor_id"] for binding in bindings}) == resident_count
    for binding in bindings:
        resident = initial["residents"][binding["npc_id"]]
        assert binding == {
            "npc_id": binding["npc_id"],
            "private_room_id": resident["private_room_id"],
            "private_sleep_slot": resident["private_sleep_slot"],
            "private_sleep_anchor_id": resident["private_sleep_anchor_id"],
        }
        assert not {
            "current_action", "current_location_id", "runtime", "observable_state",
        } & set(binding)
    public_household = engine.public_snapshot(initial)["households"][0]
    assert public_household["resident_bindings"] == bindings

    # Exercise all three minimum shared-resource classes with physically valid
    # current actions: one action per resident.  A two-person household fills
    # the two-seat TV and expresses a preference collision; resources whose
    # capacity is below the cast size additionally exercise the real queue.
    action_type_by_resource = {
        "kitchen": "prepare_food",
        "television": "use_television",
        "bathroom": "shower",
    }
    household_resources = {
        resource.kind: resource
        for resource in default_household_resources(HOUSEHOLD_ID)
    }
    assert set(household_resources) == set(action_type_by_resource)
    for kind, resource in household_resources.items():
        working = resource
        actions: list[LifeAction] = []
        for slot in range(resource.capacity):
            npc_id = npc_ids[slot % resident_count]
            action_id = f"{kind}-occupy-{slot}"
            transition = reserve_resource(
                working,
                npc_id=npc_id,
                action_id=action_id,
                now=NOW + timedelta(seconds=slot),
                lease_seconds=900,
            )
            assert transition.outcome == "acquired"
            working = transition.resource
            actions.append(
                _performing_action(
                    action_id,
                    npc_id,
                    action_type_by_resource[kind],
                    location_id=resource.location_id,
                    target_resource_id=resource.id,
                )
            )

        if resource.capacity < resident_count:
            queued_id = f"{kind}-queued"
            queued_npc = npc_ids[resource.capacity]
            queued = reserve_resource(
                working,
                npc_id=queued_npc,
                action_id=queued_id,
                now=NOW + timedelta(seconds=resource.capacity + 1),
                lease_seconds=900,
            )
            assert queued.outcome == "queued" and queued.queue_position == 1
            working = queued.resource
            actions.append(
                _performing_action(
                    queued_id,
                    queued_npc,
                    action_type_by_resource[kind],
                    location_id=resource.location_id,
                    target_resource_id=resource.id,
                )
            )
        else:
            assert kind == "television" and resource.capacity == resident_count == 2
            working = replace(
                working,
                state={**working.state, "preference_conflict": True},
            )
        collisions = detect_collisions(
            CollisionSnapshot(
                window_key=f"gdd-resource-{resident_count}-{kind}",
                now=NOW + timedelta(seconds=10),
                actions=tuple(actions),
                resources=(working,),
                profiles=profiles,
            )
        )
        assert any(
            collision.kind == "person_resource"
            and collision.resource_id == resource.id
            and len(collision.participant_ids) >= 2
            for collision in collisions
        ), f"{kind} pressure did not become a two-resident collision"

    # One deterministic six-hour catch-up is enough to cover completion,
    # replanning, resource release, and persistence of the shared-home model.
    advanced = engine.advance(initial, profiles, NOW + timedelta(hours=6))
    assert advanced["metrics"]["offline_blocks"] > 0
    assert advanced["metrics"]["completed_actions"] > 0
    assert set(advanced["households"]) == {HOUSEHOLD_ID}
    assert {resident["household_id"] for resident in advanced["residents"].values()} == {
        HOUSEHOLD_ID
    }
    assert {resident["residence_id"] for resident in advanced["residents"].values()} == {
        RESIDENCE_ID
    }
    assert {resident["home_location_id"] for resident in advanced["residents"].values()} == {
        HOME_LOCATION_ID
    }
    assert all(resident["current_action"] for resident in advanced["residents"].values())


def test_every_residential_action_resolves_to_a_manifest_canonical_anchor():
    profiles = _profiles(4)
    engine = LifeWorldEngine(timezone_name="UTC")
    state = engine.initialize(
        "gdd-action-anchors", profiles, _shared_home(profiles), now=NOW,
    )
    manifest_locations = {
        action: {
            f"{HOUSEHOLD_ID}:{room['id']}:{anchor['id']}"
            for room in shared_home_manifest()["rooms"]
            for anchor in room.get("anchors", [])
            for action in anchor.get("actions", [])
        }
        for action in SHARED_HOME_ACTIONS
    }
    assert set(manifest_locations) == SHARED_HOME_ACTIONS

    for action_type, expected_locations in manifest_locations.items():
        for npc_id in profiles:
            location = engine._canonical_home_action_location(
                state, npc_id, action_type, "2026-08-28:afternoon:fixture",
            )
            assert location in expected_locations
            if action_type in {"sleep", "rest_alone"}:
                assert location.endswith(
                    ":" + state["residents"][npc_id]["private_sleep_anchor_id"]
                )


def test_shared_home_assignment_and_timeline_are_refresh_deterministic():
    profiles = _profiles(8)
    reversed_profiles = dict(reversed(tuple(profiles.items())))
    engine = LifeWorldEngine(timezone_name="UTC")
    first = engine.initialize(
        "gdd-refresh-determinism", profiles, _shared_home(profiles), now=NOW,
    )
    reordered = engine.initialize(
        "gdd-refresh-determinism",
        reversed_profiles,
        _shared_home(reversed_profiles),
        now=NOW,
    )
    assert first == reordered

    first_advance = engine.advance(deepcopy(first), profiles, NOW + timedelta(minutes=10))
    replay_advance = engine.advance(deepcopy(first), reversed_profiles, NOW + timedelta(minutes=10))
    assert first_advance == replay_advance
    assert engine.advance(
        deepcopy(first_advance), profiles, NOW + timedelta(minutes=10),
    ) == first_advance
    assert first_advance["households"][HOUSEHOLD_ID]["resident_bindings"] == \
        first["households"][HOUSEHOLD_ID]["resident_bindings"]


def _action_signature(resident: dict) -> tuple[str, str, str | None, str | None]:
    action = resident["current_action"]
    return (
        str(action["id"]),
        str(action["status"]),
        action.get("location_id"),
        action.get("target_npc_id"),
    )


def test_fixed_ten_minute_observation_has_three_changes_and_one_autonomous_npc_collision():
    """GDD 12.4's ten-minute promise, with no wall-clock or sleep dependency."""
    profiles = _profiles(4)
    engine = LifeWorldEngine(timezone_name="UTC")
    state = engine.initialize(
        "gdd-ten-minute-observation",
        profiles,
        _shared_home(profiles),
        now=NOW,
    )
    previous = {
        npc_id: _action_signature(resident)
        for npc_id, resident in state["residents"].items()
    }
    changes: set[tuple] = set()

    # Step the deterministic decision cadence exactly twenty times.  Advancing
    # simulated time is not a reason to wait ten real minutes in CI.
    for step in range(1, 21):
        simulated_now = NOW + timedelta(seconds=30 * step)
        state = engine.advance(state, profiles, simulated_now)
        current = {
            npc_id: _action_signature(resident)
            for npc_id, resident in state["residents"].items()
        }
        for npc_id in profiles:
            if current[npc_id] != previous[npc_id]:
                changes.add((npc_id, *previous[npc_id], *current[npc_id]))
        previous = current

    autonomous_npc_collisions = [
        record
        for record in state["stories"].values()
        if record.get("collision")
        and len(record["collision"].get("participant_ids", [])) >= 2
        and (record.get("resolution") or {}).get("mode") == "autonomous"
        and NOW
        <= datetime.fromisoformat(record["collision"]["occurred_at"])
        <= NOW + timedelta(minutes=10)
    ]
    failures = []
    if len(changes) < 3:
        failures.append(
            f"only {len(changes)} distinct arrival/stage/action changes occurred: {sorted(changes)!r}"
        )
    if not autonomous_npc_collisions:
        failures.append("no autonomous two-NPC collision occurred in the fixed ten-minute window")
    assert not failures, "; ".join(failures)


ROOMMATE_FRICTIONS = {
    "dirty_dishes": ("dishwashing", "dirty_dish"),
    "trash_duty": ("trash", "garbage"),
    "remote_control": ("remote",),
    "private_food_taken": (
        "private_food",
        "personal_food",
        "food_taken",
        "food_eaten",
        "stolen_food",
        "ate_someone",
    ),
    "night_noise": ("noise",),
    "borrowed_not_returned": ("borrowed", "borrowing"),
    "bathroom_overstay": ("bathroom",),
    "unequal_care": ("unequal_care", "care_imbalance"),
}


def _scenario_corpus(scenario: CollisionScenario) -> str:
    return " ".join(
        (
            scenario.id,
            scenario.topic,
            *scenario.triggers,
            *(response.id for response in scenario.responses),
        )
    ).casefold()


def _find_scenario(terms: tuple[str, ...]) -> CollisionScenario | None:
    catalog = load_collision_catalog()
    return next(
        (
            scenario
            for scenario in catalog.scenarios.values()
            if any(term.casefold() in _scenario_corpus(scenario) for term in terms)
        ),
        None,
    )


@pytest.mark.parametrize(
    ("friction", "terms"),
    tuple(ROOMMATE_FRICTIONS.items()),
    ids=tuple(ROOMMATE_FRICTIONS),
)
def test_each_required_roommate_friction_is_rule_reachable_with_three_reactions(
    friction: str,
    terms: tuple[str, ...],
):
    """Random-event design 6.2 is a content contract, not a total-count proxy."""
    scenario = _find_scenario(terms)
    assert scenario is not None, f"missing roommate friction content: {friction}"
    assert len(scenario.responses) >= 3

    collision = build_collision(
        kind=scenario.kind,
        triggers=scenario.triggers,
        participant_ids=("resident-1", "resident-2"),
        action_ids=(f"{friction}-a", f"{friction}-b"),
        occurred_at=NOW,
        source_key=f"gdd-friction-{friction}",
        location_id=HOME_LOCATION_ID,
        resource_kind=scenario.resource_kinds[0] if scenario.resource_kinds else None,
        facts={"household_id": HOUSEHOLD_ID, "recurrence_count": 2},
    )
    assert collision is not None and collision.scenario_id == scenario.id
    assert len(collision.response_candidates) >= 3


def test_shared_household_borrowing_can_naturally_reach_a_property_boundary():
    """A catalog entry is insufficient if the authoritative world cannot emit it."""
    profiles = _profiles(2)
    engine = LifeWorldEngine(timezone_name="UTC")
    state = engine.initialize(
        "gdd-borrowed-property",
        profiles,
        _shared_home(profiles),
        now=NOW,
    )
    first, second = tuple(profiles)
    borrow_location = engine._canonical_home_action_location(
        state, first, "borrow_household_item", "gdd-borrow-fixture",
        target_npc_id=second,
    )
    assert borrow_location is not None
    state["residents"][first]["current_action"] = _performing_action(
        "borrow-shared-item",
        first,
        "borrow_household_item",
        location_id=borrow_location,
        target_npc_id=second,
    ).to_dict()
    state["residents"][second]["current_action"] = _performing_action(
        "read-at-home",
        second,
        "read",
    ).to_dict()

    boundary_events, _ = engine._fact_events(state, NOW)
    borrowed = [event for event in boundary_events if event.get("kind") == "borrowed_item"]
    assert borrowed, "shared-home borrowing never emitted the borrowed-property boundary fact"
    assert borrowed[0]["actor_id"] == first
    assert borrowed[0]["affected_id"] == second
    assert set(borrowed[0]["participant_ids"]) == {first, second}
    assert borrowed[0]["item_id"] in {
        item["id"] for item in state["residents"][second]["personal_inventory"]
    }
    assert borrowed[0]["owner_expectation"] == "ask_first"
    collisions = detect_collisions(
        CollisionSnapshot(
            window_key="gdd-borrow-boundary",
            now=NOW,
            actions=tuple(
                LifeAction.from_dict(resident["current_action"])
                for resident in state["residents"].values()
            ),
            boundary_events=tuple(borrowed),
            profiles=profiles,
        )
    )
    assert any(value.scenario_id == "borrowed_item_boundary" for value in collisions)


def _complete_fixture_action(
    engine: LifeWorldEngine,
    state: dict,
    action: LifeAction,
    completed_at: datetime,
) -> None:
    completed = replace(
        action,
        status="completed",
        ends_at=completed_at,
        completed_at=completed_at,
    )
    engine._complete_action(
        state,
        state["residents"][completed.npc_id],
        completed,
        {"needs": {}, "emotion": {}, "resource": {}},
        engine._resource_map(state),
        completed_at,
    )


def test_full_household_bin_naturally_becomes_trash_duty_and_cleaning_resolves_it():
    profiles = _profiles(2)
    engine = LifeWorldEngine(timezone_name="UTC")
    state = engine.initialize(
        "gdd-natural-trash-duty", profiles, _shared_home(profiles), now=NOW,
    )
    state["responsibilities"] = []
    state["households"][HOUSEHOLD_ID]["state"]["trash_load"] = 90
    first, second = tuple(profiles)
    meal = _performing_action(
        "meal-that-fills-bin", first, "eat",
        location_id=f"{HOUSEHOLD_ID}:shared-kitchen",
    )

    _complete_fixture_action(engine, state, meal, NOW + timedelta(minutes=20))

    trash = [
        fact for fact in state["responsibilities"]
        if fact.get("active") and fact.get("kind") == "trash"
    ]
    assert len(trash) == 1
    assert set(trash[0]["participant_ids"]) == {first, second}
    collision = detect_collisions(
        CollisionSnapshot(
            window_key="gdd-natural-trash-duty",
            now=NOW + timedelta(minutes=20),
            responsibilities=tuple(trash),
            profiles=profiles,
        )
    )
    assert [value.scenario_id for value in collision] == ["trash_duty_responsibility"]
    engine._detect_and_record(
        state, profiles, "gdd-natural-trash-duty", NOW + timedelta(minutes=20),
    )
    assert any(
        (record.get("collision") or {}).get("scenario_id") == "trash_duty_responsibility"
        for record in state["stories"].values()
    )

    cleaning = _performing_action(
        "clean-after-trash", second, "clean_shared_space",
        location_id=f"{HOUSEHOLD_ID}:living-room",
    )
    _complete_fixture_action(engine, state, cleaning, NOW + timedelta(hours=1))
    assert trash[0]["active"] is False
    assert state["households"][HOUSEHOLD_ID]["state"]["trash_load"] == 0


@pytest.mark.parametrize(
    ("access", "prepared_action_id", "expected_scenario"),
    (
        ("shared", "prepare-shared-0", "shared_food_moment"),
        ("private", "prepare-private-0", "private_food_taken_boundary"),
    ),
)
def test_prepared_food_ownership_naturally_reaches_social_or_boundary_collision(
    access: str,
    prepared_action_id: str,
    expected_scenario: str,
):
    profiles = _profiles(2)
    engine = LifeWorldEngine(timezone_name="UTC")
    state = engine.initialize(
        f"gdd-natural-{access}-food", profiles, _shared_home(profiles), now=NOW,
    )
    state["household_food"] = []
    owner, consumer = tuple(profiles)
    kitchen_id = f"{HOUSEHOLD_ID}:kitchen"
    kitchen_location = f"{HOUSEHOLD_ID}:shared-kitchen"
    prepared = _performing_action(
        prepared_action_id,
        owner,
        "prepare_food",
        location_id=kitchen_location,
        target_resource_id=kitchen_id,
    )
    _complete_fixture_action(engine, state, prepared, NOW + timedelta(minutes=30))
    assert len(state["household_food"]) == 1
    portion = state["household_food"][0]
    assert portion["access"] == access
    assert portion["owner_id"] == owner
    assert portion["active"] is True

    ate = _performing_action(
        f"consume-{access}-portion",
        consumer,
        "eat",
        location_id=kitchen_location,
    )
    _complete_fixture_action(engine, state, ate, NOW + timedelta(hours=1))
    assert portion["active"] is False
    assert portion["consumed_by"] == consumer

    boundaries, social = engine._food_fact_events(state, NOW + timedelta(hours=1))
    snapshot = CollisionSnapshot(
        window_key=f"gdd-natural-{access}-food",
        now=NOW + timedelta(hours=1),
        boundary_events=tuple(boundaries),
        social_events=tuple(social),
        profiles=profiles,
    )
    collisions = detect_collisions(snapshot)
    assert [value.scenario_id for value in collisions] == [expected_scenario]
    assert collisions[0].participant_ids == (owner, consumer)
    engine._detect_and_record(
        state, profiles, f"gdd-natural-{access}-food", NOW + timedelta(hours=1),
    )
    record = next(
        record for record in state["stories"].values()
        if (record.get("collision") or {}).get("scenario_id") == expected_scenario
    )
    assert record["resolution"]["mode"] == "autonomous"
    beats = [
        beat
        for stage in record["interaction"]["stages"]
        for beat in stage["beats"]
    ]
    assert len(beats) >= 5
    assert all(beat["text"] and beat["translation_zh"] for beat in beats)


FRIENDLY_MOMENTS = {
    "share_food": "accept_shared_food",
    "shared_entertainment": "choose_together",
    "practical_help": "offer_to_share",
    "quiet_company": "enjoy_silence",
}


@pytest.mark.parametrize(
    ("moment_kind", "response_id"),
    tuple(FRIENDLY_MOMENTS.items()),
    ids=tuple(FRIENDLY_MOMENTS),
)
def test_each_required_friendly_path_can_resolve_as_a_two_npc_moment(
    moment_kind: str,
    response_id: str,
):
    """Random-event design 6.3 requires four genuinely social Moment paths."""
    catalog = load_collision_catalog()
    scenario = next(
        (
            candidate
            for candidate in catalog.scenarios.values()
            if response_id in {response.id for response in candidate.responses}
        ),
        None,
    )
    assert scenario is not None, f"missing friendly Moment response: {moment_kind}"
    assert scenario.kind != "person_environment", (
        f"{moment_kind} is only a one-person environment response, not an NPC-NPC path"
    )

    profiles = {
        npc_id: {
            "axes": {
                "warmth": 95,
                "assertiveness": 45,
                "emotional_stability": 90,
                "openness": 85,
            },
            "emotion": {"stress": 10},
        }
        for npc_id in ("resident-1", "resident-2")
    }
    relationships = {
        (owner, target): {
            "trust": 90,
            "affinity": 90,
            "comfort": 90,
            "tension": 0,
            "resentment": 0,
        }
        for owner, target in (("resident-1", "resident-2"), ("resident-2", "resident-1"))
    }
    reached: tuple[Collision, CollisionResolution] | None = None
    for attempt in range(256):
        collision = build_collision(
            kind=scenario.kind,
            triggers=scenario.triggers,
            participant_ids=("resident-1", "resident-2"),
            action_ids=(f"{moment_kind}-a", f"{moment_kind}-b"),
            occurred_at=NOW,
            source_key=f"gdd-friendly-{moment_kind}-{attempt}",
            location_id=HOME_LOCATION_ID,
            resource_kind=scenario.resource_kinds[0] if scenario.resource_kinds else None,
            facts={"household_id": HOUSEHOLD_ID},
            profiles=profiles,
            relationships=relationships,
            catalog=catalog,
        )
        assert collision is not None
        resolution = resolve_collision_autonomously(
            collision,
            profiles=profiles,
            relationships=relationships,
            settled_at=NOW,
            catalog=catalog,
        )
        if response_id in resolution.response_by_participant.values() and "conflict" not in resolution.outcome_tags:
            reached = collision, resolution
            break

    assert reached is not None, f"friendly response {response_id} is not selectable"
    collision, resolution = reached
    story = story_from_collision(
        collision,
        resolution,
        context=StoryContext(
            novelty=85,
            personality_expression=85,
            relationship_relevance=90,
            visual_readability=85,
            player_context_relevance=30,
            need_stakes=5,
            household_impact=5,
            safe_autonomous_capacity=100,
        ),
        now=NOW,
    )
    assert len(story.participant_ids) == 2
    assert story.level == "moment"


def test_same_collision_has_three_persona_or_relationship_dependent_reactions():
    """GDD 12.4: facts stay fixed while the resident's interpretation changes."""
    collision = build_collision(
        kind="person_responsibility",
        triggers=("care_imbalance",),
        participant_ids=("ava", "bo"),
        action_ids=("care-a", "care-b"),
        occurred_at=NOW,
        # The source is a fixed fixture whose deterministic softmax draw lands
        # in three different portions of the distribution as context changes.
        source_key="gdd-reaction-126",
        location_id=HOME_LOCATION_ID,
        facts={"household_id": HOUSEHOLD_ID, "recurrence_count": 5},
    )
    assert collision is not None
    contexts = (
        (
            {
                "axes": {
                    "warmth": 100,
                    "assertiveness": 20,
                    "emotional_stability": 100,
                    "openness": 80,
                },
                "emotion": {"stress": 0},
            },
            {"trust": 100, "affinity": 100, "tension": 0, "resentment": 0},
        ),
        (
            {
                "axes": {
                    "warmth": 20,
                    "assertiveness": 100,
                    "emotional_stability": 90,
                    "openness": 40,
                },
                "emotion": {"stress": 30},
            },
            {"trust": 45, "affinity": 40, "tension": 40, "resentment": 25},
        ),
        (
            {
                "axes": {
                    "warmth": 0,
                    "assertiveness": 100,
                    "emotional_stability": 0,
                    "openness": 0,
                },
                "emotion": {"stress": 100},
            },
            {"trust": 0, "affinity": 0, "tension": 100, "resentment": 100},
        ),
    )
    reactions = []
    for profile, relationship in contexts:
        resolution = resolve_collision_autonomously(
            collision,
            profiles={"ava": profile},
            relationships={("ava", "bo"): relationship},
            settled_at=NOW,
        )
        reactions.append(resolution.response_by_participant["ava"])

    assert len(set(reactions)) >= 3, reactions


def _thread_collision(day: int, recurrence: int) -> Collision:
    collision = build_collision(
        kind="person_responsibility",
        triggers=("care_imbalance",),
        participant_ids=("ava", "bo"),
        action_ids=(f"care-day-{day}", f"affected-day-{day}"),
        occurred_at=NOW + timedelta(days=day - 1),
        source_key=f"gdd-three-day-thread-{day}",
        location_id=HOME_LOCATION_ID,
        facts={"household_id": HOUSEHOLD_ID, "recurrence_count": recurrence},
    )
    assert collision is not None
    return collision


def _resolution_with_outcome(
    collision: Collision,
    *,
    severity_after: int,
    outcome: str,
) -> CollisionResolution:
    base = resolve_collision_autonomously(collision, settled_at=collision.occurred_at)
    return replace(
        base,
        severity_before=collision.severity,
        severity_after=severity_after,
        outcome_tags=(outcome, "thread_candidate", collision.kind),
        settled_at=collision.occurred_at,
    )


def test_one_thread_recurs_escalates_and_is_repaired_across_three_days():
    """GDD 12.2/12.4: household conflict is continuity, not three one-shot events."""
    day_one_collision = _thread_collision(day=1, recurrence=1)
    day_one_resolution = _resolution_with_outcome(
        day_one_collision,
        severity_after=day_one_collision.severity,
        outcome="conflict",
    )
    day_one_story = story_from_collision(
        day_one_collision,
        day_one_resolution,
        context=StoryContext(need_stakes=70, household_impact=80),
        now=day_one_collision.occurred_at,
    )
    thread_one = update_unresolved_thread(
        None,
        story=day_one_story,
        collision=day_one_collision,
        resolution=day_one_resolution,
        now=day_one_collision.occurred_at,
    )
    assert thread_one is not None
    assert thread_one.recurrence_count == 1

    day_two_collision = _thread_collision(day=2, recurrence=2)
    assert day_two_collision.thread_key == thread_one.id
    day_two_resolution = _resolution_with_outcome(
        day_two_collision,
        severity_after=75,
        outcome="conflict",
    )
    day_two_story = story_from_collision(
        day_two_collision,
        day_two_resolution,
        context=StoryContext(
            existing_thread_id=thread_one.id,
            existing_thread_intensity=thread_one.intensity,
            recurrence_count=thread_one.recurrence_count,
            unresolved_thread_pressure=thread_one.intensity,
        ),
        now=day_two_collision.occurred_at,
    )
    thread_two = update_unresolved_thread(
        thread_one,
        story=day_two_story,
        collision=day_two_collision,
        resolution=day_two_resolution,
        now=day_two_collision.occurred_at,
    )
    assert thread_two is not None
    assert thread_two.id == thread_one.id
    assert thread_two.recurrence_count == 2
    assert thread_two.intensity > thread_one.intensity
    assert thread_two.status == "escalated"

    day_three_collision = _thread_collision(day=3, recurrence=3)
    assert day_three_collision.thread_key == thread_two.id
    day_three_resolution = _resolution_with_outcome(
        day_three_collision,
        severity_after=20,
        outcome="cooperation",
    )
    day_three_story = story_from_collision(
        day_three_collision,
        day_three_resolution,
        context=StoryContext(
            existing_thread_id=thread_two.id,
            existing_thread_intensity=thread_two.intensity,
            recurrence_count=thread_two.recurrence_count,
            unresolved_thread_pressure=thread_two.intensity,
        ),
        now=day_three_collision.occurred_at,
    )
    thread_three = update_unresolved_thread(
        thread_two,
        story=day_three_story,
        collision=day_three_collision,
        resolution=day_three_resolution,
        now=day_three_collision.occurred_at,
    )
    assert thread_three is not None
    assert thread_three.id == thread_one.id
    assert thread_three.recurrence_count == 3
    assert len(thread_three.source_story_ids) == 3
    assert thread_three.intensity < thread_two.intensity
    assert thread_three.status in {"temporarily_settled", "resolved"}
    assert set(thread_three.perspectives) == {"ava", "bo"}


def _onboarding_profile(
    name: str,
    personality: list[str],
    interests: list[str],
    *,
    occupation: str,
    household_role: str,
    chores: list[str],
    privacy: str,
    habits: list[str],
) -> dict:
    profile = deepcopy(DEFAULT_NPC_PROFILE)
    profile.update(
        {
            "name": name,
            "personality": personality,
            "interests": interests,
            "occupation": occupation,
            "householdRole": household_role,
            "chorePreferences": chores,
            "privateSpacePreference": privacy,
            "habits": habits,
        }
    )
    return profile


def test_deepseek_disabled_still_runs_onboarding_world_simulation_and_chat(tmp_path):
    """Rules own gameplay; the configured LLM is optional for a complete loop."""
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'gdd-no-deepseek.db'}",
        web_root=str(tmp_path / "missing-web"),
        deepseek_api_key=None,
        life_simulation_v2=True,
        game_timezone="UTC",
        chat_per_minute=20,
    )
    assert settings.deepseek_api_key is None
    client = TestClient(create_app(settings))
    invite = client.app.state.db.create_invites(1, 30)[0]
    registered = client.post(
        "/api/v1/auth/register",
        json={
            "username": "gdd-no-deepseek",
            "invite_code": invite,
            "password": "any format is accepted",
        },
    )
    assert registered.status_code == 201, registered.text
    headers = {"Authorization": "Bearer " + registered.json()["session_token"]}
    intro = client.post(
        "/api/v1/onboarding/intro/acknowledge",
        headers=headers,
        json={"intro_version": 1},
    )
    assert intro.status_code == 200, intro.text
    completed = client.post(
        "/api/v1/onboarding/complete",
        headers=headers,
        json={
            "household_name": "Cloud House",
            "residents": [
                _onboarding_profile(
                    "Ava",
                    ["warm", "assertive"],
                    ["music", "cooking"],
                    occupation="Designer",
                    household_role="organizer",
                    chores=["cooking", "dishes"],
                    privacy="low",
                    habits=["starts creative work early"],
                ),
                _onboarding_profile(
                    "Bo",
                    ["quiet", "thoughtful"],
                    ["books", "art"],
                    occupation="Engineer",
                    household_role="free_spirit",
                    chores=["laundry", "repairs"],
                    privacy="high",
                    habits=["reads alone after midnight"],
                ),
            ],
        },
    )
    assert completed.status_code == 201, completed.text
    created_ids = [resident["id"] for resident in completed.json()["created"]]

    world = client.get("/api/v1/world", headers=headers)
    assert world.status_code == 200, world.text
    payload = world.json()
    assert len(payload["npcs"]) == 2
    assert len(payload["households"]) == 1
    assert {member["npc_id"] for member in payload["households"][0]["members"]} == set(
        created_ids
    )
    assert all(resident.get("current_action") for resident in payload["npcs"])

    chat = client.post(
        "/api/v1/chat",
        headers={**headers, "Idempotency-Key": "gdd-no-deepseek-chat-01"},
        json={"npc_id": created_ids[0], "message": "Why? What happened today?"},
    )
    assert chat.status_code == 200, chat.text
    reply = chat.json()
    assert reply["npc_reply"]
    assert reply["english_feedback"]["is_understandable"] is True
    assert isinstance(reply["relationship_change"], int)
    assert isinstance(reply["mood_change"], int)

    traces = client.app.state.db.list_agent_traces()
    trace = next(item for item in traces if item["request_id"] == "gdd-no-deepseek-chat-01")
    assert trace["fallback_used"] == 1
    assert trace["model"] == "rules"
    # JSON serializability is part of the browser/server contract and catches
    # accidental leakage of domain objects into the fallback path.
    json.dumps(payload)
    json.dumps(reply)
