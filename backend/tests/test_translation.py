from lingolife.ai import FallbackProvider
from lingolife.db import Database


def test_fallback_translation_preserves_character_tone():
    line = "I do have an answer. Whether it's a sensible one is still under review."
    translated = FallbackProvider().translate(line)
    assert "审核" in translated


def test_npc_translation_round_trips_with_message_history(tmp_path):
    db = Database(f"sqlite:///{tmp_path / 'translation.db'}")
    db.ensure_npc("player-1", "emma")
    response = {
        "npc_reply": "That's a surprisingly good idea.",
        "npc_reply_zh": "这主意好得有点出乎意料。",
        "stats": {"relationship": 36, "mood": 51, "english_xp": 1},
    }
    committed, created = db.commit_chat("player-1", "turn-1", "What do you think?", response)
    assert created and committed["npc_reply_zh"] == response["npc_reply_zh"]
    history = db.messages("player-1", 10)
    assert history[-1]["translation"] == response["npc_reply_zh"]
    assert history[-2]["translation"] is None


def test_first_npc_messages_have_translations_and_old_rows_are_backfilled(tmp_path):
    path = tmp_path / "first-message.db"
    db = Database(f"sqlite:///{path}")
    db.ensure_npc("player-1", "emma")
    assert db.messages("player-1", 10)[0]["translation"] == "我今天工作过得糟透了……"

    db.ensure_npc("player-1", "friend", "Hi, I'm Kai. What would you like to talk about?", "嗨，我是Kai。你想聊些什么？")
    assert db.messages("player-1", 10, "friend")[0]["translation"] == "嗨，我是Kai。你想聊些什么？"
