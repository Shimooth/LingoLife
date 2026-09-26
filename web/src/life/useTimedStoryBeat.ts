import {useEffect,useState} from 'react'
import type {LifeStoryBeat} from '../types'

/** Text remains readable after its actor finishes speaking. Polls that return
 * the same beat cannot restart gestures; replaying another story can. */
export function useTimedStoryBeat(storyKey:string,beat:LifeStoryBeat|undefined,reduced=false){
 const key=beat?`${storyKey}:${beat.id??''}:${beat.speaker_id??''}:${beat.text??''}`:''
 const duration=Math.max(900,Math.min(beat?.duration_ms??2400,4200))
 const [finished,setFinished]=useState('')
 useEffect(()=>{
  if(!key||reduced)return
  const timer=window.setTimeout(()=>setFinished(key),duration)
  return ()=>window.clearTimeout(timer)
 },[key,duration,reduced])
 return !reduced&&key&&key!==finished?beat:undefined
}
