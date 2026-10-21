import {useOwnedGeometry} from './useOwnedGeometry'
import {memo,useMemo,useRef} from 'react'
import {useFrame} from '@react-three/fiber'
import {Group,Quaternion,Shape,Vector3} from 'three'
import {RoundedBox} from '@react-three/drei'
import type {OriginalAppearance,OriginalMotion,OriginalEmotion,OriginalQuality} from '../spec'
import {createHead,headDimensions,mix,shade,bodyDimensions} from './geometry'
import {OriginalFace,type OriginalFacePose} from './OriginalFace'
import {OriginalHair} from './OriginalHair'
import {OriginalHand,OriginalShoe,OriginalTorso} from './OriginalWardrobe'
import {originalResidentPose} from './motion'
import {Orb,Seam} from './parts'

export type OriginalResidentProps={appearance:OriginalAppearance;motion?:OriginalMotion;emotion?:OriginalEmotion;time?:number|{current:number};paused?:boolean;quality?:OriginalQuality}
const down=new Vector3(0,-1,0)
function Limb({length,radius,color}:{length:number;radius:number;color:string}){return <mesh position={[0,-length/2,0]} castShadow receiveShadow><capsuleGeometry args={[radius,Math.max(.025,length-radius*.65),8,20]}/><meshStandardMaterial color={color} roughness={.88}/></mesh>}
const roundShape=(()=>{const shape=new Shape();shape.absarc(0,0,.105,0,Math.PI*2,false);return shape})()
const bittenShape=(()=>{const s=new Shape();s.moveTo(.015,.104);s.bezierCurveTo(-.062,.114,-.116,.056,-.104,-.025);s.bezierCurveTo(-.09,-.119,.027,-.133,.09,-.055);s.bezierCurveTo(.112,-.024,.11,.005,.096,.032);s.quadraticCurveTo(.054,.010,.048,.057);s.quadraticCurveTo(.01,.052,.015,.104);return s})()
function Cookie({bitten=false}:{bitten?:boolean}){return <group name={bitten?'orig-prop-cookie-bitten':'orig-prop-cookie-whole'}>
 <mesh castShadow><extrudeGeometry args={[bitten?bittenShape:roundShape,{depth:.021,bevelEnabled:true,bevelSegments:3,bevelSize:.009,bevelThickness:.006,curveSegments:18}]}/><meshStandardMaterial color="#ce9b58" roughness={.9}/></mesh>
 {Array.from({length:8},(_,i)=>{const angle=i*2.39996,r=.066*Math.sqrt((i+.4)/8),x=Math.cos(angle)*r,y=Math.sin(angle)*r;if(bitten&&x>.014&&y>.015)return null;return <Orb key={i} color="#8a5736" position={[x,y,.027]} scale={[.009,.007,.003]}/>})}
</group>}
function Gift(){return <group name="orig-prop-gift">
 <RoundedBox args={[.365,.267,.28]} radius={.025} smoothness={4} castShadow receiveShadow><meshStandardMaterial color="#dfb78f" roughness={.83}/></RoundedBox>
 <RoundedBox args={[.379,.064,.294]} position={[0,.121,0]} radius={.017} smoothness={3} castShadow><meshStandardMaterial color="#f0d6af" roughness={.84}/></RoundedBox>
 <RoundedBox args={[.037,.286,.293]} position={[0,.006,0]} radius={.003} smoothness={2}><meshStandardMaterial color="#78907d" roughness={.8}/></RoundedBox>
 <RoundedBox args={[.375,.285,.037]} position={[0,.006,0]} radius={.003} smoothness={2}><meshStandardMaterial color="#78907d" roughness={.8}/></RoundedBox>
 {[-1,1].map(side=><mesh key={side} position={[side*.045,.167,0]} rotation={[Math.PI/2,0,side*.42]} scale={[1,.65,1]}><torusGeometry args={[.049,.012,8,24]}/><meshStandardMaterial color="#78907d" roughness={.7}/></mesh>)}
 <Orb color="#78907d" position={[0,.163,.004]} scale={[.026,.018,.022]}/>
</group>}

/** Original parametric toy resident, no imported model or stock animation.
 * 3D source parts and named joints also support glTF export/native pose baking. */
export const OriginalResident=memo(function OriginalResident({appearance:a,motion='idle',emotion='neutral',time,paused=false,quality='high'}:OriginalResidentProps){
 const d=useMemo(()=>headDimensions(a),[a]),b=useMemo(()=>bodyDimensions(a),[a]),head=useMemo(()=>createHead(d,quality==='high'?36:20),[d,quality])
 useOwnedGeometry(head)
 const root=useRef<Group>(null),headJoint=useRef<Group>(null),leftArm=useRef<Group>(null),rightArm=useRef<Group>(null),leftForearm=useRef<Group>(null),rightForearm=useRef<Group>(null),leftLeg=useRef<Group>(null),rightLeg=useRef<Group>(null),leftKnee=useRef<Group>(null),rightKnee=useRef<Group>(null),leftHand=useRef<Group>(null),rightHand=useRef<Group>(null),gift=useRef<Group>(null),cookie=useRef<Group>(null),wholeCookie=useRef<Group>(null),bittenCookie=useRef<Group>(null)
 const localTime=useRef(0),lastMotion=useRef(motion)
 const face=useRef<OriginalFacePose>({blink:0,talk:0,chew:0,lookX:0,lookY:0,smile:0})
 const math=useMemo(()=>({direction:new Vector3(),elbow:new Vector3(),target:new Vector3(),shoulder:new Vector3(),pole:new Vector3(),upper:new Vector3(),lower:new Vector3(),qa:new Quaternion(),qb:new Quaternion(),qp:new Quaternion(),point:new Vector3()}),[])
 const headScale=mix(.9,1.12,a.headScale)
 useFrame((_,delta)=>{
  if(lastMotion.current!==motion){lastMotion.current=motion;localTime.current=0}
  if(!paused&&time===undefined)localTime.current+=Math.min(delta,.05)
  const t=typeof time==='number'?time:time?time.current:localTime.current,p=originalResidentPose(motion,emotion,t)
  if(motion==='walk'){
   // Keep a real shoe sole on the floor as leg proportions change. The minimum
   // comes from the three shoe ellipsoids, rather than a fixed-height root bob.
   const sole=(leg:number,knee:number)=>{const angle=leg-knee,c=Math.cos(angle),s=Math.sin(angle),ankle=b.hip-b.thigh*Math.cos(leg)-(b.shin+.19)*c;return Math.min(...[[.044,.07,.04,.209],[.096,.074,.081,.195],[.122,-.019,.08,.092]].map(([y,z,ry,rz])=>ankle+y*c-z*s-Math.sqrt((ry*c)**2+(rz*s)**2)))}
   p.bodyY=Math.max(0,.004-Math.min(sole(p.leftLeg,p.leftKnee),sole(p.rightLeg,p.rightKnee)))
  }
  if(root.current){root.current.position.y=p.bodyY;root.current.rotation.z=p.bodyZ}
  if(headJoint.current)headJoint.current.rotation.set(p.headX,p.headY,p.headZ)
  leftArm.current?.rotation.set(p.leftArmX,0,p.leftArmZ);rightArm.current?.rotation.set(p.rightArmX,0,p.rightArmZ)
  leftForearm.current?.rotation.set(p.leftElbow,0,0);rightForearm.current?.rotation.set(p.rightElbow,0,0)
  leftLeg.current?.rotation.set(p.leftLeg,0,0);rightLeg.current?.rotation.set(p.rightLeg,0,0);leftKnee.current?.rotation.set(-p.leftKnee,0,0);rightKnee.current?.rotation.set(-p.rightKnee,0,0)
  Object.assign(face.current,{blink:p.blink,talk:p.talk,chew:p.chew,lookX:p.lookX,lookY:p.lookY,smile:p.smile})
  function reach(side:number,arm:Group|null,forearm:Group|null,x:number,y:number,z:number){
   if(!arm||!forearm)return
   const m=math,L1=b.upperArm,L2=b.forearm+.074
   m.shoulder.set(side*b.shoulderX,b.shoulder,0);m.target.set(x,y,z);m.direction.subVectors(m.target,m.shoulder)
   const distance=Math.min(m.direction.length(),L1+L2-.004);m.direction.normalize()
   const projection=(L1*L1-L2*L2+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,L1*L1-projection*projection))
   m.pole.set(side,-.38,.05).addScaledVector(m.direction,-m.direction.dot(m.pole)).normalize()
   m.elbow.copy(m.shoulder).addScaledVector(m.direction,projection).addScaledVector(m.pole,height)
   m.upper.subVectors(m.elbow,m.shoulder).normalize();m.lower.subVectors(m.target,m.elbow).normalize()
   m.qa.setFromUnitVectors(down,m.upper);m.qb.setFromUnitVectors(down,m.lower);arm.quaternion.copy(m.qa);forearm.quaternion.copy(m.qa.invert().multiply(m.qb))
  }
  if(motion==='receive'){
   reach(-1,rightArm.current,rightForearm.current,-.225,b.hip+.35,.36);reach(1,leftArm.current,leftForearm.current,.225,b.hip+.35,.36)
  }
  if(motion==='eat'){
   const cycle=Math.max(0,t),lift=cycle<.9?cycle/.9:cycle<2.1?1:cycle<3.2?1-(cycle-2.1)/1.1:0
   const eased=lift*lift*(3-2*lift),mouth=b.head+mix(-.267,-.175,a.mouthHeight)*headScale
   reach(-1,rightArm.current,rightForearm.current,mix(-.22,-.055,eased),mix(b.hip+.3,mouth-.115,eased),mix(.38,.435,eased))
   face.current.chew=cycle>1.5&&cycle<5.2?Math.abs(Math.sin(cycle*7)):0;face.current.talk=cycle>1.0&&cycle<1.6?.24:0
   if(wholeCookie.current)wholeCookie.current.visible=cycle<1.65;if(bittenCookie.current)bittenCookie.current.visible=cycle>=1.65
   if(cookie.current)cookie.current.visible=cycle<5.2
  }
  if(root.current&&rightHand.current&&(gift.current||cookie.current)){
   root.current.updateWorldMatrix(true,true)
   rightHand.current.getWorldQuaternion(math.qa);root.current.getWorldQuaternion(math.qb);math.qp.copy(math.qa).invert().multiply(math.qb)
   if(gift.current){gift.current.quaternion.copy(math.qp);math.point.set(0,b.hip+.35,.425);root.current.localToWorld(math.point);rightHand.current.worldToLocal(math.point);gift.current.position.copy(math.point)}
   if(cookie.current){cookie.current.quaternion.copy(math.qp);math.point.set(.03,.065,.042).applyQuaternion(math.qp);cookie.current.position.copy(math.point);cookie.current.scale.setScalar(t>3.4?.79:1)}
  }
 })
 return <group name="original-resident" scale={mix(.9,1.1,a.height)} userData={{assetFamily:'lingolife-original-v1',appearanceVersion:1,original:true}}>
  <group ref={root} name="orig-root">
   <OriginalTorso appearance={a} body={b} quality={quality}/>
   <group ref={headJoint} name="orig-head" position={[0,b.head,0]} scale={headScale}>
    <mesh name="orig-head-surface" geometry={head} castShadow receiveShadow><meshStandardMaterial color={a.skin} roughness={.62}/></mesh>
    <OriginalFace appearance={a} dimensions={d} emotion={emotion} pose={face}/>
    <OriginalHair appearance={a} dimensions={d} quality={quality}/>
   </group>
   {[-1,1].map(side=>{const left=side===1,armLength=b.upperArm,foreLength=b.forearm;return <group key={side}>
    <group ref={left?leftArm:rightArm} name={`orig-arm-${left?'left':'right'}`} position={[side*b.shoulderX,b.shoulder,0]}>
     <Limb length={armLength} radius={.104+Math.max(0,a.bodyWidth-.5)*.026} color={a.topColor}/>
     <group ref={left?leftForearm:rightForearm} name={`orig-forearm-${left?'left':'right'}`} position={[0,-armLength,0]}>
      <Limb length={foreLength} radius={.085} color={a.topColor}/>
      <mesh name="orig-cuff" position={[0,-foreLength+.024,0]}><cylinderGeometry args={[.083,.082,.061,24]}/><meshStandardMaterial color={shade(a.topColor,-.13)} roughness={.95}/></mesh>
      <group ref={left?leftHand:rightHand} position={[0,-foreLength-.074,0]}>
       <OriginalHand skin={a.skin} side={side}/>
       {!left&&motion==='receive'&&<group ref={gift}><Gift/></group>}
       {!left&&motion==='eat'&&<group ref={cookie}><group ref={wholeCookie}><Cookie/></group><group ref={bittenCookie} visible={false}><Cookie bitten/></group></group>}
      </group>
     </group>
    </group>
    <group ref={left?leftLeg:rightLeg} name={`orig-leg-${left?'left':'right'}`} position={[side*(.15+(a.bodyWidth-.5)*.045),b.hip,0]}>
     <Limb length={b.thigh} radius={mix(.119,.153,a.bodyWidth)} color={a.bottomColor}/>
     <group ref={left?leftKnee:rightKnee} name={`orig-knee-${left?'left':'right'}`} position={[0,-b.thigh,0]}>
      <Limb length={b.shin} radius={mix(.104,.13,a.bodyWidth)} color={a.bottomColor}/>
      <mesh position={[0,-b.shin+.025,0]}><cylinderGeometry args={[mix(.105,.131,a.bodyWidth),mix(.105,.131,a.bodyWidth),.067,24]}/><meshStandardMaterial color={shade(a.bottomColor,.11)} roughness={.91}/></mesh>
      <group position={[0,-b.shin-.19,0]}><OriginalShoe appearance={a}/></group>
      <Seam points={[[side*.104,-.045,.021],[side*.108,-b.shin+.045,.023]]} color={shade(a.bottomColor,.16)} radius={.002}/>
     </group>
    </group>
   </group>})}
  </group>
 </group>
})
