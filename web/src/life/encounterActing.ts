import type {LifeStory,LifeStoryBeat} from '../types.ts'

/** Stage direction reads visible facts only; it never invents acceptance. */
export function encounterActing(story:LifeStory,npcId:string,index:number,beat?:LifeStoryBeat){
 const reaction=(story.participant_reactions??story.outcome?.participant_reactions??[]).find(item=>item.npc_id===npcId)
 const negative=story.outcome?.tone==='negative'||story.outcome?.tone==='mixed'||/refus|resent|angry|boundary/.test(reaction?.reaction??'')
 const speaking=beat?.speaker_id===npcId
 const cue=speaking?beat?.animation_cue:undefined
 const expression=cue==='sad'||negative?'displeased':cue==='tired'?'sleepy':cue==='happy'?'happy':cue==='look_around'?'curious':'neutral'
 // A happy sentence is not a jumping animation; feet should stay grounded.
 const animation=speaking?'talk':beat?.speaker_id?'listen':'idle'
 const target= speaking?beat?.addressee_id:beat?.speaker_id
 const targetIndex=story.participant_ids.indexOf(target??'')
 const direction=targetIndex>=0&&targetIndex!==index?Math.sign(targetIndex-index):index===0?1:-1
 return {speaking,expression,animation,direction,bodyYaw:story.participant_ids.length>1?direction*.55:0} as const
}

export function conciseSceneContext(text:string){
 return text.replace(/^这件事发生在[^。]+。\s*/,'').replace(/^(?:In the|At) [^.]+, this moment involves [^.]+\.\s*/,'').trim()
}
