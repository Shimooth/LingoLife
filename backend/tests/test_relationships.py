from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from lingolife.relationships import (
    DIMENSIONS,
    Appraisal,
    DirectionalRelationship,
    JealousyContext,
    RelationshipEngine,
    RelationshipEvidence,
    RelationshipPair,
    RelationshipTransition,
    StructuralBond,
)


BASE = datetime(2040, 1, 1, tzinfo=timezone.utc)


def moment(days: int = 0) -> datetime:
    return BASE + timedelta(days=days)


def evidence(evidence_id: str, owner: str = "ava", target: str = "bo",
             kind: str = "shared_positive_experience", magnitude: float = 1,
             day: int = 0, appraisal: Appraisal | None = None,
             **values) -> RelationshipEvidence:
    return RelationshipEvidence(
        evidence_id=evidence_id,
        owner_id=owner,
        target_id=target,
        kind=kind,  # type: ignore[arg-type]
        magnitude=magnitude,
        occurred_at=moment(day),
        appraisal=appraisal or Appraisal(perceived_intent="beneficial", fairness=.5),
        **values,
    )


def mutual_state(**scores: int) -> RelationshipPair:
    state = RelationshipPair.initial("ava", "bo", BASE)
    for edge in (state.a_to_b, state.b_to_a):
        for key, value in scores.items():
            setattr(edge, key, value)
    return state


def test_state_uses_required_directional_dimensions_and_no_naked_jealousy_score():
    state = RelationshipPair.initial("ava", "bo", BASE)
    assert tuple(state.a_to_b.scores()) == DIMENSIONS
    assert "jealousy" not in state.a_to_b.scores()
    assert state.edge("ava", "bo") is state.a_to_b
    assert state.edge("bo", "ava") is state.b_to_a
    assert state.pair_key == "ava:bo"
    with pytest.raises(ValueError):
        state.edge("ava", "cy")


def test_relationship_pair_round_trips_through_json_ready_dict():
    engine = RelationshipEngine()
    state = engine.apply(RelationshipPair.initial("ava", "bo", BASE), evidence("round-trip")).state
    state = engine.with_structural_bonds(state, [StructuralBond(
        "neighbors", "neighbor", ("ava", "bo"), {"ava": "neighbor", "bo": "neighbor"},
    )])
    restored = RelationshipPair.from_dict(state.to_dict())

    assert restored == state
    assert restored.to_dict() == state.to_dict()


@pytest.mark.parametrize("field,value", [
    ("responsibility", -0.1), ("responsibility", 1.1),
    ("fairness", -1.1), ("fairness", 1.1),
    ("confidence", -0.1), ("confidence", 1.1),
    ("boundary_impact", -0.1), ("boundary_impact", 1.1),
])
def test_appraisal_rejects_values_outside_rule_bounds(field, value):
    with pytest.raises(ValueError):
        Appraisal(**{field: value})


def test_evidence_is_directional_idempotent_and_does_not_mutate_input_state():
    engine = RelationshipEngine()
    original = RelationshipPair.initial("ava", "bo", BASE)
    update = engine.apply(original, evidence("shared-1"))

    assert update.applied is True
    assert update.state.a_to_b.affinity > original.a_to_b.affinity
    assert update.state.b_to_a.scores() == original.b_to_a.scores()
    assert original.applied_evidence_ids == set()
    assert original.a_to_b.evidence_counts == {}

    replay = engine.apply(update.state, evidence("shared-1"))
    assert replay.applied is False
    assert replay.deltas == {}
    assert replay.state == update.state


def test_evidence_id_collision_cannot_hide_wrong_participants():
    engine = RelationshipEngine()
    applied = engine.apply(RelationshipPair.initial("ava", "bo", BASE), evidence("stable-id")).state
    with pytest.raises(ValueError):
        engine.apply(applied, evidence("stable-id", owner="ava", target="cy"))
    with pytest.raises(ValueError):
        engine.apply(applied, evidence("stable-id", owner="bo", target="ava"))
    with pytest.raises(ValueError):
        engine.apply(applied, evidence("stable-id", magnitude=.2))


def test_appraisal_changes_impact_without_changing_objective_evidence_kind():
    engine = RelationshipEngine()
    hostile = evidence(
        "harm-hostile", kind="boundary_violation",
        appraisal=Appraisal(perceived_intent="hostile", responsibility=1,
                            fairness=-1, boundary_impact=1),
    )
    accidental = evidence(
        "harm-accidental", kind="boundary_violation",
        appraisal=Appraisal(perceived_intent="accidental", responsibility=.4,
                            fairness=0, boundary_impact=.2),
    )
    hostile_update = engine.apply(RelationshipPair.initial("ava", "bo", BASE), hostile)
    accidental_update = engine.apply(RelationshipPair.initial("ava", "bo", BASE), accidental)

    assert hostile_update.deltas["trust"] < accidental_update.deltas["trust"] < 0
    assert hostile_update.deltas["tension"] > accidental_update.deltas["tension"] > 0
    assert hostile_update.deltas["resentment"] > accidental_update.deltas["resentment"] > 0


def test_all_updates_remain_between_zero_and_one_hundred():
    engine = RelationshipEngine()
    high = mutual_state(**{dimension: 99 for dimension in DIMENSIONS})
    low = mutual_state(**{dimension: 1 for dimension in DIMENSIONS})
    positive = engine.apply(high, evidence("positive", kind="support_in_crisis")).state
    negative = engine.apply(
        low,
        evidence("negative", kind="betrayal",
                 appraisal=Appraisal(perceived_intent="hostile", fairness=-1)),
    ).state
    assert all(0 <= value <= 100 for value in positive.a_to_b.scores().values())
    assert all(0 <= value <= 100 for value in negative.a_to_b.scores().values())


def test_decay_uses_distinct_half_lives_and_is_idempotent_at_same_time():
    engine = RelationshipEngine()
    state = mutual_state(familiarity=90, trust=10, tension=80, resentment=80,
                         attraction=80, fear=80)
    state = engine.refresh(state)
    decayed = engine.decay_to(state, moment(30))

    assert decayed.a_to_b.tension < decayed.a_to_b.fear < decayed.a_to_b.resentment
    assert decayed.a_to_b.familiarity > 85
    assert decayed.a_to_b.trust <= 12
    assert engine.decay_to(decayed, moment(30)) == decayed
    # Rewinding world time never applies decay twice or reverses it.
    assert engine.decay_to(decayed, moment(20)) == decayed


def test_old_harm_remains_in_history_but_no_longer_forces_current_friction():
    engine = RelationshipEngine()
    state = mutual_state(tension=20, resentment=10)
    harmful = Appraisal(perceived_intent="careless", responsibility=.8, fairness=-.4)
    for index in range(2):
        state = engine.apply(state, evidence(
            f"old-harm-{index}", kind="conflict", appraisal=harmful,
        )).state

    assert state.channels.conflict == "friction"
    aged = engine.decay_to(state, moment(45))

    assert aged.channels.conflict == "none"
    assert aged.a_to_b.evidence_counts["conflict"] == 2
    assert {"old-harm-0", "old-harm-1"} <= aged.applied_evidence_ids


def test_friendship_needs_mutual_evidence_and_uses_exit_hysteresis():
    engine = RelationshipEngine()
    state = mutual_state(familiarity=65, affinity=65, trust=65, comfort=60)
    for owner, target in (("ava", "bo"), ("bo", "ava")):
        for index, kind in enumerate((
            "shared_positive_experience", "received_help", "kept_promise",
        )):
            state = engine.apply(state, evidence(
                f"{owner}-positive-{index}", owner, target, kind, day=index,
            )).state
    assert state.channels.friendship == "friend"
    assert "ever_friends" in state.channels.history

    # Falling just below entry thresholds does not make the relationship flap.
    state.a_to_b.trust = state.a_to_b.affinity = 50
    state.b_to_a.trust = state.b_to_a.affinity = 50
    stable = engine.refresh(state)
    assert stable.channels.friendship == "friend"

    stable.a_to_b.trust = 25
    stable.a_to_b.resentment = 75
    estranged = engine.refresh(stable)
    assert estranged.channels.friendship == "estranged"
    assert "strained" in estranged.a_to_b.labels


def test_one_argument_cannot_create_enemies_but_repeated_mutual_harm_can():
    engine = RelationshipEngine()
    state = RelationshipPair.initial("ava", "bo", BASE)
    state = engine.apply(
        state,
        evidence("argument", kind="conflict",
                 appraisal=Appraisal(perceived_intent="careless", fairness=-.3)),
    ).state
    assert state.channels.conflict != "feud"
    assert "hostile" not in state.a_to_b.labels

    state = mutual_state(trust=18, affinity=25, comfort=20, tension=65, resentment=67)
    hostile_appraisal = Appraisal(perceived_intent="hostile", responsibility=1, fairness=-1)
    for owner, target in (("ava", "bo"), ("bo", "ava")):
        for index in range(2):
            state = engine.apply(state, evidence(
                f"{owner}-hostile-{index}", owner, target, "hostile_act", day=index,
                appraisal=hostile_appraisal,
            )).state
    assert all("hostile" in edge.labels for edge in (state.a_to_b, state.b_to_a))
    assert state.channels.conflict == "feud"
    assert "ever_feuded" in state.channels.history


def test_apology_reduces_heat_but_changed_behavior_repairs_resentment():
    engine = RelationshipEngine()
    initial = mutual_state(trust=35, tension=80, resentment=80)
    apology = engine.apply(
        initial,
        evidence("apology", kind="apology",
                 appraisal=Appraisal(perceived_intent="beneficial", fairness=.5)),
    )
    repair = engine.apply(
        initial,
        evidence("repair", kind="sustained_change",
                 appraisal=Appraisal(perceived_intent="beneficial", fairness=1)),
    )
    assert abs(apology.deltas["tension"]) > abs(repair.deltas["tension"])
    assert abs(repair.deltas["resentment"]) > abs(apology.deltas.get("resentment", 0))
    assert repair.deltas["trust"] > apology.deltas["trust"]


def test_competition_derives_a_separate_rivalry_channel():
    engine = RelationshipEngine()
    state = mutual_state(respect=60)
    for owner, target in (("ava", "bo"), ("bo", "ava")):
        for index in range(2):
            state = engine.apply(state, evidence(
                f"{owner}-fair-{index}", owner, target, "fair_competition", day=index,
            )).state
    assert state.channels.rivalry == "friendly"
    assert state.channels.conflict == "none"
    assert "rivalrous" in state.a_to_b.labels

    for owner, target in (("ava", "bo"), ("bo", "ava")):
        for index in range(2):
            state = engine.apply(state, evidence(
                f"{owner}-unfair-{index}", owner, target, "unfair_competition", day=index + 3,
                appraisal=Appraisal(perceived_intent="hostile", fairness=-1),
            )).state
    assert state.channels.rivalry in {"competitive", "hostile"}


def romantic_interest_state(engine: RelationshipEngine) -> RelationshipPair:
    state = mutual_state(attraction=70, familiarity=50, affinity=65, trust=60, comfort=60)
    state.a_to_b.evidence_counts["romantic_interest"] = 1
    state.b_to_a.evidence_counts["romantic_interest"] = 1
    return engine.refresh(state)


def transition(transition_id: str, to_state: str, consented_by=frozenset({"ava", "bo"}),
               initiated_by: str = "ava", channel: str = "romance") -> RelationshipTransition:
    return RelationshipTransition(
        transition_id=transition_id,
        channel=channel,  # type: ignore[arg-type]
        to_state=to_state,
        source_event_id=f"event-{transition_id}",
        initiated_by=initiated_by,
        consented_by=consented_by,
    )


def test_romance_scores_only_derive_interest_and_acknowledged_states_are_explicit():
    engine = RelationshipEngine()
    state = romantic_interest_state(engine)
    assert state.channels.romance == "mutual_interest"
    assert state.channels.romance != "dating"

    with pytest.raises(ValueError):
        engine.transition(state, transition("dating-no-consent", "dating", frozenset({"ava"})))
    dated = engine.transition(state, transition("dating", "dating"))
    assert dated.applied and dated.state.channels.romance == "dating"
    assert "ever_dated" in dated.state.channels.history
    replay = engine.transition(dated.state, transition("dating", "dating"))
    assert not replay.applied and replay.state == dated.state
    with pytest.raises(ValueError):
        engine.transition(dated.state, transition("dating", "partner"))

    partnered = engine.transition(dated.state, transition("partner", "partner")).state
    assert partnered.channels.romance == "partner"
    separated = engine.transition(
        partnered,
        transition("separate", "separated", frozenset(), initiated_by="bo"),
    ).state
    assert separated.channels.romance == "separated"
    assert {"ever_dated", "ever_partners", "ex_partner"} <= separated.channels.history
    # Lingering attraction never silently turns an ex relationship back into dating.
    assert engine.refresh(separated).channels.romance == "separated"


def test_family_bond_blocks_romance_and_structural_bonds_validate_scope_and_roles():
    engine = RelationshipEngine()
    state = romantic_interest_state(engine)
    siblings = StructuralBond(
        "family-1", "family", ("ava", "bo"), {"ava": "sibling", "bo": "sibling"},
    )
    with_family = engine.with_structural_bonds(state, [siblings])
    with pytest.raises(ValueError):
        engine.transition(with_family, transition("invalid-date", "dating"))

    with pytest.raises(ValueError):
        StructuralBond("home", "household", ("ava", "bo"),
                       {"ava": "housemate", "bo": "housemate"})
    with pytest.raises(ValueError):
        StructuralBond("bad-family", "family", ("ava", "bo"),
                       {"ava": "friend", "bo": "friend"})
    with pytest.raises(ValueError):
        engine.with_structural_bonds(state, [StructuralBond(
            "wrong-pair", "neighbor", ("ava", "cy"),
            {"ava": "neighbor", "cy": "neighbor"},
        )])

    household = StructuralBond(
        "home-1", "household", ("ava", "bo"),
        {"ava": "housemate", "bo": "housemate"}, scope_id="household-1",
    )
    with pytest.raises(ValueError):
        engine.with_structural_bonds(state, [household, StructuralBond(
            "home-duplicate", "household", ("ava", "bo"),
            {"ava": "housemate", "bo": "housemate"}, scope_id="household-1",
        )])


def test_jealousy_requires_a_three_person_event_and_thread_context():
    engine = RelationshipEngine()
    with pytest.raises(ValueError):
        JealousyContext("ctx", "ava", "bo", "bo", "event", "thread", .7)
    with pytest.raises(ValueError):
        RelationshipEvidence(
            "naked-jealousy", "ava", "bo", "jealousy_context", .7, BASE,
        )

    context = JealousyContext(
        "ctx-1", "ava", "bo", "cy", "party-1", "excluded-from-party", .8,
    )
    signal = engine.evidence_from_jealousy(context, BASE)
    assert signal.source_event_id == "party-1" and signal.thread_id == "excluded-from-party"
    update = engine.apply(RelationshipPair.initial("ava", "bo", BASE), signal)
    assert update.applied and update.state.a_to_b.tension > 5
    assert "jealousy" not in update.state.a_to_b.scores()
    assert not engine.apply(update.state, signal).applied


def test_structural_friendship_rivalry_and_conflict_labels_can_coexist():
    engine = RelationshipEngine()
    state = mutual_state(familiarity=80, affinity=70, trust=70, respect=70,
                         comfort=65, tension=42, resentment=32)
    for edge in (state.a_to_b, state.b_to_a):
        edge.evidence_counts.update({
            "shared_positive_experience": 2,
            "received_help": 1,
            "fair_competition": 2,
        })
    state = engine.with_structural_bonds(state, [StructuralBond(
        "home", "household", ("ava", "bo"),
        {"ava": "housemate", "bo": "housemate"}, scope_id="home-1",
    )])
    state = engine.refresh(state)
    assert state.channels.friendship == "friend"
    assert state.channels.rivalry == "friendly"
    assert state.channels.conflict == "friction"
    assert state.structural_bonds[0].kind == "household"


def test_feud_requires_an_explicit_mutual_truce_and_harm_breaks_it():
    engine = RelationshipEngine()
    state = mutual_state(trust=15, tension=75, resentment=80)
    for edge in (state.a_to_b, state.b_to_a):
        edge.evidence_counts["hostile_act"] = 2
    state = engine.refresh(state)
    assert state.channels.conflict == "feud"
    with pytest.raises(ValueError):
        engine.transition(state, transition(
            "one-sided-truce", "truce", frozenset({"ava"}), channel="conflict",
        ))
    truce = engine.transition(state, transition("truce", "truce", channel="conflict")).state
    assert truce.channels.conflict == "truce"
    assert "former_enemies" in truce.channels.history

    broken = engine.apply(
        truce,
        evidence("truce-broken", kind="broken_promise",
                 appraisal=Appraisal(perceived_intent="careless", fairness=-1)),
    ).state
    assert broken.channels.conflict != "truce"


def test_serialized_public_shape_keeps_channels_bonds_and_directional_labels():
    engine = RelationshipEngine()
    state = engine.with_structural_bonds(RelationshipPair.initial("ava", "bo", BASE), [
        StructuralBond("neighbors", "neighbor", ("ava", "bo"),
                       {"ava": "neighbor", "bo": "neighbor"}),
    ])
    value = state.to_dict()
    assert value["channels"]["romance"] == "none"  # type: ignore[index]
    assert value["structural_bonds"][0]["kind"] == "neighbor"  # type: ignore[index]
    assert value["a_to_b"]["labels"] == ["stranger"]  # type: ignore[index]
