from __future__ import annotations

from datetime import datetime, timedelta, timezone

from lingolife.collisions import build_collision, resolve_collision_autonomously
from lingolife.life import LifeAction
from lingolife.stories import (
    LifeStory,
    StoryContext,
    classify_story,
    derive_relationship_labels,
    observe_story,
    settle_story_autonomously,
    settle_story_with_management,
    story_from_action,
    story_from_collision,
    update_unresolved_thread,
)


NOW = datetime(2026, 8, 28, 12, tzinfo=timezone.utc)


def make_collision(*, kind="person_person", triggers=("quiet_company",),
                   source="collision-source", recurrence=0, severe=False):
    profiles = ({"emma": {"emotion": {"stress": 100}},
                 "alex": {"emotion": {"stress": 100}}} if severe else None)
    relationships = ({("emma", "alex"): {"tension": 100},
                      ("alex", "emma"): {"tension": 100}} if severe else None)
    collision = build_collision(
        kind=kind, triggers=triggers, participant_ids=("emma", "alex"),
        action_ids=("a-emma", "a-alex"), occurred_at=NOW, source_key=source,
        location_id="h:living-room", resource_kind="television" if kind == "person_resource" else None,
        resource_id="h:television" if kind == "person_resource" else None,
        facts={"household_id": "h", "recurrence_count": recurrence},
        profiles=profiles, relationships=relationships,
    )
    assert collision is not None
    return collision


def make_action():
    return LifeAction(
        id="action-read", player_id="p", npc_id="emma", action_type="read",
        status="performing", desire_id="d", commitment_id="c",
        location_id="city_library", target_resource_id=None, target_npc_id=None,
        planned_at=NOW, duration_seconds=60, interruptible=True,
        animation_cue="crouch", collision_hooks=("quiet_company",),
        need_deltas={"fun": 10}, emotion_deltas={"stress": -3}, resource_deltas={},
        started_at=NOW, ends_at=NOW + timedelta(seconds=60),
    )


def test_friendly_collision_becomes_a_moment_not_a_forced_incident():
    collision = make_collision()
    resolution = resolve_collision_autonomously(collision, settled_at=NOW)
    classification = classify_story(collision, resolution)
    assert classification.level == "moment"
    assert classification.moment_score >= 34
    assert classification.incident_score < 48


def test_moment_settlement_is_independent_from_its_minimum_presentation_ttl():
    collision = make_collision()
    resolution = resolve_collision_autonomously(collision, settled_at=NOW)
    story = story_from_collision(collision, resolution, now=NOW)

    assert story.level == "moment"
    assert story.auto_resolve_at == NOW
    assert story.presentation_expires_at == NOW + timedelta(seconds=180)
    settled = settle_story_autonomously(
        story, collision=collision, resolution=resolution, now=NOW,
    )
    assert settled.changed and settled.story.status == "resolved_autonomously"
    assert settled.story.is_presentable(now=NOW + timedelta(hours=1))

    observed = observe_story(settled.story, observed_at=NOW + timedelta(seconds=30))
    assert observed.is_presentable(now=NOW + timedelta(seconds=179))
    assert not observed.is_presentable(now=NOW + timedelta(seconds=180))


def test_severe_or_repeated_collision_becomes_incident_or_thread():
    severe = make_collision(kind="person_responsibility", triggers=("care_imbalance",),
                            source="severe", recurrence=6, severe=True)
    resolution = resolve_collision_autonomously(severe, settled_at=NOW)
    incident = classify_story(severe, resolution)
    assert incident.level == "incident"

    threaded = classify_story(severe, resolution, StoryContext(
        recurrence_count=3, existing_thread_id=severe.thread_key,
        existing_thread_intensity=60,
    ))
    assert threaded.level == "thread"
    assert "existing_thread_advanced" in threaded.reasons


def test_default_incident_management_window_is_stably_ten_to_fifteen_minutes():
    collision = make_collision(kind="person_responsibility", triggers=("care_imbalance",),
                               source="default-window", recurrence=6, severe=True)
    resolution = resolve_collision_autonomously(collision, settled_at=NOW)
    first = story_from_collision(collision, resolution, now=NOW)
    replay = story_from_collision(collision, resolution, now=NOW)

    assert first == replay
    assert first.intervention_expires_at is not None
    seconds = (first.intervention_expires_at - NOW).total_seconds()
    assert 10 * 60 <= seconds <= 15 * 60
    assert first.auto_resolve_at == first.intervention_expires_at


def test_observation_only_marks_seen_and_never_settles_the_story():
    collision = make_collision(kind="person_responsibility", triggers=("care_imbalance",),
                               source="observe", recurrence=6, severe=True)
    resolution = resolve_collision_autonomously(collision, settled_at=NOW)
    story = story_from_collision(collision, resolution, now=NOW, intervention_seconds=90)
    assert story.status == "intervention_window"
    observed = observe_story(story, observed_at=NOW + timedelta(seconds=5))
    assert observed.observed_at == NOW + timedelta(seconds=5)
    assert observed.status == "intervention_window"
    assert observed.resolution_id is None
    assert observe_story(observed, observed_at=NOW + timedelta(seconds=10)) == observed


def test_autonomous_settlement_waits_for_deadline_and_is_effect_idempotent():
    collision = make_collision(kind="person_responsibility", triggers=("care_imbalance",),
                               source="autonomous", recurrence=6, severe=True)
    resolution = resolve_collision_autonomously(collision, settled_at=NOW)
    story = story_from_collision(collision, resolution, now=NOW, intervention_seconds=60)
    pending = settle_story_autonomously(story, collision=collision, resolution=resolution,
                                        now=NOW + timedelta(seconds=59))
    assert not pending.changed and pending.mode == "pending"

    settled = settle_story_autonomously(story, collision=collision, resolution=resolution,
                                        now=NOW + timedelta(seconds=61))
    assert settled.changed and settled.story.status == "resolved_autonomously"
    assert settled.relationship_changes == resolution.relationship_changes
    assert settled.memory_seeds == resolution.memory_seeds
    assert settled.thread is not None
    replay = settle_story_autonomously(settled.story, collision=collision, resolution=resolution,
                                       now=NOW + timedelta(days=1), existing_thread=settled.thread)
    assert not replay.changed
    assert replay.relationship_changes == () and replay.memory_seeds == ()


def test_thread_upsert_uses_stable_topic_key_and_deduplicates_same_story():
    first_collision = make_collision(kind="person_responsibility", triggers=("dishwashing_thread",),
                                     source="dishes-1", recurrence=2)
    first_resolution = resolve_collision_autonomously(first_collision, settled_at=NOW)
    first_story = story_from_collision(first_collision, first_resolution, now=NOW)
    thread = update_unresolved_thread(None, story=first_story, collision=first_collision,
                                      resolution=first_resolution, now=NOW)
    assert thread and thread.recurrence_count == 1
    duplicate = update_unresolved_thread(thread, story=first_story, collision=first_collision,
                                         resolution=first_resolution, now=NOW + timedelta(seconds=1))
    assert duplicate == thread

    next_collision = make_collision(kind="person_responsibility", triggers=("dishwashing_thread",),
                                    source="dishes-2", recurrence=3)
    assert next_collision.thread_key == first_collision.thread_key
    next_resolution = resolve_collision_autonomously(next_collision, settled_at=NOW + timedelta(days=1))
    next_story = story_from_collision(next_collision, next_resolution, now=NOW + timedelta(days=1),
                                      context=StoryContext(existing_thread_id=thread.id,
                                                           recurrence_count=thread.recurrence_count,
                                                           existing_thread_intensity=thread.intensity))
    advanced = update_unresolved_thread(thread, story=next_story, collision=next_collision,
                                        resolution=next_resolution, now=NOW + timedelta(days=1))
    assert advanced and advanced.id == thread.id
    assert advanced.recurrence_count == 2
    assert len(advanced.source_story_ids) == 2


def test_ambient_action_stays_out_of_incident_flow_and_settles_to_summary():
    action = make_action()
    story = story_from_action(action)
    assert story.level == "ambient" and not story.trouble_signal
    assert story.visible_facts["visible_intent"] == "Reading"
    assert LifeStory.from_dict(story.to_dict()) == story
    pending = settle_story_autonomously(story, collision=None, resolution=None, now=NOW)
    assert not pending.changed
    completed = settle_story_autonomously(story, collision=None, resolution=None,
                                          now=NOW + timedelta(seconds=61))
    assert completed.changed and completed.story.status == "resolved_autonomously"
    assert completed.observable_aftermath[0]["kind"] == "ambient_summary"


def test_management_uses_precomputed_participant_reactions_and_is_replay_safe():
    collision = make_collision(kind="person_responsibility", triggers=("care_imbalance",),
                               source="managed", recurrence=7, severe=True)
    resolution = resolve_collision_autonomously(collision, settled_at=NOW)
    story = story_from_collision(collision, resolution, now=NOW, intervention_seconds=120)
    settled = settle_story_with_management(
        story, action="mediate", participant_acceptance={"emma": "accept", "alex": "refuse"},
        now=NOW + timedelta(seconds=30), base_resolution=resolution,
    )
    assert settled.changed and settled.story.status == "resolved_with_management"
    assert settled.observable_aftermath[0]["outcome"] == "mixed"
    replay = settle_story_with_management(
        settled.story, action="mediate", participant_acceptance={"emma": "accept", "alex": "refuse"},
        now=NOW + timedelta(seconds=31), base_resolution=resolution,
    )
    assert not replay.changed


def test_management_action_and_each_participants_reaction_change_rule_owned_consequences():
    collision = make_collision(kind="person_responsibility", triggers=("care_imbalance",),
                               source="managed-effects", recurrence=7, severe=True)
    resolution = resolve_collision_autonomously(collision, settled_at=NOW)
    story = story_from_collision(collision, resolution, now=NOW, intervention_seconds=120)

    comfort = settle_story_with_management(
        story, action="comfort",
        participant_acceptance={"emma": "accept", "alex": "accept_later"},
        now=NOW + timedelta(seconds=10), base_resolution=resolution,
    )
    mediate = settle_story_with_management(
        story, action="mediate",
        participant_acceptance={"emma": "accept", "alex": "accept_later"},
        now=NOW + timedelta(seconds=10), base_resolution=resolution,
    )
    backfire = settle_story_with_management(
        story, action="comfort",
        participant_acceptance={"emma": "accept", "alex": "backfire"},
        now=NOW + timedelta(seconds=10), base_resolution=resolution,
    )

    assert comfort.relationship_changes != mediate.relationship_changes
    assert comfort.relationship_changes != backfire.relationship_changes
    assert "cooperation" in comfort.outcome_tags
    assert "conflict" in backfire.outcome_tags
    assert backfire.action_instructions != comfort.action_instructions
    assert {item["npc_id"] for item in comfort.memory_seeds} == {"emma", "alex"}


def test_misunderstood_is_distinct_from_refusal_and_backfire():
    collision = make_collision(
        kind="person_responsibility", triggers=("care_imbalance",),
        source="managed-misunderstanding", recurrence=7, severe=True,
    )
    resolution = resolve_collision_autonomously(collision, settled_at=NOW)
    story = story_from_collision(collision, resolution, now=NOW, intervention_seconds=120)

    misunderstood = settle_story_with_management(
        story, action="give_space",
        participant_acceptance={"emma": "misunderstood", "alex": "misunderstood"},
        now=NOW + timedelta(seconds=10), base_resolution=resolution,
    )
    refused = settle_story_with_management(
        story, action="give_space",
        participant_acceptance={"emma": "refuse", "alex": "refuse"},
        now=NOW + timedelta(seconds=10), base_resolution=resolution,
    )

    aftermath = misunderstood.observable_aftermath[0]
    assert aftermath["outcome"] == "misunderstood"
    assert "misunderstanding" in misunderstood.outcome_tags
    assert "conflict" not in misunderstood.outcome_tags
    assert misunderstood.relationship_changes != refused.relationship_changes
    assert all("misunderstood" in item["content_seed"] for item in misunderstood.memory_seeds)


def test_relationship_labels_allow_friendship_conflict_and_romance_to_coexist():
    labels = derive_relationship_labels({
        "familiarity": 82, "trust": 75, "affinity": 76, "comfort": 62,
        "tension": 66, "resentment": 74, "attraction": 70,
        "romance_status": "none",
    }, open_thread_count=2)
    assert labels == {
        "bond_status": "close_friend",
        "conflict_status": "hostile",
        "romance_status": "curious",
    }
    distant = derive_relationship_labels({
        "familiarity": 50, "trust": 10, "affinity": 12, "comfort": 10,
        "tension": 10, "resentment": 10,
    })
    assert distant["bond_status"] == "distant"
    assert distant["conflict_status"] == "none"
