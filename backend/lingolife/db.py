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

from .chat_journal import (ChatRequestConflict, ChatTurnClaim,
                           ChatTurnLeaseLost, request_fingerprint)
from .events import ActiveEvent, EventHistory, event_to_dict
from .learning import LearningState
from .models import Stats
from .migration_audit import (
    MIGRATION_PROJECTION_TABLES,
    MIGRATION_VERSION,
    compare_player_fact_snapshots,
    inspect_player_integrity,
    player_fact_snapshot,
    roster_review,
)
from .profile_contract import (
    CURRENT_INTRO_VERSION,
    ONBOARDING_STATE_VERSION,
    normalize_profile_contract,
)
from .social import social_animation_cues, social_status


class LifeWorldRevisionConflict(RuntimeError):
    """The authoritative life world changed after a caller read it."""


class WorldLayoutDraftConflict(RuntimeError):
    """The authoring draft changed after an editor loaded its revision."""

    def __init__(self, current_revision: int):
        self.current_revision = current_revision
        super().__init__(f"world layout draft is at revision {current_revision}")


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
        "chat_turn_journal",
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
        "player_roster_migrations",
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
            CREATE TABLE IF NOT EXISTS chat_turn_journal (
              player_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,npc_id TEXT NOT NULL,
              message TEXT NOT NULL,request_hash TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'registered',owner_token TEXT,lease_expires_at TEXT,
              response_json TEXT,effects_json TEXT,db_applied_at TEXT,life_applied_at TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY(player_id,idempotency_key));
            CREATE INDEX IF NOT EXISTS idx_chat_turn_journal_status
              ON chat_turn_journal(status,lease_expires_at);
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
            CREATE TABLE IF NOT EXISTS player_roster_migrations (
              player_id TEXT PRIMARY KEY,migration_version TEXT NOT NULL,
              status TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,
              active_npc_ids_json TEXT NOT NULL DEFAULT '[]',
              archived_npc_ids_json TEXT NOT NULL DEFAULT '[]',
              baseline_snapshot_json TEXT NOT NULL,latest_snapshot_json TEXT NOT NULL,
              review_json TEXT NOT NULL,integrity_json TEXT NOT NULL,
              completed_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE INDEX IF NOT EXISTS idx_roster_migrations_status
              ON player_roster_migrations(status,updated_at);
            CREATE TABLE IF NOT EXISTS roster_migration_reports (
              id TEXT PRIMARY KEY,player_id TEXT NOT NULL,migration_version TEXT NOT NULL,
              action TEXT NOT NULL,status TEXT NOT NULL,revision INTEGER NOT NULL,
              actor TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',request_key TEXT,
              before_snapshot_json TEXT NOT NULL,after_snapshot_json TEXT NOT NULL,
              comparison_json TEXT NOT NULL,review_json TEXT NOT NULL,
              integrity_json TEXT NOT NULL,error_code TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(player_id,request_key));
            CREATE INDEX IF NOT EXISTS idx_roster_reports_owner
              ON roster_migration_reports(player_id,created_at,id);
            CREATE TABLE IF NOT EXISTS world_layout_configs (
              scope TEXT PRIMARY KEY,layout_json TEXT NOT NULL,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS world_layout_drafts (
              scope TEXT PRIMARY KEY CHECK(scope='global'),layout_json TEXT NOT NULL,
              layout_hash TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,
              author TEXT NOT NULL,validation_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS world_layout_versions (
              id TEXT PRIMARY KEY,layout_hash TEXT NOT NULL UNIQUE,layout_json TEXT NOT NULL,
              note TEXT NOT NULL,author TEXT NOT NULL,is_default INTEGER NOT NULL DEFAULT 0,
              validation_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS world_layout_active (
              scope TEXT PRIMARY KEY CHECK(scope='global'),version_id TEXT NOT NULL,
              activated_by TEXT NOT NULL,activation_note TEXT NOT NULL,
              activated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS world_layout_audit (
              id INTEGER PRIMARY KEY AUTOINCREMENT,action TEXT NOT NULL,
              version_id TEXT,previous_version_id TEXT,note TEXT NOT NULL,
              author TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
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
            if not self._connection.execute(
                "SELECT 1 FROM schema_migrations WHERE version=4"
            ).fetchone():
                legacy_layout = self._connection.execute(
                    "SELECT layout_json FROM world_layout_configs WHERE scope='published'"
                ).fetchone()
                if legacy_layout:
                    try:
                        normalized = self._json(json.loads(legacy_layout["layout_json"]))
                    except (TypeError, ValueError, json.JSONDecodeError):
                        normalized = legacy_layout["layout_json"]
                    layout_hash = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
                    version_id = f"layout-{layout_hash}"
                    self._connection.execute(
                        """INSERT OR IGNORE INTO world_layout_versions(
                             id,layout_hash,layout_json,note,author,validation_json)
                           VALUES (?,?,?,?,?,?)""",
                        (version_id, layout_hash, normalized, "迁移旧版已发布布局",
                         "migration-v4", self._json({"migrated": True})),
                    )
                    self._connection.execute(
                        """INSERT INTO world_layout_active(
                             scope,version_id,activated_by,activation_note)
                           VALUES ('global',?,?,?)
                           ON CONFLICT(scope) DO UPDATE SET
                             version_id=excluded.version_id,
                             activated_by=excluded.activated_by,
                             activation_note=excluded.activation_note,
                             activated_at=CURRENT_TIMESTAMP""",
                        (version_id, "migration-v4", "迁移旧版已发布布局"),
                    )
                self._connection.execute(
                    "INSERT OR IGNORE INTO schema_migrations(version,description) "
                    "VALUES (4,'immutable world layout authoring and publication')"
                )
            # The intro contract lives inside the existing JSON state.  Backfill
            # completed v3 rows in place without a schema migration or a new
            # compatibility rule; their original completion timestamp is the
            # most accurate acknowledgement time available.
            for onboarding_row in self._connection.execute(
                "SELECT player_id,state_json,completed_at FROM player_onboarding"
            ).fetchall():
                stored = json.loads(onboarding_row["state_json"] or "{}")
                changed = stored.get("version") != ONBOARDING_STATE_VERSION
                stored["version"] = ONBOARDING_STATE_VERSION
                if onboarding_row["completed_at"] and not stored.get("intro_acknowledged_at"):
                    stored["intro_version"] = CURRENT_INTRO_VERSION
                    stored["intro_acknowledged_at"] = onboarding_row["completed_at"]
                    changed = True
                if changed:
                    self._connection.execute(
                        "UPDATE player_onboarding SET state_json=? WHERE player_id=?",
                        (self._json(stored), onboarding_row["player_id"]),
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
            if not self._connection.execute(
                "SELECT 1 FROM schema_migrations WHERE version=5"
            ).fetchone():
                # Inventory every account that predates this migration boundary.
                # A broken player save must not prevent the server from starting;
                # it is recorded as blocked for explicit administrator repair.
                legacy_players = self._connection.execute(
                    "SELECT id FROM players ORDER BY created_at,id"
                ).fetchall()
                for legacy_player in legacy_players:
                    self._inventory_roster_migration(
                        str(legacy_player["id"]), actor="migration-v5",
                        note="首次盘点旧账号并迁移到单一共享住宅规则",
                    )
                self._connection.execute(
                    "INSERT OR IGNORE INTO schema_migrations(version,description) "
                    "VALUES (5,'audited single-household roster migration')"
                )
            self._connection.execute(
                "INSERT OR IGNORE INTO schema_migrations(version,description) "
                "VALUES (6,'durable idempotent chat turn journal')"
            )

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
            "SELECT id,username,player_id,disabled,daily_quota,bonus_credits,created_at,last_active_at FROM users WHERE username LIKE ? ORDER BY created_at DESC LIMIT 200",
            (f"%{query}%",),
        ).fetchall()
        result = []
        for row in rows:
            migration = self.roster_migration(str(row["player_id"]))
            compact_migration = None if migration is None else {
                "migration_version": migration["migration_version"],
                "status": migration["status"], "revision": migration["revision"],
                "active_resident_count": len(migration["active_npc_ids"]),
                "archived_resident_count": len(migration["archived_npc_ids"]),
                "total_resident_count": len(migration["candidates"]),
            }
            result.append({**dict(row), "quota": self.quota(row["id"]),
                           "roster_migration": compact_migration})
        return result

    # Audited legacy roster migration --------------------------------------

    @staticmethod
    def _decode_roster_migration(row: sqlite3.Row | None) -> dict | None:
        if row is None:
            return None
        return {
            "player_id": str(row["player_id"]),
            "migration_version": str(row["migration_version"]),
            "status": str(row["status"]),
            "revision": int(row["revision"]),
            "active_npc_ids": json.loads(row["active_npc_ids_json"] or "[]"),
            "archived_npc_ids": json.loads(row["archived_npc_ids_json"] or "[]"),
            "baseline_snapshot": json.loads(row["baseline_snapshot_json"]),
            "latest_snapshot": json.loads(row["latest_snapshot_json"]),
            "review": json.loads(row["review_json"]),
            "integrity": json.loads(row["integrity_json"]),
            "completed_at": row["completed_at"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def _write_roster_migration_report(
        self, *, player_id: str, action: str, status: str, revision: int,
        actor: str, note: str, before: dict, after: dict, comparison: dict,
        review: dict, integrity: dict, request_key: str | None = None,
        error_code: str | None = None,
    ) -> None:
        self._connection.execute(
            """INSERT INTO roster_migration_reports(
                 id,player_id,migration_version,action,status,revision,actor,note,
                 request_key,before_snapshot_json,after_snapshot_json,
                 comparison_json,review_json,integrity_json,error_code)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                "roster-audit-" + uuid.uuid4().hex, player_id, MIGRATION_VERSION,
                action, status, revision, actor.strip()[:80] or "system",
                note.strip()[:240], request_key,
                self._json(before), self._json(after), self._json(comparison),
                self._json(review), self._json(integrity), error_code,
            ),
        )

    def _inventory_roster_migration(
        self, player_id: str, *, actor: str, note: str,
    ) -> dict:
        existing = self._connection.execute(
            "SELECT * FROM player_roster_migrations WHERE player_id=?", (player_id,),
        ).fetchone()
        if existing:
            return self._decode_roster_migration(existing)  # type: ignore[return-value]

        before = player_fact_snapshot(self._connection, player_id)
        review = roster_review(before)
        try:
            integrity = inspect_player_integrity(self._connection, player_id)
        except Exception as error:  # A malformed legacy fixture is isolated to its owner.
            integrity = {
                "valid": False,
                "issues": [{"code": "AUDIT_READ_FAILED", "detail": type(error).__name__}],
            }
        if not integrity["valid"]:
            status = "blocked_invalid_fixture"
            active_ids: list[str] = []
        elif review["status"] == "eligible":
            status = "ready"
            active_ids = list(review["preserved_npc_ids"])
        else:
            status = str(review["status"])
            active_ids = list(review["preserved_npc_ids"]) if status == "needs_onboarding" else []
        archived_ids: list[str] = []
        after = player_fact_snapshot(self._connection, player_id)
        comparison = compare_player_fact_snapshots(before, after)
        completed = status == "ready" and comparison["verified"]
        self._connection.execute(
            """INSERT INTO player_roster_migrations(
                 player_id,migration_version,status,revision,active_npc_ids_json,
                 archived_npc_ids_json,baseline_snapshot_json,latest_snapshot_json,
                 review_json,integrity_json,completed_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END)""",
            (
                player_id, MIGRATION_VERSION, status, 1, self._json(active_ids),
                self._json(archived_ids), self._json(before), self._json(after),
                self._json(review), self._json(integrity), int(completed),
            ),
        )
        self._write_roster_migration_report(
            player_id=player_id, action="inventory", status=status, revision=1,
            actor=actor, note=note, before=before, after=after,
            comparison=comparison, review=review, integrity=integrity,
            request_key=f"inventory:{MIGRATION_VERSION}",
            error_code=None if integrity["valid"] else "INVALID_LEGACY_FIXTURE",
        )
        row = self._connection.execute(
            "SELECT * FROM player_roster_migrations WHERE player_id=?", (player_id,),
        ).fetchone()
        return self._decode_roster_migration(row)  # type: ignore[return-value]

    def inventory_roster_migration(
        self, player_id: str, *, actor: str = "admin", note: str = "手动盘点旧账号",
    ) -> dict:
        """Idempotently inventory one pre-v5 account without changing game facts."""
        return self._life_transaction(
            lambda: self._inventory_roster_migration(player_id, actor=actor, note=note)
        )

    def roster_migration(self, player_id: str) -> dict | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM player_roster_migrations WHERE player_id=?", (player_id,),
            ).fetchone()
            value = self._decode_roster_migration(row)
            if value is None:
                return None
            report_count = int(self._connection.execute(
                "SELECT count(*) FROM roster_migration_reports WHERE player_id=?", (player_id,),
            ).fetchone()[0])
            profile_rows = self._connection.execute(
                "SELECT npc_id,profile_json FROM npc_profiles WHERE player_id=? ORDER BY created_at,npc_id",
                (player_id,),
            ).fetchall()
        active = set(value["active_npc_ids"])
        archived = set(value["archived_npc_ids"])
        value["report_count"] = report_count
        candidates = []
        for profile_row in profile_rows:
            npc_id = str(profile_row["npc_id"])
            try:
                profile_value = json.loads(profile_row["profile_json"] or "{}")
                name = str(profile_value.get("name") or npc_id) if isinstance(profile_value, dict) else npc_id
            except (TypeError, ValueError, json.JSONDecodeError):
                name = npc_id
            candidates.append({
                "id": npc_id, "name": name,
                "active": npc_id in active, "archived": npc_id in archived,
            })
        value["candidates"] = candidates
        return value

    def roster_migration_for_user(self, user_id: str) -> dict | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT player_id,username FROM users WHERE id=?", (user_id,),
            ).fetchone()
        if not row:
            return None
        value = self.roster_migration(str(row["player_id"]))
        if value:
            value["user_id"] = user_id
            value["username"] = row["username"]
            value["reports"] = self.roster_migration_reports(str(row["player_id"]))
        return value

    def roster_migration_reports_for_user(self, user_id: str) -> dict | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT player_id,username FROM users WHERE id=?", (user_id,),
            ).fetchone()
        if not row:
            return None
        return {
            "user_id": user_id, "username": row["username"],
            "player_id": row["player_id"],
            "reports": self.roster_migration_reports(str(row["player_id"])),
        }

    def list_roster_migrations(self, status: str | None = None) -> list[dict]:
        parameters: tuple[object, ...] = ()
        predicate = ""
        if status:
            predicate = "WHERE migrations.status=?"
            parameters = (status,)
        with self._lock:
            rows = self._connection.execute(
                f"""SELECT migrations.player_id,users.id AS user_id,users.username
                    FROM player_roster_migrations migrations
                    LEFT JOIN users ON users.player_id=migrations.player_id
                    {predicate}
                    ORDER BY CASE migrations.status
                      WHEN 'needs_roster_review' THEN 0
                      WHEN 'blocked_invalid_fixture' THEN 1 ELSE 2 END,
                      migrations.updated_at DESC,migrations.player_id""",
                parameters,
            ).fetchall()
        result = []
        for row in rows:
            value = self.roster_migration(str(row["player_id"]))
            if value:
                value["user_id"] = row["user_id"]
                value["username"] = row["username"]
                result.append(value)
        return result

    def roster_migration_reports(self, player_id: str, limit: int = 100) -> list[dict]:
        with self._lock:
            rows = self._connection.execute(
                """SELECT * FROM roster_migration_reports WHERE player_id=?
                   ORDER BY rowid DESC LIMIT ?""",
                (player_id, max(1, min(500, int(limit)))),
            ).fetchall()
        return [
            {
                "id": row["id"], "player_id": row["player_id"],
                "migration_version": row["migration_version"], "action": row["action"],
                "status": row["status"], "revision": int(row["revision"]),
                "actor": row["actor"], "note": row["note"],
                "request_key": row["request_key"],
                "before_snapshot": json.loads(row["before_snapshot_json"]),
                "after_snapshot": json.loads(row["after_snapshot_json"]),
                "comparison": json.loads(row["comparison_json"]),
                "review": json.loads(row["review_json"]),
                "integrity": json.loads(row["integrity_json"]),
                "error_code": row["error_code"], "created_at": row["created_at"],
            }
            for row in rows
        ]

    def select_active_roster(
        self, user_id: str, active_npc_ids: list[str], *, expected_revision: int,
        confirm_username: str, actor: str = "admin", note: str = "管理员确认模拟阵容",
        request_key: str | None = None,
    ) -> dict:
        """Select 2-8 simulated residents and archive the rest without deletion."""
        requested = sorted(str(value) for value in active_npc_ids)
        if len(requested) != len(set(requested)):
            raise ValueError("DUPLICATE_NPC_ID")
        if not 2 <= len(requested) <= 8:
            raise ValueError("ACTIVE_ROSTER_SIZE")

        def write():
            user = self._connection.execute(
                "SELECT id,username,player_id FROM users WHERE id=?", (user_id,),
            ).fetchone()
            if not user:
                raise ValueError("USER_NOT_FOUND")
            if self._username_confirmation_key(confirm_username) != self._username_confirmation_key(
                user["username"]
            ):
                raise ValueError("USERNAME_CONFIRMATION_MISMATCH")
            current_row = self._connection.execute(
                "SELECT * FROM player_roster_migrations WHERE player_id=?", (user["player_id"],),
            ).fetchone()
            if not current_row:
                raise ValueError("ROSTER_MIGRATION_NOT_FOUND")
            current = self._decode_roster_migration(current_row)
            assert current is not None
            if current["status"] in {"blocked_invalid_fixture", "blocked_verification_failed"}:
                raise ValueError("INVALID_LEGACY_FIXTURE")
            if current["status"] == "ready" and requested == sorted(current["active_npc_ids"]):
                return {**current, "idempotent_replay": True}
            if request_key and self._connection.execute(
                "SELECT 1 FROM roster_migration_reports WHERE player_id=? AND request_key=?",
                (user["player_id"], f"selection:{request_key}"),
            ).fetchone():
                raise ValueError("ROSTER_REQUEST_CONFLICT")
            if int(current["revision"]) != int(expected_revision):
                raise ValueError("ROSTER_REVISION_CONFLICT")
            all_ids = sorted(current["baseline_snapshot"]["preserved_npc_ids"])
            if not set(requested) <= set(all_ids):
                raise ValueError("UNKNOWN_NPC_ID")
            archived = sorted(set(all_ids) - set(requested))
            before = player_fact_snapshot(self._connection, str(user["player_id"]))
            integrity = inspect_player_integrity(self._connection, str(user["player_id"]))
            if not integrity["valid"]:
                raise ValueError("INVALID_LEGACY_FIXTURE")
            revision = int(current["revision"]) + 1
            self._connection.execute(
                """UPDATE player_roster_migrations SET status='ready',revision=?,
                     active_npc_ids_json=?,archived_npc_ids_json=?,latest_snapshot_json=?,
                     integrity_json=?,completed_at=COALESCE(completed_at,CURRENT_TIMESTAMP),
                     updated_at=CURRENT_TIMESTAMP WHERE player_id=?""",
                (
                    revision, self._json(requested), self._json(archived),
                    self._json(before), self._json(integrity), user["player_id"],
                ),
            )
            after = player_fact_snapshot(self._connection, str(user["player_id"]))
            comparison = compare_player_fact_snapshots(before, after)
            if not comparison["verified"]:
                raise RuntimeError("ROSTER_FACT_VERIFICATION_FAILED")
            review = {
                **current["review"], "status": "resolved", "active_npc_ids": requested,
                "archived_npc_ids": archived, "active_selection_required": False,
            }
            self._connection.execute(
                "UPDATE player_roster_migrations SET review_json=?,latest_snapshot_json=? WHERE player_id=?",
                (self._json(review), self._json(after), user["player_id"]),
            )
            self._write_roster_migration_report(
                player_id=str(user["player_id"]), action="select_active_roster",
                status="ready", revision=revision, actor=actor, note=note,
                before=before, after=after, comparison=comparison,
                review=review, integrity=integrity,
                request_key=(f"selection:{request_key}" if request_key else None),
            )
            row = self._connection.execute(
                "SELECT * FROM player_roster_migrations WHERE player_id=?", (user["player_id"],),
            ).fetchone()
            return {**self._decode_roster_migration(row), "idempotent_replay": False}

        result = self._life_transaction(write)
        # Add names and report count only after the transaction commits.
        hydrated = self.roster_migration(str(result["player_id"]))
        assert hydrated is not None
        hydrated["idempotent_replay"] = bool(result.get("idempotent_replay"))
        return hydrated

    def verify_roster_world_reconciliation(
        self, player_id: str, *, actor: str = "system",
        note: str = "验证共享住宅世界重建未丢失旧存档事实",
    ) -> dict | None:
        """Persist a once-only post-world checksum after projections are rebuilt."""
        dynamic_tables = set(MIGRATION_PROJECTION_TABLES) | {
            "npc_personas", "npc_runtime_states", "npc_relationships", "npc_goals",
            "npc_daily_plans", "npc_social_edges", "npc_social_events", "npc_desires",
            "npc_life_actions", "life_stories", "life_story_observations",
            "life_interventions", "unresolved_threads", "npc_relationship_bonds",
            "relationship_evidence",
        }

        def write():
            row = self._connection.execute(
                "SELECT * FROM player_roster_migrations WHERE player_id=?", (player_id,),
            ).fetchone()
            current = self._decode_roster_migration(row)
            if current is None or current["status"] != "ready":
                return current
            if current["review"].get("world_verified"):
                return current
            before = dict(current["baseline_snapshot"])
            after = player_fact_snapshot(self._connection, player_id)
            integrity = inspect_player_integrity(self._connection, player_id)
            comparison = compare_player_fact_snapshots(
                before, after, allowed_changed_tables=dynamic_tables,
            )
            # Projection tables may legitimately collapse from many homes to
            # one. Derived simulation tables may update or grow, but losing
            # rows from them is never accepted as a migration side effect.
            lost_dynamic_rows = [
                {**change, "reason": "derived_rows_removed"}
                for change in comparison["changed_tables"]
                if change["table"] in dynamic_tables - set(MIGRATION_PROJECTION_TABLES)
                and int(change["after_count"]) < int(change["before_count"])
            ]
            if lost_dynamic_rows:
                comparison["unexpected_changes"].extend(lost_dynamic_rows)
                comparison["verified"] = False
            preserved_ids = sorted(before.get("preserved_npc_ids") or [])
            ids_preserved = preserved_ids == sorted(after.get("preserved_npc_ids") or [])
            verified = bool(comparison["verified"] and integrity["valid"] and ids_preserved)
            status = "ready" if verified else "blocked_verification_failed"
            revision = int(current["revision"]) + 1
            review = {
                **current["review"], "world_verified": verified,
                "world_verified_at_revision": revision,
                "all_legacy_npc_ids_preserved": ids_preserved,
            }
            self._connection.execute(
                """UPDATE player_roster_migrations SET status=?,revision=?,
                     latest_snapshot_json=?,review_json=?,integrity_json=?,
                     updated_at=CURRENT_TIMESTAMP WHERE player_id=?""",
                (status, revision, self._json(after), self._json(review),
                 self._json(integrity), player_id),
            )
            self._write_roster_migration_report(
                player_id=player_id, action="verify_shared_household", status=status,
                revision=revision, actor=actor, note=note, before=before, after=after,
                comparison=comparison, review=review, integrity=integrity,
                request_key=f"world-verification:{MIGRATION_VERSION}",
                error_code=None if verified else "FACT_VERIFICATION_FAILED",
            )
            updated = self._connection.execute(
                "SELECT * FROM player_roster_migrations WHERE player_id=?", (player_id,),
            ).fetchone()
            return self._decode_roster_migration(updated)

        return self._life_transaction(write)

    def simulation_npc_profiles(self, player_id: str) -> list[dict]:
        profiles = self.list_npc_profiles(player_id)
        migration = self.roster_migration(player_id)
        if migration is None:
            return profiles
        if migration["status"] != "ready":
            raise ValueError("ROSTER_MIGRATION_REQUIRED")
        by_id = {entry["id"]: entry for entry in profiles}
        active_ids = list(migration["active_npc_ids"])
        if not 2 <= len(active_ids) <= 8 or any(npc_id not in by_id for npc_id in active_ids):
            raise ValueError("ROSTER_MIGRATION_INVALID")
        return [by_id[npc_id] for npc_id in active_ids]

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
                "users", "agent_turn_traces", "roster_migration_reports",
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

    @staticmethod
    def _decode_chat_turn(row: sqlite3.Row | None) -> dict | None:
        if row is None:
            return None
        value = dict(row)
        for field in ("response_json", "effects_json"):
            encoded = value.pop(field, None)
            value[field.removesuffix("_json")] = json.loads(encoded) if encoded else None
        return value

    def register_chat_turn(self, player_id: str, key: str, npc_id: str,
                           message: str) -> dict:
        """Persist and validate the immutable identity of one chat command.

        A journal row is created before quota reservation or model generation,
        which means a cached response can never be replayed for a different
        character or message.  A legacy ``chat_requests`` row is adopted on
        first replay so databases created before the journal remain usable.
        Legacy rows never stored the original player message, so that one-time
        adoption can validate the NPC from the response but must pin the first
        supplied normalized message as its future fingerprint.
        """
        fingerprint = request_fingerprint(npc_id, message)
        with self._lock, self._connection:
            row = self._connection.execute(
                "SELECT * FROM chat_turn_journal WHERE player_id=? AND idempotency_key=?",
                (player_id, key),
            ).fetchone()
            if row is not None:
                if str(row["request_hash"]) != fingerprint:
                    raise ChatRequestConflict(
                        "idempotency key was reused with a different npc or message"
                    )
                return self._decode_chat_turn(row)  # type: ignore[return-value]

            legacy = self._connection.execute(
                "SELECT response_json FROM chat_requests WHERE player_id=? AND idempotency_key=?",
                (player_id, key),
            ).fetchone()
            if legacy is not None:
                response = json.loads(legacy["response_json"])
                legacy_npc = str(response.get("npc_id") or "emma")
                if legacy_npc != npc_id:
                    raise ChatRequestConflict(
                        "idempotency key was reused for a different npc"
                    )
                self._connection.execute(
                    """INSERT OR IGNORE INTO chat_turn_journal(
                         player_id,idempotency_key,npc_id,message,request_hash,status,
                         response_json,effects_json,db_applied_at,life_applied_at)
                       VALUES (?,?,?,?,?,'completed',?,'{}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)""",
                    (player_id, key, npc_id, message, fingerprint,
                     self._json(response)),
                )
            else:
                self._connection.execute(
                    """INSERT OR IGNORE INTO chat_turn_journal(
                         player_id,idempotency_key,npc_id,message,request_hash,status)
                       VALUES (?,?,?,?,?,'registered')""",
                    (player_id, key, npc_id, message, fingerprint),
                )
            row = self._connection.execute(
                "SELECT * FROM chat_turn_journal WHERE player_id=? AND idempotency_key=?",
                (player_id, key),
            ).fetchone()
            if row is None or str(row["request_hash"]) != fingerprint:
                raise ChatRequestConflict(
                    "idempotency key was reused with a different npc or message"
                )
            return self._decode_chat_turn(row)  # type: ignore[return-value]

    def get_chat_turn(self, player_id: str, key: str) -> dict | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM chat_turn_journal WHERE player_id=? AND idempotency_key=?",
                (player_id, key),
            ).fetchone()
        return self._decode_chat_turn(row)

    def claim_chat_turn(self, player_id: str, key: str, owner_token: str,
                        lease_seconds: int = 180) -> ChatTurnClaim:
        """Acquire the durable single-generator lease for a player's chat.

        Chat effects contain player-global learning state as well as NPC state,
        so all turns for one player are serialized.  The write reservation is
        taken before inspecting peers, making this election safe across worker
        processes rather than only across threads in this Python process.
        """
        lease_seconds = max(30, min(900, int(lease_seconds)))
        lease_modifier = f"+{lease_seconds} seconds"
        with self._lock:
            self._connection.execute("BEGIN IMMEDIATE")
            try:
                row = self._connection.execute(
                    "SELECT * FROM chat_turn_journal WHERE player_id=? AND idempotency_key=?",
                    (player_id, key),
                ).fetchone()
                if row is None:
                    raise KeyError((player_id, key))
                if row["response_json"]:
                    result = ChatTurnClaim("committed")
                else:
                    lease_is_live = bool(row["owner_token"]) and bool(
                        self._connection.execute(
                            "SELECT datetime(?) > CURRENT_TIMESTAMP",
                            (row["lease_expires_at"],),
                        ).fetchone()[0]
                    )
                    if lease_is_live and row["owner_token"] != owner_token:
                        result = ChatTurnClaim("busy", str(row["owner_token"]))
                    else:
                        blocker = self._connection.execute(
                            """SELECT idempotency_key,response_json FROM chat_turn_journal
                               WHERE player_id=? AND idempotency_key<>? AND (
                                 (response_json IS NULL AND owner_token IS NOT NULL
                                  AND datetime(lease_expires_at)>CURRENT_TIMESTAMP)
                                 OR (response_json IS NOT NULL AND status<>'completed')
                               )
                               ORDER BY created_at,idempotency_key LIMIT 1""",
                            (player_id, key),
                        ).fetchone()
                        if blocker is not None:
                            result = ChatTurnClaim(
                                "blocked", blocking_key=str(blocker["idempotency_key"]),
                            )
                        else:
                            self._connection.execute(
                                """UPDATE chat_turn_journal SET status='generating',owner_token=?,
                                     lease_expires_at=datetime('now',?),updated_at=CURRENT_TIMESTAMP
                                   WHERE player_id=? AND idempotency_key=?""",
                                (owner_token, lease_modifier, player_id, key),
                            )
                            result = ChatTurnClaim("acquired", owner_token)
                self._connection.commit()
                return result
            except Exception:
                self._connection.rollback()
                raise

    def release_chat_turn(self, player_id: str, key: str, owner_token: str) -> None:
        """Make a failed pre-commit generation immediately retryable."""
        with self._lock, self._connection:
            self._connection.execute(
                """UPDATE chat_turn_journal SET status='registered',owner_token=NULL,
                     lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP
                   WHERE player_id=? AND idempotency_key=? AND owner_token=?
                     AND response_json IS NULL""",
                (player_id, key, owner_token),
            )

    def commit_chat_with_effects(self, player_id: str, key: str, owner_token: str,
                                 message: str, response: dict, effects: dict,
                                 npc_id: str = "emma") -> tuple[dict, bool]:
        """Atomically publish a response and the durable effects to be applied.

        No learning, event, memory, persona, or world mutation is allowed
        before this boundary.  Once this commits, any process can finish the
        outbox from ``effects_json`` without invoking the dialogue model again.
        """
        with self._lock, self._connection:
            journal = self._connection.execute(
                "SELECT * FROM chat_turn_journal WHERE player_id=? AND idempotency_key=?",
                (player_id, key),
            ).fetchone()
            if journal is None:
                raise KeyError((player_id, key))
            if journal["response_json"]:
                return json.loads(journal["response_json"]), False
            if journal["owner_token"] != owner_token:
                raise ChatTurnLeaseLost("chat generation lease was lost before commit")
            stats = response["stats"]
            self._connection.execute(
                """UPDATE npc_states SET relationship=?,mood=?,english_xp=?,
                     updated_at=CURRENT_TIMESTAMP WHERE player_id=? AND npc_id=?""",
                (stats["relationship"], stats["mood"], stats["english_xp"],
                 player_id, npc_id),
            )
            self._connection.execute(
                "INSERT INTO messages(player_id,speaker,text,npc_id) VALUES (?,'player',?,?)",
                (player_id, message, npc_id),
            )
            self._connection.execute(
                """INSERT INTO messages(player_id,speaker,text,npc_id,translation)
                   VALUES (?,'npc',?,?,?)""",
                (player_id, response["npc_reply"], npc_id,
                 response.get("npc_reply_zh") or None),
            )
            encoded_response = self._json(response)
            self._connection.execute(
                """INSERT INTO chat_requests(idempotency_key,player_id,response_json)
                   VALUES (?,?,?)""",
                (key, player_id, encoded_response),
            )
            self._connection.execute(
                """UPDATE chat_turn_journal SET status='committed',response_json=?,
                     effects_json=?,owner_token=NULL,lease_expires_at=NULL,
                     updated_at=CURRENT_TIMESTAMP
                   WHERE player_id=? AND idempotency_key=?""",
                (encoded_response, self._json(effects), player_id, key),
            )
            return response, True

    def _insert_chat_memory(self, player_id: str, npc_id: str, memory: dict) -> None:
        content = " ".join(str(memory.get("content") or "").split())[:500]
        if not content:
            return
        importance = max(1, min(5, int(memory.get("importance", 1))))
        confidence = max(0.0, min(1.0, float(memory.get("confidence", 1))))
        existing = self._connection.execute(
            """SELECT * FROM npc_memories WHERE player_id=? AND npc_id=?
               AND lower(content)=lower(?)""",
            (player_id, npc_id, content),
        ).fetchone()
        if existing:
            self._connection.execute(
                """UPDATE npc_memories SET importance=max(importance,?),
                   confidence=max(confidence,?) WHERE id=?""",
                (importance, confidence, existing["id"]),
            )
            return
        access_stage = str(memory.get("access_stage") or "stranger")
        if access_stage not in {"stranger", "acquaintance", "friend", "close_friend"}:
            access_stage = "stranger"
        cursor = self._connection.execute(
            """INSERT INTO npc_memories(
                 player_id,npc_id,kind,content,source_event_id,importance,tags_json,
                 confidence,expires_at,access_stage)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (player_id, npc_id, str(memory.get("kind") or "conversation"), content,
             memory.get("source_event_id"), importance,
             self._json(list(memory.get("tags") or [])), confidence,
             memory.get("expires_at"), access_stage),
        )
        try:
            self._connection.execute(
                """INSERT INTO npc_memory_fts(content,player_id,npc_id,memory_id)
                   VALUES (?,?,?,?)""",
                (content, player_id, npc_id, str(cursor.lastrowid)),
            )
        except sqlite3.OperationalError:
            pass

    def apply_chat_db_effects(self, player_id: str, key: str) -> dict:
        """Apply every SQLite-owned turn effect and checkpoint it atomically."""
        with self._lock, self._connection:
            row = self._connection.execute(
                "SELECT * FROM chat_turn_journal WHERE player_id=? AND idempotency_key=?",
                (player_id, key),
            ).fetchone()
            if row is None or not row["response_json"] or not row["effects_json"]:
                raise RuntimeError("chat turn has not reached its durable commit boundary")
            effects = json.loads(row["effects_json"])
            if row["db_applied_at"]:
                return effects
            npc_id = str(row["npc_id"])

            learning_state = effects.get("learning_state")
            if isinstance(learning_state, dict):
                self._connection.execute(
                    """INSERT INTO learning_states(player_id,state_json) VALUES (?,?)
                       ON CONFLICT(player_id) DO UPDATE SET state_json=excluded.state_json,
                         updated_at=CURRENT_TIMESTAMP""",
                    (player_id, self._json(learning_state)),
                )

            event_effect = effects.get("event_transition")
            if isinstance(event_effect, dict):
                history = event_effect.get("history")
                active_event = event_effect.get("active_event")
                if isinstance(history, dict):
                    self._connection.execute(
                        """INSERT INTO event_history(
                             player_id,npc_id,template_id,category,started_on,completed_at,
                             outcome_id,relationship_change,mood_change,memory)
                           VALUES (?,?,?,?,?,?,?,?,?,?)""",
                        (history["player_id"], history["npc_id"], history["template_id"],
                         history["category"], history["started_on"], history["completed_at"],
                         history["outcome_id"], history["relationship_change"],
                         history["mood_change"], history["memory"]),
                    )
                    self._connection.execute(
                        "DELETE FROM active_events WHERE player_id=? AND npc_id=?",
                        (player_id, npc_id),
                    )
                elif isinstance(active_event, dict):
                    self._connection.execute(
                        """INSERT INTO active_events(player_id,npc_id,event_json)
                           VALUES (?,?,?) ON CONFLICT(player_id,npc_id) DO UPDATE SET
                             event_json=excluded.event_json,updated_at=CURRENT_TIMESTAMP""",
                        (player_id, npc_id, self._json(active_event)),
                    )

            for table, column, effect_key in (
                ("npc_relationships", "relationship_json", "relationship"),
                ("npc_runtime_states", "state_json", "runtime_state"),
                ("npc_goals", "goal_json", "goal"),
                ("npc_personas", "persona_json", "persona"),
            ):
                value = effects.get(effect_key)
                if isinstance(value, dict):
                    self._connection.execute(
                        f"""INSERT INTO {table}(player_id,npc_id,{column}) VALUES (?,?,?)
                            ON CONFLICT(player_id,npc_id) DO UPDATE SET
                              {column}=excluded.{column},updated_at=CURRENT_TIMESTAMP""",
                        (player_id, npc_id, self._json(value)),
                    )

            for memory in effects.get("memories") or []:
                if isinstance(memory, dict):
                    self._insert_chat_memory(player_id, npc_id, memory)

            observations = [
                " ".join(str(value).split())[:300]
                for value in effects.get("summary_observations") or []
                if str(value).strip()
            ]
            if observations:
                game_date = str(effects.get("game_date") or "")
                summary_row = self._connection.execute(
                    """SELECT summary FROM conversation_summaries
                       WHERE player_id=? AND npc_id=? AND game_date=?""",
                    (player_id, npc_id, game_date),
                ).fetchone()
                existing = summary_row[0].split(" | ") if summary_row and summary_row[0] else []
                merged = list(dict.fromkeys([*existing, *observations]))[-8:]
                self._connection.execute(
                    """INSERT INTO conversation_summaries(
                         player_id,npc_id,game_date,summary) VALUES (?,?,?,?)
                       ON CONFLICT(player_id,npc_id,game_date) DO UPDATE SET
                         summary=excluded.summary""",
                    (player_id, npc_id, game_date, " | ".join(merged)),
                )

            trace = effects.get("agent_trace")
            if isinstance(trace, dict):
                self._connection.execute(
                    """INSERT INTO agent_turn_traces(
                         player_id,npc_id,request_id,prompt_version,persona_version,
                         memory_ids_json,model,fallback_used,dialogue_ms,analysis_ms,error_type)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                    (player_id, npc_id, key, trace.get("prompt_version", "agent-v1"),
                     trace.get("persona_version"), self._json(trace.get("memory_ids", [])),
                     trace.get("model"), int(bool(trace.get("fallback_used"))),
                     int(trace.get("dialogue_ms", 0)), int(trace.get("analysis_ms", 0)),
                     trace.get("error_type")),
                )

            self._connection.execute(
                """UPDATE chat_turn_journal SET db_applied_at=CURRENT_TIMESTAMP,
                     updated_at=CURRENT_TIMESTAMP WHERE player_id=? AND idempotency_key=?""",
                (player_id, key),
            )
            return effects

    def mark_chat_life_applied(self, player_id: str, key: str) -> None:
        with self._lock, self._connection:
            self._connection.execute(
                """UPDATE chat_turn_journal SET life_applied_at=CURRENT_TIMESTAMP,
                     updated_at=CURRENT_TIMESTAMP
                   WHERE player_id=? AND idempotency_key=? AND db_applied_at IS NOT NULL""",
                (player_id, key),
            )

    def complete_chat_turn(self, player_id: str, key: str) -> dict:
        with self._lock, self._connection:
            row = self._connection.execute(
                "SELECT * FROM chat_turn_journal WHERE player_id=? AND idempotency_key=?",
                (player_id, key),
            ).fetchone()
            if row is None or not row["response_json"]:
                raise RuntimeError("chat turn is not committed")
            effects = json.loads(row["effects_json"] or "{}")
            life_required = bool(effects.get("life_interaction"))
            if not row["db_applied_at"] or (life_required and not row["life_applied_at"]):
                raise RuntimeError("chat turn effects are incomplete")
            self._connection.execute(
                """UPDATE chat_turn_journal SET status='completed',
                     updated_at=CURRENT_TIMESTAMP
                   WHERE player_id=? AND idempotency_key=?""",
                (player_id, key),
            )
            return json.loads(row["response_json"])

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
        return normalize_profile_contract(json.loads(row[0])) if row else None

    def list_npc_profiles(self, player_id: str) -> list[dict]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT npc_id,profile_json FROM npc_profiles WHERE player_id=? ORDER BY created_at,npc_id", (player_id,)
            ).fetchall()
        return [{"id": row["npc_id"],
                 "profile": normalize_profile_contract(json.loads(row["profile_json"]))}
                for row in rows]

    def get_or_create_npc_profile(self, player_id: str, npc_id: str, default_profile: dict) -> dict:
        """Persist the caller-owned default once; never silently replace customization."""
        with self._lock, self._connection:
            self.ensure_player(player_id)
            self._connection.execute(
                "INSERT OR IGNORE INTO npc_profiles(player_id,npc_id,profile_json) VALUES (?,?,?)",
                (player_id, npc_id, self._json(normalize_profile_contract(default_profile))),
            )
            return self.get_npc_profile(player_id, npc_id)  # type: ignore[return-value]

    def save_npc_profile(self, player_id: str, npc_id: str, profile: dict) -> dict:
        profile = normalize_profile_contract(profile)
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
        profile = normalize_profile_contract(profile)

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
        deliberately excluded from ``user_created_count``. Resident count is
        informative only: completion is an explicit durable decision made by
        the setup saga finalizer or the pre-v3 grandfather migration.
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
            migration_row = self._connection.execute(
                "SELECT * FROM player_roster_migrations WHERE player_id=?", (player_id,),
            ).fetchone()
        all_resident_ids = [str(value["npc_id"]) for value in profile_rows]
        migration = self._decode_roster_migration(migration_row)
        resident_ids = all_resident_ids
        if migration and migration["status"] == "ready":
            resident_ids = list(migration["active_npc_ids"])
        user_created = sum(npc_id != "emma" for npc_id in resident_ids)
        stored = json.loads(row["state_json"]) if row else {}
        setup_status = str(stored.get("setup_status") or "")
        # A staged onboarding cast is deliberately *not* ready merely because
        # its profile rows exist. Social and world projections are established
        # after this transaction and ``finalize_onboarding_setup`` is the only
        # authority allowed to open the gameplay gate for that saga.
        completed = bool(stored.get("completed"))
        if migration and migration["status"] != "ready":
            completed = False
            setup_status = str(migration["status"])
        if not setup_status:
            setup_status = "completed" if completed else "not_started"
        result = {
            "version": ONBOARDING_STATE_VERSION,
            "completed": completed,
            "setup_status": setup_status,
            "setup_key": stored.get("setup_key"),
            "min_residents": minimum,
            "max_residents": maximum,
            "resident_count": len(resident_ids),
            "user_created_count": user_created,
            "remaining_slots": max(0, maximum - len(resident_ids)),
            "household_name": str(stored.get("household_name") or "Our Home"),
            "intro_version": stored.get("intro_version"),
            "intro_acknowledged_at": (stored.get("intro_acknowledged_at")
                                        or (row["completed_at"] if completed and row else None)),
            "completed_at": row["completed_at"] if row else None,
            "updated_at": row["updated_at"] if row else None,
        }
        if migration:
            result["total_resident_count"] = len(all_resident_ids)
            result["roster_migration"] = {
                "migration_version": migration["migration_version"],
                "status": migration["status"], "revision": migration["revision"],
                "total_resident_count": len(all_resident_ids),
                "active_resident_count": len(migration["active_npc_ids"]),
                "archived_resident_count": len(migration["archived_npc_ids"]),
                "review_required": migration["status"] == "needs_roster_review",
                "integrity_valid": bool(migration["integrity"].get("valid")),
            }
        return result

    def refresh_onboarding(self, player_id: str, *, household_name: str | None = None,
                           force_complete: bool = False, minimum: int = 2,
                           maximum: int = 8) -> dict:
        """Refresh metadata without deriving readiness from resident count.

        ``force_complete`` is reserved for the explicit pre-v3 compatibility
        path. New onboarding worlds are completed only by the saga finalizer.
        """
        def write():
            row = self._connection.execute(
                "SELECT state_json FROM player_onboarding WHERE player_id=?", (player_id,),
            ).fetchone()
            stored = json.loads(row["state_json"]) if row else {}
            completed = force_complete or bool(stored.get("completed"))
            current_name = str(stored.get("household_name") or "Our Home")
            name = " ".join((household_name or current_name).split())[:64] or "Our Home"
            now = str(self._connection.execute("SELECT CURRENT_TIMESTAMP").fetchone()[0])
            intro_version = stored.get("intro_version")
            intro_acknowledged_at = stored.get("intro_acknowledged_at")
            if completed and not intro_acknowledged_at:
                intro_version = CURRENT_INTRO_VERSION
                intro_acknowledged_at = now
            value = {
                "version": ONBOARDING_STATE_VERSION, "completed": completed,
                "household_name": name, "intro_version": intro_version,
                "intro_acknowledged_at": intro_acknowledged_at,
                "setup_status": ("completed" if completed else
                                 stored.get("setup_status") or "not_started"),
            }
            if stored.get("setup_key"):
                value["setup_key"] = stored["setup_key"]
            if stored.get("setup_resident_ids"):
                value["setup_resident_ids"] = stored["setup_resident_ids"]
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

    def acknowledge_onboarding_intro(self, player_id: str, intro_version: int,
                                     *, minimum: int = 2, maximum: int = 8) -> dict:
        """Idempotently persist that this account saw the current introduction."""
        if intro_version != CURRENT_INTRO_VERSION:
            raise ValueError("UNSUPPORTED_INTRO_VERSION")
        self.ensure_player(player_id)

        def write():
            row = self._connection.execute(
                "SELECT state_json FROM player_onboarding WHERE player_id=?", (player_id,),
            ).fetchone()
            stored = json.loads(row["state_json"]) if row else {}
            if (stored.get("intro_version") == intro_version
                    and stored.get("intro_acknowledged_at")):
                return
            now = str(self._connection.execute("SELECT CURRENT_TIMESTAMP").fetchone()[0])
            stored.update({
                "version": ONBOARDING_STATE_VERSION,
                "completed": bool(stored.get("completed")),
                "household_name": str(stored.get("household_name") or "Our Home"),
                "intro_version": intro_version,
                "intro_acknowledged_at": now,
                "setup_status": stored.get("setup_status") or (
                    "completed" if stored.get("completed") else "not_started"
                ),
            })
            self._connection.execute(
                """INSERT INTO player_onboarding(player_id,state_json)
                   VALUES (?,?) ON CONFLICT(player_id) DO UPDATE SET
                     state_json=excluded.state_json,updated_at=CURRENT_TIMESTAMP""",
                (player_id, self._json(stored)),
            )

        self._life_transaction(write)
        return self.onboarding_state(player_id, minimum=minimum, maximum=maximum)

    @staticmethod
    def onboarding_setup_key(household_name: str, profiles: list[dict]) -> str:
        """Return the stable identity of one normalized onboarding request."""
        name = " ".join(household_name.split())[:64] or "Our Home"
        payload = {
            "household_name": name,
            "profiles": [normalize_profile_contract(profile) for profile in profiles],
        }
        return hashlib.sha256(Database._json(payload).encode("utf-8")).hexdigest()

    def create_onboarding_residents(self, player_id: str, residents: list[dict],
                                    household_name: str, *, maximum: int = 8) -> list[dict]:
        """Atomically stage a cast while keeping the gameplay gate closed.

        This is the durable first step of the setup saga. Replaying the same
        normalized request returns the original residents (and therefore the
        original IDs) without inserting duplicate profiles, greetings or
        stats. A different request cannot replace a setup already in flight.
        """
        name = " ".join(household_name.split())[:64] or "Our Home"
        normalized_entries = [
            {"id": str(entry["id"]), "profile": normalize_profile_contract(entry["profile"])}
            for entry in residents
        ]
        setup_key = self.onboarding_setup_key(
            name, [entry["profile"] for entry in normalized_entries],
        )

        def write():
            # Do not call ``ensure_player`` here: its legacy side effect creates
            # an Emma state and greeting, which would reappear on every saga
            # replay even though Emma is not part of a new user's chosen cast.
            self._connection.execute(
                "INSERT OR IGNORE INTO players(id) VALUES (?)", (player_id,),
            )
            if not 2 <= len(normalized_entries) <= maximum:
                raise ValueError("INVALID_ONBOARDING_RESIDENT_COUNT")
            stored_row = self._connection.execute(
                "SELECT state_json FROM player_onboarding WHERE player_id=?", (player_id,),
            ).fetchone()
            stored = json.loads(stored_row["state_json"]) if stored_row else {}
            if not stored.get("intro_acknowledged_at"):
                raise ValueError("INTRO_NOT_ACKNOWLEDGED")
            stored_key = str(stored.get("setup_key") or "")
            stored_status = str(stored.get("setup_status") or "")
            if stored_status in {"initializing", "completed"} or stored.get("completed"):
                if stored_key != setup_key:
                    raise ValueError(
                        "ONBOARDING_ALREADY_COMPLETED" if stored.get("completed")
                        else "ONBOARDING_SETUP_IN_PROGRESS"
                    )
                staged_ids = [str(value) for value in stored.get("setup_resident_ids") or []]
                if len(staged_ids) != len(normalized_entries):
                    raise ValueError("ONBOARDING_SETUP_CORRUPT")
                rows = self._connection.execute(
                    "SELECT npc_id,profile_json FROM npc_profiles WHERE player_id=?",
                    (player_id,),
                ).fetchall()
                by_id = {str(row["npc_id"]): json.loads(row["profile_json"]) for row in rows}
                if any(npc_id not in by_id for npc_id in staged_ids):
                    raise ValueError("ONBOARDING_SETUP_CORRUPT")
                return [
                    {"id": npc_id, "profile": normalize_profile_contract(by_id[npc_id])}
                    for npc_id in staged_ids
                ]
            existing_rows = self._connection.execute(
                "SELECT npc_id,profile_json FROM npc_profiles WHERE player_id=?", (player_id,),
            ).fetchall()
            # ``ensure_player`` keeps the historical Emma state/message ready
            # for old endpoints. A genuinely new batch setup has no Emma
            # profile, so remove those compatibility-only orphan rows before
            # installing the authoritative cast.
            if not any(str(row["npc_id"]) == "emma" for row in existing_rows):
                self._connection.execute(
                    "DELETE FROM messages WHERE player_id=? AND npc_id='emma'", (player_id,),
                )
                self._connection.execute(
                    "DELETE FROM npc_states WHERE player_id=? AND npc_id='emma'", (player_id,),
                )
            existing_user_created = sum(str(row["npc_id"]) != "emma" for row in existing_rows)
            if bool(stored.get("completed")) or existing_user_created >= 2:
                raise ValueError("ONBOARDING_ALREADY_COMPLETED")
            existing_count = int(self._connection.execute(
                "SELECT count(*) FROM npc_profiles WHERE player_id=?", (player_id,),
            ).fetchone()[0])
            if existing_count + len(normalized_entries) > maximum:
                raise ValueError("NPC_LIMIT_REACHED")
            incoming_ids = [entry["id"] for entry in normalized_entries]
            if len(incoming_ids) != len(set(incoming_ids)):
                raise ValueError("DUPLICATE_NPC_ID")
            existing_names = {
                self._npc_name_key(json.loads(row["profile_json"]).get("name"))
                for row in existing_rows
            }
            incoming_names = [
                self._npc_name_key(entry["profile"].get("name"))
                for entry in normalized_entries
            ]
            if any(not value for value in incoming_names):
                raise ValueError("INVALID_NPC_NAME")
            if (len(incoming_names) != len(set(incoming_names))
                    or bool(existing_names & set(incoming_names))):
                raise ValueError("NPC_NAME_TAKEN")
            created: list[dict] = []
            for entry in normalized_entries:
                npc_id = entry["id"]
                profile = entry["profile"]
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
            now = str(self._connection.execute("SELECT CURRENT_TIMESTAMP").fetchone()[0])
            state = {
                "version": ONBOARDING_STATE_VERSION, "completed": False,
                "household_name": name,
                "intro_version": stored.get("intro_version") or CURRENT_INTRO_VERSION,
                "intro_acknowledged_at": stored.get("intro_acknowledged_at") or now,
                "setup_status": "initializing",
                "setup_key": setup_key,
                "setup_resident_ids": incoming_ids,
                "setup_started_at": now,
            }
            self._connection.execute(
                """INSERT INTO player_onboarding(player_id,state_json,completed_at)
                   VALUES (?,?,NULL)
                   ON CONFLICT(player_id) DO UPDATE SET state_json=excluded.state_json,
                     completed_at=NULL,
                     updated_at=CURRENT_TIMESTAMP""",
                (player_id, self._json(state)),
            )
            return created

        return self._life_transaction(write)

    def finalize_onboarding_setup(self, player_id: str, setup_key: str, *,
                                  require_life_world: bool) -> dict:
        """Open the world only after every idempotent setup projection exists."""
        def write():
            row = self._connection.execute(
                "SELECT state_json FROM player_onboarding WHERE player_id=?", (player_id,),
            ).fetchone()
            stored = json.loads(row["state_json"]) if row else {}
            if not stored.get("intro_acknowledged_at"):
                raise ValueError("INTRO_NOT_ACKNOWLEDGED")
            if str(stored.get("setup_key") or "") != setup_key:
                raise ValueError("ONBOARDING_SETUP_MISMATCH")
            if stored.get("completed"):
                return
            if stored.get("setup_status") != "initializing":
                raise ValueError("ONBOARDING_SETUP_NOT_INITIALIZING")
            staged_ids = {str(value) for value in stored.get("setup_resident_ids") or []}
            if not 2 <= len(staged_ids) <= 8:
                raise ValueError("ONBOARDING_SETUP_CORRUPT")
            profile_ids = {
                str(row["npc_id"]) for row in self._connection.execute(
                    "SELECT npc_id FROM npc_profiles WHERE player_id=?", (player_id,),
                ).fetchall()
            }
            if not staged_ids <= profile_ids:
                raise ValueError("ONBOARDING_SETUP_CORRUPT")
            edge_pairs = {
                (str(row["npc_a"]), str(row["npc_b"]))
                for row in self._connection.execute(
                    "SELECT npc_a,npc_b FROM npc_social_edges WHERE player_id=?", (player_id,),
                ).fetchall()
            }
            expected_pairs = {
                (npc_a, npc_b) for npc_a in profile_ids for npc_b in profile_ids if npc_a != npc_b
            }
            if not expected_pairs <= edge_pairs:
                raise ValueError("ONBOARDING_INITIALIZATION_INCOMPLETE")
            if require_life_world:
                if not self._connection.execute(
                    "SELECT 1 FROM life_world_states WHERE player_id=?", (player_id,),
                ).fetchone():
                    raise ValueError("ONBOARDING_INITIALIZATION_INCOMPLETE")
                household_rows = self._connection.execute(
                    "SELECT id FROM households WHERE player_id=?", (player_id,),
                ).fetchall()
                if len(household_rows) != 1:
                    raise ValueError("ONBOARDING_INITIALIZATION_INCOMPLETE")
                member_ids = {
                    str(row["npc_id"]) for row in self._connection.execute(
                        "SELECT npc_id FROM household_members WHERE player_id=?", (player_id,),
                    ).fetchall()
                }
                if not profile_ids <= member_ids:
                    raise ValueError("ONBOARDING_INITIALIZATION_INCOMPLETE")
            now = str(self._connection.execute("SELECT CURRENT_TIMESTAMP").fetchone()[0])
            stored.update({
                "version": ONBOARDING_STATE_VERSION,
                "completed": True,
                "setup_status": "completed",
                "setup_completed_at": now,
            })
            self._connection.execute(
                """UPDATE player_onboarding SET state_json=?,
                     completed_at=COALESCE(completed_at,CURRENT_TIMESTAMP),
                     updated_at=CURRENT_TIMESTAMP WHERE player_id=?""",
                (self._json(stored), player_id),
            )

        self._life_transaction(write)
        return self.onboarding_state(player_id)

    @classmethod
    def _layout_digest(cls, layout: dict) -> tuple[str, str]:
        encoded = cls._json(layout)
        return encoded, hashlib.sha256(encoded.encode("utf-8")).hexdigest()

    @staticmethod
    def _layout_version(row: sqlite3.Row) -> dict:
        return {
            "id": row["id"], "hash": row["layout_hash"],
            "layout": json.loads(row["layout_json"]), "note": row["note"],
            "author": row["author"], "is_default": bool(row["is_default"]),
            "validation": json.loads(row["validation_json"] or "{}"),
            "created_at": row["created_at"],
        }

    def get_world_layout(self) -> dict | None:
        """Return the immutable version addressed by the singleton active pointer."""
        with self._lock:
            row = self._connection.execute(
                """SELECT versions.*,active.activated_at,active.activated_by,
                          active.activation_note
                   FROM world_layout_active active
                   JOIN world_layout_versions versions ON versions.id=active.version_id
                   WHERE active.scope='global'"""
            ).fetchone()
        if not row:
            return None
        version = self._layout_version(row)
        return {
            "layout": version["layout"],
            "updated_at": None if version["is_default"] else row["activated_at"],
            "active_version": {key: value for key, value in version.items() if key != "layout"},
            "activated_at": row["activated_at"],
            "activated_by": row["activated_by"],
            "activation_note": row["activation_note"],
        }

    def get_world_layout_draft(self) -> dict | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM world_layout_drafts WHERE scope='global'"
            ).fetchone()
        if not row:
            return None
        return {
            "layout": json.loads(row["layout_json"]), "hash": row["layout_hash"],
            "revision": int(row["revision"]), "author": row["author"],
            "validation": json.loads(row["validation_json"] or "{}"),
            "created_at": row["created_at"], "updated_at": row["updated_at"],
        }

    def save_world_layout_draft(self, layout: dict, expected_revision: int,
                                author: str, validation: dict) -> dict:
        encoded, layout_hash = self._layout_digest(layout)
        with self._lock, self._connection:
            row = self._connection.execute(
                "SELECT revision FROM world_layout_drafts WHERE scope='global'"
            ).fetchone()
            current = int(row["revision"]) if row else 0
            if current != expected_revision:
                raise WorldLayoutDraftConflict(current)
            revision = current + 1
            self._connection.execute(
                """INSERT INTO world_layout_drafts(
                     scope,layout_json,layout_hash,revision,author,validation_json)
                   VALUES ('global',?,?,?,?,?)
                   ON CONFLICT(scope) DO UPDATE SET
                     layout_json=excluded.layout_json,layout_hash=excluded.layout_hash,
                     revision=excluded.revision,author=excluded.author,
                     validation_json=excluded.validation_json,
                     updated_at=CURRENT_TIMESTAMP""",
                (encoded, layout_hash, revision, author.strip()[:80] or "admin",
                 self._json(validation)),
            )
        return self.get_world_layout_draft()  # type: ignore[return-value]

    def list_world_layout_versions(self, limit: int = 100) -> list[dict]:
        with self._lock:
            rows = self._connection.execute(
                """SELECT versions.*,
                          CASE WHEN active.version_id=versions.id THEN 1 ELSE 0 END AS is_active,
                          active.activated_at
                   FROM world_layout_versions versions
                   LEFT JOIN world_layout_active active
                     ON active.scope='global' AND active.version_id=versions.id
                   ORDER BY versions.created_at DESC,versions.id DESC LIMIT ?""",
                (max(1, min(500, int(limit))),),
            ).fetchall()
        return [
            {
                **{key: value for key, value in self._layout_version(row).items()
                   if key != "layout"},
                "is_active": bool(row["is_active"]),
                "activated_at": row["activated_at"],
            }
            for row in rows
        ]

    def world_layout_version(self, version_id: str) -> dict | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM world_layout_versions WHERE id=?", (version_id,),
            ).fetchone()
        return self._layout_version(row) if row else None

    def publish_world_layout(self, layout: dict, note: str = "兼容发布",
                             author: str = "admin", validation: dict | None = None,
                             expected_draft_revision: int | None = None,
                             is_default: bool = False) -> dict:
        """Insert an immutable content-addressed version and atomically activate it."""
        encoded, layout_hash = self._layout_digest(layout)
        version_id = f"layout-{layout_hash}"
        clean_note = note.strip()[:240] or "发布布局"
        clean_author = author.strip()[:80] or "admin"
        validation = validation or {}
        with self._lock, self._connection:
            if expected_draft_revision is not None:
                row = self._connection.execute(
                    "SELECT revision,layout_hash FROM world_layout_drafts WHERE scope='global'"
                ).fetchone()
                current = int(row["revision"]) if row else 0
                if current != expected_draft_revision or not row or row["layout_hash"] != layout_hash:
                    raise WorldLayoutDraftConflict(current)
            previous = self._connection.execute(
                "SELECT version_id FROM world_layout_active WHERE scope='global'"
            ).fetchone()
            existing = self._connection.execute(
                "SELECT id FROM world_layout_versions WHERE layout_hash=?", (layout_hash,),
            ).fetchone()
            self._connection.execute(
                """INSERT OR IGNORE INTO world_layout_versions(
                     id,layout_hash,layout_json,note,author,is_default,validation_json)
                   VALUES (?,?,?,?,?,?,?)""",
                (version_id, layout_hash, encoded, clean_note, clean_author,
                 int(is_default), self._json(validation)),
            )
            action = "publish" if not existing else "activate_existing"
            self._connection.execute(
                """INSERT INTO world_layout_active(
                     scope,version_id,activated_by,activation_note)
                   VALUES ('global',?,?,?)
                   ON CONFLICT(scope) DO UPDATE SET
                     version_id=excluded.version_id,activated_by=excluded.activated_by,
                     activation_note=excluded.activation_note,
                     activated_at=CURRENT_TIMESTAMP""",
                (version_id, clean_author, clean_note),
            )
            self._connection.execute(
                """INSERT INTO world_layout_audit(
                     action,version_id,previous_version_id,note,author)
                   VALUES (?,?,?,?,?)""",
                (action, version_id, previous["version_id"] if previous else None,
                 clean_note, clean_author),
            )
        result = self.get_world_layout()
        assert result is not None
        return {**result, "created": not bool(existing)}

    def activate_world_layout_version(self, version_id: str, note: str,
                                      author: str) -> dict | None:
        clean_note = note.strip()[:240] or "回滚到历史版本"
        clean_author = author.strip()[:80] or "admin"
        with self._lock, self._connection:
            exists = self._connection.execute(
                "SELECT 1 FROM world_layout_versions WHERE id=?", (version_id,),
            ).fetchone()
            if not exists:
                return None
            previous = self._connection.execute(
                "SELECT version_id FROM world_layout_active WHERE scope='global'"
            ).fetchone()
            self._connection.execute(
                """INSERT INTO world_layout_active(
                     scope,version_id,activated_by,activation_note)
                   VALUES ('global',?,?,?)
                   ON CONFLICT(scope) DO UPDATE SET
                     version_id=excluded.version_id,activated_by=excluded.activated_by,
                     activation_note=excluded.activation_note,
                     activated_at=CURRENT_TIMESTAMP""",
                (version_id, clean_author, clean_note),
            )
            self._connection.execute(
                """INSERT INTO world_layout_audit(
                     action,version_id,previous_version_id,note,author)
                   VALUES ('activate',?,?,?,?)""",
                (version_id, previous["version_id"] if previous else None,
                 clean_note, clean_author),
            )
        return self.get_world_layout()

    def world_layout_audit(self, limit: int = 100) -> list[dict]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT * FROM world_layout_audit ORDER BY id DESC LIMIT ?",
                (max(1, min(500, int(limit))),),
            ).fetchall()
        return [dict(row) for row in rows]

    def save_world_layout(self, layout: dict) -> dict:
        """Compatibility entry point; callers should validate before publishing."""
        return self.publish_world_layout(layout)

    def reset_world_layout(self, layout: dict | None = None,
                           author: str = "admin") -> dict | None:
        if layout is not None:
            return self.publish_world_layout(
                layout, note="恢复项目默认布局", author=author,
                validation={"valid": True, "source": "built_in_default"},
                is_default=True,
            )
        with self._lock, self._connection:
            previous = self._connection.execute(
                "SELECT version_id FROM world_layout_active WHERE scope='global'"
            ).fetchone()
            self._connection.execute("DELETE FROM world_layout_active WHERE scope='global'")
            self._connection.execute(
                """INSERT INTO world_layout_audit(
                     action,version_id,previous_version_id,note,author)
                   VALUES ('reset_virtual_default',NULL,?,?,?)""",
                (previous["version_id"] if previous else None,
                 "恢复项目默认布局", author.strip()[:80]),
            )
        return None

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
