from __future__ import annotations

from copy import deepcopy

from fastapi.testclient import TestClient
import pytest

from lingolife.app import DEFAULT_NPC_PROFILE, create_app
from lingolife.config import Settings
from lingolife.db import Database
from lingolife.models import AIResult, EnglishFeedback


ADMIN_ORIGIN = {"Origin": "https://lingolife.admin.shimooth.me"}


class StubProvider:
    def reply(self, message, stats, history, context=None):
        return AIResult(
            npc_reply="Tell me more about that.",
            npc_reply_zh="再多告诉我一些吧。",
            relationship_change=1,
            mood_change=1,
            english_xp_change=1,
            english_feedback=EnglishFeedback(
                is_understandable=True,
                corrected_text=message,
                tip="Keep going.",
                tags=[],
            ),
        )


def _client(tmp_path) -> TestClient:
    return TestClient(create_app(Settings(
        database_url=f"sqlite:///{tmp_path / 'admin-reset.db'}",
        web_root=str(tmp_path / "missing-web"),
        life_simulation_v2=True,
        admin_password="test-admin",
        admin_session_secret="test-secret",
        admin_cookie_secure=False,
    ), StubProvider()))


def _profile(name: str) -> dict:
    profile = deepcopy(DEFAULT_NPC_PROFILE)
    profile["name"] = name
    marker = sum(ord(character) for character in name.casefold())
    roles = ["organizer", "caretaker", "mediator", "cook", "fixer", "free_spirit"]
    chores = ["cooking", "dishes", "cleaning", "shopping", "repairs", "laundry"]
    profile.update({
        "occupation": f"{name} specialist",
        "personality": ["thoughtful", f"trait-{name.casefold()}"],
        "interests": ["art", f"interest-{name.casefold()}"],
        "habits": [f"{name} evening routine"],
        "householdRole": roles[marker % len(roles)],
        "chorePreferences": [chores[marker % len(chores)]],
        "privateSpacePreference": ["low", "balanced", "high"][marker % 3],
    })
    return profile


def _register_and_populate(client: TestClient, username: str = "onboarding-test") -> dict:
    db = client.app.state.db
    invite = db.create_invites(1, 17)[0]
    registered = client.post("/api/v1/auth/register", json={
        "username": username,
        "invite_code": invite,
        "password": "unchanged-password",
    })
    assert registered.status_code == 201, registered.text
    token = registered.json()["session_token"]
    headers = {"Authorization": f"Bearer {token}"}
    acknowledged = client.post(
        "/api/v1/onboarding/intro/acknowledge",
        headers=headers,
        json={"intro_version": 1},
    )
    assert acknowledged.status_code == 200, acknowledged.text
    onboarding = client.post("/api/v1/onboarding/complete", headers=headers, json={
        "household_name": "Test House",
        "residents": [_profile("Ava"), _profile("Bo")],
    })
    assert onboarding.status_code == 201, onboarding.text
    npc_id = onboarding.json()["created"][0]["id"]
    # Materialize the authoritative life world/projections and one complete AI
    # turn, including learning, messages, request cache and an audit trace.
    assert client.get("/api/v1/world", headers=headers).status_code == 200
    chatted = client.post(
        "/api/v1/chat",
        headers={**headers, "Idempotency-Key": "reset-test-chat-001"},
        json={"npc_id": npc_id, "message": "How are you today?"},
    )
    assert chatted.status_code == 200, chatted.text
    db.add_npc_memory("unused", "unused", "episodic", "unrelated account data")
    player_id = db.authenticate(token)["player_id"]
    db.add_npc_memory(player_id, npc_id, "episodic", "resettable player memory")
    user = db._connection.execute(
        "SELECT * FROM users WHERE player_id=?", (player_id,),
    ).fetchone()
    invitation = db._connection.execute(
        "SELECT * FROM invitations WHERE used_by=?", (user["id"],),
    ).fetchone()
    return {
        "headers": headers,
        "token": token,
        "invite": invite,
        "user_id": user["id"],
        "player_id": player_id,
        "invite_hash": invitation["code_hash"],
    }


def _count(db: Database, table: str, column: str, value: str) -> int:
    return int(db._connection.execute(
        f"SELECT count(*) FROM {table} WHERE {column}=?", (value,),
    ).fetchone()[0])


@pytest.mark.parametrize(("username", "allowed"), (
    ("onboarding-test", True),
    ("ONBOARDING-TEST", True),
    ("onboarding-test-mobile", True),
    ("onboarding-test2", False),
    ("test-onboarding", False),
    ("ordinary-player", False),
))
def test_onboarding_reset_account_namespace_is_narrow(username, allowed):
    assert Database._is_onboarding_test_account(username) is allowed


def test_admin_reset_restarts_onboarding_but_preserves_account_access_and_audit(tmp_path):
    client = _client(tmp_path)
    account = _register_and_populate(client)
    db = client.app.state.db

    user_before = dict(db._connection.execute(
        "SELECT * FROM users WHERE id=?", (account["user_id"],),
    ).fetchone())
    sessions_before = [dict(row) for row in db._connection.execute(
        "SELECT * FROM sessions WHERE user_id=? ORDER BY token_hash", (account["user_id"],),
    ).fetchall()]
    invitation_before = dict(db._connection.execute(
        "SELECT * FROM invitations WHERE code_hash=?", (account["invite_hash"],),
    ).fetchone())
    usage_before = [dict(row) for row in db._connection.execute(
        "SELECT * FROM usage_events WHERE user_id=? ORDER BY id", (account["user_id"],),
    ).fetchall()]
    traces_before = [dict(row) for row in db._connection.execute(
        "SELECT * FROM agent_turn_traces WHERE player_id=? ORDER BY id", (account["player_id"],),
    ).fetchall()]
    assert usage_before and traces_before
    assert _count(db, "npc_profiles", "player_id", account["player_id"]) == 2
    assert _count(db, "life_world_states", "player_id", account["player_id"]) == 1

    assert client.post(
        "/api/v1/admin/login", headers=ADMIN_ORIGIN, json={"password": "test-admin"},
    ).status_code == 200
    response = client.post(
        f"/api/v1/admin/users/{account['user_id']}/reset-onboarding",
        headers=ADMIN_ORIGIN,
        json={"confirm_username": " ONBOARDING-TEST "},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["reset"] is True
    assert payload["user"] == {"id": account["user_id"], "username": "onboarding-test"}
    assert payload["onboarding"] == {
        "version": 2,
        "completed": False,
        "setup_status": "not_started",
        "setup_key": None,
        "min_residents": 2,
        "max_residents": 8,
        "resident_count": 0,
        "user_created_count": 0,
        "remaining_slots": 8,
        "household_name": "Our Home",
        "intro_version": None,
        "intro_acknowledged_at": None,
        "completed_at": None,
        "updated_at": None,
    }
    assert set(payload["deleted"]) == set(Database._GAME_PROGRESS_TABLES)
    assert payload["deleted"]["npc_profiles"] == 2
    assert payload["deleted"]["life_world_states"] == 1
    assert payload["deleted"]["player_onboarding"] == 1

    for table in Database._GAME_PROGRESS_TABLES:
        if table in {
            row["name"] for row in db._connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }:
            assert _count(db, table, "player_id", account["player_id"]) == 0, table

    # Authentication, the redeemed invite, quota consumption and immutable AI
    # audit trail survive byte-for-byte.  No new invite is necessary.
    assert dict(db._connection.execute(
        "SELECT * FROM users WHERE id=?", (account["user_id"],),
    ).fetchone()) == user_before
    assert [dict(row) for row in db._connection.execute(
        "SELECT * FROM sessions WHERE user_id=? ORDER BY token_hash", (account["user_id"],),
    ).fetchall()] == sessions_before
    assert dict(db._connection.execute(
        "SELECT * FROM invitations WHERE code_hash=?", (account["invite_hash"],),
    ).fetchone()) == invitation_before
    assert [dict(row) for row in db._connection.execute(
        "SELECT * FROM usage_events WHERE user_id=? ORDER BY id", (account["user_id"],),
    ).fetchall()] == usage_before
    assert [dict(row) for row in db._connection.execute(
        "SELECT * FROM agent_turn_traces WHERE player_id=? ORDER BY id", (account["player_id"],),
    ).fetchall()] == traces_before
    assert _count(db, "npc_memories", "player_id", "unused") == 1

    me = client.get("/api/v1/auth/me", headers=account["headers"])
    assert me.status_code == 200
    assert me.json()["onboarding"]["completed"] is False
    assert client.post("/api/v1/auth/login", json={
        "username": "onboarding-test", "password": "unchanged-password",
    }).status_code == 200
    acknowledged = client.post(
        "/api/v1/onboarding/intro/acknowledge",
        headers=account["headers"],
        json={"intro_version": 1},
    )
    assert acknowledged.status_code == 200, acknowledged.text
    restarted = client.post("/api/v1/onboarding/complete", headers=account["headers"], json={
        "household_name": "A New Beginning",
        "residents": [_profile("Cy"), _profile("Di")],
    })
    assert restarted.status_code == 201, restarted.text
    assert restarted.json()["onboarding"]["completed"] is True
    assert {entry["profile"]["name"] for entry in restarted.json()["npcs"]} == {"Cy", "Di"}


def test_admin_reset_requires_admin_origin_and_matching_username(tmp_path):
    client = _client(tmp_path)
    account = _register_and_populate(client, "onboarding-test-guarded")
    db = client.app.state.db
    path = f"/api/v1/admin/users/{account['user_id']}/reset-onboarding"

    assert client.post(path, headers=ADMIN_ORIGIN, json={
        "confirm_username": "onboarding-test-guarded",
    }).status_code == 401
    assert client.post(
        "/api/v1/admin/login", headers=ADMIN_ORIGIN, json={"password": "test-admin"},
    ).status_code == 200
    assert client.post(path, json={"confirm_username": "onboarding-test-guarded"}).status_code == 403
    assert client.post(path, headers={"Origin": "https://evil.example"}, json={
        "confirm_username": "onboarding-test-guarded",
    }).status_code == 403
    mismatch = client.post(path, headers=ADMIN_ORIGIN, json={
        "confirm_username": "another-player",
    })
    assert mismatch.status_code == 409
    assert mismatch.json()["error"]["code"] == "USERNAME_CONFIRMATION_MISMATCH"
    assert client.post(path, headers=ADMIN_ORIGIN, json={}).status_code == 422
    assert client.post(path, headers=ADMIN_ORIGIN, json={
        "confirm_username": "onboarding-test-guarded", "unexpected": True,
    }).status_code == 422
    missing = client.post(
        "/api/v1/admin/users/not-a-user/reset-onboarding",
        headers=ADMIN_ORIGIN,
        json={"confirm_username": "onboarding-test-guarded"},
    )
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "USER_NOT_FOUND"
    assert _count(db, "npc_profiles", "player_id", account["player_id"]) == 2
    assert db.onboarding_state(account["player_id"])["completed"] is True

    invite = db.create_invites(1, 30)[0]
    ordinary = client.post("/api/v1/auth/register", json={
        "username": "ordinary-player",
        "invite_code": invite,
        "password": "ordinary-password",
    }).json()
    ordinary_headers = {"Authorization": "Bearer " + ordinary["session_token"]}
    assert client.get("/api/v1/npcs", headers=ordinary_headers).status_code == 200
    ordinary_user = db._connection.execute(
        "SELECT id,player_id FROM users WHERE username='ordinary-player'",
    ).fetchone()
    forbidden = client.post(
        f"/api/v1/admin/users/{ordinary_user['id']}/reset-onboarding",
        headers=ADMIN_ORIGIN,
        json={"confirm_username": "ordinary-player"},
    )
    assert forbidden.status_code == 403
    assert forbidden.json()["error"]["code"] == "TEST_ACCOUNT_REQUIRED"
    # A read-only resident listing must not materialize legacy Emma for a new
    # account or create progress that an admin reset could accidentally erase.
    assert _count(db, "npc_profiles", "player_id", ordinary_user["player_id"]) == 0


def test_reset_fails_closed_and_rolls_back_for_an_unclassified_player_table(tmp_path):
    client = _client(tmp_path)
    account = _register_and_populate(client, "onboarding-test-future-schema")
    db = client.app.state.db
    db._connection.execute(
        "CREATE TABLE future_player_progress (player_id TEXT NOT NULL, value TEXT NOT NULL)"
    )
    db._connection.execute(
        "INSERT INTO future_player_progress(player_id,value) VALUES (?,?)",
        (account["player_id"], "must not survive a partial reset"),
    )
    db._connection.commit()

    with pytest.raises(RuntimeError, match="future_player_progress"):
        db.reset_user_game_progress(account["user_id"], "onboarding-test-future-schema")

    assert _count(db, "future_player_progress", "player_id", account["player_id"]) == 1
    assert _count(db, "npc_profiles", "player_id", account["player_id"]) == 2
    assert db.onboarding_state(account["player_id"])["completed"] is True
