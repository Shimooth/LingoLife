"""个人视角重构的服务边界与旧存档验收，仅使用临时数据库。"""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json

import pytest
from pydantic import ValidationError

from lingolife import social_mind, social_continuity
from lingolife.agent import project_dialogue_life_context, project_public_life_context
from lingolife.app import DEFAULT_NPC_PROFILE
from lingolife.db import Database
from lingolife.life_service import LifeWorldService
from lingolife.models import NpcProfile


NOW = datetime(2026, 9, 26, 8, tzinfo=timezone.utc)


def household(tmp_path):
    db = Database(f"sqlite:///{tmp_path / 'people.db'}")
    db.ensure_player("people")
    profiles = {}
    for identity, values in (("nora", ["fairness", "autonomy"]), ("aria", ["care", "belonging"]),
                             ("charles", ["honesty", "care"])):
        profile = {**deepcopy(DEFAULT_NPC_PROFILE), "name": identity.title(), "values": values,
                   "selfImage": "希望自己是个可靠的人", "romanceEnabled": False}
        db.get_or_create_npc_profile("people", identity, profile)
        profiles[identity] = profile
    entries = [{"id": key, "profile": value} for key, value in profiles.items()]
    service = LifeWorldService(db, timezone_name="UTC")
    return db, service, profiles, entries, service.load("people", entries, now=NOW)


def save(db, state):
    return db.save_life_world_state("people", state, rules_version=state["rules_version"],
        last_advanced_at=state["last_advanced_at"], next_transition_at=state["next_transition_at"],
        expected_revision=state["revision"])


def test_old_save_upgrades_even_when_next_action_is_not_due(tmp_path):
    db, service, profiles, entries, state = household(tmp_path)
    state.pop("social_mind", None)
    state.pop("social_continuity", None)
    state["next_transition_at"] = (NOW + timedelta(hours=1)).isoformat()
    stories, relationships = deepcopy(state["stories"]), deepcopy(state["relationships"])
    inventory = {key: deepcopy(value["personal_inventory"]) for key, value in state["residents"].items()}
    save(db, state)
    upgraded = service.load("people", entries, now=NOW)
    assert upgraded["social_mind"]["version"] == social_mind.VERSION
    assert upgraded["social_continuity"]["version"] == social_continuity.VERSION
    assert set(upgraded["residents"]) == set(profiles)
    assert upgraded["stories"] == stories
    assert upgraded["relationships"] == relationships
    assert {key: value["personal_inventory"] for key, value in upgraded["residents"].items()} == inventory
    assert upgraded["social_mind"]["facts"] == {}  # 不把旧事当作刚刚亲眼见到。
    again = service.load("people", entries, now=NOW)
    assert again == upgraded


def test_private_perspective_is_provider_only_and_not_a_public_api_field(tmp_path):
    db, service, profiles, entries, state = household(tmp_path)
    social_mind.observe_fact(state, profiles, {
        "id": "private-book", "topic": "borrowed_property", "visibility": "participants",
        "participant_ids": ["nora", "aria"], "location_id": "private-bedroom",
        "facts": {"item_label": "PRIVATE_BORROWED_BOOK", "owner_id": "nora", "borrower_id": "aria"},
    }, NOW)
    state["next_transition_at"] = (NOW + timedelta(hours=1)).isoformat()
    save(db, state)
    public = service.npc_context("people", entries, "nora", now=NOW, author_opening=False)
    private = service.npc_context("people", entries, "nora", now=NOW, author_opening=False, include_private=True)
    outsider = service.npc_context("people", entries, "charles", now=NOW, author_opening=False, include_private=True)
    assert "speaker_perspective" not in public
    assert "PRIVATE_BORROWED_BOOK" not in json.dumps(public)
    assert "PRIVATE_BORROWED_BOOK" in json.dumps(private["speaker_perspective"])
    assert "PRIVATE_BORROWED_BOOK" not in json.dumps(outsider["speaker_perspective"])
    assert "speaker_perspective" not in project_public_life_context(private)
    assert "PRIVATE_BORROWED_BOOK" not in json.dumps(project_dialogue_life_context(private))
    world_public = service.city("people", entries, now=NOW)
    encoded = json.dumps(world_public)
    assert "PRIVATE_BORROWED_BOOK" not in encoded
    assert '"social_mind"' not in encoded and '"social_continuity"' not in encoded


def test_edit_personal_values_applies_without_waiting_for_next_action(tmp_path):
    db, service, profiles, entries, state = household(tmp_path)
    state["next_transition_at"] = (NOW + timedelta(hours=1)).isoformat()
    save(db, state)
    previous = deepcopy(state["social_mind"]["minds"]["nora"]["persona"])
    profiles["nora"].update(values=["honesty", "care"], selfImage="想成为可靠的人")
    changed = service.load("people", entries, now=NOW)
    persona = changed["social_mind"]["minds"]["nora"]["persona"]
    assert persona != previous
    assert persona["priority"][:2] == ["honesty", "care"]
    assert persona["self_image"] == ["想成为可靠的人"]
    assert changed["stories"] == state["stories"]
    assert service.load("people", entries, now=NOW) == changed


def test_optional_personal_values_roundtrip_and_old_profiles_still_validate():
    old = NpcProfile.model_validate(DEFAULT_NPC_PROFILE)
    assert old.values == [] and old.selfImage == ""
    profile = NpcProfile.model_validate({**DEFAULT_NPC_PROFILE, "values": ["autonomy", "care"],
                                       "selfImage": " 希望自己  不给别人添麻烦 "})
    assert profile.model_dump()["values"] == ["autonomy", "care"]
    assert profile.selfImage == "希望自己 不给别人添麻烦"
    identity = social_mind.persona_values(profile.model_dump())
    assert identity["priority"][:2] == ["autonomy", "care"]


@pytest.mark.parametrize("patch", [
    {"values": ["care", "care"]}, {"values": ["invented"]},
    {"values": ["care", "fairness", "autonomy", "honesty"]}, {"selfImage": "x" * 181},
])
def test_personality_editor_rejects_invalid_value_contracts(patch):
    with pytest.raises(ValidationError):
        NpcProfile.model_validate({**DEFAULT_NPC_PROFILE, **patch})
