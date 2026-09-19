import {useEffect,useRef,useState} from 'react'
import {useFrame} from '@react-three/fiber'
import {Html} from '@react-three/drei'
import {Group,Vector3} from 'three'
import {Character3D} from '../three/characters/Character3D'
import {getCharacterFamily} from '../three/characters/characterAssets'
import type {HouseholdResidentVisual} from './householdVisuals'
import type {SharedHomeResolvedAnchor} from '../three/interiors/sharedHomeLayout'
import {householdBeat,residentSeed,seatedAction} from '../life/householdChoreography'
import type {LifeLanguage} from '../life/lifeActionCatalog'
import {indoorWalkPath} from '../three/interiors/indoorNavigation'
import type {WorldLayoutInteriorPlacement} from '../worldLayout'
import {sharedHomeRoomForKind} from '../three/interiors/sharedHomeLayout'
import {deriveResidentExpression} from '../life/characterExpression'

export function HouseholdLifeResident({resident,anchor,language,reducedMotion,partner,roomKind,placements=[],selected=false}:{selected?:boolean;resident:HouseholdResidentVisual;anchor:SharedHomeResolvedAnchor;language:LifeLanguage;reducedMotion:boolean;partner?:SharedHomeResolvedAnchor;roomKind:string;placements?:readonly WorldLayoutInteriorPlacement[]}){
 const root=useRef<Group>(null),elapsed=useRef(0)
 const origin=useRef(anchor.position),route=useRef<[number,number,number][]>([]),previousAnchor=useRef(anchor.position.join(':'))
 const [moving,setMoving]=useState(false)
 const [standingUp,setStandingUp]=useState(false)
 const [seconds,setSeconds]=useState(0)
 const action=resident.currentAction?.source==='life'?resident.currentAction:undefined
 const active=action?.status==='performing'
 const jointLabel=active&&action.targetNpcId&&['read','practice_hobby'].includes(action.type)
  ?(language==='zh'?action.raw.visible_intent_zh:action.raw.visible_intent):undefined
 const expression=deriveResidentExpression({npcId:resident.id,action:resident.currentAction,animationCue:resident.animationCue,observableState:resident.observableState})
 const seated=active&&seatedAction(action?.type)&&/eat|read|tv|rest|seat|sofa/.test(anchor.id)
 const wasSeated=useRef(seated)
 const previousSeat=useRef(anchor.id)
 const seed=residentSeed(resident.id)
 useEffect(()=>{elapsed.current=0;setSeconds(0);setStandingUp(wasSeated.current&&(!seated||previousSeat.current!==anchor.id)&&!reducedMotion);wasSeated.current=seated;previousSeat.current=anchor.id},[action?.id,anchor.id,seated,reducedMotion])
 useEffect(()=>{
  const fingerprint=anchor.position.join(':')
  if(previousAnchor.current===fingerprint||!root.current)return
  previousAnchor.current=fingerprint
  route.current=indoorWalkPath(root.current.position.toArray(),anchor.position,roomKind,placements)
  setMoving(route.current.length>0)
 },[anchor.position,roomKind,placements])
 useEffect(()=>{
  if(!reducedMotion||!route.current.length||!root.current)return
  root.current.position.set(...route.current.at(-1)!)
  route.current=[];setMoving(false);setStandingUp(false)
 },[reducedMotion,moving])
 useFrame((_,delta)=>{
  const group=root.current;if(!group)return
  if(!reducedMotion){elapsed.current+=Math.min(delta,.1);if(Math.floor(elapsed.current)!==seconds)setSeconds(Math.floor(elapsed.current))}
  const next=route.current[0],target=new Vector3(...(next??anchor.position))
  let look=anchor.rotation
  if(standingUp&&elapsed.current>=1.8)setStandingUp(false)
  if(next&&!standingUp){
   const direction=target.clone().sub(group.position),distance=direction.length()
   look=Math.atan2(direction.x,direction.z)
   if(distance<.06){route.current.shift();if(!route.current.length){setMoving(false);elapsed.current=0;setSeconds(0)}}
   else group.position.addScaledVector(direction.normalize(),Math.min(distance,Math.min(delta,.05)*.65))
  }
  const difference=Math.atan2(Math.sin(look-group.rotation.y),Math.cos(look-group.rotation.y))
  group.rotation.y+=difference*(reducedMotion?1:1-Math.exp(-delta*4))
 })
 const beat=active?householdBeat(action?.type,seconds,seed):undefined
 const unseatedMotion=seatedAction(action?.type)&&!seated?(action?.type==='read'?'Holding_B':action?.type==='eat'?'Use_Item':'Idle_A'):beat?.motion
 const motion=standingUp?'Sit_Chair_StandUp':moving?undefined:reducedMotion?(seated?'Sit_Chair_Idle':'Idle_A'):seated&&seconds<2?'Sit_Chair_Down':unseatedMotion
 const scale=getCharacterFamily(resident.avatar)==='chibi'?.76:.56
 const attention=partner?Math.atan2(partner.position[0]-anchor.position[0],partner.position[2]-anchor.position[2])-anchor.rotation:0
 const fixtureId=action?.type==='prepare_food'?'kitchen-stove':action?.type==='leave_dishes'||(action?.type==='clean_shared_space'&&roomKind==='kitchen')?'kitchen-sink':undefined
 const original=sharedHomeRoomForKind(roomKind).placements.find(item=>item.id===fixtureId)
 const authored=placements.find(item=>item.id===fixtureId)
 const fixtureAngle=authored?.rotation.y??original?.rotation??0
 const fixtureHeight=original?(authored?.scale.y??original.scale[1])/original.scale[1]:1
 const contact:[number,number,number]|undefined=!moving&&active&&original?[
  ((authored?.position.x??original.position[0])+Math.sin(fixtureAngle)*.4)*.99,
  -.08+((authored?.position.y??original.position[1])+.82*fixtureHeight)*.99,
  .05+((authored?.position.z??original.position[2])+Math.cos(fixtureAngle)*.4)*.99,
 ]:undefined
 return <group ref={root} position={origin.current} name={`household-resident:${resident.id}`}>
  {selected&&<mesh rotation={[-Math.PI/2,0,0]} position={[0,.035,0]} name="household-focus-ring"><ringGeometry args={[.34,.4,48]}/><meshBasicMaterial color="#e9aa4d" transparent opacity={.9} depthWrite={false}/></mesh>}
  <Character3D avatar={resident.avatar} name={resident.name} seed={resident.id} scale={scale}
   animation={moving?'walk':expression.motion} lifeMotion={motion} lifeAttention={partner&&seconds%14<5?Math.max(-.45,Math.min(.45,Math.atan2(Math.sin(attention),Math.cos(attention)))):0}
   lifeProp={!moving&&seconds>=2?beat?.prop:undefined} lifeHandTarget={contact} animationPaused={reducedMotion} motionScale={.2}/>
  <Html center position={[0,1.8,0]} zIndexRange={[8,5]}>
   <div className={`household-life-label${selected?' is-selected':''}`}><b>{resident.name}</b><span>{moving?(language==='zh'?'走到那边去':'Heading over'):active?(seconds<2&&seated?(language==='zh'?'先坐下来':'Taking a seat'):jointLabel??beat?.label[language]??(language==='zh'?'忙着自己的事':'Going about the day')):language==='zh'?'稍等片刻':'Taking a moment'}</span></div>
  </Html>
 </group>
}
