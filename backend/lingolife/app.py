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

from .animation import animation_cue, resolve_turn_animation, state_animation_cue
from .ai import DeepSeekProvider, DialogueProvider, ResilientProvider
from .agent import (advance_goal, advance_relationship, advance_runtime, compile_goal,
                    compile_persona, daily_plan, dialogue_objective, initial_relationship,
                    initial_runtime, time_slot)
from .config import Settings, load_settings
from .city import CITY_LOCATIONS, LOCATION_BY_ID, city_payload
from .db import Database
from .events import ActiveEvent, EventEngine, NPCEventContext
from .learning import Evidence, LearningEngine
from .models import (AdminLoginRequest, AdminUserPatch, ChatRequest, ChatResponse,
                     InviteCreateRequest, LoginRequest, NpcProfile, PasswordChangeRequest, RegisterRequest,
                     SocialInterventionRequest)
from .social import SocialWorldEngine

KEY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$")
USERNAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$")

DEFAULT_NPC_PROFILE = {
    "name": "Emma", "age": 25, "relationship": "Friend",
    "personality": ["kind", "thoughtful", "quiet"],
    "interests": ["art", "music", "photography"], "occupation": "Designer",
    "longTermGoal": "Open a small independent design studio.",
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
        profile = db.get_npc_profile(player_id, npc_id)
        if profile:
            return profile
        if npc_id == "emma" and create_default:
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
                "stage": {"id": stage.id, "prompt": adapt(stage.prompt), "objective": adapt(stage.objective),
                          "animation_cue": stage.animation_cue},
                "stage_index": active.stage_index, "stage_count": len(template.stages),
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
        return {"persona": persona, "runtime_state": runtime, "relationship": relationship,
                "goal": goal, "daily_plan": plan, "current_slot": time_slot(datetime.now(game_zone).hour),
                "language_controller": language_controller,
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
        return social_engine.ensure_daily(player_id, profiles, plans, game_today(), slot, names, runtime_states)

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
        return {"session_token": token, "user": {"id": user["id"], "username": user["username"], "has_password": True}, "quota": db.quota(user["id"])}

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
        return {"session_token": token, "user": {"id": user["id"], "username": user["username"], "has_password": True}, "quota": db.quota(user["id"])}

    @app.get(settings.api_prefix + "/auth/me")
    def me(authorization: Optional[str] = Header(None)):
        user = current_user(authorization)
        return {"user": {"id": user["id"], "username": user["username"], "has_password": bool(user.get("password_hash"))}, "quota": db.quota(user["id"])}

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
        profile = profile_for(player_id, npc_id)
        stats = db.state(player_id, npc_id)
        learning_state = db.get_learning_state(player_id)
        agent = agent_bundle(player_id, npc_id, profile, stats, learning_state)
        active = event_engine.daily_event(event_context(player_id, npc_id, profile, stats, learning_state,
                                                        agent["runtime_state"]), game_today())
        animation = "sad" if stats.mood < 40 else "happy" if stats.mood >= 60 else "idle"
        active_view = public_event(active, profile)
        cue = active_view["stage"]["animation_cue"] if active_view else agent["animation_cue"]
        social_events = daily_social_world(player_id, db.list_npc_profiles(player_id), {npc_id: agent})
        return {"room_id": f"{npc_id}-room", "npc": {"id": npc_id, "name": profile["name"],
                                                       "animation": animation, "animation_cue": cue},
                "stats": stats, "messages": db.messages(player_id, 200, npc_id),
                "quota": db.quota(user["id"]), "active_event": active_view, "agent": agent,
                "social_interactions": [event for event in social_events if npc_id in event["participant_ids"]]}

    @app.get(settings.api_prefix + "/npc/profile")
    def npc_profile(authorization: Optional[str] = Header(None)):
        user = current_user(authorization)
        return profile_for(user["player_id"])

    @app.put(settings.api_prefix + "/npc/profile")
    def save_npc_profile(body: NpcProfile, authorization: Optional[str] = Header(None)):
        user = current_user(authorization)
        return db.save_npc_profile(user["player_id"], "emma", body.model_dump())

    @app.get(settings.api_prefix + "/npcs")
    def npc_profiles(authorization: Optional[str] = Header(None)):
        user = current_user(authorization); player_id = user["player_id"]
        profile_for(player_id)
        return {"npcs": db.list_npc_profiles(player_id), "limit": 5}

    @app.get(settings.api_prefix + "/world")
    @app.get(settings.api_prefix + "/city")
    def city(authorization: Optional[str] = Header(None)):
        user = current_user(authorization); player_id = user["player_id"]
        profile_for(player_id)  # Materialize the default resident for older accounts.
        profiles = db.list_npc_profiles(player_id)
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
            if event_cue in {"talk", "listen"}:
                event_cue = None  # Conversation-only cues should not make a resident talk alone on the map.
            social_cue = next((event.get("animation_cues", {}).get(resident["id"])
                               for event in resident_events
                               if event.get("time_slot") == agents[resident["id"]]["current_slot"]
                               and event.get("animation_cues", {}).get(resident["id"])), None)
            resident["animation_cue"] = animation_cue(("walk" if open_social and open_social.get("status") == "traveling" else None)
                                                        or social_cue or event_cue or
                                                        agents[resident["id"]].get("animation_cue"))
        payload["time_slot"] = time_slot(datetime.now(game_zone).hour)
        payload["server_time"] = server_time.isoformat()
        payload["social_interactions"] = social_events
        return payload

    @app.get(settings.api_prefix + "/social-events")
    def social_events(game_date: Optional[str] = None, npc_id: Optional[str] = None,
                      authorization: Optional[str] = Header(None)):
        user = current_user(authorization); player_id = user["player_id"]
        profiles = db.list_npc_profiles(player_id)
        if not profiles:
            profile_for(player_id)
            profiles = db.list_npc_profiles(player_id)
        daily_social_world(player_id, profiles)
        return {"social_interactions": db.list_social_events(player_id, game_date, npc_id)}

    @app.post(settings.api_prefix + "/social-events/{event_id}/intervene")
    def intervene_social_event(event_id: str, body: SocialInterventionRequest,
                               authorization: Optional[str] = Header(None)):
        user = current_user(authorization)
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
        try:
            return social_engine.observe(user["player_id"], event_id)
        except KeyError:
            raise HTTPException(404, {"code": "SOCIAL_EVENT_NOT_FOUND", "message": "Social event was not found."})
        except RuntimeError:
            raise HTTPException(409, {"code": "SOCIAL_EVENT_NOT_READY", "message": "The residents have not reached the event yet."})

    @app.post(settings.api_prefix + "/npcs", status_code=201)
    def create_npc(body: NpcProfile, authorization: Optional[str] = Header(None)):
        user = current_user(authorization); player_id = user["player_id"]
        profile_for(player_id)
        if len(db.list_npc_profiles(player_id)) >= 5:
            raise HTTPException(409, {"code": "NPC_LIMIT_REACHED", "message": "You can create up to five characters."})
        npc_id = "npc-" + uuid.uuid4().hex[:12]
        db.ensure_npc(player_id, npc_id, f"Hi, I'm {body.name}. What would you like to talk about?")
        db.save_npc_profile(player_id, npc_id, body.model_dump())
        db.ensure_social_edges(player_id, [entry["id"] for entry in db.list_npc_profiles(player_id)])
        return {"id": npc_id, "profile": body.model_dump()}

    @app.put(settings.api_prefix + "/npcs/{npc_id}")
    def update_npc(npc_id: str, body: NpcProfile, authorization: Optional[str] = Header(None)):
        user = current_user(authorization); player_id = user["player_id"]
        profile_for(player_id, npc_id, create_default=False)
        saved = db.save_npc_profile(player_id, npc_id, body.model_dump())
        runtime = db.get_runtime_state(player_id, npc_id) or initial_runtime(db.state(player_id, npc_id).mood,
                                                                            db.state(player_id, npc_id).relationship)
        db.save_persona(player_id, npc_id, compile_persona(saved, runtime.get("growth")))
        existing_goal = db.get_goal(player_id, npc_id)
        if not existing_goal or existing_goal.get("title") != (saved.get("longTermGoal") or "Build a meaningful everyday life"):
            db.save_goal(player_id, npc_id, compile_goal(saved))
        return {"id": npc_id, "profile": saved}

    @app.get(settings.api_prefix + "/npcs/{npc_id}/agent")
    def npc_agent(npc_id: str, authorization: Optional[str] = Header(None)):
        user = current_user(authorization); player_id = user["player_id"]
        profile = profile_for(player_id, npc_id, create_default=False)
        bundle = agent_bundle(player_id, npc_id, profile, db.state(player_id, npc_id),
                              db.get_learning_state(player_id))
        edges = db.ensure_social_edges(player_id, [entry["id"] for entry in db.list_npc_profiles(player_id)])
        return {**bundle, "memories": db.list_npc_memories(player_id, npc_id, 50),
                "conversation_summaries": db.list_conversation_summaries(player_id, npc_id),
                "social_connections": [edge for edge in edges if edge["npc_a"] == npc_id],
                "social_interactions": db.list_social_events(player_id, npc_id=npc_id)}

    @app.get(settings.api_prefix + "/npcs/{npc_id}/memories")
    def npc_memories(npc_id: str, authorization: Optional[str] = Header(None)):
        user = current_user(authorization); profile_for(user["player_id"], npc_id, create_default=False)
        return {"memories": db.list_npc_memories(user["player_id"], npc_id, 100)}

    @app.delete(settings.api_prefix + "/npcs/{npc_id}/memories/{memory_id}", status_code=204)
    def delete_npc_memory(npc_id: str, memory_id: int, authorization: Optional[str] = Header(None)):
        user = current_user(authorization); profile_for(user["player_id"], npc_id, create_default=False)
        if not db.delete_npc_memory(user["player_id"], npc_id, memory_id):
            raise HTTPException(404, {"code": "MEMORY_NOT_FOUND", "message": "Memory was not found."})
        return Response(status_code=204)

    @app.get(settings.api_prefix + "/learning/profile")
    def learning_profile(authorization: Optional[str] = Header(None)):
        user = current_user(authorization)
        return learning_engine.progress(db.get_learning_state(user["player_id"]))

    def prepare_chat(body: ChatRequest, idempotency_key: str, authorization: str | None):
        user = current_user(authorization); player_id = user["player_id"]
        if not KEY_RE.fullmatch(idempotency_key):
            raise HTTPException(400, {"code": "INVALID_IDEMPOTENCY_KEY", "message": "Idempotency-Key is invalid."})
        cached = db.cached(player_id, idempotency_key)
        if cached:
            # Responses cached before animation-cue support remain replayable.
            cached["animation_cue"] = animation_cue(cached.get("animation_cue") or cached.get("animation"))
            cached_agent = cached.get("agent")
            if isinstance(cached_agent, dict):
                cached_agent.setdefault("animation_cue", cached["animation_cue"])
            cached_event = cached.get("active_event")
            if isinstance(cached_event, dict) and isinstance(cached_event.get("stage"), dict):
                cached_event["stage"].setdefault("animation_cue", cached["animation_cue"])
            return user, body.message.strip(), {**cached, "quota": db.quota(user["id"])}
        message = body.message.strip()
        if not message or len(message) > settings.max_message_characters or any(ord(c) < 32 and c not in "\n\t" for c in message):
            raise HTTPException(422, {"code": "INVALID_MESSAGE", "message": f"Message must contain 1-{settings.max_message_characters} valid characters."})
        denied = db.consume_chat(user["id"], idempotency_key, settings.chat_per_minute)
        if denied:
            raise HTTPException(429, {"code": denied, "message": "Chat limit reached. Please try again later."})
        return user, message, None

    def execute_chat(body: ChatRequest, idempotency_key: str, user: dict, message: str, on_chunk=None):
        player_id = user["player_id"]
        npc_id = body.npc_id
        profile = profile_for(player_id, npc_id)
        old = db.state(player_id, npc_id)
        learning_state = db.get_learning_state(player_id)
        agent = agent_bundle(player_id, npc_id, profile, old, learning_state)
        active = event_engine.daily_event(event_context(player_id, npc_id, profile, old, learning_state,
                                                        agent["runtime_state"]), game_today())
        memories = db.relevant_npc_memories(player_id, npc_id, message, limit=8,
                                            relationship_stage=agent["relationship"]["stage"])
        summaries = db.list_conversation_summaries(player_id, npc_id, limit=3)
        event_view = public_event(active, profile)
        context = {"npc_profile": profile, "current_event": event_view,
                   "learning_targets": learning_engine.targets(learning_state, limit=3),
                   "memories": memories, "conversation_summaries": summaries, **agent,
                   "dialogue_objective": dialogue_objective(event_view, agent["runtime_state"],
                                                             agent["goal"], agent["relationship"])}
        result = provider_reply(message, old, db.messages(player_id, settings.recent_message_limit, npc_id), context, on_chunk)
        evidence = [Evidence(**item.model_dump()) for item in result.learning_evidence]
        learning_engine.apply(learning_state, evidence)
        db.save_learning_state(player_id, learning_state)
        event_update = None
        event_rel = event_mood = 0
        event_cue = event_engine.stage(active).animation_cue if active else None
        outcome_cue = None
        if active:
            transition = event_engine.advance(active, result.semantic_signals)
            event_update = {"stage_changed": transition.stage_changed, "completed": transition.completed}
            if transition.completed and transition.outcome and transition.memory:
                event_rel, event_mood = transition.outcome.relationship_change, transition.outcome.mood_change
                outcome_cue = transition.outcome.animation_cue
                db.add_npc_memory(player_id, npc_id, "event", transition.memory.memory,
                                  transition.memory.template_id, importance=3,
                                  tags=["event", transition.memory.category], confidence=1)
                event_update.update({"outcome": {"id": transition.outcome.id,
                                                 "memory": transition.memory.memory,
                                                 "animation_cue": transition.outcome.animation_cue},
                                     "memory": transition.memory.memory})
            elif transition.stage_changed and transition.event:
                # The next story beat must remain visible even while the live
                # speech bubble persists. Templates contain situation content,
                # while names are adapted to the selected custom character.
                next_stage = event_engine.stage(transition.event)
                event_cue = next_stage.animation_cue
                result.npc_reply = f"{result.npc_reply}\n\n{next_stage.prompt.replace('Emma', profile['name'])}"
            active = transition.event
        if hasattr(provider, "translate"):
            try:
                result.npc_reply_zh = provider.translate(result.npc_reply)  # type: ignore[attr-defined]
            except Exception:
                result.npc_reply_zh = ""
        understandable = result.english_feedback.is_understandable
        rel = max(-10, min(10, max(-5, min(5, result.relationship_change)) + event_rel))
        if rel > 0:
            rel = min(rel, max(0, 10 - db.positive_relationship_change_today(
                player_id, npc_id, game_today().isoformat())))
        mood = max(-10, min(10, max(-5, min(5, result.mood_change)) + event_mood))
        final_animation_cue = resolve_turn_animation(
            result.animation_cue, mood, event_cue=event_cue, outcome_cue=outcome_cue,
        )
        if event_update is not None:
            event_update["animation_cue"] = final_animation_cue
        xp = max(0, min(5, result.english_xp_change)) if understandable else 0
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
        public_agent = {"runtime_state": runtime, "relationship": relationship, "goal": goal,
                        "daily_plan": agent["daily_plan"], "current_slot": agent["current_slot"],
                        "animation_cue": final_animation_cue}
        response = {**result.model_dump(), "npc_id": npc_id, "game_date": game_today().isoformat(),
                    "relationship_change": rel, "mood_change": mood,
                    "english_xp_change": xp, "stats": stats,
                    "animation": "happy" if mood > 0 else "sad" if mood < 0 else "idle",
                    "animation_cue": final_animation_cue,
                    "active_event": public_event(active, profile), "event_update": event_update,
                    "learning_summary": learning_engine.progress(learning_state), "agent": public_agent}
        committed, created = db.commit_chat(player_id, idempotency_key, message, response, npc_id)
        if created:
            db.save_relationship(player_id, npc_id, relationship)
            db.save_runtime_state(player_id, npc_id, runtime)
            db.save_goal(player_id, npc_id, goal)
            db.save_persona(player_id, npc_id, compile_persona(profile, runtime.get("growth")))
            summary_observations = []
            for candidate in result.memory_candidates:
                if candidate.confidence < .6:
                    continue
                expires_at = (datetime.now(timezone.utc) + timedelta(days=candidate.ttl_days)).isoformat() if candidate.ttl_days else None
                db.add_npc_memory(player_id, npc_id, candidate.kind, candidate.content,
                                  importance=candidate.importance, tags=candidate.tags,
                                  confidence=candidate.confidence, expires_at=expires_at,
                                  access_stage=candidate.access_stage)
                summary_observations.append(candidate.content)
            if event_update and event_update.get("memory"):
                summary_observations.append(event_update["memory"])
            db.append_conversation_summary(player_id, npc_id, game_today().isoformat(), summary_observations)
            trace = {**result.agent_trace, "memory_ids": [item["id"] for item in memories]}
            db.add_agent_trace(player_id, npc_id, idempotency_key, trace)
        return {**committed, "quota": db.quota(user["id"])}

    @app.post(settings.api_prefix + "/chat", response_model=ChatResponse)
    def chat(body: ChatRequest, idempotency_key: str = Header(...), authorization: Optional[str] = Header(None)):
        user, message, cached = prepare_chat(body, idempotency_key, authorization)
        return cached or execute_chat(body, idempotency_key, user, message)

    @app.post(settings.api_prefix + "/chat/stream")
    def chat_stream(body: ChatRequest, idempotency_key: str = Header(...), authorization: Optional[str] = Header(None)):
        user, message, cached = prepare_chat(body, idempotency_key, authorization)
        def encode(kind: str, value) -> str:
            return json.dumps({"type": kind, "data": value}, ensure_ascii=False, separators=(",", ":")) + "\n"
        if cached:
            return StreamingResponse(iter([encode("delta", cached["npc_reply"]), encode("final", cached)]), media_type="application/x-ndjson")
        def stream():
            events: queue.Queue = queue.Queue()
            def work():
                try:
                    result = execute_chat(body, idempotency_key, user, message, lambda chunk: events.put(("delta", chunk)))
                    events.put(("final", result))
                except Exception as exc:
                    events.put(("error", {"message": str(exc)}))
                finally:
                    events.put(("done", None))
            threading.Thread(target=work, daemon=True).start()
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

    @app.get(settings.api_prefix + "/admin/agent-traces")
    def admin_agent_traces(request: Request, limit: int = 100):
        require_admin(request)
        return {"traces": db.list_agent_traces(limit)}

    @app.patch(settings.api_prefix + "/admin/users/{user_id}")
    def admin_patch_user(user_id: str, body: AdminUserPatch, request: Request):
        require_admin(request); check_admin_origin(request)
        result = db.patch_user(user_id, body.disabled, body.quota_delta)
        if not result: raise HTTPException(404, {"code": "USER_NOT_FOUND", "message": "User was not found."})
        return result

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
