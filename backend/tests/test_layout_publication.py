from __future__ import annotations

from copy import deepcopy
import json
import sqlite3

from fastapi.testclient import TestClient

from lingolife.app import DEFAULT_NPC_PROFILE, create_app
from lingolife.config import Settings
from lingolife.db import Database
from lingolife.layouts import default_world_layout


ORIGIN = {"Origin": "https://lingolife.admin.shimooth.me"}


def _client(tmp_path) -> TestClient:
    return TestClient(create_app(Settings(
        database_url=f"sqlite:///{tmp_path / 'layout-publication.db'}",
        web_root=str(tmp_path / "missing-web"),
        life_simulation_v2=True,
        admin_password="test-admin",
        admin_session_secret="test-secret",
        admin_cookie_secure=False,
    )))


def _login_admin(client: TestClient) -> None:
    response = client.post(
        "/api/v1/admin/login", headers=ORIGIN, json={"password": "test-admin"},
    )
    assert response.status_code == 200, response.text


def _valid_variant(layout: dict, offset: float) -> dict:
    result = deepcopy(layout)
    shared_home = next(
        item for item in result["city"]["buildings"] if item["id"] == "shared-home"
    )
    shared_home["position"]["x"] += offset
    return result


def _save_draft(client: TestClient, layout: dict, revision: int) -> dict:
    response = client.put(
        "/api/v1/admin/world-layout/draft", headers=ORIGIN,
        json={"layout": layout, "revision": revision, "author": "layout-tester"},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _publish(client: TestClient, revision: int, note: str) -> dict:
    response = client.post(
        "/api/v1/admin/world-layout/publish", headers=ORIGIN,
        json={"revision": revision, "note": note, "author": "layout-tester"},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_layout_schema_is_incremental_and_global_not_player_resettable(tmp_path):
    client = _client(tmp_path)
    db = client.app.state.db
    tables = {
        row[0] for row in db._connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
    }
    assert {
        "world_layout_drafts", "world_layout_versions", "world_layout_active",
        "world_layout_audit",
    } <= tables
    assert db._connection.execute(
        "SELECT description FROM schema_migrations WHERE version=4"
    ).fetchone()[0] == "immutable world layout authoring and publication"
    assert not {
        "world_layout_drafts", "world_layout_versions", "world_layout_active",
        "world_layout_audit",
    } & set(db._GAME_PROGRESS_TABLES)


def test_v4_migrates_the_legacy_published_row_without_deleting_it(tmp_path):
    path = tmp_path / "legacy-layout.db"
    legacy = default_world_layout()
    connection = sqlite3.connect(path)
    connection.executescript("""
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,description TEXT NOT NULL,
          applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        INSERT INTO schema_migrations(version,description)
          VALUES (3,'shared household onboarding and published world layout');
        CREATE TABLE world_layout_configs (
          scope TEXT PRIMARY KEY,layout_json TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    """)
    connection.execute(
        "INSERT INTO world_layout_configs(scope,layout_json) VALUES ('published',?)",
        (json.dumps(legacy),),
    )
    connection.commit()
    connection.close()

    db = Database(f"sqlite:///{path}")
    active = db.get_world_layout()
    assert active and active["layout"] == legacy
    assert active["active_version"]["author"] == "migration-v4"
    assert len(db.list_world_layout_versions()) == 1
    assert db._connection.execute(
        "SELECT layout_json FROM world_layout_configs WHERE scope='published'"
    ).fetchone() is not None


def test_server_draft_uses_compare_and_swap_and_reports_topology(tmp_path):
    client = _client(tmp_path)
    _login_admin(client)
    state = client.get("/api/v1/admin/world-layout").json()
    assert state["draft"]["revision"] == 0
    first = _save_draft(client, _valid_variant(state["layout"], 2.6), 0)
    assert first["revision"] == 1
    assert first["validation"]["valid"] is True
    assert first["validation"]["report"]["sky_road_exits"] >= 1

    stale = client.put(
        "/api/v1/admin/world-layout/draft", headers=ORIGIN,
        json={"layout": state["layout"], "revision": 0, "author": "stale-editor"},
    )
    assert stale.status_code == 409
    assert stale.json()["error"] == {
        "code": "LAYOUT_DRAFT_CONFLICT",
        "message": "草稿已被其他编辑器更新，请重新载入后再保存。",
        "current_revision": 1,
    }
    assert client.get("/api/v1/admin/world-layout/draft").json() == first


def test_invalid_draft_can_be_repaired_but_cannot_replace_active_layout(tmp_path):
    client = _client(tmp_path)
    _login_admin(client)
    default = client.get("/api/v1/world-layout").json()
    invalid = deepcopy(default["layout"])
    invalid["city"]["buildings"][0]["position"] = deepcopy(
        invalid["city"]["roads"][0]["position"]
    )
    invalid["city"]["buildings"][0]["position"]["x"] += .2

    draft = _save_draft(client, invalid, 0)
    assert draft["validation"]["valid"] is False
    assert "building.overlaps_road" in {
        issue["code"] for issue in draft["validation"]["issues"]
    }
    checked = client.post(
        "/api/v1/admin/world-layout/validate", headers=ORIGIN,
        json={"layout": invalid},
    )
    assert checked.status_code == 200
    assert checked.json() == draft["validation"]

    rejected = client.post(
        "/api/v1/admin/world-layout/publish", headers=ORIGIN,
        json={"revision": draft["revision"], "note": "bad topology"},
    )
    assert rejected.status_code == 422
    assert rejected.json()["error"]["code"] == "INVALID_LAYOUT_TOPOLOGY"
    assert client.get("/api/v1/world-layout").json() == default
    versions = client.get("/api/v1/admin/world-layout/versions").json()["versions"]
    assert len(versions) == 1 and versions[0]["is_default"] is True


def test_versions_are_immutable_content_addressed_idempotent_and_rollbackable(tmp_path):
    client = _client(tmp_path)
    _login_admin(client)
    default = client.get("/api/v1/world-layout").json()["layout"]

    first_draft = _save_draft(client, _valid_variant(default, 2.6), 0)
    first = _publish(client, first_draft["revision"], "共享住宅向东移动一格")
    first_id = first["active_version"]["id"]
    first_hash = first["active_version"]["hash"]
    assert first_id == f"layout-{first_hash}"
    assert client.get("/api/v1/world-layout").json()["layout"] == first["layout"]

    # Re-publishing byte-equivalent canonical content reuses the immutable
    # version instead of editing its original note, author or timestamp.
    same_draft = _save_draft(client, deepcopy(first["layout"]), first["draft"]["revision"])
    same = _publish(client, same_draft["revision"], "这条说明不得改写旧版本")
    assert same["active_version"]["id"] == first_id
    versions = same["versions"]
    assert len(versions) == 2
    authored = next(version for version in versions if version["id"] == first_id)
    assert authored["note"] == "共享住宅向东移动一格"

    second_draft = _save_draft(client, _valid_variant(default, 5.2), same["draft"]["revision"])
    second = _publish(client, second_draft["revision"], "共享住宅向东移动两格")
    second_id = second["active_version"]["id"]
    assert second_id != first_id
    assert len(second["versions"]) == 3

    rollback = client.post(
        f"/api/v1/admin/world-layout/versions/{first_id}/activate",
        headers=ORIGIN, json={"note": "美术验收后回滚", "author": "reviewer"},
    )
    assert rollback.status_code == 200, rollback.text
    rolled_back = rollback.json()
    assert rolled_back["active_version"]["id"] == first_id
    assert rolled_back["layout"] == first["layout"]
    history = client.get("/api/v1/admin/world-layout/versions").json()
    assert len(history["versions"]) == 3
    assert {first_id, second_id} <= {version["id"] for version in history["versions"]}
    assert history["audit"][0]["action"] == "activate"
    assert history["audit"][0]["previous_version_id"] == second_id


def test_legacy_put_and_default_reset_publish_instead_of_overwriting(tmp_path):
    client = _client(tmp_path)
    _login_admin(client)
    default = client.get("/api/v1/world-layout").json()["layout"]
    edited = _valid_variant(default, 2.6)
    published = client.put(
        "/api/v1/admin/world-layout", headers=ORIGIN,
        json={"layout": edited, "note": "旧客户端发布"},
    )
    assert published.status_code == 200, published.text
    edited_id = client.get("/api/v1/admin/world-layout").json()["active_version"]["id"]

    reset = client.post("/api/v1/admin/world-layout/reset", headers=ORIGIN)
    assert reset.status_code == 200, reset.text
    assert reset.json()["layout"] == default
    assert reset.json()["updated_at"] is None
    reset_id = client.get("/api/v1/admin/world-layout").json()["active_version"]["id"]
    assert reset_id != edited_id
    versions = client.get("/api/v1/admin/world-layout/versions").json()["versions"]
    assert len(versions) == 2
    assert edited_id in {version["id"] for version in versions}


def _resident(name: str, index: int) -> dict:
    profile = deepcopy(DEFAULT_NPC_PROFILE)
    profile.update({
        "name": name, "occupation": f"job-{index}",
        "personality": ["kind", f"trait-{index}"],
        "interests": ["art", f"interest-{index}"],
        "householdRole": ["organizer", "caretaker"][index],
        "chorePreferences": [["cooking"], ["cleaning"]][index],
        "privateSpacePreference": ["low", "high"][index],
        "habits": [f"routine-{index}"],
    })
    return profile


DYNAMIC_FACT_TABLES = (
    "npc_states", "messages", "npc_profiles", "npc_memories", "learning_states",
    "npc_runtime_states", "npc_relationships", "npc_goals", "npc_daily_plans",
    "npc_social_edges", "npc_social_events", "life_world_states", "residences",
    "households", "household_members", "household_resources", "npc_desires",
    "npc_life_actions", "life_stories", "life_story_observations",
    "life_interventions", "unresolved_threads", "npc_relationship_bonds",
    "relationship_evidence",
)


def _fact_fingerprint(client: TestClient) -> str:
    db = client.app.state.db
    snapshot = {}
    for table in DYNAMIC_FACT_TABLES:
        rows = db._connection.execute(f'SELECT * FROM "{table}" ORDER BY rowid').fetchall()
        snapshot[table] = [dict(row) for row in rows]
    return json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def test_publish_failure_success_and_rollback_never_mutate_dynamic_world_facts(tmp_path):
    client = _client(tmp_path)
    invite = client.app.state.db.create_invites(1, 30)[0]
    registered = client.post("/api/v1/auth/register", json={
        "username": "layout-facts", "password": "pw", "invite_code": invite,
    }).json()
    auth = {"Authorization": f"Bearer {registered['session_token']}"}
    assert client.post(
        "/api/v1/onboarding/intro/acknowledge", headers=auth,
        json={"intro_version": 1},
    ).status_code == 200
    completed = client.post(
        "/api/v1/onboarding/complete", headers=auth,
        json={"household_name": "Cloud Home",
              "residents": [_resident("Ava", 0), _resident("Bo", 1)]},
    )
    assert completed.status_code == 201, completed.text
    assert client.get("/api/v1/world", headers=auth).status_code == 200
    before = _fact_fingerprint(client)

    _login_admin(client)
    default = client.get("/api/v1/world-layout").json()["layout"]
    first_draft = _save_draft(client, _valid_variant(default, 2.6), 0)
    first = _publish(client, first_draft["revision"], "动态事实不变 - 1")
    first_id = first["active_version"]["id"]
    assert _fact_fingerprint(client) == before

    invalid = deepcopy(default)
    invalid["city"]["buildings"][0]["position"] = deepcopy(
        invalid["city"]["roads"][0]["position"]
    )
    invalid["city"]["buildings"][0]["position"]["x"] += .2
    invalid_draft = _save_draft(client, invalid, first["draft"]["revision"])
    rejected = client.post(
        "/api/v1/admin/world-layout/publish", headers=ORIGIN,
        json={"revision": invalid_draft["revision"], "note": "必须失败"},
    )
    assert rejected.status_code == 422
    assert client.get("/api/v1/admin/world-layout").json()["active_version"]["id"] == first_id
    assert _fact_fingerprint(client) == before

    second_draft = _save_draft(
        client, _valid_variant(default, 5.2), invalid_draft["revision"],
    )
    second = _publish(client, second_draft["revision"], "动态事实不变 - 2")
    assert second["active_version"]["id"] != first_id
    assert _fact_fingerprint(client) == before

    rollback = client.post(
        f"/api/v1/admin/world-layout/versions/{first_id}/activate",
        headers=ORIGIN, json={"note": "动态事实不变 - 回滚"},
    )
    assert rollback.status_code == 200
    assert _fact_fingerprint(client) == before


def test_all_layout_writes_require_admin_cookie_and_allowed_origin(tmp_path):
    client = _client(tmp_path)
    layout = client.get("/api/v1/world-layout").json()["layout"]
    writes = (
        ("PUT", "/api/v1/admin/world-layout/draft",
         {"layout": layout, "revision": 0}),
        ("POST", "/api/v1/admin/world-layout/validate", {"layout": layout}),
        ("POST", "/api/v1/admin/world-layout/publish",
         {"revision": 1, "note": "unauthorized"}),
        ("POST", "/api/v1/admin/world-layout/versions/unknown/activate",
         {"note": "unauthorized"}),
        ("PUT", "/api/v1/admin/world-layout", {"layout": layout}),
        ("POST", "/api/v1/admin/world-layout/reset", None),
    )
    for method, path, body in writes:
        response = client.request(method, path, json=body)
        assert response.status_code == 401, (method, path, response.text)

    _login_admin(client)
    for method, path, body in writes:
        response = client.request(
            method, path, headers={"Origin": "https://evil.example"}, json=body,
        )
        assert response.status_code == 403, (method, path, response.text)
