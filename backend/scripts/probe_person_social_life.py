"""用虚构居民观察生活模拟，不访问账号、数据库或 AI。

运行：PYTHONPATH=backend backend/.runtime/.venv/bin/python \
    backend/scripts/probe_person_social_life.py --hours 48
统计是模拟回归依据，不是线上玩家体验或模型对白质量的证明。
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
import json
from time import perf_counter

from lingolife.life import CORE_NEEDS
from lingolife.life_world import LifeWorldEngine


def probe(hours: int, population: int, seed: str) -> dict:
    cast = [
        {"name": "Nora", "personality": ["温暖", "认真", "直接"],
         "interests": ["咖啡", "烹饪"], "habits": ["给室友做饭"],
         "householdRole": "caretaker", "longTermGoal": "学会做新的菜",
         "boundaries": ["借我的东西之前先问我"], "values": ["fairness", "care"]},
        {"name": "Aria", "personality": ["内向", "敏感", "独立"],
         "interests": ["茶", "阅读"], "habits": ["喜欢安静地看书"],
         "householdRole": "free_spirit", "longTermGoal": "完成自己的阅读计划",
         "boundaries": ["需要独处时不要打扰"], "values": ["autonomy", "belonging"]},
        {"name": "Charles", "personality": ["外向", "幽默", "随性"],
         "interests": ["咖啡", "音乐"], "habits": ["遇到熟人会打招呼"],
         "householdRole": "mediator", "longTermGoal": "和朋友一起练音乐",
         "boundaries": ["不要把别人的秘密说出去"], "values": ["care", "belonging"]},
        {"name": "Jun", "personality": ["好胜", "务实", "直接"],
         "interests": ["音乐", "烹饪"], "habits": ["把事情做好后再休息"],
         "householdRole": "fixer", "longTermGoal": "练好自己的手艺",
         "boundaries": ["尊重已经说好的安排"], "values": ["achievement", "fairness"]},
    ]
    profiles = {f"resident-{i}": {**cast[i % len(cast)], "age": 26,
                "romanceEnabled": False} for i in range(population)}
    homes = {key: {"household_id": "probe-house", "location_id": "home-shared"}
             for key in profiles}
    seeds = {key: {"needs": {**{need: 80 for need in CORE_NEEDS}, "social": 28},
                   "emotion": {"stress": 25, "energy": 80, "valence": 60}}
             for key in profiles}
    now = datetime(2026, 9, 25, 8, tzinfo=timezone.utc)
    engine = LifeWorldEngine(timezone_name="UTC")
    start = perf_counter()
    state = engine.initialize(seed, profiles, homes, seeds, now=now)
    initial_topics = Counter((r.get("collision") or {}).get("topic", "solo")
                             for r in state["stories"].values())
    state = engine.advance(state, profiles, now=now + timedelta(hours=hours))
    records = list(state["stories"].values())
    topics = Counter((r.get("collision") or {}).get("topic", "solo") for r in records)
    continuity = state.get("social_continuity") or {}
    concerns = [item for values in (continuity.get("concerns") or {}).values() for item in values]
    receipts = list((continuity.get("receipts") or {}).values())
    mind = state.get("social_mind") or {}
    return {
        "seed": seed, "population": population, "simulated_hours": hours,
        "elapsed_seconds": round(perf_counter() - start, 3),
        "initial_topics": dict(initial_topics),
        "completed_actions": state["metrics"]["completed_actions"],
        "collision_stories_created": state["metrics"]["stories"],
        "retained_stories": len(records), "retained_topics": dict(topics),
        "total_topic_counts": state["metrics"].get("topic_counts", {}),
        "concern_statuses": dict(Counter(item["status"] for item in concerns)),
        "receipt_statuses": dict(Counter(item["status"] for item in receipts)),
        "mind_fact_count": len(mind.get("facts") or {}),
        "saved_state_bytes": len(json.dumps(state, ensure_ascii=False).encode()),
        "note": "虚构世界、规则模拟；无真实账号、网络或模型调用。保留历史数量受容量限制。",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hours", type=int, default=48, choices=range(1, 169), metavar="1..168")
    parser.add_argument("--residents", type=int, default=4, choices=range(2, 9))
    parser.add_argument("--seed", default="social-person-probe")
    args = parser.parse_args()
    print(json.dumps(probe(args.hours, args.residents, args.seed), ensure_ascii=False, indent=2))
