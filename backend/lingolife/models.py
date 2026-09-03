from __future__ import annotations

from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .animation import AnimationCue


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
    relationship_change: int = Field(ge=-5, le=5)
    mood_change: int = Field(ge=-5, le=5)
    english_xp_change: int = Field(ge=0, le=5)
    english_feedback: EnglishFeedback
    animation_cue: AnimationCue = "talk"
    semantic_signals: list[SemanticSignal] = Field(default_factory=list, max_length=11)
    learning_evidence: list[LearningEvidence] = Field(default_factory=list, max_length=12)
    memory_candidates: list[MemoryCandidate] = Field(default_factory=list, max_length=4)


class AIResult(BaseModel):
    npc_reply: str = Field(min_length=1, max_length=1000)
    npc_reply_zh: str = Field(default="", max_length=1200)
    relationship_change: int
    mood_change: int
    english_xp_change: int
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
    model: str = Field(default="chibi", pattern=r"^(?:chibi|city-(?:0[1-9]|1[0-6]))$")
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


class NpcProfile(BaseModel):
    name: str = Field(min_length=1, max_length=24)
    age: Optional[int] = Field(default=None, ge=16, le=100)
    relationship: str = Field(min_length=1, max_length=32)
    personality: list[str] = Field(max_length=4)
    interests: list[str] = Field(max_length=5)
    occupation: str = Field(max_length=48)
    longTermGoal: str = Field(default="", max_length=180)
    romanceEnabled: bool = True
    relationshipBoundaries: list[str] = Field(default_factory=list, max_length=8)
    # Player-authored objective social facts.  Psychological relationship
    # dimensions remain rule-owned; these ids only describe family and a
    # requested shared household with residents owned by the same player.
    familyIds: list[str] = Field(default_factory=list, max_length=4)
    # Kept for wire compatibility with older clients.  Life Simulation v2 now
    # owns one shared household per player, so this field no longer controls
    # cohabitation.  Accept the complete resident range while old saved profiles
    # are migrated into the shared home.
    householdWithIds: list[str] = Field(default_factory=list, max_length=7)
    avatar: AvatarConfig

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        # A display name is also the player-facing identity of a resident.  Do
        # not let visually empty or whitespace-variant names evade uniqueness
        # checks at the persistence boundary.
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("character name cannot be blank")
        return normalized


class OnboardingCompleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    household_name: str = Field(default="Our Home", min_length=1, max_length=64)
    residents: list[NpcProfile] = Field(min_length=2, max_length=8)

    @field_validator("residents")
    @classmethod
    def unique_resident_names(cls, residents: list[NpcProfile]):
        names = [" ".join(resident.name.split()).casefold() for resident in residents]
        if len(names) != len(set(names)):
            raise ValueError("character names must be unique")
        return residents


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
