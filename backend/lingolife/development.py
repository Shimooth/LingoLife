"""Rule-owned, evidence-backed resident development.

The life simulator already records concrete actions and story settlements.  This
module turns those facts into deliberately slow progress without letting prose,
an LLM response, or a page refresh directly rewrite a resident's personality.
Every mutation is idempotent and keeps its source provenance.
"""

from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Literal, Mapping, Sequence

from .agent import compile_goal


DEVELOPMENT_VERSION = "resident-development-v1"
MAX_DEVELOPMENT_EVIDENCE = 600
GrowthSource = Literal["life_action", "story_thread"]
GrowthKind = Literal[
    "goal_practice",
    "habit_practice",
    "completed_commitment",
    "social_cooperation",
    "relationship_repair",
    "boundary_practice",
    "setback_reflection",
]


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _stable_id(*parts: object) -> str:
    payload = "\x1f".join(str(part) for part in parts)
    return "growth-" + hashlib.sha256(payload.encode()).hexdigest()[:24]


def _fingerprint(value: Mapping[str, Any]) -> str:
    payload = {key: item for key, item in value.items() if key != "fingerprint"}
    return hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def _band(value: float, labels: tuple[str, str, str, str]) -> str:
    return labels[0] if value < 25 else labels[1] if value < 50 else labels[2] if value < 75 else labels[3]


@dataclass(frozen=True)
class DevelopmentEvidence:
    id: str
    npc_id: str
    source: GrowthSource
    source_id: str
    kind: GrowthKind
    occurred_at: str
    action_type: str | None = None
    habit_id: str | None = None
    thread_id: str | None = None
    outcome: str = "completed"
    weight: float = 1.0

    def to_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value["fingerprint"] = _fingerprint(value)
        return value


def initial_development(profile: Mapping[str, Any]) -> dict[str, Any]:
    """Compile the persistent development ledger from the public profile."""
    habits = [str(value).strip() for value in profile.get("habits", ()) if str(value).strip()]
    return {
        "version": DEVELOPMENT_VERSION,
        "goal": compile_goal(profile),
        "habits": [
            {
                "id": _stable_id("habit", label.casefold()),
                "label": label,
                "practice_count": 0,
                "strength": 20.0,
                "last_practiced_at": None,
            }
            for label in habits
        ],
        "confidence": {"value": 50.0, "successful_commitments": 0, "setbacks": 0},
        "relationship_strategies": {
            "cooperation": 0.0,
            "repair": 0.0,
            "boundary_setting": 0.0,
            "reflection": 0.0,
        },
        "applied_evidence": {},
    }


def normalize_development(value: Mapping[str, Any] | None,
                          profile: Mapping[str, Any]) -> dict[str, Any]:
    baseline = initial_development(profile)
    if not isinstance(value, Mapping):
        return baseline
    result = deepcopy(dict(value))
    result["version"] = DEVELOPMENT_VERSION
    stored_goal = result.get("goal")
    expected_title = baseline["goal"]["title"]
    profile_declares_goal = bool(str(profile.get("longTermGoal") or "").strip())
    if (not isinstance(stored_goal, Mapping)
            or (profile_declares_goal and stored_goal.get("title") != expected_title)):
        # Editing a goal starts a new goal track, but does not erase the
        # evidence ledger or unrelated habits/confidence.
        result["goal"] = baseline["goal"]
    result.setdefault("habits", baseline["habits"])
    known = {str(item.get("label", "")).casefold(): item for item in result["habits"]
             if isinstance(item, Mapping)}
    for habit in baseline["habits"]:
        known.setdefault(str(habit["label"]).casefold(), habit)
    result["habits"] = [deepcopy(known[key]) for key in sorted(known)]
    confidence = dict(result.get("confidence") or {})
    result["confidence"] = {
        "value": max(0.0, min(100.0, float(confidence.get("value", 50)))),
        "successful_commitments": max(0, int(confidence.get("successful_commitments", 0))),
        "setbacks": max(0, int(confidence.get("setbacks", 0))),
    }
    strategies = dict(baseline["relationship_strategies"])
    strategies.update(result.get("relationship_strategies") or {})
    result["relationship_strategies"] = {
        key: max(0.0, min(100.0, float(strategies[key]))) for key in strategies
    }
    applied = result.get("applied_evidence")
    result["applied_evidence"] = dict(applied) if isinstance(applied, Mapping) else {}
    return result


def personality_growth_deltas(kind: GrowthKind) -> Mapping[str, float]:
    """Tiny, evidence-linked axis nudges; repeated history is required to be visible."""
    return {
        "goal_practice": {"openness": .025, "assertiveness": .02},
        "social_cooperation": {"warmth": .03, "extraversion": .015},
        "relationship_repair": {"emotional_stability": .035, "warmth": .02},
        "boundary_practice": {"assertiveness": .035},
        "setback_reflection": {"emotional_stability": .01},
    }.get(kind, {})


def _advance_goal(goal: Mapping[str, Any], amount: float) -> dict[str, Any]:
    result = deepcopy(dict(goal))
    result["progress"] = round(max(0.0, min(100.0, float(result.get("progress", 0)) + amount)), 2)
    milestones = result.get("milestones") if isinstance(result.get("milestones"), list) else []
    active_index = min(max(0, len(milestones) - 1), int(result["progress"]) // 25) if milestones else 0
    for index, milestone in enumerate(milestones):
        milestone["status"] = "completed" if index < active_index else "active" if index == active_index else "locked"
    if result["progress"] >= 100:
        result["status"] = "completed"
        result["current_milestone"] = None
        for milestone in milestones:
            milestone["status"] = "completed"
    else:
        result["status"] = "active"
        result["current_milestone"] = milestones[active_index]["id"] if milestones else None
    return result


def apply_development_evidence(development: Mapping[str, Any], evidence: DevelopmentEvidence,
                               profile: Mapping[str, Any]) -> tuple[dict[str, Any], bool]:
    """Apply one fact exactly once and return ``(new_state, changed)``."""
    result = normalize_development(development, profile)
    raw = evidence.to_dict()
    applied = result["applied_evidence"]
    previous = applied.get(evidence.id)
    if previous is not None:
        if previous != raw["fingerprint"]:
            raise ValueError("development evidence id was reused with different content")
        return result, False

    weight = max(0.1, min(2.0, float(evidence.weight)))
    confidence = result["confidence"]
    if evidence.kind == "goal_practice":
        # Goal progress takes many completed actions; a single scene can never
        # rewrite a resident's life direction.
        result["goal"] = _advance_goal(result["goal"], 1.25 * weight)
        confidence["successful_commitments"] += 1
        confidence["value"] = min(100.0, confidence["value"] + .12 * weight)
    elif evidence.kind == "habit_practice":
        for habit in result["habits"]:
            if habit.get("id") != evidence.habit_id:
                continue
            habit["practice_count"] = int(habit.get("practice_count", 0)) + 1
            habit["strength"] = round(min(100.0, float(habit.get("strength", 20)) + .65 * weight), 2)
            habit["last_practiced_at"] = evidence.occurred_at
            break
    elif evidence.kind == "completed_commitment":
        confidence["successful_commitments"] += 1
        confidence["value"] = min(100.0, confidence["value"] + .08 * weight)
    elif evidence.kind == "social_cooperation":
        result["relationship_strategies"]["cooperation"] = min(
            100.0, result["relationship_strategies"]["cooperation"] + 1.0 * weight
        )
        confidence["value"] = min(100.0, confidence["value"] + .1 * weight)
    elif evidence.kind == "relationship_repair":
        result["relationship_strategies"]["repair"] = min(
            100.0, result["relationship_strategies"]["repair"] + 1.2 * weight
        )
        confidence["value"] = min(100.0, confidence["value"] + .15 * weight)
    elif evidence.kind == "boundary_practice":
        result["relationship_strategies"]["boundary_setting"] = min(
            100.0, result["relationship_strategies"]["boundary_setting"] + 1.0 * weight
        )
    elif evidence.kind == "setback_reflection":
        result["relationship_strategies"]["reflection"] = min(
            100.0, result["relationship_strategies"]["reflection"] + .75 * weight
        )
        confidence["setbacks"] += 1
        confidence["value"] = max(0.0, confidence["value"] - .08 * weight)
    applied[evidence.id] = raw["fingerprint"]
    if len(applied) > MAX_DEVELOPMENT_EVIDENCE:
        for key in list(applied)[:-MAX_DEVELOPMENT_EVIDENCE]:
            del applied[key]
    return result, True


def action_development_evidence(*, npc_id: str, source_id: str, action_type: str,
                                desire: Mapping[str, Any] | None,
                                development: Mapping[str, Any],
                                occurred_at: datetime,
                                collision_hooks: Sequence[str] = ()) -> tuple[DevelopmentEvidence, ...]:
    """Translate an actually completed action into auditable development facts."""
    moment = _utc(occurred_at).isoformat()
    source = str((desire or {}).get("source") or "")
    reason = str((desire or {}).get("reason") or "")
    facts: list[DevelopmentEvidence] = [DevelopmentEvidence(
        id=_stable_id("action", source_id, "commitment"), npc_id=npc_id,
        source="life_action", source_id=source_id, kind="completed_commitment",
        occurred_at=moment, action_type=action_type, weight=.5,
    )]
    if source == "goal" or reason in {"goal_relevance", "schedule_alignment"}:
        facts.append(DevelopmentEvidence(
            id=_stable_id("action", source_id, "goal"), npc_id=npc_id,
            source="life_action", source_id=source_id, kind="goal_practice",
            occurred_at=moment, action_type=action_type,
        ))
    if source == "habit" or reason == "habit":
        habits = [item for item in development.get("habits", ()) if isinstance(item, Mapping)]
        keywords = {
            "prepare_food": ("cook", "breakfast", "tea", "coffee", "烹饪", "早餐"),
            "clean_shared_space": ("clean", "tidy", "straighten", "整理", "打扫"),
            "read": ("read", "book", "note", "阅读", "读书", "笔记"),
            "practice_hobby": ("practi", "hobby", "guitar", "music", "paint", "练习", "创作"),
            "rest_alone": ("alone", "quiet", "独处", "安静"),
            "seek_company": ("check in", "housemate", "一起", "室友"),
            "talk_to_resident": ("talk", "chat", "联系", "聊天"),
        }.get(action_type, ())
        hooks = tuple(str(value).replace("_", " ").casefold() for value in collision_hooks)
        matching = [
            habit for habit in habits
            if action_type.replace("_", " ") in str(habit.get("label") or "").casefold()
            or any(hook in str(habit.get("label") or "").casefold() for hook in hooks)
            or any(keyword in str(habit.get("label") or "").casefold() for keyword in keywords)
        ]
        if matching:
            # Only reinforce a declared routine that actually explains the
            # selected action. Stable choice resolves multiple valid matches.
            index = int(hashlib.sha256(f"{source_id}:habit".encode()).hexdigest()[:8], 16) % len(matching)
            habit_id = str(matching[index].get("id") or "")
            facts.append(DevelopmentEvidence(
                id=_stable_id("action", source_id, "habit", habit_id), npc_id=npc_id,
                source="life_action", source_id=source_id, kind="habit_practice",
                occurred_at=moment, action_type=action_type, habit_id=habit_id,
            ))
    return tuple(facts)


def thread_development_evidence(*, npc_ids: Sequence[str], source_id: str,
                                thread_id: str | None, outcome_tags: Sequence[str],
                                occurred_at: datetime) -> dict[str, tuple[DevelopmentEvidence, ...]]:
    """Translate a settled social scene into the same resident evidence stream."""
    moment = _utc(occurred_at).isoformat()
    tags = {str(value) for value in outcome_tags}
    kinds: list[GrowthKind] = []
    if "cooperation" in tags:
        kinds.append("social_cooperation")
    if tags & {"repair", "apology", "resolved", "reconciliation"}:
        kinds.append("relationship_repair")
    if tags & {"boundary", "boundary_respected"}:
        kinds.append("boundary_practice")
    if tags & {"conflict", "misunderstanding", "refused", "backfired"}:
        kinds.append("setback_reflection")
    return {
        npc_id: tuple(DevelopmentEvidence(
            id=_stable_id("story", source_id, npc_id, kind), npc_id=npc_id,
            source="story_thread", source_id=source_id, kind=kind,
            occurred_at=moment, thread_id=thread_id,
            outcome="settled", weight=1.0,
        ) for kind in kinds)
        for npc_id in sorted({str(value) for value in npc_ids if str(value)})
    }


def public_development(value: Mapping[str, Any], profile: Mapping[str, Any]) -> dict[str, Any]:
    """Expose progress and qualitative practice, never the hidden evidence ledger."""
    source = normalize_development(value, profile)
    confidence = float(source["confidence"]["value"])
    strategies = source["relationship_strategies"]
    return {
        "version": DEVELOPMENT_VERSION,
        "goal": deepcopy(source["goal"]),
        "confidence": _band(confidence, ("fragile", "growing", "steady", "grounded")),
        "habits": [
            {
                "id": habit["id"], "label": habit["label"],
                "strength": _band(float(habit.get("strength", 20)),
                                  ("new", "forming", "established", "ingrained")),
                "last_practiced_at": habit.get("last_practiced_at"),
            }
            for habit in source["habits"]
        ],
        "relationship_strategies": {
            key: _band(float(amount), ("untried", "emerging", "practiced", "reliable"))
            for key, amount in strategies.items()
        },
    }
