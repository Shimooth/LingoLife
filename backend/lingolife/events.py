from __future__ import annotations

import json
import random
from dataclasses import asdict, dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Protocol, Sequence


EVENT_CATEGORIES = {"daily", "growth", "relationship", "surprise"}
SEMANTIC_SIGNALS = {
    "accept", "advice", "apology", "celebration", "curiosity", "decline",
    "empathy", "encouragement", "honesty", "practical_help", "reassurance",
}


@dataclass(frozen=True)
class NPCEventContext:
    player_id: str
    npc_id: str
    traits: tuple[str, ...] = ()
    interests: tuple[str, ...] = ()
    occupation: str = ""
    mood: str = "neutral"
    relationship: int = 35
    long_term_goals: tuple[str, ...] = ()
    learning_targets: tuple[str, ...] = ()
    needs: tuple[str, ...] = ()


@dataclass(frozen=True)
class EventStage:
    id: str
    prompt: str
    objective: str
    required_signals: tuple[str, ...] = ()
    any_signals: tuple[str, ...] = ()
    min_turns: int = 1


@dataclass(frozen=True)
class EventOutcome:
    id: str
    trigger_signals: tuple[str, ...]
    relationship_change: int
    mood_change: int
    memory: str


@dataclass(frozen=True)
class EventTemplate:
    id: str
    category: str
    title: str
    base_weight: float
    tags: dict[str, tuple[str, ...]]
    relationship_range: tuple[int, int]
    cooldown_days: int
    repeatable: bool
    learning_targets: tuple[str, ...]
    stages: tuple[EventStage, ...]
    outcomes: tuple[EventOutcome, ...]
    default_outcome: str


@dataclass
class ActiveEvent:
    player_id: str
    npc_id: str
    template_id: str
    event_date: str
    stage_index: int = 0
    stage_turns: int = 0
    collected_signals: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class EventHistory:
    player_id: str
    npc_id: str
    template_id: str
    category: str
    started_on: str
    completed_at: str
    outcome_id: str
    relationship_change: int
    mood_change: int
    memory: str


@dataclass(frozen=True)
class EventTransition:
    event: ActiveEvent | None
    stage_changed: bool
    completed: bool
    outcome: EventOutcome | None = None
    memory: EventHistory | None = None


class EventRepository(Protocol):
    """Persistence boundary. Implement these operations transactionally in SQLite."""

    def get_active_event(self, player_id: str, npc_id: str) -> ActiveEvent | None: ...
    def save_active_event(self, event: ActiveEvent) -> None: ...
    def clear_active_event(self, player_id: str, npc_id: str) -> None: ...
    def list_event_history(self, player_id: str, npc_id: str, limit: int = 50) -> list[EventHistory]: ...
    def append_event_history(self, history: EventHistory) -> None: ...


class InMemoryEventRepository:
    def __init__(self) -> None:
        self.active: dict[tuple[str, str], ActiveEvent] = {}
        self.history: list[EventHistory] = []

    def get_active_event(self, player_id: str, npc_id: str) -> ActiveEvent | None:
        return self.active.get((player_id, npc_id))

    def save_active_event(self, event: ActiveEvent) -> None:
        self.active[(event.player_id, event.npc_id)] = event

    def clear_active_event(self, player_id: str, npc_id: str) -> None:
        self.active.pop((player_id, npc_id), None)

    def list_event_history(self, player_id: str, npc_id: str, limit: int = 50) -> list[EventHistory]:
        matches = [h for h in self.history if h.player_id == player_id and h.npc_id == npc_id]
        return list(reversed(matches[-limit:]))

    def append_event_history(self, history: EventHistory) -> None:
        self.history.append(history)


def load_event_templates(path: str | Path | None = None) -> tuple[EventTemplate, ...]:
    source = Path(path) if path else Path(__file__).parents[1] / "content" / "events.json"
    raw = json.loads(source.read_text(encoding="utf-8"))
    templates: list[EventTemplate] = []
    seen: set[str] = set()
    for item in raw["events"]:
        if item["id"] in seen:
            raise ValueError(f"duplicate event id: {item['id']}")
        seen.add(item["id"])
        if item["category"] not in EVENT_CATEGORIES:
            raise ValueError(f"invalid category: {item['category']}")
        stages = tuple(EventStage(
            id=s["id"], prompt=s["prompt"], objective=s["objective"],
            required_signals=tuple(s.get("required_signals", ())),
            any_signals=tuple(s.get("any_signals", ())), min_turns=s.get("min_turns", 1),
        ) for s in item["stages"])
        outcomes = tuple(EventOutcome(
            id=o["id"], trigger_signals=tuple(o.get("trigger_signals", ())),
            relationship_change=o["relationship_change"], mood_change=o["mood_change"], memory=o["memory"],
        ) for o in item["outcomes"])
        if not stages or not outcomes or item["default_outcome"] not in {o.id for o in outcomes}:
            raise ValueError(f"incomplete event: {item['id']}")
        unknown = {x for s in stages for x in (*s.required_signals, *s.any_signals)} - SEMANTIC_SIGNALS
        unknown |= {x for o in outcomes for x in o.trigger_signals} - SEMANTIC_SIGNALS
        if unknown:
            raise ValueError(f"unknown semantic signals in {item['id']}: {sorted(unknown)}")
        templates.append(EventTemplate(
            id=item["id"], category=item["category"], title=item["title"],
            base_weight=float(item.get("base_weight", 1)),
            tags={k: tuple(v) for k, v in item.get("tags", {}).items()},
            relationship_range=tuple(item.get("relationship_range", (0, 100))),
            cooldown_days=item.get("cooldown_days", 7), repeatable=item.get("repeatable", True),
            learning_targets=tuple(item.get("learning_targets", ())), stages=stages,
            outcomes=outcomes, default_outcome=item["default_outcome"],
        ))
    return tuple(templates)


class EventEngine:
    """Rules own selection/progression/impact; an LLM may only supply semantic signals."""

    def __init__(self, repository: EventRepository, templates: Sequence[EventTemplate] | None = None,
                 rng: random.Random | None = None):
        self.repository = repository
        self.templates = tuple(templates or load_event_templates())
        self.by_id = {event.id: event for event in self.templates}
        self.rng = rng or random.Random()

    def daily_event(self, context: NPCEventContext, today: date | None = None) -> ActiveEvent | None:
        current = self.repository.get_active_event(context.player_id, context.npc_id)
        if current:
            return current
        day = (today or date.today()).isoformat()
        history = self.repository.list_event_history(context.player_id, context.npc_id)
        if any(h.started_on == day for h in history):
            return None  # lazy refresh is idempotent: at most one event begins per local game day
        scored = [(template, self.score(template, context, history, today or date.today()))
                  for template in self.templates]
        scored = [(template, score) for template, score in scored if score > 0]
        if not scored:
            return None
        event = self.rng.choices([x[0] for x in scored], weights=[x[1] for x in scored], k=1)[0]
        active = ActiveEvent(context.player_id, context.npc_id, event.id, day)
        self.repository.save_active_event(active)
        return active

    def score(self, template: EventTemplate, context: NPCEventContext,
              history: Sequence[EventHistory], today: date) -> float:
        if not template.relationship_range[0] <= context.relationship <= template.relationship_range[1]:
            return 0
        previous = [h for h in history if h.template_id == template.id]
        if previous and not template.repeatable:
            return 0
        if previous:
            last = max(date.fromisoformat(h.started_on) for h in previous)
            if (today - last).days < template.cooldown_days:
                return 0
        score = template.base_weight
        score += 1.5 * len(set(context.traits) & set(template.tags.get("traits", ())))
        score += 1.5 * len(set(context.interests) & set(template.tags.get("interests", ())))
        score += 2.0 * (context.occupation in template.tags.get("occupations", ()))
        score += 1.25 * (context.mood in template.tags.get("moods", ()))
        score += 1.5 * len(set(context.needs) & set(template.tags.get("needs", ())))
        goal_words = {word for goal in context.long_term_goals for word in goal.lower().split()}
        score += 1.25 * len(goal_words & set(template.tags.get("goals", ())))
        score += 1.0 * len(set(context.learning_targets) & set(template.learning_targets))
        recent_categories = [h.category for h in history[:3]]
        score *= 0.45 ** recent_categories.count(template.category)
        return max(0.0, score)

    def stage(self, active: ActiveEvent) -> EventStage:
        return self.by_id[active.template_id].stages[active.stage_index]

    def advance(self, active: ActiveEvent, semantic_signals: Sequence[str],
                now: datetime | None = None) -> EventTransition:
        template = self.by_id[active.template_id]
        signals = sorted(set(semantic_signals) & SEMANTIC_SIGNALS)
        active.collected_signals = sorted(set(active.collected_signals) | set(signals))
        active.stage_turns += 1
        stage = template.stages[active.stage_index]
        requirements_met = set(stage.required_signals) <= set(active.collected_signals)
        any_met = not stage.any_signals or bool(set(stage.any_signals) & set(active.collected_signals))
        if active.stage_turns < stage.min_turns or not requirements_met or not any_met:
            self.repository.save_active_event(active)
            return EventTransition(active, False, False)
        if active.stage_index + 1 < len(template.stages):
            active.stage_index += 1
            active.stage_turns = 0
            self.repository.save_active_event(active)
            return EventTransition(active, True, False)
        collected = set(active.collected_signals)
        outcome = next((o for o in template.outcomes if o.trigger_signals and set(o.trigger_signals) <= collected), None)
        outcome = outcome or next(o for o in template.outcomes if o.id == template.default_outcome)
        history = EventHistory(
            active.player_id, active.npc_id, active.template_id, template.category, active.event_date,
            (now or datetime.utcnow()).isoformat(timespec="seconds"), outcome.id,
            max(-10, min(10, outcome.relationship_change)), max(-10, min(10, outcome.mood_change)), outcome.memory,
        )
        self.repository.append_event_history(history)
        self.repository.clear_active_event(active.player_id, active.npc_id)
        return EventTransition(None, True, True, outcome, history)


def event_to_dict(value: ActiveEvent | EventHistory) -> dict:
    """Convenience serializer for JSON columns/API responses."""
    return asdict(value)
