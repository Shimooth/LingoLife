from __future__ import annotations

import json

from lingolife.db import Database
from lingolife.life_service import LifeWorldService


NOW = "2040-01-01T10:00:00+00:00"


def _service(tmp_path) -> LifeWorldService:
    return LifeWorldService(Database(f"sqlite:///{tmp_path / 'story-presentation.db'}"), "UTC")


def _profiles() -> list[dict]:
    return [
        {"id": "ava", "profile": {"name": "Ava"}},
        {"id": "bo", "profile": {"name": "Bo"}},
    ]


def _record(story_id: str, topic: str, *, status: str = "intervention_window",
            actions: list[str] | None = None, visible_facts: dict | None = None,
            location_id: str = "moonlight_cafe", resource_id: str | None = None,
            relationship_changes: list[dict] | None = None) -> dict:
    return {
        "story": {
            "id": story_id,
            "level": "incident",
            "status": status,
            "observable": True,
            "trouble_signal": status == "intervention_window",
            "participant_ids": ["ava", "bo"],
            "location_id": location_id,
            "created_at": NOW,
            "updated_at": NOW,
            "observed_at": None,
            "intervention_expires_at": "2040-01-01T10:15:00+00:00",
            "intervention_actions": actions or [],
            "visible_facts": {"topic": topic, "severity_band": "medium", **(visible_facts or {})},
        },
        "collision": {
            "id": f"collision-{story_id}",
            "scenario_id": f"scenario-{topic}",
            "topic": topic,
            "participant_ids": ["ava", "bo"],
            "location_id": location_id,
            "resource_id": resource_id,
        },
        "resolution": {
            "relationship_changes": relationship_changes or [],
            "severity_before": 52,
            "severity_after": 38,
        },
    }


def _state(records: list[dict]) -> dict:
    return {
        "stories": {record["story"]["id"]: record for record in records},
        "residents": {
            "ava": {"household_id": "household-a"},
            "bo": {"household_id": "household-b"},
        },
        "resources": [],
        "relationships": {},
        "interventions": {},
        "aftermath": [],
    }


def _forbidden_payload_terms(value: dict) -> set[str]:
    serialized = json.dumps(value, ensure_ascii=False).casefold()
    forbidden = {"attraction", "crush", "mutual_interest", "response_preview", '"needs"', "privacy_need"}
    return {term for term in forbidden if term in serialized}


def test_friendship_conflict_and_romance_candidates_have_specific_bilingual_playable_scenes(tmp_path):
    service = _service(tmp_path)
    friendship = _record(
        "story-friendship", "companionship",
        actions=["ask", "comfort", "let_them_handle_it"],
    )
    conflict = _record(
        "story-conflict", "borrowed_property",
        actions=["mediate", "set_boundary", "give_space"],
        location_id="household-a:living-room",
    )
    romance = _record(
        "story-romance", "companionship",
        actions=["support_confession", "start_dating"],
        visible_facts={"relationship_development": True},
    )
    candidate_state = _state([friendship, conflict, romance])
    views = {view["id"]: view for view in service._story_views(
        candidate_state,
        {entry["id"]: entry["profile"] for entry in _profiles()},
    )}

    friend_view = views["story-friendship"]
    assert friend_view["title"] == "A little company"
    assert "Ava and Bo" in friend_view["summary"]
    assert "Ava、Bo" in friend_view["summary_zh"]
    assert friend_view["presentation"]["location"] == {
        "id": "moonlight_cafe", "label": "Moonlight Café", "label_zh": "月光咖啡馆",
    }
    assert [beat["speaker_id"] for beat in friend_view["presentation"]["beats"]] == ["ava", "bo"]
    assert all(beat["text"] and beat["translation_zh"] for beat in friend_view["presentation"]["beats"])

    conflict_view = views["story-conflict"]
    assert conflict_view["title_zh"] == "没有先问就借走了"
    assert conflict_view["presentation"]["location"]["label_zh"] == "居民住宅"
    assert "界限" in conflict_view["management"]["prompt_zh"]
    boundary = next(option for option in conflict_view["management"]["actions"]
                    if option["id"] == "set_boundary")
    assert boundary["label"] and boundary["label_zh"]
    assert boundary["description"] and boundary["description_zh"]
    assert boundary["intent"] == "boundary"
    assert all(not any(character.isdigit() for character in option["description"])
               for view in views.values() for option in view["management"]["actions"])

    romance_view = views["story-romance"]
    assert romance_view["title"] == "Could this be something more?"
    dating = next(option for option in romance_view["management"]["actions"]
                  if option["id"] == "start_dating")
    assert "mutual choice" in dating["description"]
    assert "双方" in dating["description_zh"]
    assert romance_view["outcome"] is None
    assert romance_view["consequences"] == []
    assert not _forbidden_payload_terms(romance_view)
    assert service.story("player-story", _profiles(), "story-romance",
                         state=candidate_state) == romance_view


def test_terminal_management_and_romance_views_expose_settled_aftermath_without_scores(tmp_path):
    service = _service(tmp_path)
    conflict = _record(
        "story-managed", "dishwashing", status="resolved_with_management",
        relationship_changes=[
            {"npc_a": "ava", "npc_b": "bo", "trust": 2, "tension": -1},
            {"npc_a": "bo", "npc_b": "ava", "comfort": -1, "tension": 2,
             "attraction": 99, "dependency": 40},
        ],
        location_id="household-a:shared-kitchen",
    )
    romance = _record(
        "story-dating", "companionship", status="resolved_with_management",
        visible_facts={"relationship_development": True, "relationship_state": "dating"},
    )
    food = _record(
        "story-food", "food_shortage", status="resolved_autonomously",
        location_id="household-a:shared-kitchen", resource_id="food-stock-a",
    )
    state = _state([conflict, romance, food])
    state["interventions"] = {
        "story-managed:req": {"story_id": "story-managed", "action": "mediate",
                              "outcome": "backfired", "applied_at": NOW},
        "story-dating:req": {"story_id": "story-dating", "action": "start_dating",
                             "outcome": "accepted", "applied_at": NOW},
    }
    state["aftermath"] = [
        {"kind": "management_aftermath", "story_id": "story-managed", "action": "mediate",
         "outcome": "backfired", "participant_acceptance": {"ava": "accept", "bo": "backfire"}},
        {"kind": "relationship_transition", "story_id": "story-dating",
         "participant_ids": ["ava", "bo"], "channel": "romance", "state": "dating"},
        {"kind": "resource_restock", "story_id": "story-food", "resource_id": "food-stock-a",
         "stock_before": 0, "stock_after": 70},
    ]
    # Applied evidence wins over the original/base resolution when presenting
    # the managed consequence. Hidden dimensions are deliberately ignored.
    state["relationship_evidence"] = [{
        "fact_id": "story-managed", "deltas": {"tension": 3, "attraction": 99},
    }]
    views = {view["id"]: view for view in service._story_views(
        state, {entry["id"]: entry["profile"] for entry in _profiles()},
    )}

    managed = views["story-managed"]
    assert managed["outcome"]["mode"] == "managed"
    assert managed["outcome"]["selected_action"] == "mediate"
    assert managed["outcome"]["result"] == "backfired"
    assert managed["outcome"]["tone"] == "negative"
    assert "made the situation harder" in managed["aftermath"]
    assert "更难处理" in managed["aftermath_zh"]
    assert {(reaction["npc_id"], reaction["reaction"]) for reaction in managed["participant_reactions"]} == {
        ("ava", "accept"), ("bo", "backfire"),
    }
    assert {value["kind"] for value in managed["consequences"]} >= {"relationship", "wellbeing"}
    assert next(value for value in managed["consequences"]
                if value["kind"] == "relationship")["tone"] == "negative"
    assert managed["aftermath"] and managed["aftermath_zh"]
    assert managed["presentation"]["beats"][-1]["phase"] == "aftermath"
    assert not _forbidden_payload_terms(managed)

    dating = views["story-dating"]
    assert dating["title"] == "A new relationship"
    assert dating["outcome"]["result"] == "accepted"
    assert "begin dating" in dating["aftermath"]
    assert {value["reaction"] for value in dating["participant_reactions"]} == {"mutual_choice"}
    assert any(value["kind"] == "relationship" and value["tone"] == "positive"
               for value in dating["consequences"])
    assert not _forbidden_payload_terms(dating)

    restocked = views["story-food"]
    assert restocked["outcome"]["mode"] == "autonomous"
    assert any(value["kind"] == "resource" and "replenished" in value["text"]
               for value in restocked["consequences"])
    assert any(value["kind"] == "wellbeing" for value in restocked["consequences"])
