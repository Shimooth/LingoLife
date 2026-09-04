from __future__ import annotations

import re
from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .animation import AnimationCue
from .avatar_contract import AVATAR_COMPONENT_ALLOWLISTS
from .profile_contract import (
    CHORE_PREFERENCES,
    HOUSEHOLD_ROLES,
    PRIVATE_SPACE_PREFERENCES,
    normalize_profile_contract,
    roster_difference_report,
)


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


class MemoryCandidate(BaseModel):
    kind: Literal["player_fact", "episodic", "relationship", "language"]
    content: str = Field(min_length=3, max_length=500)
    tags: list[str] = Field(default_factory=list, max_length=8)
    importance: int = Field(default=2, ge=1, le=5)
    confidence: float = Field(default=.7, ge=0, le=1)
    ttl_days: Optional[int] = Field(default=None, ge=1, le=365)
    access_stage: Literal["stranger", "acquaintance", "friend", "close_friend"] = "stranger"


class TurnAnalysis(BaseModel):
    """Provider-visible evidence only; gameplay numbers belong to rules."""

    model_config = ConfigDict(extra="forbid")

    english_feedback: EnglishFeedback
    animation_cue: AnimationCue = "talk"
    semantic_signals: list[SemanticSignal] = Field(default_factory=list, max_length=11)
    learning_evidence: list[LearningEvidence] = Field(default_factory=list, max_length=12)
    memory_candidates: list[MemoryCandidate] = Field(default_factory=list, max_length=4)


class AIResult(BaseModel):
    npc_reply: str = Field(min_length=1, max_length=1000)
    npc_reply_zh: str = Field(default="", max_length=1200)
    # Kept for cached/API compatibility. Built-in providers leave these at
    # neutral values and execute_chat ignores values supplied by custom or
    # legacy providers before authoritative rule settlement.
    relationship_change: int = 0
    mood_change: int = 0
    english_xp_change: int = 0
    english_feedback: EnglishFeedback
    animation_cue: AnimationCue = "talk"
    semantic_signals: list[SemanticSignal] = Field(default_factory=list, max_length=11)
    learning_evidence: list[LearningEvidence] = Field(default_factory=list, max_length=12)
    memory_candidates: list[MemoryCandidate] = Field(default_factory=list, exclude=True)
    agent_trace: Dict[str, Any] = Field(default_factory=dict, exclude=True)


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
    agent: Optional[Dict[str, Any]] = None


class AvatarStroke(BaseModel):
    color: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    width: float = Field(ge=2, le=10)
    points: list[tuple[float, float]] = Field(max_length=80)


class AvatarConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: str = "chibi"
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
    pants: str = Field(default="balloon", max_length=24)
    accessory: str = Field(max_length=24)
    homeBackground: str = Field(default="bubble", max_length=24)
    strokes: list[AvatarStroke] = Field(default_factory=list, max_length=20)

    @field_validator(
        "model", "hair", "face", "eyes", "brows", "nose", "mouth", "outfit",
        "pants", "accessory", "homeBackground",
    )
    @classmethod
    def approved_component(cls, value: str, info):
        normalized = value.strip()
        allowed = AVATAR_COMPONENT_ALLOWLISTS[info.field_name]
        if normalized not in allowed:
            raise ValueError(f"avatar {info.field_name} is not an approved asset option")
        return normalized

    @field_validator("hairColor", "skin", "outfitColor")
    @classmethod
    def approved_color(cls, value: str, info):
        normalized = value.strip().lower()
        allowed = AVATAR_COMPONENT_ALLOWLISTS[info.field_name]
        if normalized not in allowed:
            raise ValueError(f"avatar {info.field_name} is not in the approved palette")
        return normalized


FamilyRole = Literal["sibling", "cousin", "parent", "child", "guardian", "dependent"]
SharedHistoryKind = Literal[
    "grew_up_together", "studied_together", "worked_together", "shared_project",
    "weathered_hardship", "family_tradition", "friendly_rivalry",
]

FAMILY_ROLE_INVERSE: dict[str, str] = {
    "sibling": "sibling", "cousin": "cousin", "parent": "child", "child": "parent",
    "guardian": "dependent", "dependent": "guardian",
}


class FamilyRelation(BaseModel):
    """One resident's persisted view of an objective, typed family bond."""

    model_config = ConfigDict(extra="forbid")

    targetId: str = Field(pattern=r"^[a-z0-9-]{1,48}$")
    role: FamilyRole


class SharedHistoryHook(BaseModel):
    """A bounded, player-authored seed; later simulation owns all outcomes."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{0,63}$")
    participantIds: list[str] = Field(min_length=2, max_length=4)
    kind: SharedHistoryKind
    summary: str = Field(min_length=3, max_length=180)
    tone: Literal["warm", "neutral", "complicated"] = "neutral"

    @field_validator("participantIds")
    @classmethod
    def valid_participants(cls, values: list[str]):
        if len(values) != len(set(values)):
            raise ValueError("shared-history participants must be unique")
        if any(not re.fullmatch(r"[a-z0-9-]{1,48}", value) for value in values):
            raise ValueError("shared-history participants must be resident ids")
        return values

    @field_validator("summary")
    @classmethod
    def normalized_summary(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if len(normalized) < 3:
            raise ValueError("shared-history summary is too short")
        return normalized


class OnboardingFamilyBond(BaseModel):
    """Atomic two-sided family input for a roster whose NPC ids do not exist yet."""

    model_config = ConfigDict(extra="forbid")

    left_index: int = Field(ge=0, le=7)
    right_index: int = Field(ge=0, le=7)
    left_role: FamilyRole
    right_role: FamilyRole

    @model_validator(mode="after")
    def consistent_pair(self):
        if self.left_index == self.right_index:
            raise ValueError("family bonds cannot reference the same resident twice")
        if FAMILY_ROLE_INVERSE[self.left_role] != self.right_role:
            raise ValueError("family roles must be a supported reciprocal pair")
        return self


class OnboardingSharedHistoryHook(BaseModel):
    """Creation-time hook references roster slots and is resolved server-side."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{0,63}$")
    participant_indices: list[int] = Field(min_length=2, max_length=4)
    kind: SharedHistoryKind
    summary: str = Field(min_length=3, max_length=180)
    tone: Literal["warm", "neutral", "complicated"] = "neutral"

    @field_validator("participant_indices")
    @classmethod
    def unique_participants(cls, values: list[int]):
        if len(values) != len(set(values)):
            raise ValueError("shared-history roster references must be unique")
        if any(value < 0 or value > 7 for value in values):
            raise ValueError("shared-history roster reference is outside the supported range")
        return values

    @field_validator("summary")
    @classmethod
    def normalize_summary(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if len(normalized) < 3:
            raise ValueError("shared-history summary is too short")
        return normalized


class NpcProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=24)
    age: Optional[int] = Field(default=None, ge=16, le=100)
    relationship: str = Field(min_length=1, max_length=32)
    personality: list[str] = Field(min_length=1, max_length=4)
    interests: list[str] = Field(min_length=1, max_length=5)
    likes: list[str] = Field(default_factory=list, max_length=6)
    dislikes: list[str] = Field(default_factory=list, max_length=6)
    quirks: list[str] = Field(default_factory=list, max_length=4)
    habits: list[str] = Field(default_factory=list, max_length=4)
    boundaries: list[str] = Field(default_factory=list, max_length=8)
    occupation: str = Field(max_length=48)
    longTermGoal: str = Field(default="", max_length=180)
    householdRole: Optional[Literal[
        "organizer", "caretaker", "mediator", "cook", "fixer", "free_spirit",
    ]] = None
    chorePreferences: list[Literal[
        "cooking", "dishes", "cleaning", "shopping", "repairs", "laundry",
    ]] = Field(default_factory=list, max_length=3)
    privateSpacePreference: Optional[Literal["low", "balanced", "high"]] = None
    romanceEnabled: bool = True
    relationshipBoundaries: list[str] = Field(default_factory=list, max_length=8)
    # Player-authored objective social facts.  Psychological relationship
    # dimensions remain rule-owned; these ids only describe family and a
    # requested shared household with residents owned by the same player.
    familyIds: list[str] = Field(default_factory=list, max_length=4)
    familyRelations: list[FamilyRelation] = Field(default_factory=list, max_length=4)
    # Kept for wire compatibility with older clients.  Life Simulation v2 now
    # owns one shared household per player, so this field no longer controls
    # cohabitation.  Accept the complete resident range while old saved profiles
    # are migrated into the shared home.
    householdWithIds: list[str] = Field(default_factory=list, max_length=7)
    shared_history_hooks: list[SharedHistoryHook] = Field(default_factory=list, max_length=4)
    avatar: AvatarConfig

    @field_validator("name", "relationship", "occupation", "longTermGoal")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        # A display name is also the player-facing identity of a resident.  Do
        # not let visually empty or whitespace-variant names evade uniqueness
        # checks at the persistence boundary.
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("profile text cannot be blank")
        return normalized

    @field_validator(
        "personality", "interests", "likes", "dislikes", "quirks", "habits",
        "boundaries", "relationshipBoundaries",
    )
    @classmethod
    def normalize_public_lists(cls, values: list[str]) -> list[str]:
        result: list[str] = []
        seen: set[str] = set()
        for raw in values:
            value = " ".join(raw.split())
            if not value:
                raise ValueError("profile lists cannot contain blank values")
            if len(value) > 80:
                raise ValueError("profile list values cannot exceed 80 characters")
            key = value.casefold()
            if key in seen:
                raise ValueError("profile list values must be unique")
            result.append(value)
            seen.add(key)
        return result

    @field_validator("familyIds", "householdWithIds")
    @classmethod
    def normalize_npc_ids(cls, values: list[str]) -> list[str]:
        result: list[str] = []
        for raw in values:
            value = raw.strip()
            if not re.fullmatch(r"[a-z0-9-]{1,48}", value):
                raise ValueError("resident ids must use lowercase letters, numbers, or hyphens")
            if value in result:
                raise ValueError("resident ids must be unique")
            result.append(value)
        return result

    @model_validator(mode="after")
    def complete_public_contract(self):
        normalized = normalize_profile_contract(self.model_dump())
        for field in (
            "likes", "dislikes", "quirks", "habits", "boundaries",
            "relationshipBoundaries", "householdRole", "chorePreferences",
            "privateSpacePreference",
        ):
            object.__setattr__(self, field, normalized[field])
        overlap = {
            value.casefold() for value in self.likes
        } & {value.casefold() for value in self.dislikes}
        if overlap:
            raise ValueError("likes and dislikes cannot contain the same value")
        if self.householdRole not in HOUSEHOLD_ROLES:
            raise ValueError("invalid household role")
        if not self.chorePreferences or not set(self.chorePreferences) <= set(CHORE_PREFERENCES):
            raise ValueError("at least one valid chore preference is required")
        if len(self.chorePreferences) != len(set(self.chorePreferences)):
            raise ValueError("chore preferences must be unique")
        if self.privateSpacePreference not in PRIVATE_SPACE_PREFERENCES:
            raise ValueError("invalid private-space preference")
        relation_targets = [relation.targetId for relation in self.familyRelations]
        if len(relation_targets) != len(set(relation_targets)):
            raise ValueError("family relation targets must be unique")
        if self.familyRelations and set(relation_targets) != set(self.familyIds):
            raise ValueError("typed family relations and familyIds must reference the same residents")
        hook_ids = [hook.id for hook in self.shared_history_hooks]
        if len(hook_ids) != len(set(hook_ids)):
            raise ValueError("shared-history hook ids must be unique per resident")
        romance_blocked = any(
            value.casefold() in {"no_romance", "no-romance", "aromantic"}
            for value in (*self.relationshipBoundaries, *self.boundaries)
        )
        if (self.age is not None and self.age < 18) or romance_blocked:
            object.__setattr__(self, "romanceEnabled", False)
        return self


class OnboardingCompleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    household_name: str = Field(default="Our Home", min_length=1, max_length=64)
    residents: list[NpcProfile] = Field(min_length=2, max_length=8)
    family_bonds: list[OnboardingFamilyBond] = Field(default_factory=list, max_length=16)
    shared_history_hooks: list[OnboardingSharedHistoryHook] = Field(default_factory=list, max_length=12)

    @field_validator("residents")
    @classmethod
    def unique_resident_names(cls, residents: list[NpcProfile]):
        names = [" ".join(resident.name.split()).casefold() for resident in residents]
        if len(names) != len(set(names)):
            raise ValueError("character names must be unique")
        report = roster_difference_report([resident.model_dump() for resident in residents])
        if not report["valid"]:
            details = ", ".join(report["missing_categories"])
            pairs = ", ".join(" / ".join(pair) for pair in report["too_similar_pairs"])
            reason = details or pairs or "public profile dimensions"
            raise ValueError(f"resident roster needs more discernible differences: {reason}")
        return residents

    @model_validator(mode="after")
    def valid_roster_references(self):
        resident_count = len(self.residents)
        # Persisted fields contain real NPC ids.  During first creation those ids
        # do not exist, so the atomic roster-level structures are the only valid
        # source of family/history facts.
        if any(resident.familyIds or resident.familyRelations or resident.shared_history_hooks
               for resident in self.residents):
            raise ValueError("onboarding family and history references must use roster-level fields")

        pairs: set[tuple[int, int]] = set()
        degrees = [0] * resident_count
        for bond in self.family_bonds:
            if bond.left_index >= resident_count or bond.right_index >= resident_count:
                raise ValueError("family bond references a resident outside this roster")
            pair = tuple(sorted((bond.left_index, bond.right_index)))
            if pair in pairs:
                raise ValueError("each family pair may appear only once")
            pairs.add(pair)
            degrees[bond.left_index] += 1
            degrees[bond.right_index] += 1
        if any(value > 4 for value in degrees):
            raise ValueError("a resident may have at most four family bonds")

        hook_ids: set[str] = set()
        hook_counts = [0] * resident_count
        for hook in self.shared_history_hooks:
            if hook.id in hook_ids:
                raise ValueError("shared-history hook ids must be unique")
            hook_ids.add(hook.id)
            if any(index >= resident_count for index in hook.participant_indices):
                raise ValueError("shared-history hook references a resident outside this roster")
            for index in hook.participant_indices:
                hook_counts[index] += 1
        if any(value > 4 for value in hook_counts):
            raise ValueError("a resident may have at most four shared-history hooks")
        return self


def materialize_onboarding_profiles(
    request: OnboardingCompleteRequest, npc_ids: list[str],
) -> list[dict[str, Any]]:
    """Resolve creation-time roster slots into immutable persisted NPC ids."""
    if len(npc_ids) != len(request.residents) or len(npc_ids) != len(set(npc_ids)):
        raise ValueError("onboarding materialization requires one unique id per resident")
    profiles = [resident.model_dump() for resident in request.residents]
    relations: list[list[dict[str, str]]] = [[] for _ in profiles]
    for bond in request.family_bonds:
        left_id, right_id = npc_ids[bond.left_index], npc_ids[bond.right_index]
        relations[bond.left_index].append({"targetId": right_id, "role": bond.left_role})
        relations[bond.right_index].append({"targetId": left_id, "role": bond.right_role})
    histories: list[list[dict[str, Any]]] = [[] for _ in profiles]
    for hook in request.shared_history_hooks:
        participant_ids = [npc_ids[index] for index in hook.participant_indices]
        persisted = {
            "id": hook.id, "participantIds": participant_ids, "kind": hook.kind,
            "summary": hook.summary, "tone": hook.tone,
        }
        for index in hook.participant_indices:
            histories[index].append(dict(persisted))
    for index, profile in enumerate(profiles):
        profile["familyRelations"] = relations[index]
        profile["familyIds"] = [relation["targetId"] for relation in relations[index]]
        profile["shared_history_hooks"] = histories[index]
    return profiles


class OnboardingIntroRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    intro_version: int = Field(ge=1, le=1000)


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


class AdminUserResetRequest(BaseModel):
    """Destructive game-save reset guarded by the selected account name."""

    model_config = ConfigDict(extra="forbid")

    confirm_username: str = Field(min_length=1, max_length=64)


class AdminRosterSelectionRequest(BaseModel):
    """Non-destructive selection of the residents simulated after migration."""

    model_config = ConfigDict(extra="forbid")

    active_npc_ids: list[str] = Field(min_length=2, max_length=8)
    expected_revision: int = Field(ge=1)
    confirm_username: str = Field(min_length=1, max_length=64)
    note: str = Field(default="管理员确认模拟阵容", min_length=1, max_length=240)
    request_key: Optional[str] = Field(default=None, min_length=8, max_length=128)

    @field_validator("active_npc_ids")
    @classmethod
    def unique_active_npc_ids(cls, values: list[str]):
        cleaned = [value.strip() for value in values]
        if any(not value or len(value) > 96 for value in cleaned):
            raise ValueError("active npc ids must be non-empty and at most 96 characters")
        if len(set(cleaned)) != len(cleaned):
            raise ValueError("active npc ids must be unique")
        return cleaned


class InviteCreateRequest(BaseModel):
    count: int = Field(default=1, ge=1, le=100)
    daily_quota: Optional[int] = Field(default=None, ge=1, le=10000)


class SocialInterventionRequest(BaseModel):
    action: Literal["mediate", "encourage", "give_space", "let_them_handle_it"]


class LifeInterventionRequest(BaseModel):
    action: Literal[
        "ask", "comfort", "advise", "mediate", "encourage", "give_space", "offer_help", "invite_talk",
        "set_boundary", "support_confession", "let_them_handle_it",
        "start_dating", "become_partners", "separate",
    ]
    idempotency_key: str = Field(min_length=8, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]+$")


# Published world-layout contract -------------------------------------------

LayoutAsset = str

CITY_ROAD_ASSETS = frozenset(
    f"/assets/world/kaykit-city/gltf/{name}.gltf" for name in (
        "road_straight", "road_straight_crossing", "road_junction",
        "road_tsplit", "road_corner", "road_corner_curved",
    )
)
CITY_BUILDING_ASSETS = frozenset(
    f"/assets/world/kaykit-city/gltf/building_{letter}.gltf" for letter in "ABCDEFGH"
)
CITY_PROP_ASSETS = frozenset(
    f"/assets/world/kaykit-city/gltf/{name}.gltf" for name in (
        "base", "streetlight", "trafficlight_A", "trafficlight_B", "trafficlight_C",
        "bench", "watertower", "firehydrant", "dumpster", "trash_A", "trash_B",
        "box_A", "box_B", "car_sedan", "car_taxi", "car_police", "car_hatchback",
        "car_stationwagon",
    )
)
CITY_DECORATION_ASSETS = frozenset({
    "/assets/world/kaykit-city/gltf/bush.gltf",
    "/assets/life/interiors/park/tree.gltf",
    "/assets/life/interiors/park/bush.gltf",
    "/assets/life/interiors/park/bench.gltf",
    "/assets/life/interiors/park/fountain.gltf",
    "/assets/life/interiors/plants/monstera_plant_medium_potted.gltf",
})
INTERIOR_ASSETS = frozenset(
    f"/assets/life/interiors/{folder}/{name}.gltf" for folder, names in {
        "furniture": (
            "armchair_pillows", "bed_single_A", "couch_pillows", "lamp_standing",
            "rug_rectangle_A", "shelf_B_large_decorated", "table_low",
        ),
        "kitchen": (
            "chair", "countertop_sink", "floor_tiles_kitchen", "fridge", "kettle",
            "stove", "table_A",
        ),
        "bathroom": ("bath", "cabinet_bathroom", "floor_tiled", "mirror", "shower", "toilet"),
        "restaurant": ("dishrack_plates", "food_burger", "food_dinner", "plate"),
        "plants": ("monstera_plant_medium_potted",),
        "park": ("bench", "bush", "fountain", "tree"),
    }.items() for name in names
)


class LayoutVector(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: float = Field(ge=-10_000, le=10_000)
    y: float = Field(ge=-10_000, le=10_000)
    z: float = Field(ge=-10_000, le=10_000)


class LayoutScale(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: float = Field(default=1, gt=0, le=20)
    y: float = Field(default=1, gt=0, le=20)
    z: float = Field(default=1, gt=0, le=20)


class CityLayoutPlacement(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")
    asset: LayoutAsset = Field(min_length=1, max_length=180)
    position: LayoutVector
    rotation: LayoutVector = Field(default_factory=lambda: LayoutVector(x=0, y=0, z=0))
    scale: LayoutScale = Field(default_factory=LayoutScale)


class BuildingLayoutPlacement(CityLayoutPlacement):
    location_id: Optional[str] = Field(default=None, max_length=64)


class InteriorLayoutPlacement(CityLayoutPlacement):
    room_id: str = Field(min_length=1, max_length=48, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")


class CityLayout(BaseModel):
    model_config = ConfigDict(extra="forbid")

    roads: list[CityLayoutPlacement] = Field(default_factory=list, min_length=1, max_length=512)
    buildings: list[BuildingLayoutPlacement] = Field(default_factory=list, min_length=1, max_length=512)
    props: list[CityLayoutPlacement] = Field(default_factory=list, max_length=1024)
    decorations: list[CityLayoutPlacement] = Field(default_factory=list, max_length=1024)

    @model_validator(mode="after")
    def validate_assets_and_ids(self):
        from .city import LOCATION_BY_ID

        groups = (
            ("roads", self.roads, CITY_ROAD_ASSETS),
            ("buildings", self.buildings, CITY_BUILDING_ASSETS),
            ("props", self.props, CITY_PROP_ASSETS),
            ("decorations", self.decorations, CITY_DECORATION_ASSETS),
        )
        ids: set[str] = set()
        positions_by_group: dict[str, set[tuple[float, float, float]]] = {}
        mapped_location_ids: set[str] = set()
        shared_home: BuildingLayoutPlacement | None = None
        for label, placements, allowed in groups:
            positions: set[tuple[float, float, float]] = set()
            for placement in placements:
                if placement.asset not in allowed:
                    raise ValueError(f"asset is not allowed in city.{label}: {placement.asset}")
                if placement.id in ids:
                    raise ValueError(f"duplicate city placement id: {placement.id}")
                ids.add(placement.id)
                point = (placement.position.x, placement.position.y, placement.position.z)
                if point in positions:
                    raise ValueError(f"duplicate position in city.{label}: {placement.id}")
                positions.add(point)
                if not (-128 <= placement.position.x <= 128
                        and -10 <= placement.position.y <= 100
                        and -128 <= placement.position.z <= 128):
                    raise ValueError(f"city placement is outside world bounds: {placement.id}")
                if isinstance(placement, BuildingLayoutPlacement) and (
                    placement.location_id is not None and placement.location_id not in LOCATION_BY_ID
                ):
                    raise ValueError(f"unknown city location_id: {placement.location_id}")
                if isinstance(placement, BuildingLayoutPlacement):
                    if placement.location_id is not None:
                        if placement.location_id in mapped_location_ids:
                            raise ValueError(f"duplicate city location_id: {placement.location_id}")
                        mapped_location_ids.add(placement.location_id)
                    if placement.id == "shared-home":
                        shared_home = placement
            positions_by_group[label] = positions
        if shared_home is None or shared_home.location_id is not None:
            raise ValueError("city must retain one unmapped shared-home building")
        missing_locations = set(LOCATION_BY_ID) - mapped_location_ids
        if missing_locations:
            raise ValueError(f"city is missing location buildings: {', '.join(sorted(missing_locations))}")
        road_xz = {(x, z) for x, _, z in positions_by_group["roads"]}
        building_xz = {(x, z) for x, _, z in positions_by_group["buildings"]}
        if road_xz & building_xz:
            raise ValueError("a city building cannot occupy a road position")
        return self


class InteriorRoomLayout(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=48, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")
    name: str = Field(min_length=1, max_length=64)
    kind: Literal["living_room", "kitchen", "bathroom", "bedroom", "shared_space", "private_room"]
    placements: list[InteriorLayoutPlacement] = Field(default_factory=list, max_length=256)

    @model_validator(mode="after")
    def validate_placements(self):
        ids: set[str] = set()
        for placement in self.placements:
            if placement.asset not in INTERIOR_ASSETS:
                raise ValueError(f"asset is not allowed in interior: {placement.asset}")
            if placement.room_id != self.id:
                raise ValueError(f"placement {placement.id} room_id must match room {self.id}")
            if placement.id in ids:
                raise ValueError(f"duplicate placement id in room {self.id}: {placement.id}")
            ids.add(placement.id)
            if not (-20 <= placement.position.x <= 20 and
                    -2 <= placement.position.y <= 12 and
                    -20 <= placement.position.z <= 20):
                raise ValueError(f"interior placement is outside room bounds: {placement.id}")
        return self


class InteriorLayout(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rooms: list[InteriorRoomLayout] = Field(default_factory=list, min_length=4, max_length=16)

    @field_validator("rooms")
    @classmethod
    def unique_room_ids(cls, rooms: list[InteriorRoomLayout]):
        ids = [room.id for room in rooms]
        if len(ids) != len(set(ids)):
            raise ValueError("room ids must be unique")
        required = {"living-room", "kitchen", "bathroom", "bedroom"}
        if not required <= set(ids):
            raise ValueError("layout must retain living-room, kitchen, bathroom and bedroom")
        required_kinds = {
            "living-room": "living_room", "kitchen": "kitchen",
            "bathroom": "bathroom", "bedroom": "bedroom",
        }
        for room in rooms:
            expected_kind = required_kinds.get(room.id)
            if expected_kind is not None and room.kind != expected_kind:
                raise ValueError(f"room {room.id} must use kind {expected_kind}")
            if expected_kind is not None and not room.placements:
                raise ValueError(f"room {room.id} must contain at least one placement")
        return rooms


class WorldLayout(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Literal[1] = 1
    city: CityLayout
    interior: InteriorLayout


class WorldLayoutRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    layout: WorldLayout
    note: str = Field(default="兼容发布", min_length=1, max_length=240)
    author: str = Field(default="admin", min_length=1, max_length=80)


class WorldLayoutDraftRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    layout: WorldLayout
    revision: int = Field(ge=0)
    author: str = Field(default="admin", min_length=1, max_length=80)


class WorldLayoutValidationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    layout: WorldLayout


class WorldLayoutPublishRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    revision: int = Field(ge=1)
    note: str = Field(min_length=1, max_length=240)
    author: str = Field(default="admin", min_length=1, max_length=80)


class WorldLayoutActivateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note: str = Field(default="回滚到历史版本", min_length=1, max_length=240)
    author: str = Field(default="admin", min_length=1, max_length=80)
