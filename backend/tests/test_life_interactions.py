from __future__ import annotations

import json
from copy import deepcopy

from lingolife.animation import ANIMATION_CUES
from lingolife.interaction import (
    INTERACTION_STAGE_ORDER,
    build_interaction_scene,
    public_interaction_scene,
)
from lingolife.life_service import LifeWorldService


PARTICIPANTS = ("ava", "bo")


def _collision(*, topic: str = "companionship", scenario_id: str = "friendly_company") -> dict:
    return {
        "id": "collision-scene-1", "scenario_id": scenario_id, "topic": topic,
        "participant_ids": list(PARTICIPANTS),
    }


def _resolution(first: str = "share_activity", second: str = "welcome_company",
                *, requires_intervention: bool = False) -> dict:
    return {
        "response_by_participant": {"ava": first, "bo": second},
        "requires_intervention": requires_intervention,
    }


def _profiles(*, ava: str = "measured", bo: str = "measured") -> dict[str, dict]:
    modes = {
        "measured": {"warmth": 55, "extraversion": 50, "assertiveness": 50,
                     "openness": 55, "emotional_stability": 55, "humor": 40},
        "reserved": {"warmth": 52, "extraversion": 15, "assertiveness": 30,
                     "openness": 55, "emotional_stability": 60, "humor": 35},
        "direct": {"warmth": 45, "extraversion": 65, "assertiveness": 88,
                   "openness": 50, "emotional_stability": 62, "humor": 35},
        "warm": {"warmth": 90, "extraversion": 58, "assertiveness": 48,
                 "openness": 62, "emotional_stability": 70, "humor": 42},
        "playful": {"warmth": 75, "extraversion": 82, "assertiveness": 58,
                    "openness": 78, "emotional_stability": 70, "humor": 88},
    }
    return {
        "ava": {"name": "Ava", "axes": modes[ava]},
        "bo": {"name": "Bo", "axes": modes[bo]},
    }


def _relationships(*, closeness: int = 20, tension: int = 5) -> dict:
    return {
        (owner, target): {
            "owner_id": owner, "target_id": target,
            "familiarity": closeness, "affinity": closeness, "trust": closeness,
            "tension": tension, "resentment": tension,
        }
        for owner, target in (("ava", "bo"), ("bo", "ava"))
    }


def _stage(scene: dict, stage_id: str) -> dict:
    return next(stage for stage in scene["stages"] if stage["id"] == stage_id)


def test_rule_response_compiles_to_four_ordered_bilingual_performance_stages():
    internal = build_interaction_scene(
        collision=_collision(), resolution=_resolution(), profiles=_profiles(),
        relationships=_relationships(),
    )
    scene = public_interaction_scene(
        internal, participant_ids=PARTICIPANTS, can_intervene=True,
    )

    assert scene is not None
    assert tuple(stage["id"] for stage in scene["stages"]) == INTERACTION_STAGE_ORDER
    assert [stage["can_intervene_after"] for stage in scene["stages"]] == [False, False, True, False]
    assert len(scene["beats"]) >= 5
    assert {npc_id: sum(beat["speaker_id"] == npc_id for beat in scene["beats"])
            for npc_id in PARTICIPANTS} == {"ava": 3, "bo": 2}
    assert all(beat["text"] and beat["translation_zh"] for beat in scene["beats"])
    assert all(900 <= beat["duration_ms"] <= 6000 for beat in scene["beats"])
    assert {beat["animation_cue"] for beat in scene["beats"]} <= ANIMATION_CUES
    assert all(beat["phase"] == stage["id"]
               for stage in scene["stages"] for beat in stage["beats"])

    encoded = json.dumps(scene, ensure_ascii=False).casefold()
    for hidden in ("response_by_participant", "share_activity", "welcome_company",
                   "persona_axes", '"trust"', '"affinity"', '"tension"'):
        assert hidden not in encoded


def test_selected_response_changes_spoken_action_emotion_and_animation():
    welcomed = build_interaction_scene(
        collision=_collision(), resolution=_resolution(second="welcome_company"),
        profiles=_profiles(), relationships=_relationships(),
    )
    declined = build_interaction_scene(
        collision=_collision(), resolution=_resolution(second="decline_kindly"),
        profiles=_profiles(), relationships=_relationships(),
    )
    hostile = build_interaction_scene(
        collision=_collision(), resolution=_resolution(second="interrupt_anyway"),
        profiles=_profiles(), relationships=_relationships(),
    )

    welcome_beat = _stage(welcomed, "exchange")["beats"][0]
    decline_beat = _stage(declined, "exchange")["beats"][0]
    hostile_beat = _stage(hostile, "exchange")["beats"][0]
    assert len({welcome_beat["text"], decline_beat["text"], hostile_beat["text"]}) == 3
    assert len({welcome_beat["emotion"], decline_beat["emotion"], hostile_beat["emotion"]}) == 3
    assert welcome_beat["animation_cue"] == "happy"
    assert decline_beat["animation_cue"] == "talk"
    assert hostile_beat["emotion"] == "frustrated"
    assert _stage(welcomed, "reaction")["beats"] != _stage(hostile, "reaction")["beats"]
    assert _stage(welcomed, "closure")["beats"] != _stage(hostile, "closure")["beats"]


def test_personality_and_relationship_stage_change_clarification_and_closure():
    base = dict(collision=_collision(), resolution=_resolution())
    reserved = build_interaction_scene(
        **base, profiles=_profiles(bo="reserved"), relationships=_relationships(),
    )
    direct = build_interaction_scene(
        **base, profiles=_profiles(bo="direct"), relationships=_relationships(),
    )
    direct_opener = build_interaction_scene(
        **base, profiles=_profiles(ava="direct"), relationships=_relationships(),
    )
    warm_opener = build_interaction_scene(
        **base, profiles=_profiles(ava="warm"), relationships=_relationships(),
    )
    close = build_interaction_scene(
        **base, profiles=_profiles(), relationships=_relationships(closeness=82),
    )
    tense = build_interaction_scene(
        **base, profiles=_profiles(), relationships=_relationships(closeness=82, tension=88),
    )

    reserved_clarification = _stage(reserved, "reaction")["beats"][-1]
    direct_clarification = _stage(direct, "reaction")["beats"][-1]
    assert reserved_clarification["text"] != direct_clarification["text"]
    assert reserved_clarification["animation_cue"] == "listen"
    assert direct_clarification["emotion"] == "focused"
    assert _stage(direct_opener, "setup")["beats"][0]["text"] != \
        _stage(warm_opener, "setup")["beats"][0]["text"]
    assert _stage(close, "closure")["beats"][0]["text"] != \
        _stage(tense, "closure")["beats"][0]["text"]
    assert _stage(tense, "closure")["beats"][0]["emotion"] in {"tense", "earnest"}


def test_scene_is_deterministic_and_public_whitelist_rejects_incomplete_or_foreign_cast():
    arguments = {
        "collision": _collision(), "resolution": _resolution(),
        "profiles": _profiles(ava="warm", bo="reserved"),
        "relationships": _relationships(closeness=70),
    }
    first = build_interaction_scene(**arguments)
    assert build_interaction_scene(**arguments) == first

    malformed = deepcopy(first)
    malformed["stages"] = malformed["stages"][:-1]
    assert public_interaction_scene(
        malformed, participant_ids=PARTICIPANTS, can_intervene=False,
    ) is None
    foreign = deepcopy(first)
    foreign["stages"][0]["beats"][0]["speaker_id"] = "not-in-this-story"
    # The foreign beat is stripped, leaving a required stage empty; the whole
    # scene is rejected rather than exposing cross-story content.
    assert public_interaction_scene(
        foreign, participant_ids=PARTICIPANTS, can_intervene=False,
    ) is None

    hardened = deepcopy(first)
    hardened["stages"][0]["label"] = "response_by_participant"
    hardened["stages"][0]["beats"][0]["id"] = "secret-response-id"
    hardened["stages"][0]["beats"][0]["emotion"] = "private-score-99"
    hardened["stages"][0]["beats"][0]["duration_ms"] = float("nan")
    public = public_interaction_scene(
        hardened, participant_ids=PARTICIPANTS, can_intervene=False,
    )
    assert public is not None
    encoded = json.dumps(public, ensure_ascii=False)
    assert "response_by_participant" not in encoded
    assert "secret-response-id" not in encoded
    assert "private-score-99" not in encoded
    assert public["beats"][0]["duration_ms"] == 2400


def test_persisted_scene_replays_after_profiles_and_relationships_change():
    record = {
        "story": {"id": "story-persisted"},
        "collision": _collision(), "resolution": _resolution(),
    }
    record["interaction"] = build_interaction_scene(
        collision=record["collision"], resolution=record["resolution"],
        profiles=_profiles(ava="warm", bo="reserved"),
        relationships=_relationships(closeness=82),
    )
    original = LifeWorldService._interaction_presentation(
        record, topic="companionship", participant_ids=PARTICIPANTS,
        profiles=_profiles(ava="warm", bo="reserved"),
        relationships=_relationships(closeness=82), can_intervene=True, outcome=None,
    )
    replay = LifeWorldService._interaction_presentation(
        record, topic="companionship", participant_ids=PARTICIPANTS,
        profiles=_profiles(ava="direct", bo="direct"),
        relationships=_relationships(closeness=5, tension=95),
        can_intervene=True, outcome=None,
    )
    assert replay == original


def test_legacy_story_without_scene_is_upgraded_at_read_time_without_hidden_outcome():
    record = {
        "story": {"id": "story-legacy"},
        "collision": _collision(topic="borrowed_property", scenario_id="borrowed_item_boundary"),
        "resolution": _resolution(first="return_and_apologize", second="state_borrowing_rule",
                                  requires_intervention=True),
    }
    presentation = LifeWorldService._interaction_presentation(
        record, topic="borrowed_property", participant_ids=PARTICIPANTS,
        profiles=_profiles(), relationships=_relationships(closeness=45),
        can_intervene=True, outcome=None,
    )

    assert tuple(stage["id"] for stage in presentation["stages"]) == INTERACTION_STAGE_ORDER
    assert len(presentation["beats"]) >= 5
    assert presentation["stages"][2]["can_intervene_after"] is True
    serialized = json.dumps(presentation, ensure_ascii=False).casefold()
    assert "response_by_participant" not in serialized
    assert "relationship_changes" not in serialized
    assert "aftermath" not in serialized
