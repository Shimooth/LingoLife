from fastapi.testclient import TestClient

from lingolife.app import create_app
from lingolife.config import Settings
from lingolife.models import AIResult, EnglishFeedback, LearningEvidence


class ContextProvider:
    def __init__(self):
        self.context = None

    def reply(self, message, stats, history, context=None):
        self.context = context
        return AIResult(
            npc_reply="I feel understood. Thank you.", relationship_change=1, mood_change=1,
            english_xp_change=2,
            english_feedback=EnglishFeedback(is_understandable=True, corrected_text=message,
                                             tip="A caring follow-up.", tags=[]),
            semantic_signals=["accept", "advice", "apology", "celebration", "curiosity", "decline",
                              "empathy", "encouragement", "honesty", "practical_help", "reassurance"],
            learning_evidence=[LearningEvidence(target_id="intent.empathy", outcome="success", confidence=1)],
        )


def setup(tmp_path):
    provider = ContextProvider()
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'agent.db'}", web_root=str(tmp_path / "none"))
    client = TestClient(create_app(settings, provider))
    code = client.app.state.db.create_invites(1, 30)[0]
    token = client.post("/api/v1/auth/register", json={"username": "agentuser", "invite_code": code}).json()["session_token"]
    return client, provider, {"Authorization": "Bearer " + token}


def test_profile_event_and_learning_are_one_persisted_loop(tmp_path):
    client, provider, auth = setup(tmp_path)
    room = client.get("/api/v1/room", headers=auth).json()
    assert room["active_event"]["stage_count"] == 3

    profile = client.get("/api/v1/npc/profile", headers=auth).json()
    profile.update({"name": "Maya", "personality": ["bold", "witty"],
                    "interests": ["gaming"], "occupation": "Developer"})
    saved = client.put("/api/v1/npc/profile", headers=auth, json=profile)
    assert saved.status_code == 200 and saved.json()["name"] == "Maya"
    assert client.get("/api/v1/room", headers=auth).json()["npc"]["name"] == "Maya"

    response = client.post("/api/v1/chat", headers={**auth, "Idempotency-Key": "agent-loop-001"},
                           json={"message": "I understand. What happened, and how can I help?"})
    assert response.status_code == 200
    data = response.json()
    assert data["event_update"]["stage_changed"] is True
    assert data["learning_summary"]["targets"]
    assert provider.context["npc_profile"]["name"] == "Maya"
    assert provider.context["current_event"]["id"] == room["active_event"]["id"]
    learning = client.get("/api/v1/learning/profile", headers=auth).json()
    empathy = next(item for item in learning["targets"] if item["id"] == "intent.empathy")
    assert empathy["successes"] == 1

    duplicate = client.post("/api/v1/chat", headers={**auth, "Idempotency-Key": "agent-loop-001"},
                            json={"message": "must not apply twice"}).json()
    assert duplicate == data
    empathy_again = next(item for item in client.get("/api/v1/learning/profile", headers=auth).json()["targets"]
                         if item["id"] == "intent.empathy")
    assert empathy_again["successes"] == 1


def test_profile_requires_auth_and_rejects_oversized_drawing(tmp_path):
    client, _, auth = setup(tmp_path)
    assert client.get("/api/v1/npc/profile").status_code == 401
    profile = client.get("/api/v1/npc/profile", headers=auth).json()
    profile["avatar"]["strokes"] = [{"color": "#112233", "width": 4,
                                      "points": [[1, 1]] * 81}]
    assert client.put("/api/v1/npc/profile", headers=auth, json=profile).status_code == 422
