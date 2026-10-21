import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {openQaPage,waitFor,delay} from './browser-cdp.mjs'
const dir=process.env.QA_ARTIFACT_DIR??'/private/tmp/lingolife-town-scale-qa-images'
await mkdir(dir,{recursive:true})
const page=await openQaPage(),reports=[]
try{
 await page.call('Page.enable')
 for(const device of [{name:'desktop',width:1280,height:900},{name:'mobile',width:390,height:844}]){
  await page.call('Emulation.setDeviceMetricsOverride',{width:device.width,height:device.height,deviceScaleFactor:1,mobile:device.name==='mobile'})
  for(const mode of ['door','car','street']){
   await page.call('Page.navigate',{url:`http://127.0.0.1:5173/scripts/fixtures/town-scale.html?mode=${mode}`})
   await page.call('Page.bringToFront')
   await waitFor(page,`window.townScaleQa?.ready && window.townScaleQa?.mode === ${JSON.stringify(mode)}`)
   await delay(450)
   const state=await page.evaluate('window.townScaleQa')
   assert.ok(state.skeletons>2,'Uses actual prepared resident rigs')
   for(const b of state.buildings){
    assert.ok(b.size.every(Number.isFinite),`${b.name}: geometry remains finite`)
    assert.ok(b.size[0]<2.4&&b.size[2]<2.4,`${b.name}: roof/step/awning stays inside parcel`)
    assert.equal(b.doorBlocked,false,`${b.name}: ray through doorway must miss the actual facade geometry`)
    assert.ok(b.doorHeight-.044>=.75&&b.doorWidth>=.45,`${b.name}: resident doorway clearance`)
   }
   if(mode==='car'){
    const car=state.cars[0];assert.ok(Math.abs(car.size[1]-.398265)<.002,'Car retains measured body height')
    assert.ok(Math.abs(car.min[1]-.002)<.0001,'Real tires touch ground')
   }
   assert.equal(await page.evaluate('document.documentElement.scrollWidth>innerWidth'),false,'No mobile horizontal overflow')
   const screenshot=await page.call('Page.captureScreenshot',{format:'png'})
   await writeFile(`${dir}/${device.name}-${mode}.png`,Buffer.from(screenshot.data,'base64'))
   reports.push({device:device.name,...state})
  }
 }
 assert.deepEqual(page.errors,[]);assert.deepEqual(page.consoleErrors,[])
 await writeFile(`${dir}/report.json`,JSON.stringify(reports,null,2))
 console.log(`Town scale browser passed: desktop/mobile × door/car/street, actual rigs, parcel bounds, car grounding, no runtime errors. Screenshots: ${dir}`)
}finally{await page.close()}
