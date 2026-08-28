import {worldTransitionTimes,type NormalizedWorldSnapshot} from './normalizeWorldSnapshot'

export type WorldScheduleOptions={maxVisibleStalenessMs:number;minimumDelayMs:number;pastDueRetryMs:number;transitionGraceMs:number}

export function nextWorldRefreshDelay(world:NormalizedWorldSnapshot,clientNow:number,serverOffsetMs:number,options:WorldScheduleOptions):number{
 const serverNow=clientNow+serverOffsetMs
 const nextTransition=worldTransitionTimes(world).find(value=>Number.isFinite(value))
 if(nextTransition===undefined)return options.maxVisibleStalenessMs
 const untilTransition=nextTransition-serverNow+options.transitionGraceMs
 if(untilTransition<=0)return Math.min(options.maxVisibleStalenessMs,options.pastDueRetryMs)
 return Math.min(options.maxVisibleStalenessMs,Math.max(options.minimumDelayMs,untilTransition))
}
