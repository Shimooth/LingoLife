from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import yaml


@dataclass(frozen=True)
class Settings:
    version: str = "0.1.0"
    api_prefix: str = "/api/v1"
    database_url: str = "sqlite:///./data/lingolife.db"
    max_message_characters: int = 500
    recent_message_limit: int = 10
    web_root: str = str(Path(__file__).resolve().parents[2] / "web" / "dist")
    deepseek_api_key: str | None = None
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-chat"
    deepseek_timeout: float = 25
    deepseek_max_tokens: int = 700
    deepseek_temperature: float = 0.7
    deepseek_retry_count: int = 1
    admin_password: str | None = None
    admin_session_secret: str | None = None
    admin_cookie_secure: bool = True
    admin_allowed_origin: str = "https://lingolife.admin.shimooth.me"
    default_daily_quota: int = 30
    chat_per_minute: int = 5


def load_settings(path: str | None = None) -> Settings:
    config_path = path or os.getenv("LINGOLIFE_CONFIG")
    raw: dict = {}
    if config_path and Path(config_path).is_file():
        raw = yaml.safe_load(Path(config_path).read_text(encoding="utf-8")) or {}
    app, demo, server, ai, database = (
        raw.get("app", {}), raw.get("demo", {}), raw.get("server", {}),
        raw.get("ai", {}), raw.get("database", {}),
    )
    database_url = os.getenv(database.get("url_env", "DATABASE_URL"), database.get("development_url", Settings.database_url))
    key = os.getenv(ai.get("api_key_env", "DEEPSEEK_API_KEY"))
    return Settings(
        version=str(app.get("version", Settings.version)),
        api_prefix=str(app.get("api_prefix", Settings.api_prefix)),
        database_url=database_url,
        max_message_characters=int(server.get("max_message_characters", Settings.max_message_characters)),
        recent_message_limit=int(demo.get("recent_message_limit", Settings.recent_message_limit)),
        web_root=os.getenv("LINGOLIFE_WEB_ROOT", str(server.get("web_root", Settings.web_root))),
        deepseek_api_key=key,
        deepseek_base_url=str(ai.get("base_url", Settings.deepseek_base_url)),
        deepseek_model=str(ai.get("model", Settings.deepseek_model)),
        deepseek_timeout=float(ai.get("timeout_seconds", Settings.deepseek_timeout)),
        deepseek_max_tokens=int(ai.get("max_tokens", Settings.deepseek_max_tokens)),
        deepseek_temperature=float(ai.get("temperature", Settings.deepseek_temperature)),
        deepseek_retry_count=int(ai.get("retry_count", Settings.deepseek_retry_count)),
        admin_password=os.getenv("ADMIN_PASSWORD"),
        admin_session_secret=os.getenv("SESSION_SECRET_KEY"),
        admin_cookie_secure=os.getenv("ADMIN_COOKIE_SECURE", "true").lower() not in {"0", "false", "no"},
        admin_allowed_origin=os.getenv("ADMIN_ALLOWED_ORIGIN", Settings.admin_allowed_origin),
        default_daily_quota=int(os.getenv("DEFAULT_DAILY_QUOTA", Settings.default_daily_quota)),
        chat_per_minute=int(os.getenv("CHAT_PER_MINUTE", Settings.chat_per_minute)),
    )
