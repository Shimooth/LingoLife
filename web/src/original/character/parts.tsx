import {useMemo} from 'react'
import {CatmullRomCurve3,Vector3} from 'three'
import type {ThreeElements} from '@react-three/fiber'
import {shade} from './geometry'

export function Orb({color,roughness=.65,...props}:Omit<ThreeElements['mesh'],'args'> & {color:string;roughness?:number}){return <mesh castShadow receiveShadow {...props}><sphereGeometry args={[1,24,16]}/><meshStandardMaterial color={color} roughness={roughness}/></mesh>}
export function Seam({points,color,radius=.006,segments=18}:{points:[number,number,number][];color:string;radius?:number;segments?:number}){
 const curve=useMemo(()=>new CatmullRomCurve3(points.map(p=>new Vector3(...p))),[points])
 return <mesh><tubeGeometry args={[curve,segments,radius,6,false]}/><meshStandardMaterial color={color} roughness={.82}/></mesh>
}
export function Button({position,color='#c4a579',scale=.019}:{position:[number,number,number];color?:string;scale?:number}){return <group position={position}><Orb color={color} scale={[scale,scale,.007]} roughness={.35}/>{[-1,1].map(side=><Orb key={side} color={shade(color,-.48)} position={[side*scale*.28,0,.007]} scale={[.0025,.0025,.002]}/>)}</group>}
