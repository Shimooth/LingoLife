import assert from 'node:assert/strict'
import {residentBodyDistance,validResidentDrop,RESIDENT_DRAG_DISTANCE,RESIDENT_LONG_PRESS_MS} from '../src/three/world/residentDrag.ts'
assert.equal(residentBodyDistance(40,70,{x:40,y:100},{x:40,y:40}),0)
assert.equal(residentBodyDistance(70,70,{x:40,y:100},{x:40,y:40}),30)
assert.equal(residentBodyDistance(40,20,{x:40,y:100},{x:40,y:40}),20)
assert.equal(residentBodyDistance(40,40,{x:40,y:40},{x:40,y:40}),0)
assert.equal(validResidentDrop('a','b',['a','b']),true)
assert.equal(validResidentDrop('a','a',['a','b']),false)
assert.equal(validResidentDrop('a',undefined,['a','b']),false)
assert.equal(validResidentDrop('a','b',['a']),false)
assert.equal(validResidentDrop('a','b',['b']),false)
assert.ok(RESIDENT_DRAG_DISTANCE>=6&&RESIDENT_DRAG_DISTANCE<15)
assert.ok(RESIDENT_LONG_PRESS_MS>=300&&RESIDENT_LONG_PRESS_MS<=500)
console.log('Resident drag logic passed: body hit distance, self/empty/stale target rejection, movement threshold, touch hold.')
