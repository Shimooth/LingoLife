from __future__ import annotations

from lingolife.life_service import select_story_attention, story_attention_budget


def _story(story_id: str, *, title: str, level: str = "moment",
           updated_at: str = "2026-09-04T10:00:00+00:00", status: str = "open",
           trouble: bool = False):
    return {
        "id": story_id,
        "title": title,
        "level": level,
        "status": status,
        "updated_at": updated_at,
        "trouble_signal": ({"severity": "high"} if trouble else None),
        "presentation": {"subject": f"{title} · Home"},
    }


def test_story_attention_budget_scales_sublinearly_for_two_four_and_eight_residents():
    two = story_attention_budget(2)
    four = story_attention_budget(4)
    eight = story_attention_budget(8)

    assert [value["resident_count"] for value in (two, four, eight)] == [2, 4, 8]
    for key in ("incidents", "moments", "threads", "aftermath"):
        assert two["desktop"][key] <= four["desktop"][key] <= eight["desktop"][key]
        assert two["compact"][key] <= four["compact"][key] <= eight["compact"][key]
        assert all(value["compact"][key] <= value["desktop"][key]
                   for value in (two, four, eight))
    # Eight residents can form 28 pairs; the public feed still stays bounded.
    assert eight["desktop"]["incidents"] < 8 * 7 // 2
    assert eight["desktop"]["moments"] <= 12


def test_attention_selector_keeps_every_urgent_incident_ahead_of_ambient_noise():
    values = [
        _story("ambient-new", title="A routine", updated_at="2026-09-04T12:00:00+00:00"),
        _story("urgent-a", title="Privacy", level="incident",
               status="awaiting_management", trouble=True),
        _story("urgent-b", title="Noise", level="incident",
               status="awaiting_management", trouble=True),
    ]

    selected = select_story_attention(values, 1, preserve_urgent=True)

    assert {value["id"] for value in selected} == {"urgent-a", "urgent-b"}
    assert all(value["status"] == "awaiting_management" for value in selected)


def test_attention_selector_balances_strength_recency_and_topic_repetition():
    values = [
        _story("kitchen-new", title="Busy kitchen",
               updated_at="2026-09-04T12:00:00+00:00"),
        _story("kitchen-old", title="Busy kitchen",
               updated_at="2026-09-04T11:00:00+00:00"),
        _story("quiet-company", title="A little company",
               updated_at="2026-09-04T10:00:00+00:00"),
        _story("strong-incident", title="A boundary", level="incident",
               updated_at="2026-09-03T10:00:00+00:00"),
    ]

    selected = select_story_attention(values, 3)

    assert selected[0]["id"] == "strong-incident"
    assert {value["id"] for value in selected[1:]} == {"kitchen-new", "quiet-company"}
