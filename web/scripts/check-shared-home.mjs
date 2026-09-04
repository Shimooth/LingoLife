import {access,readFile} from 'node:fs/promises'

const fail=message=>{throw new Error(`Shared-home guard failed: ${message}`)}
const manifest=JSON.parse(await readFile(new URL('../../config/shared-home-layout.json',import.meta.url),'utf8'))
const requiredActions=new Set([
 'prepare_food','eat','sleep','shower','use_television','read','practice_hobby',
 'borrow_household_item','clean_shared_space','leave_dishes','rest_alone','seek_company','talk_to_resident',
])
const requiredRooms=new Map([
 ['living-room','living_room'],['kitchen','kitchen'],['bathroom','bathroom'],['bedroom','bedroom'],
])
const ACTOR_CLEARANCE=.28

const rectangle=placement=>{
 const [width,depth]=manifest.asset_footprints[placement.asset]
 const angle=Number(placement.rotation??0),cosine=Math.cos(angle),sine=Math.sin(angle)
 return {
  center:[Number(placement.position[0]),Number(placement.position[2])],
  axes:[[cosine,sine],[-sine,cosine]],
  half:[width*Number(placement.scale[0])/2,depth*Number(placement.scale[2])/2],
 }
}

const rectanglesOverlap=(first,second)=>{
 const a=rectangle(first),b=rectangle(second),difference=[b.center[0]-a.center[0],b.center[1]-a.center[1]]
 for(const axis of [...a.axes,...b.axes]){
  const distance=Math.abs(difference[0]*axis[0]+difference[1]*axis[1])
  const aRadius=a.half.reduce((sum,value,index)=>sum+value*Math.abs(a.axes[index][0]*axis[0]+a.axes[index][1]*axis[1]),0)
  const bRadius=b.half.reduce((sum,value,index)=>sum+value*Math.abs(b.axes[index][0]*axis[0]+b.axes[index][1]*axis[1]),0)
  if(distance>=aRadius+bRadius-.025)return false
 }
 return true
}

const pointBlocked=(placement,x,z,padding=ACTOR_CLEARANCE)=>{
 const value=rectangle(placement),difference=[x-value.center[0],z-value.center[1]]
 return value.axes.every((axis,index)=>Math.abs(difference[0]*axis[0]+difference[1]*axis[1])<value.half[index]+padding)
}

const assertStagingPaths=(room,targets)=>{
 const bounds=manifest.room_bounds,halfWidth=bounds.width/2-ACTOR_CLEARANCE,halfDepth=bounds.depth/2-ACTOR_CLEARANCE
 const minX=-halfWidth,maxX=halfWidth,minZ=bounds.center_z-halfDepth,maxZ=bounds.center_z+halfDepth,step=.18
 const columns=Math.floor((maxX-minX)/step)+1,rows=Math.floor((maxZ-minZ)/step)+1
 const blockers=room.placements.filter(placement=>manifest.asset_footprints[placement.asset])
 const open=(x,z)=>x>=minX&&x<=maxX&&z>=minZ&&z<=maxZ&&!blockers.some(placement=>pointBlocked(placement,x,z))
 const cell=anchor=>[Math.round((anchor.position[0]-minX)/step),Math.round((anchor.position[2]-minZ)/step)]
 const point=([column,row])=>[minX+column*step,minZ+row*step]
 const key=([column,row])=>`${column}:${row}`
 const entry=room.anchors.find(anchor=>anchor.kind==='entry'&&anchor.privacy==='open')
 if(!entry)fail(`${room.id} has no route origin`)
 for(const anchor of [entry,...targets]){
  if(!open(anchor.position[0],anchor.position[2]))fail(`${anchor.id} has less than ${ACTOR_CLEARANCE}m furniture clearance`)
 }
 const start=cell(entry),queue=[start],visited=new Set([key(start)])
 for(let index=0;index<queue.length;index+=1){
  const [column,row]=queue[index]
  for(const neighbor of [[column+1,row],[column-1,row],[column,row+1],[column,row-1]]){
   if(neighbor[0]<0||neighbor[0]>=columns||neighbor[1]<0||neighbor[1]>=rows||visited.has(key(neighbor)))continue
   const [x,z]=point(neighbor)
   if(!open(x,z))continue
   visited.add(key(neighbor));queue.push(neighbor)
  }
 }
 for(const target of targets){
  if(!visited.has(key(cell(target))))fail(`${target.id} cannot be reached from ${entry.id} with ${ACTOR_CLEARANCE}m clearance`)
 }
}

if(manifest.version!==1||manifest.max_residents!==8)fail('contract must be version 1 with an eight-resident ceiling')
if(JSON.stringify(manifest.occupancy_scenarios)!==JSON.stringify([2,4,8]))fail('2/4/8 occupancy scenarios drifted')
if(manifest.rooms.length!==requiredRooms.size)fail('the residence must keep exactly four canonical functional rooms')
if(!Number.isFinite(manifest.room_bounds?.width)||!Number.isFinite(manifest.room_bounds?.depth))fail('room bounds are missing')
const roomGraph=new Map([...requiredRooms.keys()].map(id=>[id,new Set()]))
for(const connection of manifest.room_connections??[]){
 if(!Array.isArray(connection)||connection.length!==2||!roomGraph.has(connection[0])||!roomGraph.has(connection[1]))fail('the shared-room connection graph is invalid')
 roomGraph.get(connection[0]).add(connection[1]);roomGraph.get(connection[1]).add(connection[0])
}
const reachedRooms=new Set(['living-room']),roomQueue=['living-room']
while(roomQueue.length){for(const neighbor of roomGraph.get(roomQueue.shift())??[])if(!reachedRooms.has(neighbor)){reachedRooms.add(neighbor);roomQueue.push(neighbor)}}
if(reachedRooms.size!==requiredRooms.size)fail('lounge, kitchen, bathroom and bedroom corridor must remain connected')

const allFixtures=new Set(['builtin-television'])
const allActions=new Set()
const sleepSlots=new Set()
for(const room of manifest.rooms){
 if(requiredRooms.get(room.id)!==room.kind)fail(`${room.id} is not a canonical room/kind pair`)
 const fixtures=new Set()
 for(const placement of room.placements){
  if(fixtures.has(placement.id))fail(`${room.id} repeats fixture ${placement.id}`)
  fixtures.add(placement.id);allFixtures.add(placement.id)
  if(!Array.isArray(placement.position)||placement.position.length!==3||!placement.position.every(Number.isFinite))fail(`${placement.id} has an invalid position`)
  if(!Array.isArray(placement.scale)||placement.scale.length!==3||!placement.scale.every(value=>Number.isFinite(value)&&value>0))fail(`${placement.id} has an invalid scale`)
  const [x,,z]=placement.position,halfWidth=manifest.room_bounds.width/2,halfDepth=manifest.room_bounds.depth/2
  if(Math.abs(x)>halfWidth||Math.abs(z-manifest.room_bounds.center_z)>halfDepth)fail(`${placement.id} sits outside its room`)
  await access(new URL(`../public/assets/life/interiors/${placement.asset}`,import.meta.url)).catch(()=>fail(`${placement.id} references a missing runtime model`))
 }
 const blocking=room.placements.filter(placement=>manifest.asset_footprints[placement.asset])
 for(let first=0;first<blocking.length;first+=1){
  for(let second=first+1;second<blocking.length;second+=1){
   if(rectanglesOverlap(blocking[first],blocking[second]))fail(`${room.id} overlaps ${blocking[first].id} and ${blocking[second].id}`)
  }
 }
 const anchorIds=new Set()
 for(const anchor of room.anchors){
  if(anchorIds.has(anchor.id))fail(`${room.id} repeats anchor ${anchor.id}`)
  anchorIds.add(anchor.id)
  if(anchor.fixture_id&&!fixtures.has(anchor.fixture_id))fail(`${anchor.id} targets missing fixture ${anchor.fixture_id}`)
  for(const action of anchor.actions){
   if(!requiredActions.has(action))fail(`${anchor.id} exposes unknown action ${action}`)
   allActions.add(action)
  }
  if(anchor.kind==='private-bed'){
   if(anchor.privacy!=='private'||!anchor.actions.includes('sleep'))fail(`${anchor.id} is not a private sleep anchor`)
   if(!/^bed-\d\d$/.test(anchor.fixture_id??''))fail(`${anchor.id} has no explicit bed fixture`)
   sleepSlots.add(anchor.slot)
  }
 }
 if(!room.anchors.some(anchor=>anchor.kind==='entry'&&anchor.privacy==='open'))fail(`${room.id} has no open entry anchor`)
 const navigationTargets=room.anchors.filter(anchor=>anchor.privacy==='open'&&(anchor.kind==='idle'||anchor.kind==='queue'))
 if(!navigationTargets.length)fail(`${room.id} has no open resident staging anchor`)
 assertStagingPaths(room,navigationTargets)
}

const missingActions=[...requiredActions].filter(action=>!allActions.has(action))
if(missingActions.length)fail(`missing Life Action anchors: ${missingActions.join(', ')}`)
if(JSON.stringify([...sleepSlots].sort((a,b)=>a-b))!==JSON.stringify([1,2,3,4,5,6,7,8]))fail('private sleep slots must be exactly 1–8')
const bedroom=manifest.rooms.find(room=>room.kind==='bedroom')
if(bedroom.placements.filter(item=>/^bed-\d\d$/.test(item.id)).length!==8)fail('the sleeping room must render eight explicit beds')
const privateSpaces=bedroom.private_spaces??[],corridors=bedroom.corridors??[]
if(privateSpaces.length!==8)fail('the bedroom wing must declare exactly eight private rooms')
if(corridors.length!==1)fail('the bedroom wing must keep one legible connecting corridor')
const bedroomFixtures=new Map(bedroom.placements.map(item=>[item.id,item]))
const bedroomAnchors=new Map(bedroom.anchors.map(item=>[item.id,item]))
const privateIds=new Set(),privateSlots=new Set(),claimedFixtures=new Set()
const [corridorMinX,corridorMaxX,corridorMinZ,corridorMaxZ]=corridors[0].bounds
if(corridorMaxX-corridorMinX<9.8||corridorMaxZ-corridorMinZ<corridors[0].minimum_clearance)fail('the bedroom corridor is too narrow or does not span the wing')
const corridorEntry=bedroomAnchors.get(corridors[0].entry_anchor_id)
if(!corridorEntry||corridorEntry.kind!=='entry')fail('the bedroom corridor has no canonical entrance')
if(corridorEntry.position[0]<corridorMinX||corridorEntry.position[0]>corridorMaxX||corridorEntry.position[2]<corridorMinZ||corridorEntry.position[2]>corridorMaxZ)fail('the bedroom entrance is outside the clear corridor')

const boundsOverlap=(first,second)=>Math.min(first[1],second[1])-Math.max(first[0],second[0])>.01&&Math.min(first[3],second[3])-Math.max(first[2],second[2])>.01
const fixtureFits=(fixture,bounds)=>{
 const value=rectangle(fixture),corners=[]
 for(const horizontal of [-1,1])for(const vertical of [-1,1])corners.push([
  value.center[0]+horizontal*value.half[0]*value.axes[0][0]+vertical*value.half[1]*value.axes[1][0],
  value.center[1]+horizontal*value.half[0]*value.axes[0][1]+vertical*value.half[1]*value.axes[1][1],
 ])
 return corners.every(([x,z])=>x>=bounds[0]+.035&&x<=bounds[1]-.035&&z>=bounds[2]+.035&&z<=bounds[3]-.035)
}

for(let first=0;first<privateSpaces.length;first+=1){
 const space=privateSpaces[first],[minX,maxX,minZ,maxZ]=space.bounds
 if(privateIds.has(space.id)||privateSlots.has(space.slot))fail(`duplicate private bedroom identity ${space.id}/${space.slot}`)
 privateIds.add(space.id);privateSlots.add(space.slot)
 if(maxX-minX<2.35||maxZ-minZ<2.25)fail(`${space.id} is too small to read as a room`)
 const roomHalfWidth=manifest.room_bounds.width/2,roomHalfDepth=manifest.room_bounds.depth/2,roomMinZ=manifest.room_bounds.center_z-roomHalfDepth,roomMaxZ=manifest.room_bounds.center_z+roomHalfDepth
 if(minX< -roomHalfWidth||maxX>roomHalfWidth||minZ<roomMinZ||maxZ>roomMaxZ)fail(`${space.id} crosses the residence shell`)
 for(let second=first+1;second<privateSpaces.length;second+=1)if(boundsOverlap(space.bounds,privateSpaces[second].bounds))fail(`${space.id} overlaps ${privateSpaces[second].id}`)
 if(!/^#[0-9a-f]{6}$/i.test(space.accent)||!space.trace)fail(`${space.id} has no resident-readable personal identity`)
 if(!Array.isArray(space.fixture_ids)||space.fixture_ids.length<3)fail(`${space.id} needs a bed, lamp, and personal storage fixture`)
 const fixtures=space.fixture_ids.map(id=>{
  if(claimedFixtures.has(id))fail(`${id} is shared by multiple private bedrooms`)
  claimedFixtures.add(id)
  const fixture=bedroomFixtures.get(id)
  if(!fixture)fail(`${space.id} references missing fixture ${id}`)
  if(!manifest.asset_footprints[fixture.asset])fail(`${id} has no collision footprint`)
  if(!fixtureFits(fixture,space.bounds))fail(`${id} crosses the walls of ${space.id}`)
  return fixture
 })
 if(!fixtures.some(item=>item.asset==='furniture/bed_single_A.gltf'))fail(`${space.id} has no bed`)
 if(!fixtures.some(item=>item.asset==='furniture/lamp_standing.gltf'))fail(`${space.id} has no light`)
 if(!fixtures.some(item=>item.asset==='furniture/shelf_B_large_decorated.gltf'))fail(`${space.id} has no personal storage/trace fixture`)
 const bedAnchor=bedroomAnchors.get(space.bed_anchor_id),doorAnchor=bedroomAnchors.get(space.door_anchor_id)
 if(!bedAnchor||bedAnchor.kind!=='private-bed'||bedAnchor.slot!==space.slot||!space.fixture_ids.includes(bedAnchor.fixture_id))fail(`${space.id} has no unique private bed binding`)
 if(!doorAnchor||doorAnchor.kind!=='private-room-door'||doorAnchor.slot!==space.slot)fail(`${space.id} has no unique private door anchor`)
 const wallZ=space.door.wall==='south'?maxZ:minZ
 if(Math.abs(space.door.center_x-doorAnchor.position[0])>.02||Math.abs(wallZ-doorAnchor.position[2])>.22)fail(`${space.id} door transform drifted from its wall/anchor`)
 if(space.door.width<.72||space.door.center_x-space.door.width/2<minX+.18||space.door.center_x+space.door.width/2>maxX-.18)fail(`${space.id} doorway is not navigable`)
 const [approachX,,approachZ]=space.door.approach
 if(approachX<corridorMinX||approachX>corridorMaxX||approachZ<corridorMinZ||approachZ>corridorMaxZ)fail(`${space.id} doorway does not open onto the common corridor`)
 const insideDirection=space.door.wall==='south'?-1:1
 for(const distance of [0,.14,.28]){
  const z=wallZ+insideDirection*distance
  if(fixtures.some(item=>pointBlocked(item,space.door.center_x,z,.28)))fail(`${space.id} furniture blocks its doorway clearance`)
 }
}
if(JSON.stringify([...privateSlots].sort((a,b)=>a-b))!==JSON.stringify([1,2,3,4,5,6,7,8]))fail('private bedroom slots must be exactly 1–8')
assertStagingPaths(bedroom,privateSpaces.map(space=>({id:`${space.id}-corridor-approach`,position:space.door.approach})))
for(const occupancy of manifest.occupancy_scenarios){
 const roster=Array.from({length:occupancy},(_,index)=>`resident-${String(index+1).padStart(2,'0')}`)
 const assignment=new Map([...roster].sort().map((id,index)=>[id,privateSpaces[index].slot]))
 const reversed=new Map([...roster].reverse().sort().map((id,index)=>[id,privateSpaces[index].slot]))
 if(assignment.size!==occupancy||new Set(assignment.values()).size!==occupancy)fail(`${occupancy}-resident private-room assignment is not unique`)
 if(roster.some(id=>assignment.get(id)!==reversed.get(id)))fail(`${occupancy}-resident private-room assignment depends on UI order`)
}
const lounge=manifest.rooms.find(room=>room.kind==='living_room')
const idleAnchors=lounge.anchors.filter(anchor=>anchor.kind==='idle'&&anchor.privacy==='open')
if(idleAnchors.length!==8)fail('the shared lounge must expose exactly eight dedicated resident staging anchors')
for(let first=0;first<idleAnchors.length;first+=1){
 for(let second=first+1;second<idleAnchors.length;second+=1){
  const dx=idleAnchors[first].position[0]-idleAnchors[second].position[0],dz=idleAnchors[first].position[2]-idleAnchors[second].position[2]
  if(Math.hypot(dx,dz)<1.15)fail(`${idleAnchors[first].id} and ${idleAnchors[second].id} stack resident silhouettes`)
 }
}

const resources=new Map(manifest.resources.map(resource=>[resource.kind,resource]))
for(const [kind,capacity] of Object.entries({kitchen:1,television:2,bathroom:1})){
 const resource=resources.get(kind)
 if(!resource||resource.capacity!==capacity)fail(`${kind} must exist with capacity ${capacity}`)
 if(!resource.fixture_ids.length||resource.fixture_ids.some(id=>!allFixtures.has(id)))fail(`${kind} references a missing fixture`)
}
if(resources.size!==3)fail('unexpected resource contract in the shared residence')

const environment=await readFile(new URL('../src/three/interiors/IndoorEnvironment3D.tsx',import.meta.url),'utf8')
if(!environment.includes('sharedHomeDefaultPlacements'))fail('the renderer no longer consumes the checked manifest')
if(!environment.includes('eight separated private bedrooms'))fail('the renderer no longer provides visible bedroom walls and doors')
if(!environment.includes('PersonalBedroomTrace'))fail('the renderer no longer differentiates resident-owned rooms')
if(!environment.includes('name="builtin-television"'))fail('the declared television fixture is not rendered')
const preview=await readFile(new URL('../src/components/HouseholdInteriorPreview.tsx',import.meta.url),'utf8')
if(!preview.includes('resolveSharedHomeResidentAnchors'))fail('resident staging no longer follows semantic action anchors')
if(!preview.includes('resolveSharedHomePrivateSpaces'))fail('the cutaway no longer renders stable private-room assignments')
if(!preview.includes('.slice(0,8)'))fail('the cutaway no longer supports the eight-resident boundary')

console.log(`Shared-home guard passed (${manifest.rooms.length} shared rooms, ${privateSpaces.length} walled private bedrooms, ${idleAnchors.length} clear resident anchors, ${allActions.size} Life Actions).`)
