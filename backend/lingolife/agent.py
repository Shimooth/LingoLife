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

PUBLIC_NEED_KEYS = ("food", "rest", "social", "achievement", "fun")
_PUBLIC_AGENT_FIELDS = (
    "persona", "relationship", "goal", "daily_plan", "current_slot",
    "language_controller", "animation_cue",
)

_DEVELOPMENT_CONFIDENCE_BANDS = ("fragile", "growing", "steady", "grounded")
_DEVELOPMENT_HABIT_BANDS = ("new", "forming", "established", "ingrained")
_DEVELOPMENT_STRATEGY_BANDS = ("untried", "emerging", "practiced", "reliable")
_DEVELOPMENT_STRATEGY_KEYS = (
    "cooperation", "repair", "boundary_setting", "reflection",
)

_RELATIONSHIP_STAGE_RANK = {
    "stranger": 0,
    "acquaintance": 1,
    "friend": 2,
    "close_friend": 3,
}

_PUBLIC_MEMORY_FIELDS = ("id", "kind", "content", "created_at")

_PUBLIC_LIFE_ACTION_FIELDS = (
    "type", "status", "phase", "visible_intent", "visible_intent_zh",
    "visible_context", "observable_state", "interruptibility", "animation_cue",
)

_PUBLIC_VISIBLE_CONTEXT_FIELDS = (
    "icon", "activity", "activity_zh", "topic", "phase", "phase_label",
    "phase_label_zh", "progress_kind", "visibility", "location", "location_zh",
    "target_name", "object", "object_zh",
)


def _clamp(value: float, low: float = 0, high: float = 100) -> int:
    return round(max(low, min(high, value)))


def _semantic_band(value: Any, thresholds: tuple[float, float, float],
                   labels: tuple[str, str, str, str]) -> str:
    """Coarsen an internal numeric state without preserving its exact value."""
    if isinstance(value, str) and value in labels:
        return value
    try:
        number = float(value)
    except (TypeError, ValueError):
        return labels[2]
    if number < thresholds[0]:
        return labels[0]
    if number < thresholds[1]:
        return labels[1]
    if number < thresholds[2]:
        return labels[2]
    return labels[3]


def observable_runtime_state(runtime: Mapping[str, Any] | None) -> dict[str, Any]:
    """Project authoritative runtime into coarse, player-observable bands.

    This is intentionally an allow-list. New needs, decision identifiers and
    commitments remain private unless they are explicitly reviewed here.
    """
    source = runtime if isinstance(runtime, Mapping) else {}
    raw_emotion = source.get("emotion") if isinstance(source.get("emotion"), Mapping) else {}
    raw_needs = source.get("needs") if isinstance(source.get("needs"), Mapping) else {}
    emotion_specs = {
        "valence": ((35, 65, 82), ("subdued", "balanced", "bright", "radiant")),
        "stress": ((30, 55, 78), ("calm", "noticeable", "tense", "overwhelmed")),
        "energy": ((30, 55, 78), ("tired", "steady", "energetic", "lively")),
    }
    emotion = {
        key: _semantic_band(raw_emotion[key], *spec)
        for key, spec in emotion_specs.items() if key in raw_emotion
    }
    needs = {
        key: _semantic_band(raw_needs[key], (25, 45, 70),
                            ("urgent", "strained", "steady", "comfortable"))
        for key in PUBLIC_NEED_KEYS if key in raw_needs
    }
    return {"emotion": emotion, "needs": needs}


def _memory_is_available(memory: Mapping[str, Any], relationship_stage: str,
                         now: datetime | None = None) -> bool:
    """Apply the persisted disclosure level before a memory leaves the server.

    Missing access metadata belongs to the pre-disclosure schema and therefore
    keeps its historical ``stranger`` visibility.  Unknown non-empty stages are
    denied instead of being silently downgraded to public.
    """
    required = str(memory.get("access_stage") or "stranger")
    if required not in _RELATIONSHIP_STAGE_RANK:
        return False
    allowed = _RELATIONSHIP_STAGE_RANK.get(str(relationship_stage), 0)
    if _RELATIONSHIP_STAGE_RANK[required] > allowed:
        return False
    expires_at = memory.get("expires_at")
    if not expires_at:
        return True
    try:
        expiry = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
        if expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        moment = now or datetime.now(timezone.utc)
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=timezone.utc)
        return expiry.astimezone(timezone.utc) > moment.astimezone(timezone.utc)
    except (TypeError, ValueError):
        # Malformed expiry metadata must never turn a potentially temporary
        # memory into an indefinitely public one.
        return False


def project_public_memories(memories: Sequence[Mapping[str, Any]], relationship_stage: str,
                            *, now: datetime | None = None) -> list[dict[str, Any]]:
    """Return the user-facing memory DTO.

    The identifier is retained solely so the owner can delete a visible
    memory.  Confidence, appraisal, source/fact ids, ranking signals, tags and
    correction links are rule-owned metadata and intentionally excluded.
    """
    result: list[dict[str, Any]] = []
    for memory in memories:
        if not isinstance(memory, Mapping) or not _memory_is_available(
            memory, relationship_stage, now,
        ):
            continue
        result.append({
            key: json.loads(json.dumps(memory[key]))
            for key in _PUBLIC_MEMORY_FIELDS if key in memory
        })
    return result


def project_dialogue_memories(memories: Sequence[Mapping[str, Any] | str], relationship_stage: str,
                              *, now: datetime | None = None) -> list[dict[str, str]]:
    """Return memory text an external dialogue provider is allowed to use."""
    structured = [memory for memory in memories if isinstance(memory, Mapping)]
    visible = project_public_memories(structured, relationship_stage, now=now)
    result = [
        {"kind": str(memory.get("kind") or "memory"),
         "content": str(memory.get("content") or "")}
        for memory in visible if str(memory.get("content") or "").strip()
    ]
    # Legacy provider callers supplied already-projected strings.  Keep that
    # narrow contract without teaching raw database rows to bypass access-stage
    # checks.
    result.extend(
        {"kind": "memory", "content": memory.strip()}
        for memory in memories if isinstance(memory, str) and memory.strip()
    )
    return result


def project_public_life_context(context: Mapping[str, Any] | None) -> dict[str, Any]:
    """Allow-list an NPC's observable life context.

    Action locations, resource ids, target ids, transition reasons and exact
    timestamps are simulation facts.  Natural-language labels produced by the
    observable-action layer are the public contract.  Private actions are also
    collapsed to a generic activity and neutral animation so shower/sleep
    details cannot be reconstructed from adjacent fields.
    """
    source = context if isinstance(context, Mapping) else {}
    raw_action = source.get("current_action")
    raw_action = raw_action if isinstance(raw_action, Mapping) else {}
    raw_visible = raw_action.get("visible_context")
    raw_visible = raw_visible if isinstance(raw_visible, Mapping) else {}
    visibility = str(raw_visible.get("visibility") or "open")
    visible_context = {
        key: json.loads(json.dumps(raw_visible[key]))
        for key in _PUBLIC_VISIBLE_CONTEXT_FIELDS if key in raw_visible
    }
    action = {
        key: json.loads(json.dumps(raw_action[key]))
        for key in _PUBLIC_LIFE_ACTION_FIELDS if key in raw_action
        and key not in {"visible_context"}
    }
    action["visible_context"] = visible_context
    if visibility == "private":
        action["type"] = "private_time"
        action["animation_cue"] = "idle"
        action["interruptibility"] = "private"
        action["visible_context"] = {
            key: value for key, value in visible_context.items()
            if key not in {"location", "location_zh", "target_name", "object", "object_zh"}
        }

    result: dict[str, Any] = {"current_action": action}
    for key in ("recent_life_stories", "npc_relationships", "household_id"):
        if key in source:
            result[key] = json.loads(json.dumps(source[key]))
    return result


def project_dialogue_life_context(context: Mapping[str, Any] | None) -> dict[str, Any]:
    """Provider projection of life context, without household identifiers."""
    result = project_public_life_context(context)
    result.pop("household_id", None)
    return result


def _development_band(value: Any, labels: tuple[str, str, str, str],
                      default: str) -> str:
    """Accept either an already-public band or a private numeric value safely."""
    if isinstance(value, Mapping):
        value = value.get("value")
    if isinstance(value, str) and value in labels:
        return value
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return default
    return _semantic_band(numeric, (25, 50, 75), labels)


def _project_development_goal(value: Any) -> dict[str, Any] | None:
    """Keep the authored public goal shape while dropping unknown nested data."""
    if not isinstance(value, Mapping):
        return None
    result: dict[str, Any] = {
        "title": str(value.get("title") or ""),
        "progress": max(0, min(100, float(value.get("progress") or 0))),
        "status": str(value.get("status") or "active"),
        "current_milestone": (
            str(value["current_milestone"])
            if value.get("current_milestone") is not None else None
        ),
        "milestones": [],
    }
    milestones = value.get("milestones")
    if isinstance(milestones, list):
        result["milestones"] = [
            {
                "id": str(item.get("id") or ""),
                "name": str(item.get("name") or ""),
                **({"name_zh": str(item["name_zh"])} if item.get("name_zh") else {}),
                "status": str(item.get("status") or "locked"),
            }
            for item in milestones if isinstance(item, Mapping)
        ]
    return result


def _project_public_development(value: Any) -> dict[str, Any] | None:
    """Defensively expose development bands without its evidence or score ledger.

    Normal callers pass :func:`development.public_development` here.  Numeric
    handling is deliberate defence in depth so an accidental raw resident
    bundle is still coarsened at the final API/provider boundary.
    """
    if not isinstance(value, Mapping):
        return None
    goal = _project_development_goal(value.get("goal"))
    habits: list[dict[str, Any]] = []
    raw_habits = value.get("habits")
    if isinstance(raw_habits, list):
        for item in raw_habits:
            if not isinstance(item, Mapping):
                continue
            habits.append({
                "id": str(item.get("id") or ""),
                "label": str(item.get("label") or ""),
                "strength": _development_band(
                    item.get("strength"), _DEVELOPMENT_HABIT_BANDS, "new",
                ),
                "last_practiced_at": (
                    str(item["last_practiced_at"])
                    if item.get("last_practiced_at") is not None else None
                ),
            })
    raw_strategies = value.get("relationship_strategies")
    raw_strategies = raw_strategies if isinstance(raw_strategies, Mapping) else {}
    result: dict[str, Any] = {
        "version": "resident-development-v1",
        "confidence": _development_band(
            value.get("confidence"), _DEVELOPMENT_CONFIDENCE_BANDS, "steady",
        ),
        "habits": habits,
        "relationship_strategies": {
            key: _development_band(
                raw_strategies.get(key), _DEVELOPMENT_STRATEGY_BANDS, "untried",
            )
            for key in _DEVELOPMENT_STRATEGY_KEYS
        },
    }
    if goal is not None:
        result["goal"] = goal
    return result


def project_public_agent(bundle: Mapping[str, Any]) -> dict[str, Any]:
    """Return the ordinary-player Agent DTO without authoritative internals."""
    result = {
        key: json.loads(json.dumps(bundle[key]))
        for key in _PUBLIC_AGENT_FIELDS if key in bundle
    }
    result["runtime_state"] = observable_runtime_state(
        bundle.get("runtime_state") if isinstance(bundle.get("runtime_state"), Mapping) else None,
    )
    development = _project_public_development(bundle.get("development"))
    if development is not None:
        result["development"] = development
    return result


def project_dialogue_agent(bundle: Mapping[str, Any]) -> dict[str, Any]:
    """Return the disclosure-safe subset that an external dialogue model may see."""
    result = project_public_agent(bundle)
    relationship = bundle.get("relationship")
    if isinstance(relationship, Mapping):
        result["relationship"] = {"stage": str(relationship.get("stage") or "acquaintance")}
    else:
        result.pop("relationship", None)
    return result


def relationship_stage(value: int) -> str:
    return next(stage for ceiling, stage in RELATIONSHIP_STAGES if value < ceiling)


def compile_persona(profile: Mapping[str, Any], growth: Mapping[str, float] | None = None) -> dict[str, Any]:
    """Compile free-form customization into a stable, prompt-ready behavior contract."""
    traits = [str(value).strip() for value in profile.get("personality", ()) if str(value).strip()]
    likes = [str(value).strip() for value in profile.get("likes", ()) if str(value).strip()]
    dislikes = [str(value).strip() for value in profile.get("dislikes", ()) if str(value).strip()]
    quirks = [str(value).strip() for value in profile.get("quirks", ()) if str(value).strip()]
    habits = [str(value).strip() for value in profile.get("habits", ()) if str(value).strip()]
    boundaries = [str(value).strip() for value in profile.get("boundaries", ()) if str(value).strip()]
    household_role = str(profile.get("householdRole") or "free_spirit")
    chore_preferences = [str(value) for value in profile.get("chorePreferences", ())]
    private_space = str(profile.get("privateSpacePreference") or "balanced")
    shared_history = [
        {
            "id": str(item.get("id") or ""),
            "participant_ids": [str(value) for value in item.get("participantIds", ())],
            "kind": str(item.get("kind") or ""),
            "summary": str(item.get("summary") or ""),
            "tone": str(item.get("tone") or "neutral"),
        }
        for item in profile.get("shared_history_hooks", ())
        if isinstance(item, Mapping) and str(item.get("summary") or "").strip()
    ]
    text = " ".join((*traits, *quirks, *habits)).casefold()
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
        (("persistent", "stubborn", "ambitious", "执着", "固执", "有野心"), "assertiveness", 14),
        (("meticulous", "detail-oriented", "谨慎", "一丝不苟"), "emotional_stability", 10),
        (("spontaneous", "restless", "随性", "坐不住"), "emotional_stability", -10),
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
    initiative_score = axes["extraversion"] * .55 + axes["assertiveness"] * .45
    if household_role in {"organizer", "caretaker"}:
        initiative_score += 10
    persistence_score = axes["assertiveness"] * .5 + axes["emotional_stability"] * .35 + axes["openness"] * .15
    if any(word in text for word in ("persistent", "stubborn", "ambitious", "执着", "固执")):
        persistence_score += 15
    flexibility_score = axes["openness"] * .65 + (100 - axes["assertiveness"]) * .2 + axes["emotional_stability"] * .15
    if any(word in text for word in ("stubborn", "traditional", "固执", "传统")):
        flexibility_score -= 20
    pride_score = axes["assertiveness"] * .55 + (100 - axes["warmth"]) * .25 + axes["emotional_stability"] * .2
    if any(word in text for word in ("proud", "stubborn", "ambitious", "骄傲", "固执")):
        pride_score += 14
    disclosure_score = axes["warmth"] * .45 + axes["extraversion"] * .4 + axes["openness"] * .15
    disclosure_score += {"low": 10, "balanced": 0, "high": -18}.get(private_space, 0)

    behavior = {
        "initiative": "low" if initiative_score < 40 else "high" if initiative_score > 68 else "moderate",
        "conflict_style": "avoidant" if axes["assertiveness"] < 38 else "direct" if axes["assertiveness"] > 70 else "measured",
        "support_style": ("practical" if household_role in {"organizer", "fixer"}
                          else "listen_before_advice" if axes["warmth"] > 65
                          else "reserved"),
        "disclosure_style": "guarded" if disclosure_score < 40 else "open" if disclosure_score > 68 else "selective",
        "persistence": "low" if persistence_score < 42 else "high" if persistence_score > 68 else "steady",
        "flexibility": "rigid" if flexibility_score < 40 else "adaptive" if flexibility_score > 68 else "balanced",
        "pride": "low" if pride_score < 42 else "high" if pride_score > 68 else "moderate",
    }
    identity = {key: profile.get(key, "") for key in ("name", "age", "relationship", "occupation", "longTermGoal")}
    public_preferences = {
        "likes": likes, "dislikes": dislikes, "quirks": quirks, "habits": habits,
        "boundaries": boundaries, "household_role": household_role,
        "chore_preferences": chore_preferences, "private_space_preference": private_space,
        "shared_history_hooks": shared_history,
    }
    source = json.dumps({"identity": identity, "traits": traits, "interests": profile.get("interests", []),
                         "preferences": public_preferences, "growth": growth or {}},
                        ensure_ascii=False, sort_keys=True)
    return {"version": "persona-v2-" + hashlib.sha256(source.encode()).hexdigest()[:10],
            "identity": identity, "traits": traits, "interests": list(profile.get("interests", [])),
            "preferences": public_preferences, "axes": axes, "voice": voice, "behavior": behavior}


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
    raw_needs = runtime.get("needs", {})
    needs = ({key: value for key, value in raw_needs.items() if key in PUBLIC_NEED_KEYS}
             if isinstance(raw_needs, Mapping) else {})
    if needs and min(needs.values()) < 35:
        urgent = min(needs, key=needs.get)
        return f"Seek a natural form of {urgent} support without directly asking the player to fix everything"
    milestone = next((item.get("name") for item in goal.get("milestones", ()) if item.get("status") == "active"), None)
    if milestone:
        return f"Let the current goal quietly shape the conversation: {milestone}"
    return f"Build the relationship naturally at the {relationship.get('stage', 'acquaintance')} stage"
