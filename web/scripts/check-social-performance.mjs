import assert from 'node:assert/strict'
import {AnimationClip,Bone,Group,QuaternionKeyframeTrack} from 'three'
import {applySocialPerformance,registerSocialPerformance} from '../src/three/characters/socialPerformance.ts'

const model=new Group(),arm=new Bone(),leg=new Bone(),head=new Bone()
arm.name='ArmR';leg.name='FootR';head.name='Head';model.add(arm,leg,head)
const q=[0,0,Math.sin(.4),Math.cos(.4)]
const clip=new AnimationClip('upper',3,[new QuaternionKeyframeTrack('ArmR.quaternion',[0,3],[...q,...q])])
const remove=registerSocialPerformance(model,clip,clip)
const input={speaking:true,listening:false,seated:true,key:'a'},raw=arm.quaternion.clone()
let previous=raw.clone(),maxStep=0
const sample=()=>{arm.quaternion.copy(raw);head.quaternion.identity();applySocialPerformance(model,input,1/60);maxStep=Math.max(maxStep,previous.angleTo(arm.quaternion));previous.copy(arm.quaternion)}
for(let i=0;i<60;i++)sample()
assert.ok(arm.quaternion.angleTo(raw)>.3,'speech must visibly change the arms')
input.key='b';sample()
assert.ok(maxStep<.08,'a new sentence must not reset its upper-body clip and snap')
input.speaking=false;input.listening=true
let maxNod=0
for(let i=0;i<75;i++){sample();maxNod=Math.max(maxNod,Math.abs(head.rotation.x))}
assert.ok(arm.quaternion.angleTo(raw)<.004,'after speaking, the arms return to their original underlying pose')
assert.ok(maxNod>.025&&maxNod<.04,'listener acknowledges once, without endless bobbing')
assert.ok(Math.abs(head.rotation.x)<1e-8,'acknowledgement finishes')
assert.deepEqual(leg.quaternion.toArray(),[0,0,0,1],'speech cannot modify lower-body support')
assert.deepEqual(leg.position.toArray(),[0,0,0]);assert.deepEqual(arm.scale.toArray(),[1,1,1])
input.speaking=true;input.enabled=false
sample();assert.ok(arm.quaternion.angleTo(raw)<1e-8,'physical actions suppress social gestures')
input.enabled=true
arm.quaternion.copy(raw);applySocialPerformance(model,input,1/60,true)
assert.ok(arm.quaternion.angleTo(raw)<1e-8,'reduced motion must not activate gestures')
remove();arm.quaternion.copy(raw);applySocialPerformance(model,input,1)
assert.ok(arm.quaternion.angleTo(raw)<1e-8,'unmounted social layers cannot keep writing')
console.log('Social performance passed: speech fade in/out, no sentence restart, single listening nod, no lower-body writes, physical/reduced suppression and cleanup.')
