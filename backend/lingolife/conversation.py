"""Conversation boundaries follow authoritative game days and action instances."""
from __future__ import annotations

import hashlib
import json
from typing import Mapping


def conversation_id(npc_id: str, game_date: str, action_id: str) -> str:
    # Opaque identifier: private action IDs/types must not become disclosure.
    value = json.dumps([npc_id, game_date, action_id], separators=(",", ":"))
    return "conversation-" + hashlib.sha256(value.encode()).hexdigest()[:32]


ACTIVITY_OPENINGS = {
    "prepare_food": ("I'm making something to eat.", "我正在做点吃的。"),
    "eat": ("I'm having a bite to eat.", "我正在吃点东西。"),
    "use_television": ("I'm watching a little TV.", "我正在看一会儿电视。"),
    "read": ("I'm spending some time with a book.", "我正在读一会儿书。"),
    "practice_hobby": ("I'm making time for something I enjoy.", "我正在花点时间做自己喜欢的事。"),
    "borrow_household_item": ("I'm checking whether I can borrow something.", "我正在问问能不能借用一件东西。"),
    "clean_shared_space": ("I'm tidying up our shared space.", "我正在收拾我们的公共空间。"),
    "leave_dishes": ("I'm leaving these dishes for a little later.", "我打算稍后再处理这些餐具。"),
    "rest_alone": ("I'm taking a quiet moment for myself.", "我正在安静地独处一会儿。"),
    "seek_company": ("I could use a little company.", "我想找个人陪一会儿。"),
    "talk_to_resident": ("I'm catching up with a housemate.", "我正在和室友聊聊近况。"),
}


def conversation_opening(action: Mapping) -> dict[str, str]:
    """Use only the already public action; never reveal private activities."""
    visible = action.get("visible_context") or {}
    status = action.get("status")
    if action.get("type") in {"sleep", "shower", "private_time"} or visible.get("visibility") == "private":
        en, zh = "I need a little personal time right now.", "我现在需要一点私人时间。"
    elif status == "traveling":
        en, zh = "I'm on my way to my next activity.", "我正在前往下一个活动的地点。"
    elif status in {"blocked", "retrying"}:
        en, zh = "I'm waiting for my turn before I can get started.", "我正在等轮到自己，然后才能开始。"
    elif status == "planned":
        en, zh = "I'm getting ready for my next activity.", "我正在为接下来的活动做准备。"
    elif status in {"completed", "abandoned", "interrupted"}:
        en, zh = "I'm taking a moment before deciding what to do next.", "我先歇一会儿，再决定接下来做什么。"
    else:
        en, zh = ACTIVITY_OPENINGS.get(str(action.get("type")),
                                      ("It's good to see you. How are you doing?", "很高兴见到你。你最近怎么样？"))
    return {"text": en, "translation": zh}
