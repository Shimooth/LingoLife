#!/usr/bin/env python3
"""Review, then explicitly publish a town layout without resetting any player.

plan is read-only. apply requires the reviewed artifact, exact active version,
and a new SQLite backup path. Existing publication history remains available for
rollback through the layout editor. No service restart or player migration is
performed here.
"""
from __future__ import annotations

import argparse
from dataclasses import asdict
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lingolife.layout_runtime import city_route, compile_city_runtime
from lingolife.layout_validation import load_world_asset_catalog, validate_layout_topology
from lingolife.layouts import shared_home_manifest
from lingolife.models import WorldLayout
from lingolife.town_layout import plan_resident_town, town_plan_changes


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def digest(value):
    return hashlib.sha256(encoded(value).encode("utf-8")).hexdigest()


def current(connection):
    row = connection.execute("""SELECT v.id,v.layout_json FROM world_layout_active a
        JOIN world_layout_versions v ON v.id=a.version_id WHERE a.scope='global'""").fetchone()
    if not row:
        raise ValueError("没有已发布布局；请先初始化世界")
    return row[0], json.loads(row[1])


def validate(before, after):
    WorldLayout.model_validate(after)
    if before["city"]["roads"] != after["city"]["roads"] or before["interior"] != after["interior"]:
        raise ValueError("规划不得修改道路或室内布局")
    for field in ("id", "location_id"):
        if {item.get(field) for item in before["city"]["buildings"]} != {item.get(field) for item in after["city"]["buildings"]}:
            raise ValueError(f"规划丢失建筑 {field}")
    report = validate_layout_topology(after, shared_home_manifest(), load_world_asset_catalog())
    runtime = compile_city_runtime(after)
    for identifier in runtime["locations"]:
        if city_route(runtime, "shared-home", identifier) is None:
            raise ValueError(f"迁居后地点不可达：{identifier}")
    return {"valid": True, "issues": [], "report": asdict(report),
            "roads_unchanged": True, "interiors_unchanged": True,
            "location_count": len(runtime["locations"]), "all_locations_reachable": True}


def write_private(path, value):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        json.dump(value, output, ensure_ascii=False, indent=2)
        output.write("\n")


def make_plan(database, output):
    with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as connection:
        version, before = current(connection)
    after = plan_resident_town(before)
    artifact = {"schema_version": 1, "source_version": version,
                "source_hash": digest(before), "planned_hash": digest(after),
                "layout": after, "validation": validate(before, after),
                "changes": town_plan_changes(before, after)}
    write_private(output, artifact)
    return {"mode": "plan", "source_version": version, "plan": str(output),
            "changes": [{"layer": item["layer"], "id": item["id"]} for item in artifact["changes"]],
            "validation": artifact["validation"]}


def apply_plan(database, artifact_path, expected_version, backup):
    artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
    if artifact["source_version"] != expected_version or digest(artifact["layout"]) != artifact["planned_hash"]:
        raise ValueError("规划文件版本或内容摘要不匹配，请重新审查规划")
    with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as source:
        version, before = current(source)
        if version != expected_version or digest(before) != artifact["source_hash"]:
            raise ValueError("当前发布版本已变化；未应用，请重新生成规划")
        validation = validate(before, artifact["layout"])
        if before == artifact["layout"]:
            return {"mode": "apply", "changed": False, "active_version": version}
        descriptor = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.close(descriptor)
        with sqlite3.connect(backup) as destination:
            source.backup(destination)
    after = artifact["layout"]
    version_id = f"layout-{digest(after)}"
    note, author = "社区改造：中心广场与统一居民尺度", "resident-town-migration"
    # Serialize version comparison and activation with every concurrent layout
    # writer. There is no read/check/publish gap after BEGIN IMMEDIATE.
    with sqlite3.connect(database) as connection:
        connection.execute("BEGIN IMMEDIATE")
        locked_version, locked_layout = current(connection)
        if locked_version != expected_version or digest(locked_layout) != artifact["source_hash"]:
            raise ValueError("备份后发布版本变化；未应用，请重新生成规划")
        connection.execute("""INSERT OR IGNORE INTO world_layout_versions
            (id,layout_hash,layout_json,note,author,is_default,validation_json)
            VALUES (?,?,?,?,?,0,?)""", (version_id, digest(after), encoded(after), note, author, encoded(validation)))
        connection.execute("""UPDATE world_layout_active SET version_id=?,activated_by=?,
            activation_note=?,activated_at=CURRENT_TIMESTAMP WHERE scope='global'""", (version_id, author, note))
        connection.execute("""INSERT INTO world_layout_audit
            (action,version_id,previous_version_id,note,author) VALUES ('publish',?,?,?,?)""",
            (version_id, expected_version, note, author))
    return {"mode": "apply", "changed": True, "active_version": version_id,
            "rollback_version": expected_version, "backup": str(backup), "validation": validation}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, required=True)
    actions = parser.add_subparsers(dest="action", required=True)
    plan = actions.add_parser("plan")
    plan.add_argument("--out", type=Path, required=True)
    apply = actions.add_parser("apply")
    apply.add_argument("--plan", type=Path, required=True)
    apply.add_argument("--expect-version", required=True)
    apply.add_argument("--backup", type=Path, required=True)
    args = parser.parse_args()
    database = args.db.resolve(strict=True)
    result = make_plan(database, args.out) if args.action == "plan" else apply_plan(
        database, args.plan, args.expect_version, args.backup)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
