import {useEffect,useRef,useState} from 'react'
import type {LifeSceneDialogue,LifeStory} from '../types'
import {requestSceneDialogue,sceneOutcomeKey,type SceneWriter,type DialogueFailure} from './sceneDialogueRequest'
export type {SceneWriter} from './sceneDialogueRequest'

export function useSceneDialogue(story:LifeStory,writer?:SceneWriter){
 const outcomeKey=sceneOutcomeKey(story),key=`${story.id}:${outcomeKey}`,enabled=Boolean(writer)&&story.level!=='thread'
 const [retryState,setRetryState]=useState({key:'',count:0})
 const attempt=retryState.key===key?retryState.count:0,requestKey=`${key}:${attempt}`
 const [state,setState]=useState<{key:string;result?:LifeSceneDialogue;failure?:DialogueFailure}>()
 const writerRef=useRef(writer),cancelRef=useRef<()=>void>(()=>{})
 useEffect(()=>{writerRef.current=writer},[writer])
 useEffect(()=>{
  if(!writerRef.current||!enabled)return
  const request=requestSceneDialogue({id:story.id,outcomeKey,writer:writerRef.current,retry:attempt>0,
   onResult:result=>setState({key:requestKey,result}),onFailure:failure=>setState({key:requestKey,failure})})
  cancelRef.current=request.cancel
  return request.dispose
 },[enabled,outcomeKey,requestKey,attempt,story.id])
 const match=state?.key===requestKey?state:undefined
 return {key:requestKey,enabled,result:match?.result,loading:enabled&&!match,failed:enabled&&Boolean(match?.failure),failure:match?.failure,cancel:()=>cancelRef.current(),retry:()=>setRetryState({key,count:attempt+1})}
}
