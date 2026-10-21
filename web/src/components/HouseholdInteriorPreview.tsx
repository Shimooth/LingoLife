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
 SHARED_HOME_MANIFEST,
 resolveSharedHomePrivateSpaces,resolveIndoorResidentAnchors,
} from '../three/interiors'
import {HouseholdLifeResident} from './HouseholdLifeResident'
import {householdDrinkPlacements,householdSharedDrink,type HouseholdResidentVisual} from './householdVisuals'
import {SharedDrinkPerformance3D} from '../three/characters/SharedDrinkPerformance3D'
import type {WorldLayoutRoom} from '../worldLayout'
import {ConnectedHomeEnvironment3D} from '../three/interiors/ConnectedHomeEnvironment3D'
import {connectedHomeOffset,connectedHomePoint,connectedHomeFixturePoint} from '../three/interiors/connectedHomeLayout'
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

function HouseholdCamera({focus,focusId,roomKind,controls,request,manual,reducedMotion}:{focus?:readonly number[];focusId?:string;roomKind?:string;controls:RefObject<ComponentRef<typeof OrbitControls>|null>;request:string;manual:RefObject<boolean>;reducedMotion:boolean}){
 const camera=useThree(state=>state.camera),scene=useThree(state=>state.scene),width=useThree(state=>state.size.width),height=useThree(state=>state.size.height)
 const focusX=focus?.[0],focusZ=focus?.[2]
 const destination=useRef({position:new THREE.Vector3(),target:new THREE.Vector3(),offset:new THREE.Vector3(),moving:false,initialized:false})
 const lastRequest=useRef('')
 useLayoutEffect(()=>{
  const identity=`${request}:${width}:${height}`
  if(manual.current&&identity===lastRequest.current)return
  lastRequest.current=identity
  const next=destination.current,offset=roomKind?connectedHomeOffset(roomKind):[0,0,0]
  const focused=focusX!==undefined&&focusZ!==undefined
  next.target.set(focused?focusX:offset[0],.55,focused?focusZ:offset[2]-.3)
  const direction=new THREE.Vector3(.48,1.05,1).normalize()
  const right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),direction).normalize()
  const up=new THREE.Vector3().crossVectors(direction,right).normalize()
  const fov=width<600?46:42,aspect=width/Math.max(1,height),tanY=Math.tan(fov*Math.PI/360)
  // Frame the actual floor plan at any aspect ratio, with room for the controls.
  const spanX=focused?5:roomKind?10.7:23.2,spanZ=focused?4.4:roomKind?7.5:17
  let distance=0
  for(const x of [-spanX/2,spanX/2])for(const y of [-.6,2.4])for(const z of [-spanZ/2,spanZ/2]){
   const corner=new THREE.Vector3(x,y,z)
   distance=Math.max(distance,corner.dot(direction)+Math.max(Math.abs(corner.dot(right))/(tanY*aspect),Math.abs(corner.dot(up))/tanY))
  }
  next.position.copy(next.target).addScaledVector(direction,distance*1.18)
  next.offset.copy(next.position).sub(next.target)
  if(camera instanceof THREE.PerspectiveCamera){camera.fov=fov;camera.updateProjectionMatrix()}
  manual.current=false;next.moving=true
  if(!next.initialized||reducedMotion){camera.position.copy(next.position);camera.lookAt(next.target);controls.current?.target.copy(next.target);next.initialized=true}
 },[camera,width,height,focusX,focusZ,roomKind,controls,manual,request,reducedMotion])
 useFrame((_,delta)=>{
  const next=destination.current,orbit=controls.current
  if(manual.current||!orbit)return
  const actor=focusId?(scene.getObjectByName(`household-resident:${focusId}`)??scene.getObjectByName(`drink-resident:${focusId}`)):undefined
  if(actor){next.target.set(actor.position.x,.55,actor.position.z);next.position.copy(next.target).add(next.offset);next.moving=true}
  if(!next.moving)return
  const blend=reducedMotion?1:1-Math.exp(-7*Math.min(delta,.05))
  camera.position.lerp(next.position,blend);orbit.target.lerp(next.target,blend);orbit.update()
  if(camera.position.distanceToSquared(next.position)<.00001&&orbit.target.distanceToSquared(next.target)<.00001)next.moving=false
 })
 return null
}

export function HouseholdInteriorPreview({rooms,resources,language,residents=[],layoutRooms=[],life,kitchenRequest=0,residentFocus,onMemberInteract}:Props){
 const visualBudget=useVisualBudget()
 const reduce=useReducedMotion()
 const controls=useRef<ComponentRef<typeof OrbitControls>>(null),manualCamera=useRef(false)
 const [locateRequest,setLocateRequest]=useState(0)
 const [selectedId,setSelectedId]=useState('__home__')
 const [tracking,setTracking]=useState(Boolean(residentFocus))
 const target=residents.find(resident=>resident.id===residentFocus?.id)
 const targetRoom=target?residentRoom(target,rooms,resources):undefined
 useEffect(()=>{setTracking(Boolean(residentFocus))},[residentFocus])
 useEffect(()=>{if(tracking&&targetRoom)setSelectedId(targetRoom)},[tracking,targetRoom,residentFocus])
 const kitchenId=rooms.find(room=>room.kind==='kitchen')?.id
 useEffect(()=>{if(kitchenRequest&&kitchenId){setTracking(false);setSelectedId(kitchenId)}},[kitchenRequest,kitchenId])
 const homeRooms=useMemo(()=>SHARED_HOME_MANIFEST.rooms.map(defaultRoom=>{
  const room=rooms.find(item=>item.kind===defaultRoom.kind)??{id:defaultRoom.id,kind:defaultRoom.kind,resource_ids:[]}
  const authored=layoutRooms.find(item=>item.id===room.id)??layoutRooms.find(item=>item.kind===room.kind)
  return {...room,placements:authored?.placements}
 }),[rooms,layoutRooms])
 const visibleResidents=useMemo(()=>residents.filter(resident=>resident.isHome!==false).slice(0,8),[residents])
 const roomResidents=useMemo(()=>homeRooms.map(room=>({
  ...room,residents:visibleResidents.filter(resident=>{
   const id=residentRoom(resident,rooms,resources)
   const kind=rooms.find(item=>item.id===id)?.kind
   return id===room.id||kind===room.kind||((!id||kind==='shared_space')&&room.kind==='living_room')
  }),
 })),[homeRooms,visibleResidents,rooms,resources])
 const livingRoom=roomResidents.find(room=>room.kind==='living_room')!
 const drinkPlacements=useMemo(()=>householdDrinkPlacements(livingRoom.placements,connectedHomeOffset('living_room')),[livingRoom.placements])
 const liveDrink=useMemo(()=>householdSharedDrink(livingRoom.residents,'living_room',drinkPlacements),[livingRoom.residents,drinkPlacements])
 const actorRecords=useMemo(()=>roomResidents.flatMap(room=>{
  const anchors=resolveIndoorResidentAnchors(room.kind,room.residents.map(resident=>({
   id:resident.id,actionType:resident.currentAction?.source==='life'?resident.currentAction.type:null,
  })),residents,room.placements)
  return room.residents.map((resident,index)=>{
   const local=anchors[index]
   const sleeping=resident.currentAction?.source==='life'&&resident.currentAction.status==='performing'&&resident.currentAction.type==='sleep'
   const position=sleeping?connectedHomePoint([local.position[0]*.99,local.position[1],local.position[2]*.99+.05],room.kind):connectedHomePoint(local.position,room.kind)
   const drinkIndex=liveDrink?.staging.participant_ids.indexOf(resident.id)??-1
   const seat=drinkIndex>=0?liveDrink?.layout.seats[drinkIndex]:undefined
   return {resident,room,anchor:seat?{id:`shared-drink-seat:${resident.id}`,position:seat.position,rotation:seat.rotation}:{...local,position}}
  })
 }),[roomResidents,residents,liveDrink])
 const privateAssignments=useMemo(()=>resolveSharedHomePrivateSpaces(residents.slice(0,8).map(resident=>({
  id:resident.id,privateRoomId:resident.privateRoomId,
 }))),[residents])
 const residentsById=useMemo(()=>new Map(residents.map(resident=>[resident.id,resident])),[residents])
 const focusedAnchor=tracking?actorRecords.find(record=>record.resident.id===residentFocus?.id)?.anchor.position:undefined
 const selected=homeRooms.find(room=>room.id===selectedId||room.kind===rooms.find(item=>item.id===selectedId)?.kind)
 const selectedDrinkSeat=liveDrink?.layout.seats[liveDrink.staging.participant_ids.indexOf(residentFocus?.id??'')]
 const selectedName=selected?roomName(selected,language):language==='zh'?'共享住宅 · 全屋':'Shared home · Overview'
 return <>
 <section className="household-interior-preview is-connected-home" aria-label={language==='zh'?'住宅室内预览':'Household interior preview'}>
  <div className="household-interior-preview__canvas" aria-hidden>
   <Canvas dpr={visualBudget.dpr} shadows="percentage" gl={{antialias:true,alpha:true,localClippingEnabled:true,powerPreference:'high-performance'}}>
    <PerspectiveCamera makeDefault position={[5.45,3.5,7.2]} fov={36} near={.1} far={160}/>
    <OrbitControls ref={controls} onStart={()=>{manualCamera.current=true}} enableDamping={!reduce} dampingFactor={.12} minDistance={3.5} maxDistance={110} minPolarAngle={.25} maxPolarAngle={Math.PI*.48}/>
    <HouseholdCamera roomKind={selected?.kind} focus={focusedAnchor} focusId={tracking?residentFocus?.id:undefined} controls={controls} request={`${selectedId}:${residentFocus?.request??0}:${locateRequest}:${kitchenRequest}`} manual={manualCamera} reducedMotion={Boolean(reduce)}/><SceneLook/><AdaptiveResolution onTier={visualBudget.onTier}/>
    <SceneLighting areaSize={16}/>
    <Suspense fallback={null}><ConnectedHomeEnvironment3D rooms={roomResidents.map(room=>({...room,cooking:room.residents.some(resident=>resident.currentAction?.source==='life'&&resident.currentAction.type==='prepare_food'&&resident.currentAction.status==='performing')}))} occupiedPrivateSlots={privateAssignments.map(assignment=>assignment.slot)} householdLife={life} reducedMotion={Boolean(reduce)}/></Suspense>
    {selected?.kind==='bedroom'&&privateAssignments.map(assignment=>{
     const resident=residentsById.get(assignment.residentId),[minX,maxX,minZ,maxZ]=assignment.space.bounds
     const backRow=assignment.space.door.wall==='south'
     const labelX=Math.max(-3.35,Math.min(3.35,(minX+maxX)/2))
     return <Html key={assignment.residentId} center position={connectedHomeFixturePoint([labelX,backRow?2.28:.58,backRow?minZ+.08:maxZ-.08],'bedroom')} zIndexRange={[7,4]}>
      <div className="private-bedroom-label" style={{'--private-room-accent':assignment.space.accent} as CSSProperties}><span>{assignment.slot}</span><b>{resident?.name??assignment.residentId}</b></div>
     </Html>
    })}
    {liveDrink&&<Suspense fallback={null}><SharedDrinkPerformance3D key={liveDrink.id} staging={liveDrink.staging} participants={liveDrink.residents.map(person=>({id:person.id,name:person.name}))} participantAvatars={Object.fromEntries(liveDrink.residents.map(person=>[person.id,person.avatar]))} placements={drinkPlacements} reducedMotion={Boolean(reduce)}/></Suspense>}
    {selectedDrinkSeat&&<mesh name="shared-drink-selected-resident" position={[selectedDrinkSeat.position[0],selectedDrinkSeat.position[1]-.039,selectedDrinkSeat.position[2]]} rotation-x={-Math.PI/2}>
     <ringGeometry args={[.32,.37,40]}/><meshBasicMaterial color="#e5b45f" transparent opacity={.75} depthWrite={false}/>
    </mesh>}
    {actorRecords.map(({resident,anchor,room})=>{
     if(liveDrink?.staging.participant_ids.includes(resident.id))return null
     const action=resident.currentAction?.source==='life'?resident.currentAction:undefined
     const roommates=actorRecords.filter(record=>record.room.id===room.id)
     const partnerId=attentionPartner({id:resident.id,type:action?.type,targetNpcId:action?.targetNpcId},roommates.map(other=>({id:other.resident.id})))??roommates.find(other=>other.resident.currentAction?.source==='life'&&other.resident.currentAction.status==='performing'&&other.resident.currentAction.targetNpcId===resident.id)?.resident.id
     const partner=actorRecords.find(record=>record.resident.id===partnerId)?.anchor
     return <HouseholdLifeResident key={resident.id} selected={resident.id===residentFocus?.id} resident={resident} anchor={anchor} partner={partner} roomKind={room.kind} placements={room.placements} connectedRooms={homeRooms} language={language} reducedMotion={Boolean(reduce)}/>
    })}
    <ContactShadows position={[0,-.16,-.3]} opacity={.3} scale={25} blur={2.5} far={5} resolution={512}/>
   </Canvas>
  </div>
  {life&&(selected?.kind==='kitchen'||!selected)&&(life.shared_meals.length>0||life.dirty_dishes_count>0)&&<div className="household-life-facts" role="status">
   {life.shared_meals.length>0&&<span>♨ {language==='zh'?`${residentsById.get(life.shared_meals[0].prepared_by)?.name??'室友'} 留了 ${life.shared_meals.length} 份可以分享的饭菜`:`${residentsById.get(life.shared_meals[0].prepared_by)?.name??'A roommate'} left ${life.shared_meals.length} portions to share`}</span>}
   {life.dirty_dishes_count>0&&<span>◫ {language==='zh'?'水槽边还有待收拾的餐具':'There are still dishes to clean'}</span>}
  </div>}
  <div className="household-interior-preview__caption"><div><b>{selectedName}</b>{residentFocus&&<div className="household-focus-actions">{targetRoom&&<button type="button" aria-label={language==='zh'?'定位所选居民':'Locate selected resident'} onClick={()=>{setTracking(true);setSelectedId(targetRoom);setLocateRequest(value=>value+1)}}>{language==='zh'?'定位':'Locate'}</button>}{target&&onMemberInteract&&!privateAction(target)&&<button type="button" onClick={()=>onMemberInteract(target.id)}>{target.isHome===false?(language==='zh'?'回地图':'Map'):(language==='zh'?'交谈':'Talk')}</button>}</div>}</div><nav aria-label={language==='zh'?'定位住宅区域':'Focus a home area'}><button type="button" data-home-area="overview" className={!selected?'is-active':''} onClick={()=>{setTracking(false);setSelectedId('__home__')}} aria-pressed={!selected}>{language==='zh'?'全屋':'Overview'}</button>{homeRooms.map(room=><button type="button" data-home-area={room.kind} key={room.id} className={room.id===selected?.id?'is-active':''} onClick={()=>{setTracking(false);setSelectedId(room.id)}} aria-pressed={room.id===selected?.id}>{roomName(room,language)}</button>)}</nav></div>
 </section>
 </>
}

export default HouseholdInteriorPreview
