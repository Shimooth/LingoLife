"""Explicit, reversible planning for the resident town; never writes a save."""

from __future__ import annotations

from copy import deepcopy
import json
import heapq
import math
from pathlib import Path
from typing import Any, Mapping

TOWN_CONFIG_PATH = Path(__file__).resolve().parents[2] / "config" / "town-center.json"
TOWN_THEME = "resident-town-v1"


def town_center_config() -> dict[str, Any]:
    return json.loads(TOWN_CONFIG_PATH.read_text(encoding="utf-8"))


def plan_resident_town(layout: Mapping[str, Any]) -> dict[str, Any]:
    """Transform only the planned district; return a fresh document.

    Published layouts are opt-in: callers must explicitly publish the returned
    document. Named buildings retain their ids/assets and all locations retain
    their simulation identity. Roads and interiors are byte-for-byte preserved.
    Once adopted, editor changes are authoritative and are never reapplied.
    """
    result = deepcopy(dict(layout))
    city = result["city"]
    if city.get("theme") == TOWN_THEME:
        return result
    config = town_center_config()
    by_id = {item["id"]: item for item in city["buildings"]}
    for identifier, transform in config["relocations"].items():
        if identifier not in by_id:
            raise ValueError(f"town plan requires existing placement {identifier}")
        placement = by_id[identifier]
        placement["position"]["x"], placement["position"]["z"] = transform["position"]
        placement["rotation"]["y"] = transform["rotation"]
    for identifier, role in config["building_roles"].items():
        if identifier not in by_id:
            raise ValueError(f"town plan requires existing placement {identifier}")
        if role != "plaza":
            by_id[identifier]["scale"] = {"x": 1, "y": 1, "z": 1}
    # These are known default dressing in the new home/plaza/shop footprints.
    # Do not remove unknown authored objects: the town validation gate reports
    # those as conflicts for review instead of quietly erasing the edits.
    cleared = {"hydrant-cafe", "trash-centre-a", "park-bush-5", "park-bush-6", "tree-8"}
    for layer in ("props", "decorations"):
        city[layer] = [item for item in city[layer] if item["id"] not in cleared]
    # Existing default cars used to sit in the travel lanes. Preserve authored
    # off-road parking, but move those three legacy placements into real bays.
    from .layout_validation import _overlap, _rectangle, load_world_asset_catalog

    assets = load_world_asset_catalog()["assets"]
    road_rectangles = [_rectangle(item, assets[item["asset"]]) for item in city["roads"]]
    bays = {"car-taxi-centre": 13.4, "car-sedan-west": 16, "car-police-dawn": 18.6}
    for item in city["props"] + city["decorations"]:
        if "/car_" not in item["asset"]:
            continue
        item["scale"] = {"x": 1.08, "y": 1.08, "z": 1.08}
        item["position"]["y"] = round(.369 + .061042905 * 1.08 + .002, 6)
        footprint = _rectangle(item, assets[item["asset"]])
        if item["id"] in bays and any(_overlap(footprint, road, .01) for road in road_rectangles):
            item["position"]["x"], item["position"]["z"] = bays[item["id"]], 7.65
            item["rotation"]["y"] = 3.1416
    city["theme"] = TOWN_THEME
    return result


def town_plan_changes(before: Mapping[str, Any], after: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Reviewable, compact change list without player/account contents."""
    changes: list[dict[str, Any]] = []
    if before["city"].get("theme") != after["city"].get("theme"):
        changes.append({"layer": "city", "id": "theme", "before": before["city"].get("theme"),
                        "after": after["city"].get("theme")})
    for layer in ("roads", "buildings", "props", "decorations"):
        old = {item["id"]: item for item in before["city"][layer]}
        new = {item["id"]: item for item in after["city"][layer]}
        for identifier in sorted(old.keys() | new.keys()):
            if old.get(identifier) != new.get(identifier):
                changes.append({"layer": layer, "id": identifier,
                                "before": old.get(identifier), "after": new.get(identifier)})
    return changes


def pedestrian_path(nodes: Mapping[str, Any], start: str, finish: str) -> tuple[list[list[float]], float] | None:
    distances, previous = {start: 0.0}, {}
    queue = [(0.0, start)]
    while queue:
        distance, current = heapq.heappop(queue)
        if distance > distances.get(current, math.inf):
            continue
        if current == finish:
            path = [current]
            while path[-1] != start:
                path.append(previous[path[-1]])
            return [list(nodes[key]["position"]) for key in reversed(path)], distance
        for neighbor in sorted(nodes[current]["neighbors"]):
            candidate = distance + math.dist(nodes[current]["position"], nodes[neighbor]["position"])
            if candidate < distances.get(neighbor, math.inf) - 1e-9:
                distances[neighbor], previous[neighbor] = candidate, current
                heapq.heappush(queue, (candidate, neighbor))
    return None


def compile_town_pedestrians(city: Mapping[str, Any], locations: dict[str, Any]) -> dict[str, Any] | None:
    """Attach authored footpaths without changing the traffic-road graph."""
    if city.get("theme") != TOWN_THEME:
        return None
    town = town_center_config()
    nodes: dict[str, Any] = {}
    key = lambda point: f"town:{float(point[0]):g}:{float(point[1]):g}"
    for walkway in town["walkways"]:
        for point in walkway["points"]:
            nodes.setdefault(key(point), {"position": list(point), "neighbors": set()})
        for first, second in zip(walkway["points"], walkway["points"][1:]):
            nodes[key(first)]["neighbors"].add(key(second))
            nodes[key(second)]["neighbors"].add(key(first))
    for node in nodes.values():
        node["neighbors"] = sorted(node["neighbors"])
    portal = town["pedestrian"]["road_portal"]
    portal_key = key(portal["position"])
    road_position = portal["road_position"]
    road_node = f"{round(road_position[0] / 2.6)}:{round(road_position[1] / 2.6)}"
    destinations = {}
    placements = {item["id"]: item for item in city["buildings"]}
    for identifier, destination in town["pedestrian"]["destinations"].items():
        placement = placements[identifier]
        expected = town["relocations"][identifier]["position"]
        # An administrator may move a themed venue later. Until its footpath
        # is reauthored, the general road connector follows the new placement.
        if any(abs(placement["position"][axis] - expected[index]) > .001 for index, axis in enumerate(("x", "z"))):
            continue
        runtime_id = placement.get("location_id") or identifier
        node_id = key(destination["position"])
        result = pedestrian_path(nodes, node_id, portal_key)
        if result is None:
            raise ValueError(f"town destination {identifier} is disconnected")
        points, distance = result
        connector = [*points, list(road_position)]
        locations[runtime_id].update({
            "road_node_id": road_node,
            "connector_distance": round(distance + math.dist(portal["position"], road_position), 4),
            "pedestrian_position": list(destination["position"]),
            "pedestrian_connector": connector,
        })
        destinations[runtime_id] = node_id
    return {"nodes": nodes, "destinations": destinations, "road_node_id": road_node}
