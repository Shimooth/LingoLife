import assert from 'node:assert/strict'
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
