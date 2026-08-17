from fastapi.testclient import TestClient

from lingolife.app import create_app
from lingolife.config import Settings
from lingolife.models import AIResult, EnglishFeedback


class Stub:
    calls = 0
    def reply(self, message, stats, history):
        self.calls += 1
        return AIResult(npc_reply="That's sweet of you...", relationship_change=12, mood_change=3, english_xp_change=9,
            english_feedback=EnglishFeedback(is_understandable=True, corrected_text=message, tip="Natural and caring question.", tags=[]))


def client(tmp_path, provider=None):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'test.db'}")
    return TestClient(create_app(settings, provider or Stub()))


def test_health_and_new_room(tmp_path):
    c = client(tmp_path)
    assert c.get("/api/v1/health").json() == {"status": "ok", "version": "0.1.0"}
    room = c.get("/api/v1/room", headers={"X-Player-Id": "demo-player"}).json()
    assert room["stats"] == {"relationship": 35, "mood": 35, "english_xp": 0}
    assert room["messages"] == [{"speaker": "npc", "text": "I had a terrible day at work..."}]


def test_chat_clamps_and_is_idempotent(tmp_path):
    stub = Stub(); c = client(tmp_path, stub)
    headers = {"X-Player-Id": "demo-player", "Idempotency-Key": "12345678-abcd"}
    first = c.post("/api/v1/chat", headers=headers, json={"message": "Why? What happened today?"})
    second = c.post("/api/v1/chat", headers=headers, json={"message": "ignored duplicate"})
    assert first.status_code == 200 and first.json() == second.json()
    assert first.json()["relationship_change"] == 5
    assert first.json()["english_xp_change"] == 5
    assert first.json()["stats"] == {"relationship": 40, "mood": 38, "english_xp": 5}
    assert stub.calls == 1
    assert len(c.get("/api/v1/room", headers={"X-Player-Id": "demo-player"}).json()["messages"]) == 3


def test_invalid_input_has_unified_error_and_does_not_mutate(tmp_path):
    c = client(tmp_path)
    headers = {"X-Player-Id": "demo-player", "Idempotency-Key": "12345678-abcd"}
    response = c.post("/api/v1/chat", headers=headers, json={"message": "  "})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_MESSAGE"
    assert c.get("/api/v1/room", headers={"X-Player-Id": "demo-player"}).json()["stats"]["relationship"] == 35


def test_fallback_when_primary_raises(tmp_path):
    class Broken:
        def reply(self, *args): raise TimeoutError
    from lingolife.ai import ResilientProvider
    c = client(tmp_path, ResilientProvider(Broken()))
    response = c.post("/api/v1/chat", headers={"X-Player-Id": "p1", "Idempotency-Key": "abcdefgh"}, json={"message": "Are you okay?"})
    assert response.status_code == 200
    assert response.json()["english_xp_change"] == 1


def test_ununderstandable_never_gains_xp(tmp_path):
    class BadEnglish:
        def reply(self, *args):
            return AIResult(npc_reply="Could you say that another way?", relationship_change=0, mood_change=0, english_xp_change=5,
                english_feedback=EnglishFeedback(is_understandable=False, corrected_text="", tip="Try a sentence.", tags=[]))
    c = client(tmp_path, BadEnglish())
    data = c.post("/api/v1/chat", headers={"X-Player-Id": "p1", "Idempotency-Key": "abcdefgh"}, json={"message": "???"}).json()
    assert data["english_xp_change"] == 0 and data["stats"]["english_xp"] == 0


def test_fallback_non_english_input_does_not_award_xp(tmp_path):
    from lingolife.ai import FallbackProvider
    c = client(tmp_path, FallbackProvider())
    data = c.post(
        "/api/v1/chat",
        headers={"X-Player-Id": "player-cn", "Idempotency-Key": "request-cn-001"},
        json={"message": "你今天怎么了？"},
    ).json()
    assert data["english_xp_change"] == 0
    assert data["english_feedback"]["is_understandable"] is False
