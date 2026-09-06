"""A shared-meal commitment, driven by real LifeActions and food inventory.

No animation callback settles a meal. Invitations are proposals, not teleports
or forced interruptions. Normal urgent needs, schedules and resource leases win.
"""
from __future__ import annotations

from copy import deepcopy
from dataclasses import replace
from datetime import datetime, timedelta
from typing import Any, Mapping

from .life import stable_id, stable_fraction
from .npc_voice import voice_mode
from .dinner_copy import meal_line

FINAL = {"completed", "left_for_later", "cancelled"}


def at_home(resident: Mapping[str, Any]) -> bool:
    location = str(resident.get("current_location_id") or "")
    home = str(resident.get("home_location_id") or "")
    household = str(resident.get("household_id") or "")
    action = resident.get("current_action") or {}
    destination = str(action.get("location_id") or "")
    inside = location == home or bool(household and location.startswith(household + ":"))
    leaving = action.get("status") == "traveling" and destination != home and not destination.startswith(household + ":")
    return inside and not leaving


def traits(profile: Mapping[str, Any]) -> set[str]:
    values = profile.get("personality") or []
    return {str(value).lower() for value in (values if isinstance(values, list) else [values])}


def latest(state: Mapping[str, Any], household_id: str) -> dict | None:
    return (state.get("household_dinners") or {}).get(household_id)


def log(dinner: dict, key: str, now: datetime, en: str, zh: str, npc_id: str | None = None) -> None:
    if any(item["id"] == key for item in dinner["events"]):
        return
    dinner["events"].append({"id": key, "at": now.isoformat(), "npc_id": npc_id, "text": en, "text_zh": zh})
    dinner["updated_at"] = now.isoformat()


def response(resident: dict, profile: Mapping[str, Any], seed: str, *, cook: bool = False) -> tuple[str, str, str]:
    needs = (resident.get("runtime") or {}).get("needs") or {}
    action = resident.get("current_action") or {}
    mode = voice_mode(profile)
    if not at_home(resident):
        return "declined", "I'm out right now. Don't wait for me.", "我现在不在家，不用等我。"
    if action.get("action_type") in {"sleep", "shower"} or float(needs.get("rest", 60)) < 25:
        return "declined", *meal_line("tired", mode)
    if any(float(needs.get(key, 60)) < 20 for key in ("hygiene", "comfort")):
        return "declined", "I need to take care of something first.", "我得先照顾好自己的状态。"
    if not cook and float(needs.get("food", 50)) > 87:
        return "declined", *meal_line("full", mode)
    private = profile.get("privateSpacePreference") in {"high", "private", "alone"} or bool(traits(profile) & {"introverted", "reserved", "independent", "内向"})
    if private and stable_fraction(seed, resident["npc_id"], "quiet-meal") < .65:
        return "declined", *meal_line("alone", mode)
    if action.get("status") in {"performing", "traveling", "blocked"}:
        return "later", *meal_line("busy", mode)
    return "accepted", *meal_line("accepted", mode)


def propose(state: dict, profiles: Mapping[str, Mapping[str, Any]], household_id: str, now: datetime,
            game_date: str, *, source: str, cook_id: str | None = None) -> dict:
    if household_id not in state.get("households", {}):
        raise KeyError(household_id)
    existing = latest(state, household_id)
    # One opportunity per household/day. Repeated taps cannot reroll consent,
    # create unlimited food, or restart an unfinished meal across midnight.
    if existing and (existing["game_date"] == game_date or existing["phase"] not in FINAL):
        return existing
    members = sorted(key for key, value in state["residents"].items() if value.get("household_id") == household_id)
    dinner = {"id": stable_id("dinner", state["player_id"], household_id, game_date), "household_id": household_id,
              "game_date": game_date, "source": source, "phase": "proposed", "cook_id": None,
              "responses": {}, "eaten_ids": [], "portion_ids": [], "events": [], "requests": [],
              "created_at": now.isoformat(), "updated_at": now.isoformat(),
              "join_after": (now + timedelta(seconds=45)).isoformat(),
              "deadline": (now + timedelta(hours=2)).isoformat(), "cleanup_by": None, "together_ids": []}
    # Freeze only the voice category, never publicize persona axes. Edits during
    # dinner must not make the same resident switch speaking style mid-scene.
    dinner["voices"] = {key: voice_mode(profiles.get(key, {})) for key in members}
    state.setdefault("household_dinners", {})[household_id] = dinner
    log(dinner, "proposal", now, "A shared meal was suggested." if source == "player" else "Someone started preparing a meal for the house.",
        "你提议大家一起吃顿饭。" if source == "player" else "一位室友开始为家里准备一顿饭。")
    candidates = sorted(members, key=lambda key: (key != cook_id if cook_id else False,
                        not (traits(profiles.get(key, {})) & {"caring", "friendly", "warm", "热心"} or profiles.get(key, {}).get("householdRole") in {"cook", "caretaker"}), key))
    for key in candidates:
        resident = {**state["residents"][key], "npc_id": key}
        answer, en, zh = response(resident, profiles.get(key, {}), dinner["id"], cook=True)
        if key == cook_id or answer != "declined":
            dinner["cook_id"] = key
            break
    kitchen = next((item for item in state.get("resources", []) if item.get("household_id") == household_id and item.get("kind") == "kitchen" and item.get("state", {}).get("layout_available", True)), None)
    if not dinner["cook_id"] or len(members) < 2 or not kitchen or float(kitchen.get("state", {}).get("stock", 0)) < 12:
        dinner["phase"] = "cancelled"
        log(dinner, "unavailable", now, "The meal could not start: nobody is available to cook, or the kitchen needs supplies.", "这次没能开饭：暂时没人方便做饭，或厨房缺少可用食材。")
        return dinner
    for key in members:
        if key == dinner["cook_id"]:
            answer, en, zh = "accepted", *meal_line("invite", dinner["voices"][key])
        else:
            answer, en, zh = response({**state["residents"][key], "npc_id": key}, profiles.get(key, {}), dinner["id"])
        dinner["responses"][key] = {"status": answer, "text": en, "text_zh": zh}
        log(dinner, "invitation:" + key, now, en, zh, key)
    return dinner


def hint(state: dict, npc_id: str, now: datetime) -> str | None:
    resident = state["residents"][npc_id]
    dinner = latest(state, resident["household_id"])
    if not dinner or dinner["phase"] in FINAL or now >= datetime.fromisoformat(dinner["deadline"]) or not at_home(resident):
        return None
    answer = dinner["responses"].get(npc_id, {}).get("status")
    if answer not in {"accepted", "later"}:
        return None
    if dinner["phase"] in {"proposed", "preparing"}:
        if dinner["cook_id"] == npc_id and not dinner.get("prepared_action_id"):
            return "prepare_food"
        return "rest_alone" if int(dinner.get("premeal_wait_counts", {}).get(npc_id, 0)) < 8 else None
    if npc_id not in dinner["eaten_ids"] and any(food.get("dinner_id") == dinner["id"] and food.get("active", True) for food in state.get("household_food", [])):
        return "eat"
    if dinner["phase"] == "cleanup" and dinner.get("cleaner_id") == npc_id:
        return "clean_shared_space"
    if dinner["phase"] == "eating" and npc_id in dinner["eaten_ids"] and int(dinner.get("wait_counts", {}).get(npc_id, 0)) < 4:
        return "rest_alone"
    return None


def ready_to_switch(state: dict, npc_id: str, now: datetime) -> bool:
    resident = state["residents"][npc_id]
    meal = latest(state, resident["household_id"])
    action = resident.get("current_action") or {}
    desired = hint(state, npc_id, now)
    return bool(meal and desired and now >= datetime.fromisoformat(meal.get("join_after", meal["created_at"]))
                and action.get("status") == "performing" and action.get("interruptible", True)
                and action.get("action_type") in {"read", "practice_hobby", "use_television", "rest_alone"}
                and action.get("action_type") != desired)


def started(state: dict, profiles: Mapping[str, Mapping[str, Any]], npc_id: str, action: Any,
            now: datetime, game_date: str, period: str) -> None:
    resident = state["residents"][npc_id]
    if not at_home(resident):
        return
    household_id = resident["household_id"]
    dinner = latest(state, household_id)
    if action.action_type == "prepare_food" and period == "evening" and (not dinner or dinner["game_date"] != game_date):
        dinner = propose(state, profiles, household_id, now, game_date, source="autonomous", cook_id=npc_id)
    if not dinner or dinner["phase"] in FINAL:
        return
    if action.action_type == "rest_alone" and dinner["responses"].get(npc_id, {}).get("status") in {"accepted", "later"}:
        logged = dinner.setdefault("wait_action_ids", [])
        if action.id not in logged:
            logged.append(action.id)
            before_food = dinner["phase"] in {"proposed", "preparing"}
            counts = dinner.setdefault("premeal_wait_counts" if before_food else "wait_counts", {})
            counts[npc_id] = int(counts.get(npc_id, 0)) + 1
            en, zh = meal_line("waiting_food" if before_food else "waiting_others", dinner.get("voices", {}).get(npc_id, "measured"))
            log(dinner, ("waiting-food:" if before_food else "waiting:") + npc_id, now, en, zh, npc_id)
    if action.action_type == "prepare_food" and dinner["cook_id"] == npc_id and dinner["phase"] == "proposed":
        dinner["phase"] = "preparing"
        en, zh = meal_line("cooking", dinner.get("voices", {}).get(npc_id, "measured"))
        log(dinner, "cooking", now, en, zh, npc_id)


def prepared(state: dict, resident: dict, action: Any, resources: dict, now: datetime) -> None:
    dinner = latest(state, resident["household_id"])
    if not dinner or dinner["phase"] not in {"proposed", "preparing"} or dinner["cook_id"] != action.npc_id:
        return
    portions = [item for item in state["household_food"] if item.get("prepared_action_id") == action.id]
    if not portions:
        return
    wanted = sum(value["status"] in {"accepted", "later"} for value in dinner["responses"].values())
    resource = resources.get(action.target_resource_id)
    while len(portions) < wanted and resource and float(resource.state.get("stock", 0)) >= 3:
        item = {**portions[0], "id": stable_id("dinner-portion", action.id, len(portions))}
        state["household_food"].append(item); portions.append(item)
        resource = replace(resource, state={**resource.state, "stock": float(resource.state.get("stock", 0)) - 3})
        resources[resource.id] = resource
    for item in portions:
        item.update(dinner_id=dinner["id"], access="shared")
    dinner.update(phase="served", prepared_action_id=action.id, portion_ids=[item["id"] for item in portions])
    log(dinner, "served", now, f"Food is ready. There are {len(portions)} portions to share.", f"饭做好了，有 {len(portions)} 份可以分享。", action.npc_id)


def completed(state: dict, resident: dict, action: Any, now: datetime) -> None:
    dinner = latest(state, resident["household_id"])
    if not dinner or dinner["phase"] in FINAL:
        return
    if action.action_type == "eat":
        portion = next((item for item in state.get("household_food", []) if item.get("consumed_action_id") == action.id and item.get("dinner_id") == dinner["id"]), None)
        if portion and action.npc_id not in dinner["eaten_ids"]:
            dinner["eaten_ids"].append(action.npc_id)
            dinner["phase"] = "eating"
            en, zh = meal_line("ate", dinner.get("voices", {}).get(action.npc_id, "measured"))
            log(dinner, "ate:" + action.npc_id, now, en, zh, action.npc_id)
    if action.action_type == "clean_shared_space" and dinner["phase"] == "cleanup":
        dinner.update(phase="completed", cleanup_by=action.npc_id)
        en, zh = meal_line("cleaned", dinner.get("voices", {}).get(action.npc_id, "measured"))
        log(dinner, "cleaned", now, en, zh, action.npc_id)


def advance(state: dict, profiles: Mapping[str, Mapping[str, Any]], now: datetime) -> None:
    for household_id, dinner in (state.get("household_dinners") or {}).items():
        if dinner["phase"] in FINAL:
            continue
        residents = state["residents"]
        eaters = sorted(key for key in dinner["responses"] if key in residents and at_home(residents[key])
                        and (residents[key].get("current_action") or {}).get("status") == "performing"
                        and (residents[key].get("current_action") or {}).get("action_type") == "eat")
        if eaters and dinner["phase"] == "served":
            dinner["phase"] = "eating"
        if len(eaters) >= 2 and dinner.get("prepared_action_id") and not dinner["together_ids"]:
            dinner["together_ids"] = eaters
            log(dinner, "together", now, "They sat down to eat at the same time.", "他们在同一时间坐下来吃饭了。")
        expired = now >= datetime.fromisoformat(dinner["deadline"])
        expected = [key for key, value in dinner["responses"].items() if value["status"] in {"accepted", "later"}]
        remaining = any(food.get("dinner_id") == dinner["id"] and food.get("active", True) for food in state.get("household_food", []))
        done_eating = bool(dinner["eaten_ids"]) and (all(key in dinner["eaten_ids"] for key in expected) or not remaining)
        if dinner["phase"] in {"served", "eating"} and (done_eating or expired):
            dinner["phase"] = "cleanup"
            dinner["deadline"] = (now + timedelta(minutes=45)).isoformat()
            for key in expected:
                if key not in dinner["eaten_ids"]:
                    log(dinner, "missed:" + key, now, "I couldn't make it in time. Please don't wait.", "我没能及时过来，不用继续等我。", key)
            cleaner = next((key for key in expected if key in residents and at_home(residents[key])
                            and float(residents[key]["runtime"]["needs"].get("rest", 60)) >= 35
                            and (traits(profiles.get(key, {})) & {"tidy", "reliable", "caring", "整洁"}
                                 or "dishes" in profiles.get(key, {}).get("chorePreferences", []))), None)
            dinner["cleaner_id"] = cleaner
            en, zh = (meal_line("cleanup", dinner.get("voices", {}).get(cleaner, "measured")) if cleaner
                      else ("The dishes are still there. Nobody has offered to clean yet.", "餐具还留着，暂时没人主动收拾。"))
            log(dinner, "cleanup", now, en, zh, cleaner)
        elif expired:
            dinner["phase"] = "left_for_later" if dinner.get("prepared_action_id") else "cancelled"
            log(dinner, "timeout", now, "The meal has ended. Unfinished food and chores remain part of home life.", "这顿饭告一段落，没吃的饭和没做完的家务仍留在生活里。")


def request_cleanup(state: dict, profiles: Mapping[str, Mapping[str, Any]], household_id: str, now: datetime) -> None:
    dinner = latest(state, household_id)
    if dinner and "cleanup" in dinner["requests"]:
        return
    if not dinner or dinner["phase"] != "cleanup":
        raise ValueError("cleanup is not available")
    dinner["requests"].append("cleanup")
    log(dinner, "cleanup-request", now, "You asked whether someone could help wash up.", "你询问有没有人愿意帮忙收拾。")
    for key in dinner["eaten_ids"]:
        resident = state["residents"].get(key)
        if not resident or not at_home(resident):
            continue
        willing = float(resident["runtime"]["needs"].get("rest", 60)) >= 35 and not traits(profiles.get(key, {})) & {"messy", "impulsive", "随性"}
        en, zh = meal_line("cleanup" if willing else "no_cleanup", dinner.get("voices", {}).get(key, "measured"))
        log(dinner, "cleanup-answer:" + key, now, en, zh, key)
        if willing:
            dinner["cleaner_id"] = key
            break


def public_dinner(state: Mapping[str, Any], household_id: str) -> dict | None:
    dinner = latest(state, household_id)
    if not dinner:
        return None
    fields = ("id", "game_date", "source", "phase", "cook_id", "responses", "eaten_ids", "events", "created_at", "updated_at", "deadline", "cleanup_by", "together_ids", "requests")
    result = {key: deepcopy(dinner[key]) for key in fields}
    result["remaining_portions"] = sum(item.get("dinner_id") == dinner["id"] and item.get("active", True) for item in state.get("household_food", []))
    result["dirty_dishes"] = int((state["households"][household_id].get("state") or {}).get("dirty_dishes", 0))
    return result
