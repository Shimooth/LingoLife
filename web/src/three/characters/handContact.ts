import {Object3D,Quaternion,Vector3} from 'three'
import type {CharacterFamily} from './characterAssets'

/** Short, rotation-only CCD correction. Bone lengths and skin scale never change. */
export function solveHandContact(model:Object3D,family:CharacterFamily,target:Vector3,weight=.8):void{
 const hand=model.getObjectByName(family==='city'?'HandR':'DEF-handR')
 const joints=(family==='city'?['ForeArmR','ArmR']:['DEF-forearmR','DEF-upper_armR']).map(name=>model.getObjectByName(name)).filter((value):value is Object3D=>Boolean(value))
 if(!hand||joints.length!==2)return
 model.updateWorldMatrix(true,true)
 for(let iteration=0;iteration<3;iteration++)for(const joint of joints){
  const origin=joint.getWorldPosition(new Vector3())
  const from=hand.getWorldPosition(new Vector3()).sub(origin),to=target.clone().sub(origin)
  if(from.lengthSq()<1e-7||to.lengthSq()<1e-7)continue
  const delta=new Quaternion().setFromUnitVectors(from.normalize(),to.normalize())
  delta.slerp(new Quaternion(),1-weight)
  const parent=joint.parent?.getWorldQuaternion(new Quaternion())??new Quaternion()
  const world=joint.getWorldQuaternion(new Quaternion())
  joint.quaternion.copy(parent.invert().multiply(delta).multiply(world)).normalize()
  joint.updateWorldMatrix(false,true)
 }
}
