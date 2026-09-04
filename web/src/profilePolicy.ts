import type {NpcProfile} from './types'

export const ROMANCE_ADULT_AGE=18
const ROMANCE_BLOCKERS=new Set(['no_romance','no-romance','aromantic'])

const boundaryKey=(value:string)=>value.trim().toLocaleLowerCase()
const clean=(values:readonly string[]|undefined,limit:number)=>Array.from(new Map((values??[]).map(value=>value.trim()).filter(Boolean).map(value=>[value.toLocaleLowerCase(),value])).values()).slice(0,limit)
const normalizedNpcIds=(values:string[]|undefined,selfId:string|undefined,limit:number)=>{
 const unique:string[]=[]
 for(const rawId of values??[]){
  const id=rawId.trim()
  if(!id||id===selfId||unique.includes(id))continue
  unique.push(id)
  if(unique.length===limit)break
 }
 return unique
}

export function isAdultProfile(profile:Pick<NpcProfile,'age'>):boolean{
 return typeof profile.age==='number'&&Number.isInteger(profile.age)&&profile.age>=ROMANCE_ADULT_AGE
}

/** Old adult profiles predate the field and retain the server's opt-in default. */
export function romanceIsEnabled(profile:Pick<NpcProfile,'age'|'romanceEnabled'|'relationshipBoundaries'>):boolean{
 if(!isAdultProfile(profile)||profile.romanceEnabled===false)return false
 return !(profile.relationshipBoundaries??[]).some(item=>ROMANCE_BLOCKERS.has(boundaryKey(item)))
}

export function withProfileAge(profile:NpcProfile,age:number|null):NpcProfile{
 const next={...profile,age}
 return age!==null&&age<ROMANCE_ADULT_AGE?{...next,romanceEnabled:false}:next
}

export function withRomancePreference(profile:NpcProfile,enabled:boolean):NpcProfile{
 const relationshipBoundaries=(profile.relationshipBoundaries??[]).filter(item=>!ROMANCE_BLOCKERS.has(boundaryKey(item)))
 return {...profile,romanceEnabled:isAdultProfile(profile)&&enabled,relationshipBoundaries}
}

/** Produces an explicit, safe payload while retaining compatibility defaults. */
export function normalizeNpcProfilePolicy(profile:NpcProfile,selfId?:string):NpcProfile{
 const relationshipBoundaries=clean(profile.relationshipBoundaries,8)
 return {
  ...profile,
  personality:clean(profile.personality,4),interests:clean(profile.interests,5),
  likes:clean(profile.likes,6),dislikes:clean(profile.dislikes,6),
  quirks:clean(profile.quirks,4),habits:clean(profile.habits,4),boundaries:clean(profile.boundaries,8),
  chorePreferences:Array.from(new Set(profile.chorePreferences)).slice(0,3),
  romanceEnabled:romanceIsEnabled({...profile,relationshipBoundaries}),
  relationshipBoundaries,
  familyIds:normalizedNpcIds(profile.familyIds,selfId,4),
  householdWithIds:normalizedNpcIds(profile.householdWithIds,selfId,1),
 }
}
