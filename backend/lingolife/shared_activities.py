"""Small, persistent joint activities. Real actions, never dialogue, prove completion."""
from datetime import datetime, timedelta
import re
from .life import stable_id, stable_fraction
from .city import LOCATION_BY_ID
from . import pair_memory

FINAL = {'completed', 'declined', 'interrupted', 'missed'}
KINDS = {
    'drink_break': ('A drink and a little company', '坐下来喝一杯', 'talk_to_resident', 'A short, non-alcoholic drink break together. Invitation is not participation; respect a refusal. No invented brewing expertise, purchases or past conversation.', '一起坐下来喝点不含酒精的饮品。邀请不等于已参与，尊重拒绝；不虚构冲泡技术、购买或往事。'),
    'reading': ('A chapter together', '一起读一小段', 'read', 'Read a short passage together; no claim of finishing a book.', '一起读一小段，不能声称读完了整本书。'),
    'lesson': ('Show me how', '教我一招', 'practice_hobby', 'One resident demonstrates an interest; the other tries it. No invented expertise or mastery.', '一人示范自己的爱好，另一人试试；不代表专业老师，也不代表已经学会。'),
    'practice': ('One more try together', '一起再试一次', 'practice_hobby', 'Practice a shared interest together, without inventing scores, prizes or a winner.', '一起练共同爱好，不虚构分数、奖品或胜负。'),
}
PHASES = {
    'invited': ('An invitation, not a completed activity.', '刚发出邀请，还没有一起做。'),
    'forming': ('They agreed to try; waiting for a free moment.', '愿意试试，等手上的事告一段落。'),
    'active': ('Both residents are taking part at the same place.', '两个人已经到一起，正在参与。'),
    'completed': ('Both finished their part after spending time together.', '两个人一起参与了一段时间，各自完成了这次练习。'),
    'declined': ('The invitation did not become a shared plan.', '这次没约成，各自继续自己的事。'),
    'interrupted': ('The activity stopped before both could finish.', '中途有别的事，这次没有一起做完。'),
    'missed': ('They did not find a shared free moment this time.', '一直没凑上共同的空闲，这次先放下。'),
}
LEISURE = {'read', 'practice_hobby', 'use_television', 'seek_company', 'talk_to_resident'}
SUBJECT_LABELS = {'music': '音乐', 'books': '读书', 'reading': '阅读', 'history': '历史',
                  'cooking': '烹饪', 'art': '绘画', 'fitness': '健身', 'gaming': '游戏',
                  'photography': '摄影', 'writing': '写作', 'nature': '自然', 'film': '电影'}
SUBJECT_LABELS.update({'tea': '茶', 'coffee': '咖啡', 'water': '水'})


def preferred_drink(values):
    for value in values:
        text = value.casefold().replace('’', "'")
        # Free-text interests sometimes contain boundaries rather than likes.
        # Skip the whole entry conservatively, including mixed statements such
        # as "no coffee, but tea is fine"; never infer permission to consume.
        negative_zh = ('不喜欢', '不喝', '讨厌', '不爱', '不能', '不可', '不要', '不想',
                       '不碰', '不宜', '不适合', '不耐受', '过敏', '忌', '戒', '避免', '拒绝')
        negative_en = r"\b(?:no|not|never|without|avoid\w*|hate\w*|dislik\w*|allerg\w*|intoleran\w*|quit\w*|cannot|can't|don't|doesn't|won't|wouldn't|shouldn't|mustn't|unable)\b"
        if any(token in text for token in negative_zh) or re.search(negative_en, text):
            continue
        if '咖啡' in text or re.search(r'\bcoffee\b', text):
            return 'coffee'
        if '茶' in text or re.search(r'\btea\b', text):
            return 'tea'
    return None


def clock(value):
    return datetime.fromisoformat(value)


def interests(profile):
    value = profile.get('interests') or []
    return sorted({str(x).strip()[:64] for x in value if str(x).strip()}) if isinstance(value, list) else []


def active_for(state, npc_id):
    return next((item for item in state.get('shared_activities', {}).values()
                 if npc_id in item['participants'] and item['phase'] not in FINAL), None)


def is_cafe(location):
    venue = LOCATION_BY_ID.get(location)
    return bool(venue and venue.kind == 'cafe')


def present_at_cafe(resident, location):
    action = resident.get('current_action') or {}
    return (resident.get('current_location_id') == location
            and action.get('location_id') == location
            and action.get('status') == 'performing')


def offer(state, collision, profiles, now):
    if collision.topic != 'companionship' or len(collision.participant_ids) != 2:
        return None
    ids = list(collision.participant_ids)
    residents = [state['residents'][key] for key in ids]
    if residents[0]['household_id'] != residents[1]['household_id'] or any(active_for(state, key) for key in ids):
        return None
    location = collision.location_id
    cafe = is_cafe(location)
    home = bool(location) and all(location == r.get('home_location_id') or location.startswith(r['household_id'] + ':') for r in residents)
    if not home and not cafe:
        return None
    if home and location != residents[0].get('home_location_id') and location.split(':')[1] not in {'living-room', 'living_room', 'kitchen', 'shared-kitchen'}:
        return None  # Never turn a private bedroom/bathroom encounter into a group session.
    if cafe and not all(present_at_cafe(r, location)
                        and r['current_action'].get('action_type') in LEISURE for r in residents):
        return None  # A journey, shift or meal is not a voluntary drink together.
    history = list(state.get('shared_activities', {}).values())
    recent = [item for item in history if set(item['participants']) == set(ids)
              and now-clock(item['created_at']) < timedelta(hours=24 if item['phase'] == 'declined' else 8)]
    if recent:
        return None
    first, second = (interests(profiles.get(key, {})) for key in ids)
    common = sorted(set(first) & set(second))
    kinds = []
    drink = preferred_drink(first+second)
    # Public cafes support this same limited drink contract indoors. Other
    # joint activities retain their existing household-only locations.
    lounge = home and (location == residents[0].get('home_location_id') or location.split(':')[1] in {'living-room', 'living_room'})
    if drink and (lounge or cafe):
        kinds.append('drink_break')
    reading = ('book', 'read', 'literature', 'history', '读', '书', '文学', '历史')
    if not cafe and any(any(token in word.casefold() for token in reading) for word in first+second):
        kinds.append('reading')
    if not cafe and (first or second):
        kinds.append('lesson')
    if not cafe and common:
        kinds.append('practice')
    if not kinds:
        return None  # Do not manufacture an interest just to fill a quota.
    counts = {kind: sum(item['kind'] == kind for item in history[-16:]) for kind in kinds}
    kind = min(kinds, key=lambda k: (counts[k], stable_fraction(collision.id, k)))
    teachers = [key for key, values in zip(ids, (first, second)) if values]
    teacher = min(teachers, key=lambda key: stable_fraction(collision.id, 'demonstrator', key))
    subjects = common if kind == 'practice' else first if teacher == ids[0] else second
    subject = min(subjects, key=lambda word: (sum(old['subject'] == word for old in history[-16:]),
                                              stable_fraction(collision.id, word)))
    if kind == 'reading':
        subject = next(word for word in first+second if any(token in word.casefold() for token in reading))
    if kind == 'drink_break':
        subject = drink
    item = {'id': stable_id('shared-activity', collision.id), 'collision_id': collision.id,
            'kind': kind, 'participants': ids, 'teacher_id': teacher, 'subject': subject,
            'household_id': residents[0]['household_id'], 'location_id': location,
            'phase': 'invited', 'created_at': now.isoformat(), 'updated_at': now.isoformat(),
            'join_after': (now+timedelta(seconds=45)).isoformat(),
            'deadline': (now+timedelta(minutes=45)).isoformat(), 'assigned_actions': {}, 'actions': {}, 'completed_ids': []}
    state.setdefault('shared_activities', {})[item['id']] = item
    # Bound storage while preserving active commitments.
    for old in history[:-60]:
        if old['phase'] in FINAL:
            state['shared_activities'].pop(old['id'], None)
    return item


def facts(item):
    return {'activity_id': item['id'], 'activity_kind': item['kind'], 'activity_subject': item['subject'],
            'activity_phase': item['phase'], 'activity_goal': KINDS[item['kind']][3],
            'activity_goal_zh': KINDS[item['kind']][4], 'teacher_id': item['teacher_id']}


def set_phase(state, item, phase, now):
    if item['phase'] == phase:
        return
    item['phase'] = phase
    item['updated_at'] = now.isoformat()
    for record in state.get('stories', {}).values():
        if (record.get('collision') or {}).get('id') == item['collision_id']:
            record['collision']['facts'].update(facts(item))
            record['story']['updated_at'] = now.isoformat()
    if phase in FINAL:
        ids = item['participants']
        if len(ids) == 2:
            pair_memory.capture(state, {'id': f"{item['id']}:{phase}", 'topic': 'shared_activity',
                'facts': {'activity_kind': item['kind'], 'activity_subject': item['subject'], 'activity_phase': phase}},
                {'outcome_tags': [f'shared_activity_{phase}']},
                [{'npc_id': owner, 'other_npc_id': target} for owner, target in (ids, ids[::-1])], now)
        for npc_id in item['participants']:
            resident = state['residents'].get(npc_id)
            if not resident:
                continue
            history = resident.setdefault('shared_activity_history', [])
            if not any(x['id'] == item['id'] for x in history):
                history.append({'id': item['id'], 'kind': item['kind'], 'phase': phase, 'at': now.isoformat()})
                resident['shared_activity_history'] = history[-12:]


def settled(state, collision, resolution, now):
    item = state.get('shared_activities', {}).get((collision.facts or {}).get('activity_id'))
    if not item or item['phase'] != 'invited':
        return
    accepted = {'welcome_company', 'share_activity', 'enjoy_silence'}
    answers = resolution.response_by_participant
    agree = all(answers.get(key) in accepted for key in item['participants'])
    if item['kind'] != 'reading' and any(answers.get(key) == 'enjoy_silence' for key in item['participants']):
        agree = False  # Quiet company is not consent to a lesson.
    paused = any(value in {'wait', 'interrupt', 'substitute', 'abandon'}
                 for value in getattr(resolution, 'action_instructions', {}).values())
    set_phase(state, item, 'missed' if agree and paused else 'forming' if agree else 'declined', now)
    if agree and not paused:
        item['join_after'] = (now+timedelta(seconds=45)).isoformat()
        item['deadline'] = (now+timedelta(minutes=45)).isoformat()


def hint(state, npc_id, now):
    item = active_for(state, npc_id)
    if not item or item['phase'] not in {'forming', 'active'} or npc_id in item['completed_ids'] or now >= clock(item['deadline']):
        return None
    return item


def ready_to_switch(state, npc_id, now):
    item = hint(state, npc_id, now)
    action = state['residents'][npc_id].get('current_action') or {}
    return bool(item and now >= clock(item['join_after']) and npc_id not in item['actions']
                and action.get('status') == 'performing' and action.get('interruptible')
                and action.get('action_type') in LEISURE)


def started(state, npc_id, action, now):
    item = hint(state, npc_id, now)
    if not item or action.status != 'performing' or item['assigned_actions'].get(npc_id) != action.id:
        return
    if is_cafe(item['location_id']) and (action.location_id != item['location_id']
            or (state['residents'][npc_id].get('current_action') or {}).get('id') != action.id
            or not present_at_cafe(state['residents'][npc_id], item['location_id'])):
        return
    item['actions'].setdefault(npc_id, {'id': action.id, 'start': now.isoformat(), 'end': None})
    if len(item['actions']) == len(item['participants']):
        # Both must actually be present, not merely have started at different times.
        if all((state['residents'][key].get('current_action') or {}).get('id') == item['actions'][key]['id']
               and (state['residents'][key].get('current_action') or {}).get('status') == 'performing'
               and (not is_cafe(item['location_id']) or present_at_cafe(state['residents'][key], item['location_id']))
               for key in item['participants']):
            set_phase(state, item, 'active', now)


def completed(state, npc_id, action, now):
    item = active_for(state, npc_id)
    if not item or item['actions'].get(npc_id, {}).get('id') != action.id:
        return
    item['actions'][npc_id]['end'] = now.isoformat()
    if npc_id not in item['completed_ids']:
        item['completed_ids'].append(npc_id)
    if len(item['completed_ids']) != len(item['participants']):
        return
    intervals = list(item['actions'].values())
    overlap = (min(clock(x['end']) for x in intervals)-max(clock(x['start']) for x in intervals)).total_seconds()
    set_phase(state, item, 'completed' if overlap >= 60 else 'missed', now)


def advance(state, now):
    for item in state.get('shared_activities', {}).values():
        if item['phase'] in FINAL:
            continue
        if now >= clock(item['deadline']):
            set_phase(state, item, 'interrupted' if item['actions'] else 'missed', now)
        elif any(key not in state['residents'] or (key not in item['completed_ids']
                 and key in item['assigned_actions'] and (
                     (state['residents'][key].get('current_action') or {}).get('id') != item['assigned_actions'][key]
                     or (state['residents'][key].get('current_action') or {}).get('status') in {'interrupted', 'abandoned'})) for key in item['participants']):
            set_phase(state, item, 'interrupted', now)
        elif is_cafe(item['location_id']) and any(
                key in item['actions'] and key not in item['completed_ids']
                and not present_at_cafe(state['residents'][key], item['location_id'])
                for key in item['participants']):
            set_phase(state, item, 'interrupted', now)


def public(item):
    title, title_zh = KINDS[item['kind']][:2]
    text, zh = PHASES[item['phase']]
    if item['kind'] == 'drink_break':
        text, zh = {
            'invited': ('An invitation to sit down for a drink.', '邀请对方坐下来喝点东西。'),
            'forming': ('They agreed to a drink break, once they are both free.', '约好等手上的事忙完，一起坐坐。'),
            'active': ('They are sitting together for a drink and a chat.', '两个人正一起喝点东西，聊一会儿。'),
            'completed': ('They spent a little time together over a drink.', '两个人一起喝了点东西，聊了一会儿。'),
            'declined': ('The invitation was declined; they gave each other space.', '这次没约成，给彼此留点空间。'),
            'interrupted': ('Their drink break was interrupted.', '这次小歇被别的事情打断了。'),
            'missed': ('They did not find time for the drink break.', '没凑上空闲，这次先各忙各的。'),
        }[item['phase']]
    return {'id': item['id'], 'title': title, 'title_zh': title_zh, 'phase': item['phase'],
            'summary': text, 'summary_zh': zh, 'subject': item['subject'],
            'subject_zh': SUBJECT_LABELS.get(item['subject'].casefold(), item['subject']),
            'participant_ids': list(item['participants'])}


def staging(item):
    if item['kind'] != 'drink_break':
        return None
    return {'kind': 'shared_drink', 'phase': item['phase'],
            'participant_ids': list(item['participants']), 'initiator_id': item['participants'][0],
            'beverage': item['subject'] if item['subject'] in {'tea', 'coffee'} else 'water'}


def annotate_observable(state, npc_id, action, observable, target_name):
    """Only describe the assigned action, never an invitation as work underway."""
    item = active_for(state, npc_id)
    if (not item or item['assigned_actions'].get(npc_id) != action.id
            or action.status != 'performing' or observable['visible_context'].get('visibility') == 'private'):
        return
    partner = target_name or 'a housemate'
    subject_zh = SUBJECT_LABELS.get(item['subject'].casefold(), item['subject'])
    if item['phase'] != 'active':
        en, zh = f'Waiting for {partner} to join', f'正等{partner}过来'
    elif item['kind'] == 'drink_break':
        en, zh = f'Taking a drink break with {partner}', f'正和{partner}一起喝点东西'
    elif item['kind'] == 'reading':
        en, zh = f'Reading a short passage with {partner}', f'正和{partner}一起读一小段'
    elif item['kind'] == 'lesson':
        if npc_id == item['teacher_id']:
            en, zh = f'Sharing a little {item["subject"]} practice with {partner}', f'正带{partner}试试{subject_zh}'
        else:
            en, zh = f'Trying {item["subject"]} with {partner}', f'正跟{partner}试试{subject_zh}'
    else:
        en, zh = f'Practicing {item["subject"]} with {partner}', f'正和{partner}一起练{subject_zh}'
    observable.update(visible_intent=en, visible_intent_zh=zh)
    observable['visible_context'].update(activity=en, activity_zh=zh)
    observable['visible_context'].update(activity_id=item['id'], activity_kind=item['kind'], activity_phase=item['phase'])
    drink_stage = staging(item)
    if drink_stage:
        observable['visible_context'].update(activity_beverage=drink_stage['beverage'],
            activity_participant_ids=drink_stage['participant_ids'], activity_initiator_id=drink_stage['initiator_id'])
