import {useEffect,useMemo,useRef} from 'react'
import {useFrame,useLoader} from '@react-three/fiber'
import {AnimationMixer,FileLoader,LoopOnce,LoopRepeat,Vector3,Quaternion,type Group} from 'three'
import type {CharacterFamily} from './characterAssets'
import {retargetLifeMotion,type LifeMotion,type LifeMotionLibrary} from './lifeRetarget'
import {solveHandContact} from './handContact'
import {solveSeatedContact} from './seatedContact'
import type {Character3DProps} from './types'
import {rigPoseContinuity,sampleAnimationTime} from './animationContinuity'
import {solveNaturalHandContact} from './naturalHandContact'
import {applySocialPerformance,type SocialPerformance} from './socialPerformance'
import {prepareStandingTurn,solveStandingTurn} from './standingTurn'

export function LifeRigAnimation({model,family,motion,paused=false,variation=0,attention=0,handTarget,performancePose,socialPerformance}:{model:Group;family:CharacterFamily;motion:LifeMotion;paused?:boolean;variation?:number;attention?:number;handTarget?:[number,number,number];performancePose?:Character3DProps['lifePerformancePose'];socialPerformance?:SocialPerformance}){
 const text=useLoader(FileLoader,'/assets/life/motions/kaykit-life.json') as string
 const library=useMemo(()=>JSON.parse(text) as LifeMotionLibrary,[text])
 const clip=useMemo(()=>retargetLifeMotion(library,model,family,motion),[library,model,family,motion])
 const mixer=useMemo(()=>new AnimationMixer(model),[model])
 const continuity=useMemo(()=>rigPoseContinuity(model),[model])
 const action=useMemo(()=>mixer.clipAction(clip),[mixer,clip])
 const previousTurn=useRef<{key:string;progress:number}|undefined>(undefined)
 const once=['Sit_Chair_Down','Sit_Chair_StandUp','Waving','Chop'].includes(motion)
 useFrame((_,delta)=>{
  if(paused&&!performancePose)return
  // The driver can publish the next clip/time one RAF before React commits
  // that clip. Keep the last rendered pose instead of sampling the old clip
  // with the new clock (including a transition back to native locomotion).
  if(performancePose&&'motion' in performancePose&&performancePose.motion!==motion)return
  const step=Math.min(delta,.1)
  continuity.restoreAnimation()
  if(performancePose){
   action.time=sampleAnimationTime(performancePose.time,clip.duration,once)
   action.paused=false;action.enabled=true
   mixer.update(0)
  }else{
   action.setEffectiveTimeScale(.93+(variation%5)*.035)
   mixer.update(step)
  }
  continuity.saveAnimation()
  // Observe the evaluated source pose before lean/look/IK and transition
  // blending. Anatomical anchors must not be calibrated from a reaching pose.
  if(performancePose?.onBasePose){
   model.updateWorldMatrix(true,true)
   performancePose.onBasePose()
  }
  applySocialPerformance(model,socialPerformance,step,paused)
  // Support the visible seated body, not an arbitrary pelvis-pivot offset.
  // Feet may hang from a high chair; forcing them down would straighten the thighs.
  if(performancePose?.seatHeight!==undefined){
   solveSeatedContact(model,family,{seatHeight:performancePose.seatHeight,floorY:model.getWorldPosition(new Vector3()).y,weight:performancePose.seatWeight??1})
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
  if(head){
   const yaw=attention+(performancePose?.headYaw??0),pitch=performancePose?.headPitch??0
   if(yaw)head.rotateY(yaw)
   if(pitch)head.rotateX(pitch)
  }
  const contact=performancePose?.handTarget??handTarget
  if(contact){
   const target=new Vector3(...contact)
   if(!performancePose){target.x+=Math.sin(mixer.time*2.4)*.035;target.z+=Math.cos(mixer.time*2.4)*.035}
   if(performancePose)solveNaturalHandContact(model,family,target,{
    weight:performancePose.handWeight??1,
    pole:performancePose.handPole?new Vector3(...performancePose.handPole):undefined,
    wristWorldQuaternion:performancePose.handQuaternion?new Quaternion(...performancePose.handQuaternion):undefined,
    wristWeight:performancePose.handWristWeight,
   })
   else solveHandContact(model,family,target,.8,3)
  }
  const turn=!paused?performancePose?.standingTurn:undefined
  const startingTurn=Boolean(turn&&(!previousTurn.current||previousTurn.current.key!==turn.key||turn.progress<previousTurn.current.progress-.05))
  if(turn)prepareStandingTurn(model,family,turn)
  // Anchor the actual last visible shoes before advancing the walk→stand
  // crossfade; even one blended frame can push a planted sole below the floor.
  continuity.finish(startingTurn?0:step,paused)
  if(turn){
   solveStandingTurn(model,family,turn)
   continuity.saveVisible()
  }
  previousTurn.current=turn?{key:turn.key,progress:turn.progress}:undefined
 },-2)
 useEffect(()=>{
  continuity.begin(.22)
  mixer.stopAllAction()
  continuity.restoreAnimation()
  action.reset().setLoop(once?LoopOnce:LoopRepeat,once?1:Infinity)
  action.clampWhenFinished=once
  action.setEffectiveTimeScale(1).setEffectiveWeight(1).play()
  mixer.update(0)
  continuity.saveAnimation()
  continuity.finish(0)
 },[action,continuity,mixer,once])
 useEffect(()=>()=>{mixer.stopAllAction();mixer.uncacheRoot(model);continuity.restoreVisible()},[continuity,mixer,model])
 return null
}
