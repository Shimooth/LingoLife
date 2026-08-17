from __future__ import annotations

from typing import Dict, Literal, Optional

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
    quota: Dict[str, int]


class RegisterRequest(BaseModel):
    username: str
    invite_code: str


class AdminLoginRequest(BaseModel):
    password: str


class AdminUserPatch(BaseModel):
    disabled: Optional[bool] = None
    quota_delta: Optional[int] = Field(default=None, ge=-10000, le=10000)


class InviteCreateRequest(BaseModel):
    count: int = Field(default=1, ge=1, le=100)
    daily_quota: Optional[int] = Field(default=None, ge=1, le=10000)
