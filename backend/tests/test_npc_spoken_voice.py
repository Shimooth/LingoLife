from __future__ import annotations

from copy import deepcopy

import pytest

from lingolife.interaction import (
    RESPONSE_COPY, TOPIC_DEFAULT_RESPONSES, build_interaction_scene,
    public_interaction_scene,
)
from lingolife.interaction_copy import MODES, RESPONSES, SETUPS, VOICE_RESPONSES
from lingolife.dinner_copy import LINES, meal_line
from lingolife.npc_voice import voice_mode
from test_life_interactions import _collision, _profiles, _relationships, _resolution, _stage
from test_dinner import NOW, world, finish
from lingolife import dinner


@pytest.mark.parametrize("topic", list(TOPIC_DEFAULT_RESPONSES))
@pytest.mark.parametrize("mode", MODES)
def test_all_situations_have_bilingual_in_character_playable_scenes(topic, mode):
    choices = TOPIC_DEFAULT_RESPONSES[topic]
    arguments = dict(collision=_collision(topic=topic), resolution=_resolution(*choices),
                     profiles=_profiles(ava=mode, bo=mode), relationships=_relationships())
    before = deepcopy(arguments)
    internal = build_interaction_scene(**arguments)
    public = public_interaction_scene(internal, participant_ids=("ava", "bo"), can_intervene=False)
    assert public and len(public["beats"]) == 5
    assert all(beat["text"].strip() and beat["translation_zh"].strip() for beat in public["beats"])
    assert arguments == before  # direction never changes world decisions or traits
    assert internal == build_interaction_scene(**arguments)
    text = " ".join(beat["text"] for beat in public["beats"])
    assert not any(phrase in text for phrase in (
        "Can we be direct?", "Um…", "meeting me halfway", "deal with the issue, not attack",
        "something to work with", "Thank you for asking",
    ))


def test_every_intent_has_an_everyday_baseline_and_voice_variants_have_valid_keys():
    assert set(RESPONSES) == set(RESPONSE_COPY)
    assert set(SETUPS) == set(TOPIC_DEFAULT_RESPONSES)
    assert set(VOICE_RESPONSES) <= set(RESPONSES)
    for rows in SETUPS.values():
        assert len(rows) == len(MODES)
        assert all(len(row) == 2 and all(row) for row in rows)
    for rows in VOICE_RESPONSES.values():
        assert set(rows) <= set(MODES)
        assert all(len(row) == 2 and all(row) for row in rows.values())


@pytest.mark.parametrize("trait,expected", [
    ("内向", "reserved"), ("直接", "direct"), ("温柔", "warm"),
    ("幽默", "playful"), ("serious", "measured"), ("sarcastic", "playful"),
])
def test_actual_editable_traits_select_voice(trait, expected):
    assert voice_mode({"personality": [trait]}) == expected


@pytest.mark.parametrize("topic,choices", [
    ("companionship", ("share_activity", "welcome_company")),
    ("shared_kitchen", ("negotiate", "wait")),
    ("shared_food", ("share_food_together", "accept_shared_food")),
    ("dishwashing", ("offer_to_share", "remind_calmly")),
])
def test_voice_changes_response_itself_not_only_an_opener_prefix(topic, choices):
    lines = []
    for mode in MODES:
        scene = build_interaction_scene(collision=_collision(topic=topic), resolution=_resolution(*choices),
                                        profiles=_profiles(ava=mode, bo=mode))
        # dishwashing's opener is Bo so exchange is Ava; both use same voice.
        lines.append(_stage(scene, "exchange")["beats"][0]["text"])
    assert len(set(lines)) == len(MODES)


def test_refusal_is_heard_instead_of_followed_by_another_invitation():
    scene = build_interaction_scene(collision=_collision(), resolution=_resolution(second="decline_kindly"),
                                    profiles=_profiles(ava="warm", bo="reserved"))
    reaction = _stage(scene, "reaction")["beats"]
    assert "won't push" in reaction[0]["text"]
    assert "Not angry" in reaction[1]["text"]
    assert "Leaving it there" in _stage(scene, "closure")["beats"][0]["text"]


def test_conflict_keeps_a_grudge_and_suppresses_jokes_even_for_a_comedian():
    scene = build_interaction_scene(collision=_collision(topic="dishwashing"),
                                    resolution=_resolution("send_angry_message", "remind_calmly"),
                                    profiles=_profiles(ava="playful", bo="playful"),
                                    relationships=_relationships(closeness=85, tension=80))
    text = " ".join(beat["text"] for stage in scene["stages"] for beat in stage["beats"])
    assert "I'm still mad" in text
    assert "reunion" not in text and "learned to wash" not in text
    assert not any(beat["emotion"] == "playful" for stage in scene["stages"] for beat in stage["beats"])


def test_familiar_banter_requires_mutual_trust_and_low_strain():
    args = dict(collision=_collision(), resolution=_resolution(), profiles=_profiles())
    close = build_interaction_scene(**args, relationships=_relationships(closeness=85))
    new = build_interaction_scene(**args, relationships=_relationships(closeness=10))
    assert _stage(close, "reaction")["beats"][-1]["emotion"] == "familiar"
    assert _stage(new, "reaction")["beats"][-1]["emotion"] != "familiar"
    one_sided = _relationships(closeness=85)
    one_sided[("bo", "ava")]["trust"] = 10
    uneven = build_interaction_scene(**args, relationships=one_sided)
    assert _stage(uneven, "reaction")["beats"][-1]["emotion"] != "familiar"


def test_new_events_vary_but_refreshes_and_old_saved_scenes_do_not_reroll():
    endings = set()
    for number in range(20):
        scene = build_interaction_scene(collision={**_collision(), "id": f"new-{number}"},
                                        resolution=_resolution(), profiles=_profiles())
        endings.add(_stage(scene, "closure")["beats"][0]["text"])
    assert len(endings) >= 3
    legacy = build_interaction_scene(collision=_collision(), resolution=_resolution(), profiles=_profiles())
    legacy["rules_version"] = "interaction-scene-v1"
    legacy["stages"][0]["beats"][0]["text"] = "A previously spoken line."
    assert public_interaction_scene(legacy, participant_ids=("ava", "bo"), can_intervene=False)["beats"][0]["text"] == "A previously spoken line."


@pytest.mark.parametrize("intent", ["accept_shared_food", "share_food_together", "save_food_for_later", "decline_shared_food"])
def test_already_consumed_food_never_replays_an_invitation_or_denies_eating(intent):
    scene = build_interaction_scene(
        collision={**_collision(topic="shared_food"), "facts": {"prepared_by": "ava", "consumed_by": "bo"}},
        resolution=_resolution("share_food_together", intent), profiles=_profiles())
    assert "How was the meal?" == _stage(scene, "setup")["beats"][0]["text"]
    exchange = _stage(scene, "exchange")["beats"][0]["text"]
    assert "I've" in exchange
    assert "want some" not in str(scene).lower()
    assert "Let's split it" not in str(scene)
    if intent == "save_food_for_later":
        assert "If there's more" in exchange


def test_meal_voices_preserve_consent_and_remain_frozen_through_actual_actions():
    engine, state, profiles = world()
    resident = {**state["residents"]["b"], "npc_id": "b"}
    lines = set()
    for mode in MODES:
        profile = _profiles(bo=mode)["bo"]
        status, en, zh = dinner.response(resident, profile, "test")
        assert status == "accepted" and zh
        lines.add(en)
    assert len(lines) == 5
    profiles["a"]["personality"] = ["幽默", "tidy"]
    meal = dinner.propose(state, profiles, "shared", NOW, "2026-09-06", source="player")
    assert meal["voices"]["a"] == "playful"
    profiles["a"]["personality"] = ["serious"]
    finish(engine, state, profiles, "a", "prepare_food", "voice-cook")
    finish(engine, state, profiles, "a", "eat", "voice-eat")
    ate = next(item for item in meal["events"] if item["id"] == "ate:a")
    assert ate["text"] == meal_line("ate", "playful")[0]
    assert "Thanks for the meal" not in ate["text"]  # the cook isn't thanking themself
    assert "voices" not in dinner.public_dinner(state, "shared")


def test_every_meal_phase_has_five_bilingual_voices():
    for intent, rows in LINES.items():
        assert len(rows) == len(MODES)
        assert len({row[0] for row in rows}) == len(MODES)
        assert all(all(meal_line(intent, mode)) for mode in MODES)
