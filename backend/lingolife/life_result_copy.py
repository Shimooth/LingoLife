"""Observable response summaries, not invented actions or AI-authored settlement."""

# These describe a selected intention. They must not claim a resource moved,
# food was eaten, a promise was kept, or both residents agreed.
RESPONSE_SUMMARIES = {
    "wait": ("chose to wait for a turn", "选择等一会儿再用"),
    "negotiate": ("wanted to work out who uses the kitchen first", "想商量厨房谁先用"),
    "cook_together": ("suggested cooking together", "提议一起做饭"),
    "argue": ("pushed back over use of the kitchen", "在厨房使用上不肯让步"),
    "knock_and_ask": ("asked how long the bathroom would take", "问了问浴室还要用多久"),
    "offer_quick_turn": ("offered to keep their turn short", "表示自己会尽快用完"),
    "snap_at_other": ("responded impatiently about the bathroom", "对浴室的事有些不耐烦"),
    "choose_together": ("suggested choosing what to watch together", "想一起挑要看的节目"),
    "take_turns": ("suggested taking turns with the television", "提议轮流看各自想看的节目"),
    "yield_remote": ("was willing to let the other person choose", "愿意让对方选节目"),
    "grab_remote": ("insisted on choosing the television programme", "坚持自己选节目"),
    "welcome_company": ("welcomed the company", "愿意有人陪着"),
    "share_activity": ("invited the other person to join in", "想让对方一起参与"),
    "enjoy_silence": ("preferred quiet company", "更想安静地待在一起"),
    "decline_kindly": ("declined the company for now", "这次不想有人陪着"),
    "try_later": ("decided to leave the conversation for later", "决定这次先不聊"),
    "leave_a_note": ("wanted to leave a message instead", "打算改为留个消息"),
    "feel_rejected": ("felt brushed off", "觉得自己被冷落了"),
    "interrupt_anyway": ("still wanted attention despite the interruption", "还是想打断对方聊几句"),
    "clean_without_comment": ("chose to take on the dishes without an argument", "选择先承担洗碗，不争论"),
    "remind_calmly": ("brought up the dishes that needed washing", "提醒了洗碗的事"),
    "offer_to_share": ("offered to share the washing-up", "愿意分担洗碗"),
    "send_angry_message": ("was annoyed about being left with the dishes", "对洗碗的分工很不满"),
    "ask_for_recognition": ("wanted their effort to be noticed", "希望自己的付出被看见"),
    "renegotiate_roles": ("wanted to revisit the division of chores", "想重新商量家务分工"),
    "keep_overfunctioning": ("chose to keep carrying the extra work", "仍选择多承担一些事情"),
    "stop_helping": ("did not want to keep taking on extra work", "不想继续额外帮忙了"),
    "apologize_and_leave": ("apologised and chose to give some space", "道歉，并选择给对方一点空间"),
    "explain_urgency": ("tried to explain why they wanted attention", "想解释自己为什么来打扰"),
    "set_clear_boundary": ("asked for private time", "明确表示现在需要私人时间"),
    "dismiss_concern": ("did not take the privacy concern seriously", "没有认真对待对方的私人空间"),
    "return_and_apologize": ("apologised for borrowing without asking and offered to return the item", "为没先问就借东西道歉，并表示愿意归还"),
    "ask_retroactively": ("asked whether this borrowing was okay", "补问了这次能不能借"),
    "state_borrowing_rule": ("asked to be consulted before their things are borrowed", "要求借自己的东西前先问"),
    "allow_with_reminder": ("allowed this borrowing but asked to be consulted first", "同意这次借用，但提醒先问"),
    "ask_item_back": ("asked for their item back", "要求把东西还回来"),
    "deny_responsibility": ("pushed back instead of apologising for the borrowing", "对借东西的事仍不肯认错"),
    "choose_alternative": ("decided to try a different activity", "决定换一件事做"),
    "wait_for_opening": ("was willing to wait for the place to open", "愿意等这里开放"),
    "ask_for_help": ("wanted help finding another way", "想找人帮忙想别的办法"),
    "abandon_plan": ("chose to drop this plan", "决定放下这次计划"),
    "shop_for_ingredients": ("wanted to get more ingredients", "打算补充食材"),
    "share_remaining_food": ("suggested sharing the remaining food", "提议分着吃剩下的食物"),
    "order_simple_meal": ("wanted a simpler meal instead", "想换个简单的吃饭办法"),
    "blame_household": ("was unhappy about the missing ingredients", "对家里缺食材很不满"),
    "move_to_quiet_place": ("wanted to find somewhere quieter", "想换个安静的地方"),
    "ask_to_lower_volume": ("asked for the noise to be lowered", "要求把声音调小"),
    "use_headphones": ("chose headphones as a workaround", "打算用耳机避开噪声"),
    "start_argument": ("pushed back sharply about the noise", "因噪声争执起来"),
    "cheer_each_other_on": ("chose to encourage the other person", "愿意给对方鼓劲"),
    "compete_fairly": ("wanted a fair contest", "想公平地比一比"),
    "focus_on_improving": ("focused on their own improvement", "更在意自己的进步"),
    "turn_it_personal": ("took the competition personally", "有点把输赢当成针对自己了"),
    "take_trash_out_now": ("offered to deal with the rubbish", "愿意承担倒垃圾"),
    "agree_trash_schedule": ("supported a rubbish-duty schedule", "赞成安排倒垃圾的轮值"),
    "leave_trash_reminder": ("wanted to leave a rubbish-duty reminder", "想留个倒垃圾的提醒"),
    "refuse_trash_duty": ("refused this rubbish duty", "不愿承担这次倒垃圾"),
    "replace_taken_food": ("offered to replace the private food", "愿意补上拿走的私人食物"),
    "explain_food_mixup": ("wanted to explain the food mix-up", "想解释拿错食物的事"),
    "label_private_food": ("wanted private food clearly labelled", "想把私人食物标清楚"),
    "deny_taking_food": ("denied taking the food", "不承认拿了食物"),
    "accept_shared_food": ("accepted the shared food", "接受了分享的食物"),
    "share_food_together": ("was willing to share food", "愿意分享食物"),
    "save_food_for_later": ("wanted to save the food for later", "想把食物留着稍后吃"),
    "decline_shared_food": ("declined the shared food", "这次没有接受分享的食物"),
}


def response_consequence(record, profiles):
    resolution = record.get("resolution") or {}
    decisions = resolution.get("response_by_participant") or {}
    ids = (record.get("story") or {}).get("participant_ids") or list(decisions)
    facts = (record.get("collision") or {}).get("facts") or {}
    parts = []
    for npc_id in ids[:2]:
        # The old unavailable scenario assigned visitor choices to the host too.
        if npc_id == facts.get("target_id") and facts.get("target_busy"):
            pair = ("was busy and unavailable for a chat", "当时正忙，没空聊天")
        else:
            pair = RESPONSE_SUMMARIES.get(decisions.get(npc_id))
        if pair:
            name = str(profiles.get(npc_id, {}).get("name") or npc_id)
            parts.append((f"{name} {pair[0]}.", f"{name}{pair[1]}。"))
    if not parts:
        return None
    return {"kind": "wellbeing", "tone": "neutral", "text": " ".join(p[0] for p in parts),
            "translation_zh": "".join(p[1] for p in parts)}
