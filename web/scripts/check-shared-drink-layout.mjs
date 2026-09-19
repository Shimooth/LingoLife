import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'

const manifest=JSON.parse(await readFile(new URL('../../config/shared-home-layout.json',import.meta.url),'utf8'))
const defaults=manifest.rooms.find(room=>room.kind==='living_room').placements
const source=(await readFile(new URL('../src/three/interiors/sharedDrinkLayout.ts',import.meta.url),'utf8'))
 .replace("import {sharedHomeDefaultPlacements} from './sharedHomeLayout'",`const sharedHomeDefaultPlacements=()=>${JSON.stringify(defaults)}`)
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const layoutModuleUrl=`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
const {resolveSharedDrinkLayout}=await import(layoutModuleUrl)
const authored=defaults.map(item=>({id:item.id,asset:`/assets/life/interiors/${item.asset}`,position:{x:item.position[0],y:item.position[1],z:item.position[2]},rotation:{x:0,y:item.rotation,z:0},scale:{x:item.scale[0],y:item.scale[1],z:item.scale[2]}}))
const near=(actual,expected,message)=>assert.ok(Math.abs(actual-expected)<.00001,`${message}: ${actual} vs ${expected}`)
const regular=resolveSharedDrinkLayout()
assert.equal(regular.usable,true,'default chairs and cups must be physically reachable')
near(regular.table.topY,.6,'default table height')
for(let index=0;index<2;index++){
 const seat=regular.seats[index],cup=regular.cupRest[index]
 near(seat.seatTopY,.388,'cushion height comes from the asset')
 assert.ok(Math.hypot(cup[0]-seat.position[0],cup[2]-seat.position[2])<.52,'resting cup is within arm reach')
 near(cup[1],regular.table.topY,'cup sits exactly on the tabletop')
}
assert.deepEqual(resolveSharedDrinkLayout(authored),regular,'published default placements and implicit defaults share the same geometry')

const angle=.83,c=Math.cos(angle),s=Math.sin(angle)
const transform=([x,y,z])=>[1.1+x*c+z*s,y+.22,-.7-x*s+z*c]
const moved=authored.map(item=>{
 const [x,y,z]=transform([item.position.x,item.position.y,item.position.z])
 return {...item,position:{x,y,z},rotation:{x:0,y:item.rotation.y+angle,z:0}}
})
const resolved=resolveSharedDrinkLayout(moved)
assert.equal(resolved.usable,true,'rigid authoring transform preserves reach')
for(let index=0;index<2;index++){
 for(const key of ['position','approach','exit']){
  const expected=transform(regular.seats[index][key])
  resolved.seats[index][key].forEach((value,axis)=>near(value,expected[axis],`edited ${key} follows the furniture`))
 }
 const expected=transform(regular.cupRest[index])
 resolved.cupRest[index].forEach((value,axis)=>near(value,expected[axis],'cup moves with the rotated table'))
 near(resolved.seats[index].seatTopY,regular.seats[index].seatTopY+.22,'edited seat elevation')
}
assert.equal(resolveSharedDrinkLayout(authored.filter(item=>item.id!=='living-chair-north')).usable,false,'deleted chair cannot produce an invisible seat')
assert.equal(resolveSharedDrinkLayout(authored.map(item=>item.id==='living-coffee-table'?{...item,position:{...item.position,x:3}}:item)).usable,false,'faraway table cannot produce a superhuman reach')
assert.equal(resolveSharedDrinkLayout(authored.map(item=>item.id==='living-chair-north'?{...item,asset:'/assets/life/interiors/kitchen/chair.gltf'}:item)).usable,false,'unknown replacement geometry uses a safe standing scene')
const doubled=resolveSharedDrinkLayout(authored.map(item=>({...item,position:{x:item.position.x*2,y:item.position.y*2,z:item.position.z*2},scale:{x:item.scale.x*2,y:item.scale.y*2,z:item.scale.z*2}})))
near(doubled.seats[0].seatTopY,regular.seats[0].seatTopY*2,'authored vertical scale changes seat height')
assert.equal(doubled.usable,false,'oversized furniture is not silently compensated by resizing residents')

const visualSource=(await readFile(new URL('../src/components/householdVisuals.ts',import.meta.url),'utf8'))
 .replace("import {sharedHomeDefaultPlacements} from '../three/interiors/sharedHomeLayout'",`const sharedHomeDefaultPlacements=()=>${JSON.stringify(defaults)}`)
 .replace("import {resolveSharedDrinkLayout} from '../three/interiors/sharedDrinkLayout'",`import {resolveSharedDrinkLayout} from '${layoutModuleUrl}'`)
const visualCompiled=ts.transpileModule(visualSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {householdDrinkPlacements,householdSharedDrink}=await import(`data:text/javascript;base64,${Buffer.from(visualCompiled).toString('base64')}`)
const preview=householdDrinkPlacements()
const previewLayout=resolveSharedDrinkLayout(preview)
near(previewLayout.table.topY,.6*.99-.08,'preview floor transform is also used by hand targets')
near(previewLayout.seats[0].seatTopY,.388*.99-.08,'preview seat matches rendered chair')
const context={activity_id:'tea-for-two',activity_kind:'drink_break',activity_phase:'active',activity_beverage:'tea',activity_participant_ids:['a','b'],activity_initiator_id:'a',visibility:'open'}
const person=id=>({id,name:id,avatar:{},isHome:true,currentAction:{source:'life',type:'talk_to_resident',status:'performing',locationId:'house',raw:{visible_context:{...context}}}})
const residents=[person('a'),person('b'),person('outsider')]
const active=householdSharedDrink(residents,'living_room',preview)
assert.deepEqual(active.staging.participant_ids,['a','b'],'actual public participant pair owns the two seats')
assert.equal(active.residents.length,2,'unrelated residents are never pulled into drinking')
assert.equal(householdSharedDrink(residents,'bedroom',preview),undefined,'private room is never converted into a public lounge scene')
for(const status of ['traveling','planned','completed','interrupted','blocked']){
 const changed=structuredClone(residents);changed[1].currentAction.status=status
 assert.equal(householdSharedDrink(changed,'living_room',preview),undefined,`one ${status} action cannot claim active drinking`)
}
for(const [field,value] of [['activity_id','another-activity'],['activity_phase','completed'],['activity_beverage','water'],['activity_initiator_id','b'],['activity_participant_ids',['a','outsider']],['visibility','private']]){
 const changed=structuredClone(residents);changed[1].currentAction.raw.visible_context[field]=value
 assert.equal(householdSharedDrink(changed,'living_room',preview),undefined,`mixed or stale ${field} projection must not animate a fake pair`)
}
const away=structuredClone(residents);away[1].isHome=false
assert.equal(householdSharedDrink(away,'living_room',preview),undefined,'departed people are never duplicated indoors')
const elsewhere=structuredClone(residents);elsewhere[1].currentAction.locationId='office'
assert.equal(householdSharedDrink(elsewhere,'living_room',preview),undefined,'same activity ID in different locations is insufficient')
assert.equal(householdSharedDrink(residents,'living_room',preview.filter(item=>item.id!=='living-chair-north')),undefined,'authored missing seat keeps normal household actors')
console.log('Shared-drink layout passed: reachable geometry, edited transforms, live pair ownership, lifecycle/private/stale guards and preview contact alignment.')
