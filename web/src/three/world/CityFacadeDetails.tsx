import {useLayoutEffect,useMemo,useRef} from 'react'
import * as THREE from 'three'
import {buildingFacadeDetails,type FacadeBuilding,type FacadeDetail} from './cityArtDirection'

function FacadeBatch({name,details,lit=false}:{name:string;details:readonly FacadeDetail[];lit?:boolean}){
 const ref=useRef<THREE.InstancedMesh>(null)
 useLayoutEffect(()=>{
  const mesh=ref.current
  if(!mesh)return
  const matrix=new THREE.Matrix4(),quaternion=new THREE.Quaternion(),position=new THREE.Vector3(),scale=new THREE.Vector3(),color=new THREE.Color(),axis=new THREE.Vector3(0,1,0)
  details.forEach((detail,index)=>{
   matrix.compose(position.fromArray(detail.position),quaternion.setFromAxisAngle(axis,detail.rotation),scale.fromArray(detail.scale))
   mesh.setMatrixAt(index,matrix);mesh.setColorAt(index,color.set(detail.color))
  })
  mesh.instanceMatrix.needsUpdate=true
  if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true
  mesh.computeBoundingSphere()
 },[details])
 if(!details.length)return null
 return <instancedMesh ref={ref} name={`city-facade-${name}`} args={[undefined,undefined,details.length]} receiveShadow userData={{facadeDetails:details.length}}>
  <boxGeometry args={[1,1,1]}/>
  <meshStandardMaterial roughness={name.startsWith('glass')?.36:.78} metalness={0} emissive={lit?'#f0ba69':'#000000'} emissiveIntensity={lit?.24:0}/>
 </instancedMesh>
}

/** Add a fine, warm miniature facade layer without touching authored assets
 * or transforms. Core panes/frames survive low quality; no per-frame work. */
export function CityFacadeDetails({buildings,quality,night=false}:{buildings:readonly FacadeBuilding[];quality:'low'|'high';night?:boolean}){
 const batches=useMemo(()=>{
  const details=buildingFacadeDetails(buildings,{quality,night})
  return [
   {name:'frames',details:details.filter(item=>item.kind==='frame')},
   {name:'glass',details:details.filter(item=>item.kind==='glass'&&!item.lit)},
   {name:'glass-lit',details:details.filter(item=>item.kind==='glass'&&item.lit),lit:true},
   {name:'sills',details:details.filter(item=>item.kind==='sill')},
   {name:'drains',details:details.filter(item=>item.kind==='pipe')},
  ]
 },[buildings,quality,night])
 return <group name="city-facade-details">{batches.map(batch=><FacadeBatch key={batch.name} {...batch}/>)}</group>
}
