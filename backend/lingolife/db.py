from __future__ import annotations

import json
import sqlite3
import threading
import hashlib
import secrets
import uuid
import base64
from pathlib import Path
from cryptography.fernet import Fernet, InvalidToken

from .events import ActiveEvent, EventHistory, event_to_dict
from .learning import LearningState
from .models import Stats
from .social import social_animation_cues, social_status


class Database:
    def __init__(self, url: str, invite_secret: str | None = None):
        if not url.startswith("sqlite:///"):
            raise ValueError("Demo supports sqlite:/// URLs only")
        self.path = url.removeprefix("sqlite:///")
        if self.path != ":memory:":
            Path(self.path).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)
        self._connection = sqlite3.connect(self.path, check_same_thread=False, timeout=30)
        self._connection.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        self._connection.execute("PRAGMA busy_timeout=30000")
        if self.path != ":memory:":
            self._connection.execute("PRAGMA journal_mode=WAL")
        self._invite_cipher = Fernet(base64.urlsafe_b64encode(hashlib.sha256(invite_secret.encode()).digest())) if invite_secret else None
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
              npc_id TEXT NOT NULL DEFAULT 'emma', translation TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS chat_requests (
              idempotency_key TEXT NOT NULL, player_id TEXT NOT NULL, response_json TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(idempotency_key, player_id));
            CREATE TABLE IF NOT EXISTS users (
              id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE,
              player_id TEXT NOT NULL UNIQUE, password_hash TEXT,
              disabled INTEGER NOT NULL DEFAULT 0,
              daily_quota INTEGER NOT NULL DEFAULT 30, bonus_credits INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_active_at TEXT);
            CREATE TABLE IF NOT EXISTS invitations (
              code_hash TEXT PRIMARY KEY, daily_quota INTEGER NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, used_at TEXT, used_by TEXT,
              code_value TEXT);
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
            CREATE TABLE IF NOT EXISTS npc_personas (
              player_id TEXT NOT NULL,npc_id TEXT NOT NULL,persona_json TEXT NOT NULL,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(player_id,npc_id));
            CREATE TABLE IF NOT EXISTS npc_runtime_states (
              player_id TEXT NOT NULL,npc_id TEXT NOT NULL,state_json TEXT NOT NULL,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(player_id,npc_id));
            CREATE TABLE IF NOT EXISTS npc_relationships (
              player_id TEXT NOT NULL,npc_id TEXT NOT NULL,relationship_json TEXT NOT NULL,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(player_id,npc_id));
            CREATE TABLE IF NOT EXISTS npc_goals (
              player_id TEXT NOT NULL,npc_id TEXT NOT NULL,goal_json TEXT NOT NULL,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(player_id,npc_id));
            CREATE TABLE IF NOT EXISTS npc_daily_plans (
              player_id TEXT NOT NULL,npc_id TEXT NOT NULL,game_date TEXT NOT NULL,plan_json TEXT NOT NULL,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(player_id,npc_id,game_date));
            CREATE TABLE IF NOT EXISTS npc_social_edges (
              player_id TEXT NOT NULL,npc_a TEXT NOT NULL,npc_b TEXT NOT NULL,
              familiarity INTEGER NOT NULL DEFAULT 15,trust INTEGER NOT NULL DEFAULT 50,
              affinity INTEGER NOT NULL DEFAULT 50,tension INTEGER NOT NULL DEFAULT 5,
              status TEXT NOT NULL DEFAULT 'stranger',updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY(player_id,npc_a,npc_b));
            CREATE TABLE IF NOT EXISTS npc_social_events (
              id TEXT PRIMARY KEY,player_id TEXT NOT NULL,game_date TEXT NOT NULL,event_key TEXT NOT NULL,
              event_json TEXT NOT NULL,status TEXT NOT NULL,resolution_action TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(player_id,game_date,event_key));
            CREATE INDEX IF NOT EXISTS idx_social_events_day
              ON npc_social_events(player_id,game_date,created_at);
            CREATE TABLE IF NOT EXISTS agent_turn_traces (
              id INTEGER PRIMARY KEY AUTOINCREMENT,player_id TEXT NOT NULL,npc_id TEXT NOT NULL,
              request_id TEXT NOT NULL,prompt_version TEXT NOT NULL,persona_version TEXT,
              memory_ids_json TEXT NOT NULL DEFAULT '[]',model TEXT,fallback_used INTEGER NOT NULL DEFAULT 0,
              dialogue_ms INTEGER NOT NULL DEFAULT 0,analysis_ms INTEGER NOT NULL DEFAULT 0,
              error_type TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE INDEX IF NOT EXISTS idx_agent_trace_owner ON agent_turn_traces(player_id,npc_id,id DESC);
            CREATE TABLE IF NOT EXISTS conversation_summaries (
              player_id TEXT NOT NULL,npc_id TEXT NOT NULL,game_date TEXT NOT NULL,summary TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(player_id,npc_id,game_date));
            """)
            columns = {row[1] for row in self._connection.execute("PRAGMA table_info(messages)")}
            if "npc_id" not in columns:
                self._connection.execute("ALTER TABLE messages ADD COLUMN npc_id TEXT NOT NULL DEFAULT 'emma'")
            if "translation" not in columns:
                self._connection.execute("ALTER TABLE messages ADD COLUMN translation TEXT")
            self._connection.execute(
                "UPDATE messages SET translation='我今天工作过得糟透了……' "
                "WHERE speaker='npc' AND text='I had a terrible day at work...' "
                "AND (translation IS NULL OR trim(translation)='')"
            )
            self._connection.execute(
                "UPDATE messages SET translation='很高兴见到你。你今天过得怎么样？' "
                "WHERE speaker='npc' AND text='It is good to see you. How was your day?' "
                "AND (translation IS NULL OR trim(translation)='')"
            )
            self._connection.execute(
                "UPDATE messages SET translation=replace(replace(text, 'Hi, I''m ', '嗨，我是'), "
                "'. What would you like to talk about?', '。你想聊些什么？') "
                "WHERE speaker='npc' AND text LIKE 'Hi, I''m %. What would you like to talk about?' "
                "AND (translation IS NULL OR trim(translation)='')"
            )
            user_columns = {row[1] for row in self._connection.execute("PRAGMA table_info(users)")}
            if "password_hash" not in user_columns:
                self._connection.execute("ALTER TABLE users ADD COLUMN password_hash TEXT")
            invitation_columns = {row[1] for row in self._connection.execute("PRAGMA table_info(invitations)")}
            if "code_value" not in invitation_columns:
                self._connection.execute("ALTER TABLE invitations ADD COLUMN code_value TEXT")
            memory_columns = {row[1] for row in self._connection.execute("PRAGMA table_info(npc_memories)")}
            for column, definition in (
                ("tags_json", "TEXT NOT NULL DEFAULT '[]'"),
                ("confidence", "REAL NOT NULL DEFAULT 1"),
                ("expires_at", "TEXT"),
                ("last_accessed_at", "TEXT"),
                ("access_stage", "TEXT NOT NULL DEFAULT 'stranger'"),
            ):
                if column not in memory_columns:
                    self._connection.execute(f"ALTER TABLE npc_memories ADD COLUMN {column} {definition}")
            edge_columns = {row[1] for row in self._connection.execute("PRAGMA table_info(npc_social_edges)")}
            for column, definition in (
                ("familiarity", "INTEGER NOT NULL DEFAULT 15"),
                ("trust", "INTEGER NOT NULL DEFAULT 50"),
                ("tension", "INTEGER NOT NULL DEFAULT 5"),
            ):
                if column not in edge_columns:
                    self._connection.execute(f"ALTER TABLE npc_social_edges ADD COLUMN {column} {definition}")
            self._connection.execute(
                """UPDATE npc_social_edges SET status=CASE
                   WHEN tension>=60 THEN 'strained'
                   WHEN trust>=72 AND affinity>=72 AND familiarity>=70 THEN 'close_friend'
                   WHEN trust>=58 AND affinity>=58 AND familiarity>=45 THEN 'friend'
                   WHEN familiarity>=25 THEN 'acquaintance' ELSE 'stranger' END"""
            )
            try:
                self._connection.execute(
                    "CREATE VIRTUAL TABLE IF NOT EXISTS npc_memory_fts USING fts5(content,player_id UNINDEXED,npc_id UNINDEXED,memory_id UNINDEXED)"
                )
                self._connection.execute(
                    """INSERT INTO npc_memory_fts(content,player_id,npc_id,memory_id)
                       SELECT m.content,m.player_id,m.npc_id,m.id FROM npc_memories m
                       WHERE NOT EXISTS(SELECT 1 FROM npc_memory_fts f WHERE f.memory_id=CAST(m.id AS TEXT))"""
                )
            except sqlite3.OperationalError:
                pass  # Minimal SQLite builds can still use weighted recency retrieval.

    @staticmethod
    def token_hash(value: str) -> str:
        return hashlib.sha256(value.encode()).hexdigest()

    @staticmethod
    def password_hash(password: str) -> str:
        salt = secrets.token_bytes(16)
        iterations = 600_000
        derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations, dklen=32)
        encoded = lambda value: base64.urlsafe_b64encode(value).decode().rstrip("=")
        return f"pbkdf2_sha256${iterations}${encoded(salt)}${encoded(derived)}"

    @staticmethod
    def verify_password(password: str, stored: str | None) -> bool:
        if not stored:
            # Keep unknown/unmigrated account checks deliberately expensive.
            hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), b"LingoLife-dummy!", 600_000, dklen=32)
            return False
        try:
            algorithm, iterations, salt_text, digest_text = stored.split("$", 3)
            if algorithm != "pbkdf2_sha256": return False
            decode = lambda value: base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
            actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), decode(salt_text), int(iterations), dklen=32)
            return secrets.compare_digest(actual, decode(digest_text))
        except (ValueError, TypeError):
            return False

    def create_session(self, user_id: str) -> str:
        token = secrets.token_urlsafe(32)
        with self._lock, self._connection:
            self._connection.execute("INSERT INTO sessions(token_hash,user_id) VALUES (?,?)", (self.token_hash(token), user_id))
        return token

    def create_invites(self, count: int, daily_quota: int) -> list[str]:
        codes = []
        with self._lock, self._connection:
            for _ in range(count):
                code = "LL-" + secrets.token_urlsafe(12).replace("_", "").replace("-", "")
                encrypted = self._invite_cipher.encrypt(code.encode()).decode() if self._invite_cipher else None
                self._connection.execute("INSERT INTO invitations(code_hash,daily_quota,code_value) VALUES (?,?,?)", (self.token_hash(code), daily_quota, encrypted))
                codes.append(code)
        return codes

    def unused_invites(self) -> list[dict]:
        rows = self._connection.execute(
            "SELECT code_value,daily_quota,created_at FROM invitations WHERE used_at IS NULL AND code_value IS NOT NULL ORDER BY created_at DESC"
        ).fetchall()
        if not self._invite_cipher:
            return []
        result = []
        for row in rows:
            try:
                code = self._invite_cipher.decrypt(row["code_value"].encode()).decode()
            except (InvalidToken, ValueError):
                continue
            result.append({"code": code, "daily_quota": row["daily_quota"], "created_at": row["created_at"]})
        return result

    def register(self, username: str, invite_code: str, password: str) -> tuple[dict, str] | None:
        token = secrets.token_urlsafe(32)
        user_id, player_id = str(uuid.uuid4()), str(uuid.uuid4())
        if not self._connection.execute(
            "SELECT 1 FROM invitations WHERE code_hash=? AND used_at IS NULL", (self.token_hash(invite_code),)
        ).fetchone():
            return None
        password_hash = self.password_hash(password)
        try:
            with self._lock, self._connection:
                invite = self._connection.execute(
                    "SELECT daily_quota FROM invitations WHERE code_hash=? AND used_at IS NULL", (self.token_hash(invite_code),)
                ).fetchone()
                if not invite:
                    return None
                self.ensure_player(player_id)
                self._connection.execute(
                    "INSERT INTO users(id,username,player_id,daily_quota,last_active_at,password_hash) VALUES (?,?,?,?,CURRENT_TIMESTAMP,?)",
                    (user_id, username, player_id, invite[0], password_hash),
                )
                self._connection.execute("UPDATE invitations SET used_at=CURRENT_TIMESTAMP,used_by=? WHERE code_hash=?", (user_id, self.token_hash(invite_code)))
                self._connection.execute("INSERT INTO sessions(token_hash,user_id) VALUES (?,?)", (self.token_hash(token), user_id))
            return self.user_by_id(user_id), token
        except sqlite3.IntegrityError as exc:
            if "username" in str(exc).lower():
                raise ValueError("USERNAME_TAKEN") from exc
            raise

    def login(self, username: str, password: str) -> tuple[dict, str] | None:
        row = self._connection.execute("SELECT * FROM users WHERE username=? COLLATE NOCASE", (username,)).fetchone()
        user = dict(row) if row else None
        if not self.verify_password(password, user.get("password_hash") if user else None):
            return None
        if user["disabled"]:
            return user, ""
        return user, self.create_session(user["id"])

    def set_password(self, user_id: str, new_password: str, current_password: str | None,
                     current_token: str) -> bool:
        user = self.user_by_id(user_id)
        existing = user.get("password_hash")
        if existing and (current_password is None or not self.verify_password(current_password, existing)):
            return False
        replacement = self.password_hash(new_password)
        with self._lock, self._connection:
            self._connection.execute("UPDATE users SET password_hash=? WHERE id=?", (replacement, user_id))
            self._connection.execute("UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=? AND token_hash<>? AND revoked_at IS NULL",
                                     (user_id, self.token_hash(current_token)))
        return True

    def authenticate(self, token: str) -> dict | None:
        with self._lock, self._connection:
            row = self._connection.execute(
                "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.revoked_at IS NULL",
                (self.token_hash(token),),
            ).fetchone()
            if not row:
                return None
            user = dict(row)
            if user["disabled"]:
                return {**user, "disabled": True}
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
                    "INSERT INTO messages(player_id,speaker,text,npc_id,translation) VALUES (?,'npc',?,'emma',?)",
                    (player_id, "I had a terrible day at work...", "我今天工作过得糟透了……"),
                )

    def ensure_npc(self, player_id: str, npc_id: str, greeting: str = "It is good to see you. How was your day?",
                   greeting_translation: str = "很高兴见到你。你今天过得怎么样？"):
        self.ensure_player(player_id)
        with self._lock, self._connection:
            cur = self._connection.execute(
                "INSERT OR IGNORE INTO npc_states(player_id,npc_id,relationship,mood,english_xp) VALUES (?,?,35,50,0)",
                (player_id, npc_id),
            )
            if cur.rowcount:
                self._connection.execute(
                    "INSERT INTO messages(player_id,speaker,text,npc_id,translation) VALUES (?,'npc',?,?,?)",
                    (player_id, greeting, npc_id, greeting_translation),
                )

    def state(self, player_id: str, npc_id: str = "emma") -> Stats:
        self.ensure_player(player_id)
        self.ensure_npc(player_id, npc_id)
        row = self._connection.execute("SELECT relationship,mood,english_xp FROM npc_states WHERE player_id=? AND npc_id=?", (player_id, npc_id)).fetchone()
        return Stats(**dict(row))

    def messages(self, player_id: str, limit: int, npc_id: str = "emma") -> list[dict]:
        self.ensure_player(player_id)
        rows = self._connection.execute(
            "SELECT speaker,text,translation,created_at FROM (SELECT id,speaker,text,translation,created_at FROM messages WHERE player_id=? AND npc_id=? ORDER BY id DESC LIMIT ?) ORDER BY id",
            (player_id, npc_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]

    def cached(self, player_id: str, key: str) -> dict | None:
        row = self._connection.execute("SELECT response_json FROM chat_requests WHERE player_id=? AND idempotency_key=?", (player_id, key)).fetchone()
        return json.loads(row[0]) if row else None

    def positive_relationship_change_today(self, player_id: str, npc_id: str, game_date: str) -> int:
        rows = self._connection.execute(
            """SELECT response_json,created_at FROM chat_requests
               WHERE player_id=? AND created_at>=datetime('now','-2 days') ORDER BY created_at""", (player_id,)
        ).fetchall()
        total = 0
        for row in rows:
            value = json.loads(row[0])
            # Old cached responses may not contain npc_id; messages keep the
            # authoritative separation, while new responses include agent data.
            response_day = value.get("game_date") or str(row["created_at"])[:10]
            if value.get("npc_id", "emma") == npc_id and response_day == game_date:
                total += max(0, int(value.get("relationship_change", 0)))
        return total

    def commit_chat(self, player_id: str, key: str, message: str, response: dict,
                    npc_id: str = "emma") -> tuple[dict, bool]:
        """Atomically stores state/messages/result; concurrent duplicates return the winner."""
        with self._lock, self._connection:
            cached = self.cached(player_id, key)
            if cached:
                return cached, False
            stats = response["stats"]
            self._connection.execute(
                "UPDATE npc_states SET relationship=?,mood=?,english_xp=?,updated_at=CURRENT_TIMESTAMP WHERE player_id=? AND npc_id=?",
                (stats["relationship"], stats["mood"], stats["english_xp"], player_id, npc_id),
            )
            self._connection.execute("INSERT INTO messages(player_id,speaker,text,npc_id) VALUES (?,'player',?,?)", (player_id, message, npc_id))
            self._connection.execute("INSERT INTO messages(player_id,speaker,text,npc_id,translation) VALUES (?,'npc',?,?,?)", (player_id, response["npc_reply"], npc_id, response.get("npc_reply_zh") or None))
            self._connection.execute("INSERT INTO chat_requests(idempotency_key,player_id,response_json) VALUES (?,?,?)", (key, player_id, json.dumps(response)))
            return response, True

    # NPC Agent persistence -------------------------------------------------

    @staticmethod
    def _json(value: dict) -> str:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)

    def get_npc_profile(self, player_id: str, npc_id: str) -> dict | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT profile_json FROM npc_profiles WHERE player_id=? AND npc_id=?", (player_id, npc_id)
            ).fetchone()
        return json.loads(row[0]) if row else None

    def list_npc_profiles(self, player_id: str) -> list[dict]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT npc_id,profile_json FROM npc_profiles WHERE player_id=? ORDER BY created_at,npc_id", (player_id,)
            ).fetchall()
        return [{"id": row["npc_id"], "profile": json.loads(row["profile_json"])} for row in rows]

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
                       source_event_id: str | None = None, importance: int = 1,
                       tags: list[str] | None = None, confidence: float = 1.0,
                       expires_at: str | None = None, access_stage: str = "stranger") -> dict:
        importance = max(1, min(5, int(importance)))
        content = " ".join(content.split())[:500]
        confidence = max(0.0, min(1.0, float(confidence)))
        with self._lock, self._connection:
            existing = self._connection.execute(
                "SELECT * FROM npc_memories WHERE player_id=? AND npc_id=? AND lower(content)=lower(?)",
                (player_id, npc_id, content),
            ).fetchone()
            if existing:
                self._connection.execute(
                    "UPDATE npc_memories SET importance=max(importance,?),confidence=max(confidence,?) WHERE id=?",
                    (importance, confidence, existing["id"]),
                )
                return dict(self._connection.execute("SELECT * FROM npc_memories WHERE id=?", (existing["id"],)).fetchone())
            cursor = self._connection.execute(
                """INSERT INTO npc_memories(player_id,npc_id,kind,content,source_event_id,importance,
                                              tags_json,confidence,expires_at,access_stage)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (player_id, npc_id, kind, content, source_event_id, importance,
                 self._json(tags or []), confidence, expires_at,
                 access_stage if access_stage in {"stranger", "acquaintance", "friend", "close_friend"} else "stranger"),
            )
            row = self._connection.execute("SELECT * FROM npc_memories WHERE id=?", (cursor.lastrowid,)).fetchone()
            try:
                self._connection.execute(
                    "INSERT INTO npc_memory_fts(content,player_id,npc_id,memory_id) VALUES (?,?,?,?)",
                    (content, player_id, npc_id, str(cursor.lastrowid)),
                )
            except sqlite3.OperationalError:
                pass
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
        return [self._decode_memory(row) for row in rows]

    @staticmethod
    def _decode_memory(row) -> dict:
        value = dict(row)
        value["tags"] = json.loads(value.pop("tags_json", "[]") or "[]")
        return value

    def relevant_npc_memories(self, player_id: str, npc_id: str, query: str, limit: int = 8,
                              relationship_stage: str = "close_friend") -> list[dict]:
        tokens = [value.casefold() for value in query.replace("'", " ").split() if len(value) >= 3][:8]
        matched: list[sqlite3.Row] = []
        if tokens:
            expression = " OR ".join(f'"{token.replace(chr(34), "")}"' for token in tokens)
            try:
                matched = self._connection.execute(
                    """SELECT m.* FROM npc_memory_fts f JOIN npc_memories m ON m.id=CAST(f.memory_id AS INTEGER)
                       WHERE npc_memory_fts MATCH ? AND f.player_id=? AND f.npc_id=?
                         AND (m.expires_at IS NULL OR m.expires_at>CURRENT_TIMESTAMP)
                       ORDER BY bm25(npc_memory_fts),m.importance DESC,m.id DESC LIMIT ?""",
                    (expression, player_id, npc_id, max(1, limit)),
                ).fetchall()
            except sqlite3.OperationalError:
                matched = []
        important = self._connection.execute(
            """SELECT * FROM npc_memories WHERE player_id=? AND npc_id=?
                 AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP)
               ORDER BY importance DESC,id DESC LIMIT ?""", (player_id, npc_id, max(1, limit))
        ).fetchall()
        stage_rank = {"stranger": 0, "acquaintance": 1, "friend": 2, "close_friend": 3}
        allowed_rank = stage_rank.get(relationship_stage, 0)
        unique: dict[int, sqlite3.Row] = {}
        for row in (*matched, *important):
            if stage_rank.get(row["access_stage"], 0) <= allowed_rank:
                unique.setdefault(row["id"], row)
        chosen = list(unique.values())[:max(0, min(20, limit))]
        if chosen:
            with self._connection:
                self._connection.executemany("UPDATE npc_memories SET last_accessed_at=CURRENT_TIMESTAMP WHERE id=?",
                                             [(row["id"],) for row in chosen])
        return [self._decode_memory(row) for row in chosen]

    def delete_npc_memory(self, player_id: str, npc_id: str, memory_id: int) -> bool:
        with self._lock, self._connection:
            cursor = self._connection.execute(
                "DELETE FROM npc_memories WHERE id=? AND player_id=? AND npc_id=?",
                (memory_id, player_id, npc_id),
            )
            try:
                self._connection.execute("DELETE FROM npc_memory_fts WHERE memory_id=?", (str(memory_id),))
            except sqlite3.OperationalError:
                pass
        return cursor.rowcount > 0

    def _agent_json(self, table: str, column: str, player_id: str, npc_id: str) -> dict | None:
        row = self._connection.execute(
            f"SELECT {column} FROM {table} WHERE player_id=? AND npc_id=?", (player_id, npc_id)
        ).fetchone()
        return json.loads(row[0]) if row else None

    def _save_agent_json(self, table: str, column: str, player_id: str, npc_id: str, value: dict) -> dict:
        with self._lock, self._connection:
            self._connection.execute(
                f"""INSERT INTO {table}(player_id,npc_id,{column}) VALUES (?,?,?)
                    ON CONFLICT(player_id,npc_id) DO UPDATE SET {column}=excluded.{column},updated_at=CURRENT_TIMESTAMP""",
                (player_id, npc_id, self._json(value)),
            )
        return value

    def get_persona(self, player_id: str, npc_id: str) -> dict | None:
        return self._agent_json("npc_personas", "persona_json", player_id, npc_id)

    def save_persona(self, player_id: str, npc_id: str, value: dict) -> dict:
        return self._save_agent_json("npc_personas", "persona_json", player_id, npc_id, value)

    def get_runtime_state(self, player_id: str, npc_id: str) -> dict | None:
        return self._agent_json("npc_runtime_states", "state_json", player_id, npc_id)

    def save_runtime_state(self, player_id: str, npc_id: str, value: dict) -> dict:
        return self._save_agent_json("npc_runtime_states", "state_json", player_id, npc_id, value)

    def get_relationship(self, player_id: str, npc_id: str) -> dict | None:
        return self._agent_json("npc_relationships", "relationship_json", player_id, npc_id)

    def save_relationship(self, player_id: str, npc_id: str, value: dict) -> dict:
        return self._save_agent_json("npc_relationships", "relationship_json", player_id, npc_id, value)

    def get_goal(self, player_id: str, npc_id: str) -> dict | None:
        return self._agent_json("npc_goals", "goal_json", player_id, npc_id)

    def save_goal(self, player_id: str, npc_id: str, value: dict) -> dict:
        return self._save_agent_json("npc_goals", "goal_json", player_id, npc_id, value)

    def get_daily_plan(self, player_id: str, npc_id: str, game_date: str) -> dict | None:
        row = self._connection.execute(
            "SELECT plan_json FROM npc_daily_plans WHERE player_id=? AND npc_id=? AND game_date=?",
            (player_id, npc_id, game_date),
        ).fetchone()
        return json.loads(row[0]) if row else None

    def save_daily_plan(self, player_id: str, npc_id: str, game_date: str, value: dict) -> dict:
        with self._lock, self._connection:
            self._connection.execute(
                """INSERT INTO npc_daily_plans(player_id,npc_id,game_date,plan_json) VALUES (?,?,?,?)
                   ON CONFLICT(player_id,npc_id,game_date) DO UPDATE SET plan_json=excluded.plan_json,updated_at=CURRENT_TIMESTAMP""",
                (player_id, npc_id, game_date, self._json(value)),
            )
        return value

    def ensure_social_edges(self, player_id: str, npc_ids: list[str]) -> list[dict]:
        ordered = sorted(npc_ids)
        with self._lock, self._connection:
            for npc_a in ordered:
                for npc_b in ordered:
                    if npc_a == npc_b:
                        continue
                    digest = hashlib.sha256(f"{player_id}\0{npc_a}\0{npc_b}".encode()).digest()
                    familiarity = 12 + digest[0] % 9
                    trust = 45 + digest[1] % 11
                    affinity = 45 + digest[2] % 11
                    tension = 3 + digest[3] % 8
                    self._connection.execute(
                        """INSERT OR IGNORE INTO npc_social_edges(
                           player_id,npc_a,npc_b,familiarity,trust,affinity,tension,status)
                           VALUES (?,?,?,?,?,?,?,'stranger')""",
                        (player_id, npc_a, npc_b, familiarity, trust, affinity, tension),
                    )
        rows = self._connection.execute(
            """SELECT npc_a,npc_b,familiarity,trust,affinity,tension,status
               FROM npc_social_edges WHERE player_id=? ORDER BY npc_a,npc_b""",
            (player_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    def save_social_edge(self, player_id: str, npc_a: str, npc_b: str, **values: int) -> dict:
        if npc_a == npc_b:
            raise ValueError("a social edge requires two different residents")
        self.ensure_social_edges(player_id, [npc_a, npc_b])
        allowed = {key: max(0, min(100, int(value))) for key, value in values.items()
                   if key in {"familiarity", "trust", "affinity", "tension"}}
        with self._lock, self._connection:
            if allowed:
                assignments = ",".join(f"{key}=?" for key in allowed)
                self._connection.execute(
                    f"UPDATE npc_social_edges SET {assignments},updated_at=CURRENT_TIMESTAMP WHERE player_id=? AND npc_a=? AND npc_b=?",
                    (*allowed.values(), player_id, npc_a, npc_b),
                )
            row = self._connection.execute(
                """SELECT npc_a,npc_b,familiarity,trust,affinity,tension,status
                   FROM npc_social_edges WHERE player_id=? AND npc_a=? AND npc_b=?""",
                (player_id, npc_a, npc_b),
            ).fetchone()
            value = dict(row)
            value["status"] = social_status(value)
            self._connection.execute(
                "UPDATE npc_social_edges SET status=? WHERE player_id=? AND npc_a=? AND npc_b=?",
                (value["status"], player_id, npc_a, npc_b),
            )
        return value

    @staticmethod
    def _decode_social_event(row) -> dict:
        value = json.loads(row["event_json"])
        value["status"] = row["status"]
        if row["resolution_action"]:
            value.setdefault("outcome", {})["action"] = row["resolution_action"]
        value["animation_cues"] = social_animation_cues(value)
        value["created_at"] = row["created_at"]
        value["updated_at"] = row["updated_at"]
        return value

    def list_social_events(self, player_id: str, game_date: str | None = None,
                           npc_id: str | None = None, limit: int = 50) -> list[dict]:
        query = "SELECT * FROM npc_social_events WHERE player_id=?"
        parameters: list[object] = [player_id]
        if game_date is not None:
            query += " AND game_date=?"
            parameters.append(game_date)
        query += " ORDER BY game_date DESC,created_at DESC,id LIMIT ?"
        parameters.append(max(1, min(200, int(limit))))
        result = [self._decode_social_event(row) for row in self._connection.execute(query, parameters).fetchall()]
        if npc_id is not None:
            result = [event for event in result if npc_id in event.get("participant_ids", [])]
        return result

    def get_social_event(self, player_id: str, event_id: str) -> dict | None:
        row = self._connection.execute(
            "SELECT * FROM npc_social_events WHERE player_id=? AND id=?", (player_id, event_id)
        ).fetchone()
        return self._decode_social_event(row) if row else None

    def save_social_event(self, player_id: str, event: dict) -> tuple[dict, bool]:
        event_key = ":".join(sorted(event.get("participant_ids", [])))
        with self._lock, self._connection:
            cursor = self._connection.execute(
                """INSERT OR IGNORE INTO npc_social_events(
                   id,player_id,game_date,event_key,event_json,status) VALUES (?,?,?,?,?,?)""",
                (event["id"], player_id, event["date"], event_key, self._json(event), event["status"]),
            )
        return self.get_social_event(player_id, event["id"]), cursor.rowcount > 0  # type: ignore[return-value]

    def update_social_event(self, player_id: str, event: dict) -> dict:
        """Persist an in-progress event transition without applying its outcome."""
        with self._lock, self._connection:
            cursor = self._connection.execute(
                """UPDATE npc_social_events SET event_json=?,status=?,updated_at=CURRENT_TIMESTAMP
                   WHERE player_id=? AND id=?
                   AND status NOT IN ('resolved_autonomously','resolved_with_management')""",
                (self._json(event), event["status"], player_id, event["id"]),
            )
        if not cursor.rowcount:
            current = self.get_social_event(player_id, event["id"])
            if current:
                return current
            raise KeyError(event["id"])
        return self.get_social_event(player_id, event["id"])  # type: ignore[return-value]

    def resolve_social_event(self, player_id: str, event_id: str, action: str,
                             changes: list[dict], memories: list[dict], outcome: dict,
                             managed: bool = False) -> dict:
        """Atomically applies rule-owned directed deltas, memories, and event resolution."""
        with self._lock, self._connection:
            row = self._connection.execute(
                "SELECT * FROM npc_social_events WHERE player_id=? AND id=?", (player_id, event_id)
            ).fetchone()
            if not row:
                raise KeyError(event_id)
            if row["status"] in {"resolved_autonomously", "resolved_with_management"}:
                return self._decode_social_event(row)
            event = json.loads(row["event_json"])
            for change in changes:
                npc_a, npc_b = change["npc_a"], change["npc_b"]
                digest = hashlib.sha256(f"{player_id}\0{npc_a}\0{npc_b}".encode()).digest()
                self._connection.execute(
                    """INSERT OR IGNORE INTO npc_social_edges(
                       player_id,npc_a,npc_b,familiarity,trust,affinity,tension,status)
                       VALUES (?,?,?,?,?,?,?,'stranger')""",
                    (player_id, npc_a, npc_b, 12 + digest[0] % 9, 45 + digest[1] % 11,
                     45 + digest[2] % 11, 3 + digest[3] % 8),
                )
                edge = self._connection.execute(
                    "SELECT * FROM npc_social_edges WHERE player_id=? AND npc_a=? AND npc_b=?",
                    (player_id, npc_a, npc_b),
                ).fetchone()
                values = {key: max(0, min(100, int(edge[key]) + int(change.get(key, 0))))
                          for key in ("familiarity", "trust", "affinity", "tension")}
                values["status"] = social_status(values)
                self._connection.execute(
                    """UPDATE npc_social_edges SET familiarity=?,trust=?,affinity=?,tension=?,status=?,
                       updated_at=CURRENT_TIMESTAMP WHERE player_id=? AND npc_a=? AND npc_b=?""",
                    (values["familiarity"], values["trust"], values["affinity"], values["tension"],
                     values["status"], player_id, npc_a, npc_b),
                )
            for memory in memories:
                content = " ".join(str(memory["content"]).split())[:500]
                cursor = self._connection.execute(
                    """INSERT INTO npc_memories(player_id,npc_id,kind,content,source_event_id,importance,
                       tags_json,confidence,access_stage)
                       SELECT ?,?,'social',?,?,3,'[\"social\",\"npc_interaction\"]',1,'stranger'
                       WHERE NOT EXISTS(SELECT 1 FROM npc_memories WHERE player_id=? AND npc_id=? AND source_event_id=?)""",
                    (player_id, memory["npc_id"], content, event_id,
                     player_id, memory["npc_id"], event_id),
                )
                if cursor.rowcount:
                    try:
                        self._connection.execute(
                            "INSERT INTO npc_memory_fts(content,player_id,npc_id,memory_id) VALUES (?,?,?,?)",
                            (content, player_id, memory["npc_id"], str(cursor.lastrowid)),
                        )
                    except sqlite3.OperationalError:
                        pass
            status = "resolved_with_management" if managed else "resolved_autonomously"
            event["status"], event["outcome"] = status, outcome
            event["management"] = {**event.get("management", {}), "can_intervene": False}
            self._connection.execute(
                """UPDATE npc_social_events SET event_json=?,status=?,resolution_action=?,
                   updated_at=CURRENT_TIMESTAMP WHERE player_id=? AND id=?""",
                (self._json(event), status, action, player_id, event_id),
            )
        return self.get_social_event(player_id, event_id)  # type: ignore[return-value]

    def add_agent_trace(self, player_id: str, npc_id: str, request_id: str, trace: dict) -> None:
        with self._lock, self._connection:
            self._connection.execute(
                """INSERT INTO agent_turn_traces(player_id,npc_id,request_id,prompt_version,persona_version,
                   memory_ids_json,model,fallback_used,dialogue_ms,analysis_ms,error_type)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (player_id, npc_id, request_id, trace.get("prompt_version", "agent-v1"),
                 trace.get("persona_version"), self._json(trace.get("memory_ids", [])), trace.get("model"),
                 int(bool(trace.get("fallback_used"))), int(trace.get("dialogue_ms", 0)),
                 int(trace.get("analysis_ms", 0)), trace.get("error_type")),
            )

    def append_conversation_summary(self, player_id: str, npc_id: str, game_date: str,
                                    observations: list[str]) -> None:
        clean = [" ".join(value.split())[:300] for value in observations if value.strip()]
        if not clean:
            return
        row = self._connection.execute(
            "SELECT summary FROM conversation_summaries WHERE player_id=? AND npc_id=? AND game_date=?",
            (player_id, npc_id, game_date),
        ).fetchone()
        existing = row[0].split(" | ") if row and row[0] else []
        merged = list(dict.fromkeys([*existing, *clean]))[-8:]
        with self._lock, self._connection:
            self._connection.execute(
                """INSERT INTO conversation_summaries(player_id,npc_id,game_date,summary) VALUES (?,?,?,?)
                   ON CONFLICT(player_id,npc_id,game_date) DO UPDATE SET summary=excluded.summary""",
                (player_id, npc_id, game_date, " | ".join(merged)),
            )

    def list_conversation_summaries(self, player_id: str, npc_id: str, limit: int = 7) -> list[dict]:
        rows = self._connection.execute(
            """SELECT game_date,summary FROM conversation_summaries WHERE player_id=? AND npc_id=?
               ORDER BY game_date DESC LIMIT ?""", (player_id, npc_id, max(1, min(30, limit)))
        ).fetchall()
        return [dict(row) for row in rows]

    def list_agent_traces(self, limit: int = 100) -> list[dict]:
        rows = self._connection.execute(
            """SELECT t.id,u.username,t.npc_id,t.request_id,t.prompt_version,t.persona_version,
                      t.memory_ids_json,t.model,t.fallback_used,t.dialogue_ms,t.analysis_ms,t.error_type,t.created_at
               FROM agent_turn_traces t LEFT JOIN users u ON u.player_id=t.player_id
               ORDER BY t.id DESC LIMIT ?""", (max(1, min(500, limit)),)
        ).fetchall()
        result = []
        for row in rows:
            item = dict(row); item["memory_ids"] = json.loads(item.pop("memory_ids_json")); result.append(item)
        return result

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
