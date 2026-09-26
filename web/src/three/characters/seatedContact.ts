import {Object3D,Quaternion,SkinnedMesh,Vector3} from 'three'
import type {CharacterFamily} from './characterAssets'

type Surface={mesh:SkinnedMesh;vertices:number[]}
type Leg={side:'L'|'R';upper:Object3D;knee:Object3D;foot:Object3D;sole:Surface[]}
type SeatedRig={pelvis:Object3D;support:Surface[];legs:Leg[]}
export type SeatedContactOptions={seatHeight:number;floorY:number;weight?:number}
export type SeatedContactResult={
 supportSource:'skin'|'fallback';supportY:number;supportError:number;pelvisDeltaY:number
 legs:{side:'L'|'R';thighElevation:number;kneeAngle:number;soleY:number;footClearance:number}[]
}
const rigs=new WeakMap<Object3D,SeatedRig>()
const visible=(object:Object3D)=>{for(let node:Object3D|null=object;node;node=node.parent)if(!node.visible)return false;return true}
const descendants=(bone:Object3D|undefined,ancestor:Object3D)=>{for(let node=bone;node;node=node.parent??undefined)if(node===ancestor)return true;return false}

/** Cache topology, not a magic pelvis offset or one particular animated pose.
 * The Chibi wardrobe contains hidden alternatives; none may set its seat/sole. */
function rigFor(model:Object3D,family:CharacterFamily):SeatedRig|undefined{
 const cached=rigs.get(model);if(cached)return cached
 const pelvis=model.getObjectByName(family==='city'?'Hips':'DEF-spine');if(!pelvis?.parent)return
 const legs:Leg[]=[]
 for(const side of ['L','R'] as const){
  const upper=model.getObjectByName(family==='city'?`UpperLeg${side}`:`DEF-thigh${side}`)
  const knee=model.getObjectByName(family==='city'?`Leg${side}`:`DEF-shin${side}`)
  const foot=model.getObjectByName(family==='city'?`Foot${side}`:`DEF-foot${side}`)
  if(upper&&knee&&foot)legs.push({side,upper,knee,foot,sole:[]})
 }
 const support:Surface[]=[]
 model.traverse(object=>{
  if(!(object instanceof SkinnedMesh))return
  const indices=object.geometry.attributes.skinIndex,weights=object.geometry.attributes.skinWeight
  if(!indices||!weights)return
  const pelvicIndices=new Set(object.skeleton.bones.flatMap((bone,index)=>bone===pelvis||family==='chibi'&&/^DEF-pelvis[LR]$/.test(bone.name)||legs.some(leg=>bone===leg.upper)||family==='chibi'&&/^DEF-thigh[LR](?:001)?$/.test(bone.name)?[index]:[]))
  const footIndices=legs.map(leg=>new Set(object.skeleton.bones.flatMap((bone,index)=>descendants(bone,leg.foot)?[index]:[])))
  const supportVertices:number[]=[],soleVertices=legs.map(()=>[] as number[])
  for(let vertex=0;vertex<indices.count;vertex++){
   let pelvicWeight=0;const footWeights=legs.map(()=>0)
   for(let component=0;component<4;component++){
    const index=indices.getComponent(vertex,component),weight=weights.getComponent(vertex,component)
    if(pelvicIndices.has(index))pelvicWeight+=weight
    footIndices.forEach((set,leg)=>{if(set.has(index))footWeights[leg]+=weight})
   }
   // Include the butt-to-thigh transition, which Chibi weights mostly to its
   // upper legs. Body skin is the support, never an optional skirt's hem.
   if(pelvicWeight>=.5&&(family==='city'||object.name==='character_low'))supportVertices.push(vertex)
   footWeights.forEach((weight,leg)=>{if(weight>=.5)soleVertices[leg].push(vertex)})
  }
  if(supportVertices.length)support.push({mesh:object,vertices:supportVertices})
  soleVertices.forEach((vertices,index)=>{if(vertices.length)legs[index].sole.push({mesh:object,vertices})})
 })
 const rig={pelvis,support,legs};rigs.set(model,rig);return rig
}

function surfaceMin(surfaces:Surface[],accept?:(point:Vector3)=>boolean):number{
 let minimum=Infinity
 const point=new Vector3()
 for(const {mesh,vertices}of surfaces){
  if(!visible(mesh))continue
  mesh.skeleton.update()
  for(const vertex of vertices){
   mesh.getVertexPosition(vertex,point).applyMatrix4(mesh.matrixWorld)
   if(!accept||accept(point))minimum=Math.min(minimum,point.y)
  }
 }
 return minimum
}

/** Seat contact has priority over foot planting. Preserve the authored forward
 * thighs, and allow a short resident's feet to hang. Only a penetrating shoe is
 * lifted by bending its knee; there is no hip CCD and no bone stretching.
 * Call after sampling/restoring raw animation, before torso lean and hand IK.
 * floorY is the real floor, NOT the old ankle target (.11).
 */
export function solveSeatedContact(model:Object3D,family:CharacterFamily,{seatHeight,floorY,weight=1}:SeatedContactOptions):SeatedContactResult|undefined{
 const rig=rigFor(model,family);if(!rig||!Number.isFinite(seatHeight)||!Number.isFinite(floorY))return
 const blend=Number.isFinite(weight)?Math.max(0,Math.min(1,weight)):0
 model.updateWorldMatrix(true,true)
 const pelvis=rig.pelvis,hip=pelvis.getWorldPosition(new Vector3()),scale=Math.abs(pelvis.getWorldScale(new Vector3()).y)
 const forward=new Vector3(0,0,family==='city'?-1:1).applyQuaternion(model.getWorldQuaternion(new Quaternion()));forward.y=0;forward.normalize()
 // A seat supports the butt AND the proximal thighs. A posterior-only plane
 // misses Chibi's low butt/thigh skin just 22mm in front of the pelvis and lets
 // it sink through the cushion. Stop before the knee/unsupported thigh front.
 // Project along each actual femur, so this region stays proximal while sitting
 // down as well, rather than selecting the whole vertical standing leg.
 const bands=rig.legs.map(leg=>{
  const origin=leg.upper.getWorldPosition(new Vector3()),axis=leg.knee.getWorldPosition(new Vector3()).sub(origin),length=axis.length()
  return {origin,axis:axis.normalize(),length}
 })
 const seatBand=(point:Vector3)=>{
  let nearest=bands[0],distance=Infinity
  for(const band of bands){const value=point.distanceToSquared(band.origin);if(value<distance){nearest=band;distance=value}}
  return !nearest||point.clone().sub(nearest.origin).dot(nearest.axis)<=nearest.length*.45
 }
 let supportY=surfaceMin(rig.support,seatBand),supportSource:'skin'|'fallback'='skin'
 if(!Number.isFinite(supportY)){
  supportSource='fallback'
  // Unknown/unskinned models retain a conservative anatomical approximation;
  // shipped City/Chibi models are required by tests to use real skin instead.
  supportY=hip.y-(family==='city'?.082:.07)*scale
 }
 const pelvisDeltaY=(seatHeight-supportY)*blend
 if(pelvisDeltaY){const target=hip.clone();target.y+=pelvisDeltaY;pelvis.position.copy(pelvis.parent!.worldToLocal(target));model.updateWorldMatrix(true,true)}
 supportY+=pelvisDeltaY
 const results:SeatedContactResult['legs']=[]
 for(const leg of rig.legs){
  const soleHeight=()=>{
   const surface=surfaceMin(leg.sole)
   return Number.isFinite(surface)?surface:leg.foot.getWorldPosition(new Vector3()).y-.1*scale
  }
  const originalSole=soleHeight(),wantedSole=originalSole+(floorY-originalSole)*blend
  // Keep the source shoe orientation while flexing the knee. A dangling shoe
  // must not be pulled down, nor may the thigh be sacrificed to reach a floor.
  if(originalSole<floorY-.001&&blend>0){
   const footWorld=leg.foot.getWorldQuaternion(new Quaternion())
   for(let iteration=0;iteration<8;iteration++){
    const missing=wantedSole-soleHeight();if(missing<.001)break
    const origin=leg.knee.getWorldPosition(new Vector3()),from=leg.foot.getWorldPosition(new Vector3()).sub(origin),length=from.length()
    if(length<1e-5)break
    // Solve on the shin's fixed-length sphere. Normalizing a vertically raised
    // target alone cannot lift an exactly vertical shin at all.
    const target=new Vector3(from.x,0,from.z)
    if(target.lengthSq()<1e-10)target.copy(forward)
    const y=Math.max(-length,Math.min(length,from.y+missing))
    target.normalize().multiplyScalar(Math.sqrt(Math.max(0,length*length-y*y)));target.y=y
    const delta=new Quaternion().setFromUnitVectors(from.normalize(),target.normalize())
    const world=leg.knee.getWorldQuaternion(new Quaternion()),parent=leg.knee.parent?.getWorldQuaternion(new Quaternion())??new Quaternion()
    leg.knee.quaternion.copy(parent.invert().multiply(delta).multiply(world)).normalize();model.updateWorldMatrix(true,true)
    const footParent=leg.foot.parent?.getWorldQuaternion(new Quaternion())??new Quaternion()
    leg.foot.quaternion.copy(footParent.invert().multiply(footWorld)).normalize();model.updateWorldMatrix(true,true)
   }
  }
  const upper=leg.upper.getWorldPosition(new Vector3()),knee=leg.knee.getWorldPosition(new Vector3()),ankle=leg.foot.getWorldPosition(new Vector3())
  const thigh=knee.clone().sub(upper),shin=ankle.clone().sub(knee),soleY=soleHeight()
  results.push({side:leg.side,thighElevation:Math.atan2(thigh.y,Math.hypot(thigh.x,thigh.z)),kneeAngle:thigh.clone().negate().angleTo(shin),soleY,footClearance:soleY-floorY})
 }
 return {supportSource,supportY,supportError:supportY-seatHeight,pelvisDeltaY,legs:results}
}
