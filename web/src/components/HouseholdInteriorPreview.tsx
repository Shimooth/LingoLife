import {Suspense,useEffect,useLayoutEffect,useMemo,useState,useRef,type ComponentRef,type RefObject,type CSSProperties} from 'react'
import {Canvas,useThree,useFrame} from '@react-three/fiber'
import {ContactShadows,Html,PerspectiveCamera,OrbitControls} from '@react-three/drei'
import {useLiveReducedMotion as useReducedMotion} from '../life/useLiveReducedMotion'
import * as THREE from 'three'
import type {HouseholdResource,HouseholdRoom,HouseholdLifeFacts} from '../types'
import {householdResidentRoom as residentRoom,privateHouseholdActivity as privateAction,type HouseholdResidentFocus} from '../life/householdLocation'
import type {LifeLanguage} from '../life/lifeActionCatalog'
import {attentionPartner} from '../life/householdChoreography'
import {
 IndoorEnvironment3D,interiorThemeFor,
 resolveSharedHomePrivateSpaces,resolveIndoorResidentAnchors,
} from '../three/interiors'
import {HouseholdLifeResident} from './HouseholdLifeResident'
import {HouseholdRestingResident} from './HouseholdRestingResident'
import {householdDrinkPlacements,householdSharedDrink,type HouseholdResidentVisual} from './householdVisuals'
import {SharedDrinkPerformance3D} from '../three/characters/SharedDrinkPerformance3D'
import type {WorldLayoutRoom} from '../worldLayout'
import {AdaptiveResolution,SceneLighting,SceneLook} from '../three/rendering/SceneLook'
import {useVisualBudget} from '../three/rendering/useVisualBudget'

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

function HouseholdCamera({privateSuite,focus,overview,controls,request,manual,reducedMotion}:{privateSuite:boolean;focus?:readonly number[];overview?:readonly number[];controls:RefObject<ComponentRef<typeof OrbitControls>|null>;request:string;manual:RefObject<boolean>;reducedMotion:boolean}){
 const camera=useThree(state=>state.camera),width=useThree(state=>state.size.width),height=useThree(state=>state.size.height)
 const focusX=focus?.[0],focusZ=focus?.[2]
 const overviewX=overview?.[0],overviewZ=overview?.[2],overviewSpan=overview?.[3]??0
 const destination=useRef({position:new THREE.Vector3(),target:new THREE.Vector3(),moving:false,initialized:false})
 const lastRequest=useRef('')
 useLayoutEffect(()=>{
  const identity=`${request}:${focusX}:${focusZ}`
  if(manual.current&&identity===lastRequest.current)return
  lastRequest.current=identity
  const next=destination.current
  if(focusX!==undefined&&focusZ!==undefined){
   next.position.set(focusX+(privateSuite?2.8:3.8),privateSuite?5.2:4.6,focusZ+(privateSuite?4.8:6.2))
   next.target.set(focusX,privateSuite?.45:.85,focusZ)
  }else if(!privateSuite&&width<600&&overviewX!==undefined&&overviewZ!==undefined){
   // A narrow overview frames the residents together, not the empty centre of the room.
   const fit=Math.max(1,(overviewSpan+1.6)/(4.5*width/Math.max(1,height)))
   next.target.set(overviewX,.85,overviewZ)
   next.position.set(overviewX+3.8*fit,.85+3.75*fit,overviewZ+6.2*fit)
  }else if(privateSuite){
   next.position.set(width<420?5.6:6.6,width<420?9.6:6.4,width<420?17:9.3)
   next.target.set(0,.35,-.12)
  }else{
   const fit=Math.max(1,Math.min(1.18,1.35/(width/Math.max(1,height))))
   next.position.set(width<600?4.5:6.4*fit,width<600?5.4:5.6*fit,width<600?8.2:8.6*fit)
   next.target.set(width<600?-1:-.2,.6,-.25)
  }
  if(camera instanceof THREE.PerspectiveCamera){camera.fov=width<420?44:38;camera.updateProjectionMatrix()}
  manual.current=false
  next.moving=true
  if(!next.initialized||reducedMotion){camera.position.copy(next.position);camera.lookAt(next.target);controls.current?.target.copy(next.target);next.initialized=true}
 },[camera,privateSuite,width,height,focusX,focusZ,overviewX,overviewZ,overviewSpan,controls,manual,request,reducedMotion])
 useFrame((_,delta)=>{
  const next=destination.current,orbit=controls.current
  if(manual.current||!next.moving||!orbit)return
  const blend=reducedMotion?1:1-Math.exp(-7*Math.min(delta,.05))
  camera.position.lerp(next.position,blend);orbit.target.lerp(next.target,blend);orbit.update()
  if(camera.position.distanceToSquared(next.position)<.00001&&orbit.target.distanceToSquared(next.target)<.00001)next.moving=false
 })
 return null
}

const preferredRoom=(rooms:HouseholdRoom[],resources:HouseholdResource[],residents:HouseholdResidentVisual[])=>{
 const active=residents.find(resident=>resident.isHome!==false)
 return (active&&residentRoom(active,rooms,resources))??rooms.find(room=>/living|shared/.test(room.kind))?.id??rooms[0]?.id??'living-room'
}

export function HouseholdInteriorPreview({rooms,resources,language,residents=[],layoutRooms=[],life,kitchenRequest=0,residentFocus,onMemberInteract}:Props){
 const visualBudget=useVisualBudget()
 const reduce=useReducedMotion()
 const controls=useRef<ComponentRef<typeof OrbitControls>>(null),manualCamera=useRef(false)
 const [locateRequest,setLocateRequest]=useState(0)
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
 const visibleResidents=useMemo(()=>residents.filter(resident=>resident.isHome!==false&&residentRoom(resident,rooms,resources)===selected?.id).slice(0,8),[residents,resources,rooms,selected?.id])
 const drinkPlacements=useMemo(()=>householdDrinkPlacements(authoredRoom?.placements),[authoredRoom?.placements])
 const liveDrink=useMemo(()=>householdSharedDrink(visibleResidents,roomKind,drinkPlacements),[visibleResidents,roomKind,drinkPlacements])
 const residentAnchors=useMemo(()=>resolveIndoorResidentAnchors(roomKind,visibleResidents.map(resident=>({
  id:resident.id,actionType:resident.currentAction?.source==='life'?resident.currentAction.type:null,
 })),residents,authoredRoom?.placements).map((anchor,index)=>{
  const drinkIndex=liveDrink?.staging.participant_ids.indexOf(visibleResidents[index].id)??-1
  const seat=drinkIndex>=0?liveDrink?.layout.seats[drinkIndex]:undefined
  return seat?{id:`shared-drink-seat:${visibleResidents[index].id}`,position:seat.position,rotation:seat.rotation}:anchor
 }),[authoredRoom?.placements,roomKind,visibleResidents,residents,liveDrink])
 const privateAssignments=useMemo(()=>resolveSharedHomePrivateSpaces(residents.slice(0,8).map(resident=>({
  id:resident.id,privateRoomId:resident.privateRoomId,
 }))),[residents])
 const residentsById=useMemo(()=>new Map(residents.map(resident=>[resident.id,resident])),[residents])
 const bedroomFocus=tracking?residentAnchors[visibleResidents.findIndex(resident=>resident.id===residentFocus?.id)]?.position:undefined
 const selectedDrinkSeat=liveDrink?.layout.seats[liveDrink.staging.participant_ids.indexOf(residentFocus?.id??'')]
 const overview=useMemo(()=>{
  if(!residentAnchors.length)return undefined
  const xs=residentAnchors.map(anchor=>anchor.position[0]),zs=residentAnchors.map(anchor=>anchor.position[2])
  const minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs)
  return [(minX+maxX)/2,0,(minZ+maxZ)/2,Math.hypot(maxX-minX,maxZ-minZ)]
 },[residentAnchors])
 const selectedName=roomName(selected,language)
 return <>
 <section className={`household-interior-preview${privateSuite?' is-private-suite':''}`} aria-label={language==='zh'?'住宅室内预览':'Household interior preview'}>
  <div className="household-interior-preview__canvas" aria-hidden>
   <Canvas dpr={visualBudget.dpr} shadows="percentage" gl={{antialias:true,alpha:true,localClippingEnabled:true,powerPreference:'high-performance'}}>
    <PerspectiveCamera makeDefault position={[5.45,3.5,7.2]} fov={36} near={.1} far={28}/>
    <OrbitControls ref={controls} onStart={()=>{manualCamera.current=true}} enableDamping={!reduce} dampingFactor={.12} minDistance={3.5} maxDistance={24} minPolarAngle={.25} maxPolarAngle={Math.PI*.48}/>
    <HouseholdCamera privateSuite={privateSuite} focus={bedroomFocus} overview={overview} controls={controls} request={`${selectedId}:${residentFocus?.request??0}:${locateRequest}:${kitchenRequest}`} manual={manualCamera} reducedMotion={Boolean(reduce)}/><SceneLook/><AdaptiveResolution onTier={visualBudget.onTier}/>
    <SceneLighting/>
    <Suspense fallback={null}><IndoorEnvironment3D theme={theme} mode="preview" placements={authoredRoom?.placements} occupiedPrivateSlots={privateAssignments.map(assignment=>assignment.slot)} householdLife={life} cooking={visibleResidents.some(resident=>resident.currentAction?.source==='life'&&resident.currentAction.type==='prepare_food'&&resident.currentAction.status==='performing')} reducedMotion={Boolean(reduce)}/></Suspense>
    {privateSuite&&privateAssignments.map(assignment=>{
     const resident=residentsById.get(assignment.residentId),[minX,maxX,minZ,maxZ]=assignment.space.bounds
     const backRow=assignment.space.door.wall==='south'
     const labelX=Math.max(-3.35,Math.min(3.35,(minX+maxX)/2))
     return <Html key={assignment.residentId} center position={[labelX,backRow?2.28:.58,backRow?minZ+.08:maxZ-.08]} zIndexRange={[7,4]}>
      <div className="private-bedroom-label" style={{'--private-room-accent':assignment.space.accent} as CSSProperties}><span>{assignment.slot}</span><b>{resident?.name??assignment.residentId}</b></div>
     </Html>
    })}
    {liveDrink&&<Suspense fallback={null}><SharedDrinkPerformance3D key={liveDrink.id} staging={liveDrink.staging} participants={liveDrink.residents.map(person=>({id:person.id,name:person.name}))} participantAvatars={Object.fromEntries(liveDrink.residents.map(person=>[person.id,person.avatar]))} placements={drinkPlacements} reducedMotion={Boolean(reduce)}/></Suspense>}
    {selectedDrinkSeat&&<mesh name="shared-drink-selected-resident" position={[selectedDrinkSeat.position[0],selectedDrinkSeat.position[1]-.039,selectedDrinkSeat.position[2]]} rotation-x={-Math.PI/2}>
     <ringGeometry args={[.32,.37,40]}/><meshBasicMaterial color="#e5b45f" transparent opacity={.75} depthWrite={false}/>
    </mesh>}
    {visibleResidents.map((resident,index)=>{
     if(liveDrink?.staging.participant_ids.includes(resident.id))return null
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
  <div className="household-interior-preview__caption"><div><b>{selectedName}</b>{residentFocus&&<div className="household-focus-actions">{targetRoom&&<button type="button" aria-label={language==='zh'?'定位所选居民':'Locate selected resident'} onClick={()=>{setTracking(true);setSelectedId(targetRoom);setLocateRequest(value=>value+1)}}>{language==='zh'?'定位':'Locate'}</button>}{target&&onMemberInteract&&!privateAction(target)&&<button type="button" onClick={()=>onMemberInteract(target.id)}>{target.isHome===false?(language==='zh'?'回地图':'Map'):(language==='zh'?'交谈':'Talk')}</button>}</div>}</div>{rooms.length>1&&<nav aria-label={language==='zh'?'切换房间':'Choose a room'}>{rooms.map(room=><button type="button" key={room.id} className={room.id===selected?.id?'is-active':''} onClick={()=>{setTracking(false);setSelectedId(room.id)}} aria-pressed={room.id===selected?.id}>{roomName(room,language)}</button>)}</nav>}</div>
 </section>
 </>
}

export default HouseholdInteriorPreview
