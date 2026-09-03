from __future__ import annotations

import json
import sqlite3
import threading
import hashlib
import secrets
import uuid
import base64
import unicodedata
from pathlib import Path
from cryptography.fernet import Fernet, InvalidToken

from .events import ActiveEvent, EventHistory, event_to_dict
from .learning import LearningState
from .models import Stats
from .social import social_animation_cues, social_status


class LifeWorldRevisionConflict(RuntimeError):
    """The authoritative life world changed after a caller read it."""


class Database:
    # Every row in these tables belongs to the player's resettable game save.
    # Account/security/quota/audit records (users, sessions, invitations,
    # usage_events and agent_turn_traces), the durable players identity and
    # global layout are intentionally absent.  ``reset_user_game_progress``
    # audits this list against the live schema before deleting so future
    # player-scoped tables cannot silently survive a reset.
    _GAME_PROGRESS_TABLES = (
        "npc_memory_fts",
        "npc_states",
        "messages",
        "chat_requests",
        "npc_profiles",
        "npc_memories",
        "active_events",
        "event_history",
        "learning_states",
        "npc_personas",
        "npc_runtime_states",
        "npc_relationships",
        "npc_goals",
        "npc_daily_plans",
        "npc_social_edges",
        "npc_social_events",
        "conversation_summaries",
        "life_world_states",
        "residences",
        "households",
        "household_members",
        "household_resources",
        "npc_desires",
        "npc_life_actions",
        "life_stories",
        "life_story_observations",
        "life_interventions",
        "unresolved_threads",
        "npc_relationship_bonds",
        "relationship_evidence",
        "player_onboarding",
    )

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
            CREATE TABLE IF NOT EXISTS schema_migrations (
              version INTEGER PRIMARY KEY,description TEXT NOT NULL,
              applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS life_world_states (
              player_id TEXT PRIMARY KEY,revision INTEGER NOT NULL DEFAULT 0,
              rules_version TEXT NOT NULL,state_json TEXT NOT NULL,
              last_advanced_at TEXT NOT NULL,next_transition_at TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS residences (
              id TEXT PRIMARY KEY,player_id TEXT NOT NULL,location_id TEXT NOT NULL,
              name TEXT NOT NULL,state_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(player_id,location_id));
            CREATE TABLE IF NOT EXISTS households (
              id TEXT PRIMARY KEY,player_id TEXT NOT NULL,residence_id TEXT,
              name TEXT NOT NULL,state_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE INDEX IF NOT EXISTS idx_households_owner ON households(player_id,id);
            CREATE TABLE IF NOT EXISTS household_members (
              household_id TEXT NOT NULL,player_id TEXT NOT NULL,npc_id TEXT NOT NULL,
              private_room_id TEXT,role_json TEXT NOT NULL DEFAULT '{}',
              joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY(household_id,npc_id),UNIQUE(player_id,npc_id));
            CREATE INDEX IF NOT EXISTS idx_household_members_owner ON household_members(player_id,npc_id);
            CREATE TABLE IF NOT EXISTS household_resources (
              id TEXT PRIMARY KEY,player_id TEXT NOT NULL,household_id TEXT NOT NULL,
              kind TEXT NOT NULL,room_id TEXT NOT NULL,capacity INTEGER NOT NULL DEFAULT 1,
              state_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(player_id,household_id,kind,room_id));
            CREATE INDEX IF NOT EXISTS idx_household_resources_owner
              ON household_resources(player_id,household_id,kind);
            CREATE TABLE IF NOT EXISTS npc_desires (
              id TEXT PRIMARY KEY,player_id TEXT NOT NULL,npc_id TEXT NOT NULL,
              desire_json TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,
              expires_at TEXT,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE INDEX IF NOT EXISTS idx_npc_desires_current ON npc_desires(player_id,npc_id,status);
            CREATE TABLE IF NOT EXISTS npc_life_actions (
              id TEXT PRIMARY KEY,player_id TEXT NOT NULL,npc_id TEXT NOT NULL,
              action_type TEXT NOT NULL,action_json TEXT NOT NULL,status TEXT NOT NULL,
              started_at TEXT,ends_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE INDEX IF NOT EXISTS idx_life_actions_current
              ON npc_life_actions(player_id,npc_id,status,ends_at);
            CREATE TABLE IF NOT EXISTS life_stories (
              id TEXT PRIMARY KEY,player_id TEXT NOT NULL,level TEXT NOT NULL,
              story_key TEXT NOT NULL,story_json TEXT NOT NULL,status TEXT NOT NULL,
              intervention_expires_at TEXT,resolution_action TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(player_id,story_key));
            CREATE INDEX IF NOT EXISTS idx_life_stories_open
              ON life_stories(player_id,status,updated_at);
            CREATE TABLE IF NOT EXISTS life_story_observations (
              player_id TEXT NOT NULL,story_id TEXT NOT NULL,
              observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY(player_id,story_id));
            CREATE TABLE IF NOT EXISTS life_interventions (
              player_id TEXT NOT NULL,story_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,
              action TEXT NOT NULL,response_json TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY(player_id,story_id,idempotency_key));
            CREATE TABLE IF NOT EXISTS unresolved_threads (
              id TEXT PRIMARY KEY,player_id TEXT NOT NULL,kind TEXT NOT NULL,topic TEXT NOT NULL,
              participant_ids_json TEXT NOT NULL,thread_json TEXT NOT NULL,status TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE INDEX IF NOT EXISTS idx_unresolved_threads_open
              ON unresolved_threads(player_id,status,topic);
            CREATE TABLE IF NOT EXISTS npc_relationship_bonds (
              id TEXT PRIMARY KEY,player_id TEXT NOT NULL,pair_key TEXT NOT NULL,
              channel TEXT NOT NULL,kind TEXT NOT NULL,state TEXT NOT NULL,
              roles_json TEXT NOT NULL DEFAULT '{}',scope_id TEXT,context_json TEXT NOT NULL DEFAULT '{}',
              started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,ended_at TEXT,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(player_id,pair_key,channel,kind));
            CREATE INDEX IF NOT EXISTS idx_relationship_bonds_pair
              ON npc_relationship_bonds(player_id,pair_key,channel,state);
            CREATE TABLE IF NOT EXISTS relationship_evidence (
              id TEXT PRIMARY KEY,player_id TEXT NOT NULL,fact_id TEXT NOT NULL,
              source_npc_id TEXT NOT NULL,target_npc_id TEXT NOT NULL,kind TEXT NOT NULL,
              magnitude REAL NOT NULL,appraisal_json TEXT NOT NULL,deltas_json TEXT NOT NULL,
              context_json TEXT NOT NULL DEFAULT '{}',rules_version TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(player_id,fact_id,source_npc_id,target_npc_id,kind));
            CREATE INDEX IF NOT EXISTS idx_relationship_evidence_edge
              ON relationship_evidence(player_id,source_npc_id,target_npc_id,created_at);
            CREATE TABLE IF NOT EXISTS player_onboarding (
              player_id TEXT PRIMARY KEY,state_json TEXT NOT NULL DEFAULT '{}',
              completed_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS world_layout_configs (
              scope TEXT PRIMARY KEY,layout_json TEXT NOT NULL,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            """)
            self._connection.execute(
                "INSERT OR IGNORE INTO schema_migrations(version,description) VALUES (2,'life simulation v2 additive schema')"
            )
            # Grandfather accounts that already had a resident when v3 first
            # reached their database. New registrations happen after this
            # one-time boundary and therefore still receive the onboarding flow.
            if not self._connection.execute(
                "SELECT 1 FROM schema_migrations WHERE version=3"
            ).fetchone():
                self._connection.execute(
                    """INSERT OR IGNORE INTO player_onboarding(
                         player_id,state_json,completed_at)
                       SELECT DISTINCT player_id,
                         '{"version":1,"completed":true,"household_name":"Our Home"}',
                         CURRENT_TIMESTAMP FROM npc_profiles"""
                )
                self._connection.execute(
                    "INSERT OR IGNORE INTO schema_migrations(version,description) "
                    "VALUES (3,'shared household onboarding and published world layout')"
                )
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
                ("appraisal_json", "TEXT NOT NULL DEFAULT '{}'"),
                ("fact_id", "TEXT"),
                ("corrects_memory_id", "INTEGER"),
            ):
                if column not in memory_columns:
                    self._connection.execute(f"ALTER TABLE npc_memories ADD COLUMN {column} {definition}")
            edge_columns = {row[1] for row in self._connection.execute("PRAGMA table_info(npc_social_edges)")}
            for column, definition in (
                ("familiarity", "INTEGER NOT NULL DEFAULT 15"),
                ("trust", "INTEGER NOT NULL DEFAULT 50"),
                ("tension", "INTEGER NOT NULL DEFAULT 5"),
                ("respect", "INTEGER NOT NULL DEFAULT 50"),
                ("comfort", "INTEGER NOT NULL DEFAULT 50"),
                ("resentment", "INTEGER NOT NULL DEFAULT 0"),
                ("attraction", "INTEGER NOT NULL DEFAULT 0"),
                ("dependency", "INTEGER NOT NULL DEFAULT 0"),
                ("fear", "INTEGER NOT NULL DEFAULT 0"),
                ("friendship_status", "TEXT NOT NULL DEFAULT 'stranger'"),
                ("conflict_status", "TEXT NOT NULL DEFAULT 'none'"),
                ("relationship_version", "INTEGER NOT NULL DEFAULT 2"),
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
            self._connection.execute(
                """UPDATE npc_social_edges SET
                   friendship_status=CASE
                     WHEN trust>=72 AND affinity>=72 AND familiarity>=70 THEN 'close_friend'
                     WHEN trust>=58 AND affinity>=58 AND familiarity>=45 THEN 'mutual_friend'
                     WHEN familiarity>=25 THEN 'acquaintance' ELSE 'stranger' END,
                   conflict_status=CASE WHEN tension>=75 THEN 'open_conflict'
                     WHEN tension>=50 THEN 'friction' ELSE 'none' END"""
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

    @staticmethod
    def _username_confirmation_key(value: object) -> str:
        return unicodedata.normalize("NFKC", str(value or "").strip()).casefold()

    @classmethod
    def _is_onboarding_test_account(cls, username: object) -> bool:
        key = cls._username_confirmation_key(username)
        return key == "onboarding-test" or key.startswith("onboarding-test-")

    def reset_user_game_progress(self, user_id: str, confirm_username: str) -> dict:
        """Atomically erase one player's game save while retaining the account.

        This is limited to ``onboarding-test`` and ``onboarding-test-*``, and
        deliberately keyed by the immutable internal user id *and* a typed
        username confirmation. The existing session remains usable, so the
        tester can immediately reload onboarding without another invitation.
        """
        def write():
            user_row = self._connection.execute(
                "SELECT id,username,player_id FROM users WHERE id=?", (user_id,),
            ).fetchone()
            if not user_row:
                raise ValueError("USER_NOT_FOUND")
            if not self._is_onboarding_test_account(user_row["username"]):
                raise ValueError("TEST_ACCOUNT_REQUIRED")
            if self._username_confirmation_key(confirm_username) != self._username_confirmation_key(
                user_row["username"]
            ):
                raise ValueError("USERNAME_CONFIRMATION_MISMATCH")

            # Fail closed if a future migration introduces player-owned data
            # without classifying it as resettable or explicitly retained.
            player_scoped: set[str] = set()
            tables = self._connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            ).fetchall()
            for table_row in tables:
                table = str(table_row["name"])
                escaped = table.replace('"', '""')
                columns = self._connection.execute(
                    f'PRAGMA table_info("{escaped}")'
                ).fetchall()
                if any(str(column["name"]) == "player_id" for column in columns):
                    player_scoped.add(table)
            unclassified = player_scoped - set(self._GAME_PROGRESS_TABLES) - {
                "users", "agent_turn_traces",
            }
            if unclassified:
                raise RuntimeError(
                    "Unclassified player-scoped tables: " + ", ".join(sorted(unclassified))
                )

            player_id = str(user_row["player_id"])
            existing_tables = {str(row["name"]) for row in tables}
            deleted: dict[str, int] = {}
            for table in self._GAME_PROGRESS_TABLES:
                if table not in existing_tables:
                    deleted[table] = 0
                    continue
                # Names are selected exclusively from the static allowlist.
                deleted[table] = int(self._connection.execute(
                    f"SELECT count(*) FROM {table} WHERE player_id=?", (player_id,),
                ).fetchone()[0])
                self._connection.execute(
                    f"DELETE FROM {table} WHERE player_id=?", (player_id,),
                )

            return {
                "reset": True,
                "user": {"id": str(user_row["id"]), "username": str(user_row["username"])},
                "deleted": deleted,
            }

        result = self._life_transaction(write)
        player_id = str(self.user_by_id(user_id)["player_id"])
        result["onboarding"] = self.onboarding_state(player_id)
        return result

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

    @staticmethod
    def _npc_name_key(value: object) -> str:
        """Canonical comparison key for a player-visible resident name."""
        return unicodedata.normalize("NFKC", " ".join(str(value or "").split())).casefold()

    def _assert_npc_name_available(self, player_id: str, profile: dict,
                                   *, exclude_npc_id: str | None = None) -> None:
        candidate = self._npc_name_key(profile.get("name"))
        if not candidate:
            raise ValueError("INVALID_NPC_NAME")
        rows = self._connection.execute(
            "SELECT npc_id,profile_json FROM npc_profiles WHERE player_id=?", (player_id,),
        ).fetchall()
        for row in rows:
            if exclude_npc_id is not None and str(row["npc_id"]) == exclude_npc_id:
                continue
            existing = json.loads(row["profile_json"])
            if self._npc_name_key(existing.get("name")) == candidate:
                raise ValueError("NPC_NAME_TAKEN")

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
        self.ensure_player(player_id)

        def write():
            self._assert_npc_name_available(player_id, profile, exclude_npc_id=npc_id)
            self._connection.execute(
                """INSERT INTO npc_profiles(player_id,npc_id,profile_json) VALUES (?,?,?)
                   ON CONFLICT(player_id,npc_id) DO UPDATE SET
                     profile_json=excluded.profile_json,updated_at=CURRENT_TIMESTAMP""",
                (player_id, npc_id, self._json(profile)),
            )
        self._life_transaction(write)
        return profile

    def create_npc_profile(self, player_id: str, npc_id: str, profile: dict,
                           greeting: str, greeting_translation: str,
                           *, maximum: int = 8) -> dict:
        """Create one resident under the same cross-worker limit/name lock."""
        self.ensure_player(player_id)

        def write():
            count = int(self._connection.execute(
                "SELECT count(*) FROM npc_profiles WHERE player_id=?", (player_id,),
            ).fetchone()[0])
            if count >= maximum:
                raise ValueError("NPC_LIMIT_REACHED")
            self._assert_npc_name_available(player_id, profile)
            self._connection.execute(
                "INSERT INTO npc_states(player_id,npc_id,relationship,mood,english_xp) "
                "VALUES (?,?,35,50,0)", (player_id, npc_id),
            )
            self._connection.execute(
                "INSERT INTO messages(player_id,speaker,text,npc_id,translation) "
                "VALUES (?,'npc',?,?,?)",
                (player_id, greeting, npc_id, greeting_translation),
            )
            self._connection.execute(
                "INSERT INTO npc_profiles(player_id,npc_id,profile_json) VALUES (?,?,?)",
                (player_id, npc_id, self._json(profile)),
            )

        self._life_transaction(write)
        return profile

    def onboarding_state(self, player_id: str, *, minimum: int = 2,
                         maximum: int = 8) -> dict:
        """Return durable onboarding progress without materializing legacy Emma.

        Emma is a compatibility resident created by older entry points and is
        deliberately excluded from ``user_created_count``.  Existing accounts
        with two genuinely created residents migrate to completed naturally;
        a lone default Emma can never complete the guide by itself.
        """
        with self._lock:
            profile_rows = self._connection.execute(
                "SELECT npc_id FROM npc_profiles WHERE player_id=? ORDER BY created_at,npc_id",
                (player_id,),
            ).fetchall()
            row = self._connection.execute(
                "SELECT state_json,completed_at,updated_at FROM player_onboarding WHERE player_id=?",
                (player_id,),
            ).fetchone()
        resident_ids = [str(value["npc_id"]) for value in profile_rows]
        user_created = sum(npc_id != "emma" for npc_id in resident_ids)
        stored = json.loads(row["state_json"]) if row else {}
        completed = bool(stored.get("completed")) or user_created >= minimum
        return {
            "version": 1,
            "completed": completed,
            "min_residents": minimum,
            "max_residents": maximum,
            "resident_count": len(resident_ids),
            "user_created_count": user_created,
            "remaining_slots": max(0, maximum - len(resident_ids)),
            "household_name": str(stored.get("household_name") or "Our Home"),
            "completed_at": row["completed_at"] if row else None,
            "updated_at": row["updated_at"] if row else None,
        }

    def refresh_onboarding(self, player_id: str, *, household_name: str | None = None,
                           force_complete: bool = False, minimum: int = 2,
                           maximum: int = 8) -> dict:
        """Persist completion once enough non-legacy residents exist."""
        def write():
            profile_rows = self._connection.execute(
                "SELECT npc_id FROM npc_profiles WHERE player_id=?", (player_id,),
            ).fetchall()
            user_created = sum(str(row["npc_id"]) != "emma" for row in profile_rows)
            row = self._connection.execute(
                "SELECT state_json FROM player_onboarding WHERE player_id=?", (player_id,),
            ).fetchone()
            stored = json.loads(row["state_json"]) if row else {}
            completed = force_complete or bool(stored.get("completed")) or user_created >= minimum
            current_name = str(stored.get("household_name") or "Our Home")
            name = " ".join((household_name or current_name).split())[:64] or "Our Home"
            value = {"version": 1, "completed": completed, "household_name": name}
            self._connection.execute(
                """INSERT INTO player_onboarding(player_id,state_json,completed_at)
                   VALUES (?,?,CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END)
                   ON CONFLICT(player_id) DO UPDATE SET
                     state_json=excluded.state_json,
                     completed_at=CASE
                       WHEN player_onboarding.completed_at IS NOT NULL THEN player_onboarding.completed_at
                       WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END,
                     updated_at=CURRENT_TIMESTAMP""",
                (player_id, self._json(value), int(completed), int(completed)),
            )
        self._life_transaction(write)
        return self.onboarding_state(player_id, minimum=minimum, maximum=maximum)

    def create_onboarding_residents(self, player_id: str, residents: list[dict],
                                    household_name: str, *, maximum: int = 8) -> list[dict]:
        """Atomically create a validated onboarding cast and mark it complete."""
        self.ensure_player(player_id)
        name = " ".join(household_name.split())[:64] or "Our Home"

        def write():
            if not 2 <= len(residents) <= maximum:
                raise ValueError("INVALID_ONBOARDING_RESIDENT_COUNT")
            stored_row = self._connection.execute(
                "SELECT state_json FROM player_onboarding WHERE player_id=?", (player_id,),
            ).fetchone()
            stored = json.loads(stored_row["state_json"]) if stored_row else {}
            existing_rows = self._connection.execute(
                "SELECT npc_id,profile_json FROM npc_profiles WHERE player_id=?", (player_id,),
            ).fetchall()
            existing_user_created = sum(str(row["npc_id"]) != "emma" for row in existing_rows)
            if bool(stored.get("completed")) or existing_user_created >= 2:
                raise ValueError("ONBOARDING_ALREADY_COMPLETED")
            existing_count = int(self._connection.execute(
                "SELECT count(*) FROM npc_profiles WHERE player_id=?", (player_id,),
            ).fetchone()[0])
            if existing_count + len(residents) > maximum:
                raise ValueError("NPC_LIMIT_REACHED")
            incoming_ids = [str(entry["id"]) for entry in residents]
            if len(incoming_ids) != len(set(incoming_ids)):
                raise ValueError("DUPLICATE_NPC_ID")
            existing_names = {
                self._npc_name_key(json.loads(row["profile_json"]).get("name"))
                for row in existing_rows
            }
            incoming_names = [self._npc_name_key(entry["profile"].get("name")) for entry in residents]
            if any(not value for value in incoming_names):
                raise ValueError("INVALID_NPC_NAME")
            if (len(incoming_names) != len(set(incoming_names))
                    or bool(existing_names & set(incoming_names))):
                raise ValueError("NPC_NAME_TAKEN")
            created: list[dict] = []
            for entry in residents:
                npc_id = str(entry["id"])
                profile = dict(entry["profile"])
                if npc_id == "emma":
                    raise ValueError("RESERVED_NPC_ID")
                self._connection.execute(
                    "INSERT INTO npc_states(player_id,npc_id,relationship,mood,english_xp) VALUES (?,?,35,50,0)",
                    (player_id, npc_id),
                )
                self._connection.execute(
                    "INSERT INTO messages(player_id,speaker,text,npc_id,translation) VALUES (?,'npc',?,?,?)",
                    (player_id, f"Hi, I'm {profile['name']}. What would you like to talk about?",
                     npc_id, f"嗨，我是{profile['name']}。你想聊些什么？"),
                )
                self._connection.execute(
                    "INSERT INTO npc_profiles(player_id,npc_id,profile_json) VALUES (?,?,?)",
                    (player_id, npc_id, self._json(profile)),
                )
                created.append({"id": npc_id, "profile": profile})
            state = {"version": 1, "completed": True, "household_name": name}
            self._connection.execute(
                """INSERT INTO player_onboarding(player_id,state_json,completed_at)
                   VALUES (?,?,CURRENT_TIMESTAMP)
                   ON CONFLICT(player_id) DO UPDATE SET state_json=excluded.state_json,
                     completed_at=COALESCE(player_onboarding.completed_at,CURRENT_TIMESTAMP),
                     updated_at=CURRENT_TIMESTAMP""",
                (player_id, self._json(state)),
            )
            return created

        return self._life_transaction(write)

    def get_world_layout(self) -> dict | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT layout_json,updated_at FROM world_layout_configs WHERE scope='published'"
            ).fetchone()
        return ({"layout": json.loads(row["layout_json"]), "updated_at": row["updated_at"]}
                if row else None)

    def save_world_layout(self, layout: dict) -> dict:
        with self._lock, self._connection:
            self._connection.execute(
                """INSERT INTO world_layout_configs(scope,layout_json) VALUES ('published',?)
                   ON CONFLICT(scope) DO UPDATE SET layout_json=excluded.layout_json,
                     updated_at=CURRENT_TIMESTAMP""",
                (self._json(layout),),
            )
        return self.get_world_layout()  # type: ignore[return-value]

    def reset_world_layout(self) -> None:
        with self._lock, self._connection:
            self._connection.execute("DELETE FROM world_layout_configs WHERE scope='published'")

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

    # Life simulation v2 --------------------------------------------------

    def _life_transaction(self, operation):
        """Run a world/projection write under one cross-connection transaction.

        ``sqlite3.Connection`` context managers start deferred transactions, so
        a read-then-write optimistic check can race across worker processes. An
        explicit ``BEGIN IMMEDIATE`` takes the write reservation before reading
        the revision and also prevents projection helpers from committing a
        partially written snapshot.
        """
        with self._lock:
            self._connection.execute("BEGIN IMMEDIATE")
            try:
                result = operation()
                self._connection.commit()
            except BaseException:
                self._connection.rollback()
                raise
            return result

    def _write_life_world_state(self, player_id: str, state: dict, *, rules_version: str,
                                last_advanced_at: str, next_transition_at: str | None,
                                expected_revision: int | None) -> int:
        """Write the authoritative row inside an already-open transaction."""
        payload = dict(state)
        for field in ("revision", "rules_version", "last_advanced_at", "next_transition_at", "updated_at"):
            payload.pop(field, None)
        row = self._connection.execute(
            "SELECT revision FROM life_world_states WHERE player_id=?", (player_id,)
        ).fetchone()
        current_revision = int(row[0]) if row else 0
        if expected_revision is not None and current_revision != int(expected_revision):
            raise LifeWorldRevisionConflict("life world revision conflict")
        revision = current_revision + 1
        self._connection.execute(
            """INSERT INTO life_world_states(
                 player_id,revision,rules_version,state_json,last_advanced_at,next_transition_at)
               VALUES (?,?,?,?,?,?)
               ON CONFLICT(player_id) DO UPDATE SET
                 revision=excluded.revision,rules_version=excluded.rules_version,
                 state_json=excluded.state_json,last_advanced_at=excluded.last_advanced_at,
                 next_transition_at=excluded.next_transition_at,updated_at=CURRENT_TIMESTAMP""",
            (player_id, revision, rules_version, self._json(payload),
             last_advanced_at, next_transition_at),
        )
        return revision

    def get_life_world_state(self, player_id: str) -> dict | None:
        row = self._connection.execute(
            """SELECT revision,rules_version,state_json,last_advanced_at,next_transition_at,updated_at
               FROM life_world_states WHERE player_id=?""", (player_id,)
        ).fetchone()
        if not row:
            return None
        value = json.loads(row["state_json"])
        value.update({
            "revision": row["revision"], "rules_version": row["rules_version"],
            "last_advanced_at": row["last_advanced_at"],
            "next_transition_at": row["next_transition_at"], "updated_at": row["updated_at"],
        })
        return value

    def save_life_world_state(self, player_id: str, state: dict, *, rules_version: str,
                              last_advanced_at: str, next_transition_at: str | None,
                              expected_revision: int | None = None) -> dict:
        """Persist one authoritative world snapshot with optimistic revision checking."""
        def write():
            self._write_life_world_state(
                player_id, state, rules_version=rules_version,
                last_advanced_at=last_advanced_at, next_transition_at=next_transition_at,
                expected_revision=expected_revision,
            )
            return self.get_life_world_state(player_id)

        return self._life_transaction(write)  # type: ignore[return-value]

    def _upsert_household_projection(self, player_id: str, household: dict) -> None:
        """Write a household projection inside the caller's transaction."""
        household_id = str(household["id"])
        residence = household.get("residence") or {}
        residence_id = str(residence.get("id") or household.get("residence_id") or "") or None
        if residence_id:
            self._connection.execute(
                """INSERT INTO residences(id,player_id,location_id,name,state_json) VALUES (?,?,?,?,?)
                   ON CONFLICT(id) DO UPDATE SET location_id=excluded.location_id,name=excluded.name,
                     state_json=excluded.state_json,updated_at=CURRENT_TIMESTAMP""",
                (residence_id, player_id, str(residence.get("location_id") or residence_id),
                 str(residence.get("name") or household.get("name") or "Home"), self._json(residence)),
            )
        self._connection.execute(
            """INSERT INTO households(id,player_id,residence_id,name,state_json) VALUES (?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET residence_id=excluded.residence_id,name=excluded.name,
                 state_json=excluded.state_json,updated_at=CURRENT_TIMESTAMP""",
            (household_id, player_id, residence_id, str(household.get("name") or "Household"),
             self._json({key: value for key, value in household.items()
                         if key not in {"members", "resources", "residence"}})),
        )
        self._connection.execute(
            "DELETE FROM household_members WHERE player_id=? AND household_id=?",
            (player_id, household_id),
        )
        self._connection.execute(
            "DELETE FROM household_resources WHERE player_id=? AND household_id=?",
            (player_id, household_id),
        )
        for member in household.get("members", []):
            npc_id = str(member.get("npc_id") or member.get("id") or "")
            if not npc_id:
                continue
            self._connection.execute(
                """INSERT OR REPLACE INTO household_members(
                     household_id,player_id,npc_id,private_room_id,role_json)
                   VALUES (?,?,?,?,?)""",
                (household_id, player_id, npc_id, member.get("private_room_id"), self._json(member)),
            )
        for resource in household.get("resources", []):
            resource_id = str(resource.get("id") or "")
            if not resource_id:
                continue
            self._connection.execute(
                """INSERT INTO household_resources(
                     id,player_id,household_id,kind,room_id,capacity,state_json)
                   VALUES (?,?,?,?,?,?,?)
                   ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,room_id=excluded.room_id,
                     capacity=excluded.capacity,state_json=excluded.state_json,
                     updated_at=CURRENT_TIMESTAMP""",
                (resource_id, player_id, household_id, str(resource.get("kind") or "shared"),
                 str(resource.get("room_id") or "shared-space"), int(resource.get("capacity") or 1),
                 self._json(resource.get("state") or {})),
            )

    def _delete_stale_household_projections(
        self, player_id: str, current_household_ids: set[str],
    ) -> None:
        """Remove household projections absent from one authoritative snapshot.

        This helper intentionally leaves residences and all historical life
        projections intact. It runs only inside the caller's life transaction,
        before current households are upserted, so members and resources can
        safely move out of a household that disappeared during reconciliation.
        """
        if current_household_ids:
            placeholders = ",".join("?" for _ in current_household_ids)
            parameters = (player_id, *sorted(current_household_ids))
            self._connection.execute(
                f"""DELETE FROM household_members WHERE player_id=?
                    AND household_id NOT IN ({placeholders})""",
                parameters,
            )
            self._connection.execute(
                f"""DELETE FROM household_resources WHERE player_id=?
                    AND household_id NOT IN ({placeholders})""",
                parameters,
            )
            self._connection.execute(
                f"""DELETE FROM households WHERE player_id=?
                    AND id NOT IN ({placeholders})""",
                parameters,
            )
            return
        self._connection.execute(
            "DELETE FROM household_members WHERE player_id=?", (player_id,),
        )
        self._connection.execute(
            "DELETE FROM household_resources WHERE player_id=?", (player_id,),
        )
        self._connection.execute(
            "DELETE FROM households WHERE player_id=?", (player_id,),
        )

    def upsert_household_projection(self, player_id: str, household: dict) -> dict:
        """Keep the queryable Household projection aligned with the world snapshot."""
        def write():
            self._upsert_household_projection(player_id, household)

        self._life_transaction(write)
        return household

    def list_households(self, player_id: str) -> list[dict]:
        rows = self._connection.execute(
            "SELECT * FROM households WHERE player_id=? ORDER BY created_at,id", (player_id,)
        ).fetchall()
        result: list[dict] = []
        for row in rows:
            household = json.loads(row["state_json"])
            household.update({"id": row["id"], "name": row["name"],
                              "residence_id": row["residence_id"], "updated_at": row["updated_at"]})
            members = self._connection.execute(
                """SELECT npc_id,private_room_id,role_json FROM household_members
                   WHERE player_id=? AND household_id=? ORDER BY joined_at,npc_id""",
                (player_id, row["id"]),
            ).fetchall()
            household["members"] = [{**json.loads(member["role_json"]), "npc_id": member["npc_id"],
                                      "private_room_id": member["private_room_id"]} for member in members]
            resources = self._connection.execute(
                """SELECT id,kind,room_id,capacity,state_json FROM household_resources
                   WHERE player_id=? AND household_id=? ORDER BY room_id,kind,id""",
                (player_id, row["id"]),
            ).fetchall()
            household["resources"] = [{"id": resource["id"], "kind": resource["kind"],
                                        "room_id": resource["room_id"], "capacity": resource["capacity"],
                                        "state": json.loads(resource["state_json"])} for resource in resources]
            result.append(household)
        return result

    def get_household(self, player_id: str, household_id: str) -> dict | None:
        return next((item for item in self.list_households(player_id) if item["id"] == household_id), None)

    def _upsert_life_action(self, player_id: str, action: dict) -> None:
        self._connection.execute(
            """INSERT INTO npc_life_actions(
                 id,player_id,npc_id,action_type,action_json,status,started_at,ends_at)
               VALUES (?,?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET action_json=excluded.action_json,status=excluded.status,
                 started_at=excluded.started_at,ends_at=excluded.ends_at,updated_at=CURRENT_TIMESTAMP""",
            (action["id"], player_id, action["npc_id"], action["type"], self._json(action),
             action["status"], action.get("started_at"), action.get("ends_at")),
        )

    def upsert_life_action(self, player_id: str, action: dict) -> dict:
        self._life_transaction(lambda: self._upsert_life_action(player_id, action))
        return action

    def _upsert_life_story(self, player_id: str, story: dict) -> None:
        story_key = str(story.get("story_key") or story["id"])
        self._connection.execute(
            """INSERT INTO life_stories(
                 id,player_id,level,story_key,story_json,status,intervention_expires_at,resolution_action)
               VALUES (?,?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET story_json=excluded.story_json,status=excluded.status,
                 intervention_expires_at=excluded.intervention_expires_at,
                 resolution_action=excluded.resolution_action,updated_at=CURRENT_TIMESTAMP""",
            (story["id"], player_id, story["level"], story_key, self._json(story), story["status"],
             story.get("intervention_expires_at"), story.get("resolution_action")),
        )

    def upsert_life_story(self, player_id: str, story: dict) -> dict:
        self._life_transaction(lambda: self._upsert_life_story(player_id, story))
        return story

    @staticmethod
    def _decode_life_story(row) -> dict:
        value = json.loads(row["story_json"])
        value.update({"id": row["id"], "level": row["level"], "status": row["status"],
                      "intervention_expires_at": row["intervention_expires_at"],
                      "resolution_action": row["resolution_action"], "created_at": row["created_at"],
                      "updated_at": row["updated_at"]})
        return value

    def list_life_stories(self, player_id: str, *, level: str | None = None,
                          status: str | None = None, npc_id: str | None = None,
                          household_id: str | None = None, game_date: str | None = None,
                          limit: int = 100) -> list[dict]:
        query = "SELECT * FROM life_stories WHERE player_id=?"
        parameters: list[object] = [player_id]
        if level:
            query += " AND level=?"; parameters.append(level)
        if status:
            query += " AND status=?"; parameters.append(status)
        if game_date:
            query += " AND date(created_at)=?"; parameters.append(game_date)
        query += " ORDER BY created_at DESC,id LIMIT ?"; parameters.append(max(1, min(500, limit)))
        stories = [self._decode_life_story(row) for row in self._connection.execute(query, parameters).fetchall()]
        if npc_id:
            stories = [story for story in stories if npc_id in story.get("participant_ids", [])]
        if household_id:
            stories = [story for story in stories if story.get("household_id") == household_id]
        observed = {row[0] for row in self._connection.execute(
            "SELECT story_id FROM life_story_observations WHERE player_id=?", (player_id,)
        ).fetchall()}
        for story in stories:
            story["observed"] = story["id"] in observed
        return stories

    def get_life_story(self, player_id: str, story_id: str) -> dict | None:
        row = self._connection.execute(
            "SELECT * FROM life_stories WHERE player_id=? AND id=?", (player_id, story_id)
        ).fetchone()
        if not row:
            return None
        story = self._decode_life_story(row)
        story["observed"] = bool(self._connection.execute(
            "SELECT 1 FROM life_story_observations WHERE player_id=? AND story_id=?",
            (player_id, story_id),
        ).fetchone())
        return story

    def observe_life_story(self, player_id: str, story_id: str) -> dict | None:
        """Observation is deliberately read-only with respect to story settlement."""
        if not self.get_life_story(player_id, story_id):
            return None
        with self._lock, self._connection:
            self._connection.execute(
                "INSERT OR IGNORE INTO life_story_observations(player_id,story_id) VALUES (?,?)",
                (player_id, story_id),
            )
        return self.get_life_story(player_id, story_id)

    def cached_life_intervention(self, player_id: str, story_id: str,
                                 idempotency_key: str) -> dict | None:
        row = self._connection.execute(
            """SELECT response_json FROM life_interventions
               WHERE player_id=? AND story_id=? AND idempotency_key=?""",
            (player_id, story_id, idempotency_key),
        ).fetchone()
        return json.loads(row[0]) if row else None

    def life_intervention_action(self, player_id: str, story_id: str,
                                 idempotency_key: str) -> str | None:
        row = self._connection.execute(
            """SELECT action FROM life_interventions
               WHERE player_id=? AND story_id=? AND idempotency_key=?""",
            (player_id, story_id, idempotency_key),
        ).fetchone()
        return str(row[0]) if row else None

    def save_life_intervention(self, player_id: str, story_id: str, idempotency_key: str,
                               action: str, response: dict) -> dict:
        with self._lock, self._connection:
            self._connection.execute(
                """INSERT OR IGNORE INTO life_interventions(
                     player_id,story_id,idempotency_key,action,response_json) VALUES (?,?,?,?,?)""",
                (player_id, story_id, idempotency_key, action, self._json(response)),
            )
        return self.cached_life_intervention(player_id, story_id, idempotency_key) or response

    def _append_relationship_evidence(self, player_id: str, evidence: dict) -> bool:
        context = evidence.get("context") or {}
        cursor = self._connection.execute(
            """INSERT OR IGNORE INTO relationship_evidence(
                 id,player_id,fact_id,source_npc_id,target_npc_id,kind,magnitude,
                 appraisal_json,deltas_json,context_json,rules_version)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (evidence["id"], player_id, evidence["fact_id"], evidence["source_npc_id"],
             evidence["target_npc_id"], evidence["kind"], float(evidence.get("magnitude", 1)),
             self._json(evidence.get("appraisal") or {}), self._json(evidence.get("deltas") or {}),
             self._json(context), str(evidence.get("rules_version") or "relationships-v2")),
        )
        return cursor.rowcount > 0

    def append_relationship_evidence(self, player_id: str, evidence: dict) -> tuple[dict, bool]:
        inserted = self._life_transaction(lambda: self._append_relationship_evidence(player_id, evidence))
        return evidence, inserted

    def list_relationship_evidence(self, player_id: str, source_npc_id: str | None = None,
                                   target_npc_id: str | None = None, limit: int = 100) -> list[dict]:
        query = "SELECT * FROM relationship_evidence WHERE player_id=?"
        parameters: list[object] = [player_id]
        if source_npc_id:
            query += " AND source_npc_id=?"; parameters.append(source_npc_id)
        if target_npc_id:
            query += " AND target_npc_id=?"; parameters.append(target_npc_id)
        query += " ORDER BY created_at DESC,id LIMIT ?"; parameters.append(max(1, min(500, limit)))
        result = []
        for row in self._connection.execute(query, parameters).fetchall():
            result.append({"id": row["id"], "fact_id": row["fact_id"],
                           "source_npc_id": row["source_npc_id"], "target_npc_id": row["target_npc_id"],
                           "kind": row["kind"], "magnitude": row["magnitude"],
                           "appraisal": json.loads(row["appraisal_json"]),
                           "deltas": json.loads(row["deltas_json"]),
                           "context": json.loads(row["context_json"]),
                           "rules_version": row["rules_version"], "created_at": row["created_at"]})
        return result

    def _save_relationship_bond(self, player_id: str, bond: dict) -> dict:
        participants = sorted(str(value) for value in bond.get("participant_ids", []) if value)
        if len(participants) != 2 or participants[0] == participants[1]:
            raise ValueError("relationship bond requires two different residents")
        pair_key = ":".join(participants)
        supplied_id = str(bond.get("id") or "")
        bond_id = (f"bond-{hashlib.sha256((player_id + chr(0) + supplied_id).encode()).hexdigest()[:20]}"
                   if supplied_id else
                   f"bond-{hashlib.sha256((player_id + chr(0) + pair_key + chr(0) + str(bond['channel']) + chr(0) + str(bond['kind'])).encode()).hexdigest()[:20]}")
        if bond.get("channel") != "structural" and bond.get("state", "active") == "active":
            self._connection.execute(
                """UPDATE npc_relationship_bonds SET state='ended',ended_at=CURRENT_TIMESTAMP,
                   updated_at=CURRENT_TIMESTAMP WHERE player_id=? AND pair_key=? AND channel=?
                   AND kind<>? AND state='active'""",
                (player_id, pair_key, bond["channel"], bond["kind"]),
            )
        self._connection.execute(
            """INSERT INTO npc_relationship_bonds(
                 id,player_id,pair_key,channel,kind,state,roles_json,scope_id,context_json,ended_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(player_id,pair_key,channel,kind) DO UPDATE SET
                 state=excluded.state,roles_json=excluded.roles_json,scope_id=excluded.scope_id,
                 context_json=excluded.context_json,ended_at=excluded.ended_at,
                 updated_at=CURRENT_TIMESTAMP""",
            (bond_id, player_id, pair_key, bond["channel"], bond["kind"], bond.get("state", "active"),
             self._json(bond.get("roles") or {}), bond.get("scope_id"),
             self._json(bond.get("context") or {}), bond.get("ended_at")),
        )
        return {**bond, "id": bond_id, "pair_key": pair_key, "participant_ids": participants}

    def save_relationship_bond(self, player_id: str, bond: dict) -> dict:
        return self._life_transaction(lambda: self._save_relationship_bond(player_id, bond))

    def list_relationship_bonds(self, player_id: str, npc_id: str | None = None) -> list[dict]:
        rows = self._connection.execute(
            "SELECT * FROM npc_relationship_bonds WHERE player_id=? ORDER BY started_at,id", (player_id,)
        ).fetchall()
        result = []
        for row in rows:
            participants = row["pair_key"].split(":", 1)
            if npc_id and npc_id not in participants:
                continue
            result.append({"id": row["id"], "pair_key": row["pair_key"],
                           "participant_ids": participants, "channel": row["channel"],
                           "kind": row["kind"], "state": row["state"],
                           "roles": json.loads(row["roles_json"]), "scope_id": row["scope_id"],
                           "context": json.loads(row["context_json"]),
                           "started_at": row["started_at"], "ended_at": row["ended_at"],
                           "updated_at": row["updated_at"]})
        return result

    def _save_relationship_pair_projection(self, player_id: str, pair: dict) -> None:
        """Project the v2 pair into legacy directional rows and queryable bonds."""
        channels = pair.get("channels") or {}
        friendship = str(channels.get("friendship") or "none")
        conflict = str(channels.get("conflict") or "none")
        legacy_status = (
            "strained" if conflict in {"friction", "open_conflict", "feud"}
            else "close_friend" if friendship == "close_friend"
            else "friend" if friendship == "friend"
            else "acquaintance" if friendship in {"emerging", "estranged"}
            else "stranger"
        )
        directions = [pair.get("a_to_b") or {}, pair.get("b_to_a") or {}]
        for edge in directions:
            npc_a, npc_b = str(edge.get("owner_id") or ""), str(edge.get("target_id") or "")
            if not npc_a or not npc_b or npc_a == npc_b:
                continue
            self._connection.execute(
                """INSERT OR IGNORE INTO npc_social_edges(player_id,npc_a,npc_b,status)
                   VALUES (?,?,?,'stranger')""", (player_id, npc_a, npc_b),
            )
            values = [max(0, min(100, int(edge.get(key, 0)))) for key in (
                "familiarity", "trust", "affinity", "respect", "comfort", "tension",
                "resentment", "attraction", "dependency", "fear",
            )]
            self._connection.execute(
                """UPDATE npc_social_edges SET familiarity=?,trust=?,affinity=?,respect=?,comfort=?,
                   tension=?,resentment=?,attraction=?,dependency=?,fear=?,friendship_status=?,
                   conflict_status=?,status=?,relationship_version=2,updated_at=CURRENT_TIMESTAMP
                   WHERE player_id=? AND npc_a=? AND npc_b=?""",
                (*values, friendship, conflict, legacy_status, player_id, npc_a, npc_b),
            )
        for bond in pair.get("structural_bonds", []):
            self._save_relationship_bond(player_id, {
                "id": bond.get("bond_id"), "participant_ids": bond.get("participant_ids", []),
                "channel": "structural", "kind": bond.get("kind"),
                "state": "active" if bond.get("active", True) else "ended",
                "roles": bond.get("roles") or {}, "scope_id": bond.get("scope_id"),
            })
        pair_key = ":".join(sorted((str(pair["resident_a_id"]), str(pair["resident_b_id"]))))
        self._connection.execute(
            """UPDATE npc_relationship_bonds SET state='ended',ended_at=CURRENT_TIMESTAMP,
               updated_at=CURRENT_TIMESTAMP WHERE player_id=? AND pair_key=?
               AND channel IN ('friendship','conflict','rivalry','romance') AND state='active'""",
            (player_id, pair_key),
        )
        for channel in ("friendship", "conflict", "rivalry", "romance"):
            state = str(channels.get(channel) or "none")
            if state == "none":
                continue
            self._save_relationship_bond(player_id, {
                "participant_ids": [pair["resident_a_id"], pair["resident_b_id"]],
                "channel": channel, "kind": state, "state": "active",
                "context": {"history": channels.get("history", [])},
            })

    def save_relationship_pair_projection(self, player_id: str, pair: dict) -> dict:
        self._life_transaction(lambda: self._save_relationship_pair_projection(player_id, pair))
        return pair

    def save_life_world_state_and_projections(
        self, player_id: str, state: dict, *, rules_version: str,
        last_advanced_at: str, next_transition_at: str | None,
        expected_revision: int | None = None,
        households: list[dict] | None = None, actions: list[dict] | None = None,
        stories: list[dict] | None = None, evidence: list[dict] | None = None,
        relationship_pairs: list[dict] | None = None,
    ) -> dict:
        """Atomically persist the authoritative snapshot and every v2 projection.

        The world JSON remains authoritative, but its query projections are
        committed at the same SQLite boundary. A projection error therefore
        rolls back the revision as well as every projection row, so a retry can
        safely use the same ``expected_revision``.
        """
        def write():
            self._write_life_world_state(
                player_id, state, rules_version=rules_version,
                last_advanced_at=last_advanced_at, next_transition_at=next_transition_at,
                expected_revision=expected_revision,
            )
            if households is not None:
                current_household_ids = {str(household["id"]) for household in households}
                self._delete_stale_household_projections(player_id, current_household_ids)
                for household in households:
                    self._upsert_household_projection(player_id, household)
            for action in actions or []:
                self._upsert_life_action(player_id, action)
            for story in stories or []:
                self._upsert_life_story(player_id, story)
            for item in evidence or []:
                self._append_relationship_evidence(player_id, item)
            for pair in relationship_pairs or []:
                self._save_relationship_pair_projection(player_id, pair)
            return self.get_life_world_state(player_id)

        return self._life_transaction(write)  # type: ignore[return-value]

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
            """SELECT npc_a,npc_b,familiarity,trust,affinity,respect,comfort,tension,
                      resentment,attraction,dependency,fear,friendship_status,conflict_status,status
               FROM npc_social_edges WHERE player_id=? ORDER BY npc_a,npc_b""",
            (player_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    def save_social_edge(self, player_id: str, npc_a: str, npc_b: str, **values: int) -> dict:
        if npc_a == npc_b:
            raise ValueError("a social edge requires two different residents")
        self.ensure_social_edges(player_id, [npc_a, npc_b])
        allowed_dimensions = {
            "familiarity", "trust", "affinity", "respect", "comfort", "tension",
            "resentment", "attraction", "dependency", "fear",
        }
        allowed = {key: max(0, min(100, int(value))) for key, value in values.items()
                   if key in allowed_dimensions}
        with self._lock, self._connection:
            if allowed:
                assignments = ",".join(f"{key}=?" for key in allowed)
                self._connection.execute(
                    f"UPDATE npc_social_edges SET {assignments},updated_at=CURRENT_TIMESTAMP WHERE player_id=? AND npc_a=? AND npc_b=?",
                    (*allowed.values(), player_id, npc_a, npc_b),
                )
            row = self._connection.execute(
                """SELECT npc_a,npc_b,familiarity,trust,affinity,respect,comfort,tension,
                          resentment,attraction,dependency,fear,friendship_status,conflict_status,status
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
