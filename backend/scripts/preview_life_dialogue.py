"""Explicit live QA using synthetic adults and an IN-MEMORY database only.

Run from backend: PYTHONPATH=. .venv/bin/python scripts/preview_life_dialogue.py --live
At most five scenes/openings, two attempts each. No player save is opened.
"""
from __future__ import annotations

import argparse
from dataclasses import replace
import json
import os
from pathlib import Path
import re
import shlex
import sys

from lingolife.ai import DeepSeekProvider
from lingolife.config import load_settings
from lingolife.db import Database
from lingolife.life_expression import LifeExpressionService


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true", help="Explicitly allow a small paid API sample")
    parser.add_argument("--borrowing", action="store_true", help="只检查三种借物冲突，最多六次模型调用")
    args = parser.parse_args()
    if not args.live:
        parser.error("Use --live to explicitly allow synthetic API samples")
    root = Path(__file__).resolve().parents[2]
    # Read only this one key as data; never source/evaluate a shell file or
    # load DATABASE_URL from it. No extra dotenv dependency is required.
    if not os.getenv("DEEPSEEK_API_KEY") and (root / ".env").is_file():
        for line in (root / ".env").read_text().splitlines():
            match = re.fullmatch(r"\s*(?:export\s+)?DEEPSEEK_API_KEY\s*=\s*(.*)", line)
            if match:
                values = shlex.split(match.group(1), comments=True)
                if len(values) == 1:
                    os.environ["DEEPSEEK_API_KEY"] = values[0]
    settings = replace(load_settings(str(root / "config/lingolife.example.yaml")),
                       expression_daily_limit=10, expression_global_daily_limit=10)
    if not settings.deepseek_api_key or settings.deepseek_api_key == "replace-me":
        print("Live sample skipped: API key unavailable. No request made.")
        return 2
    service = LifeExpressionService(Database("sqlite:///:memory:"), DeepSeekProvider(settings), settings)
    profiles = {
        "guai": {"name": "Guai", "age": 26, "personality": ["quiet", "dry humour", "protective of alone time"], "interests": ["cooking", "mystery novels"], "quirks": ["hates being interrupted halfway through a task"]},
        "charles": {"name": "Charles", "age": 28, "personality": ["chatty", "playful", "a little impatient"], "interests": ["music", "cycling"], "quirks": ["teases friends, but respects a clear no"]},
    }
    cases = [
        ("blocked", ["guai"], "blocked_plan", "facility_unavailable", {"resource_kind": "library"},
         "Guai arrived at the library and found it closed.", "Guai 到了图书馆，发现没有开门。", {"guai": "ask_for_help"}),
        ("meal", ["guai", "charles"], "shared_food", "shared_food_consumed", {"prepared_by": "guai", "consumed_by": "charles"},
         "Charles has finished a portion of food Guai prepared.", "Charles 已吃完 Guai 做的一份饭。", {"guai": "share_food_together", "charles": "accept_shared_food"}),
        ("visit", ["charles", "guai"], "missed_connection", "resident_unavailable", {"initiator_id": "charles", "target_id": "guai", "target_busy": True},
         "Charles came to talk, but Guai is busy and needs some space.", "Charles 来聊天，但 Guai 正忙，需要一点空间。", {"charles": "try_later", "guai": "try_later"}),
    ]
    reports = []
    if args.borrowing:
        cases = [
            ("borrow-apology", ["charles", "guai"], "borrowed_property", "borrowed_item_boundary",
             {"kind": "borrowed_item", "actor_id": "charles", "affected_id": "guai", "item_kind": "hobby_supplies"},
             "Charles borrowed Guai's hobby supplies without asking.", "Charles 没问就借走了 Guai 的兴趣用品。",
             {"charles": "return_and_apologize", "guai": "ask_item_back"}),
            ("borrow-request", ["guai", "charles"], "borrowed_property", "borrowed_item_boundary",
             {"kind": "borrowed_item", "actor_id": "guai", "affected_id": "charles", "item_kind": "personal_belonging"},
             "Guai borrowed a personal item belonging to Charles without asking.", "Guai 没问就借走了 Charles 的私人物品。",
             {"guai": "ask_retroactively", "charles": "allow_with_reminder"}),
            ("borrow-friction", ["charles", "guai"], "borrowed_property", "borrowed_item_boundary",
             {"kind": "borrowed_item", "actor_id": "charles", "affected_id": "guai", "item_kind": "personal_belonging"},
             "Charles borrowed a personal item belonging to Guai without asking.", "Charles 没问就借走了 Guai 的私人物品。",
             {"charles": "deny_responsibility", "guai": "state_borrowing_rule"}),
        ]
    for key, ids, topic, scenario, facts, en, zh, responses in cases:
        story = {"id": key, "participant_ids": ids, "summary": en, "summary_zh": zh,
                 "presentation": {"location": {"label": "Library" if key == "blocked" else "Shared home"}}}
        record = {"collision": {"topic": topic, "scenario_id": scenario, "facts": facts},
                  "resolution": {"response_by_participant": responses},
                  "interaction": {"relationship_context": {"closeness": "familiar", "tension": "calm"}}}
        if args.borrowing:
            record["collision"]["facts"].update(item_label="portable charger", item_label_zh="充电宝")
            story["outcome"] = {"mode": "autonomous", "aftermath": "Some tension remains.", "aftermath_zh": "还有一些不快。"}
            record["interaction"]["relationship_context"]["tension"] = "tense"
        result = service.scene("synthetic-qa", story, record, profiles)
        reports.append({"case": key, "source": result["source"], "ending": result["ending_reason"],
                        "beats": [{key: beat[key] for key in ("speaker_id", "addressee_id", "text", "translation_zh")} for beat in result["presentation"]["beats"]]})
    for npc_id in ([] if args.borrowing else profiles):
        context = {"current_action": {"type": "cook", "status": "performing", "visible_intent": "Preparing food in the shared kitchen."},
                   "conversation": {"id": "synthetic-opening-" + npc_id, "opening": {"text": "I'm preparing food.", "translation": "我在准备吃的。"}}}
        reports.append({"case": "opening-" + npc_id, **service.opening("synthetic-qa", npc_id, profiles[npc_id], context)})
    print(json.dumps(reports, ensure_ascii=False, indent=2))
    return 0 if all(report["source"] == "ai" for report in reports) else 1


if __name__ == "__main__":
    sys.exit(main())
