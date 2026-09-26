import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {AnimationMixer,Group,LoopOnce,MeshStandardMaterial,Quaternion,Vector3} from 'three'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {clone} from 'three/examples/jsm/utils/SkeletonUtils.js'
import {retargetSocialMotion} from '../src/three/characters/socialRetarget.ts'
import {retargetLifeMotion} from '../src/three/characters/lifeRetarget.ts'
import {solveSeatedContact} from '../src/three/characters/seatedContact.ts'
import {assertSeatedContact,contactModel} from './assert-seated-contact.mjs'
import {clipsForModel} from '../src/three/characters/characterModel.ts'
import {QUIET_SOCIAL_CLIPS,applySocialPerformance,registerSocialPerformance} from '../src/three/characters/socialPerformance.ts'
import {rigPoseContinuity} from '../src/three/characters/animationContinuity.ts'

const bytes=readFileSync(new URL('../public/assets/life/motions/quaternius-social.json',import.meta.url)),library=JSON.parse(bytes)
const life=JSON.parse(readFileSync(new URL('../public/assets/life/motions/kaykit-life.json',import.meta.url)))
assert.ok(bytes.length<110000,'do not ship the 7.6MB original mannequin/animation pack')
assert.equal(library.version,1)
assert.match(readFileSync(new URL('../public/assets/life/motions/License-Quaternius-Social.txt',import.meta.url),'utf8'),/CC0 1.0/)
assert.equal(library.sourceSha256,'69591853d817488edaa8fd9bf8fc1d821eaeaf789f8627b3cd23b41c4ed67997')
assert.deepEqual(library.clips.map(clip=>clip.name),['Idle_Talking_Loop','Sitting_Talking_Loop'])
for(const clip of library.clips)for(const track of clip.tracks)assert.ok(track.name.endsWith('.quaternion'),'source subset strips translations/scales too')
const loader=new GLTFLoader().register(()=>({name:'social_material_stub',loadMaterial:()=>Promise.resolve(new MeshStandardMaterial())}))
const cityBytes=readFileSync(new URL('../public/assets/models/characters/city/animations/animations.glb',import.meta.url))
const cityAnimations=(await loader.parseAsync(cityBytes.buffer.slice(cityBytes.byteOffset,cityBytes.byteOffset+cityBytes.byteLength),'')).animations
const reports=[],quietReports=[]
for(const family of ['city','chibi'])for(const character of [0,1])for(const motion of ['Idle_Talking_Loop','Sitting_Talking_Loop']){
 const file=family==='city'?(character?'city/Character_3_2_3.glb':'city/Character_1_2_2.glb'):'chibi/all-in-one.glb'
 const bytes=readFileSync(new URL(`../public/assets/models/characters/${file}`,import.meta.url))
 const {scene,animations}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')
 const model=contactModel(scene,family,character),root=new Group()
 root.scale.setScalar(family==='city'?1.0752:.8208);root.rotation.y=family==='city'?Math.PI:0;root.add(model)
 if(motion==='Idle_Talking_Loop'){
  // Measure the actual quiet clip on the shipped models, with production
  // avatar scale (City .56*1.92, Chibi .76*1.08), not source-mannequin units.
  // City Idle_B is *not* calm: its wrists travel over half a world metre.
  const name=QUIET_SOCIAL_CLIPS[family]
  const native=clipsForModel(family==='city'?cityAnimations:animations,model).find(clip=>clip.name===name)
  assert.ok(native,`${family}/${character}: actual quiet source clip must exist`)
  const idle=new AnimationMixer(model),action=idle.clipAction(native);action.setLoop(LoopOnce,1);action.clampWhenFinished=true;action.play()
  const wrists={L:[],R:[]},elbowAngles={L:[],R:[]}
  for(let frame=0;frame<=240;frame++){
   idle.setTime(frame/240*native.duration);root.updateMatrixWorld(true)
   for(const side of ['L','R']){
    const names=family==='city'?[`Arm${side}`,`ForeArm${side}`,`Hand${side}`]:[`DEF-upper_arm${side}`,`DEF-forearm${side}`,`DEF-hand${side}`]
    const [shoulder,elbow,hand]=names.map(name=>model.getObjectByName(name).getWorldPosition(new Vector3()))
    wrists[side].push(hand);elbowAngles[side].push(shoulder.clone().sub(elbow).angleTo(hand.clone().sub(elbow)))
   }
  }
  const range=Object.fromEntries(Object.entries(wrists).map(([side,points])=>{
   let maximum=0
   for(let a=0;a<points.length;a++)for(let b=a+1;b<points.length;b++)maximum=Math.max(maximum,points[a].distanceTo(points[b]))
   assert.ok(maximum<(family==='city'?.01:.02),`${family}/${character}/${side}: listener quiet wrist range ${maximum} world metres exceeds ${family==='city'?'10':'20'}mm; do not select a large gesturing idle by name`)
   return [side,+(maximum*1000).toFixed(4)]
  }))
  const elbowRange=Object.fromEntries(Object.entries(elbowAngles).map(([side,angles])=>{
   const spread=Math.max(...angles)-Math.min(...angles)
   assert.ok(spread<.04,`${family}/${character}/${side}: wrists can stay still while elbows pump; quiet elbow range ${spread} radians must remain under 2.3 degrees`)
   return [side,+(spread*180/Math.PI).toFixed(4)]
  }))
  quietReports.push({family,character,clip:name,worldScale:root.scale.x,wholeCycleWristRangeMm:range,wholeCycleElbowRangeDegrees:elbowRange})
  idle.stopAllAction();idle.uncacheRoot(model)
  // The production order restores raw -> samples native -> saves raw ->
  // social overlay -> visible bridge. Compare all raw bones against a separate
  // native-only model through eight alternating speaking/listening turns.
  const control=clone(model),runtime=new AnimationMixer(model),reference=new AnimationMixer(control),continuity=rigPoseContinuity(model)
  runtime.clipAction(native).play();reference.clipAction(native).play()
  const remove=registerSocialPerformance(model,retargetSocialMotion(library,model,family,'Idle_Talking_Loop'),retargetSocialMotion(library,model,family,'Sitting_Talking_Loop'))
  let maxRawError=0,maxOverlay=0
  for(let frame=0;frame<1200;frame++){
   continuity.restoreAnimation();runtime.update(1/60);continuity.saveAnimation();reference.update(1/60)
   model.traverse(bone=>{
    if(!bone.isBone)return
    const other=control.getObjectByName(bone.name)
    maxRawError=Math.max(maxRawError,bone.position.distanceTo(other.position),...bone.quaternion.toArray().map((value,index)=>Math.abs(value-other.quaternion.toArray()[index])))
   })
   const speaking=frame%300<150
   applySocialPerformance(model,{speaking,listening:!speaking},1/60)
   const arm=model.getObjectByName(family==='city'?'ArmR':'DEF-upper_armR'),other=control.getObjectByName(arm.name)
   maxOverlay=Math.max(maxOverlay,arm.quaternion.clone().normalize().angleTo(other.quaternion.clone().normalize()))
   continuity.finish(1/60)
  }
  assert.equal(maxRawError,0,'social rotations/acknowledgement must never accumulate in the cached raw animation, including constant native tracks')
  assert.ok(maxOverlay>.2,'raw-cache test must exercise an actual speaking overlay, not an unloaded/no-op layer')
  quietReports.at(-1).rawCache={frames:1200,maxError:maxRawError,maxOverlayRadians:+maxOverlay.toFixed(4)}
  remove();runtime.stopAllAction();reference.stopAllAction();runtime.uncacheRoot(model);reference.uncacheRoot(control)
  const temporarySkeletons=new Set();control.traverse(node=>{if(node.isSkinnedMesh)temporarySkeletons.add(node.skeleton)});temporarySkeletons.forEach(skeleton=>skeleton.dispose())
 }
 const clip=retargetSocialMotion(library,model,family,motion)
 assert.equal(retargetSocialMotion(library,model,family,motion),clip,'cache this exact model/library only')
 assert.equal(clip.tracks.length,6,'only both upper arms, forearms and hands are included')
 for(const track of clip.tracks){
  assert.ok(/(?:Arm|arm|Hand|hand)/.test(track.name)&&track.name.endsWith('.quaternion'))
  for(let i=0;i<track.values.length;i+=4)assert.ok(Math.abs(new Quaternion().fromArray(track.values,i).length()-1)<1e-6)
  assert.ok(new Quaternion().fromArray(track.values).angleTo(new Quaternion().fromArray(track.values,track.values.length-4))<.01,'actual source loop seam must not snap')
 }
 const seated=motion==='Sitting_Talking_Loop',baseMixer=new AnimationMixer(model)
 baseMixer.clipAction(retargetLifeMotion(life,model,family,seated?'Sit_Chair_Idle':'Idle_A')).play();baseMixer.setTime(.7)
 if(seated)assertSeatedContact(model,family,solveSeatedContact(model,family,{seatHeight:.388,floorY:0}),`${family}/${character}`)
 root.updateMatrixWorld(true)
 const base=new Map();model.traverse(bone=>{if(bone.isBone)base.set(bone,{position:bone.position.clone(),quaternion:bone.quaternion.clone(),scale:bone.scale.clone(),world:bone.getWorldPosition(new Vector3())})})
 const moved=new Set(clip.tracks.map(track=>track.name.replace('.quaternion','')))
 const mixer=new AnimationMixer(model),action=mixer.clipAction(clip);action.setLoop(LoopOnce,1);action.clampWhenFinished=true;action.play()
 const get=name=>model.getObjectByName(name),sideNames=side=>family==='city'?[`Arm${side}`,`ForeArm${side}`,`Hand${side}`]:[`DEF-upper_arm${side}`,`DEF-forearm${side}`,`DEF-hand${side}`]
 const starts={},last={},samples={L:[],R:[]};let maxWristStep=0,minWristY=Infinity,minElbow=Infinity,maxElbow=0
 for(let frame=0;frame<=176;frame++){
  mixer.setTime(frame/176*clip.duration);root.updateMatrixWorld(true)
  for(const [bone,saved]of base){
   assert.ok(bone.position.distanceTo(saved.position)<1e-9&&bone.scale.distanceTo(saved.scale)<1e-9,'no translation/scaling/stretching of any bone')
   if(!moved.has(bone.name))assert.ok(bone.quaternion.equals(saved.quaternion),'the lower body, head, torso and fingers remain exactly the base pose')
  }
  for(const side of ['L','R']){
   const [shoulder,elbow,hand]=sideNames(side).map(name=>get(name).getWorldPosition(new Vector3()))
   const name=sideNames(side)[2],chest=get(family==='city'?'Torso':'DEF-spine003').getWorldPosition(new Vector3())
   assert.ok(hand.z>chest.z+.05,'both talking gestures stay anatomically in front of the torso')
   assert.ok(side==='R'?elbow.x<shoulder.x+.04:elbow.x>shoulder.x-.04,'elbows may not fold across the torso')
   const elbowAngle=shoulder.clone().sub(elbow).angleTo(hand.clone().sub(elbow));minElbow=Math.min(minElbow,elbowAngle);maxElbow=Math.max(maxElbow,elbowAngle)
   assert.ok(elbowAngle>.45&&elbowAngle<Math.PI-.05,'the elbow must remain bent without an arm flip')
   assert.ok(Math.abs(shoulder.distanceTo(elbow)-base.get(get(sideNames(side)[0])).world.distanceTo(base.get(get(sideNames(side)[1])).world))<1e-6,'upper arm physical length stays fixed across twist bones')
   assert.ok(Math.abs(elbow.distanceTo(hand)-base.get(get(sideNames(side)[1])).world.distanceTo(base.get(get(name)).world))<1e-6,'forearm physical length stays fixed')
   if(last[side])maxWristStep=Math.max(maxWristStep,hand.distanceTo(last[side]));else starts[side]=hand.clone()
   last[side]=hand.clone();samples[side].push(hand);minWristY=Math.min(minWristY,hand.y)
  }
 }
 const excursion=Math.max(...['L','R'].flatMap(side=>samples[side].map(point=>point.distanceTo(starts[side]))))
 assert.ok(maxWristStep<.02,'continuous sampled gesture must not jump more than 2cm at 60Hz')
 assert.ok(excursion>.03,'a real moving gesture, not an inert name-only animation')
 if(seated)assert.ok(minWristY>.608+.018,'seated gesture hands clear the real cafe tabletop')
 reports.push({family,character,motion,tracks:clip.tracks.length,maxWristStepMm:+(maxWristStep*1000).toFixed(2),wristExcursionMm:+(excursion*1000).toFixed(2),minWristY:+minWristY.toFixed(3),elbowDegrees:[minElbow,maxElbow].map(a=>+(a*180/Math.PI).toFixed(2))})
 mixer.stopAllAction();baseMixer.stopAllAction();mixer.uncacheRoot(model);baseMixer.uncacheRoot(model)
}
console.log(`Social motion checks passed: ${bytes.length} bytes, exact CC0 provenance, 8 actual rig/clip cases; quaternion-only upper limbs, no pelvis/legs changes, no stretching, loop closure, smooth moving wrists and tabletop clearance.`)
console.log(JSON.stringify(reports,null,2))
console.log('Quiet native stance checks (whole-cycle wrist range in millimetres, actual production-scaled rigs):',JSON.stringify(quietReports,null,2))
