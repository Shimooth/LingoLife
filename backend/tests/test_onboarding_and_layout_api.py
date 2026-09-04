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
from lingolife.life_service import LifeWorldService


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


def _ack(client: TestClient, headers: dict[str, str]) -> None:
    response = client.post(
        "/api/v1/onboarding/intro/acknowledge", headers=headers, json={"intro_version": 1},
    )
    assert response.status_code == 200, response.text


def _profile(name: str) -> dict:
    value = deepcopy(DEFAULT_NPC_PROFILE)
    value["name"] = name
    value["occupation"] = f"{name.strip()} specialist"
    value["personality"] = ["thoughtful", name.strip().casefold()]
    value["interests"] = ["art", f"{name.strip()} hobby"]
    index = sum(ord(character) for character in name.strip().casefold())
    roles = ["organizer", "caretaker", "mediator", "cook", "fixer", "free_spirit"]
    chores = ["cooking", "dishes", "cleaning", "shopping", "repairs", "laundry"]
    value["householdRole"] = roles[index % len(roles)]
    value["chorePreferences"] = [chores[index % len(chores)]]
    value["privateSpacePreference"] = ["low", "balanced", "high"][index % 3]
    value["habits"] = [f"{name.strip()} evening routine"]
    return value


def test_new_account_reads_are_non_mutating_and_only_batch_setup_opens_world(tmp_path):
    client = _client(tmp_path)
    headers = _auth(client)

    initial = client.get("/api/v1/onboarding", headers=headers).json()
    assert initial == {
        "version": 2, "completed": False,
        "setup_status": "not_started", "setup_key": None,
        "min_residents": 2, "max_residents": 8,
        "resident_count": 0, "user_created_count": 0, "remaining_slots": 8,
        "intro_version": None, "intro_acknowledged_at": None,
        "household_name": "Our Home", "completed_at": None, "updated_at": None,
    }
    _ack(client, headers)

    # Compatibility reads remain available but must not materialize Emma or
    # provide a write path around the authoritative batch saga.
    listing = client.get("/api/v1/npcs", headers=headers).json()
    assert listing["limit"] == 8
    assert listing["npcs"] == []
    assert listing["onboarding"]["completed"] is False
    assert listing["onboarding"]["user_created_count"] == 0
    assert client.get("/api/v1/npc/profile", headers=headers).status_code == 200
    assert client.get("/api/v1/npcs", headers=headers).json()["npcs"] == []

    for method, path in (
        ("POST", "/api/v1/npcs"),
        ("PUT", "/api/v1/npcs/not-created"),
        ("PUT", "/api/v1/npc/profile"),
    ):
        bypass = client.request(method, path, headers=headers, json=_profile("Ava"))
        assert bypass.status_code == 409
        assert bypass.json()["error"]["code"] == "WORLD_NOT_READY"
    assert client.get("/api/v1/onboarding", headers=headers).json()["resident_count"] == 0

    completed = client.post("/api/v1/onboarding/complete", headers=headers, json={
        "residents": [_profile("Ava"), _profile("Bo")],
    })
    assert completed.status_code == 201, completed.text
    assert completed.json()["onboarding"]["completed"] is True
    legacy_alias = client.put(
        "/api/v1/npc/profile", headers=headers, json=_profile("Emma"),
    )
    assert legacy_alias.status_code == 404
    assert legacy_alias.json()["error"]["code"] == "NPC_NOT_FOUND"

    world = client.get("/api/v1/world", headers=headers).json()
    assert len(world["npcs"]) == 2
    assert len(world["households"]) == 1
    household = world["households"][0]
    assert {member["npc_id"] for member in household["members"]} == {
        resident["id"] for resident in world["npcs"]
    }
    assert len({resident["household_id"] for resident in world["npcs"]}) == 1
    assert len({resident["home"]["id"] for resident in world["npcs"]}) == 1


def test_resident_count_cannot_complete_onboarding_outside_the_saga(tmp_path):
    db = Database(f"sqlite:///{tmp_path / 'count-bypass.db'}")
    db.ensure_player("fresh-player")
    db.acknowledge_onboarding_intro("fresh-player", 1)
    for npc_id, name in (("npc-ava", "Ava"), ("npc-bo", "Bo")):
        db.create_npc_profile(
            "fresh-player",
            npc_id,
            _profile(name),
            f"Hi, I'm {name}.",
            f"嗨，我是{name}。",
        )

    refreshed = db.refresh_onboarding("fresh-player")
    assert refreshed["resident_count"] == 2
    assert refreshed["completed"] is False
    assert refreshed["setup_status"] == "not_started"


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
    assert legacy["intro_version"] == 1
    assert legacy["intro_acknowledged_at"] == legacy["completed_at"]

    db.ensure_player("post-v3-player")
    fresh = db.onboarding_state("post-v3-player")
    assert fresh["completed"] is False
    assert fresh["resident_count"] == 0


def test_batch_onboarding_atomically_creates_up_to_eight_without_legacy_emma(tmp_path):
    client = _client(tmp_path)
    headers = _auth(client, "full-cast")
    _ack(client, headers)
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
    _ack(client, headers)
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
    _ack(client, headers)
    residents = [_profile("Ava"), _profile("  ava  ")]

    response = client.post("/api/v1/onboarding/complete", headers=headers, json={
        "household_name": "Our Home", "residents": residents,
    })

    assert response.status_code == 422
    assert client.get("/api/v1/onboarding", headers=headers).json()["resident_count"] == 0


def test_onboarding_transaction_rechecks_completion_and_rolls_back_every_resident(tmp_path):
    db = Database(f"sqlite:///{tmp_path / 'atomic-authority.db'}")
    db.ensure_player("player-1")
    db.acknowledge_onboarding_intro("player-1", 1)
    residents = [
        {"id": "npc-ava", "profile": _profile("Ava")},
        {"id": "npc-bo", "profile": _profile("Bo")},
    ]
    first = db.create_onboarding_residents("player-1", residents, "Home")
    assert len(first) == 2
    staged = db.onboarding_state("player-1")
    assert staged["setup_status"] == "initializing"
    assert staged["completed"] is False

    # A replay reuses the first transaction's resident IDs and rows.
    replay = db.create_onboarding_residents("player-1", [
        {"id": "ignored-ava", "profile": _profile("Ava")},
        {"id": "ignored-bo", "profile": _profile("Bo")},
    ], "Home")
    assert replay == first
    assert len(db.messages("player-1", 20, "npc-ava")) == 1

    with pytest.raises(ValueError, match="ONBOARDING_SETUP_IN_PROGRESS"):
        db.create_onboarding_residents("player-1", [
            {"id": "npc-cy", "profile": _profile("Cy")},
            {"id": "npc-di", "profile": _profile("Di")},
        ], "Another Home")
    assert {entry["id"] for entry in db.list_npc_profiles("player-1")} == {
        "npc-ava", "npc-bo",
    }
    db.ensure_social_edges("player-1", ["npc-ava", "npc-bo"])
    db.finalize_onboarding_setup(
        "player-1", staged["setup_key"], require_life_world=False,
    )
    assert db.onboarding_state("player-1")["completed"] is True
    with pytest.raises(ValueError, match="ONBOARDING_ALREADY_COMPLETED"):
        db.create_onboarding_residents("player-1", [
            {"id": "npc-cy", "profile": _profile("Cy")},
            {"id": "npc-di", "profile": _profile("Di")},
        ], "Another Home")

    # The public API validates profiles first, but the transaction itself must
    # still be all-or-nothing if an unexpected persistence-time failure occurs.
    db.ensure_player("player-2")
    db.acknowledge_onboarding_intro("player-2", 1)
    with pytest.raises(ValueError, match="RESERVED_NPC_ID"):
        db.create_onboarding_residents("player-2", [
            {"id": "npc-valid", "profile": _profile("Valid")},
            {"id": "emma", "profile": _profile("Reserved")},
        ], "Home")
    assert db.list_npc_profiles("player-2") == []
    assert db.onboarding_state("player-2")["completed"] is False


def test_concurrent_different_onboarding_requests_have_one_staging_winner(tmp_path):
    path = tmp_path / "concurrent-onboarding.db"
    first = Database(f"sqlite:///{path}")
    second = Database(f"sqlite:///{path}")
    first.ensure_player("player-1")
    first.acknowledge_onboarding_intro("player-1", 1)
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

    assert sorted(outcomes) == ["ONBOARDING_SETUP_IN_PROGRESS", "created"]
    assert len(first.list_npc_profiles("player-1")) == 2
    assert first.onboarding_state("player-1")["setup_status"] == "initializing"
    assert first.onboarding_state("player-1")["completed"] is False


def test_concurrent_same_setup_reuses_the_first_cast_and_greetings(tmp_path):
    path = tmp_path / "concurrent-replay.db"
    first = Database(f"sqlite:///{path}")
    second = Database(f"sqlite:///{path}")
    first.ensure_player("player-1")
    first.acknowledge_onboarding_intro("player-1", 1)
    barrier = Barrier(2)

    def submit(db: Database, prefix: str):
        barrier.wait()
        return db.create_onboarding_residents("player-1", [
            {"id": f"npc-{prefix}-1", "profile": _profile("Ava")},
            {"id": f"npc-{prefix}-2", "profile": _profile("Bo")},
        ], "Home")

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(lambda args: submit(*args), (
            (first, "alpha"), (second, "beta"),
        )))

    assert outcomes[0] == outcomes[1]
    assert len(first.list_npc_profiles("player-1")) == 2
    assert first._connection.execute(
        "SELECT count(*) FROM messages WHERE player_id='player-1'",
    ).fetchone()[0] == 2
    assert first.onboarding_state("player-1")["setup_status"] == "initializing"


@pytest.mark.parametrize("failure_point", ["social", "city", "household", "finalize"])
def test_setup_saga_recovers_from_each_projection_boundary_without_duplicates(
    tmp_path, monkeypatch, failure_point,
):
    client = _client(tmp_path)
    headers = _auth(client, f"saga-{failure_point}")
    _ack(client, headers)
    db = client.app.state.db
    payload = {
        "household_name": "Recovery Home",
        "residents": [_profile("Ava"), _profile("Bo")],
    }
    calls = 0

    if failure_point in {"social", "finalize"}:
        attribute = (
            "ensure_social_edges" if failure_point == "social"
            else "finalize_onboarding_setup"
        )
        original = getattr(db, attribute)

        def fail_db_once(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise RuntimeError(f"injected {failure_point} failure")
            return original(*args, **kwargs)

        monkeypatch.setattr(db, attribute, fail_db_once)
    else:
        attribute = "city" if failure_point == "city" else "rename_shared_household"
        original = getattr(LifeWorldService, attribute)

        def fail_world_once(self, *args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise RuntimeError(f"injected {failure_point} failure")
            return original(self, *args, **kwargs)

        monkeypatch.setattr(LifeWorldService, attribute, fail_world_once)

    with pytest.raises(RuntimeError, match=f"injected {failure_point} failure"):
        client.post("/api/v1/onboarding/complete", headers=headers, json=payload)

    staged = client.get("/api/v1/onboarding", headers=headers).json()
    assert staged["setup_status"] == "initializing"
    assert staged["completed"] is False
    assert staged["resident_count"] == 2
    assert client.get("/api/v1/world", headers=headers).status_code == 409
    counts_after_failure = {
        table: db._connection.execute(
            f"SELECT count(*) FROM {table} WHERE player_id=?", (db.authenticate(
                headers["Authorization"][7:]
            )["player_id"],),
        ).fetchone()[0]
        for table in ("npc_profiles", "npc_states", "messages")
    }
    assert counts_after_failure == {"npc_profiles": 2, "npc_states": 2, "messages": 2}

    recovered = client.post("/api/v1/onboarding/complete", headers=headers, json=payload)
    assert recovered.status_code == 201, recovered.text
    assert recovered.json()["onboarding"]["setup_status"] == "completed"
    assert recovered.json()["onboarding"]["completed"] is True
    created_ids = [entry["id"] for entry in recovered.json()["created"]]

    replay = client.post("/api/v1/onboarding/complete", headers=headers, json=payload)
    assert replay.status_code == 201, replay.text
    assert [entry["id"] for entry in replay.json()["created"]] == created_ids
    player_id = db.authenticate(headers["Authorization"][7:])["player_id"]
    assert {
        table: db._connection.execute(
            f"SELECT count(*) FROM {table} WHERE player_id=?", (player_id,),
        ).fetchone()[0]
        for table in ("npc_profiles", "npc_states", "messages")
    } == counts_after_failure
    assert db._connection.execute(
        "SELECT count(*) FROM npc_social_edges WHERE player_id=?", (player_id,),
    ).fetchone()[0] == 2
    assert db._connection.execute(
        "SELECT count(*) FROM life_world_states WHERE player_id=?", (player_id,),
    ).fetchone()[0] == 1
    assert db._connection.execute(
        "SELECT count(*) FROM households WHERE player_id=?", (player_id,),
    ).fetchone()[0] == 1
    assert db._connection.execute(
        "SELECT count(*) FROM household_members WHERE player_id=?", (player_id,),
    ).fetchone()[0] == 2


def test_batch_and_individual_character_names_use_the_same_unique_constraint(tmp_path):
    client = _client(tmp_path)
    headers = _auth(client, "unique-existing")
    _ack(client, headers)
    batch = client.post("/api/v1/onboarding/complete", headers=headers, json={
        "household_name": "Our Home",
        "residents": [_profile("Ava"), _profile("Bo")],
    })
    assert batch.status_code == 201, batch.text

    duplicate_batch_name = client.post(
        "/api/v1/npcs", headers=headers, json=_profile("  AVA "),
    )
    assert duplicate_batch_name.status_code == 409
    assert duplicate_batch_name.json()["error"]["code"] == "NPC_NAME_TAKEN"

    created = client.post("/api/v1/npcs", headers=headers, json=_profile("Cy"))
    assert created.status_code == 201
    duplicate = client.post("/api/v1/npcs", headers=headers, json=_profile("  CY "))
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "NPC_NAME_TAKEN"

    renamed = client.put(
        f"/api/v1/npcs/{created.json()['id']}", headers=headers, json=_profile("Bo"),
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
