from __future__ import annotations

from datetime import datetime, timedelta, timezone

from lingolife.life import (
    CORE_ACTION_TYPES,
    NpcLifeContext,
    ResourceState,
    WorldClock,
    advance_life_action,
    apply_action_effects,
    create_life_action,
    default_city_resources,
    default_household_resources,
    initial_life_runtime,
    load_life_catalog,
    normalize_runtime_v2,
    rank_life_actions,
    release_resource,
    reserve_resource,
    select_life_action,
    stable_id,
    stable_number,
)
from lingolife.life_world import _profile_goal_tags, _profile_schedule_kind


NOW = datetime(2026, 8, 28, 4, 0, tzinfo=timezone.utc)  # 12:00 Asia/Shanghai


def hungry_context(resources=()):
    return NpcLifeContext(
        player_id="player-1", npc_id="emma", decision_key="2026-08-28:afternoon:1",
        period="afternoon", needs={"food": 5, "rest": 80, "social": 75,
                                   "achievement": 70, "love": 60, "privacy": 70,
                                   "fun": 70, "security": 80},
        traits=("quiet", "creative"), interests=("books", "cooking"),
        current_location_id="house-1:shared-kitchen", current_location_kind="home",
        resources=tuple(resources),
    )


def test_catalog_defines_all_core_actions_and_bounded_resources():
    catalog = load_life_catalog()
    assert set(catalog.actions) == set(CORE_ACTION_TYPES)
    assert len(catalog.actions) == 13
    assert {item["kind"] for item in catalog.household_resources} == {
        "kitchen", "television", "bathroom",
    }
    assert all(5 <= action.duration_seconds[0] <= action.duration_seconds[1]
               for action in catalog.actions.values())
    assert all(action.duration_seconds[0] >= 10 * 60
               for action in catalog.actions.values())
    assert catalog.actions["sleep"].duration_seconds[0] >= 4 * 60 * 60
    assert all(action.collision_hooks for action in catalog.actions.values())
    assert len(default_city_resources(catalog)) >= 6


def test_stable_seed_and_ids_are_replayable_and_versioned():
    first = stable_number("p", "n", "window", {"b": 2, "a": 1})
    assert first == stable_number("p", "n", "window", {"a": 1, "b": 2})
    assert first != stable_number("p", "n", "window", rules_version="life-rules-v2")
    assert stable_id("action", "same") == stable_id("action", "same")
    assert stable_id("action", "same") != stable_id("action", "other")


def test_world_clock_has_stable_decision_windows_and_segmented_catch_up():
    clock = WorldClock("Asia/Shanghai", decision_seconds=30, max_catchup_days=2)
    first = clock.decision_window(NOW + timedelta(seconds=4))
    second = clock.decision_window(NOW + timedelta(seconds=21))
    assert first == second
    assert first.period == "afternoon"
    assert first.game_date == "2026-08-28"

    blocks = clock.catch_up_blocks(NOW - timedelta(days=10), NOW)
    assert blocks
    assert blocks[0].start_at == NOW - timedelta(days=2)
    assert blocks[-1].end_at == NOW
    assert all(block.offline and block.duration_seconds > 0 for block in blocks)
    assert {block.period for block in blocks} >= {"morning", "afternoon", "evening", "night"}
    assert clock.catch_up_blocks(NOW, NOW - timedelta(seconds=1)) == ()


def test_runtime_v1_is_upgraded_without_losing_existing_state():
    legacy = {"emotion": {"valence": 77}, "needs": {"food": 12, "social": 44},
              "growth": {"warmth": 2.5}, "custom_fact": "keep-me"}
    upgraded = normalize_runtime_v2(legacy, now=NOW)
    assert upgraded["version"] == 2
    assert upgraded["emotion"]["valence"] == 77
    assert upgraded["needs"]["food"] == 12
    assert {"privacy", "fun", "security"} <= upgraded["needs"].keys()
    assert upgraded["growth"]["warmth"] == 2.5
    assert upgraded["custom_fact"] == "keep-me"


def test_resource_reservation_queue_release_and_replay_are_pure_and_idempotent():
    kitchen = default_household_resources("house-1")[0]
    assert kitchen.kind == "kitchen" and kitchen.capacity == 1
    acquired = reserve_resource(kitchen, npc_id="emma", action_id="a-1", now=NOW, lease_seconds=100)
    assert acquired.outcome == "acquired" and acquired.changed
    replay = reserve_resource(acquired.resource, npc_id="emma", action_id="a-1",
                              now=NOW + timedelta(seconds=1), lease_seconds=100)
    assert replay.outcome == "acquired" and not replay.changed

    queued = reserve_resource(replay.resource, npc_id="alex", action_id="a-2",
                              now=NOW + timedelta(seconds=2), lease_seconds=90)
    assert queued.outcome == "queued" and queued.queue_position == 1
    queued_replay = reserve_resource(queued.resource, npc_id="alex", action_id="a-2",
                                     now=NOW + timedelta(seconds=3), lease_seconds=90)
    assert queued_replay.outcome == "queued" and queued_replay.queue_position == 1

    released = release_resource(queued.resource, action_id="a-1", now=NOW + timedelta(seconds=10))
    assert released.outcome == "released"
    assert released.promoted_action_ids == ("a-2",)
    assert released.resource.reservations[0].action_id == "a-2"
    assert released.resource.queue == ()
    assert ResourceState.from_dict(released.resource.to_dict()) == released.resource


def test_unavailable_resource_does_not_create_a_queue_entry():
    bathroom = next(item for item in default_household_resources("h") if item.kind == "bathroom")
    bathroom = ResourceState.from_dict({**bathroom.to_dict(), "state": {"available": False}})
    result = reserve_resource(bathroom, npc_id="emma", action_id="shower-1",
                              now=NOW, lease_seconds=60)
    assert result.outcome == "unavailable"
    assert not result.resource.queue and not result.resource.reservations


def test_action_choice_is_deterministic_and_low_food_selects_eating():
    resources = default_household_resources("house-1")
    context = hungry_context(resources)
    first = select_life_action(context)
    second = select_life_action(context)
    assert first == second
    assert first.selected.action_type == "eat"
    assert first.ranked[0].score > first.ranked[-1].score
    assert first.desire_id.startswith("desire-")
    assert first.commitment_id.startswith("commitment-")


def test_talk_requires_a_real_target_and_target_selection_is_stable():
    social_needs = {"food": 80, "rest": 80, "social": 1, "achievement": 80,
                    "love": 20, "privacy": 80, "fun": 80, "security": 80}
    alone = NpcLifeContext("p", "n", "w", "evening", social_needs,
                           traits=("outgoing",), current_location_kind="cafe")
    assert "talk_to_resident" not in {item.action_type for item in select_life_action(alone).ranked}
    together = NpcLifeContext("p", "n", "w", "evening", social_needs,
                              traits=("outgoing",), current_location_kind="cafe",
                              nearby_resident_ids=("zoe", "amy"))
    decision = select_life_action(together)
    talk = next(item for item in decision.ranked if item.action_type == "talk_to_resident")
    assert talk.target_npc_id in {"amy", "zoe"}
    assert talk == next(item for item in select_life_action(together).ranked
                        if item.action_type == "talk_to_resident")


def test_occupation_and_free_form_goal_change_schedule_ranking_and_destination():
    needs = {need: 65 for need in (
        "food", "rest", "social", "achievement", "love", "privacy", "fun", "security",
    )}
    resources = default_city_resources()
    musician = {"occupation": "Music producer",
                "longTermGoal": "Hold a personal concert"}
    engineer = {"occupation": "Software engineer",
                "longTermGoal": "Ship a useful app"}
    student = {"occupation": "Student", "longTermGoal": "Read one hundred books"}

    def ranked(npc_id, profile, interests):
        context = NpcLifeContext(
            "p", npc_id, "goal-window", "afternoon", needs,
            traits=("curious",), interests=interests,
            goal_tags=_profile_goal_tags(profile),
            current_location_id="city_plaza", current_location_kind="city",
            scheduled_kind=_profile_schedule_kind(profile, "afternoon"),
            resources=resources,
        )
        return rank_life_actions(context)

    music_actions = ranked("music", musician, ("music",))
    engineer_actions = ranked("engineer", engineer, ("gaming",))
    student_actions = ranked("student", student, ("reading",))
    music_practice = next(value for value in music_actions if value.action_type == "practice_hobby")
    engineer_practice = next(value for value in engineer_actions if value.action_type == "practice_hobby")

    assert "music" in _profile_goal_tags(musician)
    assert _profile_schedule_kind(musician, "afternoon") == "work"
    assert _profile_schedule_kind(student, "afternoon") == "study"
    assert music_practice.target_resource_id == "music-hall-practice-room"
    assert engineer_practice.target_resource_id == "innovation-hub-desk"
    assert student_actions[0].action_type == "read"


def test_life_action_travels_performs_completes_and_emits_effects_once():
    catalog = load_life_catalog()
    decision = select_life_action(hungry_context(default_household_resources("house-1")), catalog)
    action = create_life_action(
        decision, player_id="player-1", npc_id="emma", now=NOW,
        current_location_id="riverside_park", target_location_id="house-1:shared-kitchen",
        travel_seconds=40, catalog=catalog,
    )
    assert action.status == "planned"
    assert action == type(action).from_dict(action.to_dict())

    traveling = advance_life_action(action, now=NOW)
    assert traveling.action.status == "traveling"
    performing = advance_life_action(traveling.action, now=NOW + timedelta(seconds=41))
    assert performing.action.status == "performing" and performing.action.ends_at
    completed = advance_life_action(
        performing.action, now=performing.action.ends_at + timedelta(seconds=1),
    )
    assert completed.completed and completed.action.status == "completed"
    assert completed.effects["needs"]["food"] > 0
    runtime = initial_life_runtime(now=NOW)
    applied = apply_action_effects(runtime, completed)
    assert applied["needs"]["food"] > runtime["needs"]["food"]
    replay = advance_life_action(completed.action, now=NOW + timedelta(days=1))
    assert not replay.changed and replay.effects["needs"] == {}


def test_blocked_action_retries_and_can_be_interrupted_only_when_allowed():
    catalog = load_life_catalog()
    context = NpcLifeContext(
        "p", "n", "window", "evening",
        {"food": 80, "rest": 80, "social": 80, "achievement": 80,
         "love": 80, "privacy": 80, "fun": 1, "security": 80},
        interests=("film",), current_location_kind="home",
        resources=default_household_resources("h"),
    )
    decision = select_life_action(context, catalog)
    assert decision.selected.action_type == "use_television"
    action = create_life_action(decision, player_id="p", npc_id="n", now=NOW,
                                current_location_id="h:living-room", catalog=catalog)
    blocked = advance_life_action(action, now=NOW, resource_outcome="queued")
    assert blocked.action.status == "blocked" and blocked.action.retry_at
    retrying = advance_life_action(blocked.action, now=blocked.action.retry_at)
    assert retrying.action.status == "retrying" and retrying.action.attempt == 1
    performing = advance_life_action(retrying.action, now=blocked.action.retry_at,
                                     resource_outcome="acquired")
    assert performing.action.status == "performing"
    interrupted = advance_life_action(performing.action, now=NOW + timedelta(seconds=2),
                                      interruption_reason="urgent_call")
    assert interrupted.action.status == "interrupted"
