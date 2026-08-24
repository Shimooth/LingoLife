from lingolife.animation import (
    ANIMATION_CUES,
    animation_cue,
    legacy_animation_for,
    resolve_turn_animation,
    state_animation_cue,
)


def test_animation_catalog_is_finite_and_matches_supported_semantic_actions():
    assert ANIMATION_CUES == {
        "idle", "talk", "listen", "happy", "sad", "tired",
        "look_around", "walk", "run", "jump", "crouch", "push",
    }
    assert animation_cue("invented-by-ai", "talk") == "talk"


def test_event_action_then_ai_expression_then_mood_own_turn_resolution():
    assert resolve_turn_animation("sad", 4, event_cue="walk") == "walk"
    assert resolve_turn_animation("happy", -2, event_cue="talk") == "happy"
    assert resolve_turn_animation("talk", 3, event_cue="talk") == "happy"
    assert resolve_turn_animation("talk", 0, event_cue="listen") == "listen"
    assert resolve_turn_animation("not-a-clip", 0) == "talk"


def test_state_and_legacy_cues_keep_old_clients_compatible():
    assert state_animation_cue(80, 10) == "tired"
    assert state_animation_cue(30, 80) == "sad"
    assert state_animation_cue(70, 80) == "happy"
    assert legacy_animation_for("jump") == "happy"
    assert legacy_animation_for("tired") == "sad"
    assert legacy_animation_for("walk") == "idle"
