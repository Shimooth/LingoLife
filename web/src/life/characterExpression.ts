import type {
 AnimationCue,
 LifeStory,
 ObservableLifeState,
 PublicRelationshipSummary,
 SocialInteraction,
 TroubleSignal,
} from '../types'
import type {CharacterMotion} from '../three/characters'
import type {NormalizedResidentAction} from './normalizeWorldSnapshot'

export type CharacterEmote=
 |'alert'|'anger'|'cloud'|'dots'|'drop'|'drops'|'exclamation'|'exclamations'
 |'faceAngry'|'faceHappy'|'faceSad'|'heart'|'heartBroken'|'hearts'|'idea'
 |'laugh'|'music'|'question'|'sleep'|'sleeps'|'star'|'stars'|'swirl'

export type CharacterExpressionTone='quiet'|'focused'|'social'|'positive'|'tired'|'tense'|'trouble'|'romantic'
export type CharacterExpressionVfx='sparkle'|'tension'|'steam'|'dust'

/**
 * Only coarse, player-observable semantics belong here. The server may add
 * more bands over time; unknown values intentionally fall back to the visible
 * LifeAction instead of leaking or guessing an authoritative hidden state.
 */
export type ObservableCharacterState=Partial<ObservableLifeState>

export type CharacterExpressionPlan={
 motion:CharacterMotion
 emote:CharacterEmote
 tone:CharacterExpressionTone
 vfx?:CharacterExpressionVfx
 intensity:1|2|3
 label:{zh:string;en:string}
 key:string
}

type ResidentExpressionInput={
 npcId:string
 action?:NormalizedResidentAction|null
 animationCue?:AnimationCue
 observableState?:ObservableCharacterState|null
 troubleSignal?:TroubleSignal|null
 story?:LifeStory|null
 relationship?:PublicRelationshipSummary|null
}

const cue=(value:AnimationCue|undefined,fallback:CharacterMotion):CharacterMotion=>value??fallback

const ACTION_EXPRESSION:Record<Extract<NormalizedResidentAction,{source:'life'}>['type'],Omit<CharacterExpressionPlan,'key'>>={
 prepare_food:{motion:'push',emote:'idea',tone:'focused',vfx:'steam',intensity:2,label:{zh:'专心准备食物',en:'Focused on cooking'}},
 eat:{motion:'idle',emote:'faceHappy',tone:'positive',intensity:1,label:{zh:'享受这一餐',en:'Enjoying a meal'}},
 sleep:{motion:'tired',emote:'sleeps',tone:'tired',intensity:1,label:{zh:'正在熟睡',en:'Fast asleep'}},
 shower:{motion:'idle',emote:'drops',tone:'quiet',vfx:'steam',intensity:1,label:{zh:'正在洗漱',en:'Freshening up'}},
 use_television:{motion:'idle',emote:'dots',tone:'quiet',intensity:1,label:{zh:'看得很投入',en:'Absorbed in a show'}},
 read:{motion:'idle',emote:'idea',tone:'focused',intensity:1,label:{zh:'沉浸在阅读中',en:'Absorbed in a book'}},
 practice_hobby:{motion:'happy',emote:'music',tone:'positive',vfx:'sparkle',intensity:2,label:{zh:'兴致勃勃地投入爱好',en:'Enthusiastically pursuing an interest'}},
 borrow_household_item:{motion:'talk',emote:'question',tone:'social',intensity:1,label:{zh:'正在商量借用物品',en:'Asking to borrow something'}},
 clean_shared_space:{motion:'push',emote:'stars',tone:'focused',vfx:'dust',intensity:2,label:{zh:'认真整理公共空间',en:'Tidying the shared space'}},
 leave_dishes:{motion:'look_around',emote:'dots',tone:'quiet',intensity:1,label:{zh:'把餐具留在了一边',en:'Leaving the dishes for later'}},
 rest_alone:{motion:'tired',emote:'cloud',tone:'tired',intensity:1,label:{zh:'享受独处时间',en:'Taking some quiet time'}},
 seek_company:{motion:'walk',emote:'heart',tone:'social',intensity:2,label:{zh:'想找个人作伴',en:'Looking for company'}},
 talk_to_resident:{motion:'talk',emote:'laugh',tone:'social',intensity:2,label:{zh:'聊得正投入',en:'Engaged in conversation'}},
}

const copyPlan=(plan:Omit<CharacterExpressionPlan,'key'>,key:string,patch:Partial<Omit<CharacterExpressionPlan,'key'>>={}):CharacterExpressionPlan=>({
 ...plan,...patch,label:patch.label??plan.label,key,
})

const idlePlan=(key:string):CharacterExpressionPlan=>({
 motion:'idle',emote:'dots',tone:'quiet',intensity:1,
 label:{zh:'正在过自己的生活',en:'Going about the day'},key,
})

const hobbyPlan=(action:Extract<NormalizedResidentAction,{source:'life'}>,key:string):CharacterExpressionPlan=>{
 const topic=action.raw.visible_context?.topic
 const variants:Record<string,Omit<CharacterExpressionPlan,'key'>>={
  music:{motion:'happy',emote:'music',tone:'positive',vfx:'sparkle',intensity:2,label:{zh:'正随着旋律投入练习',en:'Practicing with the music'}},
  art:{motion:'push',emote:'idea',tone:'focused',vfx:'sparkle',intensity:2,label:{zh:'正专注地创作',en:'Focused on creating'}},
  photography:{motion:'look_around',emote:'star',tone:'focused',vfx:'sparkle',intensity:2,label:{zh:'正在寻找有趣的画面',en:'Looking for an interesting shot'}},
  fitness:{motion:'jump',emote:'stars',tone:'positive',vfx:'dust',intensity:3,label:{zh:'正充满活力地训练',en:'Training with energy'}},
  gaming:{motion:'idle',emote:'alert',tone:'focused',intensity:2,label:{zh:'正专心研究游戏策略',en:'Focused on a game strategy'}},
  cooking:{motion:'push',emote:'idea',tone:'focused',vfx:'steam',intensity:2,label:{zh:'正在试验新的做法',en:'Experimenting with a recipe'}},
  reading:{motion:'idle',emote:'idea',tone:'focused',intensity:1,label:{zh:'正沉浸在资料里',en:'Absorbed in research'}},
  writing:{motion:'push',emote:'idea',tone:'focused',vfx:'sparkle',intensity:2,label:{zh:'正专心写下新的想法',en:'Focused on writing'}},
  nature:{motion:'crouch',emote:'stars',tone:'quiet',vfx:'sparkle',intensity:1,label:{zh:'正在观察和照料植物',en:'Observing and caring for plants'}},
  film:{motion:'look_around',emote:'star',tone:'focused',intensity:1,label:{zh:'正在研究影像表达',en:'Studying visual storytelling'}},
 }
 return copyPlan(variants[topic??'']??ACTION_EXPRESSION.practice_hobby,key)
}

const relationshipPlan=(relationship:PublicRelationshipSummary|undefined|null,key:string):CharacterExpressionPlan|null=>{
 const channels=relationship?.channels
 if(!channels)return null
 if(channels.romance==='separated')return {motion:'sad',emote:'heartBroken',tone:'trouble',intensity:2,label:{zh:'关系留下了伤感',en:'Feeling the weight of a separation'},key}
 if(channels.conflict==='feud'||channels.rivalry==='hostile')return {motion:'sad',emote:'faceAngry',tone:'trouble',vfx:'tension',intensity:3,label:{zh:'和某人的关系很紧张',en:'In a tense relationship'},key}
 if(channels.conflict==='open_conflict')return {motion:'look_around',emote:'anger',tone:'tense',vfx:'tension',intensity:2,label:{zh:'还在为一场冲突烦恼',en:'Still bothered by a conflict'},key}
 if(channels.romance==='partner')return {motion:'happy',emote:'hearts',tone:'romantic',vfx:'sparkle',intensity:2,label:{zh:'想起了亲密的伴侣',en:'Thinking fondly of a partner'},key}
 if(channels.romance==='dating')return {motion:'happy',emote:'heart',tone:'romantic',intensity:2,label:{zh:'心里有一份甜蜜的牵挂',en:'Carrying a warm romantic thought'},key}
 if(channels.rivalry==='competitive')return {motion:'look_around',emote:'alert',tone:'focused',intensity:2,label:{zh:'燃起了竞争心',en:'Feeling competitive'},key}
 if(channels.friendship==='close_friend')return {motion:'happy',emote:'laugh',tone:'social',intensity:1,label:{zh:'想到了亲近的朋友',en:'Thinking of a close friend'},key}
 return null
}

function storyRelationshipRelevant(story:LifeStory|undefined|null,relationship:PublicRelationshipSummary|undefined|null,npcId:string):boolean{
 if(!story||!relationship)return false
 const others=story.participant_ids.filter(id=>id!==npcId)
 return others.some(id=>relationship.participant_ids.includes(id))
}

export function deriveResidentExpression({npcId,action,animationCue,observableState,troubleSignal,story,relationship}:ResidentExpressionInput):CharacterExpressionPlan{
 const key=[npcId,action?.id??'idle',action?.status??'none',action?.source==='life'?action.phase??observableState?.phase??'':observableState?.phase??'',story?.id??'',relationship?.pair_key??'',troubleSignal?.id??troubleSignal?.kind??''].join(':')
 const lifeBase=action?.source==='life'?ACTION_EXPRESSION[action.type]:undefined
 const base=action?.source==='life'&&action.type==='practice_hobby'?hobbyPlan(action,key):lifeBase?copyPlan(lifeBase,key):idlePlan(key)

 if(action?.source==='life'&&(action.raw.visible_context?.visibility==='private'||action.type==='sleep'||action.type==='shower'))return {
  motion:'idle',emote:'cloud',tone:'quiet',intensity:1,
  label:{zh:'正在享受不被打扰的私人时间',en:'Taking some undisturbed private time'},key,
 }
 if(troubleSignal){
  const conflict=troubleSignal.kind==='conflict'
  const blocked=troubleSignal.kind==='blocked'
  return copyPlan(base,key,{
   motion:conflict?'sad':blocked?'look_around':'sad',emote:conflict?'faceAngry':blocked?'question':'exclamations',
   tone:'trouble',vfx:conflict?'tension':undefined,intensity:troubleSignal.severity==='high'?3:2,
   label:{zh:troubleSignal.disclosure==='subtle'?'似乎有点心事':troubleSignal.summary_zh?.trim()||'似乎遇到了一点麻烦',en:troubleSignal.disclosure==='subtle'?'Something is on their mind':troubleSignal.summary?.trim()||'Something seems to be troubling them'},
  })
 }
 if(action?.status==='traveling'||(action?.source==='life'&&action.phase==='approach')||observableState?.phase==='traveling')return copyPlan(base,key,{
  motion:'walk',emote:action?.source==='life'&&action.type==='seek_company'?'heart':'dots',tone:'focused',intensity:1,
  label:{zh:'正在前往下一件想做的事',en:'On the way to the next activity'},
 })
 if(action?.status==='blocked'||action?.status==='retrying'||observableState?.phase==='waiting')return copyPlan(base,key,{
  motion:'look_around',emote:action?.status==='retrying'?'swirl':'question',tone:'tense',intensity:2,
  label:{zh:action?.status==='retrying'?'正在换个办法':'正在等待合适的时机',en:action?.status==='retrying'?'Trying another way':'Waiting for the right moment'},
 })

 const relation=storyRelationshipRelevant(story,relationship,npcId)?relationshipPlan(relationship,key):null
 if(relation&&story&&story.level!=='thread')return relation

 if(observableState?.mood==='tense')return copyPlan(base,key,{motion:'sad',emote:'drops',tone:'tense',vfx:'tension',intensity:2,label:{zh:'看起来有些紧绷',en:'Looking a little tense'}})
 if(observableState?.mood==='tired'||observableState?.energy==='low')return copyPlan(base,key,{motion:'tired',emote:'sleep',tone:'tired',intensity:1,label:{zh:'看起来有些疲惫',en:'Looking a little tired'}})
 if(observableState?.mood==='upbeat')return copyPlan(base,key,{motion:base.motion==='walk'?base.motion:'happy',emote:base.tone==='focused'?base.emote:'faceHappy',tone:'positive',vfx:base.vfx??'sparkle',intensity:2,label:base.label})
 if(action?.status==='completed'||(action?.source==='life'&&action.phase==='exit'))return copyPlan(base,key,{motion:'happy',emote:'star',tone:'positive',vfx:'sparkle',intensity:2,label:{zh:'刚完成了一件事',en:'Just finished something'}})
 if(action?.status==='planned'||observableState?.phase==='planning')return copyPlan(base,key,{motion:'look_around',emote:'idea',tone:'focused',intensity:1,label:{zh:'正在盘算接下来做什么',en:'Deciding what to do next'}})

 return copyPlan(base,key,{motion:cue(animationCue,base.motion)})
}

export function deriveLifeStoryParticipantExpression(story:LifeStory,participantId:string,index=0):CharacterExpressionPlan{
 const key=`${story.id}:${story.status}:${participantId}`
 const beat=story.presentation?.beats?.find(item=>item.speaker_id===participantId&&item.animation_cue)
 const reaction=story.participant_reactions?.find(item=>item.npc_id===participantId)??story.outcome?.participant_reactions?.find(item=>item.npc_id===participantId)
 const reactionText=`${reaction?.reaction??''} ${reaction?.label??''} ${reaction?.label_zh??''}`.toLowerCase()
 const publicStoryText=`${story.title} ${story.title_zh??''} ${story.summary} ${story.summary_zh??''} ${story.presentation?.subject??''} ${story.presentation?.subject_zh??''}`.toLowerCase()
 const consequenceTone=story.consequences?.find(item=>item.kind==='relationship')?.tone??story.outcome?.consequences?.find(item=>item.kind==='relationship')?.tone
 if(story.trouble_signal?.kind==='conflict'||/angry|anger|生气|愤怒|敌意/.test(reactionText))return {motion:'sad',emote:'faceAngry',tone:'trouble',vfx:'tension',intensity:3,label:{zh:'正在气头上',en:'Feeling angry'},key}
 if(/breakup|broke up|separat|rejection|rejected|分手|分开|拒绝/.test(publicStoryText))return {motion:'sad',emote:'heartBroken',tone:'trouble',intensity:3,label:{zh:'这一刻留下了失落',en:'This moment carries heartbreak'},key}
 if(consequenceTone==='negative'||/sad|hurt|upset|难过|受伤|失望/.test(reactionText))return {motion:'sad',emote:'faceSad',tone:'trouble',intensity:2,label:{zh:'情绪有些低落',en:'Feeling down'},key}
 if(/\b(date|dating|romance|romantic|confess|confession|partner|couple|kiss)\b|约会|恋爱|浪漫|表白|心意|伴侣/.test(publicStoryText))return {motion:'happy',emote:index?'heart':'hearts',tone:'romantic',vfx:'sparkle',intensity:2,label:{zh:'这一刻带着甜蜜的心意',en:'A warm romantic moment'},key}
 if(consequenceTone==='positive'||/happy|relieved|grateful|开心|感激|释然/.test(reactionText))return {motion:'happy',emote:index?'heart':'faceHappy',tone:'positive',vfx:'sparkle',intensity:2,label:{zh:'心情变好了',en:'Feeling better'},key}
 if(story.status==='awaiting_management')return {motion:index?'listen':'talk',emote:'exclamation',tone:'tense',intensity:2,label:{zh:'等待事情有个结果',en:'Waiting to see what happens'},key}
 return {motion:cue(beat?.animation_cue,index?'listen':'talk'),emote:index?'dots':'question',tone:'social',intensity:1,label:{zh:'正在经历这段互动',en:'In the middle of this moment'},key}
}

export function deriveSocialParticipantExpression(event:SocialInteraction,participantId:string,index=0):CharacterExpressionPlan{
 const key=`${event.id}:${event.status}:${participantId}`
 const resolved=event.status==='resolved_autonomously'||event.status==='resolved_with_management'
 const motion=cue((resolved?event.outcome?.animation_cues?.[participantId]:event.animation_cues?.[participantId]),event.status==='traveling'?'walk':index?'listen':'talk')
 if(event.template_id==='small_misunderstanding'&&!resolved)return {motion,emote:index?'faceSad':'faceAngry',tone:'tense',vfx:'tension',intensity:2,label:{zh:'气氛有些微妙',en:'The mood is tense'},key}
 if(resolved&&motion==='sad')return {motion,emote:'faceSad',tone:'trouble',vfx:'tension',intensity:2,label:{zh:'这段互动留下了不愉快',en:'This moment ended on a difficult note'},key}
 if(resolved&&motion==='walk')return {motion,emote:'dots',tone:'quiet',intensity:1,label:{zh:'他们决定先各自冷静一下',en:'They decided to take some space'},key}
 if(resolved)return {motion,emote:'faceHappy',tone:'positive',vfx:'sparkle',intensity:2,label:{zh:'这段互动有了温暖的结果',en:'This moment reached a warm outcome'},key}
 if(event.status==='traveling')return {motion:'walk',emote:'dots',tone:'focused',intensity:1,label:{zh:'正在前往见面地点',en:'Heading to meet someone'},key}
 return {motion,emote:index?'dots':'laugh',tone:'social',intensity:1,label:{zh:'正在和另一位居民互动',en:'Interacting with another resident'},key}
}

export function deriveAnimationExpression(animation:CharacterMotion,key:string):CharacterExpressionPlan{
 if(animation==='happy'||animation==='jump')return {motion:animation,emote:'faceHappy',tone:'positive',vfx:'sparkle',intensity:2,label:{zh:'心情很好',en:'Feeling happy'},key}
 if(animation==='sad')return {motion:animation,emote:'faceSad',tone:'trouble',intensity:2,label:{zh:'情绪有些低落',en:'Feeling down'},key}
 if(animation==='tired'||animation==='crouch')return {motion:animation,emote:'sleep',tone:'tired',intensity:1,label:{zh:'看起来有些疲惫',en:'Looking tired'},key}
 if(animation==='push')return {motion:animation,emote:'idea',tone:'focused',intensity:2,label:{zh:'正在认真处理一件事',en:'Focused on the task'},key}
 if(animation==='talk')return {motion:animation,emote:'laugh',tone:'social',intensity:1,label:{zh:'很想和你聊聊',en:'Ready to talk'},key}
 if(animation==='listen'||animation==='look_around')return {motion:animation,emote:'question',tone:'focused',intensity:1,label:{zh:'正在认真听',en:'Listening closely'},key}
 return {motion:animation,emote:'dots',tone:'quiet',intensity:1,label:{zh:'正在过自己的生活',en:'Going about the day'},key}
}
