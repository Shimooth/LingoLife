import type {SharedDrinkStaging} from '../../types'
import type {LifeMotion} from './lifeRetarget'

export type DrinkBeat='approach'|'align'|'invite'|'wait'|'sit'|'settle'|'reach'|'lift'|'sip'|'lower'|'release'|'listen'|'decline'|'stand'|'depart_turn'|'leave'|'finished'
export type DrinkPose={beat:DrinkBeat;progress:number;linearProgress:number;localTime:number;elapsed:number;duration:number;motion?:LifeMotion;motionTime:number;seated:boolean;cup:'table'|'hand';handProgress:number}
const smooth=(value:number)=>{const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t)}
export const drinkEase=smooth

// Unwrapped seconds belong to the underlying pose, not to a short hand beat.
// In particular settle→reach→lift→sip must never restart the seated breathing.
export const DRINK_TIMELINES={
 active:[['approach',1.25],['align',.4],['sit',1.15],['settle',.65],['reach',1.05],['lift',1.15],['sip',1.8],['lower',1.15],['release',.75],['listen',Infinity]],
 completed:[['lower',1.15],['release',.75],['stand',1.15],['depart_turn',.4],['leave',2.1],['finished',Infinity]],
 interrupted:[['release',.6],['stand',1.15],['depart_turn',.4],['leave',2.1],['finished',Infinity]],
} as const

/** A finite visual performance of already-public facts, never a timer that settles gameplay.
 * Active people settle into listening, not a forever-repeating toast. Completed/declined
 * stories reach a stable end. The two people are staggered without inventing new outcomes. */
export function sampleDrinkPerformance(phase:SharedDrinkStaging['phase'],elapsed:number,index:number,initiator:boolean,reduced=false):DrinkPose{
 const t=reduced?999:Math.max(0,elapsed-(index? .65:0))
 let segments:readonly (readonly [DrinkBeat,number])[]
 if(phase==='active'||phase==='completed'||phase==='interrupted')segments=DRINK_TIMELINES[phase]
 else if(phase==='declined')segments=initiator?[['invite',1.4],['wait',1.2],['decline',1.2],['finished',Infinity]]:[['wait',1.4],['decline',1.2],['depart_turn',.4],['leave',2.1],['finished',Infinity]]
 else if(phase==='missed')segments=[['finished',Infinity]]
 else segments=initiator?[['invite',1.6],['wait',Infinity]]:[['wait',Infinity]]
 let cursor=t,beat:DrinkBeat='finished',duration=Infinity
 for(const item of segments){if(cursor<item[1]){[beat,duration]=item;break}cursor-=item[1]}
 const linearProgress=Number.isFinite(duration)?Math.max(0,Math.min(1,cursor/duration)):1
 const progress=smooth(linearProgress)
 const seated=['sit','settle','reach','lift','sip','lower','release','listen','stand'].includes(beat)
 const motion:LifeMotion|undefined=beat==='approach'||beat==='leave'?undefined:beat==='sit'?'Sit_Chair_Down':beat==='stand'?'Sit_Chair_StandUp':seated?'Sit_Chair_Idle':beat==='invite'?'Interact':'Idle_A'
 const seatedStart=phase==='active'?2.8:0
 const motionTime=beat==='sit'||beat==='stand'?progress*.799:seated?Math.max(0,t-seatedStart):t
 const handProgress=beat==='lift'?progress:beat==='sip'?1:beat==='lower'?1-progress:0
 return {beat,progress,linearProgress,localTime:cursor,elapsed:t,duration,motion,motionTime,seated,cup:['lift','sip','lower'].includes(beat)?'hand':'table',handProgress}
}

/** Unknown or incomplete staging must keep the ordinary scene: no guessed invitations. */
export function isSharedDrinkStage(value:unknown):value is SharedDrinkStaging{
 if(!value||typeof value!=='object')return false
 const stage=value as SharedDrinkStaging
 return stage.kind==='shared_drink'&&['invited','forming','active','completed','declined','interrupted','missed'].includes(stage.phase)
  &&Array.isArray(stage.participant_ids)&&stage.participant_ids.length===2&&new Set(stage.participant_ids).size===2
  &&stage.participant_ids.includes(stage.initiator_id)&&['tea','coffee','water'].includes(stage.beverage)
}
