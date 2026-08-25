import pytest

from lingolife.animation import (
    ANIMATION_CUES,
    PERFORMANCE_FACINGS,
    PERFORMANCE_ROLES,
    ambient_performance,
    animation_cue,
    encounter_performance,
    journey_performance,
    legacy_animation_for,
    outcome_performance,
    performance_to_dict,
    require_animation_performance,
    resolve_turn_animation,
    stage_performance,
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


def test_stage_performance_directs_action_speech_and_listening_with_a_safe_hold():
    performance = stage_performance("crouch")
    assert [beat.cue for beat in performance.beats] == ["crouch", "talk", "listen"]
    assert [beat.role for beat in performance.beats] == ["action", "speak", "listen"]
    assert performance.beats[0].loop is False
    assert performance.hold_cue == "listen"
    assert all(450 <= beat.duration_ms <= 12000 for beat in performance.beats)
    assert all(beat.role in PERFORMANCE_ROLES for beat in performance.beats)
    assert all(beat.facing in PERFORMANCE_FACINGS for beat in performance.beats)
    assert all(0 <= beat.energy <= 1 for beat in performance.beats)
    assert performance_to_dict(performance)["version"] == 1


def test_outcome_and_map_performances_finish_in_idle_without_unattended_talking():
    resolved = outcome_performance("jump")
    assert [beat.cue for beat in resolved.beats] == ["jump", "idle"]
    assert resolved.beats[0].duration_ms >= 3200
    assert [beat.role for beat in resolved.beats] == ["resolve", "hold"]
    assert resolved.hold_cue == "idle"
    assert [beat.cue for beat in ambient_performance("talk").beats] == ["look_around", "idle"]
    assert [beat.cue for beat in ambient_performance("walk").beats] == ["look_around", "idle"]
    assert [beat.cue for beat in ambient_performance("run").beats] == ["look_around", "idle"]
    encounter = encounter_performance("listen")
    assert [beat.cue for beat in encounter.beats] == ["listen", "talk"]
    assert all(beat.facing == "target" for beat in encounter.beats)
    assert encounter.hold_cue == "listen"
    journey = journey_performance("walk")
    assert [beat.cue for beat in journey.beats] == ["walk"]
    assert journey.beats[0].loop is True and journey.hold_cue == "walk"


def test_authored_performance_is_strictly_validated_at_the_content_boundary():
    authored = require_animation_performance(
        {"hold_cue": "idle", "beats": [{"cue": "push", "role": "action",
                                           "duration_ms": 900, "loop": False,
                                           "transition_ms": 120, "facing": "target", "energy": .8}]},
        fallback_cue="talk", field="event.stage.performance",
    )
    assert authored.beats[0].cue == "push" and authored.hold_cue == "idle"
    with pytest.raises(ValueError, match="duration_ms"):
        require_animation_performance(
            [{"cue": "walk", "duration_ms": 60}], fallback_cue="walk",
            field="event.stage.performance",
        )
    with pytest.raises(ValueError, match="cue"):
        require_animation_performance(
            [{"cue": "ai_invented_dance"}], fallback_cue="talk",
            field="event.stage.performance",
        )
