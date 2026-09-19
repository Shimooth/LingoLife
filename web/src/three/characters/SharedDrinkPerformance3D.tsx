import {useMemo,useRef,useState,type RefObject} from 'react'
import {useFrame} from '@react-three/fiber'
import {Html} from '@react-three/drei'
import {Group,Vector3} from 'three'
import type {AvatarConfig,LifeStoryBeat,LifeStoryParticipant,SharedDrinkStaging} from '../../types'
import type {WorldLayoutInteriorPlacement} from '../../worldLayout'
import {Character3D} from './Character3D'
import './CharacterLabels.css'
import {getCharacterFamily} from './characterAssets'
import type {Character3DProps} from './types'
import {sampleDrinkPerformance,type DrinkPose} from './sharedDrinkPerformance'
import {resolveSharedDrinkLayout,type SharedDrinkLayout,type SharedDrinkSeat,type DrinkPoint} from '../interiors/sharedDrinkLayout'

type Pose=NonNullable<Character3DProps['lifePerformancePose']>
type ActorFrame={pose:DrinkPose;cupPosition:Vector3;handOffset:Vector3;elapsed:number}
const mix=(a:DrinkPoint,b:DrinkPoint,t:number):DrinkPoint=>a.map((v,i)=>v+(b[i]-v)*t) as DrinkPoint
const forward=(seat:SharedDrinkSeat,distance:number):DrinkPoint=>[seat.position[0]+Math.sin(seat.rotation)*distance,seat.position[1],seat.position[2]+Math.cos(seat.rotation)*distance]

function DrinkDriver({root,pose,frame,staging,seat,cupRest,index,initiator,reduced,onBeat,family,speaking,previewTime}:{root:RefObject<Group|null>;pose:Pose;frame:ActorFrame;staging:SharedDrinkStaging;seat:SharedDrinkSeat;cupRest:DrinkPoint;index:number;initiator:boolean;reduced:boolean;onBeat:(pose:DrinkPose)=>void;family:'city'|'chibi';speaking:boolean;previewTime?:number}){
 const previous=useRef(''),reachStart=useRef(new Vector3())
 useFrame((_,delta)=>{
  if(!root.current)return
  frame.elapsed=previewTime??frame.elapsed+(reduced?0:Math.min(delta,.05))
  const next=sampleDrinkPerformance(staging.phase,frame.elapsed,index,initiator,reduced)
  const front=forward(seat,.24)
  let position=next.beat==='approach'?mix(seat.approach,front,next.progress):next.beat==='sit'?mix(front,seat.position,next.progress):next.seated?seat.position:seat.approach
  const leaving=next.beat==='leave'||next.beat==='finished'&&(['completed','interrupted'].includes(staging.phase)||staging.phase==='declined'&&!initiator)
  const departure=staging.phase==='declined'?seat.approach:seat.position
  if(leaving)position=mix(departure,seat.exit,next.beat==='finished'?1:next.progress)
  const direction=next.beat==='approach'?new Vector3(...front).sub(new Vector3(...seat.approach)):new Vector3(...seat.exit).sub(new Vector3(...departure))
  let rotation=next.beat==='approach'||leaving?Math.atan2(direction.x,direction.z):seat.rotation
  if(next.beat==='decline'&&!initiator)rotation+=Math.sin(next.progress*Math.PI*3)*.11
  if(next.beat==='wait')rotation+=Math.sin(frame.elapsed*.6+index)*.025
  root.current.position.set(...position)
  const difference=Math.atan2(Math.sin(rotation-root.current.rotation.y),Math.cos(rotation-root.current.rotation.y))
  root.current.rotation.y+=difference*(reduced?1:1-Math.exp(-delta*9))
  root.current.updateWorldMatrix(true,true)
  const hand=root.current.getObjectByName(family==='city'?'HandR':'DEF-handR')
  const changed=previous.current!==next.beat
  if(changed){previous.current=next.beat;hand?.getWorldPosition(reachStart.current);onBeat(next)}
  frame.pose=next
  pose.time=next.motionTime
  if(next.beat==='listen'&&speaking)pose.time=frame.elapsed%1.3
  pose.seatHeight=next.seated?seat.seatTopY:undefined
  pose.seatWeight=next.beat==='sit'?next.progress:next.beat==='stand'?1-next.progress:1
  pose.bodyLean=next.beat==='reach'?.65*next.progress:next.beat==='lift'?.65*(1-next.progress):next.beat==='lower'?.65*next.progress:next.beat==='release'?.65*(1-next.progress):0
  const rest=new Vector3(...cupRest);rest.y+=.054
  const grip=rest.clone()
  // The handle is on the character's right, not embedded through the palm.
  frame.handOffset.set(-Math.cos(seat.rotation)*.067,0,Math.sin(seat.rotation)*.067)
  grip.add(frame.handOffset)
  const head=root.current.getObjectByName(family==='city'?'Head':'DEF-spine006')
  const mouth=head?head.getWorldPosition(new Vector3()):new Vector3(position[0],seat.seatTopY+.72,position[2])
  mouth.y+=family==='city'?.13:.2
  mouth.x+=Math.sin(seat.rotation)*.14;mouth.z+=Math.cos(seat.rotation)*.14
  mouth.add(frame.handOffset)
  if(next.beat==='reach')pose.handTarget=reachStart.current.clone().lerp(grip,next.progress).toArray()
  else if(next.cup==='hand')pose.handTarget=grip.clone().lerp(mouth,next.handProgress).toArray()
  else if(next.beat==='release'){
   const lower=new Vector3(position[0],seat.seatTopY+.24,position[2]).addScaledVector(frame.handOffset,4)
   pose.handTarget=grip.clone().lerp(lower,next.progress).toArray()
  }else pose.handTarget=undefined
  frame.cupPosition.copy(rest)
 })
 return null
}

function PhysicalCup({actor,frame,color,beverage}:{actor:RefObject<Group|null>;frame:ActorFrame;color:string;beverage:SharedDrinkStaging['beverage']}){
 const root=useRef<Group>(null)
 useFrame(()=>{
  if(!root.current)return
  const hand=actor.current?.getObjectByName('HandR')??actor.current?.getObjectByName('DEF-handR')
  const world=frame.cupPosition.clone()
  if(frame.pose.cup==='hand'&&hand)hand.getWorldPosition(world).sub(frame.handOffset)
  root.current.parent?.worldToLocal(world)
  root.current.position.copy(world)
  root.current.rotation.y=Math.atan2(-frame.handOffset.z,frame.handOffset.x)
  root.current.rotation.z=frame.pose.beat==='sip'?.14*Math.sin(frame.pose.progress*Math.PI):0
 })
 return <group ref={root} name="shared-drink-physical-cup">
  <mesh castShadow receiveShadow><cylinderGeometry args={[.052,.044,.105,20,1,true]}/><meshStandardMaterial color={color} roughness={.55} side={2}/></mesh>
  <mesh position={[0,.038,0]}><cylinderGeometry args={[.047,.047,.005,20]}/><meshStandardMaterial color={beverage==='coffee'?'#583a2c':beverage==='tea'?'#ab783e':'#93c5c4'} roughness={.3}/></mesh>
  <mesh position={[.061,0,0]}><torusGeometry args={[.029,.009,8,20]}/><meshStandardMaterial color={color} roughness={.55}/></mesh>
 </group>
}

function DrinkActor({participant,avatar,staging,index,layout,activeBeat,reducedMotion,previewTime}:{participant:LifeStoryParticipant;avatar:AvatarConfig;staging:SharedDrinkStaging;index:number;layout:SharedDrinkLayout;activeBeat?:LifeStoryBeat;reducedMotion:boolean;previewTime?:number}){
 const root=useRef<Group>(null),family=getCharacterFamily(avatar),seat=layout.seats[index]
 const initiator=participant.id===staging.initiator_id
 const [sample,setSample]=useState(()=>sampleDrinkPerformance(staging.phase,0,index,initiator,reducedMotion))
 const pose=useMemo<Pose>(()=>({time:0}),[])
 const frame=useMemo<ActorFrame>(()=>({pose:sampleDrinkPerformance(staging.phase,0,index,initiator,reducedMotion),cupPosition:new Vector3(),handOffset:new Vector3(),elapsed:0}),[index,initiator,staging.phase,reducedMotion])
 const speaking=activeBeat?.speaker_id===participant.id
 const motion=sample.beat==='listen'&&speaking?'Seated_Interact':sample.motion
 return <>
  <DrinkDriver root={root} pose={pose} frame={frame} staging={staging} seat={seat} cupRest={layout.cupRest[index]} index={index} initiator={initiator} reduced={reducedMotion} onBeat={setSample} family={family} speaking={speaking} previewTime={previewTime}/>
  <group ref={root} name={`drink-resident:${participant.id}`} position={sample.seated?seat.position:seat.approach} rotation={[0,seat.rotation,0]}>
   <Character3D avatar={avatar} name={participant.name} seed={participant.id} scale={family==='city'?.56:.76}
    animation={sample.beat==='approach'||sample.beat==='leave'?'walk':speaking?'talk':'listen'}
    lifeMotion={motion} lifePerformancePose={motion?pose:undefined} animationPaused={reducedMotion} motionScale={0}
    lifeAttention={sample.seated?(index?-.12:.12):0} faceSpeaking={speaking}
    faceAttention={index?-.2:.2} faceExpression={sample.beat==='decline'&&initiator?'curious':activeBeat?.emotion==='happy'?'happy':'neutral'}/>
   <Html center position={[0,.1,.3]} zIndexRange={[6,3]}><span className={`encounter-resident-name${speaking?' is-speaking':''}`}>{participant.name}</span></Html>
  </group>
  <PhysicalCup actor={root} frame={frame} color={index?'#d89870':'#81a79b'} beverage={staging.beverage}/>
 </>
}

export type SharedDrinkPerformance3DProps={staging:SharedDrinkStaging;participants:LifeStoryParticipant[];participantAvatars:Record<string,AvatarConfig>;activeBeat?:LifeStoryBeat;reducedMotion?:boolean;placements?:readonly WorldLayoutInteriorPlacement[];previewTime?:number}
/** Render inside the actual home coordinate space; the parent owns lights and camera. */
export function SharedDrinkPerformance3D({staging,participants,participantAvatars,activeBeat,reducedMotion=false,placements,previewTime}:SharedDrinkPerformance3DProps){
 const layout=useMemo(()=>resolveSharedDrinkLayout(placements),[placements])
 const sampleTime=import.meta.env.DEV&&Number.isFinite(previewTime)?Math.max(0,Math.min(120,previewTime!)):undefined
 if(!layout.usable)return null
 return <group name={`shared-drink-performance:${staging.phase}`}>
  {staging.participant_ids.map((id,index)=>{
   const participant=participants.find(person=>person.id===id),avatar=participantAvatars[id]
   return participant&&avatar?<DrinkActor key={`${id}:${staging.phase}`} participant={participant} avatar={avatar} staging={staging} index={index} layout={layout} activeBeat={activeBeat} reducedMotion={reducedMotion} previewTime={sampleTime}/>:null
  })}
 </group>
}
