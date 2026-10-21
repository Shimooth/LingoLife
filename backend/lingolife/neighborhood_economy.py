"""Small, durable community economy rules shared by the neighborhood service.

The wallet remains in arrival state. This module only describes community
projects and appends transaction entries; callers persist both in one database
transaction. Existing opening news is evidence of an already completed place.
"""
from __future__ import annotations

from datetime import datetime, time, timedelta, timezone


SUPPORT_AMOUNT = 30
CARE_REWARD = 10
SOCIAL_REWARD = 20
SOCIAL_DAILY_LIMIT = 3
PROJECTS = (
    {"id": "fountain", "cost": 40, "title": "Wishing fountain", "title_zh": "许愿喷泉",
     "news_id": "fountain-open", "news_title": "A place for little wishes", "news_title_zh": "许愿喷泉落成了",
     "body": "A resident asked for a place to pause. Your preparations have brought a wishing fountain to the square. Each care level brings one wish.",
     "body_zh": "居民希望有个可以停留、许愿的地方。你筹备的许愿喷泉已在广场落成；每次照料升级，都能来许一个愿。"},
    {"id": "clothing_store", "cost": 60, "title": "Neighborhood clothing shop", "title_zh": "社区服装店",
     "news_id": "clothing-open", "news_title": "A shop for meeting in style", "news_title_zh": "社区服装店开张了",
     "body": "Neighbors have begun spending time together and wanted new outfits for their outings. With your preparations complete, the clothing shop is open.",
     "body_zh": "邻居们开始一起聊天、出门，也想换身衣服赴约。你筹备的服装小店开张了，可以给奇趣换装居民挑选新衣服。"},
    {"id": "flower_beds", "cost": 35, "title": "Flowers around the square", "title_zh": "广场花坛",
     "news_id": "flower-beds-open", "news_title": "A little more color", "news_title_zh": "广场花坛添了新颜色",
     "body": "Residents wanted the space around their fountain to feel more welcoming. The new flower beds are now planted beside the square.",
     "body_zh": "居民希望喷泉旁多一点花香。你筹备的花坛已经种好，广场多了一处可以停下来欣赏的小风景。"},
    {"id": "plaza_lights", "cost": 50, "title": "Evening lights", "title_zh": "广场夜灯",
     "news_id": "plaza-lights-open", "news_title": "An evening glow", "news_title_zh": "广场夜灯亮起来了",
     "body": "Neighbors wanted their evening walks around the fountain to be a little brighter. New lamps now light the square after dusk.",
     "body_zh": "居民希望傍晚散步时，喷泉旁也有温暖的光。你筹备的广场夜灯已安装好，入夜后会亮起。"},
)


def normalize(state):
    """Add fields without inventing purchases or charging existing players."""
    state.setdefault("ledger", [])
    milestones = state.setdefault("milestones", {})
    if any(meeting.get("status") == "resolved" for meeting in state.get("meetings", [])):
        milestones["neighbors_connected"] = True
    projects = state.setdefault("projects", {})
    opened = {item["id"]: item for item in state.get("news", [])}
    for spec in PROJECTS:
        record = projects.setdefault(spec["id"], {"status": "locked"})
        old_news = opened.get(spec["news_id"])
        if old_news and record["status"] != "completed":
            record.update(status="completed", completed_at=old_news["created_at"])


def transfer(state, wallet, entry_id, delta, label, label_zh, moment):
    """Called only after eligibility/funds checks inside the command transaction."""
    wallet["coins"] += delta
    state["ledger"] = (state["ledger"] + [{
        "id": entry_id, "delta": delta, "balance": wallet["coins"],
        "label": label, "label_zh": label_zh, "created_at": moment.isoformat(),
    }])[-40:]


def reset_at(moment, zone):
    tomorrow = moment.astimezone(zone).date() + timedelta(days=1)
    return datetime.combine(tomorrow, time.min, tzinfo=zone).isoformat()


def requirements(state, profiles, earned, project_id):
    if project_id == "fountain":
        return [{"id": "care_level", "label": "A resident reaches care level 2",
                 "label_zh": "任意居民照料等级达到 2 级", "met": earned > 0}]
    if project_id == "clothing_store":
        return [{"id": "neighbors", "label": "Three residents have moved in",
                 "label_zh": "已有 3 位居民入住", "met": len(profiles) >= 3},
                {"id": "conversation", "label": "Help neighbors finish a friendly or respectful conversation",
                 "label_zh": "帮助邻居完成一次友好或尊重彼此的对话",
                 "met": bool(state["milestones"].get("neighbors_connected"))}]
    return [{"id": "fountain", "label": "The wishing fountain is open",
             "label_zh": "许愿喷泉已经落成", "met": state["projects"]["fountain"]["status"] == "completed"}]


def sync_projects(state, profiles, earned, moment):
    normalize(state)
    for spec in PROJECTS:
        record = state["projects"][spec["id"]]
        ready = all(item["met"] for item in requirements(state, profiles, earned, spec["id"]))
        if record["status"] != "completed":
            record["status"] = "proposed" if ready else "locked"
            if ready:
                record.setdefault("proposed_at", moment.isoformat())
                if profiles:
                    record.setdefault("requester_id", next(iter(profiles)))


def public_projects(state, profiles, earned):
    result = []
    for spec in PROJECTS:
        project_id = spec["id"]
        record = state["projects"][project_id]
        requester = record.get("requester_id")
        name = profiles.get(requester, {}).get("name", "A neighbor")
        name_zh = profiles.get(requester, {}).get("name", "居民")
        reasons = {
            "fountain": (f"{name} is settling in and would like a place to pause and make a wish. Prepare a fountain in the square.",
                         f"{name_zh}开始喜欢这里的生活，希望广场上有个能停留、许愿的地方。一起筹备一座喷泉吧。"),
            "clothing_store": ("Neighbors are getting to know one another and want new outfits for outings. Prepare a small shop for them.",
                               "邻居们开始一起聊天、出门，想换身衣服赴约。为这些日常筹备一间服装小店吧。"),
            "flower_beds": ("Residents would like a little color and greenery beside their fountain.",
                            "居民希望喷泉旁多一点花香，让一起休息的广场更亲切。"),
            "plaza_lights": ("Residents would like a warm, brighter square for evening walks.",
                             "居民希望傍晚散步时，喷泉旁也有一片温暖的光。"),
        }
        reason, reason_zh = reasons[project_id]
        if record["status"] == "locked":
            reason, reason_zh = {
                "fountain": (
                    "Once a resident settles into life here and reaches care level 2, they can suggest a place to pause and make a wish.",
                    "等居民逐渐适应这里、照料等级达到 2 级，就可以一起讨论在广场添一个停留、许愿的地方。"),
                "clothing_store": (
                    "When three residents have moved in and neighbors have shared a friendly or respectful conversation, they can suggest outfits for future outings.",
                    "等三位居民入住、邻居完成一次友好或尊重彼此的对话后，再为相伴出门的日常筹备服装小店。"),
                "flower_beds": (
                    "After the fountain opens, you can consider adding flowers and greenery around it.",
                    "喷泉落成后，可以再考虑在周围种上花草，为休息的广场添一点颜色。"),
                "plaza_lights": (
                    "After the fountain opens, you can consider warm lighting for evening walks around the square.",
                    "喷泉落成后，可以再考虑添上夜灯，照亮傍晚散步的广场。"),
            }[project_id]
        result.append({"id": project_id, "status": record["status"], "cost": spec["cost"],
                       "title": spec["title"], "title_zh": spec["title_zh"],
                       "reason": reason, "reason_zh": reason_zh,
                       "requirements": requirements(state, profiles, earned, project_id),
                       **({"requester_id": requester} if requester in profiles else {}),
                       **({"completed_at": record["completed_at"]} if record.get("completed_at") else {})})
    return result


def public_economy(state, daily, day, moment, zone=timezone.utc):
    return {"day": day, "reset_at": reset_at(moment, zone),
            "support": {"amount": SUPPORT_AMOUNT, "claimed": bool(daily.get("support_claimed"))},
            "care_reward": {"amount": CARE_REWARD, "claimed": bool(daily.get("care_reward_claimed"))},
            "social_reward": {"amount": SOCIAL_REWARD,
                              "remaining_pairs": max(0, SOCIAL_DAILY_LIMIT - len(daily["rewarded_pairs"]))},
            "ledger": state["ledger"]}
