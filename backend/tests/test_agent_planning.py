"""Executable NPC Agent planning contracts from GDD sections 5, 6 and 7.

The fixtures use fixed instants and persisted world JSON.  They deliberately
exercise the rules kernel without an LLM or wall-clock sleeps.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json

import pytest

from lingolife.life import (
    CORE_NEEDS,
    NpcLifeContext,
    advance_life_action,
    create_life_action,
    default_household_resources,
    select_life_action,
)
from lingolife.life_world import LifeWorldEngine


NOW = datetime(2026, 9, 4, 12, 0, tzinfo=timezone.utc)
HOUSEHOLD_ID = "planning-household"
HOME_ID = "planning-home"


def _profiles() -> dict[str, dict]:
    return {
        "ava": {
            "name": "Ava", "age": 25, "occupation": "Designer",
            "personality": ["quiet", "private"], "interests": ["books", "art"],
            "privateSpacePreference": "high", "dislikes": ["borrowing"],
        },
        "bo": {
            "name": "Bo", "age": 24, "occupation": "Student",
            "personality": ["outgoing", "warm"], "interests": ["music", "fitness"],
        },
    }


def _home(profiles: dict[str, dict]) -> dict[str, dict[str, str]]:
    return {
        npc_id: {"household_id": HOUSEHOLD_ID, "location_id": HOME_ID}
        for npc_id in profiles
    }


def _needs(**changes: int) -> dict[str, int]:
    result = {need: 70 for need in CORE_NEEDS}
    result.update(changes)
    return result


def _block(state: dict, npc_id: str, game_date: str, kind: str) -> dict:
    return next(
        value for value in state["residents"][npc_id]["daily_plans"][game_date]["blocks"]
        if value["kind"] == kind
    )


def _simulation_facts(state: dict) -> dict:
    """Exclude request accounting while comparing authoritative simulation."""
    metrics = {key: value for key, value in state["metrics"].items() if key != "offline_blocks"}
    return {
        "residents": state["residents"], "households": state["households"],
        "resources": state["resources"], "relationships": state["relationships"],
        "stories": state["stories"], "threads": state["threads"],
        "relationship_evidence": state["relationship_evidence"],
        "processed_collision_ids": state["processed_collision_ids"],
        "aftermath": state["aftermath"], "desire_effect_ids": state["desire_effect_ids"],
        "simulation_cursor_at": state["simulation_cursor_at"], "metrics": metrics,
    }


def test_daily_plans_are_deterministic_persisted_and_include_reciprocal_invitation():
    profiles = _profiles()
    engine = LifeWorldEngine(timezone_name="UTC")
    args = ("daily-plan", profiles, _home(profiles), None, None, NOW)
    initial = engine.initialize(*args)
    regenerated = LifeWorldEngine(timezone_name="UTC").initialize(*args)

    assert initial["residents"]["ava"]["daily_plans"] \
        == regenerated["residents"]["ava"]["daily_plans"]
    assert initial["residents"]["bo"]["daily_plans"] \
        == regenerated["residents"]["bo"]["daily_plans"]
    for npc_id, scheduled_kind in (("ava", "work"), ("bo", "study")):
        plan = initial["residents"][npc_id]["daily_plans"]["2026-09-04"]
        assert {block["kind"] for block in plan["blocks"]} >= {
            scheduled_kind, "sleep_window", "accepted_invitation",
        }
        assert all({"id", "starts_at", "ends_at", "location_id", "status"} <= block.keys()
                   for block in plan["blocks"])

    ava_invite = _block(initial, "ava", "2026-09-04", "accepted_invitation")
    bo_invite = _block(initial, "bo", "2026-09-04", "accepted_invitation")
    assert ava_invite["target_npc_id"] == "bo"
    assert bo_invite["target_npc_id"] == "ava"
    assert (ava_invite["starts_at"], ava_invite["ends_at"], ava_invite["location_id"]) \
        == (bo_invite["starts_at"], bo_invite["ends_at"], bo_invite["location_id"])

    # A fresh engine represents a process restart. Existing plan JSON wins even
    # if editable profile inputs change after the day has already been planned.
    stored_plans = {
        npc_id: deepcopy(resident["daily_plans"])
        for npc_id, resident in initial["residents"].items()
    }
    edited_profiles = deepcopy(profiles)
    edited_profiles["ava"]["occupation"] = "Chef"
    refreshed = LifeWorldEngine(timezone_name="UTC").advance(
        initial, edited_profiles, NOW + timedelta(seconds=1),
    )
    assert {npc_id: resident["daily_plans"] for npc_id, resident in refreshed["residents"].items()} \
        == stored_plans


def test_household_context_owns_private_items_rules_and_sleep_space():
    profiles = _profiles()
    state = LifeWorldEngine(timezone_name="UTC").initialize(
        "household-context", profiles, _home(profiles), now=NOW,
    )

    item_ids: set[str] = set()
    room_ids: set[str] = set()
    for npc_id, resident in state["residents"].items():
        inventory = resident["personal_inventory"]
        assert len(inventory) >= 2
        assert all(item["owner_id"] == npc_id and item["share_policy"] == "ask_first"
                   and item["room_id"] == resident["private_room_id"]
                   for item in inventory)
        assert not item_ids.intersection(item["id"] for item in inventory)
        item_ids.update(item["id"] for item in inventory)
        room_ids.add(resident["private_room_id"])
        expectations = resident["shared_rule_expectations"]
        assert expectations["borrowing"] == "ask_first"
        assert expectations["private_space"] in {"low", "balanced", "high"}
        assert expectations["preferred_chores"]
    assert len(room_ids) == len(profiles)


def test_active_schedule_constrains_action_once_and_records_late_arrival_and_transitions():
    profiles = _profiles()
    engine = LifeWorldEngine(timezone_name="UTC")
    state = engine.initialize("daily-plan", profiles, _home(profiles), now=NOW)

    assert state["residents"]["ava"]["current_action"]["action_type"] == "practice_hobby"
    assert state["residents"]["ava"]["current_action"]["location_id"] == "innovation_hub"
    assert state["residents"]["bo"]["current_action"]["action_type"] == "read"
    assert state["residents"]["bo"]["current_action"]["location_id"] == "city_library"

    arrivals = [
        datetime.fromisoformat(resident["current_action"]["arrives_at"])
        for resident in state["residents"].values()
    ]
    state = engine.advance(state, profiles, max(arrivals))
    for npc_id, block_kind in (("ava", "work"), ("bo", "study")):
        plan_block = _block(state, npc_id, "2026-09-04", block_kind)
        assert plan_block["status"] == "in_progress"
        assert plan_block["attended_at"]
        consequence = state["residents"][npc_id]["schedule_consequences"][-1]
        assert consequence["kind"] == "late"
        assert consequence["reason"] == "arrived_after_scheduled_start"

    action_ends = [
        datetime.fromisoformat(resident["current_action"]["ends_at"])
        for resident in state["residents"].values()
    ]
    state = engine.advance(state, profiles, max(action_ends))
    for npc_id, block_kind in (("ava", "work"), ("bo", "study")):
        assert _block(state, npc_id, "2026-09-04", block_kind)["status"] == "completed"
        log = state["residents"][npc_id]["action_transition_log"]
        assert {value["to"] for value in log} >= {"planned", "traveling", "performing", "completed"}
        assert all(value.get("reason") and value.get("at") for value in log)


@pytest.mark.parametrize(
    ("hour", "expected_kind", "expected_block"),
    ((19, "missed_invitation", "accepted_invitation"), (23, "fatigue", "sleep_window")),
)
def test_urgent_need_can_break_a_plan_and_leaves_a_reasoned_consequence(
    hour: int, expected_kind: str, expected_block: str,
):
    profiles = _profiles()
    moment = datetime(2026, 9, 4, hour, 15, tzinfo=timezone.utc)
    state = LifeWorldEngine(timezone_name="UTC").initialize(
        "daily-plan", profiles, _home(profiles),
        {"ava": {"needs": _needs(food=0)}}, None, moment,
    )

    resident = state["residents"]["ava"]
    assert resident["current_action"]["action_type"] == "eat"
    consequence = resident["schedule_consequences"][-1]
    assert consequence["kind"] == expected_kind
    assert consequence["block_kind"] == expected_block
    assert consequence["reason"] == "urgent_need:food"
    assert _block(state, "ava", "2026-09-04", expected_block)["consequence"] == {
        "kind": expected_kind, "reason": "urgent_need:food",
    }


def test_active_incident_can_override_schedule_without_fabricating_a_hidden_decision():
    profiles = _profiles()
    engine = LifeWorldEngine(timezone_name="UTC")
    state = engine.initialize("incident-plan", profiles, _home(profiles), now=NOW)
    resident = state["residents"]["ava"]
    resident["runtime"]["needs"]["food"] = 20  # important, but below emergency threshold
    resident["current_action"]["status"] = "completed"
    resident["current_action"]["completed_at"] = NOW.isoformat()
    state["stories"]["incident-fixture"] = {
        "story": {
            "level": "incident", "status": "intervention_window",
            "participant_ids": ["ava"],
        }
    }
    window = engine.clock.decision_window(NOW)
    action = engine._ensure_current_action(
        state, profiles, "ava", window.key, window.period, NOW, engine._resource_map(state),
    )

    assert action.action_type == "eat"
    assert state["residents"]["ava"]["schedule_consequences"][-1]["reason"] \
        == "active_incident"


def test_desire_stack_has_authoritative_lifecycle_queue_and_is_not_public():
    profiles = _profiles()
    engine = LifeWorldEngine(timezone_name="UTC")
    state = engine.initialize(
        "stack-test", profiles, _home(profiles),
        {"ava": {"needs": _needs(food=30)}}, None, NOW,
    )
    resident = state["residents"]["ava"]
    stack = resident["desire_stack"]
    required = {
        "id", "type", "target_id", "subject_id", "intensity", "urgency",
        "visibility", "expires_at", "blocked_by", "reason", "source", "status",
    }

    assert len(stack) >= 4
    assert all(required <= desire.keys() for desire in stack)
    assert sum(desire["status"] == "committed" for desire in stack) == 1
    assert {desire["status"] for desire in stack} >= {
        "committed", "deferred", "suppressed", "substituted",
    }
    assert resident["queued_commitment"]["status"] == "queued"
    assert resident["queued_commitment"]["desire_id"] in {
        desire["id"] for desire in stack if desire["status"] in {"candidate", "deferred"}
    }
    assert any(value.get("emotional_trace") == "frustration"
               for value in state["aftermath"] if value.get("kind") == "desire_aftermath")

    suppressed = next(desire for desire in stack if desire["status"] == "suppressed")
    suppressed_id = suppressed["id"]
    suppressed["expires_at"] = (NOW + timedelta(seconds=1)).isoformat()
    advanced = engine.advance(state, profiles, NOW + timedelta(seconds=1))
    expired = next(
        desire for desire in advanced["residents"]["ava"]["desire_stack"]
        if desire["id"] == suppressed_id
    )
    assert expired["status"] == "expired"
    assert any(value.get("emotional_trace") == "disappointment"
               and value.get("desire_type") == expired["type"]
               for value in advanced["aftermath"] if value.get("kind") == "desire_aftermath")

    public_json = json.dumps(engine.public_snapshot(advanced), ensure_ascii=False)
    assert suppressed_id not in public_json
    for private_field in (
        "desire_stack", "desire_id", "queued_commitment", "commitment_id",
        '"intensity"', '"urgency"', '"blocked_by"', "personal_inventory",
        "shared_rule_expectations", "share_policy", "label_seed",
    ):
        assert private_field not in public_json


def test_every_life_action_status_change_records_a_reason():
    context = NpcLifeContext(
        player_id="p", npc_id="ava", decision_key="reasoned-action",
        period="afternoon", needs=_needs(food=0),
        current_location_id="park", current_location_kind="city",
        resources=default_household_resources(HOUSEHOLD_ID),
    )
    decision = select_life_action(context)
    action = create_life_action(
        decision, player_id="p", npc_id="ava", now=NOW,
        current_location_id="park", target_location_id=HOME_ID,
        travel_seconds=30,
    )
    traveling = advance_life_action(action, now=NOW).action
    performing = advance_life_action(traveling, now=NOW + timedelta(seconds=30)).action
    completed = advance_life_action(performing, now=performing.ends_at).action

    assert [value["to"] for value in completed.transition_history] == [
        "planned", "traveling", "performing", "completed",
    ]
    assert [value["reason"] for value in completed.transition_history] == [
        "commitment_selected", "journey_started", "arrived", "completed",
    ]
    assert all(value["at"] for value in completed.transition_history)
    assert completed.transition_reason == "completed" and completed.transitioned_at == completed.ends_at


def test_legacy_world_without_plans_desires_or_transition_reasons_upgrades_on_advance():
    profiles = _profiles()
    engine = LifeWorldEngine(timezone_name="UTC")
    state = engine.initialize("legacy-agent-state", profiles, _home(profiles), now=NOW)
    state.pop("desire_effect_ids", None)
    for resident in state["residents"].values():
        for key in (
            "daily_plans", "desire_stack", "queued_commitment",
            "action_transition_log", "schedule_consequences",
        ):
            resident.pop(key, None)
        for key in ("transition_reason", "transitioned_at", "transition_history"):
            resident["current_action"].pop(key, None)

    upgraded = engine.advance(state, profiles, NOW + timedelta(hours=6))

    assert upgraded["desire_effect_ids"] is not None
    for resident in upgraded["residents"].values():
        assert resident["daily_plans"] and resident["desire_stack"]
        assert "queued_commitment" in resident
        assert resident["action_transition_log"]
        assert resident["current_action"]["transition_reason"]
        assert resident["current_action"]["transition_history"]
    json.dumps(upgraded)


def test_daily_plans_desires_and_transition_reasons_are_offline_segment_equivalent():
    profiles = _profiles()
    engine = LifeWorldEngine(timezone_name="UTC")
    start = datetime(2026, 9, 4, 7, 0, tzinfo=timezone.utc)
    initial = engine.initialize("segmented-agent-plan", profiles, _home(profiles), now=start)
    offline = engine.advance(initial, profiles, start + timedelta(hours=30))
    segmented = initial
    for hour in range(1, 31):
        segmented = engine.advance(segmented, profiles, start + timedelta(hours=hour))

    assert _simulation_facts(segmented) == _simulation_facts(offline)
