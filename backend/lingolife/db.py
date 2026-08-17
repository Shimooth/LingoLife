from __future__ import annotations

import json
import sqlite3
import threading
import hashlib
import secrets
import uuid
from pathlib import Path

from .events import ActiveEvent, EventHistory, event_to_dict
from .learning import LearningState
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
            CREATE TABLE IF NOT EXISTS users (
              id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE,
              player_id TEXT NOT NULL UNIQUE, disabled INTEGER NOT NULL DEFAULT 0,
              daily_quota INTEGER NOT NULL DEFAULT 30, bonus_credits INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_active_at TEXT);
            CREATE TABLE IF NOT EXISTS invitations (
              code_hash TEXT PRIMARY KEY, daily_quota INTEGER NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, used_at TEXT, used_by TEXT);
            CREATE TABLE IF NOT EXISTS sessions (
              token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              revoked_at TEXT);
            CREATE TABLE IF NOT EXISTS usage_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, request_id TEXT,
              event_type TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE INDEX IF NOT EXISTS idx_usage_user_time ON usage_events(user_id, created_at);
            CREATE TABLE IF NOT EXISTS npc_profiles (
              player_id TEXT NOT NULL, npc_id TEXT NOT NULL, profile_json TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY(player_id, npc_id));
            CREATE TABLE IF NOT EXISTS npc_memories (
              id INTEGER PRIMARY KEY AUTOINCREMENT, player_id TEXT NOT NULL, npc_id TEXT NOT NULL,
              kind TEXT NOT NULL, content TEXT NOT NULL, source_event_id TEXT,
              importance INTEGER NOT NULL DEFAULT 1 CHECK(importance BETWEEN 1 AND 5),
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE INDEX IF NOT EXISTS idx_npc_memories_owner
              ON npc_memories(player_id, npc_id, importance DESC, id DESC);
            CREATE TABLE IF NOT EXISTS active_events (
              player_id TEXT NOT NULL, npc_id TEXT NOT NULL, event_json TEXT NOT NULL,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY(player_id, npc_id));
            CREATE TABLE IF NOT EXISTS event_history (
              id INTEGER PRIMARY KEY AUTOINCREMENT, player_id TEXT NOT NULL, npc_id TEXT NOT NULL,
              template_id TEXT NOT NULL, category TEXT NOT NULL, started_on TEXT NOT NULL,
              completed_at TEXT NOT NULL, outcome_id TEXT NOT NULL,
              relationship_change INTEGER NOT NULL, mood_change INTEGER NOT NULL,
              memory TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS idx_event_history_owner
              ON event_history(player_id, npc_id, id DESC);
            CREATE TABLE IF NOT EXISTS learning_states (
              player_id TEXT PRIMARY KEY, state_json TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            """)

    @staticmethod
    def token_hash(value: str) -> str:
        return hashlib.sha256(value.encode()).hexdigest()

    def create_invites(self, count: int, daily_quota: int) -> list[str]:
        codes = []
        with self._lock, self._connection:
            for _ in range(count):
                code = "LL-" + secrets.token_urlsafe(12).replace("_", "").replace("-", "")
                self._connection.execute("INSERT INTO invitations(code_hash,daily_quota) VALUES (?,?)", (self.token_hash(code), daily_quota))
                codes.append(code)
        return codes

    def register(self, username: str, invite_code: str) -> tuple[dict, str] | None:
        token = secrets.token_urlsafe(32)
        user_id, player_id = str(uuid.uuid4()), str(uuid.uuid4())
        try:
            with self._lock, self._connection:
                invite = self._connection.execute(
                    "SELECT daily_quota FROM invitations WHERE code_hash=? AND used_at IS NULL", (self.token_hash(invite_code),)
                ).fetchone()
                if not invite:
                    return None
                self.ensure_player(player_id)
                self._connection.execute(
                    "INSERT INTO users(id,username,player_id,daily_quota,last_active_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)",
                    (user_id, username, player_id, invite[0]),
                )
                self._connection.execute("UPDATE invitations SET used_at=CURRENT_TIMESTAMP,used_by=? WHERE code_hash=?", (user_id, self.token_hash(invite_code)))
                self._connection.execute("INSERT INTO sessions(token_hash,user_id) VALUES (?,?)", (self.token_hash(token), user_id))
            return self.user_by_id(user_id), token
        except sqlite3.IntegrityError as exc:
            if "username" in str(exc).lower():
                raise ValueError("USERNAME_TAKEN") from exc
            raise

    def authenticate(self, token: str) -> dict | None:
        row = self._connection.execute(
            "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.revoked_at IS NULL",
            (self.token_hash(token),),
        ).fetchone()
        if not row:
            return None
        user = dict(row)
        if user["disabled"]:
            return {**user, "disabled": True}
        with self._lock, self._connection:
            self._connection.execute("UPDATE sessions SET last_used_at=CURRENT_TIMESTAMP WHERE token_hash=?", (self.token_hash(token),))
            self._connection.execute("UPDATE users SET last_active_at=CURRENT_TIMESTAMP WHERE id=?", (user["id"],))
        return user

    def revoke_session(self, token: str):
        with self._connection:
            self._connection.execute("UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=?", (self.token_hash(token),))

    def user_by_id(self, user_id: str) -> dict:
        return dict(self._connection.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone())

    def quota(self, user_id: str) -> dict:
        u = self.user_by_id(user_id)
        used = self._connection.execute(
            "SELECT count(*) FROM usage_events WHERE user_id=? AND event_type='chat' AND date(created_at)=date('now')", (user_id,)
        ).fetchone()[0]
        daily_remaining = max(0, u["daily_quota"] - used)
        return {"daily_limit": u["daily_quota"], "used_today": used,
                "bonus_credits": u["bonus_credits"], "remaining": daily_remaining + u["bonus_credits"]}

    def consume_chat(self, user_id: str, request_id: str, per_minute: int) -> str | None:
        """Atomically reserves quota. Returns DAILY_QUOTA or RATE_LIMIT, else None."""
        with self._lock, self._connection:
            # Idempotent retries never reserve twice.
            if self._connection.execute("SELECT 1 FROM usage_events WHERE user_id=? AND request_id=? AND event_type='chat'", (user_id, request_id)).fetchone():
                return None
            q = self.quota(user_id)
            if q["remaining"] <= 0:
                return "DAILY_QUOTA_EXCEEDED"
            minute = self._connection.execute(
                "SELECT count(*) FROM usage_events WHERE user_id=? AND event_type='chat' AND created_at >= datetime('now','-1 minute')", (user_id,)
            ).fetchone()[0]
            if minute >= per_minute:
                return "RATE_LIMITED"
            # Once today's allowance is exhausted, consume persistent gifted credits.
            if q["used_today"] >= q["daily_limit"]:
                self._connection.execute("UPDATE users SET bonus_credits=bonus_credits-1 WHERE id=?", (user_id,))
            self._connection.execute("INSERT INTO usage_events(user_id,request_id,event_type) VALUES (?,?,'chat')", (user_id, request_id))
            return None

    def summary(self) -> dict:
        row = self._connection.execute("SELECT count(*),sum(disabled),sum(date(last_active_at)=date('now')) FROM users").fetchone()
        chats = self._connection.execute("SELECT count(*) FROM usage_events WHERE event_type='chat' AND date(created_at)=date('now')").fetchone()[0]
        return {"total_users": row[0], "disabled_users": row[1] or 0, "active_today": row[2] or 0, "chats_today": chats}

    def users(self, query: str = "") -> list[dict]:
        rows = self._connection.execute(
            "SELECT id,username,disabled,daily_quota,bonus_credits,created_at,last_active_at FROM users WHERE username LIKE ? ORDER BY created_at DESC LIMIT 200",
            (f"%{query}%",),
        ).fetchall()
        return [{**dict(r), "quota": self.quota(r["id"])} for r in rows]

    def patch_user(self, user_id: str, disabled: bool | None, quota_delta: int | None) -> dict | None:
        with self._lock, self._connection:
            if disabled is not None:
                self._connection.execute("UPDATE users SET disabled=? WHERE id=?", (int(disabled), user_id))
            if quota_delta is not None:
                self._connection.execute("UPDATE users SET bonus_credits=max(0,bonus_credits+?) WHERE id=?", (quota_delta, user_id))
            if not self._connection.execute("SELECT 1 FROM users WHERE id=?", (user_id,)).fetchone():
                return None
        return {**self.user_by_id(user_id), "quota": self.quota(user_id)}

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

    # NPC Agent persistence -------------------------------------------------

    @staticmethod
    def _json(value: dict) -> str:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)

    def get_npc_profile(self, player_id: str, npc_id: str) -> dict | None:
        row = self._connection.execute(
            "SELECT profile_json FROM npc_profiles WHERE player_id=? AND npc_id=?", (player_id, npc_id)
        ).fetchone()
        return json.loads(row[0]) if row else None

    def get_or_create_npc_profile(self, player_id: str, npc_id: str, default_profile: dict) -> dict:
        """Persist the caller-owned default once; never silently replace customization."""
        with self._lock, self._connection:
            self.ensure_player(player_id)
            self._connection.execute(
                "INSERT OR IGNORE INTO npc_profiles(player_id,npc_id,profile_json) VALUES (?,?,?)",
                (player_id, npc_id, self._json(default_profile)),
            )
            return self.get_npc_profile(player_id, npc_id)  # type: ignore[return-value]

    def save_npc_profile(self, player_id: str, npc_id: str, profile: dict) -> dict:
        with self._lock, self._connection:
            self.ensure_player(player_id)
            self._connection.execute(
                """INSERT INTO npc_profiles(player_id,npc_id,profile_json) VALUES (?,?,?)
                   ON CONFLICT(player_id,npc_id) DO UPDATE SET
                     profile_json=excluded.profile_json,updated_at=CURRENT_TIMESTAMP""",
                (player_id, npc_id, self._json(profile)),
            )
        return profile

    def add_npc_memory(self, player_id: str, npc_id: str, kind: str, content: str,
                       source_event_id: str | None = None, importance: int = 1) -> dict:
        importance = max(1, min(5, int(importance)))
        with self._lock, self._connection:
            cursor = self._connection.execute(
                """INSERT INTO npc_memories(player_id,npc_id,kind,content,source_event_id,importance)
                   VALUES (?,?,?,?,?,?)""",
                (player_id, npc_id, kind, content, source_event_id, importance),
            )
            row = self._connection.execute("SELECT * FROM npc_memories WHERE id=?", (cursor.lastrowid,)).fetchone()
        return dict(row)

    def list_npc_memories(self, player_id: str, npc_id: str, limit: int = 20,
                          kind: str | None = None) -> list[dict]:
        limit = max(0, min(200, int(limit)))
        if kind is None:
            rows = self._connection.execute(
                """SELECT * FROM npc_memories WHERE player_id=? AND npc_id=?
                   ORDER BY importance DESC,id DESC LIMIT ?""", (player_id, npc_id, limit)
            ).fetchall()
        else:
            rows = self._connection.execute(
                """SELECT * FROM npc_memories WHERE player_id=? AND npc_id=? AND kind=?
                   ORDER BY importance DESC,id DESC LIMIT ?""", (player_id, npc_id, kind, limit)
            ).fetchall()
        return [dict(row) for row in rows]

    def delete_npc_memory(self, player_id: str, npc_id: str, memory_id: int) -> bool:
        with self._lock, self._connection:
            cursor = self._connection.execute(
                "DELETE FROM npc_memories WHERE id=? AND player_id=? AND npc_id=?",
                (memory_id, player_id, npc_id),
            )
        return cursor.rowcount > 0

    # EventRepository implementation ---------------------------------------

    def get_active_event(self, player_id: str, npc_id: str) -> ActiveEvent | None:
        row = self._connection.execute(
            "SELECT event_json FROM active_events WHERE player_id=? AND npc_id=?", (player_id, npc_id)
        ).fetchone()
        return ActiveEvent(**json.loads(row[0])) if row else None

    def save_active_event(self, event: ActiveEvent) -> None:
        with self._lock, self._connection:
            self._connection.execute(
                """INSERT INTO active_events(player_id,npc_id,event_json) VALUES (?,?,?)
                   ON CONFLICT(player_id,npc_id) DO UPDATE SET
                     event_json=excluded.event_json,updated_at=CURRENT_TIMESTAMP""",
                (event.player_id, event.npc_id, self._json(event_to_dict(event))),
            )

    def clear_active_event(self, player_id: str, npc_id: str) -> None:
        with self._lock, self._connection:
            self._connection.execute(
                "DELETE FROM active_events WHERE player_id=? AND npc_id=?", (player_id, npc_id)
            )

    def list_event_history(self, player_id: str, npc_id: str, limit: int = 50) -> list[EventHistory]:
        rows = self._connection.execute(
            """SELECT player_id,npc_id,template_id,category,started_on,completed_at,outcome_id,
                      relationship_change,mood_change,memory
               FROM event_history WHERE player_id=? AND npc_id=? ORDER BY id DESC LIMIT ?""",
            (player_id, npc_id, max(0, min(500, int(limit)))),
        ).fetchall()
        return [EventHistory(**dict(row)) for row in rows]

    def append_event_history(self, history: EventHistory) -> None:
        with self._lock, self._connection:
            self._insert_event_history(history)

    def _insert_event_history(self, history: EventHistory) -> None:
        self._connection.execute(
            """INSERT INTO event_history(
                 player_id,npc_id,template_id,category,started_on,completed_at,outcome_id,
                 relationship_change,mood_change,memory) VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (history.player_id, history.npc_id, history.template_id, history.category,
             history.started_on, history.completed_at, history.outcome_id,
             history.relationship_change, history.mood_change, history.memory),
        )

    def complete_event(self, history: EventHistory) -> None:
        """Preferred integration path: history append and active removal are atomic."""
        with self._lock, self._connection:
            self._insert_event_history(history)
            self._connection.execute(
                "DELETE FROM active_events WHERE player_id=? AND npc_id=?",
                (history.player_id, history.npc_id),
            )

    # Learning persistence -------------------------------------------------

    def get_learning_state(self, player_id: str) -> LearningState:
        row = self._connection.execute(
            "SELECT state_json FROM learning_states WHERE player_id=?", (player_id,)
        ).fetchone()
        return LearningState.from_dict(json.loads(row[0])) if row else LearningState()

    def save_learning_state(self, player_id: str, state: LearningState) -> LearningState:
        with self._lock, self._connection:
            self.ensure_player(player_id)
            self._connection.execute(
                """INSERT INTO learning_states(player_id,state_json) VALUES (?,?)
                   ON CONFLICT(player_id) DO UPDATE SET
                     state_json=excluded.state_json,updated_at=CURRENT_TIMESTAMP""",
                (player_id, self._json(state.to_dict())),
            )
        return state
