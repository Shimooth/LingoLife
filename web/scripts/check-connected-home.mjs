import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import typescript from 'typescript'

const compile=source=>`data:text/javascript;base64,${Buffer.from(typescript.transpileModule(source,{compilerOptions:{module:typescript.ModuleKind.ESNext,target:typescript.ScriptTarget.ES2022}}).outputText).toString('base64')}`
const manifest=JSON.parse(await readFile(new URL('../../config/shared-home-layout.json',import.meta.url),'utf8'))
const sharedSource=(await readFile(new URL('../src/three/interiors/sharedHomeLayout.ts',import.meta.url),'utf8')).replace(/import sharedHomeSource from[^\n]+/,`const sharedHomeSource=${JSON.stringify(manifest)}`)
const sharedUrl=compile(sharedSource)
const shared=await import(sharedUrl)
const layoutSource=(await readFile(new URL('../src/three/interiors/connectedHomeLayout.ts',import.meta.url),'utf8')).replaceAll("from './sharedHomeLayout'",`from '${sharedUrl}'`)
const home=await import(compile(layoutSource))
const {CONNECTED_HOME_ROOMS,CONNECTED_HOME_WALLS,CONNECTED_HOME_CORRIDORS,connectedHomePoint,connectedHomeFixturePoint,connectedHomeWalkPath}=home
const close=(a,b)=>Math.abs(a-b)<1e-7
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[2]-b[2])
const inside=(point,bounds)=>point[0]>=bounds[0]&&point[0]<=bounds[1]&&point[2]>=bounds[2]&&point[2]<=bounds[3]
const onFloor=point=>CONNECTED_HOME_ROOMS.some(room=>inside(point,room.bounds))||CONNECTED_HOME_CORRIDORS.some(bounds=>inside(point,bounds))
const wallBlocks=(point,wall)=>Math.abs(point[0]-wall.position[0])<wall.size[0]/2+.139&&Math.abs(point[2]-wall.position[2])<wall.size[1]/2+.139
const fixtures=manifest.rooms.flatMap(room=>room.placements.filter(item=>!(/floor|rug|lamp|book|dish|meal|plate|kettle|plant/.test(item.asset))&&manifest.asset_footprints[item.asset]).map(item=>{
 const [x,,z]=connectedHomeFixturePoint(item.position,room.kind),[width,depth]=manifest.asset_footprints[item.asset]
 return {x,z,halfX:width*item.scale[0]*.99/2,halfZ:depth*item.scale[2]*.99/2,angle:item.rotation}
}))
const fixtureBlocks=(point,box)=>{
 const dx=point[0]-box.x,dz=point[2]-box.z,c=Math.cos(box.angle),s=Math.sin(box.angle)
 return Math.abs(dx*c-dz*s)<box.halfX+.139&&Math.abs(dx*s+dz*c)<box.halfZ+.139
}
let checkedSegments=0
function checkRoute(from,to,label){
 const route=connectedHomeWalkPath(from,to)
 assert.ok(route.length>=2,`${label}: route must exist`)
 assert.ok(distance(route.at(-1),to)<.001,`${label}: route must finish at its action anchor`)
 const points=[from,...route]
 for(let index=1;index<points.length;index++){
  const a=points[index-1],b=points[index],steps=Math.max(1,Math.ceil(distance(a,b)/.035))
  for(let step=0;step<=steps;step++){
   const point=[a[0]+(b[0]-a[0])*step/steps,a[1],a[2]+(b[2]-a[2])*step/steps]
   assert.ok(onFloor(point),`${label}: path left the connected floor at ${point}`)
   assert.ok(!CONNECTED_HOME_WALLS.some(wall=>wallBlocks(point,wall)),`${label}: path crossed a wall at ${point}`)
   if(index>1&&index<points.length-1)assert.ok(!fixtures.some(box=>fixtureBlocks(point,box)),`${label}: ordinary walking crossed furniture at ${point}`)
  }
  checkedSegments++
 }
 return route
}

assert.equal(CONNECTED_HOME_ROOMS.length,4)
assert.equal(CONNECTED_HOME_CORRIDORS.length,2)
assert.ok(close(connectedHomePoint([1,-.17,2],'kitchen')[0],-5.2),'Actor anchors must be translated, not scaled twice')
assert.ok(close(connectedHomeFixturePoint([1,0,2],'kitchen')[0],-5.21),'Furniture must share the preview transform')
assert.ok(close(connectedHomeFixturePoint([1,0,2],'kitchen')[2],-2.57))
for(const first of CONNECTED_HOME_ROOMS){
 for(const second of CONNECTED_HOME_ROOMS){
  if(first===second)continue
  const a=shared.sharedHomeRoomForKind(first.kind).anchors.find(anchor=>anchor.kind==='entry')
  const b=shared.sharedHomeRoomForKind(second.kind).anchors.find(anchor=>anchor.kind==='entry')
  const route=checkRoute(connectedHomePoint(a.position,first.kind),connectedHomePoint(b.position,second.kind),`${first.kind} -> ${second.kind}`)
  const points=[connectedHomePoint(a.position,first.kind),...route]
  const touchesHall=points.some((point,index)=>{
   const end=points[index+1]??point,steps=Math.max(1,Math.ceil(distance(point,end)/.05))
   return Array.from({length:steps+1},(_,step)=>[point[0]+(end[0]-point[0])*step/steps,point[1],point[2]+(end[2]-point[2])*step/steps]).some(sample=>CONNECTED_HOME_CORRIDORS.some(bounds=>inside(sample,bounds)))
  })
  assert.ok(touchesHall,`${first.kind} -> ${second.kind}: different rooms must pass through the shared hall`)
 }
}

const loungeAnchor=shared.sharedHomeRoomForKind('living_room').anchors.find(anchor=>anchor.id==='living-idle-east')
const source=connectedHomePoint(loungeAnchor.position,'living_room')
const bedroom=shared.sharedHomeRoomForKind('bedroom')
for(const space of shared.SHARED_HOME_PRIVATE_SPACES){
 const door=bedroom.anchors.find(anchor=>anchor.id===space.door_anchor_id)
 const bed=bedroom.anchors.find(anchor=>anchor.id===space.bed_anchor_id)
 const route=checkRoute(source,connectedHomePoint(bed.position,'bedroom'),`private bed ${space.slot}`)
 const doorZ=connectedHomeFixturePoint([0,0,space.door.wall==='south'?space.bounds[3]:space.bounds[2]],'bedroom')[2]
 const center=connectedHomeFixturePoint([space.door.center_x,0,0],'bedroom')[0]
 const opening=space.door.width*.99/2-.139
 const points=[source,...route]
 let crossed=false
 for(let index=1;index<points.length;index++){
  const a=points[index-1],b=points[index]
  if((a[2]-doorZ)*(b[2]-doorZ)>=0)continue
  const factor=(doorZ-a[2])/(b[2]-a[2]),x=a[0]+(b[0]-a[0])*factor
  if(Math.abs(x-center)<=opening+1e-6)crossed=true
 }
 assert.ok(crossed,`bed ${space.slot}: enter through its own door`)
 checkRoute(connectedHomePoint(bed.position,'bedroom'),source,`private bed ${space.slot} exit`)
 checkRoute(source,connectedHomePoint(door.position,'bedroom'),`private door ${space.slot}`)
}

const actions={living_room:['use_television','read','practice_hobby'],kitchen:['prepare_food','eat','leave_dishes'],bathroom:['shower']}
for(const [kind,types] of Object.entries(actions)){
 const room=shared.sharedHomeRoomForKind(kind)
 for(const type of types){
  const anchor=room.anchors.find(anchor=>anchor.actions.includes(type))
  checkRoute(source,connectedHomePoint(anchor.position,kind),`${kind} ${type}`)
 }
}

for(const count of [2,4,8]){
 const roster=Array.from({length:count},(_,index)=>({id:`resident-${index+1}`,privateRoomId:`test:private-room-${String(index+1).padStart(2,'0')}`}))
 const normal=shared.resolveSharedHomePrivateSpaces(roster)
 const reversed=shared.resolveSharedHomePrivateSpaces([...roster].reverse())
 for(const member of roster){
  assert.equal(normal.find(item=>item.residentId===member.id).slot,reversed.find(item=>item.residentId===member.id).slot,'Camera/layout changes must not reassign bedrooms')
 }
  const anchors=shared.resolveIndoorResidentAnchors('bedroom',roster.map(member=>({...member,actionType:'sleep'})),roster)
 assert.equal(new Set(anchors.map(anchor=>anchor.id)).size,count)
  assert.equal(anchors.filter(anchor=>anchor.id.startsWith('sleep-')).length,count)
 for(const room of manifest.rooms){
  const actions=[undefined,...new Set(room.anchors.flatMap(anchor=>anchor.actions))]
  for(const actionType of actions){
   const targets=shared.resolveIndoorResidentAnchors(room.kind,roster.map(member=>({...member,actionType})),roster)
   for(const [index,target] of targets.entries()){
    const local=actionType==='sleep'?[target.position[0]*.99,target.position[1],target.position[2]*.99+.05]:target.position
    checkRoute(source,connectedHomePoint(local,room.kind),`${count} residents: ${room.kind} ${actionType??'idle'} ${index+1}`)
   }
  }
 }
 const prepare=shared.resolveIndoorResidentAnchors('kitchen',roster.map(member=>({...member,actionType:'prepare_food'})),roster)
 const eating=shared.resolveIndoorResidentAnchors('kitchen',roster.map(member=>({...member,actionType:'eat'})),roster)
 for(let index=0;index<count;index++)checkRoute(connectedHomePoint(prepare[index].position,'kitchen'),connectedHomePoint(eating[index].position,'kitchen'),`${count} residents: prepare -> eat ${index+1}`)
}
assert.deepEqual(connectedHomeWalkPath([999,0,999],source),[],'Outside endpoints must not be rescued by teleporting')
assert.deepEqual(connectedHomeWalkPath([NaN,0,0],source),[])
const wall=CONNECTED_HOME_WALLS.find(item=>!item.private)
assert.deepEqual(connectedHomeWalkPath(wall.position,source),[],'Blocked endpoints must not cross walls')
const beforeIsland=connectedHomePoint([-2.7,-.17,-.2],'kitchen'),afterIsland=connectedHomePoint([-.5,-.17,-.2],'kitchen')
const routeLength=(from,route)=>[from,...route].reduce((sum,point,index,points)=>sum+(index?distance(points[index-1],point):0),0)
const furnishedRoute=connectedHomeWalkPath(beforeIsland,afterIsland)
const emptyRoute=connectedHomeWalkPath(beforeIsland,afterIsland,[{kind:'kitchen',placements:[]}])
assert.ok(furnishedRoute.length&&emptyRoute.length)
assert.ok(routeLength(beforeIsland,emptyRoute)+.3<routeLength(beforeIsland,furnishedRoute),'An explicitly empty authored room must not silently restore default furniture obstacles')
const kitchen=CONNECTED_HOME_ROOMS.find(item=>item.kind==='kitchen')
const sealed=[{kind:'kitchen',placements:[{id:'sealed-door',room_id:'kitchen',asset:'/assets/life/interiors/furniture/couch_pillows.gltf',position:{x:0,y:0,z:3.25},rotation:{x:0,y:0,z:0},scale:{x:2,y:1,z:1}}]}]
assert.deepEqual(connectedHomeWalkPath(connectedHomePoint([-4.45,-.17,2.35],'kitchen'),source,sealed),[],'An obstructed doorway must have no route instead of a straight-line fallback')
assert.ok(kitchen.portal.width>1)
console.log(`Connected-home navigation checks passed: 4 linked rooms, 8 private doors/beds, 2/4/8 ownership, ${checkedSegments} collision-checked segments.`)
