import type {Household,HouseholdResource,HouseholdRoom} from '../types'
import {useEffect,useState} from 'react'
import type {HouseholdResidentFocus} from '../life/householdLocation'
import type {LifeLanguage} from '../life/lifeActionCatalog'
import {HouseholdInteriorPreview} from './HouseholdInteriorPreview'
import {HouseholdDinnerPanel} from './HouseholdDinnerPanel'
import type {HouseholdResidentVisual} from './householdVisuals'
import type {WorldLayoutRoom} from '../worldLayout'
import './HouseholdInspector.css'
import {CharacterPortrait} from './CharacterPortrait'

type Props={residentFocus?:HouseholdResidentFocus;household:Household|null;gameDate?:string;language?:LifeLanguage;residentNames?:Record<string,string>;residentVisuals?:HouseholdResidentVisual[];layoutRooms?:readonly WorldLayoutRoom[];onClose:()=>void;onMemberSelect?:(npcId:string)=>void;onDinnerCommand?:(action:'propose'|'cleanup')=>Promise<void>;className?:string}

const ROOM_NAMES:Record<string,{zh:string;en:string}>={living_room:{zh:'客厅',en:'Living room'},kitchen:{zh:'厨房',en:'Kitchen'},bathroom:{zh:'浴室',en:'Bathroom'},bedroom:{zh:'私人卧室区',en:'Private bedroom wing'},shared_space:{zh:'公共空间',en:'Shared space'}}
const RESOURCE_NAMES:Record<string,{zh:string;en:string}>={television:{zh:'电视',en:'Television'},stove:{zh:'灶台',en:'Stove'},fridge:{zh:'冰箱',en:'Fridge'},kitchen_counter:{zh:'厨房台面',en:'Kitchen counter'},shower:{zh:'淋浴',en:'Shower'},bath:{zh:'浴缸',en:'Bath'},bed:{zh:'床',en:'Bed'},sink:{zh:'水槽',en:'Sink'},table:{zh:'餐桌',en:'Table'},armchair:{zh:'扶手椅',en:'Armchair'},bookshelf:{zh:'书架',en:'Bookshelf'}}
const label=(kind:string,language:LifeLanguage,custom?:string,customZh?:string)=>language==='zh'?customZh?.trim()||ROOM_NAMES[kind]?.zh||RESOURCE_NAMES[kind]?.zh||kind.replaceAll('_',' '):custom?.trim()||ROOM_NAMES[kind]?.en||RESOURCE_NAMES[kind]?.en||kind.replaceAll('_',' ')
const inferredRoomKind=(id:string)=>/kitchen/i.test(id)?'kitchen':/bath|shower/i.test(id)?'bathroom':/bed|private/i.test(id)?'bedroom':/living|television/i.test(id)?'living_room':'shared_space'
const presentationRooms=(rooms:HouseholdRoom[],resources:HouseholdResource[])=>{
 const result=rooms.map(room=>({...room}))
 resources.forEach(resource=>{if(!result.some(room=>room.id===resource.room_id))result.push({id:resource.room_id,kind:inferredRoomKind(resource.room_id),resource_ids:[]})})
 const defaults:[string,string][]=[['living_room','living-room'],['kitchen','shared-kitchen'],['bathroom','shared-bathroom'],['bedroom','bedroom']]
 defaults.forEach(([kind,id])=>{if(!result.some(room=>room.kind===kind))result.push({id,kind,resource_ids:[]})})
 return result
}

function resourceState(resource:HouseholdResource,language:LifeLanguage){
 const occupied=resource.state.occupied_by?.length??0,waiting=resource.state.queue?.length??0
 if(waiting)return language==='zh'?`${occupied?'正在使用 · ':''}有人在等`:`${occupied?'In use · ':''}${waiting} waiting`
 if(occupied)return language==='zh'?'正在使用':'In use'
 if(resource.state.is_full)return language==='zh'?'已经满了':'Full'
 if(resource.state.is_on)return language==='zh'?'正在运行':'On'
 return language==='zh'?'现在可用':'Available now'
}

function RoomSection({room,resources,language}:{room:HouseholdRoom;resources:HouseholdResource[];language:LifeLanguage}){
 const emptyCopy=room.kind==='bedroom'?(language==='zh'?'8 间有独立墙、门、床与个人物品的固定卧室；居民会在所属房间休息，睡眠与洗浴使用适当遮挡。':'Eight resident-owned bedrooms, each with walls, a door, bed, light and personal belongings. Residents remain in their own rooms, with appropriate covering for sleep and bathing.'):(language==='zh'?'这里现在很安静。':'It is quiet here right now.')
 return <section className="household-room"><header><span aria-hidden>{room.kind==='kitchen'?'♨':room.kind==='bathroom'?'◌':room.kind==='bedroom'?'☾':'⌂'}</span><h3>{label(room.kind,language,room.name,room.name_zh)}</h3></header>{resources.length?<ul>{resources.map(resource=><li key={resource.id} className={(resource.state.occupied_by?.length??0)>0?'is-occupied':''}><span/><div><b>{label(resource.kind,language,resource.label,resource.label_zh)}</b><small>{resourceState(resource,language)}</small></div>{(resource.state.queue?.length??0)>0&&<em>{language==='zh'?`${resource.state.queue?.length} 人等待`:`${resource.state.queue?.length} waiting`}</em>}</li>)}</ul>:<p>{emptyCopy}</p>}</section>
}

export function HouseholdInspector({residentFocus,household,gameDate,language='zh',residentNames={},residentVisuals=[],layoutRooms=[],onClose,onMemberSelect,onDinnerCommand,className=''}:Props){
 const [expanded,setExpanded]=useState(true)
 const [focus,setFocus]=useState(residentFocus)
 useEffect(()=>{setFocus(residentFocus)},[residentFocus])
 const [kitchenRequest,setKitchenRequest]=useState(0)
 const members=(household?.members??[]).map(member=>typeof member==='string'?{npc_id:member}:member)
 const rooms=household?.rooms??[]
 const resources=household?.resources??[]
 const resourceRooms=household?presentationRooms(rooms,resources):[]
 const privateRooms=new Map(members.flatMap(member=>typeof member==='string'||!member.private_room_id?[]:[[member.npc_id,member.private_room_id] as const]))
 const boundResidentVisuals=residentVisuals.map(resident=>({...resident,privateRoomId:privateRooms.get(resident.id)??resident.privateRoomId}))
 return <aside className={`household-inspector ${expanded?'is-life-expanded':''} ${className}`.trim()} role="dialog" aria-modal="true" aria-label={language==='zh'?'住宅概况':'Household overview'}>
  <header><div><h2>{household?.name??(language==='zh'?'住宅':'Home')}</h2></div><button type="button" onClick={onClose} aria-label={language==='zh'?'关闭':'Close'}>×</button></header>
  {household&&<nav className="household-cast-strip" aria-label={language==='zh'?'选择居民':'Choose resident'}>{boundResidentVisuals.map(resident=><button key={resident.id} type="button" aria-pressed={focus?.id===resident.id} onClick={()=>setFocus(previous=>({id:resident.id,request:(previous?.request??0)+1}))}><CharacterPortrait avatar={resident.avatar}/><span>{resident.name}</span><i className={resident.isHome===false?'is-away':''}/></button>)}</nav>}
  {household&&<HouseholdInteriorPreview rooms={resourceRooms} resources={resources} language={language} residents={boundResidentVisuals} layoutRooms={layoutRooms} life={household?.life} kitchenRequest={kitchenRequest} residentFocus={focus} onMemberInteract={onMemberSelect}/>}
  {household&&<button type="button" className="household-expand" aria-expanded={!expanded} onClick={()=>setExpanded(value=>!value)}>{expanded?(language==='zh'?'共餐与住宅详情 ↑':'Meals & household details ↑'):(language==='zh'?'返回房间 ↓':'Back to the room ↓')}</button>}
  {household?<div className="household-inspector__body">
   <HouseholdDinnerPanel gameDate={gameDate} dinner={household.life?.dinner} language={language} names={residentNames} onCommand={onDinnerCommand} onWatch={()=>{setKitchenRequest(value=>value+1);setExpanded(true)}}/>
   <section className="household-members"><h3>{language==='zh'?'居民':'Residents'}</h3><div>{members.map(member=>{const name=member.name||residentNames[member.npc_id]||member.npc_id;return onMemberSelect?<button type="button" key={member.npc_id} onClick={()=>setFocus(previous=>({id:member.npc_id,request:(previous?.request??0)+1}))}><span>{name.slice(0,1)}</span><b>{name}</b></button>:<article key={member.npc_id}><span>{name.slice(0,1)}</span><b>{name}</b></article>})}</div></section>
   <div className="household-rooms">{resourceRooms.length?resourceRooms.map(room=><RoomSection key={room.id} room={room} resources={resources.filter(resource=>resource.room_id===room.id||(room.resource_ids??[]).includes(resource.id))} language={language}/>):<p className="household-inspector__quiet">{language==='zh'?'住宅房间还在准备中，居民资料已经可以查看。':'The rooms are still being prepared, but the residents are available.'}</p>}</div>
  </div>:<div className="household-inspector__loading" role="status"><i/><p>{language==='zh'?'正在看看家里发生了什么…':'Checking what is happening at home…'}</p></div>}
 </aside>
}

export default HouseholdInspector
