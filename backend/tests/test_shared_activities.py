from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
from types import SimpleNamespace

import pytest

from lingolife import shared_activities as activities
from lingolife.life import LifeAction
from lingolife.life_service import LifeWorldService
from lingolife.life_expression import roles_for, story_revision
from lingolife.life_world import _collision_from_dict, _resolution_from_dict
from test_life_world import _world, NOW


def ready_world():
    engine, profiles, state = _world()
    for resident in state['residents'].values():
        resident['runtime']['needs'].update({key: 75 for key in resident['runtime']['needs']})
        resident['runtime']['emotion'].update(stress=20, energy=80)
    return engine, profiles, state


def first(state):
    return next(iter(state['shared_activities'].values()))


def collision(state, identity='another'):
    return SimpleNamespace(id=identity, topic='companionship', participant_ids=('alex', 'emma'),
                           location_id='household-shared:living-room:living-tv-a', facts={})


def test_invitation_is_a_real_persisted_commitment_not_completion():
    _, _, state = ready_world()
    item = first(state)
    assert item['phase'] == 'forming' and not item['completed_ids']
    assert not item['actions']
    assert activities.hint(state, 'alex', NOW) == item
    assert not activities.ready_to_switch(state, 'alex', NOW)
    assert activities.ready_to_switch(state, 'alex', NOW+timedelta(seconds=45))


@pytest.mark.parametrize('kind', ['reading', 'lesson', 'practice', 'drink_break'])
def test_actual_action_chain_completes_each_kind_and_rewards_only_once(kind):
    engine, profiles, state = ready_world()
    first(state)['kind'] = kind
    running = engine.advance(state, profiles, NOW+timedelta(minutes=1))
    item = first(running)
    assert item['phase'] == 'active'
    for key, resident in running['residents'].items():
        action = resident['current_action']
        assert action['id'] == item['assigned_actions'][key]
        assert action['action_type'] == activities.KINDS[kind][2]
        assert action['location_id'] == item['location_id']
        assert action['duration_seconds'] == 240
        assert sum(action['need_deltas'].values()) < 10
    finished = engine.advance(running, profiles, NOW+timedelta(minutes=6))
    assert first(finished)['phase'] == 'completed'
    assert set(first(finished)['completed_ids']) == set(profiles)
    assert any('shared_activity_completed' in memory['outcome_tags']
               for pair in finished['pair_memory']['pairs'].values() for memory in pair['episodes'])
    assert all(len(resident['shared_activity_history']) == 1 for resident in finished['residents'].values())
    assert engine.advance(finished, profiles, NOW+timedelta(minutes=6)) == finished


def test_online_and_offline_reach_identical_activity_and_actions():
    engine, profiles, state = ready_world()
    offline = engine.advance(state, profiles, NOW+timedelta(minutes=8))
    online = deepcopy(state)
    for seconds in range(15, 481, 15):
        online = engine.advance(online, profiles, NOW+timedelta(seconds=seconds))
    assert online['shared_activities'] == offline['shared_activities']
    assert online['residents'] == offline['residents']
    assert online['relationship_evidence'] == offline['relationship_evidence']


def test_urgent_needs_are_not_overridden_to_make_a_scene_succeed():
    engine, profiles, state = _world()  # critically low social/love needs
    ended = engine.advance(state, profiles, NOW+timedelta(minutes=46))
    assert first(ended)['phase'] == 'missed'
    assert not first(ended)['actions']


@pytest.mark.parametrize('status', ['interrupted', 'abandoned'])
def test_interruption_never_awards_shared_completion(status):
    engine, profiles, state = ready_world()
    state = engine.advance(state, profiles, NOW+timedelta(minutes=1))
    state['residents']['emma']['current_action']['status'] = status
    activities.advance(state, NOW+timedelta(minutes=2))
    assert first(state)['phase'] == 'interrupted'
    assert not first(state)['completed_ids']


def test_missing_resident_and_elapsed_time_do_not_manufacture_success():
    _, _, state = ready_world()
    del state['residents']['emma']
    activities.advance(state, NOW+timedelta(seconds=10))
    assert first(state)['phase'] == 'interrupted'
    activities.advance(state, NOW+timedelta(hours=2))
    assert first(state)['phase'] == 'interrupted'


def test_non_overlapping_actions_are_not_a_shared_session():
    _, _, state = ready_world()
    item = first(state)
    for index, key in enumerate(item['participants']):
        start = NOW+timedelta(minutes=index*10)
        item['assigned_actions'][key] = key
        item['actions'][key] = {'id': key, 'start': start.isoformat(), 'end': None}
        action = replace(LifeAction.from_dict(state['residents'][key]['current_action']), id=key)
        activities.completed(state, key, action, start+timedelta(minutes=4))
    assert item['phase'] == 'missed'


def test_refusal_extends_pair_cooldown_and_quiet_company_is_not_lesson_consent():
    _, profiles, state = ready_world()
    item = first(state)
    item.update(phase='invited', kind='lesson')
    fact = collision(state)
    fact.facts = activities.facts(item)
    activities.settled(state, fact, SimpleNamespace(response_by_participant={'alex': 'share_activity', 'emma': 'enjoy_silence'}), NOW)
    assert item['phase'] == 'declined'
    assert activities.offer(state, collision(state), profiles, NOW+timedelta(hours=9)) is None
    assert activities.offer(state, collision(state), profiles, NOW+timedelta(hours=25)) is not None


def test_give_space_is_not_overridden_by_an_earlier_agreement():
    _, _, state = ready_world()
    item = first(state)
    item['phase'] = 'invited'
    fact = collision(state)
    fact.facts = activities.facts(item)
    activities.settled(state, fact, SimpleNamespace(
        response_by_participant={'alex': 'share_activity', 'emma': 'welcome_company'},
        action_instructions={'action-a': 'wait'}), NOW)
    assert item['phase'] == 'missed'
    assert not activities.hint(state, 'alex', NOW)


def test_persona_and_recent_history_drive_variety_without_invented_interests():
    _, profiles, state = ready_world()
    assert activities.offer(state, collision(state), profiles, NOW) is None
    activities.set_phase(state, first(state), 'completed', NOW)
    second = activities.offer(state, collision(state), profiles, NOW+timedelta(hours=9))
    assert second['kind'] != first(state)['kind']
    activities.set_phase(state, second, 'completed', NOW+timedelta(hours=9))
    third = activities.offer(state, collision(state, 'third'), profiles, NOW+timedelta(hours=18))
    assert len({item['kind'] for item in state['shared_activities'].values()}) == 3
    assert third['subject'] in profiles['alex']['interests']+profiles['emma']['interests']
    state['shared_activities'] = {}
    assert activities.offer(state, collision(state), {}, NOW) is None
    fact = collision(state)
    fact.location_id = 'household-shared:private-room-01:bed'
    assert activities.offer(state, fact, profiles, NOW) is None
    fact.location_id = 'city_library'
    assert activities.offer(state, fact, profiles, NOW) is None


def test_story_and_ai_revision_follow_real_phase_and_not_old_invitation():
    engine, profiles, state = ready_world()
    service = LifeWorldService(None)
    before = service._story_views(state, profiles, now=NOW)[0]
    state = engine.advance(state, profiles, NOW+timedelta(minutes=6))
    after = next(value for value in service._story_views(state, profiles, now=NOW+timedelta(minutes=6)) if value['id'] == before['id'])
    assert '等手上的事' in before['aftermath_zh']
    assert '各自完成' in after['aftermath_zh']
    assert story_revision(before) != story_revision(after)
    record = state['stories'][before['id']]
    assert record['collision']['facts']['activity_phase'] == 'completed'
    assert roles_for(['alex', 'emma'], {'activity_kind': 'lesson', 'teacher_id': 'alex'}) == {'alex': 'teacher', 'emma': 'learner'}


def test_concrete_observable_description_only_for_assigned_performing_action():
    engine, profiles, state = ready_world()
    state = engine.advance(state, profiles, NOW+timedelta(minutes=1))
    observable = {'visible_intent': 'old', 'visible_context': {'visibility': 'public'}}
    action = LifeAction.from_dict(state['residents']['alex']['current_action'])
    activities.annotate_observable(state, 'alex', action, observable, 'Emma')
    assert 'Emma' in observable['visible_intent_zh'] and '音乐' in observable['visible_intent_zh']
    unchanged = {'visible_intent': 'old', 'visible_context': {'visibility': 'private'}}
    activities.annotate_observable(state, 'alex', action, unchanged, 'Emma')
    assert unchanged['visible_intent'] == 'old'
    unchanged['visible_context']['visibility'] = 'public'
    activities.annotate_observable(state, 'alex', replace(action, id='unrelated'), unchanged, 'Emma')
    assert unchanged['visible_intent'] == 'old'


def test_drink_offer_requires_real_preference_and_public_lounge():
    _, _, state = ready_world()
    state['shared_activities'] = {}
    profiles = {'alex': {'interests': ['喝茶']}, 'emma': {'interests': ['books']}}
    # Other interests remain valid choices; make this unused activity preferred.
    for i, kind in enumerate(('lesson', 'reading')):
        state['shared_activities'][str(i)] = {'id': str(i), 'kind': kind, 'phase': 'completed',
            'participants': ['other-a', 'other-b'], 'subject': 'books',
            'created_at': (NOW-timedelta(days=2)).isoformat()}
    item = activities.offer(state, collision(state), profiles, NOW)
    assert item['kind'] == 'drink_break' and item['subject'] == 'tea'
    assert activities.staging(item)['phase'] == 'invited'
    assert '参与' not in activities.public(item)['summary_zh']
    assert activities.preferred_drink(['first-aid teaching', 'notebook']) is None
    assert activities.preferred_drink(['不喜欢咖啡', 'avoid tea']) is None
    assert activities.preferred_drink(['coffee tasting']) == 'coffee'


def test_drink_staging_and_summary_follow_actual_completion_or_refusal():
    engine, profiles, state = ready_world()
    first(state).update(kind='drink_break', subject='tea')
    running = engine.advance(state, profiles, NOW+timedelta(minutes=1))
    assert first(running)['phase'] == 'active'
    action = LifeAction.from_dict(running['residents']['alex']['current_action'])
    observable = {'visible_context': {'visibility': 'public'}}
    activities.annotate_observable(running, 'alex', action, observable, 'Emma')
    assert observable['visible_context']['activity_kind'] == 'drink_break'
    assert observable['visible_context']['activity_id'] == first(running)['id']
    assert observable['visible_context']['activity_phase'] == 'active'
    assert observable['visible_context']['activity_beverage'] == 'tea'
    assert observable['visible_context']['activity_participant_ids'] == first(running)['participants']
    assert observable['visible_context']['activity_initiator_id'] == first(running)['participants'][0]
    assert '喝点东西' in observable['visible_intent_zh']
    service = LifeWorldService(None)
    view = next(s for s in service._story_views(running, profiles, now=NOW+timedelta(minutes=1))
                if s.get('presentation', {}).get('staging'))
    assert view['presentation']['staging']['phase'] == 'active'
    finished = engine.advance(running, profiles, NOW+timedelta(minutes=6))
    assert first(finished)['phase'] == 'completed'
    assert '练习' not in activities.public(first(finished))['summary_zh']
    first(state)['phase'] = 'declined'
    assert activities.staging(first(state))['phase'] == 'declined'
    assert '没约成' in activities.public(first(state))['summary_zh']


@pytest.mark.parametrize('severity,visible', [(15, False), (85, True)])
def test_repeat_budget_hides_routine_cards_but_not_escalations_and_still_settles(monkeypatch, severity, visible):
    engine, profiles, state = ready_world()
    previous = next(record for record in state['stories'].values() if record.get('collision'))
    now = NOW+timedelta(minutes=31)
    fact = replace(_collision_from_dict(previous['collision']), id='repeat-collision', severity=severity, occurred_at=now)
    resolution = replace(_resolution_from_dict(previous['resolution']), id='repeat-resolution',
                         collision_id=fact.id, severity_after=severity, settled_at=now)
    monkeypatch.setattr(engine.collisions, 'detect', lambda *args, **kwargs: (fact,))
    monkeypatch.setattr(engine.collisions, 'resolve', lambda *args, **kwargs: resolution)
    engine._detect_and_record(state, profiles, 'window', now)
    record = next(row for row in state['stories'].values() if row.get('collision', {}) and row['collision']['id'] == fact.id)
    assert record['story']['observable'] is visible
    assert fact.id in state['processed_collision_ids']
    if not visible:
        before = len(state['relationship_evidence'])
        engine._settle_due_stories(state, profiles, now+timedelta(minutes=10))
        assert record['story']['status'] == 'resolved_autonomously'
        assert len(state['relationship_evidence']) > before
