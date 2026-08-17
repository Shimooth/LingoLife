from datetime import datetime, timedelta, timezone

from lingolife.learning import Evidence, LearningCatalog, LearningEngine, LearningState, SkillRecord


NOW = datetime(2026, 1, 10, 12, tzinfo=timezone.utc)


def test_catalog_has_small_but_meaningful_a2_b1_scope():
    catalog = LearningCatalog.load()
    assert len(catalog.targets) == 8
    assert sum(len(values) for values in catalog.data["expressions"].values()) == 48
    assert sum(len(values) for values in catalog.data["vocabulary"].values()) == 200
    assert {target["kind"] for target in catalog.targets.values()} == {"intent", "grammar"}


def test_rule_engine_applies_structured_evidence_and_ignores_unknown_labels():
    engine = LearningEngine()
    state = LearningState()
    engine.apply(state, [
        Evidence("intent.empathy", "success", 0.8),
        {"target_id": "grammar.questions", "outcome": "error", "confidence": 0.5, "source": "chat"},
        Evidence("hallucinated.skill", "success"),
    ], NOW)
    empathy = state.records["intent.empathy"]
    assert empathy.exposures == 0.8 and empathy.successes == 0.8 and empathy.errors == 0
    assert state.records["grammar.questions"].errors == 0.5
    assert "hallucinated.skill" not in state.records
    assert empathy.next_review_at is not None


def test_mastery_rewards_repeated_success_and_penalizes_errors():
    engine = LearningEngine()
    strong = SkillRecord(exposures=8, successes=8, errors=1, last_used_at=NOW.isoformat())
    weak = SkillRecord(exposures=8, successes=2, errors=7, last_used_at=NOW.isoformat())
    unseen = SkillRecord()
    assert engine.mastery(strong, NOW) > engine.mastery(weak, NOW) > engine.mastery(unseen, NOW)
    assert engine.mastery(strong, NOW) <= 100


def test_forgetting_decay_and_success_based_half_life():
    engine = LearningEngine()
    recent = SkillRecord(exposures=8, successes=6, errors=1, last_used_at=NOW.isoformat())
    initial = engine.mastery(recent, NOW)
    assert engine.mastery(recent, NOW + timedelta(days=30)) < initial
    durable = SkillRecord(exposures=20, successes=20, errors=1, last_used_at=NOW.isoformat())
    fragile = SkillRecord(exposures=20, successes=2, errors=1, last_used_at=NOW.isoformat())
    assert engine.mastery(durable, NOW + timedelta(days=20)) > engine.mastery(fragile, NOW + timedelta(days=20))


def test_error_schedules_tomorrow_and_due_targets_are_prioritized():
    engine = LearningEngine()
    state = LearningState()
    engine.apply(state, [Evidence("intent.advice", "error")], NOW)
    assert state.records["intent.advice"].next_review_at == (NOW + timedelta(days=1)).isoformat()
    due = engine.targets(state, NOW + timedelta(days=2), limit=2)
    assert due[0]["id"] == "intent.advice" and due[0]["due"] is True


def test_progress_is_frontend_ready_and_state_round_trips():
    engine = LearningEngine()
    state = LearningState()
    for day in range(8):
        engine.apply(state, [Evidence("intent.follow_up", "success")], NOW + timedelta(days=day))
    restored = LearningState.from_dict(state.to_dict())
    progress = engine.progress(restored, NOW + timedelta(days=8))
    item = next(item for item in progress["targets"] if item["id"] == "intent.follow_up")
    assert progress["scope"].startswith("A2-B1")
    assert progress["total_targets"] == 8
    assert 0 <= progress["overall_mastery"] <= 100
    assert item["successes"] == 8
    assert item["status"] in {"learning", "mastered"}
    assert len(progress["recommended"]) == 3
