from __future__ import annotations

import sqlite3
from datetime import date

import pytest
from fastapi.testclient import TestClient

from lingolife.app import DEFAULT_NPC_PROFILE, create_app
from lingolife.config import Settings
from lingolife.db import Database
from lingolife.social import SocialWorldEngine


def database(tmp_path, name="social.db") -> Database:
    return Database(f"sqlite:///{tmp_path / name}")


def residents():
    return [
        {"id": "ava", "profile": {"name": "Ava", "personality": ["kind", "curious"],
                                    "interests": ["music", "books"], "occupation": "Designer",
                                    "longTermGoal": "Create a community art show"}},
        {"id": "bo", "profile": {"name": "Bo", "personality": ["quiet", "kind"],
                                   "interests": ["music", "cooking"], "occupation": "Chef",
                                   "longTermGoal": "Bring people together through art"}},
    ]


def plans(location="moonlight_cafe"):
    return {npc_id: {"slots": {
        "morning": {"location_id": location}, "afternoon": {"location_id": location},
        "evening": {"location_id": "riverside_park"},
    }} for npc_id in ("ava", "bo")}


def test_existing_social_table_is_incrementally_migrated_and_data_is_kept(tmp_path):
    path = tmp_path / "legacy-social.db"
    connection = sqlite3.connect(path)
    connection.execute("CREATE TABLE npc_social_edges (player_id TEXT,npc_a TEXT,npc_b TEXT,affinity INTEGER DEFAULT 50,status TEXT DEFAULT 'neutral',updated_at TEXT,PRIMARY KEY(player_id,npc_a,npc_b))")
    connection.execute("INSERT INTO npc_social_edges VALUES ('p','ava','bo',77,'friend','2026-01-01')")
    connection.commit(); connection.close()

    db = Database(f"sqlite:///{path}")
    columns = {row[1] for row in db._connection.execute("PRAGMA table_info(npc_social_edges)")}
    tables = {row[0] for row in db._connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"familiarity", "trust", "affinity", "tension", "status"} <= columns
    assert "npc_social_events" in tables
    edges = db.ensure_social_edges("p", ["ava", "bo"])
    assert len(edges) == 2
    assert next(edge for edge in edges if edge["npc_a"] == "ava")["affinity"] == 77


def test_directional_edges_are_stable_scoped_and_independent(tmp_path):
    db = database(tmp_path)
    first = db.ensure_social_edges("p", ["ava", "bo", "cy"])
    assert len(first) == 6
    assert first == db.ensure_social_edges("p", ["cy", "bo", "ava"])
    changed = db.save_social_edge("p", "ava", "bo", trust=91, tension=2)
    reverse = next(edge for edge in db.ensure_social_edges("p", ["ava", "bo"])
                   if edge["npc_a"] == "bo" and edge["npc_b"] == "ava")
    assert changed["trust"] == 91 and reverse["trust"] != 91
    assert len(db.ensure_social_edges("another-player", ["ava", "bo"])) == 2


def test_daily_autonomous_event_is_date_stable_idempotent_and_gives_distinct_memories(tmp_path):
    db = database(tmp_path)
    engine = SocialWorldEngine(db)
    day = date(2026, 8, 21)
    before = {(edge["npc_a"], edge["npc_b"]): edge for edge in db.ensure_social_edges("p", ["ava", "bo"])}
    first = engine.ensure_daily("p", residents(), plans(), day, "afternoon", {"moonlight_cafe": "Moonlight Cafe"})
    second = engine.ensure_daily("p", list(reversed(residents())), plans(), day, "evening")
    assert len(first) == 1 and first[0]["id"] == second[0]["id"]
    assert first[0]["status"] == "resolved_autonomously"
    assert first[0]["location_id"] == "moonlight_cafe"
    assert first[0]["participant_ids"] == ["ava", "bo"]
    after = {(edge["npc_a"], edge["npc_b"]): edge for edge in db.ensure_social_edges("p", ["ava", "bo"])}
    assert after[("ava", "bo")]["affinity"] > before[("ava", "bo")]["affinity"]
    memories_a = db.list_npc_memories("p", "ava", kind="social")
    memories_b = db.list_npc_memories("p", "bo", kind="social")
    assert len(memories_a) == len(memories_b) == 1
    assert memories_a[0]["content"] != memories_b[0]["content"]
    assert memories_a[0]["source_event_id"] == first[0]["id"]
    tomorrow = engine.ensure_daily("p", residents(), plans(), date(2026, 8, 22), "afternoon")
    assert tomorrow[0]["id"] != first[0]["id"]


def test_high_impact_event_waits_for_management_and_resolution_is_idempotent(tmp_path):
    db = database(tmp_path)
    db.ensure_social_edges("p", ["ava", "bo"])
    db.save_social_edge("p", "ava", "bo", tension=70, trust=30, affinity=30)
    db.save_social_edge("p", "bo", "ava", tension=65, trust=35, affinity=32)
    engine = SocialWorldEngine(db)
    event = engine.ensure_daily("p", residents(), plans(), date(2026, 8, 21))[0]
    assert event["template_id"] == "small_misunderstanding"
    assert event["status"] == "awaiting_management"
    assert event["management"]["can_intervene"] is True
    assert engine.ensure_daily("p", residents(), plans(), date(2026, 8, 22))[0]["id"] == event["id"]
    before = db.ensure_social_edges("p", ["ava", "bo"])
    resolved = engine.intervene("p", event["id"], "mediate")
    again = engine.intervene("p", event["id"], "mediate")
    assert resolved["status"] == "resolved_with_management"
    assert again["outcome"] == resolved["outcome"]
    assert len(db.list_npc_memories("p", "ava", kind="social")) == 1
    assert db.ensure_social_edges("p", ["ava", "bo"]) != before
    with pytest.raises(RuntimeError):
        engine.intervene("p", event["id"], "give_space")


def test_city_and_world_lazy_generate_observable_social_interactions(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'api-social.db'}", web_root=str(tmp_path / "none"))
    client = TestClient(create_app(settings))
    code = client.app.state.db.create_invites(1, 30)[0]
    registered = client.post("/api/v1/auth/register", json={
        "username": "social-user", "invite_code": code, "password": "x",
    }).json()
    headers = {"Authorization": "Bearer " + registered["session_token"]}
    second = {**DEFAULT_NPC_PROFILE, "name": "Milo", "interests": ["art", "music"],
              "avatar": dict(DEFAULT_NPC_PROFILE["avatar"])}
    assert client.post("/api/v1/npcs", headers=headers, json=second).status_code == 201

    city = client.get("/api/v1/city", headers=headers).json()
    world = client.get("/api/v1/world", headers=headers).json()
    assert len(city["social_interactions"]) == 1
    assert city["social_interactions"][0]["id"] == world["social_interactions"][0]["id"]
    assert all("social_interaction_ids" in resident and "related_npc_ids" in resident for resident in city["npcs"])
    listing = client.get("/api/v1/social-events", headers=headers).json()["social_interactions"]
    assert listing[0]["id"] == city["social_interactions"][0]["id"]
    npc_id = listing[0]["participant_ids"][0]
    agent = client.get(f"/api/v1/npcs/{npc_id}/agent", headers=headers).json()
    assert agent["social_interactions"][0]["id"] == listing[0]["id"]


def test_management_intervention_api_is_owned_scoped_and_idempotent(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'api-management.db'}", web_root=str(tmp_path / "none"))
    client = TestClient(create_app(settings))
    db = client.app.state.db
    code = db.create_invites(1, 30)[0]
    registered = client.post("/api/v1/auth/register", json={
        "username": "manager-user", "invite_code": code, "password": "x",
    }).json()
    headers = {"Authorization": "Bearer " + registered["session_token"]}
    second = {**DEFAULT_NPC_PROFILE, "name": "June", "interests": ["cooking"],
              "personality": ["sensitive", "quiet"], "avatar": dict(DEFAULT_NPC_PROFILE["avatar"])}
    npc_id = client.post("/api/v1/npcs", headers=headers, json=second).json()["id"]
    player_id = db.authenticate(registered["session_token"])["player_id"]
    db.ensure_social_edges(player_id, ["emma", npc_id])
    db.save_social_edge(player_id, "emma", npc_id, tension=70)
    db.save_social_edge(player_id, npc_id, "emma", tension=70)
    event = client.get("/api/v1/city", headers=headers).json()["social_interactions"][0]
    assert event["status"] == "awaiting_management"
    endpoint = f"/api/v1/social-events/{event['id']}/intervene"
    first = client.post(endpoint, headers=headers, json={"action": "mediate"})
    retry = client.post(endpoint, headers=headers, json={"action": "mediate"})
    closed = client.post(endpoint, headers=headers, json={"action": "give_space"})
    assert first.status_code == retry.status_code == 200
    assert first.json()["outcome"] == retry.json()["outcome"]
    assert closed.status_code == 409 and closed.json()["error"]["code"] == "SOCIAL_EVENT_CLOSED"
