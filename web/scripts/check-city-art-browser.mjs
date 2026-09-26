import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {openQaPage,waitFor,delay} from './browser-cdp.mjs'

const base=process.env.QA_BASE_URL??'http://127.0.0.1:5173'
const fixture=JSON.parse(await readFile(new URL('./fixtures/city-published-layout.json',import.meta.url),'utf8'))
const cases=[
 {id:'desktop',width:1440,height:960,quality:'high'},
 {id:'mobile',width:390,height:844,quality:'low'},
 {id:'evening',width:1440,height:960,quality:'high',time:'evening'},
 {id:'reduced',width:390,height:844,quality:'low',reduced:true},
]
for(const test of cases){
 const page=await openQaPage()
 try{
  await page.call('Emulation.setDeviceMetricsOverride',{width:test.width,height:test.height,deviceScaleFactor:1,mobile:test.width<500})
  await page.call('Page.navigate',{url:`${base}/scripts/fixtures/traffic-city.html?source=production&quality=${test.quality}&time=${test.time??'afternoon'}&reduced=${test.reduced?1:0}`})
  await waitFor(page,'window.cityVisualLoaded&&window.trafficQa?.frames>=150',30000)
  const overview=await page.evaluate('window.trafficQa')
  assert.deepEqual(overview.capacityViolations,[],'published layout growth must resize all instance buffers')
  const buildings=overview.batches.filter(batch=>/^city-(buildings|landmarks)-/.test(batch.name)).reduce((sum,batch)=>sum+batch.count,0)
  assert.equal(buildings,fixture.layout.city.buildings.length,'every published building, including cafe and shared home, actually renders')
  assert.ok(overview.batches.find(batch=>batch.name==='city-facade-frames')?.count>300,'side/back facades must be visible, not just exported helpers')
  assert.equal(overview.terraces.length,2,'both real published cafe parcels have a terrace')
  assert.ok(overview.streetscape.pavingCount>54,'paving includes real pedestrian links, not just individual parcel squares')
  assert.deepEqual(overview.outdoorResidents,[],'indoor residents cannot be duplicated on the city map')
  if(test.time==='evening')assert.ok(overview.batches.find(batch=>batch.name==='city-facade-glass-lit')?.count>0)
  for(const [focus,suffix] of [['','overview'],['moonlight_cafe','moonlight'],['garden_cafe','garden']]){
   await page.evaluate(`window.cityVisualQa.focus(${JSON.stringify(focus)})`)
   await delay(2400)
   const shot=await page.call('Page.captureScreenshot',{format:'png'})
   await writeFile(`/tmp/lingolife-city-art-${test.id}-${suffix}.png`,Buffer.from(shot.data,'base64'))
  }
  assert.deepEqual(page.errors,[])
  assert.deepEqual(page.consoleErrors,[])
  console.log(JSON.stringify({case:test.id,buildings,facadeBatches:overview.batches.filter(b=>b.name.startsWith('city-facade')).length,streetscape:overview.streetscape,terraces:overview.terraces.length}))
 }finally{await page.close()}
}
console.log('City art browser checks passed: real published geometry, visible buildings, warm facades, cafe corners, mobile and indoor-presence protection.')
