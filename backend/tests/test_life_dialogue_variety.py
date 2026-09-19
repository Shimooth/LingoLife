from copy import deepcopy
from datetime import timedelta

import pytest

from lingolife.collisions import BORROWING_RESPONSES, build_collision, resolve_collision_autonomously
from lingolife.life_service import LifeWorldService, select_story_attention
from lingolife.life_expression import validate_borrowing_intents
from lingolife.life_world import LifeWorldEngine
from test_life_world import NOW, _profiles, _shared_home
from test_life_expression import scene, service


def test_borrowing_responses_cannot_swap_owner_and_borrower():
    for index in range(40):
        collision = build_collision(
            kind="person_boundary", triggers=("borrowed_without_permission",),
            participant_ids=("borrower", "owner"), action_ids=("a", "b"),
            occurred_at=NOW, source_key=f"borrowing-{index}", location_id="home",
            facts={"actor_id": "borrower", "affected_id": "owner"},
        )
        result = resolve_collision_autonomously(collision)
        assert result.response_by_participant["borrower"] in BORROWING_RESPONSES["borrower"]
        assert result.response_by_participant["owner"] in BORROWING_RESPONSES["owner"]
        if result.response_by_participant["borrower"] == "ask_retroactively":
            assert result.response_by_participant["owner"] in {"allow_with_reminder", "ask_item_back"}


def borrowing_world():
    profiles = _profiles()
    engine = LifeWorldEngine(timezone_name="UTC")
    state = engine.initialize("borrow-check", profiles, _shared_home(profiles), now=NOW)
    state["stories"] = {}
    state["residents"]["emma"]["current_action"].update(
        action_type="borrow_household_item", status="performing", target_npc_id="alex",
        target_resource_id=None, location_id="home-shared",
    )
    state["residents"]["alex"]["current_action"].update(
        action_type="read", status="performing", target_npc_id=None,
        target_resource_id=None, location_id="home-shared",
    )
    return engine, state


def borrowed_facts(engine, state):
    return [event for event in engine._fact_events(state, NOW)[0] if event["kind"] == "borrowed_item"]


def test_ordinary_borrowing_is_not_automatically_a_violation(monkeypatch):
    engine, state = borrowing_world()
    monkeypatch.setattr("lingolife.life_world.stable_fraction", lambda *args, **kwargs: .2)
    assert borrowed_facts(engine, state) == []
    state["residents"]["emma"]["shared_rule_expectations"] = engine._shared_rule_expectations({"personality": ["冲动"]})
    facts = borrowed_facts(engine, state)
    assert len(facts) == 1
    assert facts[0]["borrower_id"] == "emma" and facts[0]["owner_id"] == "alex"
    assert borrowed_facts(engine, state) == facts  # polling cannot reroll


def test_recent_conflict_reduces_recurrence_and_items_require_real_ownership(monkeypatch):
    engine, state = borrowing_world()
    monkeypatch.setattr("lingolife.life_world.stable_fraction", lambda *args, **kwargs: .08)
    assert borrowed_facts(engine, state)
    state["stories"]["recent"] = {"collision": {"topic": "borrowed_property",
        "occurred_at": (NOW - timedelta(hours=1)).isoformat(),
        "facts": {"actor_id": "emma", "affected_id": "alex"}}}
    assert not borrowed_facts(engine, state)
    state["stories"] = {}
    state["residents"]["alex"]["personal_inventory"] = []
    assert not borrowed_facts(engine, state)


def test_old_swapped_decisions_are_not_given_to_writer_as_facts(tmp_path):
    expression, writer = service(tmp_path)
    story, record, profiles = scene(actor_id="guai", affected_id="charles", item_kind="hobby_supplies")
    record["collision"]["topic"] = "borrowed_property"
    record["resolution"]["response_by_participant"] = {"guai": "state_borrowing_rule", "charles": "return_and_apologize"}
    story["outcome"] = {"mode": "autonomous", "aftermath": "Some tension remains."}
    original = deepcopy(record)
    result = expression.scene("p", story, record, profiles)
    assert result["roles"] == {"guai": "borrower", "charles": "owner"}
    contract = writer.contracts[0]
    assert contract["first_view"] is True and contract["previous_dialogue"] == []
    assert all(person["decision"] is None for person in contract["participants"])
    assert contract["facts"]["item_kind"] == "hobby_supplies"
    assert record == original  # no rewriting past resolutions


def test_city_feed_folds_settled_repeats_but_keeps_other_pairs_and_urgent_events():
    base = {"title": "Borrowed without asking", "participant_ids": ["a", "b"],
            "status": "resolved_autonomously", "level": "moment"}
    values = [{**base, "id": "old", "created_at": (NOW - timedelta(hours=1)).isoformat()},
              {**base, "id": "new", "created_at": NOW.isoformat()},
              {**base, "id": "other", "participant_ids": ["a", "c"], "created_at": NOW.isoformat()},
              {**base, "id": "urgent", "status": "awaiting_management", "created_at": NOW.isoformat()}]
    original = deepcopy(values)
    assert {v["id"] for v in select_story_attention(values, 8, preserve_urgent=True)} == {"new", "other", "urgent"}
    assert values == original


@pytest.mark.parametrize("observed", [None, NOW.isoformat()])
def test_old_moment_leaves_live_feed_even_if_never_seen(observed):
    old = {"observable": True, "status": "resolved_autonomously", "observed_at": observed,
           "created_at": (NOW - timedelta(days=2)).isoformat()}
    assert not LifeWorldService._is_story_presentable(old, NOW)
    assert LifeWorldService._is_story_presentable({**old, "created_at": NOW.isoformat()}, NOW)
    assert LifeWorldService._is_story_presentable({**old, "status": "intervention_window"}, NOW)


@pytest.mark.parametrize("decision,text,code", [
    ("deny_responsibility", "Alright. I'll ask next time.", "changed_borrowing_decision"),
    ("deny_responsibility", "I'll try to remember to ask.", "changed_borrowing_decision"),
    ("state_borrowing_rule", "You can keep it for now.", "unearned_borrowing_consent"),
    ("ask_item_back", "I've been looking for it.", "invented_borrowing_history"),
    ("return_and_apologize", "It's in my room. I'll get it.", "invented_borrowing_history"),
    ("deny_responsibility", "I took it because mine was dead.", "invented_borrowing_history"),
    ("ask_retroactively", "Saw it on the table and grabbed it.", "invented_borrowing_history"),
    ("deny_responsibility", "You weren't even using it.", "invented_borrowing_history"),
    ("ask_retroactively", "Fine. I'll ask next time.", "missing_borrowing_request"),
])
def test_known_ai_regressions_trigger_specific_repair(decision, text, code):
    with pytest.raises(ValueError, match=code):
        validate_borrowing_intents([{"speaker_id": "a", "text": text}], {
            "participants": [{"id": "a", "decision": decision}],
        })


def test_characterful_disagreement_and_actual_permission_are_allowed():
    for decision, text in [
        ("deny_responsibility", "You're making a huge thing out of this."),
        ("ask_retroactively", "Can I borrow it this time?"),
        ("allow_with_reminder", "You can use it. Just ask me next time."),
    ]:
        validate_borrowing_intents([{"speaker_id": "a", "text": text}], {
            "participants": [{"id": "a", "decision": decision}],
        })


def test_personal_objects_have_stable_authored_labels_and_reach_the_writer(tmp_path, monkeypatch):
    engine, state = borrowing_world()
    inventory = state["residents"]["alex"]["personal_inventory"]
    assert all(item["label_en"] and item["label_zh"] for item in inventory)
    assert engine._initial_personal_inventory("alex", _profiles()["alex"]) == engine._initial_personal_inventory("alex", _profiles()["alex"])
    monkeypatch.setattr("lingolife.life_world.stable_fraction", lambda *args, **kwargs: 0)
    fact = borrowed_facts(engine, state)[0]
    assert fact["item_label"] == inventory[0]["label_en"]
    expression, writer = service(tmp_path)
    story, record, profiles = scene(actor_id="guai", affected_id="charles", item_label="portable charger", item_label_zh="充电宝")
    record["collision"]["topic"] = "borrowed_property"
    expression.scene("p", story, record, profiles)
    assert writer.contracts[0]["facts"]["item_label"] == "portable charger"


def test_existing_item_labels_survive_profile_changes_and_empty_inventory_stays_empty():
    engine, state = borrowing_world()
    existing = deepcopy(state["residents"]["alex"]["personal_inventory"])
    profiles = _profiles()
    profiles["alex"]["interests"] = ["cooking"]
    state["residents"]["emma"]["personal_inventory"] = []
    engine._reconcile_residents(state, profiles, NOW, _shared_home(profiles))
    assert state["residents"]["alex"]["personal_inventory"] == existing
    assert state["residents"]["emma"]["personal_inventory"] == []
