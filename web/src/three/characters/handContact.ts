import {Object3D,Quaternion,Vector3} from 'three'
import type {CharacterFamily} from './characterAssets'

/** Short, rotation-only CCD correction. Bone lengths and skin scale never change. */
export function solveHandContact(model:Object3D,family:CharacterFamily,target:Vector3,weight=.8,iterations=3):void{
 const hand=model.getObjectByName(family==='city'?'HandR':'DEF-handR')
 const joints=(family==='city'?['ForeArmR','ArmR']:['DEF-forearmR','DEF-upper_armR']).map(name=>model.getObjectByName(name)).filter((value):value is Object3D=>Boolean(value))
 if(!hand||joints.length!==2)return
 model.updateWorldMatrix(true,true)
 const origin=new Vector3(),from=new Vector3(),to=new Vector3()
 const delta=new Quaternion(),parent=new Quaternion(),world=new Quaternion(),identity=new Quaternion()
 for(let iteration=0;iteration<iterations;iteration++){
  if(hand.getWorldPosition(from).distanceToSquared(target)<.000025)break
  for(const joint of joints){
  joint.getWorldPosition(origin)
  hand.getWorldPosition(from).sub(origin);to.copy(target).sub(origin)
  if(from.lengthSq()<1e-7||to.lengthSq()<1e-7)continue
  delta.setFromUnitVectors(from.normalize(),to.normalize())
  if(weight<1)delta.slerp(identity,1-weight)
  if(joint.parent)joint.parent.getWorldQuaternion(parent);else parent.identity()
  joint.getWorldQuaternion(world)
  joint.quaternion.copy(parent.invert().multiply(delta).multiply(world)).normalize()
  joint.updateWorldMatrix(false,true)
  }
 }
}

/** Seated feet retain the rig's lengths but rest on the visible floor, not in mid-air. */
export function groundSeatedFeet(model:Object3D,family:CharacterFamily,floorY:number,weight:number):void{
 const origin=new Vector3(),from=new Vector3(),to=new Vector3(),delta=new Quaternion(),parent=new Quaternion(),world=new Quaternion()
 for(const side of ['L','R']){
  const foot=model.getObjectByName(family==='city'?`Foot${side}`:`DEF-foot${side}`)
  const joints=(family==='city'?[`Leg${side}`,`UpperLeg${side}`]:[`DEF-shin${side}`,`DEF-thigh${side}`]).map(name=>model.getObjectByName(name)).filter((o):o is Object3D=>Boolean(o))
  if(!foot||joints.length!==2)continue
  model.updateWorldMatrix(true,true)
  const target=foot.getWorldPosition(new Vector3()),upper=joints[1].getWorldPosition(new Vector3())
  // Keep the ankle under the knee: copying the source's extended toe target can be
  // unreachable on the shorter toy-like legs and makes a seated resident float.
  target.x+=(upper.x-target.x)*weight*.8;target.z+=(upper.z-target.z)*weight*.65
  target.y+=(floorY-target.y)*weight
  for(let iteration=0;iteration<20;iteration++){
   if(foot.getWorldPosition(from).distanceToSquared(target)<.000025)break
   for(const joint of joints){
   joint.getWorldPosition(origin);foot.getWorldPosition(from).sub(origin);to.copy(target).sub(origin)
   if(from.lengthSq()<1e-7||to.lengthSq()<1e-7)continue
   delta.setFromUnitVectors(from.normalize(),to.normalize())
   if(joint.parent)joint.parent.getWorldQuaternion(parent);else parent.identity()
   joint.getWorldQuaternion(world)
   joint.quaternion.copy(parent.invert().multiply(delta).multiply(world)).normalize()
   joint.updateWorldMatrix(false,true)
   }
  }
 }
}
