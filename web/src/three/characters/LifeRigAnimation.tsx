import {useEffect,useMemo} from 'react'
import {useFrame,useLoader} from '@react-three/fiber'
import {AnimationMixer,FileLoader,LoopOnce,LoopRepeat,Vector3,type Group} from 'three'
import type {CharacterFamily} from './characterAssets'
import {retargetLifeMotion,type LifeMotion,type LifeMotionLibrary} from './lifeRetarget'
import {solveHandContact} from './handContact'

export function LifeRigAnimation({model,family,motion,paused=false,variation=0,attention=0,handTarget}:{model:Group;family:CharacterFamily;motion:LifeMotion;paused?:boolean;variation?:number;attention?:number;handTarget?:[number,number,number]}){
 const text=useLoader(FileLoader,'/assets/life/motions/kaykit-life.json') as string
 const library=useMemo(()=>JSON.parse(text) as LifeMotionLibrary,[text])
 const clip=useMemo(()=>retargetLifeMotion(library,model,family,motion),[library,model,family,motion])
 const mixer=useMemo(()=>new AnimationMixer(model),[model])
 useFrame((_,delta)=>{
  if(paused)return
  mixer.update(Math.min(delta,.05))
  const head=model.getObjectByName(family==='city'?'Head':'DEF-spine006')
  if(head&&attention)head.rotateY(attention)
  if(handTarget){
   const target=new Vector3(...handTarget)
   target.x+=Math.sin(mixer.time*2.4)*.035;target.z+=Math.cos(mixer.time*2.4)*.035
   solveHandContact(model,family,target)
  }
 })
 useEffect(()=>{
  const action=mixer.clipAction(clip)
  const once=['Sit_Chair_Down','Sit_Chair_StandUp','Waving','Chop'].includes(motion)
  action.reset().setLoop(once?LoopOnce:LoopRepeat,once?1:Infinity)
  action.clampWhenFinished=once
  action.setEffectiveTimeScale(.93+(variation%5)*.035).fadeIn(.28).play()
  if(paused)mixer.update(Math.min(clip.duration*.5,.8))
  return()=>{action.fadeOut(.2)}
 },[clip,mixer,motion,paused,variation])
 useEffect(()=>()=>{mixer.stopAllAction();mixer.uncacheRoot(model)},[mixer,model])
 return null
}
