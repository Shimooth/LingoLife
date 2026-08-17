from __future__ import annotations

import sqlite3

from lingolife.db import Database
from lingolife.events import ActiveEvent, EventHistory
from lingolife.learning import LearningState, SkillRecord


def database(tmp_path) -> Database:
    return Database(f"sqlite:///{tmp_path / 'state.db'}")


def test_schema_incrementally_migrates_an_existing_demo_database(tmp_path):
    path = tmp_path / "legacy.db"
    connection = sqlite3.connect(path)
    connection.execute("CREATE TABLE players (id TEXT PRIMARY KEY, created_at TEXT)")
    connection.execute("INSERT INTO players VALUES ('old-player','2025-01-01')")
    connection.commit()
    connection.close()

    db = Database(f"sqlite:///{path}")
    tables = {row[0] for row in db._connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"npc_profiles", "npc_memories", "active_events", "event_history", "learning_states"} <= tables
    assert db._connection.execute("SELECT id FROM players").fetchone()[0] == "old-player"


def test_profile_default_is_created_once_and_customization_round_trips(tmp_path):
    db = database(tmp_path)
    default = {"name": "Emma", "traits": ["kind"], "appearance": {"hair": "波浪长发"}}
    assert db.get_npc_profile("p1", "emma") is None
    assert db.get_or_create_npc_profile("p1", "emma", default) == default
    # A changed application default must not erase a player's saved character.
    assert db.get_or_create_npc_profile("p1", "emma", {"name": "Other"}) == default
    customized = {**default, "traits": ["creative", "curious"]}
    assert db.save_npc_profile("p1", "emma", customized) == customized
    assert db.get_npc_profile("p1", "emma") == customized


def test_memories_are_scoped_ranked_filtered_and_deletable(tmp_path):
    db = database(tmp_path)
    low = db.add_npc_memory("p1", "emma", "fact", "Player likes tea", importance=1)
    high = db.add_npc_memory("p1", "emma", "event", "We found a dog", "lost_dog", importance=9)
    db.add_npc_memory("someone-else", "emma", "event", "private", importance=5)
    memories = db.list_npc_memories("p1", "emma")
    assert [item["id"] for item in memories] == [high["id"], low["id"]]
    assert high["importance"] == 5  # public method clamps untrusted values
    assert db.list_npc_memories("p1", "emma", kind="fact")[0]["content"] == "Player likes tea"
    assert not db.delete_npc_memory("someone-else", "emma", low["id"])
    assert db.delete_npc_memory("p1", "emma", low["id"])


def test_active_event_json_round_trip_and_upsert(tmp_path):
    db = database(tmp_path)
    active = ActiveEvent("p1", "emma", "daily_rainy_walk", "2026-08-17", 1, 2, ["empathy"])
    db.save_active_event(active)
    assert db.get_active_event("p1", "emma") == active
    active.stage_index = 2
    active.collected_signals.append("advice")
    db.save_active_event(active)
    assert db.get_active_event("p1", "emma") == active
    db.clear_active_event("p1", "emma")
    assert db.get_active_event("p1", "emma") is None


def test_complete_event_atomically_writes_history_and_clears_active(tmp_path):
    db = database(tmp_path)
    active = ActiveEvent("p1", "emma", "growth_rejected_design", "2026-08-17")
    db.save_active_event(active)
    history = EventHistory("p1", "emma", active.template_id, "growth", active.event_date,
                           "2026-08-17T12:00:00", "asks_feedback", 6, 6, "我们一起准备了反馈问题。")
    db.complete_event(history)
    assert db.get_active_event("p1", "emma") is None
    assert db.list_event_history("p1", "emma") == [history]
    assert db.list_event_history("different", "emma") == []


def test_learning_state_defaults_and_round_trips_json(tmp_path):
    db = database(tmp_path)
    assert db.get_learning_state("p1") == LearningState()
    state = LearningState({
        "intent.empathy": SkillRecord(exposures=2.5, successes=2, errors=.5,
                                       last_used_at="2026-08-17T00:00:00+00:00",
                                       next_review_at="2026-08-20T00:00:00+00:00")
    })
    assert db.save_learning_state("p1", state) is state
    assert db.get_learning_state("p1") == state
