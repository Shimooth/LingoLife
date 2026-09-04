"""Pure, data-driven topology validation for authored world layouts.

The public ``validate_layout_topology`` function deliberately receives the
layout, shared-home manifest and asset catalog as plain mappings.  It performs
no database access, mutation or filesystem I/O, which makes the same validator
suitable for draft previews, publish gates and migration audits.
"""

from __future__ import annotations

from collections import deque
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
import json
import math
from pathlib import Path
from typing import Any


WORLD_ASSET_CATALOG_PATH = Path(__file__).resolve().parents[2] / "config" / "world-asset-catalog.json"
_DIRECTIONS = ("north", "east", "south", "west")
_OFFSETS = {"north": (0, -1), "east": (1, 0), "south": (0, 1), "west": (-1, 0)}
_OPPOSITE = {"north": "south", "east": "west", "south": "north", "west": "east"}
_INTERIOR_ROOT = "/assets/life/interiors/"


class AssetCatalogError(ValueError):
    """Raised when the canonical asset metadata is incomplete or inconsistent."""


@dataclass(frozen=True)
class LayoutValidationIssue:
    code: str
    path: str
    message: str


class LayoutTopologyError(ValueError):
    """A deterministic collection of topology errors suitable for API output."""

    def __init__(self, issues: Sequence[LayoutValidationIssue]):
        self.issues = tuple(issues)
        summary = "; ".join(f"{issue.code} at {issue.path}: {issue.message}" for issue in self.issues)
        super().__init__(summary)


@dataclass(frozen=True)
class LayoutTopologyReport:
    road_tiles: int
    road_edges: int
    sky_road_exits: int
    buildings: int
    decorations: int
    connected_rooms: int
    room_connections: int
    shared_home_actions: int
    private_sleep_slots: int


@dataclass(frozen=True)
class _Rectangle:
    center: tuple[float, float]
    half: tuple[float, float]
    rotation: float


def load_world_asset_catalog(path: Path = WORLD_ASSET_CATALOG_PATH) -> dict[str, Any]:
    """I/O convenience wrapper; validation itself remains a separate pure step."""
    return json.loads(path.read_text(encoding="utf-8"))


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def _is_string_list(value: Any) -> bool:
    return isinstance(value, list) and bool(value) and all(isinstance(item, str) and item for item in value)


def validate_asset_catalog(
    catalog: Mapping[str, Any],
    expected_assets_by_layer: Mapping[str, Collection[str]] | None = None,
) -> dict[str, Mapping[str, Any]]:
    """Validate metadata completeness and optionally prove allowlist coverage."""
    errors: list[str] = []
    if catalog.get("schema_version") != 1:
        errors.append("schema_version must be 1")
    licenses = catalog.get("licenses")
    sources = catalog.get("sources")
    assets = catalog.get("assets")
    if not isinstance(licenses, Mapping) or not licenses:
        errors.append("licenses must be a non-empty object")
        licenses = {}
    if not isinstance(sources, Mapping) or not sources:
        errors.append("sources must be a non-empty object")
        sources = {}
    if not isinstance(assets, Mapping) or not assets:
        errors.append("assets must be a non-empty object")
        assets = {}

    for source_id, source in sources.items():
        if not isinstance(source, Mapping):
            errors.append(f"source {source_id} must be an object")
            continue
        license_id = source.get("license_id")
        if license_id not in licenses:
            errors.append(f"source {source_id} references unknown license {license_id}")
        for field in ("creator", "pack", "url", "license_file"):
            if not isinstance(source.get(field), str) or not source[field]:
                errors.append(f"source {source_id} is missing {field}")

    normalized: dict[str, Mapping[str, Any]] = {}
    for asset_path, metadata in assets.items():
        location = f"asset {asset_path}"
        if not isinstance(asset_path, str) or not asset_path.startswith("/assets/") or not asset_path.endswith(".gltf"):
            errors.append(f"{location} has a non-runtime path")
        if not isinstance(metadata, Mapping):
            errors.append(f"{location} metadata must be an object")
            continue
        source_id, license_id = metadata.get("source_id"), metadata.get("license_id")
        if source_id not in sources:
            errors.append(f"{location} references unknown source {source_id}")
        if license_id not in licenses:
            errors.append(f"{location} references unknown license {license_id}")
        elif isinstance(sources.get(source_id), Mapping) and sources[source_id].get("license_id") != license_id:
            errors.append(f"{location} license differs from its source")
        if not isinstance(metadata.get("category"), str) or not metadata["category"]:
            errors.append(f"{location} is missing category")
        if not _is_string_list(metadata.get("allowed_layers")):
            errors.append(f"{location} is missing allowed_layers")
        footprint, bounds, lod = metadata.get("footprint"), metadata.get("bounds"), metadata.get("lod")
        if not isinstance(footprint, Mapping) or footprint.get("shape") != "rectangle" or not isinstance(footprint.get("blocking"), bool):
            errors.append(f"{location} has invalid footprint metadata")
        elif not isinstance(footprint.get("size"), list) or len(footprint["size"]) != 2 or not all(_is_number(item) and item > 0 for item in footprint["size"]):
            errors.append(f"{location} footprint size must contain two positive numbers")
        if not isinstance(bounds, Mapping) or bounds.get("source") not in {"gltf_accessor", "curated"}:
            errors.append(f"{location} has invalid bounds metadata")
        elif not isinstance(bounds.get("size"), list) or len(bounds["size"]) != 3 or not all(_is_number(item) and item > 0 for item in bounds["size"]):
            errors.append(f"{location} bounds size must contain three positive numbers")
        if not isinstance(lod, Mapping) or lod.get("strategy") not in {"single_mesh", "distance", "instanced"} or not isinstance(lod.get("levels"), int) or lod["levels"] < 1:
            errors.append(f"{location} has invalid LOD metadata")
        if not _is_string_list(metadata.get("uses")):
            errors.append(f"{location} is missing uses")
        if not isinstance(metadata.get("semantic_capabilities"), Mapping) or not metadata["semantic_capabilities"]:
            errors.append(f"{location} is missing semantic_capabilities")
        normalized[str(asset_path)] = metadata

    policy = catalog.get("topology_policy")
    if not isinstance(policy, Mapping) or not isinstance(policy.get("road_grid"), Mapping) or not isinstance(policy.get("shared_home"), Mapping):
        errors.append("topology_policy must define road_grid and shared_home")

    if expected_assets_by_layer is not None:
        expected_union: set[str] = set()
        for layer, expected in expected_assets_by_layer.items():
            expected_set = set(expected)
            expected_union.update(expected_set)
            actual_set = {path for path, metadata in normalized.items() if layer in metadata.get("allowed_layers", [])}
            missing, extra = expected_set - actual_set, actual_set - expected_set
            if missing:
                errors.append(f"{layer} catalog coverage is missing {', '.join(sorted(missing))}")
            if extra:
                errors.append(f"{layer} catalog coverage has unapproved {', '.join(sorted(extra))}")
        uncategorized = set(normalized) - expected_union
        if uncategorized:
            errors.append(f"catalog has assets outside the allowlists: {', '.join(sorted(uncategorized))}")

    if errors:
        raise AssetCatalogError("; ".join(errors))
    return normalized


def _xyz(value: Any) -> tuple[float, float, float]:
    if isinstance(value, Mapping):
        result = (value.get("x"), value.get("y"), value.get("z"))
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes)) and len(value) == 3:
        result = (value[0], value[1], value[2])
    else:
        raise ValueError("expected a three-component vector")
    if not all(_is_number(item) for item in result):
        raise ValueError("vector components must be finite numbers")
    return tuple(float(item) for item in result)


def _rotation_y(value: Any) -> float:
    if _is_number(value):
        return float(value)
    return _xyz(value)[1]


def _asset_path(value: Any) -> str:
    path = str(value or "")
    return path if path.startswith("/") else f"{_INTERIOR_ROOT}{path}"


def _rectangle(placement: Mapping[str, Any], metadata: Mapping[str, Any]) -> _Rectangle:
    x, _, z = _xyz(placement.get("position"))
    scale_x, _, scale_z = _xyz(placement.get("scale"))
    if scale_x <= 0 or scale_z <= 0:
        raise ValueError("footprint scale must be positive")
    width, depth = metadata["footprint"]["size"]
    return _Rectangle(
        center=(x, z),
        half=(float(width) * scale_x / 2, float(depth) * scale_z / 2),
        rotation=_rotation_y(placement.get("rotation", 0)),
    )


def _axes(rectangle: _Rectangle) -> tuple[tuple[float, float], tuple[float, float]]:
    cosine, sine = math.cos(rectangle.rotation), math.sin(rectangle.rotation)
    return ((cosine, sine), (-sine, cosine))


def _overlap(first: _Rectangle, second: _Rectangle, tolerance: float) -> bool:
    first_axes, second_axes = _axes(first), _axes(second)
    difference = (second.center[0] - first.center[0], second.center[1] - first.center[1])
    for axis in (*first_axes, *second_axes):
        distance = abs(difference[0] * axis[0] + difference[1] * axis[1])
        first_radius = sum(first.half[index] * abs(first_axes[index][0] * axis[0] + first_axes[index][1] * axis[1]) for index in (0, 1))
        second_radius = sum(second.half[index] * abs(second_axes[index][0] * axis[0] + second_axes[index][1] * axis[1]) for index in (0, 1))
        if distance >= first_radius + second_radius - tolerance:
            return False
    return True


def _point_blocked(point: tuple[float, float], rectangle: _Rectangle, padding: float) -> bool:
    difference = (point[0] - rectangle.center[0], point[1] - rectangle.center[1])
    return all(
        abs(difference[0] * axis[0] + difference[1] * axis[1]) < rectangle.half[index] + padding
        for index, axis in enumerate(_axes(rectangle))
    )


def _rotated_ports(base_ports: Sequence[str], rotation: float) -> frozenset[str]:
    turns = round(rotation / (math.pi / 2))
    return frozenset(_DIRECTIONS[(_DIRECTIONS.index(direction) - turns) % 4] for direction in base_ports)


def _layout_rectangles(
    placements: Sequence[Mapping[str, Any]],
    layer: str,
    assets: Mapping[str, Mapping[str, Any]],
    issues: list[LayoutValidationIssue],
) -> list[tuple[str, _Rectangle]]:
    result: list[tuple[str, _Rectangle]] = []
    for index, placement in enumerate(placements):
        path = str(placement.get("asset") or "")
        identifier = str(placement.get("id") or f"#{index}")
        metadata = assets.get(path)
        if metadata is None:
            issues.append(LayoutValidationIssue("asset.unknown", f"{layer}[{index}].asset", f"{path} has no catalog metadata"))
            continue
        if layer not in metadata.get("allowed_layers", []):
            issues.append(LayoutValidationIssue("asset.layer", f"{layer}[{index}].asset", f"{path} is not allowed in {layer}"))
            continue
        try:
            result.append((identifier, _rectangle(placement, metadata)))
        except (TypeError, ValueError, KeyError) as error:
            issues.append(LayoutValidationIssue("placement.transform", f"{layer}[{index}]", str(error)))
    return result


def _validate_roads(
    roads: Sequence[Mapping[str, Any]],
    assets: Mapping[str, Mapping[str, Any]],
    policy: Mapping[str, Any],
    issues: list[LayoutValidationIssue],
) -> tuple[list[tuple[str, _Rectangle]], int, int]:
    step = float(policy["step"])
    position_tolerance = float(policy["position_tolerance"])
    rotation_tolerance = float(policy["rotation_tolerance"])
    allowed_open = {
        (int(item["cell"][0]), int(item["cell"][1]), str(item["direction"]))
        for item in policy.get("open_ports", [])
    }
    by_cell: dict[tuple[int, int], tuple[str, frozenset[str]]] = {}
    seen_ids: set[str] = set()
    road_rectangles = _layout_rectangles(roads, "city.roads", assets, issues)

    for index, road in enumerate(roads):
        identifier, path = str(road.get("id") or f"#{index}"), str(road.get("asset") or "")
        metadata = assets.get(path)
        if metadata is None or "city.roads" not in metadata.get("allowed_layers", []):
            continue
        if identifier in seen_ids:
            issues.append(LayoutValidationIssue("road.id_duplicate", f"city.roads[{index}].id", identifier))
        seen_ids.add(identifier)
        try:
            x, _, z = _xyz(road.get("position"))
            rotation = _rotation_y(road.get("rotation", {}))
        except ValueError as error:
            issues.append(LayoutValidationIssue("placement.transform", f"city.roads[{index}]", str(error)))
            continue
        cell = (round(x / step), round(z / step))
        if abs(x - cell[0] * step) > position_tolerance or abs(z - cell[1] * step) > position_tolerance:
            issues.append(LayoutValidationIssue("road.grid_alignment", f"city.roads[{index}].position", f"{identifier} is off the {step:g}-unit grid"))
        quarter_turn = rotation / (math.pi / 2)
        if abs(quarter_turn - round(quarter_turn)) > rotation_tolerance:
            issues.append(LayoutValidationIssue("road.rotation", f"city.roads[{index}].rotation.y", f"{identifier} is not a quarter turn"))
        if cell in by_cell:
            issues.append(LayoutValidationIssue("road.cell_duplicate", f"city.roads[{index}].position", f"{identifier} shares cell {cell} with {by_cell[cell][0]}"))
            continue
        base_ports = metadata.get("semantic_capabilities", {}).get("road_ports", [])
        if not base_ports or any(direction not in _DIRECTIONS for direction in base_ports):
            issues.append(LayoutValidationIssue("road.metadata", f"catalog.assets.{path}", "road_ports are missing or invalid"))
            continue
        by_cell[cell] = (identifier, _rotated_ports(base_ports, rotation))

    graph = {cell: set() for cell in by_cell}
    seen_pairs: set[tuple[tuple[int, int], tuple[int, int]]] = set()
    seen_open: set[tuple[int, int, str]] = set()
    for cell, (identifier, ports) in by_cell.items():
        for direction, offset in _OFFSETS.items():
            neighbour_cell = (cell[0] + offset[0], cell[1] + offset[1])
            neighbour = by_cell.get(neighbour_cell)
            has_port = direction in ports
            if neighbour is None:
                if has_port:
                    port = (*cell, direction)
                    if port in allowed_open:
                        seen_open.add(port)
                    else:
                        issues.append(LayoutValidationIssue("road.open_edge", f"city.roads.{identifier}", f"unregistered {direction} port at {cell}"))
                continue
            pair = tuple(sorted((cell, neighbour_cell)))
            if pair in seen_pairs:
                continue
            seen_pairs.add(pair)
            neighbour_identifier, neighbour_ports = neighbour
            neighbour_has_port = _OPPOSITE[direction] in neighbour_ports
            if has_port != neighbour_has_port:
                issues.append(LayoutValidationIssue("road.port_mismatch", f"city.roads.{identifier}", f"{direction} edge disagrees with {neighbour_identifier}"))
            elif not has_port:
                issues.append(LayoutValidationIssue("road.closed_seam", f"city.roads.{identifier}", f"touches {neighbour_identifier} without matching road ports"))
            else:
                graph[cell].add(neighbour_cell)
                graph[neighbour_cell].add(cell)

    for cell_x, cell_z, direction in sorted(allowed_open - seen_open):
        issues.append(LayoutValidationIssue("road.exit_missing", "city.roads", f"required {direction} sky-road exit at {(cell_x, cell_z)} is missing"))

    if not graph:
        issues.append(LayoutValidationIssue("road.empty", "city.roads", "road network is empty"))
    else:
        first = next(iter(graph))
        visited, queue = {first}, deque([first])
        while queue:
            cell = queue.popleft()
            for neighbour in graph[cell]:
                if neighbour not in visited:
                    visited.add(neighbour)
                    queue.append(neighbour)
        if len(visited) != len(graph):
            missing = sorted(set(graph) - visited)
            issues.append(LayoutValidationIssue("road.disconnected", "city.roads", f"unreachable road cells: {missing[:8]}"))
    return road_rectangles, sum(len(edges) for edges in graph.values()) // 2, len(seen_open)


def _reachable_room_cells(
    room: Mapping[str, Any],
    blockers: Sequence[_Rectangle],
    bounds: Mapping[str, Any],
    entry: Mapping[str, Any],
    clearance: float,
    step: float,
) -> tuple[set[tuple[int, int]], Any, Any]:
    width, depth, center_z = float(bounds["width"]), float(bounds["depth"]), float(bounds["center_z"])
    min_x, max_x = -width / 2 + clearance, width / 2 - clearance
    min_z, max_z = center_z - depth / 2 + clearance, center_z + depth / 2 - clearance
    columns, rows = math.floor((max_x - min_x) / step) + 1, math.floor((max_z - min_z) / step) + 1

    def point(cell: tuple[int, int]) -> tuple[float, float]:
        return (min_x + cell[0] * step, min_z + cell[1] * step)

    def cell(value: Mapping[str, Any]) -> tuple[int, int]:
        x, _, z = _xyz(value.get("position"))
        return (round((x - min_x) / step), round((z - min_z) / step))

    def open_cell(candidate: tuple[int, int]) -> bool:
        if not (0 <= candidate[0] < columns and 0 <= candidate[1] < rows):
            return False
        coordinate = point(candidate)
        return not any(_point_blocked(coordinate, blocker, clearance) for blocker in blockers)

    start = cell(entry)
    if not open_cell(start):
        return set(), cell, point
    reached, queue = {start}, deque([start])
    while queue:
        column, row = queue.popleft()
        for neighbour in ((column + 1, row), (column - 1, row), (column, row + 1), (column, row - 1)):
            if neighbour not in reached and open_cell(neighbour):
                reached.add(neighbour)
                queue.append(neighbour)
    return reached, cell, point


def _index_interior_placements(
    room_id: str,
    placements: Sequence[Any],
    assets: Mapping[str, Mapping[str, Any]],
    issues: list[LayoutValidationIssue],
    scope: str,
    proposed: bool,
) -> tuple[dict[str, Mapping[str, Any]], dict[str, Mapping[str, Any]], list[tuple[str, _Rectangle]]]:
    by_id: dict[str, Mapping[str, Any]] = {}
    metadata_by_id: dict[str, Mapping[str, Any]] = {}
    blockers: list[tuple[str, _Rectangle]] = []
    prefix = "shared_home.proposed" if proposed else "shared_home"
    for index, placement in enumerate(placements):
        if not isinstance(placement, Mapping):
            issues.append(LayoutValidationIssue(f"{prefix}.fixture", f"{scope}[{index}]", "fixture must be an object"))
            continue
        fixture_id, path = str(placement.get("id") or f"#{index}"), _asset_path(placement.get("asset"))
        if fixture_id in by_id:
            issues.append(LayoutValidationIssue(f"{prefix}.fixture_duplicate", f"{scope}[{index}]", fixture_id))
        by_id[fixture_id] = placement
        if proposed and placement.get("room_id") != room_id:
            issues.append(LayoutValidationIssue("shared_home.proposed_room_reference", f"{scope}[{index}].room_id", f"fixture {fixture_id} must reference {room_id}"))
        metadata = assets.get(path)
        if metadata is None or "interior" not in metadata.get("allowed_layers", []):
            issues.append(LayoutValidationIssue(f"{prefix}.asset", f"{scope}[{index}].asset", f"{path} is not a catalogued interior asset"))
            continue
        metadata_by_id[fixture_id] = metadata
        if metadata["footprint"]["blocking"]:
            try:
                blockers.append((fixture_id, _rectangle(placement, metadata)))
            except (TypeError, ValueError, KeyError) as error:
                issues.append(LayoutValidationIssue("placement.transform", f"{scope}[{index}]", str(error)))
    return by_id, metadata_by_id, blockers


def _validate_fixture_overlaps(
    blockers: Sequence[tuple[str, _Rectangle]],
    scope: str,
    code: str,
    tolerance: float,
    issues: list[LayoutValidationIssue],
) -> None:
    for first_index, (first_id, first) in enumerate(blockers):
        for second_id, second in blockers[first_index + 1:]:
            if _overlap(first, second, tolerance):
                issues.append(LayoutValidationIssue(code, scope, f"{first_id} overlaps {second_id}"))


def _resolved_anchor(
    anchor: Mapping[str, Any],
    baseline: Mapping[str, Mapping[str, Any]],
    proposed: Mapping[str, Mapping[str, Any]],
) -> Mapping[str, Any]:
    """Move a fixture-relative semantic anchor with an authored fixture."""
    fixture_id = anchor.get("fixture_id")
    source, target = baseline.get(str(fixture_id)), proposed.get(str(fixture_id))
    if not fixture_id or source is None or target is None:
        return anchor
    source_x, source_y, source_z = _xyz(source.get("position"))
    target_x, target_y, target_z = _xyz(target.get("position"))
    anchor_x, anchor_y, anchor_z = _xyz(anchor.get("position"))
    difference = _rotation_y(target.get("rotation", 0)) - _rotation_y(source.get("rotation", 0))
    cosine, sine = math.cos(difference), math.sin(difference)
    offset_x, offset_z = anchor_x - source_x, anchor_z - source_z
    value = dict(anchor)
    value["position"] = [
        target_x + offset_x * cosine - offset_z * sine,
        target_y + anchor_y - source_y,
        target_z + offset_x * sine + offset_z * cosine,
    ]
    value["rotation"] = _rotation_y(anchor.get("rotation", 0)) + difference
    return value


def _validate_shared_home(
    manifest: Mapping[str, Any],
    proposed_interior: Mapping[str, Any],
    assets: Mapping[str, Mapping[str, Any]],
    policy: Mapping[str, Any],
    overlap_tolerance: float,
    issues: list[LayoutValidationIssue],
) -> tuple[int, int, int, int]:
    expected_rooms = dict(policy["required_rooms"])
    rooms = manifest.get("rooms") if isinstance(manifest.get("rooms"), list) else []
    by_id = {str(room.get("id")): room for room in rooms if isinstance(room, Mapping)}
    actual_rooms = {room_id: room.get("kind") for room_id, room in by_id.items()}
    if actual_rooms != expected_rooms:
        issues.append(LayoutValidationIssue("shared_home.room_contract", "shared_home.rooms", f"expected {expected_rooms}, received {actual_rooms}"))
    proposed_rooms = proposed_interior.get("rooms") if isinstance(proposed_interior.get("rooms"), list) else []
    proposed_by_id: dict[str, Mapping[str, Any]] = {}
    for index, room in enumerate(proposed_rooms):
        if not isinstance(room, Mapping):
            continue
        room_id = str(room.get("id") or f"#{index}")
        if room_id in proposed_by_id:
            issues.append(LayoutValidationIssue("shared_home.proposed_room_duplicate", f"layout.interior.rooms[{index}].id", room_id))
        proposed_by_id[room_id] = room
    for room_id, room_kind in expected_rooms.items():
        proposed_room = proposed_by_id.get(room_id)
        if proposed_room is None or proposed_room.get("kind") != room_kind:
            issues.append(LayoutValidationIssue("shared_home.proposed_room_contract", f"layout.interior.rooms.{room_id}", f"expected canonical kind {room_kind}"))
    if manifest.get("max_residents") != policy["max_residents"] or manifest.get("occupancy_scenarios") != policy["occupancy_scenarios"]:
        issues.append(LayoutValidationIssue("shared_home.capacity", "shared_home", "2/4/8 occupancy or eight-resident ceiling drifted"))

    synthetic_fixtures = dict(policy.get("synthetic_fixtures", {}))
    baseline_fixtures_by_room: dict[str, set[str]] = {}
    proposed_fixtures_by_room: dict[str, set[str]] = {}
    anchor_actions: set[str] = set()
    private_sleep: list[Mapping[str, Any]] = []
    entries: dict[str, Mapping[str, Any]] = {}
    bounds = manifest.get("room_bounds") if isinstance(manifest.get("room_bounds"), Mapping) else {}
    valid_bounds = all(_is_number(bounds.get(field)) and float(bounds[field]) > 0 for field in ("width", "depth")) and _is_number(bounds.get("center_z"))
    if not valid_bounds:
        issues.append(LayoutValidationIssue("shared_home.bounds", "shared_home.room_bounds", "room bounds are invalid"))

    for room_id, room in by_id.items():
        baseline_placements = room.get("placements") if isinstance(room.get("placements"), list) else []
        baseline, _, baseline_blockers = _index_interior_placements(
            room_id, baseline_placements, assets, issues,
            f"shared_home.rooms.{room_id}.placements", False,
        )
        _validate_fixture_overlaps(
            baseline_blockers, f"shared_home.rooms.{room_id}.placements",
            "shared_home.fixture_overlap", overlap_tolerance, issues,
        )
        proposed_room = proposed_by_id.get(room_id)
        proposed_placements = proposed_room.get("placements") if isinstance(proposed_room, Mapping) and isinstance(proposed_room.get("placements"), list) else []
        proposed, proposed_metadata, proposed_blockers = _index_interior_placements(
            room_id, proposed_placements, assets, issues,
            f"layout.interior.rooms.{room_id}.placements", True,
        )
        _validate_fixture_overlaps(
            proposed_blockers, f"layout.interior.rooms.{room_id}.placements",
            "shared_home.proposed_fixture_overlap", overlap_tolerance, issues,
        )
        baseline_fixtures_by_room[room_id] = set(baseline)
        proposed_fixtures_by_room[room_id] = set(proposed)

        anchors = room.get("anchors") if isinstance(room.get("anchors"), list) else []
        resolved_anchors: list[Mapping[str, Any]] = []
        anchor_ids: set[str] = set()
        entry_candidates: list[Mapping[str, Any]] = []
        for index, anchor in enumerate(anchors):
            if not isinstance(anchor, Mapping):
                continue
            anchor_id = str(anchor.get("id") or f"#{index}")
            if anchor_id in anchor_ids:
                issues.append(LayoutValidationIssue("shared_home.anchor_duplicate", f"shared_home.rooms.{room_id}.anchors[{index}]", anchor_id))
            anchor_ids.add(anchor_id)
            actions = anchor.get("actions") if isinstance(anchor.get("actions"), list) else []
            anchor_actions.update(str(action) for action in actions)
            fixture_id = anchor.get("fixture_id")
            if fixture_id and fixture_id not in baseline:
                issues.append(LayoutValidationIssue("shared_home.anchor_fixture", f"shared_home.rooms.{room_id}.anchors[{index}].fixture_id", f"{fixture_id} is not in the baseline {room_id}"))
            if fixture_id and fixture_id not in proposed:
                issues.append(LayoutValidationIssue("shared_home.proposed_fixture", f"layout.interior.rooms.{room_id}.placements", f"anchor {anchor_id} requires {fixture_id}"))
            elif fixture_id:
                supported_actions = set(proposed_metadata.get(str(fixture_id), {}).get("semantic_capabilities", {}).get("life_actions", []))
                unsupported_actions = set(actions) - supported_actions
                if unsupported_actions:
                    issues.append(LayoutValidationIssue("shared_home.proposed_fixture_capability", f"layout.interior.rooms.{room_id}.placements.{fixture_id}", f"fixture cannot support {sorted(unsupported_actions)}"))
            try:
                resolved = _resolved_anchor(anchor, baseline, proposed)
            except (TypeError, ValueError, KeyError) as error:
                issues.append(LayoutValidationIssue("shared_home.anchor_transform", f"shared_home.rooms.{room_id}.anchors[{index}]", str(error)))
                resolved = anchor
            resolved_anchors.append(resolved)
            if resolved.get("kind") == policy["entry_anchor_kind"] and resolved.get("privacy") == "open":
                entry_candidates.append(resolved)
            if resolved.get("kind") == "private-bed":
                private_sleep.append(resolved)
        if len(entry_candidates) != 1:
            issues.append(LayoutValidationIssue("shared_home.door_missing", f"shared_home.rooms.{room_id}.anchors", "every canonical room needs exactly one open entry/door anchor"))
        else:
            entries[room_id] = entry_candidates[0]
            if valid_bounds:
                clearance, grid_step = float(policy["actor_clearance"]), float(policy["path_grid_step"])
                reached, cell_for, point_for = _reachable_room_cells(room, [item[1] for item in proposed_blockers], bounds, entry_candidates[0], clearance, grid_step)
                if not reached:
                    issues.append(LayoutValidationIssue("shared_home.entry_blocked", f"shared_home.rooms.{room_id}.anchors.{entry_candidates[0].get('id')}", "entry has no navigable floor cell"))
                else:
                    approach_radius = float(policy["fixture_approach_radius"])
                    for anchor in resolved_anchors:
                        if not isinstance(anchor, Mapping) or anchor is entry_candidates[0] or anchor.get("privacy") != "open":
                            continue
                        anchor_id = str(anchor.get("id") or "unknown")
                        if anchor.get("fixture_id"):
                            x, _, z = _xyz(anchor.get("position"))
                            approachable = any(math.hypot(point_for(candidate)[0] - x, point_for(candidate)[1] - z) <= approach_radius for candidate in reached)
                        else:
                            approachable = cell_for(anchor) in reached
                        if not approachable:
                            issues.append(LayoutValidationIssue("shared_home.anchor_unreachable", f"shared_home.rooms.{room_id}.anchors.{anchor_id}", "no route exists from the room entry"))

    graph = {room_id: set() for room_id in expected_rooms}
    connected_edges = 0
    connections = manifest.get("room_connections", policy.get("room_connections", []))
    for index, connection in enumerate(connections):
        if not isinstance(connection, Sequence) or isinstance(connection, (str, bytes)) or len(connection) != 2:
            issues.append(LayoutValidationIssue("shared_home.connection", f"shared_home.room_connections[{index}]", "connection must contain two room ids"))
            continue
        first, second = str(connection[0]), str(connection[1])
        if first not in graph or second not in graph:
            issues.append(LayoutValidationIssue("shared_home.connection", f"shared_home.room_connections[{index}]", f"unknown room in {first} -> {second}"))
            continue
        if first not in entries or second not in entries:
            continue
        graph[first].add(second)
        graph[second].add(first)
        connected_edges += 1
    connected_room_count = 0
    if graph:
        start = next(iter(graph))
        visited, queue = {start}, deque([start])
        while queue:
            current = queue.popleft()
            for neighbour in graph[current]:
                if neighbour not in visited:
                    visited.add(neighbour)
                    queue.append(neighbour)
        connected_room_count = len(visited)
        if len(visited) != len(graph):
            issues.append(LayoutValidationIssue("shared_home.room_graph_disconnected", "shared_home.room_connections", f"unreachable rooms: {sorted(set(graph) - visited)}"))

    required_actions = set(policy["required_actions"])
    if anchor_actions != required_actions:
        issues.append(LayoutValidationIssue("shared_home.action_contract", "shared_home.rooms.*.anchors.actions", f"expected {sorted(required_actions)}, received {sorted(anchor_actions)}"))

    expected_slots = set(range(1, int(policy["sleep_slots"]) + 1))
    sleep_slots = {anchor.get("slot") for anchor in private_sleep}
    sleep_fixtures = [anchor.get("fixture_id") for anchor in private_sleep]
    if (
        sleep_slots != expected_slots
        or len(private_sleep) != len(expected_slots)
        or len(set(sleep_fixtures)) != len(expected_slots)
        or any(anchor.get("privacy") != "private" or "sleep" not in anchor.get("actions", []) for anchor in private_sleep)
    ):
        issues.append(LayoutValidationIssue("shared_home.sleep_slots", "shared_home.rooms.bedroom.anchors", "eight unique private sleep anchors are required"))

    resources = manifest.get("resources") if isinstance(manifest.get("resources"), list) else []
    resources_by_kind = {str(resource.get("kind")): resource for resource in resources if isinstance(resource, Mapping)}
    if set(resources_by_kind) != set(policy["required_resources"]):
        issues.append(LayoutValidationIssue("shared_home.resources", "shared_home.resources", "kitchen, television and bathroom resources are required"))
    for kind, resource_contract in policy["required_resources"].items():
        resource = resources_by_kind.get(kind)
        if resource is None:
            continue
        room_id = str(resource.get("room_id") or "")
        if room_id != resource_contract["room_id"] or resource.get("capacity") != resource_contract["capacity"]:
            issues.append(LayoutValidationIssue("shared_home.resource_contract", f"shared_home.resources.{kind}", f"expected room {resource_contract['room_id']} with capacity {resource_contract['capacity']}"))
        room = by_id.get(room_id)
        fixture_ids = resource.get("fixture_ids") if isinstance(resource.get("fixture_ids"), list) else []
        if not fixture_ids:
            issues.append(LayoutValidationIssue("shared_home.resource_fixture", f"shared_home.resources.{kind}.fixture_ids", "at least one fixture is required"))
        for fixture_id in fixture_ids:
            synthetic = synthetic_fixtures.get(fixture_id) == room_id
            if fixture_id not in baseline_fixtures_by_room.get(room_id, set()) and not synthetic:
                issues.append(LayoutValidationIssue("shared_home.resource_fixture", f"shared_home.resources.{kind}.fixture_ids", f"{fixture_id} is not a baseline fixture in {room_id}"))
            if fixture_id not in proposed_fixtures_by_room.get(room_id, set()) and not synthetic:
                issues.append(LayoutValidationIssue("shared_home.proposed_resource_fixture", f"layout.interior.rooms.{room_id}.placements", f"resource {kind} requires {fixture_id}"))
        room_actions = {
            str(action)
            for anchor in (room.get("anchors", []) if isinstance(room, Mapping) else [])
            if isinstance(anchor, Mapping)
            for action in (anchor.get("actions", []) if isinstance(anchor.get("actions"), list) else [])
        }
        missing_actions = set(resource_contract["actions"]) - room_actions
        if missing_actions:
            issues.append(LayoutValidationIssue("shared_home.resource_anchor", f"shared_home.resources.{kind}", f"missing action anchors: {sorted(missing_actions)}"))
    return connected_room_count, connected_edges, len(anchor_actions), len(sleep_slots & expected_slots)


def validate_layout_topology(
    layout: Mapping[str, Any],
    shared_home_manifest: Mapping[str, Any],
    asset_catalog: Mapping[str, Any],
) -> LayoutTopologyReport:
    """Validate topology and full oriented footprints without side effects.

    A successful return is a compact audit report.  Any failure raises one
    ``LayoutTopologyError`` containing every detected, path-addressable issue.
    """
    assets = validate_asset_catalog(asset_catalog)
    issues: list[LayoutValidationIssue] = []
    topology_policy = asset_catalog["topology_policy"]
    city = layout.get("city") if isinstance(layout.get("city"), Mapping) else {}
    interior = layout.get("interior") if isinstance(layout.get("interior"), Mapping) else {}
    roads = city.get("roads") if isinstance(city.get("roads"), list) else []
    buildings = city.get("buildings") if isinstance(city.get("buildings"), list) else []
    props = city.get("props") if isinstance(city.get("props"), list) else []
    decorations = city.get("decorations") if isinstance(city.get("decorations"), list) else []
    road_rectangles, road_edges, open_exits = _validate_roads(roads, assets, topology_policy["road_grid"], issues)
    building_rectangles = _layout_rectangles(buildings, "city.buildings", assets, issues)
    _layout_rectangles(props, "city.props", assets, issues)
    decoration_rectangles = _layout_rectangles(decorations, "city.decorations", assets, issues)
    overlap_tolerance = float(topology_policy["geometry"]["overlap_tolerance"])

    for building_id, building in building_rectangles:
        for road_id, road in road_rectangles:
            if _overlap(building, road, overlap_tolerance):
                issues.append(LayoutValidationIssue("building.overlaps_road", f"city.buildings.{building_id}", f"full footprint overlaps {road_id}"))
    for first_index, (first_id, first) in enumerate(building_rectangles):
        for second_id, second in building_rectangles[first_index + 1:]:
            if _overlap(first, second, overlap_tolerance):
                issues.append(LayoutValidationIssue("building.overlap", f"city.buildings.{first_id}", f"full footprint overlaps {second_id}"))
    for decoration_id, decoration in decoration_rectangles:
        for road_id, road in road_rectangles:
            if _overlap(decoration, road, overlap_tolerance):
                issues.append(LayoutValidationIssue("decoration.blocks_road", f"city.decorations.{decoration_id}", f"footprint obstructs {road_id}"))

    connected_rooms, room_connections, action_count, sleep_count = _validate_shared_home(
        shared_home_manifest,
        interior,
        assets,
        topology_policy["shared_home"],
        overlap_tolerance,
        issues,
    )
    if issues:
        raise LayoutTopologyError(issues)
    return LayoutTopologyReport(
        road_tiles=len(roads),
        road_edges=road_edges,
        sky_road_exits=open_exits,
        buildings=len(buildings),
        decorations=len(decorations),
        connected_rooms=connected_rooms,
        room_connections=room_connections,
        shared_home_actions=action_count,
        private_sleep_slots=sleep_count,
    )


__all__ = [
    "AssetCatalogError",
    "LayoutTopologyError",
    "LayoutTopologyReport",
    "LayoutValidationIssue",
    "WORLD_ASSET_CATALOG_PATH",
    "load_world_asset_catalog",
    "validate_asset_catalog",
    "validate_layout_topology",
]
