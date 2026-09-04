"""Read-only, checksum-backed audit for shared-household migrations.

Migration code is allowed to reconcile current housing projections, but it is
not allowed to silently discard the player's established world.  These helpers
take before/after snapshots using the same SQLite connection and produce a
machine-readable report that can be persisted or exposed by an admin adapter.
They never mutate the database themselves.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from typing import Any, Collection, Mapping, Sequence


AUDIT_VERSION = "single-household-audit-v2"
MIGRATION_VERSION = "single-household-v1"

# These tables contain the facts that the GDD explicitly says a housing
# migration must preserve byte-for-byte during roster selection. Housing and
# authoritative-world rows are classified separately below because their
# current residence references are the part migration is allowed to reconcile.
PROTECTED_PLAYER_TABLES: Mapping[str, str] = {
    "npc_profiles": "player_id",
    "npc_states": "player_id",
    "messages": "player_id",
    "chat_requests": "player_id",
    "npc_memories": "player_id",
    "active_events": "player_id",
    "event_history": "player_id",
    "learning_states": "player_id",
    "npc_personas": "player_id",
    "npc_runtime_states": "player_id",
    "npc_relationships": "player_id",
    "npc_goals": "player_id",
    "npc_daily_plans": "player_id",
    "npc_social_edges": "player_id",
    "npc_social_events": "player_id",
    "conversation_summaries": "player_id",
    "npc_desires": "player_id",
    "npc_life_actions": "player_id",
    "life_stories": "player_id",
    "life_story_observations": "player_id",
    "life_interventions": "player_id",
    "unresolved_threads": "player_id",
    "npc_relationship_bonds": "player_id",
    "relationship_evidence": "player_id",
}

# These rows are still audited, but the shared-household migration is expected
# to rebuild them.  Keeping them in the same snapshot makes that change visible
# (including the before/after checksum) without pretending that a projection
# rewrite is data loss.
MIGRATION_PROJECTION_TABLES: Mapping[str, str] = {
    "life_world_states": "player_id",
    "residences": "player_id",
    "households": "player_id",
    "household_members": "player_id",
    "household_resources": "player_id",
    "player_onboarding": "player_id",
}

AUDITED_PLAYER_TABLES: Mapping[str, str] = {
    **PROTECTED_PLAYER_TABLES,
    **MIGRATION_PROJECTION_TABLES,
}

DIRECT_NPC_REFERENCES: Mapping[str, tuple[str, ...]] = {
    "npc_states": ("npc_id",),
    "messages": ("npc_id",),
    "npc_memories": ("npc_id",),
    "active_events": ("npc_id",),
    "event_history": ("npc_id",),
    "npc_personas": ("npc_id",),
    "npc_runtime_states": ("npc_id",),
    "npc_relationships": ("npc_id",),
    "npc_goals": ("npc_id",),
    "npc_daily_plans": ("npc_id",),
    "npc_desires": ("npc_id",),
    "npc_life_actions": ("npc_id",),
    "npc_social_edges": ("npc_a", "npc_b"),
    "household_members": ("npc_id",),
}


def _tables(connection: sqlite3.Connection) -> set[str]:
    return {
        str(row[0]) for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }


def _columns(connection: sqlite3.Connection, table: str) -> tuple[str, ...]:
    # ``table`` always comes from our static allowlist, never user input.
    return tuple(str(row[1]) for row in connection.execute(f"PRAGMA table_info({table})"))


def _normalized(value: object) -> object:
    if isinstance(value, bytes):
        return {"bytes_sha256": hashlib.sha256(value).hexdigest(), "length": len(value)}
    return value


def _table_rows(
    connection: sqlite3.Connection, table: str, player_column: str, player_id: str,
) -> list[dict[str, Any]]:
    columns = _columns(connection, table)
    if player_column not in columns:
        return []
    rows = connection.execute(
        f"SELECT * FROM {table} WHERE {player_column}=?", (player_id,),
    ).fetchall()
    normalized = [
        {column: _normalized(row[index]) for index, column in enumerate(columns)}
        for row in rows
    ]
    return sorted(
        normalized,
        key=lambda value: json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
    )


def _digest(rows: Sequence[Mapping[str, Any]]) -> str:
    payload = json.dumps(rows, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _row_digests(rows: Sequence[Mapping[str, Any]]) -> list[str]:
    return sorted(_digest([row]) for row in rows)


def player_fact_snapshot(connection: sqlite3.Connection, player_id: str) -> dict[str, Any]:
    """Capture deterministic counts and hashes without exposing row contents."""
    available = _tables(connection)
    table_facts: dict[str, dict[str, Any]] = {}
    for table, player_column in AUDITED_PLAYER_TABLES.items():
        if table not in available:
            continue
        rows = _table_rows(connection, table, player_column, player_id)
        table_facts[table] = {
            "count": len(rows),
            "sha256": _digest(rows),
            # Row fingerprints let an audit distinguish additions from loss
            # without placing profile, message or memory content in a report.
            "row_sha256": _row_digests(rows),
            "classification": (
                "migration_projection"
                if table in MIGRATION_PROJECTION_TABLES else "protected_fact"
            ),
        }

    profile_rows = (
        _table_rows(connection, "npc_profiles", "player_id", player_id)
        if "npc_profiles" in available else []
    )
    npc_ids = sorted(str(row.get("npc_id")) for row in profile_rows if row.get("npc_id"))
    combined = _digest([
        {"table": table, **facts} for table, facts in sorted(table_facts.items())
    ])
    return {
        "audit_version": AUDIT_VERSION,
        "player_id": player_id,
        "resident_count": len(npc_ids),
        "preserved_npc_ids": npc_ids,
        "tables": table_facts,
        "protected_facts_sha256": combined,
    }


def inspect_player_integrity(connection: sqlite3.Connection, player_id: str) -> dict[str, Any]:
    """Find fixture corruption that must block an automatic migration.

    Direct foreign keys were intentionally not added to the early demo schema,
    so this check closes that historical gap before selecting a simulation cast.
    It reports identifiers only; private profile/message contents stay hidden.
    """
    available = _tables(connection)
    profiles = {
        str(row[0]) for row in connection.execute(
            "SELECT npc_id FROM npc_profiles WHERE player_id=?", (player_id,),
        ).fetchall()
    } if "npc_profiles" in available else set()
    issues: list[dict[str, Any]] = []
    for table, reference_columns in DIRECT_NPC_REFERENCES.items():
        if table not in available:
            continue
        columns = set(_columns(connection, table))
        for column in reference_columns:
            if column not in columns:
                continue
            rows = connection.execute(
                f"SELECT DISTINCT {column} FROM {table} "
                f"WHERE player_id=? AND {column} IS NOT NULL AND trim({column})<>''",
                (player_id,),
            ).fetchall()
            orphaned = sorted(str(row[0]) for row in rows if str(row[0]) not in profiles)
            if not profiles and table in {"npc_states", "messages"}:
                # The earliest account bootstrap stored a placeholder Emma
                # greeting before a profile existed. It is preserved but does
                # not turn an otherwise empty roster into corrupt data.
                orphaned = [npc_id for npc_id in orphaned if npc_id != "emma"]
            if orphaned:
                issues.append({
                    "code": "ORPHAN_NPC_REFERENCE", "table": table,
                    "column": column, "npc_ids": orphaned,
                })

    json_columns = {
        "npc_profiles": "profile_json",
        "life_world_states": "state_json", "residences": "state_json",
        "households": "state_json", "household_members": "role_json",
        "household_resources": "state_json", "player_onboarding": "state_json",
    }
    for table, column in json_columns.items():
        if table not in available or column not in _columns(connection, table):
            continue
        for row in connection.execute(
            f"SELECT rowid,{column} FROM {table} WHERE player_id=?", (player_id,),
        ).fetchall():
            try:
                value = json.loads(row[1] or "{}")
                if not isinstance(value, dict):
                    raise ValueError("expected object")
            except (TypeError, ValueError, json.JSONDecodeError):
                issues.append({
                    "code": "INVALID_JSON_PROJECTION", "table": table,
                    "row_id": str(row[0]),
                })
    return {"valid": not issues, "issues": issues}


def roster_review(snapshot: Mapping[str, Any], *, minimum: int = 2, maximum: int = 8) -> dict[str, Any]:
    count = int(snapshot.get("resident_count", 0))
    npc_ids = list(snapshot.get("preserved_npc_ids") or [])
    if count < minimum:
        status = "needs_onboarding"
    elif count > maximum:
        status = "needs_roster_review"
    else:
        status = "eligible"
    return {
        "status": status,
        "resident_count": count,
        "minimum": minimum,
        "maximum": maximum,
        "preserved_npc_ids": npc_ids,
        # Deliberately do not choose whom to archive. That is a material player
        # or administrator decision; the migration must report it instead.
        "active_selection_required": count > maximum,
        "required_archive_count": max(0, count - maximum),
    }


def compare_player_fact_snapshots(
    before: Mapping[str, Any],
    after: Mapping[str, Any],
    *,
    allowed_changed_tables: Collection[str] = (),
) -> dict[str, Any]:
    """Explain protected fact loss/change instead of silently accepting it."""
    if before.get("player_id") != after.get("player_id"):
        raise ValueError("cannot compare snapshots from different players")
    allowed = set(allowed_changed_tables)
    before_tables = dict(before.get("tables") or {})
    after_tables = dict(after.get("tables") or {})
    changed: list[dict[str, Any]] = []
    for table in sorted(set(before_tables) | set(after_tables)):
        old = dict(before_tables.get(table) or {"count": 0, "sha256": _digest([])})
        new = dict(after_tables.get(table) or {"count": 0, "sha256": _digest([])})
        if old.get("count") != new.get("count") or old.get("sha256") != new.get("sha256"):
            before_rows = set(old.get("row_sha256") or [])
            after_rows = set(new.get("row_sha256") or [])
            changed.append({
                "table": table,
                "before_count": int(old.get("count", 0)),
                "after_count": int(new.get("count", 0)),
                "count_delta": int(new.get("count", 0)) - int(old.get("count", 0)),
                "allowed": table in allowed,
                "removed_row_count": len(before_rows - after_rows),
                "added_row_count": len(after_rows - before_rows),
            })
    destructive = [item for item in changed if not item["allowed"]]
    return {
        "audit_version": AUDIT_VERSION,
        "player_id": before.get("player_id"),
        "verified": not destructive,
        "changed_tables": changed,
        "unexpected_changes": destructive,
        "before_sha256": before.get("protected_facts_sha256"),
        "after_sha256": after.get("protected_facts_sha256"),
    }
