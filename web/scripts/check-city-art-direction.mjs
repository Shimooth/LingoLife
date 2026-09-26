import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {buildingFacadeDetails,fabricBuildingStyle,KAYKIT_FACADE_PROFILE} from '../src/three/world/cityArtDirection.ts'
import {BUILDING_LOTS,BUILDING_MODELS,ROAD_TILES} from '../src/three/world/worldData.ts'

const assetBase=new URL('../public/assets/world/kaykit-city/gltf/',import.meta.url)
const attributes=async model=>{
 const gltf=JSON.parse(await readFile(new URL(`${model}.gltf`,assetBase),'utf8'))
 const buffer=await readFile(new URL(`${model}.bin`,assetBase))
 const primitive=gltf.meshes[0].primitives[0]
 const attribute=name=>{
  const accessor=gltf.accessors[primitive.attributes[name]],view=gltf.bufferViews[accessor.bufferView]
  return new Float32Array(buffer.buffer,buffer.byteOffset+(view.byteOffset||0)+(accessor.byteOffset||0),accessor.count*3)
 }
 const indexAccessor=gltf.accessors[primitive.indices],indexView=gltf.bufferViews[indexAccessor.bufferView]
 const IndexArray=indexAccessor.componentType===5125?Uint32Array:Uint16Array
 const indices=new IndexArray(buffer.buffer,buffer.byteOffset+(indexView.byteOffset||0)+(indexAccessor.byteOffset||0),indexAccessor.count)
 return {positions:attribute('POSITION'),normals:attribute('NORMAL'),indices}
}

const onAuthoredWall=(point,axis,sign,{positions,normals,indices})=>{
 const other=axis===0?2:0
 const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
 for(let index=0;index<indices.length;index+=3){
  const vertices=[indices[index],indices[index+1],indices[index+2]].map(value=>value*3)
  if(!vertices.every(value=>normals[value+axis]*sign>.95&&Math.abs(positions[value+axis]-point[axis])<.002))continue
  const corners=vertices.map(value=>[positions[value+other],positions[value+1]])
  const p=[point[other],point[1]],areas=corners.map((a,i)=>cross(a,corners[(i+1)%3],p))
  if(areas.every(value=>value>=-.00001)||areas.every(value=>value<=.00001))return true
 }
 return false
}

for(const [model,profile] of Object.entries(KAYKIT_FACADE_PROFILE)){
 const geometry=await attributes(model),{positions,normals}=geometry
 let front=0,back=0,sideWall=0,backWall=0
 for(let i=0;i<positions.length;i+=3){
  if(positions[i+1]<.2||positions[i+1]>1.5)continue
  if(normals[i+2]>.95)front++
  if(normals[i+2]<-.95)back++
  if(normals[i]>.95&&Math.abs(positions[i]-profile.halfWidth)<.002)sideWall++
  if(normals[i+2]<-.95&&Math.abs(positions[i+2]+profile.halfDepth)<.002)backWall++
 }
 assert.ok(front>back*2,`${model} must still have its authored detailed +Z facade`)
 assert.ok(sideWall>0&&backWall>0,`${model} measured wall planes must exist in the actual glTF`)
 const building={id:model,model,position:[0,.369,0],rotation:0,scale:1}
 const high=buildingFacadeDetails([building],{quality:'high'}),low=buildingFacadeDetails([building],{quality:'low'})
 assert.equal(high.filter(item=>item.kind==='frame').length,low.filter(item=>item.kind==='frame').length,'low quality retains all core windows')
 assert.ok(!low.some(item=>['sill','pipe'].includes(item.kind)))
 assert.ok(high.every(item=>item.position.every(Number.isFinite)&&item.scale.every(value=>value>0)))
 assert.ok(high.filter(item=>item.kind==='frame').every(item=>item.position[1]-item.scale[1]/2>.369+.95&&item.position[1]+item.scale[1]/2<.369+profile.wallTop),'windows stay within upper-floor wall panels and avoid ground-floor native details')
 assert.ok(high.every(item=>item.rotation!==0),'no decorative box covers the native front facade')
 const frames=high.filter(item=>item.kind==='frame')
 for(const frame of frames){
  const side=frame.id.includes('-east-')||frame.id.includes('-west-')
  const setback=profile.setback&&frame.position[1]-.369>profile.setback.fromFloor?profile.setback:undefined
  const sidePlane=frame.id.includes('-east-')?(setback?.maxX??profile.halfWidth):(setback?.minX??-profile.halfWidth)
  const wallDistance=side?Math.abs(frame.position[0]-sidePlane):Math.abs(frame.position[2])-profile.halfDepth
  assert.ok(Math.abs(wallDistance-frame.scale[2]/2)<.00001,'frame back touches the measured wall, never floats')
  const axis=side?0:2,sign=frame.id.includes('-east-')?1:-1
  for(const u of [-1,1])for(const v of [-1,1]){
   const p=[...frame.position];p[1]=p[1]-.369+v*frame.scale[1]/2
   p[axis]-=sign*frame.scale[2]/2;p[side?2:0]+=u*frame.scale[0]/2
   assert.ok(onAuthoredWall(p,axis,sign,geometry),`${frame.id} all four corners must sit on a real glTF wall triangle (including H's upper setback)`)
  }
 }
 assert.deepEqual(high,buildingFacadeDetails([building],{quality:'high'}),'decoration must be deterministic, not change on selection')
 const rotated=buildingFacadeDetails([{...building,position:[10,2,-5],rotation:Math.PI/2,scale:1.13}],{quality:'high'})
 assert.equal(high.length,rotated.length)
 for(let i=0;i<high.length;i++){
  assert.ok(Math.abs(rotated[i].position[0]-(10+high[i].position[2]*1.13))<.00001)
  assert.ok(Math.abs(rotated[i].position[2]-(-5-high[i].position[0]*1.13))<.00001)
  assert.ok(Math.abs(rotated[i].position[1]-(2+(high[i].position[1]-.369)*1.13))<.00001)
 }
}

for(const lot of BUILDING_LOTS){
 const style=fabricBuildingStyle(lot)
 assert.ok(BUILDING_MODELS[lot.family].includes(style.model),'new art direction must preserve building family')
 assert.ok(style.scale>=1&&style.scale<=1.13,'uniform scale must remain inside the proven legal 1.16 footprint')
 const front=[Math.sin(lot.rotation),Math.cos(lot.rotation)]
 assert.ok(ROAD_TILES.some(road=>{
  const dx=road.position[0]-lot.position[0],dz=road.position[1]-lot.position[1]
  return Math.abs(Math.hypot(dx,dz)-2.6)<.001&&(dx*front[0]+dz*front[1])>2.59
 }),'the native +Z front faces an adjacent road, not the overview camera')
}
const profiles=BUILDING_LOTS.map(lot=>({lot,...fabricBuildingStyle(lot)}))
assert.ok(new Set(profiles.map(item=>item.model)).size>=7,'the skyline retains real model diversity')
assert.ok(profiles.filter(item=>.65*item.lot.position[0]+.76*item.lot.position[1]>=8).every(item=>!['building_C','building_D','building_G','building_H'].includes(item.model)),'foreground does not get the taller/tower variants')
const source={id:'authored',model:'building_H',position:[1,1.7,4],rotation:.71,scale:1.23}
const frozen=JSON.stringify(source)
buildingFacadeDetails([source],{quality:'high',night:true})
assert.equal(JSON.stringify(source),frozen,'published transforms and source models are never mutated')
assert.deepEqual(fabricBuildingStyle({family:'residential',position:[15.6,10.4]}),{model:'building_A',scale:1.05})
assert.deepEqual(fabricBuildingStyle({family:'public',position:[-13,-13]}),{model:'building_G',scale:1.08})
assert.deepEqual(fabricBuildingStyle({family:'commercial',position:[0,0]}),{model:'building_D',scale:1.035})
const owner={id:'owner',model:'building_A',position:[0,.369,0],rotation:0,scale:1}
const neighbor={id:'neighbor',model:'building_B',position:[1.3,.369,0],rotation:0,scale:1}
const unblocked=buildingFacadeDetails([owner],{quality:'high'})
const blocked=buildingFacadeDetails([owner,neighbor],{quality:'high'}).filter(item=>item.buildingId==='owner')
assert.ok(unblocked.some(item=>item.id.includes('-east-')))
assert.ok(!blocked.some(item=>item.id.includes('-east-')),'details inside a neighboring authored wall are hidden, not allowed to clip through it')
const night=buildingFacadeDetails([source,owner,neighbor],{quality:'high',night:true})
assert.ok(night.some(item=>item.lit)&&night.some(item=>item.kind==='glass'&&!item.lit),'night windows vary instead of making every room glow')
console.log(`City art direction passed: 8 actual glTF wall profiles, street-facing orientation, deterministic facade transforms, low-detail windows and ${BUILDING_LOTS.length} safe new-building styles.`)
