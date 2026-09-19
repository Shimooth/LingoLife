import assert from 'node:assert/strict'
import {storyHasOutcome,storyOutcomeCopy} from '../src/life/storyOutcome.ts'
import {practicePresentation} from '../src/life/practicePresentation.ts'

const base={id:'test',status:'awaiting_management',outcome:null}
assert.equal(storyHasOutcome(base),false)
for(const result of ['accepted','mixed','misunderstood','refused','backfired']){
 const story={...base,status:'resolved_with_management',outcome:{mode:'managed',result,selected_action_label:'Comfort',selected_action_label_zh:'安慰'}}
 assert.equal(storyHasOutcome(story),true)
 assert.equal(storyOutcomeCopy(story,'zh').choice,'安慰')
 assert.equal(storyOutcomeCopy(story,'en').choice,'Comfort')
 if(result!=='accepted')assert.doesNotMatch(storyOutcomeCopy(story,'zh').result,/接受|成功/)
}
const autonomous={...base,status:'resolved_autonomously',outcome:{mode:'autonomous'}}
assert.equal(storyOutcomeCopy(autonomous,'zh').managed,false)
assert.equal(storyOutcomeCopy(autonomous,'zh').choice,'')
assert.equal(storyOutcomeCopy({...autonomous,observed_at:'today'},'zh').choice,'')
assert.equal(storyOutcomeCopy({...autonomous,observed_at:'today'},'en').choice,'')
console.log('City practice outcome checks passed (bilingual choice, non-success results, autonomous vs managed).')
const progress={status:'active',step:'participate',participation:null}
assert.equal(practicePresentation({progress,story:autonomous},'zh').kind,'recap')
assert.match(practicePresentation({progress,story:autonomous},'zh').button,/回顾/)
assert.equal(practicePresentation({progress,story:base},'en').kind,'live')
assert.equal(practicePresentation({progress:{...progress,participation:'observed'},story:base},'en').kind,'waiting_result')
assert.equal(practicePresentation({progress,story:null},'zh').kind,'waiting_story')
assert.equal(practicePresentation({progress:{...progress,step:'result'},story:autonomous},'zh').kind,'result')
