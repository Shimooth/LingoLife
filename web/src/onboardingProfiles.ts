import {defaultAvatar} from './avatar.ts'
import type {NpcProfile} from './types.ts'

export const ONBOARDING_MIN_RESIDENTS=2
export const ONBOARDING_MAX_RESIDENTS=8

type ResidentArchetype={
 id:string
 name:string
 age:number
 relationship:string
 occupation:string
 personality:string[]
 interests:string[]
 longTermGoal:string
 model:string
 hairColor:string
}

export type OnboardingResidentDraft={
 key:string
 archetypeId:string
 profile:NpcProfile
}

export type ResidentValidationIssue='name'|'age'|'relationship'|'occupation'|'personality'|'interests'|'goal'|'duplicate-name'

const ARCHETYPES:readonly ResidentArchetype[]=[
 {id:'maya-gardens',name:'Maya',age:26,relationship:'Old friend',occupation:'Landscape architect',personality:['thoughtful','playful','observant'],interests:['urban sketching','gardening','jazz'],longTermGoal:'Design a public garden where strangers feel welcome.',model:'city-01',hairColor:'#2d2323'},
 {id:'theo-coffee',name:'Theo',age:31,relationship:'New neighbor',occupation:'Barista',personality:['warm','curious','spontaneous'],interests:['specialty coffee','cycling','street photography'],longTermGoal:'Open a tiny late-night community café.',model:'city-02',hairColor:'#65423b'},
 {id:'jun-sound',name:'Jun',age:24,relationship:'Former classmate',occupation:'Game sound designer',personality:['introverted','witty','creative'],interests:['ambient music','arcade games','field recording'],longTermGoal:'Compose a soundtrack that people remember for years.',model:'city-03',hairColor:'#2d2323'},
 {id:'nora-stories',name:'Nora',age:35,relationship:'Creative collaborator',occupation:'Local journalist',personality:['bold','empathetic','persistent'],interests:['local history','podcasts','night walks'],longTermGoal:'Publish a collection of overlooked city stories.',model:'city-04',hairColor:'#b36b43'},
 {id:'leo-motion',name:'Leo',age:29,relationship:'Sports buddy',occupation:'Physical therapist',personality:['patient','energetic','optimistic'],interests:['bouldering','cooking','basketball'],longTermGoal:'Build an accessible neighborhood wellness studio.',model:'city-05',hairColor:'#65423b'},
 {id:'iris-museum',name:'Iris',age:27,relationship:'Family friend',occupation:'Museum curator',personality:['meticulous','imaginative','gentle'],interests:['folklore','pottery','old postcards'],longTermGoal:'Create an exhibition that makes history feel alive.',model:'city-06',hairColor:'#d67683'},
 {id:'mina-robotics',name:'Mina',age:32,relationship:'Online friend',occupation:'Robotics engineer',personality:['analytical','dry-humored','loyal'],interests:['tinkering','science fiction','table tennis'],longTermGoal:'Invent a household robot that genuinely helps older people.',model:'city-07',hairColor:'#2d2323'},
 {id:'kai-dance',name:'Kai',age:23,relationship:'Travel companion',occupation:'Dance teacher',personality:['outgoing','mischievous','encouraging'],interests:['street dance','sneaker design','food markets'],longTermGoal:'Lead a citywide dance performance in the main square.',model:'city-08',hairColor:'#b36b43'},
 {id:'hazel-books',name:'Hazel',age:38,relationship:'Book-club friend',occupation:'Children’s librarian',personality:['calm','perceptive','kind'],interests:['picture books','birdwatching','crosswords'],longTermGoal:'Write an illustrated adventure for shy children.',model:'city-09',hairColor:'#65423b'},
 {id:'rowan-bread',name:'Rowan',age:34,relationship:'Childhood neighbor',occupation:'Baker',personality:['generous','stubborn','cheerful'],interests:['sourdough','folk music','community fairs'],longTermGoal:'Turn a family recipe into the city’s favorite breakfast.',model:'city-10',hairColor:'#e0b06f'},
 {id:'aria-rescue',name:'Aria',age:28,relationship:'Trusted acquaintance',occupation:'Paramedic',personality:['decisive','compassionate','restless'],interests:['first-aid teaching','running','documentaries'],longTermGoal:'Start free emergency-skills workshops in every district.',model:'city-11',hairColor:'#6d718d'},
 {id:'felix-city',name:'Felix',age:36,relationship:'Friendly rival',occupation:'Urban planner',personality:['ambitious','sociable','detail-oriented'],interests:['model building','public transit','chess'],longTermGoal:'Reconnect the city with a beautiful pedestrian district.',model:'city-12',hairColor:'#65423b'},
]

let draftSequence=0
const nextDraftKey=()=>`resident-${Date.now().toString(36)}-${(++draftSequence).toString(36)}`
const randomIndex=(length:number,random:()=>number)=>Math.min(length-1,Math.max(0,Math.floor(random()*length)))

const draftFromArchetype=(archetype:ResidentArchetype):OnboardingResidentDraft=>({
 key:nextDraftKey(),
 archetypeId:archetype.id,
 profile:{
  name:archetype.name,
  age:archetype.age,
  relationship:archetype.relationship,
  occupation:archetype.occupation,
  personality:[...archetype.personality],
  interests:[...archetype.interests],
  longTermGoal:archetype.longTermGoal,
  romanceEnabled:true,
  relationshipBoundaries:[],
  familyIds:[],
  householdWithIds:[],
  avatar:{...defaultAvatar,model:archetype.model,hairColor:archetype.hairColor,strokes:[]},
 },
})

const chooseUnused=(used:Set<string>,random:()=>number)=>{
 const available=ARCHETYPES.filter(archetype=>!used.has(archetype.id))
 const pool=available.length?available:ARCHETYPES
 return pool[randomIndex(pool.length,random)]
}

export function createOnboardingResidents(count=ONBOARDING_MIN_RESIDENTS,random:()=>number=Math.random):OnboardingResidentDraft[]{
 const requested=Number.isFinite(count)?Math.round(count):ONBOARDING_MIN_RESIDENTS
 const total=Math.max(ONBOARDING_MIN_RESIDENTS,Math.min(ONBOARDING_MAX_RESIDENTS,requested))
 const used=new Set<string>(),drafts:OnboardingResidentDraft[]=[]
 while(drafts.length<total){
  const archetype=chooseUnused(used,random)
  used.add(archetype.id)
  drafts.push(draftFromArchetype(archetype))
 }
 return drafts
}

export function addRandomOnboardingResident(drafts:readonly OnboardingResidentDraft[],random:()=>number=Math.random):OnboardingResidentDraft[]{
 if(drafts.length>=ONBOARDING_MAX_RESIDENTS)return [...drafts]
 const archetype=chooseUnused(new Set(drafts.map(draft=>draft.archetypeId)),random)
 return [...drafts,draftFromArchetype(archetype)]
}

export function rerollOnboardingResident(drafts:readonly OnboardingResidentDraft[],key:string,random:()=>number=Math.random):OnboardingResidentDraft[]{
 const used=new Set(drafts.map(draft=>draft.archetypeId))
 const archetype=chooseUnused(used,random)
 return drafts.map(draft=>draft.key===key?{...draftFromArchetype(archetype),key}:draft)
}

export function validateOnboardingResidents(drafts:readonly OnboardingResidentDraft[]):Record<string,ResidentValidationIssue[]>{
 const nameCounts=new Map<string,number>()
 drafts.forEach(({profile})=>{const name=profile.name.trim().toLocaleLowerCase();if(name)nameCounts.set(name,(nameCounts.get(name)??0)+1)})
 return Object.fromEntries(drafts.map(draft=>{
  const {profile}=draft,issues:ResidentValidationIssue[]=[]
  const normalizedName=profile.name.trim().toLocaleLowerCase()
  if(!normalizedName)issues.push('name')
  else if((nameCounts.get(normalizedName)??0)>1)issues.push('duplicate-name')
  if(typeof profile.age!=='number'||!Number.isInteger(profile.age)||profile.age<16||profile.age>100)issues.push('age')
  if(!profile.relationship.trim())issues.push('relationship')
  if(!profile.occupation.trim())issues.push('occupation')
  if(!profile.personality.some(value=>value.trim()))issues.push('personality')
  if(!profile.interests.some(value=>value.trim()))issues.push('interests')
  if(!profile.longTermGoal.trim())issues.push('goal')
  return [draft.key,issues]
 }))
}

export function onboardingResidentsAreValid(drafts:readonly OnboardingResidentDraft[],minimum=ONBOARDING_MIN_RESIDENTS,maximum=ONBOARDING_MAX_RESIDENTS):boolean{
 if(drafts.length<minimum||drafts.length>maximum)return false
 return Object.values(validateOnboardingResidents(drafts)).every(issues=>issues.length===0)
}

export const ONBOARDING_ARCHETYPE_COUNT=ARCHETYPES.length
