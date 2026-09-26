"""有限的生活心事、真实承诺回执与公开转告；不调用 AI，不依赖轮询次数。"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping

from . import social_mind, pair_memory
from .life import stable_id

VERSION = 1
FINAL = {"addressed", "let_go", "expired"}
PUBLIC_ACTS = {"prepare_food", "clean_shared_space"}
SOCIAL_ACTIONS = {"talk_to_resident", "seek_company", "read", "practice_hobby", "use_television"}
FOLLOWUP_RESPONSES = {"hear_out", "defer", "keep_distance", "acknowledge"}


def clock(value: str | datetime) -> datetime:
    result = value if isinstance(value, datetime) else datetime.fromisoformat(value)
    return result.replace(tzinfo=timezone.utc) if result.tzinfo is None else result


def ensure(state: dict, profiles: Mapping, now: datetime) -> dict:
    bank = state.setdefault("social_continuity", {})
    bank.setdefault("version", VERSION)
    bank.setdefault("initialized_at", now.isoformat())
    for key in ("concerns", "receipts", "encounters"):
        bank.setdefault(key, {})
    bank.setdefault("processed_sources", [])
    for owner in state.get("residents", {}):
        bank["concerns"].setdefault(owner, [])
    return bank


def public_location(state: Mapping, owner: str, location: str | None) -> bool:
    if not location:
        return False
    resident = state.get("residents", {}).get(owner, {})
    if location == resident.get("home_location_id"):
        return False  # 旧的笼统 home 坐标不是可证明共处的房间。
    if location.startswith(str(resident.get("household_id", "")) + ":"):
        return any(part in location.split(":") for part in ("living-room", "living_room", "kitchen", "shared-kitchen"))
    return not any(part in location.casefold() for part in ("bedroom", "bathroom", "private", "shower"))


def add_concern(state: dict, owner: str, target: str, kind: str, source: str,
                topic: str, now: datetime, *, details: Mapping | None = None,
                immediate: bool = False) -> dict | None:
    bank = ensure(state, {}, now)
    if owner == target or owner not in bank["concerns"] or target not in state.get("residents", {}):
        return None
    items = bank["concerns"][owner]
    concern_id = stable_id("concern", owner, target, kind, source)
    existing = next((item for item in items if item["id"] == concern_id), None)
    if existing:
        return existing
    # 一件心事不能被同类片段反复刷新为永远无法淡去；拒绝后不换来源继续纠缠。
    if any(item["target_id"] == target and item["kind"] == kind
           and now - clock(item["created_at"]) < timedelta(hours=24) for item in items):
        return None
    if len([item for item in items if item["status"] not in FINAL]) >= 4:
        return None
    item = {"id": concern_id, "kind": kind, "owner_id": owner, "target_id": target,
            "source_fact_id": source, "source_topic": topic, "created_at": now.isoformat(),
            "expires_at": (now + timedelta(days=2 if kind == "relay" else 4)).isoformat(),
            "next_attempt_at": (now + timedelta(minutes=0 if immediate else 25)).isoformat(),
            "attempts": 0, "status": "pending", "details": deepcopy(dict(details or {}))}
    items.append(item)
    bank["concerns"][owner] = items[-12:]
    return item


def maintain(state: dict, profiles: Mapping, now: datetime) -> None:
    bank = ensure(state, profiles, now)
    for owner, items in bank["concerns"].items():
        action = state.get("residents", {}).get(owner, {}).get("current_action") or {}
        for item in items:
            if item["status"] in FINAL:
                continue
            if now >= clock(item["expires_at"]) or not social_mind.source_known(state, owner, item["source_fact_id"], now):
                item["status"] = "expired"
            elif item.get("assigned_action_id") and action.get("id") != item["assigned_action_id"]:
                item.pop("assigned_action_id", None)
                item["status"] = "let_go" if item["attempts"] >= 2 else "pending"
                item["next_attempt_at"] = (now + timedelta(hours=6)).isoformat()
    if len(bank["receipts"]) > 160:
        finished = sorted((x for x in bank["receipts"].values() if x["status"] != "accepted"),
                          key=lambda x: (x.get("updated_at", ""), x["id"]))
        for item in finished[:len(bank["receipts"]) - 160]:
            bank["receipts"].pop(item["id"], None)
    bank["processed_sources"] = bank["processed_sources"][-800:]
    if len(bank["encounters"]) > 160:
        bank["encounters"] = dict(list(bank["encounters"].items())[-160:])


def ready(state: Mapping, owner: str, eligible: tuple[str, ...], now: datetime) -> dict | None:
    result = []
    for item in state.get("social_continuity", {}).get("concerns", {}).get(owner, []):
        target = state.get("residents", {}).get(item["target_id"], {})
        action = target.get("current_action") or {}
        if (item["status"] != "pending" or item["target_id"] not in eligible
                or item["attempts"] >= 2 or not clock(item["next_attempt_at"]) <= now < clock(item["expires_at"])
                or action.get("status") != "performing"
                or action.get("action_type") not in SOCIAL_ACTIONS
                or not public_location(state, item["target_id"], target.get("current_location_id"))):
            continue
        if not social_mind.source_known(state, owner, item["source_fact_id"], now):
            continue
        if any(item["target_id"] in activity.get("participants", []) and activity.get("phase") in {"forming", "active"}
               for activity in state.get("shared_activities", {}).values()):
            continue
        result.append(item)
    return min(result, key=lambda x: (x["created_at"], x["id"])) if result else None


def weights(state: Mapping, owner: str, eligible: tuple[str, ...], now: datetime) -> dict:
    result = {key: (value - 1) * 40 for key, value in social_mind.social_target_weights(state, owner, eligible, now).items()}
    for item in state.get("social_continuity", {}).get("concerns", {}).get(owner, []):
        if item["target_id"] not in result or now >= clock(item["expires_at"]):
            continue
        if not social_mind.source_known(state, owner, item["source_fact_id"], now):
            continue
        if item["status"] == "let_go":
            result[item["target_id"]] -= 24
        elif item["status"] == "pending" and now >= clock(item["next_attempt_at"]):
            result[item["target_id"]] += 20
    return result


def assigned(state: dict, owner: str, concern: dict, action: Any, now: datetime) -> None:
    concern.update({"assigned_action_id": action.id, "status": "approaching",
                    "attempts": concern["attempts"] + 1})


def annotate_observable(state: Mapping, npc_id: str, action: Mapping, observable: dict,
                        target_name: str | None = None) -> dict:
    item = next((x for x in state.get("social_continuity", {}).get("concerns", {}).get(npc_id, [])
                 if x.get("assigned_action_id") == action.get("id") and x["status"] == "approaching"), None)
    if not item:
        return observable
    result = dict(observable)
    target = target_name or item["target_id"]
    if action.get("status") == "traveling":
        result.update({"visible_intent": f"On the way to see {target}", "visible_intent_zh": f"正在去找{target}"})
    elif action.get("status") == "performing":
        result.update({"visible_intent": f"Waiting to speak with {target}", "visible_intent_zh": f"在等{target}说会儿话"})
    return result


def collision_fact(collision: Mapping, resolution: Mapping, now: datetime) -> dict:
    return {"id": str(collision["id"]) + ":settled:" + str(resolution.get("id", "autonomous")),
            "kind": collision.get("kind", "person_person"),
            "memory_source_id": str(collision["id"]),
            "topic": collision.get("topic", ""), "occurred_at": now.isoformat(),
            "participant_ids": list(collision.get("participant_ids", [])),
            "location_id": collision.get("location_id"), "visibility": "participants",
            "outcome_tags": list(resolution.get("outcome_tags", [])),
            "facts": {**dict(collision.get("facts") or {}),
                      "outcome_tags": list(resolution.get("outcome_tags", [])),
                      "response_by_participant": dict(resolution.get("response_by_participant", {}))}}


def settled(state: dict, profiles: Mapping, collision: Mapping, resolution: Mapping, now: datetime) -> dict:
    bank = ensure(state, profiles, now)
    fact = collision_fact(collision, resolution, now)
    if fact["id"] in bank["processed_sources"]:
        return fact
    social_mind.observe_fact(state, profiles, fact, now)
    bank["processed_sources"].append(fact["id"])
    participants = list(collision.get("participant_ids", []))
    topic = str(collision.get("topic", ""))
    if len(participants) != 2 or topic in {"social_followup", "public_relay"}:
        return fact
    # 普通每次陪伴不变成待办；只有确有未尽事项、帮助或落空才产生小规模后续。
    tags = set(resolution.get("outcome_tags", []))
    details = collision.get("facts") or {}
    if topic == "missed_connection":
        actor = str(details.get("initiator_id") or details.get("actor_id") or "")
        if actor not in participants:
            return fact
        other = next(key for key in participants if key != actor)
        add_concern(state, actor, other, "check_in", fact["id"], topic, now)
    elif "conflict" in tags and topic in {"borrowed_property", "noise", "dishwashing", "unequal_care"}:
        actor = str(details.get("borrower_id") or details.get("actor_id") or details.get("created_by") or "")
        if actor not in participants:
            return fact  # 无明确责任方时不按姓名排序把一个人写成肇事者。
        target = next((key for key in participants if key != actor), None)
        personal = social_mind.persona_values(profiles.get(actor, {}))["values"]
        willing = max(personal.get("care", 0), personal.get("honesty", 0), personal.get("fairness", 0)) >= .6
        if target and (willing or social_mind.social_target_weights(state, actor, (target,), now).get(target, 0) >= .95):
            add_concern(state, actor, target, "repair", fact["id"], topic, now)
    elif "cooperation" in tags and topic in {"dishwashing", "shared_food", "unequal_care"}:
        owner, target = participants
        add_concern(state, owner, target, "thank", fact["id"], topic, now)
    return fact


def _receipt(state: dict, profiles: Mapping, item: dict, now: datetime) -> None:
    bank = ensure(state, profiles, now)
    old = bank["receipts"].get(item["id"])
    if old and old["status"] == item["status"]:
        return
    bank["receipts"][item["id"]] = item
    if item["status"] == "accepted":
        return
    source = item["id"] + ":" + item["status"]
    if source in bank["processed_sources"]:
        return
    bank["processed_sources"].append(source)
    fact = {"id": source, "kind": "commitment_receipt", "topic": "shared_activity",
            "occurred_at": now.isoformat(), "participant_ids": item["participants"],
            "location_id": item["location_id"], "visibility": "participants",
            "outcome_tags": ["kept_promise"] if item["status"] == "fulfilled" else [],
            "facts": {"receipt_status": item["status"], "commitment_id": item["id"],
                      "activity_kind": item["kind"]}}
    if item["kind"] == "scheduled_meeting":
        pair_memory.capture(state, {"id": source, "topic": "shared_activity",
            "facts": {"activity_kind": "scheduled_meeting", "activity_phase": item["status"]}},
            {"outcome_tags": fact["outcome_tags"]},
            [{"npc_id": owner, "other_npc_id": target} for owner in item["participants"]
             for target in item["participants"] if owner != target], now)
        fact["memory_source_id"] = source
    else:
        fact["memory_source_id"] = item["id"] + ":" + str(item.get("activity_phase", "completed"))
    social_mind.observe_fact(state, profiles, fact, now)
    if len(item["participants"]) != 2:
        return
    a, b = item["participants"]
    if item["status"] == "fulfilled":
        add_concern(state, a, b, "thank", source, "shared_activity", now)
    elif item["status"] == "missed":
        # 没完成只表示落空。不能在没有原因和单方知情时认定背叛/懒惰。
        for owner, target in ((a, b), (b, a)):
            kind = "check_in" if owner in item.get("fulfilled_ids", []) else "explain"
            add_concern(state, owner, target, kind, source, "shared_activity", now)


def sync_receipts(state: dict, profiles: Mapping, now: datetime) -> None:
    bank = ensure(state, profiles, now)
    initialized_at = clock(bank["initialized_at"])
    records = {(r.get("collision") or {}).get("id"): r for r in state.get("stories", {}).values() if r.get("collision")}
    for activity in state.get("shared_activities", {}).values():
        if clock(activity.get("updated_at", activity["created_at"])) < now - timedelta(days=7):
            continue
        if activity["phase"] in {"invited", "declined"}:
            continue  # 拒绝邀请不是接受后违约。
        if (activity["phase"] in {"completed", "missed", "interrupted"}
                and clock(activity.get("updated_at", activity["created_at"])) < initialized_at
                and activity["id"] not in bank["receipts"]):
            continue  # 升级旧存档不把过去的终态当作刚刚发生的新心事。
        # 仅 forming/active 或确实获得双方同意后产生的终态算承诺。
        record = records.get(activity.get("collision_id"), {})
        answers = (record.get("resolution") or {}).get("response_by_participant", {})
        agreed = all(answers.get(key) in {"welcome_company", "share_activity", "enjoy_silence"}
                     for key in activity["participants"])
        if activity["kind"] != "reading" and "enjoy_silence" in answers.values():
            agreed = False
        if activity["phase"] not in {"forming", "active", "completed"} and not agreed:
            continue
        intervals = [activity.get("actions", {}).get(key, {}) for key in activity["participants"]]
        physically_completed = (set(activity.get("completed_ids", [])) == set(activity["participants"])
            and all(value.get("start") and value.get("end") for value in intervals)
            and (min(clock(value["end"]) for value in intervals) - max(clock(value["start"]) for value in intervals)).total_seconds() >= 60)
        status = "fulfilled" if activity["phase"] == "completed" and physically_completed else "missed" if activity["phase"] in {"missed", "interrupted", "completed"} else "accepted"
        _receipt(state, profiles, {"id": activity["id"], "kind": activity["kind"],
                 "participants": list(activity["participants"]), "status": status,
                 "activity_phase": activity["phase"],
                 "accepted_at": activity["created_at"], "due_at": activity["deadline"],
                 "location_id": activity["location_id"], "updated_at": now.isoformat(),
                 "action_ids": dict(activity.get("assigned_actions", {})),
                 "fulfilled_ids": list(activity.get("completed_ids", []))}, now)
    groups: dict[str, list[tuple[str, dict]]] = {}
    for owner, resident in state.get("residents", {}).items():
        for plan in resident.get("daily_plans", {}).values():
            for block in plan.get("blocks", []):
                target = block.get("target_npc_id")
                if block.get("kind") != "accepted_invitation" or target not in state["residents"]:
                    continue
                if clock(block["ends_at"]) < now - timedelta(days=7):
                    continue
                if clock(block["ends_at"]) < initialized_at:
                    continue
                key = stable_id("schedule-receipt", sorted((owner, target)), block["starts_at"], block["location_id"])
                groups.setdefault(key, []).append((owner, block))
    for key, blocks in groups.items():
        if len(blocks) != 2:
            continue  # 单方面的日程文本不是双方承诺。
        block = blocks[0][1]
        completed = [owner for owner, raw in blocks if raw.get("completed_at") and raw.get("attended_at")]
        # 到过相同地点但不同时间，不算两人共同履约。
        overlap = (min(clock(raw["completed_at"]) for _, raw in blocks)
                   - max(clock(raw["attended_at"]) for _, raw in blocks)).total_seconds() if len(completed) == 2 else 0
        status = "fulfilled" if overlap >= 60 else "missed" if now >= clock(block["ends_at"]) else "accepted"
        _receipt(state, profiles, {"id": key, "kind": "scheduled_meeting",
                 "participants": sorted(owner for owner, _ in blocks), "status": status,
                 "accepted_at": block["starts_at"], "due_at": block["ends_at"],
                 "location_id": block["location_id"], "updated_at": now.isoformat(),
                 "fulfilled_ids": completed}, now)


def action_completed(state: dict, profiles: Mapping, action: Any, now: datetime) -> None:
    """第三人只能转告确实看见的公共劳动，不传播卧室/浴室或脑内猜测。"""
    if action.action_type not in PUBLIC_ACTS or not public_location(state, action.npc_id, action.location_id):
        return
    bank = ensure(state, profiles, now)
    source = stable_id("public-action", action.id)
    if source in bank["processed_sources"]:
        return
    bank["processed_sources"].append(source)
    witnesses = [owner for owner, r in sorted(state["residents"].items())
                 if owner != action.npc_id and r.get("current_location_id") == action.location_id
                 and (r.get("current_action") or {}).get("status") == "performing"]
    if not witnesses:
        return
    actor = state["residents"][action.npc_id]
    facts = {"actor_id": action.npc_id, "action_type": action.action_type,
             "completed_at": now.isoformat(), "public_action_completed": True}
    fact = {"id": source, "kind": "public_action", "topic": "household_help",
            "occurred_at": now.isoformat(), "participant_ids": [action.npc_id],
            "witness_ids": witnesses, "visibility": "public", "location_id": action.location_id, "facts": facts}
    social_mind.observe_fact(state, profiles, fact, now)
    actual_witnesses = [key for key in witnesses if source in state.get("social_mind", {}).get("minds", {}).get(key, {}).get("observations", {})]
    for witness in actual_witnesses[:1]:
        absent = [key for key, r in sorted(state["residents"].items())
                  if key not in {action.npc_id, *witnesses} and r.get("household_id") == actor.get("household_id")]
        if absent:
            target = max(absent, key=lambda key: weights(state, witness, tuple(absent), now).get(key, 0))
            add_concern(state, witness, target, "relay", source, "household_help", now,
                        details={"source_participants": [action.npc_id], "source_action_type": action.action_type,
                                 "source_location_id": action.location_id, "source_occurred_at": now.isoformat(),
                                 "witness_id": witness})


def encounter_candidates(state: dict, profiles: Mapping, now: datetime) -> list[dict]:
    bank = ensure(state, profiles, now)
    result = []
    for owner, items in sorted(bank["concerns"].items()):
        actor = state["residents"].get(owner, {})
        action = actor.get("current_action") or {}
        for concern in items:
            if (concern["status"] != "approaching" or concern.get("assigned_action_id") != action.get("id")
                    or action.get("status") != "performing" or not action.get("started_at")
                    or now - clock(action["started_at"]) < timedelta(seconds=30)):
                continue
            if not social_mind.source_known(state, owner, concern["source_fact_id"], now):
                concern["status"] = "expired"
                concern.pop("assigned_action_id", None)
                continue
            target = concern["target_id"]
            other = state["residents"].get(target, {})
            other_action = other.get("current_action") or {}
            if (other_action.get("status") != "performing"
                    or not other_action.get("started_at")
                    or now - clock(other_action["started_at"]) < timedelta(seconds=30)
                    or actor.get("current_location_id") != other.get("current_location_id")
                    or not public_location(state, owner, actor.get("current_location_id"))):
                continue
            encounter_id = stable_id("social-followup", concern["id"], action["id"])
            if encounter_id in bank["encounters"]:
                continue
            needs = (other.get("runtime") or {}).get("needs", {})
            stress = (other.get("runtime") or {}).get("emotion", {}).get("stress", 30)
            preference = social_mind.social_target_weights(state, target, (owner,), now).get(owner, 0)
            if preference < .45:
                response = "keep_distance"
            elif min(needs.get("rest", 70), needs.get("privacy", 70), needs.get("food", 70)) < 26 or stress > 74:
                response = "defer"
            elif other_action.get("action_type") not in SOCIAL_ACTIONS:
                response = "defer"
            else:
                response = "acknowledge" if concern["kind"] in {"relay", "thank"} else "hear_out"
            details = dict(concern.get("details", {}))
            if concern["kind"] == "relay":
                known = social_mind.perspective(state, owner, [owner, target, *details.get("source_participants", [])], before=now)
                if not any(value.get("source_id") == concern["source_fact_id"] and value.get("channel") in {"participant", "witness"}
                           for value in known.get("observations", [])):
                    concern["status"] = "expired"
                    concern.pop("assigned_action_id", None)
                    continue
            fact = {"followup_kind": concern["kind"], "source_topic": concern["source_topic"],
                    "source_fact_id": concern["source_fact_id"], "actor_id": owner, "affected_id": target,
                    "source_participants": details.get("source_participants", [owner, target]), **details}
            item = {"id": encounter_id, "concern_id": concern["id"], "owner_id": owner, "target_id": target,
                    "topic": "public_relay" if concern["kind"] == "relay" else "social_followup",
                    "action_ids": [action["id"], other_action["id"]], "location_id": actor["current_location_id"],
                    "facts": fact, "response": response, "occurred_at": now.isoformat()}
            item["expression_perspectives"] = {key: social_mind.perspective(
                state, key, [owner, target, *details.get("source_participants", [])], before=now,
            ) for key in (owner, target)}
            bank["encounters"][encounter_id] = item
            concern["status"] = "pending" if response == "defer" and concern["attempts"] < 2 else "let_go" if response in {"defer", "keep_distance"} else "addressed"
            concern.pop("assigned_action_id", None)
            concern["next_attempt_at"] = (now + timedelta(hours=12)).isoformat()
            concern["last_response"] = response
            if concern["kind"] == "relay" and response == "acknowledge":
                # 转告只扩散带来源的公共动作事实；知晓做过饭不等于一起吃过/欠人情。
                learned = social_mind.relay_fact(state, profiles, concern["source_fact_id"], owner, target, now,
                                                report_id=encounter_id + ":report")
                source_actor = next(iter(details.get("source_participants", [])), None)
                if learned and source_actor:
                    add_concern(state, target, source_actor, "check_in", concern["source_fact_id"],
                                "household_help", now)
            result.append(item)
    return result


def next_transitions(state: Mapping, after: datetime) -> list[datetime]:
    result = []
    for owner, items in state.get("social_continuity", {}).get("concerns", {}).items():
        action = state.get("residents", {}).get(owner, {}).get("current_action") or {}
        for item in items:
            if item["status"] in FINAL:
                continue
            if item["status"] == "approaching" and item.get("assigned_action_id") == action.get("id") and action.get("started_at"):
                target_action = state.get("residents", {}).get(item["target_id"], {}).get("current_action") or {}
                start = max(clock(action["started_at"]), clock(target_action.get("started_at") or action["started_at"]))
                ready_at = start + timedelta(seconds=30)
                if ready_at > after:
                    result.append(ready_at)
            expiry = clock(item["expires_at"])
            if expiry > after:
                result.append(expiry)
    return result
