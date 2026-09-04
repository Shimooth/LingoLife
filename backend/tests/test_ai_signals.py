import json

import pytest
from pydantic import ValidationError

from lingolife.ai import DeepSeekProvider, FallbackProvider, npc_reply_prefix
from lingolife.config import Settings
from lingolife.models import AIResult, EnglishFeedback, Stats, TurnAnalysis


def base_result(**extra):
    return AIResult(
        npc_reply="Tell me more.", relationship_change=1, mood_change=1, english_xp_change=1,
        english_feedback=EnglishFeedback(is_understandable=True, corrected_text="Hello", tip="Clear."),
        **extra,
    )


def test_ai_result_additions_default_empty_and_reject_unknown_values():
    result = base_result()
    assert result.semantic_signals == [] and result.learning_evidence == []
    assert result.animation_cue == "talk"
    with pytest.raises(ValidationError):
        base_result(semantic_signals=["made_up_signal"])
    with pytest.raises(ValidationError):
        base_result(learning_evidence=[{"target_id": "unknown.target", "outcome": "success"}])
    with pytest.raises(ValidationError):
        base_result(learning_evidence=[{"target_id": "intent.empathy", "outcome": "success", "confidence": 2}])
    with pytest.raises(ValidationError):
        base_result(animation_cue="ai_invented_dance")


def test_streamed_json_exposes_only_complete_decoded_reply_text():
    assert npc_reply_prefix('{"npc_reply":"Hello') == "Hello"
    assert npc_reply_prefix('{"npc_reply":"Hello\\nMaya \\u4f60') == "Hello\nMaya 你"
    assert npc_reply_prefix('{"npc_reply":"unfinished\\') == "unfinished"
    assert npc_reply_prefix('{"relationship_change":2}') == ""


def test_fallback_extracts_conservative_signals_and_learning_evidence():
    result = FallbackProvider().reply(
        "I'm sorry. Why was it so difficult? Maybe you could talk to her.",
        Stats(relationship=35, mood=30, english_xp=0), [],
    )
    assert set(result.semantic_signals) == {"curiosity", "empathy", "advice"}
    assert {item.target_id for item in result.learning_evidence} >= {
        "intent.follow_up", "intent.empathy", "intent.advice", "grammar.questions",
    }
    assert all(0 <= item.confidence <= 1 for item in result.learning_evidence)
    assert (result.relationship_change, result.mood_change, result.english_xp_change) == (0, 0, 0)


def test_fallback_awards_no_evidence_for_non_english_input():
    result = FallbackProvider().reply("你还好吗？", Stats(relationship=35, mood=30, english_xp=0), [])
    assert result.semantic_signals == [] and result.learning_evidence == []
    assert (result.relationship_change, result.mood_change, result.english_xp_change) == (0, 0, 0)


def test_deepseek_prompt_contains_optional_agent_context(monkeypatch):
    captured = []
    analysis = TurnAnalysis(
        english_feedback=EnglishFeedback(is_understandable=True, corrected_text="Are you okay?", tip="Natural."),
        semantic_signals=["empathy"], learning_evidence=[{
            "target_id": "intent.empathy", "outcome": "success", "confidence": .9,
        }], memory_candidates=[],
    ).model_dump_json()

    class Response:
        def raise_for_status(self): pass
        def __init__(self, content): self.content = content
        def json(self): return {"choices": [{"message": {"content": self.content}}]}

    class Client:
        def __init__(self, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def post(self, url, headers, json):
            captured.append(json)
            return Response(analysis if json.get("response_format") else "I answer in my own voice.")

    monkeypatch.setattr("lingolife.ai.httpx.Client", Client)
    provider = DeepSeekProvider(Settings(deepseek_api_key="test-key"))
    result = provider.reply("Are you okay?", Stats(relationship=35, mood=30, english_xp=0),
                            [{"speaker": "npc", "text": "I had a difficult day."}], {
        "npc_profile": {"name": "Mia", "personality": ["bold"]},
        "current_event": {"title": "Lost sketchbook"},
        "learning_targets": ["intent.empathy"],
        "memories": ["The player helped yesterday."],
    })
    dialogue = next(item for item in captured if not item.get("response_format"))
    analyzer = next(item for item in captured if item.get("response_format"))
    assert dialogue["model"] == "deepseek-v4-flash"
    assert dialogue["thinking"] == {"type": "disabled"}
    assert analyzer["thinking"] == {"type": "disabled"}
    system = dialogue["messages"][0]["content"]
    assert "You are Mia" in system and "Lost sketchbook" in system
    assert "The player helped yesterday." in system
    assert dialogue["messages"][1] == {"role": "assistant", "content": "I had a difficult day."}
    prompt = json.loads(analyzer["messages"][1]["content"])
    assert prompt["learning_targets"] == ["intent.empathy"]
    assert not ({"relationship_change", "mood_change", "english_xp_change"}
                & prompt["schema"]["properties"].keys())
    assert set(prompt["schema"]["properties"]["animation_cue"]["enum"]) == {
        "idle", "talk", "listen", "happy", "sad", "tired",
        "look_around", "walk", "run", "jump", "crouch", "push",
    }
    assert result.npc_reply == "I answer in my own voice."
    assert result.semantic_signals == ["empathy"]
    assert (result.relationship_change, result.mood_change, result.english_xp_change) == (0, 0, 0)


def test_turn_analysis_rejects_model_authored_gameplay_numbers():
    schema = TurnAnalysis.model_json_schema()
    assert not ({"relationship_change", "mood_change", "english_xp_change"}
                & schema["properties"].keys())
    with pytest.raises(ValidationError):
        TurnAnalysis.model_validate({
            "relationship_change": 5,
            "mood_change": 5,
            "english_xp_change": 5,
            "english_feedback": {
                "is_understandable": True,
                "corrected_text": "Hello",
                "tip": "Clear.",
            },
        })
