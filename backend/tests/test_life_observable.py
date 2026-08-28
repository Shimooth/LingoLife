from __future__ import annotations

from datetime import datetime, timedelta, timezone
from collections import Counter
import json

from lingolife.life import LifeAction
from lingolife.life_observable import project_observable_action
from lingolife.life_world import LifeWorldEngine


NOW = datetime(2026, 8, 28, 10, 0, tzinfo=timezone.utc)


def action(*, action_type="practice_hobby", status="performing", action_id="action-visible-1",
           location_id="music_hall", target_npc_id=None, target_resource_id=None):
    return LifeAction(
        id=action_id, player_id="player-1", npc_id="emma", action_type=action_type,
        status=status, desire_id="private-desire", commitment_id="private-commitment",
        location_id=location_id, target_resource_id=target_resource_id,
        target_npc_id=target_npc_id, planned_at=NOW, duration_seconds=3600,
        interruptible=True, animation_cue="happy", collision_hooks=("shared_hobby",),
        need_deltas={}, emotion_deltas={}, resource_deltas={}, started_at=NOW,
        ends_at=NOW + timedelta(hours=1),
    )


def test_music_hobby_copy_is_specific_bilingual_located_and_deterministic():
    profile = {
        "interests": ["music", "photography"], "occupation": "Music producer",
        "longTermGoal": "Hold a personal concert",
    }
    first = project_observable_action(
        action(), profile, runtime={"emotion": {"energy": 74, "stress": 24, "valence": 72}},
        location_label="Southbank Music Hall", location_label_zh="南岸音乐厅",
        object_label="practice room", object_label_zh="音乐练习室", resource_kind="hobby_space",
    )
    replay = project_observable_action(
        action(), profile, runtime={"emotion": {"energy": 74, "stress": 24, "valence": 72}},
        location_label="Southbank Music Hall", location_label_zh="南岸音乐厅",
        object_label="practice room", object_label_zh="音乐练习室", resource_kind="hobby_space",
    )

    assert first == replay
    assert "interest or personal goal" not in first["visible_intent"]
    assert "兴趣或个人目标" not in first["visible_intent_zh"]
    assert "Southbank Music Hall" in first["visible_intent"]
    assert "南岸音乐厅" in first["visible_intent_zh"]
    assert first["visible_context"]["topic"] == "music"
    assert first["visible_context"]["icon"] == "♫"
    assert first["visible_context"]["object_zh"] == "音乐练习室"
    assert first["observable_state"] == {
        "mood": "upbeat", "energy": "high", "attention": "focused", "phase": "performing",
    }


def test_goal_and_location_can_form_a_concrete_status_in_both_phases():
    profile = {
        "interests": ["fitness"], "occupation": "Personal trainer",
        "longTermGoal": "Open a neighborhood gym",
    }
    performing = project_observable_action(
        action(location_id="greenway_gym"), profile,
        location_label="Greenway Gym", location_label_zh="绿道健身房",
        resource_kind="hobby_space",
    )
    traveling = project_observable_action(
        action(status="traveling", location_id="greenway_gym"), profile,
        location_label="Greenway Gym", location_label_zh="绿道健身房",
        resource_kind="hobby_space",
    )

    assert performing["visible_intent"] == (
        "Researching training plans for a future gym at Greenway Gym"
    )
    assert performing["visible_intent_zh"] == "正在为开一家健身房研究训练方案 · 绿道健身房"
    assert traveling["visible_intent"] == (
        "Heading to Greenway Gym to research training plans for a future gym"
    )
    assert traveling["visible_intent_zh"] == "正前往绿道健身房为开一家健身房研究训练方案"
    assert traveling["visible_context"]["progress_kind"] == "route"
    assert traveling["observable_state"]["phase"] == "traveling"


def test_social_copy_names_only_the_public_target_and_hidden_values_become_bands():
    view = project_observable_action(
        action(action_type="talk_to_resident", target_npc_id="alex", location_id="moonlight_cafe"),
        {"interests": ["music"]}, target_name="Alex",
        location_label="Moonlight Café", location_label_zh="月光咖啡馆",
        runtime={"emotion": {"energy": 31, "stress": 91, "valence": 12},
                 "needs": {"love": 3, "privacy": 2}},
    )
    encoded = json.dumps(view, ensure_ascii=False)

    assert view["visible_intent"] == "Chatting with Alex at Moonlight Café"
    assert view["visible_intent_zh"] == "正在和Alex聊聊天 · 月光咖啡馆"
    assert view["visible_context"]["target_name"] == "Alex"
    assert view["observable_state"] == {
        "mood": "tense", "energy": "low", "attention": "social", "phase": "performing",
    }
    assert "private-desire" not in encoded and "private-commitment" not in encoded
    assert '"91"' not in encoded and '"12"' not in encoded
    assert '"love"' not in encoded
    assert "needs" not in view


def test_unknown_authored_interest_has_a_safe_deterministic_fallback():
    profile = {"interests": ["origami"], "occupation": "", "longTermGoal": ""}
    first = project_observable_action(action(location_id="home-emma"), profile)
    second = project_observable_action(action(location_id="home-emma"), profile)

    assert first == second
    assert first["visible_context"]["activity"] == "spend time on origami"
    assert first["visible_context"]["activity_zh"] == "钻研origami"


def test_private_actions_hide_the_exact_activity_room_and_internal_values():
    view = project_observable_action(
        action(action_type="shower", location_id="household-1:shared-bathroom",
               target_resource_id="shared-shower"),
        {"name": "Emma", "interests": ["music"]},
        location_label="Shared bathroom", location_label_zh="共用浴室",
        object_label="shower", object_label_zh="淋浴",
        runtime={"emotion": {"energy": 17, "stress": 88, "valence": 13}},
    )
    encoded = json.dumps(view, ensure_ascii=False).casefold()

    assert view["visible_intent"] == "At home and unavailable for a little while"
    assert view["visible_intent_zh"] == "正在家中处理私人事务，暂时不便打扰"
    assert view["visible_context"]["visibility"] == "private"
    assert view["visible_context"]["topic"] == "private"
    assert "shower" not in encoded and "bathroom" not in encoded
    assert "淋浴" not in encoded and "浴室" not in encoded
    assert "17" not in encoded and "88" not in encoded and "13" not in encoded


def test_two_day_routine_is_deterministic_and_not_monopolized_by_hobbies():
    profiles = {
        "mia": {"name": "Mia", "personality": ["creative", "warm"],
                "interests": ["music", "photography"], "occupation": "Music producer",
                "longTermGoal": "Hold a concert"},
        "kai": {"name": "Kai", "personality": ["curious", "energetic"],
                "interests": ["fitness", "cooking"], "occupation": "Trainer",
                "longTermGoal": "Open a gym"},
        "lee": {"name": "Lee", "personality": ["quiet", "thoughtful"],
                "interests": ["reading", "art"], "occupation": "Teacher",
                "longTermGoal": "Write a book"},
    }

    def run():
        engine = LifeWorldEngine(timezone_name="UTC")
        initial = engine.initialize("distribution-player", profiles, None, None, None, NOW)
        return engine.advance(initial, profiles, NOW + timedelta(days=2))

    first, replay = run(), run()
    first_actions = Counter(
        (record.get("story") or {}).get("visible_facts", {}).get("action_type")
        for record in first["stories"].values()
    )
    replay_actions = Counter(
        (record.get("story") or {}).get("visible_facts", {}).get("action_type")
        for record in replay["stories"].values()
    )
    completed_total = sum(count for action_type, count in first_actions.items() if action_type)

    assert first_actions == replay_actions
    assert completed_total >= 50
    assert first_actions["practice_hobby"] / completed_total < .30
    assert len({action_type for action_type, count in first_actions.items()
                if action_type and count}) >= 8
    assert all(len(set(resident["recent_action_types"])) >= 4
               for resident in first["residents"].values())
    public = LifeWorldEngine(timezone_name="UTC").public_snapshot(first)
    assert all(isinstance(value, str)
               for resident in public["residents"]
               for group in resident["runtime"].values()
               for value in group.values())
    assert "active_desire_ids" not in json.dumps(public)
