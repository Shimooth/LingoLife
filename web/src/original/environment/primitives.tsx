import {RoundedBox} from '@react-three/drei'
import {useEffect, useMemo} from 'react'
import {ExtrudeGeometry, Shape} from 'three'
import type {OriginalQuality} from './layout'

type Vec3 = [number, number, number]
export function SoftBox({size, position=[0,0,0], rotation=[0,0,0], color, radius=.1, roughness=.74, metalness=0, emissive, glow=0, quality='high', name}: {
  size:Vec3; position?:Vec3; rotation?:Vec3; color:string; radius?:number; roughness?:number; metalness?:number;
  emissive?:string; glow?:number; quality?:OriginalQuality; name?:string
}) {
  return <RoundedBox name={name} args={size} radius={Math.min(radius, ...size.map(n=>n/2-.001))} smoothness={quality==='high'?3:1} position={position} rotation={rotation} castShadow receiveShadow>
    <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} emissive={emissive??color} emissiveIntensity={glow}/>
  </RoundedBox>
}

export function Arch({width,height,depth,color,position=[0,0,0],quality='high',glow=0}: {width:number;height:number;depth:number;color:string;position?:Vec3;quality?:OriginalQuality;glow?:number}) {
  const geometry = useMemo(()=>{
    const r=width/2, shape=new Shape()
    shape.moveTo(-r,0);shape.lineTo(r,0);shape.lineTo(r,height-r)
    shape.absarc(0,height-r,r,0,Math.PI,false);shape.lineTo(-r,0)
    const result=new ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelSize:.025,bevelThickness:.025,bevelSegments:quality==='high'?3:1,curveSegments:quality==='high'?18:8})
    result.translate(0,0,-depth/2)
    return result
  },[width,height,depth,quality])
  useEffect(()=>()=>geometry.dispose(),[geometry])
  return <mesh geometry={geometry} position={position} castShadow receiveShadow><meshStandardMaterial color={color} roughness={.58} emissive={color} emissiveIntensity={glow}/></mesh>
}

export function Orb({position,scale,color,quality='high',roughness=.85}:{position:Vec3;scale:Vec3;color:string;quality?:OriginalQuality;roughness?:number}) {
  return <mesh position={position} scale={scale} castShadow receiveShadow><sphereGeometry args={[1,quality==='high'?18:10,quality==='high'?12:8]}/><meshStandardMaterial color={color} roughness={roughness}/></mesh>
}

export function Stem({start,end,width,color,quality='high'}:{start:Vec3;end:Vec3;width:number;color:string;quality?:OriginalQuality}) {
  const dx=end[0]-start[0],dy=end[1]-start[1],dz=end[2]-start[2]
  const length=Math.hypot(dx,dy,dz)
  return <group position={[(start[0]+end[0])/2,(start[1]+end[1])/2,(start[2]+end[2])/2]} rotation={[Math.atan2(dz,dy),0,-Math.atan2(dx,Math.hypot(dy,dz))]}>
    <mesh castShadow receiveShadow><cylinderGeometry args={[width*.72,width,length,quality==='high'?12:7]}/><meshStandardMaterial color={color} roughness={.9}/></mesh>
  </group>
}
