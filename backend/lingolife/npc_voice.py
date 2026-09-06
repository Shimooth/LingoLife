"""Shared, deterministic voice selection. It never decides an NPC's action."""
from __future__ import annotations

import math
from typing import Any, Mapping

from .agent import compile_persona


def voice_mode(profile: Mapping[str, Any], topic: str = "") -> str:
    raw = profile.get("axes") or profile.get("persona_axes")
    axes = raw if isinstance(raw, Mapping) else compile_persona(profile).get("axes", {})

    def number(key: str, default: float) -> float:
        try:
            value = float(axes.get(key, default))
        except (TypeError, ValueError):
            return default
        return value if math.isfinite(value) else default

    if number("humor", 40) >= 65:
        return "playful"
    if number("assertiveness", 50) >= 70:
        return "direct"
    if number("extraversion", 50) <= 37:
        return "reserved"
    if number("warmth", 55) >= 70:
        return "warm"
    return "measured"
