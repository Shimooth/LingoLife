from __future__ import annotations

from typing import Literal, cast, get_args


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

ANIMATION_CUES = frozenset(get_args(AnimationCue))
_NEUTRAL_TURN_CUES = frozenset({"idle", "talk", "listen"})


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
