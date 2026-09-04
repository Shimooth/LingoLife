from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
import math

from lingolife.db import Database
from lingolife.layout_runtime import (
    city_route,
    compile_city_runtime,
    compile_shared_home_runtime,
)
from lingolife.layout_validation import load_world_asset_catalog, validate_layout_topology
from lingolife.layouts import default_world_layout, shared_home_manifest
from lingolife.life_service import LifeWorldService
from lingolife.life_world import LifeWorldEngine


NOW = datetime(2026, 9, 4, 12, 0, tzinfo=timezone.utc)


def _extra_sofa_layout() -> dict:
    layout = default_world_layout()
    room = next(value for value in layout["interior"]["rooms"] if value["id"] == "living-room")
    sofa = deepcopy(next(value for value in room["placements"] if value["id"] == "living-sofa"))
    sofa["id"] = "living-sofa-second"
    # A validator-approved free corner in the authored living room.
    sofa["position"] = {"x": -4.5, "y": 0, "z": -3.0}
    sofa["rotation"] = {"x": 0, "y": 0, "z": 0}
    room["placements"].append(sofa)
    return layout


def _profiles() -> list[dict]:
    return [
        {"id": "ava", "profile": {"name": "Ava", "age": 28,
                                     "personality": ["warm", "outgoing"],
                                     "interests": ["music"]}},
        {"id": "bo", "profile": {"name": "Bo", "age": 29,
                                    "personality": ["quiet", "thoughtful"],
                                    "interests": ["books"]}},
    ]


def _city_building(layout: dict, location_id: str) -> dict:
    return next(
        value for value in layout["city"]["buildings"]
        if value.get("location_id") == location_id
    )


def _swap_city_transforms(layout: dict, first_id: str, second_id: str) -> dict:
    result = deepcopy(layout)
    first = _city_building(result, first_id)
    second = _city_building(result, second_id)
    for field in ("position", "rotation"):
        first[field], second[field] = deepcopy(second[field]), deepcopy(first[field])
    return result


def _swap_city_assets(layout: dict, first_id: str, second_id: str) -> dict:
    result = deepcopy(layout)
    first = _city_building(result, first_id)
    second = _city_building(result, second_id)
    first["asset"], second["asset"] = second["asset"], first["asset"]
    return result


def test_compiler_moves_fixture_relative_anchor_and_turns_extra_station_into_capacity():
    baseline_layout = default_world_layout()
    baseline = compile_shared_home_runtime(baseline_layout)
    assert {value["kind"]: value["capacity"] for value in baseline["resources"]} == {
        "kitchen": 1, "television": 2, "bathroom": 1,
    }

    moved = deepcopy(baseline_layout)
    room = next(value for value in moved["interior"]["rooms"] if value["id"] == "living-room")
    sofa = next(value for value in room["placements"] if value["id"] == "living-sofa")
    sofa["position"]["x"] += 1.25
    compiled = compile_shared_home_runtime(moved)
    baseline_anchor = next(
        anchor for value in shared_home_manifest()["rooms"] if value["id"] == "living-room"
        for anchor in value["anchors"] if anchor["id"] == "living-tv-a"
    )
    moved_anchor = next(
        anchor for value in compiled["rooms"] if value["id"] == "living-room"
        for anchor in value["anchors"] if anchor["id"] == "living-tv-a"
    )
    assert moved_anchor["position"][0] == baseline_anchor["position"][0] + 1.25

    expanded_layout = _extra_sofa_layout()
    validate_layout_topology(
        expanded_layout, shared_home_manifest(), load_world_asset_catalog(),
    )
    expanded = compile_shared_home_runtime(expanded_layout)
    assert next(value for value in expanded["resources"]
                if value["kind"] == "television")["capacity"] == 4


def test_active_layout_reconciles_world_resources_without_rewriting_social_facts(tmp_path):
    db = Database(f"sqlite:///{tmp_path / 'layout-runtime.db'}")
    db.ensure_player("player")
    base_layout = default_world_layout()
    first_publication = db.publish_world_layout(
        base_layout, note="base", author="test", validation={"valid": True},
    )
    service = LifeWorldService(db, timezone_name="UTC")
    initial = service.load("player", _profiles(), now=NOW)
    relationship_facts = deepcopy(initial["relationships"])
    story_facts = deepcopy(initial["stories"])
    assert initial["shared_home_layout_version"] == first_publication["active_version"]["id"]
    assert next(value for value in initial["resources"]
                if value.get("kind") == "television" and value.get("scope") == "household")["capacity"] == 2

    second_publication = db.publish_world_layout(
        _extra_sofa_layout(), note="more seating", author="test",
        validation={"valid": True},
    )
    migrated = service.load("player", _profiles(), now=NOW)
    television = next(value for value in migrated["resources"]
                      if value.get("kind") == "television" and value.get("scope") == "household")
    assert migrated["shared_home_layout_version"] == second_publication["active_version"]["id"]
    assert television["capacity"] == 4
    assert migrated["relationships"] == relationship_facts
    assert migrated["stories"] == story_facts


def test_capacity_shrink_waits_for_in_flight_leases():
    from lingolife.life import ResourceQueueEntry, ResourceReservation, ResourceState
    from datetime import timedelta
    from lingolife.life_world import LifeWorldEngine

    expanded = compile_shared_home_runtime(_extra_sofa_layout())
    engine = LifeWorldEngine(
        timezone_name="UTC", home_manifest=expanded, home_layout_version="expanded",
    )
    profiles = {entry["id"]: entry["profile"] for entry in _profiles()}
    homes = {npc_id: {"household_id": "shared", "location_id": "home"} for npc_id in profiles}
    state = engine.initialize("player", profiles, homes, now=NOW)
    index = next(index for index, value in enumerate(state["resources"])
                 if value.get("kind") == "television" and value.get("scope") == "household")
    resource = ResourceState.from_dict(state["resources"][index])
    leases = tuple(
        ResourceReservation(f"action-{number}", f"npc-{number}", NOW,
                            NOW + timedelta(minutes=5))
        for number in range(3)
    )
    state["resources"][index] = ResourceState(
        resource.id, resource.kind, resource.scope, resource.location_id, 4,
        resource.state, resource.household_id, leases,
        (ResourceQueueEntry("queued", "npc-q", NOW, 60),), resource.version,
    ).to_dict()

    engine.configure_shared_home(compile_shared_home_runtime(default_world_layout()), "base")
    engine._reconcile_layout_resources(state, NOW + timedelta(seconds=1))
    assert state["resources"][index]["capacity"] == 3
    assert len(state["resources"][index]["reservations"]) == 3
    assert state["resources"][index]["queue"][0]["action_id"] == "queued"


def test_city_compiler_uses_authored_anchors_and_connected_road_distance():
    baseline_layout = default_world_layout()
    moved_layout = _swap_city_transforms(
        baseline_layout, "innovation_hub", "city_library",
    )
    validate_layout_topology(
        moved_layout, shared_home_manifest(), load_world_asset_catalog(),
    )
    baseline = compile_city_runtime(baseline_layout)
    moved = compile_city_runtime(moved_layout)

    authored_innovation = _city_building(moved_layout, "innovation_hub")["position"]
    assert moved["locations"]["innovation_hub"]["position"] == [
        authored_innovation["x"], authored_innovation["z"],
    ]
    baseline_route = city_route(baseline, "shared-home", "innovation_hub")
    moved_route = city_route(moved, "shared-home", "innovation_hub")
    assert baseline_route is not None and moved_route is not None
    assert baseline_route["distance"] > moved_route["distance"]
    assert baseline_route["road_node_ids"] != moved_route["road_node_ids"]
    assert moved_route["points"][0] == moved["locations"]["shared-home"]["position"]
    assert moved_route["points"][-1] == moved["locations"]["innovation_hub"]["position"]

    # The compiled route follows reciprocal road ports, rather than drawing a
    # straight presentation-only line between the two buildings.
    road_nodes = baseline["road_nodes"]
    for first_id, second_id in zip(
        baseline_route["road_node_ids"], baseline_route["road_node_ids"][1:],
    ):
        assert second_id in road_nodes[first_id]["neighbors"]
        assert first_id in road_nodes[second_id]["neighbors"]
    origin = baseline["locations"]["shared-home"]["position"]
    target = baseline["locations"]["innovation_hub"]["position"]
    assert baseline_route["distance"] > math.dist(origin, target)


def test_authored_building_family_changes_future_simulation_opportunities():
    baseline_layout = default_world_layout()
    swapped_layout = _swap_city_assets(
        baseline_layout, "city_library", "moonlight_cafe",
    )
    validate_layout_topology(
        swapped_layout, shared_home_manifest(), load_world_asset_catalog(),
    )
    baseline = compile_city_runtime(baseline_layout)
    swapped = compile_city_runtime(swapped_layout)
    assert "reading_space" in baseline["locations"]["city_library"]["opportunity_kinds"]
    assert "dining_space" in baseline["locations"]["moonlight_cafe"]["opportunity_kinds"]
    assert swapped["locations"]["city_library"]["building_family"] == "commercial"
    assert swapped["locations"]["moonlight_cafe"]["building_family"] == "public"
    assert "reading_space" not in swapped["locations"]["city_library"]["opportunity_kinds"]
    assert "dining_space" not in swapped["locations"]["moonlight_cafe"]["opportunity_kinds"]

    profiles = {entry["id"]: entry["profile"] for entry in _profiles()}
    homes = {
        npc_id: {"household_id": "shared", "location_id": "home"}
        for npc_id in profiles
    }
    engine = LifeWorldEngine(
        timezone_name="UTC", city_runtime=swapped, city_layout_version="family-swap",
    )
    state = engine.initialize("family-player", profiles, homes, now=NOW)
    reading = next(
        value for value in state["resources"]
        if value["id"] == "city-library-reading-room"
    )
    dining = next(
        value for value in state["resources"]
        if value["id"] == "moonlight-cafe-table"
    )
    assert reading["state"]["layout_available"] is False
    assert dining["state"]["layout_available"] is False
    available_ids = {
        resource.id for resource in engine._resident_resources(
            state, "ava", engine._resource_map(state),
        )
    }
    assert "city-library-reading-room" not in available_ids
    assert "moonlight-cafe-table" not in available_ids


def test_new_life_action_saves_authored_route_and_duration_changes_with_layout():
    profile = {
        "ava": {
            "name": "Ava", "age": 28, "occupation": "Designer",
            "personality": ["warm"], "interests": ["music"],
        },
    }
    homes = {"ava": {"household_id": "shared", "location_id": "home"}}
    baseline_layout = default_world_layout()
    moved_layout = _swap_city_transforms(
        baseline_layout, "innovation_hub", "city_library",
    )
    engines = [
        LifeWorldEngine(
            timezone_name="UTC", city_runtime=compile_city_runtime(layout),
            city_layout_version="same-version",
        )
        for layout in (baseline_layout, moved_layout)
    ]
    baseline_state, moved_state = [
        engine.initialize("route-player", profile, homes, now=NOW)
        for engine in engines
    ]
    baseline_action = baseline_state["residents"]["ava"]["current_action"]
    moved_action = moved_state["residents"]["ava"]["current_action"]
    baseline_journey = baseline_state["residents"]["ava"]["current_journey"]
    moved_journey = moved_state["residents"]["ava"]["current_journey"]
    assert baseline_action["location_id"] == moved_action["location_id"] == "innovation_hub"
    assert baseline_journey["mode"] == moved_journey["mode"] == "authored_road_walk"
    assert baseline_journey["distance"] > moved_journey["distance"]
    assert baseline_journey["duration_seconds"] > moved_journey["duration_seconds"]
    assert datetime.fromisoformat(baseline_action["arrives_at"]) == (
        NOW + timedelta(seconds=baseline_journey["duration_seconds"])
    )
    assert moved_journey["points"][-1] == engines[1].city_runtime[
        "locations"
    ]["innovation_hub"]["position"]

    public_journey = engines[0].public_snapshot(baseline_state)["residents"][0][
        "current_action"
    ]["journey"]
    assert public_journey["city_layout_version"] == "same-version"
    assert public_journey["road_node_ids"] == baseline_journey["road_node_ids"]
    assert "origin_location_id" not in public_journey
    assert "target_location_id" not in public_journey


def test_city_layout_migration_preserves_in_flight_journey_and_social_facts(tmp_path):
    db = Database(f"sqlite:///{tmp_path / 'city-layout-runtime.db'}")
    db.ensure_player("player")
    baseline_layout = default_world_layout()
    first_publication = db.publish_world_layout(
        baseline_layout, note="base", author="test", validation={"valid": True},
    )
    profiles = _profiles()
    profiles[0]["profile"]["occupation"] = "Designer"
    service = LifeWorldService(db, timezone_name="UTC")
    initial = service.load("player", profiles, now=NOW)
    old_action = deepcopy(initial["residents"]["ava"]["current_action"])
    old_journey = deepcopy(initial["residents"]["ava"]["current_journey"])
    assert old_journey["city_layout_version"] == first_publication["active_version"]["id"]
    relationship_facts = deepcopy(initial["relationships"])
    story_facts = deepcopy(initial["stories"])

    changed_layout = _swap_city_assets(
        _swap_city_transforms(baseline_layout, "innovation_hub", "city_library"),
        "city_library", "moonlight_cafe",
    )
    validate_layout_topology(
        changed_layout, shared_home_manifest(), load_world_asset_catalog(),
    )
    second_publication = db.publish_world_layout(
        changed_layout, note="new city conditions", author="test",
        validation={"valid": True},
    )
    migrated = service.load("player", profiles, now=NOW)
    assert migrated["city_layout_version"] == second_publication["active_version"]["id"]
    assert migrated["residents"]["ava"]["current_action"] == old_action
    assert migrated["residents"]["ava"]["current_journey"] == old_journey
    reading = next(
        value for value in migrated["resources"]
        if value["id"] == "city-library-reading-room"
    )
    assert reading["state"]["layout_available"] is False
    assert reading["state"]["city_layout_version"] == second_publication[
        "active_version"
    ]["id"]
    assert reading["state"]["building_family"] == "commercial"
    assert migrated["relationships"] == relationship_facts
    assert migrated["stories"] == story_facts


def test_legacy_world_without_city_runtime_fields_migrates_additively():
    profiles = {entry["id"]: entry["profile"] for entry in _profiles()}
    homes = {
        npc_id: {"household_id": "shared", "location_id": "home"}
        for npc_id in profiles
    }
    engine = LifeWorldEngine(timezone_name="UTC")
    legacy = engine.initialize("legacy-player", profiles, homes, now=NOW)
    legacy.pop("city_layout_version")
    action_ids = {
        npc_id: resident["current_action"]["id"]
        for npc_id, resident in legacy["residents"].items()
    }
    for resident in legacy["residents"].values():
        resident.pop("current_journey")
    for resource in legacy["resources"]:
        if resource.get("scope") == "city":
            for key in (
                "layout_available", "city_layout_version", "building_family",
                "building_id", "road_node_id",
            ):
                resource["state"].pop(key, None)

    engine.configure_city(compile_city_runtime(default_world_layout()), "layout-v-next")
    migrated = engine.advance(legacy, profiles, now=NOW + timedelta(microseconds=1))
    assert migrated["city_layout_version"] == "layout-v-next"
    assert {
        npc_id: resident["current_action"]["id"]
        for npc_id, resident in migrated["residents"].items()
    } == action_ids
    assert all("current_journey" in value for value in migrated["residents"].values())
    assert all(
        resource["state"]["city_layout_version"] == "layout-v-next"
        and isinstance(resource["state"]["layout_available"], bool)
        for resource in migrated["resources"] if resource.get("scope") == "city"
    )


def test_city_world_action_distinguishes_active_life_from_terminal_idle(tmp_path):
    db = Database(f"sqlite:///{tmp_path / 'world-action-state.db'}")
    service = LifeWorldService(db, timezone_name="UTC")
    profile_entries = _profiles()
    profile_map = {
        entry["id"]: entry["profile"] for entry in profile_entries
    }
    homes = {
        npc_id: {"household_id": "shared", "location_id": "home"}
        for npc_id in profile_map
    }
    baseline = service.engine.initialize(
        "world-action-player", profile_map, homes, now=NOW,
    )

    expected = {
        "planned": "living", "traveling": "walking_to_event",
        "performing": "living", "blocked": "living", "retrying": "living",
        "completed": "idle", "abandoned": "idle", "interrupted": "idle",
    }
    for status, world_state in expected.items():
        state = deepcopy(baseline)
        state["residents"]["ava"]["current_action"]["status"] = status
        service.load = lambda *_args, **_kwargs: state  # type: ignore[method-assign]
        projected = service.city(
            "world-action-player", profile_entries, now=NOW,
        )
        resident = next(value for value in projected["npcs"] if value["id"] == "ava")
        assert resident["world_action"]["state"] == world_state
