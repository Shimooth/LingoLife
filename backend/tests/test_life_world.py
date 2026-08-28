from __future__ import annotations

import json
from copy import deepcopy
from datetime import datetime, timedelta, timezone

import pytest

from lingolife.life import CORE_NEEDS, LifeAction
from lingolife.life_world import LifeWorldEngine


NOW = datetime(2026, 8, 28, 12, 0, tzinfo=timezone.utc)


def _profiles(*, ages=(25, 27), family=False):
    result = {
        "alex": {
            "name": "Alex", "age": ages[0], "romanceEnabled": True,
            "personality": ["warm", "assertive"], "interests": ["music", "books"],
            "relationshipBoundaries": [],
        },
        "emma": {
            "name": "Emma", "age": ages[1], "romanceEnabled": True,
            "personality": ["warm", "quiet"], "interests": ["music", "cooking"],
            "relationshipBoundaries": [],
        },
    }
    if family:
        result["alex"]["family_ids"] = ["emma"]
        result["emma"]["family_ids"] = ["alex"]
    return result


def _shared_home(profiles):
    return {npc_id: {"household_id": "household-shared", "location_id": "home-shared"}
            for npc_id in profiles}


def _social_runtime(profiles):
    needs = {need: 100 for need in CORE_NEEDS}
    needs.update({"social": 0, "love": 0})
    return {npc_id: {"needs": needs, "emotion": {"stress": 25, "energy": 80, "valence": 60}}
            for npc_id in profiles}


def _romance_seeds(*, weak_consent=False):
    result = []
    for owner, target in (("alex", "emma"), ("emma", "alex")):
        result.append({
            "npc_a": owner, "npc_b": target, "familiarity": 85, "affinity": 82,
            "trust": 20 if weak_consent and owner == "emma" else 82,
            "comfort": 78, "attraction": 78,
            "evidence_counts": {"romantic_interest": 2},
        })
    return result


def _world(*, profiles=None, edge_seeds=None):
    profile_map = profiles or _profiles()
    engine = LifeWorldEngine(timezone_name="UTC")
    state = engine.initialize(
        "player-1", profile_map, _shared_home(profile_map), _social_runtime(profile_map),
        edge_seeds, NOW,
    )
    return engine, profile_map, state


def _collision_story_id(state):
    return next(story_id for story_id, record in state["stories"].items()
                if record.get("collision"))


def _reopen_intervention(state, story_id, *, now=NOW, extra_actions=()):
    result = deepcopy(state)
    story = result["stories"][story_id]["story"]
    story.update({
        "status": "intervention_window", "resolution_id": None,
        "trouble_signal": True,
        "intervention_actions": ["ask", "comfort", "advise", "mediate",
                                 "give_space", "let_them_handle_it", *extra_actions],
        "auto_resolve_at": (now + timedelta(minutes=5)).isoformat(),
        "intervention_expires_at": (now + timedelta(minutes=5)).isoformat(),
    })
    return result


def _with_romance_choices(state, story_id, proposed_state, choices):
    result = deepcopy(state)
    participants = result["stories"][story_id]["story"]["participant_ids"]
    rows = []
    for npc_id in participants:
        counterpart = next(value for value in participants if value != npc_id)
        rows.append({
            "id": f"choice-{story_id}-{proposed_state}-{npc_id}",
            "story_id": story_id, "npc_id": npc_id, "counterpart_id": counterpart,
            "channel": "romance", "proposed_state": proposed_state,
            "choice": choices[npc_id], "decided_at": NOW.isoformat(),
            "basis": "resident_autonomy",
        })
    result["relationship_choices"] = [
        value for value in result.get("relationship_choices", [])
        if not (value.get("story_id") == story_id
                and value.get("proposed_state") == proposed_state)
    ] + rows
    facts = result["stories"][story_id]["story"].setdefault("visible_facts", {})
    facts["relationship_choices"] = [
        {key: value for key, value in row.items()
         if key in {"npc_id", "counterpart_id", "proposed_state", "choice"}}
        for row in rows
    ]
    return result


def test_initialize_is_deterministic_json_ready_and_every_resident_has_an_action():
    profiles = _profiles()
    engine = LifeWorldEngine(timezone_name="UTC")
    arguments = ("player-1", profiles, _shared_home(profiles), _social_runtime(profiles), None, NOW)
    first = engine.initialize(*arguments)
    replay = engine.initialize(*arguments)

    assert first == replay
    assert json.loads(json.dumps(first)) == first
    assert first["revision"] == 1
    assert first["next_transition_at"] is not None
    assert all(resident["current_action"] for resident in first["residents"].values())
    assert all(resident["current_action"]["status"] in {
        "planned", "traveling", "performing", "blocked", "retrying",
    } for resident in first["residents"].values())
    # One shared household contributes exactly kitchen/TV/bathroom; the rest are city resources.
    household = [item for item in first["resources"] if item["scope"] == "household"]
    assert {item["kind"] for item in household} == {"kitchen", "television", "bathroom"}


def test_advance_at_the_same_time_is_an_idempotent_noop_and_offline_advance_progresses():
    engine, profiles, state = _world()
    assert engine.advance(state, profiles, NOW) == state

    advanced = engine.advance(state, profiles, NOW + timedelta(hours=7))
    replay = engine.advance(state, profiles, NOW + timedelta(hours=7))
    assert advanced == replay
    assert advanced["revision"] == state["revision"] + 1
    assert advanced["metrics"]["offline_blocks"] > 0
    assert advanced["metrics"]["completed_actions"] > 0
    assert all(value["current_action"] for value in advanced["residents"].values())
    assert advanced["last_advanced_at"] == (NOW + timedelta(hours=7)).isoformat()
    json.dumps(advanced)


def test_segmented_online_advance_matches_one_offline_catchup_for_core_world_facts():
    engine, profiles, initial = _world()
    offline = engine.advance(initial, profiles, NOW + timedelta(hours=6))
    segmented = initial
    for step in range(1, 73):
        segmented = engine.advance(segmented, profiles, NOW + timedelta(minutes=step * 5))

    def core(state):
        metrics = {key: value for key, value in state["metrics"].items() if key != "offline_blocks"}
        return {
            "metrics": metrics, "residents": state["residents"], "resources": state["resources"],
            "relationships": state["relationships"], "stories": state["stories"],
            "threads": state["threads"], "relationship_evidence": state["relationship_evidence"],
            "processed_collision_ids": state["processed_collision_ids"],
            "simulation_cursor_at": state["simulation_cursor_at"],
        }

    assert core(segmented) == core(offline)


def test_independent_residents_produce_an_observable_social_story_within_the_first_hour():
    profiles = {
        "alex": {"name": "Alex", "age": 26, "romanceEnabled": True,
                 "personality": ["outgoing", "curious"], "interests": ["music", "fitness"]},
        "emma": {"name": "Emma", "age": 27, "romanceEnabled": True,
                 "personality": ["warm", "creative"], "interests": ["music", "art"]},
        "maya": {"name": "Maya", "age": 28, "romanceEnabled": True,
                 "personality": ["friendly", "practical"], "interests": ["cooking", "fitness"]},
        "zoe": {"name": "Zoe", "age": 24, "romanceEnabled": True,
                "personality": ["quiet", "thoughtful"], "interests": ["reading", "art"]},
        "liam": {"name": "Liam", "age": 30, "romanceEnabled": True,
                 "personality": ["warm", "assertive"], "interests": ["photography", "music"]},
    }
    homes = {
        npc_id: {"household_id": f"household-{npc_id}", "location_id": f"home-{npc_id}"}
        for npc_id in profiles
    }
    engine = LifeWorldEngine(timezone_name="UTC")
    initial = engine.initialize("independent", profiles, homes, now=NOW)
    state = engine.advance(initial, profiles, NOW + timedelta(hours=1))
    social = [record["story"] for record in state["stories"].values()
              if record.get("collision") and len(record["story"]["participant_ids"]) >= 2
              and record["story"]["observable"]]

    assert social
    first = min(datetime.fromisoformat(item["created_at"]) for item in social)
    assert first - NOW <= timedelta(hours=1)


def test_private_chat_targets_respect_location_objective_ties_and_friendship():
    profiles = _profiles()
    private_homes = {
        npc_id: {"household_id": f"household-{npc_id}", "location_id": f"home-{npc_id}"}
        for npc_id in profiles
    }
    engine = LifeWorldEngine(timezone_name="UTC")
    strangers = engine.initialize("targets", profiles, private_homes, now=NOW)

    assert engine._eligible_resident_targets(strangers, "alex") == ()
    assert all(not (
        value["current_action"]["action_type"] == "talk_to_resident"
        and value["current_action"].get("target_npc_id")
    ) for value in strangers["residents"].values())

    public = deepcopy(strangers)
    public["residents"]["alex"]["current_location_id"] = "riverside_park"
    public["residents"]["emma"]["current_location_id"] = "riverside_park"
    assert engine._eligible_resident_targets(public, "alex") == ("emma",)

    friends = deepcopy(strangers)
    friends["relationships"]["alex:emma"]["channels"]["friendship"] = "friend"
    assert engine._eligible_resident_targets(friends, "alex") == ("emma",)

    housemates = engine.initialize("housemates", profiles, _shared_home(profiles), now=NOW)
    assert engine._eligible_resident_targets(housemates, "alex") == ("emma",)


def test_reconcile_shared_household_merges_members_resources_and_objective_bonds():
    profiles = _profiles()
    private_homes = {
        npc_id: {"household_id": f"household-{npc_id}", "location_id": f"home-{npc_id}"}
        for npc_id in profiles
    }
    engine = LifeWorldEngine(timezone_name="UTC")
    state = engine.initialize("moving", profiles, private_homes, now=NOW)
    original_kitchen = next(
        value for value in state["resources"]
        if value.get("household_id") == "household-alex" and value["kind"] == "kitchen"
    )
    original_kitchen["state"]["stock"] = 42
    profiles = deepcopy(profiles)
    profiles["alex"]["familyIds"] = ["emma"]
    shared = {
        npc_id: {
            "household_id": "household-alex", "home_location_id": "home-alex",
            "current_location_id": state["residents"][npc_id]["current_location_id"],
            "residence_id": "residence-home-alex",
        }
        for npc_id in profiles
    }

    moved = engine.advance(state, profiles, NOW + timedelta(seconds=1), shared)
    replay = engine.advance(moved, profiles, NOW + timedelta(seconds=2), shared)

    assert moved["households"]["household-alex"]["members"] == ["alex", "emma"]
    assert set(moved["households"]) == {"household-alex"}
    shared_resources = [value for value in replay["resources"]
                        if value.get("household_id") == "household-alex"]
    assert len(shared_resources) == 3
    assert len({value["id"] for value in shared_resources}) == 3
    assert next(value for value in shared_resources if value["kind"] == "kitchen")["state"]["stock"] == 42
    assert not any(value.get("household_id") == "household-emma"
                   for value in replay["resources"])
    bonds = replay["relationships"]["alex:emma"]["structural_bonds"]
    assert {value["kind"] for value in bonds} == {"household", "family"}


def test_reconcile_split_removes_ghost_household_and_household_resources():
    profiles = _profiles()
    engine = LifeWorldEngine(timezone_name="UTC")
    state = engine.initialize("split", profiles, _shared_home(profiles), now=NOW)
    independent = {
        npc_id: {
            "household_id": f"household-{npc_id}",
            "home_location_id": f"home-{npc_id}",
            "current_location_id": state["residents"][npc_id]["current_location_id"],
            "residence_id": f"residence-{npc_id}",
        }
        for npc_id in profiles
    }

    split = engine.advance(state, profiles, NOW + timedelta(seconds=1), independent)

    assert set(split["households"]) == {"household-alex", "household-emma"}
    assert "household-shared" not in split["households"]
    assert not any(value.get("household_id") == "household-shared"
                   for value in split["resources"])
    for npc_id in profiles:
        resources = [value for value in split["resources"]
                     if value.get("household_id") == f"household-{npc_id}"]
        assert {value["kind"] for value in resources} == {"kitchen", "television", "bathroom"}


def test_household_move_replans_internal_action_releases_resource_and_closes_chore_fact():
    profiles = _profiles()
    engine = LifeWorldEngine(timezone_name="UTC")
    state = engine.initialize("move-in-progress", profiles, _shared_home(profiles), now=NOW)
    bathroom = next(value for value in state["resources"]
                    if value.get("household_id") == "household-shared"
                    and value["kind"] == "bathroom")
    moving_action = state["residents"]["alex"]["current_action"]
    moving_action.update({
        "id": "moving-shower", "action_type": "shower", "status": "performing",
        "location_id": bathroom["location_id"], "target_resource_id": bathroom["id"],
        "target_npc_id": None, "arrives_at": None, "started_at": NOW.isoformat(),
        "ends_at": (NOW + timedelta(minutes=10)).isoformat(), "completed_at": None,
        "blocked_reason": None,
    })
    bathroom["reservations"] = [{
        "action_id": "moving-shower", "npc_id": "alex", "reserved_at": NOW.isoformat(),
        "expires_at": (NOW + timedelta(minutes=15)).isoformat(),
    }]
    state["responsibilities"].append({
        "id": "old-shared-dishes", "kind": "dishes", "active": True,
        "created_by": "alex", "affected_id": "emma",
        "participant_ids": ["alex", "emma"], "household_id": "household-shared",
        "location_id": bathroom["location_id"], "action_ids": ["moving-shower"],
        "created_at": NOW.isoformat(), "triggers": ["dishwashing_thread"],
    })
    mapping = {
        "alex": {"household_id": "household-alex", "home_location_id": "home-alex",
                 "current_location_id": bathroom["location_id"],
                 "residence_id": "residence-alex"},
        "emma": {"household_id": "household-shared", "home_location_id": "home-shared",
                 "current_location_id": state["residents"]["emma"]["current_location_id"],
                 "residence_id": "residence-shared"},
    }

    moved = engine.advance(state, profiles, NOW + timedelta(seconds=1), mapping)

    replacement = moved["residents"]["alex"]["current_action"]
    assert replacement["id"] != "moving-shower"
    assert replacement.get("target_resource_id") != bathroom["id"]
    assert not str(replacement.get("location_id") or "").startswith("household-shared:")
    retained_bathroom = next(value for value in moved["resources"] if value["id"] == bathroom["id"])
    assert not any(value["action_id"] == "moving-shower"
                   for value in retained_bathroom["reservations"])
    responsibility = next(value for value in moved["responsibilities"]
                          if value["id"] == "old-shared-dishes")
    assert responsibility["active"] is False
    assert responsibility["resolution_reason"] == "household_changed"


def test_shared_resource_is_reserved_and_excess_residents_queue():
    profiles = {
        f"npc-{index}": {"name": f"Resident {index}", "age": 24 + index,
                          "romanceEnabled": False, "personality": [], "interests": []}
        for index in range(3)
    }
    needs = {need: 100 for need in CORE_NEEDS}
    needs["fun"] = 0
    seeds = {npc_id: {"needs": needs} for npc_id in profiles}
    engine = LifeWorldEngine(timezone_name="UTC")
    state = engine.initialize("p", profiles, _shared_home(profiles), seeds, None, NOW)
    television = next(item for item in state["resources"] if item["kind"] == "television"
                      and item["scope"] == "household")

    assert len(television["reservations"]) == television["capacity"] == 2
    assert len(television["queue"]) == 1
    queued_npc = television["queue"][0]["npc_id"]
    # A resident can travel to the shared room before visibly waiting there.
    assert state["residents"][queued_npc]["current_action"]["status"] in {"traveling", "blocked"}


def test_food_shortage_creates_an_observable_autonomous_restock_consequence():
    profiles = {"emma": _profiles()["emma"]}
    engine = LifeWorldEngine(timezone_name="UTC")
    state = engine.initialize("restock", profiles, _shared_home(profiles), now=NOW)
    kitchen = next(item for item in state["resources"] if item["kind"] == "kitchen")
    kitchen["state"]["stock"] = 0
    for item in state["resources"]:
        item["reservations"] = []
        item["queue"] = []
    action = LifeAction(
        id="restock-trigger", player_id="restock", npc_id="emma",
        action_type="prepare_food", status="traveling", desire_id="desire-restock",
        commitment_id="commitment-restock", location_id=kitchen["location_id"],
        target_resource_id=kitchen["id"], target_npc_id=None, planned_at=NOW,
        duration_seconds=20 * 60, interruptible=True, animation_cue="push",
        collision_hooks=("food_stock",), need_deltas={"food": 9}, emotion_deltas={},
        resource_deltas={"stock": -7}, arrives_at=NOW + timedelta(seconds=1),
    )
    state["residents"]["emma"]["current_action"] = action.to_dict()
    state["residents"]["emma"]["current_location_id"] = "home-shared"
    state["next_transition_at"] = action.arrives_at.isoformat()

    advanced = engine.advance(state, profiles, NOW + timedelta(seconds=1))
    replenished = next(item for item in advanced["resources"] if item["id"] == kitchen["id"])

    assert replenished["state"]["stock"] >= 60
    assert replenished["state"]["restock_source"] == "autonomous_shopping"
    assert any(item.get("kind") == "resource_restock" for item in advanced["aftermath"])
    assert any((record.get("collision") or {}).get("scenario_id") == "food_stock_shortage"
               for record in advanced["stories"].values())


def test_unchanged_collision_fact_and_new_fact_inside_cooldown_do_not_repeat():
    engine, profiles, state = _world()
    initial_count = state["metrics"]["collisions"]
    engine._detect_and_record(state, profiles, "different-poll-window", NOW + timedelta(seconds=15))
    assert state["metrics"]["collisions"] == initial_count

    for resident in state["residents"].values():
        resident["current_action"]["id"] += "-new-fact"
    engine._detect_and_record(state, profiles, "new-actions", NOW + timedelta(minutes=1))
    assert state["metrics"]["collisions"] == initial_count

    for resident in state["residents"].values():
        resident["current_action"]["id"] += "-after-cooldown"
    engine._detect_and_record(state, profiles, "later-actions", NOW + timedelta(minutes=21))
    assert state["metrics"]["collisions"] > initial_count


def test_privacy_boundary_requires_arrival_and_real_co_location():
    engine, _, state = _world()
    alex = state["residents"]["alex"]["current_action"]
    alex.update({
        "action_type": "sleep", "status": "performing", "target_npc_id": None,
        "location_id": "home-shared", "started_at": NOW.isoformat(),
        "ends_at": (NOW + timedelta(hours=5)).isoformat(), "arrives_at": None,
        "interruptible": False,
    })
    emma = state["residents"]["emma"]["current_action"]
    emma.update({
        "action_type": "talk_to_resident", "status": "traveling", "target_npc_id": "alex",
        "location_id": "home-shared", "arrives_at": (NOW + timedelta(minutes=2)).isoformat(),
        "started_at": None, "ends_at": None,
    })

    boundaries, _ = engine._fact_events(state, NOW)
    assert not boundaries
    emma.update({
        "status": "performing", "arrives_at": (NOW + timedelta(minutes=2)).isoformat(),
        "started_at": (NOW + timedelta(minutes=2)).isoformat(),
        "ends_at": (NOW + timedelta(minutes=30)).isoformat(),
    })
    boundaries, _ = engine._fact_events(state, NOW + timedelta(minutes=2))
    assert {item["kind"] for item in boundaries} == {"privacy"}

    emma["location_id"] = "riverside_park"
    boundaries, _ = engine._fact_events(state, NOW + timedelta(minutes=3))
    assert not boundaries


def test_behavior_facts_naturally_reach_borrowed_item_noise_and_closed_facility_scenarios():
    profiles = _profiles()
    homes = {
        npc_id: {"household_id": f"household-{npc_id}", "location_id": f"home-{npc_id}"}
        for npc_id in profiles
    }
    engine = LifeWorldEngine(timezone_name="UTC")
    state = engine.initialize("fact-paths", profiles, homes, now=NOW)
    alex = state["residents"]["alex"]["current_action"]
    alex.update({
        "action_type": "sleep", "status": "performing", "location_id": "home-alex",
        "target_npc_id": None, "target_resource_id": None, "arrives_at": None,
        "started_at": NOW.isoformat(), "ends_at": (NOW + timedelta(hours=4)).isoformat(),
        "interruptible": False,
    })
    emma = state["residents"]["emma"]["current_action"]
    emma.update({
        "action_type": "practice_hobby", "status": "performing", "location_id": "home-alex",
        "target_npc_id": None, "target_resource_id": None, "arrives_at": None,
        "started_at": NOW.isoformat(), "ends_at": (NOW + timedelta(hours=1)).isoformat(),
    })

    boundaries, environment = engine._fact_events(state, NOW)
    assert "borrowed_item" in {item["kind"] for item in boundaries}
    assert "noise" in {item["kind"] for item in environment}

    library = next(item for item in state["resources"] if item["id"] == "city-library-reading-room")
    emma.update({
        "action_type": "read", "location_id": library["location_id"],
        "target_resource_id": library["id"],
    })
    _, environment = engine._fact_events(state, NOW + timedelta(hours=12))  # UTC night
    assert "facility" in {item["kind"] for item in environment}


def test_established_friends_can_naturally_create_a_borrowed_property_story():
    profiles = {
        "a": {"name": "A", "age": 25, "romanceEnabled": False,
              "personality": ["outgoing", "curious"], "interests": ["music"]},
        "b": {"name": "B", "age": 26, "romanceEnabled": False,
              "personality": ["outgoing", "creative"], "interests": ["music"]},
    }
    homes = {npc_id: {"household_id": f"household-{npc_id}",
                      "location_id": f"home-{npc_id}"} for npc_id in profiles}
    needs = {need: 100 for need in CORE_NEEDS}
    needs.update({"social": 0, "fun": 0, "achievement": 0})
    seeds = {npc_id: {"needs": needs} for npc_id in profiles}
    edges = [{
        "npc_a": owner, "npc_b": target, "familiarity": 75,
        "affinity": 70, "trust": 70, "comfort": 65,
        "evidence_counts": {"shared_positive_experience": 3},
    } for owner, target in (("a", "b"), ("b", "a"))]
    engine = LifeWorldEngine(timezone_name="UTC")
    initial = engine.initialize("borrow-natural", profiles, homes, seeds, edges, NOW)

    state = engine.advance(initial, profiles, NOW + timedelta(hours=1))

    assert state["metrics"]["scenario_counts"]["borrowed_item_boundary"] >= 1
    assert state["metrics"]["topic_counts"]["borrowed_property"] >= 1


def test_observe_changes_only_presentation_state_and_never_settles_story():
    engine, _, state = _world()
    story_id = _collision_story_id(state)
    before = deepcopy(state["stories"][story_id])
    observed = engine.observe(state, story_id, NOW + timedelta(seconds=2))

    after = observed["stories"][story_id]
    assert after["story"]["observed_at"] == (NOW + timedelta(seconds=2)).isoformat()
    assert after["story"]["status"] == before["story"]["status"]
    assert after["story"]["resolution_id"] == before["story"]["resolution_id"]
    assert after["collision"] == before["collision"]
    assert after["resolution"] == before["resolution"]
    assert engine.observe(observed, story_id, NOW + timedelta(seconds=3)) == observed


def test_management_intervention_is_idempotent_and_rejects_key_reuse():
    engine, _, state = _world()
    story_id = _collision_story_id(state)
    open_state = _reopen_intervention(state, story_id)

    applied = engine.intervene(open_state, story_id, "comfort", "request-1", NOW + timedelta(seconds=3))
    assert applied["stories"][story_id]["story"]["status"] == "resolved_with_management"
    assert applied["revision"] == open_state["revision"] + 1
    assert engine.intervene(applied, story_id, "comfort", "request-1",
                            NOW + timedelta(seconds=4)) == applied
    with pytest.raises(ValueError, match="idempotency key"):
        engine.intervene(applied, story_id, "advise", "request-1", NOW + timedelta(seconds=4))


def test_management_choice_is_applied_to_authoritative_relationship_evidence():
    engine, _, state = _world()
    story_id = _collision_story_id(state)
    opened = _reopen_intervention(state, story_id)

    comforted = engine.intervene(
        opened, story_id, "comfort", "comfort-branch", NOW + timedelta(seconds=3),
    )
    mediated = engine.intervene(
        opened, story_id, "mediate", "mediate-branch", NOW + timedelta(seconds=3),
    )

    comfort_resolution = comforted["stories"][story_id]["resolution"]
    mediate_resolution = mediated["stories"][story_id]["resolution"]
    assert comfort_resolution["mode"] == mediate_resolution["mode"] == "managed"
    assert comfort_resolution["relationship_changes"] != mediate_resolution["relationship_changes"]
    assert comforted["relationships"] != mediated["relationships"]
    assert comforted["relationship_evidence"] != mediated["relationship_evidence"]


def test_high_tension_low_trust_can_backfire_through_the_engine():
    engine, _, state = _world()
    story_id = _collision_story_id(state)
    opened = _reopen_intervention(state, story_id)
    for direction in ("a_to_b", "b_to_a"):
        edge = opened["relationships"]["alex:emma"][direction]
        edge.update({"trust": 5, "affinity": 15, "tension": 92, "resentment": 85})

    result = engine.intervene(
        opened, story_id, "comfort", "backfire-branch", NOW + timedelta(seconds=3),
    )

    aftermath = next(item for item in reversed(result["aftermath"])
                     if item.get("kind") == "management_aftermath")
    assert "backfire" in aftermath["participant_acceptance"].values()
    assert aftermath["outcome"] == "backfired"
    assert "conflict" in result["stories"][story_id]["resolution"]["outcome_tags"]


def test_mutually_accepted_mediation_can_create_a_truce_but_backfire_cannot():
    engine, _, state = _world()
    story_id = _collision_story_id(state)
    opened = _reopen_intervention(state, story_id)
    pair = opened["relationships"]["alex:emma"]
    pair["channels"]["conflict"] = "feud"
    for direction in ("a_to_b", "b_to_a"):
        pair[direction].update({
            "trust": 95, "affinity": 90, "comfort": 85,
            "tension": 25, "resentment": 20,
        })

    truce = engine.intervene(
        opened, story_id, "mediate", "mutual-truce", NOW + timedelta(seconds=3),
    )

    assert truce["relationships"]["alex:emma"]["channels"]["conflict"] == "truce"
    assert truce["stories"][story_id]["story"]["visible_facts"]["conflict_state"] == "truce"
    assert any(value.get("channel") == "conflict" and value.get("state") == "truce"
               for value in truce["aftermath"])

    rejected = _reopen_intervention(state, story_id)
    rejected["relationships"]["alex:emma"]["channels"]["conflict"] = "feud"
    for direction in ("a_to_b", "b_to_a"):
        rejected["relationships"]["alex:emma"][direction].update({
            "trust": 3, "affinity": 8, "tension": 95, "resentment": 92,
        })
    failed = engine.intervene(
        rejected, story_id, "mediate", "failed-truce", NOW + timedelta(seconds=3),
    )
    assert failed["relationships"]["alex:emma"]["channels"]["conflict"] == "feud"


def test_romance_progresses_only_with_two_eligible_consenting_non_family_adults():
    engine, _, state = _world(edge_seeds=_romance_seeds())
    story_id = _collision_story_id(state)
    state = _reopen_intervention(state, story_id, extra_actions=("start_dating",))
    assert state["relationships"]["alex:emma"]["channels"]["romance"] == "mutual_interest"
    dating_choices = [value for value in state["relationship_choices"]
                      if value["story_id"] == story_id and value["proposed_state"] == "dating"]
    assert {value["npc_id"] for value in dating_choices} == {"alex", "emma"}
    assert {value["choice"] for value in dating_choices} == {"accept"}
    assert state["stories"][story_id]["story"]["visible_facts"]["relationship_choices"]

    dating = engine.intervene(state, story_id, "start_dating", "date", NOW + timedelta(seconds=1))
    assert dating["relationships"]["alex:emma"]["channels"]["romance"] == "dating"

    dating = _reopen_intervention(dating, story_id, extra_actions=("become_partners",))
    dating = _with_romance_choices(
        dating, story_id, "partner", {"alex": "accept", "emma": "accept"},
    )
    partners = engine.intervene(dating, story_id, "become_partners", "partner",
                                NOW + timedelta(seconds=2))
    assert partners["relationships"]["alex:emma"]["channels"]["romance"] == "partner"

    separated_ready = _reopen_intervention(partners, story_id, extra_actions=("separate",))
    for direction in ("a_to_b", "b_to_a"):
        separated_ready["relationships"]["alex:emma"][direction]["tension"] = 45
    separated = engine.intervene(separated_ready, story_id, "separate", "separate",
                                 NOW + timedelta(seconds=3))
    assert separated["relationships"]["alex:emma"]["channels"]["romance"] == "separated"


def test_romance_button_cannot_override_a_recorded_hesitation_or_refusal():
    engine, _, state = _world(edge_seeds=_romance_seeds())
    story_id = _collision_story_id(state)
    state = _reopen_intervention(state, story_id, extra_actions=("start_dating",))
    state = _with_romance_choices(
        state, story_id, "dating", {"alex": "accept", "emma": "hesitate"},
    )

    with pytest.raises(ValueError, match="explicit accept choices"):
        engine.intervene(state, story_id, "start_dating", "forced-date",
                         NOW + timedelta(seconds=1))


def test_romance_action_must_be_offered_by_the_observable_story():
    engine, _, state = _world(edge_seeds=_romance_seeds())
    story_id = _collision_story_id(state)
    state = _reopen_intervention(state, story_id)

    with pytest.raises(ValueError, match="not available"):
        engine.intervene(state, story_id, "start_dating", "date", NOW + timedelta(seconds=1))


def test_observable_companionship_can_offer_a_consensual_romance_step():
    _, _, state = _world(edge_seeds=_romance_seeds())
    story = state["stories"][_collision_story_id(state)]["story"]

    assert story["status"] == "intervention_window"
    assert "support_confession" in story["intervention_actions"]
    assert "start_dating" in story["intervention_actions"]
    assert story["visible_facts"]["relationship_development"] is True


def test_natural_positive_life_interactions_reach_directional_then_mutual_interest():
    profiles = {
        "ava": {"name": "Ava", "age": 25, "romanceEnabled": True,
                "personality": ["warm", "outgoing"], "interests": ["music", "art"]},
        "bo": {"name": "Bo", "age": 27, "romanceEnabled": True,
               "personality": ["warm", "outgoing"], "interests": ["music", "art"]},
    }
    needs = {need: 100 for need in CORE_NEEDS}
    needs.update({"social": 0, "love": 0})
    seeds = {npc_id: {"needs": needs} for npc_id in profiles}
    engine = LifeWorldEngine(timezone_name="UTC")
    state = engine.initialize(
        "natural-romance", profiles, _shared_home(profiles), seeds, None, NOW,
    )
    initial = state["relationships"]["ava:bo"]
    assert initial["a_to_b"]["attraction"] == initial["b_to_a"]["attraction"] == 0

    reached: dict[str, tuple[timedelta, dict]] = {}
    for hour in range(1, 21 * 24 + 1):
        state = engine.advance(state, profiles, NOW + timedelta(hours=hour))
        pair = state["relationships"]["ava:bo"]
        channel = pair["channels"]["romance"]
        reached.setdefault(channel, (timedelta(hours=hour), deepcopy(pair)))
        if "one_sided_interest" in reached and "mutual_interest" in reached and "dating" in reached:
            break

    assert reached["one_sided_interest"][0] <= timedelta(days=14)
    assert reached["mutual_interest"][0] <= timedelta(days=14)
    assert reached["one_sided_interest"][0] < reached["mutual_interest"][0]
    directional = reached["one_sided_interest"][1]
    assert ((directional["a_to_b"]["attraction"] >= 60)
            != (directional["b_to_a"]["attraction"] >= 60))
    assert reached["dating"][0] <= timedelta(days=21)
    dating_aftermath = next(
        value for value in state["aftermath"]
        if value.get("channel") == "romance" and value.get("state") == "dating"
    )
    choices = [value for value in state["relationship_choices"]
               if value["story_id"] == dating_aftermath["story_id"]
               and value["proposed_state"] == "dating"]
    assert {value["npc_id"] for value in choices} == {"ava", "bo"}
    assert {value["choice"] for value in choices} == {"accept"}


def test_one_resident_can_end_an_acknowledged_romance():
    engine, _, state = _world(edge_seeds=_romance_seeds())
    story_id = _collision_story_id(state)
    state = _reopen_intervention(state, story_id, extra_actions=("start_dating",))
    dating = engine.intervene(state, story_id, "start_dating", "date", NOW + timedelta(seconds=1))
    dating = _reopen_intervention(dating, story_id, extra_actions=("separate",))
    dating["relationships"]["alex:emma"]["a_to_b"]["tension"] = 45

    separated = engine.intervene(dating, story_id, "separate", "leave", NOW + timedelta(seconds=2))

    assert separated["relationships"]["alex:emma"]["channels"]["romance"] == "separated"


@pytest.mark.parametrize(
    "profiles,seeds,error",
    [
        (_profiles(ages=(17, 27)), _romance_seeds(), "two adults"),
        (_profiles(family=True), _romance_seeds(), "family"),
        (_profiles(), _romance_seeds(weak_consent=True), "both residents must consent"),
    ],
)
def test_romance_rejects_underage_family_and_missing_mutual_consent(profiles, seeds, error):
    engine, _, state = _world(profiles=profiles, edge_seeds=seeds)
    story_id = _collision_story_id(state)
    state = _reopen_intervention(state, story_id, extra_actions=("start_dating",))
    with pytest.raises(ValueError, match=error):
        engine.intervene(state, story_id, "start_dating", "date", NOW + timedelta(seconds=1))


def test_public_snapshot_hides_attraction_internal_policy_and_deterministic_state():
    engine, _, state = _world(edge_seeds=_romance_seeds())
    public = engine.public_snapshot(state)
    encoded = json.dumps(public, ensure_ascii=False)

    assert "attraction" not in encoded
    assert "decision_serial" not in encoded
    assert "relationship_policy" not in encoded
    assert "active_desire_ids" not in encoded
    assert "response_preview" not in encoded
    assert "content_seed" not in encoded
    assert "mutual_interest" not in encoded
    assert '"crush"' not in encoded
    assert '"love"' not in encoded
    assert '"privacy"' not in encoded
    assert "romance" in public["relationships"][0]["channels"]
    assert all(resident["current_action"]["visible_intent"]
               for resident in public["residents"])
    assert json.loads(json.dumps(public)) == public


def test_long_running_intervention_idempotency_cache_is_bounded():
    engine, profiles, state = _world()
    state["interventions"] = {
        f"story-{index}:request-{index}": {
            "fingerprint": f"fingerprint-{index}", "story_id": f"story-{index}",
            "action": "ask", "outcome": "accepted",
            "applied_at": (NOW + timedelta(seconds=index)).isoformat(),
        }
        for index in range(750)
    }

    advanced = engine.advance(state, profiles, NOW + timedelta(seconds=1))

    assert len(advanced["interventions"]) == 600
    assert "story-749:request-749" in advanced["interventions"]
    assert "story-0:request-0" not in advanced["interventions"]


def test_thirty_day_soak_remains_json_ready_bounded_and_keeps_every_npc_acting():
    profiles = {
        f"npc-{index}": {
            "name": f"Resident {index}", "age": 22 + index, "romanceEnabled": index % 2 == 0,
            "personality": ["warm" if index % 2 else "quiet"],
            "interests": ["music", f"interest-{index}"],
        }
        for index in range(5)
    }
    engine = LifeWorldEngine(timezone_name="UTC")
    state = engine.initialize("soak-player", profiles, _shared_home(profiles), now=NOW)
    state = engine.advance(state, profiles, NOW + timedelta(days=30))

    assert state["revision"] == 2
    assert 5 * 30 * 5 <= state["metrics"]["completed_actions"] <= 5 * 30 * 25
    assert 0 < state["metrics"]["collisions"] < state["metrics"]["completed_actions"]
    assert {
        "facility_unavailable", "food_stock_shortage", "friendly_company",
        "friendly_hobby_competition", "noise_disruption",
        "dirty_dishes_responsibility", "unequal_care_responsibility",
    } <= set(state["metrics"]["scenario_counts"])
    assert {
        "blocked_plan", "food_shortage", "companionship", "friendly_competition",
        "noise", "dishwashing", "unequal_care",
    } <= set(state["metrics"]["topic_counts"])
    assert state["metrics"]["scenario_counts"]["unequal_care_responsibility"] <= 20
    assert len(state["stories"]) <= 360
    assert len(state["processed_collision_ids"]) <= 1600
    assert len(state["processed_collision_ids"]) == len(set(state["processed_collision_ids"]))
    assert state["relationship_evidence"]
    recent_action_types = {
        record["story"]["visible_facts"].get("action_type")
        for record in state["stories"].values() if not record.get("collision")
    }
    assert len(recent_action_types - {None}) >= 7
    assert all(float(item["state"].get("stock", 1)) > 0
               for item in state["resources"] if item["kind"] == "kitchen")
    channels = [pair["channels"] for pair in state["relationships"].values()]
    assert any(value["friendship"] in {"friend", "close_friend"} for value in channels)
    assert any(value["conflict"] != "none" for value in channels)
    assert any(value["rivalry"] != "none" for value in channels)
    assert all(resident["current_action"] for resident in state["residents"].values())
    assert all(resident["current_action"]["status"] not in {"completed", "abandoned", "interrupted"}
               for resident in state["residents"].values())
    assert state["next_transition_at"] is not None
    json.dumps(state)
    json.dumps(engine.public_snapshot(state))
