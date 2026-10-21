"""Community progression backed by the existing wallet, residents and world.

Scenes are receipts of actual commands. Replaying one never reapplies its
money, care or relationship effects. The relationship engine remains the
authority for friendship labels and for each resident's romantic consent.
"""
from __future__ import annotations

import copy
import hashlib
import json
import threading
from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .agent import compile_persona
from .arrival import CATALOG, ArrivalError, _fingerprint
from .life import stable_id
from .models import NpcProfile
from .relationships import Appraisal, RelationshipEvidence, RelationshipPair, RelationshipTransition
from . import neighborhood_economy as economy


GIFTS = [
    {"id": "sketchbook", "name": "A little sketchbook", "name_zh": "小小速写本", "kind": "item", "price": 22,
     "description": "A real personal belonging for drawing and sharing stories.", "description_zh": "成为居民的私人物品，用来画画、留下日常。", "emoji": "📒"},
    {"id": "plant", "name": "A desk plant", "name_zh": "桌边小绿植", "kind": "item", "price": 28,
     "description": "A small new companion in their room.", "description_zh": "成为居民房间里的一件私人物品。", "emoji": "🪴"},
    {"id": "warm_greeting", "name": "Warm greetings", "name_zh": "温柔问候", "kind": "micro",
     "description": "Practice welcoming others; gently increases warmth.", "description_zh": "练习更体贴地打招呼，亲和倾向增加 8。", "emoji": "👋"},
    {"id": "little_joke", "name": "A little humor", "name_zh": "一点小幽默", "kind": "micro",
     "description": "Practice a playful remark; gently increases humor.", "description_zh": "练习轻松的小玩笑，幽默倾向增加 8。", "emoji": "✨"},
]
CLOTHES = [
    {"id": "student_sage", "name": "Sage school days", "name_zh": "鼠尾草校园装", "price": 30,
     "outfit": "student", "outfit_color": "#6e9b83", "models": ["chibi"]},
    {"id": "traveller_blue", "name": "Blue day out", "name_zh": "晴蓝旅行装", "price": 40,
     "outfit": "traveller", "outfit_color": "#7a9cc6", "models": ["chibi"]},
    {"id": "merchant_amber", "name": "Amber market day", "name_zh": "暖杏市集装", "price": 45,
     "outfit": "merchant", "outfit_color": "#e0ad67", "models": ["chibi"]},
    {"id": "ninja_lilac", "name": "A quiet lilac", "name_zh": "暮紫忍者装", "price": 50,
     "outfit": "ninja", "outfit_color": "#8f83bb", "models": ["chibi"]},
]


class MeetingTopic(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=100)
    kind: Literal["person", "object", "activity", "other"]
    person_id: Optional[str] = Field(default=None, max_length=48)

    @field_validator("text")
    @classmethod
    def normalize_text(cls, value):
        value = " ".join(value.split())
        if not value:
            raise ValueError("a topic cannot be blank")
        return value


class MeetingAliases(BaseModel):
    model_config = ConfigDict(extra="forbid")
    a_to_b: str = Field(min_length=1, max_length=24)
    b_to_a: str = Field(min_length=1, max_length=24)

    @field_validator("a_to_b", "b_to_a")
    @classmethod
    def normalize_alias(cls, value):
        value = " ".join(value.split())
        if not value:
            raise ValueError("a nickname cannot be blank")
        return value


class NeighborhoodCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["read_news", "wish", "gift", "buy_clothing", "wear_clothing",
                    "meet", "friendship", "nicknames", "romance", "buy_food", "feed",
                    "claim_support", "buy_gift", "fund_project"]
    idempotency_key: str = Field(min_length=8, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]+$")
    npc_id: Optional[str] = Field(default=None, max_length=48)
    target_id: Optional[str] = Field(default=None, max_length=48)
    item_id: Optional[str] = Field(default=None, max_length=48)
    news_id: Optional[str] = Field(default=None, max_length=80)
    meeting_id: Optional[str] = Field(default=None, max_length=80)
    advice: Optional[Literal["encourage", "discourage"]] = None
    topic: Optional[MeetingTopic] = None
    aliases: Optional[MeetingAliases] = None
    day: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    project_id: Optional[Literal["fountain", "clothing_store", "flower_beds", "plaza_lights"]] = None

    @model_validator(mode="after")
    def current_day_for_support(self):
        if self.action == "claim_support" and not self.day:
            raise ValueError("claim_support requires the displayed economy day")
        return self


def fail(code, message):
    raise ArrivalError("NEIGHBORHOOD_" + code, message)


def now_utc():
    return datetime.now(timezone.utc)


def pair_key(a, b):
    return ":".join(sorted((a, b)))


class NeighborhoodService:
    def __init__(self, db, life, arrival):
        self.db, self.life, self.arrival = db, life, arrival
        self._lock = threading.RLock()

    def _read(self, player):
        row = self.db._connection.execute("SELECT state_json FROM player_neighborhood WHERE player_id=?", (player,)).fetchone()
        state = json.loads(row[0]) if row else {
            "version": 1, "revision": 0, "care": {}, "micro_personalities": {},
            "wishes_spent": 0, "gifts": {}, "wardrobe": {}, "news": [],
            "meetings": [], "scenes": [], "daily": {}, "aliases": {}, "last_receipt": None,
        }
        economy.normalize(state)
        return state

    def _write(self, player, state):
        self.db._connection.execute(
            "INSERT INTO player_neighborhood(player_id,state_json) VALUES (?,?) "
            "ON CONFLICT(player_id) DO UPDATE SET state_json=excluded.state_json,updated_at=CURRENT_TIMESTAMP",
            (player, self.db._json(state)),
        )

    def _care(self, state, wallet, npc):
        if npc == wallet.get("npc_id"):
            return wallet["care"]
        return state["care"].setdefault(npc, {"xp": 0, "level": 1, "satiety": 50, "preferences": {}})

    def _news(self, state, news_id, kind, title, title_zh, body, body_zh):
        if any(item["id"] == news_id for item in state["news"]):
            return
        state["news"].append({"id": news_id, "kind": kind, "title": title, "title_zh": title_zh,
                              "body": body, "body_zh": body_zh, "read": False, "created_at": now_utc().isoformat()})

    def _sync(self, state, wallet, profiles, moment=None):
        earned = sum(max(0, self._care(state, wallet, npc)["level"] - 1) for npc in profiles)
        economy.sync_projects(state, profiles, earned, moment or now_utc())
        if len(profiles) == 1:
            self._news(state, "second-resident", "resident", "Room for one more story", "再认识一位新邻居吧",
                       "Our first resident would love some company. Another neighbor can move in now.",
                       "一个人生活有点安静。现在可以邀请第二位居民入住了。")
        if len(profiles) >= 2:
            self._news(state, "third-resident", "resident", "The neighborhood is growing", "第三位居民也可以入住了",
                       "Introduce neighbors and invite a third. Once they have shared a conversation, you can prepare a clothing shop together.",
                       "介绍邻居认识，再邀请第三人入住。有了相伴出门的日常，就可以一起筹备服装小店。")
        return earned

    def _public(self, state, wallet, profiles, world):
        moment = now_utc()
        earned = self._sync(state, wallet, profiles, moment)
        day, daily = self._daily(state, moment)
        opened = {key for key, record in state["projects"].items() if record["status"] == "completed"}
        residents = []
        for npc, profile in profiles.items():
            care = copy.deepcopy(self._care(state, wallet, npc))
            raw = (world or {}).get("residents", {}).get(npc, {})
            care["satiety"] = round(raw.get("runtime", {}).get("needs", {}).get("food", care["satiety"]))
            residents.append({"id": npc, "profile": profile, "care": care,
                              "micro_personalities": state["micro_personalities"].get(npc, [])})
        meetings = copy.deepcopy(state["meetings"])
        for meeting in meetings:
            a, b = meeting["npc_id"], meeting["target_id"]
            pair = (world or {}).get("relationships", {}).get(pair_key(a, b), {})
            channels = pair.get("channels", {})
            meeting.update(friendship=channels.get("friendship", "none"), romance=channels.get("romance", "none"))
            meeting["romance_eligible"] = bool(self.life and world and a in profiles and b in profiles
                                                  and self.life.engine._romance_pair_eligible(world, profiles, a, b))
        return {"version": 1, "revision": state["revision"], "enabled": bool(profiles), "coins": wallet["coins"],
                "residents": residents, "unlocks": {"fountain": "fountain" in opened, "clothing_store": "clothing_store" in opened,
                "resident_slots": min(8, max(2, len(profiles) + 1))},
                "projects": economy.public_projects(state, profiles, earned),
                "economy": economy.public_economy(state, daily, day, moment,
                                                   self.life.engine.clock.zone if self.life else timezone.utc),
                "wishes": {"available": max(0, earned - state["wishes_spent"]), "earned": earned, "spent": state["wishes_spent"]},
                "gift_catalog": GIFTS, "gifts": state["gifts"], "clothing_catalog": CLOTHES,
                "wardrobe": state["wardrobe"], "food_catalog": CATALOG, "food_inventory": wallet["inventory"],
                "news": state["news"], "meetings": meetings, "scenes": state["scenes"], "last_receipt": state["last_receipt"]}

    def _prepare(self, player):
        if not self.db.onboarding_state(player)["completed"]:
            fail("WORLD_NOT_READY", "先邀请第一位居民入住吧。")
        wallet = self.arrival.state(player)
        if wallet["enabled"] and wallet["stage"] != "complete":
            fail("ARRIVAL_INCOMPLETE", "先完成第一位居民的欢迎与照料。")
        entries = self.db.list_npc_profiles(player)
        if self.life and entries:
            self.life.load(player, entries)

    def state(self, player):
        with self._lock:
            self._prepare(player)
            def read():
                state, wallet = self._read(player), self.arrival._read(player)
                profiles = {x["id"]: x["profile"] for x in self.db.list_npc_profiles(player)}
                before = self.db._json(state)
                result = self._public(state, wallet, profiles, self.db.get_life_world_state(player))
                if self.db._json(state) != before:
                    state["revision"] += 1
                    result["revision"] = state["revision"]
                self._write(player, state)
                return result
            return self.db._life_transaction(read)

    @staticmethod
    def _resident(profiles, npc):
        if not npc or npc not in profiles:
            fail("RESIDENT_NOT_FOUND", "这位居民不在你的社区里。")
        return profiles[npc]

    @staticmethod
    def _item(catalog, item_id):
        item = next((item for item in catalog if item["id"] == item_id), None)
        if item is None:
            fail("ITEM_NOT_FOUND", "没有找到这件物品。")
        return item

    def _scene(self, state, scene_id, kind, participants, title, title_zh, lines, result):
        beats = [{"id": f"{scene_id}:{index}", **({"speaker_id": speaker} if speaker else {}),
                  "text": en, "text_zh": zh, "shot": shot, "cue": cue}
                 for index, (speaker, en, zh, shot, cue) in enumerate(lines)]
        scene = {"id": scene_id, "kind": kind, "participant_ids": participants,
                 "title": title, "title_zh": title_zh, "beats": beats, "result": result,
                 "created_at": now_utc().isoformat()}
        state["scenes"] = (state["scenes"] + [scene])[-80:]
        return scene

    def _memory(self, player, npc, source, content, kind="life"):
        self.db._insert_chat_memory(player, npc, {"kind": kind, "content": content, "importance": 4,
                                                  "access_stage": "stranger", "source_event_id": source})

    def _profile(self, player, npc, profile):
        profile = NpcProfile(**profile).model_dump()
        self.db._connection.execute("UPDATE npc_profiles SET profile_json=?,updated_at=CURRENT_TIMESTAMP WHERE player_id=? AND npc_id=?",
                                    (self.db._json(profile), player, npc))
        persona = compile_persona(profile, (self.db.get_runtime_state(player, npc) or {}).get("growth"))
        self.db._connection.execute(
            "INSERT INTO npc_personas(player_id,npc_id,persona_json) VALUES (?,?,?) "
            "ON CONFLICT(player_id,npc_id) DO UPDATE SET persona_json=excluded.persona_json,updated_at=CURRENT_TIMESTAMP",
            (player, npc, self.db._json(persona)))
        return profile

    def _save_world(self, player, world):
        if world is None:
            return
        self.arrival._save_world(player, world)
        for pair in world.get("relationships", {}).values():
            self.db._save_relationship_pair_projection(player, pair)
        for evidence in world.get("relationship_evidence", []):
            self.db._append_relationship_evidence(player, {**evidence, "context": {"thread_id": evidence.get("thread_id")}})

    def _daily(self, state, moment):
        day = self.life.engine.clock.game_date(moment).isoformat() if self.life else moment.date().isoformat()
        state["daily"] = {key: value for key, value in sorted(state["daily"].items())[-13:]}
        return day, state["daily"].setdefault(day, {"rewarded_pairs": [], "topics": {}, "romance_pairs": []})

    def command(self, player, request: NeighborhoodCommand):
        payload = request.model_dump(exclude={"idempotency_key"})
        # These optional fields were added with community projects. Keeping
        # absent fields out preserves fingerprints of pre-upgrade commands
        # whose responses may have been lost while the client was offline.
        for field in ("day", "project_id"):
            if payload[field] is None:
                payload.pop(field)
        fingerprint = _fingerprint(payload)
        with self._lock:
            self._prepare(player)
            def write():
                previous = self.db._connection.execute(
                    "SELECT fingerprint,response_json FROM neighborhood_receipts WHERE player_id=? AND idempotency_key=?",
                    (player, request.idempotency_key)).fetchone()
                state, wallet = self._read(player), self.arrival._read(player)
                profiles = {x["id"]: x["profile"] for x in self.db.list_npc_profiles(player)}
                world = self.db.get_life_world_state(player)
                self._sync(state, wallet, profiles)
                if previous:
                    if previous[0] != fingerprint:
                        fail("KEY_CONFLICT", "这次操作编号已经用于其他操作。")
                    response = self._public(state, wallet, profiles, world)
                    cached = json.loads(previous["response_json"])
                    response["last_receipt"] = cached["last_receipt"]
                    original_scene = cached.get("scene")
                    if original_scene and not any(s["id"] == original_scene["id"] for s in response["scenes"]):
                        response["scenes"] = response["scenes"] + [original_scene]
                    return response
                scene_id = stable_id("neighborhood", player, request.idempotency_key)
                moment = now_utc()
                result = self._apply(player, state, wallet, profiles, world, request, scene_id, moment)
                self._sync(state, wallet, profiles)
                state["revision"] += 1
                state["last_receipt"] = {"id": scene_id, "action": request.action, **result}
                wallet["revision"] += 1
                self.arrival._write(player, wallet)
                self._save_world(player, world)
                self._write(player, state)
                response = self._public(state, wallet, profiles, world)
                # Keep one command receipt and its exact scene, rather than
                # duplicating the entire growing history for every command.
                saved_receipt = {"last_receipt": state["last_receipt"], "scene": next(
                    (scene for scene in state["scenes"] if scene["id"] == result.get("scene_id")), None)}
                self.db._connection.execute(
                    "INSERT INTO neighborhood_receipts(player_id,idempotency_key,fingerprint,response_json) VALUES (?,?,?,?)",
                    (player, request.idempotency_key, fingerprint, self.db._json(saved_receipt)))
                return response
            return self.db._life_transaction(write)

    def _apply(self, player, state, wallet, profiles, world, request, sid, moment):
        action, npc, item_id = request.action, request.npc_id, request.item_id
        if action == "claim_support":
            day, daily = self._daily(state, moment)
            if request.day != day:
                fail("DAY_EXPIRED", "日期已经更新，请刷新今日补助后再领取。")
            if daily.get("support_claimed"):
                fail("SUPPORT_ALREADY_CLAIMED", "今天的社区运营补助已经领取了，明天再来吧。")
            daily["support_claimed"] = True
            economy.transfer(state, wallet, sid, economy.SUPPORT_AMOUNT,
                             "City community support", "市政社区运营补助", moment)
            return {"outcome": "support_claimed", "coins_awarded": economy.SUPPORT_AMOUNT, "day": day}
        if action == "fund_project":
            spec = next((item for item in economy.PROJECTS if item["id"] == request.project_id), None)
            if spec is None:
                fail("PROJECT_NOT_FOUND", "没有找到这项社区筹备。")
            record = state["projects"][spec["id"]]
            if record["status"] == "completed":
                fail("PROJECT_COMPLETED", "这项筹备已经完成了，可以去地图上看看。")
            if record["status"] != "proposed":
                fail("PROJECT_NOT_READY", "先看看居民的需求，完成这项筹备的前提吧。")
            if wallet["coins"] < spec["cost"]:
                fail("INSUFFICIENT_COINS", "生活币还不够，领取今日社区补助或帮助邻居后再来吧。")
            economy.transfer(state, wallet, sid, -spec["cost"],
                             "Prepare " + spec["title"].lower(), "筹备" + spec["title_zh"], moment)
            record.update(status="completed", completed_at=moment.isoformat())
            self._news(state, spec["news_id"], "building", spec["news_title"], spec["news_title_zh"],
                       spec["body"], spec["body_zh"])
            requester = record.get("requester_id")
            if requester in profiles:
                self._memory(player, requester, sid,
                             f"管理员回应大家的需求，筹备完成了{spec['title_zh']}，现在可以在社区里使用了。")
            return {"outcome": "project_completed", "project_id": spec["id"], "news_id": spec["news_id"]}
        if action == "buy_gift":
            item = self._item(GIFTS, item_id)
            if item["kind"] != "item" or "price" not in item:
                fail("GIFT_NOT_FOR_SALE", "微个性只能通过许愿获得，不能用生活币购买。")
            if sum(state["gifts"].values()) >= 40:
                fail("INVENTORY_FULL", "礼物已经很多啦，先送出一些吧。")
            if wallet["coins"] < item["price"]:
                fail("INSUFFICIENT_COINS", "生活币还不够，领取今日社区补助或帮助邻居后再来吧。")
            economy.transfer(state, wallet, sid, -item["price"],
                             "Buy " + item["name"].lower(), "购买" + item["name_zh"], moment)
            state["gifts"][item_id] = state["gifts"].get(item_id, 0) + 1
            return {"outcome": "gift_bought", "item_id": item_id}
        if action == "read_news":
            item = next((item for item in state["news"] if item["id"] == request.news_id), None)
            if item is None:
                fail("NEWS_NOT_FOUND", "没有找到这条社区新闻。")
            item["read"] = True
            return {"outcome": "read", "news_id": request.news_id}
        if action == "wish":
            if state["projects"]["fountain"]["status"] != "completed":
                fail("FOUNTAIN_LOCKED", "居民已经攒下的愿望会保留，先一起把许愿喷泉筹备好吧。")
            item = self._item(GIFTS, item_id)
            earned = self._sync(state, wallet, profiles)
            if earned <= state["wishes_spent"]:
                fail("NO_WISHES", "许愿次数用完了，下次照料升级后再来吧。")
            if sum(state["gifts"].values()) >= 40:
                fail("INVENTORY_FULL", "礼物已经很多啦，先送出一些吧。")
            state["wishes_spent"] += 1
            state["gifts"][item_id] = state["gifts"].get(item_id, 0) + 1
            self._scene(state, sid, "wish", [], "A little wish comes true", "小小愿望实现了", [
                (None, "One wish for a little more joy in our neighborhood.", "许个愿，让社区的日常多一点快乐。", "wide", "wish"),
                (None, f"Your wish brought {item['name'].lower()}.", f"愿望带来了「{item['name_zh']}」。现在可以送给居民了。", "wide", "happy"),
            ], {"outcome": "wish_granted"})
            return {"scene_id": sid, "outcome": "wish_granted"}
        if action == "gift":
            profile = self._resident(profiles, npc)
            item = self._item(GIFTS, item_id)
            if state["gifts"].get(item_id, 0) < 1:
                fail("NO_GIFT", "背包里还没有这份礼物，先去许个愿吧。")
            owned_micro = state["micro_personalities"].setdefault(npc, [])
            if item["kind"] == "micro" and item_id in owned_micro:
                fail("MICRO_ALREADY_LEARNED", "这位居民已经学会这个微个性了。")
            state["gifts"][item_id] -= 1
            care = self._care(state, wallet, npc)
            care["xp"] += 8
            care["level"] = 1 + care["xp"] // 20
            if item["kind"] == "micro":
                axes = compile_persona(profile)["axes"]
                axis = "warmth" if item_id == "warm_greeting" else "humor"
                axes[axis] = min(100, axes[axis] + 8)
                profile = {**profile, "personalityAxes": axes}
                profiles[npc] = self._profile(player, npc, profile)
                owned_micro.append(item_id)
            elif world and npc in world["residents"]:
                world["residents"][npc].setdefault("personal_inventory", []).append({
                    "id": sid, "kind": "hobby_supplies" if item_id == "sketchbook" else "personal_belonging",
                    "label_seed": item["name"], "label_en": item["name"], "label_zh": item["name_zh"],
                    "owner_id": npc, "share_policy": "ask_first", "storage": "private_room", "available": True})
            self._memory(player, npc, sid, f"管理员送给我「{item['name_zh']}」。" +
                         ("我开始练习这种新的表达方式。" if item["kind"] == "micro" else "这是我现在拥有的私人物品。"))
            self._scene(state, sid, "gift", [npc], "Something just for you", "送给你的心意", [
                (npc, "Is that for me?", "这是送给我的吗？", "speaker", "receive"),
                (npc, "Thank you! I'll give this a little place in my day.", "谢谢！我会让它成为日常的一小部分。", "speaker", "happy"),
            ], {"outcome": "gift_received"})
            return {"scene_id": sid, "outcome": "gift_received", "xp_gained": 8}
        if action in {"buy_clothing", "wear_clothing"}:
            if state["projects"]["clothing_store"]["status"] != "completed":
                fail("SHOP_LOCKED", "邻居们提出换装需求后，一起筹备服装店吧。")
            item = self._item(CLOTHES, item_id)
            if action == "buy_clothing":
                if state["wardrobe"].get(item_id, 0):
                    fail("CLOTHING_OWNED", "这套衣服已经在共享衣橱里了。")
                if wallet["coins"] < item["price"]:
                    fail("INSUFFICIENT_COINS", "生活币还不够，领取今日社区补助或帮助邻居后再来吧。")
                economy.transfer(state, wallet, sid, -item["price"],
                                 "Buy " + item["name"].lower(), "购买" + item["name_zh"], moment)
                state["wardrobe"][item_id] = 1
                return {"outcome": "clothing_bought"}
            profile = self._resident(profiles, npc)
            if not state["wardrobe"].get(item_id):
                fail("CLOTHING_NOT_OWNED", "先把这套衣服带回共享衣橱吧。")
            if profile["avatar"]["model"] not in item["models"]:
                fail("CLOTHING_INCOMPATIBLE", "这套服装适合 Chibi 居民，City 居民目前还不支持拆分换装。")
            profiles[npc] = self._profile(player, npc, {**profile, "avatar": {
                **profile["avatar"], "outfit": item["outfit"], "outfitColor": item["outfit_color"]}})
            self._memory(player, npc, sid, f"我换上了「{item['name_zh']}」，这是共享衣橱里的新搭配。")
            self._scene(state, sid, "clothing", [npc], "A new look", "换个新心情", [
                (npc, "Let's try this on.", "来试试这套搭配吧。", "wide", "think"),
                (npc, "A little different. I like trying something new.", "有点不一样呢。试试新搭配还挺有趣。", "speaker", "happy"),
            ], {"outcome": "outfit_changed"})
            return {"scene_id": sid, "outcome": "outfit_changed"}
        if action in {"buy_food", "feed"}:
            return self._food(player, state, wallet, profiles, world, request, sid, moment)
        if not self.life or not world:
            fail("WORLD_REQUIRED", "社区交往需要开启生活模拟。")
        if action == "meet":
            a, b = request.npc_id, request.target_id
            self._resident(profiles, a)
            self._resident(profiles, b)
            if a == b:
                fail("DISTINCT_RESIDENTS_REQUIRED", "介绍两位不同的居民认识吧。")
            existing = next((m for m in state["meetings"] if pair_key(m["npc_id"], m["target_id"]) == pair_key(a, b)
                             and m["status"] == "awaiting_advice"), None)
            if existing:
                return {"outcome": "awaiting_advice", "meeting_id": existing["id"]}
            if pair_key(a, b) not in world["relationships"]:
                fail("RELATIONSHIP_NOT_READY", "邻居正在安顿，请稍后再试。")
            meeting = {"id": sid, "npc_id": a, "target_id": b, "status": "awaiting_advice",
                       "friendship": "none", "romance": "none", "romance_advised": False,
                       "created_at": moment.isoformat()}
            aliases = state["aliases"].get(pair_key(a, b))
            if aliases:
                meeting["aliases"] = {"a_to_b": aliases["a_to_b" if aliases["npc_id"] == a else "b_to_a"],
                                      "b_to_a": aliases["b_to_a" if aliases["npc_id"] == a else "a_to_b"]}
            called_b = (meeting.get("aliases") or {}).get("a_to_b") or profiles[b]["name"]
            state["meetings"] = (state["meetings"] + [meeting])[-80:]
            self._scene(state, sid, "meeting", [a, b], "A new conversation", "打个招呼吧", [
                (a, f"Hi, {called_b}. Do you have a moment?", f"嗨，{called_b}。方便聊两句吗？", "two_shot", "wave"),
                (b, "What did you have in mind?", "你想聊些什么呢？", "speaker", "listen"),
                (a, "I'd like to get to know you a little better.", "我想再多了解你一点。", "speaker", "talk"),
            ], {"outcome": "awaiting_advice"})
            return {"scene_id": sid, "outcome": "awaiting_advice", "meeting_id": sid}
        meeting = next((m for m in state["meetings"] if m["id"] == request.meeting_id), None)
        if meeting is None:
            fail("MEETING_NOT_FOUND", "没有找到这次见面。")
        a, b = meeting["npc_id"], meeting["target_id"]
        self._resident(profiles, a)
        self._resident(profiles, b)
        if action == "friendship":
            return self._friendship(player, state, wallet, profiles, world, request, meeting, sid, moment)
        if action == "nicknames":
            if meeting["status"] != "resolved" or not request.aliases:
                fail("NICKNAMES_NOT_READY", "聊过以后，再告诉他们怎样称呼彼此吧。")
            aliases = request.aliases.model_dump()
            meeting["aliases"] = aliases
            state["aliases"][pair_key(a, b)] = {"npc_id": a, "target_id": b, **aliases}
            for owner, target, nickname in ((a, b, aliases["a_to_b"]), (b, a, aliases["b_to_a"])):
                profiles[owner] = self._profile(player, owner, {**profiles[owner], "residentNicknames": {
                    **(profiles[owner].get("residentNicknames") or {}), target: nickname}})
                self._memory(player, owner, sid, f"我现在称呼{profiles[target]['name']}为「{nickname}」。")
            return {"outcome": "nicknames_saved"}
        return self._romance(player, state, profiles, world, request, meeting, sid, moment)

    def _food(self, player, state, wallet, profiles, world, request, sid, moment):
        item = self._item(CATALOG, request.item_id)
        if request.action == "buy_food":
            if wallet["coins"] < item["price"]:
                fail("INSUFFICIENT_COINS", "生活币还不够，领取今日社区补助或帮助邻居后再来吧。")
            if sum(wallet["inventory"].values()) >= 20:
                fail("INVENTORY_FULL", "食物背包已满，先送出一些吧。")
            economy.transfer(state, wallet, sid, -item["price"],
                             "Buy " + item["name"].lower(), "购买" + item["name_zh"], moment)
            wallet["inventory"][item["id"]] = wallet["inventory"].get(item["id"], 0) + 1
            return {"outcome": "food_bought"}
        npc = request.npc_id
        profile = self._resident(profiles, npc)
        if wallet["inventory"].get(item["id"], 0) < 1:
            fail("NO_FOOD", "先买一份食物吧。")
        care = self._care(state, wallet, npc)
        resident = (world or {}).get("residents", {}).get(npc)
        raw_action = (resident or {}).get("current_action") or {}
        if (raw_action.get("status") not in {None, "completed", "interrupted", "abandoned"}
                and (not raw_action.get("interruptible", True)
                     or raw_action.get("action_type") in {"eat", "prepare_food", "sleep", "shower"})):
            fail("RESIDENT_BUSY", "居民正在忙，忙完再送上食物吧。")
        satiety = resident["runtime"]["needs"].get("food", 50) if resident else care["satiety"]
        if satiety >= 85:
            fail("RESIDENT_FULL", "已经吃饱了，稍后再来吧。")
        preference = self.arrival._preference(player, npc, item, profile)
        care.update(xp=care["xp"] + item["xp"], satiety=min(100, satiety + item["satiety"]))
        care["level"] = 1 + care["xp"] // 20
        care["preferences"][item["id"]] = preference
        wallet["inventory"][item["id"]] -= 1
        if resident:
            resident["runtime"]["needs"]["food"] = care["satiety"]
        _, daily = self._daily(state, moment)
        reward = 0 if daily.get("care_reward_claimed") else economy.CARE_REWARD
        if reward:
            daily["care_reward_claimed"] = True
            economy.transfer(state, wallet, sid + ":care", reward,
                             "A resident's thanks for today's meal", "今日照料感谢", moment)
        reactions = {
            -2: ("Thank you for thinking of me, but this really isn't my taste.", "谢谢你想着我，不过这个真的不太合我的口味。"),
            -1: ("It's not quite my favorite, but thank you.", "不太合我的口味，不过还是谢谢你。"),
            0: ("That filled a little space in my day.", "吃完肚子舒服了一些。"),
            1: ("That was lovely. I'd enjoy it again.", "挺好吃的，下次还想试试。"),
            2: ("Oh, I really love this!", "哇，我真的很喜欢这个！"),
        }
        en, zh = reactions[preference]
        self._memory(player, npc, sid, f"管理员送来{item['name_zh']}，我吃完后说：{zh}")
        self._scene(state, sid, "food", [npc], "A little meal", "一份小小的照顾", [
            (npc, "A little something to eat? Thank you.", "是给我的食物吗？谢谢。", "speaker", "receive"),
            (npc, en, zh, "reaction", "happy" if preference >= 1 else "think"),
        ], {"outcome": "food_eaten", "food_id": item["id"], "coins_awarded": reward})
        return {"scene_id": sid, "outcome": "food_eaten", "xp_gained": item["xp"], "preference": preference,
                "coins_awarded": reward}

    def _friendship(self, player, state, wallet, profiles, world, request, meeting, sid, moment):
        if meeting["status"] != "awaiting_advice":
            fail("MEETING_ALREADY_RESOLVED", "这次见面已经结束，可以在片段里回看。")
        if request.advice is None:
            fail("ADVICE_REQUIRED", "告诉居民是否想继续聊下去吧。")
        a, b = meeting["npc_id"], meeting["target_id"]
        key = pair_key(a, b)
        if request.advice == "discourage":
            meeting["status"] = "declined"
            self._scene(state, sid, "friendship", [a, b], "Another time", "下次再聊", [
                (a, "Maybe another time. No need to rush.", "也许下次吧，不着急。", "speaker", "think"),
                (b, "All right. See you around.", "好呀，那回头见。", "two_shot", "wave"),
            ], {"outcome": "postponed"})
            return {"scene_id": sid, "outcome": "postponed"}
        if request.topic is None:
            fail("TOPIC_REQUIRED", "选一个可以聊的话题吧。")
        topic = request.topic.model_dump(exclude_none=True)
        if topic["kind"] == "person" and topic.get("person_id"):
            self._resident(profiles, topic["person_id"])
        elif topic["kind"] != "person" and topic.get("person_id"):
            fail("INVALID_TOPIC_PERSON", "只有人物话题可以指定居民。")
        day, daily = self._daily(state, moment)
        token = _fingerprint({"kind": topic["kind"], "text": topic["text"].casefold(), "person_id": topic.get("person_id")})
        used_topics = daily["topics"].setdefault(key, [])
        apply = token not in used_topics and len(used_topics) < 3
        pair = RelationshipPair.from_dict(world["relationships"][key])
        responses = {}
        for owner, target in ((a, b), (b, a)):
            edge = pair.edge(owner, target)
            dislikes = [str(x).casefold() for x in profiles[owner].get("dislikes", [])]
            disliked_topic = any(value and (value in topic["text"].casefold() or topic["text"].casefold() in value) for value in dislikes)
            responses[owner] = "hesitant" if edge.tension >= 60 or edge.trust < 25 or disliked_topic else "open"
            if apply:
                kind = "boundary_respected" if responses[owner] == "hesitant" else "shared_positive_experience"
                self.life.engine._apply_evidence(world, RelationshipEvidence(
                    evidence_id=stable_id("neighborhood-evidence", player, day, key, token, owner),
                    owner_id=owner, target_id=target, kind=kind, magnitude=.75,
                    occurred_at=moment, appraisal=Appraisal("beneficial", .8, .2, .95), source_event_id=sid))
        if apply:
            used_topics.append(token)
        open_both = all(value == "open" for value in responses.values())
        reward = economy.SOCIAL_REWARD if (apply and key not in daily["rewarded_pairs"]
                                          and len(daily["rewarded_pairs"]) < economy.SOCIAL_DAILY_LIMIT) else 0
        if reward:
            economy.transfer(state, wallet, sid + ":social", reward,
                             "Help neighbors share a conversation", "帮助邻居交流", moment)
            daily["rewarded_pairs"].append(key)
        meeting.update(status="resolved", topic=topic, responses=responses)
        after = world["relationships"][key]["channels"]
        en_response = "I could talk about that for a little while. What do you enjoy about it?" if responses[b] == "open" else "I'd rather take that topic slowly. Can we keep it light?"
        zh_response = "这个我愿意聊聊。你喜欢它的什么地方呢？" if responses[b] == "open" else "这个话题我想慢慢来。我们轻松聊两句可以吗？"
        self._scene(state, sid, "friendship", [a, b], "One small conversation", "从一个话题开始", [
            (a, f"Shall we talk about “{topic['text']}”?", f"我们聊聊「{topic['text']}」怎么样？", "two_shot", "talk"),
            (b, en_response, zh_response, "speaker", "talk" if responses[b] == "open" else "think"),
            (a, "It was nice hearing your point of view." if open_both else "Of course. We can get to know each other at our own pace.",
             "听听你的想法挺好的。" if open_both else "当然，我们按彼此舒服的节奏慢慢认识。", "speaker", "happy" if open_both else "listen"),
        ], {"outcome": "conversation_warm" if open_both else "conversation_cautious", "coins_awarded": reward,
            "friendship": after["friendship"], "romance": after["romance"]})
        for owner, target in ((a, b), (b, a)):
            self._memory(player, owner, sid, f"我和{profiles[target]['name']}聊过「{topic['text']}」。" +
                         ("我们轻松交换了想法。" if open_both else "我们决定尊重彼此的节奏，慢慢认识。"))
        return {"scene_id": sid, "outcome": "conversation_warm" if open_both else "conversation_cautious", "coins_awarded": reward}

    def _romance(self, player, state, profiles, world, request, meeting, sid, moment):
        a, b = meeting["npc_id"], meeting["target_id"]
        if meeting["status"] != "resolved" or meeting.get("romance_advised"):
            fail("ROMANCE_ALREADY_RESOLVED", "先聊过一次，再给这次心动一点建议吧。")
        if not request.advice:
            fail("ADVICE_REQUIRED", "告诉居民你的建议吧。")
        if not self.life.engine._romance_pair_eligible(world, profiles, a, b):
            fail("ROMANCE_INELIGIBLE", "恋爱需要双方成年、开启恋爱意愿，并且不是亲属。")
        day, daily = self._daily(state, moment)
        key = pair_key(a, b)
        if key in daily["romance_pairs"]:
            fail("ROMANCE_COOLDOWN", "今天已经聊过这件事了，给彼此一点时间吧。")
        daily["romance_pairs"].append(key)
        meeting["romance_advised"] = True
        pair = RelationshipPair.from_dict(world["relationships"][key])
        choices = []
        if request.advice == "discourage":
            outcome = "taking_time"
            lines = [(a, "Maybe I just enjoyed that conversation. I'll take my time.", "也许只是刚才聊得很开心。我再慢慢想一想。", "speaker", "think"),
                     (b, "There's no hurry. Let's keep getting to know each other.", "不用着急。我们继续慢慢认识就好。", "two_shot", "listen")]
        elif pair.channels.romance in {"dating", "partner"}:
            outcome = "already_together"
            lines = [(a, "We've already chosen to be together.", "我们已经决定在一起了。", "speaker", "happy"),
                     (b, "And we're still learning new things about each other.", "不过，每天还是会发现对方的新一面。", "speaker", "happy")]
        else:
            # Engine-owned discrete decisions are persisted before a transition.
            # Encouragement supplies a chance to ask, never anybody's consent.
            choices = self.life.engine._ensure_romance_choices(world, pair, (a, b), sid, "dating", moment)
            accepted = {c["npc_id"] for c in choices if c["choice"] == "accept"}
            if accepted == {a, b} and pair.channels.romance in {"mutual_interest", "separated"}:
                transition = RelationshipTransition(stable_id("neighborhood-romance", sid), "romance", "dating", sid, a, frozenset(accepted))
                world["relationships"][key] = self.life.engine.relationships.transition(pair, transition).state.to_dict()
                outcome = "dating"
            else:
                outcome = "not_ready" if accepted or any(c["choice"] == "hesitate" for c in choices) else "not_reciprocated"
            choice_by = {c["npc_id"]: c["choice"] for c in choices}
            words = {
                "accept": ("I'd like to try a date with you, if you feel the same.", "如果你也愿意，我想试着和你约会。", "shy"),
                "hesitate": ("I'm not ready to decide yet. I'd like a little more time.", "我还没准备好决定，想再多一点时间。", "think"),
                "refuse": ("I value getting to know you, but I don't want to start dating.", "我珍惜认识你的机会，但现在不想开始恋爱。", "disappointed"),
            }
            lines = [(owner, words[choice_by[owner]][0], words[choice_by[owner]][1], "speaker", words[choice_by[owner]][2]) for owner in (a, b)]
            lines.append((None, "They both chose to start dating." if outcome == "dating" else "They leave the answer with each other. A suggestion is not a promise.",
                          "两个人都愿意，决定开始交往。" if outcome == "dating" else "他们尊重了彼此的答复。建议不会替任何人作决定。", "two_shot", "happy" if outcome == "dating" else "listen"))
        romance = world["relationships"][key]["channels"]["romance"]
        public_choices = [{"npc_id": c["npc_id"], "choice": c["choice"]} for c in choices]
        self._scene(state, sid, "romance", [a, b], "A little flutter?", "是心动了吗？", lines,
                    {"outcome": outcome, "romance": romance, "choices": public_choices})
        for owner, target in ((a, b), (b, a)):
            self._memory(player, owner, sid, f"管理员建议我和{profiles[target]['name']}想一想彼此的感情。" +
                         ("我们双方都明确同意，开始交往。" if outcome == "dating" else "这次没有建立新的恋爱关系，我们尊重彼此自己的选择。"))
        return {"scene_id": sid, "outcome": outcome, "romance": romance}
