import assert from 'node:assert/strict'
import './check-conversation-location.mjs'
import {selectConversationOpening,selectSceneSpeech} from '../src/conversationOpening.ts'

const opening={text:"I'm having a bite to eat.",translation:'我正在吃点东西。'}
const room={conversation:{id:'today-eat-2',game_date:'2026-09-06',opening},messages:[
 {speaker:'npc',text:'Original welcome without a scope'},
 {speaker:'npc',text:'Yesterday I was reading.',conversation_id:'yesterday-read-1'},
 {speaker:'player',text:'Which book?',conversation_id:'today-read-2'},
 {speaker:'npc',text:'A very long book.',conversation_id:'today-read-2'},
]}
assert.deepEqual(selectConversationOpening(room),opening,'New action must not repeat an old NPC reply')
assert.equal(room.messages.length,4,'Opening selection must preserve history')
const reply={speaker:'npc',text:'A sandwich.',translation:'三明治。',conversation_id:'today-eat-2'}
room.messages.push(reply)
assert.deepEqual(selectConversationOpening(room),reply,'Re-entering the same action resumes its latest reply')
room.conversation={...room.conversation,id:'tomorrow-eat-2',game_date:'2026-09-07'}
assert.deepEqual(selectConversationOpening(room),opening,'Midnight starts a new encounter even if the action continues')
assert.deepEqual(selectConversationOpening({...room,messages:[]}),opening)
assert.equal(selectConversationOpening({messages:[{speaker:'npc',text:'Legacy reply'}]}).text,'Legacy reply')
assert.equal(selectSceneSpeech(null,room.messages),null,'Clearing live speech must not revive archived dialogue in 3D')
assert.deepEqual(selectSceneSpeech(reply,room.messages),reply)
assert.equal(selectSceneSpeech(undefined,room.messages).text,reply.text,'Uncontrolled legacy scenes may still use their own messages')
console.log('Conversation opening checks passed (action/day boundaries, same-action resume, history preservation, legacy fallback).')
