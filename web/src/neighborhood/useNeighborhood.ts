import {useCallback,useEffect,useRef,useState} from 'react'
import {ApiError,api,neighborhoodApi,session} from '../api'
import type {NeighborhoodCommand,NeighborhoodState} from './types'

const certainFailure=(cause:unknown)=>cause instanceof ApiError&&cause.status>=400&&cause.status<500
class AccountChanged extends Error {}
const fingerprint=(command:NeighborhoodCommand)=>JSON.stringify(command,(_key,value)=>
 value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value)

export function useNeighborhood(userId:string|number,language:'zh'|'en',enabled:boolean){
 const [state,setState]=useState<NeighborhoodState|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState('')
 const current=useRef<NeighborhoodState|null>(null),queue=useRef<Promise<unknown>>(Promise.resolve()),pending=useRef(0)
 const keys=useRef<Map<string,string>|null>(null),active=useRef(true)
 const accountToken=useRef(session.token())
 const checkAccount=useCallback(()=>{if(!active.current||session.token()!==accountToken.current)throw new AccountChanged('The active account changed.')},[])
 const storageKey=`lingolife.neighborhood.pending.${userId}`
 if(keys.current===null){
  try{keys.current=new Map(JSON.parse(sessionStorage.getItem(storageKey)||'[]'))}catch{keys.current=new Map()}
 }
 useEffect(()=>{active.current=true;return()=>{active.current=false}},[])
 const storeKeys=useCallback(()=>{try{sessionStorage.setItem(storageKey,JSON.stringify([...keys.current!]))}catch{/* Storage is optional. */}},[storageKey])
 const accept=useCallback((next:NeighborhoodState)=>{
  if(current.current&&next.revision<current.current.revision)return current.current
  current.current=next
  if(active.current)setState(next)
  return next
 },[])
 const explain=useCallback((cause:unknown)=>{
  if(cause instanceof AccountChanged)return language==='zh'?'登录状态已变化，请刷新页面后继续。':'Your session changed. Please refresh before continuing.'
  if(cause instanceof ApiError){
   if(cause.status===401)return language==='zh'?'登录已过期，请刷新并重新登录。':'Please refresh and sign in again.'
   if(cause.status===404)return language==='zh'?'生活广场还没有准备好，请稍后重试。':'The neighborhood is not ready yet. Please retry.'
   if(cause.status===422)return language==='zh'?'请检查话题、称呼和居民选择后再试一次。':'Check the topic, nicknames, and selected residents.'
   if(cause.status===409)return cause.message
  }
  return language==='zh'?'连接暂时中断，请重试；已经结算的操作不会重复扣费。':'Connection interrupted. Retry safely; completed actions will not be charged twice.'
 },[language])
 const refresh=useCallback(async()=>{
  if(active.current)setLoading(true)
  try{checkAccount();const next=await neighborhoodApi.get();checkAccount();const value=accept(next);if(active.current)setError('');return value}
  catch(cause){if(active.current)setError(explain(cause));throw cause}
  finally{if(active.current)setLoading(false)}
 },[accept,explain,checkAccount])
 useEffect(()=>{
  if(!enabled)return
  void refresh().catch(()=>undefined)
  const focus=()=>{if(!document.hidden)void refresh().catch(()=>undefined)}
  document.addEventListener('visibilitychange',focus)
  return()=>document.removeEventListener('visibilitychange',focus)
 },[enabled,refresh])
 const command=useCallback((intent:NeighborhoodCommand):Promise<NeighborhoodState>=>{
  pending.current++;setBusy(true)
  const result=queue.current.catch(()=>undefined).then(async()=>{
   const id=fingerprint(intent)
   // A persisted key may represent an earlier request whose response was lost.
   // Keep it through authentication failures until that original result is known.
   let uncertain=keys.current!.has(id)
   const key=keys.current!.get(id)??api.key()
   keys.current!.set(id,key);storeKeys()
   try{
    checkAccount()
    setError('')
    let value:NeighborhoodState
    try{value=await neighborhoodApi.command(intent,key)}
    catch(cause){if(certainFailure(cause))throw cause;uncertain=true;checkAccount();value=await neighborhoodApi.command(intent,key)}
    checkAccount()
    accept(value);keys.current!.delete(id);storeKeys()
    return value
   }catch(cause){
    if(certainFailure(cause)&&!uncertain){keys.current!.delete(id);storeKeys()}
    if(active.current)setError(explain(cause))
    throw cause
   }finally{pending.current--;if(active.current)setBusy(pending.current>0)}
  })
  queue.current=result.catch(()=>undefined)
  return result
 },[accept,explain,storeKeys,checkAccount])
 return {state,busy,loading,error,refresh,command}
}
