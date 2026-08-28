import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {api} from '../api'
import type {City} from '../types'
import {compareWorldVersions,normalizeWorldSnapshot,type NormalizedWorldSnapshot} from './normalizeWorldSnapshot'
import {nextWorldRefreshDelay} from './worldSchedule'

export type WorldRefreshReason='initial'|'transition'|'visibility'|'online'|'manual'|'mutation'
export type WorldFetch=({signal}:{signal:AbortSignal})=>Promise<City>

export type UseWorldSimulationOptions={
 enabled?:boolean
 initialSnapshot?:City|null
 fetchWorld?:WorldFetch
 maxVisibleStalenessMs?:number
 minimumDelayMs?:number
 pastDueRetryMs?:number
 transitionGraceMs?:number
 onError?:(error:unknown,reason:WorldRefreshReason)=>void
}

export type WorldSimulationState={
 world:NormalizedWorldSnapshot|null
 rawSnapshot:City|null
 loading:boolean
 refreshing:boolean
 error:unknown
 serverOffsetMs:number
 nextRefreshAt:number|null
 getServerNow:()=>number
 refresh:(reason?:WorldRefreshReason)=>Promise<NormalizedWorldSnapshot|null>
}

const defaultFetchWorld:WorldFetch=({signal})=>api.world({signal})
const browserVisible=()=>typeof document==='undefined'||document.visibilityState!=='hidden'
const initialOffset=(snapshot?:City|null)=>{
 const parsed=Date.parse(snapshot?.server_time??'')
 return Number.isFinite(parsed)?parsed-Date.now():0
}

export function useWorldSimulation({
 enabled=true,
 initialSnapshot=null,
 fetchWorld=defaultFetchWorld,
 maxVisibleStalenessMs=30_000,
 minimumDelayMs=800,
 pastDueRetryMs=5_000,
 transitionGraceMs=220,
 onError,
}:UseWorldSimulationOptions={}):WorldSimulationState{
 const [rawSnapshot,setRawSnapshot]=useState<City|null>(initialSnapshot)
 const [loading,setLoading]=useState(enabled&&!initialSnapshot)
 const [refreshing,setRefreshing]=useState(false)
 const [error,setError]=useState<unknown>(null)
 const [serverOffsetMs,setServerOffsetMs]=useState(()=>initialOffset(initialSnapshot))
 const [visible,setVisible]=useState(browserVisible)
 const [nextRefreshAt,setNextRefreshAt]=useState<number|null>(null)
 const [scheduleEpoch,setScheduleEpoch]=useState(0)
 const world=useMemo(()=>rawSnapshot?normalizeWorldSnapshot(rawSnapshot):null,[rawSnapshot])
 const worldRef=useRef<NormalizedWorldSnapshot|null>(world)
 const externalSnapshotRef=useRef<City|null>(initialSnapshot)
 const fetchRef=useRef(fetchWorld),onErrorRef=useRef(onError)
 const inFlightRef=useRef<Promise<NormalizedWorldSnapshot|null>|null>(null)
 const controllerRef=useRef<AbortController|null>(null)
 const mountedRef=useRef(true),acceptedEpochRef=useRef(initialSnapshot?1:0),requestSequenceRef=useRef(0)

 useEffect(()=>{worldRef.current=world},[world])
 useEffect(()=>{fetchRef.current=fetchWorld},[fetchWorld])
 useEffect(()=>{onErrorRef.current=onError},[onError])
 useEffect(()=>{mountedRef.current=true;return()=>{mountedRef.current=false;controllerRef.current?.abort()}},[])

 useEffect(()=>{
  if(!initialSnapshot||initialSnapshot===externalSnapshotRef.current)return
  externalSnapshotRef.current=initialSnapshot
  const candidate=normalizeWorldSnapshot(initialSnapshot),current=worldRef.current
  if(compareWorldVersions(candidate.worldVersion,current?.worldVersion)===-1)return
  acceptedEpochRef.current+=1
  worldRef.current=candidate
  setRawSnapshot(initialSnapshot)
  setServerOffsetMs(initialOffset(initialSnapshot))
 },[initialSnapshot])

 const refresh=useCallback((reason:WorldRefreshReason='manual')=>{
  if(!enabled)return Promise.resolve(worldRef.current)
  if(inFlightRef.current)return inFlightRef.current
  const controller=new AbortController(),requestId=++requestSequenceRef.current,epochAtStart=acceptedEpochRef.current
  controllerRef.current=controller
  const startedAt=Date.now()
  setRefreshing(true);setError(null)
  const requestPromise=(async()=>{
   try{
    const snapshot=await fetchRef.current({signal:controller.signal})
    const receivedAt=Date.now(),candidate=normalizeWorldSnapshot(snapshot)
    if(!mountedRef.current||controller.signal.aborted||requestId!==requestSequenceRef.current||epochAtStart!==acceptedEpochRef.current)return worldRef.current
    const current=worldRef.current
    if(compareWorldVersions(candidate.worldVersion,current?.worldVersion)===-1)return current
    if(candidate.serverTimeMs!==undefined)setServerOffsetMs(candidate.serverTimeMs-(startedAt+receivedAt)/2)
    acceptedEpochRef.current+=1
    worldRef.current=candidate
    setRawSnapshot(snapshot)
    return candidate
   }catch(cause){
    if(controller.signal.aborted||cause instanceof DOMException&&cause.name==='AbortError')return worldRef.current
    if(mountedRef.current){setError(cause);onErrorRef.current?.(cause,reason)}
    return worldRef.current
   }finally{
    inFlightRef.current=null
    if(controllerRef.current===controller)controllerRef.current=null
    if(mountedRef.current){setLoading(false);setRefreshing(false);setScheduleEpoch(value=>value+1)}
   }
  })()
  inFlightRef.current=requestPromise
  return requestPromise
 },[enabled])

 useEffect(()=>{
  if(!enabled){controllerRef.current?.abort();setLoading(false);return}
  if(!worldRef.current)void refresh('initial')
 },[enabled,refresh])

 useEffect(()=>{
  if(typeof document==='undefined')return
  const onVisibility=()=>{const next=browserVisible();setVisible(next);if(next&&enabled)void refresh('visibility')}
  const onOnline=()=>{if(enabled&&browserVisible())void refresh('online')}
  document.addEventListener('visibilitychange',onVisibility)
  window.addEventListener('online',onOnline)
  return()=>{document.removeEventListener('visibilitychange',onVisibility);window.removeEventListener('online',onOnline)}
 },[enabled,refresh])

 useEffect(()=>{
  if(!enabled||!visible||!world){setNextRefreshAt(null);return}
  const options={
   maxVisibleStalenessMs:Math.max(1_000,maxVisibleStalenessMs),minimumDelayMs:Math.max(250,minimumDelayMs),
   pastDueRetryMs:Math.max(1_000,pastDueRetryMs),transitionGraceMs:Math.max(0,transitionGraceMs),
  }
  const delay=nextWorldRefreshDelay(world,Date.now(),serverOffsetMs,options)
  setNextRefreshAt(Date.now()+delay)
  const timer=window.setTimeout(()=>void refresh('transition'),delay)
  return()=>window.clearTimeout(timer)
 },[enabled,maxVisibleStalenessMs,minimumDelayMs,pastDueRetryMs,refresh,scheduleEpoch,serverOffsetMs,transitionGraceMs,visible,world])

 const getServerNow=useCallback(()=>Date.now()+serverOffsetMs,[serverOffsetMs])
 return {world,rawSnapshot,loading,refreshing,error,serverOffsetMs,nextRefreshAt,getServerNow,refresh}
}
