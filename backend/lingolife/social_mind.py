"""Bounded, deterministic personal knowledge and interpretations of real events.

The world supplies facts. Residents acquire a perspective only by participating,
actually witnessing a public event, or receiving an explicit, traceable report.
Interpretations never change the fact ledger or another resident's knowledge.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import json
import re
from typing import Any, Mapping


VERSION = 1
MAX_FACTS = 128
MAX_OBSERVATIONS = 24
MAX_INTERPRETATIONS = 48
MAX_PROCESSED = 512
FACT_DAYS = 14
KNOWLEDGE_DAYS = 7
DETAIL_DAYS = 3
PUBLIC_CONTEXT_LIMIT = 8
VALUE_NAMES = ("honesty", "fairness", "care", "autonomy", "belonging", "achievement")
VALUE_LABELS = {"honesty": "诚实守信", "fairness": "公平互惠", "care": "照顾他人",
                "autonomy": "自主与边界", "belonging": "陪伴与归属", "achievement": "成长与成就"}
VALUE_ALIASES = {**{name: name for name in VALUE_NAMES},
                 "诚实": "honesty", "守信": "honesty", "公平": "fairness",
                 "关怀": "care", "照顾": "care", "自主": "autonomy", "边界": "autonomy",
                 "归属": "belonging", "陪伴": "belonging", "成长": "achievement", "成就": "achievement"}
VALUE_CUES = {
    "honesty": ("honest", "honesty", "reliable", "keep promises", "broken promises", "诚实", "守信", "可靠", "失信"),
    "fairness": ("fair", "fairness", "reciprocity", "equal share", "公平", "公正", "互惠", "平等分担"),
    "care": ("caring", "kind", "compassionate", "help others", "体贴", "善良", "关心他人", "照顾他人"),
    "autonomy": ("independent", "privacy", "ask before", "personal space", "独立", "隐私", "先询问", "先问", "私人空间"),
    "belonging": ("sociable", "company", "check in with housemates", "重视朋友", "陪伴", "归属", "合群"),
    "achievement": ("ambitious", "persistent", "improve", "有野心", "上进", "坚持", "成长", "进步"),
}
DETAIL_FIELDS = frozenset({
    "actor_id", "affected_id", "owner_id", "borrower_id", "prepared_by", "consumed_by",
    "initiator_id", "target_id", "target_busy",
    "created_by", "helper_id", "recipient_id", "resource_kind", "item_kind", "item_label", "item_label_zh",
    "activity_id", "activity_kind", "activity_subject", "activity_phase", "teacher_id",
    "violated", "permission_granted", "permission_missing", "borrowed_without_permission",
    "owner_expectation", "recurrence_count", "kind", "phase", "outcome", "triggers",
    "action_type", "completed_at", "public_action_completed", "receipt_status", "commitment_id", "fulfilled_ids",
})
PRIVATE_ACTIONS = frozenset({"sleep", "shower", "bathe", "use_toilet", "private_time"})
PRIVATE_PLACES = ("bedroom", "bathroom", "bath-room", "private-room", "卧室", "浴室", "卫生间")
WITNESS_FIELDS = frozenset({"actor_id", "affected_id", "prepared_by", "consumed_by", "helper_id", "recipient_id",
    "resource_kind", "item_kind", "activity_kind", "activity_subject", "activity_phase", "teacher_id", "phase",
    "action_type", "completed_at", "public_action_completed"})
CONTEXT_INSTRUCTION = (
    "以下仅是这个人物自己的视角。observations 中 participant/witness 表示亲历或亲眼所见，"
    "reported 表示听某人转告，必须保留来源和不确定性。interpretations 全是个人推测，"
    "不能当作客观事实、对方真实动机或他人的记忆。未知的事不能补写。"
)


def _time(value: Any) -> datetime | None:
    try:
        parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return None
        return parsed.astimezone(timezone.utc)
    except (ValueError, TypeError, OverflowError):
        return None


def _now(value: Any) -> datetime:
    moment = _time(value)
    if moment is None:
        raise ValueError("social_mind requires an explicit timezone-aware time")
    return moment


def _number(value: Any, default: float = 0.0) -> float:
    try:
        result = float(value)
        return result if result == result and abs(result) != float("inf") else default
    except (ValueError, TypeError):
        return default


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return round(max(low, min(high, value)), 4)


def _strings(value: Any, limit: int = 12) -> list[str]:
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, (list, tuple)):
        return []
    return list(dict.fromkeys(str(item).strip()[:160] for item in value if isinstance(item, str) and item.strip()))[:limit]


def _cue(text: str, cue: str) -> bool:
    pattern = re.escape(cue) if re.search(r"[^\x00-\x7f]", cue) else r"\b" + re.escape(cue) + r"\b"
    return any(not re.search(r"(?:not |never |不|并不|不是|不够)$", text[max(0, match.start()-8):match.start()])
               for match in re.finditer(pattern, text))


def persona_values(profile: Mapping[str, Any]) -> dict[str, Any]:
    """Compile only supported value cues; unfamiliar prose creates no traits.

    Explicit ``values`` accepts an ordered list of known names or a mapping of
    names to weights in [0, 1] (0..100 is also accepted for existing UI inputs).
    Explicit ``self_image``/``selfImage`` is retained as declared self-description.
    """
    text = " ".join(word for key in ("personality", "boundaries", "likes", "dislikes", "habits", "longTermGoal")
                    for word in _strings(profile.get(key))).casefold()
    values = {name: .7 for name, cues in VALUE_CUES.items() if any(_cue(text, cue) for cue in cues)}
    sources = {name: "profile_cue" for name in values}
    explicit = profile.get("values")
    if isinstance(explicit, Mapping):
        for key, raw in explicit.items():
            name = VALUE_ALIASES.get(str(key).casefold())
            if name is None or not isinstance(raw, (int, float)) or isinstance(raw, bool):
                continue
            value = _number(raw, -1)
            if 0 <= value <= 100:
                values[name] = _clamp(value / 100 if value > 1 else value)
                sources[name] = "declared"
    elif isinstance(explicit, (list, tuple)):
        for index, raw in enumerate(explicit[:6]):
            name = VALUE_ALIASES.get(str(raw).casefold())
            if name:
                values[name] = round(1 - index * .1, 2)
                sources[name] = "declared"
    priority = sorted(values, key=lambda name: (-values[name], VALUE_NAMES.index(name)))
    self_image = _strings(profile.get("self_image") or profile.get("selfImage"), 3)
    if not self_image:
        identities = (("honesty", "希望自己是个可靠的人"), ("care", "希望自己能照顾到别人"),
                      ("autonomy", "希望自己能守住个人边界"), ("achievement", "希望自己不断进步"))
        self_image = [label for name, label in identities if name in values and values[name] >= .7][:2]
    return {"values": values, "priority": priority, "self_image": self_image, "sources": sources}


def _recent(items: Mapping[str, Any], limit: int, field: str) -> dict[str, Any]:
    keys = sorted(items, key=lambda key: (str(items[key].get(field, "")), key))[-limit:]
    return {key: items[key] for key in keys}


def ensure(state: dict[str, Any], profiles: Mapping[str, Mapping[str, Any]], now: datetime) -> None:
    """Initialize without importing old stories; maintain by absolute time only."""
    moment = _now(now)
    bank = state.setdefault("social_mind", {})
    if not isinstance(bank, dict):
        raise ValueError("invalid social_mind state")
    bank.setdefault("version", VERSION)
    bank.setdefault("facts", {})
    bank.setdefault("minds", {})
    bank.setdefault("processed", {})
    residents = state.get("residents", {})
    bank["facts"] = _recent({key: fact for key, fact in bank["facts"].items()
        if (_time(fact.get("expires_at")) or moment) > moment
        and all(person in residents for person in fact.get("participant_ids", []))}, MAX_FACTS, "occurred_at")
    # Tombstones prevent replay from re-teaching a forgotten source.
    processed = {key: item for key, item in bank["processed"].items()
                 if (_time(item.get("expires_at")) or moment) > moment}
    kept = _recent(processed, MAX_PROCESSED, "occurred_at")
    removed = set(processed) - set(kept)
    if removed:
        floor = max((processed[key]["occurred_at"], key) for key in removed)
        bank["source_floor"] = list(max(tuple(bank.get("source_floor", ("", ""))), floor))
    bank["processed"] = kept
    for owner in list(bank["minds"]):
        if owner not in residents:
            del bank["minds"][owner]
    for owner in sorted(residents):
        mind = bank["minds"].setdefault(owner, {"observations": {}, "interpretations": {}})
        if owner in profiles or "persona" not in mind:
            mind["persona"] = persona_values(profiles.get(owner, {}))
        mind.setdefault("observations", {})
        mind.setdefault("interpretations", {})
        mind["observations"] = _recent({key: item for key, item in mind["observations"].items()
            if item.get("source_id") in bank["facts"]
            and (_time(item.get("expires_at")) or moment) > moment
            and (not item.get("reporter_id") or item["reporter_id"] in residents)}, MAX_OBSERVATIONS, "learned_at")
        mind["interpretations"] = _recent({key: item for key, item in mind["interpretations"].items()
            if item.get("source_id") in mind["observations"] and item.get("target_id") in residents
            and (_time(item.get("expires_at")) or moment) > moment}, MAX_INTERPRETATIONS, "created_at")


def _safe_details(raw: Mapping[str, Any]) -> dict[str, Any]:
    result = {}
    for key in sorted(DETAIL_FIELDS & raw.keys()):
        value = raw[key]
        if isinstance(value, (str, bool, int, float)) or value is None:
            result[key] = value[:160] if isinstance(value, str) else value
        elif key in {"triggers", "fulfilled_ids"}:
            result[key] = _strings(value, 8)
    return result


def _public_place(location: Any) -> bool:
    return bool(isinstance(location, str) and location and not any(token in location.casefold() for token in PRIVATE_PLACES))


def _present(resident: Mapping[str, Any], location: str, moment: datetime) -> bool:
    action = resident.get("current_action") or {}
    start = _time(action.get("started_at"))
    end = _time(action.get("completed_at") or action.get("ends_at"))
    return bool(resident.get("current_location_id") == location and action.get("location_id") == location
                and action.get("status") == "performing" and action.get("action_type") not in PRIVATE_ACTIONS
                and action.get("visibility") != "private" and start is not None and start <= moment
                and (end is None or end >= moment) and not resident.get("current_journey"))


def _canonical(fact: Mapping[str, Any], now: datetime) -> dict[str, Any] | None:
    if not all(key in fact for key in ("id", "topic", "participant_ids", "location_id", "facts")):
        return None
    if not isinstance(fact.get("facts"), Mapping) or not isinstance(fact.get("id"), str) or not fact["id"]:
        return None
    occurred = _time(fact.get("occurred_at", now))
    if occurred is None or occurred > now or now - occurred >= timedelta(days=FACT_DAYS):
        return None
    participants = _strings(fact.get("participant_ids"))
    if not participants:
        return None
    location = fact.get("location_id")
    visible = fact.get("visibility") == "public" and _public_place(location)
    return {"id": fact["id"], "topic": str(fact["topic"])[:80], "kind": str(fact.get("kind", ""))[:80],
            "memory_source_id": str(fact.get("memory_source_id") or fact["id"].removesuffix(":settled")),
            "participant_ids": participants, "location_id": location if isinstance(location, str) else None,
            "facts": _safe_details(fact["facts"]), "outcome_tags": _strings(fact.get("outcome_tags"), 12),
            "visibility": "public" if visible else "participants", "occurred_at": occurred.isoformat(),
            "expires_at": (occurred + timedelta(days=FACT_DAYS)).isoformat()}


def observe_fact(state: dict[str, Any], profiles: Mapping[str, Mapping[str, Any]],
                 fact: Mapping[str, Any], now: datetime) -> None:
    """Register one immutable source and grant only evidenced personal access."""
    moment = _now(now)
    ensure(state, profiles, moment)
    previous = state["social_mind"]["processed"].get(fact.get("id")) if isinstance(fact.get("id"), str) else None
    source = {**fact, "occurred_at": previous["occurred_at"]} if previous and "occurred_at" not in fact else fact
    value = _canonical(source, moment)
    if value is None or any(owner not in state["residents"] for owner in value["participant_ids"]):
        return
    bank = state["social_mind"]
    fingerprint = hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    old = bank["processed"].get(value["id"])
    if old:
        if old["fingerprint"] != fingerprint:
            raise ValueError("social fact source id reused with different facts")
        return
    if (value["occurred_at"], value["id"]) <= tuple(bank.get("source_floor", ("", ""))):
        return
    bank["facts"][value["id"]] = value
    bank["processed"][value["id"]] = {"fingerprint": fingerprint,
        "occurred_at": value["occurred_at"], "expires_at": value["expires_at"]}
    occurred = _now(value["occurred_at"])
    observers = {owner: "participant" for owner in value["participant_ids"]}
    # A present-day position is not evidence that somebody witnessed an old event.
    if value["visibility"] == "public" and occurred == moment:
        for owner, resident in state["residents"].items():
            if owner not in observers and _present(resident, value["location_id"], moment):
                observers[owner] = "witness"
    for owner, channel in sorted(observers.items()):
        bank["minds"][owner]["observations"][value["id"]] = {
            "source_id": value["id"], "channel": channel, "reporter_id": None,
            "confidence": 1.0 if channel == "participant" else .85,
            "learned_at": moment.isoformat(),
            "expires_at": (occurred + timedelta(days=KNOWLEDGE_DAYS)).isoformat(),
        }
        for target in value["participant_ids"]:
            if owner != target:
                appraise(state, owner, target, value, profiles.get(owner, {}), moment)
    ensure(state, profiles, moment)


def _edge(state: Mapping[str, Any], owner: str, target: str) -> Mapping[str, Any]:
    for pair in state.get("relationships", {}).values():
        for direction in ("a_to_b", "b_to_a"):
            edge = pair.get(direction) or {}
            if edge.get("owner_id") == owner and edge.get("target_id") == target:
                return edge.get("dimensions") or edge
    return {}


def _known(state: Mapping[str, Any], owner: str, source: str, now: datetime):
    bank = state.get("social_mind", {})
    fact = bank.get("facts", {}).get(source)
    observation = bank.get("minds", {}).get(owner, {}).get("observations", {}).get(source)
    if not fact or not observation:
        return None, None
    residents = state.get("residents", {})
    if owner not in residents or any(person not in residents for person in fact["participant_ids"]):
        return None, None
    if observation.get("reporter_id") and observation["reporter_id"] not in residents:
        return None, None
    occurred, learned, expires = (_time(fact.get("occurred_at")), _time(observation.get("learned_at")), _time(observation.get("expires_at")))
    if not occurred or not learned or not expires or max(occurred, learned) > now or expires <= now:
        return None, None
    memory_bank = state.get("pair_memory", {})
    source_id = observation.get("report_id") if observation["channel"] == "reported" else fact.get("memory_source_id", source)
    memory_targets = [observation.get("reporter_id")] if observation["channel"] == "reported" else fact["participant_ids"]
    if observation["channel"] in {"participant", "reported"} and source_id in memory_bank.get("processed", []):
        remembered = [item for pair in memory_bank.get("pairs", {}).values()
                      if pair.get("owner_id") == owner and pair.get("target_id") in memory_targets
                      for item in pair.get("episodes", []) if item.get("source_id") == source_id]
        # Selection/forgetting owns autobiographical memory, including an actual
        # report conversation. Cognition must not reconstruct a discarded episode.
        if not remembered or all(item.get("retention") == "discard" for item in remembered):
            return None, None
        memory_faded = all(item.get("recall") in {"fading", "gist"} for item in remembered if item.get("retention") != "discard")
    else:
        memory_faded = False
    # A spectator can see actions, not private ownership rules or unspoken consent.
    if observation["channel"] != "participant":
        fact = {**fact, "facts": {key: value for key, value in fact["facts"].items() if key in WITNESS_FIELDS}}
    if memory_faded or now - occurred >= timedelta(days=DETAIL_DAYS):
        fact = {**fact, "facts": {}}
        observation = {**observation, "recall": "fading"}
    else:
        observation = {**observation, "recall": "clear"}
    return fact, observation


def source_known(state: Mapping[str, Any], owner: str, source_id: str, now: datetime) -> bool:
    """Read-only knowledge gate for continuing a real, still-remembered concern."""
    return bool(_known(state, owner, source_id, _now(now))[0])


def appraise(state: dict[str, Any], owner: str, target: str, fact: Mapping[str, Any],
             profile: Mapping[str, Any], now: datetime) -> dict[str, Any]:
    """Return exactly the five Appraisal fields; cache a separate interpretation.

    Only stored, currently known source facts count. Extra claims in ``fact`` are
    ignored. Repeated evaluation cannot amplify certainty or rewrite attribution.
    """
    moment = _now(now)
    neutral = {"perceived_intent": "unknown", "responsibility": 0.0, "fairness": 0.0,
               "confidence": 0.0, "boundary_impact": 0.0}
    value, observation = _known(state, owner, str(fact.get("id", "")), moment)
    if not value or owner == target or target not in value["participant_ids"]:
        return neutral
    mind = state["social_mind"]["minds"][owner]
    key = value["id"] + ":" + target
    old = mind["interpretations"].get(key)
    if old:
        return deepcopy(old["appraisal"])
    detail = value["facts"]
    tags = set(value["outcome_tags"])
    topic = value["topic"]
    violated = bool(detail.get("violated") or detail.get("permission_missing") or detail.get("borrowed_without_permission"))
    negative = violated or "conflict" in tags or bool(tags & {"broken_promise", "neglect", "boundary_violation"})
    positive = not negative and ("cooperation" in tags or bool(tags & {"received_help", "kept_promise", "shared_activity_completed"})
                                or detail.get("activity_phase") == "completed")
    value_name = ("autonomy" if topic in {"borrowed_property", "privacy", "noise"} or value["kind"] == "person_boundary"
                  else "fairness" if topic in {"care_imbalance", "unequal_care", "dishes", "dishwashing", "chores", "responsibility"} or value["kind"] == "person_responsibility"
                  else "honesty" if tags & {"kept_promise", "broken_promise"}
                  else "achievement" if topic in {"competition", "hobby", "practice"}
                  else "care" if "received_help" in tags or topic in {"household_help", "shared_food"} else "belonging")
    importance = persona_values(profile)["values"].get(value_name, .5)
    edge = _edge(state, owner, target)
    trust = _number(edge.get("trust"), 50) / 100
    resentment = _number(edge.get("resentment"), 0) / 100
    actor = detail.get("actor_id") or detail.get("borrower_id") or detail.get("created_by")
    target_is_actor = actor == target
    other_actor = actor and not target_is_actor
    responsibility = .8 if target_is_actor else .2 if other_actor else .5
    if positive and observation["channel"] == "participant":
        responsibility = .8
    # Motive remains a hypothesis, even when the event itself was witnessed.
    intent = ("accidental" if trust >= .7 and resentment < .3 else "careless") if negative else "beneficial" if positive else "unknown"
    if negative and other_actor:
        intent = "unknown"
    fairness = (-1 if negative else 1 if positive else 0) * (.2 + importance * .55)
    if other_actor and negative:
        fairness *= .25
    confidence = observation["confidence"] * (.65 if negative else .9 if positive and observation["channel"] == "participant" else .75 if positive else .4)
    appraisal = {"perceived_intent": intent, "responsibility": responsibility,
                 "fairness": _clamp(fairness, -1, 1), "confidence": _clamp(confidence),
                 "boundary_impact": _clamp((.3 + .65 * importance) if negative and value_name == "autonomy" and not other_actor else 0)}
    meaning = ("在意这次相处中的边界是否得到尊重" if negative and value_name == "autonomy"
               else "在意付出是否被公平对待" if negative and value_name == "fairness"
               else "对这次相处仍有些不舒服" if negative
               else "把这次相处看作一种善意" if positive else "暂时还不能确定这件事意味着什么")
    mind["interpretations"][key] = {"source_id": value["id"], "target_id": target,
        "appraisal": appraisal, "value": value_name, "meaning": meaning, "is_inference": True,
        "created_at": moment.isoformat(), "expires_at": observation["expires_at"]}
    mind["interpretations"] = _recent(mind["interpretations"], MAX_INTERPRETATIONS, "created_at")
    return deepcopy(appraisal)


def relay_fact(state: dict[str, Any], profiles: Mapping[str, Mapping[str, Any]], source_id: str,
               reporter_id: str, recipient_id: str, now: datetime, *, report_id: str) -> bool:
    """Execute an explicit public retelling between two actually present people.

    This is a social action, not an automatic consequence of sharing a location.
    One-hop reports cannot disclose private events or recursively spread gossip.
    """
    moment = _now(now)
    ensure(state, profiles, moment)
    value, observed = _known(state, reporter_id, source_id, moment)
    residents = state.get("residents", {})
    if (not report_id or reporter_id == recipient_id or reporter_id not in residents or recipient_id not in residents
            or not value or value["visibility"] != "public" or observed["channel"] == "reported"):
        return False
    location = residents[reporter_id].get("current_location_id")
    if not _public_place(location) or not all(_present(residents[person], location, moment) for person in (reporter_id, recipient_id)):
        return False
    recipient = state["social_mind"]["minds"][recipient_id]
    if source_id in recipient["observations"]:
        return False
    trust = _number(_edge(state, recipient_id, reporter_id).get("trust"), 50) / 100
    recipient["observations"][source_id] = {"source_id": source_id, "channel": "reported", "reporter_id": reporter_id,
        "report_id": report_id, "confidence": _clamp(observed["confidence"] * (.35 + .25 * trust)),
        "learned_at": moment.isoformat(), "expires_at": observed["expires_at"]}
    for target in value["participant_ids"]:
        if target != recipient_id:
            appraise(state, recipient_id, target, value, profiles.get(recipient_id, {}), moment)
    ensure(state, profiles, moment)
    return True


def perspective(state: Mapping[str, Any], owner: str, participant_ids, *, before: datetime,
                exclude_source: str | None = None) -> dict[str, Any]:
    """Read-only, owner-scoped context; future knowledge and unknown facts stay out."""
    moment = _now(before)
    bank = state.get("social_mind", {})
    mind = bank.get("minds", {}).get(owner, {})
    others = set(participant_ids) - {owner}
    relevant_relays = {item.get("source_fact_id") for item in state.get("social_continuity", {}).get("concerns", {}).get(owner, [])
        if item.get("owner_id") == owner and item.get("kind") == "relay"
        and item.get("status") in {"pending", "approaching"} and item.get("target_id") in others
        and _time(item.get("created_at")) is not None and _time(item["created_at"]) <= moment
        and _time(item.get("expires_at")) is not None and _time(item["expires_at"]) > moment
        and isinstance(item.get("source_fact_id"), str) and source_known(state, owner, item["source_fact_id"], moment)}
    observations = []
    sources = set()
    for source in mind.get("observations", {}):
        fact, observation = _known(state, owner, source, moment)
        if (not fact or source == exclude_source or (exclude_source and fact.get("memory_source_id") == exclude_source)
                or (others and not others.intersection(fact["participant_ids"])
                    and observation.get("reporter_id") not in others
                    and not (source in relevant_relays and fact["visibility"] == "public"))):
            continue
        observations.append({"source_id": source, "topic": fact["topic"],
            "participant_ids": list(fact["participant_ids"]), "occurred_at": fact["occurred_at"],
            "learned_at": observation["learned_at"], "channel": observation["channel"],
            "reporter_id": observation["reporter_id"], "confidence": observation["confidence"], "visibility": fact["visibility"], "recall": observation["recall"],
            "facts": deepcopy(fact["facts"]), "outcome_tags": list(fact["outcome_tags"])})
    observations = sorted(observations, key=lambda item: (item["learned_at"], item["source_id"]))[-PUBLIC_CONTEXT_LIMIT:]
    sources.update(item["source_id"] for item in observations)
    interpretations = [{key: deepcopy(item[key]) for key in ("source_id", "target_id", "meaning", "value", "is_inference", "appraisal")}
                       for item in mind.get("interpretations", {}).values()
                       if item["source_id"] in sources and (_time(item.get("created_at")) or moment) <= moment
                       and (not others or item["target_id"] in others)]
    concerns = [{**{key: item[key] for key in ("kind", "target_id", "status", "source_topic")},
                 "source_id": item.get("source_fact_id")}
                for item in state.get("social_continuity", {}).get("concerns", {}).get(owner, [])
                if item.get("owner_id") == owner and item.get("status") in {"pending", "approaching"}
                and item.get("kind") in {"check_in", "repair", "thank", "relay", "explain"}
                and item.get("target_id") in state.get("residents", {})
                and (not others or item["target_id"] in others)
                and _time(item.get("created_at")) is not None and _time(item["created_at"]) <= moment
                and _time(item.get("expires_at")) is not None and _time(item["expires_at"]) > moment
                and isinstance(item.get("source_fact_id"), str) and source_known(state, owner, item["source_fact_id"], moment)][:4]
    return {"owner_id": owner, "instruction": CONTEXT_INSTRUCTION,
            "observations": observations, "interpretations": interpretations[-PUBLIC_CONTEXT_LIMIT:],
            "personal_values": [VALUE_LABELS[name] for name in mind.get("persona", {}).get("priority", [])],
            "self_image": list(mind.get("persona", {}).get("self_image", [])), "current_concerns": concerns}


def sanitize_perspective(raw: Any, owner_id: str | None = None, participant_ids=None, *,
                         for_player: bool = False) -> dict[str, Any]:
    """Idempotent expression projection with no internal scores or source ids.

    Player-facing generation receives only public experiences. Scene generation
    may use the speaker's own private experience, never somebody else's bank.
    """
    if not isinstance(raw, Mapping):
        return {}
    owner = raw.get("owner_id")
    if not isinstance(owner, str) or (owner_id is not None and owner != owner_id):
        return {}
    participants = set(_strings(participant_ids)) if participant_ids is not None else None
    if participants is not None and owner not in participants:
        return {}
    observations, references = [], {}
    raw_concerns = raw.get("current_concerns", [])
    relay_sources = {item.get("source_id") or item.get("reference")
                     for item in raw_concerns if isinstance(item, Mapping)
                     and item.get("kind") == "relay" and item.get("status") in ("pending", "approaching")
                     and isinstance(item.get("source_id") or item.get("reference"), str)
                     and (participants is None or item.get("target_id") in participants)} if isinstance(raw_concerns, list) else set()
    raw_observations = raw.get("observations", [])
    for item in raw_observations if isinstance(raw_observations, list) else []:
        if not isinstance(item, Mapping):
            continue
        visibility = item.get("visibility")
        if for_player and visibility != "public":
            continue
        channel = item.get("channel")
        if not isinstance(channel, str) or channel not in {"participant", "witness", "reported"}:
            continue
        cast = _strings(item.get("participant_ids"))
        # A witnessed third party may be discussed if a current speaker took part.
        source = item.get("source_id") or item.get("reference")
        reporter = item.get("reporter_id") if isinstance(item.get("reporter_id"), str) else None
        related_relay = isinstance(source, str) and source in relay_sources and visibility == "public"
        if not cast or (participants is not None and not participants.intersection(cast)
                        and reporter not in participants and not related_relay):
            continue
        if not isinstance(source, str) or not source or source in references:
            continue
        if channel == "reported" and not reporter:
            continue
        reference = "experience_" + str(len(observations) + 1)
        references[source] = reference
        certainty = item.get("certainty") if item.get("certainty") in ("direct", "observed", "tentative") else (
            "tentative" if channel == "reported" else "direct" if channel == "participant" else "observed")
        details = _safe_details(item.get("facts", {})) if isinstance(item.get("facts"), Mapping) else {}
        details.pop("commitment_id", None)
        if channel != "participant":
            details = {key: value for key, value in details.items() if key in WITNESS_FIELDS}
        observations.append({"reference": reference, "topic": str(item.get("topic", ""))[:80],
            "participant_ids": cast, "channel": channel, "reporter_id": reporter,
            "certainty": certainty, "visibility": "public" if visibility == "public" else "participants",
            "recall": "fading" if item.get("recall") == "fading" else "clear",
            "facts": {} if item.get("recall") == "fading" else details, "outcome_tags": _strings(item.get("outcome_tags"), 8)})
        if len(observations) >= PUBLIC_CONTEXT_LIMIT:
            break
    interpretations = []
    raw_interpretations = raw.get("interpretations", [])
    for item in raw_interpretations if isinstance(raw_interpretations, list) else []:
        if not isinstance(item, Mapping) or item.get("is_inference") is not True:
            continue
        source = item.get("source_id") or item.get("reference")
        target = item.get("target_id")
        if not isinstance(source, str) or source not in references or not isinstance(target, str) or (participants is not None and target not in participants):
            continue
        if item.get("value") not in VALUE_NAMES:
            continue
        interpretations.append({"reference": references[source], "target_id": target,
            "meaning": str(item.get("meaning", ""))[:160], "value": item["value"],
            "is_inference": True, "certainty": "tentative"})
        if len(interpretations) >= PUBLIC_CONTEXT_LIMIT:
            break
    concerns = []
    for item in raw_concerns if isinstance(raw_concerns, list) and not for_player else []:
        if (isinstance(item, Mapping) and item.get("kind") in ("check_in", "repair", "thank", "relay", "explain")
                and item.get("status") in ("pending", "approaching") and isinstance(item.get("target_id"), str)
                and item["target_id"] != owner and (participants is None or item["target_id"] in participants)):
            concern = {key: str(item.get(key, ""))[:80] for key in ("kind", "target_id", "status", "source_topic")}
            source = item.get("source_id") or item.get("reference")
            if isinstance(source, str) and source in references:
                concern["reference"] = references[source]
            concerns.append(concern)
    return {"owner_id": owner, "instruction": CONTEXT_INSTRUCTION,
        "observations": observations, "interpretations": interpretations,
        "personal_values": [value for value in _strings(raw.get("personal_values"), 6) if value in VALUE_LABELS.values()],
        "self_image": _strings(raw.get("self_image"), 3), "current_concerns": concerns[:4]}


def validate_interpretation_proposal(state: Mapping[str, Any], owner: str,
                                    proposal: Any, now: datetime) -> dict[str, Any] | None:
    """Validate an optional AI hypothesis without applying it or taking an action.

    This narrow extension point accepts references/enums only. Fact writing,
    relationship settlement and intention selection still belong to the kernel.
    No AI service or polling is needed by this module.
    """
    fields = {"source_id", "target_id", "value", "perceived_intent", "confidence"}
    if not isinstance(proposal, Mapping) or set(proposal) != fields:
        return None
    source, target = proposal["source_id"], proposal["target_id"]
    if not isinstance(source, str) or not isinstance(target, str):
        return None
    fact, observation = _known(state, owner, source, _now(now))
    if not fact or target == owner or target not in fact["participant_ids"]:
        return None
    if proposal["value"] not in VALUE_NAMES or proposal["perceived_intent"] not in (
            "beneficial", "neutral", "careless", "accidental", "unknown"):
        return None
    certainty = _number(proposal["confidence"], -1)
    if not 0 <= certainty <= observation["confidence"] * .65:
        return None
    return {**dict(proposal), "confidence": _clamp(certainty), "is_inference": True, "advisory_only": True}


def social_target_weights(state: Mapping[str, Any], owner: str, eligible_ids, now: datetime) -> dict[str, float]:
    """Multipliers for already eligible people; never introduce a new target."""
    moment = _now(now)
    result = {}
    interpretations = state.get("social_mind", {}).get("minds", {}).get(owner, {}).get("interpretations", {})
    for target in sorted(set(eligible_ids) - {owner}):
        if target not in state.get("residents", {}):
            continue
        edge = _edge(state, owner, target)
        affinity, trust = _number(edge.get("affinity"), 50), _number(edge.get("trust"), 50)
        comfort, tension, resentment = (_number(edge.get(key), fallback) for key, fallback in (("comfort", 50), ("tension", 0), ("resentment", 0)))
        weight = 1 + (affinity-50)*.007 + (trust-50)*.005 + (comfort-50)*.003 - tension*.006 - resentment*.008
        feelings = []
        for item in interpretations.values():
            if item.get("target_id") != target or (_time(item.get("created_at")) or moment) > moment:
                continue
            fact, observation = _known(state, owner, item["source_id"], moment)
            if not fact:
                continue
            age = (moment - _now(observation["learned_at"])).total_seconds() / 86400
            appraisal = item["appraisal"]
            feelings.append(appraisal["fairness"] * appraisal["confidence"] * 2**(-age/2))
        # One noisy encounter cannot drown out the established relationship.
        weight += _clamp(sum(feelings), -.4, .4)
        result[target] = _clamp(weight, .15, 2.5)
    return result
