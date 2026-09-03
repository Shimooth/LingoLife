import {Suspense,useEffect,useLayoutEffect,useMemo,useState} from 'react'
import {Canvas,useThree} from '@react-three/fiber'
import {ContactShadows,Html,PerspectiveCamera} from '@react-three/drei'
import {useReducedMotion} from 'motion/react'
import * as THREE from 'three'
import type {HouseholdResource,HouseholdRoom,LifeActionType} from '../types'
import type {LifeLanguage} from '../life/lifeActionCatalog'
import {deriveResidentExpression} from '../life/characterExpression'
import {IndoorEnvironment3D,INTERIOR_THEME_COPY,interiorThemeFor} from '../three/interiors'
import {CharacterEmote,DirectedCharacter3D} from '../three/characters'
import type {HouseholdResidentVisual} from './householdVisuals'
import type {WorldLayoutRoom} from '../worldLayout'

type Props={
 rooms:HouseholdRoom[]
 resources:HouseholdResource[]
 language:LifeLanguage
 residents?:HouseholdResidentVisual[]
 layoutRooms?:readonly WorldLayoutRoom[]
}

const ROOM_COPY:Record<string,{zh:string;en:string}>={
 living_room:{zh:'客厅',en:'Living room'},kitchen:{zh:'厨房',en:'Kitchen'},bathroom:{zh:'浴室',en:'Bathroom'},
 bedroom:{zh:'卧室',en:'Bedroom'},shared_space:{zh:'公共空间',en:'Shared space'},
}

const roomName=(room:HouseholdRoom|undefined,language:LifeLanguage)=>{
 if(!room)return language==='zh'?'住宅预览':'Home preview'
 return language==='zh'?room.name_zh?.trim()||ROOM_COPY[room.kind]?.zh||room.kind.replaceAll('_',' '):room.name?.trim()||ROOM_COPY[room.kind]?.en||room.kind.replaceAll('_',' ')
}

const ACTION_ROOM:Partial<Record<LifeActionType,string>>={
 prepare_food:'kitchen',eat:'kitchen',clean_shared_space:'living_room',leave_dishes:'kitchen',
 shower:'bathroom',sleep:'bedroom',rest_alone:'living_room',use_television:'living_room',read:'living_room',
 practice_hobby:'living_room',borrow_household_item:'living_room',seek_company:'living_room',talk_to_resident:'living_room',
}

function residentRoom(resident:HouseholdResidentVisual,rooms:HouseholdRoom[],resources:HouseholdResource[]){
 if(resident.roomId)return resident.roomId
 const lifeAction=resident.currentAction?.source==='life'?resident.currentAction:undefined
 const target=lifeAction?.targetResourceId&&resources.find(resource=>resource.id===lifeAction.targetResourceId)
 if(target)return target.room_id
 const preferred=lifeAction&&ACTION_ROOM[lifeAction.type]
 return rooms.find(room=>room.kind===preferred)?.id??rooms.find(room=>/living|shared/.test(room.kind))?.id??rooms[0]?.id
}

function HouseholdCamera(){
 const camera=useThree(state=>state.camera),width=useThree(state=>state.size.width)
 useLayoutEffect(()=>{
  camera.position.set(5.8,3.75,7.7)
  camera.lookAt(0,.9,-.55)
  if(camera instanceof THREE.PerspectiveCamera){camera.fov=width<420?44:37;camera.updateProjectionMatrix()}
 },[camera,width])
 return null
}

const privateAction=(resident:HouseholdResidentVisual)=>resident.currentAction?.source==='life'&&(resident.currentAction.raw.visible_context?.visibility==='private'||resident.currentAction.type==='sleep'||resident.currentAction.type==='shower')
const preferredRoom=(rooms:HouseholdRoom[],resources:HouseholdResource[],residents:HouseholdResidentVisual[])=>{
 const active=residents.find(resident=>resident.isHome!==false&&!privateAction(resident))
 return (active&&residentRoom(active,rooms,resources))??rooms.find(room=>/living|shared/.test(room.kind))?.id??rooms[0]?.id??'living-room'
}

export function HouseholdInteriorPreview({rooms,resources,language,residents=[],layoutRooms=[]}:Props){
 const reduce=useReducedMotion()
 const [selectedId,setSelectedId]=useState(()=>preferredRoom(rooms,resources,residents))
 useEffect(()=>{
  if(rooms.length&&!rooms.some(room=>room.id===selectedId))setSelectedId(preferredRoom(rooms,resources,residents))
 },[residents,resources,rooms,selectedId])
 const selected=rooms.find(room=>room.id===selectedId)??rooms[0]
 const roomKind=selected?.kind||'living_room'
 const theme=interiorThemeFor({roomKind})
 const authoredRoom=layoutRooms.find(room=>room.id===selected?.id)??layoutRooms.find(room=>room.kind===roomKind)
 const occupied=useMemo(()=>resources.filter(resource=>(resource.room_id===selected?.id||(selected?.resource_ids??[]).includes(resource.id))&&(resource.state.occupied_by?.length??0)>0).length,[resources,selected])
 const visibleResidents=useMemo(()=>residents.filter(resident=>resident.isHome!==false&&!privateAction(resident)&&residentRoom(resident,rooms,resources)===selected?.id).slice(0,3),[residents,resources,rooms,selected?.id])
 const privateResidents=useMemo(()=>residents.filter(resident=>resident.isHome!==false&&privateAction(resident)&&residentRoom(resident,rooms,resources)===selected?.id).length,[residents,resources,rooms,selected?.id])
 const themeCopy=INTERIOR_THEME_COPY[theme][language]
 const selectedName=roomName(selected,language)
 const occupancyCopy=privateResidents?(language==='zh'?'私人活动中':'Private activity'):visibleResidents.length?(language==='zh'?`${visibleResidents.length} 人在这里`:`${visibleResidents.length} here`):occupied?(language==='zh'?`${occupied} 处正在使用`:`${occupied} in use`):''
 const detailCopy=[themeCopy===selectedName?'':themeCopy,occupancyCopy].filter(Boolean).join(' · ')
 return <section className="household-interior-preview" aria-label={language==='zh'?'住宅室内预览':'Household interior preview'}>
  <div className="household-interior-preview__canvas" aria-hidden>
   <Canvas dpr={[1,1.3]} shadows gl={{antialias:true,alpha:true,powerPreference:'low-power'}}>
    <PerspectiveCamera makeDefault position={[5.8,3.75,7.7]} fov={37} near={.1} far={28}/>
    <HouseholdCamera/>
    <ambientLight intensity={1.05}/><hemisphereLight args={['#fff6df','#526d65',1.25]}/>
    <directionalLight position={[-4,7,5]} intensity={2.25} color="#fff1d8" castShadow shadow-mapSize={[512,512]}/>
    <pointLight position={[3.4,2.7,1.5]} intensity={4.2} distance={9} color="#f0aa7e"/>
    <Suspense fallback={null}><IndoorEnvironment3D theme={theme} mode="preview" placements={authoredRoom?.placements}/></Suspense>
    {visibleResidents.map((resident,index)=>{
     const positions=visibleResidents.length===1?[0]:visibleResidents.length===2?[-.85,.85]:[-1.35,0,1.35]
     const expression=deriveResidentExpression({npcId:resident.id,action:resident.currentAction,animationCue:resident.animationCue,observableState:resident.observableState})
     return <group key={resident.id} position={[positions[index]??0,-.17,.7]} rotation={[0,index%2?.25:-.25,0]}>
      <DirectedCharacter3D avatar={resident.avatar} animation={expression.motion} performanceMode="ambient" performanceKey={`household:${selected?.id}:${expression.key}`} reducedMotion={Boolean(reduce)} name={resident.name} seed={resident.id} scale={.58}/>
      <Html center position={[0,1.72,0]} zIndexRange={[8,5]}><CharacterEmote key={expression.key} expression={expression} language={language} size={27} decorative/></Html>
     </group>
    })}
    <ContactShadows position={[0,-.16,-.2]} opacity={.24} scale={9} blur={2.7} far={5}/>
   </Canvas>
  </div>
  <div className="household-interior-preview__caption"><div><small>{language==='zh'?'实时住宅切面':'LIVE HOME CUTAWAY'}</small><b>{selectedName}</b>{detailCopy&&<span>{detailCopy}</span>}</div>{rooms.length>1&&<nav aria-label={language==='zh'?'切换房间':'Choose a room'}>{rooms.map(room=><button type="button" key={room.id} className={room.id===selected?.id?'is-active':''} onClick={()=>setSelectedId(room.id)} aria-pressed={room.id===selected?.id}>{roomName(room,language)}</button>)}</nav>}</div>
 </section>
}

export default HouseholdInteriorPreview
