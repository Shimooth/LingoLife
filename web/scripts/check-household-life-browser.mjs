import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {openQaPage,waitFor,delay} from './browser-cdp.mjs'

const page=await openQaPage()
const select=async(index,value)=>{await page.evaluate(`(()=>{const select=document.querySelectorAll('select')[${index}];select.value=${JSON.stringify(value)};select.dispatchEvent(new Event('change',{bubbles:true}))})()`)}
try{
 await page.call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false})
 await page.call('Page.navigate',{url:`${process.env.QA_WEB_URL??'http://127.0.0.1:5173'}/scripts/fixtures/household-life.html`})
 await page.call('Page.bringToFront')
 await waitFor(page,`document.querySelector('canvas')`)
 await delay(1000)
 await page.evaluate(`(async()=>{
  const {_roots}=await import('/node_modules/.vite/deps/@react-three_fiber.js');
  window.lifeProbe=()=>{
   const scene=[..._roots.values()][0].store.getState().scene;
   const actor=scene.getObjectByName('household-resident:Emma'),bones=[];let props=0;
   actor?.traverse(object=>{if(object.isBone)bones.push({id:object.uuid,position:object.position.toArray(),rotation:object.quaternion.toArray()});if(object.name.startsWith('life-prop:'))props++});
   return {bones,props,position:actor?.position.toArray(),steam:Boolean(scene.getObjectByName('cooking-steam'))};
  };
 })()`)
 const models=await page.evaluate(`[...document.querySelectorAll('select')[1].options].map(option=>option.value)`)
 for(const model of models){
  const previous=await page.evaluate('window.lifeProbe().bones[0]?.id')
  await select(1,model)
  await waitFor(page,`window.lifeProbe().bones.length>10 && window.lifeProbe().bones[0].id!==${JSON.stringify(previous)}`)
  await delay(400)
  const before=await page.evaluate('window.lifeProbe()')
  await delay(250)
  const after=await page.evaluate('window.lifeProbe()')
  assert.ok(after.bones.every(bone=>[...bone.position,...bone.rotation].every(Number.isFinite)),`${model}: non-finite skeleton`)
  assert.ok(after.bones.some((bone,index)=>bone.rotation.some((value,axis)=>Math.abs(value-(before.bones[index]?.rotation[axis]??value))>.00001)),`${model}: animation stalled`)
  assert.equal(after.steam,true)
 }
 await select(1,'city-01');await delay(500)
 const start=await page.evaluate('window.lifeProbe().position')
 await select(0,'eat');await delay(180)
 const early=await page.evaluate('window.lifeProbe().position')
 assert.ok(Math.hypot(early[0]-start[0],early[2]-start[2])<.5,'New action teleported across the kitchen')
 await delay(11000)
 assert.equal((await page.evaluate('window.lifeProbe()')).steam,false,'Cooking steam persisted after the cook left')
 const mobile={width:390,height:844,deviceScaleFactor:1,mobile:true}
 await page.call('Emulation.setDeviceMetricsOverride',mobile)
 await delay(300)
 assert.equal(await page.evaluate('document.documentElement.scrollWidth'),390)
 await page.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
 await delay(500)
 const paused=await page.evaluate('window.lifeProbe().bones')
 await delay(400)
 assert.deepEqual(await page.evaluate('window.lifeProbe().bones'),paused,'Reduced motion changed bone transforms')
 if(process.env.QA_SCREENSHOT){const shot=await page.call('Page.captureScreenshot',{format:'png'});await writeFile(process.env.QA_SCREENSHOT,Buffer.from(shot.data,'base64'))}
 assert.deepEqual(page.errors,[])
 console.log(`Household life browser checks passed: ${models.length} rigs animate, finite bone transforms, safe action transitions, cooking state, mobile and reduced motion. No account writes.`)
}finally{await page.close()}
