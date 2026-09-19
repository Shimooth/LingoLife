import assert from 'node:assert/strict'
import {sampleDrinkPerformance,isSharedDrinkStage} from '../src/three/characters/sharedDrinkPerformance.ts'

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
 if(phase==='active')assert.deepEqual(observed,['approach','sit','settle','reach','lift','sip','lower','release','listen'])
 if(phase==='completed')assert.deepEqual(observed,['lower','release','stand','leave','finished'])
 const last=sampleDrinkPerformance(phase,120,index,index===0)
 assert.ok(['listen','finished','wait'].includes(last.beat),'Every performance must reach a stable end')
 assert.equal(last.cup,'table','No resident departs carrying a vanished cup')
 const reduced=sampleDrinkPerformance(phase,0,index,index===0,true)
 assert.ok(['listen','finished','wait'].includes(reduced.beat),'Reduced motion must skip the finite movement')
 assert.equal(reduced.cup,'table')
}
assert.notEqual(sampleDrinkPerformance('active',2,0,true).beat,sampleDrinkPerformance('active',2,1,false).beat,'Residents should not move in perfect sync')
console.log('Shared drink finite-performance checks passed (7 factual phases, 2 actors, 120-second replay, reduced motion).')
