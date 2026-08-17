from typing import Literal

from pydantic import BaseModel, Field


class Stats(BaseModel):
    relationship: int = Field(ge=0, le=100)
    mood: int = Field(ge=0, le=100)
    english_xp: int = Field(ge=0, le=100)


class EnglishFeedback(BaseModel):
    is_understandable: bool
    corrected_text: str = Field(max_length=500)
    tip: str = Field(max_length=300)
    tags: list[str] = Field(default_factory=list, max_length=8)


class AIResult(BaseModel):
    npc_reply: str = Field(min_length=1, max_length=1000)
    relationship_change: int
    mood_change: int
    english_xp_change: int
    english_feedback: EnglishFeedback


class ChatRequest(BaseModel):
    message: str


class ChatResponse(AIResult):
    stats: Stats
    animation: Literal["idle", "sad", "happy"]
