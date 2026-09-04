from copy import deepcopy

from lingolife.disclosure import decide_trouble_disclosure
from lingolife.relationships import RelationshipPair


def _profile(*traits: str, privacy="balanced", boundaries=()):
    return {
        "name": "Resident", "age": 28, "occupation": "Designer",
        "personality": list(traits), "interests": ["art"],
        "privateSpacePreference": privacy, "boundaries": list(boundaries),
    }


def _resident(*, trust=30, familiarity=20, stress=38):
    return {
        "player_connection": {"trust": trust, "familiarity": familiarity},
        "runtime": {"emotion": {"stress": stress}},
    }


def _relationship(first: str, second: str, *, trust: int, comfort: int):
    pair = RelationshipPair.initial(first, second)
    pair.edge(first, second).trust = trust
    pair.edge(first, second).comfort = comfort
    return pair.to_dict()


def test_open_resident_with_player_trust_exposes_a_live_problem():
    decision = decide_trouble_disclosure(
        participant_ids=["maya"],
        profiles={"maya": _profile("warm", "outgoing", privacy="low")},
        residents={"maya": _resident(trust=72, familiarity=68)},
        relationships={}, severity=58, story_key="story-open",
    )
    assert decision.player_visible_npc_ids == ("maya",)
    assert decision.resident_confidants == {}


def test_guarded_resident_prefers_a_trusted_housemate_over_a_player_marker():
    decision = decide_trouble_disclosure(
        participant_ids=["jun"],
        profiles={
            "jun": _profile("quiet", "introverted", privacy="high",
                            boundaries=("give me private space", "keep secrets private")),
            "maya": _profile("warm", "outgoing"),
        },
        residents={"jun": _resident(trust=22, familiarity=18)},
        relationships={"jun:maya": _relationship("jun", "maya", trust=84, comfort=77)},
        severity=52, story_key="story-confidant",
    )
    assert not decision.player_visible
    assert decision.resident_confidants == {"jun": "maya"}


def test_hidden_incident_does_not_become_visible_merely_by_repeating_the_call():
    arguments = {
        "participant_ids": ["iris"],
        "profiles": {"iris": _profile("quiet", privacy="high", boundaries=("privacy",))},
        "residents": {"iris": _resident(trust=8, familiarity=5, stress=28)},
        "relationships": {}, "severity": 35, "story_key": "stable-hidden-story",
    }
    first = decide_trouble_disclosure(**deepcopy(arguments))
    second = decide_trouble_disclosure(**deepcopy(arguments))
    assert first == second
    assert not first.player_visible
    assert first.hidden_npc_ids == ("iris",)


def test_high_urgency_can_outweigh_selective_disclosure_without_forcing_everyone_visible():
    decision = decide_trouble_disclosure(
        participant_ids=["aria", "jun"],
        profiles={
            "aria": _profile("decisive", "warm", "outgoing"),
            "jun": _profile("quiet", "introverted", privacy="high", boundaries=("private space",)),
        },
        residents={
            "aria": _resident(trust=52, familiarity=44, stress=82),
            "jun": _resident(trust=5, familiarity=4, stress=25),
        },
        relationships={}, severity=88, story_key="urgent-story",
    )
    assert "aria" in decision.player_visible_npc_ids
    assert "jun" not in decision.player_visible_npc_ids
