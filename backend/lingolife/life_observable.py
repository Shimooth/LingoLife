"""Safe, deterministic presentation copy for resident life actions.

The simulator keeps needs, desire scores and relationship policy private.  This
module turns only player-authored profile facts and physically observable action
facts into UI copy.  Keeping this projection separate prevents a richer status
label from accidentally becoming a window into the decision model.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from .life import LifeAction, stable_number


PHASE_COPY: dict[str, tuple[str, str, str, str]] = {
    "planned": ("planning", "Getting ready", "正在准备", "next"),
    "traveling": ("traveling", "On the way", "正在路上", "route"),
    "performing": ("performing", "In progress", "正在进行", "timed"),
    "blocked": ("waiting", "Waiting for a turn", "正在等待", "waiting"),
    "retrying": ("waiting", "Trying another way", "正在换个办法", "retry"),
    "completed": ("performing", "Just finished", "刚刚完成", "complete"),
    "abandoned": ("waiting", "Set aside for now", "暂时放下", "paused"),
    "interrupted": ("waiting", "Interrupted", "暂时被打断", "paused"),
}

ACTION_ICONS = {
    "prepare_food": "♨", "eat": "◉", "sleep": "☾", "shower": "◌",
    "use_television": "▣", "read": "▤", "practice_hobby": "✦",
    "borrow_household_item": "↗", "clean_shared_space": "◇",
    "leave_dishes": "◫", "rest_alone": "…", "seek_company": "➜",
    "talk_to_resident": "◌",
}

ACTION_PRIVACY = {
    "sleep": "private", "shower": "private",
    "borrow_household_item": "contextual", "rest_alone": "contextual",
}

INTEREST_ALIASES: tuple[tuple[tuple[str, ...], str], ...] = (
    (("music", "guitar", "piano", "sing", "音乐", "吉他", "钢琴", "唱歌"), "music"),
    (("art", "paint", "draw", "illustrat", "艺术", "画画", "绘画", "插画"), "art"),
    (("photo", "camera", "摄影", "拍照", "相机"), "photography"),
    (("fitness", "sport", "running", "workout", "gym", "健身", "运动", "跑步"), "fitness"),
    (("game", "gaming", "游戏", "电竞"), "gaming"),
    (("cook", "food", "baking", "烹饪", "做饭", "美食", "烘焙"), "cooking"),
    (("read", "book", "history", "阅读", "读书", "书", "历史"), "reading"),
    (("write", "journal", "写作", "写小说", "日记"), "writing"),
    (("nature", "garden", "plant", "自然", "花园", "园艺", "植物"), "nature"),
    (("film", "movie", "cinema", "电影", "影视"), "film"),
)

HOBBY_COPY: dict[str, tuple[tuple[str, str], ...]] = {
    "music": (("practice guitar", "练习吉他"), ("rehearse a new melody", "排练一段新旋律"),
              ("work on a song", "打磨一首歌")),
    "art": (("sketch city scenery", "画一张城市速写"), ("work on an illustration", "创作一幅插画"),
            ("try a new color study", "尝试一组新的色彩练习")),
    "photography": (("practice photographic composition", "练习摄影构图"),
                    ("plan a photo walk", "规划一次摄影散步"), ("edit a set of photos", "整理一组照片")),
    "fitness": (("do strength training", "进行力量训练"), ("practice a cardio routine", "练习一套有氧训练"),
                ("work on mobility", "进行拉伸与灵活性训练")),
    "gaming": (("practice a strategy game", "练习一款策略游戏"), ("study a difficult game level", "研究一个困难关卡"),
               ("work on game skills", "磨练游戏技巧")),
    "cooking": (("test a new recipe", "试做一道新菜"), ("practice baking", "练习烘焙"),
                ("refine a favorite dish", "改进一道拿手菜")),
    "reading": (("research an interesting subject", "研究一个感兴趣的话题"),
                ("take notes from a book", "边读书边做笔记"), ("explore a new book", "读一本新书")),
    "writing": (("draft a short story", "起草一篇短篇故事"), ("work on a new chapter", "打磨一个新章节"),
                ("practice creative writing", "练习创意写作")),
    "nature": (("study the local plants", "观察本地植物"), ("plan a small garden", "规划一个小花园"),
               ("care for a plant collection", "照料植物收藏")),
    "film": (("study a favorite film scene", "研究一段喜欢的电影场景"),
             ("work on a film review", "整理一篇电影短评"), ("explore visual storytelling", "研究影像叙事")),
}


@dataclass(frozen=True)
class ActivityCopy:
    infinitive: str
    zh: str
    icon: str
    topic: str | None = None


def _clean_public_text(value: object, limit: int = 72) -> str:
    text = " ".join(str(value or "").strip().split())
    if len(text) <= limit:
        return text
    return text[:max(1, limit - 1)].rstrip() + "…"


def _canonical_interest(value: str) -> str | None:
    folded = value.casefold()
    for needles, canonical in INTEREST_ALIASES:
        if any(needle in folded for needle in needles):
            return canonical
    return None


def _profile_interests(profile: Mapping[str, Any]) -> tuple[tuple[str, str], ...]:
    result: list[tuple[str, str]] = []
    for raw in profile.get("interests") or ():
        label = _clean_public_text(raw, 32)
        if not label:
            continue
        result.append((_canonical_interest(label) or label.casefold(), label))
    return tuple(result)


def _location_topic(location_id: str | None, resource_kind: str | None) -> str | None:
    identity = f"{location_id or ''} {resource_kind or ''}".casefold()
    for needles, canonical in INTEREST_ALIASES:
        if any(needle in identity for needle in needles):
            return canonical
    if "library" in identity or "reading" in identity:
        return "reading"
    return None


def _goal_activity(profile: Mapping[str, Any], location_id: str | None,
                   resource_kind: str | None) -> ActivityCopy | None:
    goal = _clean_public_text(profile.get("longTermGoal"), 64)
    occupation = _clean_public_text(profile.get("occupation"), 48)
    source = f"{goal} {occupation}".casefold()
    at_goal_space = resource_kind == "goal_space" or "innovation_hub" in (location_id or "")
    patterns: tuple[tuple[tuple[str, ...], ActivityCopy], ...] = (
        (("gym", "fitness studio", "健身房"), ActivityCopy(
            "research training plans for a future gym", "为开一家健身房研究训练方案", "◆", "fitness")),
        (("concert", "album", "singer", "musician", "演唱会", "音乐会", "歌手"), ActivityCopy(
            "rehearse for a personal music project", "为自己的音乐计划排练", "♫", "music")),
        (("design studio", "designer", "设计工作室", "设计师"), ActivityCopy(
            "develop ideas for an independent design studio", "为独立设计工作室完善创意", "✎", "art")),
        (("app", "software", "developer", "engineer", "应用", "软件", "程序员", "工程师"), ActivityCopy(
            "prototype a useful new idea", "制作一个实用新点子的原型", "⌘", "career")),
        (("cafe", "restaurant", "chef", "咖啡馆", "餐厅", "厨师"), ActivityCopy(
            "develop recipes for a future menu", "为未来的菜单研究食谱", "♨", "cooking")),
        (("book", "novel", "writer", "author", "书", "小说", "作家"), ActivityCopy(
            "draft material for a future book", "为未来的一本书整理素材", "✎", "writing")),
        (("exhibition", "gallery", "artist", "展览", "画廊", "艺术家"), ActivityCopy(
            "prepare work for a future exhibition", "为未来的展览准备作品", "✦", "art")),
    )
    for needles, copy in patterns:
        if any(needle in source for needle in needles):
            topic_at_location = _location_topic(location_id, resource_kind)
            if at_goal_space or topic_at_location in {None, copy.topic}:
                return copy
    if goal and at_goal_space:
        return ActivityCopy(f'make progress toward “{goal}”', f'推进目标“{goal}”', "◆", "goal")
    if occupation and at_goal_space:
        return ActivityCopy(f"work on a {occupation} project", f"推进一项{occupation}相关计划", "◆", "career")
    return None


def _hobby_activity(action: LifeAction, profile: Mapping[str, Any],
                    location_id: str | None, resource_kind: str | None) -> ActivityCopy:
    goal = _goal_activity(profile, location_id, resource_kind)
    if goal:
        return goal
    interests = _profile_interests(profile)
    location_topic = _location_topic(location_id, resource_kind)
    matching = [item for item in interests if item[0] == location_topic] if location_topic else []
    candidates = matching or list(interests)
    if candidates:
        topic, authored_label = candidates[
            stable_number(action.id, "observable-interest") % len(candidates)
        ]
        variants = HOBBY_COPY.get(topic)
        if variants:
            english, chinese = variants[stable_number(action.id, topic, "observable-copy") % len(variants)]
            icon = {"music": "♫", "art": "✎", "photography": "◉", "fitness": "▲",
                    "gaming": "◆", "cooking": "♨", "reading": "▤", "writing": "✎",
                    "nature": "♧", "film": "▶"}.get(topic, "✦")
            return ActivityCopy(english, chinese, icon, topic)
        return ActivityCopy(f"spend time on {authored_label}", f"钻研{authored_label}", "✦", topic)
    return ActivityCopy("work on a small personal project", "推进一个小小的个人计划", "✦", "personal")


def _reading_activity(action: LifeAction, profile: Mapping[str, Any]) -> ActivityCopy:
    interests = _profile_interests(profile)
    topic = next((canonical for canonical, _ in interests if canonical in HOBBY_COPY), None)
    copies = {
        "art": ("read a book about art and design", "读一本艺术与设计相关的书"),
        "photography": ("read a photography magazine", "读一本摄影杂志"),
        "cooking": ("look through a cookbook", "翻看一本食谱"),
        "fitness": ("read about health and training", "阅读健康与训练资料"),
        "music": ("read about music", "阅读音乐相关内容"),
        "history": ("read a history book", "读一本历史书"),
    }
    english, chinese = copies.get(topic, ("read a book", "读一本书"))
    return ActivityCopy(english, chinese, "▤", topic or "reading")


def _activity(action: LifeAction, profile: Mapping[str, Any], *, target_name: str | None,
              location_id: str | None, resource_kind: str | None) -> ActivityCopy:
    if action.action_type == "practice_hobby":
        return _hobby_activity(action, profile, location_id, resource_kind)
    if action.action_type == "read":
        return _reading_activity(action, profile)
    if action.action_type == "talk_to_resident":
        return ActivityCopy(f"chat with {target_name}" if target_name else "chat with a neighbor",
                            f"和{target_name}聊聊天" if target_name else "和邻居聊聊天", "◌", "social")
    if action.action_type == "borrow_household_item":
        return ActivityCopy(f"borrow something from {target_name}" if target_name else "borrow a household item",
                            f"向{target_name}借一件东西" if target_name else "借用一件家中物品", "↗", "social")
    values = {
        "prepare_food": ActivityCopy("prepare a homemade meal", "准备一顿家常饭", "♨", "food"),
        "eat": ActivityCopy("have a meal", "吃一顿饭", "◉", "food"),
        "sleep": ActivityCopy("get some sleep", "好好睡一觉", "☾", "rest"),
        "shower": ActivityCopy("take a shower", "洗个澡", "◌", "care"),
        "use_television": ActivityCopy("watch a favorite show", "看一会儿喜欢的节目", "▣", "fun"),
        "clean_shared_space": ActivityCopy("tidy the shared space", "整理公共空间", "◇", "home"),
        "leave_dishes": ActivityCopy("leave the dishes for later", "把餐具留到稍后再收拾", "◫", "home"),
        "rest_alone": ActivityCopy("take a quiet break", "独自安静地休息一会儿", "…", "rest"),
        "seek_company": ActivityCopy("find someone to spend time with", "找个人一起待一会儿", "➜", "social"),
    }
    return values.get(action.action_type, ActivityCopy(
        action.action_type.replace("_", " "), action.action_type.replace("_", " "),
        ACTION_ICONS.get(action.action_type, "·"), None,
    ))


def _gerund(value: str) -> str:
    # Copy is intentionally constrained to our own short verb phrases.  This
    # fallback keeps player-authored labels out of ad-hoc grammar transforms.
    irregular = {"have": "having", "make": "making", "take": "taking",
                 "get": "getting", "tidy": "tidying", "lie": "lying",
                 "do": "doing", "chat": "chatting", "plan": "planning"}
    first, separator, rest = value.partition(" ")
    if first in irregular:
        converted = irregular[first]
    elif first.endswith("e") and not first.endswith("ee"):
        converted = first[:-1] + "ing"
    else:
        converted = first + "ing"
    return converted + (separator + rest if separator else "")


def _observable_state(action: LifeAction, runtime: Mapping[str, Any]) -> dict[str, str]:
    emotion = runtime.get("emotion") or {}
    energy_value = float(emotion.get("energy", 55))
    stress_value = float(emotion.get("stress", 45))
    valence_value = float(emotion.get("valence", 50))
    if action.status in {"blocked", "retrying", "interrupted"} or stress_value >= 70:
        mood = "tense"
    elif action.action_type in {"sleep", "rest_alone"} or energy_value <= 34:
        mood = "tired"
    elif valence_value >= 65:
        mood = "upbeat"
    elif stress_value <= 38 or action.action_type in {"read", "shower"}:
        mood = "calm"
    else:
        mood = "neutral"
    energy = "low" if energy_value <= 38 else "high" if energy_value >= 70 else "steady"
    if action.status in {"blocked", "retrying", "interrupted"}:
        attention = "waiting"
    elif action.action_type in {"sleep", "rest_alone"}:
        attention = "resting"
    elif action.action_type in {"seek_company", "talk_to_resident", "borrow_household_item"}:
        attention = "social"
    else:
        attention = "focused"
    phase = PHASE_COPY.get(action.status, PHASE_COPY["performing"])[0]
    return {"mood": mood, "energy": energy, "attention": attention, "phase": phase}


def project_observable_action(action: LifeAction, profile: Mapping[str, Any], *,
                              runtime: Mapping[str, Any] | None = None,
                              target_name: str | None = None,
                              location_label: str | None = None,
                              location_label_zh: str | None = None,
                              object_label: str | None = None,
                              object_label_zh: str | None = None,
                              location_id: str | None = None,
                              resource_kind: str | None = None) -> dict[str, Any]:
    """Project an action into public bilingual copy and coarse visual state."""
    phase, phase_en, phase_zh, progress_kind = PHASE_COPY.get(
        action.status, PHASE_COPY["performing"]
    )
    privacy = ACTION_PRIVACY.get(action.action_type, "open")
    if privacy == "private":
        # The authoritative simulation still knows the room and action, but an
        # observer only sees that the resident is home and unavailable. This
        # projection is shared by the city, household cutaway, and AI context.
        return {
            "visible_intent": "At home and unavailable for a little while",
            "visible_intent_zh": "正在家中处理私人事务，暂时不便打扰",
            "visible_context": {
                "icon": "◌", "activity": "take some private time",
                "activity_zh": "处理私人事务", "topic": "private",
                "phase": phase, "phase_label": phase_en,
                "phase_label_zh": phase_zh, "progress_kind": progress_kind,
                "visibility": privacy,
            },
            "observable_state": {
                "mood": "neutral", "energy": "steady",
                "attention": "resting", "phase": phase,
            },
        }
    activity = _activity(action, profile, target_name=target_name,
                         location_id=location_id or action.location_id,
                         resource_kind=resource_kind)
    place_en = _clean_public_text(location_label, 48)
    place_zh = _clean_public_text(location_label_zh, 48) or place_en
    object_en = _clean_public_text(object_label, 40)
    object_zh = _clean_public_text(object_label_zh, 40) or object_en
    if action.status == "traveling" and place_en:
        intent_en = f"Heading to {place_en} to {activity.infinitive}"
        intent_zh = f"正前往{place_zh}{activity.zh}"
    elif action.status == "planned":
        intent_en = f"Getting ready to {activity.infinitive}"
        intent_zh = f"正准备{activity.zh}"
    elif action.status in {"blocked", "retrying"}:
        prefix_en = "Waiting to" if action.status == "blocked" else "Finding another way to"
        prefix_zh = "正在等待" if action.status == "blocked" else "正在换个办法"
        intent_en = f"{prefix_en} {activity.infinitive}"
        intent_zh = f"{prefix_zh}{activity.zh}"
        if place_en:
            intent_en += f" at {place_en}"
            intent_zh += f" · {place_zh}"
    else:
        gerund = _gerund(activity.infinitive)
        intent_en = gerund[:1].upper() + gerund[1:]
        intent_zh = f"正在{activity.zh}"
        if place_en:
            intent_en += f" at {place_en}"
            intent_zh += f" · {place_zh}"
    state = _observable_state(action, runtime or {})
    context = {
        "icon": activity.icon, "activity": activity.infinitive,
        "activity_zh": activity.zh, "topic": activity.topic,
        "phase": phase, "phase_label": phase_en, "phase_label_zh": phase_zh,
        "progress_kind": progress_kind, "visibility": privacy,
    }
    if place_en:
        context.update({"location": place_en, "location_zh": place_zh})
    if target_name:
        context["target_name"] = _clean_public_text(target_name, 24)
    if object_en:
        context.update({"object": object_en, "object_zh": object_zh})
    return {
        "visible_intent": intent_en,
        "visible_intent_zh": intent_zh,
        "visible_context": context,
        "observable_state": state,
    }


def life_action_phase(status: str) -> str:
    return {
        "planned": "approach", "traveling": "approach", "performing": "loop",
        "blocked": "react", "retrying": "react", "completed": "exit",
        "abandoned": "exit", "interrupted": "react",
    }.get(status, "loop")
