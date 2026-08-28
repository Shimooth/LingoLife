import type {AnimationCue,City,CityResident,LifeAction,LifeActionStatus,LifeActionType,ResidentWorldAction,TroubleSignal} from '../types'
import {isLifeActionType,lifeActionContract} from './lifeActionCatalog'

export type NormalizedLifeAction={
 source:'life'
 id:string
 type:LifeActionType
 status:LifeActionStatus
 phase?:LifeAction['phase']
 originLocationId?:string
 locationId:string
 targetId?:string
 targetNpcId?:string
 targetResourceId?:string
 targetLocationId?:string
 plannedAt?:string
 arrivesAt?:string
 startedAt?:string
 endsAt?:string
 retryAt?:string
 visibleIntent?:string
 visibleIntentZh?:string
 interruptibility:NonNullable<LifeAction['interruptibility']>
 animationCue?:AnimationCue
 presentation?:LifeAction['presentation']
 raw:LifeAction
}

export type NormalizedLegacyAction={
 source:'legacy'
 id:string
 type:'idle'|'living'|'legacy_event'
 status:'planned'|'traveling'|'performing'
 locationId:string
 targetLocationId?:string
 startedAt?:string
 endsAt?:string
 eventId?:string
 participantIndex?:number
 animationCue?:AnimationCue
 raw:ResidentWorldAction
}

export type NormalizedResidentAction=NormalizedLifeAction|NormalizedLegacyAction
export type NormalizedResident=CityResident&{
 action:NormalizedResidentAction|null
 visibleIntent?:string
 visibleIntentZh?:string
 troubleSignal?:TroubleSignal|null
}

export type NormalizedWorldSnapshot={
 raw:City
 date:string
 worldVersion?:string|number
 rulesVersion?:string
 serverTime?:string
 serverTimeMs?:number
 nextTransitionAt?:string
 nextTransitionAtMs?:number
 residents:NormalizedResident[]
 households:NonNullable<City['households']>
 moments:NonNullable<City['observable_moments']>
 incidents:NonNullable<City['open_incidents']>
 storyThreads:NonNullable<City['story_threads']>
 socialInteractions:NonNullable<City['social_interactions']>
}

const LIFE_STATUS=new Set<LifeActionStatus>(['planned','traveling','performing','blocked','retrying','completed','abandoned','interrupted'])
const INTERRUPTIBILITY=new Set<NonNullable<LifeAction['interruptibility']>>(['free','contextual','private','locked'])
const finiteDate=(value:unknown):number|undefined=>{
 if(typeof value!=='string'||!value)return undefined
 const parsed=Date.parse(value)
 return Number.isFinite(parsed)?parsed:undefined
}
const text=(value:unknown):string|undefined=>typeof value==='string'&&value.trim()?value:undefined

function normalizeLifeAction(resident:CityResident,value:unknown):NormalizedLifeAction|null{
 if(!value||typeof value!=='object')return null
 const candidate=value as Partial<LifeAction>
 if(!isLifeActionType(candidate.type))return null
 const status=typeof candidate.status==='string'&&LIFE_STATUS.has(candidate.status as LifeActionStatus)?candidate.status as LifeActionStatus:'performing'
 const interruptibility=typeof candidate.interruptibility==='string'&&INTERRUPTIBILITY.has(candidate.interruptibility as NonNullable<LifeAction['interruptibility']>)
  ?candidate.interruptibility as NonNullable<LifeAction['interruptibility']>
  :candidate.interruptible===false?'locked':'contextual'
 const locationId=text(candidate.location_id)??resident.current_location_id
 const raw={...candidate,id:text(candidate.id)??`life:${resident.id}:${candidate.type}`,type:candidate.type,status,location_id:locationId} as LifeAction
 return {
  source:'life',id:raw.id,type:raw.type,status,phase:raw.phase,
  originLocationId:text(raw.origin_location_id),locationId,
  targetId:text(raw.target_id)??text(raw.target_npc_id)??text(raw.target_resource_id),
  targetNpcId:text(raw.target_npc_id),targetResourceId:text(raw.target_resource_id),
  targetLocationId:locationId,plannedAt:text(raw.planned_at),arrivesAt:text(raw.arrives_at),
  startedAt:text(raw.started_at),endsAt:text(raw.ends_at),retryAt:text(raw.retry_at),
  visibleIntent:text(raw.visible_intent)??text(resident.visible_intent),
  visibleIntentZh:text(raw.visible_intent_zh)??text(resident.visible_intent_zh),
  interruptibility,animationCue:raw.animation_cue,presentation:raw.presentation,raw,
 }
}

function normalizeLegacyAction(resident:CityResident,action:ResidentWorldAction|undefined):NormalizedLegacyAction|null{
 if(!action)return null
 const status=action.state==='walking_to_event'?'traveling':action.state==='event_pending'?'planned':'performing'
 return {
  source:'legacy',id:action.event_id?`legacy:${action.event_id}:${resident.id}`:`legacy:idle:${resident.id}`,
  type:action.state==='idle'?'idle':action.state==='living'?'living':'legacy_event',status,locationId:resident.current_location_id,
  targetLocationId:action.target_location_id,startedAt:action.started_at,
  endsAt:action.state==='walking_to_event'?action.arrives_at:action.auto_resolve_at,
  eventId:action.event_id,participantIndex:action.participant_index,
  animationCue:action.animation_cue??resident.animation_cue,raw:action,
 }
}

/**
 * Compatibility projection for the legacy 3D world renderer. A current life
 * action is ambient resident activity, not an event awaiting player input.
 */
export function lifeActionWorldPresentation(action:NormalizedLifeAction):ResidentWorldAction{
 const fallback=lifeActionContract(action.type).fallbackCue
 const animation_cue=action.status==='traveling'?'walk':action.animationCue??action.presentation?.fallback_animation_cue??fallback
 if(action.status==='traveling')return {
  state:'walking_to_event',target_location_id:action.targetLocationId??action.locationId,
  started_at:action.startedAt??action.plannedAt,arrives_at:action.arrivesAt??action.endsAt,animation_cue,
 }
 if(action.status==='planned'||action.status==='performing'||action.status==='blocked'||action.status==='retrying')return {
  state:'living',target_location_id:action.targetLocationId??action.locationId,animation_cue,
 }
 return {state:'idle',animation_cue}
}

export function normalizeResidentAction(resident:CityResident):NormalizedResidentAction|null{
 if(Object.prototype.hasOwnProperty.call(resident,'current_action'))return normalizeLifeAction(resident,resident.current_action)
 return normalizeLegacyAction(resident,resident.world_action)
}

export function normalizeWorldSnapshot(snapshot:City):NormalizedWorldSnapshot{
 const serverTimeMs=finiteDate(snapshot.server_time)
 const nextTransitionAtMs=finiteDate(snapshot.next_transition_at)
 return {
  raw:snapshot,date:snapshot.date,worldVersion:snapshot.world_version,rulesVersion:snapshot.rules_version,
  serverTime:snapshot.server_time,serverTimeMs,nextTransitionAt:snapshot.next_transition_at,nextTransitionAtMs,
  residents:snapshot.npcs.map(resident=>({...resident,action:normalizeResidentAction(resident),visibleIntent:text(resident.visible_intent),visibleIntentZh:text(resident.visible_intent_zh),troubleSignal:resident.trouble_signal})),
  households:snapshot.households??[],moments:snapshot.observable_moments??[],incidents:snapshot.open_incidents??[],storyThreads:snapshot.story_threads??[],socialInteractions:snapshot.social_interactions??[],
 }
}

/** Returns undefined when opaque versions cannot be safely ordered. */
export function compareWorldVersions(candidate:string|number|undefined,current:string|number|undefined):number|undefined{
 if(candidate===undefined||current===undefined)return undefined
 if(String(candidate)===String(current))return 0
 const candidateNumber=typeof candidate==='number'?candidate:Number(candidate)
 const currentNumber=typeof current==='number'?current:Number(current)
 if(Number.isFinite(candidateNumber)&&Number.isFinite(currentNumber))return Math.sign(candidateNumber-currentNumber)
 const candidateDate=finiteDate(String(candidate)),currentDate=finiteDate(String(current))
 if(candidateDate!==undefined&&currentDate!==undefined)return Math.sign(candidateDate-currentDate)
 return undefined
}

export function worldTransitionTimes(world:NormalizedWorldSnapshot):number[]{
 const values:number[]=[]
 if(world.nextTransitionAtMs!==undefined)values.push(world.nextTransitionAtMs)
 world.residents.forEach(resident=>{
  if(resident.action?.status==='completed'||resident.action?.status==='abandoned'||resident.action?.status==='interrupted')return
  if(resident.action?.source==='life'){
   const transition=resident.action.status==='traveling'?resident.action.arrivesAt:resident.action.status==='blocked'||resident.action.status==='retrying'?resident.action.retryAt:resident.action.endsAt
   const transitionAt=finiteDate(transition);if(transitionAt!==undefined)values.push(transitionAt)
  }else{
   const end=finiteDate(resident.action?.endsAt);if(end!==undefined)values.push(end)
  }
 })
 world.incidents.forEach(incident=>{
  if(incident.status==='resolved_autonomously'||incident.status==='resolved_with_management'||incident.status==='closed')return
  const expiry=finiteDate(incident.intervention_expires_at);if(expiry!==undefined)values.push(expiry)
 })
 return values.sort((a,b)=>a-b)
}
