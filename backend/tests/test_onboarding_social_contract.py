from __future__ import annotations

from copy import deepcopy
import json

from fastapi.testclient import TestClient
from pydantic import ValidationError
import pytest

from lingolife.app import DEFAULT_NPC_PROFILE, create_app
from lingolife.config import Settings
from lingolife.models import AvatarConfig, NpcProfile, OnboardingCompleteRequest


def _settings(path) -> Settings:
    return Settings(
        database_url=f"sqlite:///{path}",
        web_root=str(path.parent / "missing-web"),
        life_simulation_v2=True,
    )


def _client(path) -> TestClient:
    return TestClient(create_app(_settings(path)))


def _auth(client: TestClient, username: str) -> tuple[dict[str, str], str]:
    invite = client.app.state.db.create_invites(1, 30)[0]
    response = client.post("/api/v1/auth/register", json={
        "username": username, "invite_code": invite, "password": "password",
    })
    assert response.status_code == 201, response.text
    token = response.json()["session_token"]
    intro = client.post(
        "/api/v1/onboarding/intro/acknowledge",
        headers={"Authorization": f"Bearer {token}"},
        json={"intro_version": 1},
    )
    assert intro.status_code == 200, intro.text
    return {"Authorization": f"Bearer {token}"}, token


def _profile(index: int) -> dict:
    value = deepcopy(DEFAULT_NPC_PROFILE)
    roles = ["organizer", "caretaker", "mediator", "cook", "fixer", "free_spirit"]
    chores = ["cooking", "dishes", "cleaning", "shopping", "repairs", "laundry"]
    value.update({
        "name": f"Contract Resident {index}",
        "relationship": f"City contact {index}",
        "occupation": f"Distinct profession {index}",
        "personality": ["warm" if index % 2 else "quiet", f"trait-{index}"],
        "interests": [f"interest-{index}", "music" if index % 2 else "reading"],
        "likes": [f"favorite-{index}", "shared meals"],
        "dislikes": [f"annoyance-{index}"],
        "quirks": [f"quirk-{index}"],
        "habits": [f"routine-{index}"],
        "boundaries": [f"boundary-{index}"],
        "householdRole": roles[index % len(roles)],
        "chorePreferences": [chores[index % len(chores)]],
        "privateSpacePreference": ["low", "balanced", "high"][index % 3],
    })
    return value


def _social_contract(count: int) -> tuple[list[dict], list[dict]]:
    role_pairs = [
        ("sibling", "sibling"), ("cousin", "cousin"),
        ("parent", "child"), ("guardian", "dependent"),
    ]
    family, history = [], []
    for pair_index, left in enumerate(range(0, count - 1, 2)):
        right = left + 1
        left_role, right_role = role_pairs[pair_index]
        family.append({
            "left_index": left, "right_index": right,
            "left_role": left_role, "right_role": right_role,
        })
        history.append({
            "id": f"shared-start-{left}-{right}",
            "participant_indices": [left, right],
            "kind": "shared_project",
            "summary": f"Residents {left} and {right} built a tiny rooftop garden together.",
            "tone": "warm" if pair_index % 2 == 0 else "complicated",
        })
    return family, history


@pytest.mark.parametrize("count", [2, 4, 8])
def test_two_four_and_eight_resident_contracts_materialize_and_survive_refresh(tmp_path, count):
    path = tmp_path / f"contract-{count}.db"
    client = _client(path)
    headers, token = _auth(client, f"contract-{count}")
    family, history = _social_contract(count)
    request = {
        "household_name": "Shared Contract Home",
        "residents": [_profile(index) for index in range(count)],
        "family_bonds": family,
        "shared_history_hooks": history,
    }

    response = client.post("/api/v1/onboarding/complete", headers=headers, json=request)
    assert response.status_code == 201, response.text
    payload = response.json()
    # ``created`` preserves roster-slot order; the ordinary NPC list is sorted
    # by its durable database ordering and must not be used as an index map.
    ids = [entry["id"] for entry in payload["created"]]
    profiles = [entry["profile"] for entry in payload["created"]]

    for pair_index, left in enumerate(range(0, count - 1, 2)):
        right = left + 1
        left_role, right_role = (
            ("sibling", "sibling"), ("cousin", "cousin"),
            ("parent", "child"), ("guardian", "dependent"),
        )[pair_index]
        assert profiles[left]["familyIds"] == [ids[right]]
        assert profiles[right]["familyIds"] == [ids[left]]
        assert profiles[left]["familyRelations"] == [{"targetId": ids[right], "role": left_role}]
        assert profiles[right]["familyRelations"] == [{"targetId": ids[left], "role": right_role}]
        relationship = next(
            item for item in payload["city"]["relationships"]
            if set(item["participant_ids"]) == {ids[left], ids[right]}
        )
        family_bond = next(
            bond for bond in relationship["structural_bonds"] if bond["kind"] == "family"
        )
        assert family_bond["roles"] == {ids[left]: left_role, ids[right]: right_role}
        hook_id = f"shared-start-{left}-{right}"
        for index in (left, right):
            hook = profiles[index]["shared_history_hooks"][0]
            assert hook["id"] == hook_id
            assert hook["participantIds"] == [ids[left], ids[right]]
            assert "rooftop garden" in hook["summary"]

    # The same request is a setup-saga replay, not a second set of characters.
    replay = client.post("/api/v1/onboarding/complete", headers=headers, json=request)
    assert replay.status_code == 201, replay.text
    assert [entry["id"] for entry in replay.json()["created"]] == ids

    # Reopen the database to prove the social contract is durable, not an API
    # response projection or browser-only draft.
    reopened = _client(path)
    refreshed = reopened.get(
        "/api/v1/npcs", headers={"Authorization": f"Bearer {token}"},
    )
    assert refreshed.status_code == 200, refreshed.text
    assert refreshed.json()["npcs"] == payload["npcs"]
    raw_profiles = [
        json.loads(row[0]) for row in reopened.app.state.db._connection.execute(
            "SELECT profile_json FROM npc_profiles ORDER BY created_at,npc_id"
        ).fetchall()
    ]
    assert sum(bool(profile["shared_history_hooks"]) for profile in raw_profiles) == count
    assert sum(bool(profile["familyRelations"]) for profile in raw_profiles) == count


@pytest.mark.parametrize("family_bonds", [
    [{"left_index": 0, "right_index": 0, "left_role": "sibling", "right_role": "sibling"}],
    [{"left_index": 0, "right_index": 2, "left_role": "sibling", "right_role": "sibling"}],
    [{"left_index": 0, "right_index": 1, "left_role": "parent", "right_role": "parent"}],
    [{"left_index": 0, "right_index": 1, "left_role": "spouse", "right_role": "spouse"}],
    [
        {"left_index": 0, "right_index": 1, "left_role": "sibling", "right_role": "sibling"},
        {"left_index": 1, "right_index": 0, "left_role": "sibling", "right_role": "sibling"},
    ],
])
def test_invalid_or_non_reciprocal_family_references_are_rejected_atomically(
    tmp_path, family_bonds,
):
    client = _client(tmp_path / "invalid-family.db")
    headers, _ = _auth(client, "invalid-family")
    response = client.post("/api/v1/onboarding/complete", headers=headers, json={
        "residents": [_profile(0), _profile(1)], "family_bonds": family_bonds,
    })
    assert response.status_code == 422
    assert client.get("/api/v1/onboarding", headers=headers).json()["resident_count"] == 0


def test_profile_level_ids_cannot_bypass_atomic_onboarding_family_contract():
    residents = [_profile(0), _profile(1)]
    residents[0]["familyIds"] = ["npc-not-yet-created"]
    with pytest.raises(ValidationError, match="roster-level"):
        OnboardingCompleteRequest.model_validate({"residents": residents})


@pytest.mark.parametrize(("field", "invalid"), [
    ("model", "city-17"), ("hair", "../../hair.glb"), ("hairColor", "#010203"),
    ("face", "unknown-face"), ("skin", "#010203"), ("eyes", "laser"),
    ("brows", "zigzag"), ("nose", "missing"), ("mouth", "missing"),
    ("outfit", "../../outfit.glb"), ("outfitColor", "#010203"),
    ("pants", "missing"), ("accessory", "missing"), ("homeBackground", "missing"),
])
def test_every_avatar_component_is_checked_against_the_server_allowlist(field, invalid):
    avatar = deepcopy(DEFAULT_NPC_PROFILE["avatar"])
    avatar[field] = invalid
    with pytest.raises(ValidationError, match="approved"):
        AvatarConfig.model_validate(avatar)


def test_shipped_legacy_avatar_aliases_remain_editable():
    avatar = deepcopy(DEFAULT_NPC_PROFILE["avatar"])
    avatar.update({
        "model": "city-16", "hair": "bob", "hairColor": "#563B38",
        "face": "long", "skin": "#F2C7A5", "eyes": "wide", "brows": "bold",
        "nose": "wide", "mouth": "soft", "outfit": "hoodie",
        "outfitColor": "#7A9CC6", "pants": "shorts", "accessory": "glasses",
        "homeBackground": "harbor",
    })
    validated = AvatarConfig.model_validate(avatar)
    assert validated.hairColor == "#563b38"
    assert validated.skin == "#f2c7a5"
    assert validated.outfitColor == "#7a9cc6"


@pytest.mark.parametrize("hook", [
    {"id": "duplicate-participant", "participant_indices": [0, 0],
     "kind": "shared_project", "summary": "A real memory", "tone": "neutral"},
    {"id": "outside-roster", "participant_indices": [0, 2],
     "kind": "shared_project", "summary": "A real memory", "tone": "neutral"},
    {"id": "bad-kind", "participant_indices": [0, 1],
     "kind": "already-best-friends", "summary": "A prewritten outcome", "tone": "warm"},
])
def test_shared_history_hooks_reject_invalid_participants_and_outcome_like_kinds(hook):
    with pytest.raises(ValidationError):
        OnboardingCompleteRequest.model_validate({
            "residents": [_profile(0), _profile(1)], "shared_history_hooks": [hook],
        })


def test_social_contract_caps_family_degree_and_history_attention_per_resident():
    residents = [_profile(index) for index in range(6)]
    five_family_bonds = [
        {"left_index": 0, "right_index": index, "left_role": "sibling", "right_role": "sibling"}
        for index in range(1, 6)
    ]
    with pytest.raises(ValidationError, match="at most four family bonds"):
        OnboardingCompleteRequest.model_validate({
            "residents": residents, "family_bonds": five_family_bonds,
        })

    five_hooks = [
        {"id": f"history-cap-{index}", "participant_indices": [0, index],
         "kind": "shared_project", "summary": f"A shared experience number {index}.",
         "tone": "neutral"}
        for index in range(1, 6)
    ]
    with pytest.raises(ValidationError, match="at most four shared-history hooks"):
        OnboardingCompleteRequest.model_validate({
            "residents": residents, "shared_history_hooks": five_hooks,
        })


def test_compiled_persona_carries_the_persisted_shared_history_seed():
    profile = NpcProfile.model_validate(_profile(0)).model_dump()
    profile["shared_history_hooks"] = [{
        "id": "old-project", "participantIds": ["npc-a", "npc-b"],
        "kind": "shared_project", "summary": "They restored an old radio together.",
        "tone": "warm",
    }]
    from lingolife.agent import compile_persona

    persona = compile_persona(profile)
    assert persona["preferences"]["shared_history_hooks"] == [{
        "id": "old-project", "participant_ids": ["npc-a", "npc-b"],
        "kind": "shared_project", "summary": "They restored an old radio together.",
        "tone": "warm",
    }]


def test_shared_history_perspective_is_editable_and_persists_across_app_restart(tmp_path):
    path = tmp_path / "editable-history.db"
    client = _client(path)
    headers, token = _auth(client, "editable-history")
    family, history = _social_contract(2)
    created = client.post("/api/v1/onboarding/complete", headers=headers, json={
        "residents": [_profile(0), _profile(1)],
        "family_bonds": family, "shared_history_hooks": history,
    }).json()["created"]
    npc_id, profile = created[0]["id"], created[0]["profile"]
    profile["shared_history_hooks"][0].update({
        "summary": "They remember the rooftop garden as difficult but worthwhile.",
        "tone": "complicated",
    })

    saved = client.put(f"/api/v1/npcs/{npc_id}", headers=headers, json=profile)
    assert saved.status_code == 200, saved.text
    assert saved.json()["profile"]["shared_history_hooks"][0]["tone"] == "complicated"

    reopened = _client(path)
    profiles = reopened.get(
        "/api/v1/npcs", headers={"Authorization": f"Bearer {token}"},
    ).json()["npcs"]
    refreshed = next(entry["profile"] for entry in profiles if entry["id"] == npc_id)
    assert refreshed["shared_history_hooks"][0]["summary"].endswith("worthwhile.")
    assert refreshed["shared_history_hooks"][0]["tone"] == "complicated"
