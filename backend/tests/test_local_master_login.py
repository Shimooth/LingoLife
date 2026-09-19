import pytest
from fastapi.testclient import TestClient
from lingolife.app import create_app
from lingolife.config import Settings, load_settings
from lingolife.db import Database
from test_api import Stub


def test_master_configuration_is_opt_in(monkeypatch):
    monkeypatch.setenv('LINGOLIFE_LOCAL_MASTER_PASSWORD_HASH', 'test-hash')
    monkeypatch.delenv('LINGOLIFE_ENV', raising=False)
    assert load_settings().local_master_password_hash is None
    monkeypatch.setenv('LINGOLIFE_ENV', 'production')
    assert load_settings().local_master_password_hash is None
    monkeypatch.setenv('LINGOLIFE_ENV', 'development')
    assert load_settings().local_master_password_hash == 'test-hash'
    assert 'test-hash' not in repr(load_settings())


@pytest.mark.parametrize('host,peer,headers,enabled,expected', [
    ('localhost', '127.0.0.1', {}, True, 200),
    ('127.0.0.1', '127.0.0.1', {}, True, 200),
    ('localhost', '127.0.0.1', {}, False, 401),
    ('lingolife.shimooth.me', '127.0.0.1', {}, True, 401),
    ('localhost', '192.0.2.10', {}, True, 401),
    ('localhost', '127.0.0.1', {'x-forwarded-for': '127.0.0.1'}, True, 401),
])
def test_master_login_is_local_only(tmp_path, host, peer, headers, enabled, expected):
    settings = Settings(database_url=f'sqlite:///{tmp_path / "auth.db"}', local_master_password_hash=Database.password_hash('local-test-master') if enabled else None)
    app = create_app(settings, Stub())
    c = TestClient(app, base_url=f'http://{host}', client=(peer, 50000))
    db = app.state.db
    code = db.create_invites(1, 30)[0]
    user, _ = db.register('new-resident', code, 'own-password')
    original = db.user_by_id(user['id'])['password_hash']
    response = c.post('/api/v1/auth/login', headers=headers, json={'username': 'new-resident', 'password': 'local-test-master'})
    assert response.status_code == expected
    assert db.user_by_id(user['id'])['password_hash'] == original
    assert c.post('/api/v1/auth/login', json={'username': 'new-resident', 'password': 'own-password'}).status_code == 200
    assert c.post('/api/v1/auth/login', json={'username': 'missing-user', 'password': 'local-test-master'}).status_code == 401
    with db._connection:
        db._connection.execute('UPDATE users SET disabled=1 WHERE id=?', (user['id'],))
    assert c.post('/api/v1/auth/login', headers=headers, json={'username': 'new-resident', 'password': 'local-test-master'}).status_code != 200
