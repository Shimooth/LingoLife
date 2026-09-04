import {defaultAvatar} from './avatar.ts'
import type {FamilyRole,NpcProfile,OnboardingFamilyBond,OnboardingSharedHistoryHook,SharedHistoryKind,SharedHistoryTone} from './types.ts'

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
 likes:string[]
 dislikes:string[]
 quirks:string[]
 habits:string[]
 boundaries:string[]
 longTermGoal:string
 householdRole:NpcProfile['householdRole']
 chorePreferences:NpcProfile['chorePreferences']
 privateSpacePreference:NpcProfile['privateSpacePreference']
 model:string
 hairColor:string
}

export type OnboardingResidentDraft={
 key:string
 archetypeId:string
 profile:NpcProfile
}

export type DraftFamilyBond={leftKey:string;rightKey:string;leftRole:FamilyRole;rightRole:FamilyRole}
export type DraftSharedHistoryHook={id:string;participantKeys:string[];kind:SharedHistoryKind;summary:string;tone:SharedHistoryTone}
export const FAMILY_ROLE_INVERSE:Readonly<Record<FamilyRole,FamilyRole>>={sibling:'sibling',cousin:'cousin',parent:'child',child:'parent',guardian:'dependent',dependent:'guardian'}

export type ResidentValidationIssue='name'|'age'|'relationship'|'occupation'|'personality'|'interests'|'likes'|'dislikes'|'quirks'|'habits'|'boundaries'|'chores'|'goal'|'duplicate-name'

const ARCHETYPES:readonly ResidentArchetype[]=[
 {id:'maya-gardens',name:'Maya',age:26,relationship:'Old friend',occupation:'Landscape architect',personality:['thoughtful','playful','observant'],interests:['urban sketching','gardening','jazz'],likes:['sunlit parks','handwritten notes','shared breakfasts'],dislikes:['wasted food','harsh criticism'],quirks:['names every houseplant'],habits:['waters plants before breakfast','sketches during quiet evenings'],boundaries:['ask before moving her plants','give her time to think after conflict'],householdRole:'caretaker',chorePreferences:['cleaning','cooking'],privateSpacePreference:'balanced',longTermGoal:'Design a public garden where strangers feel welcome.',model:'city-01',hairColor:'#2d2323'},
 {id:'theo-coffee',name:'Theo',age:31,relationship:'New neighbor',occupation:'Barista',personality:['warm','curious','spontaneous'],interests:['specialty coffee','cycling','street photography'],likes:['late conversations','strong espresso','busy streets'],dislikes:['rigid plans','cold leftovers'],quirks:['judges mugs by their handles'],habits:['makes coffee before anyone wakes','takes an evening ride'],boundaries:['do not read his notebook','ask before inviting large groups home'],householdRole:'cook',chorePreferences:['cooking','shopping'],privateSpacePreference:'low',longTermGoal:'Open a tiny late-night community café.',model:'city-02',hairColor:'#65423b'},
 {id:'jun-sound',name:'Jun',age:24,relationship:'Former classmate',occupation:'Game sound designer',personality:['introverted','witty','creative'],interests:['ambient music','arcade games','field recording'],likes:['rain sounds','cooperative games','quiet company'],dislikes:['surprise parties','speakerphone calls'],quirks:['records oddly satisfying noises'],habits:['wears headphones while cleaning','reads before sleep'],boundaries:['knock before entering private space','never share unfinished recordings'],householdRole:'free_spirit',chorePreferences:['laundry','dishes'],privateSpacePreference:'high',longTermGoal:'Compose a soundtrack that people remember for years.',model:'city-03',hairColor:'#2d2323'},
 {id:'nora-stories',name:'Nora',age:35,relationship:'Creative collaborator',occupation:'Local journalist',personality:['bold','empathetic','persistent'],interests:['local history','podcasts','night walks'],likes:['honest answers','old buildings','spicy noodles'],dislikes:['broken promises','avoiding hard questions'],quirks:['keeps ticket stubs as evidence'],habits:['checks the news at breakfast','takes notes after every conversation'],boundaries:['off-record stories stay private','do not pressure her to drop a question'],householdRole:'organizer',chorePreferences:['shopping','dishes'],privateSpacePreference:'balanced',longTermGoal:'Publish a collection of overlooked city stories.',model:'city-04',hairColor:'#b36b43'},
 {id:'leo-motion',name:'Leo',age:29,relationship:'Sports buddy',occupation:'Physical therapist',personality:['patient','energetic','optimistic'],interests:['bouldering','cooking','basketball'],likes:['early workouts','team dinners','practical help'],dislikes:['giving up early','cluttered walkways'],quirks:['stretches while waiting for the kettle'],habits:['prepares breakfast early','checks in with tired housemates'],boundaries:['ask before discussing injuries','quiet hours start at eleven'],householdRole:'caretaker',chorePreferences:['cooking','cleaning'],privateSpacePreference:'low',longTermGoal:'Build an accessible neighborhood wellness studio.',model:'city-05',hairColor:'#65423b'},
 {id:'iris-museum',name:'Iris',age:27,relationship:'Family friend',occupation:'Museum curator',personality:['meticulous','imaginative','gentle'],interests:['folklore','pottery','old postcards'],likes:['labeled shelves','slow tea','careful listeners'],dislikes:['borrowed items not returned','loud television'],quirks:['dates every note she writes'],habits:['tidies the table after dinner','makes pottery on Sundays'],boundaries:['ask before borrowing personal things','do not interrupt delicate work'],householdRole:'organizer',chorePreferences:['cleaning','laundry'],privateSpacePreference:'high',longTermGoal:'Create an exhibition that makes history feel alive.',model:'city-06',hairColor:'#d67683'},
 {id:'mina-robotics',name:'Mina',age:32,relationship:'Online friend',occupation:'Robotics engineer',personality:['analytical','dry-humored','loyal'],interests:['tinkering','science fiction','table tennis'],likes:['solvable problems','dry jokes','midnight snacks'],dislikes:['vague requests','tools left outside their case'],quirks:['gives prototypes dramatic names'],habits:['repairs small things after work','labels leftovers precisely'],boundaries:['ask before touching tools','give direct feedback instead of hints'],householdRole:'fixer',chorePreferences:['repairs','dishes'],privateSpacePreference:'balanced',longTermGoal:'Invent a household robot that genuinely helps older people.',model:'city-07',hairColor:'#2d2323'},
 {id:'kai-dance',name:'Kai',age:23,relationship:'Travel companion',occupation:'Dance teacher',personality:['outgoing','mischievous','encouraging'],interests:['street dance','sneaker design','food markets'],likes:['impromptu music','crowded dinners','friendly dares'],dislikes:['silent resentment','strict bedtime routines'],quirks:['turns chores into dance moves'],habits:['practices after lunch','invites housemates on market trips'],boundaries:['say clearly when a joke goes too far','ask before filming'],householdRole:'mediator',chorePreferences:['shopping','cooking'],privateSpacePreference:'low',longTermGoal:'Lead a citywide dance performance in the main square.',model:'city-08',hairColor:'#b36b43'},
 {id:'hazel-books',name:'Hazel',age:38,relationship:'Book-club friend',occupation:'Children’s librarian',personality:['calm','perceptive','kind'],interests:['picture books','birdwatching','crosswords'],likes:['comfortable silence','window seats','gentle humor'],dislikes:['shouting indoors','damaged books'],quirks:['leaves tiny bookmarks everywhere'],habits:['reads before sleep','does laundry on Saturday mornings'],boundaries:['give her space during arguments','return books to their shelf'],householdRole:'mediator',chorePreferences:['laundry','cleaning'],privateSpacePreference:'high',longTermGoal:'Write an illustrated adventure for shy children.',model:'city-09',hairColor:'#65423b'},
 {id:'rowan-bread',name:'Rowan',age:34,relationship:'Childhood neighbor',occupation:'Baker',personality:['generous','stubborn','cheerful'],interests:['sourdough','folk music','community fairs'],likes:['feeding a crowd','old recipes','sing-alongs'],dislikes:['wasted ingredients','last-minute criticism'],quirks:['talks to rising dough'],habits:['bakes before sunrise','cleans the kitchen in one big burst'],boundaries:['do not alter family recipes','ask before taking reserved food'],householdRole:'cook',chorePreferences:['cooking','dishes'],privateSpacePreference:'balanced',longTermGoal:'Turn a family recipe into the city’s favorite breakfast.',model:'city-10',hairColor:'#e0b06f'},
 {id:'aria-rescue',name:'Aria',age:28,relationship:'Trusted acquaintance',occupation:'Paramedic',personality:['decisive','compassionate','restless'],interests:['first-aid teaching','running','documentaries'],likes:['clear plans','morning runs','people who follow through'],dislikes:['blocked exits','being fussed over'],quirks:['counts stairs without noticing'],habits:['checks household supplies weekly','walks to decompress after shifts'],boundaries:['do not demand details about difficult calls','keep shared paths clear'],householdRole:'caretaker',chorePreferences:['shopping','repairs'],privateSpacePreference:'balanced',longTermGoal:'Start free emergency-skills workshops in every district.',model:'city-11',hairColor:'#6d718d'},
 {id:'felix-city',name:'Felix',age:36,relationship:'Friendly rival',occupation:'Urban planner',personality:['ambitious','sociable','detail-oriented'],interests:['model building','public transit','chess'],likes:['structured debates','efficient routines','city views'],dislikes:['chronic lateness','plans without owners'],quirks:['rearranges chairs into cleaner lines'],habits:['writes a shared chore list on Mondays','reviews goals over breakfast'],boundaries:['criticize the plan not the person','discuss shared spending first'],householdRole:'organizer',chorePreferences:['cleaning','shopping'],privateSpacePreference:'low',longTermGoal:'Reconnect the city with a beautiful pedestrian district.',model:'city-12',hairColor:'#65423b'},
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
	  likes:[...archetype.likes],
	  dislikes:[...archetype.dislikes],
	  quirks:[...archetype.quirks],
	  habits:[...archetype.habits],
	  boundaries:[...archetype.boundaries],
	  longTermGoal:archetype.longTermGoal,
	  householdRole:archetype.householdRole,
	  chorePreferences:[...archetype.chorePreferences],
	  privateSpacePreference:archetype.privateSpacePreference,
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
	  if(!profile.likes.some(value=>value.trim()))issues.push('likes')
	  if(!profile.dislikes.some(value=>value.trim()))issues.push('dislikes')
	  if(!profile.quirks.some(value=>value.trim()))issues.push('quirks')
	  if(!profile.habits.some(value=>value.trim()))issues.push('habits')
	  if(!profile.boundaries.some(value=>value.trim()))issues.push('boundaries')
	  if(!profile.chorePreferences.length)issues.push('chores')
  if(!profile.longTermGoal.trim())issues.push('goal')
  return [draft.key,issues]
 }))
}

export type OnboardingRosterDifference={valid:boolean;missingCategories:string[];tooSimilarPairs:[string,string][]}
const canonical=(value:unknown)=>JSON.stringify(value)
export function onboardingRosterDifference(drafts:readonly OnboardingResidentDraft[]):OnboardingRosterDifference{
 const dimensions=drafts.map(({profile})=>({
  personality:new Set(profile.personality.map(value=>value.trim().toLocaleLowerCase()).filter(Boolean)),
  interests:new Set([...profile.interests,...profile.likes].map(value=>value.trim().toLocaleLowerCase()).filter(Boolean)),
  schedule:profile.occupation.trim().toLocaleLowerCase(),
  chores:[profile.householdRole,[...profile.chorePreferences].sort()],
  social:[profile.privateSpacePreference,[...profile.boundaries].sort(),[...profile.habits].sort()],
 }))
 const equal=(a:unknown,b:unknown)=>a instanceof Set&&b instanceof Set
  ?a.size===b.size&&[...a].every(value=>b.has(value)):canonical(a)===canonical(b)
 const categories=(['personality','interests','schedule','chores','social'] as const)
 const missingCategories=categories.filter(category=>new Set(dimensions.map(value=>canonical(value[category] instanceof Set?[...value[category]].sort():value[category]))).size<2)
 const tooSimilarPairs:[string,string][]=[]
 for(let left=0;left<drafts.length;left++)for(let right=left+1;right<drafts.length;right++){
  const distinct=categories.filter(category=>!equal(dimensions[left][category],dimensions[right][category])).length
  if(distinct<3)tooSimilarPairs.push([drafts[left].profile.name,drafts[right].profile.name])
 }
 return {valid:missingCategories.length===0&&tooSimilarPairs.length===0,missingCategories,tooSimilarPairs}
}

export function onboardingResidentsAreValid(drafts:readonly OnboardingResidentDraft[],minimum=ONBOARDING_MIN_RESIDENTS,maximum=ONBOARDING_MAX_RESIDENTS):boolean{
 if(drafts.length<minimum||drafts.length>maximum)return false
 return Object.values(validateOnboardingResidents(drafts)).every(issues=>issues.length===0)&&onboardingRosterDifference(drafts).valid
}

export function buildOnboardingSocialContract(
 drafts:readonly OnboardingResidentDraft[],familyBonds:readonly DraftFamilyBond[],historyHooks:readonly DraftSharedHistoryHook[],
):{family_bonds:OnboardingFamilyBond[];shared_history_hooks:OnboardingSharedHistoryHook[]}{
 const indices=new Map(drafts.map((draft,index)=>[draft.key,index]))
 return {
  family_bonds:familyBonds.map(bond=>({
   left_index:indices.get(bond.leftKey)??-1,right_index:indices.get(bond.rightKey)??-1,
   left_role:bond.leftRole,right_role:bond.rightRole,
  })),
  shared_history_hooks:historyHooks.map(hook=>({
   id:hook.id,participant_indices:hook.participantKeys.map(key=>indices.get(key)??-1),
   kind:hook.kind,summary:hook.summary.trim(),tone:hook.tone,
  })),
 }
}

export const ONBOARDING_ARCHETYPE_COUNT=ARCHETYPES.length
