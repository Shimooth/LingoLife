from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import threading

import pytest

from lingolife import pair_memory as memory
from lingolife.config import Settings
from lingolife.db import Database
from lingolife.pair_memory_service import PairMemoryService

NOW = datetime(2026, 9, 19, tzinfo=timezone.utc)


def world():
    return {'residents': {'a': {}, 'b': {}}, 'relationships': {'ab': {
        'a_to_b': {'owner_id': 'a', 'target_id': 'b', 'trust': 80, 'tension': 12},
        'b_to_a': {'owner_id': 'b', 'target_id': 'a', 'trust': 30, 'tension': 70},
    }}, 'stories': {}, 'initialized_at': NOW.isoformat(), 'last_advanced_at': NOW.isoformat(),
            'rules_version': 'test', 'revision': 1, 'next_transition_at': None}


def add(state, identity='event', at=NOW, topic='borrowed_property', severity=30):
    collision = {'id': identity, 'topic': topic, 'severity': severity,
                 'facts': {'item_label': 'a mug', 'secret_thought': 'NEVER_SEND'}}
    seeds = [{'npc_id': a, 'other_npc_id': b, 'response_id': 'state_borrowing_rule', 'response_style': 'boundaried'}
             for a, b in [('a', 'b'), ('b', 'a')]]
    resolution = {'outcome_tags': ['conflict'], 'memory_seeds': seeds}
    memory.capture(state, collision, resolution, seeds, at)
    memory.maintain(state, at)
    return collision, resolution


def episodes(state, owner='a'):
    return next(pair['episodes'] for pair in state['pair_memory']['pairs'].values() if pair['owner_id'] == owner)


def test_subjective_selection_without_player_click_or_rewriting_relationship():
    state = world()
    add(state)
    original = deepcopy(state['relationships'])
    memory.apply_decisions(state, {episodes(state)[0]['id']: 'lasting', episodes(state, 'b')[0]['id']: 'discard'}, NOW, 'ai')
    assert episodes(state)[0]['retention'] == 'lasting'
    assert not episodes(state, 'b')
    assert state['relationships'] == original
    assert memory.recall(state, 'a')[0]['impression']['trust'] == 'high'
    assert memory.recall(state, 'b')[0]['impression']['trust'] == 'low'
    add(state)  # a read receipt / replay cannot revive the discarded memory
    assert not episodes(state, 'b')


def test_aging_removes_detail_then_small_events_but_retains_impression():
    state = world()
    add(state)
    assert episodes(state)[0]['details'] == {'item_label': 'a mug'}
    memory.maintain(state, NOW + timedelta(days=4))
    assert episodes(state)[0]['recall'] == 'fading'
    assert 'details' not in episodes(state)[0] and 'response_id' not in episodes(state)[0]
    assert not memory.decision_context(state, 'a')
    memory.maintain(state, NOW + timedelta(days=15))
    assert not episodes(state)
    assert memory.recall(state, 'a', now=NOW+timedelta(days=15))[0]['impression']


def test_landmark_becomes_gist_and_daily_reading_does_not_refresh_it():
    state = world()
    add(state)
    memory.apply_decisions(state, {episodes(state)[0]['id']: 'lasting'}, NOW, 'ai')
    baseline = deepcopy(state)
    for days in range(1, 40):
        memory.recall(state, 'a', now=NOW+timedelta(days=days))
    assert state == baseline
    memory.maintain(state, NOW+timedelta(days=40))
    assert episodes(state)[0]['recall'] == 'gist'
    assert 'details' not in episodes(state)[0] and 'severity' not in episodes(state)[0]


def test_offline_high_impact_event_survives_before_first_ai_review():
    state = world()
    add(state, severity=85)
    memory.maintain(state, NOW+timedelta(days=40))
    assert episodes(state)[0]['retention'] == 'lasting'
    assert episodes(state)[0]['recall'] == 'gist'
    assert episodes(state)[0]['selection_source'] == 'rules_pending'


def test_explicit_relationship_milestone_is_not_lost_or_reinvented():
    state = world()
    state['relationships']['ab']['channels'] = {'romance': 'dating', 'friendship': 'close', 'conflict': 'none'}
    state['aftermath'] = [{'kind': 'relationship_transition', 'story_id': 'romance',
                          'state': 'dating', 'participant_ids': ['a', 'b'], 'occurred_at': NOW.isoformat()}]
    memory.maintain(state, NOW)
    assert episodes(state)[0]['outcome_tags'] == ['dating']
    assert memory.recall(state, 'a')[0]['impression']['acknowledged_romance'] == 'dating'
    memory.apply_decisions(state, {episodes(state)[0]['id']: 'discard'}, NOW, 'ai')
    memory.maintain(state, NOW+timedelta(hours=1))
    assert not episodes(state)
    assert state['relationships']['ab']['channels']['romance'] == 'dating'


def test_continuous_and_offline_compression_match_without_new_events():
    online = world()
    add(online)
    offline = deepcopy(online)
    for hour in range(1, 400):
        memory.maintain(online, NOW+timedelta(hours=hour))
    memory.maintain(offline, NOW+timedelta(hours=399))
    assert online == offline


def test_no_recall_of_current_event_future_event_or_other_owners_memory():
    state = world()
    add(state, 'first')
    add(state, 'second', NOW+timedelta(hours=1))
    assert not memory.recall(state, 'a', before=NOW, exclude_source='first')[0]['episodes']
    assert not memory.recall(state, 'not-a-resident')
    assert 'NEVER_SEND' not in str(memory.candidates(state, {}))


def test_migration_does_not_turn_ancient_events_into_fresh_memory_or_reimport():
    state = world()
    collision, resolution = add(state)
    state.pop('pair_memory')
    state['stories']['old'] = {'collision': collision, 'resolution': resolution,
                              'story': {'status': 'resolved_autonomously', 'updated_at': (NOW-timedelta(days=30)).isoformat()}}
    archive = deepcopy(state['stories'])
    memory.maintain(state, NOW)
    assert not episodes(state)
    memory.maintain(state, NOW+timedelta(hours=1))
    assert not episodes(state) and state['stories'] == archive


@pytest.mark.parametrize('script', [None, {}, {'decisions': []}, {'decisions': [{'id': 'injected', 'retention': 'lasting'}]},
    {'decisions': [{'id': 'ok', 'retention': 'lasting', 'story': 'invented'}]},
    {'decisions': [{'id': 'ok', 'retention': 'permanent'}]},
    {'decisions': [{'id': 'ok', 'retention': 'recent'}]*2}])
def test_ai_can_only_select_exact_existing_ids(script):
    with pytest.raises(ValueError):
        memory.validate_decisions(script, [{'id': 'ok'}])


def test_retention_is_bounded_and_removed_residents_do_not_leak():
    state = world()
    for i in range(80):
        add(state, str(i), NOW+timedelta(minutes=i), topic='topic'+str(i))
        memory.apply_decisions(state, {episodes(state)[-1]['id']: 'lasting'}, NOW+timedelta(minutes=i), 'ai')
    assert len(episodes(state)) <= memory.MAX_RECENT + memory.MAX_LANDMARKS
    del state['residents']['b']
    memory.maintain(state, NOW+timedelta(hours=2))
    assert not state['pair_memory']['pairs']


class Writer:
    calls = 0
    def author_pair_memory(self, contract):
        self.calls += 1
        return {'script': {'decisions': [{'id': entry['id'], 'retention': 'lasting' if entry['owner_id'] == 'a' else 'discard'}
                                          for entry in contract['candidates']]}, 'usage': {'total_tokens': 25}}


def service(tmp_path, provider=None, **settings):
    db = Database(f"sqlite:///{tmp_path / 'memory.db'}")
    state = world()
    add(state)
    def persist(player, updated, revision):
        return db.save_life_world_state(player, updated, rules_version='test', last_advanced_at=updated['last_advanced_at'],
                                        next_transition_at=None, expected_revision=revision)
    persist('p', state, 0)
    world_service = SimpleNamespace(db=db, _lock=threading.RLock(), _persist=persist)
    return PairMemoryService(world_service, provider or Writer(), Settings(**settings))


def test_background_selects_once_and_stays_out_of_dialogue_budget(tmp_path):
    worker = service(tmp_path)
    worker.process('p', {}, NOW)
    worker.process('p', {}, NOW+timedelta(minutes=1))
    assert worker.provider.calls == 1
    state = worker.db.get_life_world_state('p')
    assert episodes(state)[0]['selection_source'] == 'ai' and not episodes(state, 'b')
    owner, _ = worker.db.expression_claim('p', 'scene', 'scene', NOW.date().isoformat(), 0, 2, 2, {})
    assert owner  # one memory request did not consume a dialogue reservation


def test_budget_or_provider_failure_falls_back_and_never_retries_polling(tmp_path):
    worker = service(tmp_path, pair_memory_daily_limit=0)
    worker.process('p', {}, NOW)
    assert worker.provider.calls == 0
    state = worker.db.get_life_world_state('p')
    assert episodes(state)[0]['selection_source'] == 'rules'
    worker.process('p', {}, NOW+timedelta(minutes=1))
    assert worker.provider.calls == 0


def test_reset_during_ai_does_not_resurrect_old_memories(tmp_path):
    worker = service(tmp_path)
    def resetting(contract):
        current = worker.db.get_life_world_state('p')
        fresh = world()
        fresh['initialized_at'] = (NOW+timedelta(seconds=1)).isoformat()
        fresh['revision'] = current['revision'] + 1
        worker.world._persist('p', fresh, current['revision'])
        return Writer().author_pair_memory(contract)
    worker.provider.author_pair_memory = resetting
    worker.process('p', {}, NOW)
    assert 'pair_memory' not in worker.db.get_life_world_state('p')


def test_concurrent_world_progress_survives_ai_selection(tmp_path):
    worker = service(tmp_path)
    def progressing(contract):
        current = worker.db.get_life_world_state('p')
        changed = deepcopy(current)
        changed['residents']['a']['completed_work'] = True
        changed['revision'] += 1
        worker.world._persist('p', changed, current['revision'])
        return Writer().author_pair_memory(contract)
    worker.provider.author_pair_memory = progressing
    worker.process('p', {}, NOW)
    current = worker.db.get_life_world_state('p')
    assert current['residents']['a']['completed_work']
    assert episodes(current)[0]['retention'] == 'lasting'


def test_failed_ai_is_cached_without_network_retry(tmp_path):
    worker = service(tmp_path)
    calls = []
    def failing(contract):
        calls.append(contract)
        raise TimeoutError()
    worker.provider.author_pair_memory = failing
    worker.process('p', {}, NOW)
    worker.process('p', {}, NOW+timedelta(minutes=2))
    assert len(calls) == 1
    assert episodes(worker.db.get_life_world_state('p'))[0]['selection_source'] == 'rules'


def test_expression_receives_each_owners_recalled_memory(tmp_path):
    from test_life_expression import service as expression_service, scene
    expression, writer = expression_service(tmp_path)
    story, record, profiles = scene(('a', 'b'))
    state = world()
    add(state)
    memory.apply_decisions(state, {episodes(state, 'b')[0]['id']: 'discard'}, NOW, 'ai')
    memories = {owner: memory.recall(state, owner, now=NOW) for owner in ('a', 'b')}
    expression.scene('p', story, record, profiles, memories=memories)
    people = {item['id']: item for item in writer.contracts[0]['participants']}
    assert people['a']['owner_memory'][0]['episodes']
    assert not people['b']['owner_memory'][0]['episodes']
