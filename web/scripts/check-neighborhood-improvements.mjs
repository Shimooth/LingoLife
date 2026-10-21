import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'

const read=path=>readFile(new URL(path,import.meta.url),'utf8')
const [source,square,fountain,configText]=await Promise.all([
 read('../src/neighborhood/NeighborhoodImprovements3D.tsx'),
 read('../src/three/world/TownSquare3D.tsx'),
 read('../src/neighborhood/Fountain3D.tsx'),
 read('../../config/town-center.json'),
])
const config=JSON.parse(configText),epsilon=1e-8
const capture=(text,pattern,label)=>{
 const match=text.match(pattern)
 assert.ok(match,`Read ${label} from production geometry; update the audit if its structure changes`)
 return match.slice(1)
}
const literal=text=>JSON.parse(text.replace(/(?<!\d)\.(\d+)/g,'0.$1'))
const positions=name=>{
 const [compact,town]=capture(source,new RegExp(`const ${name}=compact\\?(\\[.*?\\]):(\\[.*?\\])(?:\\r?\\n|$)`),`${name} positions`)
 return {compact:literal(compact),town:literal(town)}
}
const groupScale=name=>{
 const [compact,town]=capture(source,new RegExp(`name="${name}"[^>]*scale=\\{compact\\?([^:]+):([^}]+)\\}`),`${name} scales`)
 const asVector=value=>Array.isArray(value)?value:[value,value,value]
 return {compact:asVector(literal(compact)),town:asVector(literal(town))}
}
const flowers=positions('flowers'),lamps=positions('lamps')
const flowerScale=groupScale('funded-flower-bed'),lampScale=groupScale('funded-plaza-light')
const flowerSize=literal(capture(source,/<RoundedBox args=\{(\[[^\]]+\])\}/,'flower planter size')[0])
const lampSource=source.slice(source.indexOf('{value.plazaLights'))
const lampRadii=[...lampSource.matchAll(/<(?:cylinder|sphere|cone)Geometry args=\{(\[[^\]]+\])\}/g)]
 .map(match=>literal(match[1])[0])
const lampBase=literal(capture(lampSource,/<cylinderGeometry args=\{(\[[^\]]+\])\}/,'lamp base size')[0])
const lampRadius=Math.max(...lampRadii),lampBaseRadius=Math.max(lampBase[0],lampBase[1])
assert.ok(lampRadius>0&&lampBaseRadius>0)
const origin=literal(capture(square,/<group position=\{(\[[^\]]+\])\}><NeighborhoodImprovements3D/,'town placement')[0]
 .replace('ground',String(config.building_envelope.ground_y)))
const plinths=[...fountain.matchAll(/<mesh position-y=\{([^}]+)\} receiveShadow><cylinderGeometry args=\{(\[[^\]]+\])\}/g)]
 .map(match=>({height:literal(match[1]),args:literal(match[2])}))
assert.equal(plinths.length,2,'Audit both production fountain plinths')
const fountainRadius=Math.max(...plinths.map(p=>Math.max(p.args[0],p.args[1])))

const box=(x,z,hx,hz)=>[x-hx,z-hz,x+hx,z+hz]
const gap=(a,b)=>Math.hypot(Math.max(a[0]-b[2],b[0]-a[2],0),Math.max(a[1]-b[3],b[1]-a[3],0))
const inside=(a,b)=>a[0]>=b[0]-epsilon&&a[1]>=b[1]-epsilon&&a[2]<=b[2]+epsilon&&a[3]<=b[3]+epsilon
const walkwayBounds=config.walkways.flatMap(path=>path.points.slice(1).map((end,index)=>{
 const start=path.points[index],width=path.width/2
 // Production walkway meshes add 0.025 to segment length, including end caps.
 return start[0]===end[0]
  ?box(start[0],(start[1]+end[1])/2,width,Math.abs(end[1]-start[1])/2+.0125)
  :box((start[0]+end[0])/2,start[1],Math.abs(end[0]-start[0])/2+.0125,width)
}))
const townFlowers=flowers.town.map(([x,z])=>box(x+origin[0],z+origin[2],flowerSize[0]*flowerScale.town[0]/2,flowerSize[2]*flowerScale.town[2]/2))
const townLamps=lamps.town.map(([x,z])=>box(x+origin[0],z+origin[2],lampRadius*lampScale.town[0],lampRadius*lampScale.town[2]))
const townItems=[...townFlowers,...townLamps]
const facilities=Object.values(config.facilities).map(({position,half})=>box(...position,...half))
const plazaBounds=[...config.plaza.bounds.min,...config.plaza.bounds.max]
const pavingBounds=box(...config.plaza.paving.position,...config.plaza.paving.half)
let pathGap=Infinity
for(const item of townItems){
 assert.ok(inside(item,plazaBounds),'Paid scenery stays inside the planned plaza')
 for(const path of walkwayBounds){
  const distance=gap(item,path);pathGap=Math.min(pathGap,distance)
  assert.ok(distance+epsilon>=config.plaza.clearance,'Every painted walkway keeps its full configured clearance')
 }
 for(const facility of facilities)assert.ok(gap(item,facility)+epsilon>=config.plaza.clearance,'Scenery clears fixed facility parcels')
 for(const {position} of Object.values(config.pedestrian.destinations)){
  assert.ok(gap(item,box(...position,0,0))>=config.pedestrian.resident_radius+config.plaza.clearance,'Resident doorway and standing destinations stay clear')
 }
}
for(let i=0;i<townItems.length;i++)for(let j=i+1;j<townItems.length;j++){
 assert.ok(gap(townItems[i],townItems[j])+epsilon>=config.plaza.clearance,'The paid improvements leave space between one another')
}
for(const item of townFlowers)assert.ok(inside(item,pavingBounds),'Planter bases stay entirely on the paving')
for(const [x,z] of lamps.town)assert.ok(inside(box(x+origin[0],z+origin[2],lampBaseRadius*lampScale.town[0],lampBaseRadius*lampScale.town[2]),pavingBounds),'Lamp bases stay entirely on the paving')

const reserved=config.facilities.fountain.half
let compactEdge=0,compactGroundGap=Infinity
for(const [x,z] of flowers.compact){
 const footprint=box(x,z,flowerSize[0]*flowerScale.compact[0]/2,flowerSize[2]*flowerScale.compact[2]/2)
 assert.ok(inside(footprint,[-reserved[0],-reserved[1],...reserved]),'Compact planters remain in the validated legacy parcel')
 const distance=gap(footprint,[0,0,0,0])-fountainRadius
 assert.ok(distance>.02,'Even a conservative planter box stays clear of the round fountain plinth')
 compactGroundGap=Math.min(compactGroundGap,distance)
 compactEdge=Math.max(compactEdge,...footprint.map(Math.abs))
}
for(const [x,z] of lamps.compact){
 const footprint=box(x,z,lampRadius*lampScale.compact[0],lampRadius*lampScale.compact[2])
 assert.ok(inside(footprint,[-reserved[0],-reserved[1],...reserved]),'Compact lamps remain in the validated legacy parcel')
 // Lamp base/cap are round, so circle distance avoids false AABB-corner hits.
 const groundDistance=Math.hypot(x,z)-lampBaseRadius*lampScale.compact[0]-fountainRadius
 assert.ok(groundDistance>.02,'Compact lamp bases do not intersect the fountain plinth')
 assert.ok(Math.hypot(x,z)-lampRadius*lampScale.compact[0]>fountainRadius,'The complete compact lamp also remains outside the fountain outline')
 compactGroundGap=Math.min(compactGroundGap,groundDistance)
 compactEdge=Math.max(compactEdge,...footprint.map(Math.abs))
}
console.log(`Neighborhood improvements passed: town walkway gap ≥ ${pathGap.toFixed(3)}, grounded bases on paving, clear doors and fixed facilities; compact extent ±${compactEdge.toFixed(4)} within ±${reserved[0]}, fountain plinth gap ≥ ${compactGroundGap.toFixed(4)}.`)
