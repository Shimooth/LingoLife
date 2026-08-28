import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {CHIBI_CLIPS,CITY_CLIPS} from '../src/three/characters/characterAssets.ts'
import {createPerformancePlan,PERFORMANCE_MOTIONS} from '../src/three/characters/performancePlan.ts'
import {deriveLifeStoryParticipantExpression,deriveResidentExpression,deriveSocialParticipantExpression} from '../src/life/characterExpression.ts'

const chibiPath=fileURLToPath(new URL('../public/assets/models/characters/chibi/all-in-one.glb',import.meta.url))
const cityPath=fileURLToPath(new URL('../public/assets/models/characters/city/animations/animations.glb',import.meta.url))

async function glbAnimations(path){
 const buffer=await readFile(path)
 if(buffer.toString('utf8',0,4)!=='glTF')throw new Error(`Not a binary glTF file: ${path}`)
 const jsonLength=buffer.readUInt32LE(12)
 const document=JSON.parse(buffer.toString('utf8',20,20+jsonLength))
 return new Set((document.animations??[]).map(animation=>animation.name))
}

const [chibiAnimations,cityAnimations]=await Promise.all([glbAnimations(chibiPath),glbAnimations(cityPath)])
const extraCityJumpClips=[
 'Jump_A_Start','Jump_A_InAir','Jump_A_Landing',
 'Jump_B_Start','Jump_B_InAir','Jump_B_Landing',
 'Jump_C_Start','Jump_C_InAir','Jump_C_Landing',
]

for(const [family,mapping,available,extras] of [
 ['chibi',CHIBI_CLIPS,chibiAnimations,['anim_crouch','anim_uncrouch']],
 ['city',CITY_CLIPS,cityAnimations,extraCityJumpClips],
]){
 for(const cue of PERFORMANCE_MOTIONS){
  const names=mapping[cue]
  if(!names?.length)throw new Error(`${family} has no animation mapping for ${cue}`)
  for(const name of names)if(!available.has(name))throw new Error(`${family} animation mapping references missing clip: ${name}`)
 }
 for(const name of extras)if(!available.has(name))throw new Error(`${family} choreography references missing clip: ${name}`)
}

const modes=['ambient','event_pending','journey','encounter','conversation_speak','conversation_listen','conversation_react']
for(const mode of modes){
 for(const cue of PERFORMANCE_MOTIONS){
  const plan=createPerformancePlan({mode,fallbackCue:cue,seed:`guard:${mode}:${cue}`})
  if(!plan.beats.length)throw new Error(`Director produced an empty ${mode}/${cue} plan`)
  if(mode==='journey'&&(!['walk','run'].includes(plan.holdCue)||plan.beats.some(beat=>!['walk','run'].includes(beat.cue)))){
   throw new Error(`Journey director can stop locomotion for ${cue}`)
  }
 }
}

const unsafeJourney=createPerformancePlan({
 mode:'journey',fallbackCue:'walk',
 performance:{version:1,hold_cue:'idle',beats:[{cue:'walk',role:'action',duration_ms:2600,loop:true,transition_ms:280,facing:'movement',energy:.5}]},
})
if(unsafeJourney.authored||unsafeJourney.holdCue!=='walk')throw new Error('Unsafe authored journey was not replaced by continuous locomotion')

const zeroMetadata=createPerformancePlan({
 mode:'ambient',fallbackCue:'idle',
 performance:{version:1,hold_cue:'idle',beats:[{cue:'idle',role:'hold',duration_ms:1800,loop:true,transition_ms:0,facing:'free',energy:0}]},
})
if(zeroMetadata.beats[0].transition_ms!==0||zeroMetadata.beats[0].energy!==0)throw new Error('Director changed valid zero-valued performance metadata')

const stationaryJourneyCue=createPerformancePlan({
 mode:'conversation_react',fallbackCue:'walk',
 performance:{version:1,hold_cue:'listen',beats:[{cue:'walk',role:'action',duration_ms:2200,loop:true,transition_ms:200,facing:'movement',energy:.6}]},
})
if(stationaryJourneyCue.beats.some(beat=>beat.cue==='walk'||beat.cue==='run'))throw new Error('Stationary director can play locomotion without moving the actor')

const sleeping=deriveResidentExpression({npcId:'emma',action:{source:'life',id:'sleep-1',type:'sleep',status:'performing',locationId:'home-emma',interruptibility:'private',raw:{id:'sleep-1',type:'sleep',status:'performing',location_id:'home-emma'}}})
if(sleeping.motion!=='idle'||sleeping.emote!=='cloud'||/sleep|睡/.test(`${sleeping.label.en} ${sleeping.label.zh}`))throw new Error('Private resident action leaks its exact activity through expression')
const traveling=deriveResidentExpression({npcId:'emma',action:{source:'life',id:'travel-1',type:'seek_company',status:'traveling',locationId:'park',interruptibility:'free',raw:{id:'travel-1',type:'seek_company',status:'traveling',location_id:'park'}}})
if(traveling.motion!=='walk')throw new Error('Travel expression can stop locomotion')
const troubled=deriveResidentExpression({npcId:'emma',troubleSignal:{id:'conflict-1',kind:'conflict',severity:'high'}})
if(troubled.emote!=='faceAngry'||troubled.vfx!=='tension')throw new Error('Visible conflict does not reach the expression layer')
const romantic=deriveResidentExpression({npcId:'emma',story:{id:'date-1',level:'incident',status:'awaiting_management',title:'A date',summary:'',participant_ids:['emma','alex']},relationship:{pair_key:'alex|emma',participant_ids:['alex','emma'],channels:{friendship:'friend',conflict:'none',rivalry:'none',romance:'dating'}}})
if(romantic.emote!=='heart'||romantic.tone!=='romantic')throw new Error('Established romance does not reach the expression layer')
const storyReaction=deriveLifeStoryParticipantExpression({id:'story-1',level:'moment',status:'resolved_autonomously',title:'Made up',summary:'',participant_ids:['emma'],consequences:[{kind:'relationship',tone:'positive'}]},'emma')
if(storyReaction.motion!=='happy'||storyReaction.emote!=='faceHappy')throw new Error('Positive story outcome has no expressive reaction')
const misunderstanding=deriveSocialParticipantExpression({id:'social-1',date:'2026-08-28',template_id:'small_misunderstanding',title:'',summary:'',location_id:'cafe',time_slot:'afternoon',participant_ids:['emma','alex'],participants:[{id:'emma',name:'Emma'},{id:'alex',name:'Alex'}],related_npc_ids:[],importance:1,status:'awaiting_management',management:{can_intervene:true,actions:['mediate']}},'emma')
if(misunderstanding.emote!=='faceAngry')throw new Error('Social tension has no expressive reaction')

console.log(`Character animation guard passed (${chibiAnimations.size} chibi clips, ${cityAnimations.size} city clips, ${modes.length} director modes).`)
