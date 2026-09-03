from __future__ import annotations

from datetime import datetime, timedelta, timezone

from lingolife.db import Database
from lingolife.life_service import LifeWorldService


def _service(tmp_path) -> LifeWorldService:
    return LifeWorldService(Database(f"sqlite:///{tmp_path / 'household-topology.db'}"), "UTC")


def _entry(npc_id: str, *, with_ids=(), family_ids=()):
    return {
        "id": npc_id,
        "profile": {
            "name": npc_id.title(),
            "householdWithIds": list(with_ids),
            "familyIds": list(family_ids),
        },
    }


def test_player_authored_cohabitation_uses_the_selected_residents_home(tmp_path):
    service = _service(tmp_path)
    entries = [_entry("ava"), _entry("bo", with_ids=("ava",))]

    mapping = service._home_mapping("player-1", entries)

    assert mapping["ava"]["household_id"] == mapping["bo"]["household_id"]
    assert mapping["ava"]["home_location_id"] == mapping["bo"]["home_location_id"]
    assert mapping["ava"]["residence_id"] == mapping["bo"]["residence_id"]


def test_cohabitation_links_form_one_deterministic_small_household(tmp_path):
    service = _service(tmp_path)
    entries = [
        _entry("ava", with_ids=("bo",)),
        _entry("bo", with_ids=("cy",)),
        _entry("cy"),
    ]

    first = service._home_mapping("player-1", entries)
    replay = service._home_mapping("player-1", list(reversed(entries)))

    assert first == replay
    assert len({value["household_id"] for value in first.values()}) == 1
    assert len({value["home_location_id"] for value in first.values()}) == 1


def test_clearing_a_legacy_arrangement_cannot_split_the_players_shared_home(tmp_path):
    service = _service(tmp_path)
    stored = {
        "residents": {
            "ava": {
                "household_id": "shared", "home_location_id": "home-1",
                "current_location_id": "home-1", "residence_id": "shared-home",
            },
            "bo": {
                "household_id": "shared", "home_location_id": "home-1",
                "current_location_id": "shared:living-room", "residence_id": "shared-home",
            },
        },
    }

    mapping = service._home_mapping(
        "player-1", [_entry("ava"), _entry("bo")], stored,
    )

    assert mapping["ava"]["household_id"] == mapping["bo"]["household_id"] == "shared"
    assert mapping["ava"]["home_location_id"] == mapping["bo"]["home_location_id"] == "home-1"
    assert mapping["ava"]["current_location_id"] == mapping["ava"]["home_location_id"]
    assert mapping["bo"]["current_location_id"] == mapping["bo"]["home_location_id"]


def test_legacy_household_references_do_not_override_the_shared_home_invariant(tmp_path):
    service = _service(tmp_path)
    entries = [
        _entry("ava", with_ids=("ava",)),
        _entry("bo", with_ids=("another-player-resident",)),
    ]

    mapping = service._home_mapping("player-1", entries)

    assert mapping["ava"]["household_id"] == mapping["bo"]["household_id"]
    assert mapping["ava"]["home_location_id"] == mapping["bo"]["home_location_id"]


def test_existing_multi_household_world_migrates_without_losing_residents_or_relationships(tmp_path):
    service = _service(tmp_path)
    entries = [_entry("ava"), _entry("bo"), _entry("cy")]
    profiles = {entry["id"]: entry["profile"] for entry in entries}
    now = datetime(2026, 9, 3, 8, tzinfo=timezone.utc)
    state = service.engine.initialize(
        "legacy-player", profiles,
        {
            "ava": {"household_id": "household-a", "location_id": "home-1"},
            "bo": {"household_id": "household-a", "location_id": "home-1"},
            "cy": {"household_id": "household-c", "location_id": "home-8"},
        },
        now=now,
    )
    state["households"]["household-a"]["state"]["cleanliness"] = 17
    pair_keys = set(state["relationships"])
    first_pair = state["relationships"][sorted(pair_keys)[0]]
    first_pair["a_to_b"]["trust"] = 77
    state["aftermath"] = [{
        "id": "legacy-trace", "household_id": "household-c",
        "visible_after": now.isoformat(), "expires_at": (now + timedelta(days=1)).isoformat(),
    }]
    service.db.save_life_world_state(
        "legacy-player", state, rules_version=state["rules_version"],
        last_advanced_at=state["last_advanced_at"],
        next_transition_at=state["next_transition_at"], expected_revision=0,
    )

    # Migration is structural and must still happen if no simulated time has
    # elapsed since the legacy snapshot was written.
    migrated = service.load("legacy-player", entries, now=now)

    assert set(migrated["residents"]) == {"ava", "bo", "cy"}
    assert set(migrated["relationships"]) == pair_keys
    assert migrated["relationships"][sorted(pair_keys)[0]]["a_to_b"]["trust"] == 77
    assert set(migrated["households"]) == {"household-a"}
    assert migrated["households"]["household-a"]["state"]["cleanliness"] == 17
    assert {resident["household_id"] for resident in migrated["residents"].values()} == {
        "household-a",
    }
    assert {resident["home_location_id"] for resident in migrated["residents"].values()} == {
        "home-1",
    }
    assert migrated["aftermath"][0]["household_id"] == "household-a"
    assert {value["id"] for value in service.db.list_households("legacy-player")} == {
        "household-a",
    }


def test_unoccupied_legacy_household_is_removed_without_waiting_for_a_timed_transition(tmp_path):
    service = _service(tmp_path)
    entries = [_entry("ava"), _entry("bo")]
    profiles = {entry["id"]: entry["profile"] for entry in entries}
    now = datetime(2026, 9, 3, 8, tzinfo=timezone.utc)
    mapping = {
        npc_id: {"household_id": "household-shared", "location_id": "home-1"}
        for npc_id in profiles
    }
    state = service.engine.initialize("legacy-player", profiles, mapping, now=now)
    state["households"]["household-stale"] = {
        "id": "household-stale", "name": "Empty legacy home", "members": [],
        "residence_id": "residence-stale",
        "residence": {"id": "residence-stale", "location_id": "home-8", "name": "Old home"},
        "state": {"cleanliness": 33},
    }
    service.db.save_life_world_state(
        "legacy-player", state, rules_version=state["rules_version"],
        last_advanced_at=state["last_advanced_at"],
        next_transition_at=(now + timedelta(hours=4)).isoformat(), expected_revision=0,
    )

    migrated = service.load("legacy-player", entries, now=now)

    assert set(migrated["households"]) == {"household-shared"}
    assert {resident["household_id"] for resident in migrated["residents"].values()} == {
        "household-shared",
    }
