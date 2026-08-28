from __future__ import annotations

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


def test_clearing_a_shared_arrangement_moves_residents_back_to_individual_homes(tmp_path):
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

    assert mapping["ava"]["household_id"] != mapping["bo"]["household_id"]
    assert mapping["ava"]["home_location_id"] != mapping["bo"]["home_location_id"]
    assert mapping["ava"]["current_location_id"] == mapping["ava"]["home_location_id"]
    assert mapping["bo"]["current_location_id"] == mapping["bo"]["home_location_id"]


def test_invalid_and_self_household_references_are_ignored(tmp_path):
    service = _service(tmp_path)
    entries = [
        _entry("ava", with_ids=("ava",)),
        _entry("bo", with_ids=("another-player-resident",)),
    ]

    mapping = service._home_mapping("player-1", entries)

    assert mapping["ava"]["household_id"] != mapping["bo"]["household_id"]
