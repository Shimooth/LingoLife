"""Deterministic learning-progress rules for the A2--B1 social-English slice.

The LLM may report *evidence* (what the learner attempted and whether it was
successful), but it never supplies XP or mastery.  This module deliberately has
no database dependency so the repository can persist ``LearningState`` as JSON
or map its records to relational rows.
"""
from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable, Literal, Mapping

Outcome = Literal["exposure", "success", "error"]


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class Evidence:
    target_id: str
    outcome: Outcome
    confidence: float = 1.0
    source: str = "chat"


@dataclass
class SkillRecord:
    exposures: float = 0.0
    successes: float = 0.0
    errors: float = 0.0
    last_used_at: str | None = None
    next_review_at: str | None = None


@dataclass
class LearningState:
    records: dict[str, SkillRecord] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, value: Mapping[str, object]) -> "LearningState":
        raw = value.get("records", {})
        return cls({key: SkillRecord(**record) for key, record in raw.items()})  # type: ignore[union-attr,arg-type]

    def to_dict(self) -> dict[str, object]:
        return {"records": {key: asdict(record) for key, record in self.records.items()}}


class LearningCatalog:
    def __init__(self, data: Mapping[str, object]):
        self.data = dict(data)
        targets = data.get("targets")
        if not isinstance(targets, list) or not targets:
            raise ValueError("catalog must contain targets")
        self.targets = {str(item["id"]): dict(item) for item in targets}  # type: ignore[index]
        if len(self.targets) != len(targets):
            raise ValueError("target ids must be unique")

    @classmethod
    def load(cls, path: str | Path | None = None) -> "LearningCatalog":
        source = Path(path) if path else Path(__file__).parents[1] / "content" / "learning_catalog.json"
        return cls(json.loads(source.read_text(encoding="utf-8")))


class LearningEngine:
    """Apply evidence, decay mastery, and choose review/event targets."""

    def __init__(self, catalog: LearningCatalog | None = None):
        self.catalog = catalog or LearningCatalog.load()

    def mastery(self, record: SkillRecord, now: datetime | None = None) -> int:
        # A conservative evidence-weighted score: exposure alone is useful but
        # cannot create mastery, while errors remain visible rather than erasing XP.
        attempts = record.successes + record.errors
        accuracy = (record.successes + 1.0) / (attempts + 2.0)
        evidence = 1.0 - math.exp(-(record.exposures + attempts) / 5.0)
        raw = 100.0 * accuracy * evidence
        if record.last_used_at:
            last = datetime.fromisoformat(record.last_used_at)
            days = max(0.0, ((now or utcnow()) - last).total_seconds() / 86400)
            # Half-life grows with demonstrated success (3--45 days).
            half_life = min(45.0, 3.0 + record.successes * 4.0)
            raw *= 2 ** (-days / half_life)
        return round(max(0.0, min(100.0, raw)))

    def apply(self, state: LearningState, evidence: Iterable[Evidence | Mapping[str, object]],
              now: datetime | None = None) -> LearningState:
        moment = (now or utcnow()).astimezone(timezone.utc)
        for item in evidence:
            signal = item if isinstance(item, Evidence) else Evidence(**item)  # type: ignore[arg-type]
            if signal.target_id not in self.catalog.targets:
                continue  # tolerate stale/hallucinated LLM labels
            if signal.outcome not in ("exposure", "success", "error"):
                continue
            weight = max(0.0, min(1.0, float(signal.confidence)))
            if weight == 0:
                continue
            record = state.records.setdefault(signal.target_id, SkillRecord())
            record.exposures += weight
            if signal.outcome == "success":
                record.successes += weight
            elif signal.outcome == "error":
                record.errors += weight
            record.last_used_at = moment.isoformat()
            score = self.mastery(record, moment)
            interval_days = 1 if signal.outcome == "error" else max(1, min(30, round(1 + score / 12)))
            record.next_review_at = (moment + timedelta(days=interval_days)).isoformat()
        return state

    def targets(self, state: LearningState, now: datetime | None = None, limit: int = 3) -> list[dict[str, object]]:
        """Return due/weak targets suitable for an event engine learning_targets field."""
        moment = now or utcnow()
        ranked = []
        for target_id, meta in self.catalog.targets.items():
            record = state.records.get(target_id, SkillRecord())
            score = self.mastery(record, moment)
            due = not record.next_review_at or datetime.fromisoformat(record.next_review_at) <= moment
            # Due learned skills first, then unseen/weak content; catalog order is a stable tie-breaker.
            priority = (0 if due and record.exposures else 1 if record.exposures == 0 else 2, score)
            ranked.append((priority, target_id, meta, score, due))
        ranked.sort(key=lambda row: row[0])
        return [{"id": target_id, "name": meta["name"], "kind": meta["kind"],
                 "mastery": score, "due": due}
                for _, target_id, meta, score, due in ranked[:max(0, limit)]]

    def progress(self, state: LearningState, now: datetime | None = None) -> dict[str, object]:
        moment = now or utcnow()
        items = []
        for target_id, meta in self.catalog.targets.items():
            record = state.records.get(target_id, SkillRecord())
            score = self.mastery(record, moment)
            items.append({"id": target_id, "name": meta["name"], "kind": meta["kind"],
                          "mastery": score, "status": "mastered" if score >= 75 else "learning" if record.exposures else "new",
                          "exposures": round(record.exposures, 2), "successes": round(record.successes, 2),
                          "errors": round(record.errors, 2), "last_used_at": record.last_used_at,
                          "next_review_at": record.next_review_at})
        overall = round(sum(item["mastery"] for item in items) / len(items)) if items else 0  # type: ignore[arg-type]
        level = "B1-ready" if overall >= 75 else "A2+" if overall >= 45 else "A2 foundation"
        return {"scope": self.catalog.data.get("scope"), "overall_mastery": overall,
                "level": level, "mastered_count": sum(item["status"] == "mastered" for item in items),
                "total_targets": len(items), "targets": items, "recommended": self.targets(state, moment),
                "vocabulary": self.catalog.data.get("vocabulary", {})}
