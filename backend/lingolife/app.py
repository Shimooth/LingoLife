from __future__ import annotations

import re
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from .ai import DeepSeekProvider, DialogueProvider, ResilientProvider
from .config import Settings, load_settings
from .db import Database
from .models import ChatRequest, ChatResponse

PLAYER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
KEY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$")


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

    @app.exception_handler(HTTPException)
    async def http_error(_request: Request, exc: HTTPException):
        detail = exc.detail if isinstance(exc.detail, dict) else {"code": "REQUEST_ERROR", "message": str(exc.detail)}
        return JSONResponse(status_code=exc.status_code, content={"error": detail})

    def player(value: str) -> str:
        if not PLAYER_RE.fullmatch(value):
            raise HTTPException(400, {"code": "INVALID_PLAYER_ID", "message": "X-Player-Id is invalid."})
        return value

    @app.get(settings.api_prefix + "/health")
    def health(): return {"status": "ok", "version": settings.version}

    @app.get(settings.api_prefix + "/room")
    def room(x_player_id: str = Header(...)):
        player_id = player(x_player_id)
        stats = db.state(player_id)
        animation = "sad" if stats.mood < 40 else "happy" if stats.mood >= 60 else "idle"
        return {"room_id": "emma-room", "npc": {"id": "emma", "name": "Emma", "animation": animation}, "stats": stats, "messages": db.messages(player_id, settings.recent_message_limit)}

    @app.post(settings.api_prefix + "/chat", response_model=ChatResponse)
    def chat(body: ChatRequest, x_player_id: str = Header(...), idempotency_key: str = Header(...)):
        player_id = player(x_player_id)
        if not KEY_RE.fullmatch(idempotency_key):
            raise HTTPException(400, {"code": "INVALID_IDEMPOTENCY_KEY", "message": "Idempotency-Key is invalid."})
        cached = db.cached(player_id, idempotency_key)
        if cached: return cached
        message = body.message.strip()
        if not message or len(message) > settings.max_message_characters or any(ord(c) < 32 and c not in "\n\t" for c in message):
            raise HTTPException(422, {"code": "INVALID_MESSAGE", "message": f"Message must contain 1-{settings.max_message_characters} valid characters."})
        old = db.state(player_id)
        result = provider.reply(message, old, db.messages(player_id, settings.recent_message_limit))
        understandable = result.english_feedback.is_understandable
        rel = max(-5, min(5, result.relationship_change))
        mood = max(-5, min(5, result.mood_change))
        xp = max(0, min(5, result.english_xp_change)) if understandable else 0
        stats = {"relationship": max(0, min(100, old.relationship + rel)), "mood": max(0, min(100, old.mood + mood)), "english_xp": max(0, min(100, old.english_xp + xp))}
        response = {**result.model_dump(), "relationship_change": rel, "mood_change": mood, "english_xp_change": xp, "stats": stats, "animation": "happy" if mood > 0 else "sad" if mood < 0 else "idle"}
        return db.commit_chat(player_id, idempotency_key, message, response)

    app.state.db = db
    return app


app = create_app()
