"""Cafe drinking is a real, voluntary indoor activity, not map decoration."""
from copy import deepcopy
from datetime import timedelta
from types import SimpleNamespace

import pytest

from lingolife import shared_activities as activities
from lingolife.life import LifeAction
from lingolife.life_expression import SYSTEM_PROMPT
from lingolife.life_service import LifeWorldService
from lingolife.spatial_presence import spatial_presence
from test_life_world import NOW
from test_shared_activities import ready_world


def cafe_world(location='moonlight_cafe'):
    engine, profiles, state = ready_world()
    state['shared_activities'] = {}
    for key, resident in state['residents'].items():
        profiles[key]['interests'] = ['tea']
        resident['current_location_id'] = location
        resident['current_journey'] = None
        resident['current_action'].update(location_id=location, status='performing',
                                          action_type='talk_to_resident', interruptible=True)
    event = SimpleNamespace(id='cafe-drink-collision', topic='companionship',
                            participant_ids=('alex', 'emma'), location_id=location, facts={})
    return engine, profiles, state, event


def accept(state, item, event):
    event.facts = activities.facts(item)
    activities.settled(state, event, SimpleNamespace(response_by_participant={
        'alex': 'share_activity', 'emma': 'welcome_company'}), NOW)


def test_real_cafe_collision_detector_publishes_drink_stage_without_a_fixture_stage():
    engine, profiles, state, _ = cafe_world()
    state['processed_collision_ids'] = []
    state['active_collision_fact_ids'] = []
    state['collision_cooldowns'] = {}
    state['stories'] = {}
    engine._detect_and_record(state, profiles, 'cafe-public-contract', NOW)
    drinks = [item for item in state['shared_activities'].values() if item['kind'] == 'drink_break']
    assert drinks and drinks[0]['location_id'] == 'moonlight_cafe'
    stories = LifeWorldService(None)._story_views(state, profiles, now=NOW)
    scene = next(story for story in stories if story.get('presentation', {}).get('staging'))
    assert scene['location_id'] == 'moonlight_cafe'
    assert scene['presentation']['staging']['beverage'] == 'tea'
    assert scene['presentation']['staging']['phase'] in {'invited', 'forming', 'declined'}


@pytest.mark.parametrize('location', ['moonlight_cafe', 'garden_cafe'])
def test_cafe_real_actions_complete_and_remain_indoors(location):
    engine, profiles, state, event = cafe_world(location)
    item = activities.offer(state, event, profiles, NOW)
    assert item['kind'] == 'drink_break' and item['phase'] == 'invited'
    assert not item['actions']
    accept(state, item, event)
    running = engine.advance(state, profiles, NOW + timedelta(minutes=1))
    active = running['shared_activities'][item['id']]
    assert active['phase'] == 'active'
    for key in item['participants']:
        resident = running['residents'][key]
        assert resident['current_action']['id'] == active['assigned_actions'][key]
        assert resident['current_action']['location_id'] == location
        assert resident['current_action']['duration_seconds'] == 240
        presence = spatial_presence(current_location_id=resident['current_location_id'],
            target_location_id=location, status=resident['current_action']['status'],
            home_location_id=resident['home_location_id'], household_id=resident['household_id'])
        assert presence['mode'] == 'indoor' and presence['building_id'] == location
    finished = engine.advance(running, profiles, NOW + timedelta(minutes=6))
    assert finished['shared_activities'][item['id']]['phase'] == 'completed'
    assert len(finished['shared_activities'][item['id']]['completed_ids']) == 2
    assert engine.advance(finished, profiles, NOW + timedelta(minutes=6)) == finished


@pytest.mark.parametrize('change', ['other_cafe', 'traveling', 'working', 'eating', 'private', 'no_interest', 'not_companionship'])
def test_cafe_cannot_invent_copresence_or_interrupt_an_unrelated_activity(change):
    _, profiles, state, event = cafe_world()
    resident = state['residents']['emma']
    if change == 'other_cafe':
        resident['current_location_id'] = 'garden_cafe'
    elif change == 'traveling':
        resident['current_action']['status'] = 'traveling'
    elif change in {'working', 'eating'}:
        resident['current_action']['action_type'] = 'work' if change == 'working' else 'eat'
    elif change == 'private':
        event.location_id = 'household-shared:private-room-01:bed'
    elif change == 'no_interest':
        for profile in profiles.values():
            profile['interests'] = ['books']
    else:
        event.topic = 'meal_preparation'
    assert activities.offer(state, event, profiles, NOW) is None


def test_cafe_refusal_and_departure_are_final_without_fabricated_completion():
    engine, profiles, state, event = cafe_world()
    item = activities.offer(state, event, profiles, NOW)
    event.facts = activities.facts(item)
    activities.settled(state, event, SimpleNamespace(response_by_participant={
        'alex': 'share_activity', 'emma': 'decline_company'}), NOW)
    assert item['phase'] == 'declined'
    snapshot = deepcopy(item)
    accept(state, item, event)
    assert item == snapshot

    engine, profiles, state, event = cafe_world()
    item = activities.offer(state, event, profiles, NOW)
    accept(state, item, event)
    running = engine.advance(state, profiles, NOW + timedelta(minutes=1))
    active = running['shared_activities'][item['id']]
    actions = {key: LifeAction.from_dict(running['residents'][key]['current_action']) for key in item['participants']}
    running['residents']['emma']['current_location_id'] = 'garden_cafe'
    activities.advance(running, NOW + timedelta(minutes=2))
    assert active['phase'] == 'interrupted'
    for key, action in actions.items():
        activities.completed(running, key, action, NOW + timedelta(minutes=6))
    assert active['phase'] == 'interrupted' and not active['completed_ids']


def test_cafe_story_retains_its_actual_location_when_residents_later_move_home():
    _, profiles, state, event = cafe_world()
    item = activities.offer(state, event, profiles, NOW)
    record = next(value for value in state['stories'].values() if value.get('collision'))
    record['collision'].update(id=event.id, location_id=event.location_id, facts=activities.facts(item))
    record['story']['location_id'] = event.location_id
    activities.set_phase(state, item, 'completed', NOW)
    service = LifeWorldService(None)
    before = next(value for value in service._story_views(state, profiles, now=NOW)
                  if value['id'] == record['story']['id'])
    for resident in state['residents'].values():
        resident['current_location_id'] = resident['home_location_id']
    after = next(value for value in service._story_views(state, profiles, now=NOW)
                 if value['id'] == record['story']['id'])
    assert before['location_id'] == after['location_id'] == event.location_id
    assert before['presentation']['staging'] == after['presentation']['staging']
    assert after['presentation']['staging']['phase'] == 'completed'
    assert '在咖啡馆不能说回家坐沙发' in SYSTEM_PROMPT
