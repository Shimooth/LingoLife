"""Rule-owned collision detection and autonomous response selection.

Collisions describe facts, not prose.  They are deliberately independent from
SQLite and DeepSeek so a caller can detect, resolve, and persist the resulting
action/relationship instructions atomically.
"""

from __future__ import annotations

import json
import math
from itertools import combinations
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Mapping, Sequence, cast

from .life import LifeAction, ResourceState, clamp, stable_fraction, stable_id


COLLISION_RULES_VERSION = "story-rules-v1"
RESPONSE_TEMPERATURE = 4.75
CollisionKind = Literal[
    "person_person", "person_resource", "person_responsibility",
    "person_boundary", "person_environment",
]
COLLISION_KINDS = frozenset({
    "person_person", "person_resource", "person_responsibility",
    "person_boundary", "person_environment",
})
RELATIONSHIP_DIMENSIONS = frozenset({
    "familiarity", "trust", "affinity", "respect", "tension", "comfort", "resentment",
    "attraction", "dependency", "fear",
})


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


@dataclass(frozen=True)
class CollisionResponseTemplate:
    id: str
    style: str
    weight: float
    relationship_deltas: Mapping[str, int]


@dataclass(frozen=True)
class CollisionScenario:
    id: str
    kind: CollisionKind
    triggers: tuple[str, ...]
    resource_kinds: tuple[str, ...]
    topic: str
    base_severity: int
    responses: tuple[CollisionResponseTemplate, ...]
    thread_hook: str | None


@dataclass(frozen=True)
class CollisionCatalog:
    version: int
    rules_version: str
    scenarios: Mapping[str, CollisionScenario]


def load_collision_catalog(path: str | Path | None = None) -> CollisionCatalog:
    source = Path(path) if path else Path(__file__).parents[1] / "content" / "life_scenarios.json"
    raw = json.loads(source.read_text(encoding="utf-8"))
    if int(raw.get("version", 0)) != 1:
        raise ValueError("unsupported life scenario content version")
    scenarios: dict[str, CollisionScenario] = {}
    for item in raw.get("scenarios", []):
        scenario_id = str(item.get("id", ""))
        if not scenario_id or scenario_id in scenarios:
            raise ValueError(f"duplicate or empty collision scenario id: {scenario_id}")
        kind = str(item.get("kind", ""))
        if kind not in COLLISION_KINDS:
            raise ValueError(f"invalid collision kind for {scenario_id}: {kind}")
        triggers = tuple(str(value) for value in item.get("triggers", []))
        if not triggers:
            raise ValueError(f"collision scenario has no triggers: {scenario_id}")
        responses = []
        for response in item.get("responses", []):
            deltas = {str(key): int(value) for key, value in response.get("relationship_deltas", {}).items()}
            unknown = set(deltas) - RELATIONSHIP_DIMENSIONS
            if unknown or any(not -20 <= value <= 20 for value in deltas.values()):
                raise ValueError(f"invalid relationship deltas for {scenario_id}: {sorted(unknown)}")
            responses.append(CollisionResponseTemplate(
                str(response["id"]), str(response.get("style", "neutral")),
                float(response.get("weight", 1)), deltas,
            ))
        if len(responses) < 3 or len({value.id for value in responses}) != len(responses):
            raise ValueError(f"collision scenario needs at least three unique responses: {scenario_id}")
        severity = int(item.get("base_severity", 0))
        if not 0 <= severity <= 100:
            raise ValueError(f"invalid collision severity: {scenario_id}")
        scenarios[scenario_id] = CollisionScenario(
            scenario_id, cast(CollisionKind, kind), triggers,
            tuple(str(value) for value in item.get("resource_kinds", [])),
            str(item.get("topic") or scenario_id), severity, tuple(responses),
            str(item["thread_hook"]) if item.get("thread_hook") else None,
        )
    represented = {scenario.kind for scenario in scenarios.values()}
    if represented != COLLISION_KINDS:
        raise ValueError(f"collision catalog does not cover all kinds: {sorted(COLLISION_KINDS - represented)}")
    return CollisionCatalog(int(raw["version"]), str(raw.get("rules_version") or COLLISION_RULES_VERSION),
                            scenarios)


@dataclass(frozen=True)
class Collision:
    id: str
    kind: CollisionKind
    scenario_id: str
    topic: str
    participant_ids: tuple[str, ...]
    action_ids: tuple[str, ...]
    trigger: str
    occurred_at: datetime
    location_id: str | None
    resource_id: str | None
    severity: int
    response_candidates: tuple[str, ...]
    thread_key: str | None
    facts: Mapping[str, Any]
    rules_version: str = COLLISION_RULES_VERSION

    def to_dict(self) -> dict[str, Any]:
        result = asdict(self)
        result["participant_ids"] = list(self.participant_ids)
        result["action_ids"] = list(self.action_ids)
        result["response_candidates"] = list(self.response_candidates)
        result["occurred_at"] = self.occurred_at.isoformat()
        result["facts"] = dict(self.facts)
        return result


@dataclass(frozen=True)
class CollisionResolution:
    id: str
    collision_id: str
    mode: Literal["autonomous", "managed"]
    response_by_participant: Mapping[str, str]
    relationship_changes: tuple[Mapping[str, Any], ...]
    action_instructions: Mapping[str, str]
    memory_seeds: tuple[Mapping[str, str], ...]
    severity_before: int
    severity_after: int
    requires_intervention: bool
    outcome_tags: tuple[str, ...]
    settled_at: datetime
    rules_version: str = COLLISION_RULES_VERSION

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id, "collision_id": self.collision_id, "mode": self.mode,
            "response_by_participant": dict(self.response_by_participant),
            "relationship_changes": [dict(value) for value in self.relationship_changes],
            "action_instructions": dict(self.action_instructions),
            "memory_seeds": [dict(value) for value in self.memory_seeds],
            "severity_before": self.severity_before, "severity_after": self.severity_after,
            "requires_intervention": self.requires_intervention,
            "outcome_tags": list(self.outcome_tags), "settled_at": self.settled_at.isoformat(),
            "rules_version": self.rules_version,
        }


@dataclass(frozen=True)
class CollisionSnapshot:
    window_key: str
    now: datetime
    actions: tuple[LifeAction, ...] = ()
    resources: tuple[ResourceState, ...] = ()
    responsibilities: tuple[Mapping[str, Any], ...] = ()
    boundary_events: tuple[Mapping[str, Any], ...] = ()
    environment_events: tuple[Mapping[str, Any], ...] = ()
    profiles: Mapping[str, Mapping[str, Any]] = field(default_factory=dict)
    relationships: Mapping[tuple[str, str], Mapping[str, Any]] = field(default_factory=dict)
    rules_version: str = COLLISION_RULES_VERSION


def _scenario_for(catalog: CollisionCatalog, kind: CollisionKind, triggers: Sequence[str],
                  resource_kind: str | None = None) -> CollisionScenario | None:
    trigger_set = set(triggers)
    matches = [scenario for scenario in catalog.scenarios.values()
               if scenario.kind == kind and trigger_set & set(scenario.triggers)
               and (not scenario.resource_kinds or resource_kind in scenario.resource_kinds)]
    if not matches:
        return None
    return sorted(matches, key=lambda value: (-len(trigger_set & set(value.triggers)),
                                               -value.base_severity, value.id))[0]


def _thread_key(scenario: CollisionScenario, participants: Sequence[str], facts: Mapping[str, Any],
                rules_version: str) -> str | None:
    if not scenario.thread_hook:
        return None
    household = facts.get("household_id") or "world"
    return stable_id("thread", scenario.thread_hook, household, sorted(participants),
                     rules_version=rules_version)


def build_collision(*, kind: CollisionKind, triggers: Sequence[str], participant_ids: Sequence[str],
                    action_ids: Sequence[str], occurred_at: datetime, source_key: str,
                    location_id: str | None = None, resource_id: str | None = None,
                    resource_kind: str | None = None, facts: Mapping[str, Any] | None = None,
                    profiles: Mapping[str, Mapping[str, Any]] | None = None,
                    relationships: Mapping[tuple[str, str], Mapping[str, Any]] | None = None,
                    catalog: CollisionCatalog | None = None,
                    rules_version: str = COLLISION_RULES_VERSION) -> Collision | None:
    source = catalog or load_collision_catalog()
    scenario = _scenario_for(source, kind, triggers, resource_kind)
    if not scenario:
        return None
    participants = tuple(dict.fromkeys(str(value) for value in participant_ids if value))
    if not participants:
        return None
    detail = dict(facts or {})
    relationship_values = relationships or {}
    stress = max((float((profiles or {}).get(npc_id, {}).get("emotion", {}).get("stress", 0))
                  for npc_id in participants), default=0)
    peak_tension = max((float(relationship_values.get((source_id, target_id), {}).get("tension", 0))
                        for source_id in participants for target_id in participants if source_id != target_id),
                       default=0)
    recurrence = max(0, int(detail.get("recurrence_count", detail.get("recurrence", 0)) or 0))
    queue_depth = max(0, int(detail.get("queue_depth", 0) or 0))
    severity = clamp(scenario.base_severity + min(18, recurrence * 5) + min(12, queue_depth * 3)
                     + max(0, stress - 65) * .2 + max(0, peak_tension - 45) * .25)
    trigger = next((value for value in scenario.triggers if value in set(triggers)), scenario.triggers[0])
    collision_id = stable_id("collision", source_key, scenario.id, sorted(participants),
                             sorted(action_ids), resource_id or "", rules_version=rules_version)
    return Collision(
        collision_id, kind, scenario.id, scenario.topic, participants,
        tuple(dict.fromkeys(str(value) for value in action_ids if value)), trigger,
        _utc(occurred_at), location_id, resource_id, severity,
        tuple(value.id for value in scenario.responses),
        _thread_key(scenario, participants, detail, rules_version), detail, rules_version,
    )


def _actions_by_id(actions: Sequence[LifeAction]) -> dict[str, LifeAction]:
    return {action.id: action for action in actions}


def _detect_person_resource(snapshot: CollisionSnapshot, catalog: CollisionCatalog) -> list[Collision]:
    actions = _actions_by_id(snapshot.actions)
    found: list[Collision] = []
    for resource in snapshot.resources:
        participants = [value.npc_id for value in resource.reservations]
        participants.extend(value.npc_id for value in resource.queue)
        action_ids = [value.action_id for value in resource.reservations]
        action_ids.extend(value.action_id for value in resource.queue)
        triggers: list[str] = []
        if resource.queue:
            triggers.append("resource_capacity")
            triggers.append("bathroom_wait" if resource.kind == "bathroom" else
                            "kitchen_busy" if resource.kind == "kitchen" else "program_preference")
        if resource.kind == "television" and resource.state.get("preference_conflict") and len(participants) >= 2:
            triggers.append("program_preference")
        if not triggers:
            continue
        collision = build_collision(
            kind="person_resource", triggers=triggers, participant_ids=participants,
            action_ids=action_ids, occurred_at=snapshot.now,
            source_key=f"resource-pressure:{resource.id}", location_id=resource.location_id,
            resource_id=resource.id, resource_kind=resource.kind,
            facts={"resource_kind": resource.kind, "scope": resource.scope,
                   "household_id": resource.household_id, "capacity": resource.capacity,
                   "queue_depth": len(resource.queue),
                   "fact_key": f"resource-pressure:{resource.id}:{','.join(sorted(action_ids))}",
                   "action_types": [actions[value].action_type for value in action_ids if value in actions]},
            profiles=snapshot.profiles, relationships=snapshot.relationships,
            catalog=catalog, rules_version=snapshot.rules_version,
        )
        if collision:
            found.append(collision)
    return found


def _detect_person_person(snapshot: CollisionSnapshot, catalog: CollisionCatalog) -> list[Collision]:
    by_npc = {action.npc_id: action for action in snapshot.actions
              if action.status not in {"completed", "abandoned", "interrupted"}}
    arrived = {npc_id: action for npc_id, action in by_npc.items()
               if action.status == "performing"}
    found: list[Collision] = []
    seen: set[tuple[str, str, str]] = set()
    privacy_pairs = {
        tuple(sorted(_event_participants(event)))
        for event in snapshot.boundary_events
        if event.get("active", True) and event.get("kind") == "privacy"
        and len(_event_participants(event)) == 2
    }
    for action in snapshot.actions:
        # A social desire only becomes an encounter after the initiator has
        # physically arrived.  Traveling intentions remain visible on the map
        # but must not create an interaction at a distance.
        if action.status != "performing" or action.action_type not in {"seek_company", "talk_to_resident"}:
            continue
        target_id = action.target_npc_id
        if not target_id:
            # ``seek_company`` intentionally has no preselected resident.  It
            # becomes a real encounter only when another arrived resident is
            # performing at the same public/home location.
            candidates = sorted(
                (candidate for candidate in arrived.values()
                 if candidate.npc_id != action.npc_id and candidate.location_id == action.location_id),
                key=lambda value: value.npc_id,
            )
            if not candidates:
                continue
            target_id = candidates[
                int(stable_fraction(action.id, "co-located-company",
                                    rules_version=snapshot.rules_version) * len(candidates)) % len(candidates)
            ].npc_id
        target = by_npc.get(target_id)
        co_located = bool(target and target.status == "performing"
                          and target.location_id == action.location_id)
        pair = tuple(sorted((action.npc_id, target_id)))
        busy = not co_located or bool(
            target and (not target.interruptible
                        or target.action_type in {"sleep", "shower", "rest_alone"})
        )
        trigger = ("target_busy" if busy else "shared_interest"
                   if action.action_type == "talk_to_resident" else "quiet_company")
        if busy and pair in privacy_pairs:
            # One arrived interruption is one fact.  The richer privacy
            # boundary scenario owns it; do not also emit missed_connection.
            continue
        dedupe = (pair[0], pair[1], trigger)
        if dedupe in seen:
            continue
        seen.add(dedupe)
        action_ids = (action.id, target.id) if target else (action.id,)
        collision = build_collision(
            kind="person_person", triggers=((trigger, "person_availability") if busy else (trigger,)),
            participant_ids=(action.npc_id, target_id), action_ids=action_ids,
            occurred_at=snapshot.now, source_key=f"social-encounter:{pair}:{trigger}",
            location_id=action.location_id,
            facts={"target_busy": busy, "initiator_id": action.npc_id,
                   "target_id": target_id,
                   "fact_key": f"social-encounter:{':'.join(pair)}:{trigger}:{','.join(sorted(action_ids))}"},
            profiles=snapshot.profiles,
            relationships=snapshot.relationships, catalog=catalog,
            rules_version=snapshot.rules_version,
        )
        if collision:
            found.append(collision)
    active_hobbies = [action for action in snapshot.actions
                      if action.status == "performing" and action.action_type == "practice_hobby"
                      and action.location_id]
    for first, second in combinations(sorted(active_hobbies, key=lambda value: value.npc_id), 2):
        if first.location_id != second.location_id:
            continue
        pair = tuple(sorted((first.npc_id, second.npc_id)))
        first_interests = {str(value).casefold() for value in
                           snapshot.profiles.get(first.npc_id, {}).get("interests", [])}
        second_interests = {str(value).casefold() for value in
                            snapshot.profiles.get(second.npc_id, {}).get("interests", [])}
        if first_interests and second_interests and not (first_interests & second_interests):
            continue
        # Shared hobbies are not synonymous with rivalry.  A stable pair-level
        # chemistry gate lets some residents become recurring rivals while
        # others simply enjoy the same venue without turning every practice
        # session into a contest.
        if stable_fraction("rivalry-propensity", *pair,
                           rules_version=snapshot.rules_version) >= .5:
            continue
        collision = build_collision(
            kind="person_person", triggers=("shared_hobby", "competition"),
            participant_ids=pair, action_ids=(first.id, second.id),
            occurred_at=snapshot.now,
            source_key=f"shared-hobby:{pair}",
            location_id=first.location_id,
            facts={"shared_hobby": True, "resource_id": first.target_resource_id
                   if first.target_resource_id == second.target_resource_id else None,
                   "fact_key": f"shared-hobby:{':'.join(pair)}:{first.id}:{second.id}"},
            profiles=snapshot.profiles, relationships=snapshot.relationships,
            catalog=catalog, rules_version=snapshot.rules_version,
        )
        if collision:
            found.append(collision)
    return found


def _event_participants(value: Mapping[str, Any]) -> tuple[str, ...]:
    supplied = value.get("participant_ids")
    if isinstance(supplied, Sequence) and not isinstance(supplied, (str, bytes)):
        return tuple(str(item) for item in supplied if item)
    fields = ("actor_id", "affected_id", "created_by", "expected_npc_id", "responsible_npc_id", "npc_id")
    return tuple(dict.fromkeys(str(value[key]) for key in fields if value.get(key)))


def _detect_fact_events(snapshot: CollisionSnapshot, catalog: CollisionCatalog,
                        kind: CollisionKind, events: Sequence[Mapping[str, Any]]) -> list[Collision]:
    found: list[Collision] = []
    for index, event in enumerate(events):
        if event.get("active", True) is False or event.get("violated", True) is False:
            continue
        raw_triggers = event.get("triggers") or (event.get("trigger"), event.get("kind"))
        triggers = tuple(str(value) for value in raw_triggers if value)
        if kind == "person_responsibility" and str(event.get("kind")) in {"dishes", "dishwashing"}:
            triggers += ("dishwashing_thread", "responsibility_overdue")
        elif kind == "person_boundary" and str(event.get("kind")) == "privacy":
            triggers += ("privacy_boundary",)
        elif kind == "person_boundary" and str(event.get("kind")) in {"borrowed_item", "property"}:
            triggers += ("borrowed_without_permission",)
        elif kind == "person_environment" and str(event.get("kind")) == "noise":
            triggers += ("environment_noise",)
        source_id = str(event.get("id") or f"{kind}-{index}")
        facts = dict(event)
        collision = build_collision(
            kind=kind, triggers=triggers, participant_ids=_event_participants(event),
            action_ids=tuple(str(value) for value in event.get("action_ids", []) if value),
            occurred_at=snapshot.now, source_key=f"fact:{kind}:{source_id}",
            location_id=event.get("location_id"), resource_id=event.get("resource_id"),
            resource_kind=event.get("resource_kind"), facts=facts,
            profiles=snapshot.profiles, relationships=snapshot.relationships,
            catalog=catalog, rules_version=snapshot.rules_version,
        )
        if collision:
            found.append(collision)
    return found


def detect_collisions(snapshot: CollisionSnapshot,
                      catalog: CollisionCatalog | None = None) -> tuple[Collision, ...]:
    source = catalog or load_collision_catalog()
    collisions = [
        *_detect_person_resource(snapshot, source),
        *_detect_person_person(snapshot, source),
        *_detect_fact_events(snapshot, source, "person_responsibility", snapshot.responsibilities),
        *_detect_fact_events(snapshot, source, "person_boundary", snapshot.boundary_events),
        *_detect_fact_events(snapshot, source, "person_environment", snapshot.environment_events),
    ]
    unique = {collision.id: collision for collision in collisions}
    return tuple(sorted(unique.values(), key=lambda value: (value.occurred_at, value.id)))


def _axis(profile: Mapping[str, Any], name: str, default: float = 50) -> float:
    axes = profile.get("axes") if isinstance(profile.get("axes"), Mapping) else profile.get("persona_axes")
    if isinstance(axes, Mapping) and name in axes:
        return float(axes[name])
    return default


def _response_score(response: CollisionResponseTemplate, npc_id: str, collision: Collision,
                    profile: Mapping[str, Any], relationship: Mapping[str, Any]) -> float:
    warmth = _axis(profile, "warmth")
    assertion = _axis(profile, "assertiveness")
    stability = _axis(profile, "emotional_stability")
    flexibility = float(profile.get("flexibility", _axis(profile, "openness")))
    stress = float((profile.get("emotion") or {}).get("stress", 40))
    trust = float(relationship.get("trust", 50))
    affinity = float(relationship.get("affinity", 50))
    tension = float(relationship.get("tension", 5))
    resentment = float(relationship.get("resentment", 0))
    style = response.style
    score = response.weight
    if style in {"cooperative", "fair"}:
        score += warmth * .08 + trust * .06 + stability * .04
    elif style in {"warm", "caretaking"}:
        score += warmth * .11 + affinity * .06
    elif style == "patient":
        score += stability * .1 + max(0, 65 - stress) * .05
    elif style in {"assertive", "boundaried"}:
        score += assertion * .1 + stability * .04
    elif style == "confrontational":
        score += assertion * .07 + stress * .08 + tension * .08 + resentment * .08 - trust * .04
    elif style in {"avoidant", "sensitive"}:
        score += max(0, 60 - assertion) * .08 + stress * .07 + max(0, 55 - stability) * .08
    elif style in {"flexible", "practical"}:
        score += flexibility * .09 + stability * .04
    elif style == "quiet":
        score += max(0, 65 - _axis(profile, "extraversion")) * .08 + stability * .05
    return score


def _sample_response(responses: Sequence[CollisionResponseTemplate], *, npc_id: str,
                     collision: Collision, profile: Mapping[str, Any],
                     relationship: Mapping[str, Any]) -> CollisionResponseTemplate:
    """Deterministically sample a personality-weighted softmax distribution."""
    ordered = sorted(responses, key=lambda value: value.id)
    scores = [_response_score(value, npc_id, collision, profile, relationship)
              for value in ordered]
    peak = max(scores)
    weights = [math.exp((score - peak) / RESPONSE_TEMPERATURE) for score in scores]
    total = sum(weights)
    draw = stable_fraction(collision.id, npc_id, "response-softmax",
                           rules_version=collision.rules_version) * total
    cumulative = 0.0
    for response, weight in zip(ordered, weights):
        cumulative += weight
        if draw <= cumulative:
            return response
    return ordered[-1]


def _instruction(style: str, response_id: str) -> str:
    if style == "patient" or response_id in {"wait", "wait_for_opening", "try_later"}:
        return "wait"
    if style == "avoidant" or response_id in {"choose_alternative", "move_to_quiet_place", "abandon_plan"}:
        return "substitute"
    if style == "confrontational":
        return "interrupt"
    return "continue"


def resolve_collision_autonomously(collision: Collision, *,
                                   profiles: Mapping[str, Mapping[str, Any]] | None = None,
                                   relationships: Mapping[tuple[str, str], Mapping[str, Any]] | None = None,
                                   settled_at: datetime | None = None,
                                   catalog: CollisionCatalog | None = None) -> CollisionResolution:
    source = catalog or load_collision_catalog()
    scenario = source.scenarios[collision.scenario_id]
    profile_map, edge_map = profiles or {}, relationships or {}
    responses: dict[str, str] = {}
    chosen_templates: dict[str, CollisionResponseTemplate] = {}
    for npc_id in collision.participant_ids:
        other = next((value for value in collision.participant_ids if value != npc_id), "")
        edge = edge_map.get((npc_id, other), {})
        chosen = _sample_response(
            scenario.responses, npc_id=npc_id, collision=collision,
            profile=profile_map.get(npc_id, {}), relationship=edge,
        )
        responses[npc_id] = chosen.id
        chosen_templates[npc_id] = chosen
    changes: list[Mapping[str, Any]] = []
    memories: list[Mapping[str, str]] = []
    action_instructions: dict[str, str] = {}
    for index, npc_id in enumerate(collision.participant_ids):
        other = next((value for value in collision.participant_ids if value != npc_id), "")
        chosen = chosen_templates[npc_id]
        if other and chosen.relationship_deltas:
            changes.append({"npc_a": npc_id, "npc_b": other, **chosen.relationship_deltas})
        memories.append({
            "npc_id": npc_id, "kind": "relationship" if other else "episodic",
            "topic": collision.topic,
            "content_seed": f"I responded by {chosen.id.replace('_', ' ')} during {collision.topic.replace('_', ' ')}.",
        })
        if index < len(collision.action_ids):
            action_instructions[collision.action_ids[index]] = _instruction(chosen.style, chosen.id)
    hostile = sum(1 for value in chosen_templates.values() if value.style == "confrontational")
    cooperative = sum(1 for value in chosen_templates.values()
                      if value.style in {"cooperative", "fair", "warm", "patient"})
    after = clamp(collision.severity + hostile * 13 - cooperative * 7)
    requires_intervention = collision.severity >= 68 or (hostile >= 1 and collision.severity >= 55)
    tags = ["conflict" if hostile else "cooperation" if cooperative else "neutral"]
    if collision.scenario_id == "friendly_hobby_competition":
        tags.append("competition")
    tags.extend(("thread_candidate" if collision.thread_key else "standalone", collision.kind))
    moment = _utc(settled_at or collision.occurred_at)
    resolution_id = stable_id("resolution", collision.id, "autonomous",
                              rules_version=collision.rules_version)
    return CollisionResolution(
        resolution_id, collision.id, "autonomous", responses, tuple(changes),
        action_instructions, tuple(memories), collision.severity, after,
        requires_intervention, tuple(dict.fromkeys(tags)), moment, collision.rules_version,
    )


class CollisionEngine:
    """Small stateless facade suitable for dependency injection in the API layer."""

    def __init__(self, catalog: CollisionCatalog | None = None):
        self.catalog = catalog or load_collision_catalog()

    def detect(self, snapshot: CollisionSnapshot) -> tuple[Collision, ...]:
        return detect_collisions(snapshot, self.catalog)

    def resolve(self, collision: Collision, *, profiles: Mapping[str, Mapping[str, Any]] | None = None,
                relationships: Mapping[tuple[str, str], Mapping[str, Any]] | None = None,
                settled_at: datetime | None = None) -> CollisionResolution:
        return resolve_collision_autonomously(collision, profiles=profiles,
                                              relationships=relationships,
                                              settled_at=settled_at, catalog=self.catalog)
