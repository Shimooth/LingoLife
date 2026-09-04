"""Application adapter for the deterministic life-simulation world.

The simulation core in :mod:`lingolife.life_world` owns decisions and state
transitions.  This module owns the two pieces that must not leak into that
core: optimistic persistence and the public city/story DTOs used by the web
client.
"""

from __future__ import annotations

import copy
import math
import threading
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping, Sequence

from .animation import animation_cue, performance_to_dict, journey_performance, ambient_performance
from .agent import project_public_life_context
from .city import HOME_SLOTS, LOCATION_BY_ID, city_payload, home_slot
from .db import Database, LifeWorldRevisionConflict
from .interaction import build_interaction_scene, public_interaction_scene
from .layout_runtime import compile_city_runtime, compile_shared_home_runtime
from .life import LifeAction, stable_id
from .life_observable import life_action_phase, project_observable_action
from .life_world import LifeWorldEngine


def story_attention_budget(resident_count: int) -> dict[str, Any]:
    """Return bounded story budgets for the current cast and viewport class.

    More residents create more legitimate social signals, but the UI must not
    grow linearly with every possible pair. Compact screens receive a smaller
    budget while urgent incidents remain eligible for pinning by the selector.
    """
    actual_population = max(0, int(resident_count))
    # New worlds are always 2–8 residents; keep the 2-person floor only for
    # sizing the grandfathered one-resident saves that remain readable.
    population = max(2, min(8, actual_population))
    desktop = {
        "incidents": min(8, 2 + math.ceil(population / 2)),
        "moments": min(12, 3 + population),
        "threads": min(10, 2 + math.ceil(population / 2)),
        "aftermath": min(8, 2 + math.ceil(population / 3)),
    }
    compact = {
        "incidents": min(desktop["incidents"], 1 + math.ceil(population / 4)),
        "moments": min(desktop["moments"], 2 + math.ceil(population / 4)),
        "threads": min(desktop["threads"], 1 + math.ceil(population / 4)),
        "aftermath": min(desktop["aftermath"], 1 + math.ceil(population / 4)),
    }
    return {"resident_count": actual_population, "desktop": desktop, "compact": compact}


def _attention_timestamp(value: Mapping[str, Any]) -> float:
    raw = value.get("updated_at") or value.get("created_at") or ""
    try:
        return _utc(datetime.fromisoformat(str(raw).replace("Z", "+00:00"))).timestamp()
    except (TypeError, ValueError):
        return 0.0


def _attention_topic(value: Mapping[str, Any]) -> str:
    presentation = value.get("presentation")
    if isinstance(presentation, Mapping):
        subject = str(presentation.get("subject") or "").split(" · ", 1)[0].strip()
        if subject:
            return subject.casefold()
    return str(value.get("title") or value.get("id") or "story").casefold()


def _attention_strength(value: Mapping[str, Any]) -> int:
    level = str(value.get("level") or "moment")
    score = {"moment": 18, "incident": 52, "thread": 40}.get(level, 0)
    if value.get("status") == "awaiting_management":
        score += 42
    trouble = value.get("trouble_signal")
    if isinstance(trouble, Mapping):
        score += {"low": 4, "medium": 12, "high": 25}.get(
            str(trouble.get("severity") or "medium"), 12,
        )
    if value.get("outcome"):
        score += 5
    return score


def select_story_attention(values: Sequence[Mapping[str, Any]], limit: int, *,
                           preserve_urgent: bool = False) -> list[dict[str, Any]]:
    """Choose a deterministic, diverse story feed without hiding urgent items."""
    candidates = [dict(value) for value in values]
    requested = max(0, int(limit))
    if requested == 0 or not candidates:
        return []
    urgent = [value for value in candidates if (
        value.get("status") == "awaiting_management" or value.get("trouble_signal")
    )] if preserve_urgent else []
    urgent_ids = {str(value.get("id")) for value in urgent}
    selected = sorted(
        urgent, key=lambda value: (
            _attention_strength(value), _attention_timestamp(value), str(value.get("id") or ""),
        ), reverse=True,
    )[:8]
    remaining = [value for value in candidates if str(value.get("id")) not in urgent_ids]
    topic_counts: dict[str, int] = {}
    for value in selected:
        topic = _attention_topic(value)
        topic_counts[topic] = topic_counts.get(topic, 0) + 1
    target = max(requested, len(selected))
    while remaining and len(selected) < target:
        choice = max(
            remaining,
            key=lambda value: (
                _attention_strength(value) - topic_counts.get(_attention_topic(value), 0) * 24,
                _attention_timestamp(value), str(value.get("id") or ""),
            ),
        )
        remaining.remove(choice)
        selected.append(choice)
        topic = _attention_topic(choice)
        topic_counts[topic] = topic_counts.get(topic, 0) + 1
    return selected


TOPIC_COPY: dict[str, tuple[str, str, str, str]] = {
    "shared_kitchen": ("A busy kitchen", "厨房里的小插曲", "They both needed the kitchen at the same time.", "两个人恰好同时需要使用厨房。"),
    "bathroom_access": ("Waiting at the bathroom", "浴室门外", "A shared bathroom tested someone's patience.", "共用浴室让某个人等得有些着急。"),
    "shared_entertainment": ("What should we watch?", "今晚看什么？", "They wanted different things from the television.", "他们想看的电视节目不太一样。"),
    "companionship": ("A little company", "有人作伴", "One resident reached out and the other had a choice to make.", "一位居民主动靠近，另一位需要决定如何回应。"),
    "missed_connection": ("Not quite the right moment", "时机不太凑巧", "Someone wanted company while the other resident was occupied.", "有人想找人作伴，但对方正忙着自己的事情。"),
    "dishwashing": ("The dishes are still there", "餐具还留在那里", "An unfinished chore started to affect someone else.", "一件没做完的家务开始影响到另一个人。"),
    "unequal_care": ("Who keeps things going?", "总是谁在照顾大家？", "The balance of care and responsibility no longer felt even.", "照顾与责任的分配开始显得不那么公平。"),
    "privacy": ("A need for privacy", "需要一点私人空间", "One resident's quiet time was interrupted.", "一位居民的独处时间被打断了。"),
    "borrowed_property": ("Borrowed without asking", "没有先问就借走了", "A personal belonging crossed an important boundary.", "一件私人物品触碰到了重要的边界。"),
    "blocked_plan": ("Plans had to change", "计划赶不上变化", "A place or facility was unavailable, so the plan could not continue as expected.", "地点或设施暂时无法使用，原来的计划需要改变。"),
    "food_shortage": ("The kitchen is running low", "厨房快没有存货了", "There was not enough food for the plan they had in mind.", "厨房里的食物不足以完成原本的计划。"),
    "noise": ("Too much noise", "有点太吵了", "Noise made it hard for someone to continue what they were doing.", "噪音让某个人很难继续手上的事情。"),
    "friendly_competition": ("A friendly challenge", "来一场友好的较量", "A shared hobby turned into a test of skill and sportsmanship.", "共同的爱好变成了一场技术和风度的较量。"),
}

INTERVENTION_COPY: dict[str, tuple[str, str]] = {
    "ask": ("Ask what happened", "问问发生了什么"),
    "comfort": ("Offer comfort", "安慰他们"),
    "advise": ("Share a suggestion", "给一点建议"),
    "mediate": ("Help them talk", "帮他们好好沟通"),
    "encourage": ("Encourage them", "鼓励他们"),
    "give_space": ("Give them space", "给他们一点空间"),
    "offer_help": ("Offer practical help", "提供实际帮助"),
    "invite_talk": ("Invite an honest talk", "邀请他们坦诚聊聊"),
    "set_boundary": ("Support a clear boundary", "支持他们明确边界"),
    "support_confession": ("Support their confession", "支持他们表达心意"),
    "let_them_handle_it": ("Let them handle it", "让他们自己处理"),
    "start_dating": ("Acknowledge their choice to date", "确认双方开始约会的选择"),
    "become_partners": ("Acknowledge their partnership", "确认双方共同选择的伴侣关系"),
    "separate": ("Support a respectful separation", "支持他们体面地分开"),
}

INTERVENTION_DESCRIPTION_COPY: dict[str, tuple[str, str, str]] = {
    "ask": ("Hear each resident's view before suggesting a direction.", "先听听每位居民怎么看，再决定下一步。", "understand"),
    "comfort": ("Make room for feelings without deciding the outcome for them.", "先接住情绪，但不替他们决定结果。", "support"),
    "advise": ("Offer one practical way forward that they may accept or refuse.", "提供一个可执行的方向，由他们决定是否接受。", "guide"),
    "mediate": ("Help both sides speak and respond without forcing agreement.", "帮助双方表达与回应，但不强求达成一致。", "mediate"),
    "encourage": ("Give them confidence to take their own next step.", "给他们一点勇气，让他们自己迈出下一步。", "support"),
    "give_space": ("Step back so emotions can settle before anyone responds.", "暂时退开，让情绪沉淀后再回应。", "deescalate"),
    "offer_help": ("Share the immediate practical burden while leaving the decision to them.", "分担眼前的实际困难，同时把决定权留给他们。", "assist"),
    "invite_talk": ("Create a calm opening for an honest conversation.", "创造一个可以平静、坦诚交流的机会。", "communicate"),
    "set_boundary": ("Help make an observable boundary clear and respectful.", "帮助他们把已经显现的界限说清楚，并彼此尊重。", "boundary"),
    "support_confession": ("Encourage honest words without revealing or deciding anyone's private feelings.", "鼓励真诚表达，但不揭示、也不替任何人决定私人感受。", "communicate"),
    "let_them_handle_it": ("Keep observing and let the residents resolve it in their own way.", "继续观察，让居民按照自己的方式处理。", "observe"),
    "start_dating": ("Acknowledge their mutual choice to begin dating while leaving the future open.", "确认双方开始约会的共同选择，同时让未来自然发展。", "relationship"),
    "become_partners": ("Acknowledge the committed relationship they have both chosen.", "确认双方共同选择的稳定伴侣关系。", "relationship"),
    "separate": ("Respect the choice to end the romance and give both residents room afterward.", "尊重结束恋爱关系的选择，并给双方留下调整空间。", "relationship"),
}

MANAGEMENT_PROMPT_COPY: dict[str, tuple[str, str]] = {
    "shared_kitchen": ("How should you help them share the kitchen?", "你想怎样帮助他们协调厨房的使用？"),
    "bathroom_access": ("How should you respond to the wait and rising impatience?", "面对等待与逐渐上升的不耐烦，你想怎样回应？"),
    "shared_entertainment": ("How should you help them make room for both preferences?", "你想怎样帮助他们兼顾彼此的偏好？"),
    "companionship": ("Would you support the conversation, or let it unfold on its own?", "你想支持这次交流，还是让它自然发展？"),
    "missed_connection": ("How should you help without speaking for either resident?", "怎样帮助他们，又不替任何一方表达？"),
    "dishwashing": ("How should the unfinished responsibility be addressed?", "这份尚未完成的责任应该怎样处理？"),
    "unequal_care": ("How should you help them talk about an uneven burden?", "你想怎样帮助他们谈清楚不均衡的负担？"),
    "privacy": ("How should you support the boundary that became visible here?", "你想怎样支持这次已经显现出来的边界？"),
    "borrowed_property": ("How should you help restore a respectful boundary?", "你想怎样帮助他们重新建立尊重彼此的界限？"),
    "blocked_plan": ("How should you help them adapt to the interrupted plan?", "计划受阻后，你想怎样帮助他们调整？"),
    "food_shortage": ("How should the immediate shortage be handled?", "眼前的物资不足应该怎样处理？"),
    "noise": ("How should you help them address the disruption?", "你想怎样帮助他们处理这次干扰？"),
    "friendly_competition": ("How should you help keep the challenge fair and enjoyable?", "你想怎样让这次较量保持公平和有趣？"),
}

LOCATION_ZH_COPY: dict[str, str] = {
    "central_station": "中央车站", "north_bus_terminal": "北区公交总站", "airport_express": "机场快线",
    "business_center": "商务中心", "innovation_hub": "创新中心", "design_studio": "运河设计工作室",
    "city_hospital": "市立医院", "neighborhood_clinic": "社区诊所", "animal_shelter": "城市动物收容所",
    "riverside_park": "河畔公园", "botanical_garden": "植物园", "hilltop_park": "山顶公园",
    "police_station": "警察局", "city_hall": "市政厅", "fire_station": "消防站",
    "community_center": "社区中心", "old_town_market": "老城市场", "harbor_mall": "港湾商场",
    "maple_bookshop": "枫叶书店", "moonlight_cafe": "月光咖啡馆", "garden_cafe": "花园咖啡馆",
    "harbor_restaurant": "港湾餐厅", "community_gallery": "社区画廊", "city_museum": "城市博物馆",
    "aurora_theater": "极光剧院", "music_hall": "南岸音乐厅", "city_library": "城市图书馆",
    "community_school": "社区学校", "city_university": "城市大学", "sunny_plaza": "晴光广场",
    "canal_square": "运河广场", "greenway_gym": "绿道健身房", "city_stadium": "城市体育场",
    "canal_walk": "运河步道", "south_harbor": "南港", "co_working_loft": "老城共享办公阁楼",
}

REACTION_COPY: dict[str, tuple[str, str]] = {
    "accept": ("accepted the support", "接受了这次帮助"),
    "accept_later": ("asked for time, but kept the door open", "希望晚一点再谈，但没有关上沟通的大门"),
    "refuse": ("chose not to accept the intervention", "选择不接受这次介入"),
    "misunderstood": ("heard a different intention than you meant", "误解了你这次介入的用意"),
    "backfire": ("felt the intervention made the moment harder", "觉得这次介入让事情变得更难处理"),
}


def _utc(value: datetime | None = None) -> datetime:
    moment = value or datetime.now(timezone.utc)
    if moment.tzinfo is None or moment.utcoffset() is None:
        return moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc)


def _profiles(entries: Sequence[Mapping[str, Any]]) -> dict[str, dict[str, Any]]:
    return {str(entry["id"]): dict(entry.get("profile") or {}) for entry in entries}


def _observable_location(action: LifeAction, public_location_id: str,
                         home_location_id: str) -> tuple[str, str]:
    """Name only the place a bystander could identify from the action."""
    location = LOCATION_BY_ID.get(public_location_id)
    if location:
        return location.name, LOCATION_ZH_COPY.get(location.id, location.name)
    internal = str(action.location_id or "").casefold()
    room_copy = (
        ("shared-kitchen", "Home kitchen", "家中厨房"),
        ("kitchen", "Home kitchen", "家中厨房"),
        ("shared-bathroom", "Shared bathroom", "共用浴室"),
        ("bathroom", "Shared bathroom", "共用浴室"),
        ("living-room", "Living room", "客厅"),
        ("reading", "Reading room", "阅览室"),
        ("practice", "Practice room", "练习室"),
    )
    for marker, label, label_zh in room_copy:
        if marker in internal:
            return label, label_zh
    if public_location_id == home_location_id or public_location_id.startswith("home-"):
        return {
            "prepare_food": ("the home kitchen", "家中厨房"),
            "eat": ("the dining area", "家中用餐区"),
            "sleep": ("the bedroom", "卧室"),
            "shower": ("the bathroom", "浴室"),
            "use_television": ("the living room", "客厅"),
            "read": ("a reading nook", "阅读角"),
            "practice_hobby": ("a hobby corner", "兴趣角"),
            "clean_shared_space": ("a shared room", "公共房间"),
            "leave_dishes": ("the home kitchen", "家中厨房"),
            "rest_alone": ("the living room", "客厅"),
        }.get(action.action_type, ("home", "家中"))
    return "Around the city", "城市中"


def _observable_object(resource: Mapping[str, Any]) -> tuple[str | None, str | None]:
    kind = str(resource.get("kind") or "")
    identity = str(resource.get("id") or "").casefold()
    if "music" in identity:
        return "practice room", "音乐练习室"
    if "gym" in identity:
        return "training station", "训练区"
    return {
        "kitchen": ("kitchen", "厨房"), "television": ("television", "电视"),
        "bathroom": ("shared bathroom", "共用浴室"),
        "reading_space": ("reading space", "阅览区"),
        "social_space": ("public lawn", "公共草坪"),
        "dining_space": ("café table", "咖啡馆座位"),
        "hobby_space": ("activity space", "活动区"),
        "goal_space": ("project desk", "项目工作台"),
    }.get(kind, (None, None))


class LifeWorldService:
    """Load, advance, project, and persist one player's authoritative world."""

    def __init__(self, db: Database, timezone_name: str = "Asia/Shanghai"):
        self.db = db
        self.engine = LifeWorldEngine(timezone_name=timezone_name)
        self._lock = threading.RLock()

    def _refresh_layout_contract(self) -> None:
        active = self.db.get_world_layout()
        layout = active.get("layout") if active else None
        metadata = active.get("active_version") if active else None
        version = str(metadata.get("id") if isinstance(metadata, Mapping) else "built-in")
        self.engine.configure_shared_home(
            compile_shared_home_runtime(layout), version,
        )
        self.engine.configure_city(compile_city_runtime(layout), version)

    @staticmethod
    def _slot_for_home(home_id: str) -> int | None:
        if not home_id.startswith("home-"):
            return None
        try:
            value = int(home_id.removeprefix("home-")) - 1
        except ValueError:
            return None
        return value if 0 <= value < len(HOME_SLOTS) else None

    def _home_mapping(self, player_id: str, profile_entries: Sequence[Mapping[str, Any]],
                      stored: Mapping[str, Any] | None = None) -> dict[str, dict[str, str]]:
        """Map every resident owned by a player into one authoritative home.

        Before the shared-home invariant, profiles could form arbitrary
        cohabitation components.  Migration keeps the largest existing
        household as the anchor (stable id tie-break), preserving the greatest
        amount of accumulated home state.  Residents, relationship pairs and
        city positions are never discarded.
        """
        residents = dict((stored or {}).get("residents") or {})
        profile_map = _profiles(profile_entries)
        resident_ids = set(profile_map)
        if not resident_ids:
            return {}
        stored_household_sizes: dict[str, int] = {}
        for npc_id, value in residents.items():
            if npc_id not in resident_ids:
                continue
            household_id = str(value.get("household_id") or "")
            if household_id:
                stored_household_sizes[household_id] = stored_household_sizes.get(household_id, 0) + 1
        canonical_household = (
            sorted(stored_household_sizes, key=lambda value: (-stored_household_sizes[value], value))[0]
            if stored_household_sizes else stable_id("household", player_id, "shared")
        )
        canonical_household_state = dict((stored or {}).get("households") or {}).get(canonical_household) or {}
        residence = canonical_household_state.get("residence") or {}
        anchor_candidates = sorted(
            (npc_id for npc_id in resident_ids
             if str((residents.get(npc_id) or {}).get("household_id") or "") == canonical_household),
        )
        anchor_old = residents.get(anchor_candidates[0], {}) if anchor_candidates else {}
        home_id = str(
            residence.get("location_id") or anchor_old.get("home_location_id") or ""
        )
        if not home_id:
            slot = home_slot(player_id, "shared-home", set())
            home_id = f"home-{slot + 1}"
        residence_id = str(
            canonical_household_state.get("residence_id") or residence.get("id")
            or anchor_old.get("residence_id") or stable_id("residence", player_id, home_id)
        )

        result: dict[str, dict[str, str]] = {}
        for npc_id in sorted(resident_ids):
            old = residents.get(npc_id) or {}
            old_home = str(old.get("home_location_id") or "")
            old_household = str(old.get("household_id") or "")
            old_current = str(old.get("current_location_id") or "")
            was_at_old_home = (
                not old_current or old_current == old_home
                or bool(old_household and old_current.startswith(f"{old_household}:"))
            )
            result[npc_id] = {
                "household_id": canonical_household,
                "home_location_id": home_id,
                "current_location_id": home_id if was_at_old_home else old_current,
                "residence_id": residence_id,
            }
        return result

    def load(self, player_id: str, profile_entries: Sequence[Mapping[str, Any]],
             *, now: datetime | None = None, force_advance: bool = False) -> dict[str, Any]:
        moment = _utc(now)
        profile_map = _profiles(profile_entries)
        if not profile_map:
            raise ValueError("a life world requires at least one resident")
        with self._lock:
            self._refresh_layout_contract()
            for _attempt in range(3):
                stored = self.db.get_life_world_state(player_id)
                expected_revision = int(stored.get("revision", 0)) if stored else 0
                if stored is None:
                    home_mapping = self._home_mapping(player_id, profile_entries)
                    runtime_seeds = {
                        npc_id: self.db.get_runtime_state(player_id, npc_id) or {}
                        for npc_id in profile_map
                    }
                    edges = self.db.ensure_social_edges(player_id, list(profile_map))
                    candidate = self.engine.initialize(
                        player_id, profile_map, home_mapping, runtime_seeds, edges, now=moment,
                    )
                else:
                    resident_ids = set(stored.get("residents") or {})
                    profile_changed = resident_ids != set(profile_map)
                    household_ids = {
                        str(value.get("household_id") or "")
                        for npc_id, value in (stored.get("residents") or {}).items()
                        if npc_id in profile_map
                    }
                    home_ids = {
                        str(value.get("home_location_id") or "")
                        for npc_id, value in (stored.get("residents") or {}).items()
                        if npc_id in profile_map
                    }
                    projected_household_ids = {
                        str(value) for value in (stored.get("households") or {})
                    }
                    shared_home_migration_due = (
                        len(household_ids) != 1 or "" in household_ids
                        or len(home_ids) != 1 or "" in home_ids
                        # A prior interrupted/partial projection can leave an
                        # unoccupied legacy household in the authoritative JSON.
                        # Reconcile it even when resident assignments already
                        # happen to look shared, otherwise the stale household
                        # remains visible until an unrelated timed transition.
                        or projected_household_ids != household_ids
                    )
                    layout_migration_due = (
                        str(stored.get("shared_home_layout_version") or "built-in")
                        != self.engine.home_layout_version
                        or str(stored.get("city_layout_version") or "built-in")
                        != self.engine.city_layout_version
                    )
                    transition = stored.get("next_transition_at")
                    transition_due = True
                    if transition:
                        try:
                            transition_due = datetime.fromisoformat(str(transition).replace("Z", "+00:00")) <= moment
                        except ValueError:
                            transition_due = True
                    if not (force_advance or profile_changed or shared_home_migration_due
                            or layout_migration_due or transition_due):
                        return stored
                    home_mapping = self._home_mapping(player_id, profile_entries, stored)
                    advance_at = moment
                    if profile_changed or shared_home_migration_due or layout_migration_due:
                        try:
                            stored_at = datetime.fromisoformat(
                                str(stored.get("last_advanced_at") or "").replace("Z", "+00:00")
                            )
                            if stored_at.tzinfo is None or stored_at.utcoffset() is None:
                                stored_at = stored_at.replace(tzinfo=timezone.utc)
                            if advance_at <= stored_at:
                                advance_at = stored_at + timedelta(microseconds=1)
                        except ValueError:
                            pass
                    candidate = self.engine.advance(stored, profile_map, now=advance_at,
                                                    home_location_mapping=home_mapping)
                    if candidate == stored:
                        return stored
                try:
                    saved = self._persist(player_id, candidate, expected_revision)
                except LifeWorldRevisionConflict:
                    continue
                return saved
        raise RuntimeError("life world could not be updated after concurrent writes")

    def observe(self, player_id: str, profile_entries: Sequence[Mapping[str, Any]], story_id: str,
                *, now: datetime | None = None) -> dict[str, Any]:
        return self._mutate(player_id, profile_entries, lambda state: self.engine.observe(state, story_id, now))

    def intervene(self, player_id: str, profile_entries: Sequence[Mapping[str, Any]], story_id: str,
                  action: str, idempotency_key: str, *, now: datetime | None = None) -> dict[str, Any]:
        cached = self.db.cached_life_intervention(player_id, story_id, idempotency_key)
        if cached:
            if self.db.life_intervention_action(player_id, story_id, idempotency_key) != action:
                raise ValueError("idempotency key was reused with a different request")
            return cached
        state = self._mutate(
            player_id, profile_entries,
            lambda value: self.engine.intervene(value, story_id, action, idempotency_key, now),
        )
        response = self.story(player_id, profile_entries, story_id, state=state, now=now)
        return self.db.save_life_intervention(player_id, story_id, idempotency_key, action, response)

    def player_interaction(self, player_id: str, profile_entries: Sequence[Mapping[str, Any]],
                           npc_id: str, interaction_id: str, *, mood_change: int = 0,
                           relationship_change: int = 0,
                           semantic_signals: Sequence[str] = (),
                           now: datetime | None = None) -> dict[str, Any]:
        return self._mutate(
            player_id, profile_entries,
            lambda state: self.engine.player_interaction(
                state, npc_id, interaction_id, mood_change=mood_change,
                relationship_change=relationship_change,
                semantic_signals=semantic_signals, now=now,
            ),
        )

    def rename_shared_household(self, player_id: str,
                                profile_entries: Sequence[Mapping[str, Any]],
                                name: str) -> dict[str, Any]:
        """Rename the player's single shared home without altering simulation facts."""
        normalized = " ".join(name.split())[:64] or "Our Home"

        def rename(state: Mapping[str, Any]) -> dict[str, Any]:
            result = copy.deepcopy(state)
            households = result.get("households") or {}
            if len(households) != 1:
                raise ValueError("shared household invariant is not established")
            household = next(iter(households.values()))
            household["name"] = normalized
            residence = household.get("residence")
            if isinstance(residence, dict):
                residence["name"] = normalized
            result["revision"] = int(result.get("revision", 0)) + 1
            return result

        return self._mutate(player_id, profile_entries, rename)

    def _mutate(self, player_id: str, profile_entries: Sequence[Mapping[str, Any]], operation) -> dict[str, Any]:
        with self._lock:
            for _attempt in range(3):
                current = self.load(player_id, profile_entries)
                expected_revision = int(current["revision"])
                updated = operation(current)
                if updated == current:
                    return current
                try:
                    saved = self._persist(player_id, updated, expected_revision)
                except LifeWorldRevisionConflict:
                    continue
                return saved
        raise RuntimeError("life world could not be changed after concurrent writes")

    def _projection_payload(self, state: Mapping[str, Any]) -> dict[str, list[dict[str, Any]]]:
        """Build all query projections before opening the SQLite transaction."""
        resources = list(state.get("resources") or [])
        households: list[dict[str, Any]] = []
        for raw in (state.get("households") or {}).values():
            household = copy.deepcopy(raw)
            household_id = str(household["id"])
            household["members"] = [
                {"npc_id": str(member), "role": "resident"}
                if isinstance(member, str) else dict(member)
                for member in household.get("members", [])
            ]
            household["resources"] = [
                self._public_resource(resource)
                for resource in resources if resource.get("household_id") == household_id
            ]
            households.append(household)
        actions: list[dict[str, Any]] = []
        for resident in (state.get("residents") or {}).values():
            action = dict(resident.get("current_action") or {})
            if not action:
                continue
            action["type"] = action.get("action_type")
            actions.append(action)
        stories: list[dict[str, Any]] = []
        for record in (state.get("stories") or {}).values():
            story = dict(record.get("story") or {})
            if story:
                stories.append(story)
        evidence_items: list[dict[str, Any]] = []
        for raw_evidence in state.get("relationship_evidence") or []:
            value = dict(raw_evidence)
            value["context"] = {"thread_id": value.get("thread_id")}
            evidence_items.append(value)
        return {
            "households": households,
            "actions": actions,
            "stories": stories,
            "evidence": evidence_items,
            "relationship_pairs": [dict(pair) for pair in (state.get("relationships") or {}).values()],
        }

    def _persist(self, player_id: str, state: Mapping[str, Any], expected_revision: int) -> dict[str, Any]:
        projections = self._projection_payload(state)
        return self.db.save_life_world_state_and_projections(
            player_id, dict(state), rules_version=str(state["rules_version"]),
            last_advanced_at=str(state["last_advanced_at"]),
            next_transition_at=state.get("next_transition_at"),
            expected_revision=expected_revision,
            **projections,
        )

    @staticmethod
    def _public_resource(raw: Mapping[str, Any]) -> dict[str, Any]:
        state = copy.deepcopy(raw.get("state") or {})
        state["occupied_by"] = [item.get("npc_id") for item in raw.get("reservations", []) if item.get("npc_id")]
        state["queue"] = [item.get("npc_id") for item in raw.get("queue", []) if item.get("npc_id")]
        room_id = str(raw.get("room_id") or {
            "television": "living_room", "kitchen": "kitchen", "bathroom": "bathroom",
        }.get(str(raw.get("kind")), raw.get("kind") or "shared_space"))
        return {
            "id": raw["id"], "kind": raw["kind"],
            "room_id": room_id,
            "capacity": int(raw.get("capacity", 1)), "state": state,
        }

    @staticmethod
    def _trouble_recipients(record: Mapping[str, Any],
                            participant_ids: Sequence[str]) -> tuple[str, ...]:
        """Return only residents who persisted a choice to tell the player.

        Records created before the disclosure contract retain their historical
        behavior.  New records always contain ``disclosure`` even when nobody
        elects to expose the Incident as a task-like marker.
        """
        disclosure = record.get("disclosure")
        if not isinstance(disclosure, Mapping):
            return tuple(str(value) for value in participant_ids)
        allowed = set(str(value) for value in participant_ids)
        return tuple(
            npc_id for npc_id in (
                str(value) for value in disclosure.get("player_visible_npc_ids", [])
            ) if npc_id in allowed
        )

    def _recent_story_aftermath(self, stories: Sequence[Mapping[str, Any]],
                                now: datetime) -> list[dict[str, Any]]:
        """Project bounded, previous-day consequences for the return visit."""
        today = self.engine.clock.game_date(now)
        terminal = {
            "resolved_autonomously", "resolved_with_management", "closed",
        }
        result: list[dict[str, Any]] = []
        for raw in stories:
            story = dict(raw)
            if story.get("status") not in terminal or not story.get("outcome"):
                continue
            try:
                created = datetime.fromisoformat(
                    str(story.get("created_at") or "").replace("Z", "+00:00")
                )
            except (TypeError, ValueError):
                continue
            age = (today - self.engine.clock.game_date(_utc(created))).days
            if not 1 <= age <= 7:
                continue
            result.append(story)
            if len(result) == 8:
                break
        return result

    def city(self, player_id: str, profile_entries: Sequence[Mapping[str, Any]],
             *, now: datetime | None = None) -> dict[str, Any]:
        moment = _utc(now)
        state = self.load(player_id, profile_entries, now=moment)
        public = self.engine.public_snapshot(state)
        profile_map = _profiles(profile_entries)
        base = city_payload(player_id, profile_entries, {}, self.engine.clock.game_date(moment))
        resident_base = {resident["id"]: resident for resident in base["npcs"]}
        story_views = self._story_views(state, profile_map, now=moment)
        resource_by_id = {
            str(resource.get("id")): resource for resource in state.get("resources", [])
            if isinstance(resource, Mapping) and resource.get("id")
        }
        trouble_by_npc: dict[str, dict[str, Any]] = {}
        for story in story_views:
            if story.get("trouble_signal") and story["status"] == "awaiting_management":
                record = (state.get("stories") or {}).get(story["id"], {})
                for npc_id in self._trouble_recipients(record, story["participant_ids"]):
                    trouble_by_npc.setdefault(npc_id, story["trouble_signal"])
        for resident in public["residents"]:
            npc_id = resident["npc_id"]
            target = resident_base.get(npc_id)
            if not target:
                continue
            action = dict(resident["current_action"])
            raw_action = LifeAction.from_dict(state["residents"][npc_id]["current_action"])
            authoritative_home_id = str(resident.get("home_location_id") or target["home"]["id"])
            home_slot_index = self._slot_for_home(authoritative_home_id)
            if home_slot_index is not None:
                home_x, home_y = HOME_SLOTS[home_slot_index]
                target["home"] = {"id": authoritative_home_id, "x": home_x, "y": home_y}
            household_id = str(resident.get("household_id") or "")
            raw_current_location_id = str(resident.get("current_location_id") or target["home"]["id"])
            # Household room/resource locations are useful to the simulator but
            # are not city-map coordinates. Public city state anchors them to
            # the resident's home; Household DTOs still expose the actual room.
            is_internal_home_location = bool(
                household_id and raw_current_location_id.startswith(f"{household_id}:")
            )
            current_location_id = (authoritative_home_id if is_internal_home_location
                                   else raw_current_location_id)
            raw_action_location_id = str(raw_action.location_id or current_location_id)
            action_location_id = (authoritative_home_id
                                  if household_id and raw_action_location_id.startswith(f"{household_id}:")
                                  else raw_action_location_id)
            action["location_id"] = action_location_id
            location = LOCATION_BY_ID.get(current_location_id)
            if location:
                position = {"x": location.x, "y": location.y}
            elif current_location_id == target["home"]["id"]:
                position = {"x": target["home"]["x"], "y": target["home"]["y"]}
            else:
                position = dict(target["position"])
            place_en, place_zh = _observable_location(
                raw_action, action_location_id, authoritative_home_id,
            )
            resource = resource_by_id.get(str(raw_action.target_resource_id or ""), {})
            object_en, object_zh = _observable_object(resource)
            target_name = None
            if raw_action.target_npc_id:
                target_profile = profile_map.get(raw_action.target_npc_id, {})
                target_name = str(target_profile.get("name") or raw_action.target_npc_id)
            observable = project_observable_action(
                raw_action, profile_map.get(npc_id, {}),
                runtime=state["residents"][npc_id].get("runtime") or {},
                target_name=target_name, location_label=place_en, location_label_zh=place_zh,
                object_label=object_en, object_label_zh=object_zh,
                location_id=str(raw_action.location_id or action_location_id),
                resource_kind=str(resource.get("kind") or "") or None,
            )
            if observable["visible_context"].get("visibility") == "private":
                action.update({"location_id": authoritative_home_id,
                               "target_resource_id": None, "target_npc_id": None})
            intent_en = str(observable["visible_intent"])
            intent_zh = str(observable["visible_intent_zh"])
            progress_start = (raw_action.planned_at if raw_action.status in {"planned", "traveling"}
                              else raw_action.started_at)
            progress_end = (raw_action.arrives_at if raw_action.status in {"planned", "traveling"}
                            else raw_action.ends_at)
            action.update({
                "type": raw_action.action_type, "planned_at": raw_action.planned_at.isoformat(),
                "started_at": raw_action.started_at.isoformat() if raw_action.started_at else None,
                "phase": life_action_phase(raw_action.status),
                "interruptibility": ("private" if observable["visible_context"].get("visibility") == "private"
                                     else "contextual" if raw_action.interruptible else "locked"),
                "interruptible": raw_action.interruptible,
                "visible_intent": intent_en, "visible_intent_zh": intent_zh,
                "visible_context": observable["visible_context"],
                "presentation": {"version": 2, "action_cue": raw_action.action_type,
                                 "scene": "household" if current_location_id.startswith("home-") else "city",
                                 "fallback_animation_cue": raw_action.animation_cue,
                                 "progress": {
                                     "kind": observable["visible_context"]["progress_kind"],
                                     "started_at": progress_start.isoformat() if progress_start else None,
                                     "ends_at": progress_end.isoformat() if progress_end else None,
                                 },
                                 "observable_state": observable["observable_state"]},
            })
            target.update({
                "current_location_id": current_location_id, "position": position,
                "is_home": is_internal_home_location or current_location_id == target["home"]["id"],
                "household_id": resident.get("household_id"), "current_action": action,
                "development": copy.deepcopy(resident.get("development")),
                "visible_intent": intent_en, "visible_intent_zh": intent_zh,
                "observable_state": observable["observable_state"],
                "trouble_signal": trouble_by_npc.get(npc_id),
                "animation_cue": animation_cue(raw_action.animation_cue),
                "current_activity": intent_en,
            })
            walking = raw_action.status == "traveling"
            world_state = (
                "walking_to_event" if walking
                else "living" if raw_action.status in {
                    "planned", "performing", "blocked", "retrying",
                }
                else "idle"
            )
            target["world_action"] = {
                "state": world_state,
                "target_location_id": action_location_id,
                "started_at": raw_action.planned_at.isoformat(),
                "arrives_at": raw_action.arrives_at.isoformat() if raw_action.arrives_at else None,
                "journey": copy.deepcopy(action.get("journey")),
                "animation_cue": animation_cue("walk" if walking else raw_action.animation_cue),
                "performance": performance_to_dict(
                    journey_performance("walk") if walking else ambient_performance(raw_action.animation_cue)
                ),
            }
        households = []
        resources = list(state.get("resources") or [])
        for raw in (state.get("households") or {}).values():
            household = copy.deepcopy(raw)
            household["members"] = [
                {"npc_id": str(member), "name": profile_map.get(str(member), {}).get("name")}
                if isinstance(member, str) else dict(member)
                for member in household.get("members", [])
            ]
            household["resources"] = [
                self._public_resource(resource) for resource in resources
                if resource.get("household_id") == household["id"]
            ]
            households.append(household)
        all_moments = [story for story in story_views
                       if story["level"] == "moment" and story["presentable"]]
        all_incidents = [story for story in story_views if story["level"] == "incident"
                         and story["status"] not in {"resolved_autonomously", "resolved_with_management", "closed"}]
        all_threads = self._thread_views(state, profile_map)
        all_aftermath = self._recent_story_aftermath(story_views, moment)
        attention = story_attention_budget(len(public["residents"]))
        desktop_budget = attention["desktop"]
        incidents = select_story_attention(
            all_incidents, desktop_budget["incidents"], preserve_urgent=True,
        )
        moments = select_story_attention(all_moments, desktop_budget["moments"])
        threads = select_story_attention(all_threads, desktop_budget["threads"])
        recent_aftermath = select_story_attention(
            all_aftermath, desktop_budget["aftermath"],
        )
        attention["suppressed"] = {
            "incidents": max(0, len(all_incidents) - len(incidents)),
            "moments": max(0, len(all_moments) - len(moments)),
            "threads": max(0, len(all_threads) - len(threads)),
            "aftermath": max(0, len(all_aftermath) - len(recent_aftermath)),
        }
        relationship_views = []
        for relationship in public.get("relationships", []):
            value = copy.deepcopy(relationship)
            value["participants"] = [
                {"id": npc_id, "name": str(profile_map.get(npc_id, {}).get("name") or npc_id)}
                for npc_id in value.get("participant_ids", [])
            ]
            relationship_views.append(value)
        period = self.engine.clock.decision_window(moment).period
        base.update({
            "server_time": moment.isoformat(), "world_version": public["revision"],
            "city_layout_version": public.get("city_layout_version", "built-in"),
            "next_transition_at": public.get("next_transition_at"),
            "rules_version": public["rules_version"],
            "time_slot": "evening" if period == "night" else period,
            "households": households, "observable_moments": moments,
            "open_incidents": incidents, "story_threads": threads,
            "recent_aftermath": recent_aftermath, "attention_budget": attention,
            "relationships": relationship_views,
            # The former daily-event system remains queryable behind its own
            # endpoints but is not allowed to drive the v2 world twice.
            "social_interactions": [],
        })
        return base

    def stories(self, player_id: str, profile_entries: Sequence[Mapping[str, Any]],
                *, level: str | None = None, status: str | None = None,
                npc_id: str | None = None, household_id: str | None = None,
                game_date: str | None = None, now: datetime | None = None) -> dict[str, Any]:
        moment = _utc(now)
        state = self.load(player_id, profile_entries, now=moment)
        values = self._story_views(state, _profiles(profile_entries), now=moment)
        if level:
            values = [story for story in values if story["level"] == level]
        if status:
            values = [story for story in values if story["status"] == status]
        if npc_id:
            values = [story for story in values if npc_id in story["participant_ids"]]
        if household_id:
            values = [story for story in values if story.get("household_id") == household_id]
        if game_date:
            values = [story for story in values if str(story.get("created_at", ""))[:10] == game_date]
        return {"stories": values, "world_version": state["revision"],
                "server_time": moment.isoformat(), "next_transition_at": state.get("next_transition_at")}

    def story(self, player_id: str, profile_entries: Sequence[Mapping[str, Any]], story_id: str,
              *, state: Mapping[str, Any] | None = None, now: datetime | None = None) -> dict[str, Any]:
        source = state or self.load(player_id, profile_entries, now=now)
        found = next((item for item in self._story_views(source, _profiles(profile_entries), now=_utc(now))
                      if item["id"] == story_id), None)
        if not found:
            raise KeyError(story_id)
        return found

    def households(self, player_id: str, profile_entries: Sequence[Mapping[str, Any]],
                   *, now: datetime | None = None) -> dict[str, Any]:
        city = self.city(player_id, profile_entries, now=now)
        return {"households": city["households"], "world_version": city["world_version"],
                "server_time": city["server_time"]}

    def household(self, player_id: str, profile_entries: Sequence[Mapping[str, Any]], household_id: str,
                  *, now: datetime | None = None) -> dict[str, Any]:
        values = self.households(player_id, profile_entries, now=now)
        found = next((item for item in values["households"] if item["id"] == household_id), None)
        if not found:
            raise KeyError(household_id)
        return found

    def npc_context(self, player_id: str, profile_entries: Sequence[Mapping[str, Any]], npc_id: str,
                    *, now: datetime | None = None) -> dict[str, Any]:
        state = self.load(player_id, profile_entries, now=now)
        if npc_id not in state["residents"]:
            raise KeyError(npc_id)
        resident = state["residents"][npc_id]
        action = LifeAction.from_dict(resident["current_action"])
        profile_map = _profiles(profile_entries)
        resource = next((value for value in state.get("resources", [])
                         if str(value.get("id")) == str(action.target_resource_id)), {})
        object_en, object_zh = _observable_object(resource)
        target_name = None
        if action.target_npc_id:
            target_profile = profile_map.get(action.target_npc_id, {})
            target_name = str(target_profile.get("name") or action.target_npc_id)
        public_location_id = str(action.location_id or resident["current_location_id"])
        if public_location_id.startswith(f"{resident['household_id']}:"):
            public_location_id = str(resident["home_location_id"])
        place_en, place_zh = _observable_location(
            action, public_location_id, str(resident["home_location_id"]),
        )
        observable = project_observable_action(
            action, profile_map.get(npc_id, {}), runtime=resident.get("runtime") or {},
            target_name=target_name, location_label=place_en, location_label_zh=place_zh,
            object_label=object_en, object_label_zh=object_zh,
            location_id=str(action.location_id or public_location_id),
            resource_kind=str(resource.get("kind") or "") or None,
        )
        stories = [story for story in self._story_views(state, profile_map, now=_utc(now))
                   if npc_id in story["participant_ids"]][:5]
        relationships = []
        for pair in self.engine.public_snapshot(state)["relationships"]:
            if npc_id in pair["participant_ids"]:
                relationships.append(pair)
        return project_public_life_context({
            "current_action": {"type": action.action_type, "status": action.status,
                               "phase": life_action_phase(action.status),
                               "visible_intent": observable["visible_intent"],
                               "visible_intent_zh": observable["visible_intent_zh"],
                               "visible_context": observable["visible_context"],
                               "observable_state": observable["observable_state"],
                               "location_id": action.location_id,
                               "target_npc_id": action.target_npc_id,
                               "transition_reason": action.transition_reason,
                               "transitioned_at": (action.transitioned_at.isoformat()
                                                   if action.transitioned_at else None),
                               "interruptibility": ("private" if observable["visible_context"].get("visibility") == "private"
                                                    else "contextual" if action.interruptible else "locked"),
                               "animation_cue": action.animation_cue},
            "recent_life_stories": stories, "npc_relationships": relationships,
            "household_id": resident["household_id"],
        })

    @staticmethod
    def _cast_name(participant_ids: Sequence[str],
                   profiles: Mapping[str, Mapping[str, Any]]) -> tuple[str, str]:
        names = [str(profiles.get(npc_id, {}).get("name") or npc_id) for npc_id in participant_ids]
        if not names:
            return "the residents", "居民们"
        if len(names) == 1:
            return names[0], names[0]
        return (f"{', '.join(names[:-1])} and {names[-1]}",
                "、".join(names))

    @staticmethod
    def _story_location_copy(story: Mapping[str, Any], collision: Mapping[str, Any],
                             topic: str) -> dict[str, str]:
        location_id = str(story.get("location_id") or collision.get("location_id") or "")
        location = LOCATION_BY_ID.get(location_id)
        if location:
            return {"id": location_id, "label": location.name,
                    "label_zh": LOCATION_ZH_COPY.get(location_id, location.name)}
        room_copy = {
            "shared_kitchen": ("Shared kitchen", "共用厨房"),
            "bathroom_access": ("Shared bathroom", "共用浴室"),
            "shared_entertainment": ("Living room", "客厅"),
            "dishwashing": ("Household kitchen", "家中厨房"),
            "unequal_care": ("Home", "居民住宅"),
            "privacy": ("Private room", "私人房间"),
            "borrowed_property": ("Home", "居民住宅"),
            "food_shortage": ("Household kitchen", "家中厨房"),
            "noise": ("Home", "居民住宅"),
        }.get(topic)
        if room_copy:
            return {"id": location_id, "label": room_copy[0], "label_zh": room_copy[1]}
        if location_id.startswith("home-") or ":" in location_id:
            return {"id": location_id, "label": "Home", "label_zh": "居民住宅"}
        return {"id": location_id, "label": "In the city", "label_zh": "城市中"}

    @staticmethod
    def _intervention_view(action: str) -> dict[str, str]:
        label, label_zh = INTERVENTION_COPY.get(action, (action.replace("_", " ").title(), action))
        description, description_zh, intent = INTERVENTION_DESCRIPTION_COPY.get(
            action, ("Respond without deciding the residents' feelings for them.",
                     "在不替居民决定感受的前提下作出回应。", "respond"),
        )
        return {"id": action, "label": label, "label_zh": label_zh,
                "description": description, "description_zh": description_zh,
                "intent": intent}

    @staticmethod
    def _story_intervention(state: Mapping[str, Any], story_id: str) -> dict[str, Any] | None:
        matches = [dict(value) for value in (state.get("interventions") or {}).values()
                   if value.get("story_id") == story_id]
        if not matches:
            return None
        return max(matches, key=lambda value: str(value.get("applied_at") or ""))

    @staticmethod
    def _story_aftermath_records(state: Mapping[str, Any], story_id: str) -> list[dict[str, Any]]:
        return [dict(value) for value in state.get("aftermath") or []
                if value.get("story_id") == story_id]

    def _participant_reactions(self, state: Mapping[str, Any], story_id: str,
                               participant_ids: Sequence[str],
                               profiles: Mapping[str, Mapping[str, Any]]) -> list[dict[str, str]]:
        aftermath = self._story_aftermath_records(state, story_id)
        acceptance: dict[str, str] = {}
        for value in aftermath:
            if value.get("kind") == "management_aftermath":
                acceptance = {str(key): str(status) for key, status in
                              dict(value.get("participant_acceptance") or {}).items()}
        reactions = []
        for npc_id in participant_ids:
            status = acceptance.get(npc_id)
            if status not in REACTION_COPY:
                continue
            label, label_zh = REACTION_COPY[status]
            reactions.append({
                "npc_id": npc_id,
                "name": str(profiles.get(npc_id, {}).get("name") or npc_id),
                "reaction": status,
                "label": label,
                "label_zh": label_zh,
            })
        return reactions

    @staticmethod
    def _relationship_consequence(state: Mapping[str, Any], record: Mapping[str, Any],
                                  story_id: str, cast_en: str, cast_zh: str,
                                  relationship_state: str | None) -> dict[str, Any] | None:
        romance_copy = {
            "dating": (f"{cast_en} now openly relate as a dating couple.",
                       f"{cast_zh}现在公开处于约会关系。", "positive"),
            "partner": (f"{cast_en} now acknowledge each other as partners.",
                        f"{cast_zh}现在正式确认了伴侣关系。", "positive"),
            "separated": (f"{cast_en}'s romantic relationship has ended, while their shared history remains.",
                          f"{cast_zh}的恋爱关系已经结束，但共同经历仍会保留。", "mixed"),
        }.get(str(relationship_state))
        if romance_copy:
            return {"kind": "relationship", "tone": romance_copy[2],
                    "text": romance_copy[0], "translation_zh": romance_copy[1]}
        # Applied evidence is the strongest source because it reflects the
        # manager action and every participant's actual acceptance. Newer core
        # settlements may also attach effects to aftermath. The resolution is
        # only a compatibility fallback for older saved worlds.
        changes = [dict(value.get("deltas") or {}) for value in state.get("relationship_evidence") or []
                   if str(value.get("fact_id") or "") == story_id]
        if not changes:
            for value in state.get("aftermath") or []:
                if value.get("story_id") != story_id:
                    continue
                raw_effects = value.get("relationship_changes") or value.get("relationship_effects")
                if isinstance(raw_effects, Sequence) and not isinstance(raw_effects, (str, bytes)):
                    changes.extend(dict(effect) for effect in raw_effects if isinstance(effect, Mapping))
        if not changes:
            changes = list((record.get("resolution") or {}).get("relationship_changes") or [])
        positive = negative = False
        for raw in changes:
            for dimension in ("familiarity", "trust", "affinity", "respect", "comfort"):
                delta = int(raw.get(dimension, 0))
                positive = positive or delta > 0
                negative = negative or delta < 0
            for dimension in ("tension", "resentment"):
                delta = int(raw.get(dimension, 0))
                negative = negative or delta > 0
                positive = positive or delta < 0
        if not positive and not negative:
            return None
        if positive and negative:
            text = f"{cast_en} feel closer in some ways, though some tension remains."
            text_zh, tone = f"{cast_zh}在某些方面更亲近了，但仍有一些紧张没有消散。", "mixed"
        elif positive:
            text = f"The relationship between {cast_en} feels warmer and steadier after this."
            text_zh, tone = f"这件事之后，{cast_zh}之间的关系显得更温暖、更稳定。", "positive"
        else:
            text = f"The relationship between {cast_en} carries more visible tension after this."
            text_zh, tone = f"这件事之后，{cast_zh}之间留下了更明显的紧张感。", "negative"
        return {"kind": "relationship", "tone": tone, "text": text,
                "translation_zh": text_zh}

    @staticmethod
    def _resource_consequence(state: Mapping[str, Any], record: Mapping[str, Any],
                              topic: str) -> dict[str, Any] | None:
        collision = dict(record.get("collision") or {})
        resource_id = str(collision.get("resource_id") or "")
        aftermath = [dict(value) for value in state.get("aftermath") or []
                     if value.get("story_id") == (record.get("story") or {}).get("id")]
        if topic == "food_shortage" and any(value.get("kind") == "resource_restock" for value in aftermath):
            return {"kind": "resource", "tone": "positive",
                    "text": "The household food supply was replenished, so cooking can continue.",
                    "translation_zh": "家里的食材已经得到补充，可以继续做饭了。"}
        if not resource_id:
            return None
        resource = next((dict(value) for value in state.get("resources") or []
                         if str(value.get("id") or "") == resource_id), {})
        queue = list(resource.get("queue") or [])
        reservations = list(resource.get("reservations") or [])
        label = {"shared_kitchen": ("kitchen", "厨房"),
                 "bathroom_access": ("bathroom", "浴室"),
                 "shared_entertainment": ("television", "电视")}.get(topic, ("shared resource", "共享设施"))
        if queue:
            return {"kind": "resource", "tone": "mixed",
                    "text": f"The {label[0]} is still being shared in an orderly queue.",
                    "translation_zh": f"{label[1]}仍在按顺序共用。"}
        if reservations:
            return {"kind": "resource", "tone": "neutral",
                    "text": f"The {label[0]} remains in use, but nobody is left waiting.",
                    "translation_zh": f"{label[1]}仍在使用中，但已经没有人继续等待。"}
        return {"kind": "resource", "tone": "positive",
                "text": f"The {label[0]} is available again.",
                "translation_zh": f"{label[1]}现在又可以使用了。"}

    @staticmethod
    def _wellbeing_consequence(record: Mapping[str, Any]) -> dict[str, Any] | None:
        resolution = dict(record.get("resolution") or {})
        if not resolution:
            return None
        before = int(resolution.get("severity_before", 0))
        after = int(resolution.get("severity_after", before))
        if after + 4 < before:
            return {"kind": "wellbeing", "tone": "positive",
                    "text": "The immediate pressure eased, giving everyone room to continue their day.",
                    "translation_zh": "眼前的压力有所缓解，大家可以继续自己的日常。"}
        if after > before + 4:
            return {"kind": "wellbeing", "tone": "negative",
                    "text": "The moment left visible strain that may affect what happens next.",
                    "translation_zh": "这一刻留下了明显的压力，可能会影响之后的发展。"}
        return {"kind": "wellbeing", "tone": "neutral",
                "text": "The immediate situation settled, though its effects may carry into later choices.",
                "translation_zh": "眼前的情况暂时稳定下来，但影响可能延续到之后的选择中。"}

    def _outcome_view(self, state: Mapping[str, Any], record: Mapping[str, Any],
                      story: Mapping[str, Any], profiles: Mapping[str, Mapping[str, Any]],
                      cast_en: str, cast_zh: str, topic: str) -> dict[str, Any] | None:
        status = str(story.get("status") or "open")
        if status not in {"resolved_autonomously", "resolved_with_management", "archived"}:
            return None
        story_id = str(story["id"])
        intervention = self._story_intervention(state, story_id)
        relationship_state = str((story.get("visible_facts") or {}).get("relationship_state") or "") or None
        reactions = self._participant_reactions(state, story_id,
                                                [str(value) for value in story.get("participant_ids", [])],
                                                profiles)
        if not reactions and relationship_state in {"dating", "partner", "separated"}:
            reaction_copy = ({
                "dating": ("chose to begin this relationship together", "共同选择开始这段关系", "mutual_choice"),
                "partner": ("chose to acknowledge the partnership together", "共同选择确认伴侣关系", "mutual_choice"),
                "separated": ("is adjusting to the relationship change", "正在适应关系的变化", "relationship_changed"),
            })[relationship_state]
            reactions = [{
                "npc_id": npc_id,
                "name": str(profiles.get(npc_id, {}).get("name") or npc_id),
                "reaction": reaction_copy[2], "label": reaction_copy[0],
                "label_zh": reaction_copy[1],
            } for npc_id in story.get("participant_ids", [])]
        consequences = [value for value in (
            self._relationship_consequence(state, record, story_id, cast_en, cast_zh, relationship_state),
            self._resource_consequence(state, record, topic),
            self._wellbeing_consequence(record),
        ) if value]
        if relationship_state == "dating":
            aftermath = f"{cast_en} chose to begin dating. Their relationship is now openly acknowledged."
            aftermath_zh = f"{cast_zh}决定开始约会，这段关系现在已经被公开确认。"
            result, outcome_tone = "accepted", "positive"
        elif relationship_state == "partner":
            aftermath = f"{cast_en} chose to become partners and carry the relationship forward together."
            aftermath_zh = f"{cast_zh}决定成为伴侣，一起继续经营这段关系。"
            result, outcome_tone = "accepted", "positive"
        elif relationship_state == "separated":
            aftermath = f"{cast_en} ended the romance respectfully. Their shared history remains part of city life."
            aftermath_zh = f"{cast_zh}体面地结束了恋爱关系，共同经历仍会留在城市生活中。"
            result, outcome_tone = "changed", "mixed"
        elif intervention:
            result = str(intervention.get("outcome") or "mixed")
            action_view = self._intervention_view(str(intervention.get("action") or "respond"))
            result_copy = {
                "accepted": ("accepted your support", "接受了你的帮助"),
                "mixed": ("responded differently to your support", "对你的帮助作出了不同回应"),
                "misunderstood": ("misunderstood what you were trying to do", "误解了你想提供的帮助"),
                "refused": ("chose not to follow your suggestion", "选择不采纳你的建议"),
                "backfired": ("felt your involvement made the situation harder", "觉得你的介入让局面变得更难处理"),
            }.get(result, ("responded to your involvement", "对你的介入作出了回应"))
            outcome_tone = {"accepted": "positive", "mixed": "mixed",
                            "misunderstood": "uncertain", "refused": "negative",
                            "backfired": "negative"}.get(result, "neutral")
            aftermath = f"{cast_en} {result_copy[0]}: {action_view['label']}."
            aftermath_zh = f"{cast_zh}{result_copy[1]}：{action_view['label_zh']}。"
        else:
            result, outcome_tone = "autonomous", "neutral"
            aftermath = f"{cast_en} handled this moment without management intervention."
            aftermath_zh = f"{cast_zh}在没有管理者介入的情况下走过了这一刻。"
        visible_consequence = next(
            (value for value in consequences
             if not relationship_state or value.get("kind") != "relationship"),
            consequences[0] if consequences else None,
        )
        if visible_consequence:
            aftermath = f"{aftermath} {visible_consequence['text']}"
            aftermath_zh = f"{aftermath_zh}{visible_consequence['translation_zh']}"
        return {
            "mode": "managed" if intervention or status == "resolved_with_management" else "autonomous",
            "result": result, "tone": outcome_tone,
            "selected_action": str(intervention.get("action")) if intervention else None,
            "participant_reactions": reactions,
            "consequences": consequences,
            "aftermath": aftermath,
            "aftermath_zh": aftermath_zh,
        }

    @staticmethod
    def _interaction_presentation(record: Mapping[str, Any], *, topic: str,
                                  participant_ids: Sequence[str],
                                  profiles: Mapping[str, Mapping[str, Any]],
                                  relationships: Mapping[Any, Any],
                                  can_intervene: bool,
                                  outcome: Mapping[str, Any] | None) -> dict[str, Any]:
        """Return a safe staged scene, rebuilding only legacy records.

        New stories persist their authored scene beside the collision.  The
        compatibility path below lets pre-upgrade worlds gain the richer view,
        while subsequent reads of new stories remain byte-for-byte stable even
        if a resident's editable profile later changes.
        """
        raw_scene = record.get("interaction")
        if not isinstance(raw_scene, Mapping):
            resolution = dict(record.get("resolution") or {})
            resolution.setdefault("requires_intervention", can_intervene)
            raw_scene = build_interaction_scene(
                collision=dict(record.get("collision") or {
                    "id": str((record.get("story") or {}).get("id") or "legacy-story"),
                    "scenario_id": "", "topic": topic,
                    "participant_ids": list(participant_ids),
                }),
                resolution=resolution, profiles=profiles,
                relationships=relationships,
                intervention_available=can_intervene,
            )
        public = public_interaction_scene(
            raw_scene, participant_ids=participant_ids,
            can_intervene=can_intervene,
        )
        if public is None:
            # A malformed legacy/custom record must still have a playable,
            # bilingual scene without allowing arbitrary persisted fields into
            # the public contract.
            fallback = build_interaction_scene(
                collision={"id": str((record.get("story") or {}).get("id") or "fallback-story"),
                           "scenario_id": "", "topic": topic,
                           "participant_ids": list(participant_ids)},
                resolution={"requires_intervention": can_intervene},
                profiles=profiles, relationships=relationships,
                intervention_available=can_intervene,
            )
            public = public_interaction_scene(
                fallback, participant_ids=participant_ids,
                can_intervene=can_intervene,
            ) or {"version": 1, "stages": [], "beats": []}
        if outcome:
            tone = str(outcome.get("tone") or next(
                (str(value.get("tone")) for value in outcome.get("consequences", [])
                 if value.get("kind") == "relationship"), "neutral",
            ))
            aftermath = {
                "id": stable_id("interaction-aftermath", (record.get("story") or {}).get("id"), tone),
                "speaker_id": None,
                "text": str(outcome["aftermath"]),
                "translation_zh": str(outcome["aftermath_zh"]),
                "animation_cue": "happy" if tone == "positive" else "sad" if tone == "negative" else "look_around",
                "emotion": "warm" if tone == "positive" else "tense" if tone == "negative" else "reflective",
                "phase": "aftermath", "duration_ms": 3600,
            }
            public["stages"].append({
                "id": "aftermath", "label": "What remained", "label_zh": "留下的变化",
                "duration_ms": aftermath["duration_ms"], "can_intervene_after": False,
                "beats": [aftermath],
            })
            public["beats"].append(aftermath)
        return public

    @staticmethod
    def _is_story_presentable(story: Mapping[str, Any], now: datetime) -> bool:
        """Mirror the core presentation TTL without hiding history endpoints."""
        if not story.get("observable"):
            return False
        if not story.get("observed_at"):
            return True
        expires_at = story.get("presentation_expires_at")
        if not expires_at:
            return True
        try:
            expiry = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            return True
        return _utc(expiry) > _utc(now)

    def _story_views(self, state: Mapping[str, Any], profiles: Mapping[str, Mapping[str, Any]],
                     *, now: datetime | None = None) -> list[dict[str, Any]]:
        moment = _utc(now)
        result: list[dict[str, Any]] = []
        for record in (state.get("stories") or {}).values():
            story = dict(record.get("story") or {})
            if not story.get("observable") or story.get("level") == "ambient":
                continue
            collision = dict(record.get("collision") or {})
            topic = str(collision.get("topic") or (story.get("visible_facts") or {}).get("topic") or "")
            title, title_zh, summary, summary_zh = TOPIC_COPY.get(
                topic, ("A life moment", "生活中的一个片段", "Something unfolded between the residents.", "居民之间发生了一件值得留意的事。"),
            )
            visible_facts = dict(story.get("visible_facts") or {})
            relationship_state = visible_facts.get("relationship_state")
            relationship_copy = {
                "dating": ("A new relationship", "一段新的恋爱关系", "They chose to start dating.", "他们决定开始约会。"),
                "partner": ("They chose each other", "他们确认了彼此", "Their relationship became an acknowledged partnership.", "他们正式确认了伴侣关系。"),
                "separated": ("A relationship changed", "一段关系发生了变化", "At least one of them chose to end the romantic relationship.", "他们之中至少有一人决定结束这段恋爱关系。"),
            }.get(str(relationship_state))
            if relationship_copy:
                title, title_zh, summary, summary_zh = relationship_copy
            elif visible_facts.get("relationship_development"):
                title, title_zh = "Could this be something more?", "这会不会不只是友情？"
                summary, summary_zh = ("Their closeness became visible enough to acknowledge together.",
                                       "他们之间的亲近已经明显到可以一起正视了。")
            participant_ids = [str(value) for value in story.get("participant_ids", [])]
            participants = [{"id": npc_id, "name": str(profiles.get(npc_id, {}).get("name") or npc_id)}
                            for npc_id in participant_ids]
            cast_en, cast_zh = self._cast_name(participant_ids, profiles)
            location_copy = self._story_location_copy(story, collision, topic)
            if location_copy["id"] in LOCATION_BY_ID:
                setting_en = f"At {location_copy['label']}"
            elif location_copy["label"] == "Home":
                setting_en = "At home"
            elif location_copy["label"] == "In the city":
                setting_en = "In the city"
            else:
                setting_en = f"In the {location_copy['label'].lower()}"
            summary = f"{setting_en}, this moment involves {cast_en}. {summary}"
            summary_zh = f"这件事发生在{location_copy['label_zh']}，涉及{cast_zh}。{summary_zh}"
            status = str(story.get("status") or "open")
            public_status = ({"intervention_window": "awaiting_management", "archived": "closed"}.get(status)
                             or ("observed" if story.get("observed_at") and status == "open" else status))
            actions = [str(value) for value in story.get("intervention_actions", [])]
            outcome = self._outcome_view(state, record, story, profiles, cast_en, cast_zh, topic)
            interaction = self._interaction_presentation(
                record, topic=topic, participant_ids=participant_ids,
                profiles=profiles, relationships=state.get("relationships") or {},
                can_intervene=public_status == "awaiting_management", outcome=outcome,
            )
            trouble = None
            if story.get("trouble_signal"):
                band = str((story.get("visible_facts") or {}).get("severity_band") or "medium")
                trouble = {"id": f"trouble-{story['id']}", "kind": topic or "life_incident",
                           "summary": summary, "summary_zh": summary_zh, "disclosure": "visible",
                           "severity": band, "story_id": story["id"],
                           "created_at": story.get("created_at"),
                           "expires_at": story.get("intervention_expires_at")}
            household_ids = {state["residents"][npc_id]["household_id"] for npc_id in participant_ids
                             if npc_id in state.get("residents", {})}
            result.append({
                "id": story["id"], "level": story["level"], "status": public_status,
                "presentable": self._is_story_presentable(story, moment),
                "title": title, "title_zh": title_zh, "summary": summary, "summary_zh": summary_zh,
                "participant_ids": participant_ids, "npc_ids": participant_ids,
                "participants": participants,
                "household_id": next(iter(household_ids)) if len(household_ids) == 1 else None,
                "location_id": story.get("location_id"), "created_at": story.get("created_at"),
                "updated_at": story.get("updated_at"), "observed_at": story.get("observed_at"),
                "intervention_expires_at": story.get("intervention_expires_at"),
                "trouble_signal": trouble,
                "management": {"can_intervene": public_status == "awaiting_management",
                               "prompt": MANAGEMENT_PROMPT_COPY.get(
                                   topic, ("How would you respond without deciding for them?", "你想怎样回应，同时把决定权留给他们？"),
                               )[0],
                               "prompt_zh": MANAGEMENT_PROMPT_COPY.get(
                                   topic, ("How would you respond without deciding for them?", "你想怎样回应，同时把决定权留给他们？"),
                               )[1],
                               "actions": [self._intervention_view(action) for action in actions]},
                "presentation": {
                    **interaction,
                    "subject": f"{TOPIC_COPY.get(topic, (title, title_zh, '', ''))[0]} · {location_copy['label']}",
                    "subject_zh": f"{TOPIC_COPY.get(topic, (title, title_zh, '', ''))[1]} · {location_copy['label_zh']}",
                    "location": location_copy,
                },
                "outcome": outcome,
                "participant_reactions": list(outcome.get("participant_reactions", [])) if outcome else [],
                "consequences": list(outcome.get("consequences", [])) if outcome else [],
                "aftermath": outcome.get("aftermath") if outcome else None,
                "aftermath_zh": outcome.get("aftermath_zh") if outcome else None,
            })
        return sorted(result, key=lambda item: (str(item.get("created_at") or ""), item["id"]), reverse=True)

    def _thread_views(self, state: Mapping[str, Any], profiles: Mapping[str, Mapping[str, Any]]) -> list[dict[str, Any]]:
        result = []
        for raw in (state.get("threads") or {}).values():
            topic = str(raw.get("topic") or "")
            title, title_zh, summary, summary_zh = TOPIC_COPY.get(
                topic, ("An ongoing story", "仍在继续的故事", "This pattern may matter again later.", "这段经历以后可能还会产生影响。"),
            )
            participant_ids = [str(value) for value in raw.get("participant_ids", [])]
            status = "closed" if raw.get("status") in {"resolved", "dormant"} else "open"
            result.append({
                "id": raw["id"], "level": "thread", "status": status,
                "title": title, "title_zh": title_zh, "summary": summary, "summary_zh": summary_zh,
                "participant_ids": participant_ids, "npc_ids": participant_ids,
                "participants": [{"id": npc_id, "name": str(profiles.get(npc_id, {}).get("name") or npc_id)}
                                 for npc_id in participant_ids],
                "created_at": raw.get("created_at"), "updated_at": raw.get("updated_at"),
                "aftermath": f"This has resurfaced {int(raw.get('recurrence_count', 0))} time(s).",
                "aftermath_zh": f"这件事已经再次出现了 {int(raw.get('recurrence_count', 0))} 次。",
            })
        return sorted(result, key=lambda item: str(item.get("updated_at") or ""), reverse=True)
