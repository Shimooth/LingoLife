"""First-city guided play, based exclusively on public, rule-owned stories.

Progress is metadata, never a command to manufacture or settle a life event.
One bounded public receipt survives story retention and cross-device resumes.
"""
from __future__ import annotations

from copy import deepcopy

TERMINAL = {"resolved_autonomously", "resolved_with_management", "closed"}


def initial_practice(status: str = "not_started") -> dict:
    return {"version": 1, "revision": 0, "status": status, "step": "discover",
            "npc_id": None, "story_id": None, "participation": None,
            "receipt": None}


def eligible(story: dict) -> bool:
    return (story.get("level") in {"moment", "incident"}
            and len(story.get("participant_ids", [])) >= 2)


def reconcile(progress: dict, stories: list[dict]) -> dict:
    result = deepcopy(progress)
    if result["status"] not in {"active", "paused"} or not result.get("story_id"):
        return result
    if result.get("receipt"):
        return result
    story = next((item for item in stories if item["id"] == result["story_id"]), None)
    if not story:
        # Retention / cast changes must not strand the guide on a missing event.
        result.update(story_id=None, participation=None, step="participate")
        return result
    managed = story.get("outcome", {}).get("mode") == "managed" if story.get("outcome") else False
    if managed:
        result["participation"] = "managed"
    elif story.get("observed_at"):
        result["participation"] = "observed"
    if result.get("participation") and story.get("status") in TERMINAL:
        result.update(step="result", receipt=deepcopy(story))
    return result


def transition(progress: dict, event: str, *, npc_id: str | None = None,
               story_id: str | None = None, resident_ids: list[str], stories: list[dict]) -> dict:
    result = reconcile(progress, stories)
    if event == "start":
        # Explicitly repeating the guide never repeats any world settlement.
        if result["status"] in {"not_started", "completed"}:
            result = {**initial_practice("active"), "revision": progress["revision"]}
        else:
            result["status"] = "active"
    elif event == "pause":
        if result["status"] == "active":
            result["status"] = "paused"
    elif event == "follow":
        if npc_id not in resident_ids:
            raise ValueError("resident not found")
        if result["status"] == "active" and result["step"] == "discover":
            result.update(step="participate", npc_id=npc_id)
    elif event == "select_story":
        story = next((item for item in stories if item["id"] == story_id and eligible(item)), None)
        if not story:
            raise ValueError("public two-resident story not found")
        if result["status"] == "active" and result["step"] == "participate":
            result.update(story_id=story_id, participation=None)
            result = reconcile(result, stories)
    elif event == "acknowledge_result":
        if story_id != result.get("story_id") or result["step"] not in {"result", "complete"} or not result.get("receipt"):
            raise ValueError("witness a settled outcome before completing the guide")
        result.update(status="completed", step="complete")
    else:
        raise ValueError("unknown practice event")
    return result


def practice_view(progress: dict, stories: list[dict]) -> dict:
    selected = progress.get("receipt") or next(
        (item for item in stories if item["id"] == progress.get("story_id")), None)
    candidates = [item for item in stories if eligible(item)]
    candidates.sort(key=lambda item: (
        item.get("status") == "awaiting_management" and bool(item.get("management", {}).get("can_intervene")),
        progress.get("npc_id") in item.get("participant_ids", []),
        item.get("status") not in TERMINAL,
        item.get("created_at", ""), item["id"],
    ), reverse=True)
    return {"progress": {key: value for key, value in progress.items() if key != "receipt"},
            "story": selected, "candidate": candidates[0] if candidates else None}
