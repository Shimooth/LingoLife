from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import json
import math
import sqlite3
from threading import Barrier

from fastapi.testclient import TestClient
import pytest

from lingolife.app import DEFAULT_NPC_PROFILE, create_app
from lingolife.config import Settings
from lingolife.db import Database


def _client(tmp_path, *, life=True) -> TestClient:
    return TestClient(create_app(Settings(
        database_url=f"sqlite:///{tmp_path / 'onboarding-layout.db'}",
        web_root=str(tmp_path / "missing-web"),
        life_simulation_v2=life,
        admin_password="test-admin",
        admin_session_secret="test-secret",
        admin_cookie_secure=False,
    )))


def _auth(client: TestClient, username: str = "onboarding-user") -> dict[str, str]:
    invite = client.app.state.db.create_invites(1, 30)[0]
    response = client.post("/api/v1/auth/register", json={
        "username": username, "invite_code": invite, "password": "password",
    })
    assert response.status_code == 201, response.text
    return {"Authorization": "Bearer " + response.json()["session_token"]}


def _profile(name: str) -> dict:
    value = deepcopy(DEFAULT_NPC_PROFILE)
    value["name"] = name
    return value


def test_default_emma_does_not_complete_onboarding_and_two_created_residents_do(tmp_path):
    client = _client(tmp_path)
    headers = _auth(client)

    initial = client.get("/api/v1/onboarding", headers=headers).json()
    assert initial == {
        "version": 1, "completed": False, "min_residents": 2, "max_residents": 8,
        "resident_count": 0, "user_created_count": 0, "remaining_slots": 8,
        "household_name": "Our Home", "completed_at": None, "updated_at": None,
    }

    # The legacy list route may still materialize Emma for old clients, but she
    # is not treated as a player-created onboarding resident.
    listing = client.get("/api/v1/npcs", headers=headers).json()
    assert listing["limit"] == 8
    assert [entry["id"] for entry in listing["npcs"]] == ["emma"]
    assert listing["onboarding"]["completed"] is False
    assert listing["onboarding"]["user_created_count"] == 0

    first = client.post("/api/v1/npcs", headers=headers, json=_profile("Ava"))
    assert first.status_code == 201, first.text
    assert first.json()["onboarding"]["completed"] is False
    second = client.post("/api/v1/npcs", headers=headers, json=_profile("Bo"))
    assert second.status_code == 201, second.text
    assert second.json()["onboarding"]["completed"] is True

    world = client.get("/api/v1/world", headers=headers).json()
    assert len(world["npcs"]) == 3
    assert len(world["households"]) == 1
    household = world["households"][0]
    assert {member["npc_id"] for member in household["members"]} == {
        resident["id"] for resident in world["npcs"]
    }
    assert len({resident["household_id"] for resident in world["npcs"]}) == 1
    assert len({resident["home"]["id"] for resident in world["npcs"]}) == 1


def test_v3_grandfathers_an_existing_single_emma_but_not_accounts_created_after_migration(tmp_path):
    path = tmp_path / "pre-v3.db"
    connection = sqlite3.connect(path)
    connection.executescript("""
        CREATE TABLE npc_profiles (
          player_id TEXT NOT NULL,npc_id TEXT NOT NULL,profile_json TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY(player_id,npc_id));
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,description TEXT NOT NULL,
          applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    """)
    connection.execute(
        "INSERT INTO npc_profiles(player_id,npc_id,profile_json) VALUES (?,?,?)",
        ("existing-player", "emma", json.dumps(_profile("Emma"))),
    )
    connection.commit()
    connection.close()

    db = Database(f"sqlite:///{path}")
    legacy = db.onboarding_state("existing-player")
    assert legacy["completed"] is True
    assert legacy["resident_count"] == 1
    assert legacy["user_created_count"] == 0
    assert legacy["completed_at"]

    db.ensure_player("post-v3-player")
    fresh = db.onboarding_state("post-v3-player")
    assert fresh["completed"] is False
    assert fresh["resident_count"] == 0


def test_batch_onboarding_atomically_creates_up_to_eight_without_legacy_emma(tmp_path):
    client = _client(tmp_path)
    headers = _auth(client, "full-cast")
    residents = [_profile(f"Resident {index}") for index in range(1, 9)]

    response = client.post("/api/v1/onboarding/complete", headers=headers, json={
        "household_name": "Cloud House", "residents": residents,
    })
    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["onboarding"]["completed"] is True
    assert payload["onboarding"]["resident_count"] == 8
    assert payload["onboarding"]["user_created_count"] == 8
    assert payload["onboarding"]["remaining_slots"] == 0
    assert len(payload["created"]) == len(payload["npcs"]) == 8
    assert "emma" not in {entry["id"] for entry in payload["npcs"]}
    assert payload["household"]["name"] == "Cloud House"
    assert {member["npc_id"] for member in payload["household"]["members"]} == {
        entry["id"] for entry in payload["npcs"]
    }

    rejected = client.post("/api/v1/npcs", headers=headers, json=_profile("Ninth"))
    assert rejected.status_code == 409
    assert rejected.json()["error"]["code"] == "NPC_LIMIT_REACHED"
    assert len(client.get("/api/v1/npcs", headers=headers).json()["npcs"]) == 8


def test_onboarding_batch_validation_does_not_partially_create_residents(tmp_path):
    client = _client(tmp_path)
    headers = _auth(client, "atomic-cast")
    invalid = [_profile("Valid"), _profile("Also Valid")]
    invalid[1]["avatar"]["skin"] = "not-a-color"

    response = client.post("/api/v1/onboarding/complete", headers=headers, json={
        "household_name": "Our Home", "residents": invalid,
    })
    assert response.status_code == 422
    assert client.get("/api/v1/onboarding", headers=headers).json()["resident_count"] == 0


def test_onboarding_names_are_unique_after_whitespace_and_case_normalization(tmp_path):
    client = _client(tmp_path)
    headers = _auth(client, "unique-cast")
    residents = [_profile("Ava"), _profile("  ava  ")]

    response = client.post("/api/v1/onboarding/complete", headers=headers, json={
        "household_name": "Our Home", "residents": residents,
    })

    assert response.status_code == 422
    assert client.get("/api/v1/onboarding", headers=headers).json()["resident_count"] == 0


def test_onboarding_transaction_rechecks_completion_and_rolls_back_every_resident(tmp_path):
    db = Database(f"sqlite:///{tmp_path / 'atomic-authority.db'}")
    db.ensure_player("player-1")
    residents = [
        {"id": "npc-ava", "profile": _profile("Ava")},
        {"id": "npc-bo", "profile": _profile("Bo")},
    ]
    assert len(db.create_onboarding_residents("player-1", residents, "Home")) == 2

    with pytest.raises(ValueError, match="ONBOARDING_ALREADY_COMPLETED"):
        db.create_onboarding_residents("player-1", [
            {"id": "npc-cy", "profile": _profile("Cy")},
            {"id": "npc-di", "profile": _profile("Di")},
        ], "Another Home")
    assert {entry["id"] for entry in db.list_npc_profiles("player-1")} == {
        "npc-ava", "npc-bo",
    }

    # The public API validates profiles first, but the transaction itself must
    # still be all-or-nothing if an unexpected persistence-time failure occurs.
    db.ensure_player("player-2")
    with pytest.raises(ValueError, match="RESERVED_NPC_ID"):
        db.create_onboarding_residents("player-2", [
            {"id": "npc-valid", "profile": _profile("Valid")},
            {"id": "emma", "profile": _profile("Reserved")},
        ], "Home")
    assert db.list_npc_profiles("player-2") == []
    assert db.onboarding_state("player-2")["completed"] is False


def test_concurrent_onboarding_requests_have_one_cross_connection_winner(tmp_path):
    path = tmp_path / "concurrent-onboarding.db"
    first = Database(f"sqlite:///{path}")
    second = Database(f"sqlite:///{path}")
    first.ensure_player("player-1")
    barrier = Barrier(2)

    def submit(db: Database, prefix: str):
        residents = [
            {"id": f"npc-{prefix}-1", "profile": _profile(f"{prefix} One")},
            {"id": f"npc-{prefix}-2", "profile": _profile(f"{prefix} Two")},
        ]
        barrier.wait()
        try:
            db.create_onboarding_residents("player-1", residents, f"{prefix} Home")
            return "created"
        except ValueError as error:
            return str(error)

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(lambda args: submit(*args), (
            (first, "Alpha"), (second, "Beta"),
        )))

    assert sorted(outcomes) == ["ONBOARDING_ALREADY_COMPLETED", "created"]
    assert len(first.list_npc_profiles("player-1")) == 2
    assert first.onboarding_state("player-1")["completed"] is True


def test_existing_and_individual_character_names_use_the_same_unique_constraint(tmp_path):
    client = _client(tmp_path)
    headers = _auth(client, "unique-existing")
    # The legacy listing creates Emma but does not complete onboarding.
    client.get("/api/v1/npcs", headers=headers)

    batch = client.post("/api/v1/onboarding/complete", headers=headers, json={
        "household_name": "Our Home",
        "residents": [_profile("Ｅｍｍａ"), _profile("Bo")],
    })
    assert batch.status_code == 409
    assert batch.json()["error"]["code"] == "NPC_NAME_TAKEN"
    assert client.get("/api/v1/onboarding", headers=headers).json()["resident_count"] == 1

    created = client.post("/api/v1/npcs", headers=headers, json=_profile("Ava"))
    assert created.status_code == 201
    duplicate = client.post("/api/v1/npcs", headers=headers, json=_profile("  AVA "))
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "NPC_NAME_TAKEN"

    renamed = client.put(
        f"/api/v1/npcs/{created.json()['id']}", headers=headers, json=_profile("Emma"),
    )
    assert renamed.status_code == 409
    assert renamed.json()["error"]["code"] == "NPC_NAME_TAKEN"


def test_published_layout_default_is_complete_legal_and_public(tmp_path):
    client = _client(tmp_path)
    response = client.get("/api/v1/world-layout")
    assert response.status_code == 200
    payload = response.json()
    assert payload["updated_at"] is None
    layout = payload["layout"]
    assert layout["version"] == 1
    assert {key: len(value) for key, value in layout["city"].items()} == {
        "roads": 100, "buildings": 54, "props": 40, "decorations": 35,
    }
    assert {room["id"] for room in layout["interior"]["rooms"]} == {
        "living-room", "kitchen", "bathroom", "bedroom",
    }
    assert all(room["placements"] for room in layout["interior"]["rooms"])
    assert any(building["id"] == "shared-home" for building in layout["city"]["buildings"])
    road_positions = {(item["position"]["x"], item["position"]["z"])
                      for item in layout["city"]["roads"]}
    building_positions = {(item["position"]["x"], item["position"]["z"])
                          for item in layout["city"]["buildings"]}
    assert not road_positions & building_positions
    all_ids = [item["id"] for values in layout["city"].values() for item in values]
    assert len(all_ids) == len(set(all_ids))
    assert {item["position"]["y"] for item in layout["city"]["roads"]} == {.245}
    assert {item["position"]["y"] for item in layout["city"]["buildings"]} == {.369}
    # The KayKit road and building meshes both have a 2 m footprint.  On the
    # 2.6 m authoring grid, keeping buildings at or below the 1.3 road scale
    # prevents a model from visibly crossing the parcel boundary.
    assert max(item["scale"]["x"] for item in layout["city"]["buildings"]) <= 1.3
    decoration_positions = [
        (item["position"]["x"], item["position"]["z"])
        for item in layout["city"]["decorations"]
    ]
    assert min(math.dist(building, decoration) for building in building_positions
               for decoration in decoration_positions) >= 2.3
    assert min(math.dist(road, decoration) for road in road_positions
               for decoration in decoration_positions) >= 2.4


def test_admin_can_publish_persist_and_reset_a_strictly_validated_layout(tmp_path):
    client = _client(tmp_path)
    origin = {"Origin": "https://lingolife.admin.shimooth.me"}
    assert client.post("/api/v1/admin/login", headers=origin,
                       json={"password": "test-admin"}).status_code == 200
    default = client.get("/api/v1/admin/world-layout").json()["layout"]
    edited = deepcopy(default)
    shared_home = next(item for item in edited["city"]["buildings"]
                       if item["id"] == "shared-home")
    shared_home["position"]["x"] += 2.6

    saved = client.put("/api/v1/admin/world-layout", headers=origin, json={"layout": edited})
    assert saved.status_code == 200, saved.text
    assert saved.json()["updated_at"]
    assert client.get("/api/v1/world-layout").json() == saved.json()

    # Reopening the application against the same DB proves this is not an
    # in-process editor cache.
    reopened = _client(tmp_path)
    assert reopened.get("/api/v1/world-layout").json() == saved.json()

    invalid = deepcopy(edited)
    invalid["city"]["decorations"][0]["asset"] = "https://evil.example/model.gltf"
    denied = client.put("/api/v1/admin/world-layout", headers=origin, json={"layout": invalid})
    assert denied.status_code == 422
    assert client.get("/api/v1/world-layout").json() == saved.json()

    reset = client.post("/api/v1/admin/world-layout/reset", headers=origin)
    assert reset.status_code == 200
    assert reset.json()["updated_at"] is None
    assert reset.json()["layout"] == default


def test_layout_mutations_require_admin_origin_and_reject_unknown_fields(tmp_path):
    client = _client(tmp_path)
    layout = client.get("/api/v1/world-layout").json()["layout"]
    assert client.get("/api/v1/admin/world-layout").status_code == 401
    assert client.put("/api/v1/admin/world-layout", json={"layout": layout}).status_code == 401

    origin = {"Origin": "https://lingolife.admin.shimooth.me"}
    client.post("/api/v1/admin/login", headers=origin, json={"password": "test-admin"})
    forbidden = deepcopy(layout)
    forbidden["city"]["roads"][0]["script"] = "unexpected"
    response = client.put("/api/v1/admin/world-layout", headers=origin,
                          json={"layout": forbidden})
    assert response.status_code == 422
    wrong_origin = client.post(
        "/api/v1/admin/world-layout/reset", headers={"Origin": "https://evil.example"},
    )
    assert wrong_origin.status_code == 403


@pytest.mark.parametrize("mutate", [
    lambda layout: layout["city"]["buildings"].__setitem__(
        slice(None), [item for item in layout["city"]["buildings"] if item["id"] != "shared-home"],
    ),
    lambda layout: layout["city"]["buildings"][1].__setitem__(
        "location_id", layout["city"]["buildings"][0]["location_id"],
    ),
    lambda layout: layout["city"]["roads"][0]["position"].__setitem__("x", 10_000),
    lambda layout: layout["interior"]["rooms"][0].__setitem__("kind", "bathroom"),
])
def test_layout_publish_rejects_broken_world_semantics(tmp_path, mutate):
    client = _client(tmp_path)
    origin = {"Origin": "https://lingolife.admin.shimooth.me"}
    client.post("/api/v1/admin/login", headers=origin, json={"password": "test-admin"})
    layout = client.get("/api/v1/world-layout").json()["layout"]
    mutate(layout)

    response = client.put("/api/v1/admin/world-layout", headers=origin, json={"layout": layout})

    assert response.status_code == 422


def test_corrupt_persisted_layout_cannot_bypass_public_validation(tmp_path):
    client = _client(tmp_path)
    default = client.get("/api/v1/world-layout").json()
    client.app.state.db.save_world_layout({
        "version": 1, "city": {"roads": [], "buildings": [], "props": [], "decorations": []},
        "interior": {"rooms": []},
    })

    response = client.get("/api/v1/world-layout")

    assert response.status_code == 200
    assert response.json() == default
