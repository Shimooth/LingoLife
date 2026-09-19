from copy import deepcopy
import pytest

from lingolife.life_result_copy import response_consequence
from lingolife.life_service import LifeWorldService
from lingolife.life_expression import delivery_direction, validate_script, validate_borrowing_intents
from test_life_expression import scene, service


def test_familiarity_does_not_claim_trust_or_stability():
    record = {"resolution": {"relationship_changes": [{"familiarity": 2}]}}
    result = LifeWorldService._relationship_consequence({}, record, "s", "A and B", "A、B", None)
    assert "熟悉" in result["translation_zh"]
    assert "稳定" not in result["translation_zh"]
    assert "信任" not in result["translation_zh"]


def test_opposite_direction_effects_are_not_cancelled():
    record = {"resolution": {"relationship_changes": [{"trust": 2}, {"trust": -2}]}}
    assert LifeWorldService._relationship_consequence({}, record, "s", "A and B", "A、B", None)["tone"] == "mixed"


def test_concrete_result_preserves_intention_and_different_responses():
    record = {"resolution": {"response_by_participant": {"a": "ask_item_back", "b": "deny_responsibility"}}}
    result = response_consequence(record, {"a": {"name": "Nora"}, "b": {"name": "Bo"}})
    assert "Nora要求把东西还回来" in result["translation_zh"]
    assert "Bo对借东西的事仍不肯认错" in result["translation_zh"]
    assert "已经归还" not in result["translation_zh"]
    record["resolution"]["response_by_participant"] = {"a": "choose_alternative"}
    assert response_consequence(record, {})["text"] != result["text"]
    assert response_consequence({}, {}) is None


def test_busy_host_does_not_become_visitor_in_results():
    record = {"collision": {"facts": {"target_id": "a", "target_busy": True}},
              "resolution": {"response_by_participant": {"a": "try_later", "b": "try_later"}}}
    result = response_consequence(record, {})["translation_zh"]
    assert "a当时正忙" in result and "b决定这次先不聊" in result


def test_personality_delivery_is_stable_distinct_and_not_private():
    quiet = {"axes": {"extraversion": 12, "assertiveness": 80}, "secret": "never send"}
    talkative = {"axes": {"extraversion": 90, "warmth": 80}}
    first = delivery_direction(quiet, {"closeness": "familiar"}, "scene-a")
    assert first == delivery_direction(quiet, {"closeness": "familiar"}, "scene-a")
    assert first != delivery_direction(talkative, {"closeness": "familiar"}, "scene-a")
    assert "never send" not in str(first)


def test_contract_carries_concrete_decision_and_voice_without_rewriting_cache(tmp_path):
    expression, writer = service(tmp_path)
    story, record, profiles = scene(initiator_id="charles", target_id="guai", target_busy=True)
    original = deepcopy(record)
    first = expression.scene("p", story, record, profiles)
    participants = writer.contracts[0]["participants"]
    assert all(person["delivery"] and person["decision_brief"] for person in participants)
    assert "不能接待" in participants[0]["decision_brief"]
    assert expression.scene("p", story, record, profiles) == first
    assert len(writer.contracts) == 2 and record == original


def test_three_courtesy_fillers_require_repair_but_one_thanks_is_allowed():
    contract = {"kind": "scene", "participants": [{"id": "a", "role": "resident"}, {"id": "b", "role": "resident"}]}
    lines = ["Thanks for hearing me out.", "I understand your point.", "That's fair.", "You can keep it."]
    beats = [{"speaker_id": "a" if i % 2 == 0 else "b", "addressee_id": "b" if i % 2 == 0 else "a", "role": "resident", "text": line, "translation_zh": "这是一句中文。", "animation_cue": "talk"} for i, line in enumerate(lines)]
    script = {"beats": beats, "ending_reason": "decision_reached"}
    with pytest.raises(ValueError, match="courtesy_loop"):
        validate_script(script, contract)
    beats[1]["text"] = "My charger. Ask me next time."
    beats[2]["text"] = "Can I keep it for now?"
    assert validate_script(script, contract)


def test_negated_apology_is_not_a_forced_reconciliation():
    contract = {"participants": [{"id": "a", "decision": "deny_responsibility"}]}
    validate_borrowing_intents([{"speaker_id": "a", "text": "I'm not sorry. It's just a charger."}], contract)
    with pytest.raises(ValueError, match="changed_borrowing_decision"):
        validate_borrowing_intents([{"speaker_id": "a", "text": "I'm sorry. I should have asked."}], contract)


def test_return_intention_does_not_complete_a_transfer():
    contract = {"participants": [{"id": "a", "decision": "return_and_apologize"}]}
    with pytest.raises(ValueError, match="invented_return"):
        validate_borrowing_intents([{"speaker_id": "a", "text": "Here you go. Sorry."}], contract)
    validate_borrowing_intents([{"speaker_id": "a", "text": "I want to give it back. I'm sorry."}], contract)
