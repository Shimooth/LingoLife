from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path

from .models import Stats


class Database:
    def __init__(self, url: str):
        if not url.startswith("sqlite:///"):
            raise ValueError("Demo supports sqlite:/// URLs only")
        self.path = url.removeprefix("sqlite:///")
        if self.path != ":memory:":
            Path(self.path).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)
        self._connection = sqlite3.connect(self.path, check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        self._init_schema()

    def _init_schema(self):
        with self._connection:
            self._connection.executescript("""
            CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS npc_states (
              player_id TEXT NOT NULL, npc_id TEXT NOT NULL, relationship INTEGER NOT NULL,
              mood INTEGER NOT NULL, english_xp INTEGER NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY(player_id, npc_id));
            CREATE TABLE IF NOT EXISTS messages (
              id INTEGER PRIMARY KEY AUTOINCREMENT, player_id TEXT NOT NULL,
              speaker TEXT NOT NULL CHECK(speaker IN ('player','npc')), text TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS chat_requests (
              idempotency_key TEXT NOT NULL, player_id TEXT NOT NULL, response_json TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(idempotency_key, player_id));
            """)

    def ensure_player(self, player_id: str):
        with self._lock, self._connection:
            self._connection.execute("INSERT OR IGNORE INTO players(id) VALUES (?)", (player_id,))
            cur = self._connection.execute(
                "INSERT OR IGNORE INTO npc_states(player_id,npc_id,relationship,mood,english_xp) VALUES (?,'emma',35,35,0)",
                (player_id,),
            )
            if cur.rowcount:
                self._connection.execute(
                    "INSERT INTO messages(player_id,speaker,text) VALUES (?,'npc',?)",
                    (player_id, "I had a terrible day at work..."),
                )

    def state(self, player_id: str) -> Stats:
        self.ensure_player(player_id)
        row = self._connection.execute("SELECT relationship,mood,english_xp FROM npc_states WHERE player_id=? AND npc_id='emma'", (player_id,)).fetchone()
        return Stats(**dict(row))

    def messages(self, player_id: str, limit: int) -> list[dict]:
        self.ensure_player(player_id)
        rows = self._connection.execute(
            "SELECT speaker,text FROM (SELECT id,speaker,text FROM messages WHERE player_id=? ORDER BY id DESC LIMIT ?) ORDER BY id",
            (player_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]

    def cached(self, player_id: str, key: str) -> dict | None:
        row = self._connection.execute("SELECT response_json FROM chat_requests WHERE player_id=? AND idempotency_key=?", (player_id, key)).fetchone()
        return json.loads(row[0]) if row else None

    def commit_chat(self, player_id: str, key: str, message: str, response: dict) -> dict:
        """Atomically stores state/messages/result; concurrent duplicates return the winner."""
        with self._lock, self._connection:
            cached = self.cached(player_id, key)
            if cached:
                return cached
            stats = response["stats"]
            self._connection.execute(
                "UPDATE npc_states SET relationship=?,mood=?,english_xp=?,updated_at=CURRENT_TIMESTAMP WHERE player_id=? AND npc_id='emma'",
                (stats["relationship"], stats["mood"], stats["english_xp"], player_id),
            )
            self._connection.execute("INSERT INTO messages(player_id,speaker,text) VALUES (?,'player',?)", (player_id, message))
            self._connection.execute("INSERT INTO messages(player_id,speaker,text) VALUES (?,'npc',?)", (player_id, response["npc_reply"]))
            self._connection.execute("INSERT INTO chat_requests(idempotency_key,player_id,response_json) VALUES (?,?,?)", (key, player_id, json.dumps(response)))
            return response
