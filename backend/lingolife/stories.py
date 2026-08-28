"""Emergent story classification and autonomous settlement primitives.

Ambient actions, moments, incidents, and longer threads all originate from
rule-owned action/collision facts.  Observation is deliberately separate from
settlement: opening a story may mark it seen, but never decides its outcome.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field, replace
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Mapping, Sequence, cast

from .collisions import Collision, CollisionResolution
from .life import LifeAction, action_visible_intent, clamp, stable_id, stable_number


STORY_RULES_VERSION = "story-rules-v1"
MOMENT_PRESENTATION_TTL_SECONDS = 180
INCIDENT_INTERVENTION_MIN_SECONDS = 10 * 60
INCIDENT_INTERVENTION_MAX_SECONDS = 15 * 60
StoryLevel = Literal["ambient", "moment", "incident", "thread"]
StoryStatus = Literal[
    "open", "intervention_window", "resolved_autonomously",
    "resolved_with_management", "archived",
]
ThreadStatus = Literal[
    "unspoken", "raised", "escalated", "temporarily_settled", "resolved", "dormant",
]
TERMINAL_STORY_STATUSES = frozenset({"resolved_autonomously", "resolved_with_management", "archived"})


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _parse_time(value: str | datetime | None) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return _utc(value)
    try:
        return _utc(datetime.fromisoformat(value.replace("Z", "+00:00")))
    except (TypeError, ValueError):
        return None


@dataclass(frozen=True)
class StoryContext:
    novelty: int = 50
    personality_expression: int = 50
    relationship_relevance: int = 35
    visual_readability: int = 55
    player_context_relevance: int = 25
    recent_repetition: int = 0
    need_stakes: int = 30
    unresolved_thread_pressure: int = 0
    goal_impact: int = 0
    household_impact: int = 25
    safe_autonomous_capacity: int = 50
    recurrence_count: int = 0
    disclosure_allowed: bool = True
    existing_thread_id: str | None = None
    existing_thread_intensity: int = 0


@dataclass(frozen=True)
class StoryClassification:
    level: StoryLevel
    moment_score: int
    incident_score: int
    reasons: tuple[str, ...]


def classify_story(collision: Collision, resolution: CollisionResolution,
                   context: StoryContext | None = None) -> StoryClassification:
    value = context or StoryContext()
    moment_score = clamp(
        value.novelty * .20 + value.personality_expression * .20
        + value.relationship_relevance * .18 + value.visual_readability * .22
        + value.player_context_relevance * .10 + collision.severity * .20
        - value.recent_repetition * .25,
    )
    conflict_bonus = 18 if "conflict" in resolution.outcome_tags else 0
    incident_score = clamp(
        value.need_stakes * .17 + collision.severity * .30
        + max(collision.severity, resolution.severity_after) * .12
        + value.unresolved_thread_pressure * .16 + value.goal_impact * .10
        + value.household_impact * .12 + conflict_bonus
        - value.safe_autonomous_capacity * .12,
    )
    reasons: list[str] = []
    if value.existing_thread_id and (value.recurrence_count >= 2 or value.existing_thread_intensity >= 55):
        level: StoryLevel = "thread"
        reasons.append("existing_thread_advanced")
    elif value.recurrence_count >= 3 and collision.thread_key:
        level = "thread"
        reasons.append("recurring_pattern")
    elif incident_score >= 48 or resolution.requires_intervention:
        level = "incident"
        reasons.append("meaningful_consequence")
    elif moment_score >= 34:
        level = "moment"
        reasons.append("observable_character_moment")
    else:
        level = "ambient"
        reasons.append("ordinary_life")
    if "conflict" in resolution.outcome_tags:
        reasons.append("relationship_friction")
    if collision.thread_key:
        reasons.append("thread_candidate")
    return StoryClassification(level, moment_score, incident_score, tuple(reasons))


@dataclass(frozen=True)
class LifeStory:
    id: str
    story_key: str
    level: StoryLevel
    status: StoryStatus
    title_key: str
    participant_ids: tuple[str, ...]
    collision_ids: tuple[str, ...]
    location_id: str | None
    thread_id: str | None
    observable: bool
    trouble_signal: bool
    intervention_actions: tuple[str, ...]
    created_at: datetime
    updated_at: datetime
    auto_resolve_at: datetime
    intervention_expires_at: datetime | None
    observed_at: datetime | None
    resolution_id: str | None
    visible_facts: Mapping[str, Any]
    classification: StoryClassification
    rules_version: str = STORY_RULES_VERSION
    presentation_expires_at: datetime | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id, "story_key": self.story_key, "level": self.level,
            "status": self.status, "title_key": self.title_key,
            "participant_ids": list(self.participant_ids),
            "collision_ids": list(self.collision_ids), "location_id": self.location_id,
            "thread_id": self.thread_id, "observable": self.observable,
            "trouble_signal": self.trouble_signal,
            "intervention_actions": list(self.intervention_actions),
            "created_at": self.created_at.isoformat(), "updated_at": self.updated_at.isoformat(),
            "auto_resolve_at": self.auto_resolve_at.isoformat(),
            "intervention_expires_at": (self.intervention_expires_at.isoformat()
                                         if self.intervention_expires_at else None),
            "observed_at": self.observed_at.isoformat() if self.observed_at else None,
            "presentation_expires_at": (self.presentation_expires_at.isoformat()
                                         if self.presentation_expires_at else None),
            "resolution_id": self.resolution_id, "visible_facts": dict(self.visible_facts),
            "classification": asdict(self.classification), "rules_version": self.rules_version,
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "LifeStory":
        classification = value.get("classification", {})
        return cls(
            str(value["id"]), str(value["story_key"]), cast(StoryLevel, value["level"]),
            cast(StoryStatus, value["status"]), str(value["title_key"]),
            tuple(str(item) for item in value.get("participant_ids", [])),
            tuple(str(item) for item in value.get("collision_ids", [])),
            value.get("location_id"), value.get("thread_id"), bool(value.get("observable", True)),
            bool(value.get("trouble_signal", False)),
            tuple(str(item) for item in value.get("intervention_actions", [])),
            _parse_time(value.get("created_at")) or datetime.fromtimestamp(0, timezone.utc),
            _parse_time(value.get("updated_at")) or datetime.fromtimestamp(0, timezone.utc),
            _parse_time(value.get("auto_resolve_at")) or datetime.fromtimestamp(0, timezone.utc),
            _parse_time(value.get("intervention_expires_at")), _parse_time(value.get("observed_at")),
            value.get("resolution_id"), dict(value.get("visible_facts", {})),
            StoryClassification(cast(StoryLevel, classification.get("level", value["level"])),
                                int(classification.get("moment_score", 0)),
                                int(classification.get("incident_score", 0)),
                                tuple(classification.get("reasons", []))),
            str(value.get("rules_version", STORY_RULES_VERSION)),
            _parse_time(value.get("presentation_expires_at")),
        )

    def is_presentable(self, *, now: datetime) -> bool:
        """Return presentation availability independently of settlement.

        An unobserved moment is retained until the player has had a chance to
        see it.  Once observed, it may leave the live surface only after its
        minimum TTL; it remains in history either way.
        """
        if not self.observable:
            return False
        if self.observed_at is None:
            return True
        return self.presentation_expires_at is None or _utc(now) < self.presentation_expires_at


@dataclass(frozen=True)
class UnresolvedThread:
    id: str
    kind: str
    topic: str
    participant_ids: tuple[str, ...]
    source_story_ids: tuple[str, ...]
    intensity: int
    recurrence_count: int
    status: ThreadStatus
    perspectives: Mapping[str, str]
    created_at: datetime
    updated_at: datetime
    last_evidence_at: datetime
    rules_version: str = STORY_RULES_VERSION

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id, "kind": self.kind, "topic": self.topic,
            "participant_ids": list(self.participant_ids),
            "source_story_ids": list(self.source_story_ids), "intensity": self.intensity,
            "recurrence_count": self.recurrence_count, "status": self.status,
            "perspectives": dict(self.perspectives), "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "last_evidence_at": self.last_evidence_at.isoformat(),
            "rules_version": self.rules_version,
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "UnresolvedThread":
        epoch = datetime.fromtimestamp(0, timezone.utc)
        return cls(
            str(value["id"]), str(value["kind"]), str(value["topic"]),
            tuple(str(item) for item in value.get("participant_ids", [])),
            tuple(str(item) for item in value.get("source_story_ids", [])),
            clamp(value.get("intensity", 0)), int(value.get("recurrence_count", 0)),
            cast(ThreadStatus, value.get("status", "unspoken")),
            dict(value.get("perspectives", {})), _parse_time(value.get("created_at")) or epoch,
            _parse_time(value.get("updated_at")) or epoch,
            _parse_time(value.get("last_evidence_at")) or epoch,
            str(value.get("rules_version", STORY_RULES_VERSION)),
        )


@dataclass(frozen=True)
class StorySettlement:
    story: LifeStory
    changed: bool
    mode: Literal["autonomous", "managed", "pending"]
    relationship_changes: tuple[Mapping[str, Any], ...] = ()
    action_instructions: Mapping[str, str] = field(default_factory=dict)
    memory_seeds: tuple[Mapping[str, str], ...] = ()
    thread: UnresolvedThread | None = None
    observable_aftermath: tuple[Mapping[str, Any], ...] = ()
    outcome_tags: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "story": self.story.to_dict(), "changed": self.changed, "mode": self.mode,
            "relationship_changes": [dict(value) for value in self.relationship_changes],
            "action_instructions": dict(self.action_instructions),
            "memory_seeds": [dict(value) for value in self.memory_seeds],
            "thread": self.thread.to_dict() if self.thread else None,
            "observable_aftermath": [dict(value) for value in self.observable_aftermath],
            "outcome_tags": list(self.outcome_tags),
        }


def story_from_action(action: LifeAction, *, now: datetime | None = None,
                      observable: bool = True) -> LifeStory:
    """Represent one ordinary action without promoting it into an event list."""
    moment = _utc(now or action.started_at or action.planned_at)
    story_id = stable_id("story", action.id, "ambient", rules_version=action.rules_version)
    classification = StoryClassification("ambient", 0, 0, ("ordinary_life",))
    return LifeStory(
        story_id, action.id, "ambient", "open", f"action.{action.action_type}",
        (action.npc_id,), (), action.location_id, None, observable, False, (), moment, moment,
        action.ends_at or moment, None, None, None,
        {"action_id": action.id, "action_type": action.action_type,
         "visible_intent": action_visible_intent(action), "animation_cue": action.animation_cue},
        classification, action.rules_version, action.ends_at or moment,
    )


def story_from_collision(collision: Collision, resolution: CollisionResolution, *,
                         context: StoryContext | None = None, now: datetime | None = None,
                         intervention_seconds: int | None = None) -> LifeStory:
    if intervention_seconds is None:
        span = INCIDENT_INTERVENTION_MAX_SECONDS - INCIDENT_INTERVENTION_MIN_SECONDS
        intervention_seconds = INCIDENT_INTERVENTION_MIN_SECONDS + stable_number(
            collision.id, "intervention-window", rules_version=collision.rules_version,
        ) % (span + 1)
    if intervention_seconds < 15 or intervention_seconds > 86400:
        raise ValueError("intervention_seconds must be between 15 and 86400")
    story_context = context or StoryContext()
    classification = classify_story(collision, resolution, story_context)
    moment = _utc(now or collision.occurred_at)
    requires_window = classification.level in {"incident", "thread"} and resolution.requires_intervention
    status: StoryStatus = "intervention_window" if requires_window else "open"
    expiry = moment + timedelta(seconds=intervention_seconds) if requires_window else None
    # Settlement and presentation are separate clocks.  Moments can apply
    # deterministic consequences immediately while remaining visible long
    # enough for a player to notice or observe them.
    auto_delay = (intervention_seconds if requires_window else
                  30 if classification.level in {"incident", "thread"} else 0)
    auto_resolve_at = moment + timedelta(seconds=auto_delay)
    presentation_expires_at = moment + timedelta(
        seconds=max(MOMENT_PRESENTATION_TTL_SECONDS, auto_delay)
    )
    thread_id = story_context.existing_thread_id or collision.thread_key
    story_key = stable_id("story-key", collision.id, rules_version=collision.rules_version)
    story_id = stable_id("story", story_key, classification.level, rules_version=collision.rules_version)
    observable = classification.level != "ambient"
    trouble = bool(story_context.disclosure_allowed and requires_window)
    actions = ("ask", "comfort", "advise", "mediate", "give_space", "let_them_handle_it") if requires_window else ()
    visible = {
        "topic": collision.topic, "trigger": collision.trigger,
        "severity_band": "high" if collision.severity >= 65 else "medium" if collision.severity >= 35 else "low",
        "resource_id": collision.resource_id, "response_preview": dict(resolution.response_by_participant),
    }
    return LifeStory(
        story_id, story_key, classification.level, status, f"collision.{collision.scenario_id}",
        collision.participant_ids, (collision.id,), collision.location_id, thread_id,
        observable, trouble, actions, moment, moment, auto_resolve_at, expiry,
        None, None, visible, classification, collision.rules_version,
        presentation_expires_at,
    )


def observe_story(story: LifeStory, *, observed_at: datetime) -> LifeStory:
    """Mark presentation state only; observation never changes the outcome."""
    if story.observed_at is not None:
        return story
    moment = _utc(observed_at)
    return replace(story, observed_at=moment, updated_at=max(story.updated_at, moment))


def _perspectives(resolution: CollisionResolution) -> dict[str, str]:
    result = {}
    for seed in resolution.memory_seeds:
        npc_id = seed.get("npc_id")
        content = seed.get("content_seed")
        if npc_id and content:
            result[str(npc_id)] = str(content)
    return result


def update_unresolved_thread(existing: UnresolvedThread | None, *, story: LifeStory,
                             collision: Collision, resolution: CollisionResolution,
                             now: datetime) -> UnresolvedThread | None:
    """Create/advance a thread only when repeated or consequential evidence exists."""
    if not collision.thread_key:
        return existing
    conflict = "conflict" in resolution.outcome_tags
    consequential = conflict or collision.severity >= 42 or story.level == "thread"
    if existing is None and not consequential:
        return None
    moment = _utc(now)
    if existing is None:
        intensity = clamp(max(collision.severity, resolution.severity_after))
        status: ThreadStatus = "escalated" if intensity >= 70 else "unspoken"
        return UnresolvedThread(
            collision.thread_key, "conflict" if conflict else "relationship_pattern",
            collision.topic, collision.participant_ids, (story.id,), intensity, 1,
            status, _perspectives(resolution), moment, moment, moment, collision.rules_version,
        )
    source_ids = tuple(dict.fromkeys((*existing.source_story_ids, story.id)))
    duplicate = story.id in existing.source_story_ids
    if duplicate:
        return existing
    recurrence = existing.recurrence_count + (0 if duplicate else 1)
    delta = 0 if duplicate else (8 if conflict else 3)
    if resolution.severity_after + 10 < resolution.severity_before:
        delta -= 7
    intensity = clamp(existing.intensity + delta)
    if intensity >= 70 or recurrence >= 4:
        status = "escalated"
    elif delta < 0:
        status = "temporarily_settled"
    elif existing.status in {"resolved", "dormant"}:
        status = "raised"
    else:
        status = existing.status
    perspectives = dict(existing.perspectives)
    perspectives.update(_perspectives(resolution))
    return replace(existing, source_story_ids=source_ids, recurrence_count=recurrence,
                   intensity=intensity, status=cast(ThreadStatus, status), perspectives=perspectives,
                   updated_at=moment, last_evidence_at=moment)


def settle_story_autonomously(story: LifeStory, *, collision: Collision | None,
                              resolution: CollisionResolution | None, now: datetime,
                              existing_thread: UnresolvedThread | None = None) -> StorySettlement:
    """Settle when the rule-owned deadline passes; repeated calls return no effects."""
    if story.status in TERMINAL_STORY_STATUSES:
        return StorySettlement(story, False, "autonomous", thread=existing_thread)
    moment = _utc(now)
    if moment < story.auto_resolve_at:
        return StorySettlement(story, False, "pending", thread=existing_thread)
    if story.collision_ids and (collision is None or resolution is None):
        raise ValueError("collision stories require their deterministic collision and resolution")
    resolution_id = (resolution.id if resolution else
                     stable_id("resolution", story.id, "autonomous", rules_version=story.rules_version))
    updated = replace(story, status="resolved_autonomously", resolution_id=resolution_id,
                      updated_at=moment, trouble_signal=False, intervention_actions=())
    thread = existing_thread
    relationships: tuple[Mapping[str, Any], ...] = ()
    instructions: Mapping[str, str] = {}
    memories: tuple[Mapping[str, str], ...] = ()
    aftermath: tuple[Mapping[str, Any], ...]
    if collision and resolution:
        thread = update_unresolved_thread(existing_thread, story=updated, collision=collision,
                                          resolution=resolution, now=moment)
        relationships = resolution.relationship_changes
        instructions = resolution.action_instructions
        memories = resolution.memory_seeds
        aftermath = ({
            "kind": "relationship_aftermath" if relationships else "life_aftermath",
            "story_id": story.id, "participant_ids": list(story.participant_ids),
            "topic": collision.topic,
            "visible_state": "tense" if resolution.severity_after >= 55 else
                             "settling" if resolution.severity_after >= 30 else "calm",
        },)
    else:
        aftermath = ({"kind": "ambient_summary", "story_id": story.id,
                      "participant_ids": list(story.participant_ids),
                      "action_type": story.visible_facts.get("action_type")},)
    return StorySettlement(updated, True, "autonomous", relationships, instructions,
                           memories, thread, aftermath)


_MANAGEMENT_ACCEPT_EFFECTS: Mapping[str, Mapping[str, int]] = {
    "ask": {"familiarity": 1, "trust": 1, "comfort": 1},
    "comfort": {"affinity": 2, "trust": 1, "comfort": 3, "tension": -1},
    "advise": {"respect": 2, "trust": 1, "tension": -1},
    "mediate": {"trust": 2, "respect": 2, "tension": -3, "resentment": -2},
    "encourage": {"affinity": 2, "respect": 1, "comfort": 1},
    "give_space": {"trust": 1, "comfort": 2, "tension": -2},
    "offer_help": {"trust": 3, "affinity": 1, "comfort": 2, "resentment": -1},
    "invite_talk": {"familiarity": 2, "trust": 1, "comfort": 2},
    "set_boundary": {"respect": 3, "trust": 1, "tension": -2},
    "support_confession": {"trust": 2, "comfort": 2},
    "let_them_handle_it": {"respect": 1, "dependency": -1},
}
_MANAGEMENT_REFUSAL_EFFECTS: Mapping[str, Mapping[str, int]] = {
    "ask": {"comfort": -1, "tension": 1},
    "comfort": {"comfort": -2, "tension": 2},
    "advise": {"respect": -1, "tension": 2},
    "mediate": {"trust": -2, "tension": 3, "resentment": 1},
    "encourage": {"comfort": -1, "tension": 1},
    "give_space": {"affinity": -1, "comfort": -1},
    "offer_help": {"trust": -1, "dependency": 1, "tension": 1},
    "invite_talk": {"comfort": -2, "tension": 1},
    "set_boundary": {"respect": -1, "tension": 3, "resentment": 2},
    "support_confession": {"comfort": -3, "tension": 2},
    "let_them_handle_it": {"trust": -1, "resentment": 1},
}


def _contextual_management_delta(action: str, reaction: str, topic: str) -> dict[str, int]:
    accepted = reaction in {"accept", "accept_later"}
    source = _MANAGEMENT_ACCEPT_EFFECTS if accepted else _MANAGEMENT_REFUSAL_EFFECTS
    result = dict(source.get(action, {}))
    factor = .55 if reaction == "accept_later" else 1.5 if reaction == "backfire" else 1.0
    result = {key: round(value * factor) for key, value in result.items()}

    boundary_topics = {"privacy", "borrowed_property", "noise"}
    practical_topics = {"dishwashing", "unequal_care", "shared_kitchen", "bathroom_access",
                        "food_shortage", "blocked_plan"}
    social_topics = {"companionship", "missed_connection", "friendly_competition"}
    if accepted and topic in boundary_topics:
        if action in {"give_space", "set_boundary"}:
            result["respect"] = result.get("respect", 0) + 2
            result["tension"] = result.get("tension", 0) - 1
        elif action == "comfort":
            result["comfort"] = result.get("comfort", 0) - 2
    if accepted and topic in practical_topics:
        if action in {"mediate", "offer_help", "advise"}:
            result["trust"] = result.get("trust", 0) + 2
        elif action == "give_space":
            result["resentment"] = result.get("resentment", 0) + 2
    if accepted and topic in social_topics:
        if action in {"ask", "comfort", "invite_talk", "encourage"}:
            result["affinity"] = result.get("affinity", 0) + 2
        elif action == "set_boundary":
            result["comfort"] = result.get("comfort", 0) - 2
    return {key: max(-20, min(20, value)) for key, value in result.items() if value}


def settle_story_with_management(story: LifeStory, *, action: str,
                                 participant_acceptance: Mapping[str, Literal[
                                     "accept", "accept_later", "refuse", "backfire"
                                 ]], now: datetime,
                                 base_resolution: CollisionResolution) -> StorySettlement:
    """Apply already rule-evaluated participant reactions without inventing numbers."""
    if story.status in TERMINAL_STORY_STATUSES:
        return StorySettlement(story, False, "managed")
    moment = _utc(now)
    if story.status != "intervention_window" or (story.intervention_expires_at
                                                  and moment > story.intervention_expires_at):
        return StorySettlement(story, False, "pending")
    if action not in story.intervention_actions:
        raise ValueError("management action is not available for this story")
    unknown = set(participant_acceptance) - set(story.participant_ids)
    if unknown or not participant_acceptance:
        raise ValueError("participant acceptance must be scoped to story participants")
    invalid_reactions = set(participant_acceptance.values()) - {
        "accept", "accept_later", "refuse", "backfire",
    }
    if invalid_reactions:
        raise ValueError("unknown participant acceptance reaction")
    accepted = sum(value in {"accept", "accept_later"} for value in participant_acceptance.values())
    negative = sum(value in {"refuse", "backfire"} for value in participant_acceptance.values())
    backfires = sum(value == "backfire" for value in participant_acceptance.values())
    outcome = ("backfired" if backfires else "mixed" if accepted and negative
               else "accepted" if accepted else "refused")
    resolution_id = stable_id("resolution", story.id, action, sorted(participant_acceptance.items()),
                              rules_version=story.rules_version)
    updated = replace(story, status="resolved_with_management", resolution_id=resolution_id,
                      updated_at=moment, trouble_signal=False, intervention_actions=())
    aftermath = ({"kind": "management_aftermath", "story_id": story.id,
                  "action": action, "outcome": outcome,
                  "participant_acceptance": dict(participant_acceptance)},)
    base_changes = {
        (str(value.get("npc_a")), str(value.get("npc_b"))): dict(value)
        for value in base_resolution.relationship_changes
        if value.get("npc_a") and value.get("npc_b")
    }
    topic = str(story.visible_facts.get("topic") or "")
    managed_changes: list[Mapping[str, Any]] = []
    for owner in story.participant_ids:
        target = next((value for value in story.participant_ids if value != owner), None)
        if not target:
            continue
        row = base_changes.get((owner, target), {"npc_a": owner, "npc_b": target})
        values = {key: int(value) for key, value in row.items()
                  if key not in {"npc_a", "npc_b"}}
        delta = _contextual_management_delta(
            action, participant_acceptance.get(owner, "refuse"), topic,
        )
        for key, value in delta.items():
            values[key] = max(-20, min(20, values.get(key, 0) + value))
        managed_changes.append({"npc_a": owner, "npc_b": target, **values})

    instructions = dict(base_resolution.action_instructions)
    instruction_ids = list(instructions)
    for index, npc_id in enumerate(story.participant_ids):
        if index >= len(instruction_ids):
            break
        reaction = participant_acceptance[npc_id]
        if reaction == "backfire":
            instructions[instruction_ids[index]] = "interrupt"
        elif action == "give_space" and reaction in {"accept", "accept_later"}:
            instructions[instruction_ids[index]] = "wait"
        elif action in {"mediate", "offer_help", "invite_talk", "comfort"} and reaction == "accept":
            instructions[instruction_ids[index]] = "continue"

    memories = tuple({
        "npc_id": npc_id, "kind": "relationship", "topic": topic,
        "content_seed": f"Management tried {action.replace('_', ' ')}; I chose to {reaction.replace('_', ' ')}.",
    } for npc_id, reaction in participant_acceptance.items())
    tags = tuple(dict.fromkeys((
        "conflict" if backfires or not accepted else "cooperation" if not negative else "mixed",
        "managed", f"management_{action}",
    )))
    return StorySettlement(updated, True, "managed", tuple(managed_changes), instructions,
                           memories, None, aftermath, tags)


def derive_relationship_labels(edge: Mapping[str, Any], *,
                               open_thread_count: int = 0) -> dict[str, str]:
    """Derive orthogonal, hysteresis-friendly labels from a directional edge."""
    familiarity = int(edge.get("familiarity", 0))
    trust = int(edge.get("trust", 50))
    affinity = int(edge.get("affinity", 50))
    tension = int(edge.get("tension", 0))
    comfort = int(edge.get("comfort", 50))
    resentment = int(edge.get("resentment", 0))
    attraction = int(edge.get("attraction", 0))
    if familiarity < 25:
        bond = "stranger"
    elif min(trust, affinity) >= 72 and familiarity >= 70 and comfort >= 58:
        bond = "close_friend"
    elif min(trust, affinity) >= 57 and familiarity >= 45:
        bond = "friend"
    elif trust < 25 and affinity < 30:
        bond = "distant"
    else:
        bond = "acquaintance"
    if resentment >= 70 and tension >= 65 and open_thread_count:
        conflict = "hostile"
    elif resentment >= 48 or tension >= 58:
        conflict = "strained"
    elif open_thread_count or tension >= 28:
        conflict = "friction"
    elif edge.get("conflict_status") == "reconciling" and tension >= 12:
        conflict = "reconciling"
    else:
        conflict = "none"
    romance = str(edge.get("romance_status", "none"))
    if romance == "none" and attraction >= 65:
        romance = "curious"
    return {"bond_status": bond, "conflict_status": conflict, "romance_status": romance}
