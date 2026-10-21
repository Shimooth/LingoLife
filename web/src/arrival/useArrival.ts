import {useCallback,useRef,useState} from 'react'
import {ApiError,api,arrivalApi} from '../api'
import type {ArrivalAction,ArrivalDraft,ArrivalState} from './types'
import {sameArrivalDraft as sameDraft} from './draftComparison'

const messages:Record<string,string>={
 ARRIVAL_REVISION_CONFLICT:'资料已在另一处更新，请刷新后继续。',
 INSUFFICIENT_FUNDS:'金币不够了，请选择价格更低的食物。',
 FOOD_NOT_OWNED:'背包里没有这份食物，请先购买。',
 RESIDENT_BUSY:'居民现在不方便吃东西，请稍后再试。',
 RESIDENT_FULL:'已经吃饱啦，等饿了再来吧。',
 ARRIVAL_INSUFFICIENT_COINS:'生活币不够了，请选择价格更低的食物。',
 ARRIVAL_NO_FOOD:'食物篮里没有这份食物，请先购买。',
 ARRIVAL_INVENTORY_FULL:'食物篮满了，先送一份给居民吧。',
 ARRIVAL_RESIDENT_BUSY:'居民正在忙，等忙完再送食物吧。',
 ARRIVAL_RESIDENT_FULL:'已经吃饱啦，等饿了再来吧。',
 ARRIVAL_ALREADY_CREATED:'居民已经入住，请刷新继续体验。',
 ARRIVAL_CREATE_IN_PROGRESS:'居民正在入住，请稍等后重试。',
 ARRIVAL_WRONG_STAGE:'这一步已经有变化，请刷新继续体验。',
}

/** Serializes draft autosaves and commands; retries retain the command key. */
export function useArrival(language:'zh'|'en',userId:string|number){
 const [state,setState]=useState<ArrivalState|null>(null)
 const [pending,setPending]=useState(0),[error,setError]=useState('')
 const stateRef=useRef<ArrivalState|null>(null)
 const queue=useRef<Promise<unknown>>(Promise.resolve())
 const retry=useRef<Map<string,string>|null>(null)
 const conflicted=useRef(false)
 const storageKey=`lingolife.arrival.pending.${userId}`
 if(!retry.current){
  try{retry.current=new Map(JSON.parse(sessionStorage.getItem(storageKey)||'[]'))}
  catch{retry.current=new Map()}
 }
 const requestKey=useCallback((fingerprint:string)=>{
  const keys=retry.current!
  if(!keys.has(fingerprint))keys.set(fingerprint,api.key())
  try{sessionStorage.setItem(storageKey,JSON.stringify([...keys]))}catch{/* Optional browser storage. */}
  return keys.get(fingerprint)!
 },[storageKey])
 const forgetKey=useCallback((fingerprint:string)=>{
  retry.current!.delete(fingerprint)
  try{sessionStorage.setItem(storageKey,JSON.stringify([...retry.current!]))}catch{/* Optional browser storage. */}
 },[storageKey])
 const accept=useCallback((value:ArrivalState)=>{
  // Slow startup reads must not replace a newer autosave or settlement.
  if(stateRef.current&&value.revision<stateRef.current.revision)return stateRef.current
  stateRef.current=value;setState(value);return value
 },[])
 const restore=useCallback(async()=>{
  try{return accept(await arrivalApi.get())}
  catch(cause){if(cause instanceof ApiError&&cause.status===404)return null;throw cause}
 },[accept])
 const explain=useCallback((cause:unknown)=>{
  if(language==='en')return cause instanceof Error?cause.message:'Connection interrupted. Please retry.'
  if(cause instanceof ApiError){
   if(cause.status===409&&/REVISION|CONFLICT/.test(cause.code||''))return '资料已更新，请刷新后继续；已经保存的内容会保留。'
   if(cause.code&&messages[cause.code])return messages[cause.code]
   if(cause.status===401)return '登录已过期，请刷新并重新登录。'
   if(cause.status===422)return '请检查姓名、生日和角色设定，再试一次。'
  }
  return '暂时没有保存成功，请重试。已经完成的购买和照料不会重复结算。'
 },[language])
 const enqueue=useCallback(<T,>(operation:()=>Promise<T>):Promise<T>=>{
  setPending(value=>value+1)
  const result=queue.current.catch(()=>undefined).then(async()=>{
   setError('')
   try{return await operation()}
   catch(cause){setError(explain(cause));throw cause}
   finally{setPending(value=>Math.max(0,value-1))}
  })
  queue.current=result.catch(()=>undefined)
  return result
 },[explain])
 const saveDraft=useCallback((draft:ArrivalDraft)=>enqueue(async()=>{
  if(conflicted.current)throw new ApiError(409,'Draft changed elsewhere','ARRIVAL_REVISION_CONFLICT')
  const current=stateRef.current
  if(!current||current.stage!=='create')return
  try{accept(await arrivalApi.save(draft,current.revision))}
  catch(cause){
   if(cause instanceof ApiError&&cause.status<500&&cause.status!==409)throw cause
   const remote=await arrivalApi.get()
   if(remote.stage==='create'&&sameDraft(remote.draft,draft)){accept(remote);return}
   if(remote.stage==='create'&&remote.revision===current.revision){
    accept(await arrivalApi.save(draft,remote.revision));return
   }
   conflicted.current=true
   throw new ApiError(409,'Draft changed elsewhere','ARRIVAL_REVISION_CONFLICT')
  }
 }),[accept,enqueue])
 const create=useCallback((draft:ArrivalDraft)=>enqueue(async()=>{
  if(conflicted.current)throw new ApiError(409,'Draft changed elsewhere','ARRIVAL_REVISION_CONFLICT')
  const current=stateRef.current
  if(!current)throw new Error('Arrival has not loaded')
  const fingerprint=JSON.stringify({action:'create',draft})
  const key=requestKey(fingerprint)
  try{accept(await retryUncertain(()=>arrivalApi.create(draft,current.revision,key)));forgetKey(fingerprint)}
  catch(cause){if(definitiveFailure(cause))forgetKey(fingerprint);throw cause}
 }),[accept,enqueue,requestKey,forgetKey])
 const command=useCallback((action:ArrivalAction,foodId?:string)=>enqueue(async()=>{
  const fingerprint=JSON.stringify({action,foodId})
  const key=requestKey(fingerprint)
  try{
   const value=accept(await retryUncertain(()=>arrivalApi.command(action,foodId,key)))
   forgetKey(fingerprint)
   return value
  }catch(cause){if(definitiveFailure(cause))forgetKey(fingerprint);throw cause}
 }),[accept,enqueue,requestKey,forgetKey])
 return {state,restore,saveDraft,create,command,busy:pending>0,error}
}

const definitiveFailure=(cause:unknown)=>cause instanceof ApiError&&cause.status>=400&&cause.status<500
async function retryUncertain<T>(operation:()=>Promise<T>):Promise<T>{
 try{return await operation()}catch(cause){if(definitiveFailure(cause))throw cause;return operation()}
}
