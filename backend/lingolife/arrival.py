"""A durable, single-resident arrival and first-care loop.

Economic commands and their world effects share one SQLite transaction. The
creation saga reuses the old onboarding initializer, retaining its world-ready
boundary and safe retries instead of materializing a second kind of resident.
"""
from __future__ import annotations

import calendar
import copy
import hashlib
import json
import threading
from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .agent import compile_persona
from .models import NpcProfile, PersonalityAxes, ResidentVoice


CATALOG = [
    {"id": "toast", "name": "Warm toast", "name_zh": "暖暖吐司", "price": 15,
     "satiety": 42, "xp": 20, "emoji": "🍞", "color": "#dba768"},
    {"id": "rice", "name": "Rice bowl", "name_zh": "蔬菜饭", "price": 25,
     "satiety": 55, "xp": 20, "emoji": "🍙", "color": "#d6e6ba"},
    {"id": "pudding", "name": "Caramel pudding", "name_zh": "焦糖布丁", "price": 20,
     "satiety": 35, "xp": 20, "emoji": "🍮", "color": "#e9bf78"},
]


class ManagerProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # These values are also an autosaved form. A blank name and partially
    # selected birthday are valid drafts; final creation validates them below.
    name: str = Field(default="", max_length=24)
    birthday_month: Optional[int] = Field(default=None, ge=1, le=12)
    birthday_day: Optional[int] = Field(default=None, ge=1, le=31)

    @model_validator(mode="after")
    def normalize_name(self):
        self.name = " ".join(self.name.split())
        return self


class ArrivalDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")
    step: str = Field(default="appearance", min_length=1, max_length=32)
    profile: NpcProfile
    voice: ResidentVoice = Field(default_factory=ResidentVoice)
    personality: PersonalityAxes = Field(default_factory=PersonalityAxes)
    manager: ManagerProfile = Field(default_factory=ManagerProfile)

    @model_validator(mode="after")
    def no_missing_residents(self):
        if (self.profile.familyIds or self.profile.familyRelations
                or self.profile.householdWithIds or self.profile.shared_history_hooks):
            raise ValueError("the first resident cannot reference residents who do not exist")
        return self


class ArrivalDraftRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0)
    draft: ArrivalDraft


class ArrivalCreateRequest(ArrivalDraftRequest):
    idempotency_key: str = Field(min_length=8, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]+$")

    @model_validator(mode="after")
    def complete_manager_profile(self):
        manager = self.draft.manager
        if not manager.name:
            raise ValueError("manager name cannot be blank")
        month, day = manager.birthday_month, manager.birthday_day
        if (month is None) != (day is None):
            raise ValueError("birthday requires both month and day")
        if month is not None and day > calendar.monthrange(2000, month)[1]:
            raise ValueError("birthday is not a valid calendar date")
        return self


class ArrivalCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["welcome_done", "buy", "feed", "finish"]
    food_id: Optional[str] = Field(default=None, max_length=32)
    idempotency_key: str = Field(min_length=8, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]+$")


class ArrivalError(ValueError):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def _fail(code: str, message: str):
    raise ArrivalError(code, message)


def _fingerprint(value: dict) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


class ArrivalService:
    def __init__(self, db, life_world, default_profile: dict):
        self.db = db
        self.life = life_world
        self.default_profile = default_profile
        self._lock = threading.RLock()

    def _read(self, player_id: str) -> dict:
        row = self.db._connection.execute(
            "SELECT state_json FROM player_arrival WHERE player_id=?", (player_id,),
        ).fetchone()
        if row:
            state = json.loads(row[0])
            # A player may finish through an older 2–8-person client after
            # saving a new draft. That completed world wins over the draft.
            if (state["stage"] == "create" and not state.get("_pending_create")
                    and self.db.onboarding_state(player_id)["completed"]):
                profiles = self.db.list_npc_profiles(player_id)
                state.update(stage="complete", enabled=False,
                             npc_id=profiles[0]["id"] if profiles else None)
            return state
        profiles = self.db.list_npc_profiles(player_id)
        old_world = bool(profiles or self.db.onboarding_state(player_id)["completed"])
        draft = ArrivalDraft(profile=NpcProfile(**copy.deepcopy(self.default_profile))).model_dump()
        return {"version": 1, "revision": 0, "enabled": not old_world,
                "stage": "complete" if old_world else "create", "draft": draft,
                "npc_id": profiles[0]["id"] if profiles else None,
                "manager": draft["manager"], "coins": 100, "inventory": {},
                "care": {"xp": 0, "level": 1, "satiety": 28, "preferences": {}},
                "last_receipt": None}

    def _write(self, player_id: str, state: dict):
        self.db._connection.execute(
            "INSERT INTO player_arrival(player_id,state_json) VALUES (?,?) "
            "ON CONFLICT(player_id) DO UPDATE SET state_json=excluded.state_json,updated_at=CURRENT_TIMESTAMP",
            (player_id, self.db._json(state)),
        )

    def _public(self, player_id: str, state: dict) -> dict:
        result = {key: copy.deepcopy(value) for key, value in state.items() if not key.startswith("_")}
        world = self.db.get_life_world_state(player_id)
        resident = (world or {}).get("residents", {}).get(state["npc_id"])
        if resident:
            result["care"]["satiety"] = round(resident["runtime"]["needs"].get("food", 28))
        result["catalog"] = copy.deepcopy(CATALOG)
        return result

    def state(self, player_id: str) -> dict:
        with self.db._lock:
            return self._public(player_id, self._read(player_id))

    def manager_name(self, player_id: str) -> str | None:
        with self.db._lock:
            row = self.db._connection.execute(
                "SELECT state_json FROM player_arrival WHERE player_id=?", (player_id,),
            ).fetchone()
            return (json.loads(row[0]).get("manager") or {}).get("name") if row else None

    def save_draft(self, player_id: str, request: ArrivalDraftRequest) -> dict:
        def write():
            state = self._read(player_id)
            if state["stage"] != "create" or state.get("_pending_create"):
                _fail("ARRIVAL_ALREADY_CREATED", "这位居民已经入住，请在人物信息中修改。")
            if state["revision"] != request.expected_revision:
                _fail("ARRIVAL_REVISION_CONFLICT", "草稿已在其他页面更新，请重新载入。")
            state.update(draft=request.draft.model_dump(), revision=state["revision"] + 1)
            self._write(player_id, state)
            return self._public(player_id, state)
        return self.db._life_transaction(write)

    def _cached(self, player_id: str, key: str, fingerprint: str):
        row = self.db._connection.execute(
            "SELECT fingerprint,response_json FROM arrival_receipts WHERE player_id=? AND idempotency_key=?",
            (player_id, key),
        ).fetchone()
        if not row:
            return None
        if row["fingerprint"] != fingerprint:
            _fail("ARRIVAL_KEY_CONFLICT", "这次操作编号已用于其他操作。")
        # Return today's state rather than regressing a tab to an old stage.
        return self._public(player_id, self._read(player_id))

    def _receipt(self, player_id: str, state: dict, key: str, fingerprint: str, **details):
        state["last_receipt"] = {"id": key, "idempotency_key": key, **details}
        state["revision"] += 1
        self._write(player_id, state)
        response = self._public(player_id, state)
        self.db._connection.execute(
            "INSERT INTO arrival_receipts(player_id,idempotency_key,fingerprint,response_json) VALUES (?,?,?,?)",
            (player_id, key, fingerprint, self.db._json(response)),
        )
        return response

    def _record_alias(self, player_id: str, key: str, fingerprint: str, response: dict):
        # A recovered creation can arrive under a new browser-generated key.
        # Bind every successful key without re-running the creation effects.
        if self._cached(player_id, key, fingerprint) is None:
            self.db._connection.execute(
                "INSERT INTO arrival_receipts(player_id,idempotency_key,fingerprint,response_json) VALUES (?,?,?,?)",
                (player_id, key, fingerprint, self.db._json(response)),
            )
        return response

    def create(self, player_id: str, request: ArrivalCreateRequest) -> dict:
        fingerprint = _fingerprint({"action": "create", "draft": request.draft.model_dump()})
        key = request.idempotency_key
        with self._lock:
            def reserve():
                cached = self._cached(player_id, key, fingerprint)
                if cached is not None:
                    return cached, True
                state = self._read(player_id)
                pending = state.get("_pending_create")
                if pending:
                    if pending["fingerprint"] != fingerprint:
                        _fail("ARRIVAL_CREATE_IN_PROGRESS", "居民正在办理入住，请重试原来的操作。")
                    return state, False
                if state.get("_creation_fingerprint") == fingerprint:
                    return self._record_alias(player_id, key, fingerprint, self._public(player_id, state)), True
                if state["stage"] != "create" or self.db.list_npc_profiles(player_id):
                    _fail("ARRIVAL_ALREADY_CREATED", "这座城市已经有居民了。")
                if state["revision"] != request.expected_revision:
                    _fail("ARRIVAL_REVISION_CONFLICT", "草稿已更新，请重新载入。")
                state.update(draft=request.draft.model_dump(),
                             _pending_create={"key": key, "fingerprint": fingerprint})
                self._write(player_id, state)
                return state, False
            state, done = self.db._life_transaction(reserve)
            if done:
                return state
            draft = state["draft"]
            profile = copy.deepcopy(draft["profile"])
            profile.update(voice=draft["voice"], personalityAxes=draft["personality"])
            npc_id = "npc-" + hashlib.sha256((player_id + ":arrival:" + fingerprint).encode()).hexdigest()[:12]
            self.db.acknowledge_onboarding_intro(player_id, 1)
            self.db.create_onboarding_residents(player_id, [{"id": npc_id, "profile": profile}], "Our Home", minimum=1)
            self.db.save_persona(player_id, npc_id, compile_persona(profile))
            profiles = self.db.list_npc_profiles(player_id)
            self.db.ensure_social_edges(player_id, [entry["id"] for entry in profiles])
            if self.life:
                self.life.load(player_id, profiles)
            setup_key = self.db.onboarding_setup_key("Our Home", [profile])
            self.db.finalize_onboarding_setup(player_id, setup_key, require_life_world=self.life is not None, minimum=1)

            def complete():
                cached = self._cached(player_id, key, fingerprint)
                if cached is not None:
                    return cached
                current = self._read(player_id)
                if current.get("_creation_fingerprint") == fingerprint:
                    return self._record_alias(player_id, key, fingerprint, self._public(player_id, current))
                pending = current.pop("_pending_create", {})
                current.update(stage="welcome", npc_id=npc_id, manager=draft["manager"],
                               _creation_fingerprint=fingerprint)
                current["draft"]["profile"] = profile
                world = self.db.get_life_world_state(player_id)
                if world:
                    world["arrival_hold"] = npc_id
                    resident = world["residents"][npc_id]
                    resident["runtime"]["needs"]["food"] = 28
                    self._interrupt_for_arrival(world, npc_id)
                    self._save_world(player_id, world)
                response = self._receipt(player_id, current, key, fingerprint, action="create")
                if pending.get("key") and pending["key"] != key:
                    self._record_alias(player_id, pending["key"], fingerprint, response)
                return response
            return self.db._life_transaction(complete)

    def _interrupt_for_arrival(self, world: dict, npc_id: str):
        # Cancel any randomly selected first action and release reservations;
        # it must not complete an autonomous meal after the tutorial's meal.
        resident = world["residents"][npc_id]
        action = resident.get("current_action") or {}
        if action:
            action.update(status="interrupted", blocked_reason="arrival_tutorial",
                          completed_at=datetime.now(timezone.utc).isoformat())
        for resource in world.get("resources", []):
            resource["reservations"] = [r for r in resource.get("reservations", []) if r.get("npc_id") != npc_id]
            resource["queue"] = [r for r in resource.get("queue", []) if r.get("npc_id") != npc_id]
        resident["pending_instruction"] = None

    def _save_world(self, player_id: str, world: dict):
        self.db._write_life_world_state(
            player_id, world, rules_version=world["rules_version"],
            last_advanced_at=world["last_advanced_at"],
            next_transition_at=world.get("next_transition_at"), expected_revision=world["revision"],
        )
        for resident in world["residents"].values():
            action = dict(resident.get("current_action") or {})
            if action:
                action["type"] = action.get("action_type")
                self.db._upsert_life_action(player_id, action)
        if self.life:
            for household in self.life._projection_payload(world)["households"]:
                self.db._upsert_household_projection(player_id, household)

    @staticmethod
    def _preference(player_id: str, npc_id: str, food: dict, profile: dict) -> int:
        tokens = {food["id"], food["name"].casefold(), food["name_zh"]}
        for field, result in (("dislikes", -2), ("likes", 2)):
            if any(any(token in str(value).casefold() for token in tokens) for value in profile.get(field, [])):
                return result
        return hashlib.sha256(f"{player_id}:{npc_id}:{food['id']}".encode()).digest()[0] % 5 - 2

    def command(self, player_id: str, request: ArrivalCommand) -> dict:
        payload = request.model_dump(exclude={"idempotency_key"})
        fingerprint = _fingerprint(payload)
        def write():
            cached = self._cached(player_id, request.idempotency_key, fingerprint)
            if cached is not None:
                return cached
            state = self._read(player_id)
            profile = self.db.get_npc_profile(player_id, state["npc_id"]) if state["npc_id"] else None
            if not profile or state["stage"] == "create":
                _fail("ARRIVAL_NOT_CREATED", "请先完成居民创建。")
            action, food_id = request.action, request.food_id
            details = {"action": action}
            if action in {"buy", "feed"}:
                if state["stage"] not in {"hungry", "complete"}:
                    _fail("ARRIVAL_WRONG_STAGE", "请先完成当前的引导。")
                food = next((item for item in CATALOG if item["id"] == food_id), None)
                if not food:
                    _fail("ARRIVAL_FOOD_NOT_FOUND", "没有找到这份食物。")
                details["food_id"] = food_id
                inventory = state["inventory"]
                if action == "buy":
                    if sum(inventory.values()) >= 20:
                        _fail("ARRIVAL_INVENTORY_FULL", "食物背包已满，请先使用已有食物。")
                    if state["coins"] < food["price"]:
                        _fail("ARRIVAL_INSUFFICIENT_COINS", "金币不够，换一份食物试试。")
                    state["coins"] -= food["price"]
                    inventory[food_id] = inventory.get(food_id, 0) + 1
                else:
                    if inventory.get(food_id, 0) < 1:
                        _fail("ARRIVAL_NO_FOOD", "请先购买这份食物。")
                    world = self.db.get_life_world_state(player_id)
                    resident = (world or {}).get("residents", {}).get(state["npc_id"])
                    satiety = resident["runtime"]["needs"].get("food", 28) if resident else state["care"]["satiety"]
                    raw_action = (resident or {}).get("current_action") or {}
                    if (raw_action.get("status") not in {None, "completed", "interrupted", "abandoned"}
                            and (not raw_action.get("interruptible", True)
                                 or raw_action.get("action_type") in {"eat", "prepare_food", "sleep", "shower"})):
                        _fail("ARRIVAL_RESIDENT_BUSY", "居民正在忙，等忙完再送食物吧。")
                    if satiety >= 85:
                        _fail("ARRIVAL_RESIDENT_FULL", "已经吃饱了，稍后再来吧。")
                    preference = self._preference(player_id, state["npc_id"], food, profile)
                    inventory[food_id] -= 1
                    care = state["care"]
                    care["satiety"] = min(100, satiety + food["satiety"])
                    care["preferences"][food_id] = preference
                    taste = {-2: "特别不喜欢", -1: "不喜欢", 0: "觉得味道普通", 1: "喜欢", 2: "很喜欢"}[preference]
                    manager = (state.get("manager") or {}).get("name") or "管理员"
                    self.db._insert_chat_memory(player_id, state["npc_id"], {
                        "kind": "life", "importance": 4, "access_stage": "stranger",
                        "source_event_id": "arrival:" + request.idempotency_key,
                        "tags": ["care", "food", food_id],
                        "content": f"管理员希望我称呼对方为{manager}。{manager}送给我一份{food['name_zh']}，我吃完了，我{taste}这种食物。",
                    })
                    old_level = care["level"]
                    care["xp"] += food["xp"]
                    care["level"] = 1 + care["xp"] // 20
                    if resident:
                        resident["runtime"]["needs"]["food"] = care["satiety"]
                        self._save_world(player_id, world)
                    if state["stage"] == "hungry":
                        state["stage"] = "level_up"
                    details.update(preference=preference, xp_gained=food["xp"], leveled_up=care["level"] > old_level)
            elif action == "welcome_done":
                if state["stage"] != "welcome":
                    _fail("ARRIVAL_WRONG_STAGE", "欢迎仪式已经结束。")
                state["stage"] = "hungry"
            elif action == "finish":
                if state["stage"] != "level_up":
                    _fail("ARRIVAL_WRONG_STAGE", "先给居民送上第一份食物吧。")
                state.update(stage="complete", enabled=False)
                world = self.db.get_life_world_state(player_id)
                if world:
                    world.pop("arrival_hold", None)
                    now = datetime.now(timezone.utc).isoformat()
                    world.update(last_advanced_at=now, next_transition_at=now)
                    self._save_world(player_id, world)
            return self._receipt(player_id, state, request.idempotency_key, fingerprint, **details)
        with self._lock:
            # Bring completed worlds up to date before checking real satiety.
            state = self.state(player_id)
            if self.life and state["stage"] == "complete" and state["npc_id"]:
                self.life.load(player_id, self.db.list_npc_profiles(player_id))
            return self.db._life_transaction(write)
