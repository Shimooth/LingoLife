import {useEffect,useMemo,useRef} from 'react'
import {useFrame,useLoader} from '@react-three/fiber'
import {AnimationMixer,FileLoader,LoopOnce,LoopRepeat,Vector3,Quaternion,type Group} from 'three'
import type {CharacterFamily} from './characterAssets'
import {retargetLifeMotion,type LifeMotion,type LifeMotionLibrary} from './lifeRetarget'
import {solveHandContact,groundSeatedFeet} from './handContact'
import type {Character3DProps} from './types'

export function LifeRigAnimation({model,family,motion,paused=false,variation=0,attention=0,handTarget,performancePose}:{model:Group;family:CharacterFamily;motion:LifeMotion;paused?:boolean;variation?:number;attention?:number;handTarget?:[number,number,number];performancePose?:Character3DProps['lifePerformancePose']}){
 const text=useLoader(FileLoader,'/assets/life/motions/kaykit-life.json') as string
 const library=useMemo(()=>JSON.parse(text) as LifeMotionLibrary,[text])
 const clip=useMemo(()=>retargetLifeMotion(library,model,family,motion),[library,model,family,motion])
 const mixer=useMemo(()=>new AnimationMixer(model),[model])
 const corrections=useMemo(()=>{
  const names=family==='city'?['Hips','Torso','Head','ArmR','ForeArmR','UpperLegL','LegL','UpperLegR','LegR']:
   ['DEF-spine','DEF-spine001','DEF-spine006','DEF-upper_armR','DEF-forearmR','DEF-thighL','DEF-shinL','DEF-thighR','DEF-shinR']
  return names.flatMap(name=>{const node=model.getObjectByName(name);return node?[{node,position:node.position.clone(),quaternion:node.quaternion.clone()}]:[]})
 },[model,family])
 const corrected=useRef(false)
 useFrame((_,delta)=>{
  if(paused&&!performancePose)return
  // Mixer caches constant tracks; undo last frame's additive corrections before
  // evaluating it, otherwise a held pose can accumulate lean/IK indefinitely.
  if(corrected.current)for(const saved of corrections){saved.node.position.copy(saved.position);saved.node.quaternion.copy(saved.quaternion)}
  if(performancePose)mixer.setTime(Math.max(0,Math.min(performancePose.time,clip.duration-.0001)))
  else mixer.update(Math.min(delta,.05))
  corrected.current=Boolean(performancePose)
  if(performancePose)for(const saved of corrections){saved.position.copy(saved.node.position);saved.quaternion.copy(saved.node.quaternion)}
  // Pin the pelvis to the real cushion, preserving the original skeleton lengths.
  // Blend the correction during sit/stand; don't move a standing character onto a seat.
  if(performancePose?.seatHeight!==undefined){
   const pelvis=model.getObjectByName(family==='city'?'Hips':'DEF-spine')
   if(pelvis?.parent){
    model.updateWorldMatrix(true,true)
    const point=pelvis.getWorldPosition(new Vector3()),scale=pelvis.getWorldScale(new Vector3())
    const desired=performancePose.seatHeight+(family==='city'?.082:.07)*Math.abs(scale.y)
    const corrected=point.clone();corrected.y+=(desired-point.y)*(performancePose.seatWeight??1)
    pelvis.position.copy(pelvis.parent.worldToLocal(corrected))
    model.updateWorldMatrix(true,true)
    groundSeatedFeet(model,family,model.getWorldPosition(new Vector3()).y+.11,performancePose.seatWeight??1)
   }
  }
  if(performancePose?.bodyLean){
   const torso=model.getObjectByName(family==='city'?'Torso':'DEF-spine001')
   if(torso?.parent){
    const axis=new Vector3(family==='city'?-1:1,0,0).applyQuaternion(model.getWorldQuaternion(new Quaternion()))
    const world=torso.getWorldQuaternion(new Quaternion()),parent=torso.parent.getWorldQuaternion(new Quaternion())
    torso.quaternion.copy(parent.invert().multiply(new Quaternion().setFromAxisAngle(axis,performancePose.bodyLean)).multiply(world)).normalize()
    model.updateWorldMatrix(true,true)
   }
  }
  const head=model.getObjectByName(family==='city'?'Head':'DEF-spine006')
  if(head&&attention)head.rotateY(attention)
  const contact=performancePose?.handTarget??handTarget
  if(contact){
   const target=new Vector3(...contact)
   if(!performancePose){target.x+=Math.sin(mixer.time*2.4)*.035;target.z+=Math.cos(mixer.time*2.4)*.035}
   solveHandContact(model,family,target,performancePose?1:.8,performancePose?30:3)
  }
 })
 useEffect(()=>{
  if(corrected.current)for(const saved of corrections){saved.node.position.copy(saved.position);saved.node.quaternion.copy(saved.quaternion)}
  corrected.current=false
  const action=mixer.clipAction(clip)
  const once=['Sit_Chair_Down','Sit_Chair_StandUp','Waving','Chop'].includes(motion)
  action.reset().setLoop(once?LoopOnce:LoopRepeat,once?1:Infinity)
  action.clampWhenFinished=once
  action.setEffectiveTimeScale(performancePose?1:.93+(variation%5)*.035).fadeIn(performancePose?0:.28).play()
  if(performancePose)mixer.setTime(Math.max(0,Math.min(performancePose.time,clip.duration-.0001)))
  if(paused)mixer.update(Math.min(clip.duration*.5,.8))
  return()=>{action.fadeOut(.2)}
 },[clip,mixer,motion,paused,variation,performancePose,corrections])
 useEffect(()=>()=>{mixer.stopAllAction();mixer.uncacheRoot(model)},[mixer,model])
 return null
}
