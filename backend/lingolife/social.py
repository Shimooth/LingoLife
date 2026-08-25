from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from itertools import combinations
from typing import Any, Mapping, Protocol, Sequence

from .animation import AnimationCue, animation_cue


SOCIAL_ACTIONS = {"mediate", "encourage", "give_space", "let_them_handle_it"}
OPEN_SOCIAL_STATUSES = {"traveling", "awaiting_observation", "awaiting_management"}
SOCIAL_TRAVEL_SECONDS = (12, 72)
SOCIAL_FALLBACK_TRAVEL_SECONDS = (24, 34)
SOCIAL_EVENT_EXPIRY_HOURS = 24

SOCIAL_TEMPLATE_CUES: dict[str, tuple[AnimationCue, AnimationCue]] = {
    "shared_interest_chat": ("talk", "listen"),
    "help_with_goal": ("talk", "happy"),
    "unexpected_teamwork": ("push", "happy"),
    "small_misunderstanding": ("talk", "sad"),
}


def social_animation_cues(event: Mapping[str, Any]) -> dict[str, AnimationCue]:
    """Upgrade persisted social events and constrain all participant cues."""
    raw_participants = event.get("participant_ids")
    participants = ([str(value) for value in raw_participants[:2]]
                    if isinstance(raw_participants, (list, tuple)) else [])
    defaults = SOCIAL_TEMPLATE_CUES.get(str(event.get("template_id")), ("talk", "listen"))
    outcome = event.get("outcome") if isinstance(event.get("outcome"), Mapping) else {}
    supplied = outcome.get("animation_cues") or event.get("animation_cues") or {}
    supplied = supplied if isinstance(supplied, Mapping) else {}
    return {npc_id: animation_cue(supplied.get(npc_id), defaults[index])
            for index, npc_id in enumerate(participants)}


@dataclass(frozen=True)
class SocialTemplate:
    id: str
    title: str
    summary: str
    memory_actor: str
    memory_other: str
    base_changes: Mapping[str, int]


TEMPLATES = {
    "shared_interest_chat": SocialTemplate(
        "shared_interest_chat", "An animated conversation", "{a} and {b} discovered something they both enjoy at {place}.",
        "I had a lively conversation with {other} about something we both enjoy.",
        "{other} and I found common ground in an unexpectedly fun conversation.",
        {"familiarity": 5, "trust": 2, "affinity": 4, "tension": -2},
    ),
    "help_with_goal": SocialTemplate(
        "help_with_goal", "A timely helping hand", "{a} offered {b} practical help with a personal goal at {place}.",
        "I offered {other} some practical help with a goal that matters to them.",
        "{other} noticed what I was working toward and offered useful help.",
        {"familiarity": 4, "trust": 5, "affinity": 3, "tension": -1},
    ),
    "unexpected_teamwork": SocialTemplate(
        "unexpected_teamwork", "Unexpected teamwork", "{a} and {b} worked together to solve a small problem at {place}.",
        "{other} and I made a surprisingly effective team today.",
        "I learned that I can work well with {other} when something needs doing.",
        {"familiarity": 5, "trust": 4, "affinity": 3, "tension": -2},
    ),
    "small_misunderstanding": SocialTemplate(
        "small_misunderstanding", "A small misunderstanding", "A difference in expectations caused tension between {a} and {b} at {place}.",
        "I felt misunderstood by {other}; we have not fully cleared the air yet.",
        "My conversation with {other} became tense because we expected different things.",
        {"familiarity": 2, "trust": -4, "affinity": -3, "tension": 7},
    ),
}


class SocialRepository(Protocol):
    def ensure_social_edges(self, player_id: str, npc_ids: list[str]) -> list[dict]: ...
    def list_social_events(self, player_id: str, game_date: str | None = None,
                           npc_id: str | None = None, limit: int = 50) -> list[dict]: ...
    def get_social_event(self, player_id: str, event_id: str) -> dict | None: ...
    def save_social_event(self, player_id: str, event: dict) -> tuple[dict, bool]: ...
    def update_social_event(self, player_id: str, event: dict) -> dict: ...
    def resolve_social_event(self, player_id: str, event_id: str, action: str,
                             changes: list[dict], memories: list[dict], outcome: dict,
                             managed: bool = False) -> dict: ...


def _number(*parts: object) -> int:
    return int.from_bytes(hashlib.sha256("\0".join(map(str, parts)).encode()).digest()[:8], "big")


def _utc(value: datetime | None = None) -> datetime:
    current = value or datetime.now(timezone.utc)
    return current.replace(tzinfo=timezone.utc) if current.tzinfo is None else current.astimezone(timezone.utc)


def _timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return _utc(parsed)
    except ValueError:
        return None


def social_travel_seconds(origin_ids: Sequence[str], target_id: str,
                          positions: Mapping[str, tuple[float, float]] | None,
                          seed: str) -> int:
    """Estimate a human-paced, server-authoritative journey duration.

    Logical city coordinates are normalized to the 56 x 38 rendered world.
    The route factor accounts for pavement turns; deterministic jitter keeps
    journeys from feeling mechanical without making replay unstable.
    """
    if positions and target_id in positions:
        target_x, target_y = positions[target_id]
        distances = [math.hypot((positions[origin][0] - target_x) * 56 / 4800,
                                (positions[origin][1] - target_y) * 38 / 3000)
                     for origin in origin_ids if origin in positions]
        if distances:
            route_distance = max(distances) * 1.22
            jitter = .94 + (_number(seed, "travel-pace") % 13) / 100
            estimate = round(route_distance / 1.18 * jitter)
            return max(SOCIAL_TRAVEL_SECONDS[0], min(SOCIAL_TRAVEL_SECONDS[1], estimate))
    low, high = SOCIAL_FALLBACK_TRAVEL_SECONDS
    return low + _number(seed, "travel") % (high - low + 1)


def _words(values: Sequence[str]) -> set[str]:
    return {word.casefold().strip(".,!?;:'\"") for value in values for word in str(value).split() if len(word) > 2}


def _plan_locations(plan: Mapping[str, Any]) -> dict[str, str]:
    result: dict[str, str] = {}
    for slot, item in (plan.get("slots") or {}).items():
        if isinstance(item, Mapping) and item.get("location_id"):
            result[str(slot)] = str(item["location_id"])
    return result


def _status(edge: Mapping[str, Any]) -> str:
    if int(edge.get("tension", 0)) >= 60:
        return "strained"
    familiarity, trust, affinity = (int(edge.get(key, 0)) for key in ("familiarity", "trust", "affinity"))
    if min(trust, affinity) >= 72 and familiarity >= 70:
        return "close_friend"
    if min(trust, affinity) >= 58 and familiarity >= 45:
        return "friend"
    if familiarity >= 25:
        return "acquaintance"
    return "stranger"


class SocialWorldEngine:
    """Deterministic NPC society. The rule engine, never an LLM, owns every delta."""

    def __init__(self, repository: SocialRepository):
        self.repository = repository

    def ensure_daily(self, player_id: str, profiles: Sequence[dict], plans: Mapping[str, dict],
                     game_day: date, current_slot: str = "afternoon",
                     location_names: Mapping[str, str] | None = None,
                     runtime_states: Mapping[str, dict] | None = None,
                     location_positions: Mapping[str, tuple[float, float]] | None = None,
                     now: datetime | None = None) -> list[dict]:
        day = game_day.isoformat()
        current_time = _utc(now)
        recent = self.repository.list_social_events(player_id, limit=20)
        for event in recent:
            if event.get("status") == "generated":  # Upgrade pre-journey events from older releases.
                self._settle(player_id, event, "autonomous", managed=False)
            elif event.get("status") in OPEN_SOCIAL_STATUSES:
                # Residents wait for the observer for the rest of the game day.
                # An unseen story is closed lazily on the next day's first read,
                # so no background worker is required and no event blocks forever.
                if str(event.get("date", "")) < day:
                    self._settle(player_id, event, "autonomous", managed=False)
                else:
                    self._advance(player_id, event, current_time)
        existing = self.repository.list_social_events(player_id, day)
        if existing:
            return existing
        open_events = [event for event in self.repository.list_social_events(player_id, limit=20)
                       if event.get("status") in OPEN_SOCIAL_STATUSES]
        if open_events:
            return open_events
        if len(profiles) < 2:
            return existing
        ordered = sorted(profiles, key=lambda item: item["id"])
        ids = [item["id"] for item in ordered]
        edges = self.repository.ensure_social_edges(player_id, ids)
        edge_map = {(edge["npc_a"], edge["npc_b"]): edge for edge in edges}
        profile_map = {item["id"]: item.get("profile", {}) for item in ordered}
        recent = self.repository.list_social_events(player_id, limit=20)

        candidates: list[tuple[int, str, str, str, str]] = []
        for npc_a, npc_b in combinations(ids, 2):
            profile_a, profile_b = profile_map[npc_a], profile_map[npc_b]
            interests_a = {str(value).casefold() for value in profile_a.get("interests", [])}
            interests_b = {str(value).casefold() for value in profile_b.get("interests", [])}
            traits_a = {str(value).casefold() for value in profile_a.get("personality", [])}
            traits_b = {str(value).casefold() for value in profile_b.get("personality", [])}
            plan_a, plan_b = _plan_locations(plans.get(npc_a, {})), _plan_locations(plans.get(npc_b, {}))
            shared_current_place = plan_a.get(current_slot) if plan_a.get(current_slot) == plan_b.get(current_slot) else None
            slot = current_slot
            current_places = tuple(dict.fromkeys(filter(None, (plan_a.get(slot), plan_b.get(slot), "sunny_plaza"))))
            location = shared_current_place or current_places[_number(player_id, day, npc_a, npc_b, "place") % len(current_places)]
            forward = edge_map[(npc_a, npc_b)]
            reverse = edge_map[(npc_b, npc_a)]
            state_a, state_b = (runtime_states or {}).get(npc_a, {}), (runtime_states or {}).get(npc_b, {})
            social_need = sum(max(0, 45 - float(state.get("needs", {}).get("social", 50)))
                              for state in (state_a, state_b))
            relationship_score = sum(int(edge[key]) for edge in (forward, reverse)
                                     for key in ("familiarity", "trust", "affinity")) // 12
            tension = max(int(forward["tension"]), int(reverse["tension"]))
            recent_penalty = 24 if any({npc_a, npc_b} <= set(event.get("participant_ids", [])) for event in recent[:5]) else 0
            score = (30 + 12 * len(interests_a & interests_b) + 4 * len(traits_a & traits_b)
                     + 18 * bool(shared_current_place) + relationship_score + tension // 2 - recent_penalty
                     + int(social_need // 5)
                     + _number(player_id, day, npc_a, npc_b) % 17)
            candidates.append((score, npc_a, npc_b, slot, location))
        _, npc_a, npc_b, slot, location = max(candidates)
        forward, reverse = edge_map[(npc_a, npc_b)], edge_map[(npc_b, npc_a)]
        profile_a, profile_b = profile_map[npc_a], profile_map[npc_b]
        shared_interests = ({str(value).casefold() for value in profile_a.get("interests", [])}
                            & {str(value).casefold() for value in profile_b.get("interests", [])})
        goals_a = _words([profile_a.get("longTermGoal", "")])
        goals_b = _words([profile_b.get("longTermGoal", "")])
        peak_tension = max(int(forward["tension"]), int(reverse["tension"]))
        traits_a = {str(value).casefold() for value in profile_a.get("personality", [])}
        traits_b = {str(value).casefold() for value in profile_b.get("personality", [])}
        incompatible = bool((traits_a & {"blunt", "direct", "stubborn", "impulsive"}) and
                            (traits_b & {"sensitive", "quiet", "anxious", "careful"})) or bool(
                            (traits_b & {"blunt", "direct", "stubborn", "impulsive"}) and
                            (traits_a & {"sensitive", "quiet", "anxious", "careful"}))
        stress = max(float((runtime_states or {}).get(npc_id, {}).get("emotion", {}).get("stress", 0))
                     for npc_id in (npc_a, npc_b))
        if peak_tension >= 45 or incompatible or (stress >= 70 and _number(day, npc_a, npc_b, "stress") % 3 == 0):
            template_id = "small_misunderstanding"
        elif shared_interests:
            template_id = "shared_interest_chat"
        elif goals_a & goals_b or _number(day, npc_a, npc_b, "goal") % 3 == 0:
            template_id = "help_with_goal"
        else:
            template_id = "unexpected_teamwork"
        template = TEMPLATES[template_id]
        important = template_id == "small_misunderstanding" and peak_tension >= 45
        name_a, name_b = str(profile_a.get("name", npc_a)), str(profile_b.get("name", npc_b))
        place = (location_names or {}).get(location, location.replace("_", " ").title())
        shared_subject = (sorted(shared_interests)[_number(day, npc_a, npc_b, "subject") % len(shared_interests)]
                          if shared_interests else None)
        goal_subject = " ".join(str(profile_b.get("longTermGoal") or profile_a.get("longTermGoal")
                                    or "make everyday life a little better").split())[:140]
        presentation_beats = {
            "shared_interest_chat": [
                {"speaker_id": npc_a, "text": f"I didn't know you were into {shared_subject or 'this'} too.",
                 "translation_zh": f"我以前不知道你也喜欢「{shared_subject or '这个'}」。"},
                {"speaker_id": npc_b, "text": "I am! What do you enjoy most about it?",
                 "translation_zh": "是啊！你最喜欢它的哪一点？"},
            ],
            "help_with_goal": [
                {"speaker_id": npc_a, "text": f"You said you want to {goal_subject[:1].lower() + goal_subject[1:]}. I might be able to help.",
                 "translation_zh": "你说过这件事对你很重要，我也许能帮上忙。"},
                {"speaker_id": npc_b, "text": "Really? I would appreciate that more than you know.",
                 "translation_zh": "真的吗？这份帮助对我意义很大。"},
            ],
            "unexpected_teamwork": [
                {"speaker_id": npc_a, "text": "This little problem is bigger than it looked.",
                 "translation_zh": "这个小问题比看上去麻烦多了。"},
                {"speaker_id": npc_b, "text": "Let's split it up. I think we can handle it together.",
                 "translation_zh": "我们分工吧，我觉得一起就能搞定。"},
            ],
            "small_misunderstanding": [
                {"speaker_id": npc_a, "text": "I was trying to be honest, not hurtful.",
                 "translation_zh": "我只是想坦诚一点，并不是要伤害你。"},
                {"speaker_id": npc_b, "text": "It did not sound that way to me.",
                 "translation_zh": "可我听起来并不是那样。"},
            ],
        }[template_id]
        event_id = "social-" + hashlib.sha256(f"{player_id}\0{day}\0{npc_a}\0{npc_b}".encode()).hexdigest()[:20]
        fallback_origins = ("city_library", "old_town_market", "riverside_park", "moonlight_cafe",
                            "central_station", "botanical_garden")
        origins: dict[str, str] = {}
        for npc_id in (npc_a, npc_b):
            planned = _plan_locations(plans.get(npc_id, {}))
            candidates_for_origin = [value for key, value in planned.items()
                                     if key != current_slot and value != location]
            candidates_for_origin.extend(value for value in fallback_origins
                                         if value != location and value not in candidates_for_origin)
            origins[npc_id] = candidates_for_origin[_number(event_id, npc_id, "origin") % len(candidates_for_origin)]
        travel_seconds = social_travel_seconds(tuple(origins.values()), location, location_positions, event_id)
        arrives_at = current_time + timedelta(seconds=travel_seconds)
        summary = template.summary.format(a=name_a, b=name_b, place=place)
        if template_id == "shared_interest_chat" and shared_subject:
            summary = f"{name_a} and {name_b} discovered that they both enjoy {shared_subject} at {place}."
        elif template_id == "help_with_goal":
            summary = f"At {place}, {name_a} offered {name_b} practical help with this goal: {goal_subject}"
        event = {
            "id": event_id, "date": day, "template_id": template_id, "title": template.title,
            "summary": summary,
            "location_id": location, "time_slot": slot, "participant_ids": [npc_a, npc_b],
            "participants": [{"id": npc_a, "name": name_a}, {"id": npc_b, "name": name_b}],
            "related_npc_ids": [npc_a, npc_b], "importance": 4 if important else 2,
            "status": "traveling",
            "journey": {
                "started_at": current_time.isoformat(),
                "arrives_at": arrives_at.isoformat(),
                "auto_resolve_at": (arrives_at + timedelta(hours=SOCIAL_EVENT_EXPIRY_HOURS)).isoformat(),
                "origin_location_ids": origins,
                "target_location_id": location,
            },
            "animation_cues": social_animation_cues({"template_id": template_id,
                                                       "participant_ids": [npc_a, npc_b]}),
            "presentation": {"subject": shared_subject or goal_subject,
                             "beats": presentation_beats},
            "management": ({"can_intervene": True, "actions": sorted(SOCIAL_ACTIONS),
                            "prompt": "These residents are in conflict. You may mediate or let them handle it."}
                           if important else {"can_intervene": False, "actions": []}),
        }
        self.repository.save_social_event(player_id, event)
        return self.repository.list_social_events(player_id, day)

    def _advance(self, player_id: str, event: dict, now: datetime) -> dict:
        journey = event.get("journey") if isinstance(event.get("journey"), Mapping) else {}
        auto_resolve_at = _timestamp(str(journey.get("auto_resolve_at", "")))
        if auto_resolve_at and now >= auto_resolve_at:
            return self._settle(player_id, event, "autonomous", managed=False)
        arrives_at = _timestamp(str(journey.get("arrives_at", "")))
        if event.get("status") == "traveling" and arrives_at and now >= arrives_at:
            event = dict(event)
            event["status"] = ("awaiting_management" if event.get("management", {}).get("can_intervene")
                               else "awaiting_observation")
            return self.repository.update_social_event(player_id, event)
        return event

    def observe(self, player_id: str, event_id: str) -> dict:
        event = self.repository.get_social_event(player_id, event_id)
        if not event:
            raise KeyError(event_id)
        if event.get("status") in OPEN_SOCIAL_STATUSES:
            event = self._advance(player_id, event, _utc())
        if event.get("status") in {"resolved_autonomously", "resolved_with_management"}:
            return event
        event = self._advance(player_id, event, _utc())
        if event.get("status") != "awaiting_observation":
            raise RuntimeError("social event is not ready to observe")
        return self._settle(player_id, event, "observed", managed=False)

    def intervene(self, player_id: str, event_id: str, action: str) -> dict:
        if action not in SOCIAL_ACTIONS:
            raise ValueError("invalid social intervention action")
        event = self.repository.get_social_event(player_id, event_id)
        if not event:
            raise KeyError(event_id)
        if event.get("status") in OPEN_SOCIAL_STATUSES:
            event = self._advance(player_id, event, _utc())
        if event.get("status") in {"resolved_autonomously", "resolved_with_management"}:
            if event.get("outcome", {}).get("action") == action:
                return event
            raise RuntimeError("social event has already been resolved")
        if event.get("status") == "traveling":
            raise RuntimeError("social event is not ready for management")
        if event.get("status") != "awaiting_management":
            raise RuntimeError("social event is not open for management")
        return self._settle(player_id, event, action, managed=True)

    def _settle(self, player_id: str, event: dict, action: str, managed: bool) -> dict:
        template = TEMPLATES[event["template_id"]]
        npc_a, npc_b = event["participant_ids"][:2]
        name_map = {item["id"]: item["name"] for item in event["participants"]}
        modifiers = {"familiarity": 0, "trust": 0, "affinity": 0, "tension": 0}
        if action == "mediate":
            modifiers.update({"trust": 5, "affinity": 3, "tension": -11})
        elif action == "encourage":
            modifiers.update({"familiarity": 2, "trust": 2, "affinity": 4, "tension": -4})
        elif action == "give_space":
            modifiers.update({"trust": 1, "tension": -5})
        changes = []
        for source, target in ((npc_a, npc_b), (npc_b, npc_a)):
            # A stable one-point asymmetry lets each resident hold a genuinely directional view.
            directional = 1 if _number(event["id"], source, target) % 2 else 0
            changes.append({"npc_a": source, "npc_b": target, **{
                key: int(template.base_changes[key]) + int(modifiers[key]) + (directional if key == "familiarity" else 0)
                for key in ("familiarity", "trust", "affinity", "tension")
            }})
        memories = [
            {"npc_id": npc_a, "content": template.memory_actor.format(other=name_map[npc_b])},
            {"npc_id": npc_b, "content": template.memory_other.format(other=name_map[npc_a])},
        ]
        if managed:
            for memory in memories:
                memory["content"] += f" The community manager chose to {action.replace('_', ' ')}."
        resolved_cues = ({npc_a: "happy", npc_b: "happy"} if action in {"mediate", "encourage"} else
                         {npc_a: "walk", npc_b: "walk"} if action == "give_space" else
                         social_animation_cues(event))
        outcome = {"action": action, "managed": managed, "edge_changes": changes,
                   "animation_cues": resolved_cues}
        return self.repository.resolve_social_event(player_id, event["id"], action, changes, memories,
                                                    outcome, managed=managed)


def social_status(edge: Mapping[str, Any]) -> str:
    return _status(edge)
