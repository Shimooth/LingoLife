from __future__ import annotations

from copy import deepcopy
import json

import pytest
from fastapi.testclient import TestClient

from lingolife.ai import _persona_prompt
from lingolife.app import DEFAULT_NPC_PROFILE, create_app
from lingolife.config import Settings
from lingolife.models import AIResult, EnglishFeedback


class CapturingProvider:
    def __init__(self) -> None:
        self.contexts: list[dict] = []

    def reply(self, message, stats, history, context):
        self.contexts.append(deepcopy(context))
        return AIResult(
            npc_reply="I am glad you checked in.",
            npc_reply_zh="很高兴你来看看我。",
            english_feedback=EnglishFeedback(
                is_understandable=True,
                corrected_text=message,
                tip="This sounds natural.",
                tags=[],
            ),
        )


def _ready_client(tmp_path) -> tuple[TestClient, CapturingProvider, dict[str, str], dict]:
    provider = CapturingProvider()
    client = TestClient(create_app(Settings(
        database_url=f"sqlite:///{tmp_path / 'privacy.db'}",
        web_root=str(tmp_path / "missing-web"),
        life_simulation_v2=True,
    ), provider))
    invite = client.app.state.db.create_invites(1, 30)[0]
    registered = client.post("/api/v1/auth/register", json={
        "username": "privacy-user", "password": "test-password", "invite_code": invite,
    })
    assert registered.status_code == 201, registered.text
    token = registered.json()["session_token"]
    user = client.app.state.db.authenticate(token)
    assert user is not None
    client.app.state.db.get_or_create_npc_profile(
        user["player_id"], "emma", DEFAULT_NPC_PROFILE,
    )
    client.app.state.db.refresh_onboarding(user["player_id"], force_complete=True)
    headers = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/v1/world", headers=headers).status_code == 200
    return client, provider, headers, user


def _force_private_action(client: TestClient, player_id: str, action_type: str) -> None:
    db = client.app.state.db
    state = deepcopy(db.get_life_world_state(player_id))
    resident = state["residents"]["emma"]
    room = "shared-bathroom" if action_type == "shower" else "private-sleep-pod-1"
    internal_location = f"{resident['household_id']}:{room}"
    resident["current_location_id"] = internal_location
    resident["current_action"].update({
        "action_type": action_type,
        "status": "performing",
        "location_id": internal_location,
        "target_resource_id": "classified-private-resource",
        "target_npc_id": "classified-private-target",
        "interruptible": False,
        "animation_cue": "tired",
        "transition_reason": "classified-internal-transition",
        "transitioned_at": "2026-09-04T00:00:00+00:00",
        "started_at": "2026-09-04T00:00:00+00:00",
        "ends_at": "2099-01-01T00:00:00+00:00",
    })
    state["next_transition_at"] = "2099-01-01T00:00:00+00:00"
    db.save_life_world_state(
        player_id, state, rules_version=state["rules_version"],
        last_advanced_at=state["last_advanced_at"],
        next_transition_at=state["next_transition_at"],
        expected_revision=state["revision"],
    )


@pytest.mark.parametrize("action_type", ["shower", "sleep"])
def test_private_action_and_restricted_memories_never_reach_api_or_provider(
    tmp_path, action_type,
):
    client, provider, headers, user = _ready_client(tmp_path)
    player_id = user["player_id"]
    _force_private_action(client, player_id, action_type)

    db = client.app.state.db
    visible = db.add_npc_memory(
        player_id, "emma", "episodic", "We watched the sunrise together.",
        source_event_id="source-visible", importance=4, tags=["visible"], confidence=.41,
        access_stage="stranger",
    )
    hidden = db.add_npc_memory(
        player_id, "emma", "relationship", "A deeply private confession.",
        source_event_id="source-hidden", importance=5, tags=["secret"], confidence=.99,
        access_stage="friend",
    )
    db._connection.execute(
        "UPDATE npc_memories SET appraisal_json=?,fact_id=?,corrects_memory_id=? WHERE id=?",
        ('{"private":true}', "classified-fact-id", visible["id"], visible["id"]),
    )
    db._connection.commit()

    memories_response = client.get("/api/v1/npcs/emma/memories", headers=headers)
    assert memories_response.status_code == 200, memories_response.text
    memories = memories_response.json()["memories"]
    assert [memory["id"] for memory in memories] == [visible["id"]]
    assert set(memories[0]) == {"id", "kind", "content", "created_at"}
    assert hidden["id"] not in {memory["id"] for memory in memories}

    room_response = client.get("/api/v1/room?npc_id=emma", headers=headers)
    assert room_response.status_code == 200, room_response.text
    room_action = room_response.json()["life_context"]["current_action"]
    assert room_action["type"] == "private_time"
    assert not ({"location_id", "target_resource_id", "target_npc_id",
                 "transition_reason", "transitioned_at"} & set(room_action))

    agent_response = client.get("/api/v1/npcs/emma/agent", headers=headers)
    assert agent_response.status_code == 200, agent_response.text
    agent = agent_response.json()
    assert agent["memories"] == memories
    public_action = agent["current_action"]
    assert public_action["type"] == "private_time"
    assert public_action["animation_cue"] == "idle"
    assert public_action["interruptibility"] == "private"
    assert not ({"location_id", "target_resource_id", "target_npc_id",
                 "transition_reason", "transitioned_at"} & set(public_action))
    assert not ({"location", "location_zh", "target_name", "object", "object_zh"}
                & set(public_action["visible_context"]))

    chat = client.post(
        "/api/v1/chat",
        headers={**headers, "Idempotency-Key": f"private-{action_type}-context-01"},
        json={"npc_id": "emma", "message": "How are you doing today?"},
    )
    assert chat.status_code == 200, chat.text
    assert len(provider.contexts) == 1
    provider_context = provider.contexts[0]
    assert provider_context["memories"] == [{
        "kind": visible["kind"], "content": visible["content"],
    }]
    life_action = provider_context["current_life"]["current_action"]
    assert life_action["type"] == "private_time"
    assert life_action["animation_cue"] == "idle"
    plan = json.dumps(provider_context["daily_plan"], ensure_ascii=False)
    life = json.dumps(provider_context["current_life"], ensure_ascii=False)
    for secret in (
        action_type, "classified-private-resource", "classified-private-target",
        "classified-internal-transition", internal_marker(action_type),
        "A deeply private confession.", "confidence", "appraisal", "fact_id",
    ):
        assert secret not in plan
        assert secret not in life
        assert secret not in json.dumps(provider_context["memories"], ensure_ascii=False)


def internal_marker(action_type: str) -> str:
    return "shared-bathroom" if action_type == "shower" else "private-sleep-pod-1"


def test_deepseek_prompt_defensively_reprojects_raw_private_context_and_memories():
    prompt = _persona_prompt({
        "npc_profile": {"name": "Maya", "personality": ["quiet"]},
        "relationship": {"stage": "acquaintance", "trust": 99},
        "current_life": {
            "current_action": {
                "type": "shower", "status": "performing", "animation_cue": "tired",
                "location_id": "home:shared-bathroom",
                "target_resource_id": "secret-resource",
                "target_npc_id": "secret-target",
                "transition_reason": "secret-reason",
                "visible_intent": "At home and unavailable for a little while",
                "visible_intent_zh": "正在家中处理私人事务，暂时不便打扰",
                "visible_context": {
                    "visibility": "private", "activity": "take some private time",
                    "activity_zh": "处理私人事务", "location": "Secret bathroom",
                    "target_name": "Secret target", "object": "Secret shower",
                },
            },
        },
        "memories": [
            {"id": 1, "kind": "episodic", "content": "A public picnic.",
             "access_stage": "stranger", "confidence": .4, "fact_id": "public-fact"},
            {"id": 2, "kind": "relationship", "content": "A restricted confession.",
             "access_stage": "friend", "confidence": .99, "appraisal_json": "secret"},
        ],
    })
    assert "A public picnic." in prompt
    for secret in (
        "shower", "shared-bathroom", "secret-resource", "secret-target", "secret-reason",
        "Secret bathroom", "Secret target", "Secret shower", "A restricted confession.",
        "confidence", "fact_id", "appraisal_json", '"trust":99',
    ):
        assert secret not in prompt
