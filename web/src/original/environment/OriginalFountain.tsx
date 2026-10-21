import {useEffect, useMemo, useRef} from 'react'
import {useFrame} from '@react-three/fiber'
import {CatmullRomCurve3, Group, LatheGeometry, Mesh, TubeGeometry, Vector2, Vector3} from 'three'
import type {OriginalQuality, OriginalTimeOfDay} from './layout'
import {Orb} from './primitives'

function CeramicProfile({points,color,quality,glazed=false}:{points:[number,number][];color:string;quality:OriginalQuality;glazed?:boolean}) {
  const profile=JSON.stringify(points)
  const geometry=useMemo(()=>new LatheGeometry((JSON.parse(profile) as [number,number][]).map(p=>new Vector2(...p)),quality==='high'?64:28),[profile,quality])
  useEffect(()=>()=>geometry.dispose(),[geometry])
  return <mesh geometry={geometry} castShadow receiveShadow><meshPhysicalMaterial color={color} roughness={glazed?.25:.7} clearcoat={glazed?.6:.07} clearcoatRoughness={.2}/></mesh>
}

function WaterArc({angle,quality}:{angle:number;quality:OriginalQuality}) {
  const geometry=useMemo(()=>{
    const curve=new CatmullRomCurve3([new Vector3(0,1.82,0),new Vector3(.43,2.17,0),new Vector3(.86,1.88,0),new Vector3(1.13,.57,0)])
    return new TubeGeometry(curve,quality==='high'?24:12,.032,quality==='high'?7:4,false)
  },[quality])
  useEffect(()=>()=>geometry.dispose(),[geometry])
  return <mesh geometry={geometry} rotation-y={angle}><meshPhysicalMaterial color="#c7eeeb" roughness={.12} transparent opacity={.64} depthWrite={false} clearcoat={1}/></mesh>
}

export function OriginalFountain({quality='high',timeOfDay='day',paused=false}:{quality?:OriginalQuality;timeOfDay?:OriginalTimeOfDay;paused?:boolean}) {
  const ripples=useRef<Group>(null), droplets=useRef<Group>(null), surface=useRef<Mesh>(null), timer=useRef(0)
  useFrame((_,dt)=>{
    if(paused)return
    timer.current+=Math.min(dt,.05)
    const t=timer.current
    if(surface.current)surface.current.position.y=.559+Math.sin(t*1.4)*.004
    ripples.current?.children.forEach((r,index)=>{
      const phase=(t*.28+index*.25)%1
      r.scale.setScalar(.25+phase*.8)
      const mesh=r as Mesh
      const material=mesh.material
      if(!Array.isArray(material))material.opacity=(1-phase)*.24
    })
    droplets.current?.children.forEach((drop,index)=>{
      const phase=(t*.74+index*.17)%1,angle=Math.floor(index/3)*Math.PI/2+.18
      const radius=.08+1.05*phase
      drop.position.set(Math.cos(angle)*radius,1.86+1.45*phase-2.75*phase*phase,Math.sin(angle)*radius)
      drop.scale.setScalar(.024+.017*Math.sin(phase*Math.PI))
    })
  })
  const night=timeOfDay==='night'
  return <group name="original-wish-fountain" userData={{assetFamily:'lingolife-original-v1',height:2.26,boundsRadius:1.85}}>
    <CeramicProfile quality={quality} color="#d4c4a5" points={[[0,0],[1.7,0],[1.84,.09],[1.84,.16],[1.72,.21],[0,.21]]}/>
    <CeramicProfile quality={quality} color="#e9dec5" points={[[.02,.20],[1.37,.20],[1.48,.28],[1.65,.61],[1.66,.76],[1.62,.82],[1.47,.82],[1.43,.76],[1.46,.67],[1.28,.31],[.02,.31]]}/>
    <CeramicProfile quality={quality} glazed color="#769d8b" points={[[1.61,.61],[1.68,.68],[1.69,.77],[1.65,.85],[1.47,.85],[1.41,.77],[1.45,.69]]}/>
    <mesh ref={surface} position-y={.559} rotation-x={-Math.PI/2} receiveShadow><circleGeometry args={[1.39,quality==='high'?64:28]}/><meshPhysicalMaterial color={night?'#588c87':'#78b9b1'} emissive="#4b9592" emissiveIntensity={night?.2:.03} roughness={.17} metalness={.12} clearcoat={1} clearcoatRoughness={.08}/></mesh>
    <CeramicProfile quality={quality} color="#ecdfc4" points={[[0,.30],[.43,.30],[.44,.42],[.30,.49],[.19,1.17],[.30,1.25],[.31,1.36],[0,1.36]]}/>
    <CeramicProfile quality={quality} glazed color="#769d8b" points={[[.05,1.21],[.41,1.24],[.67,1.42],[.72,1.54],[.70,1.61],[.62,1.64],[.56,1.51],[.12,1.42]]}/>
    <CeramicProfile quality={quality} color="#f3e7cd" points={[[0,1.39],[.17,1.39],[.20,1.60],[.13,1.79],[0,1.89]]}/>
    <Orb position={[0,1.84,0]} scale={[.145,.20,.145]} color="#d6b469" quality={quality} roughness={.38}/>
    <mesh position={[0,1.51,0]} rotation-x={-Math.PI/2}><circleGeometry args={[.54,32]}/><meshPhysicalMaterial color="#b5d8c8" roughness={.12} clearcoat={1}/></mesh>
    {[0,1,2,3].map(index=><WaterArc key={index} angle={index*Math.PI/2+.18} quality={quality}/>)}
    <group ref={ripples} position-y={.567}>
      {[0,1,2,3].map(index=><mesh key={index} rotation-x={-Math.PI/2}><ringGeometry args={[1.13,1.145,quality==='high'?48:24]}/><meshBasicMaterial color="#e4f6db" transparent opacity={.2} depthWrite={false}/></mesh>)}
    </group>
    {quality==='high'&&<group ref={droplets}>{Array.from({length:12},(_,i)=><mesh key={i}><sphereGeometry args={[1,6,6]}/><meshPhysicalMaterial color="#dbf9ee" roughness={.06} clearcoat={1}/></mesh>)}</group>}
    {quality==='high'&&Array.from({length:16},(_,i)=>{
      const angle=i*Math.PI/8
      return <mesh key={i} position={[Math.cos(angle)*1.6,.55,Math.sin(angle)*1.6]} rotation={[0,-angle+Math.PI/2,Math.PI/4]} castShadow><boxGeometry args={[.075,.075,.015]}/><meshStandardMaterial color="#ad9167" roughness={.5}/></mesh>
    })}
  </group>
}
