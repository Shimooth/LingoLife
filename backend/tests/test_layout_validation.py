from copy import deepcopy
from pathlib import Path

import pytest

from lingolife.layout_validation import (
    LayoutTopologyError,
    load_world_asset_catalog,
    validate_asset_catalog,
    validate_layout_topology,
)
from lingolife.layouts import default_world_layout, shared_home_manifest
from lingolife.models import (
    CITY_BUILDING_ASSETS,
    CITY_DECORATION_ASSETS,
    CITY_PROP_ASSETS,
    CITY_ROAD_ASSETS,
    INTERIOR_ASSETS,
)


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _catalog():
    return load_world_asset_catalog()


def _manifest():
    return deepcopy(shared_home_manifest())


def _codes(error: LayoutTopologyError) -> set[str]:
    return {issue.code for issue in error.issues}


def test_asset_catalog_covers_every_backend_allowlist_with_complete_runtime_metadata():
    catalog = _catalog()
    expected = {
        "city.roads": CITY_ROAD_ASSETS,
        "city.buildings": CITY_BUILDING_ASSETS,
        "city.props": CITY_PROP_ASSETS,
        "city.decorations": CITY_DECORATION_ASSETS,
        "interior": INTERIOR_ASSETS,
    }

    assets = validate_asset_catalog(catalog, expected)

    assert len(assets) == 62
    assert set(assets) == set().union(*expected.values())
    for asset_path, metadata in assets.items():
        assert (PROJECT_ROOT / "web" / "public" / asset_path.lstrip("/")).is_file()
        assert metadata["source_id"] in catalog["sources"]
        assert metadata["license_id"] in catalog["licenses"]
        assert metadata["category"]
        assert len(metadata["footprint"]["size"]) == 2
        assert len(metadata["bounds"]["size"]) == 3
        assert metadata["lod"]["levels"] >= 1
        assert metadata["uses"]
        assert metadata["semantic_capabilities"]
    for source in catalog["sources"].values():
        assert (PROJECT_ROOT / source["license_file"]).is_file()


def test_default_layout_and_shared_home_pass_the_pure_topology_gate_without_mutation():
    layout, manifest, catalog = default_world_layout(), _manifest(), _catalog()
    originals = deepcopy((layout, manifest, catalog))

    report = validate_layout_topology(layout, manifest, catalog)

    assert report.road_tiles == 100
    assert report.road_edges >= 99
    assert report.sky_road_exits == 3
    assert report.buildings == 54
    assert report.connected_rooms == 4
    assert report.room_connections == 3
    assert report.shared_home_actions == 13
    assert report.private_sleep_slots == 8
    assert (layout, manifest, catalog) == originals


def test_disconnected_road_component_is_rejected():
    layout = default_world_layout()
    layout["city"]["roads"] = [road for road in layout["city"]["roads"] if road["id"] != "road--2--7"]

    with pytest.raises(LayoutTopologyError) as caught:
        validate_layout_topology(layout, _manifest(), _catalog())

    assert "road.disconnected" in _codes(caught.value)


@pytest.mark.parametrize(
    ("mutation", "expected_code"),
    [
        (lambda road: road["position"].__setitem__("x", road["position"]["x"] + 0.2), "road.grid_alignment"),
        (lambda road: road["rotation"].__setitem__("y", road["rotation"]["y"] + 0.2), "road.rotation"),
    ],
)
def test_road_grid_and_connector_orientation_are_checked(mutation, expected_code):
    layout = default_world_layout()
    mutation(layout["city"]["roads"][20])

    with pytest.raises(LayoutTopologyError) as caught:
        validate_layout_topology(layout, _manifest(), _catalog())

    assert expected_code in _codes(caught.value)


def test_building_full_footprint_cannot_press_into_a_road_without_sharing_its_center():
    layout = default_world_layout()
    road = layout["city"]["roads"][0]
    building = layout["city"]["buildings"][0]
    building["position"]["x"] = road["position"]["x"] + 2.0
    building["position"]["z"] = road["position"]["z"]

    with pytest.raises(LayoutTopologyError) as caught:
        validate_layout_topology(layout, _manifest(), _catalog())

    assert "building.overlaps_road" in _codes(caught.value)


def test_building_oriented_footprints_cannot_overlap_each_other():
    layout = default_world_layout()
    first, second = layout["city"]["buildings"][:2]
    first["position"] = deepcopy(second["position"])
    first["rotation"] = {"x": 0.0, "y": 0.37, "z": 0.0}

    with pytest.raises(LayoutTopologyError) as caught:
        validate_layout_topology(layout, _manifest(), _catalog())

    assert "building.overlap" in _codes(caught.value)


def test_decoration_footprint_cannot_obstruct_the_main_road():
    layout = default_world_layout()
    road = layout["city"]["roads"][40]
    decoration = layout["city"]["decorations"][0]
    decoration["position"]["x"] = road["position"]["x"]
    decoration["position"]["z"] = road["position"]["z"]

    with pytest.raises(LayoutTopologyError) as caught:
        validate_layout_topology(layout, _manifest(), _catalog())

    assert "decoration.blocks_road" in _codes(caught.value)


def test_missing_room_door_breaks_the_shared_home_connection_graph():
    manifest = _manifest()
    bathroom = next(room for room in manifest["rooms"] if room["id"] == "bathroom")
    bathroom["anchors"] = [anchor for anchor in bathroom["anchors"] if anchor["kind"] != "entry"]

    with pytest.raises(LayoutTopologyError) as caught:
        validate_layout_topology(default_world_layout(), manifest, _catalog())

    assert {"shared_home.door_missing", "shared_home.room_graph_disconnected"} <= _codes(caught.value)


def test_explicit_room_connection_graph_must_reach_all_four_rooms():
    manifest = _manifest()
    manifest["room_connections"] = [["living-room", "kitchen"], ["living-room", "bathroom"]]

    with pytest.raises(LayoutTopologyError) as caught:
        validate_layout_topology(default_world_layout(), manifest, _catalog())

    assert "shared_home.room_graph_disconnected" in _codes(caught.value)


def test_furniture_cannot_block_the_room_entry_path():
    layout = default_world_layout()
    lounge = next(room for room in layout["interior"]["rooms"] if room["id"] == "living-room")
    sofa = next(placement for placement in lounge["placements"] if placement["id"] == "living-sofa")
    sofa["position"] = {"x": -4.45, "y": 0.0, "z": 2.35}

    with pytest.raises(LayoutTopologyError) as caught:
        validate_layout_topology(layout, _manifest(), _catalog())

    assert "shared_home.entry_blocked" in _codes(caught.value)


def test_proposed_interior_cannot_remove_a_manifest_anchor_or_resource_fixture():
    layout = default_world_layout()
    kitchen = next(room for room in layout["interior"]["rooms"] if room["id"] == "kitchen")
    kitchen["placements"] = [placement for placement in kitchen["placements"] if placement["id"] != "kitchen-stove"]

    with pytest.raises(LayoutTopologyError) as caught:
        validate_layout_topology(layout, _manifest(), _catalog())

    assert {"shared_home.proposed_fixture", "shared_home.proposed_resource_fixture"} <= _codes(caught.value)


def test_proposed_fixture_asset_must_support_its_manifest_anchor_actions():
    layout = default_world_layout()
    bedroom = next(room for room in layout["interior"]["rooms"] if room["id"] == "bedroom")
    bed = next(placement for placement in bedroom["placements"] if placement["id"] == "bed-08")
    bed["asset"] = "/assets/life/interiors/furniture/table_low.gltf"

    with pytest.raises(LayoutTopologyError) as caught:
        validate_layout_topology(layout, _manifest(), _catalog())

    assert "shared_home.proposed_fixture_capability" in _codes(caught.value)


def test_missing_action_anchor_is_rejected_by_room_and_resource_contracts():
    manifest = _manifest()
    kitchen = next(room for room in manifest["rooms"] if room["id"] == "kitchen")
    kitchen["anchors"] = [anchor for anchor in kitchen["anchors"] if anchor["id"] != "kitchen-prep"]

    with pytest.raises(LayoutTopologyError) as caught:
        validate_layout_topology(default_world_layout(), manifest, _catalog())

    assert {"shared_home.action_contract", "shared_home.resource_anchor"} <= _codes(caught.value)


def test_resource_fixture_reference_and_eight_private_sleep_slots_are_checked():
    manifest = _manifest()
    kitchen = next(resource for resource in manifest["resources"] if resource["kind"] == "kitchen")
    kitchen["fixture_ids"] = ["missing-counter"]
    bedroom = next(room for room in manifest["rooms"] if room["id"] == "bedroom")
    bedroom["anchors"] = [anchor for anchor in bedroom["anchors"] if anchor.get("slot") != 8]

    with pytest.raises(LayoutTopologyError) as caught:
        validate_layout_topology(default_world_layout(), manifest, _catalog())

    assert {"shared_home.resource_fixture", "shared_home.sleep_slots"} <= _codes(caught.value)


def test_resource_room_and_capacity_contract_cannot_drift():
    manifest = _manifest()
    television = next(resource for resource in manifest["resources"] if resource["kind"] == "television")
    television["capacity"] = 3

    with pytest.raises(LayoutTopologyError) as caught:
        validate_layout_topology(default_world_layout(), manifest, _catalog())

    assert "shared_home.resource_contract" in _codes(caught.value)
