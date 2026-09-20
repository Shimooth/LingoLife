import {useState} from 'react'
import type {Dispatch,SetStateAction} from 'react'
import type {Language} from '../i18n'
import type {FamilyRole} from '../types'
import {FAMILY_ROLE_INVERSE,type DraftFamilyBond,type DraftSharedHistoryHook,type OnboardingResidentDraft} from '../onboardingProfiles'
import './OnboardingRelationships.css'

type Props={language:Language;selected:OnboardingResidentDraft;drafts:OnboardingResidentDraft[];bonds:DraftFamilyBond[];histories:DraftSharedHistoryHook[];setBonds:Dispatch<SetStateAction<DraftFamilyBond[]>>;setHistories:Dispatch<SetStateAction<DraftSharedHistoryHook[]>>;disabled:boolean}
const roles:Record<FamilyRole,[string,string]>={sibling:['兄弟姐妹','Sibling'],cousin:['表／堂亲','Cousin'],parent:['我是对方的父母','I am their parent'],child:['我是对方的子女','I am their child'],guardian:['我是对方的监护人','I am their guardian'],dependent:['我由对方监护','I am their dependent']}
export default function OnboardingRelationships({language,selected,drafts,bonds,histories,setBonds,setHistories,disabled}:Props){
 const zh=language==='zh',key=selected.key
 const [target,setTarget]=useState('')
 const bondFor=(other:string)=>bonds.find(b=>(b.leftKey===key&&b.rightKey===other)||(b.rightKey===key&&b.leftKey===other))
 const historyFor=(other:string)=>histories.find(h=>h.participantKeys.length===2&&h.participantKeys.includes(key)&&h.participantKeys.includes(other))
 const rows=drafts.filter(d=>d.key!==key&&(bondFor(d.key)||historyFor(d.key)))
 const count=(other:string)=>histories.filter(h=>h.participantKeys.includes(other)).length
 const available=drafts.filter(d=>d.key!==key&&!rows.includes(d)&&count(d.key)<4)
 const chosen=available.some(d=>d.key===target)?target:available[0]?.key??''
 const remove=(other:string)=>{
  setBonds(current=>current.filter(b=>!((b.leftKey===key&&b.rightKey===other)||(b.rightKey===key&&b.leftKey===other))))
  setHistories(current=>current.filter(h=>!(h.participantKeys.length===2&&h.participantKeys.includes(key)&&h.participantKeys.includes(other))))
 }
 const add=()=>{
  const other=available.find(d=>d.key===chosen)
  if(!other||disabled||count(key)>=4||histories.length>=12)return
  setHistories(current=>[...current,{id:`connection-${crypto.randomUUID()}`,participantKeys:[key,other.key],kind:'personal_connection',summary:zh?`${selected.profile.name}和${other.profile.name}是朋友。`:`${selected.profile.name} and ${other.profile.name} are friends.`,tone:'neutral'}])
 }
 const changeRole=(other:string,role:FamilyRole|'')=>{
  const rest=bonds.filter(b=>!((b.leftKey===key&&b.rightKey===other)||(b.rightKey===key&&b.leftKey===other)))
  setBonds(role?[...rest,{leftKey:key,rightKey:other,leftRole:role,rightRole:FAMILY_ROLE_INVERSE[role]}]:rest)
 }
 return <fieldset className="onboarding-relationships" disabled={disabled}>
  <legend>{zh?'与其他成员的关系':'Connections with other members'} <small>{zh?'选填':'Optional'}</small></legend>
  {rows.map(other=>{
   const bond=bondFor(other.key),history=historyFor(other.key),role=bond?(bond.leftKey===key?bond.leftRole:bond.rightRole):''
   const familyFull=!bond&&(bonds.filter(b=>b.leftKey===key||b.rightKey===key).length>=4||bonds.filter(b=>b.leftKey===other.key||b.rightKey===other.key).length>=4||bonds.length>=16)
   return <section className="onboarding-relationships__row" key={other.key}>
    <header><strong>{selected.profile.name} ↔ {other.profile.name}</strong><button type="button" onClick={()=>remove(other.key)} aria-label={zh?`移除与${other.profile.name}的关系`:`Remove connection with ${other.profile.name}`}>{zh?'移除':'Remove'}</button></header>
    <label>{zh?'关系类型':'Relationship type'}<select value={role} onChange={e=>changeRole(other.key,e.target.value as FamilyRole|'')}>
     <option value="">{zh?'自定义（非亲属）':'Custom (not family)'}</option>
     {Object.entries(roles).map(([id,label])=><option key={id} value={id} disabled={familyFull}>{label[zh?0:1]}</option>)}
    </select></label>
    {history&&<label>{zh?'关系与背景':'Connection and background'}<input maxLength={180} value={history.summary} placeholder={zh?'例如：老同学，经常一起打球':'For example: old classmates who play basketball together'} onChange={e=>setHistories(current=>current.map(h=>h.id===history.id?{...h,summary:e.target.value}:h))}/></label>}
   </section>
  })}
  <div className="onboarding-relationships__add">
   <select aria-label={zh?'选择关系成员':'Choose a member'} value={chosen} onChange={e=>setTarget(e.target.value)} disabled={!available.length||count(key)>=4||histories.length>=12}>
    {!available.length&&<option value="">{zh?'暂无其他成员':'No other members'}</option>}
    {available.map(other=><option key={other.key} value={other.key}>{other.profile.name}</option>)}
   </select>
   <button type="button" onClick={add} disabled={!chosen||count(key)>=4||histories.length>=12}>{zh?'＋ 添加关系':'+ Add connection'}</button>
  </div>
 </fieldset>
}
