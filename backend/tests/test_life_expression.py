from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import json
import threading

import httpx
import pytest

from lingolife.ai import DeepSeekProvider
from lingolife.config import Settings
from lingolife.db import Database
from lingolife.life_expression import (LifeExpressionService, SYSTEM_PROMPT, REVIEW_SYSTEM_PROMPT, roles_for,
                                       story_revision, validate_script)
from test_life_api import _auth, _client, _install_open_story, ContextStub


class Writer(ContextStub):
    def __init__(self):
        super().__init__()
        self.contracts = []

    def author_expression(self, contract):
        self.contracts.append(deepcopy(contract))
        people = contract["participants"]
        return {"script": {"ending_reason": "unresolved_pause", "beats": [
            {"speaker_id": person["id"], "addressee_id": "player" if contract["kind"] == "opening" else
             (people[(index + 1) % len(people)]["id"] if len(people) > 1 else None),
             "role": person["role"], "text": f"I need a minute to think, says {person['persona'].get('name', person['id'])}.",
             "translation_zh": f"{person['persona'].get('name', person['id'])}需要一点时间想想。",
             "animation_cue": "talk"} for index, person in enumerate(people)]},
                "usage": {"total_tokens": 123}}


def scene(ids=("guai", "charles"), **facts):
    story = {"id": "moment-1", "participant_ids": list(ids), "summary": "An awkward moment.",
             "summary_zh": "一个有点尴尬的时刻。", "presentation": {"beats": [], "location": {"label": "Home"}}}
    record = {"collision": {"topic": "missed_connection", "scenario_id": "resident_unavailable", "facts": facts},
              "resolution": {"response_by_participant": {npc_id: "try_later" for npc_id in ids}}}
    profiles = {npc_id: {"name": npc_id.upper(), "personality": ["quiet"], "interests": ["books"]} for npc_id in ids}
    return story, record, profiles


def service(tmp_path, writer=None, **settings):
    db = Database(f"sqlite:///{tmp_path / 'expressions.db'}")
    provider = writer or Writer()
    return LifeExpressionService(db, provider, Settings(**settings)), provider


def test_scene_is_ai_authored_bilingual_and_persistent_not_poll_regenerated(tmp_path):
    expression, writer = service(tmp_path)
    story, record, profiles = scene(initiator_id="charles", target_id="guai", target_busy=True)
    original = deepcopy((story, record))
    first = expression.scene("p", story, record, profiles)
    assert first["source"] == "ai"
    assert first["roles"] == {"guai": "unavailable_host", "charles": "visitor"}
    assert first["presentation"]["version"] == 3
    assert all(beat["translation_zh"] for beat in first["presentation"]["beats"])
    assert writer.contracts[0]["participants"][0]["decision"] == "unavailable_now"
    story.update(observed_at="today", updated_at="later")
    profiles["guai"]["personality"] = ["loud"]
    assert expression.scene("p", story, record, profiles) == first
    # Survives another worker/service instance.
    another, other_writer = service(tmp_path)
    assert another.scene("p", story, record, profiles) == first
    assert not other_writer.contracts
    assert len(writer.contracts) == 2
    assert record == original[1]


def test_meal_roles_solo_and_fact_allowlist(tmp_path):
    expression, writer = service(tmp_path)
    story, record, profiles = scene(prepared_by="guai", consumed_by="charles", secret_thought="NEVER_SEND_THIS")
    record["expression_personas"] = deepcopy(profiles)
    profiles["guai"]["name"] = "Edited later"
    profiles["guai"]["private_memory"] = "NEVER_SEND_THIS"
    result = expression.scene("p", story, record, profiles)
    assert result["roles"] == {"guai": "cook", "charles": "diner"}
    contract = writer.contracts[0]
    assert contract["participants"][0]["persona"]["name"] == "GUAI"
    assert "NEVER_SEND_THIS" not in json.dumps(contract)
    solo, record, profiles = scene(("guai",))
    solo["id"] = "solo"
    result = expression.scene("p", solo, record, profiles)
    assert len(result["presentation"]["beats"]) == 1
    assert result["presentation"]["beats"][0]["addressee_id"] is None
    assert roles_for(["guai"], {}) == {"guai": "alone"}


def test_outcome_generates_continuation_with_actual_results_not_old_setup(tmp_path):
    expression, writer = service(tmp_path)
    story, record, profiles = scene()
    initial = expression.scene("p", story, record, profiles)
    story["outcome"] = {"mode": "managed", "result": "refused", "selected_action": "mediate",
                        "aftermath": "The suggestion was refused.", "aftermath_zh": "建议被拒绝了。"}
    story["aftermath"] = story["outcome"]["aftermath"]
    later = expression.scene("p", story, record, profiles)
    assert initial["cache_key"] != later["cache_key"]
    assert writer.contracts[-1]["kind"] == "continuation"
    assert writer.contracts[-1]["actual_outcome"]["result"] == "refused"
    assert writer.contracts[-1]["previous_dialogue"][0]["text"] == initial["presentation"]["beats"][0]["text"]
    assert expression.scene("p", story, record, profiles) == later
    assert len(writer.contracts) == 4


@pytest.mark.parametrize("mutation", [
    lambda script: script.update(relationship_change=50),
    lambda script: script["beats"][0].update(speaker_id="intruder"),
    lambda script: script["beats"][0].update(role="visitor"),
    lambda script: script["beats"][0].update(addressee_id="guai"),
    lambda script: script["beats"][0].update(translation_zh=""),
    lambda script: script["beats"][0].update(text="中文不是英文"),
    lambda script: script["beats"][0].update(animation_cue="invented_backflip"),
    lambda script: script.update(ending_reason="forced_happy_ending"),
    lambda script: script.update(beats=script["beats"][:1]),
    lambda script: script["beats"][-1].update(text="Right, then."),
])
def test_rejects_malformed_identity_animation_and_filler(mutation):
    contract = {"kind": "scene", "participants": [{"id": "guai", "role": "resident", "persona": {}},
                                                     {"id": "charles", "role": "resident", "persona": {}}]}
    script = Writer().author_expression(contract)["script"]
    mutation(script)
    with pytest.raises((ValueError, TypeError)):
        validate_script(script, contract)


def test_invalid_output_retries_once_and_fallback_is_short_and_cached(tmp_path):
    class Invalid(Writer):
        def author_expression(self, contract):
            super().author_expression(contract)
            return {"script": {"npc_reply": "Right, then."}}
    expression, writer = service(tmp_path, Invalid())
    args = scene()
    first = expression.scene("p", *args)
    assert first["source"] == "fallback"
    assert first["presentation"]["beats"][0]["speaker_id"] is None
    assert first["presentation"]["beats"][0]["text"] == args[0]["summary"]
    assert expression.scene("p", *args) == first
    assert len(writer.contracts) == 2


def test_repair_succeeds_without_changing_world(tmp_path):
    class Repair(Writer):
        def author_expression(self, contract):
            response = super().author_expression(contract)
            if len(self.contracts) == 1:
                response["script"]["beats"][0]["role"] = "wrong"
            return response
    expression, writer = service(tmp_path, Repair())
    assert expression.scene("p", *scene())["source"] == "ai"
    assert len(writer.contracts) == 2
    assert writer.contracts[-1]["repair"] == {
        "attempt": 1,
        "instruction": "上一次输出未通过校验。请重新检查所有 schema、人物身份和对话承接约束。",
    }


def test_network_failure_is_not_retried_and_provider_exception_not_exposed(tmp_path):
    class Offline(Writer):
        def author_expression(self, contract):
            self.contracts.append(contract)
            raise RuntimeError("secret-body-that-must-not-leak")
    expression, writer = service(tmp_path, Offline())
    result = expression.scene("p", *scene())
    assert result["source"] == "fallback"
    assert "secret-body" not in json.dumps(result)
    assert len(writer.contracts) == 1


def test_two_workers_claim_once_without_blocking_database(tmp_path):
    entered, release = threading.Event(), threading.Event()
    class Slow(Writer):
        def author_expression(self, contract):
            entered.set()
            assert release.wait(5)
            return super().author_expression(contract)
    first, writer = service(tmp_path, Slow())
    second, unused = service(tmp_path)
    with ThreadPoolExecutor(max_workers=2) as pool:
        future = pool.submit(first.scene, "p", *scene())
        assert entered.wait(5)
        try:
            pending = second.scene("p", *scene())
            assert pending["status"] == "pending"
            assert not unused.contracts
        finally:
            release.set()
        result = future.result(5)
    assert result["source"] == "ai"
    assert second.scene("p", *scene()) == result
    assert len(writer.contracts) == 2


def test_expired_claim_cannot_overwrite_fallback(tmp_path):
    expression, _ = service(tmp_path)
    db = expression.db
    owner, _ = db.expression_claim("p", "key", "scene", "2026-09-15", 0, 10, 10, {"source": "fallback"})
    assert owner
    _, result = db.expression_claim("p", "key", "scene", "2026-09-15", 66, 10, 10, {"source": "fallback"})
    assert result["reason"] == "timeout"
    assert not db.expression_finish("p", "key", owner, {"source": "ai"})


def test_budget_is_atomic_per_player_and_global_and_failures_stay_cached(tmp_path):
    expression, writer = service(tmp_path, expression_daily_limit=2, expression_global_daily_limit=4)
    story, record, profiles = scene()
    assert expression.scene("p", story, record, profiles)["source"] == "ai"
    story["id"] = "other"
    assert expression.scene("p", story, record, profiles)["reason"] == "budget"
    assert expression.scene("q", story, record, profiles)["source"] == "ai"
    assert expression.scene("r", story, record, profiles)["reason"] == "budget"
    assert len(writer.contracts) == 4


def test_opening_same_action_cache_different_npc_and_context(tmp_path):
    expression, writer = service(tmp_path)
    context = {"current_action": {"type": "cook", "status": "performing"},
               "conversation": {"id": "guai-day-action", "opening": {"text": "I'm cooking.", "translation": "我在做饭。"}}}
    a = expression.opening("p", "guai", {"name": "Guai", "personality": ["quiet"]}, context)
    assert expression.opening("p", "guai", {"name": "Guai"}, context) == a
    context["conversation"]["id"] = "charles-day-action"
    b = expression.opening("p", "charles", {"name": "Charles", "personality": ["playful"]}, context)
    assert a != b
    assert a["translation"] and b["translation"]
    assert a["text"] in writer.contracts[-1]["recent_lines"]
    assert len(writer.contracts) == 4


def test_deepseek_bilingual_json_wire_contract(monkeypatch):
    seen = []
    def transport(request):
        seen.append(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"content": json.dumps({"beats": [], "ending_reason": "unresolved_pause"})}}],
                                         "usage": {"total_tokens": 20, "untrusted_field": "discard"}})
    client_class = httpx.Client
    monkeypatch.setattr(httpx, "Client", lambda **kwargs: client_class(transport=httpx.MockTransport(transport), **kwargs))
    result = DeepSeekProvider(Settings(deepseek_api_key="synthetic-test-key")).author_expression({"kind": "scene"})
    assert seen[0]["messages"][0]["content"] == SYSTEM_PROMPT
    assert seen[0]["response_format"] == {"type": "json_object"}
    assert seen[0]["thinking"] == {"type": "disabled"}
    assert result["usage"] == {"total_tokens": 20}
    DeepSeekProvider(Settings(deepseek_api_key="synthetic-test-key")).author_expression({
        "kind": "scene", "review_candidate": {"beats": []},
    })
    assert seen[1]["messages"][0]["content"] == REVIEW_SYSTEM_PROMPT
    assert "本次请求是终审，不是续写" in REVIEW_SYSTEM_PROMPT


def test_api_authorization_no_world_poll_generation_and_intervention_continuation(tmp_path):
    writer = Writer()
    client = _client(tmp_path, writer)
    headers, user = _auth(client, "writer-owner")
    other_headers, _ = _auth(client, "writer-other")
    story_id = _install_open_story(client, user["player_id"])
    path = f"/api/v1/life-stories/{story_id}/dialogue"
    assert client.post(path).status_code == 401
    assert client.post(path, headers=other_headers).status_code == 404
    assert client.get("/api/v1/world", headers=headers).status_code == 200
    assert client.get("/api/v1/life-stories", headers=headers).status_code == 200
    assert not writer.contracts
    original = client.app.state.db.get_life_world_state(user["player_id"])
    first = client.post(path, headers=headers)
    assert first.status_code == 200, first.text
    assert first.json()["source"] == "ai"
    assert client.app.state.db.get_life_world_state(user["player_id"]) == original
    assert client.post(path, headers=headers).json() == first.json()
    result = client.post(f"/api/v1/life-stories/{story_id}/intervene", headers=headers,
                         json={"action": "comfort", "idempotency_key": "writer-choice"})
    assert result.status_code == 200, result.text
    second = client.post(path, headers=headers)
    assert second.status_code == 200
    assert first.json()["cache_key"] != second.json()["cache_key"]
    assert writer.contracts[-1]["kind"] == "continuation"
    assert writer.contracts[-1]["actual_outcome"] == result.json()["outcome"]


def test_room_chat_share_one_opening_and_private_context_stays_redacted(tmp_path):
    writer = Writer()
    client = _client(tmp_path, writer)
    headers, _ = _auth(client, "writer-chat")
    room = client.get("/api/v1/room?author_opening=true", headers=headers).json()
    assert room["conversation"]["opening"]["source"] == "ai"
    assert len(writer.contracts) == 2
    repeat = client.get("/api/v1/room?author_opening=true", headers=headers).json()
    assert room["conversation"] == repeat["conversation"]
    response = client.post("/api/v1/chat", headers={**headers, "Idempotency-Key": "opening-test"},
                           json={"message": "What's on your mind?", "npc_id": "emma"})
    assert response.status_code == 200, response.text
    assert len(writer.contracts) == 2
    assert "recent_life_stories" not in writer.contracts[0]


def test_test_account_reset_includes_expression_cache(tmp_path):
    client = _client(tmp_path, Writer())
    headers, user = _auth(client, "onboarding-test-writer")
    assert client.get("/api/v1/room?author_opening=true", headers=headers).status_code == 200
    db = client.app.state.db
    assert db.recent_expressions(user["player_id"], "opening")
    db.reset_user_game_progress(user["id"], "onboarding-test-writer")
    assert not db.recent_expressions(user["player_id"], "opening")


def test_observation_does_not_change_revision():
    assert story_revision({}) == story_revision({"observed_at": "later", "updated_at": "later", "status": "observed"})
    assert story_revision({}) != story_revision({"outcome": {"result": "refused"}})


def test_player_chat_context_reads_only_actual_cached_dialogue_not_templates(tmp_path):
    expression, writer = service(tmp_path)
    story, record, profiles = scene()
    story["presentation"]["beats"] = [{"text": "OBSOLETE TEMPLATE"}]
    before = expression.dialogue_context("p", [story])
    assert "OBSOLETE TEMPLATE" not in json.dumps(before)
    assert not writer.contracts
    generated = expression.scene("p", story, record, profiles)
    context = expression.dialogue_context("p", [story])
    assert context[0]["witnessed_dialogue"][0]["text"] == generated["presentation"]["beats"][0]["text"]
    assert len(writer.contracts) == 2


def test_abandon_pending_opening_fences_late_writer_and_keeps_existing_success(tmp_path):
    expression, _ = service(tmp_path)
    db = expression.db
    owner, _ = db.expression_claim("p", "key", "opening", "2026-09-15", 0, 10, 10, {"source": "fallback"})
    result = db.expression_abandon_pending("p", "key", {"source": "fallback", "reason": "timeout"})
    assert result["reason"] == "timeout"
    assert not db.expression_finish("p", "key", owner, {"source": "ai"})
    assert db.expression_abandon_pending("p", "key", {"source": "different"}) == result


def test_editor_receives_candidate_but_other_scene_text_is_not_a_memory(tmp_path):
    expression, writer = service(tmp_path)
    story, record, profiles = scene()
    expression.scene("p", story, record, profiles)
    assert writer.contracts[1]["review_candidate"]
    story["id"] = "unrelated"
    expression.scene("p", story, record, profiles)
    assert "recent_lines" not in writer.contracts[2]
    assert writer.contracts[2]["previous_dialogue"] == []


def test_room_bootstrap_does_not_wait_for_ai_and_reuses_existing_opening(tmp_path):
    writer = Writer()
    client = _client(tmp_path, writer)
    headers, _ = _auth(client, "writer-bootstrap")
    assert client.get("/api/v1/room", headers=headers).status_code == 200
    assert not writer.contracts
    generated = client.get("/api/v1/room?author_opening=true", headers=headers).json()
    cached = client.get("/api/v1/room", headers=headers).json()
    assert generated["conversation"]["opening"] == cached["conversation"]["opening"]
    assert len(writer.contracts) == 2


def test_failed_scene_can_retry_without_erasing_history_or_spend(tmp_path):
    class Flaky(Writer):
        def author_expression(self, contract):
            if not getattr(self, "online", False):
                raise httpx.ReadTimeout("secret request data")
            return super().author_expression(contract)
    expression, writer = service(tmp_path, Flaky())
    args = scene()
    failed = expression.scene("p", *args)
    assert failed["source"] == "fallback"
    cached = expression.db.expression_cached("p", failed["cache_key"])
    assert cached["failure_code"] == "timeout"
    writer.online = True
    assert expression.scene("p", *args) == failed
    fixed = expression.scene("p", *args, retry=True)
    assert fixed["source"] == "ai"
    assert fixed["cache_key"] != failed["cache_key"]
    assert expression.scene("p", *args) == fixed
    assert expression.scene("p", *args, retry=True) == fixed
    assert len(writer.contracts) == 2
    assert expression.db.expression_cached("p", failed["cache_key"]) == cached
    assert expression.db._connection.execute("SELECT SUM(reserved_calls) FROM life_expression_cache").fetchone()[0] == 4


def test_editor_failure_preserves_valid_draft_for_single_call_retry(tmp_path, caplog):
    class EditorDown(Writer):
        def author_expression(self, contract):
            if len(self.contracts) == 1 and not getattr(self, "online", False):
                raise httpx.ReadTimeout("secret-token-must-not-be-logged")
            return super().author_expression(contract)
    expression, writer = service(tmp_path, EditorDown())
    failed = expression.scene("p", *scene())
    cached = expression.db.expression_cached("p", failed["cache_key"])
    assert cached["draft"]["beats"]
    assert "draft" not in failed  # unreviewed draft is not public dialogue
    assert "phase=review code=timeout" in caplog.text
    assert "secret-token" not in caplog.text
    writer.online = True
    result = expression.scene("p", *scene(), retry=True)
    assert result["source"] == "ai"
    assert len(writer.contracts) == 2  # one original draft + one successful editor call
    assert writer.contracts[-1]["review_candidate"] == cached["draft"]


def test_retry_respects_daily_budget_and_does_not_generate_a_retry_chain(tmp_path):
    expression, writer = service(tmp_path, expression_daily_limit=2)
    writer.author_expression = lambda contract: (_ for _ in ()).throw(httpx.ReadTimeout("offline"))
    first = expression.scene("p", *scene())
    budget = expression.scene("p", *scene(), retry=True)
    assert budget["reason"] == "budget"
    assert budget["retryable"] is False
    for _ in range(3):
        assert expression.scene("p", *scene(), retry=True) == budget
    assert expression.db._connection.execute("SELECT COUNT(*) FROM life_expression_cache").fetchone()[0] == 2
    assert first["cache_key"] != budget["cache_key"]


def test_continuation_and_chat_use_successful_retry_not_old_failed_summary(tmp_path):
    class Recovering(Writer):
        def author_expression(self, contract):
            if not getattr(self, "online", False):
                raise httpx.ConnectError("offline")
            return super().author_expression(contract)
    expression, writer = service(tmp_path, Recovering())
    story, record, profiles = scene()
    expression.scene("p", story, record, profiles)
    writer.online = True
    fixed = expression.scene("p", story, record, profiles, retry=True)
    assert expression.dialogue_context("p", [story])[0]["witnessed_dialogue"][0]["text"] == fixed["presentation"]["beats"][0]["text"]
    story["outcome"] = {"mode": "managed", "result": "refused"}
    expression.scene("p", story, record, profiles)
    assert writer.contracts[-1]["previous_dialogue"][0]["text"] == fixed["presentation"]["beats"][0]["text"]


def test_concurrent_retries_share_one_reservation(tmp_path):
    entered, release = threading.Event(), threading.Event()
    class DelayedRecovery(Writer):
        def author_expression(self, contract):
            if not getattr(self, "online", False):
                raise httpx.ConnectError("offline")
            entered.set()
            assert release.wait(5)
            return super().author_expression(contract)
    expression, writer = service(tmp_path, DelayedRecovery())
    expression.scene("p", *scene())
    writer.online = True
    other, other_writer = service(tmp_path)
    with ThreadPoolExecutor(max_workers=2) as pool:
        pending = pool.submit(expression.scene, "p", *scene(), retry=True)
        assert entered.wait(5)
        try:
            assert other.scene("p", *scene(), retry=True)["status"] == "pending"
            assert not other_writer.contracts
        finally:
            release.set()
        result = pending.result(5)
    assert other.scene("p", *scene(), retry=True) == result
    assert len(writer.contracts) == 2
    assert expression.db._connection.execute("SELECT SUM(reserved_calls) FROM life_expression_cache").fetchone()[0] == 4
