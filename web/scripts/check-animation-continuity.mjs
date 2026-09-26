import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {AnimationMixer,LoopRepeat,MeshStandardMaterial} from 'three'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {clone} from 'three/examples/jsm/utils/SkeletonUtils.js'
import {RigPoseContinuity,advanceAnimationSpeed,sampleAnimationTime} from '../src/three/characters/animationContinuity.ts'
import {retargetLifeMotion} from '../src/three/characters/lifeRetarget.ts'
import {clipsForModel} from '../src/three/characters/characterModel.ts'

const loader=new GLTFLoader().register(()=>({name:'continuity_test_material',loadMaterial:()=>Promise.resolve(new MeshStandardMaterial())}))
const load=async path=>{const bytes=readFileSync(new URL(`../public/assets/models/characters/${path}`,import.meta.url));return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')}
const [city,chibi,cityAnimations]=await Promise.all([load('city/Character_1_2_2.glb'),load('chibi/all-in-one.glb'),load('city/animations/animations.glb')])
const library=JSON.parse(readFileSync(new URL('../public/assets/life/motions/kaykit-life.json',import.meta.url)))
const snapshot=model=>{const pose=[];model.traverse(node=>{if(node.isBone)pose.push({name:node.name,position:node.position.clone(),quaternion:node.quaternion.clone()})});return pose}
const difference=(a,b)=>Math.max(...a.map((pose,index)=>Math.max(pose.position.distanceTo(b[index].position),pose.quaternion.clone().normalize().angleTo(b[index].quaternion.clone().normalize()))))
const summaries=[]

assert.equal(sampleAnimationTime(9.5,3),.5)
assert.ok(sampleAnimationTime(9.5,3,true)>2.99)
assert.equal(sampleAnimationTime(-1,3),0)
assert.equal(sampleAnimationTime(Infinity,3),0)
const advances=[]
for(const fps of [15,30,60]){
 let speed=.15,time=0
 for(let frame=0;frame<fps*2;frame++){
  const step=advanceAnimationSpeed(speed,frame<fps?1.45:.35,1/fps)
  speed=step.speed;time+=step.average/fps
 }
 advances.push(time)
}
assert.ok(Math.max(...advances)-Math.min(...advances)<1e-10,'speed changes integrate identically at 15/30/60fps')

for(const [family,asset] of [['city',city],['chibi',chibi]]){
 const model=clone(asset.scene),bridge=new RigPoseContinuity(model)
 const nativeClips=family==='city'?clipsForModel(cityAnimations.animations,model):asset.animations
 const nativeClip=nativeClips.find(clip=>clip.name===(family==='city'?'Walk_C':'anim_walk'))
 const lifeClip=retargetLifeMotion(library,model,family,'Sit_Chair_Idle')
 assert.ok(nativeClip?.tracks.length&&lifeClip.tracks.length)
 let mixer=new AnimationMixer(model),action=mixer.clipAction(nativeClip).setLoop(LoopRepeat,Infinity).play()
 const evaluate=(time,delta=0,immediate=false)=>{
  bridge.restoreAnimation();action.time=sampleAnimationTime(time,action.getClip().duration);mixer.update(0)
  bridge.saveAnimation();bridge.finish(delta,immediate);return snapshot(model)
 }
 const native=evaluate(.37)
 bridge.begin(.22);mixer.stopAllAction();mixer.uncacheRoot(model);bridge.restoreVisible()
 assert.ok(difference(native,snapshot(model))<1e-6,'native mixer cleanup must preserve the last displayed pose')
 mixer=new AnimationMixer(model);action=mixer.clipAction(lifeClip).setLoop(LoopRepeat,Infinity).play()
 assert.ok(difference(native,evaluate(.14))<1e-6,'first native→life pose must be exactly the displayed native pose, never T-pose')
 const first=evaluate(.14+1/60,1/60)
 const firstStep=difference(native,first)
 assert.ok(firstStep<.08,`${family}: first 60fps transition step must stay below .08 radians/metres, got ${firstStep}`)
 evaluate(.5,.1);evaluate(.6,.1);evaluate(.7,.1)
 const expected=evaluate(.25,0,true),wrapped=evaluate(lifeClip.duration*4+.25,0,true)
 assert.ok(difference(expected,wrapped)<1e-6,'authored continuous time must wrap rather than freeze at the last frame')
 const seam=difference(evaluate(lifeClip.duration-.001,0,true),evaluate(lifeClip.duration+.001,0,true))
 assert.ok(seam<.035,`${family}: real idle loop has an unexpectedly discontinuous seam ${seam}`)
 const head=model.getObjectByName(family==='city'?'Head':'DEF-spine006'),hand=model.getObjectByName(family==='city'?'HandR':'DEF-handR')
 let corrected
 for(let frame=0;frame<120;frame++){
  bridge.restoreAnimation();action.time=.4;mixer.update(0);bridge.saveAnimation()
  head.rotateY(.12);hand.rotateX(.18);bridge.finish(1/60,true)
  const pose=snapshot(model)
  if(corrected)assert.ok(difference(corrected,pose)<1e-6,'head/wrist corrections cannot accumulate on cached constant tracks')
  corrected=pose
 }
 // Pausing performs no evaluation; resuming uses the existing action phase.
 const paused=snapshot(model),pausedTime=action.time
 for(let frame=0;frame<60;frame++)assert.ok(difference(paused,snapshot(model))<1e-6)
 assert.equal(action.time,pausedTime)
 for(let frame=0;frame<30;frame++)assert.ok(difference(evaluate(17.23,0,true),evaluate(17.23,0,true))<1e-6,'reduced motion remains one evaluated finite pose')
 const beforeReturn=snapshot(model)
 bridge.begin(.22);mixer.stopAllAction();mixer.uncacheRoot(model);bridge.restoreVisible()
 mixer=new AnimationMixer(model);action=mixer.clipAction(nativeClip).setLoop(LoopRepeat,Infinity).play()
 assert.ok(difference(beforeReturn,evaluate(1.2))<1e-6,'life→native also preserves the first pose')
 mixer.stopAllAction();mixer.uncacheRoot(model)

 const fpsResults=[]
 for(const fps of [15,30,60]){
  const rig=clone(asset.scene),clip=retargetLifeMotion(library,rig,family,'Sit_Chair_Idle')
  const player=new AnimationMixer(rig),current=player.clipAction(clip).setLoop(LoopRepeat,Infinity).play(),continuity=new RigPoseContinuity(rig)
  for(let frame=0;frame<=fps*2;frame++){
   continuity.restoreAnimation();current.time=sampleAnimationTime(frame/fps,clip.duration);player.update(0)
   continuity.saveAnimation();continuity.finish(1/fps)
  }
  fpsResults.push(snapshot(rig));player.stopAllAction();player.uncacheRoot(rig)
 }
 assert.ok(difference(fpsResults[0],fpsResults[1])<1e-6&&difference(fpsResults[1],fpsResults[2])<1e-6,'same elapsed time yields the same real rig pose at 15/30/60fps')
 summaries.push({family,firstTransitionStepRad:+firstStep.toFixed(5),loopSeamRad:+seam.toFixed(5),gaitAdvance:advances.map(value=>+value.toFixed(6))})
}
const nativeSource=readFileSync(new URL('../src/three/characters/AssetCharacter3D.tsx',import.meta.url),'utf8')
assert.match(nativeSource,/active\.current\?\.action===next&&!once/,'an unchanged loop action must not restart')
assert.doesNotMatch(nativeSource,/\}, \[actions[^\n]*(?:\bspeed\b|\bpaused\b|\bplayback\b)/,'per-frame speed, playback and pause changes must not retrigger the action effect')
const lifeSource=readFileSync(new URL('../src/three/characters/LifeRigAnimation.tsx',import.meta.url),'utf8')
assert.match(lifeSource,/'motion' in performancePose&&performancePose\.motion!==motion\)return/,'a next-clip clock arriving before React commits must hold the displayed pose')
assert.ok(lifeSource.indexOf('performancePose.motion!==motion')<lifeSource.indexOf('continuity.restoreAnimation()'),'mismatched frames must not restore or modify the previous pose')
assert.ok(lifeSource.indexOf('performancePose.onBasePose()')>lifeSource.indexOf('continuity.saveAnimation()')&&lifeSource.indexOf('performancePose.onBasePose()')<lifeSource.indexOf('performancePose?.seatHeight'),'anatomical calibration must observe the evaluated base pose before seated/lean/head/hand corrections')
assert.match(lifeSource,/\},-2\)/,'life pose must update after targets and before physical props')
assert.match(nativeSource,/\},-2\)/,'native locomotion uses the same pose-before-props scheduling')
console.log('Actual animation continuity:',JSON.stringify(summaries))
console.log('Animation continuity passed: native↔life first-pose preservation, loop seams, continuous time, 15/30/60fps, speed ramps, pause/reduced and non-accumulating head/wrist corrections.')
