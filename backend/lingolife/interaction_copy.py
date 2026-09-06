"""Bilingual spoken copy, keyed by situation and *already decided* intent.

No state changes, invented memories, food preferences or relationship labels.
Each variant preserves its intent. Humor is situational, not a generic prefix.
"""
from __future__ import annotations

Pair = tuple[str, str]

# normal, direct, reserved, warm, playful. Quiet does not mean permanently shy;
# warmth means attention to the other person, not compulsory gratitude.
SETUPS: dict[str, tuple[Pair, ...]] = {
    "shared_kitchen": (
        ("Oh, you need the kitchen too?", "咦，你也要用厨房？"),
        ("I need the kitchen. How are we doing this?", "我要用厨房，咱俩怎么安排？"),
        ("Kitchen taken?", "厨房有人用了？"),
        ("You're cooking too? What do we do about the space?", "你也要做饭？这地方怎么分呀？"),
        ("Two cooks, one kitchen. Here we go.", "两个厨子，一个厨房。好戏来了。")),
    "bathroom_access": (
        ("Still in there? I'm waiting out here.", "还在里面吗？我在外面等着呢。"),
        ("How much longer? I need a turn.", "还要多久？我也要用。"),
        ("Nearly done?", "快好了吗？"),
        ("Everything okay in there? I'm waiting for a turn.", "里面还好吧？我等着用呢。"),
        ("Hello from the queue of one.", "这里是只有一个人的排队现场，你好。")),
    "shared_entertainment": (
        ("Wait, I wanted to pick something too.", "等等，我也有想看的。"),
        ("Hold on. Who gets the remote?", "等一下，遥控器归谁？"),
        ("Can I pick something?", "我能选个节目吗？"),
        ("I have an idea for what to watch. Want to hear it?", "我有个想看的，要听听吗？"),
        ("One remote. Two very important opinions.", "一个遥控器，两位都很有主见。")),
    "companionship": (
        ("Room for one more?", "还能加我一个吗？"),
        ("Want company, or are you doing your own thing?", "想有人陪，还是想自己待着？"),
        ("Mind if I stay?", "我能待会儿吗？"),
        ("Feel like hanging out for a bit?", "要不要一起待会儿？"),
        ("Taking applications for company?", "这里还招陪聊吗？")),
    "missed_connection": (
        ("Bad timing? I wanted to catch you for a minute.", "来得不是时候？我想找你说会儿话。"),
        ("Got a minute, or not now?", "有空吗，还是现在不行？"),
        ("Busy?", "在忙？"),
        ("I wanted to see you. Is this a bad moment?", "想找你待会儿，现在不方便吗？"),
        ("Did I arrive right in the middle of something? Classic timing.", "我是不是刚好赶上你忙？这时机选的。")),
    "dishwashing": (
        ("So... these dishes?", "所以……这些碗呢？"),
        ("The dishes are still here. Who's doing them?", "碗还在这儿，谁洗？"),
        ("Still not washed.", "还没洗。"),
        ("We still have these dishes to deal with.", "咱们还有这些碗没处理呢。"),
        ("The dishes haven't learned to wash themselves, then.", "看来这些碗还没学会自己洗澡。")),
    "unequal_care": (
        ("I'm doing a lot of the looking after here.", "这家里不少照顾人的活都落我身上了。"),
        ("I can't keep carrying this much.", "这么多事，我没法一直扛。"),
        ("It's a lot. For one person.", "一个人做，太多了。"),
        ("I like helping. I'm getting worn out, though.", "我愿意帮忙，可我也快累趴了。"),
        ("I seem to have become the entire support team.", "我好像一个人承包了整个后勤组。")),
    "privacy": (
        ("Hang on. I wanted to be alone in here.", "等一下，我想在这儿一个人待着。"),
        ("You need to ask before coming in.", "进来之前得先问我。"),
        ("I wanted some space.", "我想自己待着。"),
        ("I need this bit of space to myself, okay?", "这会儿让我自己待着，好吗？"),
        ("There is a door. That was meant to be a hint.", "这里有扇门，本来是想起点作用的。")),
    "borrowed_property": (
        ("You could've asked before taking it.", "拿之前可以先问我啊。"),
        ("That's mine. Ask first.", "那是我的，先问再拿。"),
        ("I didn't say you could take it.", "我没说能拿走。"),
        ("I don't mind being asked. I mind not being asked.", "问我不麻烦，不问我才让我难受。"),
        ("Apparently my stuff has a social life without me.", "看来我的东西背着我出去串门了。")),
    "blocked_plan": (
        ("Oh. So that's not happening.", "啊，看来这计划行不通了。"),
        ("This won't work. What's the other option?", "这样不行，还有什么办法？"),
        ("Well. Now what?", "好吧，现在呢？"),
        ("That's a shame. I was looking forward to this.", "真可惜，我还挺期待的。"),
        ("Excellent. My plan has left without me.", "好极了，我的计划先一步跑路了。")),
    "food_shortage": (
        ("We're short on ingredients.", "食材不够了。"),
        ("Not enough food. We need another plan.", "吃的不够，得换个办法。"),
        ("Not much left.", "没剩多少了。"),
        ("I wanted to make something, but we're short on supplies.", "本想做点吃的，可食材不够。"),
        ("Today's special: not enough ingredients.", "今日特供：食材不足。")),
    "noise": (
        ("I keep losing my place with all that noise.", "这么吵，我老是做到一半就断了思路。"),
        ("Too loud. I can't concentrate.", "太吵了，我没法专心。"),
        ("A bit loud.", "有点吵。"),
        ("Can we figure out the noise? I'm trying to focus.", "咱们能想想办法吗？我想专心做点事。"),
        ("My thoughts would like a turn at being heard.", "我的脑子也想争取一点发言权。")),
    "friendly_competition": (
        ("Want to see who's better at this?", "比比看谁更厉害？"),
        ("You and me. A little competition?", "咱俩比一场？"),
        ("Want to try a round?", "要比一轮吗？"),
        ("Let's try a little challenge together.", "咱们一起挑战一下吧。"),
        ("Fancy a contest? I can be a very modest winner.", "比一场？我赢了也可以很谦虚的。")),
    "trash_duty": (
        ("The bin's full. Whose turn?", "垃圾桶满了，轮到谁？"),
        ("Full bin. We need to sort out the turns.", "垃圾满了，轮班得说清楚。"),
        ("Bin's full again.", "垃圾又满了。"),
        ("We need to work out who's taking that bin out.", "咱们得看看谁去倒这桶垃圾。"),
        ("The bin has reached its final form.", "垃圾桶已经进化到最终形态了。")),
    "private_food": (
        ("Where's the food I saved?", "我留的那份吃的呢？"),
        ("My food's gone. I was saving that.", "我的吃的不见了，那是我特意留的。"),
        ("That was my portion.", "那份是我的。"),
        ("I was looking forward to that food. It's gone.", "我还盼着吃那份呢，结果没了。"),
        ("My food has vanished. Impressive trick. Not a fan.", "我的食物凭空消失了，好魔术，我不喜欢。")),
    "shared_food": (
        ("Want some? I made extra.", "吃点吗？我多做了些。"),
        ("I've made extra. Eating with me?", "多做了点，一起吃？"),
        ("Made extra. Want some?", "多做了点，要吗？"),
        ("Come have some if you feel like it. I made extra.", "想吃就来吃点呀，我多做了些。"),
        ("I appear to have cooked for an audience. Hungry?", "我好像按开宴会的量做了。饿不饿？")),
}

# Everyday intent vocabulary, including the less frequent collision scenarios.
RESPONSES: dict[str, Pair] = {
    "wait": ("Go ahead. I'll wait.", "你先吧，我等会儿。"),
    "negotiate": ("You take one side, I'll take the other. Work for you?", "你用一边，我用另一边，行吗？"),
    "cook_together": ("Or we could just cook together?", "要不干脆一起做？"),
    "argue": ("I was here first. I'm not moving.", "我先来的，我不让。"),
    "knock_and_ask": ("How much longer in there?", "里面还要多久啊？"),
    "offer_quick_turn": ("Give me a minute. You're next.", "让我快点弄完，下一个就是你。"),
    "snap_at_other": ("Seriously? I'm still waiting here.", "不是吧？我还在这儿等着呢。"),
    "choose_together": ("Let's pick something we both want to watch.", "挑个咱俩都想看的吧。"),
    "take_turns": ("One pick each. That's fair, right?", "一人选一次，公平吧？"),
    "yield_remote": ("Your pick. Next one's mine, though.", "你选吧，不过下次归我。"),
    "grab_remote": ("No, I'm watching what I picked.", "不行，我就要看我选的。"),
    "welcome_company": ("Stay a bit. I'd like that.", "待会儿吧，我还挺想有人陪的。"),
    "share_activity": ("Come join in, if you want.", "想一起就来呀。"),
    "enjoy_silence": ("Stay. Just... no need to talk the whole time.", "留下吧，就是……不用一直找话说。"),
    "decline_kindly": ("Not today. I need some time on my own.", "今天不了，我想自己待会儿。"),
    "try_later": ("Okay. I'll catch you later.", "行，那晚点再找你。"),
    "leave_a_note": ("I'll leave a note so you know I stopped by.", "留张字条吧，让你知道我来过。"),
    "feel_rejected": ("Oh. I know you're busy. Still stings, though.", "噢。我知道你忙，可还是有点难受。"),
    "interrupt_anyway": ("No, listen. I need to say this now.", "不，你先听我说，我现在就得说。"),
    "clean_without_comment": ("I'll do it this time.", "这次我来吧。"),
    "remind_calmly": ("You left these. Can you finish up?", "这些是你留下的，收个尾行吗？"),
    "offer_to_share": ("Split the washing-up with me?", "跟我分着洗？"),
    "send_angry_message": ("I'm not your cleaning service.", "我又不是你请的保洁。"),
    "ask_for_recognition": ("Do you even notice how much I'm doing?", "我做了这么多，你到底有没有看见？"),
    "renegotiate_roles": ("We need to split this up differently.", "这些事得重新分工了。"),
    "keep_overfunctioning": ("Fine. I'll do it. Again.", "行，我来，又是我。"),
    "stop_helping": ("I'm done carrying this. Someone else can step in.", "我不扛了，换别人来吧。"),
    "apologize_and_leave": ("Sorry. I'll leave you alone.", "抱歉，我先出去，你自己待着吧。"),
    "explain_urgency": ("It felt urgent. That's why I came in.", "我觉得挺急的，所以就进来了。"),
    "set_clear_boundary": ("Ask before coming in. I mean it.", "进来前先问，我是认真的。"),
    "dismiss_concern": ("Oh, come on. It's not that big a deal.", "拜托，有这么严重吗？"),
    "return_and_apologize": ("Here, I'm giving it back. Should've asked.", "喏，还你，是该先问一声。"),
    "ask_retroactively": ("I should've asked. Can we sort this out?", "是我没先问，这事咱们怎么处理？"),
    "state_borrowing_rule": ("Ask before borrowing my stuff. Every time.", "借我的东西先问一声，每次都要。"),
    "deny_responsibility": ("Why's this suddenly my fault?", "怎么突然就成我的错了？"),
    "choose_alternative": ("Right. I'll try something else.", "行吧，我换个办法。"),
    "wait_for_opening": ("I'll wait until it's available.", "我等到能用的时候吧。"),
    "ask_for_help": ("Does anyone know another way to do this?", "有人知道还有什么办法吗？"),
    "abandon_plan": ("Forget it. I can't face starting over.", "算了，实在不想从头折腾。"),
    "shop_for_ingredients": ("I'll go get what's missing.", "缺的我去买吧。"),
    "share_remaining_food": ("We can split what's left. It isn't much.", "剩下的分着吃吧，就是不多。"),
    "order_simple_meal": ("Let's just order something simple.", "干脆点个简单的吃吧。"),
    "blame_household": ("How did we all let the food run this low?", "咱们怎么能把食材耗到这份上？"),
    "move_to_quiet_place": ("I'm finding somewhere quiet. Can't focus here.", "我找个安静地方去，这里没法专心。"),
    "ask_to_lower_volume": ("Turn it down, will you? I'm trying to focus.", "小点声行吗？我正想专心呢。"),
    "use_headphones": ("Headphones it is. I'll keep working.", "戴耳机吧，我继续做我的。"),
    "start_argument": ("You're not listening. That's the problem.", "你根本没在听，这才是问题。"),
    "cheer_each_other_on": ("Let's push each other. We can both get better.", "互相加把劲儿吧，咱俩都能变厉害。"),
    "compete_fairly": ("Same rules for both of us. Deal?", "咱俩规则一样，说定了？"),
    "focus_on_improving": ("I'm trying to beat my own best, not you.", "我想超越的是我自己，不是你。"),
    "turn_it_personal": ("Friendly? You just want to beat me.", "友好切磋？你就是想赢我。"),
    "take_trash_out_now": ("I'll take it out. We can sort the turns after.", "我先去倒，之后再说轮班。"),
    "agree_trash_schedule": ("Let's write down whose turn it is.", "把轮到谁写下来吧。"),
    "leave_trash_reminder": ("Your turn. Before it spills over, please.", "轮到你了，别等到满出来啊。"),
    "refuse_trash_duty": ("Not my mess. I'm not taking it out.", "不是我弄的，我不倒。"),
    "replace_taken_food": ("I took the wrong one. I'll replace it. I'll ask next time.", "我拿错那份了，我补给你，下次先问。"),
    "explain_food_mixup": ("I thought it was for everyone. Sorry, I got that wrong.", "我以为大家都能吃呢，抱歉，弄错了。"),
    "label_private_food": ("Let's put names on our food. Still ask before taking it.", "吃的写上名字吧，拿之前还是得问。"),
    "deny_taking_food": ("You don't know it was me. Stop blaming me.", "你又不知道是不是我，别赖我。"),
    "accept_shared_food": ("Yeah, I'll have some.", "好啊，给我来点。"),
    "share_food_together": ("Let's split it and eat together.", "分着吃吧，一起吃。"),
    "save_food_for_later": ("Save my bit? I'll eat later.", "帮我留一份？我晚点吃。"),
    "decline_shared_food": ("I'll pass. Not feeling hungry right now.", "我就算了，这会儿不想吃。"),
}

# Focused full-sentence variants for frequently observed intentions. Other
# intentions keep the concise semantic baseline instead of adding catchphrases.
VOICE_RESPONSES: dict[str, dict[str, Pair]] = {
    "wait": {"reserved": ("I'll wait.", "我等吧。"), "direct": ("You finish first. Then me.", "你先弄完，然后我来。"), "warm": ("Finish up. I can wait a bit.", "你先弄完，我能再等会儿。"), "playful": ("I'll wait. Very impressive patience happening over here.", "我等。这边正在展示惊人的耐心。")},
    "negotiate": {"reserved": ("Half each?", "一人一半？"), "direct": ("Split the space. We both need it.", "地方分开用，咱俩都要用。"), "warm": ("Let's make room for both of us.", "咱们挤挤，都能用上。"), "playful": ("Let's draw an imaginary border down the middle.", "咱在中间画条看不见的国界吧。")},
    "cook_together": {"reserved": ("Cook together?", "一起做？"), "direct": ("Let's cook together. Easier.", "一起做吧，省事。"), "warm": ("Come cook with me. I'd like the company.", "来跟我一起做吧，有个伴儿挺好。"), "playful": ("Team up? Two cooks can't possibly be trouble.", "组队？两个厨子怎么可能添乱呢。")},
    "welcome_company": {"reserved": ("Yeah. Stay.", "嗯，留下吧。"), "direct": ("Stay. I want some company.", "留下，我想有人陪。"), "warm": ("Come on, stay a while. It's nice having you here.", "来嘛，多待会儿，有你在挺好的。"), "playful": ("You're in. Very exclusive club of two.", "批准加入，两个人的限量俱乐部。")},
    "share_activity": {"reserved": ("Join in?", "一起来？"), "direct": ("Let's do this together.", "咱俩一起弄。"), "warm": ("Come join me. It's nicer with company.", "来跟我一起吧，有人陪更好。"), "playful": ("Join in. I could use a partner in this extremely serious business.", "来搭把手，这可是咱们的重大事业。")},
    "decline_kindly": {"reserved": ("Not today. Need some quiet.", "今天不了，想静静。"), "direct": ("I want to be alone today.", "今天我想自己待着。"), "warm": ("I'm not up for company today. It's not you.", "今天没力气陪人待着，不是因为你。"), "playful": ("My social battery's dead. Solo time today.", "社交电量清零，今天单人模式。")},
    "enjoy_silence": {"reserved": ("Stay. Quietly, though.", "待着吧，安静点就好。"), "direct": ("Stay if you want. We don't need to keep talking.", "想留就留，不用一直聊。"), "warm": ("We can just be here together. No need to fill the quiet.", "就一起待着吧，安静也挺好的。"), "playful": ("Company, yes. Compulsory small talk, no.", "欢迎陪伴，不欢迎强制尬聊。")},
    "remind_calmly": {"reserved": ("These are yours to finish.", "这些还得你收尾。"), "direct": ("Finish the dishes you left.", "把你留下的碗洗完。"), "warm": ("Can you finish these up? I don't want to keep reminding you.", "把这些收拾完吧，我也不想老提醒你。"), "playful": ("Your dishes are requesting a reunion. At the sink.", "你的碗申请跟你团聚，地点水池。")},
    "offer_to_share": {"reserved": ("Half each? I'll help.", "一人一半？我搭把手。"), "direct": ("Split the dishes with me.", "跟我分着洗。"), "warm": ("Let's get through these together.", "来，一起把这些搞定。"), "playful": ("Team washing-up? Not glamorous, but it's a team.", "组个洗碗队？不够威风，好歹也是个队。")},
    "argue": {"reserved": ("No. I was first.", "不，我先来的。"), "direct": ("I got here first. End of discussion.", "我先到的，没什么好说的。"), "warm": ("I don't like arguing, but I was here first. I'm staying.", "我不想吵，可我先来的，我不让。")},
    "set_clear_boundary": {"reserved": ("Ask first. Please.", "先问一声，行吗。"), "direct": ("Don't come in without asking.", "别不问就进来。"), "warm": ("I need you to ask first, even if we're getting along.", "就算咱俩处得好，也得先问一声。")},
    "accept_shared_food": {"reserved": ("Yeah. Some, please.", "嗯，来点。"), "direct": ("I'm in. Pass me some.", "吃，给我来点。"), "warm": ("Yes! Eating together sounds nice.", "好呀！一起吃挺好的。"), "playful": ("I accept this very important invitation to eat.", "本人接受这份重要的吃饭邀请。")},
    "share_food_together": {"reserved": ("Split it? Eat together?", "分一分，一起吃？"), "direct": ("Split it between us. Let's eat.", "咱俩分着，开吃。"), "warm": ("Let's share it. I like eating with company.", "分着吃吧，我喜欢有人陪着吃饭。"), "playful": ("Split it with me. A very edible team project.", "跟我分着吃，一个可以吃掉的合作项目。")},
    "save_food_for_later": {"reserved": ("Later. Save me some?", "晚点吃，帮我留点？"), "direct": ("Save my portion. I'll eat later.", "我的留着，晚点吃。"), "warm": ("I'd like some later. Could you keep a bit for me?", "晚点想吃，帮我留一点好不好？"), "playful": ("Can I reserve a portion for future me?", "能给未来的我预订一份吗？")},
    "decline_shared_food": {"reserved": ("No food for me right now.", "这会儿不吃。"), "direct": ("Not hungry. I'll pass.", "不饿，我不吃了。"), "warm": ("You eat. I'm not hungry right now.", "你吃吧，我这会儿不饿。"), "playful": ("Stomach says no. Very firm decision.", "胃说不吃，态度很坚决。")},
}

# Concrete topic callbacks: neither a settlement nor a claim an action happened.
CALLBACKS: dict[str, Pair] = {
    "shared_kitchen": ("It's a small kitchen when we both need it.", "咱俩都要用的时候，这厨房可真小。"),
    "bathroom_access": ("Waiting out here isn't much fun.", "在外面干等着可不好玩。"),
    "shared_entertainment": ("Picking something is almost a whole show by itself.", "光选节目就快够演一集了。"),
    "companionship": ("I didn't have a big plan. Just wanted some company.", "也没什么大安排，就是想有人陪。"),
    "missed_connection": ("The timing's awkward, isn't it?", "这时机就是挺尴尬的，是吧？"),
    "dishwashing": ("I don't want the sink to be the main topic in this house.", "我可不想咱家天天围着水池说事。"),
    "unequal_care": ("I don't want looking after the house to swallow the whole day.", "我不想一整天都耗在照顾家里这些事上。"),
    "privacy": ("A closed door needs to mean something.", "关上门总得有点意义吧。"),
    "borrowed_property": ("It's the asking that matters.", "重点是先问一声。"),
    "blocked_plan": ("Not the day I had in mind.", "跟我想好的这一天不一样了。"),
    "food_shortage": ("Hard to cook with things we don't have.", "没食材，想做也做不出来啊。"),
    "noise": ("It's hard to think over the noise.", "这声音盖着，脑子根本转不动。"),
    "friendly_competition": ("Let's see how this goes.", "看看这场会怎么样。"),
    "trash_duty": ("That bin isn't getting any emptier by itself.", "那垃圾桶可不会自己变空。"),
    "private_food": ("Food isn't automatically up for grabs.", "吃的摆着也不等于谁都能拿。"),
    "shared_food": ("Meals are a whole thing in a shared house, huh?", "合住以后，吃顿饭还挺有讲究哈。"),
}

MODES = ("measured", "direct", "reserved", "warm", "playful")


def setup_pair(topic: str, mode: str, fallback: Pair) -> Pair:
    rows = SETUPS.get(topic)
    return rows[MODES.index(mode) if mode in MODES else 0] if rows else fallback


def response_pair(intent: str, mode: str, fallback: Pair) -> Pair:
    return VOICE_RESPONSES.get(intent, {}).get(mode, RESPONSES.get(intent, fallback))
