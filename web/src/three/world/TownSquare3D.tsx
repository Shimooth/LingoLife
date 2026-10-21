import {RoundedBox} from '@react-three/drei'
import {useEffect,useMemo} from 'react'
import {ExtrudeGeometry,Shape} from 'three'
import {NeighborhoodImprovements3D,type NeighborhoodImprovements} from '../../neighborhood/NeighborhoodImprovements3D'
import {TOWN_CENTER} from './townCenterLayout'

type Quality='high'|'low'
const ground=TOWN_CENTER.building_envelope.ground_y

function SquarePaving(){
 const {position,half}=TOWN_CENTER.plaza.paving
 const geometry=useMemo(()=>{
  const [x,z]=half,r=.38,shape=new Shape()
  shape.moveTo(-x+r,-z);shape.lineTo(x-r,-z);shape.quadraticCurveTo(x,-z,x,-z+r)
  shape.lineTo(x,z-r);shape.quadraticCurveTo(x,z,x-r,z)
  shape.lineTo(-x+r,z);shape.quadraticCurveTo(-x,z,-x,z-r)
  shape.lineTo(-x,-z+r);shape.quadraticCurveTo(-x,-z,-x+r,-z)
  return new ExtrudeGeometry(shape,{depth:.035,bevelEnabled:false,curveSegments:8})
 },[half])
 useEffect(()=>()=>geometry.dispose(),[geometry])
 return <mesh geometry={geometry} position={[position[0],ground-.025,position[1]]} rotation-x={-Math.PI/2} receiveShadow><meshStandardMaterial color="#d8c7ac" roughness={.96}/></mesh>
}

function Bench({position,rotation,quality}:{position:[number,number];rotation:number;quality:Quality}){
 return <group position={[position[0],ground,position[1]]} rotation-y={rotation} name="town-square-bench">
  {[-.34,.34].map(x=><RoundedBox key={x} args={[.075,.15,.29]} radius={.025} position={[x,.075,0]} castShadow={quality==='high'}><meshStandardMaterial color="#718e7b" roughness={.95}/></RoundedBox>)}
  <RoundedBox args={[1.02,.065,.34]} radius={.025} position={[0,.1575,0]} receiveShadow castShadow={quality==='high'}><meshStandardMaterial color="#cea779" roughness={.86}/></RoundedBox>
  <RoundedBox args={[1.02,.20,.055]} radius={.025} position={[0,.29,-.14]} receiveShadow castShadow={quality==='high'}><meshStandardMaterial color="#cea779" roughness={.86}/></RoundedBox>
 </group>
}
function FlowerBed({position,tree=false,quality}:{position:[number,number];tree?:boolean;quality:Quality}){
 return <group position={[position[0],ground,position[1]]} name={tree?'town-square-tree':'town-square-flowers'}>
  <RoundedBox args={[.55,.2,.55]} radius={.085} position-y={.1} receiveShadow castShadow={quality==='high'}><meshStandardMaterial color="#e2c4a2" roughness={.95}/></RoundedBox>
  <mesh position-y={.2}><cylinderGeometry args={[.2,.2,.02,16]}/><meshStandardMaterial color="#8e8061" roughness={1}/></mesh>
  {tree?<>
   <mesh position-y={.62} castShadow={quality==='high'}><cylinderGeometry args={[.045,.06,.9,8]}/><meshStandardMaterial color="#a58362" roughness={1}/></mesh>
   <mesh position={[0,1.22,0]} scale={[.46,.6,.46]} castShadow={quality==='high'}><sphereGeometry args={[1,12,10]}/><meshStandardMaterial color="#87aa85" roughness={1}/></mesh>
   <mesh position={[-.18,1.07,.03]} scale={[.29,.33,.3]} castShadow={quality==='high'}><sphereGeometry args={[1,12,8]}/><meshStandardMaterial color="#9bb88c" roughness={1}/></mesh>
  </>:<>
   <mesh position-y={.28} scale={[.23,.13,.23]} castShadow={quality==='high'}><sphereGeometry args={[1,10,8]}/><meshStandardMaterial color="#91ab7c" roughness={1}/></mesh>
   {[[-.11,.09],[.1,.07],[0,-.1]].map(([x,z],index)=><mesh key={index} position={[x,.39,z]} scale={[.075,.045,.075]}><sphereGeometry args={[1,8,6]}/><meshStandardMaterial color={index===1?'#efc776':'#e8a99b'} roughness={.92}/></mesh>)}
  </>}
 </group>
}

/** This is a public place even before its fountain unlocks. Only real NPCs
 * use it; decoration never invents residents or runs a separate simulation. */
export function TownSquare3D({quality='high',night=false,improvements}:{quality?:Quality;night?:boolean;improvements?:NeighborhoodImprovements}){
 const segments=TOWN_CENTER.walkways.flatMap(path=>path.points.slice(1).map((end,index)=>{
  const start=path.points[index]
  return {id:`${path.id}:${index}`,position:[(start[0]+end[0])/2,(start[1]+end[1])/2] as [number,number],length:Math.hypot(end[0]-start[0],end[1]-start[1]),rotation:Math.atan2(end[0]-start[0],end[1]-start[1]),width:path.width}
 }))
 return <group name="resident-town-square" userData={{theme:TOWN_CENTER.theme,plazaLocationId:TOWN_CENTER.plaza.location_id}}>
  <SquarePaving/>
  <group position={[0,ground,6.5]}><NeighborhoodImprovements3D value={improvements} night={night} quality={quality}/></group>
  {segments.map(segment=><mesh key={segment.id} name={`town-walkway:${segment.id}`} position={[segment.position[0],ground+.013,segment.position[1]]} rotation-y={segment.rotation} receiveShadow><boxGeometry args={[segment.width,.018,segment.length+.025]}/><meshStandardMaterial color="#eddfc6" roughness={.96}/></mesh>)}
  <mesh position={[0,ground+.024,6.5]} rotation-x={-Math.PI/2} receiveShadow><ringGeometry args={[1.12,1.36,48]}/><meshStandardMaterial color="#eadbbe" roughness={.97}/></mesh>
  {quality==='high'&&[-2.9,2.9].flatMap(x=>[3.45,4.05,8.6].map(z=><mesh key={`${x}:${z}`} position={[x,ground+.013,z]} rotation-x={-Math.PI/2}><circleGeometry args={[.035,8]}/><meshStandardMaterial color="#bba485" roughness={1}/></mesh>))}
  {[-1,1].flatMap(side=>[5.65,7.05].map(z=><Bench key={`${side}:${z}`} position={[side*3.3,z]} rotation={-side*Math.PI/2} quality={quality}/>))}
  {[-1,1].map(side=><FlowerBed key={`tree:${side}`} position={[side*3.15,8.62]} tree quality={quality}/>)}
  {[-1,1].map(side=><FlowerBed key={`flowers:${side}`} position={[side*3.22,4.05]} quality={quality}/>)}
 </group>
}
