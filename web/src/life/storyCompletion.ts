import type {LifeStory} from '../types.ts'
import {storyHasOutcome,storyOutcomeCopy} from './storyOutcome.ts'
import {sceneOutcomeKey} from './sceneDialogueRequest.ts'

export const storyCompletionKey=(story:LifeStory)=>`${story.id}:${sceneOutcomeKey(story)}`
export function storyCompletionCopy(story:LifeStory,language:'zh'|'en'){
 if(!storyHasOutcome(story))return null
 const zh=language==='zh',copy=storyOutcomeCopy(story,language)
 const consequences=story.consequences??story.outcome?.consequences??[]
 // Actual activity, relationship or resource change, not two repeated intentions.
 const item=['shared_activity','relationship','resource'].flatMap(kind=>consequences.filter(item=>item.kind===kind)).find(item=>item.text||item.translation_zh)
 const text=item?(zh?item.translation_zh||item.text:item.text||item.translation_zh):undefined
 return {title:copy.managed?copy.result:'',text:text|| (copy.managed?copy.summary:undefined)|| (zh?'这段交流暂时告一段落。':'This exchange has come to a close.'),tone:item?.tone||copy.tone}
}

/** Per-tab bounded receipt ledger: reopening a replay is not a new settlement. */
export function completionLedger(limit=200){
 const seen=new Set<string>()
 return {has:(key:string)=>seen.has(key),mark:(key:string)=>{seen.add(key);if(seen.size>limit)seen.delete(seen.values().next().value!)}}
}
