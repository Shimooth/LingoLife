import {Suspense,useMemo,useRef,useState} from 'react'
import {Canvas,useFrame,useLoader,useThree} from '@react-three/fiber'
import {PerspectiveCamera} from '@react-three/drei'
import {FileLoader,Group,MathUtils,Vector3} from 'three'
import type {NpcProfile} from '../types'
import type {ArrivalFood} from './types'
import {Character3D} from '../three/characters/Character3D'
import {getCharacterFamily} from '../three/characters/characterAssets'
import type {Character3DProps} from '../three/characters/types'
import {measureDrinkMouth,type DrinkMouthAnchor} from '../three/characters/sharedDrinkContact'
import {SceneLook} from '../three/rendering/SceneLook'
import {ArrivalRoom3D,ArrivalRoomLighting} from './ArrivalRoom3D'

type Mode='welcome'|'idle'|'feeding'|'happy'|'disliked'|'neutral_result'
type Pose=NonNullable<Character3DProps['lifePerformancePose']>
export type ArrivalWelcomePhase='arriving'|'greeting'|'settled'
export type ArrivalPerformance3DProps={profile:NpcProfile;mode:Mode;performanceKey:string;food?:ArrivalFood;reduced:boolean;onReady:()=>void;onBite:(bite:number)=>void;onFinished:()=>void;onWelcomePhase?:(phase:ArrivalWelcomePhase)=>void}
type WelcomeBeat='arriving'|'stopping'|'greeting'|'settled'
const WALK_START=.3,WALK_END=3.35,GREETING_START=4.08,GREETING_END=6.3
const start=new Vector3(.48,0,-2.7),destination=new Vector3(0,0,.2)
const walkLength=start.distanceTo(destination),walkYaw=Math.atan2(destination.x-start.x,destination.z-start.z)
const welcomeYaw=.105

function ArrivalActor({profile,mode,food,reduced,onReady,onBite,onFinished,onWelcomePhase}:Omit<ArrivalPerformance3DProps,'performanceKey'>){
 // Load the motion library before starting this performance's clock.
 useLoader(FileLoader,'/assets/life/motions/kaykit-life.json')
 const actor=useRef<Group>(null),prop=useRef<Group>(null)
 const family=getCharacterFamily(profile.avatar)
 const [welcomeBeat,setWelcomeBeat]=useState<WelcomeBeat>(mode==='welcome'&&!reduced?'arriving':'settled')
 const entering=mode==='welcome'&&welcomeBeat==='arriving'&&!reduced
 const phase=useRef<ArrivalWelcomePhase|undefined>(undefined)
 const playback=useMemo(()=>({speed:0,time:0}),[])
 const elapsed=useRef(0),ready=useRef(false),finished=useRef(false),bite=useRef(0)
 const mouth=useRef<DrinkMouthAnchor|undefined>(undefined),rest=useRef<Vector3|undefined>(undefined)
 const pose=useMemo<Pose>(()=>({time:0,motion:'Idle_A'}),[])
 const {camera,size}=useThree()
 const calibration=useMemo(()=>()=>{
  if(!actor.current)return
  if(!mouth.current)mouth.current=measureDrinkMouth(actor.current,family)
  if(!rest.current){
   const hand=actor.current.getObjectByName(family==='city'?'HandR':'DEF-handR')
   if(hand)rest.current=hand.getWorldPosition(new Vector3())
  }
 },[family])
 useFrame((_,delta)=>{
  const root=actor.current
  if(!root?.getObjectByName(family==='city'?'Hips':'DEF-spine'))return
  if(!ready.current){ready.current=true;onReady()}
  if(!document.hidden)elapsed.current+=reduced?0:Math.min(delta,.06)
  const time=elapsed.current
  let walkDistance=0
  if(mode==='welcome'){
   const next:WelcomeBeat=reduced?'settled':time<WALK_END?'arriving':time<GREETING_START?'stopping':time<GREETING_END?'greeting':'settled'
   if(next!==welcomeBeat)setWelcomeBeat(next)
   const publicPhase:ArrivalWelcomePhase=next==='stopping'?'arriving':next
   if(phase.current!==publicPhase){phase.current=publicPhase;onWelcomePhase?.(publicPhase)}
   const progress=reduced?1:MathUtils.smoothstep(time,WALK_START,WALK_END)
   walkDistance=progress*walkLength
   root.position.copy(start).lerp(destination,progress)
   root.rotation.y=next==='arriving'?walkYaw:MathUtils.lerp(walkYaw,welcomeYaw,reduced?1:MathUtils.smoothstep(time,WALK_END,GREETING_START))
   // Match the source gait to travelled metres at this portrait's actual scale.
   const stride=family==='city'?1.58*(.73/.56):.66*(.95/.76),cycle=family==='city'?1:.7916666865
   playback.time=walkDistance/stride*cycle
   pose.motion=next==='greeting'?'Waving':'Idle_A'
   pose.time=reduced?0:next==='greeting'?Math.min(2.133333,time-GREETING_START):next==='settled'?Math.max(0,time-GREETING_END):0
   pose.standingTurn=next==='stopping'?{root,key:'arrival-stop',startYaw:walkYaw,endYaw:welcomeYaw,progress:MathUtils.clamp((time-WALK_END)/(GREETING_START-WALK_END),0,1)}:undefined
   pose.headPitch=next==='stopping'?-.035*Math.sin(MathUtils.smoothstep(time,WALK_END,GREETING_START)*Math.PI):0
  }else{pose.time=0;pose.motion='Idle_A'}
  pose.onBasePose=calibration
  const reveal=mode==='welcome'&&!reduced?MathUtils.smoothstep(time,.2,6.8):1
  const aspect=Math.max(.4,size.width/size.height),distance=Math.max(MathUtils.lerp(8.45,7.65,reveal),2.65/aspect)
  const welcome=mode==='welcome',portrait=MathUtils.smoothstep(.95-aspect,0,.4)
  const targetHeight=welcome?MathUtils.lerp(1.08,.58,portrait):1.31
  camera.position.set(welcome?MathUtils.lerp(1.9,.8,reveal):.18,MathUtils.lerp(2.55,2.05,reveal),distance)
  camera.lookAt(0,MathUtils.lerp(1.18,targetHeight,reveal),MathUtils.lerp(-.6,0,reveal))
  root.userData.arrival={time,bite:bite.current,welcomePhase:phase.current,welcomeBeat,walkDistance,walkTime:playback.time}
  if(mode==='feeding'&&mouth.current&&rest.current){
   const cycle=Math.min(2,Math.floor(time/2)),progress=(time-cycle*2)/2
   const reach=Math.sin(Math.min(1,progress)*Math.PI)
   const target=mouth.current.head.localToWorld(mouth.current.point.clone())
   // Palm stays in front of and just below the measured visible mouth.
   target.add(new Vector3(-.035,-.065,.12))
   pose.handTarget=rest.current.clone().lerp(target,MathUtils.smoothstep(reach,0,1)).toArray()
   pose.handWeight=Math.min(1,time*4)
   pose.headPitch=-.035*reach
   const nextBite=Math.min(3,Math.floor((time+1)/2))
   if(nextBite!==bite.current){bite.current=nextBite;onBite(nextBite)}
   root.userData.arrival={...root.userData.arrival,bite:nextBite,handTarget:pose.handTarget}
   if(time>=6.25&&!finished.current){finished.current=true;onFinished()}
  }
 },-3)
 useFrame(()=>{
  if(!prop.current)return
  const hand=actor.current?.getObjectByName(family==='city'?'HandR':'DEF-handR')
  prop.current.visible=Boolean(hand)&&bite.current<3
  if(hand){
   const point=hand.getWorldPosition(new Vector3()).add(new Vector3(0,.065,.045))
   prop.current.position.copy(point)
   prop.current.scale.setScalar([1,.72,.43,0][bite.current])
  }
 },-1)
 return <>
  <group ref={actor} name="arrival-resident" position={mode==='welcome'&&!reduced?start.toArray():[0,0,mode==='welcome'?.2:0]}>
   <Character3D avatar={profile.avatar} name={profile.name} seed="arrival-resident" scale={family==='city'?.73:.95}
    animation={entering?'walk':mode==='happy'?'happy':mode==='disliked'?'sad':'idle'} animationClip={entering?(family==='city'?'Walk_B':'anim_walk'):undefined} animationPlayback={entering?playback:undefined} animationTransitionMs={entering?150:300}
    lifeMotion={mode==='happy'||mode==='disliked'||entering?undefined:mode==='welcome'&&welcomeBeat==='greeting'?'Waving':'Idle_A'}
    lifePerformancePose={mode==='happy'||mode==='disliked'||entering?undefined:pose} animationPaused={reduced} motionScale={0}
    faceExpression={mode==='happy'||mode==='welcome'?'happy':mode==='disliked'?'displeased':mode==='feeding'?'curious':'neutral'}/>
  </group>
  {mode==='feeding'&&<group ref={prop} name="arrival-food-in-hand">
   {food?.id==='toast'?<group rotation={[.1,0,.15]}>
    <mesh castShadow><boxGeometry args={[.2,.22,.065]}/><meshStandardMaterial color="#ba7841" roughness={.9}/></mesh>
    <mesh position={[0,0,.035]}><boxGeometry args={[.166,.181,.01]}/><meshStandardMaterial color="#f0d795" roughness={1}/></mesh>
    <mesh position={[.015,.01,.044]} rotation={[0,0,.3]}><boxGeometry args={[.06,.046,.015]}/><meshStandardMaterial color="#edbc4e"/></mesh>
   </group>:food?.id==='rice'?<group>
    <mesh castShadow><cylinderGeometry args={[.13,.07,.095,16]}/><meshStandardMaterial color="#719b94" roughness={.6}/></mesh>
    <mesh position={[0,.047,0]}><sphereGeometry args={[.117,16,10,0,Math.PI*2,0,Math.PI/2]}/><meshStandardMaterial color="#fff3dc" roughness={1}/></mesh>
    <mesh position={[.015,.142,0]} scale={[1,.35,1]}><sphereGeometry args={[.027,10,6]}/><meshStandardMaterial color="#b97557"/></mesh>
   </group>:<group>
    <mesh castShadow position={[0,-.045,0]}><cylinderGeometry args={[.155,.145,.025,18]}/><meshStandardMaterial color="#f5eee0"/></mesh>
    <mesh castShadow position={[0,.015,0]}><cylinderGeometry args={[.078,.115,.105,18]}/><meshStandardMaterial color="#f0cc70" roughness={.5}/></mesh>
    <mesh position={[0,.07,0]}><cylinderGeometry args={[.08,.078,.014,18]}/><meshStandardMaterial color="#a86837" roughness={.35}/></mesh>
   </group>}
  </group>}
 </>
}

export function ArrivalPerformance3D(props:ArrivalPerformance3DProps){
 return <Canvas shadows="percentage" dpr={[1,1.5]} gl={{antialias:true,alpha:false}} aria-label={`${props.profile.name} ${props.mode==='feeding'?'eating':'at home'}`}>
  <color attach="background" args={['#eee4cf']}/>
  <PerspectiveCamera makeDefault position={[1.9,2.55,8.45]} fov={35} near={.1} far={50}/>
  <SceneLook exposure={1.02}/><ArrivalRoomLighting/>
  <ArrivalRoom3D/>
  <Suspense fallback={null}><ArrivalActor key={props.performanceKey} {...props}/></Suspense>
 </Canvas>
}
