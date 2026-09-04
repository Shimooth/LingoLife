"""Validated, versioned layout defaults shared by the game and admin API.

The asset keys intentionally use the public URLs already consumed by the Three
renderer.  A saved layout therefore never contains an arbitrary filesystem or
network URL: :class:`WorldLayout` validates every placement against the bundled
asset catalog before it can reach persistence.
"""

from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path
from typing import Any

from .city import CITY_LOCATIONS
from .models import WorldLayout


CITY_ASSET_ROOT = "/assets/world/kaykit-city/gltf"
INTERIOR_ROOT = "/assets/life/interiors"
SHARED_HOME_MANIFEST_PATH = Path(__file__).resolve().parents[2] / "config" / "shared-home-layout.json"
SHARED_HOME_ACTIONS = frozenset({
    "prepare_food", "eat", "sleep", "shower", "use_television", "read",
    "practice_hobby", "borrow_household_item", "clean_shared_space", "leave_dishes",
    "rest_alone", "seek_company", "talk_to_resident",
})


def _vector(x: float = 0, y: float = 0, z: float = 0) -> dict[str, float]:
    return {"x": round(float(x), 4), "y": round(float(y), 4), "z": round(float(z), 4)}


def _scale(value: float | tuple[float, float, float] = 1) -> dict[str, float]:
    x, y, z = value if isinstance(value, tuple) else (value, value, value)
    return _vector(x, y, z)


def _placement(identifier: str, asset: str, x: float, y: float, z: float,
               rotation_y: float = 0, scale: float | tuple[float, float, float] = 1,
               **extra: Any) -> dict[str, Any]:
    return {
        "id": identifier, "asset": asset, "position": _vector(x, y, z),
        "rotation": _vector(0, rotation_y, 0), "scale": _scale(scale), **extra,
    }


def _default_roads() -> list[dict[str, Any]]:
    """Mirror the connected KayKit road skeleton used by the current city."""
    step = 2.6
    values: dict[str, dict[str, Any]] = {}

    def add(gx: int, gz: int, model: str, rotation: float = 0) -> None:
        identifier = f"road-{gx}-{gz}"
        values[identifier] = _placement(
            identifier, f"{CITY_ASSET_ROOT}/{model}.gltf", gx * step, .245, gz * step,
            rotation, 1.3,
        )

    for gx in range(-14, 15):
        add(gx, 0, "road_straight", math.pi / 2)
    for gx in (-11, -5, 0, 6, 11):
        add(gx, 0, "road_straight_crossing", math.pi / 2)
    for gz in range(-4, 0):
        add(-7, gz, "road_straight")
        add(5, gz, "road_straight")
    for gx in range(-6, 5):
        add(gx, -5, "road_straight", math.pi / 2)
    add(-7, -5, "road_corner_curved")
    add(5, -5, "road_corner_curved", -math.pi / 2)
    add(-7, 0, "road_tsplit", math.pi)
    add(5, 0, "road_tsplit", math.pi)
    for gz in range(-10, -5):
        add(-2, gz, "road_straight")
    add(-2, -5, "road_tsplit", math.pi)
    add(-2, -7, "road_straight_crossing")

    for gz in range(1, 5):
        add(-9, gz, "road_straight")
        add(3, gz, "road_straight")
    for gx in range(-8, 3):
        add(gx, 5, "road_straight", math.pi / 2)
    add(-9, 0, "road_tsplit")
    add(3, 0, "road_tsplit")
    add(-9, 5, "road_corner_curved", math.pi / 2)
    add(3, 5, "road_tsplit", math.pi)
    for gx in range(-8, -3):
        add(gx, 3, "road_straight", math.pi / 2)
    for gz in range(1, 3):
        add(-3, gz, "road_straight")
    add(-9, 3, "road_tsplit", math.pi / 2)
    add(-3, 3, "road_corner", math.pi)
    add(-3, 0, "road_tsplit")
    add(-6, 3, "road_straight_crossing", math.pi / 2)

    for gx in range(4, 10):
        add(gx, 5, "road_straight", math.pi / 2)
    for gz in range(1, 5):
        add(9, gz, "road_straight")
    add(9, 0, "road_junction")
    add(9, 5, "road_corner_curved", math.pi)
    add(6, 5, "road_straight_crossing", math.pi / 2)
    for gz in range(-3, 0):
        add(9, gz, "road_straight")
    for gx in range(6, 9):
        add(gx, -3, "road_straight", math.pi / 2)
    add(9, -3, "road_corner", -math.pi / 2)
    add(6, -3, "road_straight", math.pi / 2)
    add(5, -3, "road_tsplit", math.pi / 2)
    add(9, -1, "road_straight_crossing")
    return list(values.values())


def _building_model(kind: str, index: int) -> str:
    if kind in {"commercial", "cafe", "restaurant", "shopping"}:
        choices = ("building_D", "building_E")
    elif kind in {"public", "transit", "work", "health", "civic", "culture", "education", "fitness"}:
        choices = ("building_F", "building_G", "building_H")
    else:
        choices = ("building_A", "building_B", "building_C")
    return choices[index % len(choices)]


def _default_buildings() -> list[dict[str, Any]]:
    """Claim legal road-adjacent parcels for landmarks and city fabric."""
    step = 2.6
    road_positions = [
        (placement["position"]["x"], placement["position"]["z"])
        for placement in _default_roads()
    ]
    road_cells = {
        (round(x / step), round(z / step)) for x, z in road_positions
    }
    outline = (
        (-27, -12.8), (-23.2, -17.3), (-9.3, -17.8), (-6.8, -17.1),
        (7.6, -17.1), (10.1, -17.8), (23, -17.2), (27, -12.6),
        (27, -3.1), (26.4, -1.2), (27, 1.1), (27, 12.7),
        (22.8, 17.2), (9.2, 17.7), (6.7, 17), (-7.8, 17),
        (-10.3, 17.7), (-23.1, 17.1), (-27, 12.8), (-27, 3),
        (-26.4, 1), (-27, -1.2),
    )
    half = step / 2 + .01

    def inside(x: float, z: float) -> bool:
        result = False
        previous = len(outline) - 1
        for index, (xi, zi) in enumerate(outline):
            xj, zj = outline[previous]
            if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi:
                result = not result
            previous = index
        return result

    def lot_inside(x: float, z: float) -> bool:
        return all(inside(cx, cz) for cx, cz in (
            (x - half, z - half), (x + half, z - half),
            (x - half, z + half), (x + half, z + half),
        ))

    def touches_road(gx: int, gz: int) -> bool:
        return any(cell in road_cells for cell in (
            (gx - 1, gz), (gx + 1, gz), (gx, gz - 1), (gx, gz + 1),
        ))

    def district(x: float, z: float) -> str:
        if z < -7:
            return "east" if x > 10 else "north"
        if z > 7:
            return "harbor" if x > 5 else "south"
        if x < -10:
            return "west"
        if x > 10:
            return "east"
        return "central"

    def family(current_district: str, z: float, index: int) -> str:
        if current_district in {"central", "south"}:
            return "public" if index % 3 == 0 else "commercial"
        if current_district in {"north", "east"}:
            return "commercial" if index % 3 == 0 else "public"
        if current_district == "harbor":
            return "commercial" if index % 2 else "public"
        return "commercial" if abs(z) < 6 and index % 3 == 0 else "residential"

    def rotation(x: float, z: float) -> float:
        road_x, road_z = min(
            road_positions, key=lambda point: (point[0] - x) ** 2 + (point[1] - z) ** 2,
        )
        dx, dz = road_x - x, road_z - z
        return (math.pi / 2 if dx > 0 else -math.pi / 2) if abs(dx) > abs(dz) else (
            0 if dz > 0 else math.pi
        )

    lots: list[dict[str, Any]] = []
    for gz in range(-6, 7):
        for gx in range(-10, 11):
            x, z = gx * step, gz * step
            if (gx, gz) in road_cells or not touches_road(gx, gz) or not lot_inside(x, z):
                continue
            index = (gz + 6) * 21 + gx + 10
            current_district = district(x, z)
            lots.append({
                "gx": gx, "gz": gz, "x": x, "z": z,
                "rotation": rotation(x, z),
                "family": family(current_district, z, index),
            })

    claimed: set[tuple[int, int]] = set()

    def claim(target_x: float, target_z: float) -> dict[str, Any]:
        available = [lot for lot in lots if (lot["gx"], lot["gz"]) not in claimed]
        if not available:
            raise RuntimeError("default city does not have enough legal building lots")
        selected = min(
            available,
            key=lambda lot: ((lot["x"] - target_x) ** 2 + (lot["z"] - target_z) ** 2,
                             lot["gz"], lot["gx"]),
        )
        claimed.add((selected["gx"], selected["gz"]))
        return selected

    result: list[dict[str, Any]] = []
    for index, location in enumerate(CITY_LOCATIONS):
        target_x = (location.x / 4800 - .5) * 56
        target_z = (location.y / 3000 - .5) * 38
        lot = claim(target_x, target_z)
        model = _building_model(location.kind, index)
        result.append(_placement(
            f"landmark-{location.id}", f"{CITY_ASSET_ROOT}/{model}.gltf",
            lot["x"], .369, lot["z"], lot["rotation"], 1.16,
            location_id=location.id,
        ))

    home = claim(-22, 8)
    result.append(_placement(
        "shared-home", f"{CITY_ASSET_ROOT}/building_B.gltf",
        home["x"], .369, home["z"], home["rotation"], 1.16,
        location_id=None,
    ))

    # Fill the connected streetscape to the current visual-density target.
    for lot in sorted(lots, key=lambda value: (value["gz"], value["gx"])):
        if len(result) >= 54:
            break
        cell = (lot["gx"], lot["gz"])
        if cell in claimed:
            continue
        claimed.add(cell)
        model = _building_model(lot["family"], len(result))
        result.append(_placement(
            f"fabric-{lot['gx']}-{lot['gz']}", f"{CITY_ASSET_ROOT}/{model}.gltf",
            lot["x"], .369, lot["z"], lot["rotation"], 1.16,
            location_id=None,
        ))
    if len(result) < 54:
        raise RuntimeError("default city could not reach the required building density")
    return result


def _default_props() -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for index, x in enumerate((-23.4, -18.2, -13, -7.8, -2.6, 2.6, 7.8, 13, 18.2, 23.4)):
        result.append(_placement(
            f"cloudway-light-n-{index}", f"{CITY_ASSET_ROOT}/streetlight.gltf",
            x, .37, -1.18, math.pi if index % 2 else 0, 1.3,
        ))
        result.append(_placement(
            f"cloudway-light-s-{index}", f"{CITY_ASSET_ROOT}/streetlight.gltf",
            x, .37, 1.18, 0 if index % 2 else math.pi, 1.3,
        ))
    fixed = (
        ("signal-west-a", "trafficlight_A", -23.9, -1.03, 0, 1.35),
        ("signal-west-b", "trafficlight_B", -23.1, 1.06, math.pi, 1.35),
        ("signal-centre-a", "trafficlight_C", -8.8, -1.08, math.pi / 2, 1.28),
        ("signal-centre-b", "trafficlight_C", 8.8, 1.08, -math.pi / 2, 1.28),
        ("signal-dawn-a", "trafficlight_B", 22.3, -1.05, math.pi, 1.35),
        ("signal-dawn-b", "trafficlight_A", 23.1, 1.04, 0, 1.35),
        ("hydrant-cafe", "firehydrant", -4.45, 2.35, .2, 1.65),
        ("hydrant-library", "firehydrant", -14.7, .95, -.2, 1.65),
        ("hydrant-hospital", "firehydrant", 16.9, 2.25, .4, 1.65),
        ("dumpster-market", "dumpster", -11.7, 10.2, math.pi / 2, 1.45),
        ("trash-centre-a", "trash_A", -1.1, 2.05, 0, 2),
        ("trash-centre-b", "trash_B", 4.25, -2.1, 0, 2),
        ("cargo-old-a", "box_A", -12.25, 10.6, .2, 2),
        ("cargo-old-b", "box_B", -11.8, 10.9, -.2, 2),
        ("bench-campus-a", "bench", -5.9, -10.7, math.pi / 2, 2.1),
        ("bench-sunny-a", "bench", .7, -5.5, math.pi / 2, 2.1),
        ("watertower-cloudgate", "watertower", -24.2, -12.8, .2, 2.4),
        ("car-taxi-centre", "car_taxi", 1.1, .28, math.pi / 2, 1.16),
        ("car-sedan-west", "car_sedan", -16.6, -.28, -math.pi / 2, 1.16),
        ("car-police-dawn", "car_police", 23.3, .28, math.pi / 2, 1.16),
    )
    for identifier, model, x, z, rotation, scale in fixed:
        result.append(_placement(
            identifier, f"{CITY_ASSET_ROOT}/{model}.gltf", x, .37, z, rotation, scale,
        ))
    return result


def _default_decorations() -> list[dict[str, Any]]:
    # These points deliberately sit outside both the 2.6 m road tiles and the
    # occupied building parcels.  The tree mesh is much wider than its trunk,
    # so checking only placement centres makes foliage visibly cut through a
    # facade even when the JSON positions are technically different.
    trees = (
        (-24, -15), (-22.9, -14.2), (-21.7, -15.4),
        (-6.4, -7.6), (-3.2, -5.5), (1.2, -7.5), (4.7, -5.7),
        (6.4, -7.2), (-1.4, 8.9), (-.4, 10.4),
        (24.2, -14.1), (25.1, -12.7), (23.6, -11.8),
        (19.6, 7.7), (-21, 3.5), (-16.8, 16.1), (10.5, 16.1),
        (16.8, -2.8), (-11.2, 2.8), (10.5, 4.9), (-25.2, -4.9),
        (16.1, -16.1), (18.2, 16.1),
    )
    tree_asset = f"{INTERIOR_ROOT}/park/tree.gltf"
    bush_asset = f"{CITY_ASSET_ROOT}/bush.gltf"
    result = [
        _placement(f"tree-{index}", tree_asset, x, .37, z, index * .37, .72 + index % 3 * .06)
        for index, (x, z) in enumerate(trees)
    ]
    bushes = ((.4, -5.2), (1.5, -6.1), (2.7, -5.2), (-4.8, 10.4),
              (-2.5, 10.4), (2.8, 3.5), (-4.2, 2.8), (-13.3, 10.5),
              (-9.1, 15.4), (3.5, 15.4), (5.6, 9.1), (-15.4, -4.9))
    result.extend(
        _placement(f"park-bush-{index}", bush_asset, x, .37, z, index * .68, 1.65 + index % 3 * .12)
        for index, (x, z) in enumerate(bushes)
    )
    return result


@lru_cache(maxsize=1)
def shared_home_manifest() -> dict[str, Any]:
    """Load and validate the one shared-home art/action contract.

    The JSON is also imported by the Web renderer and its static guard, so the
    eight private sleep slots and all thirteen Life Action anchors cannot drift
    independently from the backend's built-in placement defaults.
    """
    value = json.loads(SHARED_HOME_MANIFEST_PATH.read_text(encoding="utf-8"))
    validate_shared_home_manifest(value)
    return value


def _oriented_rectangles_overlap(first: dict[str, Any], second: dict[str, Any],
                                  footprints: dict[str, list[float]]) -> bool:
    """Return whether two blocking floor footprints overlap with a small seam."""
    def rectangle(item: dict[str, Any]):
        width, depth = footprints[item["asset"]]
        scale = item["scale"]
        width, depth = width * scale[0], depth * scale[2]
        angle = float(item.get("rotation", 0))
        center = (float(item["position"][0]), float(item["position"][2]))
        axes = ((math.cos(angle), math.sin(angle)), (-math.sin(angle), math.cos(angle)))
        return center, axes, (width / 2, depth / 2)

    a_center, a_axes, a_half = rectangle(first)
    b_center, b_axes, b_half = rectangle(second)
    difference = (b_center[0] - a_center[0], b_center[1] - a_center[1])
    for axis in (*a_axes, *b_axes):
        distance = abs(difference[0] * axis[0] + difference[1] * axis[1])
        a_radius = sum(a_half[index] * abs(a_axes[index][0] * axis[0]
                                             + a_axes[index][1] * axis[1]) for index in (0, 1))
        b_radius = sum(b_half[index] * abs(b_axes[index][0] * axis[0]
                                             + b_axes[index][1] * axis[1]) for index in (0, 1))
        if distance >= a_radius + b_radius - .025:
            return False
    return True


def validate_shared_home_manifest(value: dict[str, Any]) -> None:
    """Fail closed on visual collisions, missing resources or action anchors."""
    if value.get("version") != 1 or value.get("max_residents") != 8:
        raise ValueError("shared home must support exactly eight active residents")
    if value.get("occupancy_scenarios") != [2, 4, 8]:
        raise ValueError("shared home must retain 2/4/8 occupancy scenarios")
    bounds = value.get("room_bounds") or {}
    half_width, half_depth = float(bounds.get("width", 0)) / 2, float(bounds.get("depth", 0)) / 2
    center_z = float(bounds.get("center_z", 0))
    if half_width < 5 or half_depth < 3:
        raise ValueError("shared home room bounds are too small")

    rooms = value.get("rooms") or []
    required_rooms = {
        "living-room": "living_room", "kitchen": "kitchen",
        "bathroom": "bathroom", "bedroom": "bedroom",
    }
    if {room.get("id"): room.get("kind") for room in rooms} != required_rooms:
        raise ValueError("shared home must contain its four canonical functional rooms")
    footprints = value.get("asset_footprints") or {}
    fixture_ids: set[str] = {"builtin-television"}
    action_coverage: set[str] = set()
    sleep_slots: set[int] = set()
    required_assets = {
        "living-room": {"furniture/couch_pillows.gltf": 1,
                         "furniture/armchair_pillows.gltf": 3,
                         "furniture/shelf_B_large_decorated.gltf": 1},
        "kitchen": {"kitchen/countertop_sink.gltf": 1, "kitchen/fridge.gltf": 1,
                    "kitchen/stove.gltf": 1, "kitchen/table_A.gltf": 2,
                    "kitchen/chair.gltf": 4, "kitchen/floor_tiles_kitchen.gltf": 1},
        "bathroom": {"bathroom/shower.gltf": 1, "bathroom/bath.gltf": 1,
                     "bathroom/cabinet_bathroom.gltf": 1, "bathroom/toilet.gltf": 1,
                     "bathroom/floor_tiled.gltf": 1},
        "bedroom": {"furniture/bed_single_A.gltf": 8},
    }
    for room in rooms:
        placements = room.get("placements") or []
        placement_ids = [str(item.get("id")) for item in placements]
        if len(placement_ids) != len(set(placement_ids)):
            raise ValueError(f"duplicate shared-home fixture id in {room['id']}")
        fixture_ids.update(placement_ids)
        counts: dict[str, int] = {}
        blocking: list[dict[str, Any]] = []
        for placement in placements:
            asset = str(placement.get("asset") or "")
            counts[asset] = counts.get(asset, 0) + 1
            position, scale = placement.get("position") or [], placement.get("scale") or []
            if len(position) != 3 or len(scale) != 3 or min(map(float, scale)) <= 0:
                raise ValueError(f"invalid shared-home transform: {placement.get('id')}")
            x, z = float(position[0]), float(position[2])
            if not (-half_width <= x <= half_width and center_z - half_depth <= z <= center_z + half_depth):
                raise ValueError(f"shared-home fixture outside room: {placement.get('id')}")
            if asset in footprints:
                blocking.append(placement)
        for asset, minimum in required_assets[room["id"]].items():
            if counts.get(asset, 0) < minimum:
                raise ValueError(f"shared home {room['id']} requires {minimum} x {asset}")
        for index, first in enumerate(blocking):
            for second in blocking[index + 1:]:
                if _oriented_rectangles_overlap(first, second, footprints):
                    raise ValueError(
                        f"shared-home fixtures overlap in {room['id']}: {first['id']} / {second['id']}"
                    )

        anchors = room.get("anchors") or []
        anchor_ids = [str(anchor.get("id")) for anchor in anchors]
        if len(anchor_ids) != len(set(anchor_ids)) or not any(
            anchor.get("kind") == "entry" for anchor in anchors
        ):
            raise ValueError(f"shared home {room['id']} needs unique anchors and an entry")
        for anchor in anchors:
            position = anchor.get("position") or []
            if len(position) != 3:
                raise ValueError(f"invalid shared-home anchor: {anchor.get('id')}")
            x, z = float(position[0]), float(position[2])
            if not (-half_width <= x <= half_width and center_z - half_depth <= z <= center_z + half_depth):
                raise ValueError(f"shared-home anchor outside room: {anchor.get('id')}")
            fixture_id = anchor.get("fixture_id")
            if fixture_id and fixture_id not in placement_ids:
                raise ValueError(f"shared-home anchor has missing fixture: {anchor.get('id')}")
            actions = set(anchor.get("actions") or [])
            if not actions <= SHARED_HOME_ACTIONS:
                raise ValueError(f"shared-home anchor has unknown Life Action: {anchor.get('id')}")
            action_coverage.update(actions)
            if anchor.get("kind") == "private-bed":
                if anchor.get("privacy") != "private" or "sleep" not in actions:
                    raise ValueError("every sleeping pod must be private and support sleep")
                sleep_slots.add(int(anchor.get("slot", 0)))

    if action_coverage != SHARED_HOME_ACTIONS:
        missing = ", ".join(sorted(SHARED_HOME_ACTIONS - action_coverage))
        raise ValueError(f"shared home is missing Life Action anchors: {missing}")
    if sleep_slots != set(range(1, 9)):
        raise ValueError("shared home must expose eight distinct private sleeping slots")

    resources = value.get("resources") or []
    by_kind = {resource.get("kind"): resource for resource in resources}
    if set(by_kind) != {"kitchen", "television", "bathroom"}:
        raise ValueError("shared home must expose kitchen, television and bathroom resources")
    expected_capacities = {"kitchen": 1, "television": 2, "bathroom": 1}
    for kind, expected in expected_capacities.items():
        resource = by_kind[kind]
        if resource.get("capacity") != expected:
            raise ValueError(f"shared home {kind} capacity must be {expected}")
        if not resource.get("fixture_ids") or not set(resource["fixture_ids"]) <= fixture_ids:
            raise ValueError(f"shared home {kind} references a missing fixture")


def _default_rooms() -> list[dict[str, Any]]:
    rooms = []
    for room in shared_home_manifest()["rooms"]:
        rooms.append({
            "id": room["id"], "name": room["name"], "kind": room["kind"],
            "placements": [
                _placement(
                    placement["id"], f"{INTERIOR_ROOT}/{placement['asset']}",
                    *placement["position"], placement.get("rotation", 0),
                    tuple(placement["scale"]), room_id=room["id"],
                )
                for placement in room["placements"]
            ],
        })
    return rooms


def default_world_layout() -> dict[str, Any]:
    """Return a fresh, fully validated default suitable for direct rendering."""
    value = {
        "version": 1,
        "city": {
            "roads": _default_roads(), "buildings": _default_buildings(),
            "props": _default_props(), "decorations": _default_decorations(),
        },
        "interior": {"rooms": _default_rooms()},
    }
    return WorldLayout.model_validate(value).model_dump(mode="json")
