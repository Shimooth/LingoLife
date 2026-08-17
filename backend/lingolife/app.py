from __future__ import annotations

import re
import base64
import hashlib
import hmac
import secrets
import threading
import time
from typing import Optional
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .ai import DeepSeekProvider, DialogueProvider, ResilientProvider
from .config import Settings, load_settings
from .db import Database
from .models import (AdminLoginRequest, AdminUserPatch, ChatRequest, ChatResponse,
                     InviteCreateRequest, RegisterRequest)

KEY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$")
USERNAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$")


def create_app(settings: Settings | None = None, provider: DialogueProvider | None = None) -> FastAPI:
    settings = settings or load_settings()
    db = Database(settings.database_url)
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
    def room(authorization: Optional[str] = Header(None)):
        user = current_user(authorization); player_id = user["player_id"]
        stats = db.state(player_id)
        animation = "sad" if stats.mood < 40 else "happy" if stats.mood >= 60 else "idle"
        return {"room_id": "emma-room", "npc": {"id": "emma", "name": "Emma", "animation": animation}, "stats": stats, "messages": db.messages(player_id, settings.recent_message_limit), "quota": db.quota(user["id"])}

    @app.post(settings.api_prefix + "/chat", response_model=ChatResponse)
    def chat(body: ChatRequest, idempotency_key: str = Header(...), authorization: Optional[str] = Header(None)):
        user = current_user(authorization); player_id = user["player_id"]
        if not KEY_RE.fullmatch(idempotency_key):
            raise HTTPException(400, {"code": "INVALID_IDEMPOTENCY_KEY", "message": "Idempotency-Key is invalid."})
        cached = db.cached(player_id, idempotency_key)
        if cached: return {**cached, "quota": db.quota(user["id"])}
        message = body.message.strip()
        if not message or len(message) > settings.max_message_characters or any(ord(c) < 32 and c not in "\n\t" for c in message):
            raise HTTPException(422, {"code": "INVALID_MESSAGE", "message": f"Message must contain 1-{settings.max_message_characters} valid characters."})
        denied = db.consume_chat(user["id"], idempotency_key, settings.chat_per_minute)
        if denied:
            status = 429
            raise HTTPException(status, {"code": denied, "message": "Chat limit reached. Please try again later."})
        old = db.state(player_id)
        result = provider.reply(message, old, db.messages(player_id, settings.recent_message_limit))
        understandable = result.english_feedback.is_understandable
        rel = max(-5, min(5, result.relationship_change))
        mood = max(-5, min(5, result.mood_change))
        xp = max(0, min(5, result.english_xp_change)) if understandable else 0
        stats = {"relationship": max(0, min(100, old.relationship + rel)), "mood": max(0, min(100, old.mood + mood)), "english_xp": max(0, min(100, old.english_xp + xp))}
        response = {**result.model_dump(), "relationship_change": rel, "mood_change": mood, "english_xp_change": xp, "stats": stats, "animation": "happy" if mood > 0 else "sad" if mood < 0 else "idle"}
        committed = db.commit_chat(player_id, idempotency_key, message, response)
        return {**committed, "quota": db.quota(user["id"])}

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
