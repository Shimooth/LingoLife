"""Public, player-editable NPC profile contract and cast-level safeguards.

The database deliberately stores profile JSON instead of one column per field.
Keeping legacy normalization here makes old saves acquire deterministic defaults
at the read boundary without rewriting (or randomising) established characters.
"""

from __future__ import annotations

import hashlib
import re
from typing import Any, Mapping, Sequence


HOUSEHOLD_ROLES = (
    "organizer", "caretaker", "mediator", "cook", "fixer", "free_spirit",
)
CHORE_PREFERENCES = (
    "cooking", "dishes", "cleaning", "shopping", "repairs", "laundry",
)
PRIVATE_SPACE_PREFERENCES = ("low", "balanced", "high")
ONBOARDING_STATE_VERSION = 2
CURRENT_INTRO_VERSION = 1

_DEFAULT_DISLIKES = (
    "being rushed", "unnecessary noise", "broken promises", "clutter",
    "awkward silence", "wasted food",
)
_DEFAULT_QUIRKS = (
    "straightens objects when thinking", "collects favorite mugs",
    "hums without noticing", "double-checks the door",
    "gives objects little nicknames", "takes unusually detailed notes",
)
_DEFAULT_HABITS = (
    "read before sleep", "prepare breakfast early", "clean on weekend mornings",
    "take an evening walk", "make tea after work", "check in with housemates",
)
_DEFAULT_BOUNDARIES = (
    "ask before borrowing personal things", "knock before entering private space",
    "do not share secrets without permission", "give space during conflict",
    "do not pressure romantic decisions", "discuss shared spending first",
)


def _stable_index(profile: Mapping[str, Any], namespace: str, length: int) -> int:
    identity = "\x1f".join((
        str(profile.get("name") or "resident"),
        str(profile.get("occupation") or ""),
        "|".join(str(value) for value in profile.get("personality") or ()),
        namespace,
    ))
    return int.from_bytes(hashlib.sha256(identity.encode("utf-8")).digest()[:8], "big") % length


def _clean_list(value: object, *, maximum: int) -> list[str]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        return []
    result: list[str] = []
    seen: set[str] = set()
    for raw in value:
        item = " ".join(str(raw).split())
        key = item.casefold()
        if not item or key in seen:
            continue
        result.append(item[:80])
        seen.add(key)
        if len(result) >= maximum:
            break
    return result


def normalize_profile_contract(profile: Mapping[str, Any]) -> dict[str, Any]:
    """Return a full contract while preserving every pre-existing JSON field.

    Missing defaults are derived solely from persisted public identity fields;
    therefore the same legacy save receives the same contract across workers,
    refreshes and deployments. Explicit valid values always win.
    """
    result = dict(profile)
    # New structured social facts are explicit empty lists for legacy saves.
    # We never infer a family role or fabricate a shared memory from an old
    # untyped ``familyIds`` entry.
    if not isinstance(result.get("familyRelations"), list):
        result["familyRelations"] = []
    if not isinstance(result.get("shared_history_hooks"), list):
        result["shared_history_hooks"] = []
    interests = _clean_list(result.get("interests"), maximum=5)
    likes = _clean_list(result.get("likes"), maximum=6)
    if not likes:
        likes = interests[:3] or ["shared meals"]
    result["likes"] = likes

    for key, pool, maximum in (
        ("dislikes", _DEFAULT_DISLIKES, 6),
        ("quirks", _DEFAULT_QUIRKS, 4),
        ("habits", _DEFAULT_HABITS, 4),
    ):
        values = _clean_list(result.get(key), maximum=maximum)
        if not values:
            values = [pool[_stable_index(result, key, len(pool))]]
        result[key] = values

    legacy_boundaries = _clean_list(result.get("relationshipBoundaries"), maximum=8)
    boundaries = _clean_list(result.get("boundaries"), maximum=8)
    if not boundaries:
        ordinary_legacy = [value for value in legacy_boundaries
                           if value.casefold() not in {"no_romance", "no-romance", "aromantic"}]
        # Relationship policy flags remain available under their legacy key;
        # add one ordinary-life boundary so the public contract is complete.
        boundaries = ordinary_legacy or [
            _DEFAULT_BOUNDARIES[_stable_index(result, "boundaries", len(_DEFAULT_BOUNDARIES))]
        ]
    for value in boundaries:
        if (value.casefold() in {"no_romance", "no-romance", "aromantic"}
                and value.casefold() not in {item.casefold() for item in legacy_boundaries}):
            legacy_boundaries.append(value)
    result["boundaries"] = boundaries
    result["relationshipBoundaries"] = legacy_boundaries

    role = str(result.get("householdRole") or "").strip()
    if role not in HOUSEHOLD_ROLES:
        role = HOUSEHOLD_ROLES[_stable_index(result, "household-role", len(HOUSEHOLD_ROLES))]
    result["householdRole"] = role

    chores = _clean_list(result.get("chorePreferences"), maximum=3)
    chores = [value for value in chores if value in CHORE_PREFERENCES]
    if not chores:
        start = _stable_index(result, "chores", len(CHORE_PREFERENCES))
        chores = [CHORE_PREFERENCES[start], CHORE_PREFERENCES[(start + 2) % len(CHORE_PREFERENCES)]]
    result["chorePreferences"] = chores

    privacy = str(result.get("privateSpacePreference") or "").strip()
    if privacy not in PRIVATE_SPACE_PREFERENCES:
        privacy = PRIVATE_SPACE_PREFERENCES[
            _stable_index(result, "private-space", len(PRIVATE_SPACE_PREFERENCES))
        ]
    result["privateSpacePreference"] = privacy
    return result


def _tokens(values: object) -> set[str]:
    if not isinstance(values, Sequence) or isinstance(values, (str, bytes)):
        return set()
    return {
        token.casefold()
        for value in values
        for token in re.findall(r"[\w'-]+", str(value), flags=re.UNICODE)
        if token
    }


def _schedule_style(profile: Mapping[str, Any]) -> str:
    occupation = str(profile.get("occupation") or "").casefold()
    groups = (
        ("care", ("doctor", "nurse", "paramedic", "therap", "teacher", "librar")),
        ("creative", ("design", "artist", "music", "dance", "journal", "writer", "photo")),
        ("technical", ("engineer", "develop", "robot", "scient", "architect")),
        ("hospitality", ("barista", "baker", "cook", "chef", "shop")),
    )
    group = next((name for name, words in groups if any(word in occupation for word in words)), "general")
    # Exact occupation is a public schedule cause too: two creative residents
    # can still have clearly different working hours and destinations.
    return f"{group}:{' '.join(occupation.split())}"


def roster_difference_report(profiles: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """Explain whether a proposed household will yield recognisably different Agents.

    We intentionally compare public causes, never relationship outcomes. A pair
    must differ across at least three causes, while the whole cast must include
    variation in every major design category.
    """
    normalized = [normalize_profile_contract(profile) for profile in profiles]
    dimensions: list[tuple[str, list[object]]] = [
        ("personality", [_tokens(profile.get("personality")) for profile in normalized]),
        ("interests", [_tokens((*profile.get("interests", ()), *profile.get("likes", ()))) for profile in normalized]),
        ("schedule", [_schedule_style(profile) for profile in normalized]),
        ("chores", [(profile["householdRole"], tuple(profile["chorePreferences"])) for profile in normalized]),
        ("social_style", [(profile["privateSpacePreference"], tuple(profile["boundaries"]),
                           tuple(profile["habits"])) for profile in normalized]),
    ]

    category_variation = {
        name: len({repr(value) for value in values}) > 1
        for name, values in dimensions
    }
    too_similar: list[list[str]] = []
    for index, first in enumerate(normalized):
        for second_index in range(index + 1, len(normalized)):
            distinct = sum(
                dimensions[dimension_index][1][index] != dimensions[dimension_index][1][second_index]
                for dimension_index in range(len(dimensions))
            )
            if distinct < 3:
                too_similar.append([
                    str(first.get("name") or index + 1),
                    str(normalized[second_index].get("name") or second_index + 1),
                ])
    missing = [name for name, varied in category_variation.items() if not varied]
    return {
        "valid": not missing and not too_similar,
        "category_variation": category_variation,
        "missing_categories": missing,
        "too_similar_pairs": too_similar,
    }
