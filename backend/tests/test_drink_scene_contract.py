"""Independent checks for the authored drink scene's engine/AI boundary."""
from copy import deepcopy
from datetime import timedelta
from types import SimpleNamespace

import pytest

from lingolife import shared_activities as activities
from lingolife.life import LifeAction
from lingolife.life_expression import SYSTEM_PROMPT, story_revision
from lingolife.life_service import LifeWorldService
from test_life_expression import Writer, service
from test_life_world import NOW
from test_shared_activities import collision, first, ready_world


def drink_world():
    engine, profiles, state = ready_world()
    item = first(state)
    item.update(kind='drink_break', subject='tea')
    activities.set_phase(state, item, 'invited', NOW)
    return engine, profiles, state


def drink_story(state, profiles, now=NOW):
    return next(story for story in LifeWorldService(None)._story_views(state, profiles, now=now)
                if story.get('presentation', {}).get('staging'))


@pytest.mark.parametrize('entry', [
    "I don't drink coffee", 'I don’t drink coffee', 'I cannot drink tea',
    'No coffee for me', 'not keen on tea', 'never drink coffee',
    'allergic to coffee', 'caffeine intolerance; tea', 'avoiding coffee',
    'I quit coffee', 'I dislike tea', 'no coffee, but tea is fine',
    '不爱喝咖啡', '对咖啡过敏', '戒咖啡', '不宜喝茶', '不想喝咖啡',
    '咖啡因不耐受，咖啡', '避免喝茶', '不要咖啡', '不能喝茶',
])
def test_drink_preferences_do_not_turn_negation_or_restrictions_into_permission(entry):
    assert activities.preferred_drink([entry]) is None


@pytest.mark.parametrize(('entry', 'expected'), [
    ('tea', 'tea'), ('coffee tasting', 'coffee'), ('afternoon tea', 'tea'),
    ('茶道', 'tea'), ('喜欢手冲咖啡', 'coffee'), ('喝茶', 'tea'),
    ('first-aid teaching', None), ('notebook', None), ('steak', None),
])
def test_drink_positive_interest_matching_preserves_word_boundaries(entry, expected):
    assert activities.preferred_drink([entry]) == expected


@pytest.mark.parametrize('phase', ['invited', 'forming', 'active', 'completed', 'declined', 'interrupted', 'missed'])
def test_drink_stage_and_expression_facts_are_exact_engine_phase(tmp_path, phase):
    _, profiles, state = drink_world()
    activities.set_phase(state, first(state), phase, NOW)
    story = drink_story(state, profiles)
    stage = story['presentation']['staging']
    assert stage == {'kind': 'shared_drink', 'phase': phase, 'beverage': 'tea',
                     'participant_ids': first(state)['participants'],
                     'initiator_id': first(state)['participants'][0]}
    expression, writer = service(tmp_path)
    snapshot = deepcopy(state)
    result = expression.scene('player-a', story, state['stories'][story['id']], profiles)
    assert result['presentation']['staging'] == stage
    assert writer.contracts[0]['facts']['activity_phase'] == phase
    assert writer.contracts[0]['facts']['activity_subject'] == 'tea'
    assert state == snapshot, 'writing or viewing dialogue must not settle/advance an activity'
    assert 'forming 只约好稍后' in SYSTEM_PROMPT
    assert '不得变成喝酒或假设对方也喜欢咖啡' in SYSTEM_PROMPT


def test_ai_cannot_supply_or_override_stage_metadata(tmp_path):
    class BadStageWriter(Writer):
        def author_expression(self, contract):
            result = super().author_expression(contract)
            result['script']['staging'] = {'kind': 'shared_drink', 'phase': 'completed', 'beverage': 'wine'}
            return result

    _, profiles, state = drink_world()
    story = drink_story(state, profiles)
    expression, _ = service(tmp_path, BadStageWriter())
    result = expression.scene('player-a', story, state['stories'][story['id']], profiles)
    assert result['source'] == 'fallback'
    assert result['presentation']['staging']['phase'] == 'invited'
    assert result['presentation']['staging']['beverage'] == 'tea'
    assert first(state)['phase'] == 'invited'


def test_drink_refusal_is_final_even_when_old_acceptance_is_replayed():
    _, _, state = drink_world()
    item = first(state)
    event = collision(state)
    event.facts = activities.facts(item)
    activities.settled(state, event, SimpleNamespace(response_by_participant={
        'alex': 'share_activity', 'emma': 'decline_company'}), NOW)
    assert item['phase'] == 'declined'
    snapshot = deepcopy(state)
    activities.settled(state, event, SimpleNamespace(response_by_participant={
        'alex': 'share_activity', 'emma': 'welcome_company'}), NOW+timedelta(minutes=1))
    activities.advance(state, NOW+timedelta(hours=1))
    assert state == snapshot
    assert activities.hint(state, 'alex', NOW+timedelta(minutes=2)) is None


def test_interrupted_drink_cannot_be_completed_by_late_old_action():
    engine, profiles, state = drink_world()
    activities.set_phase(state, first(state), 'forming', NOW)
    state = engine.advance(state, profiles, NOW+timedelta(minutes=1))
    item = first(state)
    assert item['phase'] == 'active'
    actions = {key: LifeAction.from_dict(state['residents'][key]['current_action']) for key in item['participants']}
    state['residents']['emma']['current_action']['status'] = 'interrupted'
    activities.advance(state, NOW+timedelta(minutes=2))
    assert item['phase'] == 'interrupted'
    snapshot = deepcopy(state)
    for key, action in actions.items():
        activities.completed(state, key, action, NOW+timedelta(minutes=6))
    assert state == snapshot


def test_drink_progress_invalidates_dialogue_cache_without_fabricating_completion():
    engine, profiles, state = drink_world()
    activities.set_phase(state, first(state), 'forming', NOW)
    before = drink_story(state, profiles)
    running = engine.advance(state, profiles, NOW+timedelta(minutes=1))
    active = drink_story(running, profiles, NOW+timedelta(minutes=1))
    finished = engine.advance(running, profiles, NOW+timedelta(minutes=6))
    after = drink_story(finished, profiles, NOW+timedelta(minutes=6))
    assert len({story_revision(story) for story in [before, active, after]}) == 3
    assert before['presentation']['staging']['phase'] == 'forming'
    assert active['presentation']['staging']['phase'] == 'active'
    assert after['presentation']['staging']['phase'] == 'completed'
    assert not first(state)['completed_ids']


def test_legacy_stories_without_shared_activity_storage_have_no_invented_drink_stage():
    _, profiles, state = ready_world()
    state.pop('shared_activities', None)
    for record in state['stories'].values():
        facts = (record.get('collision') or {}).get('facts') or {}
        for key in list(facts):
            if key.startswith('activity_') or key == 'teacher_id':
                facts.pop(key)
    stories = LifeWorldService(None)._story_views(state, profiles, now=NOW)
    assert stories
    assert all('staging' not in story['presentation'] for story in stories)
