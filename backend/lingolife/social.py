from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import date
from itertools import combinations
from typing import Any, Mapping, Protocol, Sequence


SOCIAL_ACTIONS = {"mediate", "encourage", "give_space", "let_them_handle_it"}


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
    def resolve_social_event(self, player_id: str, event_id: str, action: str,
                             changes: list[dict], memories: list[dict], outcome: dict,
                             managed: bool = False) -> dict: ...


def _number(*parts: object) -> int:
    return int.from_bytes(hashlib.sha256("\0".join(map(str, parts)).encode()).digest()[:8], "big")


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
                     runtime_states: Mapping[str, dict] | None = None) -> list[dict]:
        day = game_day.isoformat()
        existing = self.repository.list_social_events(player_id, day)
        if existing:
            for event in existing:
                if event.get("status") == "generated":
                    self._settle(player_id, event, "autonomous", managed=False)
            return self.repository.list_social_events(player_id, day)
        open_events = [event for event in self.repository.list_social_events(player_id, limit=20)
                       if event.get("status") == "awaiting_management"]
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
            slot_order = {"morning": 0, "afternoon": 1, "evening": 2}
            meetings = sorted(((slot, place) for slot, place in plan_a.items() if plan_b.get(slot) == place),
                              key=lambda item: (slot_order.get(item[0], 99), item[0], item[1]))
            meeting = meetings[0] if meetings else None
            fallback_slots = sorted(set(plan_a) | set(plan_b), key=lambda value: (slot_order.get(value, 99), value))
            slot = meeting[0] if meeting else (fallback_slots[_number(player_id, day, npc_a, npc_b, "slot") % len(fallback_slots)]
                                               if fallback_slots else current_slot)
            location = meeting[1] if meeting else plan_a.get(slot) or plan_b.get(slot) or "sunny_plaza"
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
                     + 18 * bool(meeting) + relationship_score + tension // 2 - recent_penalty
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
        event_id = "social-" + hashlib.sha256(f"{player_id}\0{day}\0{npc_a}\0{npc_b}".encode()).hexdigest()[:20]
        event = {
            "id": event_id, "date": day, "template_id": template_id, "title": template.title,
            "summary": template.summary.format(a=name_a, b=name_b, place=place),
            "location_id": location, "time_slot": slot, "participant_ids": [npc_a, npc_b],
            "participants": [{"id": npc_a, "name": name_a}, {"id": npc_b, "name": name_b}],
            "related_npc_ids": [npc_a, npc_b], "importance": 4 if important else 2,
            "status": "awaiting_management" if important else "generated",
            "management": ({"can_intervene": True, "actions": sorted(SOCIAL_ACTIONS),
                            "prompt": "These residents are in conflict. You may mediate or let them handle it."}
                           if important else {"can_intervene": False, "actions": []}),
        }
        saved, created = self.repository.save_social_event(player_id, event)
        if created and not important:
            return [self._settle(player_id, saved, "autonomous", managed=False)]
        return self.repository.list_social_events(player_id, day)

    def intervene(self, player_id: str, event_id: str, action: str) -> dict:
        if action not in SOCIAL_ACTIONS:
            raise ValueError("invalid social intervention action")
        event = self.repository.get_social_event(player_id, event_id)
        if not event:
            raise KeyError(event_id)
        if event.get("status") in {"resolved_autonomously", "resolved_with_management"}:
            if event.get("outcome", {}).get("action") == action:
                return event
            raise RuntimeError("social event has already been resolved")
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
        outcome = {"action": action, "managed": managed, "edge_changes": changes}
        return self.repository.resolve_social_event(player_id, event["id"], action, changes, memories,
                                                    outcome, managed=managed)


def social_status(edge: Mapping[str, Any]) -> str:
    return _status(edge)
