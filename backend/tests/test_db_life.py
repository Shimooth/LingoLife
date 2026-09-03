from __future__ import annotations

import json
import sqlite3
import threading

import pytest

from lingolife.db import Database, LifeWorldRevisionConflict
from lingolife.relationships import (
    RelationshipChannels,
    RelationshipPair,
    StructuralBond,
)


def database(tmp_path, name: str = "life-v2.db") -> Database:
    return Database(f"sqlite:///{tmp_path / name}")


def table_names(db: Database) -> set[str]:
    return {row[0] for row in db._connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )}


def columns(db: Database, table: str) -> set[str]:
    return {row[1] for row in db._connection.execute(f"PRAGMA table_info({table})")}


def test_life_v2_schema_incrementally_migrates_legacy_rows_without_data_loss(tmp_path):
    path = tmp_path / "legacy-life.db"
    connection = sqlite3.connect(path)
    connection.executescript("""
        CREATE TABLE npc_social_edges (
          player_id TEXT NOT NULL,npc_a TEXT NOT NULL,npc_b TEXT NOT NULL,
          affinity INTEGER NOT NULL DEFAULT 50,status TEXT NOT NULL DEFAULT 'stranger',
          updated_at TEXT,PRIMARY KEY(player_id,npc_a,npc_b));
        INSERT INTO npc_social_edges(player_id,npc_a,npc_b,affinity,status,updated_at)
          VALUES ('legacy-player','ava','bo',77,'friend','2026-01-01');
        CREATE TABLE npc_memories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,player_id TEXT NOT NULL,npc_id TEXT NOT NULL,
          kind TEXT NOT NULL,content TEXT NOT NULL,source_event_id TEXT,
          importance INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        INSERT INTO npc_memories(player_id,npc_id,kind,content,source_event_id,importance)
          VALUES ('legacy-player','ava','social','Bo helped me before.','old-event',3);
    """)
    connection.commit()
    connection.close()

    db = Database(f"sqlite:///{path}")
    expected_tables = {
        "schema_migrations", "life_world_states", "residences", "households",
        "household_members", "household_resources", "npc_desires",
        "npc_life_actions", "life_stories", "life_story_observations",
        "life_interventions", "unresolved_threads", "npc_relationship_bonds",
        "relationship_evidence", "player_onboarding", "world_layout_configs",
    }
    assert expected_tables <= table_names(db)
    assert db._connection.execute(
        "SELECT description FROM schema_migrations WHERE version=2"
    ).fetchone()[0] == "life simulation v2 additive schema"
    assert db._connection.execute(
        "SELECT description FROM schema_migrations WHERE version=3"
    ).fetchone()[0] == "shared household onboarding and published world layout"

    edge = db._connection.execute(
        "SELECT * FROM npc_social_edges WHERE player_id='legacy-player'"
    ).fetchone()
    assert edge["affinity"] == 77
    assert edge["respect"] == edge["comfort"] == 50
    assert edge["resentment"] == edge["attraction"] == edge["dependency"] == edge["fear"] == 0
    assert edge["relationship_version"] == 2
    memory = db._connection.execute(
        "SELECT * FROM npc_memories WHERE player_id='legacy-player'"
    ).fetchone()
    assert memory["content"] == "Bo helped me before."
    assert json.loads(memory["appraisal_json"]) == {}
    assert memory["fact_id"] is None and memory["corrects_memory_id"] is None


def test_life_world_snapshot_revision_rejects_stale_writers_and_keeps_state(tmp_path):
    db = database(tmp_path)
    first = db.save_life_world_state(
        "player-1", {"clock": "morning", "revision": 999},
        rules_version="life-v2", last_advanced_at="2040-01-01T08:00:00+00:00",
        next_transition_at="2040-01-01T08:05:00+00:00", expected_revision=0,
    )
    assert first["revision"] == 1 and first["clock"] == "morning"
    assert first["rules_version"] == "life-v2"

    second = db.save_life_world_state(
        "player-1", {"clock": "afternoon", "updated_at": "untrusted"},
        rules_version="life-v2.1", last_advanced_at="2040-01-01T12:00:00+00:00",
        next_transition_at=None, expected_revision=1,
    )
    assert second["revision"] == 2 and second["clock"] == "afternoon"
    assert second["next_transition_at"] is None

    with pytest.raises(RuntimeError, match="revision conflict"):
        db.save_life_world_state(
            "player-1", {"clock": "stale-write"}, rules_version="life-v2",
            last_advanced_at="2040-01-01T09:00:00+00:00", next_transition_at=None,
            expected_revision=1,
        )
    persisted = db.get_life_world_state("player-1")
    assert persisted and persisted["revision"] == 2 and persisted["clock"] == "afternoon"
    assert db.get_life_world_state("another-player") is None


def test_world_and_all_projections_roll_back_together_then_retry_same_revision(tmp_path, monkeypatch):
    db = database(tmp_path)
    action = {
        "id": "action-atomic", "npc_id": "ava", "type": "read",
        "status": "performing", "started_at": "2040-01-01T08:00:00+00:00",
        "ends_at": "2040-01-01T08:30:00+00:00",
    }
    story = {
        "id": "story-atomic", "story_key": "atomic:story", "level": "moment",
        "status": "open", "participant_ids": ["ava"],
    }
    original = db._upsert_life_story

    def projection_failure(_player_id, _story):
        raise ValueError("injected projection failure")

    monkeypatch.setattr(db, "_upsert_life_story", projection_failure)
    with pytest.raises(ValueError, match="injected projection failure"):
        db.save_life_world_state_and_projections(
            "player-atomic", {"clock": "morning"}, rules_version="life-v2",
            last_advanced_at="2040-01-01T08:00:00+00:00", next_transition_at=None,
            expected_revision=0, households=[household_projection()],
            actions=[action], stories=[story],
        )

    assert db.get_life_world_state("player-atomic") is None
    assert db.get_household("player-atomic", "household-1") is None
    assert db._connection.execute(
        "SELECT COUNT(*) FROM npc_life_actions WHERE player_id='player-atomic'"
    ).fetchone()[0] == 0
    assert db._connection.execute(
        "SELECT COUNT(*) FROM life_stories WHERE player_id='player-atomic'"
    ).fetchone()[0] == 0

    monkeypatch.setattr(db, "_upsert_life_story", original)
    saved = db.save_life_world_state_and_projections(
        "player-atomic", {"clock": "morning"}, rules_version="life-v2",
        last_advanced_at="2040-01-01T08:00:00+00:00", next_transition_at=None,
        expected_revision=0, households=[household_projection()],
        actions=[action], stories=[story],
    )
    assert saved["revision"] == 1
    assert db.get_household("player-atomic", "household-1") is not None
    assert db.get_life_story("player-atomic", "story-atomic") is not None


def test_concurrent_bundle_writers_have_one_winner_and_loser_projects_nothing(tmp_path):
    path = tmp_path / "concurrent-life.db"
    databases = [Database(f"sqlite:///{path}"), Database(f"sqlite:///{path}")]
    barrier = threading.Barrier(2)
    outcomes: list[tuple[str, str]] = []

    def write(db: Database, writer: str):
        action = {
            "id": f"action-{writer}", "npc_id": "ava", "type": "read",
            "status": "performing", "started_at": "2040-01-01T08:00:00+00:00",
            "ends_at": "2040-01-01T08:30:00+00:00",
        }
        barrier.wait()
        try:
            db.save_life_world_state_and_projections(
                "player-race", {"writer": writer}, rules_version="life-v2",
                last_advanced_at="2040-01-01T08:00:00+00:00", next_transition_at=None,
                expected_revision=0, actions=[action],
            )
        except LifeWorldRevisionConflict:
            outcomes.append((writer, "conflict"))
        else:
            outcomes.append((writer, "saved"))

    threads = [threading.Thread(target=write, args=(db, f"writer-{index}"))
               for index, db in enumerate(databases)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)
        assert not thread.is_alive()

    assert sorted(status for _, status in outcomes) == ["conflict", "saved"]
    winner = next(writer for writer, status in outcomes if status == "saved")
    persisted = databases[0].get_life_world_state("player-race")
    assert persisted and persisted["revision"] == 1 and persisted["writer"] == winner
    projected_ids = {row[0] for row in databases[0]._connection.execute(
        "SELECT id FROM npc_life_actions WHERE player_id='player-race'"
    ).fetchall()}
    assert projected_ids == {f"action-{winner}"}


def household_projection() -> dict:
    return {
        "id": "household-1",
        "name": "Cloud House",
        "cleanliness": 72,
        "noise": 18,
        "residence": {
            "id": "residence-1", "location_id": "cloud-district",
            "name": "Cloud House", "floor_plan": "cutaway-v1",
        },
        "members": [
            {"npc_id": "ava", "private_room_id": "room-a", "role": "organizer"},
            {"id": "bo", "private_room_id": "room-b", "role": "cook"},
        ],
        "resources": [
            {"id": "tv-1", "kind": "television", "room_id": "living-room",
             "capacity": 2, "state": {"occupied_by": ["ava"], "program": "news"}},
            {"id": "bath-1", "kind": "bathroom", "room_id": "bathroom",
             "capacity": 1, "state": {"occupied_by": []}},
        ],
    }


def household_projection_variant(household_id: str, npc_id: str) -> dict:
    payload = household_projection()
    suffix = household_id.removeprefix("household-")
    payload.update({"id": household_id, "name": f"Household {suffix}"})
    payload["residence"].update({
        "id": f"residence-{suffix}", "location_id": f"district-{suffix}",
        "name": f"Household {suffix}",
    })
    payload["members"] = [
        {"npc_id": npc_id, "private_room_id": f"room-{suffix}", "role": "resident"},
    ]
    payload["resources"] = [
        {"id": f"resource-{suffix}", "kind": "television", "room_id": "living-room",
         "capacity": 2, "state": {"occupied_by": []}},
    ]
    return payload


def test_complete_household_snapshot_removes_only_owner_stale_projections_and_keeps_history(tmp_path):
    db = database(tmp_path)
    current = household_projection_variant("household-current", "ava")
    stale = household_projection_variant("household-stale", "bo")
    other_player = household_projection_variant("household-other-player", "cy")
    action = {
        "id": "action-kept", "npc_id": "ava", "type": "read", "status": "completed",
        "started_at": "2040-01-01T08:00:00+00:00", "ends_at": "2040-01-01T08:30:00+00:00",
    }
    story = {
        "id": "story-kept", "story_key": "history:kept", "level": "moment",
        "status": "resolved_autonomously", "participant_ids": ["ava", "bo"],
    }
    evidence = {
        "id": "evidence-kept", "fact_id": "fact-kept", "source_npc_id": "ava",
        "target_npc_id": "bo", "kind": "shared_experience", "magnitude": .8,
        "appraisal": {"valence": "positive"}, "deltas": {"affinity": 2},
        "context": {"story_id": "story-kept"}, "rules_version": "relationships-v2",
    }

    db.save_life_world_state_and_projections(
        "player-owner", {"phase": "cohabiting"}, rules_version="life-v2",
        last_advanced_at="2040-01-01T08:00:00+00:00", next_transition_at=None,
        expected_revision=0, households=[current, stale], actions=[action], stories=[story],
        evidence=[evidence],
    )
    db.save_life_world_state_and_projections(
        "player-other", {"phase": "unrelated"}, rules_version="life-v2",
        last_advanced_at="2040-01-01T08:00:00+00:00", next_transition_at=None,
        expected_revision=0, households=[other_player],
    )

    saved = db.save_life_world_state_and_projections(
        "player-owner", {"phase": "split"}, rules_version="life-v2",
        last_advanced_at="2040-01-01T09:00:00+00:00", next_transition_at=None,
        expected_revision=1, households=[current],
    )

    assert saved["revision"] == 2
    assert {value["id"] for value in db.list_households("player-owner")} == {"household-current"}
    assert db.get_household("player-owner", "household-stale") is None
    for table in ("households", "household_members", "household_resources"):
        assert db._connection.execute(
            f"SELECT COUNT(*) FROM {table} WHERE player_id=? AND "
            f"{'id' if table == 'households' else 'household_id'}=?",
            ("player-owner", "household-stale"),
        ).fetchone()[0] == 0
    assert db._connection.execute(
        "SELECT COUNT(*) FROM npc_life_actions WHERE player_id='player-owner' AND id='action-kept'"
    ).fetchone()[0] == 1
    assert db.get_life_story("player-owner", "story-kept") is not None
    assert [value["id"] for value in db.list_relationship_evidence("player-owner")] == [
        "evidence-kept",
    ]
    assert {value["id"] for value in db.list_households("player-other")} == {
        "household-other-player",
    }


def test_stale_household_cleanup_rolls_back_with_failed_projection_and_can_retry(tmp_path, monkeypatch):
    db = database(tmp_path)
    current = household_projection_variant("household-current", "ava")
    stale = household_projection_variant("household-stale", "bo")
    db.save_life_world_state_and_projections(
        "player-rollback", {"phase": "cohabiting"}, rules_version="life-v2",
        last_advanced_at="2040-01-01T08:00:00+00:00", next_transition_at=None,
        expected_revision=0, households=[current, stale],
    )
    failing_story = {
        "id": "story-failure", "story_key": "failure:after-cleanup", "level": "moment",
        "status": "open", "participant_ids": ["ava"],
    }
    original = db._upsert_life_story

    def projection_failure(_player_id, _story):
        raise ValueError("failure after household cleanup")

    monkeypatch.setattr(db, "_upsert_life_story", projection_failure)
    with pytest.raises(ValueError, match="failure after household cleanup"):
        db.save_life_world_state_and_projections(
            "player-rollback", {"phase": "split"}, rules_version="life-v2",
            last_advanced_at="2040-01-01T09:00:00+00:00", next_transition_at=None,
            expected_revision=1, households=[current], stories=[failing_story],
        )

    persisted = db.get_life_world_state("player-rollback")
    assert persisted and persisted["revision"] == 1 and persisted["phase"] == "cohabiting"
    projected_stale = db.get_household("player-rollback", "household-stale")
    assert projected_stale is not None
    assert [value["npc_id"] for value in projected_stale["members"]] == ["bo"]
    assert [value["id"] for value in projected_stale["resources"]] == ["resource-stale"]

    monkeypatch.setattr(db, "_upsert_life_story", original)
    retried = db.save_life_world_state_and_projections(
        "player-rollback", {"phase": "split"}, rules_version="life-v2",
        last_advanced_at="2040-01-01T09:00:00+00:00", next_transition_at=None,
        expected_revision=1, households=[current], stories=[failing_story],
    )
    assert retried["revision"] == 2
    assert db.get_household("player-rollback", "household-stale") is None
    assert db.get_life_story("player-rollback", "story-failure") is not None


def test_household_projection_round_trips_nested_members_resources_and_residence(tmp_path):
    db = database(tmp_path)
    payload = household_projection()
    assert db.upsert_household_projection("player-1", payload) == payload
    stored = db.get_household("player-1", "household-1")
    assert stored is not None
    assert stored["name"] == "Cloud House" and stored["cleanliness"] == 72
    assert stored["residence_id"] == "residence-1"
    assert [(item["npc_id"], item["private_room_id"], item["role"])
            for item in stored["members"]] == [
                ("ava", "room-a", "organizer"), ("bo", "room-b", "cook"),
            ]
    resources = {item["id"]: item for item in stored["resources"]}
    assert resources["tv-1"]["capacity"] == 2
    assert resources["tv-1"]["state"] == {"occupied_by": ["ava"], "program": "news"}
    assert db.get_household("another-player", "household-1") is None
    residence = db._connection.execute(
        "SELECT * FROM residences WHERE player_id='player-1' AND id='residence-1'"
    ).fetchone()
    assert residence and json.loads(residence["state_json"])["floor_plan"] == "cutaway-v1"


def test_household_projection_replaces_members_and_resources_instead_of_leaving_ghosts(tmp_path):
    db = database(tmp_path)
    db.upsert_household_projection("player-1", household_projection())
    changed = household_projection()
    changed["members"] = [{"npc_id": "ava", "private_room_id": "room-a", "role": "organizer"}]
    changed["resources"] = [{
        "id": "tv-1", "kind": "television", "room_id": "living-room",
        "capacity": 1, "state": {"occupied_by": []},
    }]
    db.upsert_household_projection("player-1", changed)

    stored = db.get_household("player-1", "household-1")
    assert stored is not None
    assert [item["npc_id"] for item in stored["members"]] == ["ava"]
    assert [item["id"] for item in stored["resources"]] == ["tv-1"]
    assert stored["resources"][0]["capacity"] == 1


def test_life_action_upsert_and_story_observation_never_settle_world_facts(tmp_path):
    db = database(tmp_path)
    action = {
        "id": "action-1", "npc_id": "ava", "type": "prepare_food",
        "status": "performing", "started_at": "2040-01-01T10:00:00+00:00",
        "ends_at": "2040-01-01T10:05:00+00:00", "resource_id": "stove-1",
    }
    db.upsert_life_action("player-1", action)
    completed = {**action, "status": "completed", "result": {"meal": "soup"}}
    db.upsert_life_action("player-1", completed)
    action_row = db._connection.execute(
        "SELECT * FROM npc_life_actions WHERE player_id='player-1' AND id='action-1'"
    ).fetchone()
    assert action_row["status"] == "completed"
    assert json.loads(action_row["action_json"])["result"] == {"meal": "soup"}

    story = {
        "id": "story-1", "story_key": "dishes:ava:bo", "level": "incident",
        "status": "intervention_window", "household_id": "household-1",
        "participant_ids": ["ava", "bo"], "objective_fact": {"dishes_left": 3},
        "intervention_expires_at": "2040-01-01T10:30:00+00:00",
        "resolution_action": None,
    }
    db.upsert_life_story("player-1", story)
    before = db.get_life_story("player-1", "story-1")
    observed = db.observe_life_story("player-1", "story-1")
    observed_again = db.observe_life_story("player-1", "story-1")

    assert before and before["observed"] is False
    assert observed and observed_again and observed["observed"] is True
    assert observed["status"] == before["status"] == "intervention_window"
    assert observed["resolution_action"] is None
    assert observed["objective_fact"] == before["objective_fact"]
    assert db._connection.execute(
        "SELECT COUNT(*) FROM life_story_observations WHERE player_id='player-1' AND story_id='story-1'"
    ).fetchone()[0] == 1
    assert db.observe_life_story("another-player", "story-1") is None


def test_life_story_queries_filter_json_participants_and_household_without_mutating(tmp_path):
    db = database(tmp_path)
    for story in (
        {"id": "moment-a", "level": "moment", "status": "resolved",
         "participant_ids": ["ava", "bo"], "household_id": "home-a"},
        {"id": "incident-b", "level": "incident", "status": "open",
         "participant_ids": ["cy"], "household_id": "home-b"},
    ):
        db.upsert_life_story("player-1", story)
    assert [item["id"] for item in db.list_life_stories("player-1", npc_id="ava")] == ["moment-a"]
    assert [item["id"] for item in db.list_life_stories("player-1", household_id="home-b")] == ["incident-b"]
    assert db.list_life_stories("player-1", level="moment")[0]["status"] == "resolved"


def test_life_intervention_cache_is_scoped_and_first_result_wins(tmp_path):
    db = database(tmp_path)
    response = {"result": "mixed", "participant_responses": {"ava": "accepted", "bo": "refused"}}
    assert db.cached_life_intervention("player-1", "story-1", "request-1") is None
    assert db.save_life_intervention(
        "player-1", "story-1", "request-1", "mediate", response,
    ) == response
    replay = db.save_life_intervention(
        "player-1", "story-1", "request-1", "force_agreement", {"result": "different"},
    )
    assert replay == response
    assert db.cached_life_intervention("player-1", "story-1", "request-1") == response
    assert db.cached_life_intervention("player-1", "story-2", "request-1") is None
    assert db.cached_life_intervention("player-2", "story-1", "request-1") is None
    assert db._connection.execute("SELECT COUNT(*) FROM life_interventions").fetchone()[0] == 1


def test_extended_social_edges_are_directional_bounded_and_have_no_jealousy_column(tmp_path):
    db = database(tmp_path)
    edge_columns = columns(db, "npc_social_edges")
    assert {
        "familiarity", "affinity", "trust", "respect", "comfort", "tension",
        "resentment", "attraction", "dependency", "fear", "friendship_status",
        "conflict_status", "relationship_version",
    } <= edge_columns
    assert "jealousy" not in edge_columns

    db.ensure_social_edges("player-1", ["ava", "bo"])
    changed = db.save_social_edge(
        "player-1", "ava", "bo", respect=120, comfort=-4, resentment=73,
        attraction=68, dependency=41, fear=19, jealousy=100,
    )
    reverse = next(edge for edge in db.ensure_social_edges("player-1", ["ava", "bo"])
                   if edge["npc_a"] == "bo" and edge["npc_b"] == "ava")
    assert changed["respect"] == 100 and changed["comfort"] == 0
    assert changed["resentment"] == 73 and changed["attraction"] == 68
    assert changed["dependency"] == 41 and changed["fear"] == 19
    assert reverse["resentment"] == reverse["attraction"] == reverse["dependency"] == reverse["fear"] == 0


def relationship_pair_projection() -> dict:
    pair = RelationshipPair.initial("ava", "bo")
    pair.a_to_b.familiarity = 82
    pair.a_to_b.affinity = 74
    pair.a_to_b.trust = 69
    pair.a_to_b.respect = 88
    pair.a_to_b.comfort = 67
    pair.a_to_b.tension = 34
    pair.a_to_b.resentment = 21
    pair.a_to_b.attraction = 61
    pair.a_to_b.dependency = 17
    pair.a_to_b.fear = 3
    pair.b_to_a.familiarity = 71
    pair.b_to_a.affinity = 59
    pair.b_to_a.trust = 62
    pair.b_to_a.respect = 53
    pair.b_to_a.comfort = 55
    pair.b_to_a.tension = 46
    pair.b_to_a.resentment = 32
    pair.b_to_a.attraction = 8
    pair.b_to_a.dependency = 10
    pair.b_to_a.fear = 1
    pair.channels = RelationshipChannels(
        friendship="friend", conflict="friction", rivalry="friendly",
        romance="one_sided_interest", history={"ever_friends", "ever_rivals"},
    )
    pair.structural_bonds = [StructuralBond(
        "housemates", "household", ("ava", "bo"),
        {"ava": "housemate", "bo": "housemate"}, scope_id="household-1",
    )]
    return pair.to_dict()


def test_relationship_pair_projection_updates_both_edges_and_all_channels(tmp_path):
    db = database(tmp_path)
    pair = relationship_pair_projection()
    assert db.save_relationship_pair_projection("player-1", pair) == pair
    edges = {(item["npc_a"], item["npc_b"]): item
             for item in db.ensure_social_edges("player-1", ["ava", "bo"])}
    forward, reverse = edges[("ava", "bo")], edges[("bo", "ava")]
    assert (forward["respect"], forward["comfort"], forward["resentment"],
            forward["attraction"], forward["dependency"], forward["fear"]) == (88, 67, 21, 61, 17, 3)
    assert (reverse["respect"], reverse["comfort"], reverse["resentment"],
            reverse["attraction"], reverse["dependency"], reverse["fear"]) == (53, 55, 32, 8, 10, 1)
    assert forward["friendship_status"] == reverse["friendship_status"] == "friend"
    assert forward["conflict_status"] == reverse["conflict_status"] == "friction"
    assert forward["status"] == reverse["status"] == "strained"

    bonds = db.list_relationship_bonds("player-1", "ava")
    active = {(bond["channel"], bond["kind"]) for bond in bonds if bond["state"] == "active"}
    assert active == {
        ("structural", "household"), ("friendship", "friend"),
        ("conflict", "friction"), ("rivalry", "friendly"),
        ("romance", "one_sided_interest"),
    }
    friendship = next(item for item in bonds if item["channel"] == "friendship")
    assert set(friendship["context"]["history"]) == {"ever_friends", "ever_rivals"}


def test_new_channel_bond_ends_previous_state_but_structural_bonds_coexist(tmp_path):
    db = database(tmp_path)
    base = {"participant_ids": ["bo", "ava"], "state": "active"}
    emerging = db.save_relationship_bond(
        "player-1", {**base, "channel": "friendship", "kind": "emerging"},
    )
    friend = db.save_relationship_bond(
        "player-1", {**base, "channel": "friendship", "kind": "friend"},
    )
    db.save_relationship_bond("player-1", {
        **base, "channel": "structural", "kind": "household", "scope_id": "home-1",
    })
    db.save_relationship_bond("player-1", {
        **base, "channel": "structural", "kind": "work", "scope_id": "studio-1",
    })
    bonds = db.list_relationship_bonds("player-1")
    old = next(item for item in bonds if item["id"] == emerging["id"])
    current = next(item for item in bonds if item["id"] == friend["id"])
    structural = [item for item in bonds if item["channel"] == "structural"]
    assert old["state"] == "ended" and old["ended_at"] is not None
    assert current["state"] == "active" and current["ended_at"] is None
    assert len(structural) == 2 and all(item["state"] == "active" for item in structural)
    assert all(item["pair_key"] == "ava:bo" for item in bonds)


def test_relationship_pair_projection_ends_replaced_and_cleared_channel_states(tmp_path):
    db = database(tmp_path)
    pair = relationship_pair_projection()
    db.save_relationship_pair_projection("player-1", pair)

    changed = relationship_pair_projection()
    changed["channels"] = {
        "friendship": "close_friend", "conflict": "none",
        "rivalry": "none", "romance": "none", "history": ["ever_friends"],
    }
    db.save_relationship_pair_projection("player-1", changed)

    bonds = db.list_relationship_bonds("player-1")
    active = {(item["channel"], item["kind"]) for item in bonds if item["state"] == "active"}
    assert active == {("structural", "household"), ("friendship", "close_friend")}
    ended = {(item["channel"], item["kind"]) for item in bonds if item["state"] == "ended"}
    assert {
        ("friendship", "friend"), ("conflict", "friction"),
        ("rivalry", "friendly"), ("romance", "one_sided_interest"),
    } <= ended


def test_relationship_evidence_is_semantically_deduplicated_and_jealousy_stays_contextual(tmp_path):
    db = database(tmp_path)
    assert "jealousy" not in columns(db, "relationship_evidence")
    evidence = {
        "id": "evidence-1", "fact_id": "party-1", "source_npc_id": "ava",
        "target_npc_id": "bo", "kind": "jealousy_context", "magnitude": .7,
        "appraisal": {"perceived_intent": "unknown", "confidence": .8},
        "deltas": {"tension": 3, "dependency": 1},
        "context": {"third_party_id": "cy", "thread_id": "excluded-from-party"},
        "rules_version": "relationships-v2",
    }
    _, inserted = db.append_relationship_evidence("player-1", evidence)
    _, replayed = db.append_relationship_evidence("player-1", evidence)
    semantically_same = {**evidence, "id": "another-id", "magnitude": .9}
    _, duplicate_fact = db.append_relationship_evidence("player-1", semantically_same)
    assert inserted is True and replayed is False and duplicate_fact is False

    rows = db.list_relationship_evidence("player-1", "ava", "bo")
    assert len(rows) == 1
    assert rows[0]["context"] == {"third_party_id": "cy", "thread_id": "excluded-from-party"}
    assert rows[0]["deltas"] == {"tension": 3, "dependency": 1}
    assert db.list_relationship_evidence("player-1", source_npc_id="cy") == []
