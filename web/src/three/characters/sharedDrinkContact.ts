import {Euler,Object3D,Quaternion,Ray,SkinnedMesh,Vector3} from 'three'

export type DrinkMouthAnchor={head:Object3D;point:Vector3;forward:Vector3}
// Readable against the deliberately oversized City hands. The hand meets the
// outside handle, leaving the ceramic body visible instead of inside the palm.
export const DRINK_CUP_RIM={height:.075,radius:.071}
export const DRINK_CUP_GRIP=.108
export function drinkHandOffset(rotation:number):Vector3{
 const diagonal=DRINK_CUP_GRIP/Math.sqrt(2)
 return new Vector3(-Math.cos(rotation)-Math.sin(rotation),0,Math.sin(rotation)-Math.cos(rotation)).multiplyScalar(diagonal)
}

/** Measure the visible face once, in the actual rig's pose. Head pivots are
 * inside the skull and differ between City and Chibi; they are not lips. */
export function measureDrinkMouth(actor:Object3D,family:'city'|'chibi'):DrinkMouthAnchor|undefined{
 const head=actor.getObjectByName(family==='city'?'Head':'DEF-spine006')
 if(!head)return undefined
 actor.updateWorldMatrix(true,true)
 const forward=new Vector3(0,0,1).applyQuaternion(actor.getWorldQuaternion(new Quaternion())).normalize()
 const level=head.getWorldPosition(new Vector3());level.y+=family==='city'?.13:.045
 const ray=new Ray(level.clone().addScaledVector(forward,2),forward.clone().negate())
 let distance=Infinity,contact:Vector3|undefined
 actor.traverse(mesh=>{
  if(!(mesh instanceof SkinnedMesh)||!mesh.visible)return
  if(family==='chibi'&&mesh.name!=='character_low')return
  const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material]
  if(family==='city'&&materials.some(material=>/hair/i.test(material.name)))return
  const indices=mesh.geometry.index,skinIndex=mesh.geometry.attributes.skinIndex,skinWeight=mesh.geometry.attributes.skinWeight
  if(!indices||!skinIndex||!skinWeight)return
  const headBones=new Set(mesh.skeleton.bones.flatMap((bone,index)=>{
   let parent:Object3D|null=bone
   while(parent){if(parent===head)return [index];parent=parent.parent}
   return []
  }))
  if(!headBones.size)return
  mesh.skeleton.update()
  const vertices=new Map<number,Vector3|null>()
  const vertex=(index:number)=>{
   if(vertices.has(index))return vertices.get(index)
   let weight=0
   for(let slot=0;slot<4;slot++)if(headBones.has(skinIndex.getComponent(index,slot)))weight+=skinWeight.getComponent(index,slot)
   const point=weight>.5?mesh.getVertexPosition(index,new Vector3()).applyMatrix4(mesh.matrixWorld):null
   vertices.set(index,point);return point
  }
  for(let index=0;index<indices.count;index+=3){
   const a=vertex(indices.getX(index)),b=vertex(indices.getX(index+1)),c=vertex(indices.getX(index+2))
   if(!a||!b||!c)continue
   const hit=ray.intersectTriangle(a,b,c,false,new Vector3())
   if(hit&&hit.distanceToSquared(ray.origin)<distance){contact=hit;distance=hit.distanceToSquared(ray.origin)}
  }
 })
 if(!contact)return undefined
 return {head,point:head.worldToLocal(contact),forward:forward.applyQuaternion(head.getWorldQuaternion(new Quaternion()).invert())}
}

export function drinkCupRotation(handOffset:Vector3,tilt=0):Quaternion{
 return new Quaternion().setFromEuler(new Euler(tilt,Math.atan2(-handOffset.z,handOffset.x),0,'YXZ'))
}

export function drinkCupRimOffset(handOffset:Vector3,tilt:number,forward:Vector3):Vector3{
 // A round cup can meet the lips anywhere around its rim. Its handle points
 // diagonally back toward the wrist, so short Chibi arms need not cross a skull.
 return new Vector3(0,DRINK_CUP_RIM.height,0).addScaledVector(forward,-DRINK_CUP_RIM.radius).applyAxisAngle(handOffset.clone().normalize(),tilt)
}

/** The near upper rim, not the cup centre, meets the measured face surface. */
export function drinkSipCupCenter(anchor:DrinkMouthAnchor,handOffset:Vector3,tilt=0):Vector3{
 const surface=anchor.head.localToWorld(anchor.point.clone())
 const forward=anchor.forward.clone().applyQuaternion(anchor.head.getWorldQuaternion(new Quaternion()))
 const rim=drinkCupRimOffset(handOffset,tilt,forward)
 return surface.addScaledVector(forward,.004).sub(rim)
}
