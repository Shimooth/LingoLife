"""Deterministic Trouble Signal disclosure policy.

An Incident can exist without becoming a player-facing task marker.  This
module decides *who*, if anyone, is willing to expose a problem to the player
from persisted facts.  It has no provider dependency and never changes the
Incident outcome.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from .agent import compile_persona
from .life import stable_fraction
from .relationships import RelationshipPair


@dataclass(frozen=True)
class DisclosureDecision:
    player_visible_npc_ids: tuple[str, ...]
    resident_confidants: Mapping[str, str]
    hidden_npc_ids: tuple[str, ...]

    @property
    def player_visible(self) -> bool:
        return bool(self.player_visible_npc_ids)


def _pair_key(first: str, second: str) -> str:
    return ":".join(sorted((first, second)))


def _edge(
    relationships: Mapping[str, Mapping[str, Any]], owner: str, target: str,
) -> tuple[int, int]:
    raw = relationships.get(_pair_key(owner, target))
    if not raw:
        return 0, 0
    try:
        edge = RelationshipPair.from_dict(raw).edge(owner, target)
        return int(edge.trust), int(edge.comfort)
    except (KeyError, TypeError, ValueError):
        return 0, 0


def _ordinary_boundary_pressure(profile: Mapping[str, Any]) -> int:
    text = " ".join(str(value).casefold() for value in profile.get("boundaries") or ())
    guarded_terms = (
        "private", "privacy", "secret", "space", "pressure", "personal",
        "隐私", "秘密", "空间", "独处", "逼迫",
    )
    return min(18, sum(term in text for term in guarded_terms) * 5)


def decide_trouble_disclosure(
    *,
    participant_ids: Sequence[str],
    profiles: Mapping[str, Mapping[str, Any]],
    residents: Mapping[str, Mapping[str, Any]],
    relationships: Mapping[str, Mapping[str, Any]],
    severity: int,
    story_key: str,
) -> DisclosureDecision:
    """Resolve player disclosure and resident-only confidants from world facts.

    ``player_connection`` is intentionally small and local to each resident.
    It is advanced by committed player conversations, so refreshing or asking
    an LLM cannot reroll this decision.  If somebody has a substantially more
    trusted housemate, a selective/guarded resident may tell that person rather
    than raising a Trouble Signal for the player.
    """

    visible: list[str] = []
    hidden: list[str] = []
    confidants: dict[str, str] = {}
    cast = tuple(dict.fromkeys(str(value) for value in participant_ids if value in profiles))
    urgency = max(0, min(100, int(severity)))

    for npc_id in cast:
        profile = profiles[npc_id]
        persona = compile_persona(profile)
        behavior = persona.get("behavior") or {}
        disclosure_style = str(behavior.get("disclosure_style") or "selective")
        pride = str(behavior.get("pride") or "moderate")
        resident = residents.get(npc_id) or {}
        connection = resident.get("player_connection") or {}
        player_trust = max(0, min(100, int(connection.get("trust", 30))))
        player_familiarity = max(0, min(100, int(connection.get("familiarity", 20))))
        stress = max(0, min(100, int(
            ((resident.get("runtime") or {}).get("emotion") or {}).get("stress", 38)
        )))

        other_ids = [other for other in profiles if other != npc_id]
        ranked_confidants = sorted(
            ((*_edge(relationships, npc_id, other), other) for other in other_ids),
            key=lambda value: (value[0] + value[1], value[0], value[1], value[2]),
            reverse=True,
        )
        best_trust, best_comfort, best_other = ranked_confidants[0] if ranked_confidants else (0, 0, "")
        has_natural_confidant = best_trust >= 60 and best_comfort >= 55

        score = (
            urgency * .42
            + player_trust * .31
            + player_familiarity * .12
            + stress * .08
            + {"open": 18, "selective": 0, "guarded": -20}.get(disclosure_style, 0)
            + {"low": 5, "moderate": 0, "high": -12}.get(pride, 0)
            - _ordinary_boundary_pressure(profile)
            - (10 if has_natural_confidant and disclosure_style != "open" else 0)
            + (stable_fraction(story_key, npc_id, "trouble-disclosure") - .5) * 14
        )
        threshold = 54 if urgency >= 70 else 60
        if score >= threshold:
            visible.append(npc_id)
        elif has_natural_confidant:
            confidants[npc_id] = best_other
        else:
            hidden.append(npc_id)

    return DisclosureDecision(tuple(visible), confidants, tuple(hidden))
