from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, timezone
from typing import Any, Mapping, Sequence


RELATIONSHIP_STAGES = (
    (20, "stranger"),
    (50, "acquaintance"),
    (80, "friend"),
    (101, "close_friend"),
)


def _clamp(value: float, low: float = 0, high: float = 100) -> int:
    return round(max(low, min(high, value)))


def relationship_stage(value: int) -> str:
    return next(stage for ceiling, stage in RELATIONSHIP_STAGES if value < ceiling)


def compile_persona(profile: Mapping[str, Any], growth: Mapping[str, float] | None = None) -> dict[str, Any]:
    """Compile free-form customization into a stable, prompt-ready behavior contract."""
    traits = [str(value).strip() for value in profile.get("personality", ()) if str(value).strip()]
    text = " ".join(traits).casefold()
    axes = {"warmth": 55, "extraversion": 50, "assertiveness": 50,
            "openness": 55, "emotional_stability": 55, "humor": 40}
    rules = (
        (("kind", "warm", "friendly", "温柔", "善良", "友好"), "warmth", 25),
        (("cold", "distant", "冷淡", "高冷"), "warmth", -25),
        (("introvert", "quiet", "shy", "内向", "安静", "害羞"), "extraversion", -28),
        (("extrovert", "outgoing", "energetic", "外向", "活泼", "开朗"), "extraversion", 28),
        (("bold", "confident", "direct", "自信", "大胆", "直接"), "assertiveness", 25),
        (("gentle", "soft", "温和", "体贴"), "assertiveness", -15),
        (("creative", "curious", "创造", "好奇", "艺术"), "openness", 28),
        (("practical", "traditional", "务实", "传统"), "openness", -15),
        (("calm", "steady", "冷静", "沉稳"), "emotional_stability", 25),
        (("sensitive", "anxious", "敏感", "焦虑"), "emotional_stability", -24),
        (("funny", "witty", "sarcastic", "幽默", "毒舌"), "humor", 30),
        (("serious", "严肃", "认真"), "humor", -20),
    )
    for words, axis, delta in rules:
        if any(word in text for word in words):
            axes[axis] += delta
    for axis, delta in (growth or {}).items():
        if axis in axes:
            axes[axis] += float(delta)
    axes = {key: _clamp(value) for key, value in axes.items()}

    voice = {
        "sentence_length": "short" if axes["extraversion"] < 35 else "varied" if axes["openness"] > 70 else "medium",
        "directness": "direct" if axes["assertiveness"] > 68 else "gentle" if axes["assertiveness"] < 38 else "balanced",
        "emotional_expression": "open" if axes["warmth"] + axes["extraversion"] > 130 else "subtle",
        "humor_style": "dry" if "sarcastic" in text or "毒舌" in text else "playful" if axes["humor"] > 65 else "rare",
        "question_frequency": "low" if axes["extraversion"] < 35 else "natural",
    }
    behavior = {
        "initiative": "low" if axes["extraversion"] < 35 else "high" if axes["extraversion"] > 70 else "moderate",
        "conflict_style": "avoidant" if axes["assertiveness"] < 38 else "direct" if axes["assertiveness"] > 70 else "measured",
        "support_style": "listen_before_advice" if axes["warmth"] > 65 else "practical" if axes["assertiveness"] > 60 else "reserved",
    }
    identity = {key: profile.get(key, "") for key in ("name", "age", "relationship", "occupation", "longTermGoal")}
    source = json.dumps({"identity": identity, "traits": traits, "interests": profile.get("interests", []),
                         "growth": growth or {}},
                        ensure_ascii=False, sort_keys=True)
    return {"version": "persona-v1-" + hashlib.sha256(source.encode()).hexdigest()[:10],
            "identity": identity, "traits": traits, "interests": list(profile.get("interests", [])),
            "axes": axes, "voice": voice, "behavior": behavior}


def initial_runtime(stats_mood: int, relationship: int, now: datetime | None = None) -> dict[str, Any]:
    moment = now or datetime.now(timezone.utc)
    return {
        "emotion": {"valence": _clamp(stats_mood), "stress": 38, "energy": 68},
        "needs": {"food": 72, "rest": 70, "social": 58, "achievement": 55,
                  "love": _clamp(30 + relationship * .45)},
        "growth": {"warmth": 0.0, "extraversion": 0.0, "assertiveness": 0.0,
                   "openness": 0.0, "emotional_stability": 0.0, "humor": 0.0},
        "last_simulated_at": moment.isoformat(),
    }


def advance_runtime(state: Mapping[str, Any], profile: Mapping[str, Any], stats_mood: int,
                    now: datetime | None = None) -> dict[str, Any]:
    """Lazily advance needs; cap catch-up so abandoned accounts recover gracefully."""
    moment = now or datetime.now(timezone.utc)
    result = json.loads(json.dumps(state))
    try:
        previous = datetime.fromisoformat(str(result["last_simulated_at"]))
        if previous.tzinfo is None:
            previous = previous.replace(tzinfo=timezone.utc)
    except (KeyError, TypeError, ValueError):
        previous = moment
    hours = max(0.0, min(168.0, (moment - previous).total_seconds() / 3600))
    day_cycles = hours / 24
    needs = result.setdefault("needs", {})
    persona = compile_persona(profile, result.get("growth"))
    introvert = persona["axes"]["extraversion"] < 40
    # Daily plans imply ordinary meals, sleep, work and leisure even while the
    # player is offline; only unmet residue accumulates across days.
    needs["food"] = _clamp(float(needs.get("food", 70)) - hours * 1.2 + day_cycles * 25)
    needs["rest"] = _clamp(float(needs.get("rest", 70)) - hours * .75 + day_cycles * 18)
    needs["social"] = _clamp(float(needs.get("social", 55)) - hours * (.35 if introvert else .65) + day_cycles * (5 if introvert else 9))
    needs["achievement"] = _clamp(float(needs.get("achievement", 55)) - hours * .3 + day_cycles * 7)
    needs["love"] = _clamp(float(needs.get("love", 50)) - hours * .15)
    emotion = result.setdefault("emotion", {})
    strain = sum(max(0, 35 - float(needs.get(key, 50))) for key in ("food", "rest", "social")) / 3
    emotion["energy"] = _clamp(float(emotion.get("energy", 65)) - hours * .35 + max(0, float(needs["rest"]) - 70) * .03)
    emotion["stress"] = _clamp(float(emotion.get("stress", 40)) + strain * .08 - hours * .05)
    emotion["valence"] = _clamp(stats_mood * .7 + (100 - float(emotion["stress"])) * .3)
    result["last_simulated_at"] = moment.isoformat()
    return result


def initial_relationship(overall: int) -> dict[str, Any]:
    return {"familiarity": _clamp(overall), "trust": _clamp(overall * .8),
            "closeness": _clamp(max(0, overall - 10)), "stage": relationship_stage(overall)}


def advance_relationship(current: Mapping[str, Any], delta: int, signals: Sequence[str]) -> dict[str, Any]:
    result = dict(current)
    supportive = len(set(signals) & {"empathy", "encouragement", "honesty", "practical_help", "reassurance"})
    result["familiarity"] = _clamp(float(result.get("familiarity", 35)) + max(-2, min(3, delta)))
    result["trust"] = _clamp(float(result.get("trust", 28)) + max(-3, min(3, delta)) + supportive * .5)
    result["closeness"] = _clamp(float(result.get("closeness", 25)) + max(-2, min(2, delta)) + supportive * .25)
    overall = round((result["familiarity"] + result["trust"] + result["closeness"]) / 3)
    result["stage"] = relationship_stage(overall)
    return result


def compile_goal(profile: Mapping[str, Any]) -> dict[str, Any]:
    title = str(profile.get("longTermGoal", "")).strip() or "Build a meaningful everyday life"
    occupation = str(profile.get("occupation", "")).casefold()
    interests = " ".join(map(str, profile.get("interests", ()))).casefold()
    theme = occupation + " " + interests + " " + title.casefold()
    if any(word in theme for word in ("music", "song", "concert", "音乐", "演出")):
        names = (("Choose a creative direction", "确定创作方向"), ("Finish a first piece", "完成第一件作品"),
                 ("Share it with someone trusted", "向信任的人分享"), ("Perform it publicly", "进行公开演出"))
    elif any(word in theme for word in ("art", "design", "paint", "photo", "艺术", "设计", "摄影")):
        names = (("Define the story", "确定作品故事"), ("Create a small collection", "创作小型作品集"),
                 ("Ask for honest feedback", "寻求真实反馈"), ("Present the finished work", "展示完成的作品"))
    else:
        names = (("Clarify the next step", "明确下一步"), ("Build a steady routine", "建立稳定节奏"),
                 ("Take a meaningful risk", "尝试有意义的突破"), ("Reach the goal and reflect", "完成目标并回顾"))
    return {"title": title, "progress": 0, "status": "active", "current_milestone": "step-1",
            "milestones": [{"id": f"step-{index + 1}", "name": name, "name_zh": name_zh,
                            "status": "active" if index == 0 else "locked"}
                           for index, (name, name_zh) in enumerate(names)]}


def advance_goal(goal: Mapping[str, Any], amount: int) -> dict[str, Any]:
    result = json.loads(json.dumps(goal))
    result["progress"] = _clamp(float(result.get("progress", 0)) + max(0, min(15, amount)))
    active_index = min(3, int(result["progress"]) // 25)
    for index, milestone in enumerate(result.get("milestones", [])):
        milestone["status"] = "completed" if index < active_index else "active" if index == active_index else "locked"
    if result["progress"] >= 100:
        result["status"] = "completed"
        result["current_milestone"] = None
    else:
        result["current_milestone"] = f"step-{active_index + 1}"
    return result


def _stable_choice(values: Sequence[str], *seed: str) -> str:
    number = int.from_bytes(hashlib.sha256("\x1f".join(seed).encode()).digest()[:8], "big")
    return values[number % len(values)]


def daily_plan(player_id: str, npc_id: str, profile: Mapping[str, Any], runtime: Mapping[str, Any],
               goal: Mapping[str, Any], game_day: date) -> dict[str, Any]:
    occupation = str(profile.get("occupation", "")).casefold()
    workplace = "city_hospital" if any(x in occupation for x in ("doctor", "nurse", "medical")) else \
        "community_school" if any(x in occupation for x in ("teacher", "tutor")) else \
        "design_studio" if any(x in occupation for x in ("design", "architect")) else \
        "music_hall" if any(x in occupation for x in ("music", "singer", "composer")) else \
        "community_gallery" if any(x in occupation for x in ("artist", "photo")) else \
        "innovation_hub" if any(x in occupation for x in ("developer", "engineer", "technology")) else "business_center"
    interests = " ".join(map(str, profile.get("interests", ()))).casefold()
    leisure = "music_hall" if "music" in interests else "maple_bookshop" if any(x in interests for x in ("book", "read")) else \
        "city_museum" if any(x in interests for x in ("art", "photo")) else "greenway_gym" if any(x in interests for x in ("sport", "fitness")) else "riverside_park"
    needs = runtime.get("needs", {})
    evening = "moonlight_cafe" if float(needs.get("social", 50)) < 35 else leisure
    if game_day.weekday() >= 5:
        morning, afternoon = leisure, _stable_choice(("old_town_market", "botanical_garden", "city_library"), player_id, npc_id, game_day.isoformat())
    else:
        morning, afternoon = workplace, workplace
    milestone = next((item.get("name") for item in goal.get("milestones", ()) if item.get("status") == "active"), goal.get("title"))
    return {"date": game_day.isoformat(), "slots": {
        "morning": {"activity_id": "work" if game_day.weekday() < 5 else "personal_interest",
                    "activity": "Work on daily responsibilities" if game_day.weekday() < 5 else "Spend time on a personal interest", "location_id": morning},
        "afternoon": {"activity_id": "goal", "activity": str(milestone), "location_id": afternoon},
        "evening": {"activity_id": "recover_connect", "activity": "Recover or connect with someone", "location_id": evening},
    }}


def time_slot(local_hour: int) -> str:
    return "morning" if local_hour < 12 else "afternoon" if local_hour < 18 else "evening"


def dialogue_objective(active_event: Mapping[str, Any] | None, runtime: Mapping[str, Any],
                       goal: Mapping[str, Any], relationship: Mapping[str, Any]) -> str:
    if active_event:
        return str(active_event.get("stage", {}).get("objective") or "Continue the current situation naturally")
    needs = runtime.get("needs", {})
    if needs and min(needs.values()) < 35:
        urgent = min(needs, key=needs.get)
        return f"Seek a natural form of {urgent} support without directly asking the player to fix everything"
    milestone = next((item.get("name") for item in goal.get("milestones", ()) if item.get("status") == "active"), None)
    if milestone:
        return f"Let the current goal quietly shape the conversation: {milestone}"
    return f"Build the relationship naturally at the {relationship.get('stage', 'acquaintance')} stage"
