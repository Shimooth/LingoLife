import assert from 'node:assert/strict'
import {encounterActing,conciseSceneContext} from '../src/life/encounterActing.ts'
const story={id:'scene',participant_ids:['a','b'],outcome:{tone:'neutral'}}
const beat={speaker_id:'a',addressee_id:'b',animation_cue:'happy'}
assert.equal(encounterActing(story,'a',0,beat).speaking,true)
assert.equal(encounterActing(story,'b',1,beat).speaking,false)
assert.equal(encounterActing(story,'a',0,beat).animation,'talk','Happy speech does not make a seated resident jump')
assert.equal(encounterActing(story,'b',1,beat).animation,'listen')
assert.equal(encounterActing(story,'a',0,beat).expression,'happy')
assert.equal(encounterActing(story,'b',1,beat).expression,'neutral','Do not copy the speaker emotion to everyone')
assert.equal(encounterActing({...story,outcome:{tone:'negative'}},'b',1,beat).expression,'displeased')
assert.ok(encounterActing(story,'a',0,beat).bodyYaw>0)
assert.ok(encounterActing(story,'b',1,beat).bodyYaw<0)
assert.equal(conciseSceneContext('这件事发生在客厅，涉及甲、乙。一人刚想开口。'),'一人刚想开口。')
assert.equal(conciseSceneContext('甲没问乙，就拿了对方的书。'),'甲没问乙，就拿了对方的书。','Specific factual summaries remain intact')
console.log('Encounter acting: speaker/listener distinction, restrained speech, factual expressions, mutual attention and concise context passed.')
