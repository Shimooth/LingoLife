"""Deterministic, persistence-agnostic primitives for LingoLife's life simulation.

This module deliberately has no database or web-framework dependency.  Every
operation accepts a complete value and returns a new value, which lets the API
layer apply an action transition, resource reservation, and story settlement in
one SQLite transaction.  IDs are derived from stable world facts rather than
process randomness, so retries and process restarts can replay the same choice.
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import asdict, dataclass, field, replace
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any, Literal, Mapping, Sequence, cast
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .animation import AnimationCue, require_animation_cue


RULES_VERSION = "life-rules-v1"
ACTION_SELECTION_TEMPERATURE = 5.5
RUNTIME_VERSION = 2
CORE_NEEDS = ("food", "rest", "social", "achievement", "love", "privacy", "fun", "security")
CORE_ACTION_TYPES = (
    "prepare_food",
    "eat",
    "sleep",
    "shower",
    "use_television",
    "read",
    "practice_hobby",
    "borrow_household_item",
    "clean_shared_space",
    "leave_dishes",
    "rest_alone",
    "seek_company",
    "talk_to_resident",
)
ACTION_STATUSES = frozenset({
    "planned", "traveling", "performing", "blocked", "retrying",
    "completed", "abandoned", "interrupted",
})
TERMINAL_ACTION_STATUSES = frozenset({"completed", "abandoned", "interrupted"})

Period = Literal["morning", "afternoon", "evening", "night"]
ActionStatus = Literal[
    "planned", "traveling", "performing", "blocked", "retrying",
    "completed", "abandoned", "interrupted",
]
ResourceScope = Literal["household", "city"]
ReservationOutcome = Literal["acquired", "queued", "unavailable"]


def clamp(value: float | int, low: float = 0, high: float = 100) -> int:
    return round(max(low, min(high, float(value))))


def _canonical(value: object) -> str:
    if isinstance(value, datetime):
        return _utc(value).isoformat(timespec="seconds")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, (Mapping, list, tuple, set, frozenset)):
        normalized = sorted(value) if isinstance(value, (set, frozenset)) else value
        return json.dumps(normalized, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return str(value)


def stable_number(*parts: object, rules_version: str = RULES_VERSION) -> int:
    """Return the same unsigned number for the same versioned world facts."""
    material = "\x1f".join((rules_version, *(_canonical(part) for part in parts)))
    return int.from_bytes(hashlib.sha256(material.encode("utf-8")).digest()[:8], "big")


def stable_fraction(*parts: object, rules_version: str = RULES_VERSION) -> float:
    return stable_number(*parts, rules_version=rules_version) / float(2**64 - 1)


def stable_id(prefix: str, *parts: object, rules_version: str = RULES_VERSION, length: int = 20) -> str:
    material = "\x1f".join((rules_version, *(_canonical(part) for part in parts)))
    return f"{prefix}-" + hashlib.sha256(material.encode("utf-8")).hexdigest()[:length]


def _utc(value: datetime) -> datetime:
    return (value.replace(tzinfo=timezone.utc) if value.tzinfo is None
            else value.astimezone(timezone.utc))


def _parse_time(value: str | datetime | None) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return _utc(value)
    try:
        return _utc(datetime.fromisoformat(value.replace("Z", "+00:00")))
    except (TypeError, ValueError):
        return None


def period_for_hour(hour: int) -> Period:
    if 6 <= hour < 12:
        return "morning"
    if 12 <= hour < 18:
        return "afternoon"
    if 18 <= hour < 23:
        return "evening"
    return "night"


@dataclass(frozen=True)
class SimulationWindow:
    key: str
    start_at: datetime
    end_at: datetime
    game_date: str
    period: Period
    offline: bool

    @property
    def duration_seconds(self) -> int:
        return max(0, round((self.end_at - self.start_at).total_seconds()))

    def to_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "start_at": self.start_at.isoformat(),
            "end_at": self.end_at.isoformat(),
            "game_date": self.game_date,
            "period": self.period,
            "offline": self.offline,
            "duration_seconds": self.duration_seconds,
        }


class WorldClock:
    """Authoritative wall-clock projection with stable online and catch-up windows."""

    def __init__(self, timezone_name: str = "Asia/Shanghai", *, decision_seconds: int = 30,
                 max_catchup_days: int = 7, online_threshold_seconds: int = 15 * 60):
        if decision_seconds < 5 or decision_seconds > 3600:
            raise ValueError("decision_seconds must be between 5 and 3600")
        if max_catchup_days < 1 or max_catchup_days > 31:
            raise ValueError("max_catchup_days must be between 1 and 31")
        try:
            self.zone = ZoneInfo(timezone_name)
        except ZoneInfoNotFoundError as exc:
            raise ValueError(f"unknown world timezone: {timezone_name}") from exc
        self.timezone_name = timezone_name
        self.decision_seconds = decision_seconds
        self.max_catchup_days = max_catchup_days
        self.online_threshold_seconds = online_threshold_seconds

    def decision_window(self, moment: datetime) -> SimulationWindow:
        current = _utc(moment)
        stamp = int(current.timestamp())
        start = datetime.fromtimestamp(stamp - stamp % self.decision_seconds, timezone.utc)
        end = start + timedelta(seconds=self.decision_seconds)
        local = start.astimezone(self.zone)
        key = f"{local.date().isoformat()}:{period_for_hour(local.hour)}:{int(start.timestamp())}"
        return SimulationWindow(key, start, end, local.date().isoformat(), period_for_hour(local.hour), False)

    def game_date(self, moment: datetime) -> date:
        return _utc(moment).astimezone(self.zone).date()

    def catch_up_blocks(self, last_simulated_at: datetime, now: datetime) -> tuple[SimulationWindow, ...]:
        """Split offline time at local-day periods without replaying every tick.

        The returned range is capped.  Callers can record a compact recovery
        summary for time before the first block instead of simulating old days.
        """
        end = _utc(now)
        original_start = _utc(last_simulated_at)
        if end <= original_start:
            return ()
        start = max(original_start, end - timedelta(days=self.max_catchup_days))
        offline = (end - original_start).total_seconds() > self.online_threshold_seconds
        blocks: list[SimulationWindow] = []
        cursor = start
        while cursor < end:
            local = cursor.astimezone(self.zone)
            candidates = []
            for day_offset in (0, 1):
                local_day = local.date() + timedelta(days=day_offset)
                for boundary_hour in (0, 6, 12, 18, 23):
                    candidate = datetime.combine(local_day, time(boundary_hour), self.zone)
                    if candidate > local:
                        candidates.append(candidate)
            boundary = min(candidates).astimezone(timezone.utc)
            block_end = min(boundary, end)
            period = period_for_hour(local.hour)
            key = f"{local.date().isoformat()}:{period}:{int(cursor.timestamp())}"
            blocks.append(SimulationWindow(key, cursor, block_end, local.date().isoformat(), period, offline))
            cursor = block_end
        return tuple(blocks)


@dataclass(frozen=True)
class ResourceTemplate:
    id: str
    kind: str
    scope: ResourceScope
    location_id: str
    capacity: int
    state: Mapping[str, Any]
    household_id: str | None = None


@dataclass(frozen=True)
class ActionTemplate:
    type: str
    label: str
    need_weights: Mapping[str, float]
    trait_affinities: tuple[str, ...]
    interest_affinities: tuple[str, ...]
    required_resource_kinds: tuple[str, ...]
    optional_resource_kinds: tuple[str, ...]
    preferred_location_kinds: tuple[str, ...]
    allowed_periods: tuple[Period, ...]
    duration_seconds: tuple[int, int]
    interruptible: bool
    requires_resident_target: bool
    need_deltas: Mapping[str, int]
    emotion_deltas: Mapping[str, int]
    resource_deltas: Mapping[str, int]
    animation_cue: AnimationCue
    collision_hooks: tuple[str, ...]
    offline_eligible: bool


@dataclass(frozen=True)
class LifeCatalog:
    version: int
    rules_version: str
    actions: Mapping[str, ActionTemplate]
    household_resources: tuple[Mapping[str, Any], ...]
    city_resources: tuple[ResourceTemplate, ...]


def load_life_catalog(path: str | Path | None = None) -> LifeCatalog:
    source = Path(path) if path else Path(__file__).parents[1] / "content" / "life_actions.json"
    raw = json.loads(source.read_text(encoding="utf-8"))
    if int(raw.get("version", 0)) != 1:
        raise ValueError("unsupported life action content version")
    rules_version = str(raw.get("rules_version") or RULES_VERSION)
    known_resource_kinds = {
        str(item.get("kind"))
        for item in (*raw.get("household_resources", []), *raw.get("city_resources", []))
        if item.get("kind")
    }
    actions: dict[str, ActionTemplate] = {}
    for item in raw.get("actions", []):
        action_type = str(item.get("type", ""))
        if action_type in actions:
            raise ValueError(f"duplicate life action type: {action_type}")
        if action_type not in CORE_ACTION_TYPES:
            raise ValueError(f"unknown life action type: {action_type}")
        duration = item.get("duration_seconds", [])
        if (not isinstance(duration, list) or len(duration) != 2
                or not all(isinstance(value, int) and not isinstance(value, bool) for value in duration)
                or not 5 <= duration[0] <= duration[1] <= 86400):
            raise ValueError(f"invalid duration for {action_type}")
        need_weights = {str(key): float(value) for key, value in item.get("need_weights", {}).items()}
        need_deltas = {str(key): int(value) for key, value in item.get("need_deltas", {}).items()}
        unknown_needs = (set(need_weights) | set(need_deltas)) - set(CORE_NEEDS)
        if unknown_needs:
            raise ValueError(f"unknown needs for {action_type}: {sorted(unknown_needs)}")
        resource_kinds = {
            str(value) for value in (*item.get("required_resource_kinds", []),
                                     *item.get("optional_resource_kinds", []))
        }
        if resource_kinds - known_resource_kinds:
            raise ValueError(f"unknown resource kinds for {action_type}: {sorted(resource_kinds - known_resource_kinds)}")
        allowed = tuple(item.get("allowed_periods") or ("morning", "afternoon", "evening", "night"))
        if not allowed or not set(allowed) <= {"morning", "afternoon", "evening", "night"}:
            raise ValueError(f"invalid allowed periods for {action_type}")
        actions[action_type] = ActionTemplate(
            action_type,
            str(item.get("label") or action_type.replace("_", " ").title()),
            need_weights,
            tuple(str(value).casefold() for value in item.get("trait_affinities", [])),
            tuple(str(value).casefold() for value in item.get("interest_affinities", [])),
            tuple(str(value) for value in item.get("required_resource_kinds", [])),
            tuple(str(value) for value in item.get("optional_resource_kinds", [])),
            tuple(str(value) for value in item.get("preferred_location_kinds", [])),
            cast(tuple[Period, ...], allowed),
            (duration[0], duration[1]),
            bool(item.get("interruptible", True)),
            bool(item.get("requires_resident_target", False)),
            need_deltas,
            {str(key): int(value) for key, value in item.get("emotion_deltas", {}).items()},
            {str(key): int(value) for key, value in item.get("resource_deltas", {}).items()},
            require_animation_cue(item.get("animation_cue"), field=f"{action_type}.animation_cue"),
            tuple(str(value) for value in item.get("collision_hooks", [])),
            bool(item.get("offline_eligible", True)),
        )
    if set(actions) != set(CORE_ACTION_TYPES):
        missing = sorted(set(CORE_ACTION_TYPES) - set(actions))
        raise ValueError(f"life action catalog must define all core actions; missing={missing}")

    household = tuple(raw.get("household_resources", []))
    if {str(item.get("kind")) for item in household} != {"kitchen", "television", "bathroom"}:
        raise ValueError("household catalog must define kitchen, television, and bathroom")
    city: list[ResourceTemplate] = []
    for item in raw.get("city_resources", []):
        capacity = int(item.get("capacity", 0))
        if capacity < 1:
            raise ValueError(f"invalid city resource capacity: {item.get('id')}")
        city.append(ResourceTemplate(
            str(item["id"]), str(item["kind"]), "city", str(item["location_id"]), capacity,
            dict(item.get("state", {})), None,
        ))
    return LifeCatalog(int(raw["version"]), rules_version, actions, household, tuple(city))


@dataclass(frozen=True)
class ResourceReservation:
    action_id: str
    npc_id: str
    reserved_at: datetime
    expires_at: datetime | None = None

    def to_dict(self) -> dict[str, Any]:
        return {"action_id": self.action_id, "npc_id": self.npc_id,
                "reserved_at": self.reserved_at.isoformat(),
                "expires_at": self.expires_at.isoformat() if self.expires_at else None}


@dataclass(frozen=True)
class ResourceQueueEntry:
    action_id: str
    npc_id: str
    requested_at: datetime
    lease_seconds: int

    def to_dict(self) -> dict[str, Any]:
        return {"action_id": self.action_id, "npc_id": self.npc_id,
                "requested_at": self.requested_at.isoformat(), "lease_seconds": self.lease_seconds}


@dataclass(frozen=True)
class ResourceState:
    id: str
    kind: str
    scope: ResourceScope
    location_id: str
    capacity: int
    state: Mapping[str, Any] = field(default_factory=dict)
    household_id: str | None = None
    reservations: tuple[ResourceReservation, ...] = ()
    queue: tuple[ResourceQueueEntry, ...] = ()
    version: int = 1

    @property
    def available(self) -> bool:
        return bool(self.state.get("available", True))

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id, "kind": self.kind, "scope": self.scope,
            "location_id": self.location_id, "household_id": self.household_id,
            "capacity": self.capacity, "state": dict(self.state), "version": self.version,
            "reservations": [value.to_dict() for value in self.reservations],
            "queue": [value.to_dict() for value in self.queue],
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "ResourceState":
        reservations = tuple(ResourceReservation(
            str(item["action_id"]), str(item["npc_id"]),
            _parse_time(item.get("reserved_at")) or datetime.fromtimestamp(0, timezone.utc),
            _parse_time(item.get("expires_at")),
        ) for item in value.get("reservations", []))
        queue = tuple(ResourceQueueEntry(
            str(item["action_id"]), str(item["npc_id"]),
            _parse_time(item.get("requested_at")) or datetime.fromtimestamp(0, timezone.utc),
            max(5, int(item.get("lease_seconds", 60))),
        ) for item in value.get("queue", []))
        return cls(str(value["id"]), str(value["kind"]), cast(ResourceScope, value["scope"]),
                   str(value["location_id"]), max(1, int(value["capacity"])),
                   dict(value.get("state", {})), value.get("household_id"),
                   reservations, queue, int(value.get("version", 1)))


@dataclass(frozen=True)
class ResourceTransition:
    resource: ResourceState
    outcome: ReservationOutcome | Literal["released"]
    action_id: str
    queue_position: int | None = None
    promoted_action_ids: tuple[str, ...] = ()
    changed: bool = False


def default_household_resources(household_id: str, catalog: LifeCatalog | None = None) -> tuple[ResourceState, ...]:
    source = catalog or load_life_catalog()
    resources = []
    for item in source.household_resources:
        suffix, room = str(item["id_suffix"]), str(item["room_id"])
        resources.append(ResourceState(
            id=f"{household_id}:{suffix}", kind=str(item["kind"]), scope="household",
            location_id=f"{household_id}:{room}", household_id=household_id,
            capacity=max(1, int(item["capacity"])), state=dict(item.get("state", {})),
        ))
    return tuple(resources)


def default_city_resources(catalog: LifeCatalog | None = None) -> tuple[ResourceState, ...]:
    source = catalog or load_life_catalog()
    return tuple(ResourceState(value.id, value.kind, value.scope, value.location_id,
                               value.capacity, dict(value.state)) for value in source.city_resources)


def _promote_queue(resource: ResourceState, now: datetime) -> tuple[ResourceState, tuple[str, ...]]:
    current = _utc(now)
    active = tuple(value for value in resource.reservations
                   if value.expires_at is None or value.expires_at > current)
    queued = sorted(resource.queue, key=lambda value: (value.requested_at, value.action_id))
    promoted: list[str] = []
    while resource.available and len(active) < resource.capacity and queued:
        entry = queued.pop(0)
        if any(value.action_id == entry.action_id for value in active):
            continue
        active += (ResourceReservation(entry.action_id, entry.npc_id, current,
                                       current + timedelta(seconds=entry.lease_seconds)),)
        promoted.append(entry.action_id)
    return replace(resource, reservations=active, queue=tuple(queued)), tuple(promoted)


def reserve_resource(resource: ResourceState, *, npc_id: str, action_id: str, now: datetime,
                     lease_seconds: int) -> ResourceTransition:
    """Acquire or deterministically queue an action; replaying the same ID is a no-op."""
    if lease_seconds < 5 or lease_seconds > 86400:
        raise ValueError("lease_seconds must be between 5 and 86400")
    current, promoted = _promote_queue(resource, now)
    existing = next((value for value in current.reservations if value.action_id == action_id), None)
    if existing:
        return ResourceTransition(current, "acquired", action_id, promoted_action_ids=promoted,
                                  changed=current != resource)
    queued = next((index for index, value in enumerate(current.queue) if value.action_id == action_id), None)
    if queued is not None:
        return ResourceTransition(current, "queued", action_id, queued + 1, promoted,
                                  current != resource)
    if not current.available:
        return ResourceTransition(current, "unavailable", action_id, promoted_action_ids=promoted,
                                  changed=current != resource)
    moment = _utc(now)
    if len(current.reservations) < current.capacity:
        reservation = ResourceReservation(action_id, npc_id, moment,
                                          moment + timedelta(seconds=lease_seconds))
        updated = replace(current, reservations=(*current.reservations, reservation))
        return ResourceTransition(updated, "acquired", action_id, promoted_action_ids=promoted, changed=True)
    entry = ResourceQueueEntry(action_id, npc_id, moment, lease_seconds)
    queue = tuple(sorted((*current.queue, entry), key=lambda value: (value.requested_at, value.action_id)))
    updated = replace(current, queue=queue)
    position = next(index for index, value in enumerate(queue) if value.action_id == action_id) + 1
    return ResourceTransition(updated, "queued", action_id, position, promoted, True)


def release_resource(resource: ResourceState, *, action_id: str, now: datetime) -> ResourceTransition:
    reservations = tuple(value for value in resource.reservations if value.action_id != action_id)
    queue = tuple(value for value in resource.queue if value.action_id != action_id)
    removed = len(reservations) != len(resource.reservations) or len(queue) != len(resource.queue)
    updated, promoted = _promote_queue(replace(resource, reservations=reservations, queue=queue), now)
    return ResourceTransition(updated, "released", action_id, promoted_action_ids=promoted,
                              changed=removed or updated != resource)


def apply_resource_deltas(resource: ResourceState, deltas: Mapping[str, int | float]) -> ResourceState:
    state = dict(resource.state)
    for key, delta in deltas.items():
        old = state.get(key, 0)
        if isinstance(old, (int, float)) and not isinstance(old, bool):
            state[key] = clamp(float(old) + float(delta))
    return replace(resource, state=state)


def initial_life_runtime(*, mood: int = 50, relationship: int = 35,
                         now: datetime | None = None) -> dict[str, Any]:
    moment = _utc(now or datetime.now(timezone.utc))
    return {
        "version": RUNTIME_VERSION,
        "emotion": {"valence": clamp(mood), "stress": 38, "energy": 68},
        "needs": {"food": 72, "rest": 70, "social": 58, "achievement": 55,
                  "love": clamp(30 + relationship * .45), "privacy": 60,
                  "fun": 52, "security": 75},
        "growth": {"warmth": 0.0, "extraversion": 0.0, "assertiveness": 0.0,
                   "openness": 0.0, "emotional_stability": 0.0, "humor": 0.0},
        "active_desire_ids": [], "current_commitment_id": None,
        "queued_commitment_id": None, "last_simulated_at": moment.isoformat(),
    }


def normalize_runtime_v2(value: Mapping[str, Any] | None, *, mood: int = 50,
                         relationship: int = 35, now: datetime | None = None) -> dict[str, Any]:
    """Add runtime-v2 fields without discarding existing emotion, needs, or growth."""
    baseline = initial_life_runtime(mood=mood, relationship=relationship, now=now)
    if not value:
        return baseline
    result = json.loads(json.dumps(value))
    result["version"] = RUNTIME_VERSION
    for group in ("emotion", "needs", "growth"):
        merged = dict(baseline[group])
        merged.update(result.get(group) or {})
        result[group] = merged
    for key in ("active_desire_ids", "current_commitment_id", "queued_commitment_id", "last_simulated_at"):
        result.setdefault(key, baseline[key])
    return result


@dataclass(frozen=True)
class NpcLifeContext:
    player_id: str
    npc_id: str
    decision_key: str
    period: Period
    needs: Mapping[str, float]
    emotion: Mapping[str, float] = field(default_factory=dict)
    traits: tuple[str, ...] = ()
    interests: tuple[str, ...] = ()
    habits: tuple[str, ...] = ()
    goal_tags: tuple[str, ...] = ()
    current_location_id: str | None = None
    current_location_kind: str = "home"
    scheduled_kind: str = "free"
    nearby_resident_ids: tuple[str, ...] = ()
    resources: tuple[ResourceState, ...] = ()
    recent_action_types: tuple[str, ...] = ()
    rules_version: str = RULES_VERSION


@dataclass(frozen=True)
class ActionCandidate:
    action_type: str
    score: float
    reasons: tuple[str, ...]
    target_resource_id: str | None
    target_npc_id: str | None


@dataclass(frozen=True)
class ActionDecision:
    desire_id: str
    commitment_id: str
    decision_key: str
    selected: ActionCandidate
    ranked: tuple[ActionCandidate, ...]
    rules_version: str = RULES_VERSION

    def to_dict(self) -> dict[str, Any]:
        return {
            "desire_id": self.desire_id, "commitment_id": self.commitment_id,
            "decision_key": self.decision_key, "selected": asdict(self.selected),
            "ranked": [asdict(value) for value in self.ranked],
            "rules_version": self.rules_version,
        }


def _resource_target(template: ActionTemplate, context: NpcLifeContext) -> str | None:
    kinds = template.required_resource_kinds or template.optional_resource_kinds
    if not kinds:
        return None
    if (not template.required_resource_kinds and context.current_location_kind == "home"
            and stable_fraction(context.player_id, context.npc_id, context.decision_key,
                                template.type, "leave-home",
                                rules_version=context.rules_version) >= .58):
        return None
    candidates = [resource for resource in context.resources if resource.kind in kinds]
    if not candidates:
        return None
    # Residents normally remember opening hours instead of repeatedly walking
    # to a visibly closed venue.  A small, deterministic planning-mistake path
    # remains so ``facility_unavailable`` is still an organically reachable
    # fact (rather than content which only tests can manufacture).
    open_candidates = [
        resource for resource in candidates
        if not resource.state.get("open_periods")
        or context.period in {str(value) for value in resource.state.get("open_periods", ())}
    ]
    if open_candidates:
        candidates = open_candidates
    elif not template.required_resource_kinds:
        misses_hours = stable_fraction(
            context.player_id, context.npc_id, context.decision_key,
            template.type, "opening-hours-mistake", rules_version=context.rules_version,
        ) < .15
        if not misses_hours:
            return None
    themes = {value.casefold() for value in (*context.interests, *context.goal_tags)}

    def theme_rank(value: ResourceState) -> int:
        identity = f"{value.id} {value.location_id}".casefold()
        if (("music" in themes and "music" in identity)
                or ("fitness" in themes and ("gym" in identity or "fitness" in identity))
                or ({"art", "writing", "reading"} & themes
                    and ("library" in identity or "art" in identity))):
            return 0
        if "career" in themes and value.kind == "goal_space":
            return 1
        return 2

    candidates.sort(key=lambda value: (
        value.location_id != context.current_location_id,
        theme_rank(value),
        not value.available,
        len(value.reservations) >= value.capacity,
        value.id,
    ))
    best_rank = (
        candidates[0].location_id != context.current_location_id,
        theme_rank(candidates[0]),
        not candidates[0].available,
        len(candidates[0].reservations) >= candidates[0].capacity,
    )
    tied = [value for value in candidates if (
        value.location_id != context.current_location_id,
        theme_rank(value),
        not value.available,
        len(value.reservations) >= value.capacity,
    ) == best_rank]
    return tied[stable_number(context.player_id, context.npc_id, context.decision_key,
                              template.type, "resource", rules_version=context.rules_version) % len(tied)].id


def rank_life_actions(context: NpcLifeContext, catalog: LifeCatalog | None = None) -> tuple[ActionCandidate, ...]:
    source = catalog or load_life_catalog()
    traits = {value.casefold() for value in context.traits}
    interests = {value.casefold() for value in context.interests}
    habits = {value.casefold() for value in context.habits}
    goal_tags = {value.casefold() for value in context.goal_tags}
    candidates: list[ActionCandidate] = []
    for template in source.actions.values():
        if context.period not in template.allowed_periods:
            continue
        if template.requires_resident_target and not context.nearby_resident_ids:
            continue
        score = 8.0
        reasons: list[str] = []
        for need, weight in template.need_weights.items():
            pressure = max(0.0, 100.0 - float(context.needs.get(need, 55)))
            score += pressure * float(weight)
            if pressure >= 55:
                reasons.append(f"low_{need}")
        trait_matches = traits & set(template.trait_affinities)
        interest_matches = interests & set(template.interest_affinities)
        score += 8 * len(trait_matches) + 10 * len(interest_matches)
        if trait_matches:
            reasons.append("personality_fit")
        if interest_matches:
            reasons.append("interest_fit")
        if template.type in habits or set(template.collision_hooks) & habits:
            score += 16
            reasons.append("habit")
        if template.type == "practice_hobby" and goal_tags & interests:
            score += 14
            reasons.append("goal_relevance")
        if context.current_location_kind in template.preferred_location_kinds:
            score += 8
            reasons.append("location_fit")
        if context.period == "night" and template.type == "sleep":
            score += 48
            reasons.append("sleep_window")
        if context.period in {"morning", "evening"} and template.type in {"prepare_food", "eat"}:
            score += 12
        if (template.type == "seek_company" and not context.nearby_resident_ids
                and float(context.needs.get("social", 55)) <= 65):
            # An independently housed resident with no legitimate private-chat
            # target should go somewhere public to meet people instead of
            # magically selecting a stranger's home as a destination.
            score += min(26, (100 - float(context.needs.get("social", 55))) * .5)
            reasons.append("seek_public_company")
        if context.scheduled_kind not in {"", "free", "leisure"}:
            urgent = any(float(context.needs.get(need, 100)) < 22 for need in template.need_weights)
            schedule_aligned = (
                template.type == "practice_hobby"
                and "career" in goal_tags
            ) or (template.type == "read" and context.scheduled_kind == "study")
            if schedule_aligned:
                score += 18
                reasons.append("schedule_alignment")
            elif not urgent:
                score -= 24
                reasons.append("schedule_conflict")
        repetitions = context.recent_action_types.count(template.type)
        if repetitions:
            score -= 20 * repetitions
            reasons.append("recent_repetition")
        target_resource_id = _resource_target(template, context)
        if template.required_resource_kinds and not target_resource_id:
            score -= 18  # The desire may survive and seek a city alternative.
            reasons.append("resource_missing")
        target_npc_id = None
        if template.requires_resident_target:
            ordered = sorted(context.nearby_resident_ids)
            target_npc_id = ordered[stable_number(context.npc_id, context.decision_key, template.type,
                                                  rules_version=context.rules_version) % len(ordered)]
        score += stable_fraction(context.player_id, context.npc_id, context.decision_key,
                                 template.type, "variation", rules_version=context.rules_version) * 7
        candidates.append(ActionCandidate(template.type, round(score, 4), tuple(dict.fromkeys(reasons)),
                                          target_resource_id, target_npc_id))
    return tuple(sorted(candidates, key=lambda value: (-value.score, value.action_type)))


def select_life_action(context: NpcLifeContext, catalog: LifeCatalog | None = None) -> ActionDecision:
    ranked = rank_life_actions(context, catalog)
    if not ranked:
        raise ValueError("no eligible life actions")
    peak = ranked[0].score
    weights = [math.exp((candidate.score - peak) / ACTION_SELECTION_TEMPERATURE)
               for candidate in ranked]
    threshold = stable_fraction(
        context.player_id, context.npc_id, context.decision_key, "action-softmax",
        rules_version=context.rules_version,
    ) * sum(weights)
    selected = ranked[-1]
    cumulative = 0.0
    for candidate, weight in zip(ranked, weights):
        cumulative += weight
        if threshold <= cumulative:
            selected = candidate
            break
    desire_id = stable_id("desire", context.player_id, context.npc_id, context.decision_key,
                          selected.action_type, rules_version=context.rules_version)
    commitment_id = stable_id("commitment", desire_id, rules_version=context.rules_version)
    return ActionDecision(desire_id, commitment_id, context.decision_key, selected, ranked,
                          context.rules_version)


@dataclass(frozen=True)
class LifeAction:
    id: str
    player_id: str
    npc_id: str
    action_type: str
    status: ActionStatus
    desire_id: str
    commitment_id: str
    location_id: str | None
    target_resource_id: str | None
    target_npc_id: str | None
    planned_at: datetime
    duration_seconds: int
    interruptible: bool
    animation_cue: AnimationCue
    collision_hooks: tuple[str, ...]
    need_deltas: Mapping[str, int]
    emotion_deltas: Mapping[str, int]
    resource_deltas: Mapping[str, int]
    arrives_at: datetime | None = None
    started_at: datetime | None = None
    ends_at: datetime | None = None
    retry_at: datetime | None = None
    attempt: int = 0
    blocked_reason: str | None = None
    completed_at: datetime | None = None
    rules_version: str = RULES_VERSION

    def to_dict(self) -> dict[str, Any]:
        result = asdict(self)
        for key in ("planned_at", "arrives_at", "started_at", "ends_at", "retry_at", "completed_at"):
            result[key] = result[key].isoformat() if result[key] else None
        result["collision_hooks"] = list(self.collision_hooks)
        return result

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "LifeAction":
        status = str(value["status"])
        if status not in ACTION_STATUSES:
            raise ValueError(f"invalid life action status: {status}")
        return cls(
            str(value["id"]), str(value["player_id"]), str(value["npc_id"]), str(value["action_type"]),
            cast(ActionStatus, status), str(value["desire_id"]), str(value["commitment_id"]),
            value.get("location_id"), value.get("target_resource_id"), value.get("target_npc_id"),
            _parse_time(value.get("planned_at")) or datetime.fromtimestamp(0, timezone.utc),
            int(value["duration_seconds"]), bool(value.get("interruptible", True)),
            require_animation_cue(value.get("animation_cue"), field="life_action.animation_cue"),
            tuple(str(item) for item in value.get("collision_hooks", [])),
            dict(value.get("need_deltas", {})), dict(value.get("emotion_deltas", {})),
            dict(value.get("resource_deltas", {})), _parse_time(value.get("arrives_at")),
            _parse_time(value.get("started_at")), _parse_time(value.get("ends_at")),
            _parse_time(value.get("retry_at")), int(value.get("attempt", 0)),
            value.get("blocked_reason"), _parse_time(value.get("completed_at")),
            str(value.get("rules_version", RULES_VERSION)),
        )


@dataclass(frozen=True)
class ActionTransition:
    previous_status: ActionStatus
    action: LifeAction
    changed: bool
    completed: bool
    reason: str | None
    effects: Mapping[str, Mapping[str, int]]

    def to_dict(self) -> dict[str, Any]:
        return {"previous_status": self.previous_status, "action": self.action.to_dict(),
                "changed": self.changed, "completed": self.completed,
                "reason": self.reason, "effects": {key: dict(value) for key, value in self.effects.items()}}


def create_life_action(decision: ActionDecision, *, player_id: str, npc_id: str,
                       now: datetime, current_location_id: str | None,
                       target_location_id: str | None = None, travel_seconds: int = 0,
                       catalog: LifeCatalog | None = None) -> LifeAction:
    source = catalog or load_life_catalog()
    template = source.actions[decision.selected.action_type]
    moment = _utc(now)
    duration_range = template.duration_seconds
    duration = duration_range[0] + stable_number(
        decision.commitment_id, "duration", rules_version=decision.rules_version,
    ) % (duration_range[1] - duration_range[0] + 1)
    location = target_location_id or current_location_id
    travel = max(0, min(3600, int(travel_seconds)))
    arrives = moment + timedelta(seconds=travel) if travel and location != current_location_id else None
    action_id = stable_id("action", decision.commitment_id, rules_version=decision.rules_version)
    return LifeAction(
        action_id, player_id, npc_id, template.type, "planned", decision.desire_id,
        decision.commitment_id, location, decision.selected.target_resource_id,
        decision.selected.target_npc_id, moment, duration, template.interruptible,
        template.animation_cue, template.collision_hooks, dict(template.need_deltas),
        dict(template.emotion_deltas), dict(template.resource_deltas), arrives_at=arrives,
        rules_version=decision.rules_version,
    )


def _effects(action: LifeAction) -> dict[str, Mapping[str, int]]:
    return {"needs": dict(action.need_deltas), "emotion": dict(action.emotion_deltas),
            "resource": dict(action.resource_deltas)}


def _perform(action: LifeAction, start: datetime) -> LifeAction:
    begins = _utc(start)
    return replace(action, status="performing", started_at=begins,
                   ends_at=begins + timedelta(seconds=action.duration_seconds),
                   retry_at=None, blocked_reason=None)


def advance_life_action(action: LifeAction, *, now: datetime,
                        resource_outcome: ReservationOutcome = "acquired",
                        interruption_reason: str | None = None) -> ActionTransition:
    """Advance one action without reading or mutating external state.

    The caller reserves the target resource first and passes that result here.
    Completion effects are emitted only on the transition into ``completed``.
    """
    current = _utc(now)
    previous = action.status
    empty: Mapping[str, Mapping[str, int]] = {"needs": {}, "emotion": {}, "resource": {}}
    if action.status in TERMINAL_ACTION_STATUSES:
        return ActionTransition(previous, action, False, action.status == "completed", None, empty)
    if interruption_reason and action.interruptible:
        updated = replace(action, status="interrupted", blocked_reason=interruption_reason)
        return ActionTransition(previous, updated, True, False, interruption_reason, empty)

    updated = action
    reason: str | None = None
    if updated.status == "planned":
        if updated.arrives_at and current < updated.arrives_at:
            updated = replace(updated, status="traveling")
            reason = "journey_started"
        elif updated.target_resource_id and resource_outcome != "acquired":
            retry_delay = 20 + stable_number(updated.id, updated.attempt, "retry",
                                             rules_version=updated.rules_version) % 41
            updated = replace(updated, status="blocked", blocked_reason=resource_outcome,
                              retry_at=current + timedelta(seconds=retry_delay))
            reason = resource_outcome
        else:
            updated = _perform(updated, updated.arrives_at or current)
            reason = "performance_started"
    if updated.status == "traveling" and updated.arrives_at and current >= updated.arrives_at:
        if updated.target_resource_id and resource_outcome != "acquired":
            retry_delay = 20 + stable_number(updated.id, updated.attempt, "retry",
                                             rules_version=updated.rules_version) % 41
            updated = replace(updated, status="blocked", blocked_reason=resource_outcome,
                              retry_at=current + timedelta(seconds=retry_delay))
            reason = resource_outcome
        else:
            updated = _perform(updated, updated.arrives_at)
            reason = "arrived"
    elif updated.status == "blocked" and updated.retry_at and current >= updated.retry_at:
        updated = replace(updated, status="retrying", attempt=updated.attempt + 1)
        reason = "retry_due"
    elif updated.status == "retrying":
        if resource_outcome == "acquired":
            updated = _perform(updated, current)
            reason = "resource_acquired"
        else:
            retry_delay = 20 + stable_number(updated.id, updated.attempt, "retry",
                                             rules_version=updated.rules_version) % 41
            updated = replace(updated, status="blocked", blocked_reason=resource_outcome,
                              retry_at=current + timedelta(seconds=retry_delay))
            reason = resource_outcome

    if updated.status == "performing" and updated.ends_at and current >= updated.ends_at:
        completed = replace(updated, status="completed", completed_at=updated.ends_at)
        return ActionTransition(previous, completed, completed != action, True, "completed", _effects(completed))
    return ActionTransition(previous, updated, updated != action, False, reason, empty)


def apply_action_effects(runtime: Mapping[str, Any], transition: ActionTransition) -> dict[str, Any]:
    """Apply a newly completed transition to a runtime snapshot.

    Persistence must guard the action's completed transition; this pure helper
    intentionally does not keep a second effect ledger.
    """
    result = normalize_runtime_v2(runtime)
    if not transition.completed or transition.previous_status == "completed":
        return result
    for group in ("needs", "emotion"):
        values = result.setdefault(group, {})
        for key, delta in transition.effects.get(group, {}).items():
            values[key] = clamp(float(values.get(key, 50)) + float(delta))
    result["current_commitment_id"] = None
    result["active_desire_ids"] = [value for value in result.get("active_desire_ids", [])
                                    if value != transition.action.desire_id]
    result["last_simulated_at"] = (transition.action.completed_at or transition.action.ends_at
                                    or transition.action.planned_at).isoformat()
    return result


def action_visible_intent(action: LifeAction) -> str:
    labels = {
        "prepare_food": "Preparing food", "eat": "Eating", "sleep": "Sleeping",
        "shower": "Using the bathroom", "use_television": "Watching television",
        "read": "Reading", "practice_hobby": "Practicing a hobby",
        "clean_shared_space": "Cleaning a shared space",
        "leave_dishes": "Leaving the kitchen", "rest_alone": "Taking some quiet time",
        "seek_company": "Looking for company", "talk_to_resident": "Talking with someone",
    }
    return labels.get(action.action_type, action.action_type.replace("_", " ").title())
