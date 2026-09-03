"""Serializable orchestration for the rule-owned life simulation.

``LifeWorldEngine`` is intentionally persistence independent.  Every public
method consumes JSON-ready values and returns a new JSON-ready world snapshot;
the API/DB adapter can therefore save that snapshot and its projections in one
transaction.  No method calls an LLM or relies on process-local random state.
"""

from __future__ import annotations

import copy
import json
import re
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from itertools import combinations
from typing import Any, Iterable, Mapping, MutableMapping, Sequence, cast

from .agent import compile_persona, observable_runtime_state
from .collisions import (
    COLLISION_RULES_VERSION,
    Collision,
    CollisionEngine,
    CollisionResolution,
    CollisionSnapshot,
)
from .life import (
    CORE_NEEDS,
    RULES_VERSION,
    LifeAction,
    LifeCatalog,
    NpcLifeContext,
    ResourceState,
    WorldClock,
    advance_life_action,
    apply_resource_deltas,
    clamp,
    create_life_action,
    default_city_resources,
    default_household_resources,
    load_life_catalog,
    normalize_runtime_v2,
    release_resource,
    reserve_resource,
    select_life_action,
    stable_fraction,
    stable_id,
    stable_number,
)
from .life_observable import life_action_phase, project_observable_action
from .relationships import (
    Appraisal,
    DIMENSIONS,
    DirectionalRelationship,
    RelationshipEngine,
    RelationshipEvidence,
    RelationshipPair,
    RelationshipTransition,
    StructuralBond,
)
from .stories import (
    TERMINAL_STORY_STATUSES,
    LifeStory,
    StoryContext,
    UnresolvedThread,
    observe_story,
    settle_story_autonomously,
    settle_story_with_management,
    story_from_action,
    story_from_collision,
    update_unresolved_thread,
)


WORLD_SCHEMA_VERSION = 1
WORLD_RULES_VERSION = "life-world-v1"
ROMANCE_ACTIONS = frozenset({"start_dating", "become_partners", "separate"})
MANAGEMENT_ACTIONS = frozenset({
    "ask", "comfort", "advise", "mediate", "encourage", "give_space", "offer_help",
    "invite_talk", "set_boundary", "support_confession", "let_them_handle_it",
})
MAX_STORIES = 360
MAX_EVIDENCE = 1200
MAX_PROCESSED_IDS = 1600
MAX_SIMULATION_STEPS = 50_000
MAX_COLLISION_COOLDOWNS = 800
MAX_INTERVENTIONS = 600
MAX_RELATIONSHIP_CHOICES = 600
RELATIONSHIP_DECAY_INTERVAL_SECONDS = 6 * 60 * 60
COLLISION_COOLDOWN_SECONDS = {
    "person_person": 20 * 60,
    "person_resource": 15 * 60,
    "person_responsibility": 6 * 60 * 60,
    "person_boundary": 30 * 60,
    "person_environment": 60 * 60,
}


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _moment(value: str | datetime | None, *, fallback: datetime | None = None) -> datetime:
    if isinstance(value, datetime):
        return _utc(value)
    if isinstance(value, str):
        return _utc(datetime.fromisoformat(value.replace("Z", "+00:00")))
    if fallback is not None:
        return _utc(fallback)
    raise ValueError("a timestamp is required")


def _json_copy(value: Mapping[str, Any]) -> dict[str, Any]:
    """Copy and simultaneously assert that a caller supplied JSON state."""
    return cast(dict[str, Any], json.loads(json.dumps(value, ensure_ascii=False)))


def _profile_map(profiles: Mapping[str, Any] | Sequence[Mapping[str, Any]]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    if isinstance(profiles, Mapping):
        iterable: Iterable[tuple[object, object]] = profiles.items()
        for supplied_id, raw in iterable:
            if not isinstance(raw, Mapping):
                continue
            profile = dict(raw.get("profile") or raw)
            npc_id = str(raw.get("npc_id") or raw.get("id") or supplied_id)
            if npc_id:
                result[npc_id] = profile
    else:
        for index, raw in enumerate(profiles):
            if not isinstance(raw, Mapping):
                continue
            profile = dict(raw.get("profile") or raw)
            npc_id = str(raw.get("npc_id") or raw.get("id") or profile.get("id") or f"npc-{index + 1}")
            result[npc_id] = profile
    if not result:
        raise ValueError("profiles must contain at least one resident")
    return dict(sorted(result.items()))


def _list(value: object) -> tuple[str, ...]:
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        return tuple(str(item).casefold() for item in value if str(item).strip())
    return ()


def _profile_traits(profile: Mapping[str, Any]) -> tuple[str, ...]:
    values = set(_list(profile.get("personality") or profile.get("traits")))
    axes = compile_persona(profile).get("axes", {})
    if float(axes.get("warmth", 50)) >= 65:
        values.update(("warm", "friendly", "caring"))
    elif float(axes.get("warmth", 50)) <= 38:
        values.add("distant")
    if float(axes.get("extraversion", 50)) >= 65:
        values.update(("outgoing", "friendly"))
    elif float(axes.get("extraversion", 50)) <= 38:
        values.update(("quiet", "introverted"))
    if float(axes.get("assertiveness", 50)) >= 65:
        values.add("assertive")
    elif float(axes.get("assertiveness", 50)) <= 38:
        values.add("gentle")
    if float(axes.get("openness", 50)) >= 65:
        values.update(("creative", "curious"))
    if float(axes.get("emotional_stability", 50)) >= 65:
        values.update(("calm", "steady"))
    return tuple(sorted(values))


def _profile_interests(profile: Mapping[str, Any]) -> tuple[str, ...]:
    values = set(_list(profile.get("interests")))
    text = " ".join(values)
    aliases = (
        (("艺术", "画画", "绘画"), "art"), (("音乐",), "music"),
        (("摄影", "拍照"), "photography"), (("阅读", "读书", "书"), "reading"),
        (("写作",), "writing"), (("做饭", "烹饪", "美食"), "cooking"),
        (("运动", "健身", "跑步"), "fitness"), (("游戏",), "gaming"),
        (("电影",), "film"), (("自然", "植物", "花园"), "nature"),
    )
    values.update(alias for needles, alias in aliases if any(needle in text for needle in needles))
    return tuple(sorted(values))


def _profile_goal_tags(profile: Mapping[str, Any]) -> tuple[str, ...]:
    """Extract compact action-planning themes from free-form profile goals."""
    values = set(_list(profile.get("goal_tags")))
    source = " ".join((str(profile.get("longTermGoal") or ""),
                       str(profile.get("occupation") or ""))).casefold()
    values.update(re.findall(r"[a-z0-9]+", source))
    aliases = (
        (("music", "concert", "singer", "musician", "音乐", "演唱会"), "music"),
        (("art", "artist", "design", "designer", "paint", "艺术", "设计", "绘画"), "art"),
        (("photo", "photography", "摄影"), "photography"),
        (("write", "writer", "author", "写作", "作家"), "writing"),
        (("read", "book", "teacher", "study", "阅读", "教师", "学习"), "reading"),
        (("cook", "chef", "food", "烹饪", "厨师", "美食"), "cooking"),
        (("fitness", "sport", "run", "健身", "运动", "跑步"), "fitness"),
        (("game", "gaming", "游戏"), "gaming"),
        (("friend", "community", "people", "朋友", "社区", "社交"), "social"),
    )
    values.update(alias for needles, alias in aliases if any(needle in source for needle in needles))
    occupation = str(profile.get("occupation") or "").strip().casefold()
    if any(value in occupation for value in ("student", "学生")):
        values.add("study")
    elif occupation and occupation not in {"none", "unemployed", "retired", "无", "无业", "退休"}:
        values.add("career")
    return tuple(sorted(values))


def _profile_schedule_kind(profile: Mapping[str, Any], period: str) -> str:
    occupation = str(profile.get("occupation") or "").strip().casefold()
    if not occupation or occupation in {"none", "unemployed", "retired", "无", "无业", "退休"}:
        return "free"
    if period not in {"morning", "afternoon"}:
        return "free"
    if any(value in occupation for value in ("student", "学生")):
        return "study"
    return "work"


def _location_info(npc_id: str, mapping: Mapping[str, Any] | None) -> dict[str, str]:
    raw = (mapping or {}).get(npc_id)
    if isinstance(raw, str):
        return {"household_id": f"household-{npc_id}", "home_location_id": raw,
                "current_location_id": raw, "residence_id": f"residence-{npc_id}"}
    value = dict(raw) if isinstance(raw, Mapping) else {}
    household = str(value.get("household_id") or value.get("householdId") or f"household-{npc_id}")
    home = str(value.get("home_location_id") or value.get("homeLocationId")
               or value.get("home_id") or value.get("homeId") or value.get("location_id")
               or value.get("locationId") or f"home-{npc_id}")
    current = str(value.get("current_location_id") or value.get("currentLocationId") or home)
    residence = str(value.get("residence_id") or value.get("residenceId") or f"residence-{home}")
    return {"household_id": household, "home_location_id": home,
            "current_location_id": current, "residence_id": residence}


def _pair_key(a: str, b: str) -> str:
    return ":".join(sorted((a, b)))


def _collision_from_dict(value: Mapping[str, Any]) -> Collision:
    return Collision(
        id=str(value["id"]), kind=cast(Any, value["kind"]),
        scenario_id=str(value["scenario_id"]), topic=str(value["topic"]),
        participant_ids=tuple(str(item) for item in value.get("participant_ids", [])),
        action_ids=tuple(str(item) for item in value.get("action_ids", [])),
        trigger=str(value["trigger"]), occurred_at=_moment(value.get("occurred_at")),
        location_id=cast(Any, value.get("location_id")),
        resource_id=cast(Any, value.get("resource_id")),
        severity=int(value.get("severity", 0)),
        response_candidates=tuple(str(item) for item in value.get("response_candidates", [])),
        thread_key=cast(Any, value.get("thread_key")), facts=dict(value.get("facts") or {}),
        rules_version=str(value.get("rules_version") or COLLISION_RULES_VERSION),
    )


def _resolution_from_dict(value: Mapping[str, Any]) -> CollisionResolution:
    return CollisionResolution(
        id=str(value["id"]), collision_id=str(value["collision_id"]),
        mode=cast(Any, value.get("mode", "autonomous")),
        response_by_participant={str(k): str(v) for k, v in dict(value.get("response_by_participant") or {}).items()},
        relationship_changes=tuple(dict(item) for item in value.get("relationship_changes", [])),
        action_instructions={str(k): str(v) for k, v in dict(value.get("action_instructions") or {}).items()},
        memory_seeds=tuple({str(k): str(v) for k, v in dict(item).items()}
                           for item in value.get("memory_seeds", [])),
        severity_before=int(value.get("severity_before", 0)),
        severity_after=int(value.get("severity_after", 0)),
        requires_intervention=bool(value.get("requires_intervention", False)),
        outcome_tags=tuple(str(item) for item in value.get("outcome_tags", [])),
        settled_at=_moment(value.get("settled_at")),
        rules_version=str(value.get("rules_version") or COLLISION_RULES_VERSION),
    )


def _bands(edge: DirectionalRelationship) -> dict[str, str]:
    closeness = ("close" if min(edge.familiarity, edge.affinity, edge.trust) >= 70 else
                 "warm" if min(edge.affinity, edge.trust) >= 55 else
                 "familiar" if edge.familiarity >= 30 else "new")
    tension = "high" if max(edge.tension, edge.resentment) >= 65 else (
        "noticeable" if max(edge.tension, edge.resentment) >= 30 else "calm")
    return {"closeness": closeness, "tension": tension}


class LifeWorldEngine:
    """Pure world-state coordinator.

    The authoritative snapshot contains implementation details needed for
    deterministic replay.  Clients must receive :meth:`public_snapshot`, not
    the authoritative snapshot directly.
    """

    def __init__(self, *, timezone_name: str = "Asia/Shanghai",
                 catalog: LifeCatalog | None = None,
                 collision_engine: CollisionEngine | None = None):
        self.catalog = catalog or load_life_catalog()
        self.clock = WorldClock(timezone_name, max_catchup_days=31)
        self.collisions = collision_engine or CollisionEngine()
        self.relationships = RelationshipEngine()

    def initialize(self, player_id: str,
                   profiles: Mapping[str, Any] | Sequence[Mapping[str, Any]],
                   home_location_mapping: Mapping[str, Any] | None = None,
                   runtime_seeds: Mapping[str, Mapping[str, Any]] | None = None,
                   edge_seeds: Mapping[Any, Any] | Sequence[Mapping[str, Any]] | None = None,
                   now: datetime | None = None, **aliases: Any) -> dict[str, Any]:
        """Create one complete world snapshot from legacy-compatible seeds."""
        if not player_id:
            raise ValueError("player_id is required")
        current = _utc(now or datetime.now(timezone.utc))
        if home_location_mapping is None:
            home_location_mapping = aliases.pop("home_locations", aliases.pop("location_mapping", None))
        if aliases:
            raise TypeError(f"unsupported initialize arguments: {sorted(aliases)}")
        profile_map = _profile_map(profiles)
        locations = {npc_id: _location_info(npc_id, home_location_mapping)
                     for npc_id in profile_map}

        households: dict[str, dict[str, Any]] = {}
        resources: list[dict[str, Any]] = []
        for household_id in sorted({item["household_id"] for item in locations.values()}):
            members = sorted(npc_id for npc_id, item in locations.items()
                             if item["household_id"] == household_id)
            first = locations[members[0]]
            households[household_id] = {
                "id": household_id, "name": f"{profile_map[members[0]].get('name', members[0])}'s household",
                "residence_id": first["residence_id"],
                "residence": {"id": first["residence_id"], "location_id": first["home_location_id"],
                              "name": "Home"},
                "members": members,
                "state": {"cleanliness": 78, "noise": 22, "shared_budget": 100},
            }
            resources.extend(item.to_dict() for item in default_household_resources(household_id, self.catalog))
        resources.extend(item.to_dict() for item in default_city_resources(self.catalog))

        residents: dict[str, dict[str, Any]] = {}
        for npc_id, profile in profile_map.items():
            runtime = normalize_runtime_v2((runtime_seeds or {}).get(npc_id), now=current)
            residents[npc_id] = {
                "npc_id": npc_id, **locations[npc_id], "runtime": runtime,
                "current_action": None, "recent_action_types": [], "decision_serial": 0,
                "completed_action_count": 0, "pending_instruction": None,
                "relationship_policy": self._relationship_policy(profile),
            }

        pairs = self._initial_relationships(profile_map, locations, edge_seeds, current)
        state: dict[str, Any] = {
            "schema_version": WORLD_SCHEMA_VERSION, "rules_version": WORLD_RULES_VERSION,
            "player_id": player_id, "revision": 0,
            "initialized_at": current.isoformat(), "last_advanced_at": current.isoformat(),
            "simulation_cursor_at": current.isoformat(),
            "next_transition_at": None, "residents": residents,
            "households": households, "resources": resources, "relationships": pairs,
            "stories": {}, "open_story_ids": [], "threads": {}, "responsibilities": [],
            "boundary_events": [], "environment_events": [],
            "processed_collision_ids": [], "processed_action_effect_ids": [],
            "active_collision_fact_ids": [], "collision_cooldowns": {},
            "relationship_evidence": [], "memory_seeds": [], "aftermath": [],
            "relationship_choices": [],
            "interventions": {}, "processed_player_interaction_ids": [],
            "metrics": {"completed_actions": 0, "collisions": 0, "stories": 0,
                        "offline_blocks": 0, "scenario_counts": {}, "topic_counts": {}},
        }
        window = self.clock.decision_window(current)
        resource_map = self._resource_map(state)
        for npc_id in sorted(residents):
            self._ensure_current_action(state, profile_map, npc_id, window.key,
                                        window.period, current, resource_map)
        state["resources"] = [resource_map[key].to_dict() for key in sorted(resource_map)]
        self._detect_and_record(state, profile_map, window.key, current)
        self._settle_due_stories(state, profile_map, current)
        state["next_transition_at"] = self._next_transition(state, current)
        state["revision"] = 1
        return self._ready(state)

    def advance(self, state: Mapping[str, Any],
                profiles: Mapping[str, Any] | Sequence[Mapping[str, Any]],
                now: datetime | None = None,
                home_location_mapping: Mapping[str, Any] | None = None) -> dict[str, Any]:
        """Advance online or offline time and return a new authoritative state."""
        result = self._validate_and_copy(state)
        current = _utc(now or datetime.now(timezone.utc))
        last = _moment(result.get("last_advanced_at"), fallback=current)
        if current <= last:
            return result
        profile_map = _profile_map(profiles)
        self._reconcile_residents(result, profile_map, current, home_location_mapping)
        # ``last_advanced_at`` tracks API progress while ``simulation_cursor_at``
        # tracks the latest deterministic transition integrated by the kernel.
        # Keeping them separate is what makes polling every second and opening
        # the game once after a day produce the same simulated facts.
        cursor = _moment(result.get("simulation_cursor_at"), fallback=last)
        if current - cursor > timedelta(days=self.clock.max_catchup_days):
            capped = current - timedelta(days=self.clock.max_catchup_days)
            self._advance_instant(result, profile_map, cursor, capped)
            cursor = capped

        # New residents need a commitment even when no existing transition is
        # due during this request.
        resource_map = self._resource_map(result)
        selection_moment = max(cursor, last)
        selection_window = self.clock.decision_window(selection_moment)
        for npc_id in sorted(result["residents"]):
            self._ensure_current_action(result, profile_map, npc_id, selection_window.key,
                                        selection_window.period, selection_moment, resource_map)
        result["resources"] = [resource_map[key].to_dict() for key in sorted(resource_map)]

        steps = 0
        while True:
            transition_at = self._next_transition_moment(result, cursor)
            if transition_at is None or transition_at > current:
                break
            self._advance_instant(result, profile_map, cursor, transition_at)
            cursor = transition_at
            steps += 1
            if steps > MAX_SIMULATION_STEPS:
                raise RuntimeError("life simulation exceeded its deterministic transition budget")

        gap_seconds = (current - last).total_seconds()
        if gap_seconds > self.clock.online_threshold_seconds:
            result["metrics"]["offline_blocks"] = int(result["metrics"].get("offline_blocks", 0)) + len(
                self.clock.catch_up_blocks(last, current)
            )
        result["last_advanced_at"] = current.isoformat()
        result["next_transition_at"] = self._next_transition(result, current)
        self._trim(result, force=True)
        result["revision"] = int(result.get("revision", 0)) + 1
        return self._ready(result)

    def observe(self, state: Mapping[str, Any], story_id: str,
                now: datetime | None = None) -> dict[str, Any]:
        """Mark a story observed without settling it or changing its outcome."""
        result = self._validate_and_copy(state)
        record = result.get("stories", {}).get(story_id)
        if not isinstance(record, MutableMapping):
            raise KeyError(f"unknown story: {story_id}")
        story = LifeStory.from_dict(record["story"])
        updated = observe_story(story, observed_at=_utc(now or datetime.now(timezone.utc)))
        if updated == story:
            return result
        record["story"] = updated.to_dict()
        result["revision"] = int(result.get("revision", 0)) + 1
        return self._ready(result)

    def intervene(self, state: Mapping[str, Any], story_id: str, action: str,
                  idempotency_key: str, now: datetime | None = None) -> dict[str, Any]:
        """Resolve one intervention exactly once; replay is a state no-op."""
        if not idempotency_key:
            raise ValueError("idempotency_key is required")
        result = self._validate_and_copy(state)
        current = _utc(now or datetime.now(timezone.utc))
        record = result.get("stories", {}).get(story_id)
        if not isinstance(record, MutableMapping):
            raise KeyError(f"unknown story: {story_id}")
        fingerprint = stable_id("intervention-request", story_id, action)
        cache_key = f"{story_id}:{idempotency_key}"
        existing = result["interventions"].get(cache_key)
        if existing:
            if existing.get("fingerprint") != fingerprint:
                raise ValueError("idempotency key was reused with a different request")
            return result
        story = LifeStory.from_dict(record["story"])
        collision = _collision_from_dict(record["collision"])
        resolution = _resolution_from_dict(record["resolution"])
        if story.status in TERMINAL_STORY_STATUSES:
            raise ValueError("story has already been settled")
        if (story.status != "intervention_window" or
                (story.intervention_expires_at and current > story.intervention_expires_at)):
            raise ValueError("story is not open for intervention")
        if action not in story.intervention_actions:
            raise ValueError("management action is not available for this story")
        if action in ROMANCE_ACTIONS:
            relationship_state = self._apply_romance_transition(result, story, action, current)
            visible_facts = {**story.visible_facts, "relationship_state": relationship_state}
            updated_story = replace(story, status="resolved_with_management",
                                    resolution_id=stable_id("resolution", story.id, action),
                                    intervention_actions=(), trouble_signal=False, updated_at=current,
                                    visible_facts=visible_facts)
            record["story"] = updated_story.to_dict()
            result["open_story_ids"] = [value for value in result.get("open_story_ids", [])
                                        if value != story.id]
            result["aftermath"] = (list(result.get("aftermath", [])) + [{
                "kind": "relationship_transition", "story_id": story.id,
                "participant_ids": list(story.participant_ids),
                "channel": "romance", "state": relationship_state,
                "occurred_at": current.isoformat(),
            }])[-120:]
            outcome = "accepted"
        else:
            if action not in MANAGEMENT_ACTIONS:
                raise ValueError("unknown management action")
            acceptance = self._participant_acceptance(result, story, action)
            settlement = settle_story_with_management(
                story, action=action, participant_acceptance=acceptance,
                now=current, base_resolution=resolution,
            )
            if not settlement.changed:
                raise ValueError("story is not open for intervention")
            record["story"] = settlement.story.to_dict()
            if settlement.story.status in TERMINAL_STORY_STATUSES:
                result["open_story_ids"] = [value for value in result.get("open_story_ids", [])
                                            if value != story.id]
            severity_shift = (-8 if "cooperation" in settlement.outcome_tags else
                              8 if "conflict" in settlement.outcome_tags else 0)
            managed_resolution = replace(
                resolution, id=settlement.story.resolution_id or resolution.id, mode="managed",
                relationship_changes=settlement.relationship_changes,
                action_instructions=settlement.action_instructions,
                memory_seeds=settlement.memory_seeds,
                severity_after=clamp(resolution.severity_after + severity_shift),
                outcome_tags=settlement.outcome_tags or resolution.outcome_tags,
                settled_at=current,
            )
            record["resolution"] = managed_resolution.to_dict()
            existing_thread = (UnresolvedThread.from_dict(result["threads"][story.thread_id])
                               if story.thread_id and story.thread_id in result["threads"] else None)
            thread = update_unresolved_thread(existing_thread, story=settlement.story,
                                              collision=collision, resolution=managed_resolution,
                                              now=current)
            if thread:
                result["threads"][thread.id] = thread.to_dict()
            self._apply_settlement(result, _collision_from_dict(record["collision"]), managed_resolution,
                                   settlement.story, settlement.action_instructions,
                                   settlement.memory_seeds, settlement.observable_aftermath,
                                   current, profiles=None)
            self._maybe_apply_managed_truce(
                result, settlement.story, action, acceptance, current,
            )
            outcome = next(iter(settlement.observable_aftermath), {}).get("outcome", "mixed")
        result["interventions"][cache_key] = {
            "fingerprint": fingerprint, "story_id": story_id, "action": action,
            "outcome": outcome, "applied_at": current.isoformat(),
        }
        result["revision"] = int(result.get("revision", 0)) + 1
        result["next_transition_at"] = self._next_transition(result, current)
        self._trim(result)
        return self._ready(result)

    def player_interaction(self, state: Mapping[str, Any], npc_id: str, interaction_id: str,
                           *, mood_change: int = 0, relationship_change: int = 0,
                           semantic_signals: Sequence[str] = (),
                           now: datetime | None = None) -> dict[str, Any]:
        """Apply the rule-owned life effects of one committed player conversation.

        Player-to-NPC relationship progression remains a separate product
        relationship.  This transition only updates the resident's immediate
        life state and is idempotent by the committed chat request id.
        """
        if not interaction_id:
            raise ValueError("interaction_id is required")
        result = self._validate_and_copy(state)
        if npc_id not in result["residents"]:
            raise KeyError(f"unknown resident: {npc_id}")
        applied = result.setdefault("processed_player_interaction_ids", [])
        fact_id = stable_id("player-interaction", result["player_id"], npc_id, interaction_id)
        if fact_id in applied:
            return result
        moment = _utc(now or datetime.now(timezone.utc))
        resident = result["residents"][npc_id]
        runtime = normalize_runtime_v2(resident.get("runtime"), now=moment)
        mood = max(-10, min(10, int(mood_change)))
        relationship = max(-10, min(10, int(relationship_change)))
        runtime["emotion"]["valence"] = clamp(float(runtime["emotion"].get("valence", 50)) + mood)
        runtime["emotion"]["stress"] = clamp(
            float(runtime["emotion"].get("stress", 38)) - max(0, mood) + max(0, -mood) * .5,
        )
        runtime["needs"]["social"] = clamp(float(runtime["needs"].get("social", 50)) + 8)
        runtime["needs"]["love"] = clamp(float(runtime["needs"].get("love", 50)) + relationship)
        runtime["last_simulated_at"] = moment.isoformat()
        resident["runtime"] = runtime
        applied.append(fact_id)
        result["processed_player_interaction_ids"] = applied[-MAX_PROCESSED_IDS:]
        result["aftermath"] = (list(result.get("aftermath", [])) + [{
            "kind": "player_conversation", "fact_id": fact_id, "npc_id": npc_id,
            "semantic_signals": sorted({str(value) for value in semantic_signals}),
            "occurred_at": moment.isoformat(),
        }])[-120:]
        result["revision"] = int(result.get("revision", 0)) + 1
        return self._ready(result)

    def public_snapshot(self, state: Mapping[str, Any]) -> dict[str, Any]:
        """Return UI-safe state, excluding seeds and hidden attraction."""
        source = self._validate_and_copy(state)
        residents = []
        for npc_id, raw in sorted(source["residents"].items()):
            action = LifeAction.from_dict(raw["current_action"])
            observable = project_observable_action(
                action, {}, runtime=raw.get("runtime") or {},
            )
            residents.append({
                "npc_id": npc_id, "household_id": raw["household_id"],
                "home_location_id": raw["home_location_id"],
                "current_location_id": raw["current_location_id"],
                "runtime": observable_runtime_state(raw.get("runtime")),
                "current_action": {
                    "id": action.id, "type": action.action_type, "status": action.status,
                    "phase": life_action_phase(action.status),
                    "location_id": action.location_id, "target_npc_id": action.target_npc_id,
                    "target_resource_id": action.target_resource_id,
                    "arrives_at": action.arrives_at.isoformat() if action.arrives_at else None,
                    "ends_at": action.ends_at.isoformat() if action.ends_at else None,
                    "retry_at": action.retry_at.isoformat() if action.retry_at else None,
                    "visible_intent": observable["visible_intent"],
                    "visible_intent_zh": observable["visible_intent_zh"],
                    "visible_context": observable["visible_context"],
                    "observable_state": observable["observable_state"],
                    "animation_cue": copy.deepcopy(action.animation_cue),
                },
                "observable_state": observable["observable_state"],
            })
        pairs = []
        for key, raw in sorted(source["relationships"].items()):
            pair = RelationshipPair.from_dict(raw)
            pairs.append({
                "pair_key": key,
                "participant_ids": [pair.resident_a_id, pair.resident_b_id],
                "channels": {
                    "friendship": pair.channels.friendship, "conflict": pair.channels.conflict,
                    "rivalry": pair.channels.rivalry,
                    "romance": (pair.channels.romance
                                if pair.channels.romance in {"dating", "partner", "separated"} else "none"),
                    "history": sorted(pair.channels.history),
                },
                "directions": [
                    {"owner_id": edge.owner_id, "target_id": edge.target_id,
                     "labels": sorted(set(edge.labels) - {"crush", "dependent", "afraid"}), **_bands(edge)}
                    for edge in (pair.a_to_b, pair.b_to_a)
                ],
                "structural_bonds": [
                    {"bond_id": bond.bond_id, "kind": bond.kind,
                     "participant_ids": list(bond.participant_ids), "roles": dict(bond.roles),
                     "scope_id": bond.scope_id, "active": bond.active}
                    for bond in pair.structural_bonds
                ],
            })
        stories = []
        for record in source["stories"].values():
            story = dict(record["story"])
            if not story.get("observable"):
                continue
            presentable = LifeStory.from_dict(story).is_presentable(
                now=_moment(source.get("last_advanced_at")),
            )
            facts = {key: value for key, value in dict(story.get("visible_facts") or {}).items()
                     if key != "response_preview"}
            stories.append({key: copy.deepcopy(value) for key, value in story.items()
                            if key not in {"classification", "rules_version", "visible_facts"}})
            stories[-1]["visible_facts"] = facts
            stories[-1]["presentable"] = presentable
        stories.sort(key=lambda value: (value["created_at"], value["id"]), reverse=True)
        threads = []
        for raw in source["threads"].values():
            intensity = int(raw.get("intensity", 0))
            threads.append({
                "id": raw["id"], "kind": raw["kind"], "topic": raw["topic"],
                "participant_ids": list(raw.get("participant_ids", [])),
                "source_story_ids": list(raw.get("source_story_ids", [])),
                "status": raw["status"], "recurrence_count": int(raw.get("recurrence_count", 0)),
                "intensity_band": "high" if intensity >= 70 else "medium" if intensity >= 35 else "low",
                "updated_at": raw["updated_at"],
            })
        return self._ready({
            "schema_version": source["schema_version"], "rules_version": source["rules_version"],
            "player_id": source["player_id"], "revision": source["revision"],
            "last_advanced_at": source["last_advanced_at"],
            "next_transition_at": source.get("next_transition_at"),
            "residents": residents, "households": list(source["households"].values()),
            "resources": copy.deepcopy(source["resources"]), "relationships": pairs,
            "stories": stories, "threads": sorted(threads, key=lambda value: value["updated_at"], reverse=True),
            "aftermath": copy.deepcopy(source.get("aftermath", [])[-40:]),
            "metrics": copy.deepcopy(source.get("metrics", {})),
        })

    # Initialization -------------------------------------------------

    def _initial_relationships(self, profiles: Mapping[str, Mapping[str, Any]],
                               locations: Mapping[str, Mapping[str, str]],
                               seeds: Mapping[Any, Any] | Sequence[Mapping[str, Any]] | None,
                               now: datetime) -> dict[str, Any]:
        pairs = {_pair_key(a, b): RelationshipPair.initial(a, b, now)
                 for a, b in combinations(sorted(profiles), 2)}
        raw_seeds: list[tuple[str | None, Mapping[str, Any]]] = []
        if isinstance(seeds, Mapping):
            raw_seeds = [(str(key), value) for key, value in seeds.items() if isinstance(value, Mapping)]
        elif seeds:
            raw_seeds = [(None, value) for value in seeds if isinstance(value, Mapping)]
        for supplied_key, raw in raw_seeds:
            if "resident_a_id" in raw and "resident_b_id" in raw and "a_to_b" in raw:
                pair = RelationshipPair.from_dict(raw)
                if pair.pair_key in pairs:
                    pairs[pair.pair_key] = pair
                continue
            owner = str(raw.get("owner_id") or raw.get("source_npc_id") or raw.get("npc_a") or "")
            target = str(raw.get("target_id") or raw.get("target_npc_id") or raw.get("npc_b") or "")
            if (not owner or not target) and supplied_key and ":" in supplied_key:
                owner, target = supplied_key.split(":", 1)
            key = _pair_key(owner, target) if owner and target and owner != target else ""
            if key not in pairs:
                continue
            edge = pairs[key].edge(owner, target)
            for dimension in DIMENSIONS:
                if dimension in raw:
                    setattr(edge, dimension, clamp(raw[dimension]))
            if isinstance(raw.get("evidence_counts"), Mapping):
                edge.evidence_counts.update({str(k): int(v) for k, v in raw["evidence_counts"].items()})
            pairs[key] = self.relationships.refresh(pairs[key])

        for key, pair in pairs.items():
            a, b = pair.resident_a_id, pair.resident_b_id
            bonds = list(pair.structural_bonds)
            if locations[a]["household_id"] == locations[b]["household_id"]:
                bonds.append(StructuralBond(
                    stable_id("bond", key, "household", locations[a]["household_id"]),
                    "household", (a, b), {a: "housemate", b: "housemate"},
                    locations[a]["household_id"], True,
                ))
            family_a = set(_list(profiles[a].get("family_ids") or profiles[a].get("familyIds")))
            family_b = set(_list(profiles[b].get("family_ids") or profiles[b].get("familyIds")))
            if b.casefold() in family_a or a.casefold() in family_b:
                bonds.append(StructuralBond(stable_id("bond", key, "family"), "family", (a, b),
                                            {a: "sibling", b: "sibling"}, None, True))
            if bonds:
                unique: dict[tuple[str, str, tuple[tuple[str, str], ...]], StructuralBond] = {}
                for bond in bonds:
                    signature = (bond.kind, bond.scope_id or "", tuple(sorted(bond.roles.items())))
                    unique.setdefault(signature, bond)
                pair = self.relationships.with_structural_bonds(pair, list(unique.values()))
            pairs[key] = self.relationships.refresh(pair)
        return {key: pair.to_dict() for key, pair in sorted(pairs.items())}

    def _reconcile_residents(self, state: MutableMapping[str, Any],
                             profiles: Mapping[str, Mapping[str, Any]], now: datetime,
                             home_location_mapping: Mapping[str, Any] | None = None) -> None:
        residents = state["residents"]
        previous_households = {
            npc_id: str(resident.get("household_id") or "")
            for npc_id, resident in residents.items()
        }
        for npc_id in profiles:
            if npc_id in residents:
                resident = residents[npc_id]
                resident["runtime"] = normalize_runtime_v2(resident.get("runtime"), now=now)
                resident["relationship_policy"] = self._relationship_policy(profiles[npc_id])
                if home_location_mapping is not None and npc_id in home_location_mapping:
                    old_home = str(resident.get("home_location_id") or "")
                    old_household = str(resident.get("household_id") or "")
                    old_current = str(resident.get("current_location_id") or "")
                    info = _location_info(npc_id, home_location_mapping)
                    if info["household_id"] != old_household:
                        self._interrupt_action_for_household_move(
                            state, resident, old_household, old_home, now,
                        )
                    resident.update({key: value for key, value in info.items()
                                     if key != "current_location_id"})
                    # Moving house should move a resident who was physically at
                    # home, but must not teleport somebody already out in town.
                    was_at_home = (not old_current or old_current == old_home
                                   or (old_household
                                       and old_current.startswith(f"{old_household}:")))
                    resident["current_location_id"] = (
                        info["home_location_id"] if was_at_home else old_current
                    )
                continue
            info = _location_info(npc_id, home_location_mapping)
            residents[npc_id] = {"npc_id": npc_id, **info,
                                 "runtime": normalize_runtime_v2(None, now=now),
                                 "current_action": None, "recent_action_types": [],
                                 "decision_serial": 0, "completed_action_count": 0,
                                 "pending_instruction": None,
                                 "relationship_policy": self._relationship_policy(profiles[npc_id])}

        # Preserve open stories, unresolved responsibilities and historical
        # facts when legacy per-resident households collapse into the one shared
        # home. Stable story/thread ids remain unchanged; only their objective
        # household/location references move to the canonical residence.
        household_remap = {
            old: str(residents[npc_id].get("household_id") or "")
            for npc_id, old in previous_households.items()
            if npc_id in residents and old
            and old != str(residents[npc_id].get("household_id") or "")
        }
        if household_remap:
            def rehome(value: Any) -> Any:
                if isinstance(value, MutableMapping):
                    for key, item in list(value.items()):
                        if key == "household_id" and isinstance(item, str) and item in household_remap:
                            value[key] = household_remap[item]
                        elif key in {"location_id", "home_location_id"} and isinstance(item, str):
                            old_prefix = next((old for old in household_remap
                                               if item.startswith(f"{old}:")), None)
                            if old_prefix:
                                value[key] = household_remap[old_prefix] + item[len(old_prefix):]
                        else:
                            rehome(item)
                elif isinstance(value, list):
                    for item in value:
                        rehome(item)
                return value

            for collection_name in (
                "stories", "threads", "responsibilities", "boundary_events",
                "environment_events", "aftermath", "memory_seeds",
            ):
                rehome(state.get(collection_name))

        # Rebuild objective household membership from resident locations while
        # preserving accumulated household state and resources.  In particular,
        # adding a housemate must not overwrite the original member or reset the
        # kitchen merely because the shared household id already exists.
        members_by_household: dict[str, list[str]] = {}
        for npc_id, resident in residents.items():
            members_by_household.setdefault(str(resident["household_id"]), []).append(npc_id)
        for household_id, members in sorted(members_by_household.items()):
            members.sort()
            anchor = residents[members[0]]
            household = state["households"].get(household_id)
            if household is None:
                household = {
                    "id": household_id,
                    "name": f"{profiles.get(members[0], {}).get('name', members[0])}'s household",
                    "residence_id": anchor["residence_id"],
                    "residence": {"id": anchor["residence_id"],
                                  "location_id": anchor["home_location_id"], "name": "Home"},
                    "state": {"cleanliness": 78, "noise": 22, "shared_budget": 100},
                }
                state["households"][household_id] = household
            household["members"] = members
            household.setdefault("residence_id", anchor["residence_id"])
            household.setdefault("residence", {
                "id": anchor["residence_id"], "location_id": anchor["home_location_id"],
                "name": "Home",
            })
        obsolete_households = set(state["households"]) - set(members_by_household)
        for household_id in obsolete_households:
            state["households"].pop(household_id, None)
        if obsolete_households:
            state["resources"] = [
                value for value in state["resources"]
                if value.get("scope") == "city"
                or value.get("household_id") not in obsolete_households
            ]

        # Chore facts remain in history, but cease being current facts after
        # their participants no longer share the household which owned them.
        for responsibility in state.get("responsibilities", []):
            if not responsibility.get("active", True):
                continue
            household_id = str(responsibility.get("household_id") or "")
            participants = {str(value) for value in responsibility.get("participant_ids", [])}
            current_members = set(members_by_household.get(household_id, []))
            if household_id not in members_by_household or not participants <= current_members:
                responsibility["active"] = False
                responsibility["resolved_at"] = now.isoformat()
                responsibility["resolution_reason"] = "household_changed"

        existing_resource_ids = {str(value.get("id")) for value in state["resources"]}
        for household_id in sorted(members_by_household):
            for resource in default_household_resources(household_id, self.catalog):
                if resource.id not in existing_resource_ids:
                    state["resources"].append(resource.to_dict())
                    existing_resource_ids.add(resource.id)

        for a, b in combinations(sorted(residents), 2):
            key = _pair_key(a, b)
            pair = (RelationshipPair.from_dict(state["relationships"][key])
                    if key in state["relationships"] else RelationshipPair.initial(a, b, now))
            # Household and family are objective bonds, so replace their stale
            # projections while preserving school/work/neighbor bonds.
            bonds = [bond for bond in pair.structural_bonds
                     if bond.kind not in {"household", "family"}]
            if residents[a]["household_id"] == residents[b]["household_id"]:
                household_id = str(residents[a]["household_id"])
                bonds.append(StructuralBond(
                    stable_id("bond", key, "household", household_id),
                    "household", (a, b), {a: "housemate", b: "housemate"},
                    household_id, True,
                ))
            family_a = set(_list(profiles.get(a, {}).get("family_ids")
                                 or profiles.get(a, {}).get("familyIds")))
            family_b = set(_list(profiles.get(b, {}).get("family_ids")
                                 or profiles.get(b, {}).get("familyIds")))
            if b.casefold() in family_a or a.casefold() in family_b:
                bonds.append(StructuralBond(
                    stable_id("bond", key, "family"), "family", (a, b),
                    {a: "sibling", b: "sibling"}, None, True,
                ))
            pair = self.relationships.with_structural_bonds(pair, bonds)
            state["relationships"][key] = self.relationships.refresh(pair).to_dict()

    @staticmethod
    def _interrupt_action_for_household_move(state: MutableMapping[str, Any],
                                             resident: MutableMapping[str, Any],
                                             old_household_id: str, old_home_id: str,
                                             now: datetime) -> None:
        raw = resident.get("current_action")
        if not isinstance(raw, Mapping):
            return
        action = LifeAction.from_dict(raw)
        if action.status in {"completed", "abandoned", "interrupted"}:
            return
        target_resource = next((
            value for value in state.get("resources", [])
            if value.get("id") == action.target_resource_id
        ), None)
        old_internal_location = bool(
            action.location_id and (
                action.location_id == old_home_id
                or (old_household_id
                    and str(action.location_id).startswith(f"{old_household_id}:"))
            )
        )
        old_household_resource = bool(
            target_resource and target_resource.get("household_id") == old_household_id
        )
        if not (old_internal_location or old_household_resource):
            return
        if action.target_resource_id:
            for index, resource_raw in enumerate(state.get("resources", [])):
                if resource_raw.get("id") != action.target_resource_id:
                    continue
                released = release_resource(
                    ResourceState.from_dict(resource_raw), action_id=action.id, now=now,
                )
                state["resources"][index] = released.resource.to_dict()
                break
        resident["current_action"] = replace(
            action, status="interrupted", completed_at=now,
            blocked_reason="household_changed",
        ).to_dict()
        resident["pending_instruction"] = None
        runtime = resident.get("runtime")
        if isinstance(runtime, MutableMapping):
            runtime["active_desire_ids"] = []
            runtime["current_commitment_id"] = None

    # Actions/resources ----------------------------------------------

    @staticmethod
    def _resource_map(state: Mapping[str, Any]) -> dict[str, ResourceState]:
        return {str(raw["id"]): ResourceState.from_dict(raw) for raw in state.get("resources", [])}

    def _resident_resources(self, state: Mapping[str, Any], npc_id: str,
                            resources: Mapping[str, ResourceState]) -> tuple[ResourceState, ...]:
        household_id = state["residents"][npc_id]["household_id"]
        return tuple(resource for resource in resources.values()
                     if resource.scope == "city" or resource.household_id == household_id)

    @staticmethod
    def _eligible_resident_targets(state: Mapping[str, Any], npc_id: str) -> tuple[str, ...]:
        """Residents an NPC may intentionally approach for a private chat.

        A stranger elsewhere in the city is not "nearby" and cannot be used as
        a shortcut that teleports the actor into that stranger's home.  New
        acquaintances first meet by independently choosing a public social
        space; household/family ties and established friendship can justify a
        deliberate visit.
        """
        actor = state["residents"][npc_id]
        actor_location = actor.get("current_location_id")
        eligible: list[str] = []
        for other_id, other in sorted(state["residents"].items()):
            if other_id == npc_id:
                continue
            pair_raw = state.get("relationships", {}).get(_pair_key(npc_id, other_id))
            if not pair_raw:
                continue
            same_location = bool(actor_location and actor_location == other.get("current_location_id"))
            objective_tie = any(
                bool(bond.get("active", True)) and bond.get("kind") in {"household", "family"}
                for bond in pair_raw.get("structural_bonds", [])
            )
            established_friend = pair_raw.get("channels", {}).get("friendship") in {
                "friend", "close_friend",
            }
            if same_location or objective_tie or established_friend:
                eligible.append(other_id)
        return tuple(eligible)

    def _ensure_current_action(self, state: MutableMapping[str, Any],
                               profiles: Mapping[str, Mapping[str, Any]], npc_id: str,
                               window_key: str, period: str, now: datetime,
                               resources: MutableMapping[str, ResourceState]) -> LifeAction:
        resident = state["residents"][npc_id]
        raw = resident.get("current_action")
        if isinstance(raw, Mapping):
            action = LifeAction.from_dict(raw)
            if action.status not in {"completed", "abandoned", "interrupted"}:
                return action
        profile = profiles.get(npc_id, {})
        runtime = normalize_runtime_v2(resident.get("runtime"), now=now)
        nearby = self._eligible_resident_targets(state, npc_id)
        serial = int(resident.get("decision_serial", 0)) + 1
        decision_key = f"{window_key}:{serial}"
        context = NpcLifeContext(
            player_id=state["player_id"], npc_id=npc_id, decision_key=decision_key,
            period=cast(Any, period), needs=runtime["needs"], emotion=runtime["emotion"],
            traits=_profile_traits(profile),
            interests=_profile_interests(profile), habits=_list(profile.get("habits")),
            goal_tags=_profile_goal_tags(profile),
            current_location_id=resident.get("current_location_id"),
            current_location_kind="home" if resident.get("current_location_id") == resident.get("home_location_id") else "city",
            scheduled_kind=_profile_schedule_kind(profile, period),
            nearby_resident_ids=nearby,
            resources=self._resident_resources(state, npc_id, resources),
            recent_action_types=tuple(resident.get("recent_action_types", [])),
        )
        decision = select_life_action(context, self.catalog)
        target_location = resident.get("current_location_id")
        if decision.selected.target_resource_id in resources:
            target_location = resources[decision.selected.target_resource_id].location_id
        elif decision.selected.target_npc_id in state["residents"]:
            target_location = state["residents"][decision.selected.target_npc_id]["current_location_id"]
        travel = (0 if target_location == resident.get("current_location_id") else
                  120 + int(stable_fraction(decision.commitment_id, "travel") * 240))
        action = create_life_action(
            decision, player_id=state["player_id"], npc_id=npc_id, now=now,
            current_location_id=resident.get("current_location_id"),
            target_location_id=target_location, travel_seconds=travel, catalog=self.catalog,
        )
        outcome = "acquired"
        if action.target_resource_id and action.target_resource_id in resources:
            transition = reserve_resource(resources[action.target_resource_id], npc_id=npc_id,
                                          action_id=action.id, now=now,
                                          lease_seconds=action.duration_seconds + travel + 5 * 60)
            resources[action.target_resource_id] = transition.resource
            outcome = transition.outcome
        action = advance_life_action(action, now=now, resource_outcome=cast(Any, outcome)).action
        resident["current_action"] = action.to_dict()
        resident["decision_serial"] = serial
        resident["runtime"] = runtime
        runtime["active_desire_ids"] = [decision.desire_id]
        runtime["current_commitment_id"] = decision.commitment_id
        return action

    def _advance_instant(self, state: MutableMapping[str, Any],
                         profiles: Mapping[str, Mapping[str, Any]], start: datetime,
                         end: datetime) -> None:
        """Integrate one canonical transition instant.

        This method is deliberately independent of API polling windows.  The
        only instants fed into it are facts already stored in the world
        (arrival, completion, retry, reservation expiry, or story deadline).
        """
        elapsed = max(0, (end - start).total_seconds())
        for npc_id in sorted(state["residents"]):
            self._decay_runtime(state["residents"][npc_id], elapsed, end)
        for key, raw in list(state["relationships"].items()):
            last_decayed = _moment(raw.get("last_decayed_at"), fallback=end)
            if (end - last_decayed).total_seconds() < RELATIONSHIP_DECAY_INTERVAL_SECONDS:
                continue
            pair = RelationshipPair.from_dict(raw)
            state["relationships"][key] = self.relationships.decay_to(pair, end).to_dict()

        # A due incident may issue an instruction that must be consumed at the
        # same transition instant, before the action completes or retries.
        self._settle_due_stories(state, profiles, end)
        resource_map = self._resource_map(state)
        window = self.clock.decision_window(end)
        for npc_id in sorted(state["residents"]):
            resident = state["residents"][npc_id]
            action = self._ensure_current_action(state, profiles, npc_id, window.key,
                                                 window.period, end, resource_map)
            # ``blocked -> retrying -> performing`` contains two zero-time
            # transitions.  Stabilize them here so retrying cannot become a
            # state with no future wake-up timestamp.
            for _ in range(4):
                outcome = "acquired"
                if action.target_resource_id and action.target_resource_id in resource_map:
                    reserved = reserve_resource(
                        resource_map[action.target_resource_id], npc_id=npc_id,
                        action_id=action.id, now=end,
                        lease_seconds=action.duration_seconds + 5 * 60,
                    )
                    resource_map[action.target_resource_id] = reserved.resource
                    outcome = reserved.outcome
                instruction = resident.get("pending_instruction")
                interruption = "collision_interruption" if instruction in {"interrupt", "substitute"} else None
                transition = advance_life_action(
                    action, now=end, resource_outcome=cast(Any, outcome),
                    interruption_reason=interruption,
                )
                resident["pending_instruction"] = None
                action = transition.action
                if action.status == "performing":
                    resident["current_location_id"] = action.location_id or resident["current_location_id"]
                if transition.completed:
                    self._complete_action(state, resident, action, transition.effects, resource_map, end)
                    resident["current_action"] = None
                    action = self._ensure_current_action(
                        state, profiles, npc_id, window.key, window.period, end, resource_map,
                    )
                    break
                if action.status in {"abandoned", "interrupted"}:
                    if action.target_resource_id and action.target_resource_id in resource_map:
                        released = release_resource(resource_map[action.target_resource_id],
                                                    action_id=action.id, now=end)
                        resource_map[action.target_resource_id] = released.resource
                    resident["current_action"] = None
                    action = self._ensure_current_action(
                        state, profiles, npc_id, window.key, window.period, end, resource_map,
                    )
                    break
                if action.status != "retrying":
                    break
            resident["current_action"] = action.to_dict()

        state["resources"] = [resource_map[key].to_dict() for key in sorted(resource_map)]
        self._detect_and_record(state, profiles, window.key, end)
        self._settle_due_stories(state, profiles, end)
        state["simulation_cursor_at"] = end.isoformat()
        self._trim(state)

    def _advance_block(self, state: MutableMapping[str, Any],
                       profiles: Mapping[str, Mapping[str, Any]], window_key: str,
                       period: str, start: datetime, end: datetime) -> None:
        """Compatibility wrapper for older internal callers.

        New code advances through :meth:`_advance_instant`; retaining this
        private wrapper keeps out-of-tree diagnostics from silently reverting
        to the former coarse one-action-per-block behaviour.
        """
        del window_key, period
        cursor = start
        while True:
            transition_at = self._next_transition_moment(state, cursor)
            if transition_at is None or transition_at > end:
                break
            self._advance_instant(state, profiles, cursor, transition_at)
            cursor = transition_at
        if cursor == start and self._has_due_transition(state, end):
            self._advance_instant(state, profiles, cursor, end)

    @staticmethod
    def _decay_runtime(resident: MutableMapping[str, Any], elapsed_seconds: float, now: datetime) -> None:
        runtime = normalize_runtime_v2(resident.get("runtime"), now=now)
        hours = min(24 * 31, elapsed_seconds / 3600)
        rates = {"food": 2.2, "rest": 1.05, "social": .7, "achievement": .3,
                 "love": .22, "privacy": .3, "fun": .48, "security": .04}
        for need in CORE_NEEDS:
            runtime["needs"][need] = clamp(float(runtime["needs"].get(need, 55)) - rates[need] * hours)
        runtime["emotion"]["stress"] = clamp(float(runtime["emotion"].get("stress", 38)) + .12 * hours)
        runtime["last_simulated_at"] = now.isoformat()
        resident["runtime"] = runtime

    def _complete_action(self, state: MutableMapping[str, Any], resident: MutableMapping[str, Any],
                         action: LifeAction, effects: Mapping[str, Mapping[str, int]],
                         resources: MutableMapping[str, ResourceState], now: datetime) -> None:
        applied = state["processed_action_effect_ids"]
        if action.id not in applied:
            runtime = resident["runtime"]
            for group in ("needs", "emotion"):
                for key, delta in effects.get(group, {}).items():
                    runtime[group][key] = clamp(float(runtime[group].get(key, 50)) + delta)
            target_id = action.target_resource_id
            if target_id and target_id in resources:
                resources[target_id] = apply_resource_deltas(resources[target_id], effects.get("resource", {}))
            elif action.action_type == "clean_shared_space":
                for key, resource in list(resources.items()):
                    if resource.household_id == resident["household_id"]:
                        resources[key] = apply_resource_deltas(resource, effects.get("resource", {}))
            kitchen_after = resources.get(target_id) if target_id else None
            creates_dishes = action.action_type == "leave_dishes" or (
                action.action_type == "prepare_food" and kitchen_after is not None
                and kitchen_after.kind == "kitchen"
                and float(kitchen_after.state.get("cleanliness", 100)) <= 55
            )
            if creates_dishes:
                others = [npc_id for npc_id, value in state["residents"].items()
                          if value["household_id"] == resident["household_id"] and npc_id != action.npc_id]
                state["responsibilities"].append({
                    "id": stable_id("responsibility", action.id), "kind": "dishes", "active": True,
                    "created_by": action.npc_id, "affected_id": others[0] if others else None,
                    "participant_ids": [action.npc_id, *others[:1]],
                    "household_id": resident["household_id"], "location_id": action.location_id,
                    "action_ids": [action.id], "created_at": now.isoformat(),
                    "triggers": ["chore_created", "dishwashing_thread"],
                })
            elif action.action_type == "clean_shared_space":
                active = [responsibility for responsibility in state["responsibilities"]
                          if responsibility.get("active")
                          and responsibility.get("household_id") == resident["household_id"]]
                creators = sorted({str(value.get("created_by")) for value in active
                                   if value.get("created_by") and value.get("created_by") != action.npc_id})
                for responsibility in active:
                    if responsibility.get("kind") != "care_imbalance":
                        responsibility["active"] = False
                counts = resident.setdefault("uncredited_cleanup_counts", {})
                for creator_id in creators:
                    count = int(counts.get(creator_id, 0)) + 1
                    counts[creator_id] = count
                    if count < 2:
                        continue
                    existing_care_thread = any(
                        responsibility.get("active")
                        and responsibility.get("kind") == "care_imbalance"
                        and responsibility.get("created_by") == creator_id
                        and responsibility.get("affected_id") == action.npc_id
                        and responsibility.get("household_id") == resident["household_id"]
                        for responsibility in state["responsibilities"]
                    )
                    if existing_care_thread:
                        continue
                    state["responsibilities"].append({
                        "id": stable_id("responsibility", action.id, creator_id, "care-imbalance"),
                        "kind": "care_imbalance", "active": True,
                        "created_by": creator_id, "affected_id": action.npc_id,
                        "participant_ids": [action.npc_id, creator_id],
                        "household_id": resident["household_id"], "location_id": action.location_id,
                        "action_ids": [action.id], "created_at": now.isoformat(),
                        "recurrence_count": count,
                        "triggers": ["care_imbalance", "repeated_uncredited_work"],
                    })
            applied.append(action.id)
            resident["completed_action_count"] = int(resident.get("completed_action_count", 0)) + 1
            state["metrics"]["completed_actions"] = int(state["metrics"].get("completed_actions", 0)) + 1
            recent = list(resident.get("recent_action_types", []))
            resident["recent_action_types"] = ([action.action_type] + recent)[:5]
            ambient = story_from_action(action, now=now)
            if ambient.id not in state["stories"]:
                state["stories"][ambient.id] = {"story": ambient.to_dict(),
                                                "collision": None, "resolution": None}
                state.setdefault("open_story_ids", []).append(ambient.id)
        if action.target_resource_id and action.target_resource_id in resources:
            released = release_resource(resources[action.target_resource_id], action_id=action.id, now=now)
            resources[action.target_resource_id] = released.resource
        resident["runtime"]["active_desire_ids"] = []
        resident["runtime"]["current_commitment_id"] = None

    # Collisions/stories ---------------------------------------------

    def _relationship_edges(self, state: Mapping[str, Any]) -> dict[tuple[str, str], Mapping[str, Any]]:
        result: dict[tuple[str, str], Mapping[str, Any]] = {}
        for raw in state["relationships"].values():
            first = raw.get("a_to_b", {})
            second = raw.get("b_to_a", {})
            result[(str(first.get("owner_id")), str(first.get("target_id")))] = first
            result[(str(second.get("owner_id")), str(second.get("target_id")))] = second
        return result

    def _collision_profiles(self, state: Mapping[str, Any],
                            profiles: Mapping[str, Mapping[str, Any]]) -> dict[str, Mapping[str, Any]]:
        result = {}
        for npc_id, profile in profiles.items():
            value = dict(profile)
            value["axes"] = compile_persona(profile).get("axes", {})
            if npc_id in state["residents"]:
                value["emotion"] = dict(state["residents"][npc_id]["runtime"].get("emotion") or {})
            result[npc_id] = value
        return result

    def _fact_events(self, state: Mapping[str, Any], now: datetime) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        boundaries: list[dict[str, Any]] = []
        environment: list[dict[str, Any]] = []
        actions = {npc_id: LifeAction.from_dict(raw["current_action"])
                   for npc_id, raw in state["residents"].items()}
        period = self.clock.decision_window(now).period
        for actor_id, action in actions.items():
            if action.target_npc_id and action.target_npc_id in actions:
                target = actions[action.target_npc_id]
                if (action.status == "performing" and target.status == "performing"
                        and action.location_id == target.location_id
                        and target.action_type in {"sleep", "shower", "rest_alone"}):
                    boundaries.append({
                        "id": stable_id("boundary", action.id, target.id), "kind": "privacy",
                        "participant_ids": [actor_id, target.npc_id], "actor_id": actor_id,
                        "affected_id": target.npc_id, "action_ids": [action.id, target.id],
                        "location_id": target.location_id, "triggers": ["privacy_boundary"],
                        "active": True, "violated": True,
                    })
            if action.status == "performing" and action.target_resource_id:
                resource = next((raw for raw in state["resources"]
                                 if raw["id"] == action.target_resource_id), None)
                resource_state = (resource.get("state") or {}) if resource else {}
                open_periods = set(resource_state.get("open_periods") or ())
                unavailable = bool(resource and (
                    not bool(resource_state.get("available", True))
                    or (open_periods and period not in open_periods)
                ))
                if resource and unavailable:
                    environment.append({
                        "id": stable_id("environment", action.id, "unavailable"),
                        "kind": "facility", "participant_ids": [actor_id],
                        "npc_id": actor_id, "action_ids": [action.id],
                        "location_id": resource["location_id"], "resource_id": resource["id"],
                        "resource_kind": resource["kind"], "triggers": ["resource_unavailable"],
                        "active": True,
                    })
                if resource and resource["kind"] == "kitchen" and float(
                    (resource.get("state") or {}).get("stock", 100)) <= 10:
                    environment.append({
                        "id": stable_id("environment", action.id, "food-stock"),
                        "kind": "inventory", "participant_ids": [actor_id],
                        "npc_id": actor_id, "action_ids": [action.id],
                        "location_id": resource["location_id"], "resource_id": resource["id"],
                        "resource_kind": resource["kind"], "triggers": ["food_stock", "inventory_empty"],
                        "active": True,
                    })
            home_owner = next((
                owner_id for owner_id, owner in state["residents"].items()
                if owner_id != actor_id
                and owner.get("household_id") != state["residents"][actor_id].get("household_id")
                and (owner.get("home_location_id") == action.location_id
                     or (owner.get("household_id") and action.location_id
                         and str(action.location_id).startswith(f"{owner.get('household_id')}:")))
            ), None)
            household_item_actions = {
                "borrow_household_item": "personal_belonging",
                "practice_hobby": "hobby_supplies", "use_television": "television",
                "read": "books", "prepare_food": "kitchen_supplies",
            }
            item_kind = household_item_actions.get(action.action_type)
            missed_permission = (
                action.action_type in {"practice_hobby", "borrow_household_item"}
                or stable_fraction(action.id, home_owner or "", "permission-check") < .28
            )
            if (home_owner and action.status == "performing" and item_kind and missed_permission):
                boundaries.append({
                    "id": stable_id("boundary", action.id, home_owner, "borrowed-household-item"),
                    "kind": "borrowed_item", "participant_ids": [actor_id, home_owner],
                    "actor_id": actor_id, "affected_id": home_owner,
                    "action_ids": [action.id, actions[home_owner].id],
                    "location_id": action.location_id,
                    "triggers": ["borrowed_without_permission", "relationship_boundary"],
                    "item_kind": item_kind, "active": True, "violated": True,
                })

        noisy_types = {"practice_hobby", "use_television", "prepare_food"}
        quiet_types = {"sleep", "read", "rest_alone"}
        performing = [action for action in actions.values() if action.status == "performing"]
        for first, second in combinations(sorted(performing, key=lambda value: value.npc_id), 2):
            if first.location_id != second.location_id:
                continue
            noisy = first if first.action_type in noisy_types and second.action_type in quiet_types else (
                second if second.action_type in noisy_types and first.action_type in quiet_types else None
            )
            affected = second if noisy is first else first if noisy is second else None
            if not noisy or not affected:
                continue
            environment.append({
                "id": stable_id("environment", noisy.id, affected.id, "noise"),
                "kind": "noise", "participant_ids": [noisy.npc_id, affected.npc_id],
                "actor_id": noisy.npc_id, "affected_id": affected.npc_id,
                "action_ids": [noisy.id, affected.id], "location_id": noisy.location_id,
                "triggers": ["environment_noise", "noise_boundary"], "active": True,
            })
        return boundaries, environment

    def _detect_and_record(self, state: MutableMapping[str, Any],
                           profiles: Mapping[str, Mapping[str, Any]],
                           window_key: str, now: datetime) -> None:
        boundaries, environment = self._fact_events(state, now)
        state["boundary_events"] = boundaries
        state["environment_events"] = environment
        actions = tuple(LifeAction.from_dict(raw["current_action"])
                        for raw in state["residents"].values())
        resources = tuple(ResourceState.from_dict(raw) for raw in state["resources"])
        profile_map = self._collision_profiles(state, profiles)
        edges = self._relationship_edges(state)
        snapshot = CollisionSnapshot(
            window_key=window_key, now=now, actions=actions, resources=resources,
            responsibilities=tuple(item for item in state["responsibilities"] if item.get("active", True)),
            boundary_events=tuple(boundaries), environment_events=tuple(environment),
            profiles=profile_map, relationships=edges,
        )
        processed = set(state["processed_collision_ids"])
        previously_active = set(state.get("active_collision_fact_ids", []))
        detected = self.collisions.detect(snapshot)
        state["active_collision_fact_ids"] = [collision.id for collision in detected]
        cooldowns = state.setdefault("collision_cooldowns", {})
        for collision in detected:
            # A collision is the rising edge of a fact.  Re-evaluating an
            # unchanged queue, responsibility, or co-located action must not
            # create another story merely because time advanced.
            if collision.id in previously_active or collision.id in processed:
                continue
            cooldown_key = self._collision_cooldown_key(collision)
            last_occurrence = _moment(cooldowns.get(cooldown_key)) if cooldowns.get(cooldown_key) else None
            cooldown = timedelta(seconds=COLLISION_COOLDOWN_SECONDS[collision.kind])
            if last_occurrence is not None and now < last_occurrence + cooldown:
                continue
            resolution = self.collisions.resolve(collision, profiles=profile_map,
                                                 relationships=edges, settled_at=now)
            existing_thread = (state["threads"].get(collision.thread_key)
                               if collision.thread_key else None)
            recurrence = int(existing_thread.get("recurrence_count", 0)) if existing_thread else 0
            context = StoryContext(
                novelty=max(15, 65 - recurrence * 12), personality_expression=58,
                relationship_relevance=75 if len(collision.participant_ids) >= 2 else 30,
                visual_readability=72, need_stakes=min(90, 25 + collision.severity),
                unresolved_thread_pressure=int(existing_thread.get("intensity", 0)) if existing_thread else 0,
                household_impact=60 if collision.kind in {"person_resource", "person_responsibility"} else 30,
                recurrence_count=recurrence,
                existing_thread_id=str(existing_thread["id"]) if existing_thread else None,
                existing_thread_intensity=int(existing_thread.get("intensity", 0)) if existing_thread else 0,
            )
            story = story_from_collision(collision, resolution, context=context, now=now)
            story = self._offer_story_interventions(state, profiles, story, collision, resolution, now)
            if story.id not in state["stories"]:
                state["stories"][story.id] = {
                    "story": story.to_dict(), "collision": collision.to_dict(),
                    "resolution": resolution.to_dict(),
                }
                state.setdefault("open_story_ids", []).append(story.id)
            state["processed_collision_ids"].append(collision.id)
            processed.add(collision.id)
            cooldowns[cooldown_key] = now.isoformat()
            state["metrics"]["collisions"] = int(state["metrics"].get("collisions", 0)) + 1
            state["metrics"]["stories"] = int(state["metrics"].get("stories", 0)) + 1
            scenario_counts = state["metrics"].setdefault("scenario_counts", {})
            scenario_counts[collision.scenario_id] = int(scenario_counts.get(collision.scenario_id, 0)) + 1
            topic_counts = state["metrics"].setdefault("topic_counts", {})
            topic_counts[collision.topic] = int(topic_counts.get(collision.topic, 0)) + 1

    @staticmethod
    def _collision_cooldown_key(collision: Collision) -> str:
        scope = (collision.resource_id or collision.thread_key or collision.location_id
                 or str(collision.facts.get("household_id") or "world"))
        return stable_id(
            "collision-cooldown", collision.kind, collision.scenario_id,
            sorted(collision.participant_ids), scope,
            rules_version=collision.rules_version,
        )

    def _offer_story_interventions(self, state: MutableMapping[str, Any],
                                   profiles: Mapping[str, Mapping[str, Any]],
                                   story: LifeStory, collision: Collision,
                                   resolution: CollisionResolution,
                                   now: datetime) -> LifeStory:
        """Choose contextual management options, including disclosed romance beats."""
        by_kind = {
            "person_person": ("ask", "comfort", "invite_talk", "give_space", "let_them_handle_it"),
            "person_resource": ("mediate", "offer_help", "set_boundary", "let_them_handle_it"),
            "person_responsibility": ("ask", "mediate", "offer_help", "set_boundary", "let_them_handle_it"),
            "person_boundary": ("ask", "set_boundary", "give_space", "mediate", "let_them_handle_it"),
            "person_environment": ("ask", "advise", "encourage", "offer_help", "let_them_handle_it"),
        }
        actions = list(by_kind.get(collision.kind, story.intervention_actions))
        relationship_actions: list[str] = []
        if len(collision.participant_ids) == 2:
            a, b = collision.participant_ids
            pair_raw = state.get("relationships", {}).get(_pair_key(a, b))
            if pair_raw and self._romance_pair_eligible(state, profiles, a, b):
                pair = RelationshipPair.from_dict(pair_raw)
                if collision.topic in {"companionship", "missed_connection"}:
                    if pair.channels.romance == "mutual_interest":
                        choices = self._ensure_romance_choices(
                            state, pair, (a, b), story.id, "dating", now,
                        )
                        relationship_actions.append("support_confession")
                        if all(value["choice"] == "accept" for value in choices):
                            relationship_actions.append("start_dating")
                    elif pair.channels.romance == "dating":
                        choices = self._ensure_romance_choices(
                            state, pair, (a, b), story.id, "partner", now,
                        )
                        if all(value["choice"] == "accept" for value in choices):
                            relationship_actions.append("become_partners")
                if (pair.channels.romance in {"dating", "partner"}
                        and "conflict" in resolution.outcome_tags
                        and any(self._consents(pair, npc, "separated") for npc in (a, b))):
                    relationship_actions.append("separate")
        if story.status != "intervention_window" and not relationship_actions:
            return story
        actions.extend(relationship_actions)
        facts = dict(story.visible_facts)
        if relationship_actions:
            facts["relationship_development"] = True
        story_choices = [
            {key: value for key, value in choice.items()
             if key in {"npc_id", "counterpart_id", "proposed_state", "choice"}}
            for choice in state.get("relationship_choices", [])
            if choice.get("story_id") == story.id
        ]
        if story_choices:
            facts["relationship_choices"] = story_choices
        expiry_seconds = 10 * 60 + stable_number(story.id, "management-window") % (5 * 60 + 1)
        expiry = story.intervention_expires_at or (now + timedelta(seconds=expiry_seconds))
        presentation_expiry = max(
            story.presentation_expires_at or now,
            expiry,
        )
        return replace(
            story, level="incident" if relationship_actions and story.level == "moment" else story.level,
            status="intervention_window",
            intervention_actions=tuple(dict.fromkeys(actions)),
            auto_resolve_at=max(story.auto_resolve_at, expiry),
            intervention_expires_at=expiry, visible_facts=facts,
            presentation_expires_at=presentation_expiry,
        )

    def _settle_due_stories(self, state: MutableMapping[str, Any],
                            profiles: Mapping[str, Mapping[str, Any]], now: datetime) -> None:
        open_ids = list(state.get("open_story_ids", []))
        remaining: list[str] = []
        for story_id in open_ids:
            record = state["stories"].get(story_id)
            if not record:
                continue
            raw_story = record["story"]
            if raw_story.get("status") in TERMINAL_STORY_STATUSES:
                continue
            auto_resolve_at = raw_story.get("auto_resolve_at")
            if auto_resolve_at and _moment(auto_resolve_at) > now:
                remaining.append(story_id)
                continue
            story = LifeStory.from_dict(raw_story)
            if not record.get("collision") or not record.get("resolution"):
                settlement = settle_story_autonomously(
                    story, collision=None, resolution=None, now=now, existing_thread=None,
                )
                if settlement.changed:
                    record["story"] = settlement.story.to_dict()
                    state["aftermath"] = (list(state.get("aftermath", [])) +
                                          [dict(item) for item in settlement.observable_aftermath])[-120:]
                if settlement.story.status not in TERMINAL_STORY_STATUSES:
                    remaining.append(story_id)
                continue
            collision = _collision_from_dict(record["collision"])
            resolution = _resolution_from_dict(record["resolution"])
            existing = (UnresolvedThread.from_dict(state["threads"][story.thread_id])
                        if story.thread_id and story.thread_id in state["threads"] else None)
            settlement = settle_story_autonomously(story, collision=collision, resolution=resolution,
                                                   now=now, existing_thread=existing)
            if not settlement.changed:
                remaining.append(story_id)
                continue
            record["story"] = settlement.story.to_dict()
            if settlement.thread:
                state["threads"][settlement.thread.id] = settlement.thread.to_dict()
            self._apply_settlement(state, collision, resolution, settlement.story,
                                   settlement.action_instructions, settlement.memory_seeds,
                                   settlement.observable_aftermath, now, profiles)
            if settlement.story.status not in TERMINAL_STORY_STATUSES:
                remaining.append(story_id)
        state["open_story_ids"] = list(dict.fromkeys(remaining))

    def _apply_settlement(self, state: MutableMapping[str, Any], collision: Collision,
                          resolution: CollisionResolution, story: LifeStory,
                          instructions: Mapping[str, str], memories: Sequence[Mapping[str, str]],
                          aftermath: Sequence[Mapping[str, Any]], now: datetime,
                          profiles: Mapping[str, Mapping[str, Any]] | None) -> None:
        by_action = {raw["current_action"]["id"]: raw for raw in state["residents"].values()}
        for action_id, instruction in instructions.items():
            if action_id in by_action:
                by_action[action_id]["pending_instruction"] = instruction
        state["memory_seeds"] = (list(state.get("memory_seeds", [])) +
                                  [dict(item) for item in memories])[-MAX_EVIDENCE:]
        state["aftermath"] = (list(state.get("aftermath", [])) +
                              [dict(item) for item in aftermath])[-120:]
        if collision.scenario_id == "food_stock_shortage" and collision.resource_id:
            self._apply_autonomous_restock(state, collision, story, now)
        self._apply_relationship_evidence(state, collision, resolution, story, now,
                                          profiles or {})

    @staticmethod
    def _apply_autonomous_restock(state: MutableMapping[str, Any], collision: Collision,
                                  story: LifeStory, now: datetime) -> None:
        """Close the food-stock loop without requiring a separate shop action.

        The collision remains observable as a shopping/delivery consequence,
        while the deterministic resource effect prevents a long-running world
        from becoming permanently unable to prepare food.
        """
        resource_rows = list(state.get("resources", []))
        for index, raw in enumerate(resource_rows):
            if raw.get("id") != collision.resource_id:
                continue
            resource = ResourceState.from_dict(raw)
            values = dict(resource.state)
            before = clamp(values.get("stock", 0))
            amount = 60 + stable_number(collision.id, "autonomous-restock") % 26
            values["stock"] = clamp(before + amount)
            values["restocked_at"] = now.isoformat()
            values["restock_source"] = "autonomous_shopping"
            resource_rows[index] = replace(resource, state=values).to_dict()
            state["resources"] = resource_rows
            visible = {
                "kind": "resource_restock", "story_id": story.id,
                "participant_ids": list(story.participant_ids),
                "resource_id": collision.resource_id, "amount": amount,
                "stock_before": before, "stock_after": values["stock"],
                "occurred_at": now.isoformat(),
            }
            state["aftermath"] = (list(state.get("aftermath", [])) + [visible])[-120:]
            record = state.get("stories", {}).get(story.id)
            if isinstance(record, MutableMapping) and isinstance(record.get("story"), MutableMapping):
                facts = dict(record["story"].get("visible_facts") or {})
                facts.update({"restock_amount": amount, "resource_stock": values["stock"]})
                record["story"]["visible_facts"] = facts
            return

    def _apply_relationship_evidence(self, state: MutableMapping[str, Any], collision: Collision,
                                     resolution: CollisionResolution, story: LifeStory,
                                     now: datetime,
                                     profiles: Mapping[str, Mapping[str, Any]]) -> None:
        if len(collision.participant_ids) < 2:
            return
        changes = {(str(item.get("npc_a")), str(item.get("npc_b"))): item
                   for item in resolution.relationship_changes
                   if item.get("npc_a") and item.get("npc_b")}
        evidence_at = story.created_at
        positive_story = "cooperation" in resolution.outcome_tags
        romance_before = "none"
        if len(collision.participant_ids) == 2:
            pair_key = _pair_key(*collision.participant_ids)
            raw_pair = state["relationships"].get(pair_key)
            if raw_pair:
                pair = self.relationships.decay_to(RelationshipPair.from_dict(raw_pair), evidence_at)
                state["relationships"][pair_key] = pair.to_dict()
                romance_before = pair.channels.romance
        for owner in collision.participant_ids:
            target = next((item for item in collision.participant_ids if item != owner), None)
            if not target:
                continue
            raw_change = changes.get((owner, target), {})
            negative = (sum(int(raw_change.get(key, 0)) for key in ("tension", "resentment", "fear"))
                        - sum(int(raw_change.get(key, 0)) for key in ("trust", "affinity", "comfort", "respect")))
            if "competition" in resolution.outcome_tags:
                kind = "unfair_competition" if negative > 1 else "fair_competition"
                appraisal = (Appraisal("hostile", .8, -.65, .9) if negative > 1 else
                             Appraisal("beneficial", .85, .8, .9))
            elif negative > 1 or (not raw_change and "conflict" in resolution.outcome_tags):
                kind = ("boundary_violation" if collision.kind == "person_boundary" else
                        "neglect" if collision.kind == "person_responsibility" else
                        "hostile_act" if max(collision.severity, resolution.severity_after) >= 68
                        else "conflict")
                appraisal = Appraisal("careless", .75, -.35, .9,
                                      .8 if collision.kind == "person_boundary" else 0)
            else:
                kind = ("boundary_respected" if collision.kind == "person_boundary" else
                        "received_help" if collision.kind == "person_responsibility" else
                        "shared_positive_experience")
                appraisal = Appraisal("beneficial", .8, .35, .9, 0)
            magnitude = min(.95, max(.25, collision.severity / 100,
                                     max((abs(int(value)) for key, value in raw_change.items()
                                          if key not in {"npc_a", "npc_b"}), default=0) / 8))
            self._apply_evidence(state, RelationshipEvidence(
                evidence_id=stable_id("evidence", story.id, resolution.id, owner, target, kind),
                owner_id=owner, target_id=target, kind=cast(Any, kind), magnitude=magnitude,
                occurred_at=evidence_at, appraisal=appraisal, source_event_id=story.id,
                thread_id=story.thread_id,
            ))
        if (positive_story and len(collision.participant_ids) == 2
                and self._romance_pair_eligible(state, profiles, *collision.participant_ids)):
            a, b = collision.participant_ids
            shared_interests = set(_profile_interests(profiles.get(a, {}))) & set(
                _profile_interests(profiles.get(b, {}))
            )
            pair = RelationshipPair.from_dict(state["relationships"][_pair_key(a, b)])
            for owner, target in ((a, b), (b, a)):
                edge = pair.edge(owner, target)
                spark_chance = min(
                    .18, .08 + min(.06, len(shared_interests) * .03)
                    + (.025 if edge.affinity >= 60 and edge.trust >= 55 else 0),
                )
                if stable_fraction(story.id, owner, target, "romantic-spark") >= spark_chance:
                    continue
                self._apply_evidence(state, RelationshipEvidence(
                    evidence_id=stable_id("evidence", story.id, resolution.id, owner, target,
                                          "romantic-interest"),
                    owner_id=owner, target_id=target, kind="romantic_interest", magnitude=1,
                    occurred_at=evidence_at, appraisal=Appraisal("beneficial", 1, .25, .85),
                    source_event_id=story.id, thread_id=story.thread_id,
                ))
        if (len(collision.participant_ids) == 2
                and ("conflict" in resolution.outcome_tags
                     or romance_before in {"mutual_interest", "dating", "partner"})):
            self._maybe_romance_transition(
                state, profiles, collision.participant_ids, story.id, now,
                conflict="conflict" in resolution.outcome_tags,
            )

    def _apply_evidence(self, state: MutableMapping[str, Any], evidence: RelationshipEvidence) -> None:
        key = _pair_key(evidence.owner_id, evidence.target_id)
        if key not in state["relationships"]:
            return
        pair = RelationshipPair.from_dict(state["relationships"][key])
        update = self.relationships.apply(pair, evidence)
        state["relationships"][key] = update.state.to_dict()
        if update.applied:
            state["relationship_evidence"].append({
                "id": evidence.evidence_id, "fact_id": evidence.source_event_id or evidence.evidence_id,
                "source_npc_id": evidence.owner_id, "target_npc_id": evidence.target_id,
                "kind": evidence.kind, "magnitude": evidence.magnitude,
                "appraisal": {"perceived_intent": evidence.appraisal.perceived_intent,
                              "responsibility": evidence.appraisal.responsibility,
                              "fairness": evidence.appraisal.fairness,
                              "confidence": evidence.appraisal.confidence,
                              "boundary_impact": evidence.appraisal.boundary_impact},
                "deltas": dict(update.deltas), "thread_id": evidence.thread_id,
                "created_at": evidence.occurred_at.isoformat(), "rules_version": WORLD_RULES_VERSION,
            })
            state["relationship_evidence"] = state["relationship_evidence"][-MAX_EVIDENCE:]

    # Explicit relationship transitions -----------------------------

    @staticmethod
    def _romance_choice(pair: RelationshipPair, npc_id: str, target: str,
                        source_id: str) -> str:
        """Return an explicit, replay-stable resident choice for a romance step.

        Score thresholds only decide whether the proposal is plausible.  The
        transition itself is owned by these discrete choices and therefore can
        represent hesitation or refusal without silently converting a score
        into consent.
        """
        other_id = pair.resident_b_id if npc_id == pair.resident_a_id else pair.resident_a_id
        edge = pair.edge(npc_id, other_id)
        if not LifeWorldEngine._consents(pair, npc_id, target):
            return "refuse"
        if target == "dating":
            readiness = (edge.attraction * .34 + edge.trust * .27 + edge.affinity * .22
                         + edge.comfort * .17 - edge.tension * .22)
        else:
            readiness = (edge.trust * .34 + edge.comfort * .27 + edge.affinity * .20
                         + edge.attraction * .19 - edge.tension * .26)
        # Very strong readiness is still recorded as a choice; this branch
        # simply keeps established, healthy pairs from behaving capriciously.
        if readiness >= 68:
            return "accept"
        roll = stable_fraction(source_id, pair.pair_key, npc_id, target, "resident-choice")
        accept_chance = max(.30, min(.72, .42 + (readiness - 45) / 90))
        if roll < accept_chance:
            return "accept"
        if roll < min(.92, accept_chance + .22):
            return "hesitate"
        return "refuse"

    def _ensure_romance_choices(self, state: MutableMapping[str, Any], pair: RelationshipPair,
                                participants: Sequence[str], source_id: str, target: str,
                                now: datetime) -> list[dict[str, Any]]:
        expected_ids = {
            npc_id: stable_id("relationship-choice", source_id, pair.pair_key, npc_id, target)
            for npc_id in participants
        }
        choices = state.setdefault("relationship_choices", [])
        by_id = {str(value.get("id")): value for value in choices}
        result: list[dict[str, Any]] = []
        for npc_id in participants:
            choice_id = expected_ids[npc_id]
            existing = by_id.get(choice_id)
            if existing is None:
                other_id = next(value for value in participants if value != npc_id)
                existing = {
                    "id": choice_id, "story_id": source_id, "npc_id": npc_id,
                    "counterpart_id": other_id, "channel": "romance",
                    "proposed_state": target,
                    "choice": self._romance_choice(pair, npc_id, target, source_id),
                    "decided_at": now.isoformat(), "basis": "resident_autonomy",
                }
                choices.append(existing)
            result.append(existing)
        state["relationship_choices"] = choices[-MAX_RELATIONSHIP_CHOICES:]
        record = state.get("stories", {}).get(source_id)
        if isinstance(record, MutableMapping) and isinstance(record.get("story"), MutableMapping):
            facts = dict(record["story"].get("visible_facts") or {})
            facts["relationship_choices"] = [
                {key: value for key, value in choice.items()
                 if key in {"npc_id", "counterpart_id", "proposed_state", "choice"}}
                for choice in result
            ]
            record["story"]["visible_facts"] = facts
        return result

    @staticmethod
    def _romance_enabled(profile: Mapping[str, Any]) -> bool:
        age = profile.get("age")
        enabled = profile.get("romanceEnabled", profile.get("romance_enabled", False))
        boundaries = {str(item).casefold() for item in profile.get("relationshipBoundaries", [])}
        return isinstance(age, int) and not isinstance(age, bool) and age >= 18 and bool(enabled) \
            and not ({"no_romance", "no-romance", "aromantic"} & boundaries)

    @classmethod
    def _relationship_policy(cls, profile: Mapping[str, Any]) -> dict[str, Any]:
        """Persist only rule gates needed when an intervention has no profile input."""
        age = profile.get("age")
        return {
            "adult": isinstance(age, int) and not isinstance(age, bool) and age >= 18,
            "romance_enabled": cls._romance_enabled(profile),
            "family_ids": list(_list(profile.get("family_ids") or profile.get("familyIds"))),
        }

    def _romance_pair_eligible(self, state: Mapping[str, Any],
                               profiles: Mapping[str, Mapping[str, Any]], a: str, b: str) -> bool:
        if not self._romance_enabled(profiles.get(a, {})) or not self._romance_enabled(profiles.get(b, {})):
            return False
        raw = state["relationships"].get(_pair_key(a, b))
        if not raw:
            return False
        pair = RelationshipPair.from_dict(raw)
        return not any(bond.active and bond.kind == "family" for bond in pair.structural_bonds)

    @staticmethod
    def _consents(pair: RelationshipPair, npc_id: str, relationship_state: str) -> bool:
        other_id = (pair.resident_b_id if npc_id == pair.resident_a_id else pair.resident_a_id)
        edge = pair.edge(npc_id, other_id)
        if relationship_state == "dating":
            return edge.attraction >= 45 and edge.trust >= 40 and edge.affinity >= 45 and edge.tension < 65
        if relationship_state == "partner":
            return edge.attraction >= 45 and edge.trust >= 60 and edge.comfort >= 55 and edge.tension < 45
        return edge.tension >= 35 or edge.resentment >= 30

    def _maybe_romance_transition(self, state: MutableMapping[str, Any],
                                  profiles: Mapping[str, Mapping[str, Any]],
                                  participants: Sequence[str], source_id: str, now: datetime,
                                  *, conflict: bool = False) -> None:
        if len(participants) != 2:
            return
        a, b = participants
        if not self._romance_pair_eligible(state, profiles, a, b):
            return
        key = _pair_key(a, b)
        pair = RelationshipPair.from_dict(state["relationships"][key])
        target = ("separated" if conflict and pair.channels.romance in {"dating", "partner"}
                  and any(self._consents(pair, npc, "separated") for npc in (a, b)) else
                  "dating" if pair.channels.romance == "mutual_interest" else
                  "partner" if pair.channels.romance == "dating" else None)
        if not target or (target != "separated" and
                          not all(self._consents(pair, npc, target) for npc in (a, b))):
            return
        if target in {"dating", "partner"}:
            choices = self._ensure_romance_choices(
                state, pair, (a, b), source_id, target, now,
            )
            if not all(value["choice"] == "accept" for value in choices):
                return
        # Dating can happen naturally; partnership needs repeated evidence and
        # is intentionally much less frequent.
        chance = .28 if target == "dating" else .08 if target == "partner" else .24
        if stable_fraction(source_id, key, target) >= chance:
            return
        transition = RelationshipTransition(
            stable_id("relationship-transition", source_id, key, target), "romance", target,
            source_id, a, frozenset((a, b)),
        )
        state["relationships"][key] = self.relationships.transition(pair, transition).state.to_dict()
        record = state.get("stories", {}).get(source_id)
        if isinstance(record, MutableMapping) and isinstance(record.get("story"), MutableMapping):
            facts = dict(record["story"].get("visible_facts") or {})
            facts["relationship_state"] = target
            record["story"]["visible_facts"] = facts
            action_for_target = {"dating": "start_dating", "partner": "become_partners"}.get(target)
            if action_for_target:
                record["story"]["intervention_actions"] = [
                    value for value in record["story"].get("intervention_actions", [])
                    if value != action_for_target
                ]
        state["aftermath"] = (list(state.get("aftermath", [])) + [{
            "kind": "relationship_transition", "story_id": source_id,
            "participant_ids": [a, b], "channel": "romance", "state": target,
            "occurred_at": now.isoformat(),
        }])[-120:]

    def _apply_romance_transition(self, state: MutableMapping[str, Any], story: LifeStory,
                                  action: str, now: datetime) -> str:
        if len(story.participant_ids) != 2:
            raise ValueError("romance transitions require exactly two resident participants")
        a, b = story.participant_ids
        key = _pair_key(a, b)
        pair = RelationshipPair.from_dict(state["relationships"][key])
        policies = [state["residents"][npc].get("relationship_policy", {}) for npc in (a, b)]
        if not all(policy.get("adult") and policy.get("romance_enabled") for policy in policies):
            raise ValueError("romance requires two adults with romance enabled")
        if any(bond.active and bond.kind == "family" for bond in pair.structural_bonds):
            raise ValueError("family relationships are not romance-eligible")
        target = {"start_dating": "dating", "become_partners": "partner", "separate": "separated"}[action]
        if target in {"dating", "partner"} and not all(self._consents(pair, npc, target) for npc in (a, b)):
            raise ValueError(f"both residents must consent to {target}")
        if target == "separated" and not any(self._consents(pair, npc, "separated") for npc in (a, b)):
            raise ValueError("at least one resident must want the separation")
        if target in {"dating", "partner"}:
            choices = [
                value for value in state.get("relationship_choices", [])
                if value.get("story_id") == story.id and value.get("proposed_state") == target
                and value.get("npc_id") in {a, b}
            ]
            accepted = {str(value.get("npc_id")) for value in choices
                        if value.get("choice") == "accept"}
            if accepted != {a, b}:
                raise ValueError(f"{target} requires both residents' explicit accept choices")
        consenting = (frozenset((a, b)) if target != "separated" else
                      frozenset(npc for npc in (a, b) if self._consents(pair, npc, "separated")))
        transition = RelationshipTransition(
            stable_id("relationship-transition", story.id, action), "romance", target,
            story.id, a, consenting,
        )
        state["relationships"][key] = self.relationships.transition(pair, transition).state.to_dict()
        return target

    def _maybe_apply_managed_truce(self, state: MutableMapping[str, Any], story: LifeStory,
                                   action: str, acceptance: Mapping[str, Any],
                                   now: datetime) -> None:
        """Let mutually accepted mediation end an otherwise sticky feud."""
        if action != "mediate" or len(story.participant_ids) != 2:
            return
        a, b = story.participant_ids
        if {npc_id for npc_id, reaction in acceptance.items() if reaction == "accept"} != {a, b}:
            return
        key = _pair_key(a, b)
        raw = state.get("relationships", {}).get(key)
        if not raw:
            return
        pair = RelationshipPair.from_dict(raw)
        if pair.channels.conflict not in {"friction", "open_conflict", "feud"}:
            return
        transition = RelationshipTransition(
            stable_id("relationship-transition", story.id, action, "truce"),
            "conflict", "truce", story.id, a, frozenset((a, b)),
        )
        state["relationships"][key] = self.relationships.transition(pair, transition).state.to_dict()
        state["aftermath"] = (list(state.get("aftermath", [])) + [{
            "kind": "relationship_transition", "story_id": story.id,
            "participant_ids": [a, b], "channel": "conflict", "state": "truce",
            "occurred_at": now.isoformat(),
        }])[-120:]
        record = state.get("stories", {}).get(story.id)
        if isinstance(record, MutableMapping) and isinstance(record.get("story"), MutableMapping):
            facts = dict(record["story"].get("visible_facts") or {})
            facts["conflict_state"] = "truce"
            record["story"]["visible_facts"] = facts

    def _participant_acceptance(self, state: Mapping[str, Any], story: LifeStory,
                                action: str) -> dict[str, Any]:
        result = {}
        topic = str(story.visible_facts.get("topic") or "")
        mismatch = (
            (topic in {"privacy", "borrowed_property", "noise"}
             and action in {"comfort", "invite_talk"})
            or (topic in {"dishwashing", "unequal_care", "shared_kitchen", "bathroom_access"}
                and action == "give_space")
            or (topic in {"companionship", "missed_connection"} and action == "set_boundary")
        )
        for npc_id in story.participant_ids:
            trust, affinity, tension, resentment = 50, 50, 5, 0
            others = [item for item in story.participant_ids if item != npc_id]
            if others:
                pair = RelationshipPair.from_dict(state["relationships"][_pair_key(npc_id, others[0])])
                edge = pair.edge(npc_id, others[0])
                trust, affinity = edge.trust, edge.affinity
                tension, resentment = edge.tension, edge.resentment
            variation = stable_fraction(story.id, action, npc_id)
            backfire_risk = ((100 - trust) * .32 + tension * .38 + resentment * .28
                             + (18 if mismatch else 0) + variation * 16)
            if backfire_risk >= 72:
                result[npc_id] = "backfire"
                continue
            score = trust * .62 + affinity * .18 - tension * .22 - resentment * .16 \
                + variation * 32 - (10 if mismatch else 0)
            result[npc_id] = ("accept" if score >= 48 else "accept_later"
                              if score >= 34 else "refuse")
        return result

    # State hygiene --------------------------------------------------

    @staticmethod
    def _has_due_transition(state: Mapping[str, Any], moment: datetime) -> bool:
        for raw in state["residents"].values():
            action = LifeAction.from_dict(raw["current_action"])
            if action.status in {"planned", "retrying"}:
                return True
            if action.status == "traveling" and action.arrives_at and action.arrives_at <= moment:
                return True
            if action.status == "performing" and action.ends_at and action.ends_at <= moment:
                return True
            if action.status == "blocked" and action.retry_at and action.retry_at <= moment:
                return True
        for story_id in state.get("open_story_ids", []):
            record = state["stories"].get(story_id)
            if not record:
                continue
            raw_story = record["story"]
            if (raw_story.get("status") not in TERMINAL_STORY_STATUSES
                    and _moment(raw_story.get("auto_resolve_at")) <= moment):
                return True
        for raw in state["resources"]:
            resource = ResourceState.from_dict(raw)
            if any(value.expires_at and value.expires_at <= moment for value in resource.reservations):
                return True
        return False

    @classmethod
    def _next_transition_moment(cls, state: Mapping[str, Any], after: datetime) -> datetime | None:
        if cls._has_due_transition(state, after):
            return after
        candidates: list[datetime] = []
        for raw in state["residents"].values():
            action = LifeAction.from_dict(raw["current_action"])
            for value in (action.arrives_at if action.status == "traveling" else None,
                          action.ends_at if action.status == "performing" else None,
                          action.retry_at if action.status == "blocked" else None):
                if value and value > after:
                    candidates.append(value)
        for story_id in state.get("open_story_ids", []):
            record = state["stories"].get(story_id)
            if not record:
                continue
            raw_story = record["story"]
            if raw_story.get("status") in TERMINAL_STORY_STATUSES:
                continue
            auto_resolve_at = _moment(raw_story.get("auto_resolve_at"))
            if auto_resolve_at > after:
                candidates.append(auto_resolve_at)
        for raw in state["resources"]:
            resource = ResourceState.from_dict(raw)
            candidates.extend(value.expires_at for value in resource.reservations
                              if value.expires_at and value.expires_at > after)
        return min(candidates) if candidates else None

    @staticmethod
    def _next_transition(state: Mapping[str, Any], now: datetime) -> str | None:
        candidate = LifeWorldEngine._next_transition_moment(state, now)
        return candidate.isoformat() if candidate and candidate > now else None

    @staticmethod
    def _trim(state: MutableMapping[str, Any], *, force: bool = False) -> None:
        state["processed_collision_ids"] = state["processed_collision_ids"][-MAX_PROCESSED_IDS:]
        state["processed_action_effect_ids"] = state["processed_action_effect_ids"][-MAX_PROCESSED_IDS:]
        state["processed_player_interaction_ids"] = state.get("processed_player_interaction_ids", [])[-MAX_PROCESSED_IDS:]
        state["active_collision_fact_ids"] = state.get("active_collision_fact_ids", [])[-MAX_PROCESSED_IDS:]
        state["open_story_ids"] = [
            story_id for story_id in state.get("open_story_ids", [])
            if story_id in state["stories"]
            and state["stories"][story_id]["story"].get("status") not in TERMINAL_STORY_STATUSES
        ]
        cooldowns = state.get("collision_cooldowns", {})
        if len(cooldowns) > MAX_COLLISION_COOLDOWNS:
            ordered_cooldowns = sorted(cooldowns.items(), key=lambda item: item[1], reverse=True)
            state["collision_cooldowns"] = dict(ordered_cooldowns[:MAX_COLLISION_COOLDOWNS])
        interventions = state.get("interventions", {})
        if len(interventions) > MAX_INTERVENTIONS:
            ordered_interventions = sorted(
                interventions.items(), key=lambda item: item[1].get("applied_at", ""), reverse=True,
            )
            state["interventions"] = dict(ordered_interventions[:MAX_INTERVENTIONS])
        state["relationship_choices"] = state.get("relationship_choices", [])[-MAX_RELATIONSHIP_CHOICES:]
        state["responsibilities"] = state["responsibilities"][-300:]
        # Compact in batches during simulation; sorting the entire history for
        # every newly completed action dominates long offline catch-up time.
        if len(state["stories"]) > MAX_STORIES and (force or len(state["stories"]) > MAX_STORIES + 40):
            ordered = sorted(state["stories"].items(),
                             key=lambda item: item[1]["story"].get("updated_at", ""), reverse=True)
            keep = dict(ordered[:MAX_STORIES])
            # Open stories are never evicted by summary compaction.
            keep.update({key: value for key, value in state["stories"].items()
                         if value["story"].get("status") not in TERMINAL_STORY_STATUSES})
            state["stories"] = keep

    def _validate_and_copy(self, state: Mapping[str, Any]) -> dict[str, Any]:
        result = _json_copy(state)
        if int(result.get("schema_version", 0)) != WORLD_SCHEMA_VERSION:
            raise ValueError("unsupported life world schema version")
        if result.get("rules_version") != WORLD_RULES_VERSION:
            raise ValueError("unsupported life world rules version")
        if not result.get("player_id"):
            raise ValueError("world state has no player_id")
        result.setdefault("simulation_cursor_at", result.get("last_advanced_at"))
        result.setdefault("active_collision_fact_ids", [])
        result.setdefault("collision_cooldowns", {})
        result.setdefault("relationship_choices", [])
        result.setdefault("open_story_ids", [
            story_id for story_id, record in result.get("stories", {}).items()
            if record.get("story", {}).get("status") not in TERMINAL_STORY_STATUSES
        ])
        for npc_id, resident in result.get("residents", {}).items():
            if not isinstance(resident.get("current_action"), Mapping):
                raise ValueError(f"resident {npc_id} has no current_action")
            LifeAction.from_dict(resident["current_action"])
        return result

    @staticmethod
    def _ready(value: Mapping[str, Any]) -> dict[str, Any]:
        return cast(dict[str, Any], json.loads(json.dumps(value, ensure_ascii=False)))
