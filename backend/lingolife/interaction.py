"""Deterministic, replayable direction for observable NPC interactions.

The collision engine owns what each resident decides to do.  This module only
turns those already-selected responses into an observable scene: dialogue,
emotion bands, semantic animation cues, and timing.  It deliberately stores no
relationship scores, persona axes, response identifiers, or predicted outcome.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Mapping, Sequence

from .agent import compile_persona
from .animation import ANIMATION_CUES, AnimationCue, animation_cue
from .collisions import CollisionCatalog, load_collision_catalog
from .life import stable_id


INTERACTION_RULES_VERSION = "interaction-scene-v1"
INTERACTION_STAGE_ORDER = ("setup", "exchange", "reaction", "closure")
INTERACTION_STAGE_COPY = {
    "setup": ("The moment begins", "事情发生"),
    "exchange": ("They answer", "彼此回应"),
    "reaction": ("The feeling shifts", "情绪变化"),
    "closure": ("A visible pause", "暂时收束"),
}
OBSERVABLE_EMOTIONS = frozenset({
    "neutral", "focused", "patient", "open", "warm", "frustrated", "helpful",
    "measured", "calm", "gentle", "hurt", "restrained", "angry", "earnest",
    "strained", "withdrawn", "remorseful", "firm", "dismissive", "defensive",
    "adaptive", "uncertain", "hopeful", "guarded", "energized", "playful",
    "concerned", "impatient", "curious", "settled", "tense", "reflective",
    "familiar",
})


@dataclass(frozen=True)
class ResponseCopy:
    style: str
    text: str
    translation_zh: str
    cue: AnimationCue = "talk"
    emotion: str = "focused"


# These lines express a decision that the deterministic collision resolver has
# already made.  They are observable speech, not internal thought or a promise
# about the eventual relationship outcome.
RESPONSE_COPY: dict[str, ResponseCopy] = {
    "wait": ResponseCopy("patient", "I can wait. Finish what you need first.", "我可以等，你先把需要做的做完。", "listen", "patient"),
    "negotiate": ResponseCopy("cooperative", "Let's divide the space and make it work for both of us.", "我们分一下空间，尽量让两个人都能做成吧。", "talk", "open"),
    "cook_together": ResponseCopy("warm", "We could make something together instead.", "不如我们一起做点吃的吧。", "happy", "warm"),
    "argue": ResponseCopy("confrontational", "I got here first, and I am not backing down.", "是我先到的，我不打算让步。", "talk", "frustrated"),
    "knock_and_ask": ResponseCopy("assertive", "Could you tell me how much longer you need?", "你能告诉我还需要多久吗？", "talk", "focused"),
    "offer_quick_turn": ResponseCopy("cooperative", "I'll be quick, and then it is all yours.", "我会快一点，然后就完全交给你。", "happy", "helpful"),
    "snap_at_other": ResponseCopy("confrontational", "You have kept me waiting long enough.", "你已经让我等得够久了。", "sad", "frustrated"),
    "choose_together": ResponseCopy("cooperative", "Let's find something we would both enjoy.", "我们找一个两个人都喜欢的吧。", "talk", "open"),
    "take_turns": ResponseCopy("fair", "We can take turns. That keeps it fair.", "我们可以轮流来，这样比较公平。", "talk", "measured"),
    "yield_remote": ResponseCopy("warm", "You choose this time. I can pick next time.", "这次你选吧，下次再让我选。", "happy", "warm"),
    "grab_remote": ResponseCopy("confrontational", "No. I have already decided what I am watching.", "不行，我已经决定要看什么了。", "talk", "frustrated"),
    "welcome_company": ResponseCopy("warm", "Stay. I would really like the company.", "留下来吧，我真的很想有人陪。", "happy", "warm"),
    "share_activity": ResponseCopy("cooperative", "You can join me. We can do this together.", "你可以加入，我们一起做吧。", "talk", "open"),
    "enjoy_silence": ResponseCopy("quiet", "You can stay. We do not have to fill the silence.", "你可以留下，我们不一定非得说话。", "listen", "calm"),
    "decline_kindly": ResponseCopy("boundaried", "Thank you for asking, but I need time by myself today.", "谢谢你来问，不过我今天需要自己待一会儿。", "talk", "gentle"),
    "try_later": ResponseCopy("patient", "All right. I will find you when there is a better moment.", "好吧，等时机合适一点我再来找你。", "listen", "patient"),
    "leave_a_note": ResponseCopy("warm", "I'll leave you a note, so you know I came by.", "我给你留张便条，这样你会知道我来过。", "talk", "warm"),
    "feel_rejected": ResponseCopy("sensitive", "I understand you are busy, but that still stings a little.", "我知道你在忙，但心里还是有一点难受。", "sad", "hurt"),
    "interrupt_anyway": ResponseCopy("confrontational", "This cannot wait. I need you to listen now.", "这不能再等了，我需要你现在听我说。", "talk", "frustrated"),
    "clean_without_comment": ResponseCopy("caretaking", "I'll take care of it this time.", "这次我来处理吧。", "crouch", "restrained"),
    "remind_calmly": ResponseCopy("assertive", "I need you to finish the part you left behind.", "我需要你把留下的那部分收拾完。", "talk", "focused"),
    "offer_to_share": ResponseCopy("cooperative", "Let's split the work and clear it together.", "我们分一下工，一起收拾干净吧。", "talk", "helpful"),
    "send_angry_message": ResponseCopy("confrontational", "I am tired of cleaning up after this happens.", "我受够了每次发生这种事都要来收拾。", "sad", "angry"),
    "ask_for_recognition": ResponseCopy("assertive", "I need you to notice how much I have been carrying.", "我需要你看到我一直承担了多少。", "talk", "earnest"),
    "renegotiate_roles": ResponseCopy("cooperative", "Let's decide again who is responsible for what.", "我们重新说清楚每个人负责什么吧。", "talk", "focused"),
    "keep_overfunctioning": ResponseCopy("caretaking", "I will handle it. Someone has to keep things moving.", "我来处理吧，总得有人让事情继续运转。", "tired", "strained"),
    "stop_helping": ResponseCopy("avoidant", "I cannot keep doing this. I am stepping back.", "我不能再这样做下去了，我要先退开。", "sad", "withdrawn"),
    "apologize_and_leave": ResponseCopy("cooperative", "I'm sorry. I will give you the space you asked for.", "对不起，我会把你需要的空间留给你。", "talk", "remorseful"),
    "explain_urgency": ResponseCopy("assertive", "I came in because it felt urgent, but I should explain.", "我是因为觉得事情紧急才进来的，但我应该解释清楚。", "talk", "focused"),
    "set_clear_boundary": ResponseCopy("boundaried", "Please ask before coming into my private space.", "下次进入我的私人空间前，请先问我。", "talk", "firm"),
    "dismiss_concern": ResponseCopy("confrontational", "You are making too much of this.", "你把这件事看得太严重了。", "look_around", "dismissive"),
    "return_and_apologize": ResponseCopy("cooperative", "I should have asked. I am returning it now.", "我本来应该先问你，我现在就把它还回来。", "talk", "remorseful"),
    "ask_retroactively": ResponseCopy("warm", "I should have asked first. Can we make this right?", "我应该先问你的，我们能把这件事处理好吗？", "talk", "gentle"),
    "state_borrowing_rule": ResponseCopy("boundaried", "From now on, we ask before borrowing personal things.", "从现在开始，借私人物品前要先询问。", "talk", "firm"),
    "deny_responsibility": ResponseCopy("confrontational", "I do not see why this is being blamed on me.", "我不明白为什么这件事要怪到我头上。", "look_around", "defensive"),
    "choose_alternative": ResponseCopy("flexible", "The plan changed. I will find another way to do it.", "计划变了，我会找另一个办法完成。", "look_around", "adaptive"),
    "wait_for_opening": ResponseCopy("patient", "I can wait until the place is available again.", "我可以等到这里重新开放。", "listen", "patient"),
    "ask_for_help": ResponseCopy("warm", "Maybe someone here can help me find another option.", "也许这里有人能帮我找另一个选择。", "talk", "hopeful"),
    "abandon_plan": ResponseCopy("avoidant", "Forget it. I do not have the energy to rearrange everything.", "算了，我没有精力重新安排这一切。", "tired", "withdrawn"),
    "shop_for_ingredients": ResponseCopy("practical", "I will pick up what is missing and come back.", "我去把缺的东西买回来再继续。", "walk", "focused"),
    "share_remaining_food": ResponseCopy("warm", "There is not much, but we can share what is left.", "虽然不多，但我们可以把剩下的分着吃。", "happy", "warm"),
    "order_simple_meal": ResponseCopy("flexible", "Let's order something simple and adjust the plan.", "我们点些简单的东西，再调整计划吧。", "talk", "adaptive"),
    "blame_household": ResponseCopy("confrontational", "How did everyone let the kitchen get this empty?", "大家怎么会让厨房空成这样？", "sad", "frustrated"),
    "move_to_quiet_place": ResponseCopy("avoidant", "I am going somewhere quieter so I can concentrate.", "我要去安静一点的地方，这样才能专心。", "walk", "withdrawn"),
    "ask_to_lower_volume": ResponseCopy("assertive", "Could you lower the volume? I cannot focus like this.", "你能小声一点吗？这样我没法专心。", "talk", "firm"),
    "use_headphones": ResponseCopy("practical", "I will use headphones and keep working.", "我会戴上耳机继续做事。", "listen", "focused"),
    "start_argument": ResponseCopy("confrontational", "If you will not listen, then we have a bigger problem.", "如果你不肯听，那我们的问题就更大了。", "talk", "angry"),
    "cheer_each_other_on": ResponseCopy("warm", "Let's make each other better and enjoy the challenge.", "我们互相鼓励，一起享受这场挑战吧。", "happy", "playful"),
    "compete_fairly": ResponseCopy("fair", "Best effort, clear rules, and no excuses. Deal?", "全力以赴、规则清楚、不找借口。说定了？", "talk", "energized"),
    "focus_on_improving": ResponseCopy("practical", "I am competing with who I was yesterday, not with you.", "我是在和昨天的自己较量，不是在和你较量。", "talk", "focused"),
    "turn_it_personal": ResponseCopy("confrontational", "Do not pretend this is friendly when you want to beat me.", "别装作只是友好切磋，你明明就是想赢我。", "sad", "angry"),
    "take_trash_out_now": ResponseCopy("cooperative", "I'll take the trash out now. We can sort out turns afterward.", "我现在就去倒垃圾，之后我们再商量轮班。", "walk", "helpful"),
    "agree_trash_schedule": ResponseCopy("fair", "Let's put trash duty on a schedule so neither of us has to guess.", "我们给倒垃圾排个班，这样谁都不用猜该谁做。", "talk", "measured"),
    "leave_trash_reminder": ResponseCopy("assertive", "Please take your turn before the bin overflows again.", "请在垃圾桶再次满出来前完成你这一轮。", "talk", "firm"),
    "refuse_trash_duty": ResponseCopy("confrontational", "That mess is not mine, so I am not taking it out.", "那堆垃圾不是我弄的，我不会去倒。", "sad", "angry"),
    "replace_taken_food": ResponseCopy("cooperative", "I took the wrong portion. I'll replace it and ask next time.", "我拿错了那份食物。我会补回来，下次也会先问。", "talk", "remorseful"),
    "explain_food_mixup": ResponseCopy("warm", "I honestly thought it was for everyone. I'm sorry about the mix-up.", "我真的以为那是大家都能吃的。弄错了，对不起。", "talk", "gentle"),
    "label_private_food": ResponseCopy("boundaried", "Let's label personal food clearly and still ask before taking it.", "我们把私人食物标清楚，而且拿之前还是要先问。", "talk", "firm"),
    "deny_taking_food": ResponseCopy("confrontational", "You cannot prove that I took it, so stop blaming me.", "你又不能证明是我拿的，别再怪我。", "look_around", "defensive"),
    "accept_shared_food": ResponseCopy("warm", "Thank you. I'd love to share this with you.", "谢谢，我很愿意和你一起分享。", "happy", "warm"),
    "share_food_together": ResponseCopy("cooperative", "Let's split it and eat together while it is still warm.", "我们分着吃吧，趁热一起吃。", "happy", "open"),
    "save_food_for_later": ResponseCopy("patient", "Could you save my part? I'd like to have it a little later.", "能帮我留一份吗？我想晚一点再吃。", "talk", "patient"),
    "decline_shared_food": ResponseCopy("boundaried", "That is kind of you, but I do not feel like eating right now.", "你很贴心，不过我现在不太想吃。", "talk", "gentle"),
}


# opener role, English, Chinese, cue, observable emotion
TOPIC_SETUP_COPY: dict[str, tuple[int, str, str, AnimationCue, str]] = {
    "shared_kitchen": (0, "I was just about to use the kitchen.", "我正准备使用厨房。", "talk", "focused"),
    "bathroom_access": (0, "I have been waiting for a turn.", "我已经等了一会儿。", "talk", "impatient"),
    "shared_entertainment": (0, "I had something in mind for the television.", "我本来想看一个节目。", "talk", "curious"),
    "companionship": (0, "Would you like some company?", "你想有人陪一会儿吗？", "talk", "hopeful"),
    "missed_connection": (0, "I hoped we could talk for a moment.", "我本来希望能和你聊一会儿。", "talk", "hopeful"),
    "dishwashing": (1, "The dishes are still here.", "餐具还留在这里。", "look_around", "concerned"),
    "unequal_care": (0, "I feel like I have been carrying a lot lately.", "我感觉最近承担了很多。", "talk", "strained"),
    "privacy": (1, "I needed some space just then.", "刚才我需要一点自己的空间。", "talk", "guarded"),
    "borrowed_property": (1, "I wanted to be asked before it was borrowed.", "我希望东西被借走前能先问我。", "talk", "hurt"),
    "blocked_plan": (0, "This was not how I expected the plan to go.", "事情没有按我预想的计划发展。", "look_around", "uncertain"),
    "food_shortage": (0, "There is not enough here for the plan I had.", "这里的存货不够完成原来的计划。", "look_around", "concerned"),
    "noise": (1, "It is hard to keep going with this much noise.", "这么吵，我很难继续手上的事。", "talk", "strained"),
    "friendly_competition": (0, "Want to make this a friendly challenge?", "要不要来一场友好的较量？", "happy", "playful"),
    "trash_duty": (1, "The bin is full again, and we need to decide whose turn it is.", "垃圾桶又满了，我们得说清楚这次轮到谁。", "look_around", "concerned"),
    "private_food": (1, "The food I had saved is gone.", "我特意留着的那份食物不见了。", "talk", "hurt"),
    "shared_food": (0, "I made enough to share. Would you like some?", "我多做了一些，要不要一起吃？", "happy", "warm"),
}

TOPIC_DEFAULT_RESPONSES: dict[str, tuple[str, str]] = {
    "shared_kitchen": ("negotiate", "wait"),
    "bathroom_access": ("knock_and_ask", "offer_quick_turn"),
    "shared_entertainment": ("take_turns", "choose_together"),
    "companionship": ("share_activity", "welcome_company"),
    "missed_connection": ("try_later", "leave_a_note"),
    "dishwashing": ("offer_to_share", "remind_calmly"),
    "unequal_care": ("ask_for_recognition", "renegotiate_roles"),
    "privacy": ("apologize_and_leave", "set_clear_boundary"),
    "borrowed_property": ("return_and_apologize", "state_borrowing_rule"),
    "blocked_plan": ("choose_alternative", "ask_for_help"),
    "food_shortage": ("shop_for_ingredients", "share_remaining_food"),
    "noise": ("ask_to_lower_volume", "move_to_quiet_place"),
    "friendly_competition": ("compete_fairly", "cheer_each_other_on"),
    "trash_duty": ("agree_trash_schedule", "take_trash_out_now"),
    "private_food": ("replace_taken_food", "label_private_food"),
    "shared_food": ("share_food_together", "accept_shared_food"),
}


def _number(value: object, fallback: float = 50) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return fallback
    return result if math.isfinite(result) else fallback


def _axes(profile: Mapping[str, Any]) -> Mapping[str, Any]:
    raw = profile.get("axes") or profile.get("persona_axes")
    if isinstance(raw, Mapping):
        return raw
    return compile_persona(profile).get("axes", {})


def _voice_mode(profile: Mapping[str, Any], topic: str) -> str:
    axes = _axes(profile)
    if topic in {"companionship", "friendly_competition"} and _number(axes.get("humor"), 40) >= 65:
        return "playful"
    if _number(axes.get("assertiveness")) >= 70:
        return "direct"
    if _number(axes.get("extraversion")) <= 37:
        return "reserved"
    if _number(axes.get("warmth"), 55) >= 70:
        return "warm"
    return "measured"


def _find_edge(relationships: Mapping[Any, Any], owner_id: str,
               target_id: str) -> Mapping[str, Any]:
    direct = relationships.get((owner_id, target_id))
    if isinstance(direct, Mapping):
        return direct
    direct = relationships.get(f"{owner_id}:{target_id}")
    if isinstance(direct, Mapping) and "owner_id" in direct:
        return direct
    for raw in relationships.values():
        if not isinstance(raw, Mapping):
            continue
        candidates = (raw.get("a_to_b"), raw.get("b_to_a"), raw)
        for candidate in candidates:
            if (isinstance(candidate, Mapping)
                    and str(candidate.get("owner_id") or candidate.get("npc_a") or "") == owner_id
                    and str(candidate.get("target_id") or candidate.get("npc_b") or "") == target_id):
                return candidate
    return {}


def _relationship_band(relationships: Mapping[Any, Any], first: str,
                       second: str) -> tuple[str, str]:
    directions = [_find_edge(relationships, first, second),
                  _find_edge(relationships, second, first)]
    available = [edge for edge in directions if edge]
    if not available:
        return "new", "calm"
    closeness_values = [min(_number(edge.get("familiarity"), 15),
                            _number(edge.get("affinity"), 35),
                            _number(edge.get("trust"), 35)) for edge in available]
    familiarity = min(_number(edge.get("familiarity"), 15) for edge in available)
    floor = min(closeness_values)
    closeness = "close" if floor >= 70 else "warm" if floor >= 55 else (
        "familiar" if familiarity >= 30 else "new"
    )
    strain = max(max(_number(edge.get("tension"), 0),
                     _number(edge.get("resentment"), 0)) for edge in available)
    tension = "high" if strain >= 65 else "noticeable" if strain >= 30 else "calm"
    return closeness, tension


@lru_cache(maxsize=1)
def _default_catalog() -> CollisionCatalog:
    return load_collision_catalog()


def _style_for(response_id: str, scenario_id: str,
               catalog: CollisionCatalog | None) -> str:
    copy = RESPONSE_COPY.get(response_id)
    if copy:
        return copy.style
    scenario = (catalog or _default_catalog()).scenarios.get(scenario_id)
    if scenario:
        found = next((value for value in scenario.responses if value.id == response_id), None)
        if found:
            return found.style
    return "neutral"


def _fallback_response(topic: str, role: int) -> str:
    values = TOPIC_DEFAULT_RESPONSES.get(topic, ("", ""))
    return values[min(max(role, 0), len(values) - 1)] if values else ""


def _response_copy(response_id: str, *, topic: str, role: int) -> ResponseCopy:
    chosen = response_id or _fallback_response(topic, role)
    return RESPONSE_COPY.get(chosen, ResponseCopy(
        "neutral", "I need a moment to decide how to respond.",
        "我需要一点时间想想该怎样回应。", "look_around", "uncertain",
    ))


def _duration(text: str, *, mode: str = "measured", floor: int = 1900) -> int:
    words = max(1, len(text.split()))
    pause = 260 if mode == "reserved" else 80 if mode == "direct" else 150
    return max(floor, min(4800, 1260 + words * 175 + pause))


def _beat(*, collision_id: str, sequence: int, phase: str,
          speaker_id: str | None, text: str, translation_zh: str,
          cue: object, emotion: str, mode: str = "measured") -> dict[str, Any]:
    normalized_cue = animation_cue(cue, "talk")
    return {
        "id": stable_id("interaction-beat", collision_id, sequence, phase,
                        rules_version=INTERACTION_RULES_VERSION),
        "speaker_id": speaker_id,
        "text": text,
        "translation_zh": translation_zh,
        "animation_cue": normalized_cue,
        "emotion": emotion,
        "phase": phase,
        "duration_ms": _duration(text, mode=mode),
    }


def _same_stance_line(style: str) -> tuple[str, str, AnimationCue, str]:
    if style == "confrontational":
        return ("Then neither of us is ready to give way.", "看来我们两个人现在都不愿意让步。", "sad", "frustrated")
    if style in {"avoidant", "sensitive"}:
        return ("I need some room too. Let us slow this down.", "我也需要一点空间，我们先慢下来吧。", "sad", "guarded")
    if style in {"warm", "cooperative", "fair", "patient", "caretaking"}:
        return ("That works for me too. We can try it that way.", "我也愿意，那我们就这样试试看。", "happy", "open")
    if style == "quiet":
        return ("Yes. We can keep this simple and quiet.", "嗯，我们可以简单、安静地待着。", "listen", "calm")
    return ("I can work with that for now.", "目前这样我可以接受。", "talk", "measured")


def _voiced_setup(setup: tuple[int, str, str, AnimationCue, str],
                  mode: str, topic: str) -> tuple[str, str, AnimationCue, str]:
    line = (setup[1], setup[2], setup[3], setup[4])
    if mode == "reserved":
        return (f"Um… {line[0]}", f"那个……{line[1]}", "talk", "guarded")
    if mode == "direct":
        return (f"Can we be direct? {line[0]}", f"我们直说吧。{line[1]}", "talk", "focused")
    if mode == "warm":
        return (f"Hey. {line[0]}", f"嗨。{line[1]}", line[2], "warm")
    if mode == "playful" and topic == "friendly_competition":
        return (f"{line[0]} No pressure—mostly.", f"{line[1]}别有压力——大概吧。", "happy", "playful")
    return line


def _clarification_line(*, speaker_profile: Mapping[str, Any], topic: str,
                        own_style: str, heard_style: str,
                        closeness: str, tension: str) -> tuple[str, str, AnimationCue, str]:
    mode = _voice_mode(speaker_profile, topic)
    if "confrontational" in {own_style, heard_style}:
        if mode == "reserved":
            return ("I heard you. I need a moment before I answer anything else.",
                    "我听到了，但在继续回应前，我需要缓一缓。", "sad", "guarded")
        if mode == "warm" and closeness in {"warm", "close"}:
            return ("I am upset too, but I do not want us to turn on each other.",
                    "我也很难受，但我不想让我们彼此伤害。", "sad", "earnest")
        if mode == "direct":
            return ("I hear the frustration. Raising the pressure will not solve this.",
                    "我听到了你的不满，但增加压力解决不了问题。", "talk", "firm")
        return ("We are both getting tense. Let us deal with the issue, not attack each other.",
                "我们都越来越紧张了，先处理事情，不要彼此攻击。", "talk", "strained")
    if own_style in {"avoidant", "sensitive"} or heard_style in {"avoidant", "sensitive"}:
        if tension == "high":
            return ("I can pause, but I do not want this to disappear without an answer.",
                    "我可以暂停，但我不希望这件事没有回应就消失。", "sad", "guarded")
        return ("We can take some space and come back when the words are easier.",
                "我们可以先留一点空间，等更容易开口时再回来谈。", "listen", "gentle")
    if mode == "playful" and topic == "friendly_competition":
        return ("Good. Bragging rights only—no dramatic victory speeches.",
                "很好，只争个小小的炫耀权，可不许发表夸张的胜利演说。", "happy", "playful")
    if mode == "reserved":
        return ("Okay. I may not say much, but I am comfortable with that.",
                "好。我可能话不多，但这样让我觉得自在。", "listen", "calm")
    if mode == "direct":
        return ("Good. Then let us be clear about the next step.",
                "好，那我们把下一步说清楚。", "talk", "focused")
    if mode == "warm":
        return ("That feels fair. Thank you for meeting me halfway.",
                "这样很公平，谢谢你愿意和我各退一步。", "happy", "warm")
    if closeness == "close":
        return ("That sounds like us. We can make it work without making it bigger.",
                "这很像我们会有的处理方式，不必把事情越弄越大。", "happy", "familiar")
    return ("I understand what you mean. That gives us something to work with.",
            "我明白你的意思了，这样我们就有了可以继续处理的方向。", "talk", "open")


def _closure_line(*, topic: str, styles: Sequence[str], closeness: str,
                  tension: str, voice_mode: str,
                  requires_intervention: bool) -> tuple[str, str, AnimationCue, str]:
    if "confrontational" in styles or tension == "high":
        if requires_intervention:
            return ("Let us stop here before this gets worse. We may need help untangling it.",
                    "先停在这里吧，免得情况更糟。也许我们需要有人帮忙理清楚。", "sad", "tense")
        if closeness in {"warm", "close"}:
            return ("We are frustrated, but this matters too much to leave as an attack.",
                    "我们都很挫败，但这件事太重要了，不能只留下彼此的攻击。", "sad", "earnest")
        return ("We are not solving this while we are this tense. Let us pause.",
                "现在这么紧张，问题解决不了。我们先暂停吧。", "sad", "tense")
    if any(style in {"avoidant", "sensitive"} for style in styles):
        return ("We will leave it here for now, and come back when there is more room.",
                "我们暂时先停在这里，等彼此更有余地时再回来谈。", "listen", "guarded")
    if topic == "friendly_competition" and voice_mode == "playful":
        return ("Deal. May the best questionable technique win.",
                "说定了，看看谁那套可疑的小技巧更厉害。", "jump", "playful")
    if all(style in {"warm", "cooperative", "fair", "patient", "caretaking", "quiet"}
           for style in styles):
        if closeness == "close":
            return ("All right. We know each other well enough to try it this way.",
                    "好。我们足够了解彼此，可以先这样试试看。", "happy", "warm")
        if closeness == "new":
            return ("All right. That is a fair place to start.",
                    "好，这会是一个公平的开始。", "happy", "open")
        return ("All right. Let us try that and check in with each other.",
                "好，我们就这样试试，也记得照顾彼此的感受。", "happy", "settled")
    if requires_intervention:
        return ("That is where things stand. Neither of us has to force the next step yet.",
                "事情暂时就停在这里，我们都不必立刻强迫下一步发生。", "look_around", "uncertain")
    return ("Let us try that for now and see what happens next.",
            "暂时就这样试试，看看接下来会怎样。", "talk", "measured")


def _single_person_reaction(profile: Mapping[str, Any], topic: str) -> tuple[str, str, AnimationCue, str]:
    mode = _voice_mode(profile, topic)
    return {
        "reserved": ("I need a quiet minute to adjust.", "我需要安静一会儿来调整。", "listen", "calm"),
        "direct": ("The situation changed, so I need a clear next step.", "情况变了，我需要一个清楚的下一步。", "talk", "focused"),
        "warm": ("Maybe I can ask someone nearby and make this easier.", "也许我可以问问附近的人，让事情容易一点。", "talk", "hopeful"),
        "playful": ("Well, that was not in today's script.", "好吧，今天的剧本里可没写这一段。", "happy", "playful"),
    }.get(mode, ("I will take a breath and adjust the plan.", "我先缓一口气，再调整计划。", "look_around", "adaptive"))


def _value(value: object, key: str, fallback: object = None) -> object:
    if isinstance(value, Mapping):
        return value.get(key, fallback)
    return getattr(value, key, fallback)


def build_interaction_scene(*, collision: object, resolution: object,
                            profiles: Mapping[str, Mapping[str, Any]],
                            relationships: Mapping[Any, Any] | None = None,
                            catalog: CollisionCatalog | None = None,
                            intervention_available: bool | None = None) -> dict[str, Any]:
    """Compile one rule resolution into a four-stage immutable scene plan."""
    collision_id = str(_value(collision, "id", "collision"))
    scenario_id = str(_value(collision, "scenario_id", ""))
    topic = str(_value(collision, "topic", ""))
    participants = tuple(dict.fromkeys(
        str(value) for value in (_value(collision, "participant_ids", ()) or ()) if value
    ))
    raw_responses = _value(resolution, "response_by_participant", {}) or {}
    responses = dict(raw_responses) if isinstance(raw_responses, Mapping) else {}
    requires_intervention = (bool(_value(resolution, "requires_intervention", False))
                             if intervention_available is None else intervention_available)
    setup = TOPIC_SETUP_COPY.get(topic, (
        0, "Something changed, and I think we should talk about it.",
        "事情发生了变化，我想我们应该谈谈。", "talk", "concerned",
    ))
    opener_index = min(setup[0], max(0, len(participants) - 1)) if participants else 0
    opener = participants[opener_index] if participants else None
    others = [value for index, value in enumerate(participants) if index != opener_index]
    responder = others[0] if others else opener
    relationship_map = relationships or {}
    closeness, tension = (_relationship_band(relationship_map, opener, responder)
                          if opener and responder and opener != responder else ("new", "calm"))
    opener_profile = profiles.get(opener or "", {})
    responder_profile = profiles.get(responder or "", {})
    opener_mode = _voice_mode(opener_profile, topic)
    responder_mode = _voice_mode(responder_profile, topic)

    sequence = 0
    stage_beats: dict[str, list[dict[str, Any]]] = {stage: [] for stage in INTERACTION_STAGE_ORDER}

    def add(phase: str, speaker_id: str | None, line: tuple[str, str, object, str], mode: str) -> None:
        nonlocal sequence
        sequence += 1
        stage_beats[phase].append(_beat(
            collision_id=collision_id, sequence=sequence, phase=phase,
            speaker_id=speaker_id, text=line[0], translation_zh=line[1],
            cue=line[2], emotion=line[3], mode=mode,
        ))

    add("setup", opener, _voiced_setup(setup, opener_mode, topic), opener_mode)
    opener_role = participants.index(opener) if opener in participants else 0
    responder_role = participants.index(responder) if responder in participants else 0
    opener_response_id = str(responses.get(opener) or _fallback_response(topic, opener_role))
    responder_response_id = str(responses.get(responder) or _fallback_response(topic, responder_role))
    opener_copy = _response_copy(opener_response_id, topic=topic, role=opener_role)
    responder_copy = _response_copy(responder_response_id, topic=topic, role=responder_role)
    opener_style = _style_for(opener_response_id, scenario_id, catalog) or opener_copy.style
    responder_style = _style_for(responder_response_id, scenario_id, catalog) or responder_copy.style

    add("exchange", responder, (responder_copy.text, responder_copy.translation_zh,
                                 responder_copy.cue, responder_copy.emotion), responder_mode)
    if opener == responder:
        add("reaction", opener, _single_person_reaction(opener_profile, topic), opener_mode)
    else:
        opener_line = (_same_stance_line(opener_style)
                       if opener_response_id == responder_response_id
                       else (opener_copy.text, opener_copy.translation_zh,
                             opener_copy.cue, opener_copy.emotion))
        add("reaction", opener, opener_line, opener_mode)
        clarification = _clarification_line(
            speaker_profile=responder_profile, topic=topic,
            own_style=responder_style, heard_style=opener_style,
            closeness=closeness, tension=tension,
        )
        add("reaction", responder, clarification, responder_mode)

    closure = _closure_line(
        topic=topic, styles=(opener_style, responder_style),
        closeness=closeness, tension=tension, voice_mode=opener_mode,
        requires_intervention=requires_intervention,
    )
    add("closure", opener, closure, opener_mode)
    stages = []
    for stage_id in INTERACTION_STAGE_ORDER:
        label, label_zh = INTERACTION_STAGE_COPY[stage_id]
        beats = stage_beats[stage_id]
        stages.append({
            "id": stage_id, "label": label, "label_zh": label_zh,
            "duration_ms": sum(int(beat["duration_ms"]) for beat in beats),
            "intervention_checkpoint": stage_id == "reaction",
            "beats": beats,
        })
    return {
        "version": 1, "rules_version": INTERACTION_RULES_VERSION,
        "stages": stages,
    }


def public_interaction_scene(value: object, *, participant_ids: Sequence[str],
                             can_intervene: bool) -> dict[str, Any] | None:
    """Validate and whitelist a persisted scene for the public story DTO."""
    if not isinstance(value, Mapping) or not isinstance(value.get("stages"), Sequence):
        return None
    allowed_speakers = {str(npc_id) for npc_id in participant_ids}
    stages_by_id: dict[str, dict[str, Any]] = {}
    for raw_stage in value.get("stages", []):
        if not isinstance(raw_stage, Mapping):
            continue
        stage_id = str(raw_stage.get("id") or "")
        if stage_id not in INTERACTION_STAGE_ORDER or stage_id in stages_by_id:
            continue
        raw_beats = raw_stage.get("beats")
        if not isinstance(raw_beats, Sequence) or isinstance(raw_beats, (str, bytes)):
            continue
        beats = []
        for raw in raw_beats:
            if not isinstance(raw, Mapping):
                continue
            speaker = raw.get("speaker_id")
            if speaker is not None and str(speaker) not in allowed_speakers:
                continue
            text = str(raw.get("text") or "").strip()[:800]
            text_zh = str(raw.get("translation_zh") or "").strip()[:800]
            if not text or not text_zh:
                continue
            duration = max(900, min(6000, int(_number(raw.get("duration_ms"), 2400))))
            emotion = str(raw.get("emotion") or "neutral")
            beats.append({
                "id": stable_id(
                    "interaction-public-beat", stage_id, len(beats), speaker, text,
                    rules_version=INTERACTION_RULES_VERSION,
                ),
                "speaker_id": str(speaker) if speaker is not None else None,
                "text": text, "translation_zh": text_zh,
                "animation_cue": animation_cue(raw.get("animation_cue"), "talk"),
                "emotion": emotion if emotion in OBSERVABLE_EMOTIONS else "neutral",
                "phase": stage_id, "duration_ms": duration,
            })
        if not beats:
            continue
        label, label_zh = INTERACTION_STAGE_COPY[stage_id]
        stages_by_id[stage_id] = {
            "id": stage_id, "label": label, "label_zh": label_zh,
            "duration_ms": sum(beat["duration_ms"] for beat in beats),
            "can_intervene_after": bool(can_intervene and stage_id == "reaction"),
            "beats": beats,
        }
    if any(stage not in stages_by_id for stage in INTERACTION_STAGE_ORDER):
        return None
    stages = [stages_by_id[stage] for stage in INTERACTION_STAGE_ORDER]
    beats = [beat for stage in stages for beat in stage["beats"]]
    if any(beat["animation_cue"] not in ANIMATION_CUES for beat in beats):
        return None
    return {"version": 1, "stages": stages, "beats": beats}
