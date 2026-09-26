import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {AnimationMixer,Group,MeshStandardMaterial,Quaternion,Vector3} from 'three'
import {retargetLifeMotion} from '../src/three/characters/lifeRetarget.ts'
import {solveSeatedContact} from '../src/three/characters/seatedContact.ts'
import {assertSeatedContact,contactModel} from './assert-seated-contact.mjs'
import {captureHandGripOffset,createHandContactState,handOrientationForGrip,solveNaturalHandContact} from '../src/three/characters/naturalHandContact.ts'
import {DRINK_CUP_RIM,drinkCupRimOffset,drinkHandOffset,drinkSipCupCenter,measureDrinkMouth} from '../src/three/characters/sharedDrinkContact.ts'
import {CAFE_DRINK_RIG} from '../src/three/world/streetscapeLayout.ts'
import {sampleDrinkPerformance} from '../src/three/characters/sharedDrinkPerformance.ts'
import {drinkHandArc,drinkLeanLimit,drinkReleaseTarget,sampleDrinkUpperBody} from '../src/three/characters/sharedDrinkChoreography.ts'

// The actual shipped City and Chibi rigs include different bind axes, arm
// lengths, and Chibi twist bones. No fabricated two-stick skeleton substitutes.
const loader=new GLTFLoader().register(parser=>({name:'natural_contact_material',loadMaterial:index=>Promise.resolve(new MeshStandardMaterial({name:parser.json.materials[index].name}))}))
const library=JSON.parse(readFileSync(new URL('../public/assets/life/motions/kaykit-life.json',import.meta.url)))
const results=[]
for(const [family,path,scale] of [['city','city/Character_1_2_2.glb',.56*1.92],['chibi','chibi/all-in-one.glb',.76*1.08]])for(const [index,seat] of CAFE_DRINK_RIG.seats.entries()){
 const maxLean=drinkLeanLimit(family)
 const selectedPath=family==='city'&&index?'city/Character_3_2_3.glb':path
 const bytes=readFileSync(new URL(`../public/assets/models/characters/${selectedPath}`,import.meta.url))
 const {scene:source}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')
 const model=contactModel(source,family,index)
 const actor=new Group(),root=new Group();actor.position.set(...seat.position);actor.rotation.y=seat.rotation
 root.scale.setScalar(scale);root.rotation.y=family==='city'?Math.PI:0;root.add(model);actor.add(root)
 const mixer=new AnimationMixer(model);mixer.clipAction(retargetLifeMotion(library,model,family,'Sit_Chair_Idle')).play();mixer.setTime(1)
 const hip=model.getObjectByName(family==='city'?'Hips':'DEF-spine'),torso=model.getObjectByName(family==='city'?'Torso':'DEF-spine001')
 const arm=model.getObjectByName(family==='city'?'ArmR':'DEF-upper_armR'),elbow=model.getObjectByName(family==='city'?'ForeArmR':'DEF-forearmR'),hand=model.getObjectByName(family==='city'?'HandR':'DEF-handR')
 actor.updateMatrixWorld(true)
 const base=new Map();model.traverse(bone=>{if(bone.isBone)base.set(bone,{position:bone.position.clone(),quaternion:bone.quaternion.clone(),scale:bone.scale.clone()})})
 const mouth=measureDrinkMouth(actor,family);assert.ok(mouth)
 const restore=(lean=0)=>{
  for(const [bone,pose]of base){bone.position.copy(pose.position);bone.quaternion.copy(pose.quaternion);bone.scale.copy(pose.scale)}
  actor.updateMatrixWorld(true)
  assertSeatedContact(model,family,solveSeatedContact(model,family,{seatHeight:seat.seatTopY,floorY:0,weight:1}),`${family}/${index}`)
  if(lean){
   const axis=new Vector3(family==='city'?-1:1,0,0).applyQuaternion(model.getWorldQuaternion(new Quaternion()))
   const world=torso.getWorldQuaternion(new Quaternion())
   torso.quaternion.copy(torso.parent.getWorldQuaternion(new Quaternion()).invert().multiply(new Quaternion().setFromAxisAngle(axis,lean)).multiply(world))
   actor.updateMatrixWorld(true)
  }
 }
 const assertRigid=()=>model.traverse(bone=>{
  if(!bone.isBone)return
  const saved=base.get(bone)
  if(bone!==hip)assert.ok(bone.position.distanceTo(saved.position)<1e-9,`${family}: no child bone translation, including intermediate twist bones; pelvis root translation supplies actual seat support`)
  assert.ok(bone.scale.distanceTo(saved.scale)<1e-9,`${family}: no bone or skin stretching`)
  assert.ok(bone.quaternion.toArray().every(Number.isFinite))
 })
 const offset=drinkHandOffset(seat.rotation),tableTarget=new Vector3(...CAFE_DRINK_RIG.cupRest[index]).add(offset).add(new Vector3(0,DRINK_CUP_RIM.height+.0015,0))
 restore(maxLean)
 const table=solveNaturalHandContact(model,family,tableTarget)
 assert.ok(table?.reachable&&table.error<.012,`${family}/${index}: new grip must retain <12mm contact, ${JSON.stringify(table)}`)
 assertRigid()
 const rimErrors=[]
 for(const tilt of [0,-.06,-.12]){
  restore()
  const target=drinkSipCupCenter(mouth,offset,tilt).add(offset),result=solveNaturalHandContact(model,family,target)
  const cup=hand.getWorldPosition(new Vector3()).sub(offset)
  const forward=mouth.forward.clone().applyQuaternion(mouth.head.getWorldQuaternion(new Quaternion()))
  const rim=drinkCupRimOffset(offset,tilt,forward).add(cup),skin=mouth.head.localToWorld(mouth.point.clone())
  const error=rim.distanceTo(skin)
  assert.ok(result?.reachable&&error<.012,`${family}/${index}: physical rim/face must retain <12mm, ${error}m ${JSON.stringify(result)}`)
  assert.ok(cup.clone().sub(skin).dot(forward)>DRINK_CUP_RIM.radius*.8,'cup stays outside the face')
  rimErrors.push(error);assertRigid()
 }
 // A whole contact ramps in and out; weight=0 is exactly the source animation,
 // and no intermediate blend may jump across an elbow fold.
 let previousElbow,previousHand,maxBlendStep=0
 for(let step=0;step<=40;step++){
  restore(maxLean)
  const start=hand.getWorldPosition(new Vector3()),weight=step/40
  solveNaturalHandContact(model,family,tableTarget,{weight,state:createHandContactState()})
  const currentElbow=elbow.getWorldPosition(new Vector3()),currentHand=hand.getWorldPosition(new Vector3())
  if(step===0)assert.ok(currentHand.distanceTo(start)<1e-10,'zero contact weight must leave authored wrist untouched')
  if(previousElbow){
   maxBlendStep=Math.max(maxBlendStep,currentElbow.distanceTo(previousElbow),currentHand.distanceTo(previousHand))
   assert.ok(currentElbow.distanceTo(previousElbow)<.045&&currentHand.distanceTo(previousHand)<.045,'contact blend must not snap')
  }
  previousElbow=currentElbow;previousHand=currentHand;assertRigid()
 }
 // Actual moving reach→sip targets, restoring the underlying clip each frame.
 // A retained pole state must not flip while the shoulder lean settles back.
 const state=createHandContactState();previousElbow=undefined;let maxPathStep=0
 for(let frame=0;frame<=90;frame++){
  const t=frame/90;restore(maxLean*(1-t))
  const sip=drinkSipCupCenter(mouth,offset,-.12*t).add(offset),target=tableTarget.clone().lerp(sip,t)
  const result=solveNaturalHandContact(model,family,target,{state})
  const current=elbow.getWorldPosition(new Vector3())
  if(previousElbow){maxPathStep=Math.max(maxPathStep,current.distanceTo(previousElbow));assert.ok(current.distanceTo(previousElbow)<.06,'elbow must not flip during the real table-to-face path')}
  previousElbow=current;assert.ok(result.clampedError<1e-5,'full contact solves the reachable/clamped point exactly');assertRigid()
 }
 restore(maxLean)
 const explicitPole=arm.getWorldPosition(new Vector3()).add(new Vector3(index?1:-1,-.3,-.6))
 solveNaturalHandContact(model,family,tableTarget,{pole:explicitPole,poleWeight:1,state:createHandContactState()})
 const poleShoulder=arm.getWorldPosition(new Vector3()),poleAxis=hand.getWorldPosition(new Vector3()).sub(poleShoulder).normalize()
 const actualBend=elbow.getWorldPosition(new Vector3()).sub(poleShoulder);actualBend.addScaledVector(poleAxis,-actualBend.dot(poleAxis)).normalize()
 const preferredBend=explicitPole.clone().sub(poleShoulder);preferredBend.addScaledVector(poleAxis,-preferredBend.dot(poleAxis)).normalize()
 assert.ok(actualBend.dot(preferredBend)>.99999,'an explicit world pole determines the elbow plane on both rigs')
 assertRigid()
 restore(maxLean)
 const localWrist=hand.quaternion.clone()
 solveNaturalHandContact(model,family,tableTarget,{wristWorldQuaternion:new Quaternion(),wristWeight:0})
 assert.ok(localWrist.angleTo(hand.quaternion)<1e-6,'zero wrist weight retains the authored grip pose')
 assertRigid()
 restore(maxLean)
 const wrist=new Quaternion().setFromAxisAngle(new Vector3(.3,.8,-.1).normalize(),.83)
 const oriented=solveNaturalHandContact(model,family,tableTarget,{wristWorldQuaternion:wrist,wristWeight:1})
 assert.ok(oriented.error<.012&&hand.getWorldQuaternion(new Quaternion()).normalize().angleTo(wrist)<1e-5,`${family}/${index}: wrist direction must be controlled independently of palm contact, error=${oriented.error}, angle=${hand.getWorldQuaternion(new Quaternion()).normalize().angleTo(wrist)}`)
 const cupRotation=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),seat.rotation+.2)
 const grip=captureHandGripOffset(model,family,cupRotation)
 assert.ok(handOrientationForGrip(cupRotation,grip).angleTo(hand.getWorldQuaternion(new Quaternion()).normalize())<1e-5,'calibration reads each actual rig without a guessed mug-to-hand Euler')
 const tiltedCup=cupRotation.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),-.12))
 const wanted=handOrientationForGrip(tiltedCup,grip)
 solveNaturalHandContact(model,family,tableTarget,{wristWorldQuaternion:wanted})
 assert.ok(hand.getWorldQuaternion(new Quaternion()).normalize().angleTo(wanted)<1e-5);assertRigid()
 restore()
 const shoulder=arm.getWorldPosition(new Vector3()),far=shoulder.clone().add(new Vector3(10,4,3))
 const unreachable=solveNaturalHandContact(model,family,far)
 assert.equal(unreachable.reachable,false,'short arms cannot pretend to reach distant props')
 assert.ok(unreachable.clampedDistance<.8&&unreachable.error>5&&unreachable.clampedError<1e-5,'unreachable target stops at measured arm reach')
 assertRigid()
 const zero=solveNaturalHandContact(model,family,shoulder.clone())
 assert.ok(zero&&Number.isFinite(zero.elbowAngle)&&zero.clampedError<1e-5,'target at shoulder must not divide by zero')
 assertRigid()
 // The real release target moves toward the lap while the animated shoulder
 // unleans and the contact weight fades. A static 0→1 test misses this case.
 const releaseState=createHandContactState();let previousRelease,maxReleasePosition=0,maxReleaseRotation=0
 for(let frame=0;frame<=45;frame++){
  const elapsed=8.600001+frame/60+(index?.65:0),pose=sampleDrinkPerformance('active',elapsed,index,index===0),body=sampleDrinkUpperBody(pose,maxLean)
  for(const [bone,saved]of base){bone.position.copy(saved.position);bone.quaternion.copy(saved.quaternion);bone.scale.copy(saved.scale)}
  mixer.setTime(pose.motionTime);actor.updateMatrixWorld(true)
  assertSeatedContact(model,family,solveSeatedContact(model,family,{seatHeight:seat.seatTopY,floorY:0,weight:1}),`${family}/${index}/release`)
  const leanAxis=new Vector3(family==='city'?-1:1,0,0).applyQuaternion(model.getWorldQuaternion(new Quaternion()))
  const torsoWorld=torso.getWorldQuaternion(new Quaternion())
  torso.quaternion.copy(torso.parent.getWorldQuaternion(new Quaternion()).invert().multiply(new Quaternion().setFromAxisAngle(leanAxis,body.lean)).multiply(torsoWorld));actor.updateMatrixWorld(true)
  const lower=new Vector3(...drinkReleaseTarget(seat.position,seat))
  const target=new Vector3(...drinkHandArc(tableTarget.toArray(),lower.toArray(),pose.progress))
  const animatedBones=new Map();model.traverse(bone=>{if(bone.isBone)animatedBones.set(bone,{position:bone.position.clone(),scale:bone.scale.clone()})})
  const result=solveNaturalHandContact(model,family,target,{weight:body.handWeight,state:releaseState})
  const current={p:elbow.getWorldPosition(new Vector3()),a:arm.quaternion.clone(),f:elbow.quaternion.clone()}
  if(previousRelease){
   maxReleasePosition=Math.max(maxReleasePosition,current.p.distanceTo(previousRelease.p))
   maxReleaseRotation=Math.max(maxReleaseRotation,current.a.angleTo(previousRelease.a),current.f.angleTo(previousRelease.f))
  }
  previousRelease=current
  assert.ok(result&&Number.isFinite(result.error))
  for(const [bone,saved]of animatedBones){assert.ok(bone.position.distanceTo(saved.position)<1e-9);assert.ok(bone.scale.distanceTo(saved.scale)<1e-9)}
 }
 assert.ok(maxReleasePosition<.03&&maxReleaseRotation<.15,`${family}/${index}: live release must not flip its elbow: ${maxReleasePosition}m / ${maxReleaseRotation}rad`)
 results.push({family,seat:index,gripMm:+(table.error*1000).toFixed(4),rimMm:+(Math.max(...rimErrors)*1000).toFixed(4),maxBlendStepMm:+(maxBlendStep*1000).toFixed(2),maxPathElbowStepMm:+(maxPathStep*1000).toFixed(2),releaseStepMm:+(maxReleasePosition*1000).toFixed(2),releaseStepRad:+maxReleaseRotation.toFixed(4)})
 mixer.stopAllAction();mixer.uncacheRoot(model)
}

// Consume the production home furniture resolver as well as the cafe rig.
// TypeScript strips its type-only imports; only the bundler-owned default JSON
// import is replaced with the exact same authored data, not a second layout.
const defaults=JSON.parse(readFileSync(new URL('../../config/shared-home-layout.json',import.meta.url))).rooms.find(room=>room.kind==='living_room').placements
const layoutSource=readFileSync(new URL('../src/three/interiors/sharedDrinkLayout.ts',import.meta.url),'utf8')
 .replace("import {sharedHomeDefaultPlacements} from './sharedHomeLayout'",`const sharedHomeDefaultPlacements=()=>${JSON.stringify(defaults)}`)
const layoutCode=ts.transpileModule(layoutSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {resolveSharedDrinkLayout}=await import(`data:text/javascript;base64,${Buffer.from(layoutCode).toString('base64')}`)
const leanResults=[],leanFailures=[]
for(const [location,layout]of [['cafe',CAFE_DRINK_RIG],['home',resolveSharedDrinkLayout()]])for(const [family,path,scale]of [['city','city/Character_1_2_2.glb',.56*1.92],['chibi','chibi/all-in-one.glb',.76*1.08]]){
 let maxError=0,minHeadClearance=Infinity,minReachSlack=Infinity,minHeadAt
 for(const [index,seat]of layout.seats.entries()){
  const selectedPath=family==='city'&&index?'city/Character_3_2_3.glb':path
  const bytes=readFileSync(new URL(`../public/assets/models/characters/${selectedPath}`,import.meta.url))
  const {scene:source}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')
  const model=contactModel(source,family,index)
  const actor=new Group(),root=new Group();actor.position.set(...seat.position);actor.rotation.y=seat.rotation
  root.scale.setScalar(scale);root.rotation.y=family==='city'?Math.PI:0;root.add(model);actor.add(root)
  const mixer=new AnimationMixer(model),clip=retargetLifeMotion(library,model,family,'Sit_Chair_Idle')
  mixer.clipAction(clip).play();mixer.setTime(1);actor.updateMatrixWorld(true)
  // Capture an already sampled RAW pose. Restoring bind instead would break
  // constant mixer tracks, which deliberately skip unchanged writes.
  const raw=new Map();model.traverse(bone=>{if(bone.isBone)raw.set(bone,{p:bone.position.clone(),q:bone.quaternion.clone(),s:bone.scale.clone()})})
  const torso=model.getObjectByName(family==='city'?'Torso':'DEF-spine001'),head=model.getObjectByName(family==='city'?'Head':'DEF-spine006')
  const arm=model.getObjectByName(family==='city'?'ArmR':'DEF-upper_armR'),elbow=model.getObjectByName(family==='city'?'ForeArmR':'DEF-forearmR'),hand=model.getObjectByName(family==='city'?'HandR':'DEF-handR')
  const skin=family==='chibi'?model.getObjectByName('character_low'):undefined,headVertices=[]
  if(skin){
   const headIndices=new Set()
   skin.skeleton.bones.forEach((bone,index)=>{for(let node=bone;node;node=node.parent)if(node===head){headIndices.add(index);break}})
   const indices=skin.geometry.attributes.skinIndex,weights=skin.geometry.attributes.skinWeight
   for(let vertex=0;vertex<indices.count;vertex++){
    let weight=0;for(let component=0;component<4;component++)if(headIndices.has(indices.getComponent(vertex,component)))weight+=weights.getComponent(vertex,component)
    if(weight>.5)headVertices.push(vertex)
   }
   assert.ok(headVertices.length>0,'clearance check must use actual Chibi head skin, not a guessed head box')
  }
  const target=new Vector3(...layout.cupRest[index]).add(drinkHandOffset(seat.rotation)).add(new Vector3(0,DRINK_CUP_RIM.height+.0015,0))
  for(let frame=0;frame<96;frame++){
   for(const [bone,saved]of raw){bone.position.copy(saved.p);bone.quaternion.copy(saved.q);bone.scale.copy(saved.s)}
   mixer.setTime(frame*clip.duration/96);actor.updateMatrixWorld(true)
   assertSeatedContact(model,family,solveSeatedContact(model,family,{seatHeight:seat.seatTopY,floorY:0,weight:1}),`${location}/${family}/${index}/full-cycle`)
   const axis=new Vector3(family==='city'?-1:1,0,0).applyQuaternion(model.getWorldQuaternion(new Quaternion()))
   torso.quaternion.copy(torso.parent.getWorldQuaternion(new Quaternion()).invert().multiply(new Quaternion().setFromAxisAngle(axis,drinkLeanLimit(family))).multiply(torso.getWorldQuaternion(new Quaternion())))
   head.rotateY(index?-.12:.12);head.rotateX(.1);actor.updateMatrixWorld(true)
   const shoulder=arm.getWorldPosition(new Vector3()),joint=elbow.getWorldPosition(new Vector3()),wrist=hand.getWorldPosition(new Vector3())
   minReachSlack=Math.min(minReachSlack,shoulder.distanceTo(joint)+joint.distanceTo(wrist)-shoulder.distanceTo(target))
   const result=solveNaturalHandContact(model,family,target)
   assert.ok(result?.reachable&&result.error<.012,`${location}/${family}/${index}: production lean must reach the cup throughout the seated clip`)
   maxError=Math.max(maxError,result.error)
   if(skin&&frame%8===0){
    skin.skeleton.update()
    for(const vertex of headVertices){
     const position=skin.getVertexPosition(vertex,new Vector3()).applyMatrix4(skin.matrixWorld),clearance=position.y-layout.table.topY
     if(clearance<minHeadClearance){minHeadClearance=clearance;minHeadAt={seat:index,frame,clipTime:+(frame*clip.duration/96).toFixed(4),vertex}}
    }
   }
  }
  mixer.stopAllAction();mixer.uncacheRoot(model)
 }
 // This is a conservative vertical skin clearance, not a hair/triangle collision
 // solver. The final contact sheet still checks the visible silhouette.
 if(family==='chibi'&&minHeadClearance<=.08)leanFailures.push(`${location}: short-arm lean must keep Chibi face safely above the tabletop, ${minHeadClearance}m`)
 leanResults.push({location,family,maxLean:drinkLeanLimit(family),maxGripMm:+(maxError*1000).toFixed(3),minReachSlackMm:+(minReachSlack*1000).toFixed(2),minHeadClearanceMm:family==='chibi'?+(minHeadClearance*1000).toFixed(2):null,minHeadAt})
}
console.log('Natural hand contact actual rig results:',JSON.stringify(results))
console.log('Production seated lean full-cycle results:',JSON.stringify(leanResults))
assert.deepEqual(leanFailures,[],'Chibi actual head skin must retain more than 80mm tabletop clearance in both production layouts')
console.log('Natural hand contact checks passed: both real rigs/seats, pole-stable reach/sip/release on the production trajectory, eased contact, independent calibrated wrist, no stretch, unreachable target limits and cafe/home reach with safe Chibi face clearance.')
