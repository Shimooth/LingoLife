import assert from 'node:assert/strict'
import {ROAD_TILES,ROAD_TILE_STEP,ROAD_TILE_SCALE,ROAD_DIRECTION_OFFSET,OPPOSITE_ROAD_DIRECTION,roadConnections} from '../src/three/world/worldData.ts'
import {trafficRoadsFromLayout,trafficRoutes,trafficLoop,prepareTrafficRoute,sampleTrafficRoute,createTrafficFleet,advanceTrafficFleet,trafficPosesOverlap} from '../src/three/world/ambientTraffic.ts'

// This is the published layout contract: transforms rounded to four places,
// asset paths instead of model names, and no runtime-only surface metadata.
const placements=ROAD_TILES.map(road=>({id:road.id,asset:`/assets/world/kaykit-city/gltf/${road.model}.gltf`,position:{x:+road.position[0].toFixed(4),y:.245,z:+road.position[1].toFixed(4)},rotation:{x:0,y:+road.rotation.toFixed(4),z:0},scale:{x:ROAD_TILE_SCALE,y:ROAD_TILE_SCALE,z:ROAD_TILE_SCALE}}))
const authored=trafficRoadsFromLayout(placements)
assert.equal(authored.length,ROAD_TILES.length)
assert.ok(authored.some(road=>road.surface==='skyway'),'published transforms must recover cloudway classification')
const routes=trafficRoutes(authored)
assert.equal(routes.filter(route=>!route.closed).length,6,'all three registered exits need inbound and outbound traffic')
assert.equal(routes.length,trafficRoutes(ROAD_TILES).length,'published layouts cannot silently lose transit routes')
assert.ok(routes.filter(route=>route.closed).length>=8,'local circulation must cover several districts')
const covered=new Set(routes.flatMap(route=>route.tileIds))
assert.equal(covered.size,ROAD_TILES.length,'every connected default city street participates in ambient traffic')
const byId=new Map(authored.map(road=>[road.id,road]))
for(const route of routes){
 const count=route.closed?route.points.length:route.points.length-1
 for(let index=0;index<count;index++){
  const current=byId.get(route.tileIds[index]),next=byId.get(route.tileIds[(index+1)%route.points.length])
  const direction=Object.entries(ROAD_DIRECTION_OFFSET).find(([,offset])=>Math.abs(next.position[0]-current.position[0]-offset[0]*ROAD_TILE_STEP)<.001&&Math.abs(next.position[1]-current.position[1]-offset[1]*ROAD_TILE_STEP)<.001)?.[0]
  assert.ok(direction&&roadConnections(current).includes(direction)&&roadConnections(next).includes(OPPOSITE_ROAD_DIRECTION[direction]),`${route.id} cannot cross a closed curb or invent a closing edge`)
 }
 const prepared=prepareTrafficRoute(route)
 for(const segment of prepared.segments){
  const center=byId.get(segment.tileId).position
  for(let index=0;index<=20;index++){
   const pose=sampleTrafficRoute(prepared,segment.start+segment.length*index/20)
   assert.ok(pose.position.every(Number.isFinite))
   assert.ok(Math.abs(Math.hypot(...pose.tangent)-1)<1e-6)
   assert.ok(Math.abs(pose.position[0]-center[0])<=ROAD_TILE_STEP/2+1e-6&&Math.abs(pose.position[1]-center[1])<=ROAD_TILE_STEP/2+1e-6,'a turn must stay within its road tile')
  }
  if(segment.start>0){
   const before=sampleTrafficRoute(prepared,segment.start-1e-5),after=sampleTrafficRoute(prepared,segment.start+1e-5)
   assert.ok(Math.hypot(before.position[0]-after.position[0],before.position[1]-after.position[1])<.0001,'lane positions must be continuous at tile boundaries')
   assert.ok(before.tangent[0]*after.tangent[0]+before.tangent[1]*after.tangent[1]>.9999,'lane tangents must be continuous at tile boundaries')
  }
 }
 if(!route.closed){
  assert.equal(sampleTrafficRoute(prepared,0).opacity,0)
  assert.equal(sampleTrafficRoute(prepared,prepared.length).opacity,0)
  for(const distance of [ROAD_TILE_STEP/2,prepared.length-ROAD_TILE_STEP/2]){
   const pose=sampleTrafficRoute(prepared,distance)
   assert.ok(Math.abs(pose.position[0])>34||pose.position[1]<-24,'fades must occur outside the city in the cloudways')
  }
 }else{
  const before=sampleTrafficRoute(prepared,prepared.length-1e-5),after=sampleTrafficRoute(prepared,1e-5)
  assert.ok(Math.hypot(before.position[0]-after.position[0],before.position[1]-after.position[1])<.0001,'closed routes must not teleport at their seam')
 }
}

assert.deepEqual(trafficRoutes([]),[])
assert.deepEqual(trafficLoop(ROAD_TILES.slice(0,6)),[])
const broken=authored.filter(road=>road.id!=='road--2--8')
assert.equal(trafficRoutes(broken).filter(route=>!route.closed).length,2,'a severed north cloudway must not keep imaginary transit routes')
const rotated=authored.map(road=>road.id==='road--2--8'?{...road,rotation:Math.PI/2}:road)
assert.equal(trafficRoutes(rotated).filter(route=>!route.closed).length,2,'adjacent tiles with opposing closed ports are disconnected')
const cityOnly=authored.filter(road=>Math.abs(road.position[0])<25&&road.position[1]>-17).map(road=>({...road,surface:'skyway'}))
assert.equal(trafficRoutes(cityOnly).filter(route=>!route.closed).length,0,'arbitrary edited dead ends cannot become teleport gateways')
assert.deepEqual(trafficRoadsFromLayout([{...placements[0],scale:{x:1,y:1,z:1}}]),[],'incompatible road scales cannot create invisible drivable pavement')
assert.deepEqual(trafficRoadsFromLayout([{...placements[0],scale:{x:1.3,y:2,z:1.3}}]),[],'vertically scaled roads require a different wheel height')
assert.deepEqual(trafficRoadsFromLayout([{...placements[0],position:{...placements[0].position,y:3}}]),[],'raised authored roads must not make cars float underneath')

let totalTrips=0
for(const maxVehicles of [20,28,32]){
 const fleet=createTrafficFleet(routes,{maxVehicles}),lastMovement=new Map(fleet.vehicles.map(vehicle=>[vehicle.id,0]))
 assert.equal(fleet.vehicles.length,maxVehicles)
 assert.equal(new Set(fleet.vehicles.map(vehicle=>vehicle.route.id)).size,routes.length,'both quality levels must populate every route')
 for(let tick=0;tick<18000;tick++){
  const previous=fleet.vehicles.map(vehicle=>({...vehicle.pose,position:[...vehicle.pose.position]}))
  advanceTrafficFleet(fleet,1/30)
  for(let index=0;index<fleet.vehicles.length;index++){
   const vehicle=fleet.vehicles[index]
   if(vehicle.speed>.1)lastMovement.set(vehicle.id,tick)
   assert.ok(tick-lastMovement.get(vehicle.id)<30*60,'a vehicle must not deadlock for a full minute')
   const displacement=Math.hypot(vehicle.pose.position[0]-previous[index].position[0],vehicle.pose.position[1]-previous[index].position[1])
   if(displacement>1)assert.ok(previous[index].opacity<.002&&vehicle.pose.opacity===0,'only invisible cloudway endpoints may recycle')
   for(let other=index+1;other<fleet.vehicles.length;other++)assert.ok(!trafficPosesOverlap(vehicle.pose,fleet.vehicles[other].pose),`${vehicle.id} intersects ${fleet.vehicles[other].id}`)
  }
 }
 assert.ok(fleet.vehicles.every(vehicle=>vehicle.trips>=5),'every route must remain active over a ten-minute simulation')
 totalTrips+=fleet.vehicles.reduce((sum,vehicle)=>sum+vehicle.trips,0)
}
console.log(`Ambient traffic checks passed (${routes.length} routes, ${covered.size} road tiles, three gateways, ${totalTrips} completed trips; no collisions or minute-long deadlocks at 20/28/32 vehicles).`)
