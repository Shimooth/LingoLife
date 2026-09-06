import type {Message,Room} from './types.ts'
import type {SpeechLine} from './three/characters/types.ts'

export function selectSceneSpeech(liveSpeech:SpeechLine|null|undefined,messages:Message[]):SpeechLine|null{
 // Explicit null means a cleared encounter, not an invitation to replay history.
 if(liveSpeech!==undefined)return liveSpeech
 const last=messages.at(-1)
 return last?{...last,key:last.created_at}:null
}

/** Only this encounter may resume a live bubble; all other messages are history. */
export function selectConversationOpening(room:Room){
 if(room.conversation){
  return [...room.messages].reverse().find(message=>message.speaker==='npc'&&message.text.trim()&&message.conversation_id===room.conversation?.id)??room.conversation.opening
 }
 // Compatibility for the retired event flow or an older server.
 const previous=[...room.messages].reverse().find(message=>message.speaker==='npc'&&message.text.trim())
 const event=room.active_event,stage=event?.stage
 const hasPersistedTurn=room.messages.some(message=>message.speaker==='player')
 const eventHasStarted=Boolean(event&&((event.stage_turns??(hasPersistedTurn?1:0))>0||event.stage_index>0))
 return previous&&(!stage||eventHasStarted)?previous:stage?{text:stage.prompt,translation:stage.translation}:previous
}
