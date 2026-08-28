from concurrent.futures import ThreadPoolExecutor
import threading

from fastapi.testclient import TestClient

from lingolife.animation import ANIMATION_CUES
from lingolife.app import create_app
from lingolife.config import Settings
from lingolife.models import AIResult, EnglishFeedback


class Stub:
    calls = 0
    def reply(self, message, stats, history):
        self.calls += 1
        return AIResult(npc_reply="That's sweet of you...", relationship_change=12, mood_change=3, english_xp_change=9,
            english_feedback=EnglishFeedback(is_understandable=True, corrected_text=message, tip="Natural and caring question.", tags=[]))


def client(tmp_path, provider=None, web_root=None):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'test.db'}", web_root=str(web_root or tmp_path / "missing-web"),
                        admin_password="test-admin", admin_session_secret="test-secret", admin_cookie_secure=False)
    return TestClient(create_app(settings, provider or Stub()))


def auth(c, username="tester", quota=30):
    code = c.app.state.db.create_invites(1, quota)[0]
    data = c.post("/api/v1/auth/register", json={"username": username, "invite_code": code, "password": "test-password"}).json()
    return {"Authorization": "Bearer " + data["session_token"]}


def test_serves_web_root_and_static_assets_without_shadowing_api(tmp_path):
    web_root = tmp_path / "web" / "dist"
    web_root.mkdir(parents=True)
    (web_root / "index.html").write_text('<script src="/app.js"></script><main>LingoLife</main>', encoding="utf-8")
    (web_root / "app.js").write_text('document.title = "LingoLife";', encoding="utf-8")

    c = client(tmp_path, web_root=web_root)
    root = c.get("/")
    asset = c.get("/app.js")

    assert root.status_code == 200
    assert "LingoLife" in root.text
    assert root.headers["content-type"].startswith("text/html")
    assert asset.status_code == 200
    assert asset.text == 'document.title = "LingoLife";'
    assert c.get("/api/v1/health").json() == {"status": "ok", "version": "0.1.0"}


def test_compresses_large_static_assets_without_touching_api(tmp_path):
    web_root = tmp_path / "web" / "dist"
    web_root.mkdir(parents=True)
    (web_root / "index.html").write_text("<main>LingoLife</main>", encoding="utf-8")
    (web_root / "large.js").write_text("const island = true;\n" * 500, encoding="utf-8")
    c = client(tmp_path, web_root=web_root)

    asset = c.get("/large.js", headers={"Accept-Encoding": "gzip"})
    health = c.get("/api/v1/health", headers={"Accept-Encoding": "gzip"})

    assert asset.status_code == 200
    assert asset.headers["content-encoding"] == "gzip"
    assert health.status_code == 200
    assert "content-encoding" not in health.headers


def test_missing_web_root_leaves_api_available(tmp_path):
    c = client(tmp_path)
    assert c.get("/").status_code == 404
    assert c.get("/api/v1/health").status_code == 200


def test_health_and_new_room(tmp_path):
    c = client(tmp_path)
    assert c.get("/api/v1/health").json() == {"status": "ok", "version": "0.1.0"}
    room = c.get("/api/v1/room", headers=auth(c)).json()
    assert room["stats"] == {"relationship": 35, "mood": 35, "english_xp": 0}
    assert room["messages"][0]["speaker"] == "npc"
    assert room["messages"][0]["text"] == "I had a terrible day at work..."
    assert room["messages"][0]["translation"] == "我今天工作过得糟透了……"
    assert room["messages"][0]["created_at"]
    assert room["npc"]["animation_cue"] in ANIMATION_CUES
    assert room["active_event"]["stage"]["translation"]
    assert room["active_event"]["stage"]["animation_cue"] == room["npc"]["animation_cue"]
    performance = room["active_event"]["stage"]["performance"]
    assert performance["version"] == 1 and performance["hold_cue"] == "listen"
    assert performance["beats"][0]["cue"] in ANIMATION_CUES
    assert {"role", "duration_ms", "loop", "transition_ms", "facing", "energy"} <= performance["beats"][0].keys()
    assert room["active_event"]["stage_turns"] == 0


def test_chat_clamps_and_is_idempotent(tmp_path):
    stub = Stub(); c = client(tmp_path, stub)
    headers = {**auth(c), "Idempotency-Key": "12345678-abcd"}
    first = c.post("/api/v1/chat", headers=headers, json={"message": "Why? What happened today?"})
    second = c.post("/api/v1/chat", headers=headers, json={"message": "ignored duplicate"})
    assert first.status_code == 200 and first.json() == second.json()
    assert first.json()["relationship_change"] == 5
    assert first.json()["english_xp_change"] == 5
    assert first.json()["stats"] == {"relationship": 40, "mood": 38, "english_xp": 5}
    assert first.json()["animation"] == "happy"
    assert first.json()["animation_cue"] in ANIMATION_CUES
    assert first.json()["event_update"]["performance"]["beats"]
    assert stub.calls == 1
    reopened = c.get("/api/v1/room", headers=headers).json()
    assert len(reopened["messages"]) == 3
    assert reopened["messages"][-1]["text"] == first.json()["npc_reply"]
    assert reopened["active_event"]["stage_turns"] == 1


def test_legacy_cached_chat_is_upgraded_to_the_animation_cue_contract(tmp_path):
    import json

    c = client(tmp_path, Stub())
    auth_headers = auth(c)
    headers = {**auth_headers, "Idempotency-Key": "legacy-animation-01"}
    first = c.post("/api/v1/chat", headers=headers, json={"message": "How was your day?"}).json()
    player_id = c.app.state.db.authenticate(auth_headers["Authorization"][7:])["player_id"]
    legacy = dict(first)
    legacy.pop("animation_cue", None)
    legacy.get("agent", {}).pop("animation_cue", None)
    legacy["agent"]["runtime_state"] = {
        "emotion": {"valence": 67, "stress": 42, "energy": 53},
        "needs": {"food": 41, "rest": 62, "social": 55, "achievement": 58,
                  "love": 17, "privacy": 12, "security": 8},
        "active_desire_ids": ["desire-from-old-cache"],
        "current_commitment_id": "commitment-from-old-cache",
        "queued_commitment_id": "queued-from-old-cache",
    }
    legacy.get("active_event", {}).get("stage", {}).pop("performance", None)
    legacy.get("event_update", {}).pop("performance", None)
    with c.app.state.db._connection:
        c.app.state.db._connection.execute(
            "UPDATE chat_requests SET response_json=? WHERE player_id=? AND idempotency_key=?",
            (json.dumps(legacy), player_id, "legacy-animation-01"),
        )
    replay = c.post("/api/v1/chat", headers=headers, json={"message": "ignored"}).json()
    assert replay["animation"] == "happy"
    assert replay["animation_cue"] == "happy"
    assert replay["active_event"]["stage"]["performance"]["beats"]
    assert replay["event_update"]["performance"]["beats"]
    assert replay["agent"]["runtime_state"]["needs"]["food"] == "strained"
    encoded = json.dumps(replay["agent"])
    assert all(value not in encoded for value in (
        "desire-from-old-cache", "commitment-from-old-cache", '"love"', '"privacy"', '"security"',
    ))
    streamed = c.post("/api/v1/chat/stream", headers=headers, json={"message": "ignored again"})
    stream_events = [json.loads(line) for line in streamed.text.splitlines()]
    assert stream_events[-1]["type"] == "final"
    assert stream_events[-1]["data"]["agent"] == replay["agent"]


def test_positive_relationship_growth_has_a_per_character_daily_cap(tmp_path):
    c = client(tmp_path, Stub())
    headers = auth(c)
    results = [c.post("/api/v1/chat", headers={**headers, "Idempotency-Key": f"bond-cap-{index:02d}"},
                      json={"message": "I am here for you."}).json() for index in range(3)]
    assert [item["relationship_change"] for item in results] == [5, 5, 0]
    assert results[-1]["stats"]["relationship"] == 45


def test_invalid_input_has_unified_error_and_does_not_mutate(tmp_path):
    c = client(tmp_path)
    headers = {**auth(c), "Idempotency-Key": "12345678-abcd"}
    response = c.post("/api/v1/chat", headers=headers, json={"message": "  "})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_MESSAGE"
    assert c.get("/api/v1/room", headers=headers).json()["stats"]["relationship"] == 35


def test_fallback_when_primary_raises(tmp_path):
    class Broken:
        def reply(self, *args): raise TimeoutError
    from lingolife.ai import ResilientProvider
    c = client(tmp_path, ResilientProvider(Broken()))
    response = c.post("/api/v1/chat", headers={**auth(c), "Idempotency-Key": "abcdefgh"}, json={"message": "Are you okay?"})
    assert response.status_code == 200
    assert response.json()["english_xp_change"] == 1
    assert response.json()["npc_reply_zh"]
    assert c.get("/api/v1/room", headers=response.request.headers).json()["messages"][-1]["translation"]


def test_ununderstandable_never_gains_xp(tmp_path):
    class BadEnglish:
        def reply(self, *args):
            return AIResult(npc_reply="Could you say that another way?", relationship_change=0, mood_change=0, english_xp_change=5,
                english_feedback=EnglishFeedback(is_understandable=False, corrected_text="", tip="Try a sentence.", tags=[]))
    c = client(tmp_path, BadEnglish())
    data = c.post("/api/v1/chat", headers={**auth(c), "Idempotency-Key": "abcdefgh"}, json={"message": "???"}).json()
    assert data["english_xp_change"] == 0 and data["stats"]["english_xp"] == 0


def test_fallback_non_english_input_does_not_award_xp(tmp_path):
    from lingolife.ai import FallbackProvider
    c = client(tmp_path, FallbackProvider())
    data = c.post(
        "/api/v1/chat",
        headers={**auth(c), "Idempotency-Key": "request-cn-001"},
        json={"message": "你今天怎么了？"},
    ).json()
    assert data["english_xp_change"] == 0
    assert data["english_feedback"]["is_understandable"] is False


def test_chat_stream_sends_delta_then_validated_final_result(tmp_path):
    import json
    from lingolife.ai import ResilientProvider
    c = client(tmp_path, ResilientProvider(None))
    response = c.post("/api/v1/chat/stream", headers={**auth(c), "Idempotency-Key": "stream-0001"},
                      json={"message": "Why did that happen?", "npc_id": "emma"})
    events = [json.loads(line) for line in response.text.splitlines()]
    assert response.status_code == 200
    assert events[0]["type"] == "delta" and events[0]["data"]
    assert events[-1]["type"] == "final"
    assert events[-1]["data"]["npc_reply"].startswith(events[0]["data"])
    assert events[-1]["data"]["stats"]["english_xp"] == 1
    assert all(isinstance(value, str)
               for value in events[-1]["data"]["agent"]["runtime_state"]["needs"].values())


def test_invite_registration_unique_username_session_and_logout(tmp_path):
    c = client(tmp_path)
    code1, code2 = c.app.state.db.create_invites(2, 7)
    registered = c.post("/api/v1/auth/register", json={"username": "Alice_1", "invite_code": code1, "password": "🌙 any format"})
    assert registered.status_code == 201
    token = registered.json()["session_token"]
    assert registered.json()["quota"] == {"daily_limit": 7, "used_today": 0, "bonus_credits": 0, "remaining": 7}
    assert c.get("/api/v1/auth/me", headers={"Authorization": "Bearer " + token}).json()["user"]["username"] == "Alice_1"
    duplicate = c.post("/api/v1/auth/register", json={"username": "alice_1", "invite_code": code2, "password": "anything"})
    assert duplicate.status_code == 409 and duplicate.json()["error"]["code"] == "USERNAME_TAKEN"
    assert c.post("/api/v1/auth/logout", headers={"Authorization": "Bearer " + token}).status_code == 204
    assert c.get("/api/v1/auth/me", headers={"Authorization": "Bearer " + token}).status_code == 401
    # Only the SHA-256 digest is persisted, never the bearer secret.
    stored = c.app.state.db._connection.execute("SELECT token_hash FROM sessions").fetchone()[0]
    assert token not in stored and len(stored) == 64


def test_password_login_restores_the_same_account_on_another_device(tmp_path):
    c = client(tmp_path)
    code = c.app.state.db.create_invites(1, 7)[0]
    registered = c.post("/api/v1/auth/register", json={
        "username": "AcrossDevices", "invite_code": code, "password": "🌙 spaces and symbols !?",
    }).json()
    old_token = registered["session_token"]
    player_id = c.app.state.db.authenticate(old_token)["player_id"]
    c.app.state.db.state(player_id, "emma")
    with c.app.state.db._connection:
        c.app.state.db._connection.execute(
            "UPDATE npc_states SET relationship=39,mood=37,english_xp=1 WHERE player_id=? AND npc_id='emma'",
            (player_id,),
        )

    assert c.post("/api/v1/auth/login", json={"username": "acrossdevices", "password": "wrong"}).status_code == 401
    logged_in = c.post("/api/v1/auth/login", json={
        "username": "acrossdevices", "password": "🌙 spaces and symbols !?",
    })
    assert logged_in.status_code == 200
    new_token = logged_in.json()["session_token"]
    room = c.get("/api/v1/room", headers={"Authorization": "Bearer " + new_token}).json()
    assert room["stats"] == {"relationship": 39, "mood": 37, "english_xp": 1}
    stored = c.app.state.db._connection.execute(
        "SELECT password_hash FROM users WHERE username='AcrossDevices'"
    ).fetchone()[0]
    assert stored.startswith("pbkdf2_sha256$600000$")
    assert "spaces and symbols" not in stored


def test_logged_in_npc_list_and_city_reads_do_not_lock_a_file_database(tmp_path):
    database_path = tmp_path / "concurrent-reads.db"
    settings = Settings(
        database_url=f"sqlite:///{database_path}",
        web_root=str(tmp_path / "none"),
    )
    first = TestClient(create_app(settings, Stub()))
    headers = auth(first, username="parallel-reader")
    # Materialize the account's default resident before opening additional
    # application connections. The concurrent requests below still exercise
    # authentication activity writes and the city's lazy Agent/world refresh.
    assert first.get("/api/v1/npcs", headers=headers).status_code == 200
    # Independent application instances model concurrent server workers and,
    # crucially, give every request its own SQLite connection. Sharing one
    # sqlite3.Connection object across simultaneous Python threads would test
    # the driver object rather than file-level locking behavior.
    clients = [first, *(TestClient(create_app(settings, Stub())) for _ in range(7))]

    assert database_path.is_file()
    assert first.app.state.db.path != ":memory:"
    assert all(current.app.state.db._connection.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
               for current in clients)

    requests = [
        (current, "/api/v1/npcs" if index % 2 == 0 else "/api/v1/city")
        for index, current in enumerate(clients)
    ]
    ready = threading.Barrier(len(requests))

    def read(client_and_path):
        current, path = client_and_path
        try:
            ready.wait(timeout=10)
            response = current.get(path, headers=headers)
            return path, response.status_code, response.text
        except Exception as exc:  # Keep SQLite failures visible in one assertion.
            return path, None, f"{type(exc).__name__}: {exc}"

    with ThreadPoolExecutor(max_workers=len(requests)) as pool:
        results = list(pool.map(read, requests))

    failures = [result for result in results
                if result[1] != 200 or "database is locked" in result[2].casefold()]
    assert not failures, failures
    assert {path for path, _, _ in results} == {"/api/v1/npcs", "/api/v1/city"}


def test_legacy_account_can_set_password_once_and_password_change_revokes_other_sessions(tmp_path):
    c = client(tmp_path)
    db = c.app.state.db
    db.ensure_player("legacy-player")
    with db._connection:
        db._connection.execute(
            "INSERT INTO users(id,username,player_id,last_active_at) VALUES ('legacy-user','legacy','legacy-player',CURRENT_TIMESTAMP)"
        )
    legacy_token = db.create_session("legacy-user")
    headers = {"Authorization": "Bearer " + legacy_token}
    assert c.get("/api/v1/auth/me", headers=headers).json()["user"]["has_password"] is False
    assert c.put("/api/v1/auth/password", headers=headers, json={"new_password": "first", "current_password": None}).status_code == 200
    second = c.post("/api/v1/auth/login", json={"username": "legacy", "password": "first"}).json()["session_token"]
    second_headers = {"Authorization": "Bearer " + second}
    wrong = c.put("/api/v1/auth/password", headers=second_headers, json={"current_password": "nope", "new_password": "next"})
    assert wrong.status_code == 401
    assert c.put("/api/v1/auth/password", headers=second_headers, json={"current_password": "first", "new_password": "next"}).status_code == 200
    assert c.get("/api/v1/auth/me", headers=headers).status_code == 401
    assert c.post("/api/v1/auth/login", json={"username": "legacy", "password": "first"}).status_code == 401
    assert c.post("/api/v1/auth/login", json={"username": "legacy", "password": "next"}).status_code == 200


def test_invite_is_single_use_and_auth_is_required(tmp_path):
    c = client(tmp_path)
    code = c.app.state.db.create_invites(1, 30)[0]
    assert c.post("/api/v1/auth/register", json={"username": "first", "invite_code": code, "password": "x"}).status_code == 201
    reused = c.post("/api/v1/auth/register", json={"username": "second", "invite_code": code, "password": "x"})
    assert reused.status_code == 400 and reused.json()["error"]["code"] == "INVALID_INVITE"
    assert c.get("/api/v1/room", headers={"X-Player-Id": "forged"}).status_code == 401


def test_daily_quota_rate_limit_and_idempotency(tmp_path):
    c = client(tmp_path)
    headers = auth(c, quota=2)
    for i in range(2):
        result = c.post("/api/v1/chat", headers={**headers, "Idempotency-Key": f"request-{i:03d}"}, json={"message": "How are you?"})
        assert result.status_code == 200
    # Retry is cached and consumes no extra unit.
    retry = c.post("/api/v1/chat", headers={**headers, "Idempotency-Key": "request-001"}, json={"message": "ignored"})
    assert retry.status_code == 200 and retry.json()["quota"]["used_today"] == 2
    denied = c.post("/api/v1/chat", headers={**headers, "Idempotency-Key": "request-999"}, json={"message": "One more"})
    assert denied.status_code == 429 and denied.json()["error"]["code"] == "DAILY_QUOTA_EXCEEDED"


def test_minute_rate_limit(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'rate.db'}", web_root=str(tmp_path / "none"), chat_per_minute=1)
    c = TestClient(create_app(settings, Stub()))
    headers = auth(c, quota=10)
    assert c.post("/api/v1/chat", headers={**headers, "Idempotency-Key": "rate-0001"}, json={"message": "Hello"}).status_code == 200
    blocked = c.post("/api/v1/chat", headers={**headers, "Idempotency-Key": "rate-0002"}, json={"message": "Again"})
    assert blocked.status_code == 429 and blocked.json()["error"]["code"] == "RATE_LIMITED"


def test_admin_invites_user_management_summary_and_no_message_leak(tmp_path):
    c = client(tmp_path)
    origin = {"Origin": "https://lingolife.admin.shimooth.me"}
    bad = c.post("/api/v1/admin/login", headers=origin, json={"password": "wrong"})
    assert bad.status_code == 401
    login = c.post("/api/v1/admin/login", headers=origin, json={"password": "test-admin"})
    assert login.status_code == 200 and login.json() == {"authenticated": True}
    made = c.post("/api/v1/admin/invites", headers=origin, json={"count": 1, "daily_quota": 9})
    assert made.status_code == 201
    unused = c.get("/api/v1/admin/invites").json()["invites"]
    assert unused == [{"code": made.json()["invites"][0], "daily_quota": 9, "created_at": unused[0]["created_at"]}]
    encrypted = c.app.state.db._connection.execute("SELECT code_value FROM invitations WHERE used_at IS NULL").fetchone()[0]
    assert made.json()["invites"][0] not in encrypted
    token = c.post("/api/v1/auth/register", json={"username": "managed", "invite_code": made.json()["invites"][0], "password": "managed-pass"}).json()["session_token"]
    assert c.get("/api/v1/admin/invites").json() == {"invites": []}
    c.post("/api/v1/chat", headers={"Authorization": "Bearer " + token, "Idempotency-Key": "managed-001"}, json={"message": "private chat text"})
    listing = c.get("/api/v1/admin/users").json()
    assert "private chat text" not in str(listing)
    traces = c.get("/api/v1/admin/agent-traces").json()["traces"]
    assert len(traces) == 1 and "private chat text" not in str(traces)
    user_id = listing["users"][0]["id"]
    changed = c.patch(f"/api/v1/admin/users/{user_id}", headers=origin, json={"disabled": True, "quota_delta": 5})
    assert changed.status_code == 200 and changed.json()["disabled"] == 1
    assert changed.json()["quota"]["daily_limit"] == 9
    assert changed.json()["quota"]["bonus_credits"] == 5
    assert c.get("/api/v1/auth/me", headers={"Authorization": "Bearer " + token}).status_code == 403
    summary = c.get("/api/v1/admin/summary").json()
    assert summary["total_users"] == 1 and summary["chats_today"] == 1


def test_admin_mutations_reject_foreign_origin(tmp_path):
    c = client(tmp_path)
    c.post("/api/v1/admin/login", headers={"Origin": "https://lingolife.admin.shimooth.me"}, json={"password": "test-admin"})
    response = c.post("/api/v1/admin/invites", headers={"Origin": "https://evil.example"}, json={})
    assert response.status_code == 403 and response.json()["error"]["code"] == "INVALID_ORIGIN"


def test_admin_login_is_rate_limited(tmp_path):
    c = client(tmp_path)
    origin = {"Origin": "https://lingolife.admin.shimooth.me"}
    for _ in range(5):
        assert c.post("/api/v1/admin/login", headers=origin, json={"password": "wrong"}).status_code == 401
    blocked = c.post("/api/v1/admin/login", headers=origin, json={"password": "test-admin"})
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "TOO_MANY_ATTEMPTS"


def test_admin_is_closed_when_secrets_are_not_configured(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'closed.db'}", web_root=str(tmp_path / "none"))
    c = TestClient(create_app(settings, Stub()))
    assert c.post("/api/v1/admin/login", headers={"Origin": "https://lingolife.admin.shimooth.me"}, json={"password": ""}).status_code == 401
    c.cookies.set("lingolife_admin", "1.forged")
    assert c.get("/api/v1/admin/summary").status_code == 503
