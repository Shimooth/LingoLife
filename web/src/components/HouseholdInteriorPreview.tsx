import {Suspense,useEffect,useLayoutEffect,useMemo,useState,type CSSProperties} from 'react'
import {Canvas,useThree} from '@react-three/fiber'
import {ContactShadows,Html,PerspectiveCamera,OrbitControls} from '@react-three/drei'
import {useLiveReducedMotion as useReducedMotion} from '../life/useLiveReducedMotion'
import * as THREE from 'three'
import type {HouseholdResource,HouseholdRoom,HouseholdLifeFacts} from '../types'
import {householdResidentRoom as residentRoom,privateHouseholdActivity as privateAction,type HouseholdResidentFocus} from '../life/householdLocation'
import type {LifeLanguage} from '../life/lifeActionCatalog'
import {attentionPartner} from '../life/householdChoreography'
import {
 IndoorEnvironment3D,INTERIOR_THEME_COPY,interiorThemeFor,
 resolveSharedHomePrivateSpaces,resolveIndoorResidentAnchors,
} from '../three/interiors'
import {HouseholdLifeResident} from './HouseholdLifeResident'
import {HouseholdRestingResident} from './HouseholdRestingResident'
import type {HouseholdResidentVisual} from './householdVisuals'
import type {WorldLayoutRoom} from '../worldLayout'

type Props={
 rooms:HouseholdRoom[]
 resources:HouseholdResource[]
 language:LifeLanguage
 residents?:HouseholdResidentVisual[]
 layoutRooms?:readonly WorldLayoutRoom[]
 life?:HouseholdLifeFacts
 kitchenRequest?:number
 residentFocus?:HouseholdResidentFocus
 onMemberInteract?:(id:string)=>void
}

const ROOM_COPY:Record<string,{zh:string;en:string}>={
 living_room:{zh:'客厅',en:'Living room'},kitchen:{zh:'厨房',en:'Kitchen'},bathroom:{zh:'浴室',en:'Bathroom'},
 bedroom:{zh:'私人卧室区',en:'Private bedroom wing'},shared_space:{zh:'公共空间',en:'Shared space'},
}

const roomName=(room:HouseholdRoom|undefined,language:LifeLanguage)=>{
 if(!room)return language==='zh'?'住宅预览':'Home preview'
 return language==='zh'?room.name_zh?.trim()||ROOM_COPY[room.kind]?.zh||room.kind.replaceAll('_',' '):room.name?.trim()||ROOM_COPY[room.kind]?.en||room.kind.replaceAll('_',' ')
}

function HouseholdCamera({privateSuite,focus}:{privateSuite:boolean;focus?:readonly number[]}){
 const camera=useThree(state=>state.camera),width=useThree(state=>state.size.width),height=useThree(state=>state.size.height)
 const focusX=focus?.[0],focusZ=focus?.[2]
 useLayoutEffect(()=>{
  if(privateSuite&&focusX!==undefined&&focusZ!==undefined){
   camera.position.set(focusX+2.8,5.2,focusZ+4.8)
   camera.lookAt(focusX,.45,focusZ)
  }else if(privateSuite){
   camera.position.set(width<420?5.6:6.6,width<420?9.6:6.4,width<420?17:9.3)
   camera.lookAt(0,.35,-.12)
  }else{
   const fit=Math.max(1,1.55/(width/Math.max(1,height)))
   camera.position.set(5.45*fit,.84+(3.5-.84)*fit,-.48+(7.2+.48)*fit)
   camera.lookAt(0,.84,-.48)
  }
  if(camera instanceof THREE.PerspectiveCamera){camera.fov=privateSuite?(width<420?48:40):(width<420?43:36);camera.updateProjectionMatrix()}
 },[camera,privateSuite,width,height,focusX,focusZ])
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

const preferredRoom=(rooms:HouseholdRoom[],resources:HouseholdResource[],residents:HouseholdResidentVisual[])=>{
 const active=residents.find(resident=>resident.isHome!==false)
 return (active&&residentRoom(active,rooms,resources))??rooms.find(room=>/living|shared/.test(room.kind))?.id??rooms[0]?.id??'living-room'
}

export function HouseholdInteriorPreview({rooms,resources,language,residents=[],layoutRooms=[],life,kitchenRequest=0,residentFocus,onMemberInteract}:Props){
 const reduce=useReducedMotion()
 const [selectedId,setSelectedId]=useState(()=>preferredRoom(rooms,resources,residents))
 const [tracking,setTracking]=useState(Boolean(residentFocus))
 const target=residents.find(resident=>resident.id===residentFocus?.id)
 const targetRoom=target?residentRoom(target,rooms,resources):undefined
 useEffect(()=>{setTracking(Boolean(residentFocus))},[residentFocus])
 useEffect(()=>{if(tracking&&targetRoom)setSelectedId(targetRoom)},[tracking,targetRoom,residentFocus])
 const kitchenId=rooms.find(room=>room.kind==='kitchen')?.id
 useEffect(()=>{if(kitchenRequest&&kitchenId){setTracking(false);setSelectedId(kitchenId)}},[kitchenRequest,kitchenId])
 useEffect(()=>{
  if(rooms.length&&!rooms.some(room=>room.id===selectedId))setSelectedId(preferredRoom(rooms,resources,residents))
 },[residents,resources,rooms,selectedId])
 const selected=rooms.find(room=>room.id===selectedId)??rooms[0]
 const roomKind=selected?.kind||'living_room'
 const theme=interiorThemeFor({roomKind})
 const privateSuite=theme==='home_bedroom'
 const authoredRoom=layoutRooms.find(room=>room.id===selected?.id)??layoutRooms.find(room=>room.kind===roomKind)
 const occupied=useMemo(()=>resources.filter(resource=>(resource.room_id===selected?.id||(selected?.resource_ids??[]).includes(resource.id))&&(resource.state.occupied_by?.length??0)>0).length,[resources,selected])
 const visibleResidents=useMemo(()=>residents.filter(resident=>resident.isHome!==false&&residentRoom(resident,rooms,resources)===selected?.id).slice(0,8),[residents,resources,rooms,selected?.id])
 const residentAnchors=useMemo(()=>resolveIndoorResidentAnchors(roomKind,visibleResidents.map(resident=>({
  id:resident.id,actionType:resident.currentAction?.source==='life'?resident.currentAction.type:null,
 })),residents,authoredRoom?.placements),[authoredRoom?.placements,roomKind,visibleResidents,residents])
 const privateAssignments=useMemo(()=>resolveSharedHomePrivateSpaces(residents.slice(0,8).map(resident=>({
  id:resident.id,privateRoomId:resident.privateRoomId,
 }))),[residents])
 const residentsById=useMemo(()=>new Map(residents.map(resident=>[resident.id,resident])),[residents])
 const bedroomFocus=privateSuite?residentAnchors[visibleResidents.findIndex(resident=>resident.id===residentFocus?.id)]?.position:undefined
 const cameraTarget:[number,number,number]=bedroomFocus?[bedroomFocus[0],.45,bedroomFocus[2]]:privateSuite?[0,.35,-.12]:[0,.84,-.48]
 const themeCopy=INTERIOR_THEME_COPY[theme][language]
 const selectedName=roomName(selected,language)
 const occupancyCopy=visibleResidents.length?(language==='zh'?`${visibleResidents.length} 人在这里`:`${visibleResidents.length} here`):occupied?(language==='zh'?`${occupied} 处正在使用`:`${occupied} in use`):''
 const stateCounts=visibleResidents.reduce<Record<string,number>>((counts,resident)=>{const action=resident.currentAction?.source==='life'?resident.currentAction:undefined;const state=action?.status==='performing'?(action.type==='sleep'?'sleep':action.type==='rest_alone'?'rest':action.type==='shower'?'shower':'busy'):'transition';counts[state]=(counts[state]??0)+1;return counts},{})
 const stateNames:Record<string,string>=language==='zh'?{sleep:'睡觉',rest:'休息',shower:'洗澡',busy:'活动中',transition:'准备或移动中'}:{sleep:'sleeping',rest:'resting',shower:'showering',busy:'active',transition:'preparing or moving'}
 const detailCopy=[themeCopy===selectedName?'':themeCopy,occupancyCopy,...Object.entries(stateCounts).map(([state,count])=>language==='zh'?`${count} 人${stateNames[state]}`:`${count} ${stateNames[state]}`)].filter(Boolean).join(' · ')
 const focusCopy=target?(target.isHome===false?(language==='zh'?'已离开住宅，当前位置请到地图查看。':'Has left home. View their current location on the map.'):targetRoom?(language==='zh'?`现在位于${roomName(rooms.find(room=>room.id===targetRoom),language)}，脚下金色圆圈为所选居民。`:`Currently in ${roomName(rooms.find(room=>room.id===targetRoom),language)}. The selected resident has a gold ring.`):(language==='zh'?'正在同步具体位置…':'Updating their location…')):(language==='zh'?'正在同步居民位置…':'Updating resident location…')
 return <>
  {residentFocus&&<div className="household-resident-focus" role="status"><div><b>{target?.name??(language==='zh'?'定位居民':'Locating resident')}</b><p>{focusCopy}</p></div>{targetRoom&&<button type="button" onClick={()=>{setTracking(true);setSelectedId(targetRoom)}}>{language==='zh'?'定位':'Locate'}</button>}{target&&onMemberInteract&&!privateAction(target)&&<button type="button" onClick={()=>onMemberInteract(target.id)}>{target.isHome===false?(language==='zh'?'回地图':'Map'):(language==='zh'?'交谈':'Talk')}</button>}</div>}
 <section className={`household-interior-preview${privateSuite?' is-private-suite':''}`} aria-label={language==='zh'?'住宅室内预览':'Household interior preview'}>
  <div className="household-interior-preview__canvas" aria-hidden>
   <Canvas dpr={[1,1.75]} shadows gl={{antialias:true,alpha:true,localClippingEnabled:true,powerPreference:'high-performance'}}>
    <PerspectiveCamera makeDefault position={[5.45,3.5,7.2]} fov={36} near={.1} far={28}/>
    <HouseholdCamera privateSuite={privateSuite} focus={bedroomFocus}/><HouseholdRendering/>
    <OrbitControls target={cameraTarget} enableDamping={!reduce} dampingFactor={.12} minDistance={3.5} maxDistance={24} minPolarAngle={.25} maxPolarAngle={Math.PI*.48}/>
    <ambientLight intensity={.48}/><hemisphereLight args={['#fff3d5','#3e625b',.92]}/>
    <directionalLight position={[-4.5,7.5,6]} intensity={3.15} color="#ffe7c5" castShadow shadow-mapSize={[1024,1024]} shadow-bias={-.00035}/>
    <directionalLight position={[5,4,-2]} intensity={1.1} color="#b7e1dd"/>
    <pointLight position={[3.4,2.7,1.5]} intensity={2.7} distance={9} color="#efaa78"/>
    <Suspense fallback={null}><IndoorEnvironment3D theme={theme} mode="preview" placements={authoredRoom?.placements} occupiedPrivateSlots={privateAssignments.map(assignment=>assignment.slot)} householdLife={life} cooking={visibleResidents.some(resident=>resident.currentAction?.source==='life'&&resident.currentAction.type==='prepare_food'&&resident.currentAction.status==='performing')} reducedMotion={Boolean(reduce)}/></Suspense>
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
     const action=resident.currentAction?.source==='life'?resident.currentAction:undefined
     const partnerId=attentionPartner({id:resident.id,type:action?.type,targetNpcId:action?.targetNpcId},visibleResidents.map(other=>({id:other.id})))??visibleResidents.find(other=>other.currentAction?.source==='life'&&other.currentAction.status==='performing'&&other.currentAction.targetNpcId===resident.id)?.id
     const partner=partnerId?residentAnchors[visibleResidents.findIndex(other=>other.id===partnerId)]:undefined
     if(action?.status==='performing'&&(action.type==='sleep'||action.type==='shower'))return <HouseholdRestingResident key={resident.id} resident={resident} anchor={anchor} selected={resident.id===residentFocus?.id} language={language} reducedMotion={Boolean(reduce)}/>
     return <HouseholdLifeResident key={resident.id} selected={resident.id===residentFocus?.id} resident={resident} anchor={anchor} partner={partner} roomKind={roomKind} placements={authoredRoom?.placements} language={language} reducedMotion={Boolean(reduce)}/>
    })}
    <ContactShadows position={[0,-.16,-.2]} opacity={.32} scale={9.5} blur={2.45} far={5}/>
   </Canvas>
  </div>
  {life&&roomKind==='kitchen'&&(life.shared_meals.length>0||life.dirty_dishes_count>0)&&<div className="household-life-facts" role="status">
   {life.shared_meals.length>0&&<span>♨ {language==='zh'?`${residentsById.get(life.shared_meals[0].prepared_by)?.name??'室友'} 留了 ${life.shared_meals.length} 份可以分享的饭菜`:`${residentsById.get(life.shared_meals[0].prepared_by)?.name??'A roommate'} left ${life.shared_meals.length} portions to share`}</span>}
   {life.dirty_dishes_count>0&&<span>◫ {language==='zh'?'水槽边还有待收拾的餐具':'There are still dishes to clean'}</span>}
  </div>}
  <div className="household-interior-preview__caption"><div><small>{language==='zh'?'共享住宅实时切面':'LIVE SHARED-HOME CUTAWAY'}</small><b>{selectedName}</b>{detailCopy&&<span>{detailCopy}</span>}</div>{rooms.length>1&&<nav aria-label={language==='zh'?'切换房间':'Choose a room'}>{rooms.map(room=><button type="button" key={room.id} className={room.id===selected?.id?'is-active':''} onClick={()=>{setTracking(false);setSelectedId(room.id)}} aria-pressed={room.id===selected?.id}>{roomName(room,language)}</button>)}</nav>}</div>
 </section>
 </>
}

export default HouseholdInteriorPreview
