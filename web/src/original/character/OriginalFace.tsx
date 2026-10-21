import {useMemo,useRef,type RefObject} from 'react'
import {useFrame} from '@react-three/fiber'
import {Group,Mesh} from 'three'
import type {OriginalAppearance,OriginalEmotion} from '../spec'
import {faceDepth,mix,type HeadDimensions,shade} from './geometry'
import {Orb,Seam} from './parts'

export type OriginalFacePose={blink:number;talk:number;chew:number;lookX:number;lookY:number;smile:number}
function Eye({side,a,d,emotion,pose}:{side:number;a:OriginalAppearance;d:HeadDimensions;emotion:OriginalEmotion;pose:RefObject<OriginalFacePose>}){
 const lid=useRef<Group>(null),iris=useRef<Group>(null)
 const x=side*mix(.136,.222,a.eyeSpacing),y=mix(-.025,.091,a.eyeHeight),width=mix(.071,.115,a.eyeSize),height=width*.88,z=faceDepth(d,x,y)+.009
 const tilt=side*(a.eyeTilt-.5)*.5,browY=mix(.098,.177,a.browHeight),browAngle=side*((a.browAngle-.5)*.65+(emotion==='sad'?.25:emotion==='curious'?-.14:0))
 const upper=useMemo(()=>[[-width,-height*.02,.013],[-width*.55,height*.66,.028],[0,height*.83,.033],[width*.6,height*.63,.025],[width,-height*.03,.011]] as [number,number,number][],[width,height])
 useFrame(()=>{const p=pose.current;if(lid.current)lid.current.scale.y=Math.max(.035,1-p.blink*.965);if(iris.current){iris.current.position.x=p.lookX*.008;iris.current.position.y=p.lookY*.006}})
 return <group name={`orig-eye-${side===-1?'right':'left'}`} position={[x,y,z]} rotation={[0,side*.11,tilt]}>
  <group ref={lid} name="orig-eyelids">
   <Orb color="#fff6e9" scale={[width,height,.035]} roughness={.3}/>
   <group ref={iris}>
    <Orb color={shade(a.eyeColor,-.22)} position={[0,0,.034]} scale={[width*mix(.43,.69,a.irisSize),height*.79,.011]} roughness={.32}/>
    <Orb color={a.eyeColor} position={[0,-.009,.043]} scale={[width*mix(.34,.55,a.irisSize),height*.54,.004]} roughness={.26}/>
    <Orb color="#252825" position={[0,.003,.046]} scale={[width*mix(.21,.35,a.irisSize),height*.58,.004]} roughness={.2}/>
    <Orb color="#ffffff" position={[-width*.22,height*.32,.052]} scale={[width*.14,width*.18,.003]} roughness={.16}/>
    <Orb color="#ffffff" position={[width*.22,-height*.2,.05]} scale={[width*.06,width*.06,.002]} roughness={.2}/>
   </group>
   <Seam points={upper} color={shade(a.hairColor,-.3)} radius={.0065}/>
   <Seam points={[[-width,-height*.02,.01],[0,-height*.84,.02],[width,-height*.03,.01]]} color={shade(a.skin,-.13)} radius={.004}/>
  </group>
  <group name="orig-brow" position={[0,browY,0]} rotation-z={browAngle}><Seam points={[[-width*.91,0,0],[0,.013,.006],[width*.82,-.004,0]]} color={a.hairColor} radius={mix(.007,.018,a.browThickness)}/></group>
 </group>
}
export function OriginalFace({appearance:a,dimensions:d,emotion,pose}:{appearance:OriginalAppearance;dimensions:HeadDimensions;emotion:OriginalEmotion;pose:RefObject<OriginalFacePose>}){
 const open=useRef<Group>(null),closed=useRef<Group>(null),cheekLeft=useRef<Mesh>(null),cheekRight=useRef<Mesh>(null)
 const noseY=mix(-.115,-.037,a.noseHeight),noseZ=faceDepth(d,0,noseY),noseW=mix(.035,.065,a.noseWidth),noseD=mix(.032,.086,a.noseLength)
 const mouthY=mix(-.267,-.175,a.mouthHeight),mouthZ=faceDepth(d,0,mouthY)+.018,mouthW=mix(.059,.12,a.mouthWidth),lip=mix(.004,.011,a.lipFullness)
 const smile=emotion==='sad'?-.018:emotion==='happy'?.031:.014
 const skinPink=shade(a.skin,-.04),lipColor=shade(a.skin,-.58)
 const freckles=useMemo(()=>Array.from({length:Math.round(a.freckles*13)},(_,i)=>{const theta=i*2.39996,r=Math.sqrt((i+1)/14);return {x:.185+Math.cos(theta)*.078*r,y:-.099+Math.sin(theta)*.039*r,size:.004+(i%3)*.0008}}),[a.freckles])
 useFrame(()=>{const p=pose.current,talk=Math.max(p.talk,p.chew*.38);if(open.current){open.current.visible=talk>.09;open.current.scale.y=.2+talk*.85}if(closed.current)closed.current.visible=talk<=.09;const swell=1+p.chew*.045;if(cheekLeft.current)cheekLeft.current.scale.z=.012*swell;if(cheekRight.current)cheekRight.current.scale.z=.012*swell})
 return <group name="orig-face">
  {[-1,1].map(side=><Eye key={side} side={side} a={a} d={d} emotion={emotion} pose={pose}/>)}
  <group name="orig-nose" position={[0,noseY,noseZ]}>
   <Orb color={a.skin} position={[0,.024,0]} scale={[noseW*.62,.07,noseD*.68]} roughness={.62}/>
   <Orb color={a.skin} position={[0,-.013,noseD*.45]} scale={[noseW,.039,noseD]} roughness={.61}/>
   {[-1,1].map(side=><Orb key={side} color={shade(a.skin,-.25)} position={[side*noseW*.55,-.03,noseD*1.14]} scale={[noseW*.18,.007,.004]}/>)}
  </group>
  {[-1,1].map(side=>{const x=side*.23,y=-.112,z=faceDepth(d,x,y)+.006;return <group key={side}>
   <mesh ref={side===-1?cheekLeft:cheekRight} name="orig-cheek-warmth" position={[x,y,z]} rotation-y={side*.2} scale={[.078,.043,.012]}><sphereGeometry args={[1,24,14]}/><meshStandardMaterial color="#d77f70" transparent opacity={.16} roughness={.9} depthWrite={false}/></mesh>
   {freckles.map((f,i)=><Orb key={i} castShadow={false} roughness={1} color={shade(a.skin,-.4)} position={[f.x*side,f.y,faceDepth(d,f.x*side,f.y)+.006]} scale={[f.size,f.size,.002]}/>)}
  </group>})}
  <group name="orig-mouth" position={[0,mouthY,mouthZ]}>
   <group ref={closed} name="orig-mouth-closed"><Seam points={[[-mouthW,smile,0],[-mouthW*.55,-.005,.014],[0,-.011,.02],[mouthW*.55,-.005,.014],[mouthW,smile,0]]} color={lipColor} radius={lip}/><Seam points={[[-mouthW*.46,-.02,.017],[0,-.025,.022],[mouthW*.46,-.02,.017]]} color={skinPink} radius={lip*.65}/></group>
   <group ref={open} name="orig-mouth-open" visible={false}>
    <Orb color="#633b36" scale={[mouthW*.87,.061,.012]}/>
    <Orb color="#cf8980" position={[0,-.032,.013]} scale={[mouthW*.63,.022,.005]}/>
    <Orb color="#fff0d9" position={[0,.037,.012]} scale={[mouthW*.65,.014,.004]}/>
   </group>
  </group>
  {[-1,1].map(side=>{const y=mix(-.115,.035,a.earHeight),s=mix(.065,.095,a.earSize);return <group key={side} name={`orig-ear-${side}`} position={[side*(d.width*.955),y,-.005]} rotation-z={side*-.17}>
   <Orb color={a.skin} scale={[s,.113,.052]}/><Orb color={shade(a.skin,-.17)} position={[side*.012,0,.048]} scale={[s*.44,.063,.012]}/><Orb color={a.skin} position={[side*.015,-.008,.054]} scale={[s*.27,.035,.007]}/>
   {a.accessory==='earrings'&&<mesh position={[side*.004,-.093,.037]} rotation-y={side*.3}><torusGeometry args={[.027,.007,8,20]}/><meshStandardMaterial color="#dab779" metalness={.7} roughness={.3}/></mesh>}
  </group>})}
  {a.accessory==='glasses'&&<group name="orig-glasses" position={[0,mix(-.025,.091,a.eyeHeight),.025]}>
   {[-1,1].map(side=><group key={side} position={[side*mix(.136,.222,a.eyeSpacing),0,faceDepth(d,side*mix(.136,.222,a.eyeSpacing),mix(-.025,.091,a.eyeHeight))+.035]} rotation-y={side*.11}>
    <mesh scale={[1.14,1,1]}><torusGeometry args={[mix(.10,.137,a.eyeSize),.009,8,36]}/><meshStandardMaterial color="#765c3f" metalness={.5} roughness={.35}/></mesh>
    <Seam points={[[side*.12,.016,0],[side*.19,.017,-.04],[side*(d.width-.19),.012,-.35]]} radius={.007} color="#765c3f"/>
   </group>)}
   <Seam points={[[-.046,.014,.426],[0,.027,.438],[.046,.014,.426]]} color="#765c3f" radius={.007}/>
  </group>}
 </group>
}
