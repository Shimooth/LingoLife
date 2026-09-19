import type {LifeSceneDialogue} from '../types.ts'

export type SceneWriter=(id:string,signal?:AbortSignal,retry?:boolean)=>Promise<LifeSceneDialogue>
export type DialogueFailure='timeout'|'network'|'changed'|'cancelled'
const stable=(value:unknown):unknown=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,stable(item)])):value
export const sceneOutcomeKey=(story:{outcome?:unknown;aftermath?:unknown})=>JSON.stringify(stable({outcome:story.outcome??null,aftermath:story.aftermath??null}))

/** One budget for the entire attempt, including pending polls. Never keep
 * generating against an obsolete outcome or accept a late aborted response. */
export function requestSceneDialogue({id,outcomeKey,writer,retry=false,onResult,onFailure,timeoutMs=60000,pollMs=1200}:{
 id:string;outcomeKey:string;writer:SceneWriter;retry?:boolean
 onResult:(result:LifeSceneDialogue)=>void;onFailure:(reason:DialogueFailure)=>void
 timeoutMs?:number;pollMs?:number
}){
 const controller=new AbortController()
 let finished=false,firstRequest=true,poll:ReturnType<typeof setTimeout>|undefined
 const dispose=()=>{finished=true;controller.abort();clearTimeout(deadline);if(poll)clearTimeout(poll)}
 const fail=(reason:DialogueFailure)=>{if(finished)return;dispose();onFailure(reason)}
 const deadline=setTimeout(()=>fail('timeout'),timeoutMs)
 const load=async()=>{
  try{
   const explicitRetry=retry&&firstRequest
   firstRequest=false
   const result=await writer(id,controller.signal,explicitRetry)
   if(finished)return
   if(sceneOutcomeKey(result)!==outcomeKey){fail('changed');return}
   if(result.status==='pending'){poll=setTimeout(()=>void load(),pollMs);return}
   dispose();onResult(result)
  }catch{fail('network')}
 }
 void load()
 return {dispose,cancel:()=>fail('cancelled')}
}
