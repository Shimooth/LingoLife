import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const previewSource=readFileSync(new URL('../src/components/HouseholdInteriorPreview.tsx',import.meta.url),'utf8')
assert.doesNotMatch(previewSource,/脚下金色圆圈|共享住宅实时切面|className="household-resident-focus"/)
assert.match(previewSource,/className="household-focus-actions"/,'functional locate/talk controls must survive the copy cleanup')
import {householdResidentRoom,privateHouseholdActivity} from '../src/life/householdLocation.ts'
const rooms=[{id:'shared-kitchen',kind:'kitchen'},{id:'shared-lounge',kind:'living_room'}]
const resident={id:'aria',isHome:true,roomId:'kitchen',currentAction:{source:'life',type:'read',raw:{}}}
assert.equal(householdResidentRoom(resident,rooms,[]),'shared-kitchen','Public room beats inferred action room')
assert.equal(householdResidentRoom({...resident,roomId:'living_room'},rooms,[]),'shared-lounge')
assert.equal(householdResidentRoom({...resident,isHome:false},rooms,[]),undefined)
const hidden={...resident,currentAction:{...resident.currentAction,raw:{visible_context:{visibility:'private'}}}}
assert.ok(privateHouseholdActivity(hidden))
assert.equal(householdResidentRoom(hidden,rooms,[]),'shared-kitchen','Private intention does not hide physical presence')
const bedrooms=[...rooms,{id:'bedrooms',kind:'bedroom'}]
assert.equal(householdResidentRoom({...resident,roomId:null,currentAction:{...resident.currentAction,type:'sleep'}},bedrooms,[]),'bedrooms')
console.log('Household location checks passed: aliases, authoritative room priority, observable private presence, away.')
