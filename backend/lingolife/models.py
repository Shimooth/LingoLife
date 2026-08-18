from __future__ import annotations

from typing import Any, Dict, Literal, Optional

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


SemanticSignal = Literal[
    "accept", "advice", "apology", "celebration", "curiosity", "decline",
    "empathy", "encouragement", "honesty", "practical_help", "reassurance",
]
LearningTarget = Literal[
    "intent.follow_up", "intent.empathy", "intent.advice", "intent.past_story",
    "grammar.past_simple", "grammar.questions", "grammar.soft_advice", "grammar.sequence",
]


class LearningEvidence(BaseModel):
    """Observable evaluator signal; mastery and XP are intentionally absent."""

    target_id: LearningTarget
    outcome: Literal["exposure", "success", "error"]
    confidence: float = Field(default=1.0, ge=0, le=1)
    source: Literal["chat", "event", "review"] = "chat"


class AIResult(BaseModel):
    npc_reply: str = Field(min_length=1, max_length=1000)
    relationship_change: int
    mood_change: int
    english_xp_change: int
    english_feedback: EnglishFeedback
    semantic_signals: list[SemanticSignal] = Field(default_factory=list, max_length=11)
    learning_evidence: list[LearningEvidence] = Field(default_factory=list, max_length=12)


class ChatRequest(BaseModel):
    message: str
    npc_id: str = Field(default="emma", pattern=r"^[a-z0-9-]{1,48}$")


class ChatResponse(AIResult):
    stats: Stats
    animation: Literal["idle", "sad", "happy"]
    quota: Dict[str, int]
    active_event: Optional[Dict[str, Any]] = None
    event_update: Optional[Dict[str, Any]] = None
    learning_summary: Optional[Dict[str, Any]] = None


class AvatarStroke(BaseModel):
    color: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    width: float = Field(ge=2, le=10)
    points: list[tuple[float, float]] = Field(max_length=80)


class AvatarConfig(BaseModel):
    hair: str = Field(max_length=24)
    hairColor: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    face: str = Field(max_length=24)
    skin: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    eyes: str = Field(max_length=24)
    brows: str = Field(max_length=24)
    nose: str = Field(max_length=24)
    mouth: str = Field(max_length=24)
    outfit: str = Field(max_length=24)
    outfitColor: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    accessory: str = Field(max_length=24)
    strokes: list[AvatarStroke] = Field(default_factory=list, max_length=20)


class NpcProfile(BaseModel):
    name: str = Field(min_length=1, max_length=24)
    relationship: str = Field(min_length=1, max_length=32)
    personality: list[str] = Field(max_length=4)
    interests: list[str] = Field(max_length=5)
    occupation: str = Field(max_length=48)
    longTermGoal: str = Field(default="", max_length=180)
    avatar: AvatarConfig


class RegisterRequest(BaseModel):
    username: str
    invite_code: str
    password: str = Field(min_length=1, max_length=256)


class LoginRequest(BaseModel):
    username: str
    password: str = Field(min_length=1, max_length=256)


class PasswordChangeRequest(BaseModel):
    new_password: str = Field(min_length=1, max_length=256)
    current_password: Optional[str] = Field(default=None, max_length=256)


class AdminLoginRequest(BaseModel):
    password: str


class AdminUserPatch(BaseModel):
    disabled: Optional[bool] = None
    quota_delta: Optional[int] = Field(default=None, ge=-10000, le=10000)


class InviteCreateRequest(BaseModel):
    count: int = Field(default=1, ge=1, le=100)
    daily_quota: Optional[int] = Field(default=None, ge=1, le=10000)
