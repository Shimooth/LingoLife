from __future__ import annotations

from copy import deepcopy
import json

from fastapi.testclient import TestClient
from pydantic import ValidationError
import pytest

from lingolife.agent import compile_persona
from lingolife.app import DEFAULT_NPC_PROFILE, create_app
from lingolife.collisions import Collision, CollisionResponseTemplate, _response_score
from lingolife.config import Settings
from lingolife.db import Database
from lingolife.life import NpcLifeContext, rank_life_actions
from lingolife.models import NpcProfile, OnboardingCompleteRequest
from lingolife.profile_contract import normalize_profile_contract, roster_difference_report
from datetime import datetime, timezone


PUBLIC_CONTRACT_FIELDS = {
    "likes", "dislikes", "quirks", "habits", "boundaries", "householdRole",
    "chorePreferences", "privateSpacePreference",
}


def _resident(index: int) -> dict:
    value = deepcopy(DEFAULT_NPC_PROFILE)
    roles = ["organizer", "caretaker", "mediator", "cook", "fixer", "free_spirit"]
    chores = ["cooking", "dishes", "cleaning", "shopping", "repairs", "laundry"]
    value.update({
        "name": f"Resident {index}",
        "occupation": f"Profession {index}",
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


def _client(tmp_path) -> TestClient:
    return TestClient(create_app(Settings(
        database_url=f"sqlite:///{tmp_path / 'phase6.db'}",
        web_root=str(tmp_path / "missing-web"),
        life_simulation_v2=True,
    )))


def _register(client: TestClient) -> tuple[dict[str, str], str]:
    invite = client.app.state.db.create_invites(1, 30)[0]
    response = client.post("/api/v1/auth/register", json={
        "username": "phase6-user", "invite_code": invite, "password": "password",
    })
    assert response.status_code == 201
    token = response.json()["session_token"]
    user = client.app.state.db.authenticate(token)
    assert user
    return {"Authorization": f"Bearer {token}"}, user["player_id"]


def test_legacy_profile_gets_a_full_deterministic_contract_without_rewriting_storage(tmp_path):
    legacy = {key: deepcopy(value) for key, value in DEFAULT_NPC_PROFILE.items()
              if key not in PUBLIC_CONTRACT_FIELDS}
    first = normalize_profile_contract(legacy)
    second = normalize_profile_contract(legacy)
    assert first == second
    assert all(first[field] for field in PUBLIC_CONTRACT_FIELDS)

    db = Database(f"sqlite:///{tmp_path / 'legacy-profile.db'}")
    db.ensure_player("legacy-player")
    with db._connection:
        db._connection.execute(
            "INSERT INTO npc_profiles(player_id,npc_id,profile_json) VALUES (?,?,?)",
            ("legacy-player", "emma", json.dumps(legacy)),
        )
    assert PUBLIC_CONTRACT_FIELDS <= db.get_npc_profile("legacy-player", "emma").keys()
    raw = json.loads(db._connection.execute(
        "SELECT profile_json FROM npc_profiles WHERE player_id='legacy-player' AND npc_id='emma'"
    ).fetchone()[0])
    assert not (PUBLIC_CONTRACT_FIELDS & raw.keys())


def test_profile_contract_strictly_rejects_conflicts_blanks_and_unknown_enums():
    valid = NpcProfile.model_validate(_resident(1))
    assert PUBLIC_CONTRACT_FIELDS <= valid.model_dump().keys()
    with pytest.raises(ValidationError):
        NpcProfile.model_validate({**_resident(1), "likes": ["tea"], "dislikes": ["Tea"]})
    with pytest.raises(ValidationError):
        NpcProfile.model_validate({**_resident(1), "habits": [" "]})
    with pytest.raises(ValidationError):
        NpcProfile.model_validate({**_resident(1), "householdRole": "dictator"})
    with pytest.raises(ValidationError):
        NpcProfile.model_validate({**_resident(1), "unexpected_private_score": 99})


def test_persona_has_six_axes_and_all_seven_derived_behaviors():
    persona = compile_persona(_resident(1))
    assert set(persona["axes"]) == {
        "warmth", "extraversion", "assertiveness", "openness",
        "emotional_stability", "humor",
    }
    assert set(persona["behavior"]) == {
        "initiative", "conflict_style", "support_style", "disclosure_style",
        "persistence", "flexibility", "pride",
    }
    changed = _resident(2)
    changed.update({
        "personality": ["outgoing", "bold", "stubborn"],
        "householdRole": "organizer", "privateSpacePreference": "low",
    })
    assert compile_persona(changed)["behavior"] != persona["behavior"]
    assert compile_persona(changed)["version"] != persona["version"]


def test_public_preferences_change_action_ranking_and_collision_response():
    needs = {key: 58 for key in (
        "food", "rest", "social", "achievement", "love", "privacy", "fun", "security",
    )}
    cook = NpcLifeContext(
        "player", "cook", "decision", "evening", needs,
        traits=("warm",), interests=("cooking",), likes=("cooking",),
        household_role="cook", chore_preferences=("cooking",),
        private_space_preference="low", behavior={"initiative": "high", "flexibility": "adaptive"},
    )
    private_reader = NpcLifeContext(
        "player", "reader", "decision", "evening", needs,
        traits=("quiet",), interests=("reading",), dislikes=("cooking",),
        household_role="free_spirit", chore_preferences=("laundry",),
        private_space_preference="high", behavior={"initiative": "low", "flexibility": "rigid"},
    )
    cook_scores = {candidate.action_type: candidate.score for candidate in rank_life_actions(cook)}
    reader_scores = {candidate.action_type: candidate.score for candidate in rank_life_actions(private_reader)}
    assert cook_scores["prepare_food"] > reader_scores["prepare_food"] + 20
    assert reader_scores["rest_alone"] > cook_scores["rest_alone"]

    collision = Collision(
        "collision-1", "person_boundary", "privacy", "privacy",
        ("a", "b"), ("action-a", "action-b"), "privacy_boundary",
        datetime(2026, 9, 4, tzinfo=timezone.utc), "home", None, 45,
        ("set_boundary",), "privacy", {"boundary": "private space"},
    )
    response = CollisionResponseTemplate("set_boundary", "boundaried", 1, {})
    assert _response_score(
        response, "a", collision,
        {"boundaries": ["protect private space"], "pride": 80,
         "behavior": {"conflict_style": "direct"}}, {},
    ) > _response_score(
        response, "a", collision,
        {"boundaries": ["share meals"], "pride": 20,
         "behavior": {"conflict_style": "avoidant"}}, {},
    )


@pytest.mark.parametrize("count", [2, 4, 8])
def test_valid_cast_sizes_and_difference_contract(count: int):
    residents = [_resident(index) for index in range(1, count + 1)]
    request = OnboardingCompleteRequest.model_validate({"residents": residents})
    assert len(request.residents) == count
    assert roster_difference_report(residents)["valid"] is True


def test_cast_boundaries_and_similar_residents_are_rejected():
    with pytest.raises(ValidationError):
        OnboardingCompleteRequest.model_validate({"residents": [_resident(1)]})
    with pytest.raises(ValidationError):
        OnboardingCompleteRequest.model_validate({
            "residents": [_resident(index) for index in range(1, 10)],
        })
    clone = _resident(1)
    clone["name"] = "Clone"
    with pytest.raises(ValidationError, match="discernible differences"):
        OnboardingCompleteRequest.model_validate({"residents": [_resident(1), clone]})


def test_intro_state_is_idempotently_persisted_through_completion(tmp_path):
    client = _client(tmp_path)
    headers, player_id = _register(client)
    initial = client.get("/api/v1/onboarding", headers=headers).json()
    assert initial["intro_version"] is None and initial["intro_acknowledged_at"] is None

    acknowledged = client.post(
        "/api/v1/onboarding/intro/acknowledge", headers=headers, json={"intro_version": 1},
    )
    assert acknowledged.status_code == 200
    first_stamp = acknowledged.json()["intro_acknowledged_at"]
    replay = client.post(
        "/api/v1/onboarding/intro/acknowledge", headers=headers, json={"intro_version": 1},
    ).json()
    assert replay["intro_acknowledged_at"] == first_stamp
    raw = json.loads(client.app.state.db._connection.execute(
        "SELECT state_json FROM player_onboarding WHERE player_id=?", (player_id,),
    ).fetchone()[0])
    assert raw["intro_version"] == 1 and raw["intro_acknowledged_at"] == first_stamp

    completed = client.post("/api/v1/onboarding/complete", headers=headers, json={
        "residents": [_resident(1), _resident(2)],
    })
    assert completed.status_code == 201, completed.text
    assert completed.json()["onboarding"]["intro_acknowledged_at"] == first_stamp
    assert client.post(
        "/api/v1/onboarding/intro/acknowledge", headers=headers, json={"intro_version": 2},
    ).json()["error"]["code"] == "INTRO_VERSION_UNSUPPORTED"


def test_database_cannot_create_the_world_before_intro_acknowledgement(tmp_path):
    db = Database(f"sqlite:///{tmp_path / 'intro-authority.db'}")
    db.ensure_player("fresh-player")
    residents = [
        {"id": "npc-one", "profile": _resident(1)},
        {"id": "npc-two", "profile": _resident(2)},
    ]

    with pytest.raises(ValueError, match="INTRO_NOT_ACKNOWLEDGED"):
        db.create_onboarding_residents("fresh-player", residents, "Our Home")

    assert db.list_npc_profiles("fresh-player") == []
    assert db.onboarding_state("fresh-player")["completed"] is False


def test_main_world_apis_share_ready_gate_and_open_after_completion(tmp_path):
    client = _client(tmp_path)
    headers, _ = _register(client)
    protected = (
        ("GET", "/api/v1/world", None),
        ("GET", "/api/v1/city", None),
        ("GET", "/api/v1/room", None),
        ("GET", "/api/v1/life-stories", None),
        ("GET", "/api/v1/households", None),
        ("GET", "/api/v1/social-events", None),
        ("GET", "/api/v1/npcs/missing/agent", None),
        ("POST", "/api/v1/chat", {"message": "Hello", "npc_id": "emma"}),
    )
    for method, path, body in protected:
        request_headers = {**headers, **({"Idempotency-Key": "phase6-gate-01"} if path.endswith("/chat") else {})}
        response = client.request(method, path, headers=request_headers, json=body)
        assert response.status_code == 409, (path, response.text)
        assert response.json()["error"]["code"] == "WORLD_NOT_READY"
        assert response.json()["error"]["onboarding"]["completed"] is False

    assert client.get("/api/v1/onboarding", headers=headers).status_code == 200
    assert client.get("/api/v1/world-layout").status_code == 200
    cast = {"residents": [_resident(1), _resident(2)]}
    skipped_intro = client.post(
        "/api/v1/onboarding/complete", headers=headers, json=cast,
    )
    assert skipped_intro.status_code == 409
    assert skipped_intro.json()["error"]["code"] == "INTRO_NOT_ACKNOWLEDGED"
    assert client.get("/api/v1/onboarding", headers=headers).json()["resident_count"] == 0

    acknowledged = client.post(
        "/api/v1/onboarding/intro/acknowledge",
        headers=headers,
        json={"intro_version": 1},
    )
    assert acknowledged.status_code == 200
    completed = client.post("/api/v1/onboarding/complete", headers=headers, json=cast)
    assert completed.status_code == 201, completed.text
    first_id = completed.json()["npcs"][0]["id"]
    assert client.get("/api/v1/world", headers=headers).status_code == 200
    assert client.get(f"/api/v1/room?npc_id={first_id}", headers=headers).status_code == 200
    assert client.get("/api/v1/households", headers=headers).status_code == 200
