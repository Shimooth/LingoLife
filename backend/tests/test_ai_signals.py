import json

import pytest
from pydantic import ValidationError

from lingolife.ai import DeepSeekProvider, FallbackProvider
from lingolife.config import Settings
from lingolife.models import AIResult, EnglishFeedback, Stats


def base_result(**extra):
    return AIResult(
        npc_reply="Tell me more.", relationship_change=1, mood_change=1, english_xp_change=1,
        english_feedback=EnglishFeedback(is_understandable=True, corrected_text="Hello", tip="Clear."),
        **extra,
    )


def test_ai_result_additions_default_empty_and_reject_unknown_values():
    result = base_result()
    assert result.semantic_signals == [] and result.learning_evidence == []
    with pytest.raises(ValidationError):
        base_result(semantic_signals=["made_up_signal"])
    with pytest.raises(ValidationError):
        base_result(learning_evidence=[{"target_id": "unknown.target", "outcome": "success"}])
    with pytest.raises(ValidationError):
        base_result(learning_evidence=[{"target_id": "intent.empathy", "outcome": "success", "confidence": 2}])


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


def test_fallback_awards_no_evidence_for_non_english_input():
    result = FallbackProvider().reply("你还好吗？", Stats(relationship=35, mood=30, english_xp=0), [])
    assert result.semantic_signals == [] and result.learning_evidence == []


def test_deepseek_prompt_contains_optional_agent_context(monkeypatch):
    captured = {}
    content = base_result(semantic_signals=["empathy"], learning_evidence=[{
        "target_id": "intent.empathy", "outcome": "success", "confidence": .9,
    }]).model_dump_json()

    class Response:
        def raise_for_status(self): pass
        def json(self): return {"choices": [{"message": {"content": content}}]}

    class Client:
        def __init__(self, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def post(self, url, headers, json):
            captured.update(json)
            return Response()

    monkeypatch.setattr("lingolife.ai.httpx.Client", Client)
    provider = DeepSeekProvider(Settings(deepseek_api_key="test-key"))
    result = provider.reply("Are you okay?", Stats(relationship=35, mood=30, english_xp=0), [], {
        "npc_profile": {"name": "Mia", "traits": ["bold"]},
        "current_event": {"title": "Lost sketchbook"},
        "learning_targets": ["intent.empathy"],
        "memories": ["The player helped yesterday."],
    })
    prompt = json.loads(captured["messages"][1]["content"])
    assert prompt["npc_profile"]["name"] == "Mia"
    assert prompt["current_event"]["title"] == "Lost sketchbook"
    assert prompt["learning_targets"] == ["intent.empathy"]
    assert prompt["relevant_memories"] == ["The player helped yesterday."]
    assert result.semantic_signals == ["empathy"]
