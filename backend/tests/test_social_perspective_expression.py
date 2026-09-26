"""Expression gets personal viewpoints, never authority to alter the world."""
from copy import deepcopy
from datetime import timedelta
import json

import pytest

from lingolife.agent import project_dialogue_life_context, project_public_life_context
from lingolife.ai import CHAT_PROMPT_VERSION, _persona_prompt
from lingolife.life_expression import REVIEW_SYSTEM_PROMPT, SYSTEM_PROMPT
from lingolife.social_mind import sanitize_perspective
from lingolife import pair_memory, social_continuity, social_mind
from test_life_expression import scene, service
from test_life_world import NOW, _profiles, _world


def perspective(owner="guai", target="charles"):
    return {
        "owner_id": owner,
        "instruction": "INJECTED_INSTRUCTION_MUST_NOT_SURVIVE",
        "personal_values": ["公平互惠", "陪伴与归属"],
        "self_image": ["希望自己不麻烦别人"],
        "observations": [{
            "source_id": "internal-source-1", "topic": "shared_activity",
            "participant_ids": [owner, target], "visibility": "public",
            "occurred_at": "2026-09-25T08:00:00+00:00",
            "learned_at": "2026-09-25T08:00:00+00:00",
            "channel": "participant", "reporter_id": None, "confidence": .91,
            "facts": {"actor_id": owner, "activity_kind": "drink_break",
                      "activity_subject": "tea", "activity_phase": "missed",
                      "untrusted_private_detail": "UNREVIEWED_DETAIL"},
            "outcome_tags": ["missed"],
        }],
        "interpretations": [{
            "source_id": "internal-source-1", "target_id": target,
            "meaning": "我担心这次邀请没有被放在心上", "value": "belonging",
            "is_inference": True,
            "appraisal": {"perceived_intent": "unknown", "confidence": .4,
                          "fairness": -.2, "boundary_impact": 0, "responsibility": .5},
            "private_instruction": "UNKNOWN_NESTED_INSTRUCTION",
        }],
        "raw_world_state": "OTHER_RESIDENT_SECRET",
    }


def test_scene_uses_each_frozen_view_not_shared_beliefs_or_other_minds(tmp_path):
    expression, writer = service(tmp_path)
    story, record, profiles = scene(initiator_id="guai", target_id="charles")
    record["expression_perspectives"] = {
        "guai": perspective(),
        "charles": {**perspective("charles", "guai"), "interpretations": [],
                    "self_image": ["希望自己是个可靠的人"]},
        "outsider": {"owner_id": "outsider", "self_image": ["UNINVOLVED_PRIVATE_MIND"]},
    }
    original = deepcopy(record)
    result = expression.scene("p", story, record, profiles)
    assert result["source"] == "ai"
    contract = writer.contracts[0]
    a, b = contract["participants"]
    assert a["perspective"]["owner_id"] == "guai"
    assert b["perspective"]["owner_id"] == "charles"
    assert a["perspective"]["interpretations"][0]["is_inference"] is True
    worry = "我担心这次邀请没有被放在心上"
    assert worry in json.dumps(a["perspective"], ensure_ascii=False)
    assert worry not in json.dumps(b, ensure_ascii=False)
    assert worry not in json.dumps(contract["facts"], ensure_ascii=False)
    for marker in ("UNINVOLVED_PRIVATE_MIND", "OTHER_RESIDENT_SECRET", "UNREVIEWED_DETAIL",
                   "UNKNOWN_NESTED_INSTRUCTION", "INJECTED_INSTRUCTION_MUST_NOT_SURVIVE"):
        assert marker not in json.dumps(contract)
    assert record == original
    # The rendering DTO never includes internal perspective or appraisal data.
    assert "perspective" not in json.dumps(result)


def test_old_scene_has_no_backfilled_view_and_new_cache_keeps_original(tmp_path):
    expression, writer = service(tmp_path)
    story, record, profiles = scene()
    profiles["guai"]["speaker_perspective"] = perspective()
    expression.scene("p", story, record, profiles)
    assert all(person["perspective"] == {} for person in writer.contracts[0]["participants"])
    story["id"] = "new-social-scene"
    record["expression_perspectives"] = {"guai": perspective()}
    first = expression.scene("p", story, record, profiles)
    first_contract = deepcopy(writer.contracts[-1])
    record["expression_perspectives"]["guai"]["interpretations"][0]["meaning"] = "TOMORROW_KNOWLEDGE"
    profiles["guai"]["personality"] = ["a different person"]
    assert expression.scene("p", story, record, profiles) == first
    assert len(writer.contracts) == 4  # Existing draft + review, no extra cognition calls.
    assert "TOMORROW_KNOWLEDGE" not in json.dumps(first_contract)


def test_swapped_owner_perspective_is_rejected(tmp_path):
    expression, writer = service(tmp_path)
    story, record, profiles = scene()
    record["expression_perspectives"] = {"guai": perspective("charles", "guai")}
    expression.scene("p", story, record, profiles)
    assert writer.contracts[0]["participants"][0]["perspective"] == {}


def test_provider_projection_is_private_filtered_and_idempotent():
    raw = perspective()
    private = deepcopy(raw["observations"][0])
    private.update(source_id="private-fact-id", visibility="private")
    private["facts"] = {"item_label": "PRIVATE_BODY_OR_CONFESSION"}
    raw["observations"].append(private)
    raw["interpretations"].append({**raw["interpretations"][0], "source_id": "private-fact-id",
                                    "meaning": "PRIVATE_INTERPRETATION"})
    context = {"current_action": {"type": "socialize", "visible_context": {"visibility": "open"}},
               "household_id": "private-household-id", "speaker_perspective": raw}
    original = deepcopy(context)
    public = project_public_life_context(context)
    assert "speaker_perspective" not in public
    provider = project_dialogue_life_context(context)
    assert provider["speaker_perspective"]["observations"]
    assert provider["speaker_perspective"]["interpretations"]
    assert project_dialogue_life_context(provider) == provider
    encoded = json.dumps(provider)
    for marker in ("PRIVATE_BODY_OR_CONFESSION", "PRIVATE_INTERPRETATION", "private-fact-id",
                   "internal-source-1", "private-household-id", "appraisal", "confidence"):
        assert marker not in encoded
    assert context == original


@pytest.mark.parametrize("value", [None, [], "not a view", 3])
def test_invalid_perspective_does_not_break_legacy_context(value):
    projected = project_dialogue_life_context({"speaker_perspective": value})
    assert "speaker_perspective" not in projected


def test_player_prompt_keeps_declared_character_and_own_view_as_separate_data():
    context = {"npc_profile": {"name": "Guai", "personality": ["独立", "嘴硬"],
                               "interests": ["coffee", "茶"]},
               "current_life": {"speaker_perspective": perspective()}}
    prompt = _persona_prompt(context)
    data = json.loads(prompt.split("<CHARACTER_DATA>\n", 1)[1].split("\n</CHARACTER_DATA>", 1)[0])
    assert data["character_facts"]["interests"] == ["coffee", "茶"]
    view = data["current_life"]["speaker_perspective"]
    assert view["personal_values"] == ["公平互惠", "陪伴与归属"]
    assert view["self_image"] == ["希望自己不麻烦别人"]
    assert view["interpretations"][0]["is_inference"] is True
    assert "猜测当事实" in prompt
    assert "谈话只能表达意见、请求和意向，不能完成世界行动" in prompt
    assert "个人视角" in SYSTEM_PROMPT and "speaker_id 对应的 perspective" in REVIEW_SYSTEM_PROMPT
    assert CHAT_PROMPT_VERSION == "agent-v3-personal-perspective"


def test_opening_receives_own_personal_view_and_does_not_regenerate(tmp_path):
    expression, writer = service(tmp_path)
    context = {"current_action": {"type": "socialize", "visible_intent": "A quiet break"},
               "speaker_perspective": perspective(),
               "conversation": {"id": "guai-current-action", "opening": {
                   "text": "Give me a second.", "translation": "稍等一下。"}}}
    first = expression.opening("p", "guai", {"name": "Guai", "personality": ["quiet"]}, context)
    participant = writer.contracts[0]["participants"][0]
    assert participant["perspective"]["self_image"] == ["希望自己不麻烦别人"]
    assert participant["delivery"]["rhythm"]
    assert expression.opening("p", "guai", {"name": "Guai"}, context) == first
    assert len(writer.contracts) == 2
    assert set(first) == {"text", "translation", "source"}


@pytest.mark.parametrize("topic", ["social_followup", "public_relay"])
def test_continuing_social_exchange_keeps_recipient_agency(tmp_path, topic):
    expression, writer = service(tmp_path)
    story, record, profiles = scene(actor_id="guai", affected_id="charles",
                                    followup_kind="explain", source_topic="shared_activity",
                                    source_fact_id="INTERNAL_FACT_ID")
    record["collision"]["topic"] = topic
    record["resolution"]["response_by_participant"] = {"guai": "acknowledge", "charles": "hear_out"}
    expression.scene("p", story, record, profiles)
    contract = writer.contracts[0]
    assert contract["facts"]["followup_kind"] == "explain"
    assert "source_fact_id" not in contract["facts"]
    assert contract["participants"][0]["role"] == "initiator"
    assert contract["participants"][1]["role"] == "affected_resident"
    assert "不是接受解释" in contract["participants"][1]["decision_brief"]
    assert any("不是重新演一次原事件" in item for item in contract["continuity_constraints"])
    assert "不能用一段对白完成归还" in " ".join(contract["continuity_constraints"])


def test_sanitized_player_view_retains_uncertainty_after_second_projection():
    once = sanitize_perspective(perspective(), for_player=True)
    twice = sanitize_perspective(once, for_player=True)
    assert once == twice
    assert twice["interpretations"][0]["is_inference"] is True


def test_public_relay_can_reference_absent_actor_without_reading_their_mind(tmp_path):
    expression, writer = service(tmp_path)
    story, record, profiles = scene(actor_id="guai", affected_id="charles", witness_id="guai",
                                    followup_kind="relay", source_topic="public_household_action",
                                    source_action_type="prepare_food", source_participants=["absent_cook"])
    record["collision"]["topic"] = "public_relay"
    witness = perspective()
    witness["observations"][0].update(channel="witness", participant_ids=["absent_cook"])
    witness["observations"][0]["facts"] = {"action_type": "prepare_food", "actor_id": "absent_cook"}
    witness["interpretations"] = []
    record["expression_perspectives"] = {
        "guai": witness, "charles": {"owner_id": "charles"},
        "absent_cook": {"owner_id": "absent_cook", "self_image": ["PRIVATE_ABSENT_MIND"]},
    }
    expression.scene("p", story, record, profiles)
    people = writer.contracts[0]["participants"]
    assert {person["id"] for person in people} == {"guai", "charles"}
    assert people[0]["perspective"]["observations"][0]["channel"] == "witness"
    assert people[1]["perspective"]["observations"] == []
    assert "PRIVATE_ABSENT_MIND" not in json.dumps(writer.contracts[0])


def set_present(state, npc_id, location, at, target=None):
    resident = state["residents"][npc_id]
    resident["current_location_id"] = location
    resident["current_journey"] = None
    resident["current_action"].update({
        "id": "social-expression-action-" + npc_id,
        "action_type": "talk_to_resident", "status": "performing",
        "location_id": location, "started_at": at.isoformat(), "target_npc_id": target,
        "completed_at": None, "ends_at": (at + timedelta(hours=1)).isoformat(), "visibility": "open",
    })
    resident["runtime"]["needs"].update(rest=80, privacy=80, food=80)
    resident["runtime"]["emotion"]["stress"] = 20


def test_real_followup_record_preserves_specific_borrowed_item_for_writer(tmp_path):
    profiles = _profiles()
    engine, profiles, state = _world(profiles=profiles)
    state["social_continuity"]["concerns"] = {npc_id: [] for npc_id in profiles}
    moment = NOW + timedelta(hours=1)
    source = {"id": "real-borrow-source", "kind": "person_boundary", "topic": "borrowed_property",
              "participant_ids": ["emma", "alex"], "location_id": "household-shared:living-room",
              "facts": {"actor_id": "emma", "affected_id": "alex", "borrower_id": "emma",
                        "owner_id": "alex", "item_label": "blue mug", "item_label_zh": "蓝色杯子",
                        "borrowed_without_permission": True}}
    resolution = {"outcome_tags": ["conflict"], "response_by_participant": {
        "emma": "return_and_apologize", "alex": "ask_item_back"}}
    source_fact = social_continuity.settled(state, profiles, source, resolution, moment)
    concern = next(item for item in state["social_continuity"]["concerns"]["emma"]
                   if item["source_fact_id"] == source_fact["id"])
    for npc, target in (("emma", "alex"), ("alex", "emma")):
        set_present(state, npc, "household-shared:living-room", moment, target)
    concern.update(status="approaching", attempts=1, assigned_action_id="social-expression-action-emma")
    engine._record_social_followups(state, profiles, moment + timedelta(seconds=31))
    record = next(value for value in state["stories"].values()
                  if value.get("collision", {}).get("topic") == "social_followup")
    expression, writer = service(tmp_path)
    result = expression.scene("p", record["story"], record, profiles)
    assert result["source"] == "ai"
    contract = writer.contracts[0]
    assert contract["facts"]["followup_kind"] == "repair"
    emma = next(person for person in contract["participants"] if person["id"] == "emma")
    assert emma["decision"] == "repair_attempt"
    assert "不预设对方接受" in emma["decision_brief"]
    known = emma["perspective"]["observations"]
    assert any(item["facts"].get("item_label") == "blue mug" for item in known)
    assert any(item["facts"].get("owner_id") == "alex" for item in known)
    assert len(writer.contracts) == 2


def test_real_relay_story_freezes_knowledge_before_the_listener_learns(tmp_path):
    profiles = _profiles()
    profiles["nora"] = {"name": "Nora", "personality": ["quiet"], "interests": ["books"]}
    engine, profiles, state = _world(profiles=profiles)
    state["social_continuity"]["concerns"] = {npc_id: [] for npc_id in profiles}
    moment = NOW + timedelta(hours=1)
    kitchen, lounge = "household-shared:kitchen", "household-shared:living-room"
    set_present(state, "alex", kitchen, moment)
    set_present(state, "emma", kitchen, moment)
    set_present(state, "nora", lounge, moment)
    public = {"id": "alex-cooked", "kind": "public_action_completed", "topic": "household_help",
              "participant_ids": ["alex"], "location_id": kitchen, "occurred_at": moment.isoformat(),
              "visibility": "public", "facts": {"actor_id": "alex", "action_type": "prepare_food"}}
    social_mind.observe_fact(state, profiles, public, moment)
    social_continuity.add_concern(state, "emma", "nora", "relay", "alex-cooked", "household_help", moment,
        details={"source_participants": ["alex"], "source_action_type": "prepare_food",
                 "source_location_id": kitchen, "source_occurred_at": moment.isoformat(), "witness_id": "emma"})
    later = moment + timedelta(minutes=30)
    set_present(state, "emma", lounge, later, "nora")
    set_present(state, "nora", lounge, later, "emma")
    concern = next(item for item in state["social_continuity"]["concerns"]["emma"] if item["kind"] == "relay")
    concern.update(status="approaching", attempts=1, assigned_action_id="social-expression-action-emma")
    engine._record_social_followups(state, profiles, later + timedelta(seconds=31))
    record = next(value for value in state["stories"].values()
                  if value.get("collision", {}).get("topic") == "public_relay")
    assert record["collision"]["facts"]["source_people"] == [{"id": "alex", "name": "Alex"}]
    profiles["alex"]["name"] = "A later name"
    expression, writer = service(tmp_path)
    expression.scene("p", record["story"], record, profiles)
    contract = writer.contracts[0]
    people = {person["id"]: person for person in contract["participants"]}
    assert set(people) == {"emma", "nora"}
    assert contract["facts"]["source_action_type"] == "prepare_food"
    assert contract["reference_people"] == [{"id": "alex", "name": "Alex"}]
    assert contract["facts"]["source_occurred_at"] == moment.isoformat()
    assert any(item["channel"] == "witness" and item["facts"].get("action_type") == "prepare_food"
               for item in people["emma"]["perspective"]["observations"])
    assert not any(item["facts"].get("action_type") == "prepare_food"
                   for item in people["nora"]["perspective"]["observations"])
    assert state["social_mind"]["minds"]["nora"]["observations"]["alex-cooked"]["channel"] == "reported"


def test_historical_scene_does_not_import_todays_relationship_impression(tmp_path):
    expression, writer = service(tmp_path)
    story, record, profiles = scene()
    record["interaction"] = {"relationship_context": {"closeness": "unfamiliar"}}
    state = {"residents": {"guai": {}, "charles": {}}, "relationships": {
        "guai:charles": {"channels": {"romance": "dating", "friendship": "close_friend"},
                         "a_to_b": {"owner_id": "guai", "target_id": "charles",
                                    "dimensions": {"trust": 90, "affinity": 90}}}},
        "pair_memory": {"version": 1, "pairs": {"guai:charles": {
            "owner_id": "guai", "target_id": "charles", "impression": {}, "episodes": []}}}}
    current = pair_memory.recall(state, "guai", now=NOW + timedelta(days=1), before=NOW)
    assert current[0]["impression"]["acknowledged_romance"] == "dating"
    original = deepcopy(current)
    expression.scene("p", story, record, profiles, memories={"guai": current})
    contract = writer.contracts[0]
    assert contract["relationship_context"]["closeness"] == "unfamiliar"
    assert contract["participants"][0]["owner_memory"] == [{"target_id": "charles", "episodes": []}]
    assert "dating" not in json.dumps(contract)
    # Only historical scene projection changes. Current-time recall remains
    # intact for present-day decisions/chat and no shared memory is mutated.
    assert current == original
    assert pair_memory.recall(state, "guai", now=NOW + timedelta(days=1))[0]["impression"]["acknowledged_romance"] == "dating"


def test_relay_mentions_only_frozen_names_without_exposing_absent_person_profile(tmp_path):
    expression, writer = service(tmp_path)
    story, record, profiles = scene(actor_id="guai", affected_id="charles", witness_id="guai",
        followup_kind="relay", source_participants=["cook"], source_action_type="prepare_food",
        source_people=[{"id": "cook", "name": "Nora", "private_motive": "ABSENT_PRIVATE_MOTIVE"},
                       {"id": "stranger", "name": "UNRELATED_NAME"},
                       {"id": "cook", "name": "DUPLICATE_NAME"}])
    record["collision"]["topic"] = "public_relay"
    profiles["cook"] = {"name": "A later rename", "private_memory": "ABSENT_PRIVATE_MEMORY"}
    profiles["stranger"] = {"name": "UNRELATED_NAME"}
    expression.scene("p", story, record, profiles)
    contract = writer.contracts[0]
    assert contract["reference_people"] == [{"id": "cook", "name": "Nora"}]
    assert {person["id"] for person in contract["participants"]} == {"guai", "charles"}
    assert "source_people" not in contract["facts"]
    for marker in ("ABSENT_PRIVATE_MOTIVE", "ABSENT_PRIVATE_MEMORY", "A later rename", "UNRELATED_NAME", "DUPLICATE_NAME"):
        assert marker not in json.dumps(contract)


@pytest.mark.parametrize("topic,has_frozen_name,has_profile", [
    ("social_followup", True, True), ("public_relay", False, True), ("public_relay", True, False),
])
def test_relay_reference_names_never_backfill_unrelated_or_missing_records(tmp_path, topic, has_frozen_name, has_profile):
    expression, writer = service(tmp_path)
    story, record, profiles = scene(source_participants=["cook"])
    record["collision"]["topic"] = topic
    if has_frozen_name:
        record["collision"]["facts"]["source_people"] = [{"id": "cook", "name": "Nora"}]
    if has_profile:
        profiles["cook"] = {"name": "DO_NOT_BACKFILL_CURRENT_NAME"}
    expression.scene("p", story, record, profiles)
    assert writer.contracts[0]["reference_people"] == []
