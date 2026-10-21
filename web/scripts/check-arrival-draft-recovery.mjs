import assert from 'node:assert/strict'
import {sameArrivalDraft} from '../src/arrival/draftComparison.ts'

// The first PUT has committed, but its response never reached the browser.
// GET returns the model-normalized draft while the form retains typed spacing.
const request={
 step:'manager',
 profile:{
  name:'  Alex\t Kim ',age:24,relationship:' new\nneighbor ',occupation:'  game   designer ',
  longTermGoal:' Start\ta  garden ',selfImage:'\u0085 quietly\u3000curious ',
  personality:[' warm '],interests:[' long   walks '],likes:[' shared\tmeals '],
  dislikes:[' loud\nmusic '],quirks:[' pauses\tbefore\nanswering '],habits:[' morning\tcoffee '],
  boundaries:[' ask\tbefore\nborrowing '],relationshipBoundaries:[' no_romance '],values:[' care '],
  householdRole:'free_spirit',chorePreferences:['cleaning'],privateSpacePreference:'balanced',
  familyIds:[],familyRelations:[],householdWithIds:[],shared_history_hooks:[],
  avatar:{model:'chibi',hair:'hair-one',hairColor:'#112233'},
 },
 voice:{voice_uri:'voice://English UK/Voice One',language:'en-GB',rate:.9,pitch:1},
 personality:{warmth:50,extraversion:50,assertiveness:50,openness:50,emotional_stability:50,humor:50},
 manager:{name:' \t管理员\u3000Alex\n ',birthday_month:10,birthday_day:3},
}
const remote=structuredClone(request)
Object.assign(remote.profile,{
 name:'Alex Kim',relationship:'new neighbor',occupation:'game designer',longTermGoal:'Start a garden',
 selfImage:'quietly curious',personality:['warm'],interests:['long walks'],likes:['shared meals'],
 dislikes:['loud music'],quirks:['pauses before answering'],habits:['morning coffee'],
 boundaries:['ask before borrowing'],relationshipBoundaries:['no_romance'],values:['care'],
})
remote.manager.name='管理员 Alex'
const original=structuredClone(request)
assert.equal(sameArrivalDraft(remote,request),true,'lost PUT response must reconcile normalized GET without another save')
assert.deepEqual(request,original,'comparison must not change the live editing draft')
assert.equal(sameArrivalDraft(null,request),false,'a missing remote draft is not a successful save')

// A real concurrent edit remains a conflict, including literal voice IDs.
for(const change of [
 value=>{value.manager.name='Another manager'},
 value=>{value.profile.occupation='Teacher'},
 value=>{value.profile.age=25},
 value=>{value.personality.warmth=55},
 value=>{value.manager.birthday_day=4},
 value=>{value.voice.voice_uri+=' '},
 value=>{value.voice.voice_uri=value.voice.voice_uri.toLowerCase()},
 value=>{value.voice.language='en-US'},
 value=>{value.voice.rate=1},
 value=>{value.profile.avatar.model='city-01'},
 value=>{value.step='introduction'},
]){
 const changed=structuredClone(remote);change(changed)
 assert.equal(sameArrivalDraft(changed,request),false,'a concurrent factual edit must not be acknowledged as the lost save')
}
const bom=structuredClone(remote);bom.profile.name='\ufeffAlex Kim'
assert.equal(sameArrivalDraft(bom,request),false,'do not erase characters Python does not normalize')
console.log('Arrival draft recovery passed: lost-response reconciliation, immutable input, 12 concurrent-edit boundaries.')
