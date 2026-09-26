import {useMemo,useRef,useState,type RefObject} from 'react'
import {useFrame,useLoader} from '@react-three/fiber'
import {Html} from '@react-three/drei'
import {FileLoader,Group,Quaternion,Vector3} from 'three'
import type {AvatarConfig,LifeStoryBeat,LifeStoryParticipant,SharedDrinkStaging} from '../../types'
import type {WorldLayoutInteriorPlacement} from '../../worldLayout'
import {Character3D} from './Character3D'
import './CharacterLabels.css'
import {getCharacterFamily} from './characterAssets'
import type {Character3DProps} from './types'
import type {SocialPerformance} from './socialPerformance'
import {sampleDrinkPerformance,type DrinkPose} from './sharedDrinkPerformance'
import {drinkHandArc,drinkLeanLimit,drinkReleaseTarget,planDrinkExit,sampleDrinkPlacement,sampleDrinkUpperBody,type DrinkDeparture} from './sharedDrinkChoreography'
import {DRINK_CUP_RIM,drinkCupRotation,drinkHandOffset,drinkSipCupCenter,measureDrinkMouth,type DrinkMouthAnchor} from './sharedDrinkContact'
import {resolveSharedDrinkLayout,type SharedDrinkLayout,type SharedDrinkSeat,type DrinkPoint} from '../interiors/sharedDrinkLayout'

type Pose=NonNullable<Character3DProps['lifePerformancePose']>
type Playback={speed:number;time?:number}
type ActorFrame={pose:DrinkPose;cupPosition:Vector3;handOffset:Vector3;elapsed:number;tilt:number;phase:SharedDrinkStaging['phase'];visualPhase:SharedDrinkStaging['phase'];mouth?:Vector3;mouthAnchor?:DrinkMouthAnchor;gripOffset?:Quaternion;timeOffset:number;seatedClockOffset:number;finishSitting?:boolean;departure?:DrinkDeparture}

function DrinkDriver({root,pose,social,playback,frame,staging,seat,cupRest,index,initiator,reduced,onBeat,family,speaking,listening,previewTime}:{root:RefObject<Group|null>;pose:Pose;social:SocialPerformance;playback:Playback;frame:ActorFrame;staging:SharedDrinkStaging;seat:SharedDrinkSeat;cupRest:DrinkPoint;index:number;initiator:boolean;reduced:boolean;onBeat:(pose:DrinkPose)=>void;family:'city'|'chibi';speaking:boolean;listening:boolean;previewTime?:number}){
 const previous=useRef(''),reachStart=useRef(new Vector3())
 const calibrateMouth=useMemo(()=>()=>{
  // The life mixer calls this on its authored base pose, before procedural
  // leaning/look-down. A replay opened at "reach" must not calibrate a forehead.
  if(root.current&&!frame.mouthAnchor&&frame.pose.seated&&frame.pose.beat!=='sit')frame.mouthAnchor=measureDrinkMouth(root.current,family)
 },[family,frame,root])
 useFrame((_,delta)=>{
  if(!root.current?.getObjectByName(family==='city'?'Hips':'DEF-spine'))return
  if(frame.phase!==staging.phase){
   if(staging.phase==='completed'||staging.phase==='interrupted'){
    const exit=planDrinkExit(frame.pose,root.current.position.toArray(),root.current.rotation.y)
    frame.finishSitting=exit.finishSitting;frame.departure=exit.departure
    if(!exit.finishSitting){
     frame.visualPhase='completed';frame.timeOffset=exit.offset+(index?.65:0);frame.elapsed=0
     frame.seatedClockOffset=pose.time-exit.offset
    }
   }else{frame.visualPhase=staging.phase;frame.timeOffset=0;frame.elapsed=0;frame.seatedClockOffset=0;frame.departure=undefined;frame.finishSitting=false}
   frame.phase=staging.phase;previous.current=''
  }
  frame.elapsed=previewTime??frame.elapsed+(reduced?0:Math.min(delta,.1))
  let next=sampleDrinkPerformance(frame.visualPhase,frame.elapsed+frame.timeOffset,index,initiator,reduced)
  if(frame.finishSitting&&next.beat!=='sit'){
   frame.finishSitting=false;frame.visualPhase='completed';frame.elapsed=0;frame.timeOffset=1.9+(index?.65:0)
   next=sampleDrinkPerformance('completed',frame.timeOffset,index,initiator,reduced)
  }
  const placement=sampleDrinkPlacement(next,seat,frame.visualPhase,initiator,frame.departure),body=sampleDrinkUpperBody(next,drinkLeanLimit(family))
  const position=placement.position
  root.current.position.set(...position)
  root.current.rotation.y=placement.rotation
  root.current.updateWorldMatrix(true,true)
  // Phase comes from distance, not a wall-clock walk playing under a sliding
  // root. In-place source cycles are calibrated for the actual encounter size.
  const stride=family==='city'?1.58:.66,cycle=family==='city'?1:.7916666865
  playback.speed=placement.walkSpeed/stride*cycle
  // Hold the last sampled walk while React hands playback to the life rig.
  // Clearing this clock lets the old mixer advance for a frame during handoff.
  if(placement.walking)playback.time=placement.walkDistance/stride*cycle
  const hand=root.current.getObjectByName(family==='city'?'HandR':'DEF-handR')
  const changed=previous.current!==next.beat
  if(changed){previous.current=next.beat;hand?.getWorldPosition(reachStart.current);if(next.beat==='reach')frame.gripOffset=undefined;onBeat(next)}
  frame.pose=next
  pose.onBasePose=calibrateMouth
  pose.time=Math.max(0,next.motionTime+(next.motion==='Sit_Chair_Idle'?frame.seatedClockOffset:0))
  pose.motion=next.motion
  pose.standingTurn=placement.standingTurn?{...placement.standingTurn,root:root.current,key:`${frame.visualPhase}:${next.beat}`}:undefined
  social.enabled=!reduced&&['listen','invite','wait'].includes(next.beat)
  social.speaking=speaking;social.listening=listening;social.seated=next.seated
  pose.seatHeight=next.seated?seat.seatTopY:undefined
  pose.seatWeight=next.beat==='sit'?next.progress:next.beat==='stand'?1-next.progress:1
  pose.bodyLean=body.lean
  pose.handWeight=body.handWeight
  pose.headYaw=placement.lookYaw
  pose.headPitch=body.headPitch
  const rest=new Vector3(...cupRest);rest.y+=DRINK_CUP_RIM.height+.0015
  const grip=rest.clone()
  // The handle is on the character's right, not embedded through the palm.
  frame.handOffset.copy(drinkHandOffset(seat.rotation))
  grip.add(frame.handOffset)
  const head=root.current.getObjectByName(family==='city'?'Head':'DEF-spine006')
  if(frame.mouthAnchor?.head!==head)frame.mouthAnchor=undefined
  frame.tilt=next.beat==='sip'?-.12*Math.sin(next.progress*Math.PI):0
  frame.mouth=frame.mouthAnchor?.head.localToWorld(frame.mouthAnchor.point.clone())
  const mouth=frame.mouthAnchor?drinkSipCupCenter(frame.mouthAnchor,frame.handOffset,frame.tilt).add(frame.handOffset):grip
  if(next.beat==='reach')pose.handTarget=drinkHandArc(reachStart.current.toArray(),grip.toArray(),next.progress)
  else if(next.cup==='hand')pose.handTarget=drinkHandArc(grip.toArray(),mouth.toArray(),next.handProgress,index?-.025:.025)
  else if(next.beat==='release'){
   // The handle points diagonally back; extending that vector takes the arm
   // behind its shoulder and can flip a short Chibi elbow during release.
   pose.handTarget=drinkHandArc(grip.toArray(),drinkReleaseTarget(position,seat),next.progress)
  }else pose.handTarget=undefined
  pose.handQuaternion=frame.gripOffset&&next.cup==='hand'?drinkCupRotation(frame.handOffset,frame.tilt).multiply(frame.gripOffset).toArray():undefined
  pose.handWristWeight=next.cup==='hand'?body.handWeight:0
  frame.cupPosition.copy(rest)
  root.current.userData.drink={beat:next.beat,elapsed:frame.elapsed,motionTime:pose.time,walkSpeed:placement.walkSpeed,walkDistance:placement.walkDistance,handWeight:body.handWeight}
 },-3)
 return null
}

function PhysicalCup({actor,frame,color,beverage}:{actor:RefObject<Group|null>;frame:ActorFrame;color:string;beverage:SharedDrinkStaging['beverage']}){
 const root=useRef<Group>(null)
 useFrame(()=>{
  if(!root.current)return
  const hand=actor.current?.getObjectByName('HandR')??actor.current?.getObjectByName('DEF-handR')
  const world=frame.cupPosition.clone()
  if(frame.pose.cup==='hand'&&hand)hand.getWorldPosition(world).sub(frame.handOffset)
  if(frame.pose.cup==='hand'&&hand&&!frame.gripOffset)frame.gripOffset=drinkCupRotation(frame.handOffset,frame.tilt).invert().multiply(hand.getWorldQuaternion(new Quaternion()))
  root.current.parent?.worldToLocal(world)
  root.current.position.copy(world)
  root.current.quaternion.copy(drinkCupRotation(frame.handOffset,frame.tilt))
  root.current.userData.beat=frame.pose.beat
  root.current.userData.mouthSurface=frame.mouthAnchor?.head.localToWorld(frame.mouthAnchor.point.clone()).toArray()
 },-1)
 return <group ref={root} name="shared-drink-physical-cup">
  <mesh castShadow receiveShadow><cylinderGeometry args={[DRINK_CUP_RIM.radius,.06,DRINK_CUP_RIM.height*2,20,1,true]}/><meshStandardMaterial color={color} roughness={.55} side={2}/></mesh>
  <mesh position={[0,.055,0]}><cylinderGeometry args={[.066,.066,.006,20]}/><meshStandardMaterial color={beverage==='coffee'?'#583a2c':beverage==='tea'?'#ab783e':'#93c5c4'} roughness={.3}/></mesh>
  <mesh position={[.086,0,0]}><torusGeometry args={[.039,.012,8,20]}/><meshStandardMaterial color={color} roughness={.55}/></mesh>
 </group>
}

function DrinkActor({participant,avatar,staging,index,layout,activeBeat,reducedMotion,previewTime}:{participant:LifeStoryParticipant;avatar:AvatarConfig;staging:SharedDrinkStaging;index:number;layout:SharedDrinkLayout;activeBeat?:LifeStoryBeat;reducedMotion:boolean;previewTime?:number}){
 const root=useRef<Group>(null),family=getCharacterFamily(avatar),seat=layout.seats[index]
 const initiator=participant.id===staging.initiator_id
 const [sample,setSample]=useState(()=>sampleDrinkPerformance(staging.phase,0,index,initiator,reducedMotion))
 const pose=useMemo<Pose>(()=>({time:0}),[]),playback=useMemo<Playback>(()=>({speed:0}),[])
 const social=useMemo<SocialPerformance>(()=>({speaking:false,enabled:false}),[])
 const frameRef=useRef<ActorFrame|null>(null)
 if(!frameRef.current)frameRef.current={pose:sampleDrinkPerformance(staging.phase,0,index,initiator,reducedMotion),cupPosition:new Vector3(),handOffset:new Vector3(),elapsed:0,tilt:0,phase:staging.phase,visualPhase:staging.phase,timeOffset:0,seatedClockOffset:0}
 const frame=frameRef.current
 const speaking=activeBeat?.speaker_id===participant.id
 const motion=sample.motion
 const expressing=speaking&&!reducedMotion&&['listen','invite','wait'].includes(sample.beat)
 const initial=sampleDrinkPlacement(sample,seat,staging.phase,initiator)
 return <>
  <DrinkDriver root={root} pose={pose} social={social} playback={playback} frame={frame} staging={staging} seat={seat} cupRest={layout.cupRest[index]} index={index} initiator={initiator} reduced={reducedMotion} onBeat={setSample} family={family} speaking={speaking} listening={Boolean(activeBeat&&!speaking)} previewTime={previewTime}/>
  <group ref={root} name={`drink-resident:${participant.id}`} position={initial.position} rotation={[0,initial.rotation,0]}>
   <Character3D avatar={avatar} name={participant.name} seed={participant.id} scale={family==='city'?.56:.76}
    animation={sample.beat==='approach'||sample.beat==='leave'?'walk':speaking?'talk':'listen'}
    animationClip={sample.beat==='approach'||sample.beat==='leave'?(family==='city'?'Walk_B':'anim_walk'):undefined} animationPlayback={playback}
    lifeMotion={motion} lifePerformancePose={motion?pose:undefined} socialPerformance={social} animationPaused={reducedMotion} motionScale={0}
    lifeAttention={sample.seated?(index?-.12:.12):0} faceSpeaking={expressing}
    faceAttention={index?-.2:.2} faceExpression={sample.beat==='decline'&&initiator?'curious':activeBeat?.emotion==='happy'?'happy':'neutral'}/>
   <Html center position={[0,.1,.3]} zIndexRange={[6,3]}><span className={`encounter-resident-name${expressing?' is-speaking':''}`}>{participant.name}</span></Html>
  </group>
  <PhysicalCup actor={root} frame={frame} color={index?'#d89870':'#81a79b'} beverage={staging.beverage}/>
 </>
}

export type SharedDrinkPerformance3DProps={staging:SharedDrinkStaging;participants:LifeStoryParticipant[];participantAvatars:Record<string,AvatarConfig>;activeBeat?:LifeStoryBeat;reducedMotion?:boolean;placements?:readonly WorldLayoutInteriorPlacement[];layoutOverride?:SharedDrinkLayout;previewTime?:number}
/** Render inside the actual home coordinate space; the parent owns lights and camera. */
export function SharedDrinkPerformance3D({staging,participants,participantAvatars,activeBeat,reducedMotion=false,placements,layoutOverride,previewTime}:SharedDrinkPerformance3DProps){
 // The first walk→life transition is only 400ms. Loading the life library at
 // that transition used to spend most of the turn in the native fallback,
 // rotating both feet before the contact controller even existed. Warm it
 // before mounting the performance clock; models must also exist to advance.
 useLoader(FileLoader,'/assets/life/motions/kaykit-life.json')
 const layout=useMemo(()=>layoutOverride??resolveSharedDrinkLayout(placements),[layoutOverride,placements])
 const sampleTime=import.meta.env.DEV&&Number.isFinite(previewTime)?Math.max(0,Math.min(120,previewTime!)):undefined
 if(!layout.usable)return null
 return <group name={`shared-drink-performance:${staging.phase}`}>
  {staging.participant_ids.map((id,index)=>{
   const participant=participants.find(person=>person.id===id),avatar=participantAvatars[id]
   return participant&&avatar?<DrinkActor key={id} participant={participant} avatar={avatar} staging={staging} index={index} layout={layout} activeBeat={activeBeat} reducedMotion={reducedMotion} previewTime={sampleTime}/>:null
  })}
 </group>
}
