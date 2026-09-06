from copy import deepcopy
from datetime import datetime, timezone

import pytest

from lingolife.conversation import conversation_id, conversation_opening
from lingolife.db import Database
from lingolife.life_service import LifeWorldService
from test_life_api import ContextStub, _auth, _client


class HistoryProvider(ContextStub):
    def __init__(self):
        super().__init__()
        self.histories = []

    def reply(self, message, stats, history, context):
        self.histories.append(deepcopy(history))
        return super().reply(message, stats, history, context)


def test_scope_changes_on_game_day_or_action_instance_not_action_type():
    first = conversation_id("emma", "2026-09-06", "read-1")
    assert first == conversation_id("emma", "2026-09-06", "read-1")
    assert first != conversation_id("emma", "2026-09-07", "read-1")
    assert first != conversation_id("emma", "2026-09-06", "read-2")
    assert first != conversation_id("maya", "2026-09-06", "read-1")
    assert "read" not in first


@pytest.mark.parametrize("action_type", ["sleep", "shower", "private_time"])
def test_private_opening_is_bilingual_without_disclosing_activity(action_type):
    opening = conversation_opening({"type": action_type, "status": "performing"})
    assert opening == {"text": "I need a little personal time right now.",
                       "translation": "我现在需要一点私人时间。"}


def test_room_city_and_timezone_share_scope_across_midnight(tmp_path, monkeypatch):
    with _client(tmp_path) as client:
        headers, _ = _auth(client, "scope-midnight")
        original_load = LifeWorldService.load
        state = {}

        def fixed_load(self, *args, **kwargs):
            if not state:
                state.update(deepcopy(original_load(self, *args, **kwargs)))
            return deepcopy(state)

        monkeypatch.setattr(LifeWorldService, "load", fixed_load)
        # Freeze the action so this proves midnight alone changes the scope.
        moment = [datetime(2026, 9, 6, 15, 59, 59, tzinfo=timezone.utc)]
        monkeypatch.setattr("lingolife.life_service._utc", lambda value=None: value or moment[0])
        first = client.get("/api/v1/room", headers=headers).json()["conversation"]
        city = client.get("/api/v1/city", headers=headers).json()
        assert city["npcs"][0]["conversation_id"] == first["id"]
        assert first["game_date"] == "2026-09-06"
        moment[0] = datetime(2026, 9, 6, 16, 0, tzinfo=timezone.utc)
        second = client.get("/api/v1/room", headers=headers).json()["conversation"]
        assert second["game_date"] == "2026-09-07"
        assert second["id"] != first["id"]
        action = state["residents"]["emma"]["current_action"]
        action["status"] = "performing"
        same_action = client.get("/api/v1/room", headers=headers).json()["conversation"]
        assert same_action["id"] == second["id"]  # phase changes are not new actions
        action["id"] += "-next-instance"
        next_action = client.get("/api/v1/room", headers=headers).json()["conversation"]
        assert next_action["id"] != second["id"]


def test_action_switch_archives_old_turns_filters_provider_and_preserves_replay(tmp_path, monkeypatch):
    provider = HistoryProvider()
    with _client(tmp_path, provider) as client:
        headers, user = _auth(client, "scope-history")
        original = LifeWorldService.npc_context
        encounter = ["read-1"]

        def context(self, *args, **kwargs):
            result = original(self, *args, **kwargs)
            result["conversation"] = {
                "id": conversation_id("emma", "2026-09-06", encounter[0]),
                "game_date": "2026-09-06",
                "opening": conversation_opening({"type": "read" if encounter[0] == "read-1" else "eat",
                                                  "status": "performing"}),
            }
            return result

        monkeypatch.setattr(LifeWorldService, "npc_context", context)

        def chat(message, key):
            result = client.post("/api/v1/chat", headers={**headers, "Idempotency-Key": key},
                                 json={"message": message, "npc_id": "emma"})
            assert result.status_code == 200, result.text
            return result.json()

        first_room = client.get("/api/v1/room", headers=headers).json()
        first = chat("Is that book interesting?", "scope-chat-1")
        assert provider.histories[0] == [{"speaker": "npc", "text": first_room["conversation"]["opening"]["text"]}]
        chat("Tell me about the book.", "scope-chat-2")
        assert any(item["text"] == "Is that book interesting?" for item in provider.histories[1])
        same_room = client.get("/api/v1/room", headers=headers).json()
        assert same_room["conversation"]["id"] == first["conversation"]["id"]
        assert same_room["messages"][-1]["conversation_id"] == first["conversation"]["id"]

        encounter[0] = "eat-2"
        new_room = client.get("/api/v1/room", headers=headers).json()
        assert new_room["messages"] == same_room["messages"]  # no deletion
        assert new_room["conversation"]["id"] != first["conversation"]["id"]
        chat("What are you eating?", "scope-chat-3")
        assert provider.histories[2] == [{"speaker": "npc", "text": new_room["conversation"]["opening"]["text"]}]
        count_before = len(client.app.state.db.messages(user["player_id"], 200))
        replay = chat("Is that book interesting?", "scope-chat-1")
        assert replay["conversation"]["id"] == first["conversation"]["id"]
        assert provider.calls == 3
        assert len(client.app.state.db.messages(user["player_id"], 200)) == count_before
        reopened = Database(f"sqlite:///{tmp_path / 'life-api.db'}")
        try:
            persisted = reopened.messages(user["player_id"], 200, conversation_id=first["conversation"]["id"])
            assert len(persisted) == 4
            assert all(item["conversation_id"] == first["conversation"]["id"] for item in persisted)
            assert len(reopened.messages(user["player_id"], 200)) == count_before
        finally:
            reopened._connection.close()
