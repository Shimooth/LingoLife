import assert from 'node:assert/strict'
import {sampleDrinkPerformance,isSharedDrinkStage} from '../src/three/characters/sharedDrinkPerformance.ts'
import {sampleDrinkPlacement,sampleDrinkUpperBody,drinkHandArc,planDrinkExit} from '../src/three/characters/sharedDrinkChoreography.ts'
import {CAFE_DRINK_RIG} from '../src/three/world/streetscapeLayout.ts'

const staging={kind:'shared_drink',phase:'active',participant_ids:['a','b'],initiator_id:'a',beverage:'tea'}
assert.ok(isSharedDrinkStage(staging))
for(const bad of [null,{}, {...staging,kind:'reading'}, {...staging,participant_ids:['a','a']},{...staging,initiator_id:'stranger'},{...staging,beverage:'wine'}])assert.equal(isSharedDrinkStage(bad),false)
const phases=['invited','forming','active','completed','declined','interrupted','missed']
for(const phase of phases)for(const index of [0,1]){
 const observed=[]
 for(let t=0;t<=120;t+=.025){
  const pose=sampleDrinkPerformance(phase,t,index,index===0)
  assert.ok(Number.isFinite(pose.motionTime)&&pose.motionTime>=0)
  assert.ok(pose.progress>=0&&pose.progress<=1)
  assert.ok(pose.handProgress>=0&&pose.handProgress<=1)
  if(observed.at(-1)!==pose.beat)observed.push(pose.beat)
  if(['invited','forming','declined','missed'].includes(phase)){
   assert.equal(pose.cup,'table',`${phase} must not invent accepted drinking`)
   assert.equal(pose.seated,false)
  }
 }
 if(phase==='active')assert.deepEqual(observed,['approach','align','sit','settle','reach','lift','sip','lower','release','listen'])
 if(phase==='completed')assert.deepEqual(observed,['lower','release','stand','depart_turn','leave','finished'])
 const last=sampleDrinkPerformance(phase,120,index,index===0)
 assert.ok(['listen','finished','wait'].includes(last.beat),'Every performance must reach a stable end')
 assert.equal(last.cup,'table','No resident departs carrying a vanished cup')
 const reduced=sampleDrinkPerformance(phase,0,index,index===0,true)
 assert.ok(['listen','finished','wait'].includes(reduced.beat),'Reduced motion must skip the finite movement')
 assert.equal(reduced.cup,'table')
}
assert.notEqual(sampleDrinkPerformance('active',2,0,true).beat,sampleDrinkPerformance('active',2,1,false).beat,'Residents should not move in perfect sync')
for(const phase of phases)for(const [index,seat] of CAFE_DRINK_RIG.seats.entries()){
 let previous
 for(let time=0;time<18;time+=1/120){
  const pose=sampleDrinkPerformance(phase,time,index,index===0),placement=sampleDrinkPlacement(pose,seat,phase,index===0),upper=sampleDrinkUpperBody(pose)
  assert.ok([...placement.position,placement.rotation,placement.walkSpeed,upper.lean,upper.headPitch,upper.handWeight].every(Number.isFinite))
  assert.ok(upper.handWeight>=0&&upper.handWeight<=1)
  if(previous){
   assert.ok(Math.hypot(...placement.position.map((value,i)=>value-previous.placement.position[i]))<.03,`${phase}/${pose.beat}: root cannot teleport across a beat`)
   const turn=Math.atan2(Math.sin(placement.rotation-previous.placement.rotation),Math.cos(placement.rotation-previous.placement.rotation))
   assert.ok(Math.abs(turn)<.14,`${phase}/${pose.beat}: turn happens before sitting or walking, not in one frame`)
   if(pose.motion==='Sit_Chair_Idle'&&previous.pose.motion===pose.motion)assert.ok(Math.abs(pose.motionTime-previous.pose.motionTime-(pose.elapsed-previous.pose.elapsed))<1e-6,'seated clock continues across every hand beat, including the second resident’s initial pause')
  }
  previous={pose,placement}
 }
}
for(const progress of [0,1])assert.deepEqual(drinkHandArc([0,0,0],[1,1,1],progress,.025),progress?[1,1,1]:[0,0,0],'rounding a reach cannot move its physical endpoints')
for(const [index,seat] of CAFE_DRINK_RIG.seats.entries())for(let t=0;t<=12;t+=.03){
 const pose=sampleDrinkPerformance('active',t,index,index===0),placement=sampleDrinkPlacement(pose,seat,'active',index===0)
 const exit=planDrinkExit(pose,placement.position,placement.rotation)
 if(exit.finishSitting){assert.equal(pose.beat,'sit');continue}
 const closing=sampleDrinkPerformance('completed',exit.offset+(index?.65:0),index,index===0)
 const after=sampleDrinkPlacement(closing,seat,'completed',index===0,exit.departure)
 assert.ok(Math.hypot(...after.position.map((value,i)=>value-placement.position[i]))<1e-6,'a live interruption starts at the visible root position')
 const turn=Math.atan2(Math.sin(after.rotation-placement.rotation),Math.cos(after.rotation-placement.rotation))
 assert.ok(Math.abs(turn)<1e-6,'a live interruption preserves the initial facing')
 if(pose.cup==='hand')assert.ok(Math.abs(closing.handProgress-pose.handProgress)<1e-6,'a live exit puts the cup down from its current height')
 else assert.equal(closing.cup,'table','live completion must not pick a resting cup back up')
}
console.log('Shared drink finite-performance checks passed (7 factual phases, 2 actors, 120-second replay, reduced motion).')
