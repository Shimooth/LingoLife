"""仅翻译模型侧的任务说明，不改动玩家可见的英文剧情与接口字段。"""
from __future__ import annotations

import re
from typing import Any, Mapping


EVENT_OBJECTIVES_ZH = {
    "Ask what happened.": "询问发生了什么。",
    "Respond to the invitation.": "回应邀请。",
    "Offer an idea.": "提出一个想法。",
    "Notice Emma's mood.": "留意 Emma 的情绪。",
    "Make a gentle suggestion.": "温和地提出建议。",
    "Accept or decline honestly.": "坦诚地接受或拒绝。",
    "Ask for details.": "询问细节。",
    "Make a prediction.": "作出猜测。",
    "Share Emma's excitement.": "分享 Emma 的兴奋。",
    "Show empathy and ask what happened.": "表达理解，并询问发生了什么。",
    "Respond to Emma's self-doubt.": "回应 Emma 的自我怀疑。",
    "Help make a practical plan.": "帮助制定切实可行的计划。",
    "React and ask about the opportunity.": "作出回应，并询问这个机会。",
    "Address Emma's fear.": "回应 Emma 的担忧。",
    "Offer help or a theme.": "提供帮助或提出一个主题。",
    "Ask about the interview.": "询问面试情况。",
    "Suggest an approach.": "建议一种应对方式。",
    "Agree to help or encourage Emma.": "答应帮忙，或鼓励 Emma。",
    "Respond empathetically.": "有同理心地回应。",
    "Give honest advice.": "给出坦诚的建议。",
    "Help form an apology.": "帮助组织道歉的话。",
    "Ask what has happened before.": "询问之前发生过什么。",
    "Evaluate the message honestly.": "坦诚地评价这条消息。",
    "Suggest a polite request.": "建议一种礼貌的请求方式。",
    "Invite Emma to explain.": "请 Emma 解释一下。",
    "Acknowledge the complicated feeling.": "理解并回应这种复杂的感受。",
    "Help Emma decide.": "帮助 Emma 作出决定。",
    "Ask for identifying details.": "询问有助于辨认的细节。",
    "Prioritize the dog's safety.": "优先考虑狗的安全。",
    "Help with a plan.": "帮助制定计划。",
    "Check whether Emma is safe.": "确认 Emma 是否安全。",
    "Offer practical priorities.": "提出切实可行的处理优先级。",
    "Balance safety and helping someone.": "兼顾安全与帮助他人。",
    "Ask for relevant details.": "询问相关细节。",
    "Discuss safe options.": "讨论安全的选择。",
    "Give and explain an opinion.": "表达看法并说明理由。",
    "Ask about the note.": "询问便条的内容。",
    "Give an honest reaction.": "作出坦诚的回应。",
    "Help compose a reply.": "帮助组织回复。",
    "Ask what they might perform.": "询问他们可能表演什么。",
    "Respond to the fear.": "回应担忧。",
    "Help make the choice.": "帮助作出选择。",
    "Ask what may be wrong.": "询问可能出了什么问题。",
    "Offer a considerate approach.": "提出体贴的处理方式。",
    "Help plan the conversation.": "帮助规划这次谈话。",
    "Check how they feel.": "询问他们的感受。",
    "Address the guilt.": "回应内疚的感受。",
    "Suggest a recovery plan.": "提出恢复计划。",
    "Invite an explanation.": "请对方解释一下。",
    "Acknowledge the pressure.": "理解并回应压力。",
    "Help phrase a boundary.": "帮助表达个人边界。",
    "Check the situation.": "了解当前情况。",
    "Compare safe options.": "比较安全的选择。",
    "Offer support.": "提供支持。",
}


def localize_event_objective(value: str) -> str:
    if value in EVENT_OBJECTIVES_ZH:
        return EVENT_OBJECTIVES_ZH[value]
    # 旧剧情会将 Emma 替换为当前角色名；保留替换后的名字。
    for source, translated in EVENT_OBJECTIVES_ZH.items():
        if "Emma" not in source:
            continue
        matched = re.fullmatch(re.escape(source).replace("Emma", "(.+)"), value)
        if matched:
            return translated.replace("Emma", matched.group(1))
    return value  # 自定义剧情资料不是系统指令，不擅自翻译或丢弃。


def event_prompt_data(event: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if event is None:
        return None
    result = dict(event)
    if isinstance(event.get("stage"), Mapping):
        stage = dict(event["stage"])
        if isinstance(stage.get("objective"), str):
            stage["objective"] = localize_event_objective(stage["objective"])
        result["stage"] = stage
    return result
