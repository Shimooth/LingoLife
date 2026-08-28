from datetime import date, datetime, timedelta, timezone

from lingolife.agent import (advance_goal, advance_relationship, advance_runtime,
                             compile_goal, compile_persona, daily_plan,
                             dialogue_objective, initial_relationship, initial_runtime,
                             project_dialogue_agent, project_public_agent)


def profile(**overrides):
    return {"name": "Lisa", "relationship": "Friend", "occupation": "Music producer",
            "personality": ["introverted", "creative", "witty"],
            "interests": ["music", "photography"], "longTermGoal": "Hold a personal concert",
            **overrides}


def test_persona_compiler_turns_traits_into_stable_behavior_contract():
    first = compile_persona(profile())
    second = compile_persona(profile())
    assert first == second
    assert first["axes"]["extraversion"] < 40
    assert first["axes"]["openness"] > 70
    assert first["voice"]["question_frequency"] == "low"
    assert first["behavior"]["initiative"] == "low"
    assert compile_persona(profile(personality=["outgoing", "warm"]))["version"] != first["version"]


def test_lazy_runtime_progression_is_bounded_and_models_offline_life():
    now = datetime(2026, 8, 19, tzinfo=timezone.utc)
    state = initial_runtime(55, 40, now - timedelta(days=30))
    advanced = advance_runtime(state, profile(), 55, now)
    assert all(0 <= value <= 100 for value in advanced["needs"].values())
    assert all(0 <= value <= 100 for value in advanced["emotion"].values())
    assert advanced["last_simulated_at"] == now.isoformat()


def test_agent_projections_coarsen_observable_state_and_drop_authoritative_internals():
    bundle = {
        "persona": {"version": "persona-v1", "voice": {"directness": "gentle"}},
        "runtime_state": {
            "emotion": {"valence": 81, "stress": 57, "energy": 28},
            "needs": {"food": 18, "rest": 51, "social": 76, "achievement": 42,
                      "fun": 88, "love": 3, "privacy": 9, "security": 11},
            "active_desire_ids": ["desire-secret"],
            "current_commitment_id": "commitment-secret",
            "queued_commitment_id": "queued-secret",
            "growth": {"warmth": 4.25},
            "last_simulated_at": "2026-08-28T00:00:00+00:00",
        },
        "relationship": {"stage": "friend", "trust": 63, "closeness": 57},
        "goal": {"title": "Make an album"}, "daily_plan": {"slots": {}},
        "current_slot": "afternoon", "language_controller": {"estimated_level": "A2"},
        "animation_cue": "talk", "internal_seed": "never-public",
    }

    public = project_public_agent(bundle)
    assert public["runtime_state"] == {
        "emotion": {"valence": "bright", "stress": "tense", "energy": "tired"},
        "needs": {"food": "urgent", "rest": "steady", "social": "comfortable",
                  "achievement": "strained", "fun": "comfortable"},
    }
    assert "internal_seed" not in public
    assert bundle["runtime_state"]["needs"]["love"] == 3

    dialogue = project_dialogue_agent(bundle)
    assert dialogue["relationship"] == {"stage": "friend"}
    assert dialogue["runtime_state"] == public["runtime_state"]
    assert project_public_agent(public) == public

    # A private need may affect autonomous rules, but must not name itself in
    # the external dialogue objective.
    objective = dialogue_objective(
        None, bundle["runtime_state"], {"title": "Make an album", "milestones": []},
        bundle["relationship"],
    )
    assert "love" not in objective and "privacy" not in objective and "security" not in objective


def test_relationship_goal_and_schedule_have_rule_owned_progression():
    relationship = advance_relationship(initial_relationship(35), 3, ["empathy", "honesty"])
    assert relationship["trust"] > 28 and relationship["stage"] in {"acquaintance", "friend"}
    goal = compile_goal(profile())
    assert "concert" in goal["title"].lower() and len(goal["milestones"]) == 4
    progressed = advance_goal(advance_goal(goal, 15), 15)
    assert progressed["milestones"][0]["status"] == "completed"
    runtime = initial_runtime(50, 35)
    plan = daily_plan("p", "lisa", profile(), runtime, progressed, date(2026, 8, 19))
    assert set(plan["slots"]) == {"morning", "afternoon", "evening"}
    assert plan["slots"]["morning"]["location_id"] == "music_hall"
