import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import typescript from 'typescript'
import {TOWN_CENTER,townStandingPosition} from '../src/three/world/townCenterLayout.ts'
import {ROAD_TILES,BUILDING_LOTS} from '../src/three/world/worldData.ts'
import {residentSidewalkOffset} from '../src/three/world/worldTransforms.ts'
import {resolveNeighborhoodPlots} from '../src/neighborhood/neighborhoodFacilityPlacement.ts'
import {resolveStreetscapeLayout,streetscapeFootprintsOverlap,validateStreetscapeFootprint} from '../src/three/world/streetscapeLayout.ts'

const source=(await readFile(new URL('../src/three/world/worldNavigation.ts',import.meta.url),'utf8'))
 .replace("from './worldData'",`from '${new URL('../src/three/world/worldData.ts',import.meta.url).href}'`)
 .replace("from './townCenterLayout.ts'",`from '${new URL('../src/three/world/townCenterLayout.ts',import.meta.url).href}'`)
const compiled=typescript.transpileModule(source,{compilerOptions:{module:typescript.ModuleKind.ESNext,target:typescript.ScriptTarget.ES2022}}).outputText
const {buildPedestrianRouteForRoads,samplePedestrianRoute}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const lots=Object.keys(TOWN_CENTER.pedestrian.destinations).map(id=>({id,...TOWN_CENTER.relocations[id],family:'residential',district:'core'}))
const layout={city:{theme:TOWN_CENTER.theme,props:[],decorations:[]}}
const buildings=lots.filter(lot=>lot.id!=='landmark-sunny_plaza').map(lot=>({...lot,scale:1}))
for(const lot of lots){
 const positions=Array.from({length:8},(_,index)=>townStandingPosition(lot,residentSidewalkOffset(index,8)))
 assert.equal(new Set(positions.map(point=>JSON.stringify(point))).size,8,'eight residents retain distinct standing slots')
 for(let index=1;index<positions.length;index++)assert.ok(Math.hypot(positions[index][0]-positions[index-1][0],positions[index][2]-positions[index-1][2])>.2,'neighbouring roster slots preserve body width')
}
const constraints={roads:ROAD_TILES,buildings,landmarks:[],townCenter:true}
const streetscape=resolveStreetscapeLayout(constraints)
const plots=resolveNeighborhoodPlots(constraints,streetscape,layout)
assert.deepEqual(plots.map(plot=>plot?.position),[[0,6.5],[5.2,2.6]],'town facilities remain at the planned central parcels')
assert.equal(plots[1].rotation,TOWN_CENTER.facilities.wardrobe.rotation,'the wardrobe door faces the square')
assert.deepEqual(resolveNeighborhoodPlots({...constraints,roads:[...ROAD_TILES].reverse()},streetscape,layout),plots,'array order cannot change a planned facility')
const blocked=resolveNeighborhoodPlots({...constraints,obstacles:[TOWN_CENTER.facilities.fountain]},streetscape,layout)
assert.equal(blocked[0],undefined,'a new obstruction cannot silently move the fountain to a remote leftover lot')
assert.ok(blocked[1],'one unavailable parcel does not remove the other facility')
for(const facility of Object.values(TOWN_CENTER.facilities))assert.equal(validateStreetscapeFootprint(facility,constraints,true),null,'both reserved facilities clear the complete road modules and buildings')
for(const planter of streetscape.planters)assert.ok(!streetscapeFootprintsOverlap(planter,{position:[0,5.3],half:[6.5,3.8],rotation:0}),'automatic street furniture does not intrude into the planned public space')

let samples=0
const assertSafe=point=>{
 const actor={position:[point[0],point[2]],half:[.18,.18],rotation:0}
 assert.ok(!streetscapeFootprintsOverlap(actor,TOWN_CENTER.facilities.fountain,.02),`resident intersects fountain at ${point}`)
 for(const building of buildings)assert.ok(!streetscapeFootprintsOverlap(actor,{position:building.position,half:TOWN_CENTER.building_envelope.half,rotation:building.rotation},.015),`resident intersects ${building.id} at ${point}`)
 // Local trips stay inside the traffic-free square, south of the road.
 assert.ok(point[2]>=1.7&&Math.abs(point[0])<4,'local visits never detour through a vehicle lane')
 samples++
}
for(const origin of lots)for(const target of lots)for(const offset of [-.7,.7]){
 const options={townCenter:true,seed:`${origin.id}:${target.id}`,startLateralOffset:offset,endLateralOffset:-offset}
 const route=buildPedestrianRouteForRoads(origin,target,ROAD_TILES,options)
 assert.ok(route.reachable,`${origin.id} can reach ${target.id}`)
 assert.deepEqual(route.points[0],townStandingPosition(origin,offset),'routes start at the same real doorway as the standing character')
 assert.deepEqual(route.points.at(-1),townStandingPosition(target,-offset),'route completion agrees with the event staging position')
 assert.deepEqual(route,buildPedestrianRouteForRoads(origin,target,[...ROAD_TILES].reverse(),options),'route choice is stable under published road ordering')
 for(let n=0;n<=100;n++)assertSafe(samplePedestrianRoute(route,n/100).position)
}
const plaza=lots.find(lot=>lot.id==='landmark-sunny_plaza')
for(const lot of BUILDING_LOTS.filter(lot=>Math.abs(lot.position[0])>8||lot.position[1]<0)){
 const route=buildPedestrianRouteForRoads(lot,plaza,ROAD_TILES,{townCenter:true,seed:lot.id})
 assert.ok(route.reachable,`the external sidewalk at ${lot.id} connects to the square`)
 assert.deepEqual(route.points.at(-1),[0,.375,4.9])
 for(let n=0;n<=100;n++){
  const point=samplePedestrianRoute(route,n/100).position
  assert.ok(!streetscapeFootprintsOverlap({position:[point[0],point[2]],half:[.18,.18],rotation:0},TOWN_CENTER.facilities.fountain,.02),'external arrivals also avoid the fountain')
 }
}
console.log(`Town center passed (fixed facilities, real doorway endpoints, ${samples} local clearance samples, all external sidewalk approaches reachable).`)
