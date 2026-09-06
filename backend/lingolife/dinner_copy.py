"""Meal-stage speech; five voices share exactly the same action semantics."""
from __future__ import annotations

from .interaction_copy import MODES, Pair, response_pair

# measured / direct / reserved / warm / playful
LINES: dict[str, tuple[Pair, ...]] = {
    "invite": (("I'm cooking. Who's eating with me?", "我来做饭，谁一起吃？"), ("I'll cook. Tell me if you're in.", "我做饭，要吃就说一声。"), ("I'll cook. Join me?", "我做饭，一起吃？"), ("I'll make us something. Come eat if you're up for it.", "我来做点吃的，想一起就来呀。"), ("Kitchen duty accepted. Taking applications for eaters.", "厨房任务已接取，现招募吃饭队员。")),
    "full": (("Still full. I'll sit this one out.", "还饱着呢，这顿不吃了。"), ("Not hungry. No food for me.", "不饿，我这份不用了。"), ("Still full.", "还饱着。"), ("You eat. I'm still full from before.", "你们吃，我还没消化完呢。"), ("No room left. Stomach's closed for business.", "装不下了，胃已经打烊。")),
    "tired": (("I'm wiped out. Need some rest first.", "累瘫了，得先歇着。"), ("Too tired. I'm resting instead.", "太累，不吃了，先休息。"), ("Need rest. Not today.", "想歇着，今天不了。"), ("I can't keep my energy up. I'll rest this time.", "真撑不住精神了，这次先歇着。"), ("Battery flat. I need to recharge, not socialize.", "电量耗尽，得充电，聊不动了。")),
    "alone": (("I'm having some time to myself tonight.", "今晚我想自己待着。"), ("I'm keeping tonight to myself.", "今晚我自己待着。"), ("Quiet evening for me.", "今晚想静静。"), ("I need a quiet night on my own. You enjoy it.", "我想一个人安静一晚，你们好好吃。"), ("Tonight's a one-person gathering. Just me.", "今晚是单人聚会，嘉宾只有我。")),
    "busy": (("Let me finish this bit first. Then I'll join you.", "让我先把这点弄完，再来。"), ("After I finish this. Don't start counting me out.", "我弄完就来，别把我漏了。"), ("In a bit. Finishing something.", "待会儿来，还差一点。"), ("I want to join. Just let me wrap this up first.", "想一起吃的，让我先收个尾。"), ("Save a place for a person currently losing a fight with their to-do list.", "给这位正在跟待办事项搏斗的人留个位子。")),
    "cooking": (("Right. Let's get this food going.", "行，开始弄吃的。"), ("I'm on the cooking now.", "我开始做了。"), ("Starting now.", "开始做了。"), ("I'll get this going. You can take a breather.", "我开始弄了，你们先歇会儿。"), ("Chef mode. Let's see how this goes.", "厨子模式启动，看看发挥。")),
    "waiting_food": (("I'll sit here till it's ready.", "我在这儿坐着等开饭。"), ("I'll wait here for the food.", "我就在这儿等饭。"), ("I'll wait here.", "我在这儿等。"), ("I'll keep you company here while you cook.", "你做饭，我在这儿陪着等会儿。"), ("I'm contributing my excellent waiting skills.", "我负责贡献高超的等饭技术。")),
    "waiting_others": (("No rush. I'll sit a bit longer.", "不急，我再坐会儿。"), ("Finish yours. I'm staying a bit.", "你吃完，我再待会儿。"), ("I'll stay a bit.", "再坐会儿。"), ("Keep eating. I'll hang out here with you.", "你慢慢吃，我在这儿陪你。"), ("I've moved on to the professional sitting-around part.", "我已进入专业饭后闲坐环节。")),
    "ate": (("Done eating. My dishes are by the sink.", "吃好了，我的碗在水槽边。"), ("Finished. Dishes are by the sink.", "吃完了，碗在水槽边。"), ("Done. Dishes by the sink.", "好了，碗在水槽边。"), ("I've finished mine. My dishes are by the sink for now.", "我这份吃完了，碗先放水槽边了。"), ("Food: dealt with. Dishes: by the sink, looking hopeful.", "饭：解决。碗：在水槽边满怀期待。")),
    "cleaned": (("Washed up. That's that done.", "洗完了，这活儿算完。"), ("Dishes done. Kitchen's usable again.", "碗洗好了，厨房能用了。"), ("All washed.", "洗好了。"), ("All washed up. Nice having the kitchen clear again.", "洗好了，厨房清爽了，看着舒服。"), ("The sink is free. A small but important victory.", "水槽解放，一场小而重要的胜利。")),
    "cleanup": (("I'll wash up once I finish this.", "弄完手上的我就来洗碗。"), ("I'll take the dishes after this.", "接下来碗归我洗。"), ("I'll wash up after.", "我待会儿洗。"), ("I'll do the washing-up after this. You've had enough to do.", "我忙完来洗碗，你们也忙够了。"), ("I'll take on the dishes after this. Thrilling evening plans.", "我忙完就挑战洗碗，多么激动人心的夜间安排。")),
    "no_cleanup": (("Not now. I'm too tired for dishes.", "现在不行，没力气洗碗了。"), ("Too tired. Not doing dishes now.", "太累，现在不洗。"), ("Can't. Too tired.", "不行，太累。"), ("I can't help right now. I'm worn out.", "现在实在搭不上手，太累了。"), ("No energy left for a sink-side adventure.", "没力气再参加水槽探险了。")),
}


def meal_line(intent: str, mode: str) -> Pair:
    if intent == "accepted":
        return response_pair("accept_shared_food", mode, ("I'm in.", "算我一个。"))
    return LINES[intent][MODES.index(mode) if mode in MODES else 0]
