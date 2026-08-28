import type {NpcProfile} from './types'

export const ROMANCE_ADULT_AGE=18
const ROMANCE_BLOCKERS=new Set(['no_romance','no-romance','aromantic'])

const boundaryKey=(value:string)=>value.trim().toLocaleLowerCase()
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
 const relationshipBoundaries=(profile.relationshipBoundaries??[]).map(item=>item.trim()).filter(Boolean).slice(0,8)
 return {
  ...profile,
  romanceEnabled:romanceIsEnabled({...profile,relationshipBoundaries}),
  relationshipBoundaries,
  familyIds:normalizedNpcIds(profile.familyIds,selfId,4),
  householdWithIds:normalizedNpcIds(profile.householdWithIds,selfId,1),
 }
}
