import type {SharedDrinkStaging} from '../../types'
import type {LifeMotion} from './lifeRetarget'

export type DrinkBeat='approach'|'invite'|'wait'|'sit'|'settle'|'reach'|'lift'|'sip'|'lower'|'release'|'listen'|'decline'|'stand'|'leave'|'finished'
export type DrinkPose={beat:DrinkBeat;progress:number;motion?:LifeMotion;motionTime:number;seated:boolean;cup:'table'|'hand';handProgress:number}
const smooth=(value:number)=>{const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t)}
export const drinkEase=smooth

/** A finite visual performance of already-public facts, never a timer that settles gameplay.
 * Active people settle into listening, not a forever-repeating toast. Completed/declined
 * stories reach a stable end. The two people are staggered without inventing new outcomes. */
export function sampleDrinkPerformance(phase:SharedDrinkStaging['phase'],elapsed:number,index:number,initiator:boolean,reduced=false):DrinkPose{
 const t=reduced?999:Math.max(0,elapsed-(index? .65:0))
 let segments:[DrinkBeat,number][]
 if(phase==='active')segments=[['approach',1.6],['sit',1],['settle',.8],['reach',1],['lift',1.15],['sip',1.8],['lower',1.25],['release',.7],['listen',Infinity]]
 else if(phase==='completed')segments=[['lower',1.5],['release',.8],['stand',1],['leave',2.4],['finished',Infinity]]
 else if(phase==='declined')segments=initiator?[['invite',1.4],['wait',1.2],['decline',1.2],['finished',Infinity]]:[['wait',1.4],['decline',1.2],['leave',2.4],['finished',Infinity]]
 else if(phase==='interrupted')segments=[['release',.6],['stand',1],['leave',2.4],['finished',Infinity]]
 else if(phase==='missed')segments=[['finished',Infinity]]
 else segments=initiator?[['invite',1.6],['wait',Infinity]]:[['wait',Infinity]]
 let cursor=t,beat:DrinkBeat='finished',duration=Infinity
 for(const item of segments){if(cursor<item[1]){[beat,duration]=item;break}cursor-=item[1]}
 const progress=Number.isFinite(duration)?smooth(cursor/duration):1
 const seated=['sit','settle','reach','lift','sip','lower','release','listen','stand'].includes(beat)
 const motion:LifeMotion|undefined=beat==='approach'||beat==='leave'?undefined:beat==='sit'?'Sit_Chair_Down':beat==='stand'?'Sit_Chair_StandUp':seated?'Sit_Chair_Idle':beat==='invite'?'Interact':'Idle_A'
 const motionTime=beat==='sit'||beat==='stand'?progress*.799:cursor%(motion==='Sit_Chair_Idle'?3.6:motion==='Interact'?1.3:1.066667)
 const handProgress=beat==='lift'?progress:beat==='sip'?1:beat==='lower'?1-progress:0
 return {beat,progress,motion,motionTime,seated,cup:['lift','sip','lower'].includes(beat)?'hand':'table',handProgress}
}

/** Unknown or incomplete staging must keep the ordinary scene: no guessed invitations. */
export function isSharedDrinkStage(value:unknown):value is SharedDrinkStaging{
 if(!value||typeof value!=='object')return false
 const stage=value as SharedDrinkStaging
 return stage.kind==='shared_drink'&&['invited','forming','active','completed','declined','interrupted','missed'].includes(stage.phase)
  &&Array.isArray(stage.participant_ids)&&stage.participant_ids.length===2&&new Set(stage.participant_ids).size===2
  &&stage.participant_ids.includes(stage.initiator_id)&&['tea','coffee','water'].includes(stage.beverage)
}
