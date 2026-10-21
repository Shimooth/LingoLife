import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {openQaPage,delay} from './browser-cdp.mjs'
const dir=process.env.QA_ARTIFACT_DIR??'/private/tmp/lingolife-town-center-qa'
await mkdir(dir,{recursive:true})
const page=await openQaPage(),report={screens:[],walk:[]}
const wait=async expression=>{for(let n=0;n<180;n++){try{if(await page.evaluate(`Boolean(${expression})`))return}catch(error){if(!/context|document|navigation/i.test(error.message))throw error}await delay(100)}throw new Error(`Timeout: ${expression}`)}
const scene=async expression=>page.evaluate(`(async()=>{const { _roots }=await import('/node_modules/.vite/deps/@react-three_fiber.js');const state=[..._roots.values()][0]?.store.getState();if(!state)return null;const {scene,camera}=state;return ${expression}})()`)
const shot=async name=>{await delay(800);const png=await page.call('Page.captureScreenshot',{format:'png'});await writeFile(`${dir}/${name}.png`,Buffer.from(png.data,'base64'));report.screens.push(name)}
const click=selector=>page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
const ready=async()=>{await wait(`window.townPreview && document.querySelector('canvas') && !document.querySelector('.world3d-loading')`);await delay(2400)}
try{
 await page.call('Page.enable')
 await page.call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false})
 await page.call('Page.navigate',{url:'http://127.0.0.1:5173/scripts/fixtures/town-center.html'})
 await ready()
 assert.equal(await page.evaluate(`document.querySelector('.world3d-shell').dataset.cameraFraming`),'neighborhood')
 const geometry=await scene(`(()=>{const buildings=[];scene.traverse(o=>{if(o.name.startsWith('town-building:'))buildings.push({name:o.name,position:o.position.toArray(),scale:o.scale.toArray()})});return {buildings,fountain:scene.getObjectByName('neighborhood-fountain-landmark')?.position.toArray(),shop:scene.getObjectByName('neighborhood-wardrobe-landmark')?.position.toArray(),zoom:camera.zoom}})()`)
 assert.deepEqual(geometry.fountain,[0,.369,6.5]);assert.deepEqual(geometry.shop,[5.2,.369,2.6])
 assert.equal(geometry.buildings.length,5);assert.ok(geometry.buildings.every(b=>b.scale.every(s=>s===1)))
 report.geometry=geometry;await shot('01-neighborhood-desktop')
 await click('[data-neighborhood-facility="fountain"]');assert.match(await page.evaluate('document.body.innerText'),/许愿喷泉入口可用/)
 await click('[data-neighborhood-facility="wardrobe"]');assert.match(await page.evaluate('document.body.innerText'),/服装店入口可用/)
 await click('[data-camera-action="overview"]');await delay(2000)
 assert.equal(await page.evaluate(`document.querySelector('.world3d-shell').dataset.cameraFraming`),'city');assert.ok(await scene('camera.zoom')<geometry.zoom)
 await shot('02-whole-city')
 await click('[data-camera-action="neighborhood"]');await delay(1800)
 await page.evaluate('window.townPreview.walk()')
 for(let n=0;n<14;n++){
  const pos=await scene(`scene.getObjectByName('city-resident:town-qa-home').position.toArray()`)
  report.walk.push(pos);assert.ok(Math.hypot(pos[0],pos[2]-6.5)>1.1,'walk avoids fountain');assert.ok(pos[2]>1.7,'walk stays away from cars')
  if(n===6)await shot('03-walking-to-square')
  await delay(900)
 }
 assert.ok(report.walk.some(p=>Math.abs(p[0]+3.65)<.2),'walk starts at real front door')
 assert.ok(report.walk.at(-1)[2]>4.5&&report.walk.at(-1)[2]<5.4,'resident reaches square')
 for(let n=1;n<report.walk.length;n++)assert.ok(Math.hypot(...report.walk[n].map((v,i)=>v-report.walk[n-1][i]))<2,'journey does not teleport')
 await page.evaluate('window.townPreview.showFountain()');await delay(3800);await shot('04-fountain-close')
 assert.equal(await page.evaluate(`document.querySelector('.world3d-shell').dataset.cameraFraming`),'facility')
 await click('[data-camera-action="neighborhood"]');await delay(1600)
 // A real drag must retain manual camera ownership after programmatic framing settles.
 const before=await scene('camera.position.toArray()')
 await page.call('Input.dispatchMouseEvent',{type:'mousePressed',x:1020,y:625,button:'left',clickCount:1})
 for(let n=1;n<=8;n++)await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:1020+n*11,y:625+n*2,button:'left',buttons:1})
 await page.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:1108,y:641,button:'left',clickCount:1});await delay(1700)
 const manual=await scene('camera.position.toArray()');assert.ok(Math.hypot(...manual.map((v,i)=>v-before[i]))>.3,'manual orbit remains usable')
 await delay(650);assert.ok(Math.hypot(...(await scene('camera.position.toArray()')).map((v,i)=>v-manual[i]))<.1,'camera does not snap back')
 await page.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
 await click('[data-camera-action="neighborhood"]');await delay(2200);await shot('05-neighborhood-mobile')
 assert.equal(await page.evaluate('document.documentElement.scrollWidth>innerWidth'),false)
 const mobileFountain=await page.evaluate(`(()=>{const r=document.querySelector('[data-neighborhood-facility="fountain"]').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`)
 assert.ok(mobileFountain.x>=0&&mobileFountain.x+mobileFountain.w<=390&&mobileFountain.y>80&&mobileFountain.y+mobileFountain.h<740,'mobile fountain interaction is visible')
 await page.call('Page.navigate',{url:'http://127.0.0.1:5173/scripts/fixtures/town-center.html?locked=1&quality=low'})
 await ready();assert.equal(await scene(`Boolean(scene.getObjectByName('neighborhood-fountain-landmark'))`),false)
 await shot('06-locked-square-mobile');await page.evaluate('window.townPreview.setUnlocked(true)');await delay(500)
 assert.deepEqual(await scene(`scene.getObjectByName('neighborhood-fountain-landmark')?.position.toArray()`),[0,.369,6.5])
 await page.call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false})
 await page.call('Page.navigate',{url:'http://127.0.0.1:5173/scripts/fixtures/town-center.html?time=evening'})
 await ready();await shot('07-evening')
 assert.deepEqual(page.errors,[]);assert.deepEqual(page.consoleErrors,[])
 await writeFile(`${dir}/report.json`,JSON.stringify(report,null,2))
 console.log(`Town center browser passed: production map, five low-rise buildings, central facilities, walking, camera/manual orbit, desktop/mobile, unlock and evening. Screenshots: ${dir}`)
}finally{await page.close()}
