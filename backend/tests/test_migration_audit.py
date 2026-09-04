from copy import deepcopy
import json
import sqlite3

from fastapi.testclient import TestClient
import pytest

from lingolife.app import create_app
from lingolife.config import Settings
from lingolife.db import Database
from lingolife.life_service import LifeWorldService
from lingolife.migration_audit import (
    compare_player_fact_snapshots,
    player_fact_snapshot,
    roster_review,
)


def _profile(name: str):
    return {
        "name": name, "age": 28, "relationship": "Friend",
        "personality": ["warm"], "interests": ["art"], "occupation": "Designer",
        "longTermGoal": "Make something meaningful.",
        "romanceEnabled": True, "relationshipBoundaries": [],
        "avatar": {"model": "city-01", "hair": "hair-variant", "hairColor": "#563B38",
                   "face": "round", "skin": "#F2C7A5", "eyes": "dot", "brows": "soft",
                   "nose": "button", "mouth": "smile", "outfit": "hoodie",
                   "outfitColor": "#7A9CC6", "pants": "shorts", "accessory": "none", "strokes": []},
    }


def _legacy_rows(db: Database, count: int):
    player = "legacy-player"
    with db._connection:
        db._connection.execute("INSERT OR IGNORE INTO players(id) VALUES (?)", (player,))
        for index in range(count):
            npc_id = f"npc-{index + 1}"
            db._connection.execute(
                "INSERT INTO npc_profiles(player_id,npc_id,profile_json) VALUES (?,?,?)",
                (player, npc_id, json.dumps(_profile(f"Resident {index + 1}"))),
            )
            db._connection.execute(
                "INSERT OR REPLACE INTO npc_states(player_id,npc_id,relationship,mood,english_xp) VALUES (?,?,35,50,0)",
                (player, npc_id),
            )
            db._connection.execute(
                "INSERT INTO messages(player_id,npc_id,speaker,text) VALUES (?,?,'npc',?)",
                (player, npc_id, f"Memory-bearing message {index + 1}"),
            )
            db._connection.execute(
                "INSERT INTO npc_memories(player_id,npc_id,kind,content) VALUES (?,?,'life',?)",
                (player, npc_id, f"Memory {index + 1}"),
            )
    return player


def _pre_v5_database(path, count: int, *, orphaned_household_member: bool = False):
    connection = sqlite3.connect(path)
    connection.executescript("""
        CREATE TABLE players (
          id TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE npc_profiles (
          player_id TEXT NOT NULL,npc_id TEXT NOT NULL,profile_json TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY(player_id,npc_id)
        );
    """)
    connection.execute("INSERT INTO players(id) VALUES ('legacy-player')")
    for index in range(count):
        connection.execute(
            "INSERT INTO npc_profiles(player_id,npc_id,profile_json) VALUES ('legacy-player',?,?)",
            (f"npc-{index + 1}", json.dumps(_profile(f"Resident {index + 1}"))),
        )
    if orphaned_household_member:
        connection.executescript("""
            CREATE TABLE household_members (
              household_id TEXT NOT NULL,player_id TEXT NOT NULL,npc_id TEXT NOT NULL,
              private_room_id TEXT,role_json TEXT NOT NULL DEFAULT '{}',
              joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY(household_id,npc_id),UNIQUE(player_id,npc_id)
            );
            INSERT INTO household_members(household_id,player_id,npc_id)
            VALUES ('old-home','legacy-player','ghost-resident');
        """)
    connection.commit()
    connection.close()


def test_snapshot_covers_gdd_protected_facts_without_returning_private_rows(tmp_path):
    db = Database(f"sqlite:///{tmp_path / 'audit.db'}")
    player = _legacy_rows(db, 2)
    with db._connection:
        db._connection.execute(
            "INSERT INTO learning_states(player_id,state_json) VALUES (?,?)",
            (player, json.dumps({"version": 1, "targets": {}})),
        )

    snapshot = player_fact_snapshot(db._connection, player)

    assert snapshot["resident_count"] == 2
    assert snapshot["preserved_npc_ids"] == ["npc-1", "npc-2"]
    assert snapshot["tables"]["messages"]["count"] == 2
    assert snapshot["tables"]["npc_memories"]["count"] == 2
    assert snapshot["tables"]["learning_states"]["count"] == 1
    assert {"life_world_states", "residences", "households", "household_members",
            "household_resources"} <= set(snapshot["tables"])
    assert snapshot["tables"]["messages"]["classification"] == "protected_fact"
    assert snapshot["tables"]["households"]["classification"] == "migration_projection"
    assert len(snapshot["protected_facts_sha256"]) == 64
    assert "rows" not in json.dumps(snapshot)
    assert "Memory-bearing message" not in json.dumps(snapshot)


def test_over_capacity_roster_is_reported_without_silently_archiving_anyone(tmp_path):
    db = Database(f"sqlite:///{tmp_path / 'over-capacity.db'}")
    player = _legacy_rows(db, 10)
    before = player_fact_snapshot(db._connection, player)

    review = roster_review(before)
    after = player_fact_snapshot(db._connection, player)

    assert review["status"] == "needs_roster_review"
    assert review["active_selection_required"] is True
    assert review["required_archive_count"] == 2
    assert review["preserved_npc_ids"] == before["preserved_npc_ids"]
    assert after == before


def test_zero_or_one_resident_requires_onboarding_and_two_to_eight_are_eligible(tmp_path):
    for count, expected in ((0, "needs_onboarding"), (1, "needs_onboarding"),
                            (2, "eligible"), (8, "eligible")):
        db = Database(f"sqlite:///{tmp_path / f'roster-{count}.db'}")
        player = _legacy_rows(db, count)
        assert roster_review(player_fact_snapshot(db._connection, player))["status"] == expected


def test_comparison_detects_even_count_preserving_fact_rewrites(tmp_path):
    db = Database(f"sqlite:///{tmp_path / 'rewrite.db'}")
    player = _legacy_rows(db, 2)
    before = player_fact_snapshot(db._connection, player)
    with db._connection:
        db._connection.execute(
            "UPDATE messages SET text='silently rewritten' WHERE player_id=? AND id=(SELECT min(id) FROM messages WHERE player_id=?)",
            (player, player),
        )
    after = player_fact_snapshot(db._connection, player)

    report = compare_player_fact_snapshots(before, after)
    assert report["verified"] is False
    assert report["unexpected_changes"] == [{
        "table": "messages", "before_count": 2, "after_count": 2,
        "count_delta": 0, "allowed": False,
        "removed_row_count": 1, "added_row_count": 1,
    }]


def test_comparison_can_explicitly_allow_a_documented_projection_change(tmp_path):
    db = Database(f"sqlite:///{tmp_path / 'allowed.db'}")
    player = _legacy_rows(db, 2)
    before = player_fact_snapshot(db._connection, player)
    with db._connection:
        db._connection.execute(
            "UPDATE npc_runtime_states SET state_json=? WHERE player_id=?",
            (json.dumps({"migration_marker": True}), player),
        )
    # Insert a runtime row when the legacy fixture did not have one.
    if player_fact_snapshot(db._connection, player)["tables"]["npc_runtime_states"]["count"] == 0:
        with db._connection:
            db._connection.execute(
                "INSERT INTO npc_runtime_states(player_id,npc_id,state_json) VALUES (?,?,?)",
                (player, "npc-1", json.dumps({"migration_marker": True})),
            )
    after = player_fact_snapshot(db._connection, player)

    report = compare_player_fact_snapshots(
        deepcopy(before), after, allowed_changed_tables={"npc_runtime_states"},
    )
    assert report["verified"] is True
    assert report["unexpected_changes"] == []
    assert report["changed_tables"][0]["allowed"] is True


@pytest.mark.parametrize(
    ("count", "expected"),
    ((0, "needs_onboarding"), (1, "needs_onboarding"),
     (2, "ready"), (8, "ready"), (10, "needs_roster_review")),
)
def test_pre_v5_database_is_inventoried_once_on_open(tmp_path, count, expected):
    path = tmp_path / f"pre-v5-{count}.db"
    _pre_v5_database(path, count)

    db = Database(f"sqlite:///{path}")
    migration = db.roster_migration("legacy-player")

    assert migration is not None
    assert migration["status"] == expected
    assert migration["revision"] == 1
    assert migration["report_count"] == 1
    assert len(migration["candidates"]) == count
    assert db._connection.execute(
        "SELECT count(*) FROM schema_migrations WHERE version=5"
    ).fetchone()[0] == 1
    assert db.onboarding_state("legacy-player")["completed"] is (expected == "ready")

    # Reopening must not create another inventory report or pick a new cast.
    db._connection.close()
    reopened = Database(f"sqlite:///{path}")
    replay = reopened.roster_migration("legacy-player")
    assert replay is not None
    assert replay["revision"] == 1
    assert replay["report_count"] == 1


def _attach_legacy_user(db: Database, player: str, username: str = "legacy-ten"):
    with db._connection:
        db._connection.execute(
            """INSERT INTO users(
                 id,username,player_id,password_hash,daily_quota,last_active_at)
               VALUES ('legacy-user',?,?,?,30,CURRENT_TIMESTAMP)""",
            (username, player, db.password_hash("password")),
        )


def test_ten_residents_require_explicit_selection_and_archive_without_deletion(tmp_path):
    path = tmp_path / "selection.db"
    db = Database(f"sqlite:///{path}")
    player = _legacy_rows(db, 10)
    _attach_legacy_user(db, player)
    migration = db.inventory_roster_migration(player)
    original = player_fact_snapshot(db._connection, player)

    assert migration["status"] == "needs_roster_review"
    assert db.onboarding_state(player)["completed"] is False
    with pytest.raises(ValueError, match="ROSTER_MIGRATION_REQUIRED"):
        db.simulation_npc_profiles(player)

    active = [f"npc-{index}" for index in range(1, 9)]
    selected = db.select_active_roster(
        "legacy-user", active, expected_revision=1,
        confirm_username="legacy-ten", request_key="selection-request-1",
    )

    assert selected["status"] == "ready"
    assert selected["active_npc_ids"] == active
    assert selected["archived_npc_ids"] == ["npc-10", "npc-9"]
    assert len(db.simulation_npc_profiles(player)) == 8
    assert len(db.list_npc_profiles(player)) == 10
    assert player_fact_snapshot(db._connection, player) == original
    reports = db.roster_migration_reports(player)
    assert [report["action"] for report in reports] == ["select_active_roster", "inventory"]
    assert all(report["comparison"]["verified"] for report in reports)
    assert {"npc_profiles", "messages", "npc_memories", "life_world_states",
            "households", "residences", "household_resources"} <= set(
                reports[0]["before_snapshot"]["tables"]
            )

    # A retry after a lost response is accepted even with the old CAS revision.
    replay = db.select_active_roster(
        "legacy-user", active, expected_revision=1,
        confirm_username="legacy-ten", request_key="selection-request-1",
    )
    assert replay["idempotent_replay"] is True
    assert replay["revision"] == 2
    assert len(db.roster_migration_reports(player)) == 2
    db._connection.close()
    reopened = Database(f"sqlite:///{path}")
    persisted = reopened.roster_migration(player)
    assert persisted is not None and persisted["status"] == "ready"
    assert persisted["active_npc_ids"] == active
    assert len(reopened.list_npc_profiles(player)) == 10
    assert len(reopened.roster_migration_reports(player)) == 2


def test_selection_failure_rolls_back_state_and_keeps_original_report(tmp_path, monkeypatch):
    db = Database(f"sqlite:///{tmp_path / 'rollback.db'}")
    player = _legacy_rows(db, 10)
    _attach_legacy_user(db, player)
    before = db.inventory_roster_migration(player)
    original_writer = db._write_roster_migration_report

    def fail_report(**_values):
        raise RuntimeError("injected report failure")

    monkeypatch.setattr(db, "_write_roster_migration_report", fail_report)
    with pytest.raises(RuntimeError, match="injected report failure"):
        db.select_active_roster(
            "legacy-user", [f"npc-{index}" for index in range(1, 9)],
            expected_revision=1, confirm_username="legacy-ten",
        )
    monkeypatch.setattr(db, "_write_roster_migration_report", original_writer)

    after = db.roster_migration(player)
    assert after is not None
    assert after["status"] == before["status"] == "needs_roster_review"
    assert after["revision"] == before["revision"] == 1
    assert after["active_npc_ids"] == []
    assert len(db.roster_migration_reports(player)) == 1


def test_test_account_reset_retires_current_state_but_preserves_audit_reports(tmp_path):
    db = Database(f"sqlite:///{tmp_path / 'audit-retention.db'}")
    player = _legacy_rows(db, 10)
    _attach_legacy_user(db, player, "onboarding-test-legacy")
    db.inventory_roster_migration(player)
    db.select_active_roster(
        "legacy-user", [f"npc-{index}" for index in range(1, 9)],
        expected_revision=1, confirm_username="onboarding-test-legacy",
    )
    report_ids = [item["id"] for item in db.roster_migration_reports(player)]

    db.reset_user_game_progress("legacy-user", "onboarding-test-legacy")

    assert db.roster_migration(player) is None
    retained = db.roster_migration_reports_for_user("legacy-user")
    assert retained is not None
    assert [item["id"] for item in retained["reports"]] == report_ids


def test_invalid_pre_v5_fixture_is_quarantined_instead_of_crashing_startup(tmp_path):
    path = tmp_path / "invalid-pre-v5.db"
    _pre_v5_database(path, 2, orphaned_household_member=True)

    db = Database(f"sqlite:///{path}")
    migration = db.roster_migration("legacy-player")

    assert migration is not None
    assert migration["status"] == "blocked_invalid_fixture"
    assert migration["integrity"]["valid"] is False
    assert migration["integrity"]["issues"][0]["code"] == "ORPHAN_NPC_REFERENCE"
    assert db.onboarding_state("legacy-player")["completed"] is False
    with pytest.raises(ValueError, match="ROSTER_MIGRATION_REQUIRED"):
        db.simulation_npc_profiles("legacy-player")
    report = db.roster_migration_reports("legacy-player")[0]
    assert report["error_code"] == "INVALID_LEGACY_FIXTURE"


def test_shared_household_rebuild_simulates_only_active_cast_and_keeps_all_profiles(tmp_path):
    db = Database(f"sqlite:///{tmp_path / 'world-rebuild.db'}")
    player = _legacy_rows(db, 10)
    _attach_legacy_user(db, player)
    db.inventory_roster_migration(player)
    db.select_active_roster(
        "legacy-user", [f"npc-{index}" for index in range(1, 9)],
        expected_revision=1, confirm_username="legacy-ten",
    )
    service = LifeWorldService(db, "Asia/Shanghai")

    city = service.city(player, db.simulation_npc_profiles(player))
    verified = db.verify_roster_world_reconciliation(player)

    assert len(city["npcs"]) == 8
    assert {npc["id"] for npc in city["npcs"]} == {f"npc-{index}" for index in range(1, 9)}
    assert len(db.list_npc_profiles(player)) == 10
    households = db.list_households(player)
    assert len(households) == 1
    assert len(households[0]["members"]) == 8
    assert verified is not None and verified["status"] == "ready"
    assert verified["review"]["world_verified"] is True
    assert verified["review"]["all_legacy_npc_ids_preserved"] is True
    assert db.roster_migration_reports(player)[0]["action"] == "verify_shared_household"


def test_admin_can_audit_and_resolve_roster_before_world_is_allowed(tmp_path):
    client = TestClient(create_app(Settings(
        database_url=f"sqlite:///{tmp_path / 'migration-api.db'}",
        web_root=str(tmp_path / "missing-web"), life_simulation_v2=True,
        admin_password="test-admin", admin_session_secret="test-secret",
        admin_cookie_secure=False,
    )))
    db = client.app.state.db
    player = _legacy_rows(db, 10)
    _attach_legacy_user(db, player)
    db.refresh_onboarding(player, force_complete=True)
    db.inventory_roster_migration(player)
    token = db.create_session("legacy-user")
    auth = {"Authorization": f"Bearer {token}"}
    origin = {"Origin": "https://lingolife.admin.shimooth.me"}

    blocked = client.get("/api/v1/city", headers=auth)
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "ROSTER_REVIEW_REQUIRED"
    assert client.post(
        "/api/v1/admin/login", headers=origin, json={"password": "test-admin"},
    ).status_code == 200
    listing = client.get(
        "/api/v1/admin/roster-migrations?status=needs_roster_review",
    )
    assert listing.status_code == 200
    assert listing.json()["migrations"][0]["username"] == "legacy-ten"
    detail = client.get("/api/v1/admin/users/legacy-user/roster-migration")
    assert detail.status_code == 200
    assert detail.json()["reports"][0]["action"] == "inventory"

    path = "/api/v1/admin/users/legacy-user/roster-migration/select"
    body = {
        "active_npc_ids": [f"npc-{index}" for index in range(1, 9)],
        "expected_revision": 1, "confirm_username": "legacy-ten",
        "note": "API test selection", "request_key": "api-selection-001",
    }
    assert client.post(path, json=body).status_code == 403
    selected = client.post(path, headers=origin, json=body)
    assert selected.status_code == 200, selected.text
    assert selected.json()["archived_npc_ids"] == ["npc-10", "npc-9"]

    city = client.get("/api/v1/city", headers=auth)
    assert city.status_code == 200, city.text
    assert len(city.json()["npcs"]) == 8
    assert len(client.get("/api/v1/npcs", headers=auth).json()["npcs"]) == 8
    assert len(db.list_npc_profiles(player)) == 10
    final_detail = client.get("/api/v1/admin/users/legacy-user/roster-migration").json()
    assert final_detail["status"] == "ready"
    assert final_detail["reports"][0]["action"] == "verify_shared_household"
