import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import * as THREE from 'three'
import {CAFE_CITY_SCALE,CAFE_DRINK_RIG,resolveStreetscapeLayout,streetscapeFootprintsOverlap,streetscapeObstacleFromAuthored,validateStreetscapeFootprint} from '../src/three/world/streetscapeLayout.ts'
import {trafficRoadsFromLayout} from '../src/three/world/ambientTraffic.ts'

const document=JSON.parse(await readFile(new URL('./fixtures/city-published-layout.json',import.meta.url),'utf8')),city=document.layout.city
const original=JSON.stringify(document)
// Validate the entire glTF scene, not its first mesh. The imported park trees
// have a much larger canopy than the small KayKit bushes despite similar names.
for(const asset of new Set([...city.props,...city.decorations].map(item=>item.asset))){
 const source=JSON.parse(await readFile(new URL(`../public${asset}`,import.meta.url),'utf8'))
 const bounds=new THREE.Box3()
 const visit=(index,parent)=>{
  const node=source.nodes[index]
  const local=node.matrix?new THREE.Matrix4().fromArray(node.matrix):new THREE.Matrix4().compose(new THREE.Vector3(...(node.translation??[0,0,0])),new THREE.Quaternion(...(node.rotation??[0,0,0,1])),new THREE.Vector3(...(node.scale??[1,1,1])))
  const matrix=parent.clone().multiply(local)
  if(node.mesh!==undefined)for(const primitive of source.meshes[node.mesh].primitives){
   const accessor=source.accessors[primitive.attributes.POSITION]
   bounds.union(new THREE.Box3(new THREE.Vector3(...accessor.min),new THREE.Vector3(...accessor.max)).applyMatrix4(matrix))
  }
  for(const child of node.children??[])visit(child,matrix)
 }
 for(const index of source.scenes[source.scene??0].nodes)visit(index,new THREE.Matrix4())
 const measured=[Math.max(Math.abs(bounds.min.x),Math.abs(bounds.max.x)),Math.max(Math.abs(bounds.min.z),Math.abs(bounds.max.z))]
 const footprint=streetscapeObstacleFromAuthored({asset,position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}})
 measured.forEach((extent,index)=>assert.ok(footprint.half[index]>=extent,`${asset} footprint must contain the full mesh on axis ${index}`))
}
const constraints={
 roads:trafficRoadsFromLayout(city.roads),
 buildings:city.buildings.map(item=>({id:item.id,position:[item.position.x,item.position.z],rotation:item.rotation.y,scale:Math.max(item.scale.x,item.scale.y,item.scale.z)})),
 landmarks:city.buildings.filter(item=>item.location_id).map(item=>({locationId:item.location_id,kind:item.location_id.includes('cafe')?'cafe':'other',position:[item.position.x,item.position.z],rotation:item.rotation.y,scale:item.scale.x})),
 obstacles:[...city.props,...city.decorations].map(streetscapeObstacleFromAuthored),
}
const layout=resolveStreetscapeLayout(constraints)
assert.ok(layout.paving.length>=40,'the real 54-building authored map receives consistent parcel paving')
assert.ok(layout.paving.filter(item=>item.id.startsWith('walk-link-')).length>=4,'existing aprons receive safe continuous links across vacant parcels')
assert.ok(layout.planters.length>=2,'safe garden groups are present in the real authored map')
assert.ok(layout.cafeTerrace,'the real cafe at [-5.2,7.8], not a mock cafe, has a usable terrace')
assert.deepEqual(layout.cafeTerraces.map(item=>item.locationId),['moonlight_cafe','garden_cafe'],'both actual cafe parcels receive collision-checked exterior furniture')
assert.equal(layout.cafeTerrace.locationId,'moonlight_cafe')
assert.equal(layout.cafeTerrace.scale,CAFE_CITY_SCALE)
assert.equal(validateStreetscapeFootprint(layout.cafeTerrace.footprint,constraints),null)
const accepted=layout.cafeTerraces.map(item=>item.footprint)
for(const item of layout.cafeTerraces)assert.equal(validateStreetscapeFootprint(item.footprint,constraints),null)
for(const planter of layout.planters){
 assert.equal(validateStreetscapeFootprint(planter,{...constraints,obstacles:[...constraints.obstacles,...accepted]}),null,`${planter.id} must clear live roads, all buildings, parking, existing objects and earlier additions`)
 accepted.push(planter)
}
assert.equal(JSON.stringify(document),original,'renderer must not relocate or edit authored scenery')
assert.deepEqual(resolveStreetscapeLayout(constraints),layout,'no random regeneration or hopping props on render')
for(const paving of layout.paving){
 for(const road of constraints.roads)assert.equal(streetscapeFootprintsOverlap(paving,{position:road.position,half:[1.26,1.26],rotation:road.rotation}),false,`${paving.id} must not paint a road`)
 if(paving.id.startsWith('walk-link-'))for(const obstacle of constraints.obstacles)assert.equal(streetscapeFootprintsOverlap(paving,obstacle,.049),false,`${paving.id} must not paint over authored props`)
}
const terrace=layout.cafeTerrace.footprint
const blockers=[{position:terrace.position,half:[20,20],rotation:Math.PI/4}]
assert.equal(resolveStreetscapeLayout({...constraints,obstacles:[...constraints.obstacles,...blockers]}).cafeTerrace,null,'an authored obstacle must suppress the terrace, never be moved or hidden')
assert.equal(validateStreetscapeFootprint({position:[16,6.5],half:[.4,.4],rotation:0},{...constraints,obstacles:[]}), 'courtyard','station parking is never a planter candidate')
assert.equal(validateStreetscapeFootprint({position:[0,0],half:[.4,.4],rotation:Math.PI/4},constraints),'road','rotated objects cannot protrude into a road')
assert.equal(validateStreetscapeFootprint(terrace,{...constraints,characterRoutes:[{points:[[terrace.position[0]-3,.375,terrace.position[1]],[terrace.position[0]+3,.375,terrace.position[1]]]}]}),'pedestrian','reserve shoulder width along every live pedestrian path')
assert.equal(validateStreetscapeFootprint(terrace,{...constraints,characterPositions:[terrace.position]}),'pedestrian','do not spawn furniture around a resident')
assert.equal(validateStreetscapeFootprint({position:[26,16],half:[1,1],rotation:Math.PI/4},constraints),'outside','check every corner against the actual city outline')
assert.equal(CAFE_DRINK_RIG.table.topY,.608)
for(const [index,seat] of CAFE_DRINK_RIG.seats.entries()){
 const cup=CAFE_DRINK_RIG.cupRest[index]
 assert.ok(Math.hypot(cup[0],cup[2])+.07<.5,'entire cup fits the circular table')
 assert.ok(Math.hypot(cup[0]-seat.position[0],cup[2]-seat.position[2])<.72,'cup is within supported hand reach')
 assert.ok(Math.abs(CAFE_DRINK_RIG.table.topY-seat.seatTopY)<.35,'table is reachable from the actual seat')
 const front=[seat.position[0]+Math.sin(seat.rotation)*.24,seat.position[2]+Math.cos(seat.rotation)*.24]
 assert.ok(Math.hypot(...front)>.5+.1,'sit-down stance cannot start inside the table')
 assert.ok(Math.abs(seat.position[0])+.215<1.2,'chair geometry stays within the reserved native footprint')
}
// The largest native canopy reaches z=-2.83; the map reserve must contain it.
assert.ok(2.83*CAFE_CITY_SCALE<terrace.half[1])
assert.ok(1.15*CAFE_CITY_SCALE<terrace.half[0])
console.log(JSON.stringify({check:'streetscape',passed:true,roads:constraints.roads.length,buildings:constraints.buildings.length,paving:layout.paving.length,gardens:layout.planters.length,cafe:layout.cafeTerrace.position}))
