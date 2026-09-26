import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import * as THREE from 'three'
import typescript from 'typescript'
import {BUILDING_LOTS,KAYKIT_ASSET_BASE,KAYKIT_VEHICLE_HALF_EXTENTS,ROAD_TILES,STREET_PROPS} from '../src/three/world/worldData.ts'

const source=await readFile(new URL('../src/three/world/worldDecorations.ts',import.meta.url),'utf8')
const rewritten=source.replace(/from '\.\/worldData(?:\.ts)?'/,`from '${new URL('../src/three/world/worldData.ts',import.meta.url).href}'`)
assert.notEqual(rewritten,source,'parking guard must execute the production validator')
const compiled=typescript.transpileModule(rewritten,{compilerOptions:{module:typescript.ModuleKind.ESNext,target:typescript.ScriptTarget.ES2022}}).outputText
const {filterSafeAuthoredVehicles,filterSafeParkedVehicles,isParkedVehicle,parkedVehicleFromAuthored,validateParkedVehiclePlacement}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

// Read every scene node, not only the first mesh (which is a wheel). Bounds
// must continue to contain the actual shipped model if assets are replaced.
const vehicleMinimumY=new Map()
for(const [model,expected] of Object.entries(KAYKIT_VEHICLE_HALF_EXTENTS)){
 const document=JSON.parse(await readFile(new URL(`../public${KAYKIT_ASSET_BASE}/${model}.gltf`,import.meta.url),'utf8'))
 const bounds=new THREE.Box3()
 const visit=(index,parent)=>{
  const node=document.nodes[index]
  const local=node.matrix?new THREE.Matrix4().fromArray(node.matrix):new THREE.Matrix4().compose(
   new THREE.Vector3(...(node.translation??[0,0,0])),
   new THREE.Quaternion(...(node.rotation??[0,0,0,1])),
   new THREE.Vector3(...(node.scale??[1,1,1])),
  )
  const matrix=parent.clone().multiply(local)
  if(node.mesh!==undefined)for(const primitive of document.meshes[node.mesh].primitives){
   const accessor=document.accessors[primitive.attributes.POSITION]
   bounds.union(new THREE.Box3(new THREE.Vector3(...accessor.min),new THREE.Vector3(...accessor.max)).applyMatrix4(matrix))
  }
  for(const child of node.children??[])visit(child,matrix)
 }
 for(const index of document.scenes[document.scene??0].nodes)visit(index,new THREE.Matrix4())
 vehicleMinimumY.set(model,bounds.min.y)
 const actual=[Math.max(Math.abs(bounds.min.x),Math.abs(bounds.max.x)),Math.max(Math.abs(bounds.min.z),Math.abs(bounds.max.z))]
 expected.forEach((half,index)=>{
  assert.ok(half>=actual[index],`${model} collision bounds omit scene geometry on axis ${index}`)
  assert.ok(half-actual[index]<.002,`${model} collision bounds do not match the shipped asset`)
 })
}

const car=(id,position,rotation=0,model='car_sedan',scale=1.16)=>({id,model,position,rotation,scale})
const courtyard=[car('station-yard-car-a',[13.4,5.4],0,'car_sedan',1.12),car('station-yard-car-b',[16,5.4],0,'car_hatchback',1.12),car('station-yard-car-c',[18.6,5.4],0,'car_stationwagon',1.12)]
// Test against every potential parcel, not just today's occupied buildings.
const constraints={roads:ROAD_TILES,buildings:BUILDING_LOTS.map(lot=>({...lot,scale:1.16}))}
const defaults=STREET_PROPS.filter(isParkedVehicle)
assert.equal(defaults.length,5,'default parked vehicles must remain visible')
const acceptedCourtyard=filterSafeParkedVehicles(courtyard,constraints)
assert.equal(acceptedCourtyard.length,3,'the existing parking area must remain usable')
const acceptedDefaults=filterSafeParkedVehicles(defaults,{...constraints,vehicles:acceptedCourtyard})
assert.equal(acceptedDefaults.length,5,'every default car must have a legal, unoccupied parking position')
for(const item of [...courtyard,...defaults]){
 assert.equal(validateParkedVehiclePlacement(item,constraints).valid,true,`${item.id} intersects a road, parcel, path, tree or fixed prop`)
 const rotation=new THREE.Matrix4().makeRotationY(item.rotation)
 const [halfX,halfZ]=KAYKIT_VEHICLE_HALF_EXTENTS[item.model].map(value=>value*item.scale)
 for(const x of [-halfX,halfX])for(const z of [-halfZ,halfZ]){
  const corner=new THREE.Vector3(x,0,z).applyMatrix4(rotation).add(new THREE.Vector3(item.position[0],0,item.position[1]))
  assert.ok(corner.x>=12.15&&corner.x<=19.85&&corner.z>=4.3&&corner.z<=8.7,`${item.id} extends beyond the paved station parking area`)
 }
}

const legacy=[car('legacy-taxi',[1.1,.28],Math.PI/2,'car_taxi'),car('legacy-sedan',[-16.6,-.28],-Math.PI/2),car('legacy-police',[23.3,.28],Math.PI/2,'car_police')]
for(const item of legacy)assert.equal(validateParkedVehiclePlacement(item,constraints).reason,'road',`${item.id} still blocks live traffic`)
assert.equal(filterSafeParkedVehicles(legacy,constraints).length,0)
// The two former fallback-only parked cars also sat on active roads.
for(const item of [car('old-campus',[-18.45,-7.6],0,'car_hatchback'),car('old-station',[15.7,13.05],Math.PI/2,'car_stationwagon')]){
 assert.equal(validateParkedVehiclePlacement(item,constraints).reason,'road')
}

const tile={id:'synthetic-road',model:'road_straight',position:[3,0],rotation:0,surface:'city'}
const synthetic={roads:[tile],buildings:[]}
assert.equal(validateParkedVehiclePlacement(car('long-axis',[3,1.9]),synthetic).reason,'road','longitudinal bounds must use local Z')
assert.equal(validateParkedVehiclePlacement(car('turned',[3,1.9],Math.PI/2),synthetic).valid,true,'a rotation must rotate the full footprint')
assert.equal(validateParkedVehiclePlacement(car('sidewalk',[3,1.6],Math.PI/2),synthetic).reason,'road','the sidewalk clearance must be protected')
assert.equal(validateParkedVehiclePlacement(car('crossing',[3,0]),{...synthetic,roads:[{...tile,model:'road_straight_crossing'}]}).reason,'road')
assert.equal(validateParkedVehiclePlacement(car('intersection',[3,0]),{...synthetic,roads:[{...tile,model:'road_junction'}]}).reason,'road')
assert.equal(validateParkedVehiclePlacement(defaults[0],{...constraints,roads:[{...tile,position:defaults[0].position}]}).reason,'road','an authored road may invalidate the default parking area')
assert.equal(validateParkedVehiclePlacement(defaults[0],{roads:[],buildings:[{position:defaults[0].position,rotation:.3,scale:2}]}).reason,'building')
assert.equal(validateParkedVehiclePlacement(car('fountain',[0,6.5]),{roads:[],buildings:[]}).reason,'pedestrian_area')
assert.equal(validateParkedVehiclePlacement(car('garden',[0,-6.5]),{roads:[],buildings:[]}).reason,'pedestrian_area')
assert.equal(validateParkedVehiclePlacement(car('edge',[26.9,7]),{roads:[],buildings:[]}).reason,'outside_city')
const competing=car('duplicate-space',defaults[0].position)
assert.deepEqual(filterSafeParkedVehicles([defaults[0],competing],constraints),[defaults[0]],'first legal car must own its parking space')
assert.equal(filterSafeParkedVehicles([competing],{...constraints,vehicles:[defaults[0]]}).length,0,'parking priority must work across scene layers')
assert.equal(filterSafeParkedVehicles([{...defaults[0]}],{...constraints,vehicles:[defaults[0]]}).length,0,'reusing an ID in another layer must not bypass collision checks')

const authored=item=>({id:item.id,asset:`${KAYKIT_ASSET_BASE}/${item.model}.gltf`,position:{x:item.position[0],y:.47,z:item.position[1]},rotation:{x:0,y:item.rotation,z:0},scale:{x:item.scale,y:item.scale,z:item.scale}})
const validAuthored=authored(defaults[0]),invalidAuthored=legacy.map(authored)
const nonVehicle={...validAuthored,id:'untouched-lamp',asset:`${KAYKIT_ASSET_BASE}/streetlight.gltf`,position:{x:0,y:.37,z:0}}
const imported=[...invalidAuthored,validAuthored,nonVehicle]
const frozenBefore=JSON.stringify(imported)
const filtered=filterSafeAuthoredVehicles(imported,constraints)
assert.deepEqual(filtered,[validAuthored,nonVehicle],'legacy published roads must be protected while legal parking and other props survive')
assert.equal(filtered[0],validAuthored,'authored transforms must retain their original identity')
assert.equal(JSON.stringify(imported),frozenBefore,'render filtering must never rewrite saved map data')
assert.equal(filterSafeAuthoredVehicles([validAuthored],{...constraints,vehicles:[competing]}).length,0,'authored decorations must respect accepted prop vehicles')
assert.equal(filterSafeAuthoredVehicles([{...validAuthored,rotation:{x:.2,y:0,z:0}}],constraints).length,0,'tilted vehicles need full 3D handling and cannot bypass the flat parking guard')
const longAuthored={...authored(car('stretched',[3,1.9],Math.PI/2)),scale:{x:4,y:1,z:1}}
assert.equal(validateParkedVehiclePlacement(parkedVehicleFromAuthored(longAuthored),synthetic).reason,'road','authored nonuniform scale must be retained')
assert.equal(filterSafeParkedVehicles([car('invalid',[13.4,7.65],0,'car_sedan',Number.NaN)],constraints).length,0)

// The pure default generator is source data, never a live database read.
const backendSource=await readFile(new URL('../../backend/lingolife/layouts.py',import.meta.url),'utf8')
const defaultPropsSource=backendSource.split('def _default_props()')[1].split('def _default_decorations()')[0]
const heightBranch=/height = ([\d.]+) if model\.startswith\("car_"\) else ([\d.]+)/.exec(defaultPropsSource)
assert.ok(heightBranch,'default parked vehicles must use their own contact height')
assert.match(defaultPropsSource,/x, height, z, rotation, scale/,'the generated placement must consume the contact height')
assert.equal(Number(heightBranch[2]),.37,'non-vehicle props must retain their existing height')
for(const item of defaults.slice(0,3)){
 const escaped=item.id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
 const tuple=new RegExp(`\\("${escaped}", "${item.model}", ([\\d.]+), ([\\d.]+), math\\.pi, ([\\d.]+)\\)`).exec(backendSource)
 assert.ok(tuple,`backend default parking tuple missing for ${item.id}`)
 assert.deepEqual(tuple.slice(1).map(Number),[...item.position,item.scale],`${item.id} frontend/backend default parking drifted`)
 const wheelY=Number(heightBranch[1])+vehicleMinimumY.get(item.model)*item.scale
 assert.ok(wheelY>=.36&&wheelY<=.365,`${item.id} tires must contact the parking surface without sinking or floating`)
}
console.log('Traffic parking guard passed (full glTF bounds and tire contact, 8 safe parked cars, 5 legacy road obstructions, all parcels, sidewalks, authored transforms and immutable cross-layer filtering).')
