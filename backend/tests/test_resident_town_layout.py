from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import sqlite3

import pytest

from lingolife import layouts
from lingolife.layout_runtime import city_route, compile_city_runtime
from lingolife.layout_validation import LayoutTopologyError, load_world_asset_catalog, validate_layout_topology
from lingolife.models import WorldLayout
from lingolife.town_layout import plan_resident_town, town_center_config


def legacy_layout():
    return {"version": 1, "city": {"roads": layouts._default_roads(),
            "buildings": layouts._default_buildings(), "props": layouts._default_props(),
            "decorations": layouts._default_decorations()}, "interior": {"rooms": layouts._default_rooms()}}


def validate(layout):
    return validate_layout_topology(layout, layouts.shared_home_manifest(), load_world_asset_catalog())


def test_town_plan_is_explicit_idempotent_and_preserves_identity_and_unaffected_edits():
    before = legacy_layout()
    filler = next(item for item in before["city"]["buildings"] if item["id"].startswith("fabric-"))
    filler["scale"] = {"x": 1.04, "y": 1.04, "z": 1.04}
    original = deepcopy(before)
    after = plan_resident_town(before)
    assert before == original
    assert after == plan_resident_town(after)
    assert after["city"]["theme"] == "resident-town-v1"
    assert after["city"]["roads"] == before["city"]["roads"]
    assert after["interior"] == before["interior"]
    assert filler == next(item for item in after["city"]["buildings"] if item["id"] == filler["id"])
    for field in ("id", "location_id"):
        assert {item.get(field) for item in before["city"]["buildings"]} == {item.get(field) for item in after["city"]["buildings"]}
    assert WorldLayout.model_validate(before).city.theme is None
    assert validate(after).buildings == 54


def test_new_default_reserves_plaza_and_preserves_connected_traffic_roads():
    default = layouts.default_world_layout()
    assert default["city"]["theme"] == "resident-town-v1"
    report = validate(default)
    assert report.road_tiles == 100 and report.sky_road_exits == 3
    before_runtime = compile_city_runtime(legacy_layout())
    runtime = compile_city_runtime(default)
    assert runtime["road_nodes"] == before_runtime["road_nodes"]
    assert set(runtime["locations"]) == set(before_runtime["locations"])
    assert len(runtime["locations"]) == 37
    for origin in runtime["locations"]:
        for target in runtime["locations"]:
            assert city_route(runtime, origin, target) is not None


def test_center_paths_use_the_shared_walkways_and_do_not_walk_through_fountain():
    runtime = compile_city_runtime(layouts.default_world_layout())
    config = town_center_config()
    allowed_edges = {frozenset((tuple(first), tuple(second))) for path in config["walkways"]
                     for first, second in zip(path["points"], path["points"][1:])}
    for origin, target in (("shared-home", "sunny_plaza"), ("shared-home", "moonlight_cafe"), ("moonlight_cafe", "sunny_plaza")):
        route = city_route(runtime, origin, target)
        assert route["road_node_ids"] == []
        assert all(frozenset((tuple(first), tuple(second))) in allowed_edges for first, second in zip(route["points"], route["points"][1:]))
        assert [0, 6.5] not in route["points"]
    assert city_route(runtime, "shared-home", "sunny_plaza")["distance"] == 5.95
    assert city_route(runtime, "shared-home", "moonlight_cafe")["distance"] == 7.3


@pytest.mark.parametrize("position,code", [((0, 6.5), "town.facility_blocked"), ((-2.6, 4.9), "town.walkway_blocked")])
def test_unknown_authored_obstacles_are_reported_and_never_silently_removed(position, code):
    before = legacy_layout()
    obstacle = {"id": "user-authored-bench", "asset": "/assets/world/kaykit-city/gltf/bench.gltf",
                "position": {"x": position[0], "y": .37, "z": position[1]},
                "rotation": {"x": 0, "y": 0, "z": 0}, "scale": {"x": 1, "y": 1, "z": 1}}
    before["city"]["props"].append(obstacle)
    after = plan_resident_town(before)
    assert obstacle in after["city"]["props"]
    with pytest.raises(LayoutTopologyError) as error:
        validate(after)
    assert code in {issue.code for issue in error.value.issues}


def test_legacy_lane_cars_move_to_legal_parking_and_share_vehicle_scale():
    before = legacy_layout()
    car = next(item for item in before["city"]["props"] if item["id"] == "car-taxi-centre")
    car["position"].update(x=1.1, y=.37, z=.28)
    car["rotation"]["y"] = 1.5708
    after = plan_resident_town(before)
    validate(after)
    cars = [item for item in after["city"]["props"] if "/car_" in item["asset"]]
    assert all(item["scale"] == {"x": 1.08, "y": 1.08, "z": 1.08} for item in cars)
    moved = next(item for item in cars if item["id"] == car["id"])
    assert moved["position"] == {"x": 13.4, "y": .436926, "z": 7.65}


def migration_script():
    path = Path(__file__).resolve().parents[1] / "scripts" / "plan_resident_town.py"
    spec = importlib.util.spec_from_file_location("town_plan_cli", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_reviewed_apply_backs_up_versions_and_never_changes_player_rows(tmp_path):
    script = migration_script()
    database, plan, backup = (tmp_path / name for name in ("world.db", "plan.json", "backup.db"))
    before = legacy_layout()
    with sqlite3.connect(database) as connection:
        connection.executescript("""CREATE TABLE world_layout_versions(id TEXT PRIMARY KEY,layout_hash TEXT UNIQUE,layout_json TEXT,note TEXT,author TEXT,is_default INTEGER,validation_json TEXT);
            CREATE TABLE world_layout_active(scope TEXT PRIMARY KEY,version_id TEXT,activated_by TEXT,activation_note TEXT,activated_at TEXT);
            CREATE TABLE world_layout_audit(action TEXT,version_id TEXT,previous_version_id TEXT,note TEXT,author TEXT);
            CREATE TABLE player_save(id TEXT PRIMARY KEY,coins INTEGER,voice TEXT,progress TEXT);
            INSERT INTO player_save VALUES ('existing-player',87,'saved-voice','in-progress');""")
        connection.execute("INSERT INTO world_layout_versions VALUES ('old-version',?,?,?,?,?,?)", (script.digest(before), script.encoded(before), "old", "test", 1, "{}"))
        connection.execute("INSERT INTO world_layout_active VALUES ('global','old-version','test','old','2026-01-01')")
    script.make_plan(database, plan)
    with pytest.raises(ValueError, match="版本"):
        script.apply_plan(database, plan, "wrong-version", backup)
    assert not backup.exists()
    result = script.apply_plan(database, plan, "old-version", backup)
    assert result["changed"] and result["rollback_version"] == "old-version"
    with sqlite3.connect(database) as connection, sqlite3.connect(backup) as original:
        assert connection.execute("SELECT * FROM player_save").fetchall() == original.execute("SELECT * FROM player_save").fetchall()
        assert connection.execute("SELECT count(*) FROM world_layout_versions").fetchone()[0] == 2
        assert original.execute("SELECT version_id FROM world_layout_active").fetchone()[0] == "old-version"
    assert backup.stat().st_mode & 0o777 == 0o600
    with pytest.raises(ValueError, match="当前发布版本"):
        script.apply_plan(database, plan, "old-version", tmp_path / "second-backup.db")
