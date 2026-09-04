from copy import deepcopy

import pytest

from lingolife.layouts import (
    SHARED_HOME_ACTIONS,
    default_world_layout,
    shared_home_manifest,
    validate_shared_home_manifest,
)


def test_shared_home_contract_supports_two_four_and_eight_residents():
    manifest = shared_home_manifest()

    assert manifest["max_residents"] == 8
    assert manifest["occupancy_scenarios"] == [2, 4, 8]
    assert {room["id"]: room["kind"] for room in manifest["rooms"]} == {
        "living-room": "living_room",
        "kitchen": "kitchen",
        "bathroom": "bathroom",
        "bedroom": "bedroom",
    }
    assert {action for room in manifest["rooms"] for anchor in room["anchors"]
            for action in anchor["actions"]} == SHARED_HOME_ACTIONS
    lounge = next(room for room in manifest["rooms"] if room["kind"] == "living_room")
    assert len([anchor for anchor in lounge["anchors"] if anchor["privacy"] == "open"]) >= 8


def test_shared_sleeping_room_has_eight_explicit_private_bed_spaces():
    bedroom = next(room for room in shared_home_manifest()["rooms"]
                   if room["kind"] == "bedroom")
    fixtures = {placement["id"] for placement in bedroom["placements"]}
    private_beds = [anchor for anchor in bedroom["anchors"]
                    if anchor["kind"] == "private-bed"]

    assert len(private_beds) == 8
    assert {anchor["slot"] for anchor in private_beds} == set(range(1, 9))
    assert all(anchor["privacy"] == "private" and "sleep" in anchor["actions"]
               for anchor in private_beds)
    assert all(anchor["fixture_id"] in fixtures for anchor in private_beds)


def test_private_bedrooms_have_unique_boundaries_doors_lights_and_personal_traces():
    manifest = shared_home_manifest()
    bedroom = next(room for room in manifest["rooms"]
                   if room["kind"] == "bedroom")
    fixtures = {placement["id"]: placement for placement in bedroom["placements"]}
    anchors = {anchor["id"]: anchor for anchor in bedroom["anchors"]}
    spaces = bedroom["private_spaces"]
    corridor = bedroom["corridors"][0]
    corridor_min_x, corridor_max_x, corridor_min_z, corridor_max_z = corridor["bounds"]

    assert bedroom["name"] == "Private bedroom wing"
    assert len(spaces) == 8
    assert {space["slot"] for space in spaces} == set(range(1, 9))
    assert len({space["id"] for space in spaces}) == 8
    assert len({fixture for space in spaces for fixture in space["fixture_ids"]}) == 24
    assert corridor["minimum_clearance"] >= .72
    assert anchors[corridor["entry_anchor_id"]]["kind"] == "entry"
    assert {tuple(sorted(edge)) for edge in manifest["room_connections"]} == {
        ("kitchen", "living-room"),
        ("bathroom", "living-room"),
        ("bedroom", "living-room"),
    }

    for index, space in enumerate(spaces):
        min_x, max_x, min_z, max_z = space["bounds"]
        assert max_x - min_x >= 2.35
        assert max_z - min_z >= 2.25
        assert space["door"]["width"] >= .72
        approach_x, _, approach_z = space["door"]["approach"]
        assert corridor_min_x <= approach_x <= corridor_max_x
        assert corridor_min_z <= approach_z <= corridor_max_z
        assert anchors[space["bed_anchor_id"]]["slot"] == space["slot"]
        assert anchors[space["door_anchor_id"]]["slot"] == space["slot"]
        assets = {fixtures[fixture_id]["asset"] for fixture_id in space["fixture_ids"]}
        assert "furniture/bed_single_A.gltf" in assets
        assert "furniture/lamp_standing.gltf" in assets
        assert "furniture/shelf_B_large_decorated.gltf" in assets
        assert space["trace"]
        for other in spaces[index + 1:]:
            other_min_x, other_max_x, other_min_z, other_max_z = other["bounds"]
            overlap_x = min(max_x, other_max_x) - max(min_x, other_min_x)
            overlap_z = min(max_z, other_max_z) - max(min_z, other_min_z)
            assert overlap_x <= .01 or overlap_z <= .01


def test_default_world_layout_is_derived_from_checked_shared_home_manifest():
    manifest = shared_home_manifest()
    rooms = {room["id"]: room for room in default_world_layout()["interior"]["rooms"]}

    for source in manifest["rooms"]:
        rendered = rooms[source["id"]]
        assert rendered["kind"] == source["kind"]
        assert {item["id"] for item in rendered["placements"]} == {
            item["id"] for item in source["placements"]
        }
        assert all(item["asset"].startswith("/assets/life/interiors/")
                   for item in rendered["placements"])


@pytest.mark.parametrize("break_contract", [
    lambda value: value.__setitem__("occupancy_scenarios", [2, 4]),
    lambda value: next(room for room in value["rooms"] if room["kind"] == "bedroom")[
        "anchors"
    ].remove(next(
        anchor for anchor in next(
            room for room in value["rooms"] if room["kind"] == "bedroom"
        )["anchors"] if anchor["kind"] == "private-bed"
    )),
    lambda value: next(resource for resource in value["resources"]
                       if resource["kind"] == "television").__setitem__("capacity", 1),
    lambda value: next(room for room in value["rooms"] if room["kind"] == "living_room")[
        "anchors"
    ].pop(0),
])
def test_shared_home_guard_rejects_capacity_privacy_and_anchor_regressions(break_contract):
    broken = deepcopy(shared_home_manifest())
    break_contract(broken)

    with pytest.raises(ValueError):
        validate_shared_home_manifest(broken)
