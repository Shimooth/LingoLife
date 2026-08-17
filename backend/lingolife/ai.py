from __future__ import annotations

import json
import re
from typing import Protocol

import httpx

from .config import Settings
from .models import AIResult, EnglishFeedback, Stats


class DialogueProvider(Protocol):
    def reply(self, message: str, stats: Stats, history: list[dict]) -> AIResult: ...


class DeepSeekProvider:
    def __init__(self, settings: Settings):
        if not settings.deepseek_api_key:
            raise ValueError("DEEPSEEK_API_KEY is not configured")
        self.settings = settings

    def reply(self, message: str, stats: Stats, history: list[dict]) -> AIResult:
        prompt = {
            "emma": "25, kind, introverted, works at a small design studio",
            "stats": stats.model_dump(), "recent_messages": history, "player_message": message,
            "rules": [
                "Return one JSON object matching the schema and no prose outside it.",
                "npc_reply is Emma's natural in-character reply to player_message.",
                "english_feedback evaluates player_message, never npc_reply.",
                "english_feedback.corrected_text is a corrected version of player_message; keep it unchanged when already natural.",
                "english_feedback.tip is one short encouraging observation addressed to the player.",
                "relationship_change reflects care, respect, and relevance, not perfect grammar.",
                "relationship_change and mood_change are integers from -5 to 5; english_xp_change is an integer from 0 to 5.",
            ],
            "example": {
                "npc_reply": "My manager rejected the idea I worked on all week. Thanks for asking.",
                "relationship_change": 2, "mood_change": 2, "english_xp_change": 2,
                "english_feedback": {
                    "is_understandable": True,
                    "corrected_text": "Why? What happened today?",
                    "tip": "Natural and caring question.", "tags": [],
                },
            },
            "schema": AIResult.model_json_schema(),
        }
        payload = {
            "model": self.settings.deepseek_model,
            "messages": [{"role": "system", "content": "You are Emma and an encouraging English evaluator. Always output valid JSON."}, {"role": "user", "content": json.dumps(prompt)}],
            "response_format": {"type": "json_object"}, "max_tokens": self.settings.deepseek_max_tokens,
            "temperature": self.settings.deepseek_temperature,
        }
        last_error: Exception | None = None
        for _ in range(self.settings.deepseek_retry_count + 1):
            try:
                with httpx.Client(timeout=self.settings.deepseek_timeout) as client:
                    response = client.post(self.settings.deepseek_base_url.rstrip("/") + "/chat/completions", headers={"Authorization": f"Bearer {self.settings.deepseek_api_key}"}, json=payload)
                    response.raise_for_status()
                content = response.json()["choices"][0]["message"]["content"]
                return AIResult.model_validate_json(content)
            except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as error:
                last_error = error
        raise RuntimeError("AI response unavailable or invalid") from last_error


class FallbackProvider:
    def reply(self, message: str, stats: Stats, history: list[dict]) -> AIResult:
        understandable = re.search(r"[A-Za-z]", message) is not None
        return AIResult(
            npc_reply="Thanks for asking. It means a lot that you're here. I just need a little time to process today.",
            relationship_change=1 if understandable else 0, mood_change=1 if understandable else 0,
            english_xp_change=1 if understandable else 0,
            english_feedback=EnglishFeedback(is_understandable=understandable, corrected_text=message,
                tip="Your message is clear and caring." if understandable else "Try writing a short question in English.", tags=[]),
        )


class ResilientProvider:
    def __init__(self, primary: DialogueProvider | None, fallback: DialogueProvider | None = None):
        self.primary, self.fallback = primary, fallback or FallbackProvider()

    def reply(self, message: str, stats: Stats, history: list[dict]) -> AIResult:
        if self.primary:
            try:
                return self.primary.reply(message, stats, history)
            except Exception:
                pass
        return self.fallback.reply(message, stats, history)
