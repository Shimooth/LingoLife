from copy import deepcopy
from datetime import datetime, timedelta, timezone

import pytest

from lingolife import social_mind as mind
from lingolife.relationships import Appraisal


NOW = datetime(2026, 9, 26, 9, tzinfo=timezone.utc)
PROFILES = {"a": {"personality": ["independent"], "values": {"autonomy": 1}},
            "b": {"personality": ["善良"]}, "c": {}, "d": {}}


def resident(location="home:living-room", action="read"):
    return {"current_location_id": location, "current_journey": None,
            "current_action": {"location_id": location, "status": "performing", "action_type": action,
                               "started_at": (NOW-timedelta(minutes=5)).isoformat()}}


def world():
    return {"residents": {"a": resident(), "b": resident(), "c": resident(),
                          "d": resident("cafe")},
            "relationships": {"ab": {
                "a_to_b": {"owner_id": "a", "target_id": "b", "trust": 85, "affinity": 75},
                "b_to_a": {"owner_id": "b", "target_id": "a", "trust": 20, "affinity": 30}}},
            "stories": {"old": {"never_import_me": True}}}


def fact(identity="borrow", at=NOW, visibility="participants", **changes):
    return {"id": identity, "topic": "borrowed_property", "kind": "person_boundary",
            "participant_ids": ["a", "b"], "location_id": "home:living-room", "occurred_at": at.isoformat(),
            "visibility": visibility, "outcome_tags": ["conflict"],
            "facts": {"actor_id": "b", "owner_id": "a", "violated": True,
                      "owner_expectation": "ask_first", "item_label": "my special mug",
                      "private_secret": "DO_NOT_COPY"}, **changes}


def context(state, owner="a", before=NOW, exclude=None):
    return mind.perspective(state, owner, ["a", "b", "c", "d"], before=before, exclude_source=exclude)


def test_values_are_grounded_bilingual_ordered_and_explicit_overrides_win():
    assert mind.persona_values({"personality": ["kind", "independent"]})["values"] == {"care": .7, "autonomy": .7}
    assert mind.persona_values({"personality": ["善良", "独立"]})["values"] == {"care": .7, "autonomy": .7}
    compiled = mind.persona_values({"personality": ["independent"], "values": ["公平", "honesty", "care"]})
    assert compiled["priority"][:3] == ["fairness", "honesty", "care"]
    assert mind.persona_values({"values": {"autonomy": 20}, "personality": ["independent"]})["values"]["autonomy"] == .2
    assert mind.persona_values({"personality": ["galactic potato", "not honest", "不独立"]})["values"] == {}
    assert mind.persona_values({"values": ["invented_secret"], "selfImage": "希望先听完别人的话"})["self_image"] == ["希望先听完别人的话"]


def test_initialization_preserves_history_and_does_not_invent_memories():
    state = world()
    old = deepcopy(state)
    mind.ensure(state, PROFILES, NOW)
    assert {key: value for key, value in state.items() if key != "social_mind"} == old
    assert not context(state)["observations"]
    assert not mind.perspective(old, "a", ["a", "b"], before=NOW)["observations"]


def test_private_fact_only_participants_know_and_interpretations_never_rewrite_facts():
    state = world()
    original = fact()
    mind.observe_fact(state, PROFILES, original, NOW)
    assert len(context(state, "a")["observations"]) == 1
    assert not context(state, "c")["observations"]
    assert not context(state, "d")["observations"]
    assert "DO_NOT_COPY" not in str(state["social_mind"])
    assert context(state)["interpretations"][0]["is_inference"] is True
    assert original == fact()
    bank = deepcopy(state["social_mind"]["facts"])
    result = mind.appraise(state, "d", "b", original, {}, NOW)
    assert result["confidence"] == 0
    assert state["social_mind"]["facts"] == bank


def test_real_public_witness_and_reports_cannot_read_private_ownership_or_permission():
    state = world()
    mind.observe_fact(state, PROFILES, fact(visibility="public"), NOW)
    witness = context(state, "c")["observations"][0]
    assert witness["channel"] == "witness"
    assert witness["facts"] == {"actor_id": "b"}
    assert witness["visibility"] == "public"
    assert not context(state, "d")["observations"]
    assert context(state, "a")["observations"][0]["facts"]["owner_expectation"] == "ask_first"


@pytest.mark.parametrize("change", ["sleep", "travel", "future_start", "missing_start", "private", "wrong_location"])
def test_same_location_alone_does_not_prove_witnessing(change):
    state = world()
    person = state["residents"]["c"]
    if change == "sleep":
        person["current_action"]["action_type"] = "sleep"
    elif change == "travel":
        person["current_journey"] = {"to": "home:living-room"}
    elif change == "future_start":
        person["current_action"]["started_at"] = (NOW+timedelta(minutes=1)).isoformat()
    elif change == "missing_start":
        person["current_action"].pop("started_at")
    elif change == "private":
        person["current_action"]["visibility"] = "private"
    else:
        person["current_action"]["location_id"] = "cafe"
    mind.observe_fact(state, PROFILES, fact(visibility="public"), NOW)
    assert not context(state, "c")["observations"]


def test_private_room_cannot_be_marked_public_and_old_event_does_not_gain_today_witnesses():
    state = world()
    state["residents"]["c"] = resident("home:bedroom-c")
    mind.observe_fact(state, PROFILES, fact(visibility="public", location_id="home:bedroom-c"), NOW)
    assert not context(state, "c")["observations"]
    state = world()
    mind.observe_fact(state, PROFILES, fact(at=NOW-timedelta(hours=1), visibility="public"), NOW)
    assert not context(state, "c")["observations"]
    assert not context(state, before=NOW-timedelta(minutes=1))["observations"]


def test_same_fact_differs_by_values_and_trust_and_remains_valid_appraisal():
    strong, weak, wary = world(), world(), world()
    weaker = {**PROFILES, "a": {"values": {"autonomy": .1}}}
    wary["relationships"]["ab"]["a_to_b"]["trust"] = 20
    for state, profiles in ((strong, PROFILES), (weak, weaker), (wary, PROFILES)):
        mind.observe_fact(state, profiles, fact(), NOW)
    first = mind.appraise(strong, "a", "b", fact(), PROFILES["a"], NOW)
    second = mind.appraise(weak, "a", "b", fact(), weaker["a"], NOW)
    third = mind.appraise(wary, "a", "b", fact(), PROFILES["a"], NOW)
    assert first["boundary_impact"] > second["boundary_impact"]
    assert first["perceived_intent"] == "accidental"
    assert third["perceived_intent"] == "careless"
    for result in (first, second, third):
        Appraisal(**result)


def test_reappraisal_and_persona_edit_do_not_rewrite_past_interpretation():
    state = world()
    mind.observe_fact(state, PROFILES, fact(), NOW)
    old = deepcopy(state["social_mind"]["minds"]["a"]["interpretations"])
    edited = {**PROFILES, "a": {"values": {"autonomy": .1}}}
    mind.ensure(state, edited, NOW+timedelta(hours=1))
    state["relationships"]["ab"]["a_to_b"]["trust"] = 5
    mind.appraise(state, "a", "b", {**fact(), "facts": {"secret": "invented"}}, edited["a"], NOW+timedelta(hours=1))
    assert state["social_mind"]["minds"]["a"]["interpretations"] == old
    assert state["social_mind"]["minds"]["a"]["persona"]["values"]["autonomy"] == .1


def test_future_invalid_time_and_conflicting_sources_cannot_enter_knowledge():
    state = world()
    mind.observe_fact(state, PROFILES, fact(at=NOW+timedelta(seconds=1)), NOW)
    mind.observe_fact(state, PROFILES, fact(occurred_at="not-a-time"), NOW)
    assert not state["social_mind"]["facts"]
    mind.observe_fact(state, PROFILES, fact(), NOW)
    with pytest.raises(ValueError, match="source id reused"):
        mind.observe_fact(state, PROFILES, fact(facts={"violated": False}), NOW)


def test_read_only_perspective_excludes_source_future_knowledge_and_other_owner():
    state = world()
    mind.observe_fact(state, PROFILES, fact(), NOW)
    later = NOW+timedelta(hours=1)
    mind.observe_fact(state, PROFILES, fact("second", later), later)
    before = deepcopy(state)
    assert [item["source_id"] for item in context(state)["observations"]] == ["borrow"]
    assert not context(state, exclude="borrow")["observations"]
    assert not context(state, "d", later)["observations"]
    assert state == before


def test_retelling_requires_a_real_shared_moment_and_stays_reported():
    state = world()
    mind.observe_fact(state, PROFILES, fact(visibility="public"), NOW)
    assert not mind.relay_fact(state, PROFILES, "borrow", "c", "d", NOW, report_id="report")
    state["residents"]["d"] = resident()
    later = NOW+timedelta(minutes=10)
    assert mind.relay_fact(state, PROFILES, "borrow", "c", "d", later, report_id="report")
    observed = context(state, "d", later)["observations"][0]
    assert observed["channel"] == "reported" and observed["reporter_id"] == "c"
    assert observed["confidence"] < .6
    assert "owner_expectation" not in observed["facts"]
    assert not context(state, "d", NOW)["observations"]
    snapshot = deepcopy(state)
    assert not mind.relay_fact(state, PROFILES, "borrow", "c", "d", later+timedelta(minutes=1), report_id="again")
    assert state == snapshot
    # The listener cannot turn a report into first-hand knowledge or start a rumour chain.
    state["residents"]["e"] = resident()
    assert not mind.relay_fact(state, PROFILES, "borrow", "d", "e", later, report_id="chain")


def test_private_or_unknown_source_cannot_be_retold():
    state = world()
    mind.observe_fact(state, PROFILES, fact(), NOW)
    assert not mind.relay_fact(state, PROFILES, "borrow", "a", "c", NOW, report_id="private")
    assert not mind.relay_fact(state, PROFILES, "invented", "a", "c", NOW, report_id="unknown")


def test_absolute_expiry_is_poll_invariant_and_duplicate_cannot_refresh():
    online = world()
    event = fact()
    event.pop("occurred_at")
    mind.observe_fact(online, PROFILES, event, NOW)
    offline = deepcopy(online)
    for hour in range(1, 200):
        moment = NOW+timedelta(hours=hour)
        mind.ensure(online, PROFILES, moment)
        mind.observe_fact(online, PROFILES, event, moment)
    mind.ensure(offline, PROFILES, moment)
    assert online == offline
    assert not context(online, before=moment)["observations"]


def test_capacity_and_tombstone_floor_prevent_old_replay_from_teaching_again():
    state = world()
    for index in range(mind.MAX_PROCESSED + 8):
        moment = NOW+timedelta(seconds=index)
        mind.observe_fact(state, PROFILES, fact(str(index), moment), moment)
    bank = state["social_mind"]
    assert len(bank["facts"]) <= mind.MAX_FACTS
    assert len(bank["processed"]) <= mind.MAX_PROCESSED
    assert len(bank["minds"]["a"]["observations"]) <= mind.MAX_OBSERVATIONS
    assert len(bank["minds"]["a"]["interpretations"]) <= mind.MAX_INTERPRETATIONS
    old = deepcopy(bank)
    mind.observe_fact(state, PROFILES, fact("0"), moment)
    assert state["social_mind"] == old


def test_target_weights_use_only_owners_relationship_and_known_experiences():
    state = world()
    mind.ensure(state, PROFILES, NOW)
    before = mind.social_target_weights(state, "a", ["a", "b", "c", "missing"], NOW)
    assert set(before) == {"b", "c"} and before["b"] > before["c"]
    mind.observe_fact(state, PROFILES, fact(), NOW)
    after = mind.social_target_weights(state, "a", ["b", "c"], NOW)
    assert after["b"] < before["b"] and after["c"] == before["c"]
    snapshot = deepcopy(state)
    mind.social_target_weights(state, "a", ["b", "c"], NOW+timedelta(days=8))
    assert state == snapshot


def test_safe_expression_projection_is_idempotent_and_player_does_not_get_private_thoughts():
    state = world()
    mind.observe_fact(state, PROFILES, fact(), NOW)
    state["social_continuity"] = {"concerns": {"a": [{"owner_id": "a", "target_id": "b", "kind": "repair",
        "status": "pending", "source_topic": "borrowed_property", "source_fact_id": "borrow", "created_at": NOW.isoformat(),
        "expires_at": (NOW+timedelta(days=1)).isoformat(), "details": {"private": "DO_NOT_COPY"}}]}}
    raw = context(state)
    scene = mind.sanitize_perspective(raw, "a", ["a", "b"])
    assert scene["observations"] and scene["interpretations"] and scene["current_concerns"]
    assert mind.sanitize_perspective(scene, "a", ["a", "b"]) == scene
    for forbidden in ("source_id", "appraisal", "confidence", "DO_NOT_COPY"):
        assert forbidden not in str(scene)
    player = mind.sanitize_perspective(raw, "a", ["a", "b"], for_player=True)
    assert not player["observations"] and not player["interpretations"] and not player["current_concerns"]
    assert mind.sanitize_perspective(raw, "b", ["a", "b"]) == {}
    assert mind.sanitize_perspective(raw, "a", ["b"]) == {}


def test_public_report_projection_keeps_uncertainty_and_drops_unlinked_guess():
    state = world()
    mind.observe_fact(state, PROFILES, fact(visibility="public"), NOW)
    state["residents"]["d"] = resident()
    mind.relay_fact(state, PROFILES, "borrow", "c", "d", NOW, report_id="public-report")
    raw = context(state, "d")
    raw["interpretations"].append({"source_id": "unseen", "target_id": "b", "meaning": "MADE_UP", "is_inference": True, "value": "care"})
    safe = mind.sanitize_perspective(raw, "d", ["a", "b", "c", "d"], for_player=True)
    assert safe["observations"][0]["certainty"] == "tentative"
    assert safe["observations"][0]["reporter_id"] == "c"
    assert "MADE_UP" not in str(safe)
    assert mind.sanitize_perspective(safe, "d", ["a", "b", "c", "d"], for_player=True) == safe


def test_removed_resident_and_expired_or_future_concern_cannot_leak_on_read():
    state = world()
    mind.observe_fact(state, PROFILES, fact(), NOW)
    del state["residents"]["b"]
    assert not context(state)["observations"]
    mind.ensure(state, PROFILES, NOW)
    assert "b" not in state["social_mind"]["minds"]
    assert not state["social_mind"]["facts"]


def test_three_day_compression_cannot_recover_details_via_mind_or_late_report():
    state = world()
    mind.observe_fact(state, PROFILES, fact(visibility="public"), NOW)
    future = NOW+timedelta(days=3)
    first = context(state, "a", future)["observations"][0]
    assert first["recall"] == "fading" and first["facts"] == {}
    state["residents"]["d"] = resident()
    assert mind.relay_fact(state, PROFILES, "borrow", "c", "d", future, report_id="late")
    report = context(state, "d", future)["observations"][0]
    assert report["facts"] == {} and report["recall"] == "fading"
    assert "my special mug" not in str(mind.sanitize_perspective(context(state, "a", future)))


@pytest.mark.parametrize("episodes", [[], [{"source_id": "borrow", "retention": "discard", "recall": "clear"}]])
def test_existing_memory_discard_cannot_be_bypassed_by_new_cognition_bank(episodes):
    state = world()
    mind.observe_fact(state, PROFILES, fact("borrow:settled"), NOW)
    state["pair_memory"] = {"processed": ["borrow"], "pairs": {"a-b": {
        "owner_id": "a", "target_id": "b", "episodes": episodes}}}
    assert not context(state, "a")["observations"]
    assert not context(state, "a")["interpretations"]


def test_existing_fading_memory_and_source_exclusion_apply_across_settlement_suffix():
    state = world()
    mind.observe_fact(state, PROFILES, fact("borrow:settled"), NOW)
    state["pair_memory"] = {"processed": ["borrow"], "pairs": {"a-b": {
        "owner_id": "a", "target_id": "b", "episodes": [
            {"source_id": "borrow", "retention": "lasting", "recall": "fading"}]}}}
    assert context(state)["observations"][0]["facts"] == {}
    assert not context(state, exclude="borrow")["observations"]


def test_current_concerns_cannot_use_future_or_expired_state():
    state = world()
    mind.ensure(state, PROFILES, NOW)
    base = {"owner_id": "a", "target_id": "b", "kind": "repair", "status": "pending", "source_topic": "borrowed_property"}
    state["social_continuity"] = {"concerns": {"a": [
        {**base, "created_at": (NOW+timedelta(hours=1)).isoformat(), "expires_at": (NOW+timedelta(days=1)).isoformat()},
        {**base, "created_at": (NOW-timedelta(days=2)).isoformat(), "expires_at": (NOW-timedelta(days=1)).isoformat()},
    ]}}
    assert not context(state)["current_concerns"]


def test_optional_proposal_is_only_a_bounded_hypothesis_about_known_fact():
    state = world()
    mind.observe_fact(state, PROFILES, fact(), NOW)
    proposal = {"source_id": "borrow", "target_id": "b", "value": "autonomy", "perceived_intent": "careless", "confidence": .5}
    snapshot = deepcopy(state)
    accepted = mind.validate_interpretation_proposal(state, "a", proposal, NOW)
    assert accepted["is_inference"] and accepted["advisory_only"]
    assert mind.validate_interpretation_proposal(state, "d", proposal, NOW) is None
    assert mind.validate_interpretation_proposal(state, "a", {**proposal, "confidence": 1}, NOW) is None
    assert mind.validate_interpretation_proposal(state, "a", {**proposal, "new_fact": "secret"}, NOW) is None
    assert mind.validate_interpretation_proposal(state, "a", {**proposal, "target_id": "c"}, NOW) is None
    assert state == snapshot


def test_a_grounded_relay_can_discuss_the_absent_actor_without_unrelated_memories():
    state = world()
    event = fact("public-help", visibility="public", topic="household_help", participant_ids=["a"],
                 outcome_tags=["cooperation"], facts={"actor_id": "a", "action_type": "clean_shared_space"})
    mind.observe_fact(state, PROFILES, event, NOW)
    state["social_continuity"] = {"concerns": {"c": [{"owner_id": "c", "target_id": "d", "kind": "relay",
        "status": "approaching", "source_topic": "household_help", "source_fact_id": "public-help",
        "created_at": NOW.isoformat(), "expires_at": (NOW+timedelta(days=1)).isoformat()}]}}
    relay_view = mind.perspective(state, "c", ["c", "d"], before=NOW)
    scene = mind.sanitize_perspective(relay_view, "c", ["c", "d"])
    assert scene["observations"][0]["facts"]["actor_id"] == "a"
    assert scene["current_concerns"][0]["reference"] == scene["observations"][0]["reference"]
    assert mind.sanitize_perspective(scene, "c", ["c", "d"]) == scene
    state["residents"]["d"] = resident()
    assert mind.relay_fact(state, PROFILES, "public-help", "c", "d", NOW, report_id="c-told-d")
    recipient_view = mind.perspective(state, "d", ["c", "d"], before=NOW)
    assert mind.sanitize_perspective(recipient_view, "d", ["c", "d"])["observations"][0]["channel"] == "reported"
    state["pair_memory"] = {"processed": ["c-told-d"], "pairs": {"d-c": {
        "owner_id": "d", "target_id": "c", "episodes": []}}}
    assert not mind.source_known(state, "d", "public-help", NOW)
    assert not context(state, "d")["observations"]


def test_real_missed_commitment_explanation_reaches_scene_but_stays_private_from_player():
    state = world()
    event = fact("meeting:missed", topic="missed_connection", outcome_tags=["missed"],
                 facts={"initiator_id": "a", "target_id": "b", "target_busy": True, "private_reason": "DO_NOT_COPY"})
    mind.observe_fact(state, PROFILES, event, NOW)
    state["social_continuity"] = {"concerns": {"a": [{"owner_id": "a", "target_id": "b", "kind": "explain",
        "status": "pending", "source_topic": "missed_connection", "source_fact_id": event["id"],
        "created_at": NOW.isoformat(), "expires_at": (NOW+timedelta(days=1)).isoformat()}]}}
    raw = context(state)
    assert raw["current_concerns"][0]["kind"] == "explain"
    scene = mind.sanitize_perspective(raw, "a", ["a", "b"])
    assert scene["current_concerns"][0]["kind"] == "explain"
    assert scene["observations"][0]["facts"] == {"initiator_id": "a", "target_id": "b", "target_busy": True}
    assert "DO_NOT_COPY" not in str(scene)
    assert mind.sanitize_perspective(scene, "a", ["a", "b"]) == scene
    assert not mind.sanitize_perspective(raw, "a", ["a", "b"], for_player=True)["current_concerns"]
    assert not mind.sanitize_perspective(raw, "b", ["a", "b"])


def test_sanitizer_ignores_unstructured_external_fields():
    raw = {"owner_id": "a", "observations": [None, {"channel": [], "source_id": "x"}],
           "interpretations": [{"source_id": [], "target_id": "b", "is_inference": True}],
           "current_concerns": [{"kind": {}, "target_id": "b"}], "hidden_beliefs": "DO_NOT_COPY"}
    result = mind.sanitize_perspective(raw, "a", ["a", "b"])
    assert not result["observations"] and not result["interpretations"] and not result["current_concerns"]
    assert "DO_NOT_COPY" not in str(result)
