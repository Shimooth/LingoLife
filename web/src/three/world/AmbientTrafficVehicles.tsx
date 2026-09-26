import {useGLTF} from '@react-three/drei'
import {useFrame} from '@react-three/fiber'
import {useEffect,useMemo,useRef} from 'react'
import * as THREE from 'three'
import {advanceTrafficFleet,createTrafficFleet,trafficRoutes,type TrafficVehicle} from './ambientTraffic'
import {KAYKIT_ASSET_BASE,type RoadTilePlacement} from './worldData'

const MODELS=['car_taxi','car_sedan','car_hatchback'] as const
// Road asphalt is local y=.07 (not the .1-high curb); wheels extend below
// the car pivot. Align actual tire geometry instead of floating above the road.
const VEHICLE_Y=.245+.07*1.3+.061042905*1.08+.002

function TrafficCar({vehicle,shadows}:{vehicle:TrafficVehicle;shadows:boolean}){
 const group=useRef<THREE.Group>(null)
 const {scene}=useGLTF(`${KAYKIT_ASSET_BASE}/${MODELS[vehicle.modelIndex]}.gltf`)
 const asset=useMemo(()=>{
  const object=scene.clone(true),materials:THREE.Material[]=[]
  object.traverse(child=>{
   if(!(child instanceof THREE.Mesh))return
   child.castShadow=shadows;child.receiveShadow=true
   const clones=(Array.isArray(child.material)?child.material:[child.material]).map(source=>{
    const material=source.clone()
    if(material instanceof THREE.MeshStandardMaterial){material.roughness=.5;material.metalness=.01;material.envMapIntensity=.82}
    materials.push(material)
    return material
   })
   child.material=Array.isArray(child.material)?clones:clones[0]
  })
  return {object,materials}
 },[scene,shadows])
 useEffect(()=>()=>asset.materials.forEach(material=>material.dispose()),[asset])
 useFrame(()=>{
  const node=group.current
  if(!node)return
  const {position,tangent,opacity}=vehicle.pose
  node.position.set(position[0],VEHICLE_Y,position[1])
  node.rotation.y=Math.atan2(tangent[0],tangent[1])
  node.visible=opacity>.001
  node.userData.opacity=opacity;node.userData.speed=vehicle.speed;node.userData.trips=vehicle.trips
  // Fade only at cloudway boundaries. The car retains its physical size.
  const fading=opacity<.999
  for(const material of asset.materials){
   if(material.transparent!==fading){material.transparent=fading;material.depthWrite=!fading;material.needsUpdate=true}
   material.opacity=opacity
  }
 })
 return <group ref={group} name={vehicle.id} visible={false} userData={{routeId:vehicle.route.id,closed:vehicle.route.closed}}><primitive object={asset.object} scale={1.08}/></group>
}

export function AmbientTraffic({roads,reducedMotion,quality}:{roads:readonly RoadTilePlacement[];reducedMotion:boolean;quality:'high'|'low'}){
 const fleet=useMemo(()=>createTrafficFleet(trafficRoutes(roads),{maxVehicles:quality==='high'?28:20}),[roads,quality])
 // Run before car transforms, while leaving R3F's render loop in control.
 useFrame((_,delta)=>{if(!reducedMotion)advanceTrafficFleet(fleet,delta)},-1)
 if(reducedMotion||!fleet.vehicles.length)return null
 return <group name="ambient-road-traffic">{fleet.vehicles.map(vehicle=><TrafficCar key={vehicle.id} vehicle={vehicle} shadows={quality==='high'}/>)}</group>
}
