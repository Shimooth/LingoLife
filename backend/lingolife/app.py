from __future__ import annotations

import re
import base64
import hashlib
import hmac
import secrets
import threading
import time
import inspect
import uuid
import json
import queue
from typing import Optional
from contextlib import asynccontextmanager
from pathlib import Path
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware

from .animation import (
    ambient_performance,
    animation_cue,
    encounter_performance,
    journey_performance,
    outcome_performance,
    performance_to_dict,
    resolve_turn_animation,
    stage_performance,
    state_animation_cue,
)
from .ai import DeepSeekProvider, DialogueProvider, ResilientProvider
from .agent import (advance_goal, advance_relationship, advance_runtime, compile_goal,
                    compile_persona, daily_plan, dialogue_objective, initial_relationship,
                    initial_runtime, project_dialogue_agent, project_dialogue_life_context,
                    project_dialogue_memories, project_public_agent,
                    project_public_life_context, project_public_memories, time_slot)
from .config import Settings, load_settings
from .city import CITY_LOCATIONS, LOCATION_BY_ID, city_payload
from .chat_journal import (ChatRequestConflict, ChatTurnLeaseLost,
                           preview_event_advance)
from .chat_rules import settle_chat_semantics
from .db import Database, WorldLayoutDraftConflict
from .development import public_development
from .events import ActiveEvent, EventEngine, NPCEventContext, event_to_dict
from .learning import Evidence, LearningEngine
from .life_service import LifeWorldService
from .layout_validation import (LayoutTopologyError, load_world_asset_catalog,
                                validate_layout_topology)
from .layouts import default_world_layout, shared_home_manifest
from .models import (AdminLoginRequest, AdminRosterSelectionRequest, AdminUserPatch, AdminUserResetRequest,
                     ChatRequest, ChatResponse,
                     InviteCreateRequest, LifeInterventionRequest, LoginRequest, NpcProfile,
                     OnboardingCompleteRequest, OnboardingIntroRequest, PasswordChangeRequest, RegisterRequest,
                     SocialInterventionRequest, WorldLayout, WorldLayoutActivateRequest,
                     WorldLayoutDraftRequest, WorldLayoutPublishRequest,
                     WorldLayoutRequest, WorldLayoutValidationRequest,
                     materialize_onboarding_profiles)
from .profile_contract import CURRENT_INTRO_VERSION
from .social import SocialWorldEngine

KEY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$")
USERNAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$")
NPC_LIMIT = 8
ONBOARDING_MIN_RESIDENTS = 2

DEFAULT_NPC_PROFILE = {
    "name": "Emma", "age": 25, "relationship": "Friend",
    "personality": ["kind", "thoughtful", "quiet"],
    "interests": ["art", "music", "photography"], "occupation": "Designer",
    "likes": ["urban sketching", "soft jazz", "quiet cafés"],
    "dislikes": ["being rushed", "people borrowing things without asking"],
    "quirks": ["straightens picture frames when thinking"],
    "habits": ["read before sleep", "make tea after work"],
    "boundaries": ["ask before borrowing personal things", "knock before entering private space"],
    "householdRole": "mediator", "chorePreferences": ["cleaning", "dishes"],
    "privateSpacePreference": "high",
    "longTermGoal": "Open a small independent design studio.",
    "romanceEnabled": True, "relationshipBoundaries": [],
    "avatar": {"model": "chibi", "hair": "hair-variant", "hairColor": "#563B38", "face": "round",
               "skin": "#EFB99B", "eyes": "dot", "brows": "soft", "nose": "button",
               "mouth": "smile", "outfit": "student", "outfitColor": "#D87362",
               "pants": "balloon", "accessory": "none", "homeBackground": "bubble", "strokes": []},
}


def create_app(settings: Settings | None = None, provider: DialogueProvider | None = None) -> FastAPI:
    settings = settings or load_settings()
    db = Database(settings.database_url, settings.admin_session_secret)
    learning_engine = LearningEngine()
    event_engine = EventEngine(db)
    social_engine = SocialWorldEngine(db)
    life_world = LifeWorldService(db, settings.game_timezone) if settings.life_simulation_v2 else None
    built_in_world_layout = default_world_layout()
    world_asset_catalog = load_world_asset_catalog()
    home_manifest = shared_home_manifest()
    try:
        game_zone = ZoneInfo(settings.game_timezone)
    except ZoneInfoNotFoundError as exc:
        raise ValueError(f"Unknown GAME_TIMEZONE: {settings.game_timezone}") from exc
    game_today = lambda: datetime.now(game_zone).date()
    if provider is None:
        primary = DeepSeekProvider(settings) if settings.deepseek_api_key else None
        provider = ResilientProvider(primary)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        yield

    app = FastAPI(title="LingoLife", version=settings.version, lifespan=lifespan)
    attempt_lock = threading.Lock()
    attempts: dict[str, list[float]] = {}
    chat_locks_guard = threading.Lock()
    chat_player_locks: dict[str, threading.RLock] = {}

    def chat_player_lock(player_id: str) -> threading.RLock:
        # SQLite uses one connection in this service. Keeping a player's full
        # prepare/generate/commit window together also prevents stale absolute
        # learning/NPC snapshots when two distinct keys arrive concurrently.
        with chat_locks_guard:
            return chat_player_locks.setdefault(player_id, threading.RLock())

    def rate_limit(bucket: str, request: Request, maximum: int, window_seconds: int):
        client = request.client.host if request.client else "unknown"
        key, now = f"{bucket}:{client}", time.time()
        with attempt_lock:
            recent = [stamp for stamp in attempts.get(key, []) if stamp > now - window_seconds]
            if len(recent) >= maximum:
                raise HTTPException(429, {"code": "TOO_MANY_ATTEMPTS", "message": "Too many attempts. Please wait and try again."})
            recent.append(now)
            attempts[key] = recent

    def clear_attempts(bucket: str, request: Request):
        client = request.client.host if request.client else "unknown"
        with attempt_lock:
            attempts.pop(f"{bucket}:{client}", None)

    @app.exception_handler(HTTPException)
    async def http_error(_request: Request, exc: HTTPException):
        detail = exc.detail if isinstance(exc.detail, dict) else {"code": "REQUEST_ERROR", "message": str(exc.detail)}
        return JSONResponse(status_code=exc.status_code, content={"error": detail})

    def current_user(authorization: str | None) -> dict:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(401, {"code": "AUTH_REQUIRED", "message": "Sign in is required."})
        user = db.authenticate(authorization[7:])
        if not user:
            raise HTTPException(401, {"code": "INVALID_SESSION", "message": "Session is invalid or expired."})
        if user.get("disabled"):
            raise HTTPException(403, {"code": "USER_DISABLED", "message": "This account is disabled."})
        return user

    def profile_for(player_id: str, npc_id: str = "emma", create_default: bool = True) -> dict:
        migration = db.roster_migration(player_id)
        if (migration and migration["status"] == "ready"
                and npc_id not in migration["active_npc_ids"]):
            raise HTTPException(404, {
                "code": "NPC_ARCHIVED",
                "message": "This preserved legacy character is not in the active simulation roster.",
            })
        profile = db.get_npc_profile(player_id, npc_id)
        if profile:
            return profile
        if npc_id == "emma" and create_default and not db.list_npc_profiles(player_id):
            return db.get_or_create_npc_profile(player_id, "emma", DEFAULT_NPC_PROFILE)
        raise HTTPException(404, {"code": "NPC_NOT_FOUND", "message": "Character was not found."})

    def event_context(player_id: str, npc_id: str, profile: dict, stats, learning_state,
                      runtime: dict | None = None) -> NPCEventContext:
        targets = learning_engine.targets(learning_state, limit=3)
        mood = "sad" if stats.mood < 35 else "happy" if stats.mood >= 65 else "neutral"
        goal = profile.get("longTermGoal", "")
        needs = runtime.get("needs", {}) if runtime else {}
        urgent_needs = tuple(key for key, _ in sorted(needs.items(), key=lambda item: item[1])[:2])
        return NPCEventContext(
            player_id=player_id, npc_id=npc_id, traits=tuple(profile.get("personality", [])),
            interests=tuple(profile.get("interests", [])), occupation=profile.get("occupation", ""),
            mood=mood, relationship=stats.relationship,
            long_term_goals=(goal,) if goal else (),
            learning_targets=tuple(item["id"] for item in targets),
            needs=urgent_needs or (("connection",) if stats.relationship < 50 else ("growth",)),
        )

    def public_event(active: ActiveEvent | None, profile: dict | None = None) -> dict | None:
        if not active:
            return None
        template = event_engine.by_id[active.template_id]
        stage = event_engine.stage(active)
        name = str((profile or {}).get("name", "Emma"))
        adapt = lambda value: value.replace("Emma", name)
        return {"id": template.id, "title": adapt(template.title), "category": template.category,
                "stage": {"id": stage.id, "prompt": adapt(stage.prompt), "translation": adapt(stage.prompt_zh),
                          "objective": adapt(stage.objective),
                          "animation_cue": stage.animation_cue,
                          "performance": performance_to_dict(stage.performance)},
                "stage_index": active.stage_index, "stage_turns": active.stage_turns,
                "stage_count": len(template.stages),
                "learning_targets": list(template.learning_targets)}

    def agent_bundle(player_id: str, npc_id: str, profile: dict, stats, learning_state) -> dict:
        runtime = db.get_runtime_state(player_id, npc_id) or initial_runtime(stats.mood, stats.relationship)
        runtime = advance_runtime(runtime, profile, stats.mood)
        db.save_runtime_state(player_id, npc_id, runtime)
        persona = compile_persona(profile, runtime.get("growth"))
        if db.get_persona(player_id, npc_id) != persona:
            db.save_persona(player_id, npc_id, persona)
        relationship = db.get_relationship(player_id, npc_id) or initial_relationship(stats.relationship)
        if not db.get_relationship(player_id, npc_id):
            db.save_relationship(player_id, npc_id, relationship)
        goal = db.get_goal(player_id, npc_id)
        if not goal or goal.get("title") != (profile.get("longTermGoal") or "Build a meaningful everyday life"):
            goal = db.save_goal(player_id, npc_id, compile_goal(profile))
        day = game_today().isoformat()
        plan = db.get_daily_plan(player_id, npc_id, day)
        if not plan:
            plan = db.save_daily_plan(player_id, npc_id, day,
                                      daily_plan(player_id, npc_id, profile, runtime, goal, game_today()))
        progress = learning_engine.progress(learning_state)
        mastery = int(progress["overall_mastery"])
        language_controller = {
            "estimated_level": progress["level"],
            "max_sentence_length": 12 if mastery < 25 else 18 if mastery < 50 else 26,
            "vocabulary": "common" if mastery < 45 else "everyday_plus",
            "correction_style": "natural_recast",
            "stretch_targets": [item["id"] for item in progress["recommended"][:2]],
        }
        development = public_development({}, profile)
        # The legacy scheduler owns this compatibility goal.  Keep the public
        # development DTO coherent without inventing an evidence ledger.
        development["goal"] = json.loads(json.dumps(goal))
        return {"persona": persona, "runtime_state": runtime, "relationship": relationship,
                "goal": goal, "daily_plan": plan, "current_slot": time_slot(datetime.now(game_zone).hour),
                "language_controller": language_controller,
                "development": development,
                "animation_cue": state_animation_cue(stats.mood, runtime.get("emotion", {}).get("energy"))}

    def daily_social_world(player_id: str, profiles: list[dict], agents: dict[str, dict] | None = None) -> list[dict]:
        bundles = agents or {}
        for entry in profiles:
            npc_id, profile = entry["id"], entry["profile"]
            if npc_id not in bundles:
                bundles[npc_id] = agent_bundle(player_id, npc_id, profile, db.state(player_id, npc_id),
                                                db.get_learning_state(player_id))
        slot = time_slot(datetime.now(game_zone).hour)
        plans = {npc_id: bundle["daily_plan"] for npc_id, bundle in bundles.items()}
        runtime_states = {npc_id: bundle["runtime_state"] for npc_id, bundle in bundles.items()}
        names = {location.id: location.name for location in CITY_LOCATIONS}
        positions = {location.id: (location.x, location.y) for location in CITY_LOCATIONS}
        return social_engine.ensure_daily(player_id, profiles, plans, game_today(), slot, names, runtime_states,
                                          positions)

    def life_profiles(player_id: str) -> list[dict]:
        """Return only the explicitly active simulation cast."""
        entries = db.simulation_npc_profiles(player_id)
        if entries:
            return entries
        profile_for(player_id)
        return db.simulation_npc_profiles(player_id)

    def onboarding_state(player_id: str) -> dict:
        return db.onboarding_state(
            player_id, minimum=ONBOARDING_MIN_RESIDENTS, maximum=NPC_LIMIT,
        )

    def require_world_ready(user: dict) -> dict:
        """Enforce the same authoritative onboarding boundary on gameplay APIs."""
        state = onboarding_state(user["player_id"])
        if not state["completed"]:
            migration_status = (state.get("roster_migration") or {}).get("status")
            code = ("ROSTER_REVIEW_REQUIRED" if migration_status == "needs_roster_review"
                    else "LEGACY_FIXTURE_BLOCKED" if migration_status in {
                        "blocked_invalid_fixture", "blocked_verification_failed",
                    }
                    else "WORLD_NOT_READY")
            raise HTTPException(409, {
                "code": code,
                "message": (
                    "An administrator must select 2-8 active residents before this legacy world can run."
                    if code == "ROSTER_REVIEW_REQUIRED" else
                    "This legacy save failed integrity checks and requires administrator review."
                    if code == "LEGACY_FIXTURE_BLOCKED" else
                    "Complete the introduction and create 2-8 residents before entering the world."
                ),
                "onboarding": state,
            })
        return state

    def layout_validation(layout: dict) -> dict:
        try:
            report = validate_layout_topology(layout, home_manifest, world_asset_catalog)
        except LayoutTopologyError as error:
            return {
                "valid": False,
                "issues": [
                    {"code": issue.code, "path": issue.path, "message": issue.message}
                    for issue in error.issues
                ],
            }
        return {
            "valid": True, "issues": [],
            "report": {
                "road_tiles": report.road_tiles, "road_edges": report.road_edges,
                "sky_road_exits": report.sky_road_exits, "buildings": report.buildings,
                "decorations": report.decorations, "connected_rooms": report.connected_rooms,
                "room_connections": report.room_connections,
                "shared_home_actions": report.shared_home_actions,
                "private_sleep_slots": report.private_sleep_slots,
            },
        }

    def require_valid_layout(layout: dict) -> dict:
        validation = layout_validation(layout)
        if not validation["valid"]:
            raise HTTPException(422, {
                "code": "INVALID_LAYOUT_TOPOLOGY",
                "message": "布局未通过道路、建筑或共享住宅拓扑校验。",
                "issues": validation["issues"],
            })
        return validation

    # A fresh installation starts from the same immutable/active contract as
    # authored layouts. Invalid legacy rows remain in history for diagnosis,
    # but never become the player's effective layout.
    stored_at_start = db.get_world_layout()
    try:
        stored_layout = (WorldLayout.model_validate(stored_at_start["layout"]).model_dump(mode="json")
                         if stored_at_start else None)
        stored_is_valid = bool(stored_layout and layout_validation(stored_layout)["valid"])
    except (KeyError, TypeError, ValueError):
        stored_is_valid = False
    if not stored_is_valid:
        db.publish_world_layout(
            built_in_world_layout, note="初始化项目默认布局", author="system",
            validation=require_valid_layout(built_in_world_layout), is_default=True,
        )

    def published_world_layout() -> dict:
        # Treat the DB as durable storage, not as a trust boundary.  This also
        # makes upgrades safe if an old/corrupt row predates current asset and
        # semantic validators (including malformed JSON from manual operations).
        try:
            stored = db.get_world_layout()
            if stored:
                layout = WorldLayout.model_validate(stored["layout"]).model_dump(mode="json")
                if not layout_validation(layout)["valid"]:
                    raise ValueError("invalid active layout topology")
                return {"layout": layout, "updated_at": stored.get("updated_at")}
        except (KeyError, TypeError, ValueError):
            pass
        return {"layout": built_in_world_layout, "updated_at": None}

    def admin_layout_state() -> dict:
        published = published_world_layout()
        active = db.get_world_layout()
        active_metadata = {}
        if active and active.get("layout") == published["layout"]:
            active_metadata = {
                key: value for key, value in active.items()
                if key not in {"layout", "updated_at", "created"}
            }
        draft = db.get_world_layout_draft()
        if draft is None:
            draft = {
                "layout": published["layout"], "revision": 0, "hash": None,
                "author": None, "validation": layout_validation(published["layout"]),
                "created_at": None, "updated_at": None,
            }
        return {
            **published, **active_metadata, "draft": draft,
            "versions": db.list_world_layout_versions(),
            "audit": db.world_layout_audit(50),
        }

    def life_dialogue_bundle(player_id: str, npc_id: str, profile: dict, stats,
                             learning_state: dict) -> tuple[dict, dict]:
        """Build dialogue context without running the retired daily scheduler."""
        assert life_world is not None
        entries = life_profiles(player_id)
        life_context = life_world.npc_context(player_id, entries, npc_id)
        resident_state = life_world.load(player_id, entries)["residents"][npc_id]
        runtime = resident_state["runtime"]
        relationship = db.get_relationship(player_id, npc_id) or initial_relationship(stats.relationship)
        if not db.get_relationship(player_id, npc_id):
            db.save_relationship(player_id, npc_id, relationship)
        development = public_development(resident_state.get("development") or {}, profile)
        development_goal = development.get("goal")
        goal = (dict(development_goal) if isinstance(development_goal, dict)
                else db.get_goal(player_id, npc_id))
        if not goal or goal.get("title") != (profile.get("longTermGoal") or "Build a meaningful everyday life"):
            goal = compile_goal(profile)
        if db.get_goal(player_id, npc_id) != goal:
            db.save_goal(player_id, npc_id, goal)
        if development.get("goal") != goal:
            development["goal"] = json.loads(json.dumps(goal))
        persona = compile_persona(profile, runtime.get("growth"))
        if db.get_persona(player_id, npc_id) != persona:
            db.save_persona(player_id, npc_id, persona)
        progress = learning_engine.progress(learning_state)
        mastery = int(progress["overall_mastery"])
        current_action = life_context["current_action"]
        slot = time_slot(datetime.now(game_zone).hour)
        compatible_plan = {
            "date": game_today().isoformat(),
            "slots": {name: {"activity_id": current_action["type"],
                              "activity": current_action["visible_intent"],
                              "location_id": current_action.get("location_id") or "home"}
                      for name in ("morning", "afternoon", "evening")},
        }
        bundle = {
            "persona": persona, "runtime_state": runtime, "relationship": relationship,
            "goal": goal, "daily_plan": compatible_plan, "current_slot": slot,
            "language_controller": {
                "estimated_level": progress["level"],
                "max_sentence_length": 12 if mastery < 25 else 18 if mastery < 50 else 26,
                "vocabulary": "common" if mastery < 45 else "everyday_plus",
                "correction_style": "natural_recast",
                "stretch_targets": [item["id"] for item in progress["recommended"][:2]],
            },
            "development": development,
            "animation_cue": current_action.get("animation_cue") or "idle",
        }
        return bundle, life_context

    def provider_reply(message: str, stats, history: list[dict], context: dict, on_chunk=None):
        # Preserve compatibility with small test/custom providers implementing the original contract.
        parameters = inspect.signature(provider.reply).parameters
        if on_chunk and len(parameters) >= 5:
            return provider.reply(message, stats, history, context, on_chunk)
        return provider.reply(message, stats, history, context) if len(parameters) >= 4 else provider.reply(message, stats, history)

    def admin_cookie() -> str:
        if not settings.admin_password or not settings.admin_session_secret:
            raise HTTPException(503, {"code": "ADMIN_NOT_CONFIGURED", "message": "Admin access is not configured."})
        timestamp = str(int(time.time()))
        signature = hmac.new(settings.admin_session_secret.encode(), timestamp.encode(), hashlib.sha256).digest()
        return timestamp + "." + base64.urlsafe_b64encode(signature).decode().rstrip("=")

    def require_admin(request: Request):
        if not settings.admin_password or not settings.admin_session_secret:
            raise HTTPException(503, {"code": "ADMIN_NOT_CONFIGURED", "message": "Admin access is not configured."})
        value = request.cookies.get("lingolife_admin")
        try:
            timestamp, supplied = (value or "").split(".", 1)
            expected = admin_cookie().split(".", 1)[1] if timestamp == str(int(time.time())) else base64.urlsafe_b64encode(
                hmac.new((settings.admin_session_secret or "").encode(), timestamp.encode(), hashlib.sha256).digest()
            ).decode().rstrip("=")
            issued_at = int(timestamp)
            valid = hmac.compare_digest(supplied, expected) and time.time() - 8 * 3600 < issued_at <= time.time() + 30
        except (ValueError, TypeError):
            valid = False
        if not valid:
            raise HTTPException(401, {"code": "ADMIN_AUTH_REQUIRED", "message": "Admin sign-in is required."})

    def check_admin_origin(request: Request):
        origin = request.headers.get("origin")
        if origin != settings.admin_allowed_origin:
            raise HTTPException(403, {"code": "INVALID_ORIGIN", "message": "Origin is not allowed."})

    @app.get(settings.api_prefix + "/health")
    def health(): return {"status": "ok", "version": settings.version}

    @app.post(settings.api_prefix + "/auth/register", status_code=201)
    def register(body: RegisterRequest, request: Request):
        rate_limit("register", request, maximum=10, window_seconds=60)
        username = body.username.strip()
        if not USERNAME_RE.fullmatch(username):
            raise HTTPException(422, {"code": "INVALID_USERNAME", "message": "Username must be 3-32 letters, numbers, _ or -."})
        try:
            result = db.register(username, body.invite_code.strip(), body.password)
        except ValueError:
            raise HTTPException(409, {"code": "USERNAME_TAKEN", "message": "Username is already taken."})
        if not result:
            raise HTTPException(400, {"code": "INVALID_INVITE", "message": "Invite code is invalid or already used."})
        user, token = result
        return {"session_token": token, "user": {"id": user["id"], "username": user["username"], "has_password": True}, "quota": db.quota(user["id"]),
                "onboarding": onboarding_state(user["player_id"])}

    @app.post(settings.api_prefix + "/auth/login")
    def login(body: LoginRequest, request: Request):
        rate_limit("login", request, maximum=10, window_seconds=15 * 60)
        username = body.username.strip()
        result = db.login(username, body.password)
        if not result:
            raise HTTPException(401, {"code": "INVALID_CREDENTIALS", "message": "Username or password is incorrect."})
        user, token = result
        if user.get("disabled"):
            raise HTTPException(403, {"code": "USER_DISABLED", "message": "This account is disabled."})
        clear_attempts("login", request)
        return {"session_token": token, "user": {"id": user["id"], "username": user["username"], "has_password": True}, "quota": db.quota(user["id"]),
                "onboarding": onboarding_state(user["player_id"])}

    @app.get(settings.api_prefix + "/auth/me")
    def me(authorization: Optional[str] = Header(None)):
        user = current_user(authorization)
        return {"user": {"id": user["id"], "username": user["username"], "has_password": bool(user.get("password_hash"))}, "quota": db.quota(user["id"]),
                "onboarding": onboarding_state(user["player_id"])}

    @app.get(settings.api_prefix + "/onboarding")
    def onboarding(authorization: Optional[str] = Header(None)):
        user = current_user(authorization)
        return onboarding_state(user["player_id"])

    @app.post(settings.api_prefix + "/onboarding/intro/acknowledge")
    def acknowledge_onboarding_intro(body: OnboardingIntroRequest,
                                     authorization: Optional[str] = Header(None)):
        user = current_user(authorization)
        if body.intro_version != CURRENT_INTRO_VERSION:
            raise HTTPException(409, {
                "code": "INTRO_VERSION_UNSUPPORTED",
                "message": "Reload to view the current introduction.",
            })
        return db.acknowledge_onboarding_intro(
            user["player_id"], body.intro_version,
            minimum=ONBOARDING_MIN_RESIDENTS, maximum=NPC_LIMIT,
        )

    @app.post(settings.api_prefix + "/onboarding/complete", status_code=201)
    def complete_onboarding(body: OnboardingCompleteRequest,
                            authorization: Optional[str] = Header(None)):
        user = current_user(authorization); player_id = user["player_id"]
        household_name = " ".join(body.household_name.split())[:64] or "Our Home"
        # NPC ids must be stable across a setup-saga retry so typed family and
        # shared-history references materialize to the same persisted contract.
        contract_seed = hashlib.sha256((player_id + "\0" + json.dumps(
            body.model_dump(), ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        )).encode("utf-8")).hexdigest()
        npc_ids = [
            "npc-" + hashlib.sha256(f"{contract_seed}:{index}".encode()).hexdigest()[:12]
            for index in range(len(body.residents))
        ]
        requested_profiles = materialize_onboarding_profiles(body, npc_ids)
        setup_key = db.onboarding_setup_key(household_name, requested_profiles)
        before = onboarding_state(player_id)
        if before["completed"] and before.get("setup_key") != setup_key:
            raise HTTPException(409, {"code": "ONBOARDING_ALREADY_COMPLETED",
                                      "message": "Character onboarding is already complete."})
        if not before.get("intro_acknowledged_at"):
            raise HTTPException(409, {"code": "INTRO_NOT_ACKNOWLEDGED",
                                      "message": "View and acknowledge the introduction before creating the world."})
        entries = [{"id": npc_id, "profile": profile}
                   for npc_id, profile in zip(npc_ids, requested_profiles)]
        try:
            created = db.create_onboarding_residents(
                player_id, entries, household_name, maximum=NPC_LIMIT,
            )
        except ValueError as error:
            if str(error) == "NPC_LIMIT_REACHED":
                raise HTTPException(409, {"code": "NPC_LIMIT_REACHED",
                                          "message": "You can create up to eight characters."})
            if str(error) == "ONBOARDING_ALREADY_COMPLETED":
                raise HTTPException(409, {"code": "ONBOARDING_ALREADY_COMPLETED",
                                          "message": "Character onboarding is already complete."})
            if str(error) == "NPC_NAME_TAKEN":
                raise HTTPException(409, {"code": "NPC_NAME_TAKEN",
                                          "message": "Character names must be unique."})
            if str(error) == "INTRO_NOT_ACKNOWLEDGED":
                raise HTTPException(409, {"code": "INTRO_NOT_ACKNOWLEDGED",
                                          "message": "View and acknowledge the introduction before creating the world."})
            if str(error) == "ONBOARDING_SETUP_IN_PROGRESS":
                raise HTTPException(409, {"code": "ONBOARDING_SETUP_IN_PROGRESS",
                                          "message": "Another character setup is already in progress."})
            raise
        profiles = db.list_npc_profiles(player_id)
        db.ensure_social_edges(player_id, [entry["id"] for entry in profiles])
        world = life_world.city(player_id, profiles) if life_world is not None else None
        if life_world is not None:
            households = world.get("households") or []
            if len(households) != 1:
                raise RuntimeError("shared household invariant is not established")
            if households[0].get("name") != household_name:
                state = life_world.rename_shared_household(player_id, profiles, household_name)
                # Reproject after the name-only world mutation.
                world = life_world.city(player_id, profiles)
                assert len(state.get("households") or {}) == 1
        completed = db.finalize_onboarding_setup(
            player_id, setup_key, require_life_world=life_world is not None,
        )
        household = (world.get("households") or [None])[0] if world else None
        return {
            "onboarding": completed, "created": created,
            "npcs": profiles, "household": household, "city": world,
        }

    @app.put(settings.api_prefix + "/auth/password")
    def change_password(body: PasswordChangeRequest, authorization: Optional[str] = Header(None)):
        user = current_user(authorization); token = authorization[7:]
        if not db.set_password(user["id"], body.new_password, body.current_password, token):
            raise HTTPException(401, {"code": "INVALID_CURRENT_PASSWORD", "message": "Current password is incorrect."})
        return {"has_password": True}

    @app.post(settings.api_prefix + "/auth/logout", status_code=204)
    def logout(authorization: Optional[str] = Header(None)):
        current_user(authorization)
        db.revoke_session(authorization[7:])
        return Response(status_code=204)

    @app.get(settings.api_prefix + "/room")
    def room(npc_id: str = "emma", authorization: Optional[str] = Header(None)):
        user = current_user(authorization); player_id = user["player_id"]
        require_world_ready(user)
        profile = profile_for(player_id, npc_id)
        stats = db.state(player_id, npc_id)
        if life_world is not None:
            entries = life_profiles(player_id)
            context = life_world.npc_context(player_id, entries, npc_id)
            cue = context["current_action"].get("animation_cue") or "idle"
            return {"room_id": f"{npc_id}-room",
                    "npc": {"id": npc_id, "name": profile["name"],
                            "animation": "sad" if stats.mood < 40 else "happy" if stats.mood >= 60 else "idle",
                            "animation_cue": cue},
                    "stats": stats, "messages": db.messages(player_id, 200, npc_id),
                    "quota": db.quota(user["id"]), "active_event": None,
                    "life_context": context, "social_interactions": []}
        learning_state = db.get_learning_state(player_id)
        agent = agent_bundle(player_id, npc_id, profile, stats, learning_state)
        active = event_engine.daily_event(event_context(player_id, npc_id, profile, stats, learning_state,
                                                        agent["runtime_state"]), game_today())
        animation = "sad" if stats.mood < 40 else "happy" if stats.mood >= 60 else "idle"
        active_view = public_event(active, profile)
        cue = active_view["stage"]["animation_cue"] if active_view else agent["animation_cue"]
        social_events = daily_social_world(player_id, life_profiles(player_id), {npc_id: agent})
        return {"room_id": f"{npc_id}-room", "npc": {"id": npc_id, "name": profile["name"],
                                                       "animation": animation, "animation_cue": cue},
                "stats": stats, "messages": db.messages(player_id, 200, npc_id),
                "quota": db.quota(user["id"]), "active_event": active_view,
                "agent": project_public_agent(agent),
                "social_interactions": [event for event in social_events if npc_id in event["participant_ids"]]}

    @app.get(settings.api_prefix + "/npc/profile")
    def npc_profile(authorization: Optional[str] = Header(None)):
        user = current_user(authorization)
        # Keep the compatibility alias readable without silently adding Emma
        # to a new user's not-yet-created onboarding cast.
        profile = db.get_npc_profile(user["player_id"], "emma")
        if profile:
            return profile
        if not onboarding_state(user["player_id"])["completed"]:
            return NpcProfile.model_validate(DEFAULT_NPC_PROFILE).model_dump()
        raise HTTPException(404, {
            "code": "NPC_NOT_FOUND",
            "message": "The legacy Emma profile does not exist in this world.",
        })

    @app.put(settings.api_prefix + "/npc/profile")
    def save_npc_profile(body: NpcProfile, authorization: Optional[str] = Header(None)):
        user = current_user(authorization)
        require_world_ready(user)
        if not db.get_npc_profile(user["player_id"], "emma"):
            raise HTTPException(404, {
                "code": "NPC_NOT_FOUND",
                "message": "The legacy Emma profile does not exist in this world.",
            })
        try:
            return db.save_npc_profile(user["player_id"], "emma", body.model_dump())
        except ValueError as error:
            if str(error) == "NPC_NAME_TAKEN":
                raise HTTPException(409, {"code": "NPC_NAME_TAKEN",
                                          "message": "Character names must be unique."})
            raise

    @app.get(settings.api_prefix + "/npcs")
    def npc_profiles(authorization: Optional[str] = Header(None)):
        user = current_user(authorization); player_id = user["player_id"]
        migration = db.roster_migration(player_id)
        profiles = (db.simulation_npc_profiles(player_id)
                    if migration and migration["status"] == "ready"
                    else db.list_npc_profiles(player_id))
        return {"npcs": profiles, "limit": NPC_LIMIT,
                "onboarding": onboarding_state(player_id)}

    @app.get(settings.api_prefix + "/world-layout")
    def world_layout():
        # Public so the loading scene can fetch its published map before sign-in.
        return published_world_layout()

    @app.get(settings.api_prefix + "/world")
    @app.get(settings.api_prefix + "/city")
    def city(authorization: Optional[str] = Header(None)):
        user = current_user(authorization); player_id = user["player_id"]
        require_world_ready(user)
        if life_world is not None:
            payload = life_world.city(player_id, life_profiles(player_id))
            verification = db.verify_roster_world_reconciliation(player_id)
            if verification and verification["status"] != "ready":
                raise HTTPException(409, {
                    "code": "ROSTER_MIGRATION_VERIFICATION_FAILED",
                    "message": "Legacy save verification failed after rebuilding the shared household.",
                })
            return payload
        profile_for(player_id)  # Materialize the default resident for older accounts.
        profiles = life_profiles(player_id)
        learning_state = db.get_learning_state(player_id)
        active_events: dict[str, ActiveEvent | None] = {}
        summaries: dict[str, dict | None] = {}
        agents: dict[str, dict] = {}
        planned_locations: dict[str, str] = {}
        for entry in profiles:
            npc_id, profile = entry["id"], entry["profile"]
            stats = db.state(player_id, npc_id)
            agent = agent_bundle(player_id, npc_id, profile, stats, learning_state)
            active = event_engine.daily_event(event_context(player_id, npc_id, profile, stats, learning_state,
                                                            agent["runtime_state"]), game_today())
            active_events[npc_id] = active
            summaries[npc_id] = public_event(active, profile)
            agents[npc_id] = agent
            slot = agent["current_slot"]
            planned_locations[npc_id] = agent["daily_plan"]["slots"][slot]["location_id"]
        payload = city_payload(player_id, profiles, active_events, game_today(), planned_locations)
        social_events = daily_social_world(player_id, profiles, agents)
        server_time = datetime.now(timezone.utc)
        for resident in payload["npcs"]:
            resident["active_event"] = summaries[resident["id"]]
            resident["daily_plan"] = agents[resident["id"]]["daily_plan"]
            resident["current_activity"] = agents[resident["id"]]["daily_plan"]["slots"][agents[resident["id"]]["current_slot"]]["activity"]
            resident_events = [event for event in social_events if resident["id"] in event["participant_ids"]]
            resident["social_interaction_ids"] = [event["id"] for event in resident_events]
            resident["related_npc_ids"] = sorted({npc_id for event in resident_events
                                                   for npc_id in event["participant_ids"] if npc_id != resident["id"]})
            open_social = next((event for event in resident_events
                                if event.get("status") in {"traveling", "awaiting_observation", "awaiting_management"}), None)
            if open_social:
                journey = open_social.get("journey", {})
                walking = open_social.get("status") == "traveling"
                location_id = ((journey.get("origin_location_ids") or {}).get(resident["id"])
                               if walking else journey.get("target_location_id"))
                location = LOCATION_BY_ID.get(location_id)
                if location:
                    resident["current_location_id"] = location.id
                    resident["position"] = {"x": location.x, "y": location.y}
                    resident["is_home"] = False
                resident["world_action"] = {
                    "state": "walking_to_event" if walking else "waiting_at_event",
                    "event_id": open_social["id"],
                    "target_location_id": journey.get("target_location_id", open_social.get("location_id")),
                    "started_at": journey.get("started_at"),
                    "arrives_at": journey.get("arrives_at"),
                    "auto_resolve_at": journey.get("auto_resolve_at"),
                    "participant_index": open_social.get("participant_ids", []).index(resident["id"]),
                }
            elif resident.get("active_event"):
                resident["world_action"] = {
                    "state": "event_pending", "event_id": resident["active_event"]["id"],
                    "target_location_id": resident["current_location_id"],
                }
            else:
                resident["world_action"] = {"state": "idle"}
            event_cue = (resident.get("active_event") or {}).get("stage", {}).get("animation_cue")
            if event_cue in {"talk", "listen", "walk", "run"}:
                # Speech and locomotion need a partner/route. An unattended
                # resident must not talk alone or walk in place on the map.
                event_cue = None
            open_social_cue = ((open_social.get("animation_cues") or {}).get(resident["id"])
                               if open_social else None)
            social_cue = open_social_cue or next((event.get("animation_cues", {}).get(resident["id"])
                                                  for event in resident_events
                                                  if event.get("time_slot") == agents[resident["id"]]["current_slot"]
                                                  and event.get("animation_cues", {}).get(resident["id"])), None)
            resident["animation_cue"] = animation_cue(("walk" if open_social and open_social.get("status") == "traveling" else None)
                                                        or social_cue or event_cue or
                                                        agents[resident["id"]].get("animation_cue"))
            # The map gets finite ambient choreography rather than conversation
            # talk/listen loops. The full dialogue plan remains available on
            # resident.active_event.stage.performance.
            resident["world_action"]["animation_cue"] = resident["animation_cue"]
            action_state = resident["world_action"]["state"]
            performance = (journey_performance(resident["animation_cue"])
                           if action_state == "walking_to_event" else
                           encounter_performance(resident["animation_cue"])
                           if action_state == "waiting_at_event" else
                           ambient_performance(resident["animation_cue"]))
            resident["world_action"]["performance"] = performance_to_dict(performance)
        payload["time_slot"] = time_slot(datetime.now(game_zone).hour)
        payload["server_time"] = server_time.isoformat()
        payload["social_interactions"] = social_events
        return payload

    @app.get(settings.api_prefix + "/social-events")
    def social_events(game_date: Optional[str] = None, npc_id: Optional[str] = None,
                      authorization: Optional[str] = Header(None)):
        user = current_user(authorization); player_id = user["player_id"]
        require_world_ready(user)
        if life_world is not None:
            return {"social_interactions": []}
        profiles = life_profiles(player_id)
        if not profiles:
            profile_for(player_id)
            profiles = life_profiles(player_id)
        daily_social_world(player_id, profiles)
        return {"social_interactions": db.list_social_events(player_id, game_date, npc_id)}

    @app.post(settings.api_prefix + "/social-events/{event_id}/intervene")
    def intervene_social_event(event_id: str, body: SocialInterventionRequest,
                               authorization: Optional[str] = Header(None)):
        user = current_user(authorization)
        require_world_ready(user)
        if life_world is not None:
            raise HTTPException(410, {"code": "LEGACY_SOCIAL_EVENT_RETIRED",
                                      "message": "This interaction now belongs to the life-story system."})
        try:
            return social_engine.intervene(user["player_id"], event_id, body.action)
        except KeyError:
            raise HTTPException(404, {"code": "SOCIAL_EVENT_NOT_FOUND", "message": "Social event was not found."})
        except ValueError:
            raise HTTPException(422, {"code": "INVALID_SOCIAL_ACTION", "message": "This management action is not supported."})
        except RuntimeError as error:
            if "not ready" in str(error):
                raise HTTPException(409, {"code": "SOCIAL_EVENT_NOT_READY", "message": "The residents have not reached the event yet."})
            raise HTTPException(409, {"code": "SOCIAL_EVENT_CLOSED", "message": "This event is no longer open for management."})

    @app.post(settings.api_prefix + "/social-events/{event_id}/observe")
    def observe_social_event(event_id: str, authorization: Optional[str] = Header(None)):
        user = current_user(authorization)
        require_world_ready(user)
        if life_world is not None:
            raise HTTPException(410, {"code": "LEGACY_SOCIAL_EVENT_RETIRED",
                                      "message": "This interaction now belongs to the life-story system."})
        try:
            return social_engine.observe(user["player_id"], event_id)
        except KeyError:
            raise HTTPException(404, {"code": "SOCIAL_EVENT_NOT_FOUND", "message": "Social event was not found."})
        except RuntimeError:
            raise HTTPException(409, {"code": "SOCIAL_EVENT_NOT_READY", "message": "The residents have not reached the event yet."})

    @app.get(settings.api_prefix + "/life-stories")
    def life_stories(level: Optional[str] = None, status: Optional[str] = None,
                     npc_id: Optional[str] = None, household_id: Optional[str] = None,
                     game_date: Optional[str] = None,
                     authorization: Optional[str] = Header(None)):
        user = current_user(authorization)
        require_world_ready(user)
        if life_world is None:
            return {"stories": [], "world_version": None,
                    "server_time": datetime.now(timezone.utc).isoformat(), "next_transition_at": None}
        if level and level not in {"moment", "incident", "thread"}:
            raise HTTPException(422, {"code": "INVALID_STORY_LEVEL", "message": "Unknown story level."})
        if status and status not in {"open", "observed", "awaiting_management", "resolved_autonomously",
                                     "resolved_with_management", "closed"}:
            raise HTTPException(422, {"code": "INVALID_STORY_STATUS", "message": "Unknown story status."})
        return life_world.stories(user["player_id"], life_profiles(user["player_id"]),
                                  level=level, status=status, npc_id=npc_id,
                                  household_id=household_id, game_date=game_date)

    @app.post(settings.api_prefix + "/life-stories/{story_id}/observe")
    def observe_life_story(story_id: str, authorization: Optional[str] = Header(None)):
        user = current_user(authorization)
        require_world_ready(user)
        if life_world is None:
            raise HTTPException(404, {"code": "LIFE_STORY_NOT_FOUND", "message": "Life story was not found."})
        profiles = life_profiles(user["player_id"])
        try:
            state = life_world.observe(user["player_id"], profiles, story_id)
            return life_world.story(user["player_id"], profiles, story_id, state=state)
        except KeyError:
            raise HTTPException(404, {"code": "LIFE_STORY_NOT_FOUND", "message": "Life story was not found."})

    @app.post(settings.api_prefix + "/life-stories/{story_id}/intervene")
    def intervene_life_story(story_id: str, body: LifeInterventionRequest,
                             authorization: Optional[str] = Header(None)):
        user = current_user(authorization)
        require_world_ready(user)
        if life_world is None:
            raise HTTPException(404, {"code": "LIFE_STORY_NOT_FOUND", "message": "Life story was not found."})
        try:
            return life_world.intervene(user["player_id"], life_profiles(user["player_id"]),
                                        story_id, body.action, body.idempotency_key)
        except KeyError:
            raise HTTPException(404, {"code": "LIFE_STORY_NOT_FOUND", "message": "Life story was not found."})
        except ValueError as error:
            raise HTTPException(409, {"code": "LIFE_INTERVENTION_REJECTED", "message": str(error)})

    @app.get(settings.api_prefix + "/households")
    def households(authorization: Optional[str] = Header(None)):
        user = current_user(authorization)
        require_world_ready(user)
        if life_world is None:
            return {"households": [], "world_version": None,
                    "server_time": datetime.now(timezone.utc).isoformat()}
        return life_world.households(user["player_id"], life_profiles(user["player_id"]))

    @app.get(settings.api_prefix + "/households/{household_id}")
    def household(household_id: str, authorization: Optional[str] = Header(None)):
        user = current_user(authorization)
        require_world_ready(user)
        if life_world is None:
            raise HTTPException(404, {"code": "HOUSEHOLD_NOT_FOUND", "message": "Household was not found."})
        try:
            return life_world.household(user["player_id"], life_profiles(user["player_id"]), household_id)
        except KeyError:
            raise HTTPException(404, {"code": "HOUSEHOLD_NOT_FOUND", "message": "Household was not found."})

    @app.post(settings.api_prefix + "/npcs", status_code=201)
    def create_npc(body: NpcProfile, authorization: Optional[str] = Header(None)):
        user = current_user(authorization); player_id = user["player_id"]
        require_world_ready(user)
        npc_id = "npc-" + uuid.uuid4().hex[:12]
        try:
            db.create_npc_profile(
                player_id, npc_id, body.model_dump(),
                f"Hi, I'm {body.name}. What would you like to talk about?",
                f"嗨，我是{body.name}。你想聊些什么？", maximum=NPC_LIMIT,
            )
        except ValueError as error:
            if str(error) == "NPC_LIMIT_REACHED":
                raise HTTPException(409, {"code": "NPC_LIMIT_REACHED",
                                          "message": "You can create up to eight characters."})
            if str(error) == "NPC_NAME_TAKEN":
                raise HTTPException(409, {"code": "NPC_NAME_TAKEN",
                                          "message": "Character names must be unique."})
            raise
        db.ensure_social_edges(player_id, [entry["id"] for entry in db.list_npc_profiles(player_id)])
        progress = onboarding_state(player_id)
        if life_world is not None:
            life_world.load(player_id, life_profiles(player_id), force_advance=True)
        return {"id": npc_id, "profile": body.model_dump(), "onboarding": progress}

    @app.put(settings.api_prefix + "/npcs/{npc_id}")
    def update_npc(npc_id: str, body: NpcProfile, authorization: Optional[str] = Header(None)):
        user = current_user(authorization); player_id = user["player_id"]
        require_world_ready(user)
        profile_for(player_id, npc_id, create_default=False)
        try:
            saved = db.save_npc_profile(player_id, npc_id, body.model_dump())
        except ValueError as error:
            if str(error) == "NPC_NAME_TAKEN":
                raise HTTPException(409, {"code": "NPC_NAME_TAKEN",
                                          "message": "Character names must be unique."})
            raise
        runtime = db.get_runtime_state(player_id, npc_id) or initial_runtime(db.state(player_id, npc_id).mood,
                                                                            db.state(player_id, npc_id).relationship)
        db.save_persona(player_id, npc_id, compile_persona(saved, runtime.get("growth")))
        existing_goal = db.get_goal(player_id, npc_id)
        if not existing_goal or existing_goal.get("title") != (saved.get("longTermGoal") or "Build a meaningful everyday life"):
            db.save_goal(player_id, npc_id, compile_goal(saved))
        if life_world is not None:
            life_world.load(player_id, life_profiles(player_id), force_advance=True)
        return {"id": npc_id, "profile": saved}

    @app.get(settings.api_prefix + "/npcs/{npc_id}/agent")
    def npc_agent(npc_id: str, authorization: Optional[str] = Header(None)):
        user = current_user(authorization); player_id = user["player_id"]
        require_world_ready(user)
        profile = profile_for(player_id, npc_id, create_default=False)
        if life_world is not None:
            learning_state = db.get_learning_state(player_id)
            bundle, context = life_dialogue_bundle(player_id, npc_id, profile,
                                                   db.state(player_id, npc_id), learning_state)
            stage = str(bundle.get("relationship", {}).get("stage") or "stranger")
            return {**project_public_agent(bundle), **project_public_life_context(context),
                    "memories": project_public_memories(
                        db.list_npc_memories(player_id, npc_id, 200), stage,
                    )[:50],
                    "conversation_summaries": db.list_conversation_summaries(player_id, npc_id),
                    "social_connections": context["npc_relationships"],
                    "social_interactions": []}
        bundle = agent_bundle(player_id, npc_id, profile, db.state(player_id, npc_id),
                              db.get_learning_state(player_id))
        edges = db.ensure_social_edges(player_id, [entry["id"] for entry in life_profiles(player_id)])
        stage = str(bundle.get("relationship", {}).get("stage") or "stranger")
        return {**project_public_agent(bundle),
                "memories": project_public_memories(
                    db.list_npc_memories(player_id, npc_id, 200), stage,
                )[:50],
                "conversation_summaries": db.list_conversation_summaries(player_id, npc_id),
                "social_connections": [edge for edge in edges if edge["npc_a"] == npc_id],
                "social_interactions": db.list_social_events(player_id, npc_id=npc_id)}

    @app.get(settings.api_prefix + "/npcs/{npc_id}/memories")
    def npc_memories(npc_id: str, authorization: Optional[str] = Header(None)):
        user = current_user(authorization); require_world_ready(user)
        player_id = user["player_id"]
        profile_for(player_id, npc_id, create_default=False)
        relationship = db.get_relationship(player_id, npc_id) or initial_relationship(
            db.state(player_id, npc_id).relationship,
        )
        stage = str(relationship.get("stage") or "stranger")
        return {"memories": project_public_memories(
            db.list_npc_memories(player_id, npc_id, 200), stage,
        )[:100]}

    @app.delete(settings.api_prefix + "/npcs/{npc_id}/memories/{memory_id}", status_code=204)
    def delete_npc_memory(npc_id: str, memory_id: int, authorization: Optional[str] = Header(None)):
        user = current_user(authorization); require_world_ready(user)
        profile_for(user["player_id"], npc_id, create_default=False)
        if not db.delete_npc_memory(user["player_id"], npc_id, memory_id):
            raise HTTPException(404, {"code": "MEMORY_NOT_FOUND", "message": "Memory was not found."})
        return Response(status_code=204)

    @app.get(settings.api_prefix + "/learning/profile")
    def learning_profile(authorization: Optional[str] = Header(None)):
        user = current_user(authorization)
        return learning_engine.progress(db.get_learning_state(user["player_id"]))

    def resume_chat_effects(player_id: str, idempotency_key: str) -> dict | None:
        """Finish a committed chat outbox without calling the model again."""
        turn = db.get_chat_turn(player_id, idempotency_key)
        if not turn or not turn.get("response"):
            return None
        effects = db.apply_chat_db_effects(player_id, idempotency_key)
        life_effect = effects.get("life_interaction")
        turn = db.get_chat_turn(player_id, idempotency_key)
        if life_effect and not turn.get("life_applied_at"):
            if life_world is None:
                raise RuntimeError("committed life-world chat cannot be completed in legacy mode")
            life_world.player_interaction(
                player_id,
                life_profiles(player_id),
                str(life_effect["npc_id"]),
                idempotency_key,
                mood_change=int(life_effect.get("mood_change", 0)),
                relationship_change=int(life_effect.get("relationship_change", 0)),
                semantic_signals=list(life_effect.get("semantic_signals") or []),
            )
            db.mark_chat_life_applied(player_id, idempotency_key)
        return db.complete_chat_turn(player_id, idempotency_key)

    def claim_chat_execution(player_id: str, idempotency_key: str) -> tuple[str | None, dict | None]:
        """Elect one generator; concurrent requests wait for its durable result."""
        owner_token = uuid.uuid4().hex
        wait_seconds = max(
            30.0,
            settings.deepseek_timeout * (settings.deepseek_retry_count + 1) + 15.0,
        )
        deadline = time.monotonic() + min(180.0, wait_seconds)
        while True:
            claim = db.claim_chat_turn(
                player_id, idempotency_key, owner_token,
                lease_seconds=max(60, int(wait_seconds + 30)),
            )
            if claim.acquired:
                return owner_token, None
            if claim.blocking_key:
                # Preserve causal order for player-global learning and for
                # successive turns that derive NPC state from the prior turn.
                if resume_chat_effects(player_id, claim.blocking_key) is not None:
                    continue
            recovered = resume_chat_effects(player_id, idempotency_key)
            if recovered is not None:
                return None, recovered
            if time.monotonic() >= deadline:
                raise HTTPException(409, {
                    "code": "CHAT_REQUEST_IN_PROGRESS",
                    "message": "The same chat request is still being processed.",
                })
            time.sleep(.025)

    def prepare_chat(body: ChatRequest, idempotency_key: str, authorization: str | None):
        user = current_user(authorization); player_id = user["player_id"]
        require_world_ready(user)
        if not KEY_RE.fullmatch(idempotency_key):
            raise HTTPException(400, {"code": "INVALID_IDEMPOTENCY_KEY", "message": "Idempotency-Key is invalid."})
        message = body.message.strip()
        if not message or len(message) > settings.max_message_characters or any(ord(c) < 32 and c not in "\n\t" for c in message):
            raise HTTPException(422, {"code": "INVALID_MESSAGE", "message": f"Message must contain 1-{settings.max_message_characters} valid characters."})
        try:
            turn = db.register_chat_turn(player_id, idempotency_key, body.npc_id, message)
        except ChatRequestConflict as exc:
            raise HTTPException(409, {
                "code": "IDEMPOTENCY_KEY_REUSED",
                "message": str(exc),
            }) from exc
        cached = turn.get("response") or db.cached(player_id, idempotency_key)
        if cached:
            cached = resume_chat_effects(player_id, idempotency_key) or cached
            # Responses cached before animation-cue support remain replayable.
            cached["animation_cue"] = animation_cue(cached.get("animation_cue") or cached.get("animation"))
            cached_agent = cached.get("agent")
            if isinstance(cached_agent, dict):
                cached_agent = project_public_agent(cached_agent)
                cached["agent"] = cached_agent
                cached_agent.setdefault("animation_cue", cached["animation_cue"])
            cached_event = cached.get("active_event")
            if isinstance(cached_event, dict) and isinstance(cached_event.get("stage"), dict):
                cached_stage = cached_event["stage"]
                cached_stage.setdefault("animation_cue", cached["animation_cue"])
                cached_stage.setdefault(
                    "performance",
                    performance_to_dict(stage_performance(cached_stage["animation_cue"])),
                )
            cached_update = cached.get("event_update")
            if isinstance(cached_update, dict):
                cached_outcome = cached_update.get("outcome")
                if isinstance(cached_outcome, dict):
                    cached_outcome.setdefault("animation_cue", cached["animation_cue"])
                    cached_outcome.setdefault(
                        "performance",
                        performance_to_dict(outcome_performance(cached_outcome["animation_cue"])),
                    )
                cached_update.setdefault(
                    "performance",
                    performance_to_dict(
                        outcome_performance(cached["animation_cue"])
                        if cached_update.get("completed") else stage_performance(cached["animation_cue"])
                    ),
                )
            return user, message, {**cached, "quota": db.quota(user["id"])}
        denied = db.consume_chat(user["id"], idempotency_key, settings.chat_per_minute)
        if denied:
            raise HTTPException(429, {"code": denied, "message": "Chat limit reached. Please try again later."})
        return user, message, None

    def generate_and_commit_chat(body: ChatRequest, idempotency_key: str, user: dict,
                                 message: str, owner_token: str, on_chunk=None):
        player_id = user["player_id"]
        npc_id = body.npc_id
        profile = profile_for(player_id, npc_id)
        old = db.state(player_id, npc_id)
        learning_state = db.get_learning_state(player_id)
        if life_world is not None:
            agent, life_context = life_dialogue_bundle(player_id, npc_id, profile, old, learning_state)
            active = None
        else:
            agent = agent_bundle(player_id, npc_id, profile, old, learning_state)
            active = event_engine.daily_event(event_context(player_id, npc_id, profile, old, learning_state,
                                                            agent["runtime_state"]), game_today())
            life_context = None
        memories = db.relevant_npc_memories(player_id, npc_id, message, limit=8,
                                            relationship_stage=agent["relationship"]["stage"])
        summaries = db.list_conversation_summaries(player_id, npc_id, limit=3)
        event_view = public_event(active, profile)
        # Renderer timing is not story context and would waste dialogue-model
        # tokens, so keep the public event rich while sending the model only
        # narrative fields.
        prompt_event = ({**event_view, "stage": {
            key: value for key, value in event_view["stage"].items() if key != "performance"
        }} if event_view else None)
        dialogue_agent = project_dialogue_agent(agent)
        prompt_memories = project_dialogue_memories(
            memories, str(agent.get("relationship", {}).get("stage") or "stranger"),
        )
        context = {"npc_profile": profile, "current_event": prompt_event,
                   "current_life": project_dialogue_life_context(life_context),
                   "learning_targets": learning_engine.targets(learning_state, limit=3),
                   "memories": prompt_memories, "conversation_summaries": summaries, **dialogue_agent,
                   "dialogue_objective": dialogue_objective(event_view, agent["runtime_state"],
                                                             agent["goal"], agent["relationship"])}
        result = provider_reply(message, old, db.messages(player_id, settings.recent_message_limit, npc_id), context, on_chunk)
        # Legacy/custom providers may still populate these API-era fields. At
        # the provider boundary they are always neutralized; only validated
        # semantic and language evidence can reach authoritative settlement.
        result = result.model_copy(update={
            "relationship_change": 0,
            "mood_change": 0,
            "english_xp_change": 0,
        })
        dialogue_fallback = bool(
            result.agent_trace.get("dialogue_fallback")
            or result.agent_trace.get("model") == "rules"
        )
        fallback_translation_parts = []
        if dialogue_fallback and event_view:
            stage_translation = event_view.get("stage", {}).get("translation")
            if stage_translation:
                fallback_translation_parts.append(str(stage_translation))
        evidence = [Evidence(**item.model_dump()) for item in result.learning_evidence]
        learning_engine.apply(learning_state, evidence)
        event_update = None
        event_transition_effect = None
        event_rel = event_mood = 0
        event_cue = event_engine.stage(active).animation_cue if active else None
        outcome_cue = None
        event_performance = event_engine.stage(active).performance if active else None
        if active:
            transition = preview_event_advance(event_engine, active, result.semantic_signals)
            event_transition_effect = {
                "active_event": event_to_dict(transition.event) if transition.event else None,
                "history": event_to_dict(transition.memory) if transition.memory else None,
            }
            event_update = {"stage_changed": transition.stage_changed, "completed": transition.completed}
            if transition.completed and transition.outcome and transition.memory:
                event_rel, event_mood = transition.outcome.relationship_change, transition.outcome.mood_change
                outcome_cue = transition.outcome.animation_cue
                event_performance = transition.outcome.performance
                event_update.update({"outcome": {"id": transition.outcome.id,
                                                 "memory": transition.memory.memory,
                                                 "animation_cue": transition.outcome.animation_cue,
                                                 "performance": performance_to_dict(transition.outcome.performance)},
                                     "memory": transition.memory.memory})
            elif transition.stage_changed and transition.event:
                # The next story beat must remain visible even while the live
                # speech bubble persists. Templates contain situation content,
                # while names are adapted to the selected custom character.
                next_stage = event_engine.stage(transition.event)
                event_cue = next_stage.animation_cue
                event_performance = next_stage.performance
                result.npc_reply = f"{result.npc_reply}\n\n{next_stage.prompt.replace('Emma', profile['name'])}"
                if dialogue_fallback and next_stage.prompt_zh:
                    fallback_translation_parts.append(next_stage.prompt_zh.replace('Emma', profile['name']))
            active = transition.event
        translated_reply = result.npc_reply_zh.strip()
        if hasattr(provider, "translate"):
            try:
                translated_reply = provider.translate(result.npc_reply).strip()  # type: ignore[attr-defined]
            except Exception:
                translated_reply = ""
        if not translated_reply and fallback_translation_parts:
            translated_reply = "\n\n".join(fallback_translation_parts)
        result.npc_reply_zh = translated_reply[:1200]
        semantic_settlement = settle_chat_semantics(
            semantic_signals=result.semantic_signals,
            english_feedback=result.english_feedback,
            learning_evidence=result.learning_evidence,
        )
        rel = max(-10, min(10, semantic_settlement.relationship_change + event_rel))
        if rel > 0:
            rel = min(rel, max(0, 10 - db.positive_relationship_change_today(
                player_id, npc_id, game_today().isoformat())))
        mood = max(-10, min(10, semantic_settlement.mood_change + event_mood))
        final_animation_cue = resolve_turn_animation(
            result.animation_cue, mood, event_cue=event_cue, outcome_cue=outcome_cue,
        )
        if event_update is not None:
            event_update["animation_cue"] = final_animation_cue
            event_update["performance"] = performance_to_dict(
                event_performance or stage_performance(final_animation_cue)
            )
        xp = semantic_settlement.english_xp_change
        stats = {"relationship": max(0, min(100, old.relationship + rel)), "mood": max(0, min(100, old.mood + mood)), "english_xp": max(0, min(100, old.english_xp + xp))}
        relationship = advance_relationship(agent["relationship"], rel, result.semantic_signals)
        runtime = json.loads(json.dumps(agent["runtime_state"]))
        runtime["emotion"]["valence"] = stats["mood"]
        runtime["emotion"]["stress"] = max(0, min(100, runtime["emotion"]["stress"] - max(0, mood)))
        runtime["needs"]["social"] = max(0, min(100, runtime["needs"]["social"] + 8))
        runtime["needs"]["love"] = max(0, min(100, runtime["needs"]["love"] + max(0, rel)))
        goal = agent["goal"]
        if event_update and event_update.get("completed"):
            goal = advance_goal(goal, 8 + max(0, event_rel))
            growth = runtime.setdefault("growth", {})
            if set(result.semantic_signals) & {"encouragement", "reassurance", "practical_help"}:
                growth["assertiveness"] = min(15, float(growth.get("assertiveness", 0)) + .5)
                growth["emotional_stability"] = min(15, float(growth.get("emotional_stability", 0)) + .5)
        public_agent = project_public_agent({
            "runtime_state": runtime, "relationship": relationship, "goal": goal,
            "daily_plan": agent["daily_plan"], "current_slot": agent["current_slot"],
            "development": agent.get("development"),
            "animation_cue": final_animation_cue,
        })
        response = {**result.model_dump(), "npc_id": npc_id, "game_date": game_today().isoformat(),
                    "relationship_change": rel, "mood_change": mood,
                    "english_xp_change": xp, "stats": stats,
                    "animation": "happy" if mood > 0 else "sad" if mood < 0 else "idle",
                    "animation_cue": final_animation_cue,
                    "active_event": public_event(active, profile), "event_update": event_update,
                    "learning_summary": learning_engine.progress(learning_state), "agent": public_agent}
        memories_to_commit = []
        summary_observations = []
        for index, candidate in enumerate(result.memory_candidates):
            if candidate.confidence < .6:
                continue
            expires_at = (
                datetime.now(timezone.utc) + timedelta(days=candidate.ttl_days)
            ).isoformat() if candidate.ttl_days else None
            memories_to_commit.append({
                "kind": candidate.kind,
                "content": candidate.content,
                "source_event_id": f"chat:{idempotency_key}:memory:{index}",
                "importance": candidate.importance,
                "tags": list(candidate.tags),
                "confidence": candidate.confidence,
                "expires_at": expires_at,
                "access_stage": candidate.access_stage,
            })
            summary_observations.append(candidate.content)
        if event_update and event_update.get("memory"):
            summary_observations.append(event_update["memory"])
            history = (event_transition_effect or {}).get("history") or {}
            memories_to_commit.append({
                "kind": "event",
                "content": event_update["memory"],
                "source_event_id": history.get("template_id"),
                "importance": 3,
                "tags": ["event", history.get("category", "daily")],
                "confidence": 1,
                "access_stage": "stranger",
            })
        effects = {
            "version": 1,
            "game_date": game_today().isoformat(),
            "learning_state": learning_state.to_dict(),
            "event_transition": event_transition_effect,
            "relationship": relationship,
            "runtime_state": runtime if life_world is None else None,
            "goal": goal,
            "persona": compile_persona(profile, runtime.get("growth")),
            "memories": memories_to_commit,
            "summary_observations": summary_observations,
            "agent_trace": {
                **result.agent_trace,
                "memory_ids": [item["id"] for item in memories],
            },
            "life_interaction": ({
                "npc_id": npc_id,
                "mood_change": mood,
                "relationship_change": rel,
                "semantic_signals": list(result.semantic_signals),
            } if life_world is not None else None),
        }
        db.commit_chat_with_effects(
            player_id, idempotency_key, owner_token, message, response, effects, npc_id,
        )
        committed = resume_chat_effects(player_id, idempotency_key) or response
        return {**committed, "quota": db.quota(user["id"])}

    def execute_chat(body: ChatRequest, idempotency_key: str, user: dict,
                     message: str, on_chunk=None):
        player_id = user["player_id"]
        while True:
            owner_token, cached = claim_chat_execution(player_id, idempotency_key)
            if cached is not None:
                if on_chunk:
                    on_chunk(str(cached.get("npc_reply") or ""))
                return {**cached, "quota": db.quota(user["id"])}
            assert owner_token is not None
            try:
                return generate_and_commit_chat(
                    body, idempotency_key, user, message, owner_token, on_chunk,
                )
            except ChatTurnLeaseLost:
                # Another process recovered an expired lease. Its committed
                # response is authoritative; wait for it rather than publishing
                # this stale model result.
                continue
            finally:
                turn = db.get_chat_turn(player_id, idempotency_key)
                if not turn or not turn.get("response"):
                    db.release_chat_turn(player_id, idempotency_key, owner_token)

    @app.post(settings.api_prefix + "/chat", response_model=ChatResponse)
    def chat(body: ChatRequest, idempotency_key: str = Header(...), authorization: Optional[str] = Header(None)):
        player_lock = chat_player_lock(current_user(authorization)["player_id"])
        with player_lock:
            user, message, cached = prepare_chat(body, idempotency_key, authorization)
            return cached or execute_chat(body, idempotency_key, user, message)

    @app.post(settings.api_prefix + "/chat/stream")
    def chat_stream(body: ChatRequest, idempotency_key: str = Header(...), authorization: Optional[str] = Header(None)):
        player_lock = chat_player_lock(current_user(authorization)["player_id"])
        def encode(kind: str, value) -> str:
            return json.dumps({"type": kind, "data": value}, ensure_ascii=False, separators=(",", ":")) + "\n"
        events: queue.Queue = queue.Queue()
        def work():
            prepared = False
            try:
                # RLock ownership never crosses an iterator yield: this worker
                # acquires and releases it in one thread while the response
                # iterator only consumes the queue.
                with player_lock:
                    user, message, cached = prepare_chat(
                        body, idempotency_key, authorization,
                    )
                    prepared = True
                    events.put(("ready", None))
                    if cached:
                        events.put(("delta", cached["npc_reply"]))
                        events.put(("final", cached))
                    else:
                        result = execute_chat(body, idempotency_key, user, message, lambda chunk: events.put(("delta", chunk)))
                        events.put(("final", result))
            except Exception as exc:
                events.put((
                    "error" if prepared else "startup_error",
                    {"message": str(exc)} if prepared else exc,
                ))
            finally:
                events.put(("done", None))
        threading.Thread(target=work, daemon=True).start()
        startup_kind, startup_value = events.get()
        if startup_kind == "startup_error":
            raise startup_value
        if startup_kind != "ready":
            raise RuntimeError("chat stream worker failed before preparation")
        def stream():
            while True:
                kind, value = events.get()
                if kind == "done":
                    break
                yield encode(kind, value)
        return StreamingResponse(stream(), media_type="application/x-ndjson", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    @app.post(settings.api_prefix + "/admin/login")
    def admin_login(body: AdminLoginRequest, request: Request, response: Response):
        check_admin_origin(request)
        rate_limit("admin-login", request, maximum=5, window_seconds=15 * 60)
        if not settings.admin_password or not secrets.compare_digest(body.password, settings.admin_password):
            raise HTTPException(401, {"code": "INVALID_ADMIN_PASSWORD", "message": "Password is incorrect."})
        clear_attempts("admin-login", request)
        response.set_cookie("lingolife_admin", admin_cookie(), max_age=8*3600, httponly=True, secure=settings.admin_cookie_secure, samesite="strict", path=settings.api_prefix + "/admin")
        return {"authenticated": True}

    @app.get(settings.api_prefix + "/admin/session")
    def admin_session(request: Request): require_admin(request); return {"authenticated": True}

    @app.post(settings.api_prefix + "/admin/logout", status_code=204)
    def admin_logout(request: Request, response: Response):
        require_admin(request); check_admin_origin(request)
        response.delete_cookie("lingolife_admin", path=settings.api_prefix + "/admin")
        response.status_code = 204

    @app.get(settings.api_prefix + "/admin/summary")
    def admin_summary(request: Request): require_admin(request); return db.summary()

    @app.get(settings.api_prefix + "/admin/users")
    def admin_users(request: Request, q: str = ""): require_admin(request); return {"users": db.users(q[:64])}

    @app.get(settings.api_prefix + "/admin/roster-migrations")
    def admin_roster_migrations(request: Request, status: str = ""):
        require_admin(request)
        allowed = {"", "ready", "needs_onboarding", "needs_roster_review",
                   "blocked_invalid_fixture", "blocked_verification_failed"}
        if status not in allowed:
            raise HTTPException(422, {
                "code": "INVALID_MIGRATION_STATUS", "message": "Unknown roster migration status.",
            })
        return {"migrations": db.list_roster_migrations(status or None)}

    @app.get(settings.api_prefix + "/admin/users/{user_id}/roster-migration")
    def admin_user_roster_migration(user_id: str, request: Request):
        require_admin(request)
        result = db.roster_migration_for_user(user_id)
        if result is None:
            raise HTTPException(404, {
                "code": "ROSTER_MIGRATION_NOT_FOUND",
                "message": "This account has no legacy roster migration record.",
            })
        return result

    @app.get(settings.api_prefix + "/admin/users/{user_id}/roster-migration/reports")
    def admin_user_roster_migration_reports(user_id: str, request: Request):
        require_admin(request)
        result = db.roster_migration_reports_for_user(user_id)
        if result is None:
            raise HTTPException(404, {
                "code": "USER_NOT_FOUND", "message": "User was not found.",
            })
        return result

    @app.post(settings.api_prefix + "/admin/users/{user_id}/roster-migration/select")
    def admin_select_user_roster(
        user_id: str, body: AdminRosterSelectionRequest, request: Request,
    ):
        require_admin(request); check_admin_origin(request)
        try:
            return db.select_active_roster(
                user_id, body.active_npc_ids,
                expected_revision=body.expected_revision,
                confirm_username=body.confirm_username, actor="admin",
                note=body.note, request_key=body.request_key,
            )
        except ValueError as error:
            code = str(error)
            status_code = 404 if code in {"USER_NOT_FOUND", "ROSTER_MIGRATION_NOT_FOUND"} else 409
            messages = {
                "USER_NOT_FOUND": "User was not found.",
                "ROSTER_MIGRATION_NOT_FOUND": "This account has no legacy roster migration record.",
                "USERNAME_CONFIRMATION_MISMATCH": "Confirmation username does not match the selected account.",
                "ROSTER_REVISION_CONFLICT": "The roster review changed. Reload it before saving.",
                "ROSTER_REQUEST_CONFLICT": "This roster request key was already used for another selection.",
                "DUPLICATE_NPC_ID": "Each active resident can only be selected once.",
                "ACTIVE_ROSTER_SIZE": "Select between two and eight active residents.",
                "UNKNOWN_NPC_ID": "The selection contains a character outside this legacy roster.",
                "INVALID_LEGACY_FIXTURE": "The legacy save failed integrity checks and cannot be activated.",
            }
            raise HTTPException(status_code, {
                "code": code, "message": messages.get(code, "Roster selection was rejected."),
            })

    @app.get(settings.api_prefix + "/admin/agent-traces")
    def admin_agent_traces(request: Request, limit: int = 100):
        require_admin(request)
        return {"traces": db.list_agent_traces(limit)}

    @app.get(settings.api_prefix + "/admin/world-layout")
    def admin_world_layout(request: Request):
        require_admin(request)
        return admin_layout_state()

    @app.get(settings.api_prefix + "/admin/world-layout/draft")
    def admin_world_layout_draft(request: Request):
        require_admin(request)
        return admin_layout_state()["draft"]

    @app.put(settings.api_prefix + "/admin/world-layout/draft")
    def admin_save_world_layout_draft(body: WorldLayoutDraftRequest, request: Request):
        require_admin(request); check_admin_origin(request)
        layout = body.layout.model_dump(mode="json")
        validation = layout_validation(layout)
        try:
            return db.save_world_layout_draft(
                layout, body.revision, body.author, validation,
            )
        except WorldLayoutDraftConflict as error:
            raise HTTPException(409, {
                "code": "LAYOUT_DRAFT_CONFLICT",
                "message": "草稿已被其他编辑器更新，请重新载入后再保存。",
                "current_revision": error.current_revision,
            })

    @app.post(settings.api_prefix + "/admin/world-layout/validate")
    def admin_validate_world_layout(body: WorldLayoutValidationRequest, request: Request):
        require_admin(request); check_admin_origin(request)
        return layout_validation(body.layout.model_dump(mode="json"))

    @app.post(settings.api_prefix + "/admin/world-layout/publish")
    def admin_publish_world_layout(body: WorldLayoutPublishRequest, request: Request):
        require_admin(request); check_admin_origin(request)
        draft = db.get_world_layout_draft()
        current_revision = int(draft["revision"]) if draft else 0
        if not draft or current_revision != body.revision:
            raise HTTPException(409, {
                "code": "LAYOUT_DRAFT_CONFLICT",
                "message": "草稿版本已变化，请重新载入后再发布。",
                "current_revision": current_revision,
            })
        layout = WorldLayout.model_validate(draft["layout"]).model_dump(mode="json")
        validation = require_valid_layout(layout)
        try:
            db.publish_world_layout(
                layout, note=body.note, author=body.author,
                validation=validation, expected_draft_revision=body.revision,
            )
        except WorldLayoutDraftConflict as error:
            raise HTTPException(409, {
                "code": "LAYOUT_DRAFT_CONFLICT",
                "message": "草稿版本已变化，请重新载入后再发布。",
                "current_revision": error.current_revision,
            })
        return admin_layout_state()

    @app.get(settings.api_prefix + "/admin/world-layout/versions")
    def admin_world_layout_versions(request: Request):
        require_admin(request)
        return {"versions": db.list_world_layout_versions(),
                "audit": db.world_layout_audit(100)}

    @app.post(settings.api_prefix + "/admin/world-layout/versions/{version_id}/activate")
    def admin_activate_world_layout(version_id: str, body: WorldLayoutActivateRequest,
                                    request: Request):
        require_admin(request); check_admin_origin(request)
        version = db.world_layout_version(version_id)
        if not version:
            raise HTTPException(404, {
                "code": "LAYOUT_VERSION_NOT_FOUND", "message": "布局版本不存在。",
            })
        layout = WorldLayout.model_validate(version["layout"]).model_dump(mode="json")
        require_valid_layout(layout)
        if not db.activate_world_layout_version(version_id, body.note, body.author):
            raise HTTPException(404, {
                "code": "LAYOUT_VERSION_NOT_FOUND", "message": "布局版本不存在。",
            })
        return admin_layout_state()

    @app.put(settings.api_prefix + "/admin/world-layout")
    def admin_save_world_layout(body: WorldLayoutRequest, request: Request):
        require_admin(request); check_admin_origin(request)
        layout = body.layout.model_dump(mode="json")
        validation = require_valid_layout(layout)
        db.publish_world_layout(
            layout, note=body.note, author=body.author, validation=validation,
        )
        return published_world_layout()

    @app.post(settings.api_prefix + "/admin/world-layout/reset")
    def admin_reset_world_layout(request: Request):
        require_admin(request); check_admin_origin(request)
        validation = require_valid_layout(built_in_world_layout)
        existing_draft = db.get_world_layout_draft()
        draft = db.save_world_layout_draft(
            built_in_world_layout, int(existing_draft["revision"]) if existing_draft else 0,
            "admin", validation,
        )
        db.publish_world_layout(
            built_in_world_layout, note="恢复项目默认布局", author="admin",
            validation=validation, expected_draft_revision=draft["revision"],
            is_default=True,
        )
        return published_world_layout()

    @app.patch(settings.api_prefix + "/admin/users/{user_id}")
    def admin_patch_user(user_id: str, body: AdminUserPatch, request: Request):
        require_admin(request); check_admin_origin(request)
        result = db.patch_user(user_id, body.disabled, body.quota_delta)
        if not result: raise HTTPException(404, {"code": "USER_NOT_FOUND", "message": "User was not found."})
        return result

    @app.post(settings.api_prefix + "/admin/users/{user_id}/reset-onboarding")
    def admin_reset_user_onboarding(user_id: str, body: AdminUserResetRequest,
                                    request: Request):
        """Return one existing account to the fresh-player game flow.

        This operation is intentionally limited to the reserved
        ``onboarding-test`` account family. Authentication, sessions, invite
        redemption and quota/usage records deliberately survive. The typed
        username confirmation prevents an accidentally selected test account
        from losing its game save.
        """
        require_admin(request); check_admin_origin(request)
        try:
            return db.reset_user_game_progress(user_id, body.confirm_username)
        except ValueError as error:
            if str(error) == "USER_NOT_FOUND":
                raise HTTPException(404, {"code": "USER_NOT_FOUND",
                                          "message": "User was not found."})
            if str(error) == "USERNAME_CONFIRMATION_MISMATCH":
                raise HTTPException(409, {"code": "USERNAME_CONFIRMATION_MISMATCH",
                                          "message": "Confirmation username does not match the selected account."})
            if str(error) == "TEST_ACCOUNT_REQUIRED":
                raise HTTPException(403, {"code": "TEST_ACCOUNT_REQUIRED",
                                          "message": "Only onboarding-test accounts can reset their game save."})
            raise

    @app.post(settings.api_prefix + "/admin/invites", status_code=201)
    def admin_invites(body: InviteCreateRequest, request: Request):
        require_admin(request); check_admin_origin(request)
        quota = body.daily_quota or settings.default_daily_quota
        return {"invites": db.create_invites(body.count, quota), "daily_quota": quota}

    @app.get(settings.api_prefix + "/admin/invites")
    def admin_unused_invites(request: Request):
        require_admin(request)
        return {"invites": db.unused_invites()}

    # Keep this catch-all mount after every API route so the web UI can never
    # shadow the JSON endpoints. Starlette's StaticFiles rejects paths that
    # escape this directory and serves index.html for the root request.
    web_root = Path(settings.web_root).resolve()
    if web_root.is_dir():
        # Compress only static files, leaving the NDJSON chat stream untouched.
        static_app = GZipMiddleware(
            StaticFiles(directory=web_root, html=True),
            minimum_size=1024,
            compresslevel=6,
        )
        app.mount("/", static_app, name="web")

    app.state.db = db
    return app


app = create_app()
