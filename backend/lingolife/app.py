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

from fastapi import FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .ai import DeepSeekProvider, DialogueProvider, ResilientProvider
from .config import Settings, load_settings
from .city import city_payload
from .db import Database
from .events import ActiveEvent, EventEngine, NPCEventContext
from .learning import Evidence, LearningEngine
from .models import (AdminLoginRequest, AdminUserPatch, ChatRequest, ChatResponse,
                     InviteCreateRequest, NpcProfile, RegisterRequest)

KEY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$")
USERNAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$")

DEFAULT_NPC_PROFILE = {
    "name": "Emma", "relationship": "Friend",
    "personality": ["kind", "thoughtful", "quiet"],
    "interests": ["art", "music", "photography"], "occupation": "Designer",
    "longTermGoal": "Open a small independent design studio.",
    "avatar": {"hair": "waves", "hairColor": "#4A3028", "face": "oval",
               "skin": "#E8B895", "eyes": "soft", "brows": "soft", "nose": "button",
               "mouth": "soft", "outfit": "sweater", "outfitColor": "#A86555",
               "accessory": "none", "strokes": []},
}


def create_app(settings: Settings | None = None, provider: DialogueProvider | None = None) -> FastAPI:
    settings = settings or load_settings()
    db = Database(settings.database_url)
    learning_engine = LearningEngine()
    event_engine = EventEngine(db)
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

    def event_context(player_id: str, npc_id: str, profile: dict, stats, learning_state) -> NPCEventContext:
        targets = learning_engine.targets(learning_state, limit=3)
        mood = "sad" if stats.mood < 35 else "happy" if stats.mood >= 65 else "neutral"
        goal = profile.get("longTermGoal", "")
        return NPCEventContext(
            player_id=player_id, npc_id=npc_id, traits=tuple(profile.get("personality", [])),
            interests=tuple(profile.get("interests", [])), occupation=profile.get("occupation", ""),
            mood=mood, relationship=stats.relationship,
            long_term_goals=(goal,) if goal else (),
            learning_targets=tuple(item["id"] for item in targets),
            needs=("connection",) if stats.relationship < 50 else ("growth",),
        )

    def public_event(active: ActiveEvent | None) -> dict | None:
        if not active:
            return None
        template = event_engine.by_id[active.template_id]
        stage = event_engine.stage(active)
        return {"id": template.id, "title": template.title, "category": template.category,
                "stage": {"id": stage.id, "prompt": stage.prompt, "objective": stage.objective},
                "stage_index": active.stage_index, "stage_count": len(template.stages),
                "learning_targets": list(template.learning_targets)}

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
            result = db.register(username, body.invite_code.strip())
        except ValueError:
            raise HTTPException(409, {"code": "USERNAME_TAKEN", "message": "Username is already taken."})
        if not result:
            raise HTTPException(400, {"code": "INVALID_INVITE", "message": "Invite code is invalid or already used."})
        user, token = result
        return {"session_token": token, "user": {"id": user["id"], "username": user["username"]}, "quota": db.quota(user["id"])}

    @app.get(settings.api_prefix + "/auth/me")
    def me(authorization: Optional[str] = Header(None)):
        user = current_user(authorization)
        return {"user": {"id": user["id"], "username": user["username"]}, "quota": db.quota(user["id"])}

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
        active = event_engine.daily_event(event_context(player_id, npc_id, profile, stats, learning_state))
        animation = "sad" if stats.mood < 40 else "happy" if stats.mood >= 60 else "idle"
        return {"room_id": f"{npc_id}-room", "npc": {"id": npc_id, "name": profile["name"], "animation": animation},
                "stats": stats, "messages": db.messages(player_id, settings.recent_message_limit, npc_id),
                "quota": db.quota(user["id"]), "active_event": public_event(active)}

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

    @app.get(settings.api_prefix + "/city")
    def city(authorization: Optional[str] = Header(None)):
        user = current_user(authorization); player_id = user["player_id"]
        profile_for(player_id)  # Materialize the default resident for older accounts.
        profiles = db.list_npc_profiles(player_id)
        learning_state = db.get_learning_state(player_id)
        active_events: dict[str, ActiveEvent | None] = {}
        summaries: dict[str, dict | None] = {}
        for entry in profiles:
            npc_id, profile = entry["id"], entry["profile"]
            stats = db.state(player_id, npc_id)
            active = event_engine.daily_event(event_context(player_id, npc_id, profile, stats, learning_state))
            active_events[npc_id] = active
            summaries[npc_id] = public_event(active)
        payload = city_payload(player_id, profiles, active_events)
        for resident in payload["npcs"]:
            resident["active_event"] = summaries[resident["id"]]
        return payload

    @app.post(settings.api_prefix + "/npcs", status_code=201)
    def create_npc(body: NpcProfile, authorization: Optional[str] = Header(None)):
        user = current_user(authorization); player_id = user["player_id"]
        profile_for(player_id)
        if len(db.list_npc_profiles(player_id)) >= 5:
            raise HTTPException(409, {"code": "NPC_LIMIT_REACHED", "message": "You can create up to five characters."})
        npc_id = "npc-" + uuid.uuid4().hex[:12]
        db.ensure_npc(player_id, npc_id, f"Hi, I'm {body.name}. What would you like to talk about?")
        db.save_npc_profile(player_id, npc_id, body.model_dump())
        return {"id": npc_id, "profile": body.model_dump()}

    @app.put(settings.api_prefix + "/npcs/{npc_id}")
    def update_npc(npc_id: str, body: NpcProfile, authorization: Optional[str] = Header(None)):
        user = current_user(authorization); player_id = user["player_id"]
        profile_for(player_id, npc_id, create_default=False)
        return {"id": npc_id, "profile": db.save_npc_profile(player_id, npc_id, body.model_dump())}

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
        active = event_engine.daily_event(event_context(player_id, npc_id, profile, old, learning_state))
        context = {"npc_profile": profile, "current_event": public_event(active),
                   "learning_targets": learning_engine.targets(learning_state, limit=3),
                   "memories": db.list_npc_memories(player_id, npc_id, limit=8)}
        result = provider_reply(message, old, db.messages(player_id, settings.recent_message_limit, npc_id), context, on_chunk)
        evidence = [Evidence(**item.model_dump()) for item in result.learning_evidence]
        learning_engine.apply(learning_state, evidence)
        db.save_learning_state(player_id, learning_state)
        event_update = None
        event_rel = event_mood = 0
        if active:
            transition = event_engine.advance(active, result.semantic_signals)
            event_update = {"stage_changed": transition.stage_changed, "completed": transition.completed}
            if transition.completed and transition.outcome and transition.memory:
                event_rel, event_mood = transition.outcome.relationship_change, transition.outcome.mood_change
                db.add_npc_memory(player_id, npc_id, "event", transition.memory.memory,
                                  transition.memory.template_id, importance=3)
                event_update.update({"outcome": {"id": transition.outcome.id,
                                                 "memory": transition.memory.memory},
                                     "memory": transition.memory.memory})
            elif transition.stage_changed and transition.event:
                next_stage = event_engine.stage(transition.event)
                result.npc_reply = f"{result.npc_reply}\n\n{next_stage.prompt}"
            active = transition.event
        understandable = result.english_feedback.is_understandable
        rel = max(-10, min(10, max(-5, min(5, result.relationship_change)) + event_rel))
        mood = max(-10, min(10, max(-5, min(5, result.mood_change)) + event_mood))
        xp = max(0, min(5, result.english_xp_change)) if understandable else 0
        stats = {"relationship": max(0, min(100, old.relationship + rel)), "mood": max(0, min(100, old.mood + mood)), "english_xp": max(0, min(100, old.english_xp + xp))}
        response = {**result.model_dump(), "relationship_change": rel, "mood_change": mood,
                    "english_xp_change": xp, "stats": stats,
                    "animation": "happy" if mood > 0 else "sad" if mood < 0 else "idle",
                    "active_event": public_event(active), "event_update": event_update,
                    "learning_summary": learning_engine.progress(learning_state)}
        committed = db.commit_chat(player_id, idempotency_key, message, response, npc_id)
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

    # Keep this catch-all mount after every API route so the web UI can never
    # shadow the JSON endpoints. Starlette's StaticFiles rejects paths that
    # escape this directory and serves index.html for the root request.
    web_root = Path(settings.web_root).resolve()
    if web_root.is_dir():
        app.mount("/", StaticFiles(directory=web_root, html=True), name="web")

    app.state.db = db
    return app


app = create_app()
