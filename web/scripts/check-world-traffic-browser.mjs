// Requires local Vite + an isolated Chrome on QA_CDP_URL (default :19226).
// The fixture has no authentication, backend requests, resident data or AI calls.
import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {openQaPage,waitFor,delay} from './browser-cdp.mjs'
import {trafficPosesOverlap} from '../src/three/world/ambientTraffic.ts'
import {validateParkedVehiclePlacement} from '../src/three/world/worldDecorations.ts'
import {ROAD_TILES} from '../src/three/world/worldData.ts'

const origin=process.env.QA_BASE_URL??'http://127.0.0.1:5173'
const cases=[
 {id:'desktop-published',query:'source=published',width:1440,height:960,count:28,observe:true},
 {id:'mobile-low',query:'source=published&quality=low',width:390,height:844,count:20,observe:true},
 {id:'builtin',query:'source=builtin&view=top',width:1440,height:960,count:28},
 {id:'broken',query:'source=broken&view=top',width:1440,height:960},
 {id:'empty',query:'source=empty',width:960,height:720,count:0},
 {id:'reduced',query:'source=published&reduced=1',width:390,height:844,count:0},
]
const pose=car=>({position:[car.x,car.z],tangent:[Math.sin(car.yaw),Math.cos(car.yaw)]})
for(const test of cases){
 const page=await openQaPage()
 try{
  await page.call('Emulation.setDeviceMetricsOverride',{width:test.width,height:test.height,deviceScaleFactor:1,mobile:test.width<500})
  await page.call('Page.navigate',{url:`${origin}/scripts/fixtures/traffic-city.html?${test.query}`})
  await waitFor(page,'window.trafficQa?.ready',30000)
  // Let the observer's intentional entry-camera damping finish before
  // asserting that subsequent traffic updates leave the camera alone.
  await waitFor(page,'window.trafficQa?.frames>=150',15000)
  const first=await page.evaluate('window.trafficQa'),seen=new Set(),regions=new Set()
  if(test.count!==undefined)assert.equal(first.cars.length,test.count,test.id)
  if(test.id==='desktop-published'||test.id==='mobile-low'){
   assert.equal(new Set(first.cars.filter(c=>!c.closed).map(c=>c.route)).size,6,'published map must render every inbound/outbound route')
   assert.ok(first.parked.length>=2,'legal stationary cars should remain in parking spaces')
   assert.ok(first.parked.every(c=>!['parked-car-taxi-centre','parked-car-sedan-west','parked-car-police-dawn'].includes(c.id)),'legacy cars must not obstruct driving lanes')
  }
  const samples=[first]
  for(let i=0;i<(test.observe?16:2);i++){
   await delay(400)
   const current=await page.evaluate('window.trafficQa')
   samples.push(current)
   for(let j=0;j<current.cars.length;j++){
    const car=current.cars[j],initial=first.cars.find(c=>c.id===car.id)
    if(initial&&Math.hypot(car.x-initial.x,car.z-initial.z)>1)seen.add(car.id)
    if(car.visible){if(car.x<-15)regions.add('west');if(car.x>15)regions.add('east');if(car.z<-7)regions.add('north');if(car.z>7)regions.add('south')}
    assert.equal(car.scale,1,'no shrinking cars at gateways')
    assert.ok(Math.abs(car.y-.4039263374)<.00001,'tires must sit on asphalt, not curb height')
    for(const other of current.cars.slice(j+1))assert.ok(!trafficPosesOverlap(pose(car),pose(other)),`${test.id}: ${car.id}/${other.id} overlap`)
   }
  }
  const final=samples.at(-1)
  assert.equal(final.gatewayClouds,15,'all three exit cloud banks remain present at both quality levels')
  assert.deepEqual(final.camera,first.camera,'traffic must not force the observer camera to reset')
  if(test.observe){
   assert.ok(seen.size>=test.count*.7,`${test.id}: most vehicles must make observable progress`)
   assert.equal(regions.size,4,'real renderer must have traffic in all four city regions')
  }
  if(test.id==='broken')assert.equal(new Set(final.cars.filter(c=>!c.closed).map(c=>c.route)).size,2,'severed east road cannot keep phantom gateway traffic')
  if(test.id!=='empty')for(const car of final.parked)assert.equal(validateParkedVehiclePlacement(car,{roads:ROAD_TILES,buildings:[]}).valid,true,'rendered parking stays outside all road tiles')
  assert.deepEqual(page.errors,[],`${test.id}: browser exception`)
  assert.deepEqual(page.consoleErrors,[],`${test.id}: browser console error`)
  const screenshot=await page.call('Page.captureScreenshot',{format:'png'})
  const path=`/tmp/lingolife-traffic-${test.id}.png`
  await writeFile(path,Buffer.from(screenshot.data,'base64'))
  if(test.id==='desktop-published'){
   await page.evaluate('window.trafficQa.zoomOut()')
   await delay(400)
   const wide=await page.call('Page.captureScreenshot',{format:'png'})
   await writeFile('/tmp/lingolife-traffic-gateways.png',Buffer.from(wide.data,'base64'))
  }
  console.log(JSON.stringify({case:test.id,cars:final.cars.length,movingObserved:seen.size,parked:final.parked.length,regions:[...regions],screenshot:path}))
 }finally{await page.close()}
}
console.log('Actual WebGL traffic browser checks passed; this is not a physical-device FPS benchmark.')
