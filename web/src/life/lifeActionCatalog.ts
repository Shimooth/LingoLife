import type {AnimationCue,LifeAction,LifeActionStatus,LifeActionType} from '../types'

export type LifeLanguage='zh'|'en'
export type LocalizedLifeCopy={zh:string;en:string}
export type LifeScene='kitchen'|'dining'|'bedroom'|'bathroom'|'living-room'|'study'|'hobby'|'shared-space'|'city'|'social'
export type LifeAnchorKind='counter'|'table-seat'|'bed'|'shower'|'armchair'|'floor-seat'|'work-surface'|'room-center'|'doorway'|'conversation-pair'
export type LifeAnimationSemantic=
 |'pick_up_table'|'carry_item'|'use_item'|'put_down_item'
 |'prepare_food_enter'|'prepare_food_loop'|'prepare_food_exit'
 |'sit_down'|'sit_idle'|'stand_up'|'eat'|'drink'
 |'lie_down'|'sleep'|'wake_up'|'shower'
 |'watch_television'|'read'|'practice_hobby'|'clean'
 |'walk'|'wave'|'talk'|'listen'|'idle'

export type LifeActionPresentationContract={
 type:LifeActionType
 label:LocalizedLifeCopy
 activeLabel:LocalizedLifeCopy
 scene:LifeScene
 anchor:LifeAnchorKind
 enter:readonly LifeAnimationSemantic[]
 loop:readonly LifeAnimationSemantic[]
 exit:readonly LifeAnimationSemantic[]
 fallbackCue:AnimationCue
 propIds:readonly string[]
 vfxIds:readonly string[]
 sfxIds:readonly string[]
 privacy:'open'|'contextual'|'private'
 attention:'ambient'|'social'
 glyph:string
}

export const LIFE_ACTION_TYPES=[
 'prepare_food','eat','sleep','shower','use_television','read','practice_hobby','borrow_household_item','clean_shared_space','leave_dishes','rest_alone','seek_company','talk_to_resident',
] as const satisfies readonly LifeActionType[]

export const LIFE_ACTION_CATALOG={
 prepare_food:{type:'prepare_food',label:{zh:'准备食物',en:'Prepare food'},activeLabel:{zh:'正在准备食物',en:'Preparing food'},scene:'kitchen',anchor:'counter',enter:['pick_up_table','prepare_food_enter'],loop:['prepare_food_loop'],exit:['prepare_food_exit','put_down_item'],fallbackCue:'push',propIds:['cutting-board','knife','food-ingredient','pan','pot'],vfxIds:['steam'],sfxIds:['chop','knife-slice','metal-pot'],privacy:'open',attention:'ambient',glyph:'♨'},
 eat:{type:'eat',label:{zh:'吃东西',en:'Eat'},activeLabel:{zh:'正在吃东西',en:'Eating'},scene:'dining',anchor:'table-seat',enter:['sit_down','pick_up_table'],loop:['eat','drink'],exit:['put_down_item','stand_up'],fallbackCue:'idle',propIds:['plate','bowl','prepared-food','cup'],vfxIds:[],sfxIds:['tableware'],privacy:'open',attention:'ambient',glyph:'◉'},
 sleep:{type:'sleep',label:{zh:'睡觉',en:'Sleep'},activeLabel:{zh:'正在睡觉',en:'Sleeping'},scene:'bedroom',anchor:'bed',enter:['lie_down'],loop:['sleep'],exit:['wake_up'],fallbackCue:'tired',propIds:['bed','pillow'],vfxIds:['sleep'],sfxIds:['cloth','bed-creak'],privacy:'private',attention:'ambient',glyph:'☾'},
 shower:{type:'shower',label:{zh:'洗澡',en:'Shower'},activeLabel:{zh:'正在洗澡',en:'Taking a shower'},scene:'bathroom',anchor:'shower',enter:['use_item'],loop:['shower'],exit:['idle'],fallbackCue:'idle',propIds:['shower','towel'],vfxIds:['steam','water'],sfxIds:['shower'],privacy:'private',attention:'ambient',glyph:'◌'},
 use_television:{type:'use_television',label:{zh:'看电视',en:'Watch television'},activeLabel:{zh:'正在看节目',en:'Watching a show'},scene:'living-room',anchor:'armchair',enter:['sit_down','use_item'],loop:['watch_television'],exit:['stand_up'],fallbackCue:'idle',propIds:['television','remote','couch'],vfxIds:['screen-glow'],sfxIds:['television'],privacy:'open',attention:'ambient',glyph:'▣'},
 read:{type:'read',label:{zh:'阅读',en:'Read'},activeLabel:{zh:'正在安静地阅读',en:'Reading quietly'},scene:'study',anchor:'armchair',enter:['sit_down','pick_up_table'],loop:['read'],exit:['put_down_item','stand_up'],fallbackCue:'idle',propIds:['book','armchair','bookshelf'],vfxIds:[],sfxIds:['book-open','book-flip','book-close'],privacy:'open',attention:'ambient',glyph:'▤'},
 practice_hobby:{type:'practice_hobby',label:{zh:'投入兴趣或目标',en:'Pursue an interest or goal'},activeLabel:{zh:'正在投入兴趣或个人目标',en:'Working on an interest or personal goal'},scene:'hobby',anchor:'work-surface',enter:['use_item'],loop:['practice_hobby'],exit:['put_down_item'],fallbackCue:'happy',propIds:['board-game','radio','plant','hobby-tool'],vfxIds:['sparkle'],sfxIds:['hobby'],privacy:'open',attention:'ambient',glyph:'✦'},
 borrow_household_item:{type:'borrow_household_item',label:{zh:'向朋友借用物品',en:'Borrow from a friend'},activeLabel:{zh:'正在向朋友借用物品',en:'Borrowing something from a friend'},scene:'shared-space',anchor:'work-surface',enter:['pick_up_table'],loop:['carry_item','use_item'],exit:['put_down_item'],fallbackCue:'push',propIds:['book','hobby-tool','board-game'],vfxIds:[],sfxIds:['book-open'],privacy:'contextual',attention:'social',glyph:'↗'},
 clean_shared_space:{type:'clean_shared_space',label:{zh:'整理公共空间',en:'Clean the shared space'},activeLabel:{zh:'正在整理公共空间',en:'Cleaning the shared space'},scene:'shared-space',anchor:'room-center',enter:['pick_up_table'],loop:['clean'],exit:['put_down_item'],fallbackCue:'push',propIds:['cleaning-tool','bin','dirty-dishes'],vfxIds:['dust','sparkle'],sfxIds:['cleaning'],privacy:'open',attention:'ambient',glyph:'◇'},
 leave_dishes:{type:'leave_dishes',label:{zh:'留下餐具',en:'Leave the dishes'},activeLabel:{zh:'把餐具留在了水槽边',en:'Leaving dishes by the sink'},scene:'kitchen',anchor:'counter',enter:['carry_item'],loop:['put_down_item'],exit:['idle'],fallbackCue:'idle',propIds:['dirty-plate','dirty-bowl','sink'],vfxIds:[],sfxIds:['tableware'],privacy:'open',attention:'ambient',glyph:'◫'},
 rest_alone:{type:'rest_alone',label:{zh:'独自休息',en:'Rest alone'},activeLabel:{zh:'正在一个人放松',en:'Relaxing alone'},scene:'living-room',anchor:'floor-seat',enter:['sit_down'],loop:['sit_idle'],exit:['stand_up'],fallbackCue:'tired',propIds:['couch','armchair','rug'],vfxIds:[],sfxIds:['room-tone'],privacy:'contextual',attention:'ambient',glyph:'…'},
 seek_company:{type:'seek_company',label:{zh:'去找人作伴',en:'Seek company'},activeLabel:{zh:'正在去找人聊聊',en:'Going to find some company'},scene:'city',anchor:'doorway',enter:['walk'],loop:['walk'],exit:['wave'],fallbackCue:'walk',propIds:[],vfxIds:[],sfxIds:['footstep'],privacy:'open',attention:'social',glyph:'➜'},
 talk_to_resident:{type:'talk_to_resident',label:{zh:'和居民交谈',en:'Talk to a resident'},activeLabel:{zh:'正在和另一位居民聊天',en:'Talking with another resident'},scene:'social',anchor:'conversation-pair',enter:['wave'],loop:['talk','listen'],exit:['idle'],fallbackCue:'talk',propIds:[],vfxIds:['speech'],sfxIds:[],privacy:'open',attention:'social',glyph:'◌'},
} as const satisfies Record<LifeActionType,LifeActionPresentationContract>

const ACTION_SET:ReadonlySet<string>=new Set(LIFE_ACTION_TYPES)

export function isLifeActionType(value:unknown):value is LifeActionType{
 return typeof value==='string'&&ACTION_SET.has(value)
}

export function lifeActionContract(type:LifeActionType):LifeActionPresentationContract{
 return LIFE_ACTION_CATALOG[type]
}

export function localizedLifeCopy(copy:LocalizedLifeCopy,language:LifeLanguage):string{
 return copy[language]
}

export function lifeActionIntent(action:Pick<LifeAction,'type'|'visible_intent'|'visible_intent_zh'>,language:LifeLanguage):string{
 if(language==='zh')return action.visible_intent_zh?.trim()||LIFE_ACTION_CATALOG[action.type].activeLabel.zh
 return action.visible_intent?.trim()||LIFE_ACTION_CATALOG[action.type].activeLabel.en
}

const STATUS_COPY:Record<LifeActionStatus,LocalizedLifeCopy>={
 planned:{zh:'准备去做',en:'Getting ready'},traveling:{zh:'正在前往',en:'On the way'},performing:{zh:'正在进行',en:'In progress'},blocked:{zh:'暂时被打断',en:'Temporarily blocked'},retrying:{zh:'正在换个办法',en:'Trying another way'},completed:{zh:'刚刚完成',en:'Just finished'},abandoned:{zh:'暂时放下了',en:'Set aside for now'},interrupted:{zh:'被另一件事打断',en:'Interrupted'},
}

export function lifeActionStatusLabel(status:LifeActionStatus,language:LifeLanguage):string{
 return localizedLifeCopy(STATUS_COPY[status],language)
}
