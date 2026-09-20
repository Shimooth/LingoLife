"""The complete path, not just the read gate, must accept an undersized old save."""
import json

import pytest

from test_onboarding_and_layout_api import _client, _profile, _auth, _ack
from test_migration_audit import _legacy_rows, _attach_legacy_user


def legacy(client, count=1, completed=True):
    db = client.app.state.db
    player = _legacy_rows(db, count)
    _attach_legacy_user(db, player)
    if completed:
        db.refresh_onboarding(player, force_complete=True)
        with db._connection:
            raw = db._connection.execute('SELECT state_json FROM player_onboarding WHERE player_id=?', (player,)).fetchone()[0]
            state = json.loads(raw)
            state.pop('setup_status', None)  # exact pre-saga production shape
            db._connection.execute('UPDATE player_onboarding SET state_json=? WHERE player_id=?', (json.dumps(state), player))
    db.inventory_roster_migration(player)
    headers = {'Authorization': 'Bearer ' + db.create_session('legacy-user')}
    if not completed:
        _ack(client, headers)
    return db, player, headers


@pytest.mark.parametrize('count,completed', [(0, True), (1, True), (1, False)])
def test_legacy_resume_preserves_history_and_unlocks_world(tmp_path, count, completed):
    client = _client(tmp_path)
    db, player, headers = legacy(client, count, completed)
    before = {table: db._connection.execute(f'SELECT * FROM {table} WHERE player_id=?', (player,)).fetchall()
              for table in ('npc_profiles', 'messages', 'npc_memories')}
    state = client.get('/api/v1/onboarding', headers=headers).json()
    assert state['completed'] is False
    body = {'residents': [_profile('Aria'), _profile('Nora')], 'household_name': 'Cloudview House'}
    response = client.post('/api/v1/onboarding/complete', headers=headers, json=body)
    assert response.status_code == 201, response.text
    assert response.json()['onboarding']['completed'] is True
    assert len(response.json()['npcs']) == count + 2
    for table, rows in before.items():
        current = [tuple(row) for row in db._connection.execute(f'SELECT * FROM {table} WHERE player_id=?', (player,))]
        assert all(tuple(row) in current for row in rows)
    migration = db.roster_migration(player)
    assert migration['status'] == 'ready'
    assert len(migration['active_npc_ids']) == count + 2
    assert migration['review']['completed_via_onboarding']
    assert len(migration['baseline_snapshot']['preserved_npc_ids']) == count
    assert client.get('/api/v1/city', headers=headers).status_code == 200
    replay = client.post('/api/v1/onboarding/complete', headers=headers, json=body)
    assert replay.status_code == 201, replay.text
    assert len(replay.json()['npcs']) == count + 2
    assert db.roster_migration(player)['revision'] == migration['revision']
    reports = db.roster_migration_reports(player)
    assert sum(r['action'] == 'complete_onboarding' for r in reports) == 1


def test_world_failure_can_retry_without_creating_duplicate_residents(tmp_path, monkeypatch):
    client = _client(tmp_path)
    db, player, headers = legacy(client)
    body = {'residents': [_profile('Aria'), _profile('Nora')]}
    from lingolife.life_service import LifeWorldService
    original = LifeWorldService.city
    def unavailable(*args, **kwargs):
        raise RuntimeError('simulated interrupted initialization')
    monkeypatch.setattr(LifeWorldService, 'city', unavailable)
    with pytest.raises(RuntimeError, match='simulated interrupted'):
        client.post('/api/v1/onboarding/complete', headers=headers, json=body)
    assert len(db.list_npc_profiles(player)) == 3
    assert db.onboarding_state(player)['completed'] is False
    monkeypatch.setattr(LifeWorldService, 'city', original)
    retry = client.post('/api/v1/onboarding/complete', headers=headers, json=body)
    assert retry.status_code == 201, retry.text
    assert retry.json()['onboarding']['completed'] is True
    assert len(db.list_npc_profiles(player)) == 3


def test_administrator_blocked_roster_cannot_use_resume_to_bypass_review(tmp_path):
    client = _client(tmp_path)
    db, player, headers = legacy(client, count=10)
    result = client.post('/api/v1/onboarding/complete', headers=headers,
                         json={'residents': [_profile('Aria'), _profile('Nora')]})
    assert result.status_code == 409
    assert result.json()['error']['code'] == 'ROSTER_REVIEW_REQUIRED'
    assert len(db.list_npc_profiles(player)) == 10


def test_translation_backfilled_after_inventory_does_not_block_legacy_resume(tmp_path):
    client = _client(tmp_path)
    db, player, headers = legacy(client)
    with db._connection:
        db._connection.execute("UPDATE messages SET translation='补齐的旧消息翻译' WHERE player_id=?", (player,))
    result = client.post('/api/v1/onboarding/complete', headers=headers,
                         json={'residents': [_profile('Aria'), _profile('Nora')]})
    assert result.status_code == 201, result.text
    assert result.json()['onboarding']['completed'] is True
    assert db._connection.execute("SELECT translation FROM messages WHERE player_id=? AND npc_id='npc-1'", (player,)).fetchone()[0] == '补齐的旧消息翻译'
    assert client.get('/api/v1/city', headers=headers).status_code == 200
    raw = db._connection.execute('SELECT state_json FROM player_onboarding WHERE player_id=?', (player,)).fetchone()[0]
    assert 'legacy_resume_snapshot' not in json.loads(raw)


@pytest.mark.parametrize('custom', [False, True])
def test_relationships_are_optional_or_materialized_for_only_selected_pair(tmp_path, custom):
    client = _client(tmp_path)
    headers = _auth(client)
    _ack(client, headers)
    body = {'residents': [_profile('Aria'), _profile('Nora'), _profile('Charles')]}
    if custom:
        body['shared_history_hooks'] = [{'id': 'connection-test', 'participant_indices': [0, 1],
                                        'kind': 'personal_connection', 'summary': '老同学，经常一起打球。'}]
    response = client.post('/api/v1/onboarding/complete', headers=headers, json=body)
    assert response.status_code == 201, response.text
    profiles = response.json()['created']
    by_name = {item['profile']['name']: item for item in profiles}
    for name in ('Aria', 'Nora', 'Charles'):
        hooks = by_name[name]['profile']['shared_history_hooks']
        assert len(hooks) == (1 if custom and name != 'Charles' else 0)
        assert by_name[name]['profile']['familyRelations'] == []
    if custom:
        hook = by_name['Aria']['profile']['shared_history_hooks'][0]
        assert set(hook['participantIds']) == {by_name['Aria']['id'], by_name['Nora']['id']}
        assert hook['summary'] == '老同学，经常一起打球。'
