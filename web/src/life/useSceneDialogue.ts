import {useEffect,useState} from 'react'
import type {LifeSceneDialogue,LifeStory} from '../types'

export type SceneWriter=(id:string,signal?:AbortSignal,retry?:boolean)=>Promise<LifeSceneDialogue>
const stable=(value:unknown):unknown=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,stable(item)])):value
export const sceneOutcomeKey=(story:{outcome?:unknown;aftermath?:unknown})=>JSON.stringify(stable({outcome:story.outcome??null,aftermath:story.aftermath??null}))

export function useSceneDialogue(story:LifeStory,writer?:SceneWriter){
 const key=`${story.id}:${sceneOutcomeKey(story)}`,enabled=Boolean(writer)&&story.level!=='thread'
 const [retryState,setRetryState]=useState({key:'',count:0})
 const attempt=retryState.key===key?retryState.count:0,requestKey=`${key}:${attempt}`
 const [state,setState]=useState<{key:string;result?:LifeSceneDialogue;failed?:boolean}>()
 useEffect(()=>{
  if(!writer||!enabled)return
  const controller=new AbortController(),started=Date.now()
  let timer:ReturnType<typeof setTimeout>|undefined
  const deadline=setTimeout(()=>{controller.abort();if(timer)clearTimeout(timer);setState({key:requestKey,failed:true})},70000)
  const load=async()=>{
   try{
    const result=await writer(story.id,controller.signal,attempt>0)
    if(controller.signal.aborted)return
    if(result.status==='pending'||`${story.id}:${sceneOutcomeKey(result)}`!==key){
     if(Date.now()-started<70000){timer=setTimeout(()=>void load(),1200);return}
     clearTimeout(deadline);setState({key:requestKey,failed:true});return
    }
    clearTimeout(deadline);setState({key:requestKey,result})
   }catch{clearTimeout(deadline);if(!controller.signal.aborted)setState({key:requestKey,failed:true})}
  }
  void load()
  return()=>{controller.abort();clearTimeout(deadline);if(timer)clearTimeout(timer)}
 },[enabled,key,requestKey,attempt,story.id,writer])
 const match=state?.key===requestKey?state:undefined
 return {key:requestKey,enabled,result:match?.result,loading:enabled&&!match,failed:enabled&&Boolean(match?.failed),retry:()=>setRetryState({key,count:attempt+1})}
}
