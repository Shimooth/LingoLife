from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import ast
import inspect
import json
import threading
import time
import textwrap

from fastapi.testclient import TestClient

from lingolife.app import DEFAULT_NPC_PROFILE, create_app
from lingolife.config import Settings
from lingolife.models import (
    AIResult,
    EnglishFeedback,
    LearningEvidence,
    MemoryCandidate,
)


class CountingProvider:
    def __init__(self, *, delay: float = 0.0, fail_first: bool = False):
        self.delay = delay
        self.fail_first = fail_first
        self.calls = 0
        self.active_calls = 0
        self.max_active_calls = 0
        self._lock = threading.Lock()

    def reply(self, message, stats, history, context, on_chunk=None):
        with self._lock:
            self.calls += 1
            call = self.calls
            self.active_calls += 1
            self.max_active_calls = max(self.max_active_calls, self.active_calls)
        try:
            if self.delay:
                time.sleep(self.delay)
            if self.fail_first and call == 1:
                raise RuntimeError("injected generation failure")
            if on_chunk:
                on_chunk("I remember that")
            return AIResult(
                npc_reply="I remember that, and I appreciate you checking in.",
                npc_reply_zh="我记得，也很感谢你来关心我。",
                english_feedback=EnglishFeedback(
                    is_understandable=True,
                    corrected_text=message,
                    tip="Natural follow-up.",
                    tags=[],
                ),
                semantic_signals=["empathy", "curiosity"],
                learning_evidence=[
                    LearningEvidence(target_id="intent.empathy", outcome="success"),
                ],
                memory_candidates=[
                    MemoryCandidate(
                        kind="player_fact",
                        content="The player checks in when I seem worried.",
                        tags=["care"],
                        importance=3,
                        confidence=.9,
                    ),
                ],
                agent_trace={"prompt_version": "journal-test-v1", "model": "stub"},
            )
        finally:
            with self._lock:
                self.active_calls -= 1


def _client(tmp_path, provider, *, life_v2: bool = False,
            raise_server_exceptions: bool = True) -> TestClient:
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'chat-journal.db'}",
        web_root=str(tmp_path / "missing-web"),
        life_simulation_v2=life_v2,
        chat_per_minute=20,
    )
    return TestClient(
        create_app(settings, provider),
        raise_server_exceptions=raise_server_exceptions,
    )


def _auth(client: TestClient, username: str = "journal-user") -> tuple[dict[str, str], dict]:
    invite = client.app.state.db.create_invites(1, 30)[0]
    registration = client.post(
        "/api/v1/auth/register",
        json={"username": username, "invite_code": invite, "password": "pw"},
    )
    assert registration.status_code == 201, registration.text
    token = registration.json()["session_token"]
    user = client.app.state.db.authenticate(token)
    assert user is not None
    client.app.state.db.get_or_create_npc_profile(
        user["player_id"], "emma", DEFAULT_NPC_PROFILE,
    )
    client.app.state.db.refresh_onboarding(user["player_id"], force_complete=True)
    return {"Authorization": f"Bearer {token}"}, user


def _count(db, sql: str, values: tuple = ()) -> int:
    return int(db._connection.execute(sql, values).fetchone()[0])


def test_stream_iterator_never_holds_player_rlock_across_yield():
    """Guard against AnyIO resuming a sync iterator on another worker thread."""
    tree = ast.parse(textwrap.dedent(inspect.getsource(create_app)))
    chat_stream = next(
        node for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef) and node.name == "chat_stream"
    )
    stream = next(
        node for node in chat_stream.body
        if isinstance(node, ast.FunctionDef) and node.name == "stream"
    )
    work = next(
        node for node in chat_stream.body
        if isinstance(node, ast.FunctionDef) and node.name == "work"
    )
    assert any(isinstance(node, ast.Yield) for node in ast.walk(stream))
    assert not any(isinstance(node, (ast.With, ast.AsyncWith)) for node in ast.walk(stream))
    assert any(isinstance(node, (ast.With, ast.AsyncWith)) for node in ast.walk(work))


def test_same_key_concurrency_generates_and_applies_exactly_once(tmp_path):
    provider = CountingProvider(delay=.15)
    client = _client(tmp_path, provider)
    auth, user = _auth(client)
    headers = {**auth, "Idempotency-Key": "concurrent-chat-001"}
    body = {"message": "You seem worried. What happened?", "npc_id": "emma"}

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(
            lambda _index: client.post("/api/v1/chat", headers=headers, json=body),
            range(2),
        ))

    assert [response.status_code for response in responses] == [200, 200]
    assert responses[0].json() == responses[1].json()
    assert provider.calls == 1
    db = client.app.state.db
    player_id = user["player_id"]
    assert len(db.messages(player_id, 20, "emma")) == 3
    assert db.get_learning_state(player_id).records["intent.empathy"].successes == 1
    assert _count(
        db,
        "SELECT count(*) FROM agent_turn_traces WHERE player_id=? AND request_id=?",
        (player_id, "concurrent-chat-001"),
    ) == 1
    assert _count(
        db,
        "SELECT count(*) FROM npc_memories WHERE player_id=? AND content=?",
        (player_id, "The player checks in when I seem worried."),
    ) == 1
    assert db.get_chat_turn(player_id, "concurrent-chat-001")["status"] == "completed"


def test_different_keys_for_one_player_are_serialized_without_lost_updates(tmp_path):
    provider = CountingProvider(delay=.12)
    client = _client(tmp_path, provider)
    auth, user = _auth(client, "journal-serial")
    body = {"message": "You seem worried. What happened?", "npc_id": "emma"}

    def send(key: str):
        return client.post(
            "/api/v1/chat",
            headers={**auth, "Idempotency-Key": key},
            json=body,
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(send, ("serial-chat-001", "serial-chat-002")))

    assert all(response.status_code == 200 for response in responses)
    assert provider.calls == 2
    assert provider.max_active_calls == 1
    # Both turns derive from the authoritative result of the prior one. A
    # last-write-wins race would leave relationship=38 and learning=1 here.
    assert sorted(response.json()["stats"]["relationship"] for response in responses) == [38, 41]
    db = client.app.state.db
    assert db.state(user["player_id"], "emma").relationship == 41
    assert db.get_learning_state(user["player_id"]).records["intent.empathy"].successes == 2


def test_stream_concurrency_keeps_protocol_and_effects_exactly_once(tmp_path):
    provider = CountingProvider(delay=.15)
    client = _client(tmp_path, provider)
    auth, user = _auth(client, "journal-stream")
    headers = {**auth, "Idempotency-Key": "concurrent-stream-001"}
    body = {"message": "Would you like to talk about it?", "npc_id": "emma"}

    def send(_index: int):
        response = client.post("/api/v1/chat/stream", headers=headers, json=body)
        return response, [json.loads(line) for line in response.text.splitlines()]

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(send, range(2)))

    assert all(response.status_code == 200 for response, _events in results)
    assert all(sum(event["type"] == "final" for event in events) == 1
               for _response, events in results)
    assert all(any(event["type"] == "delta" for event in events)
               for _response, events in results)
    finals = [next(event["data"] for event in events if event["type"] == "final")
              for _response, events in results]
    assert finals[0] == finals[1]
    assert provider.calls == 1
    db = client.app.state.db
    player_id = user["player_id"]
    assert db.get_learning_state(player_id).records["intent.empathy"].successes == 1
    assert _count(
        db,
        "SELECT count(*) FROM agent_turn_traces WHERE player_id=? AND request_id=?",
        (player_id, "concurrent-stream-001"),
    ) == 1


def test_key_reuse_with_different_message_or_npc_is_rejected(tmp_path):
    provider = CountingProvider()
    client = _client(tmp_path, provider)
    auth, _user = _auth(client, "journal-conflict")
    headers = {**auth, "Idempotency-Key": "immutable-command-001"}
    body = {"message": "How was your day?", "npc_id": "emma"}
    assert client.post("/api/v1/chat", headers=headers, json=body).status_code == 200

    changed_message = client.post(
        "/api/v1/chat", headers=headers,
        json={"message": "What happened next?", "npc_id": "emma"},
    )
    changed_npc = client.post(
        "/api/v1/chat", headers=headers,
        json={"message": body["message"], "npc_id": "someone-else"},
    )

    assert changed_message.status_code == changed_npc.status_code == 409
    assert changed_message.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"
    assert changed_npc.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"
    assert provider.calls == 1


def test_generation_failure_releases_lease_for_same_request_retry(tmp_path):
    provider = CountingProvider(fail_first=True)
    client = _client(tmp_path, provider, raise_server_exceptions=False)
    auth, user = _auth(client, "journal-generation")
    headers = {**auth, "Idempotency-Key": "generation-retry-001"}
    body = {"message": "Can I help?", "npc_id": "emma"}

    failed = client.post("/api/v1/chat", headers=headers, json=body)
    turn = client.app.state.db.get_chat_turn(user["player_id"], "generation-retry-001")
    assert failed.status_code == 500
    assert turn["status"] == "registered"
    assert turn["owner_token"] is None and turn["response"] is None

    recovered = client.post("/api/v1/chat", headers=headers, json=body)
    assert recovered.status_code == 200, recovered.text
    assert provider.calls == 2
    assert client.app.state.db.get_chat_turn(
        user["player_id"], "generation-retry-001",
    )["status"] == "completed"


def test_replay_recovers_failure_after_response_commit_without_duplicate_effects(
    tmp_path, monkeypatch,
):
    provider = CountingProvider()
    client = _client(tmp_path, provider, raise_server_exceptions=False)
    auth, user = _auth(client, "journal-db-recovery")
    db = client.app.state.db
    original_apply = db.apply_chat_db_effects
    calls = 0

    def fail_once(player_id: str, key: str):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("injected failure after response commit")
        return original_apply(player_id, key)

    monkeypatch.setattr(db, "apply_chat_db_effects", fail_once)
    headers = {**auth, "Idempotency-Key": "db-effects-recovery-001"}
    body = {"message": "Tell me what happened.", "npc_id": "emma"}

    failed = client.post("/api/v1/chat", headers=headers, json=body)
    journal = db.get_chat_turn(user["player_id"], "db-effects-recovery-001")
    assert failed.status_code == 500
    assert journal["status"] == "committed" and journal["db_applied_at"] is None
    assert provider.calls == 1
    assert db.get_learning_state(user["player_id"]).records == {}

    recovered = client.post("/api/v1/chat", headers=headers, json=body)
    assert recovered.status_code == 200, recovered.text
    assert provider.calls == 1
    assert db.get_learning_state(user["player_id"]).records["intent.empathy"].successes == 1
    assert _count(
        db,
        "SELECT count(*) FROM npc_memories WHERE player_id=? AND content=?",
        (user["player_id"], "The player checks in when I seem worried."),
    ) == 1
    assert _count(
        db,
        "SELECT count(*) FROM agent_turn_traces WHERE player_id=? AND request_id=?",
        (user["player_id"], "db-effects-recovery-001"),
    ) == 1
    assert db.get_chat_turn(user["player_id"], "db-effects-recovery-001")["status"] == "completed"


def test_replay_after_life_effect_before_checkpoint_is_world_idempotent(
    tmp_path, monkeypatch,
):
    provider = CountingProvider()
    client = _client(
        tmp_path, provider, life_v2=True, raise_server_exceptions=False,
    )
    auth, user = _auth(client, "journal-life-recovery")
    db = client.app.state.db
    original_mark = db.mark_chat_life_applied
    calls = 0

    def fail_once(player_id: str, key: str):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("injected failure after life-world mutation")
        return original_mark(player_id, key)

    monkeypatch.setattr(db, "mark_chat_life_applied", fail_once)
    headers = {**auth, "Idempotency-Key": "life-effects-recovery-001"}
    body = {"message": "You can tell me when you are ready.", "npc_id": "emma"}

    failed = client.post("/api/v1/chat", headers=headers, json=body)
    assert failed.status_code == 500
    journal = db.get_chat_turn(user["player_id"], "life-effects-recovery-001")
    assert journal["db_applied_at"] and journal["life_applied_at"] is None
    after_effect = deepcopy(db.get_life_world_state(user["player_id"]))
    assert len(after_effect["processed_player_interaction_ids"]) == 1

    recovered = client.post("/api/v1/chat", headers=headers, json=body)
    assert recovered.status_code == 200, recovered.text
    after_replay = db.get_life_world_state(user["player_id"])
    assert len(after_replay["processed_player_interaction_ids"]) == 1
    assert len([
        item for item in after_replay["aftermath"]
        if item.get("kind") == "player_conversation"
    ]) == 1
    assert provider.calls == 1
    assert db.get_chat_turn(user["player_id"], "life-effects-recovery-001")["status"] == "completed"
