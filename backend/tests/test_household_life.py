from dataclasses import replace
from datetime import datetime, timedelta, timezone

from lingolife.household_life import public_home_life
from lingolife.life import NpcLifeContext, rank_life_actions
from lingolife.life import LifeAction, stable_fraction
from lingolife.life_world import LifeWorldEngine


def context(**changes):
    base = NpcLifeContext(player_id="home-test", npc_id="cook", decision_key="breakfast",
                          period="morning", needs={"food": 45, "rest": 65},
                          current_location_kind="home")
    return replace(base, **changes)


def score(value, action):
    return next(item for item in rank_life_actions(value) if item.action_type == action)


def test_real_home_meal_biases_eating_not_more_cooking():
    plain = context(recent_action_types=("prepare_food",))
    ready = replace(plain, available_home_meal=True)
    assert score(ready, "eat").score > score(plain, "eat").score
    assert "meal_ready_at_home" in score(ready, "eat").reasons
    assert score(ready, "prepare_food").score < score(plain, "prepare_food").score
    assert score(ready, "eat").target_resource_id is None


def test_home_meal_does_not_pull_someone_out_of_an_outside_action():
    outside = context(current_location_kind="work")
    assert score(replace(outside, available_home_meal=True), "eat").score == score(outside, "eat").score


def test_tidy_and_tired_people_respond_differently_to_dishes():
    tidy = context(traits=("tidy",), recent_action_types=("eat",))
    assert score(replace(tidy, pending_home_dishes=True), "clean_shared_space").score > score(tidy, "clean_shared_space").score
    tired = context(traits=("messy",), recent_action_types=("eat",))
    assert score(replace(tired, pending_home_dishes=True), "leave_dishes").score > score(tired, "leave_dishes").score


def test_visible_facts_exclude_private_food_other_homes_and_hidden_state():
    shared = {"id":"meal-1","household_id":"home","owner_id":"cook","access":"shared","active":True}
    state = {"household_food":[shared,{**shared,"id":"private","access":"private"},{**shared,"id":"away","household_id":"other"},{**shared,"id":"used","active":False}],
             "responsibilities":[],"households":{"home":{"state":{"dirty_dishes":2}}},"hidden_score":99}
    result = public_home_life(state,"home")
    assert result == {"shared_meals":[{"id":"meal-1","prepared_by":"cook","prepared_at":None}],"dirty_dishes_count":2}


def test_clear_dishes_removes_the_visual_trace_and_projection_is_read_only():
    state = {"households":{"home":{"state":{"dirty_dishes":3}}}}
    assert public_home_life(state,"home")["dirty_dishes_count"] == 3
    assert "household_food" not in state
    state["households"]["home"]["state"]["dirty_dishes"] = 0
    assert public_home_life(state,"home")["dirty_dishes_count"] == 0


def test_real_cook_share_eat_cleanup_chain_is_idempotent_and_visible():
    now = datetime(2026, 9, 6, 8, tzinfo=timezone.utc)
    profiles = {"cook":{"name":"Emma","personality":["caring"],"householdRole":"cook"},
                "guest":{"name":"Leo","personality":["friendly"]}}
    engine = LifeWorldEngine(timezone_name="UTC")
    state = engine.initialize("breakfast-test", profiles, {key:{"household_id":"home","home_location_id":"home-shared","current_location_id":"home-shared"} for key in profiles}, now=now)
    resources = engine._resource_map(state)
    kitchen = next(resource.id for resource in resources.values() if resource.kind == "kitchen")
    def finish(action_id, person, kind):
        action = LifeAction(id=action_id, player_id="breakfast-test", npc_id=person, action_type=kind,
                            status="completed", desire_id="desire-"+action_id, commitment_id="commit-"+action_id,
                            location_id="home-shared", target_resource_id=kitchen if kind=="prepare_food" else None, target_npc_id=None,
                            planned_at=now, started_at=now, ends_at=now+timedelta(minutes=20),completed_at=now+timedelta(minutes=20),
                            duration_seconds=1200, interruptible=True, animation_cue="idle",collision_hooks=(),
                            need_deltas={},emotion_deltas={},resource_deltas={})
        engine._complete_action(state,state["residents"][person],action,{"needs":{},"emotion":{},"resource":{}},resources,now+timedelta(minutes=20),profile=profiles[person])
    prepared = next(f"cook-{i}" for i in range(100) if stable_fraction(f"cook-{i}","prepared-food-access") < .7)
    finish(prepared,"cook","prepare_food")
    assert len(public_home_life(state,"home")["shared_meals"]) == 2
    finish(prepared,"cook","prepare_food")
    assert len(public_home_life(state,"home")["shared_meals"]) == 2
    finish("guest-eat","guest","eat")
    assert len(public_home_life(state,"home")["shared_meals"]) == 1
    assert public_home_life(state,"home")["dirty_dishes_count"] == 1
    assert not any(item.get("kind")=="dishes" for item in state["responsibilities"])
    assert ":kitchen:" in engine._canonical_home_action_location(state,"cook","clean_shared_space","breakfast:2")
    finish("guest-eat","guest","eat")
    assert public_home_life(state,"home")["dirty_dishes_count"] == 1
    finish("clean","cook","clean_shared_space")
    assert public_home_life(state,"home")["dirty_dishes_count"] == 0
