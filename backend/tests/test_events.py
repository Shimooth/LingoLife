from __future__ import annotations

import json
import random
from dataclasses import replace
from datetime import date, datetime

import pytest

from lingolife.events import (
    ActiveEvent,
    EventEngine,
    EventHistory,
    InMemoryEventRepository,
    NPCEventContext,
    load_event_templates,
)


@pytest.fixture()
def templates():
    return load_event_templates()


@pytest.fixture()
def context():
    return NPCEventContext(
        player_id="player-1", npc_id="emma", traits=("creative", "introverted"),
        interests=("art", "photography"), occupation="designer", mood="sad",
        relationship=50, long_term_goals=("build a design portfolio",),
        learning_targets=("expressing_empathy",), needs=("achievement",),
    )


def test_content_has_eighteen_unique_multistage_events_across_all_categories(templates):
    assert len(templates) == 18
    assert len({event.id for event in templates}) == 18
    assert {event.category for event in templates} == {"daily", "growth", "relationship", "surprise"}
    assert all(len(event.stages) >= 3 for event in templates)
    assert all(event.learning_targets for event in templates)
    assert all(outcome.memory for event in templates for outcome in event.outcomes)


def test_json_is_utf8_content_not_python_embedded():
    # Content editors can expand the pool without changing engine code.
    raw = json.loads((__import__("pathlib").Path(__file__).parents[1] / "content/events.json").read_text())
    assert raw["version"] == 1


def test_context_matching_materially_increases_score(templates, context):
    engine = EventEngine(InMemoryEventRepository(), templates, random.Random(1))
    event = next(x for x in templates if x.id == "growth_rejected_design")
    matched = engine.score(event, context, [], date(2026, 8, 17))
    generic = engine.score(event, replace(context, traits=(), interests=(), occupation="", mood="neutral",
                                                  long_term_goals=(), learning_targets=(), needs=()), [], date(2026, 8, 17))
    assert matched > generic + 5


def test_nonrepeatable_and_cooldown_events_are_excluded(templates, context):
    engine = EventEngine(InMemoryEventRepository(), templates)
    unique = next(x for x in templates if x.id == "growth_rejected_design")
    repeatable = next(x for x in templates if x.id == "daily_rainy_walk")
    history = [EventHistory(context.player_id, context.npc_id, unique.id, unique.category, "2026-01-01",
                            "2026-01-01T12:00:00", "x", 0, 0, "x")]
    assert engine.score(unique, context, history, date(2026, 8, 17)) == 0
    recent = [replace(history[0], template_id=repeatable.id, category=repeatable.category, started_on="2026-08-15")]
    assert engine.score(repeatable, context, recent, date(2026, 8, 17)) == 0
    assert engine.score(repeatable, context, recent, date(2026, 9, 1)) > 0


def test_recent_category_is_penalized_to_create_diversity(templates, context):
    engine = EventEngine(InMemoryEventRepository(), templates)
    event = next(x for x in templates if x.id == "growth_rejected_design")
    old = EventHistory(context.player_id, context.npc_id, "other", "growth", "2026-07-01",
                       "2026-07-01T00:00:00", "ok", 0, 0, "memory")
    assert engine.score(event, context, [old, old, old], date(2026, 8, 17)) < engine.score(event, context, [], date(2026, 8, 17)) / 5


def test_daily_lazy_refresh_is_idempotent_and_only_one_event_per_day(templates, context):
    repo = InMemoryEventRepository()
    engine = EventEngine(repo, templates, random.Random(7))
    first = engine.daily_event(context, date(2026, 8, 17))
    assert first is engine.daily_event(context, date(2026, 8, 17))
    template = engine.by_id[first.template_id]
    # Complete directly to exercise same-day refresh guard.
    first.stage_index = len(template.stages) - 1
    last = template.stages[-1]
    engine.advance(first, list(last.required_signals) + list(last.any_signals or ("advice",)), datetime(2026, 8, 17, 12))
    assert engine.daily_event(context, date(2026, 8, 17)) is None
    assert engine.daily_event(context, date(2026, 8, 18)) is not None


def test_unfinished_event_expires_and_is_replaced_on_the_next_game_day(templates, context):
    repo = InMemoryEventRepository()
    engine = EventEngine(repo, templates, random.Random(4))
    yesterday = engine.daily_event(context, date(2026, 8, 17))
    today = engine.daily_event(context, date(2026, 8, 18))
    assert today is not None and today.event_date == "2026-08-18"
    assert today is not yesterday
    expired = next(item for item in repo.history if item.started_on == "2026-08-17")
    assert expired.outcome_id == "expired"
    assert expired.relationship_change == expired.mood_change == 0
    assert expired.memory == ""


def test_occupation_events_are_case_insensitive_and_exclude_wrong_jobs(templates, context):
    engine = EventEngine(InMemoryEventRepository(), templates)
    teacher_event = next(item for item in templates if item.id == "growth_difficult_student")
    assert engine.score(teacher_event, replace(context, occupation="High School Teacher"), [], date(2026, 8, 18)) > 0
    assert engine.score(teacher_event, replace(context, occupation="Designer"), [], date(2026, 8, 18)) == 0


def test_stage_requires_rule_signals_and_minimum_turns(templates, context):
    event = next(x for x in templates if x.id == "growth_rejected_design")
    repo = InMemoryEventRepository()
    engine = EventEngine(repo, [event])
    active = ActiveEvent(context.player_id, context.npc_id, event.id, "2026-08-17")
    repo.save_active_event(active)
    waiting = engine.advance(active, ["curiosity", "made_up_llm_label"])
    assert not waiting.stage_changed
    assert active.stage_index == 0
    moved = engine.advance(active, ["empathy"])
    assert moved.stage_changed and not moved.completed
    assert active.stage_index == 1
    assert "made_up_llm_label" not in active.collected_signals


def test_multistage_completion_produces_bounded_impact_and_long_term_memory(templates, context):
    event = next(x for x in templates if x.id == "growth_rejected_design")
    repo = InMemoryEventRepository()
    engine = EventEngine(repo, [event])
    active = ActiveEvent(context.player_id, context.npc_id, event.id, "2026-08-17")
    repo.save_active_event(active)
    assert engine.advance(active, ["empathy", "curiosity"]).event.stage_index == 1
    assert engine.advance(active, ["encouragement"]).event.stage_index == 2
    result = engine.advance(active, ["practical_help"], datetime(2026, 8, 17, 13, 30))
    assert result.completed
    assert result.outcome.id == "asks_feedback"
    assert result.memory.relationship_change == 6
    assert result.memory.mood_change == 6
    assert "useful feedback" in result.memory.memory
    assert repo.get_active_event(context.player_id, context.npc_id) is None
    assert repo.list_event_history(context.player_id, context.npc_id)[0] == result.memory


def test_relationship_gate_can_exclude_intimate_event(templates, context):
    engine = EventEngine(InMemoryEventRepository(), templates)
    event = next(x for x in templates if x.id == "relationship_old_friend_message")
    assert engine.score(event, replace(context, relationship=20), [], date(2026, 8, 17)) == 0
    assert engine.score(event, replace(context, relationship=60), [], date(2026, 8, 17)) > 0
