import {useCallback,useEffect,useRef,useState} from 'react'
import {ApiError,practiceApi} from '../api'
import type {CityPractice,CityPracticeCommand} from '../types'

export function useCityPractice(enabled:boolean,worldVersion:string|number|undefined){
 const [data,setData]=useState<CityPractice|null>(null),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false)
 const sequence=useRef(0),pending=useRef(false),mounted=useRef(true),refreshQueued=useRef(false)
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;sequence.current+=1}},[])
 const refresh=useCallback(async()=>{
  if(pending.current){refreshQueued.current=true;return}
  const request=++sequence.current
  try{const next=await practiceApi.get();if(mounted.current&&request===sequence.current){setData(next);setFailed(false)}}
  catch(cause){if(mounted.current&&request===sequence.current){
   if(cause instanceof ApiError&&(cause.status===404||cause.code==='LIFE_SIMULATION_REQUIRED')){setData(null);setFailed(false)}
   else setFailed(true)
  }}
 },[])
 useEffect(()=>{if(enabled)void refresh()},[enabled,worldVersion,refresh])
 const command=useCallback(async(body:CityPracticeCommand)=>{
  if(pending.current)return null
  pending.current=true;const request=++sequence.current;setBusy(true);setFailed(false)
  try{const next=await practiceApi.update(body);if(mounted.current&&request===sequence.current)setData(next);return next}
  catch{if(mounted.current)setFailed(true);return null}
  finally{pending.current=false;if(mounted.current){setBusy(false);if(refreshQueued.current){refreshQueued.current=false;void refresh()}}}
 },[refresh])
 return {data,busy,failed,refresh,command}
}
