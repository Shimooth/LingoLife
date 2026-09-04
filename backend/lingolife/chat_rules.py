"""Rule-owned settlement for a player-to-resident conversation.

The dialogue model may describe what the player expressed and provide bounded
language evidence.  It must not choose relationship, mood, or XP numbers.  This
module is deliberately provider-free so the same semantic facts always settle
the same way when DeepSeek is unavailable, retried, or replaced.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Sequence


SEMANTIC_RELATIONSHIP_WEIGHTS: Mapping[str, int] = {
    "accept": 1,
    "advice": 0,
    "apology": 2,
    "celebration": 1,
    "curiosity": 1,
    "decline": 0,
    "empathy": 2,
    "encouragement": 1,
    "honesty": 1,
    "practical_help": 2,
    "reassurance": 1,
}

SEMANTIC_MOOD_WEIGHTS: Mapping[str, int] = {
    "accept": 1,
    "advice": 0,
    "apology": 1,
    "celebration": 3,
    "curiosity": 0,
    "decline": -1,
    "empathy": 1,
    "encouragement": 2,
    "honesty": 0,
    "practical_help": 1,
    "reassurance": 2,
}


@dataclass(frozen=True)
class ChatRuleSettlement:
    relationship_change: int
    mood_change: int
    english_xp_change: int
    reasons: tuple[str, ...]


def _understandable(feedback: object) -> bool:
    if isinstance(feedback, Mapping):
        return bool(feedback.get("is_understandable"))
    return bool(getattr(feedback, "is_understandable", False))


def _evidence_value(evidence: object, key: str, fallback: object = None) -> object:
    if isinstance(evidence, Mapping):
        return evidence.get(key, fallback)
    return getattr(evidence, key, fallback)


def settle_chat_semantics(
    *,
    semantic_signals: Sequence[str],
    english_feedback: object,
    learning_evidence: Sequence[object],
) -> ChatRuleSettlement:
    """Convert bounded semantic evidence into authoritative gameplay numbers.

    English correctness never gates warmth or relationship progress.  If the
    player's meaning is understandable, empathy still counts even when the
    evaluator also reports a grammar error.  XP, by contrast, is derived only
    from understandable language and unique, schema-approved learning targets.
    """

    signals = tuple(dict.fromkeys(
        value for value in (str(item) for item in semantic_signals)
        if value in SEMANTIC_RELATIONSHIP_WEIGHTS
    ))
    understandable = _understandable(english_feedback)

    relationship = sum(SEMANTIC_RELATIONSHIP_WEIGHTS[value] for value in signals)
    mood = sum(SEMANTIC_MOOD_WEIGHTS[value] for value in signals)

    # Multiple labels can describe one caring intent.  Caps keep a verbose
    # analyzer from turning one message into a large stat jump.
    relationship = max(-5, min(5, relationship))
    mood = max(-5, min(5, mood))

    outcomes_by_target: dict[str, str] = {}
    outcome_priority = {"exposure": 1, "error": 2, "success": 3}
    for evidence in learning_evidence:
        target = str(_evidence_value(evidence, "target_id", ""))
        outcome = str(_evidence_value(evidence, "outcome", ""))
        if not target or outcome not in outcome_priority:
            continue
        previous = outcomes_by_target.get(target)
        if previous is None or outcome_priority[outcome] > outcome_priority[previous]:
            outcomes_by_target[target] = outcome

    if not understandable:
        xp = 0
    else:
        successes = sum(value == "success" for value in outcomes_by_target.values())
        exposures = sum(value == "exposure" for value in outcomes_by_target.values())
        errors = sum(value == "error" for value in outcomes_by_target.values())
        xp = max(1, min(5, 1 + successes * 2 + exposures - errors))

    reasons = tuple(
        [f"semantic:{value}" for value in signals]
        + [f"learning:{target}:{outcome}" for target, outcome in sorted(outcomes_by_target.items())]
        + (["english:understandable"] if understandable else ["english:not_understandable"])
    )
    return ChatRuleSettlement(relationship, mood, xp, reasons)
