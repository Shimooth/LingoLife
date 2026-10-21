import type {PersonalityAxes} from './types'
export type {PersonalityAxes} from './types'

type Copy = { zh: string; en: string }
export const DEFAULT_PERSONALITY: PersonalityAxes = {
  warmth: 65, extraversion: 40, assertiveness: 40, openness: 60, emotional_stability: 65, humor: 55,
}

export const PERSONALITY_AXES: readonly { key: keyof PersonalityAxes; label: Copy; low: Copy; high: Copy }[] = [
  { key: 'warmth', label: { zh: '待人的方式', en: 'With other people' }, low: { zh: '慢慢熟悉', en: 'Takes time' }, high: { zh: '亲切热心', en: 'Warm-hearted' } },
  { key: 'extraversion', label: { zh: '社交的步调', en: 'Social rhythm' }, low: { zh: '安静自在', en: 'Quiet company' }, high: { zh: '主动热闹', en: 'Loves company' } },
  { key: 'assertiveness', label: { zh: '表达想法', en: 'Speaking their mind' }, low: { zh: '温和商量', en: 'Gentle approach' }, high: { zh: '直接坚定', en: 'Direct and firm' } },
  { key: 'openness', label: { zh: '面对新鲜事', en: 'Something new' }, low: { zh: '熟悉安心', en: 'Enjoys the familiar' }, high: { zh: '好奇探索', en: 'Curious explorer' } },
  { key: 'emotional_stability', label: { zh: '情绪的节奏', en: 'Emotional rhythm' }, low: { zh: '敏感细腻', en: 'Feels deeply' }, high: { zh: '沉着安稳', en: 'Steady and calm' } },
  { key: 'humor', label: { zh: '日常的趣味', en: 'Everyday humor' }, low: { zh: '认真踏实', en: 'Earnest and grounded' }, high: { zh: '俏皮风趣', en: 'Playful and witty' } },
]

export function normalizePersonality(value: Partial<PersonalityAxes> | null | undefined): PersonalityAxes {
  return Object.fromEntries(PERSONALITY_AXES.map(({ key }) => {
    const raw = value?.[key]
    return [key, typeof raw === 'number' && Number.isFinite(raw) ? Math.round(Math.max(0, Math.min(100, raw))) : DEFAULT_PERSONALITY[key]]
  })) as PersonalityAxes
}

const GROUPS = [
  { id: 'gentle', name: { zh: '温和派', en: 'The gentle ones' }, impression: { zh: '相处舒服，愿意慢慢认识身边的人。', en: 'Easy to be around, with time to get to know people.' }, color: '#678574', types: [
    ['安稳陪伴型', 'Steady companion', '熟悉的小事让生活踏实，也喜欢静静陪在朋友身边。', 'Familiar little things feel comforting. They enjoy simply being there for a friend.'],
    ['暖心逗趣型', 'Gentle joker', '习惯舒服的节奏，却常常用一个小玩笑让大家放松。', 'They like a comfortable rhythm and a little joke that puts everyone at ease.'],
    ['细腻寻趣型', 'Thoughtful explorer', '留意日常的小细节，也愿意悄悄尝试一点新鲜事。', 'They notice little details and quietly make room for something new.'],
    ['悠悠漫想型', 'Playful daydreamer', '按自己的步调生活，脑海里总有新鲜又有趣的小念头。', 'They follow their own rhythm, with a head full of curious, playful ideas.'],
  ] },
  { id: 'lively', name: { zh: '明朗派', en: 'The bright ones' }, impression: { zh: '亲切开朗，让第一次见面也不那么拘谨。', en: 'Warm and outgoing, making a first meeting feel a little easier.' }, color: '#c18548', types: [
    ['热心同行型', 'Caring companion', '喜欢和大家一起行动，会认真记住朋友需要的帮助。', 'They like doing things together and remember when a friend needs help.'],
    ['阳光捧场型', 'Cheerful encourager', '熟悉的人和开心的气氛最合心意，总愿意为别人加油。', 'Familiar faces and a happy atmosphere suit them. They love cheering people on.'],
    ['好奇领路型', 'Curious guide', '发现有意思的事情，就想邀请大家一起来试试看。', 'When something catches their interest, they invite everyone to give it a try.'],
    ['灵感派对型', 'Spark of the party', '点子来得快，笑声也来得快，喜欢把新鲜体验分享给朋友。', 'Quick with an idea and a laugh, they love sharing new experiences with friends.'],
  ] },
  { id: 'thoughtful', name: { zh: '沉思派', en: 'The thoughtful ones' }, impression: { zh: '初见有些含蓄，熟悉之后会看到丰富的内心。', en: 'Reserved at first, with more to discover as you get to know them.' }, color: '#79849c', types: [
    ['专注守序型', 'Focused keeper', '珍惜熟悉的习惯，喜欢把手头的事情一件件做好。', 'They treasure familiar routines and take care with one thing at a time.'],
    ['静静幽默型', 'Quiet wit', '平时话不多，偶尔冒出的幽默却很有自己的味道。', 'Usually quiet, their unexpected humor has a flavor all its own.'],
    ['独立琢磨型', 'Independent thinker', '喜欢留一点独处时间，慢慢弄明白让自己好奇的问题。', 'They enjoy some time alone to work through whatever has sparked their curiosity.'],
    ['奇想收藏型', 'Collector of curiosities', '爱观察也爱想象，会把寻常的小事变成有趣的发现。', 'Observant and imaginative, they turn ordinary moments into amusing discoveries.'],
  ] },
  { id: 'spirited', name: { zh: '率性派', en: 'The spirited ones' }, impression: { zh: '有自己的主意，认识之后更能理解这份坦率。', en: 'They know their own mind; their candor makes more sense as you grow closer.' }, color: '#b77970', types: [
    ['坚定行动型', 'Determined doer', '心里有清楚的方向，习惯用实际行动表达自己的想法。', 'With a clear sense of direction, they tend to show their ideas through action.'],
    ['爽快搭档型', 'Straight-talking sidekick', '表达直接，也喜欢轻松玩笑；认定的朋友会认真相待。', 'Direct and fond of a joke, they take their friendships seriously.'],
    ['自主开拓型', 'Independent trailblazer', '有了新想法就想试一试，愿意自己走出一条路。', 'A new idea makes them want to try things, even if they have to find their own way.'],
    ['随兴冒险型', 'Playful adventurer', '喜欢即兴决定和意外惊喜，常常带来出乎意料的趣事。', 'They enjoy spontaneous decisions and little surprises, often with an unexpected story to tell.'],
  ] },
] as const

/** Every axis contributes; exact midpoints consistently select the upper band. */
export function describePersonality(input: PersonalityAxes) {
  const axes = normalizePersonality(input)
  const energetic = axes.extraversion * .65 + axes.assertiveness * .35 >= 50
  const welcoming = axes.warmth * .7 + axes.emotional_stability * .3 >= 50
  const groupIndex = welcoming ? (energetic ? 1 : 0) : (energetic ? 3 : 2)
  const subtype = (axes.openness >= 50 ? 2 : 0) + (axes.humor >= 50 ? 1 : 0)
  const group = GROUPS[groupIndex]
  const selected = group.types[subtype]
  const traitOptions: Record<keyof PersonalityAxes, [string, string]> = {
    warmth: ['慢热', '温柔'], extraversion: ['内向', '外向'], assertiveness: ['温和', '自信'],
    openness: ['务实', '好奇'], emotional_stability: ['敏感', '沉稳'], humor: ['认真', '幽默'],
  }
  const prominent = [...PERSONALITY_AXES].sort((a, b) => Math.abs(axes[b.key] - 50) - Math.abs(axes[a.key] - 50))
  const traits = prominent.slice(0, 4).map(({ key }) => traitOptions[key][axes[key] >= 50 ? 1 : 0])
  const traitEnglish: Record<string, string> = {
    '慢热': 'Reserved', '温柔': 'Warm', '内向': 'Quiet', '外向': 'Outgoing',
    '温和': 'Gentle', '自信': 'Confident', '务实': 'Practical', '好奇': 'Curious',
    '敏感': 'Sensitive', '沉稳': 'Calm', '认真': 'Earnest', '幽默': 'Witty',
  }
  return {
    id: `${group.id}-${subtype}`, groupId: group.id, group: group.name, color: group.color,
    name: { zh: selected[0], en: selected[1] }, description: { zh: selected[2], en: selected[3] },
    impression: group.impression, traits, traitLabels: {zh: traits, en: traits.map(trait => traitEnglish[trait])},
  }
}

export function residentIntroduction(name: string, personality: PersonalityAxes): Copy {
  const axes = normalizePersonality(personality)
  const social = axes.extraversion >= 50
    ? { en: 'I would love to get to know everyone here.', zh: '我很想认识这里的每一个人。' }
    : { en: 'I like taking my time to get to know someone.', zh: '我喜欢慢慢认识一个人。' }
  const interest = axes.openness >= 50
    ? { en: 'I wonder what we will discover together.', zh: '不知道我们会一起发现些什么呢。' }
    : { en: 'I hope we can share some lovely everyday moments.', zh: '希望我们能一起度过一些舒服的日常时光。' }
  return { en: `Hi, I'm ${name.trim() || 'your new neighbor'}. ${social.en} ${interest.en}`, zh: `你好，我是${name.trim() || '你的新邻居'}。${social.zh}${interest.zh}` }
}
