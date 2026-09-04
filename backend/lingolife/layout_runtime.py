"""Compile an approved visual layout into the shared-home simulation contract.

The authoring schema intentionally cannot edit hidden NPC facts.  It can,
however, move approved fixtures and add additional approved stations.  This
compiler turns those visual choices into stable action anchors and bounded
resource capacities consumed by :class:`LifeWorldEngine`.
"""

from __future__ import annotations

from copy import deepcopy
from functools import lru_cache
import heapq
import math
from typing import Any, Mapping

from .city import CITY_LOCATIONS
from .layout_validation import load_world_asset_catalog
from .layouts import default_world_layout, shared_home_manifest


CITY_RUNTIME_SCHEMA_VERSION = 1
CITY_HOME_LOCATION_ID = "shared-home"
_DIRECTIONS = ("north", "east", "south", "west")
_OFFSETS = {"north": (0, -1), "east": (1, 0), "south": (0, 1), "west": (-1, 0)}
_OPPOSITE = {"north": "south", "east": "west", "south": "north", "west": "east"}

# Building families are intentionally gameplay-relevant but coarse.  The
# semantic location remains authoritative (a library does not become a cafe
# merely because its shell changes), while its shell decides which optional
# opportunities the venue can physically support.
_FAMILY_OPPORTUNITIES = {
    "residential": frozenset({"social_space"}),
    "commercial": frozenset({"dining_space", "social_space"}),
    "public": frozenset({"reading_space", "hobby_space", "goal_space", "social_space"}),
}
_LOCATION_OPPORTUNITIES = {
    "transit": frozenset({"social_space"}),
    "work": frozenset({"goal_space", "social_space"}),
    "health": frozenset({"goal_space", "social_space"}),
    "park": frozenset({"hobby_space", "reading_space", "social_space"}),
    "civic": frozenset({"goal_space", "social_space"}),
    "shopping": frozenset({"dining_space", "social_space"}),
    "cafe": frozenset({"dining_space", "social_space"}),
    "restaurant": frozenset({"dining_space", "social_space"}),
    "culture": frozenset({"hobby_space", "social_space"}),
    "education": frozenset({"reading_space", "goal_space", "social_space"}),
    "plaza": frozenset({"hobby_space", "social_space"}),
    "fitness": frozenset({"hobby_space", "social_space"}),
    "waterfront": frozenset({"hobby_space", "social_space"}),
}


def _xyz(value: object) -> tuple[float, float, float]:
    if isinstance(value, Mapping):
        return float(value.get("x", 0)), float(value.get("y", 0)), float(value.get("z", 0))
    if isinstance(value, (list, tuple)) and len(value) >= 3:
        return float(value[0]), float(value[1]), float(value[2])
    return 0.0, 0.0, 0.0


def _rotation_y(value: object) -> float:
    if isinstance(value, Mapping):
        return float(value.get("y", 0))
    return float(value or 0)


def _asset_path(value: object) -> str:
    path = str(value or "")
    return path if path.startswith("/assets/") else f"/assets/life/interiors/{path.lstrip('/')}"


def _road_node_id(cell: tuple[int, int]) -> str:
    return f"{cell[0]}:{cell[1]}"


def _rotated_ports(base_ports: object, rotation: float) -> frozenset[str]:
    ports = tuple(str(value) for value in base_ports) if isinstance(base_ports, (list, tuple)) else ()
    turns = round(rotation / (math.pi / 2))
    return frozenset(
        _DIRECTIONS[(_DIRECTIONS.index(direction) - turns) % 4]
        for direction in ports if direction in _DIRECTIONS
    )


def _compile_road_nodes(
    roads: list[Mapping[str, Any]],
    assets: Mapping[str, Mapping[str, Any]],
    step: float,
) -> dict[str, dict[str, Any]]:
    by_cell: dict[tuple[int, int], dict[str, Any]] = {}
    for placement in roads:
        x, _, z = _xyz(placement.get("position"))
        cell = (round(x / step), round(z / step))
        metadata = assets.get(str(placement.get("asset") or ""), {})
        ports = _rotated_ports(
            dict(metadata.get("semantic_capabilities") or {}).get("road_ports", ()),
            _rotation_y(placement.get("rotation")),
        )
        by_cell[cell] = {
            "id": _road_node_id(cell),
            "cell": [cell[0], cell[1]],
            "position": [round(x, 4), round(z, 4)],
            "ports": sorted(ports),
            "neighbors": [],
        }
    for cell, node in sorted(by_cell.items()):
        ports = set(node["ports"])
        neighbors: list[str] = []
        for direction in _DIRECTIONS:
            if direction not in ports:
                continue
            offset = _OFFSETS[direction]
            neighbor_cell = (cell[0] + offset[0], cell[1] + offset[1])
            neighbor = by_cell.get(neighbor_cell)
            if neighbor is not None and _OPPOSITE[direction] in neighbor["ports"]:
                neighbors.append(str(neighbor["id"]))
        node["neighbors"] = sorted(neighbors)
    return {
        str(node["id"]): node for _, node in sorted(by_cell.items())
    }


def _nearest_road_node(
    position: tuple[float, float], road_nodes: Mapping[str, Mapping[str, Any]],
) -> tuple[str, float]:
    if not road_nodes:
        raise ValueError("city runtime requires at least one road node")
    node_id, node = min(
        road_nodes.items(),
        key=lambda item: (
            (float(item[1]["position"][0]) - position[0]) ** 2
            + (float(item[1]["position"][1]) - position[1]) ** 2,
            item[0],
        ),
    )
    connector = math.hypot(
        float(node["position"][0]) - position[0],
        float(node["position"][1]) - position[1],
    )
    return node_id, round(connector, 4)


def compile_city_runtime(
    layout: Mapping[str, Any] | None,
    *,
    asset_catalog: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Compile authored city geometry into deterministic simulation facts.

    The result contains no NPC state.  Location ids remain stable across
    versions, while building anchors, family-supported opportunities and the
    traversable road graph come from the active layout rather than the legacy
    4800x3000 presentation coordinates.
    """
    world = deepcopy(dict(layout or default_world_layout()))
    catalog = dict(asset_catalog or load_world_asset_catalog())
    assets = dict(catalog.get("assets") or {})
    road_policy = dict((catalog.get("topology_policy") or {}).get("road_grid") or {})
    step = float(road_policy.get("step") or 2.6)
    city = dict(world.get("city") or {})
    roads = [value for value in city.get("roads", []) if isinstance(value, Mapping)]
    buildings = [value for value in city.get("buildings", []) if isinstance(value, Mapping)]
    road_nodes = _compile_road_nodes(roads, assets, step)
    location_contracts = {value.id: value for value in CITY_LOCATIONS}
    locations: dict[str, dict[str, Any]] = {}
    for placement in sorted(buildings, key=lambda value: str(value.get("id") or "")):
        location_id = str(placement.get("location_id") or "")
        is_home = str(placement.get("id") or "") == CITY_HOME_LOCATION_ID
        if not location_id and not is_home:
            continue
        runtime_id = CITY_HOME_LOCATION_ID if is_home else location_id
        contract = location_contracts.get(location_id)
        if not is_home and contract is None:
            continue
        x, _, z = _xyz(placement.get("position"))
        road_node_id, connector_distance = _nearest_road_node((x, z), road_nodes)
        metadata = dict(assets.get(str(placement.get("asset") or "")) or {})
        capabilities = dict(metadata.get("semantic_capabilities") or {})
        family = str(capabilities.get("building_family") or "unknown")
        location_kind = "home" if is_home else str(contract.kind)
        supported = (
            frozenset() if is_home
            else _FAMILY_OPPORTUNITIES.get(family, frozenset())
            & _LOCATION_OPPORTUNITIES.get(location_kind, frozenset())
        )
        locations[runtime_id] = {
            "id": runtime_id,
            "location_id": None if is_home else location_id,
            "building_id": str(placement.get("id") or ""),
            "asset": str(placement.get("asset") or ""),
            "building_family": family,
            "kind": location_kind,
            "position": [round(x, 4), round(z, 4)],
            "road_node_id": road_node_id,
            "connector_distance": connector_distance,
            "opportunity_kinds": sorted(supported),
        }
    missing = set(location_contracts) - set(locations)
    if missing:
        raise ValueError(f"city runtime is missing mapped locations: {', '.join(sorted(missing))}")
    if CITY_HOME_LOCATION_ID not in locations:
        raise ValueError("city runtime is missing the shared-home building")
    return {
        "schema_version": CITY_RUNTIME_SCHEMA_VERSION,
        "road_step": step,
        "road_nodes": road_nodes,
        "locations": dict(sorted(locations.items())),
    }


@lru_cache(maxsize=1)
def _cached_default_city_runtime() -> dict[str, Any]:
    return compile_city_runtime(default_world_layout())


def default_city_runtime() -> dict[str, Any]:
    """Return an isolated copy of the built-in city simulation contract."""
    return deepcopy(_cached_default_city_runtime())


def city_opportunity_available(
    runtime: Mapping[str, Any], location_id: str, opportunity_kind: str,
) -> bool:
    location = dict((runtime.get("locations") or {}).get(location_id) or {})
    return opportunity_kind in set(str(value) for value in location.get("opportunity_kinds", []))


def city_route(
    runtime: Mapping[str, Any], origin_location_id: str, target_location_id: str,
) -> dict[str, Any] | None:
    """Return the stable shortest authored-road route between two anchors."""
    locations = dict(runtime.get("locations") or {})
    origin = locations.get(origin_location_id)
    target = locations.get(target_location_id)
    if not isinstance(origin, Mapping) or not isinstance(target, Mapping):
        return None
    if origin_location_id == target_location_id:
        return {
            "origin_location_id": origin_location_id,
            "target_location_id": target_location_id,
            "distance": 0.0,
            "road_node_ids": [],
            "points": [list(origin["position"])],
        }
    nodes = dict(runtime.get("road_nodes") or {})
    start, finish = str(origin.get("road_node_id") or ""), str(target.get("road_node_id") or "")
    if start not in nodes or finish not in nodes:
        return None
    distances: dict[str, float] = {start: 0.0}
    previous: dict[str, str] = {}
    queue: list[tuple[float, str]] = [(0.0, start)]
    while queue:
        distance, node_id = heapq.heappop(queue)
        if distance > distances.get(node_id, math.inf) + 1e-9:
            continue
        if node_id == finish:
            break
        node = nodes[node_id]
        x, z = float(node["position"][0]), float(node["position"][1])
        for neighbor_id in sorted(str(value) for value in node.get("neighbors", [])):
            neighbor = nodes.get(neighbor_id)
            if not isinstance(neighbor, Mapping):
                continue
            edge = math.hypot(
                float(neighbor["position"][0]) - x,
                float(neighbor["position"][1]) - z,
            )
            candidate = distance + edge
            if candidate + 1e-9 < distances.get(neighbor_id, math.inf):
                distances[neighbor_id] = candidate
                previous[neighbor_id] = node_id
                heapq.heappush(queue, (candidate, neighbor_id))
    if finish not in distances:
        return None
    path = [finish]
    while path[-1] != start:
        path.append(previous[path[-1]])
    path.reverse()
    points = [list(origin["position"])]
    points.extend([list(nodes[node_id]["position"]) for node_id in path])
    points.append(list(target["position"]))
    deduplicated: list[list[float]] = []
    for point in points:
        normalized = [round(float(point[0]), 4), round(float(point[1]), 4)]
        if not deduplicated or normalized != deduplicated[-1]:
            deduplicated.append(normalized)
    total = (
        float(origin.get("connector_distance") or 0)
        + distances[finish]
        + float(target.get("connector_distance") or 0)
    )
    return {
        "origin_location_id": origin_location_id,
        "target_location_id": target_location_id,
        "distance": round(total, 4),
        "road_node_ids": path,
        "points": deduplicated,
    }


def _move_anchor(anchor: Mapping[str, Any], baseline: Mapping[str, Any],
                 authored: Mapping[str, Any]) -> dict[str, Any]:
    source_x, source_y, source_z = _xyz(baseline.get("position"))
    target_x, target_y, target_z = _xyz(authored.get("position"))
    anchor_x, anchor_y, anchor_z = _xyz(anchor.get("position"))
    difference = _rotation_y(authored.get("rotation")) - _rotation_y(baseline.get("rotation"))
    cosine, sine = math.cos(difference), math.sin(difference)
    offset_x, offset_z = anchor_x - source_x, anchor_z - source_z
    result = deepcopy(dict(anchor))
    result["position"] = [
        target_x + offset_x * cosine - offset_z * sine,
        target_y + anchor_y - source_y,
        target_z + offset_x * sine + offset_z * cosine,
    ]
    result["rotation"] = _rotation_y(anchor.get("rotation")) + difference
    return result


def _additional_capacity(kind: str, baseline_ids: set[str],
                         authored: list[Mapping[str, Any]],
                         assets: Mapping[str, Mapping[str, Any]]) -> int:
    extra = 0
    for placement in authored:
        if str(placement.get("id") or "") in baseline_ids:
            continue
        capabilities = dict(assets.get(_asset_path(placement.get("asset")), {}).get(
            "semantic_capabilities", {}
        ))
        actions = set(str(value) for value in capabilities.get("life_actions", []))
        if kind == "television" and "use_television" in actions:
            extra += max(1, int(capabilities.get("seat_count", 1)))
        elif kind == "kitchen" and capabilities.get("resource_kind") == "kitchen" \
                and "prepare_food" in actions:
            extra += 1
        elif kind == "bathroom" and capabilities.get("resource_kind") == "bathroom" \
                and "shower" in actions:
            extra += 1
    return extra


def compile_shared_home_runtime(
    layout: Mapping[str, Any] | None,
    *,
    manifest: Mapping[str, Any] | None = None,
    asset_catalog: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Return a deterministic semantic manifest for one validated layout.

    Required baseline fixtures remain required by the publish validator.  An
    author may add another approved sofa, stove, or shower; those additions
    increase the corresponding capacity instead of remaining decorative only.
    Existing fixture-relative anchors follow authored translation/rotation.
    """
    source = deepcopy(dict(manifest or shared_home_manifest()))
    world = deepcopy(dict(layout or default_world_layout()))
    catalog = dict(asset_catalog or load_world_asset_catalog())
    assets = dict(catalog.get("assets") or {})
    authored_rooms = {
        str(room.get("id")): room
        for room in ((world.get("interior") or {}).get("rooms") or [])
        if isinstance(room, Mapping)
    }

    baseline_ids_by_room: dict[str, set[str]] = {}
    authored_by_room: dict[str, list[Mapping[str, Any]]] = {}
    for room in source.get("rooms", []):
        room_id = str(room["id"])
        baseline = {
            str(item["id"]): item for item in room.get("placements", [])
            if isinstance(item, Mapping) and item.get("id")
        }
        authored = [
            item for item in authored_rooms.get(room_id, {}).get("placements", [])
            if isinstance(item, Mapping)
        ]
        authored_index = {str(item.get("id")): item for item in authored}
        baseline_ids_by_room[room_id] = set(baseline)
        authored_by_room[room_id] = authored
        room["anchors"] = [
            _move_anchor(anchor, baseline[str(anchor["fixture_id"])],
                         authored_index[str(anchor["fixture_id"])])
            if (isinstance(anchor, Mapping) and anchor.get("fixture_id") in baseline
                and anchor.get("fixture_id") in authored_index)
            else deepcopy(anchor)
            for anchor in room.get("anchors", [])
        ]

    for resource in source.get("resources", []):
        kind, room_id = str(resource.get("kind")), str(resource.get("room_id"))
        base_capacity = max(1, int(resource.get("capacity", 1)))
        resource["capacity"] = base_capacity + _additional_capacity(
            kind, baseline_ids_by_room.get(room_id, set()),
            authored_by_room.get(room_id, []), assets,
        )
    return source


__all__ = [
    "CITY_HOME_LOCATION_ID",
    "CITY_RUNTIME_SCHEMA_VERSION",
    "city_opportunity_available",
    "city_route",
    "compile_city_runtime",
    "compile_shared_home_runtime",
    "default_city_runtime",
]
