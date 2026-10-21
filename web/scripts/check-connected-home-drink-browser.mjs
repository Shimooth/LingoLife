import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {openQaPage,waitFor,delay} from './browser-cdp.mjs'

const output=process.env.QA_OUTPUT_DIR??'/private/tmp/lingolife-connected-home-qa'
await mkdir(output,{recursive:true})
const page=await openQaPage()
const click=selector=>page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
try{
 await page.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})
 await page.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
 await page.call('Page.navigate',{url:`${process.env.QA_WEB_URL??'http://127.0.0.1:5173'}/scripts/fixtures/connected-home.html`})
 await page.call('Page.bringToFront')
 await waitFor(page,`document.querySelector('[data-phase="drink"]')&&document.querySelector('canvas')`)
 await click('[data-phase="drink"]');await click('[data-home-area="living_room"]')
 await page.evaluate(`(async()=>{
  const {_roots}=await import('/node_modules/.vite/deps/@react-three_fiber.js');const {Vector3}=await import('/node_modules/.vite/deps/three.js');
  window.connectedDrinkProbe=()=>{
   const root=[..._roots.values()][0];if(!root)return {actors:[],cups:[],duplicate:[]};
   const scene=root.store.getState().scene;scene.updateMatrixWorld(true);
   const actors=[],cups=[],duplicate=[];
   scene.traverse(object=>{
    if(object.name.startsWith('drink-resident:')){const hand=object.getObjectByName('HandR')??object.getObjectByName('DEF-handR');actors.push({id:object.name.slice('drink-resident:'.length),position:object.getWorldPosition(new Vector3()).toArray(),hand:hand?.getWorldPosition(new Vector3()).toArray(),beat:object.userData.drink?.beat})}
    if(object.name==='shared-drink-physical-cup')cups.push({position:object.getWorldPosition(new Vector3()).toArray(),beat:object.userData.beat,mouth:object.userData.mouthSurface});
    if(['household-resident:aria','household-resident:nora'].includes(object.name))duplicate.push(object.name);
   });return {actors,cups,duplicate};
  };
 })()`)
 await waitFor(page,`connectedDrinkProbe().actors.length===2&&connectedDrinkProbe().actors.every(actor=>actor.hand)&&connectedDrinkProbe().cups.length===2`)
 const resting=await page.evaluate('connectedDrinkProbe()')
 assert.deepEqual(resting.duplicate,[],'Shared drink residents also remained in ordinary actor slots')
 const inLiving=position=>position.every(Number.isFinite)&&position[0]>=-11.447&&position[0]<=-.953&&position[2]>=.7395&&position[2]<=7.8675
 assert.ok(resting.actors.every(actor=>inLiving(actor.position)),'Drink actors missed the translated living-room floor')
 assert.ok(resting.cups.every(cup=>inLiving(cup.position)),'Physical cups missed the translated living-room table')
 await page.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]})
 await waitFor(page,`connectedDrinkProbe().cups.some(cup=>cup.beat==='sip')`,25000)
 const sipping=await page.evaluate('connectedDrinkProbe()')
 assert.deepEqual(sipping.duplicate,[])
 for(const [index,cup] of sipping.cups.entries()){
  if(cup.beat!=='sip')continue
  const hand=sipping.actors[index].hand
  assert.ok(inLiving(cup.position),'Sip cup has a second parent offset')
  assert.ok(Math.hypot(...cup.position.map((value,axis)=>value-hand[axis]))<.18,'Sip cup lost actual hand contact')
  assert.ok(cup.mouth?.every(Number.isFinite),'Sip mouth calibration is missing or invalid')
  assert.ok(Math.hypot(...cup.position.map((value,axis)=>value-cup.mouth[axis]))<.3,'Sip cup missed the actual face after room translation')
 }
 const screenshot=await page.call('Page.captureScreenshot',{format:'png'})
 await writeFile(`${output}/desktop-shared-drink.png`,Buffer.from(screenshot.data,'base64'))
 await delay(300)
 assert.deepEqual(page.errors,[]);assert.deepEqual(page.consoleErrors,[])
 await writeFile(`${output}/drink-report.json`,JSON.stringify({status:'passed',resting,sipping,noAccountWrites:true},null,2))
 console.log('Connected-home drink browser checks passed: two real rigs and cups in the translated living room, no duplicate residents, physical hand/face contact during normal sip, finite coordinates, reduced-motion placement. No account writes.')
}finally{await page.close()}
