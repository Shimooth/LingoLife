import {Suspense,useEffect,useLayoutEffect,useMemo,useState,type CSSProperties} from 'react'
import {Canvas,useThree} from '@react-three/fiber'
import {ContactShadows,Html,PerspectiveCamera} from '@react-three/drei'
import {useReducedMotion} from 'motion/react'
import * as THREE from 'three'
import type {HouseholdResource,HouseholdRoom,LifeActionType} from '../types'
import type {LifeLanguage} from '../life/lifeActionCatalog'
import {deriveResidentExpression} from '../life/characterExpression'
import {
 IndoorEnvironment3D,INTERIOR_THEME_COPY,interiorThemeFor,
 resolveSharedHomePrivateSpaces,resolveSharedHomeResidentAnchors,
} from '../three/interiors'
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
 bedroom:{zh:'私人卧室区',en:'Private bedroom wing'},shared_space:{zh:'公共空间',en:'Shared space'},
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

function HouseholdCamera({privateSuite}:{privateSuite:boolean}){
 const camera=useThree(state=>state.camera),width=useThree(state=>state.size.width)
 useLayoutEffect(()=>{
  if(privateSuite){
   camera.position.set(width<420?5.6:6.6,width<420?9.6:6.4,width<420?17:9.3)
   camera.lookAt(0,.35,-.12)
  }else{
   camera.position.set(5.45,3.5,7.2)
   camera.lookAt(0,.84,-.48)
  }
  if(camera instanceof THREE.PerspectiveCamera){camera.fov=privateSuite?(width<420?48:40):(width<420?43:36);camera.updateProjectionMatrix()}
 },[camera,privateSuite,width])
 return null
}

function HouseholdRendering(){
 const gl=useThree(state=>state.gl)
 useLayoutEffect(()=>{
  const previousToneMapping=gl.toneMapping,previousExposure=gl.toneMappingExposure,previousColorSpace=gl.outputColorSpace
  gl.toneMapping=THREE.ACESFilmicToneMapping
  gl.toneMappingExposure=1.08
  gl.outputColorSpace=THREE.SRGBColorSpace
  return ()=>{gl.toneMapping=previousToneMapping;gl.toneMappingExposure=previousExposure;gl.outputColorSpace=previousColorSpace}
 },[gl])
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
 const privateSuite=theme==='home_bedroom'
 const authoredRoom=layoutRooms.find(room=>room.id===selected?.id)??layoutRooms.find(room=>room.kind===roomKind)
 const occupied=useMemo(()=>resources.filter(resource=>(resource.room_id===selected?.id||(selected?.resource_ids??[]).includes(resource.id))&&(resource.state.occupied_by?.length??0)>0).length,[resources,selected])
 const visibleResidents=useMemo(()=>residents.filter(resident=>resident.isHome!==false&&!privateAction(resident)&&residentRoom(resident,rooms,resources)===selected?.id).slice(0,8),[residents,resources,rooms,selected?.id])
 const privateResidents=useMemo(()=>residents.filter(resident=>resident.isHome!==false&&privateAction(resident)&&residentRoom(resident,rooms,resources)===selected?.id).length,[residents,resources,rooms,selected?.id])
 const residentAnchors=useMemo(()=>resolveSharedHomeResidentAnchors(roomKind,visibleResidents.map(resident=>({
  id:resident.id,actionType:resident.currentAction?.source==='life'?resident.currentAction.type:null,
 })),authoredRoom?.placements),[authoredRoom?.placements,roomKind,visibleResidents])
 const privateAssignments=useMemo(()=>resolveSharedHomePrivateSpaces(residents.slice(0,8).map(resident=>({
  id:resident.id,privateRoomId:resident.privateRoomId,
 }))),[residents])
 const residentsById=useMemo(()=>new Map(residents.map(resident=>[resident.id,resident])),[residents])
 const themeCopy=INTERIOR_THEME_COPY[theme][language]
 const selectedName=roomName(selected,language)
 const occupancyCopy=privateResidents?(language==='zh'?'私人活动中':'Private activity'):visibleResidents.length?(language==='zh'?`${visibleResidents.length} 人在这里`:`${visibleResidents.length} here`):occupied?(language==='zh'?`${occupied} 处正在使用`:`${occupied} in use`):''
 const detailCopy=[themeCopy===selectedName?'':themeCopy,occupancyCopy].filter(Boolean).join(' · ')
 return <section className={`household-interior-preview${privateSuite?' is-private-suite':''}`} aria-label={language==='zh'?'住宅室内预览':'Household interior preview'}>
  <div className="household-interior-preview__canvas" aria-hidden>
   <Canvas dpr={[1,1.75]} shadows gl={{antialias:true,alpha:true,powerPreference:'high-performance'}}>
    <PerspectiveCamera makeDefault position={[5.45,3.5,7.2]} fov={36} near={.1} far={28}/>
    <HouseholdCamera privateSuite={privateSuite}/><HouseholdRendering/>
    <ambientLight intensity={.48}/><hemisphereLight args={['#fff3d5','#3e625b',.92]}/>
    <directionalLight position={[-4.5,7.5,6]} intensity={3.15} color="#ffe7c5" castShadow shadow-mapSize={[1024,1024]} shadow-bias={-.00035}/>
    <directionalLight position={[5,4,-2]} intensity={1.1} color="#b7e1dd"/>
    <pointLight position={[3.4,2.7,1.5]} intensity={2.7} distance={9} color="#efaa78"/>
    <Suspense fallback={null}><IndoorEnvironment3D theme={theme} mode="preview" placements={authoredRoom?.placements} occupiedPrivateSlots={privateAssignments.map(assignment=>assignment.slot)}/></Suspense>
    {privateSuite&&privateAssignments.map(assignment=>{
     const resident=residentsById.get(assignment.residentId),[minX,maxX,minZ,maxZ]=assignment.space.bounds
     const backRow=assignment.space.door.wall==='south'
     const labelX=Math.max(-3.35,Math.min(3.35,(minX+maxX)/2))
     return <Html key={assignment.residentId} center position={[labelX,backRow?2.28:.58,backRow?minZ+.08:maxZ-.08]} zIndexRange={[7,4]}>
      <div className="private-bedroom-label" style={{'--private-room-accent':assignment.space.accent} as CSSProperties}><span>{assignment.slot}</span><b>{resident?.name??assignment.residentId}</b></div>
     </Html>
    })}
    {visibleResidents.map((resident,index)=>{
     const anchor=residentAnchors[index]
     const expression=deriveResidentExpression({npcId:resident.id,action:resident.currentAction,animationCue:resident.animationCue,observableState:resident.observableState})
     return <group key={resident.id} position={anchor?.position??[0,-.17,.7]} rotation={[0,anchor?.rotation??0,0]}>
      <DirectedCharacter3D avatar={resident.avatar} animation={expression.motion} performanceMode="ambient" performanceKey={`household:${selected?.id}:${expression.key}`} reducedMotion={Boolean(reduce)} name={resident.name} seed={resident.id} scale={visibleResidents.length>5?.44:.56}/>
      <Html center position={[0,visibleResidents.length>5?1.42:1.68,0]} zIndexRange={[8,5]}><CharacterEmote key={expression.key} expression={expression} language={language} size={visibleResidents.length>5?20:26} decorative/></Html>
     </group>
    })}
    <ContactShadows position={[0,-.16,-.2]} opacity={.32} scale={9.5} blur={2.45} far={5}/>
   </Canvas>
  </div>
  <div className="household-interior-preview__caption"><div><small>{language==='zh'?'共享住宅实时切面':'LIVE SHARED-HOME CUTAWAY'}</small><b>{selectedName}</b>{detailCopy&&<span>{detailCopy}</span>}</div>{rooms.length>1&&<nav aria-label={language==='zh'?'切换房间':'Choose a room'}>{rooms.map(room=><button type="button" key={room.id} className={room.id===selected?.id?'is-active':''} onClick={()=>setSelectedId(room.id)} aria-pressed={room.id===selected?.id}>{roomName(room,language)}</button>)}</nav>}</div>
 </section>
}

export default HouseholdInteriorPreview
