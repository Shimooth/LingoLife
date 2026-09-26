import {Object3D,Quaternion,Vector3} from 'three'
import type {CharacterFamily} from './characterAssets'

export type HandContactState={bendDirection:Vector3;initialized:boolean}
export const createHandContactState=():HandContactState=>({bendDirection:new Vector3(),initialized:false})
export type NaturalHandContactOptions={
 /** Whole-contact blend, normally eased by the performance's reach/release. */
 weight?:number
 /** World-space point toward which the right elbow bends. */
 pole?:Vector3
 poleWeight?:number
 /** World hand orientation, NOT a cup quaternion without a calibrated offset. */
 wristWorldQuaternion?:Quaternion
 wristWeight?:number
 state?:HandContactState
}
export type NaturalHandContactResult={
 reachable:boolean;requestedDistance:number;clampedDistance:number;error:number
 clampedError:number;elbowAngle:number;appliedWeight:number
}
type ArmRig={family:CharacterFamily;arm:Object3D;forearm:Object3D;hand:Object3D;opposite?:Object3D;state:HandContactState}
const rigs=new WeakMap<Object3D,ArmRig>()
const finiteVector=(value:Vector3)=>[value.x,value.y,value.z].every(Number.isFinite)
const boundedWeight=(value:number|undefined,fallback=1)=>Number.isFinite(value)?Math.max(0,Math.min(1,value!)):fallback

const armRig=(model:Object3D,family:CharacterFamily):ArmRig|undefined=>{
 const cached=rigs.get(model)
 if(cached?.family===family)return cached
 const names=family==='city'?['ArmR','ForeArmR','HandR','ArmL']:['DEF-upper_armR','DEF-forearmR','DEF-handR','DEF-upper_armL']
 const [arm,forearm,hand,opposite]=names.map(name=>model.getObjectByName(name))
 if(!arm||!forearm||!hand)return undefined
 const rig={family,arm,forearm,hand,opposite,state:createHandContactState()};rigs.set(model,rig);return rig
}

const projectBend=(direction:Vector3,axis:Vector3)=>direction.addScaledVector(axis,-direction.dot(axis))

/** Rotate only the joint; even Chibi's intermediate twist bones retain every
 * authored translation and scale. The effective two segment lengths are read
 * from the current real pose instead of assuming either kit's bind axes. */
const aimJoint=(joint:Object3D,child:Object3D,target:Vector3)=>{
 const origin=joint.getWorldPosition(new Vector3())
 const from=child.getWorldPosition(new Vector3()).sub(origin),to=target.clone().sub(origin)
 if(from.lengthSq()<1e-12||to.lengthSq()<1e-12)return
 const delta=new Quaternion().setFromUnitVectors(from.normalize(),to.normalize())
 const world=joint.getWorldQuaternion(new Quaternion())
 const parent=joint.parent?.getWorldQuaternion(new Quaternion())??new Quaternion()
 joint.quaternion.copy(parent.invert().multiply(delta).multiply(world)).normalize()
 joint.updateWorldMatrix(false,true)
}

/** Rotation-only, pole-stabilized right arm contact. Unlike CCD, two links
 * have one deliberate bend plane instead of finding a different elbow fold
 * each frame. Targets beyond the physical reach are clamped, never stretched.
 * It is hand/arm IK only: no finger closure, shoulder translation or torso IK.
 */
export function solveNaturalHandContact(model:Object3D,family:CharacterFamily,target:Vector3,options:NaturalHandContactOptions={}):NaturalHandContactResult|undefined{
 const rig=armRig(model,family)
 if(!rig||!finiteVector(target))return undefined
 const {arm,forearm,hand}=rig,weight=boundedWeight(options.weight),state=options.state??rig.state
 model.updateWorldMatrix(true,true)
 const shoulder=arm.getWorldPosition(new Vector3()),elbow=forearm.getWorldPosition(new Vector3()),palm=hand.getWorldPosition(new Vector3())
 const upperLength=shoulder.distanceTo(elbow),lowerLength=elbow.distanceTo(palm)
 if(upperLength<1e-5||lowerLength<1e-5)return undefined
 const request=target.clone().sub(shoulder),requestedDistance=request.length()
 const axis=requestedDistance>1e-7?request.clone().divideScalar(requestedDistance):palm.clone().sub(shoulder).normalize()
 if(axis.lengthSq()<.5)axis.set(0,0,1)
 const minReach=Math.abs(upperLength-lowerLength)+1e-5,maxReach=upperLength+lowerLength-1e-5
 const clampedDistance=Math.max(minReach,Math.min(maxReach,requestedDistance)),clampedTarget=shoulder.clone().addScaledVector(axis,clampedDistance)
 const reachable=requestedDistance>=minReach-1e-5&&requestedDistance<=maxReach+1e-5
 const elbowAngle=Math.acos(Math.max(-1,Math.min(1,(upperLength**2+lowerLength**2-clampedDistance**2)/(2*upperLength*lowerLength))))
 if(weight===0)return {reachable,requestedDistance,clampedDistance,error:palm.distanceTo(target),clampedError:palm.distanceTo(clampedTarget),elbowAngle,appliedWeight:0}

 const authoredBend=projectBend(elbow.clone().sub(shoulder),axis)
 const previous=state.initialized?projectBend(state.bendDirection.clone(),axis):new Vector3()
 const side=rig.opposite?shoulder.clone().sub(rig.opposite.getWorldPosition(new Vector3())).normalize():new Vector3(-1,0,0)
 const pole=options.pole&&finiteVector(options.pole)?options.pole.clone().sub(shoulder):side.multiplyScalar(.4).add(new Vector3(0,-.8,0))
 const preferred=projectBend(pole,axis)
 // At the pole/target singularity, preserve the last valid plane instead of
 // changing sign as the target crosses a nearly straight shoulder axis.
 if(preferred.lengthSq()<.0001){
  if(previous.lengthSq()>.0001)preferred.copy(previous)
  else if(authoredBend.lengthSq()>.0001)preferred.copy(authoredBend)
  else projectBend(preferred.set(Math.abs(axis.y)<.8?0:1,Math.abs(axis.y)<.8?-1:0,0),axis)
 }
 preferred.normalize()
 const bend=authoredBend.lengthSq()>.000001?authoredBend.normalize():previous.lengthSq()>.000001?previous.normalize():preferred.clone()
 const angle=Math.atan2(new Vector3().crossVectors(bend,preferred).dot(axis),Math.max(-1,Math.min(1,bend.dot(preferred))))
 bend.applyAxisAngle(axis,angle*boundedWeight(options.poleWeight)).normalize()
 state.bendDirection.copy(bend);state.initialized=true
 const along=(upperLength**2-lowerLength**2+clampedDistance**2)/(2*clampedDistance)
 const height=Math.sqrt(Math.max(0,upperLength**2-along**2))
 const elbowTarget=shoulder.clone().addScaledVector(axis,along).addScaledVector(bend,height)
 const originalArm=arm.quaternion.clone(),originalForearm=forearm.quaternion.clone(),originalHand=hand.quaternion.clone()
 aimJoint(arm,forearm,elbowTarget)
 aimJoint(forearm,hand,clampedTarget)
 const wrist=options.wristWorldQuaternion
 if(wrist&&wrist.toArray().every(Number.isFinite)&&wrist.lengthSq()>1e-8){
  const parent=hand.parent?.getWorldQuaternion(new Quaternion())??new Quaternion()
  const desired=parent.invert().multiply(wrist.clone().normalize())
  hand.quaternion.slerp(desired,boundedWeight(options.wristWeight)).normalize()
 }
 const solvedArm=arm.quaternion.clone(),solvedForearm=forearm.quaternion.clone(),solvedHand=hand.quaternion.clone()
 arm.quaternion.copy(originalArm).slerp(solvedArm,weight).normalize()
 forearm.quaternion.copy(originalForearm).slerp(solvedForearm,weight).normalize()
 hand.quaternion.copy(originalHand).slerp(solvedHand,weight).normalize()
 model.updateWorldMatrix(true,true)
 const actual=hand.getWorldPosition(new Vector3())
 return {reachable,requestedDistance,clampedDistance,error:actual.distanceTo(target),clampedError:actual.distanceTo(clampedTarget),elbowAngle,appliedWeight:weight}
}

/** Call once AFTER the reach pose has been solved, while the cup is still.
 * This captures the actual rig's posed hand, not a guessed City/Chibi Euler.
 * Re-capture for a new grasp. It preserves a grip, but does not invent fingers. */
export function captureHandGripOffset(model:Object3D,family:CharacterFamily,cupWorldQuaternion:Quaternion):Quaternion|undefined{
 const rig=armRig(model,family)
 if(!rig||!cupWorldQuaternion.toArray().every(Number.isFinite)||cupWorldQuaternion.lengthSq()<1e-8)return undefined
 model.updateWorldMatrix(true,true)
 return cupWorldQuaternion.clone().normalize().invert().multiply(rig.hand.getWorldQuaternion(new Quaternion())).normalize()
}

export const handOrientationForGrip=(cupWorldQuaternion:Quaternion,gripOffset:Quaternion):Quaternion=>cupWorldQuaternion.clone().multiply(gripOffset).normalize()
