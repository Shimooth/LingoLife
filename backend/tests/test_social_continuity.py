from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from lingolife import social_continuity as continuity, social_mind
from lingolife.life import CORE_NEEDS, NpcLifeContext, rank_life_actions
from lingolife.life_world import LifeWorldEngine


NOW = datetime(2026, 9, 26, 12, tzinfo=timezone.utc)
PROFILES = {key: {"name": key, "personality": ["caring", "reliable"], "interests": ["books"]}
            for key in ("a", "b", "c")}
LOUNGE = "shared:living-room:sofa"


def action(owner, *, location=LOUNGE, kind="read", status="performing", start=NOW):
    return {"id": f"action-{owner}", "npc_id": owner, "action_type": kind, "status": status,
            "started_at": start.isoformat(), "location_id": location}


def world():
    state = {"residents": {key: {"household_id": "shared", "home_location_id": "home",
              "current_location_id": LOUNGE, "current_action": action(key),
              "runtime": {"needs": {need: 70 for need in CORE_NEEDS}, "emotion": {"stress": 20}},
              "daily_plans": {}} for key in PROFILES}, "relationships": {}, "stories": {}}
    continuity.ensure(state, PROFILES, NOW)
    social_mind.ensure(state, PROFILES, NOW)
    return state


def assign(state, owner="a", target="b", kind="check_in", *, now=NOW):
    remember(state, "past-real-source", (owner, target), now)
    concern = continuity.add_concern(state, owner, target, kind, "past-real-source", "missed_connection", now, immediate=True)
    continuity.assigned(state, owner, concern, SimpleNamespace(id=state["residents"][owner]["current_action"]["id"]), now)
    return concern


def remember(state, source, participants=("a", "b"), now=NOW):
    social_mind.observe_fact(state, PROFILES, {"id": source, "topic": "missed_connection",
        "participant_ids": list(participants), "location_id": LOUNGE, "facts": {}, "occurred_at": now.isoformat()}, now)


def test_social_target_ranking_uses_directional_preference_not_uniform_sampling():
    context = NpcLifeContext(player_id="p", npc_id="a", decision_key="d", period="afternoon",
        needs={key: 60 for key in CORE_NEEDS}, nearby_resident_ids=("b", "c"),
        social_target_weights={"b": -30, "c": 45})
    candidate = next(item for item in rank_life_actions(context) if item.action_type == "talk_to_resident")
    assert candidate.target_npc_id == "c"
    reversed_context = NpcLifeContext(**{**context.__dict__, "social_target_weights": {"b": 45, "c": -30}})
    assert next(item for item in rank_life_actions(reversed_context) if item.action_type == "talk_to_resident").target_npc_id == "b"


def test_concerns_are_bounded_persist_across_midnight_and_fade_without_polling():
    state = world()
    for index in range(30):
        if index < 4:
            remember(state, f"source-{index}")
        continuity.add_concern(state, "a", "b", f"kind-{index}", f"source-{index}", "noise", NOW)
    items = state["social_continuity"]["concerns"]["a"]
    assert len(items) == 4
    continuity.maintain(state, PROFILES, NOW + timedelta(days=1))
    assert all(item["status"] == "pending" for item in items)
    continuity.maintain(state, PROFILES, NOW + timedelta(days=5))
    assert all(item["status"] == "expired" for item in items)
    same = deepcopy(state)
    continuity.maintain(state, PROFILES, NOW + timedelta(days=5))
    assert same == state


def test_cannot_seek_private_resident_or_interrupt_accepted_activity():
    state = world()
    remember(state, "source")
    concern = continuity.add_concern(state, "a", "b", "check_in", "source", "missed_connection", NOW, immediate=True)
    assert continuity.ready(state, "a", ("b",), NOW) == concern
    state["residents"]["b"]["current_location_id"] = "shared:bedroom:bed-b"
    assert continuity.ready(state, "a", ("b",), NOW) is None
    state["residents"]["b"]["current_location_id"] = LOUNGE
    state["shared_activities"] = {"x": {"participants": ["b", "c"], "phase": "active"}}
    assert continuity.ready(state, "a", ("b",), NOW) is None


def test_followup_needs_actual_shared_location_and_thirty_seconds():
    state = world()
    assign(state)
    assert continuity.encounter_candidates(state, PROFILES, NOW + timedelta(seconds=29)) == []
    state["residents"]["b"]["current_location_id"] = "elsewhere"
    assert continuity.encounter_candidates(state, PROFILES, NOW + timedelta(seconds=30)) == []
    state["residents"]["b"]["current_location_id"] = LOUNGE
    events = continuity.encounter_candidates(state, PROFILES, NOW + timedelta(seconds=31))
    assert len(events) == 1 and events[0]["response"] == "hear_out"
    assert continuity.encounter_candidates(state, PROFILES, NOW + timedelta(seconds=32)) == []
    assert not state["relationships"]  # 听到解释不自动原谅/加好感。


def test_response_can_defer_then_let_go_instead_of_harassment():
    state = world()
    concern = assign(state)
    state["residents"]["b"]["runtime"]["emotion"]["stress"] = 90
    event = continuity.encounter_candidates(state, PROFILES, NOW + timedelta(seconds=31))[0]
    assert event["response"] == "defer" and concern["status"] == "pending"
    assert continuity.ready(state, "a", ("b",), NOW + timedelta(hours=1)) is None
    later = NOW + timedelta(hours=13)
    state["residents"]["a"]["current_action"] = action("a", start=later)
    state["residents"]["a"]["current_action"]["id"] = "second-attempt"
    continuity.assigned(state, "a", concern, SimpleNamespace(id="second-attempt"), later)
    assert continuity.encounter_candidates(state, PROFILES, later + timedelta(seconds=31))[0]["response"] == "defer"
    assert concern["status"] == "let_go"


def test_public_status_does_not_claim_the_other_person_already_responded():
    state = world()
    assign(state)
    observable = {"visible_intent": "Reading", "visible_intent_zh": "阅读", "action_type": "read"}
    result = continuity.annotate_observable(state, "a", state["residents"]["a"]["current_action"], observable, "B")
    assert result["visible_intent_zh"] == "在等B说会儿话"
    assert observable["visible_intent_zh"] == "阅读"


def test_declined_activity_never_becomes_a_broken_promise():
    state = world()
    state["shared_activities"] = {"activity": {"id": "activity", "phase": "declined", "participants": ["a", "b"],
        "created_at": NOW.isoformat(), "updated_at": NOW.isoformat()}}
    continuity.sync_receipts(state, PROFILES, NOW)
    assert not state["social_continuity"]["receipts"]
    assert not state["social_continuity"]["concerns"]["a"]


def test_scheduled_promise_requires_actual_overlapping_completion():
    state = world()
    for owner, target in (("a", "b"), ("b", "a")):
        state["residents"][owner]["daily_plans"] = {"today": {"blocks": [{
            "kind": "accepted_invitation", "target_npc_id": target, "starts_at": NOW.isoformat(),
            "ends_at": (NOW + timedelta(hours=1)).isoformat(), "location_id": LOUNGE,
            "attended_at": NOW.isoformat(), "status": "in_progress"}]}}
    continuity.sync_receipts(state, PROFILES, NOW)
    assert next(iter(state["social_continuity"]["receipts"].values()))["status"] == "accepted"
    for owner in ("a", "b"):
        block = state["residents"][owner]["daily_plans"]["today"]["blocks"][0]
        block["completed_at"] = (NOW + timedelta(minutes=5)).isoformat()
    continuity.sync_receipts(state, PROFILES, NOW + timedelta(minutes=5))
    receipt = next(iter(state["social_continuity"]["receipts"].values()))
    assert receipt["status"] == "fulfilled"
    snapshot = deepcopy(state)
    continuity.sync_receipts(state, PROFILES, NOW + timedelta(minutes=6))
    assert snapshot == state


def test_three_person_public_witness_then_real_relay_and_future_intention():
    state = world()
    state["residents"]["b"]["current_location_id"] = "city_library"
    completed = SimpleNamespace(id="cooking-1", npc_id="a", action_type="prepare_food", location_id=LOUNGE)
    continuity.action_completed(state, PROFILES, completed, NOW)
    concern = state["social_continuity"]["concerns"]["c"][0]
    source = concern["source_fact_id"]
    assert source in state["social_mind"]["minds"]["c"]["observations"]
    assert source not in state["social_mind"]["minds"]["b"]["observations"]
    later = NOW + timedelta(minutes=30)
    for key in ("b", "c"):
        state["residents"][key]["current_location_id"] = LOUNGE
        state["residents"][key]["current_action"] = action(key, kind="talk_to_resident", start=later)
    continuity.assigned(state, "c", concern, SimpleNamespace(id="action-c"), later)
    event = continuity.encounter_candidates(state, PROFILES, later + timedelta(seconds=30))[0]
    assert event["topic"] == "public_relay" and event["response"] == "acknowledge"
    assert event["expression_perspectives"]["b"]["observations"] == []
    reported = state["social_mind"]["minds"]["b"]["observations"][source]
    assert reported["channel"] == "reported" and reported["reporter_id"] == "c"
    assert any(item["target_id"] == "a" and item["kind"] == "check_in"
               for item in state["social_continuity"]["concerns"]["b"])


def test_private_completion_is_not_a_public_fact_or_relay():
    state = world()
    continuity.action_completed(state, PROFILES, SimpleNamespace(
        id="private-clean", npc_id="a", action_type="clean_shared_space", location_id="shared:bedroom:bed-a"), NOW)
    assert not state["social_mind"]["facts"]
    assert not state["social_continuity"]["concerns"]["c"]


def test_world_produces_real_visible_followup_record_with_frozen_viewpoints():
    engine = LifeWorldEngine(timezone_name="UTC")
    mapping = {key: {"household_id": "shared", "location_id": "home"} for key in PROFILES}
    state = engine.initialize("continuity-test", PROFILES, mapping, now=NOW)
    for owner in ("a", "b"):
        resident = state["residents"][owner]
        resident["current_location_id"] = LOUNGE
        resident["current_action"].update({"status": "performing", "started_at": NOW.isoformat(),
            "location_id": LOUNGE, "action_type": "talk_to_resident"})
        resident["runtime"]["needs"].update({key: 80 for key in CORE_NEEDS})
        resident["runtime"]["emotion"]["stress"] = 10
    assign(state)
    engine._record_social_followups(state, PROFILES, NOW + timedelta(seconds=30))
    records = [record for record in state["stories"].values()
               if (record.get("collision") or {}).get("topic") == "social_followup"]
    assert len(records) == 1
    assert records[0]["story"]["observable"]
    assert set(records[0]["expression_perspectives"]) == {"a", "b"}
    assert records[0]["resolution"]["relationship_changes"] == []
    assert records[0]["interaction"]["stages"]


def live_world_with_concern():
    engine = LifeWorldEngine(timezone_name="UTC")
    mapping = {key: {"household_id": "shared", "location_id": "home"} for key in PROFILES}
    state = engine.initialize("live-continuity", PROFILES, mapping, now=NOW)
    state.update({"stories": {}, "open_story_ids": [], "shared_activities": {}, "household_dinners": {}})
    for owner, resident in state["residents"].items():
        resident["current_location_id"] = LOUNGE
        resident["current_journey"] = None
        resident["current_action"].update({"status": "performing", "started_at": NOW.isoformat(),
            "location_id": LOUNGE, "action_type": "read", "target_npc_id": None,
            "ends_at": (NOW + timedelta(seconds=1 if owner == "a" else 1800)).isoformat(),
            "arrives_at": None, "target_resource_id": None})
        resident["runtime"]["needs"].update({key: 80 for key in CORE_NEEDS})
        resident["runtime"]["emotion"]["stress"] = 10
        resident["pending_instruction"] = None
    continuity.add_concern(state, "a", "b", "check_in", "live-source", "missed_connection", NOW, immediate=True)
    remember(state, "live-source")
    return engine, state


def test_canonical_advance_selects_follows_and_settles_concern_online_equals_offline():
    engine, state = live_world_with_concern()
    direct = engine.advance(state, PROFILES, NOW + timedelta(seconds=100))
    stepped = state
    for seconds in (1, 10, 20, 31, 32, 55, 100):
        stepped = engine.advance(stepped, PROFILES, NOW + timedelta(seconds=seconds))
    visible = lambda value: [record for record in value["stories"].values()
        if (record.get("collision") or {}).get("topic") == "social_followup"]
    assert visible(direct)
    assert visible(direct) == visible(stepped)
    assert direct["social_continuity"] == stepped["social_continuity"]
    assert direct["social_mind"] == stepped["social_mind"]
    assert direct["residents"] == stepped["residents"]
    assert visible(direct)[0]["story"]["status"] == "resolved_autonomously"


def test_urgent_need_wins_over_pending_concern_in_real_selector():
    engine, state = live_world_with_concern()
    state["residents"]["a"]["runtime"]["needs"]["food"] = 0
    result = engine.advance(state, PROFILES, NOW + timedelta(seconds=2))
    assert result["residents"]["a"]["current_action"]["action_type"] != "talk_to_resident"
    assert result["social_continuity"]["concerns"]["a"][0]["status"] == "pending"


def test_old_completed_activity_is_not_replayed_as_a_new_promise_on_upgrade():
    state = world()
    state["shared_activities"] = {"old": {"id": "old", "phase": "completed", "participants": ["a", "b"],
        "created_at": (NOW - timedelta(days=1)).isoformat(), "updated_at": (NOW - timedelta(hours=1)).isoformat()}}
    continuity.sync_receipts(state, PROFILES, NOW)
    assert not state["social_continuity"]["receipts"]


def test_traveling_or_private_witness_does_not_seed_a_relay():
    state = world()
    state["residents"]["b"]["current_location_id"] = "city_library"
    state["residents"]["c"]["current_journey"] = {"route": "still-arriving"}
    continuity.action_completed(state, PROFILES, SimpleNamespace(
        id="cooking-travel", npc_id="a", action_type="prepare_food", location_id=LOUNGE), NOW)
    assert not state["social_continuity"]["concerns"]["c"]


def test_forgotten_source_cannot_be_reconstructed_from_a_concern():
    state = world()
    concern = assign(state, kind="repair")
    state["pair_memory"] = {"processed": ["past-real-source"], "pairs": {}}
    assert continuity.encounter_candidates(state, PROFILES, NOW + timedelta(seconds=31)) == []
    assert concern["status"] == "expired"
    assert not state["social_continuity"]["encounters"]


def test_real_fulfillment_adds_kept_promise_evidence_once_and_not_for_missed():
    engine, state = live_world_with_concern()
    for owner, target in (("a", "b"), ("b", "a")):
        state["residents"][owner]["daily_plans"] = {"today": {"blocks": [{
            "kind": "accepted_invitation", "target_npc_id": target, "starts_at": NOW.isoformat(),
            "ends_at": (NOW + timedelta(hours=1)).isoformat(), "location_id": LOUNGE,
            "attended_at": NOW.isoformat(), "completed_at": (NOW + timedelta(minutes=5)).isoformat(),
            "status": "completed"}]}}
    engine._sync_social_receipts(state, PROFILES, NOW + timedelta(minutes=5))
    evidence = [row for row in state["relationship_evidence"] if row["kind"] == "kept_promise"]
    assert len(evidence) == 2
    assert {row["source_npc_id"] for row in evidence} == {"a", "b"}
    snapshot = deepcopy(state)
    engine._sync_social_receipts(state, PROFILES, NOW + timedelta(minutes=6))
    assert snapshot == state


def test_activity_phase_label_alone_cannot_claim_fulfillment():
    state = world()
    state["shared_activities"] = {"activity": {"id": "activity", "kind": "reading", "phase": "completed",
        "participants": ["a", "b"], "created_at": NOW.isoformat(), "updated_at": NOW.isoformat(),
        "deadline": (NOW + timedelta(minutes=45)).isoformat(), "location_id": LOUNGE,
        "actions": {"a": {"start": NOW.isoformat(), "end": (NOW + timedelta(minutes=4)).isoformat()},
                    "b": {"start": (NOW + timedelta(minutes=5)).isoformat(), "end": (NOW + timedelta(minutes=9)).isoformat()}},
        "completed_ids": ["a", "b"]}}
    continuity.sync_receipts(state, PROFILES, NOW + timedelta(minutes=9))
    assert state["social_continuity"]["receipts"]["activity"]["status"] == "missed"
    assert not any("kept_promise" in fact["outcome_tags"] for fact in state["social_mind"]["facts"].values())
