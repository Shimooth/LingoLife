from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from typing import Literal, Mapping, Sequence, cast, get_args


# Gameplay speaks in semantic cues instead of asset clip names. Each character
# renderer owns the final cue -> clip/fallback mapping for its model family.
AnimationCue = Literal[
    "idle",
    "talk",
    "listen",
    "happy",
    "sad",
    "tired",
    "look_around",
    "walk",
    "run",
    "jump",
    "crouch",
    "push",
]
LegacyAnimation = Literal["idle", "sad", "happy"]
PerformanceRole = Literal[
    "establish",
    "react",
    "speak",
    "listen",
    "action",
    "resolve",
    "hold",
]
PerformanceFacing = Literal["player", "camera", "target", "movement", "free"]

ANIMATION_CUES = frozenset(get_args(AnimationCue))
PERFORMANCE_ROLES = frozenset(get_args(PerformanceRole))
PERFORMANCE_FACINGS = frozenset(get_args(PerformanceFacing))
_NEUTRAL_TURN_CUES = frozenset({"idle", "talk", "listen"})


@dataclass(frozen=True)
class AnimationBeat:
    """One semantic beat in an asset-independent NPC performance."""

    cue: AnimationCue
    role: PerformanceRole
    duration_ms: int
    loop: bool
    transition_ms: int
    facing: PerformanceFacing
    energy: float


@dataclass(frozen=True)
class AnimationPerformance:
    """A short directed sequence; clients hold ``hold_cue`` after it ends."""

    beats: tuple[AnimationBeat, ...]
    hold_cue: AnimationCue = "idle"
    version: int = 1


_CUE_DEFAULTS: dict[AnimationCue, tuple[int, bool, PerformanceFacing, float]] = {
    "idle": (1800, True, "free", .18),
    "talk": (4600, True, "player", .48),
    "listen": (3000, True, "player", .28),
    "happy": (3200, False, "player", .78),
    "sad": (2600, True, "player", .22),
    "tired": (3000, True, "free", .12),
    "look_around": (2200, True, "target", .38),
    "walk": (2600, True, "movement", .52),
    "run": (1900, True, "movement", .88),
    "jump": (3200, False, "camera", .95),
    "crouch": (2300, False, "target", .35),
    "push": (1700, False, "target", .72),
}


def _role_for(cue: AnimationCue) -> PerformanceRole:
    if cue == "talk":
        return "speak"
    if cue == "listen":
        return "listen"
    if cue in {"walk", "run", "crouch", "push"}:
        return "action"
    if cue in {"happy", "sad", "tired", "jump"}:
        return "react"
    return "establish"


def _default_beat(cue: AnimationCue, role: PerformanceRole | None = None) -> AnimationBeat:
    duration, loop, facing, energy = _CUE_DEFAULTS[cue]
    return AnimationBeat(cue, role or _role_for(cue), duration, loop, 280, facing, energy)


def stage_performance(cue: object) -> AnimationPerformance:
    """Expand an authored stage cue into action, speech and listening beats."""
    primary = animation_cue(cue, "talk")
    beats: list[AnimationBeat] = []
    if primary != "talk":
        beats.append(_default_beat(primary))
    beats.append(_default_beat("talk"))
    if primary != "listen":
        beats.append(_default_beat("listen"))
    return AnimationPerformance(tuple(beats), "listen")


def outcome_performance(cue: object) -> AnimationPerformance:
    """Resolve a story with an expressive/action beat and a calm hold."""
    primary = animation_cue(cue, "idle")
    resolved = _default_beat(primary, "resolve")
    if primary == "idle":
        return AnimationPerformance((resolved,), "idle")
    return AnimationPerformance((resolved, _default_beat("idle", "hold")), "idle")


def ambient_performance(cue: object) -> AnimationPerformance:
    """Create finite in-place map choreography without speech or locomotion."""
    primary = animation_cue(cue, "idle")
    if primary in {"talk", "listen", "walk", "run"}:
        primary = "look_around"
    first = _default_beat(primary)
    if primary == "idle":
        return AnimationPerformance((first,), "idle")
    return AnimationPerformance((first, _default_beat("idle", "hold")), "idle")


def encounter_performance(cue: object) -> AnimationPerformance:
    """Direct co-located residents to react, speak and listen to each other."""
    primary = animation_cue(cue, "talk")
    beats: list[AnimationBeat] = []
    if primary != "talk":
        beats.append(_default_beat(primary))
    beats.append(_default_beat("talk"))
    if primary != "listen":
        beats.append(_default_beat("listen"))
    targeted = tuple(AnimationBeat(beat.cue, beat.role, beat.duration_ms, beat.loop,
                                   beat.transition_ms, "target", beat.energy)
                     for beat in beats)
    return AnimationPerformance(targeted, "listen")


def journey_performance(cue: object = "walk") -> AnimationPerformance:
    """Keep locomotion active until the authoritative journey state changes."""
    movement = animation_cue(cue, "walk")
    if movement not in {"walk", "run"}:
        movement = "walk"
    return AnimationPerformance((_default_beat(movement, "action"),), movement)


def performance_to_dict(performance: AnimationPerformance) -> dict:
    """Return the stable JSON contract consumed by web animation directors."""
    return {
        "version": performance.version,
        "hold_cue": performance.hold_cue,
        "beats": [asdict(beat) for beat in performance.beats],
    }


def require_animation_performance(
    value: object,
    *,
    fallback_cue: AnimationCue,
    kind: Literal["stage", "outcome"] = "stage",
    field: str = "performance",
) -> AnimationPerformance:
    """Validate optional authored choreography and synthesize legacy content.

    Authoring accepts either a beat list or ``{beats, hold_cue}``. Persisted
    events do not store the plan, so changing safe timing metadata does not
    require a database migration.
    """
    if value is None:
        return stage_performance(fallback_cue) if kind == "stage" else outcome_performance(fallback_cue)
    supplied: object = value
    hold_value: object = "listen" if kind == "stage" else "idle"
    if isinstance(value, Mapping):
        supplied = value.get("beats")
        hold_value = value.get("hold_cue", hold_value)
    if not isinstance(supplied, Sequence) or isinstance(supplied, (str, bytes)) or not supplied:
        raise ValueError(f"invalid {field}: expected one or more beats")
    beats: list[AnimationBeat] = []
    for index, raw in enumerate(supplied):
        if not isinstance(raw, Mapping):
            raise ValueError(f"invalid {field}.beats[{index}]: expected an object")
        cue = require_animation_cue(raw.get("cue"), field=f"{field}.beats[{index}].cue")
        defaults = _default_beat(cue)
        role = raw.get("role", defaults.role)
        facing = raw.get("facing", defaults.facing)
        duration = raw.get("duration_ms", defaults.duration_ms)
        transition = raw.get("transition_ms", defaults.transition_ms)
        loop = raw.get("loop", defaults.loop)
        energy = raw.get("energy", defaults.energy)
        if role not in PERFORMANCE_ROLES:
            raise ValueError(f"invalid {field}.beats[{index}].role: {role!r}")
        if facing not in PERFORMANCE_FACINGS:
            raise ValueError(f"invalid {field}.beats[{index}].facing: {facing!r}")
        if not isinstance(duration, int) or isinstance(duration, bool) or not 450 <= duration <= 12000:
            raise ValueError(f"invalid {field}.beats[{index}].duration_ms: {duration!r}")
        if not isinstance(transition, int) or isinstance(transition, bool) or not 0 <= transition <= 1500:
            raise ValueError(f"invalid {field}.beats[{index}].transition_ms: {transition!r}")
        if not isinstance(loop, bool):
            raise ValueError(f"invalid {field}.beats[{index}].loop: {loop!r}")
        if (not isinstance(energy, (int, float)) or isinstance(energy, bool)
                or not math.isfinite(float(energy)) or not 0 <= float(energy) <= 1):
            raise ValueError(f"invalid {field}.beats[{index}].energy: {energy!r}")
        beats.append(AnimationBeat(cue, cast(PerformanceRole, role), duration, loop, transition,
                                   cast(PerformanceFacing, facing), round(float(energy), 3)))
    hold_cue = require_animation_cue(hold_value, field=f"{field}.hold_cue")
    return AnimationPerformance(tuple(beats), hold_cue)


def require_animation_cue(value: object, *, field: str = "animation_cue") -> AnimationCue:
    """Validate authored/generated content at its trust boundary."""
    if not isinstance(value, str) or value not in ANIMATION_CUES:
        raise ValueError(f"invalid {field}: {value!r}")
    return cast(AnimationCue, value)


def animation_cue(value: object, fallback: AnimationCue = "idle") -> AnimationCue:
    """Coerce legacy persisted/API values without ever leaking a new clip name."""
    return cast(AnimationCue, value) if isinstance(value, str) and value in ANIMATION_CUES else fallback


def state_animation_cue(mood: int | float, energy: int | float | None = None) -> AnimationCue:
    if energy is not None and energy < 25:
        return "tired"
    if mood < 40:
        return "sad"
    if mood >= 60:
        return "happy"
    return "idle"


def legacy_animation_for(cue: object) -> LegacyAnimation:
    """Keep old clients functional while richer clients consume animation_cue."""
    normalized = animation_cue(cue)
    if normalized in {"happy", "jump"}:
        return "happy"
    if normalized in {"sad", "tired"}:
        return "sad"
    return "idle"


def resolve_turn_animation(
    requested: object,
    mood_change: int | float,
    *,
    event_cue: object | None = None,
    outcome_cue: object | None = None,
) -> AnimationCue:
    """Rules select the final cue; an LLM can only request a catalog member.

    Authored event action beats have priority. Otherwise an expressive AI cue
    wins, followed by the deterministic mood delta and neutral talk/listen cues.
    """
    requested_cue = animation_cue(requested, "talk")
    for candidate in (outcome_cue, event_cue):
        if candidate is not None:
            normalized = animation_cue(candidate, "talk")
            if normalized not in _NEUTRAL_TURN_CUES:
                return normalized
    if requested_cue not in _NEUTRAL_TURN_CUES:
        return requested_cue
    if mood_change > 0:
        return "happy"
    if mood_change < 0:
        return "sad"
    if event_cue is not None:
        return animation_cue(event_cue, requested_cue)
    return requested_cue
