import {Object3D,Quaternion,SkinnedMesh,Vector3} from 'three'
import type {CharacterFamily} from './characterAssets'

export type StandingTurnPose={
 root:Object3D
 /** Stable for one turn; a new arrival/departure must get a different key. */
 key:string
 startYaw:number
 endYaw:number
 /** Linear turn progress. Each foot gets its own eased swing, not a walk loop. */
 progress:number
}
type Side='L'|'R'
type Leg={side:Side;upper:Object3D;knee:Object3D;foot:Object3D;start:Vector3;end:Vector3;orientation:Quaternion;endOrientation:Quaternion;bendStart:Vector3;bendEnd:Vector3;initialSole:number}
type Turn={key:string;progress:number;initialProgress:number;startYaw:number;endYaw:number;first:Side;legs:Leg[]}
type TurnReference={key:string;progress:number;feet:{side:Side;end:Vector3;orientation:Quaternion}[]}
export type StandingTurnResult={pelvisDrop:number;feet:{side:Side;planted:boolean;lift:number;error:number;target:Vector3}[]}
const turns=new WeakMap<Object3D,Turn>()
const references=new WeakMap<Object3D,TurnReference>()
const up=new Vector3(0,1,0)
const ease=(t:number)=>{const v=Math.max(0,Math.min(1,t));return v*v*(3-2*v)}
const yawDelta=(a:number,b:number)=>Math.atan2(Math.sin(b-a),Math.cos(b-a))
const visible=(object:Object3D)=>{for(let node:Object3D|null=object;node;node=node.parent)if(!node.visible)return false;return true}

function soleHeight(model:Object3D,foot:Object3D):number{
 let y=Infinity;const point=new Vector3()
 model.traverse(object=>{
  if(!(object instanceof SkinnedMesh)||!visible(object))return
  const indices=object.geometry.attributes.skinIndex,weights=object.geometry.attributes.skinWeight
  if(!indices||!weights)return
  const members=new Set<number>()
  object.skeleton.bones.forEach((bone,index)=>{for(let node:Object3D|null=bone;node;node=node.parent)if(node===foot){members.add(index);break}})
  object.skeleton.update()
  for(let vertex=0;vertex<indices.count;vertex++){
   let weight=0
   for(let component=0;component<4;component++)if(members.has(indices.getComponent(vertex,component)))weight+=weights.getComponent(vertex,component)
   if(weight<.5)continue
   object.getVertexPosition(vertex,point).applyMatrix4(object.matrixWorld);y=Math.min(y,point.y)
  }
 })
 return y
}

/** Before the pose bridge, remember where the authored standing shoes should
 * finish. A final walking frame can have a 60cm stride; rotating that stride
 * would leave the resident in an unnatural wide lunge after the turn. */
export function prepareStandingTurn(model:Object3D,family:CharacterFamily,pose:StandingTurnPose):void{
 const previous=references.get(model)
 if(previous?.key===pose.key&&pose.progress>=previous.progress-.05){previous.progress=pose.progress;return}
 model.updateWorldMatrix(true,true)
 const origin=pose.root.getWorldPosition(new Vector3()),rotation=new Quaternion().setFromAxisAngle(up,yawDelta(pose.root.rotation.y,pose.endYaw))
 const feet:TurnReference['feet']=[]
 for(const side of ['L','R'] as const){
  const foot=model.getObjectByName(family==='city'?`Foot${side}`:`DEF-foot${side}`)
  if(!foot)continue
  const end=foot.getWorldPosition(new Vector3()).sub(origin).applyQuaternion(rotation).add(origin),sole=soleHeight(model,foot)
  if(Number.isFinite(sole))end.y+=origin.y-sole+.002
  feet.push({side,end,orientation:rotation.clone().multiply(foot.getWorldQuaternion(new Quaternion()))})
 }
 references.set(model,{key:pose.key,progress:pose.progress,feet})
}

function begin(model:Object3D,family:CharacterFamily,pose:StandingTurnPose):Turn{
 const origin=pose.root.getWorldPosition(new Vector3())
 const turnRotation=new Quaternion().setFromAxisAngle(up,yawDelta(pose.root.rotation.y,pose.endYaw)),reference=references.get(model)
 const legs:Leg[]=[]
 for(const side of ['L','R'] as const){
  const names=family==='city'?[`UpperLeg${side}`,`Leg${side}`,`Foot${side}`]:[`DEF-thigh${side}`,`DEF-shin${side}`,`DEF-foot${side}`]
  const [upper,knee,foot]=names.map(name=>model.getObjectByName(name))
  if(!upper||!knee||!foot)continue
  const start=foot.getWorldPosition(new Vector3())
  const sole=soleHeight(model,foot),rest=reference?.key===pose.key?reference.feet.find(value=>value.side===side):undefined
  const end=rest?.end.clone()??start.clone().sub(origin).applyQuaternion(turnRotation).add(origin)
  if(!rest&&Number.isFinite(sole))end.y+=origin.y-sole+.002
  const orientation=foot.getWorldQuaternion(new Quaternion())
  const hip=upper.getWorldPosition(new Vector3()),axis=start.clone().sub(hip).normalize()
  const forward=new Vector3(0,0,family==='city'?-1:1).applyQuaternion(model.getWorldQuaternion(new Quaternion()))
  const bendStart=knee.getWorldPosition(new Vector3()).sub(hip);bendStart.addScaledVector(axis,-bendStart.dot(axis))
  if(bendStart.lengthSq()<1e-6)bendStart.copy(forward)
  bendStart.normalize()
  legs.push({side,upper,knee,foot,start,end,orientation,endOrientation:rest?.orientation.clone()??turnRotation.clone().multiply(orientation),bendStart,bendEnd:forward.applyQuaternion(turnRotation).normalize(),initialSole:sole-origin.y})
 }
 // Put an already airborne shoe down first. Do not snap it to the floor on
 // the transition frame merely to satisfy a planted-foot test.
 const highest=[...legs].sort((a,b)=>b.initialSole-a.initialSole)[0]
 const first=highest?.initialSole>.012?highest.side:yawDelta(pose.startYaw,pose.endYaw)>0?'R':'L'
 return {key:pose.key,progress:pose.progress,initialProgress:pose.progress,startYaw:pose.startYaw,endYaw:pose.endYaw,first,legs}
}

function aim(joint:Object3D,from:Vector3,to:Vector3){
 if(from.lengthSq()<1e-10||to.lengthSq()<1e-10)return
 const delta=new Quaternion().setFromUnitVectors(from.normalize(),to.normalize())
 const parent=joint.parent?.getWorldQuaternion(new Quaternion())??new Quaternion()
 joint.quaternion.copy(parent.invert().multiply(delta).multiply(joint.getWorldQuaternion(new Quaternion()))).normalize()
 joint.updateWorldMatrix(false,true)
}

/** A bounded two-step standing turn. Evaluate AFTER the raw animation and pose
 * bridge, then save the resulting visible pose for the next clip transition.
 * The support shoe stays at a world-space anchor while the other rises and
 * turns; no bone is translated/scaled except the pelvis for weight transfer.
 * This is not general locomotion or a replacement for a dedicated turn clip.
 */
export function solveStandingTurn(model:Object3D,family:CharacterFamily,pose:StandingTurnPose):StandingTurnResult|undefined{
 if(![pose.startYaw,pose.endYaw,pose.progress].every(Number.isFinite))return
 const observedProgress=Math.max(0,Math.min(1,pose.progress)),angle=yawDelta(pose.startYaw,pose.endYaw)
 if(Math.abs(angle)<.035||Math.abs(angle)>Math.PI*.7)return
 const pelvis=model.getObjectByName(family==='city'?'Hips':'DEF-spine')
 if(!pelvis?.parent)return
 model.updateWorldMatrix(true,true)
 let state=turns.get(model)
 if(!state||state.key!==pose.key||Math.abs(state.startYaw-pose.startYaw)>.001||Math.abs(state.endYaw-pose.endYaw)>.001||observedProgress<state.progress-.05){state=begin(model,family,pose);turns.set(model,state)}
 if(state.legs.length!==2)return
 state.progress=observedProgress
 // React may switch the mixer one frame after the driver entered this beat.
 // Start from that actually visible frame, never rewind its feet to an
 // idealized p=0 and jump forward. Finish within the remaining turn time.
 const progress=Math.min(1,Math.max(0,(observedProgress-state.initialProgress)/Math.max(.00001,1-state.initialProgress)))
 const first=state.first,half=progress<.5?0:1,local=progress*2-half
 const swinging=half===0?first:first==='L'?'R':'L'
 const targets=state.legs.map(leg=>{
  const step=leg.side===first?Math.min(1,progress*2):Math.max(0,progress*2-1),weight=ease(step)
  const lift=.038*Math.pow(Math.sin(step*Math.PI),2)
  const target=leg.start.clone().lerp(leg.end,weight);target.y+=lift
  // Some native source shoes begin a few millimetres below the floor. Ease
  // that inherited contact error out vertically; never teleport the foot on
  // entry or slide its planted footprint sideways to disguise it.
  target.y+=Math.max(0,.002-leg.initialSole)*ease(progress/.18)*(1-weight)
  const rotation=leg.orientation.clone().slerp(leg.endOrientation,weight)
  return {leg,target,rotation,lift,planted:step===0||step===1}
 })
 const support=targets.find(value=>value.leg.side!==swinging)!
 const centre=pelvis.getWorldPosition(new Vector3()),shift=support.target.clone().sub(centre);shift.y=0
 // Carry the pelvis between the actual footprints while closing the last
 // walking stride. A fixed root centre otherwise needs a deep squat to reach
 // the old rear foot during the middle of the turn.
 const feetCentre=new Vector3(),sourceCentre=new Vector3()
 for(const {leg,target}of targets){feetCentre.addScaledVector(target,.5);sourceCentre.addScaledVector(leg.foot.getWorldPosition(new Vector3()),.5)}
 const transfer=feetCentre.sub(sourceCentre);transfer.y=0;transfer.clampLength(0,.11)
 centre.add(transfer)
 if(shift.lengthSq()>1e-8)centre.add(shift.normalize().multiplyScalar(.016*Math.sin(local*Math.PI)**2))
 // A slight yielding knee is essential: a straight leg cannot hold its ankle
 // fixed while the hip travels around it. Derive any extra drop from the real
 // two bone lengths instead of stretching or tolerating a sliding support foot.
 const requestedDrop=.028*Math.sin(progress*Math.PI)**2
 centre.y-=requestedDrop
 let extraDrop=0
 const oldPelvis=pelvis.getWorldPosition(new Vector3()),translation=centre.clone().sub(oldPelvis)
 for(const {leg,target}of targets){
  const hip=leg.upper.getWorldPosition(new Vector3()).add(translation),knee=leg.knee.getWorldPosition(new Vector3()),foot=leg.foot.getWorldPosition(new Vector3())
  const reach=leg.upper.getWorldPosition(new Vector3()).distanceTo(knee)+knee.distanceTo(foot)
  const horizontal=Math.hypot(target.x-hip.x,target.z-hip.z),height=Math.sqrt(Math.max(0,(reach*.999)**2-horizontal**2))
  extraDrop=Math.max(extraDrop,hip.y-target.y-height)
 }
 // The supported turn is only for a small standing adjustment, not a squat
 // or an arbitrary 180-degree pivot. Unknown extreme poses keep their source.
 if(extraDrop+requestedDrop>.13)return
 centre.y-=Math.max(0,extraDrop)
 pelvis.position.copy(pelvis.parent.worldToLocal(centre));model.updateWorldMatrix(true,true)
 const feet:StandingTurnResult['feet']=[]
 for(const {leg,target,rotation,lift,planted}of targets){
  const hip=leg.upper.getWorldPosition(new Vector3()),knee=leg.knee.getWorldPosition(new Vector3()),foot=leg.foot.getWorldPosition(new Vector3())
  const a=hip.distanceTo(knee),b=knee.distanceTo(foot),axis=target.clone().sub(hip),distance=Math.min(a+b-.00001,Math.max(.00001,axis.length()))
  axis.normalize()
  // A straightening raw idle knee has an almost-zero bend plane. Re-reading
  // it each frame flips that plane and whips the ankle despite a planted foot.
  // Carry the observed entrance bend toward the final facing continuously.
  const pole=leg.bendStart.clone().lerp(leg.bendEnd,ease(progress));pole.addScaledVector(axis,-pole.dot(axis))
  if(pole.lengthSq()<1e-8){pole.set(0,0,family==='city'?-1:1).applyQuaternion(model.getWorldQuaternion(new Quaternion()));pole.addScaledVector(axis,-pole.dot(axis))}
  pole.normalize()
  const along=(a*a-b*b+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,a*a-along*along))
  const desiredKnee=hip.clone().addScaledVector(axis,along).addScaledVector(pole,height)
  aim(leg.upper,knee.sub(hip),desiredKnee.sub(hip))
  const kneeNow=leg.knee.getWorldPosition(new Vector3())
  aim(leg.knee,leg.foot.getWorldPosition(new Vector3()).sub(kneeNow),target.clone().sub(kneeNow))
  const parent=leg.foot.parent?.getWorldQuaternion(new Quaternion())??new Quaternion()
  leg.foot.quaternion.copy(parent.invert().multiply(rotation)).normalize();leg.foot.updateWorldMatrix(false,true)
  feet.push({side:leg.side,planted,lift,error:leg.foot.getWorldPosition(new Vector3()).distanceTo(target),target})
 }
 return {pelvisDrop:requestedDrop+Math.max(0,extraDrop),feet}
}
