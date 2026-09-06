import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {openQaPage,waitFor,delay} from './browser-cdp.mjs'

const page=await openQaPage()
const click=selector=>page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
const state=()=>page.evaluate(`JSON.parse(document.querySelector('#qa-state').textContent)`)
try{
 await page.call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false})
 await page.call('Page.navigate',{url:`${process.env.QA_WEB_URL??'http://127.0.0.1:5173'}/scripts/fixtures/spatial-presence.html`})
 await page.call('Page.bringToFront')
 await waitFor(page,`document.querySelector('canvas')&&!document.querySelector('.world3d-intro')`,60000)
 await page.evaluate(`(async()=>{const {_roots}=await import('/node_modules/.vite/deps/@react-three_fiber.js');window.presenceProbe=()=>{const {scene,camera}=[..._roots.values()][0].store.getState();const actors=[];scene.traverse(object=>{if(object.name.startsWith('city-resident:'))actors.push({id:object.name,position:object.position.toArray()})});return {actors,camera:camera.position.toArray()}}})()`)
 assert.deepEqual((await page.evaluate('presenceProbe()')).actors.map(actor=>actor.id),['city-resident:bo'])
 assert.equal(await page.evaluate(`document.querySelectorAll('.world3d-resident-entry').length`),2,'Indoor residents must remain discoverable')
 assert.equal(await page.evaluate(`document.querySelectorAll('.world3d-home').length`),1,'Filtering actors must not remove home geometry')
 await click('.world3d-resident-entry .world3d-resident-button')
 assert.equal((await state()).opened,'home:shared')
 assert.equal(await page.evaluate('window.lastLocatedResident'),'emma','Home handoff must retain which resident was clicked')
 await click('[data-phase="rooms"]');await delay(200)
 assert.equal((await page.evaluate('presenceProbe()')).actors.length,1,'Room changes must not place anyone in the street')
 for(const phase of ['depart','return']){
  await click(`[data-phase="${phase}"]`)
  await waitFor(page,`presenceProbe().actors.some(actor=>actor.id==='city-resident:emma')`)
  await click('.world3d-resident-entry .world3d-resident-button')
  const first=(await page.evaluate('presenceProbe()')).actors.find(actor=>actor.id==='city-resident:emma').position
  await delay(550)
  const second=(await page.evaluate('presenceProbe()')).actors.find(actor=>actor.id==='city-resident:emma').position
  assert.ok(Math.hypot(second[0]-first[0],second[2]-first[2])>.02,`${phase}: route did not move`)
  await waitFor(page,`!presenceProbe().actors.some(actor=>actor.id==='city-resident:emma')`,15000)
  await waitFor(page,`JSON.parse(document.querySelector('#qa-state').textContent).opened===${JSON.stringify(phase==='depart'?'place:moonlight_cafe':'home:shared')}`)
  assert.ok((await page.evaluate('presenceProbe()')).camera.every(Number.isFinite))
 }
 assert.equal((await state()).arrivals,2,'Life-action arrival should notify exactly once per journey')
 await click('[data-phase="cafe"]');await click('.world3d-resident-entry .world3d-resident-button')
 assert.equal((await state()).opened,'place:moonlight_cafe')
 await page.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
 await click('[data-language]');await delay(200)
 assert.match(await page.evaluate(`document.querySelector('.world3d-presence-label').textContent`),/^Inside/)
 assert.equal(await page.evaluate('document.documentElement.scrollWidth'),390)
 await page.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
 // Re-mount to exercise the world's existing demand-frame reduced-motion mode.
 await page.call('Page.reload');await waitFor(page,`document.querySelector('canvas')&&!document.querySelector('.world3d-intro')`,60000)
 await click('[data-phase="depart"]')
 await waitFor(page,`JSON.parse(document.querySelector('#qa-state').textContent).phase==='cafe'`,15000)
 assert.equal((await state()).arrivals,1,'Arrival timer must also work with no continuous frames')
 if(process.env.QA_SCREENSHOT){const shot=await page.call('Page.captureScreenshot',{format:'png'});await writeFile(process.env.QA_SCREENSHOT,Buffer.from(shot.data,'base64'))}
 assert.deepEqual(page.errors,[])
 assert.deepEqual(page.consoleErrors,[],'React error-boundary failures must not count as successful rendering')
 console.log('Spatial presence browser checks passed: real city actors/labels, room transitions, outbound/return walking, building follow handoff, mobile, reduced motion. No API/account writes.')
}catch(error){
 console.error(await page.evaluate(`JSON.stringify({text:document.body.innerText.slice(-1600),intro:document.querySelector('.world3d-intro')?.className})`),page.errors,page.consoleErrors)
 throw error
}finally{await page.close()}
