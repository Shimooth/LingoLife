import type {ArrivalDraft} from './types'

// These are the fields normalized by NpcProfile validators and ManagerProfile.
// Keep enum values, asset/voice identifiers, and the tutorial step exact.
const profileTextFields=['name','relationship','occupation','longTermGoal','selfImage'] as const
const profileListFields=['personality','interests','likes','dislikes','quirks','habits','boundaries','relationshipBoundaries','values'] as const

function normalizedText(value:string):string{
 // Python str.split() also recognizes NEL and the four information separators;
 // unlike JavaScript \s, it does not strip a byte-order mark from identity text.
 // eslint-disable-next-line no-control-regex -- Match the server's intentional whitespace normalization.
 return value.split(/[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/u).filter(Boolean).join(' ')
}

function comparisonDraft(value:ArrivalDraft):ArrivalDraft{
 const profile={...value.profile}
 for(const field of profileTextFields){
  const text=profile[field]
  if(typeof text==='string')profile[field]=normalizedText(text)
 }
 for(const field of profileListFields){
  const list=profile[field]
  if(Array.isArray(list))Object.assign(profile,{[field]:list.map(normalizedText)})
 }
 return {...value,profile,manager:{...value.manager,name:normalizedText(value.manager.name)}}
}

function stable(value:unknown):unknown{
 return Array.isArray(value)?value.map(stable):value&&typeof value==='object'
  ?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,stable(item)])):value
}

/** Reconcile a committed autosave whose response was lost, without treating
 * server whitespace cleanup as a conflicting edit from another device. */
export function sameArrivalDraft(left:ArrivalDraft|null,right:ArrivalDraft):boolean{
 return left!==null&&JSON.stringify(stable(comparisonDraft(left)))===JSON.stringify(stable(comparisonDraft(right)))
}
