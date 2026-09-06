from copy import deepcopy
from datetime import datetime, timedelta, timezone

import pytest

from lingolife import dinner
from lingolife.life import LifeAction
from lingolife.life_world import LifeWorldEngine
from lingolife.household_life import public_home_life

NOW = datetime(2026, 9, 6, 18, tzinfo=timezone.utc)


def world():
    engine = LifeWorldEngine(timezone_name="UTC")
    profiles = {"a":{"name":"Ava","personality":["caring","tidy"],"householdRole":"cook"},
                "b":{"name":"Bo","personality":["friendly"]}}
    state = engine.initialize("dinner-test",profiles,{key:{"household_id":"shared","home_location_id":"home-1","current_location_id":"home-1"} for key in profiles},now=NOW)
    for resident in state["residents"].values():
        resident["current_location_id"] = "home-1"
        resident["runtime"]["needs"].update(food=50,rest=80,hygiene=70,comfort=70)
        resident["current_action"].update(action_type="read",status="completed",location_id="home-1")
    return engine, state, profiles


def finish(engine, state, profiles, npc_id, kind, serial, now=NOW):
    resources = engine._resource_map(state)
    kitchen = next(item.id for item in resources.values() if item.kind=="kitchen")
    action = LifeAction(id=serial,player_id=state["player_id"],npc_id=npc_id,action_type=kind,
                        status="completed",desire_id=serial,commitment_id=serial,
                        location_id="shared:kitchen:table",target_resource_id=kitchen if kind=="prepare_food" else None,target_npc_id=None,
                        planned_at=now,started_at=now,ends_at=now,completed_at=now,duration_seconds=120,
                        interruptible=True,animation_cue="idle",collision_hooks=(),need_deltas={},emotion_deltas={},resource_deltas={})
    engine._complete_action(state,state["residents"][npc_id],action,{"needs":{},"emotion":{},"resource":{}},resources,now,profiles[npc_id])
    state["resources"] = [value.to_dict() for value in resources.values()]
    return action


def test_invitation_respects_fullness_privacy_fatigue_and_actual_location():
    _, state, profiles = world()
    resident = {**state["residents"]["b"],"npc_id":"b"}
    assert dinner.response(resident,profiles["b"],"seed")[0] == "accepted"
    resident["current_action"]["status"] = "performing"
    assert dinner.response(resident,profiles["b"],"seed")[0] == "later"
    resident["runtime"]["needs"]["food"] = 95
    assert dinner.response(resident,profiles["b"],"seed")[0] == "declined"
    resident["runtime"]["needs"].update(food=50,rest=10)
    assert dinner.response(resident,profiles["b"],"seed")[0] == "declined"
    resident["runtime"]["needs"]["rest"] = 80
    resident["current_location_id"] = "city_library"
    assert dinner.response(resident,profiles["b"],"seed")[0] == "declined"


def test_proposal_is_once_daily_without_interrupting_or_manufacturing_food():
    _, state, profiles = world()
    before = deepcopy(state["residents"])
    first = deepcopy(dinner.propose(state,profiles,"shared",NOW,"2026-09-06",source="player"))
    assert first["cook_id"] == "a"
    assert state["residents"] == before
    assert not state["household_food"]
    assert dinner.propose(state,profiles,"shared",NOW+timedelta(minutes=1),"2026-09-06",source="player") == first
    with pytest.raises(KeyError):
        dinner.propose(state,profiles,"another-home",NOW,"2026-09-06",source="player")


def test_actual_cook_eat_wash_chain_and_duplicate_effects_are_safe():
    engine, state, profiles = world()
    meal = dinner.propose(state,profiles,"shared",NOW,"2026-09-06",source="player")
    assert dinner.hint(state,"a",NOW) == "prepare_food"
    assert dinner.hint(state,"b",NOW) == "rest_alone"
    finish(engine,state,profiles,"a","prepare_food","cook")
    assert meal["phase"] == "served"
    assert len(meal["portion_ids"]) == 2
    assert dinner.hint(state,"b",NOW) == "eat"
    finish(engine,state,profiles,"a","prepare_food","cook")
    assert len([item for item in state["household_food"] if item.get("dinner_id")==meal["id"]]) == 2
    for key in profiles:
        finish(engine,state,profiles,key,"eat","eat-"+key)
    dinner.advance(state,profiles,NOW)
    assert meal["phase"] == "cleanup" and meal["cleaner_id"] == "a"
    assert public_home_life(state,"shared")["dirty_dishes_count"] == 2
    assert dinner.hint(state,"a",NOW) == "clean_shared_space"
    finish(engine,state,profiles,"a","clean_shared_space","wash")
    assert meal["phase"] == "completed" and meal["cleanup_by"] == "a"
    snapshot = deepcopy(dinner.public_dinner(state,"shared"))
    finish(engine,state,profiles,"a","clean_shared_space","wash")
    assert dinner.public_dinner(state,"shared") == snapshot
    assert snapshot["remaining_portions"] == snapshot["dirty_dishes"] == 0
    assert snapshot["eaten_ids"] == ["a","b"]
    assert "runtime" not in str(snapshot) and "needs" not in snapshot


def test_no_volunteer_leaves_real_dishes_and_suggestion_can_be_declined():
    engine, state, profiles = world()
    profiles["a"]["personality"] = profiles["b"]["personality"] = ["messy"]
    meal = dinner.propose(state,profiles,"shared",NOW,"2026-09-06",source="player")
    finish(engine,state,profiles,"a","prepare_food","cook")
    for key in profiles:
        finish(engine,state,profiles,key,"eat","eat-"+key)
    dinner.advance(state,profiles,NOW)
    assert meal["phase"] == "cleanup" and meal["cleaner_id"] is None
    dinner.request_cleanup(state,profiles,"shared",NOW)
    assert meal["cleaner_id"] is None
    baseline = deepcopy(meal)
    dinner.request_cleanup(state,profiles,"shared",NOW)
    assert meal == baseline
    dinner.advance(state,profiles,NOW+timedelta(hours=1))
    assert meal["phase"] == "left_for_later"
    assert dinner.public_dinner(state,"shared")["dirty_dishes"] == 2


def test_cook_cancelled_or_missed_deadline_is_not_fake_success():
    _, state, profiles = world()
    meal = dinner.propose(state,profiles,"shared",NOW,"2026-09-06",source="player")
    dinner.advance(state,profiles,NOW+timedelta(hours=3))
    assert meal["phase"] == "cancelled" and not meal["eaten_ids"]
    assert dinner.hint(state,"a",NOW+timedelta(hours=3)) is None


def test_normal_engine_completes_an_accepted_meal_without_player_clicks():
    engine, state, profiles = world()
    dinner.propose(state,profiles,"shared",NOW,"2026-09-06",source="player")
    result = engine.advance(state,profiles,now=NOW+timedelta(hours=3))
    meal = dinner.public_dinner(result,"shared")
    assert meal["phase"] in {"completed","left_for_later"}, meal
    assert len(meal["eaten_ids"]) == 2, meal
    assert any(item["id"]=="served" for item in meal["events"])


def test_no_inventory_and_no_available_cook_cancel_cleanly():
    _, state, profiles = world()
    for resource in state["resources"]:
        if resource["kind"] == "kitchen":
            resource["state"]["stock"] = 0
    assert dinner.propose(state,profiles,"shared",NOW,"2026-09-06",source="player")["phase"] == "cancelled"


def test_busy_leisure_wraps_up_voluntarily_without_partial_action_rewards():
    engine, state, profiles = world()
    for resident in state["residents"].values():
        resident["current_action"].update(action_type="read",status="performing",started_at=NOW.isoformat(),ends_at=(NOW+timedelta(hours=1)).isoformat())
    old_id = state["residents"]["a"]["current_action"]["id"]
    dinner.propose(state,profiles,"shared",NOW,"2026-09-06",source="player")
    before = engine.advance(state,profiles,now=NOW+timedelta(seconds=30))
    assert before["residents"]["a"]["current_action"]["id"] == old_id
    result = engine.advance(before,profiles,now=NOW+timedelta(minutes=15))
    meal = dinner.public_dinner(result,"shared")
    assert meal["phase"] == "completed", meal
    assert len(meal["eaten_ids"]) == 2
    assert old_id not in result["processed_action_effect_ids"]
    assert not any(item.get("kind")=="relationship_reward" for item in meal["events"])


def test_online_and_offline_dinner_result_agree():
    engine, state, profiles = world()
    dinner.propose(state,profiles,"shared",NOW,"2026-09-06",source="player")
    offline = engine.advance(state,profiles,now=NOW+timedelta(minutes=20))
    online = state
    for minute in range(1,21):
        online = engine.advance(online,profiles,now=NOW+timedelta(minutes=minute))
    assert dinner.public_dinner(online,"shared") == dinner.public_dinner(offline,"shared")


def test_dinner_api_is_scoped_persistent_and_repeat_safe(tmp_path):
    from test_life_api import _client, _auth
    client = _client(tmp_path)
    headers, user = _auth(client,"dinner-api-owner")
    city = client.get('/api/v1/city',headers=headers).json()
    household_id = city['households'][0]['id']
    url = f'/api/v1/households/{household_id}/dinner'
    assert client.post(url,json={"action":"propose"}).status_code == 401
    result = client.post(url,headers=headers,json={"action":"propose"})
    assert result.status_code == 200, result.text
    original = result.json()['dinner']
    retry = client.post(url,headers=headers,json={"action":"propose"})
    assert retry.json()['dinner']['id'] == original['id']
    stored = client.get(f'/api/v1/households/{household_id}',headers=headers).json()
    assert stored['life']['dinner']['id'] == original['id']
    login = client.post('/api/v1/auth/login',json={"username":"dinner-api-owner","password":"test-password"}).json()
    second = {"Authorization":"Bearer " + login['session_token']}
    assert client.get(f'/api/v1/households/{household_id}',headers=second).json()['life']['dinner']['id'] == original['id']
    outsider, _ = _auth(client,"dinner-api-outsider")
    assert client.post(url,headers=outsider,json={"action":"propose"}).status_code == 404
    assert client.post(url,headers=headers,json={"action":"force_success"}).status_code == 422


def test_leisure_switch_does_not_override_a_work_commitment():
    engine, state, profiles = world()
    for resident in state['residents'].values():
        resident['current_action'].update(action_type='practice_hobby',status='performing',started_at=NOW.isoformat(),ends_at=(NOW+timedelta(hours=1)).isoformat())
    dinner.propose(state,profiles,'shared',NOW,'2026-09-06',source='player')
    original = state['residents']['a']['current_action']['id']
    # Exercise the selector's real work-protection branch with a fixed block.
    engine._active_plan_block = lambda resident, now: {'kind':'work','location_id':'home-1','id':'work-test','starts_at':NOW.isoformat(),'ends_at':(NOW+timedelta(hours=1)).isoformat()}
    result = engine.advance(state,profiles,now=NOW+timedelta(minutes=2))
    assert result['residents']['a']['current_action']['id'] == original
