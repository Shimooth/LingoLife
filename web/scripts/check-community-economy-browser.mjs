// Mutating integration QA requires a separate backend/database and explicit test session.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {openQaPage,waitFor,delay} from './browser-cdp.mjs'
const base=process.env.QA_WEB_URL??'http://127.0.0.1:5174'
assert.match(base,/^http:\/\/127\.0\.0\.1:5174\/?$/,'Use the isolated QA frontend, not the player service')
assert.ok(process.env.QA_SESSION_FILE,'An isolated QA session file is required')
const auth=JSON.parse(await fs.readFile(process.env.QA_SESSION_FILE,'utf8'))
assert.equal(auth.username,'onboarding-test-community-drag')
const out=process.env.QA_OUTPUT_DIR??'/private/tmp/lingolife-community-drag-qa/images'
await fs.mkdir(out,{recursive:true})
const page=await openQaPage(),checks=[]
const get=path=>page.evaluate(`fetch('/api/v1/${path}',{headers:{Authorization:'Bearer '+localStorage.getItem('lingolife.session-token')}}).then(r=>{if(!r.ok)throw Error(r.status);return r.json()})`)
const state=()=>get('neighborhood')
const click=async selector=>{await waitFor(page,`document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled`,30000);await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await delay(160)}
const settled=()=>waitFor(page,`!document.querySelector('.neighborhood-footer .is-saving')`,30000)
const field=(selector,value)=>page.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`)
const shot=async name=>{await delay(300);const {data}=await page.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(`${out}/${name}.png`,Buffer.from(data,'base64'));assert.ok(await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Horizontal overflow')}
const wallet=async()=>{if(await page.evaluate(`Boolean(document.querySelector('.neighborhood-panel'))`))await click('.neighborhood-close');await click('.city-life-wallet');await waitFor(page,`document.querySelector('[data-neighborhood-tab="wallet"]')`)}
const fund=async id=>{await wallet();await click(`[data-project-id="${id}"] .neighborhood-primary`);await waitFor(page,`!document.querySelector('.neighborhood-panel')`,30000);assert.equal((await state()).projects.find(p=>p.id===id).status,'completed');await delay(500)}
const dismissOpening=async()=>{if(await page.evaluate(`Boolean(document.querySelector('.neighborhood-opening-top button'))`)){await click('.neighborhood-opening-top button');await waitFor(page,`!document.querySelector('.neighborhood-opening-notice')`)}}
const scene=expression=>page.evaluate(`(async()=>{const {_roots}=await import('/node_modules/.vite/deps/@react-three_fiber.js');const scene=[..._roots.values()].map(r=>r.store.getState().scene).find(s=>s.getObjectByName('neighborhood-facilities'));return ${expression}})()`)
const dock=id=>page.evaluate(`(()=>{const e=document.querySelector('.world3d-resident-button[data-resident-drop-id="${id}"]');e.scrollIntoView({block:'nearest',inline:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
try{
 await page.call('Page.enable');await page.call('Page.bringToFront');await page.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})
 await page.call('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('lingolife.session-token',${JSON.stringify(auth.session_token)});localStorage.setItem('lingolife.language','zh');`})
 await page.call('Page.navigate',{url:base});await waitFor(page,`document.querySelector('.city-life-wallet')`,45000)
 assert.equal((await get('auth/me')).user.username,auth.username)
 const initial=await state();assert.equal(initial.residents.length,1);assert.equal(initial.coins,250);assert.equal(initial.unlocks.fountain,false)
 await waitFor(page,`document.querySelector('[data-neighborhood-project="fountain"]')`,30000)
 assert.equal(await scene(`Boolean(scene?.getObjectByName('neighborhood-fountain-landmark'))`),false)
 await shot('01-resident-proposal-map');await wallet();await click('[data-economy-action="claim-support"]');await settled()
 assert.equal((await state()).coins,280);assert.ok(await page.evaluate(`document.querySelector('[data-economy-action="claim-support"]').disabled`))
 await click('.neighborhood-wallet-spending .neighborhood-item-grid article:first-child .neighborhood-primary');await settled();assert.equal((await state()).coins,258);assert.equal((await state()).gifts.sketchbook,1)
 await shot('02-wallet-desktop');checks.push('daily grant once, real gift purchase, ledger and proposed map parcel')
 await fund('fountain');assert.equal((await state()).coins,218);await waitFor(page,`document.querySelector('[data-neighborhood-facility="fountain"]')`,30000);assert.equal(await scene(`Boolean(scene?.getObjectByName('neighborhood-fountain-landmark'))`),true)
 await shot('03-funded-fountain');await dismissOpening()
 // These residents belong only to the disposable integration database.
 await page.evaluate(`(async()=>{const headers={Authorization:'Bearer '+localStorage.getItem('lingolife.session-token'),'Content-Type':'application/json'};const arrival=await fetch('/api/v1/arrival',{headers}).then(r=>r.json());for(const name of ['小满','小禾']){const p=structuredClone(arrival.draft.profile);p.name=name;const r=await fetch('/api/v1/npcs',{method:'POST',headers,body:JSON.stringify(p)});if(!r.ok)throw Error('QA resident '+r.status)}})()`)
 await page.call('Page.reload');await delay(600);await waitFor(page,`document.querySelectorAll('.world3d-resident-button[data-resident-drop-id]').length===3&&!document.querySelector('.world3d-intro')`,45000)
 let current=await state();assert.equal(current.projects.find(p=>p.id==='clothing_store').status,'locked')
 const ids=current.residents.map(r=>r.id);await page.evaluate(`(()=>{window.qaMeetRequests=0;const native=window.fetch.bind(window);window.fetch=(...args)=>{const body=JSON.parse(args[1]?.body||'{}');if(String(args[0]).endsWith('/neighborhood/command')&&body.action==='meet')window.qaMeetRequests++;return native(...args)}})()`)
 const a=await dock(ids[0]),b=await dock(ids[1])
 await page.call('Input.dispatchMouseEvent',{type:'mousePressed',...a,button:'left',clickCount:1});await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:a.x+12,y:a.y+3,button:'left',buttons:1});await delay(70);await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...b,button:'left',buttons:1});await delay(100)
 assert.equal(await page.evaluate(`document.querySelector('.world3d-shell').dataset.residentDragTarget`),ids[1]);await shot('04-real-drag-target')
 await page.call('Input.dispatchMouseEvent',{type:'mouseReleased',...b,button:'left',clickCount:1});await waitFor(page,`document.querySelector('input[name="neighborhood-topic"]')`,30000)
 assert.equal(await page.evaluate('window.qaMeetRequests'),1);current=await state();assert.equal(current.meetings.length,1);assert.equal(current.meetings[0].npc_id,ids[0]);assert.equal(current.meetings[0].target_id,ids[1]);assert.equal(current.meetings[0].status,'awaiting_advice')
 assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('.neighborhood-pair-slot select')].map(e=>e.value)`),ids.slice(0,2))
 await field('input[name="neighborhood-topic"]','一起画喷泉边的花');await click('.neighborhood-choice-row .neighborhood-primary');await settled();current=await state();assert.equal(current.meetings[0].status,'resolved');assert.equal(current.meetings[0].topic.text,'一起画喷泉边的花');assert.equal(current.coins,238);assert.equal(current.projects.find(p=>p.id==='clothing_store').status,'proposed')
 await shot('05-real-drag-conversation');checks.push('drag sends one meet, opens correct pair and scene, real topic and reward persist, conversation enables shop proposal')
 await fund('clothing_store');assert.equal((await state()).coins,178);await dismissOpening();await waitFor(page,`document.querySelector('[data-neighborhood-facility="wardrobe"]')`,30000)
 await fund('flower_beds');await fund('plaza_lights');current=await state();assert.equal(current.coins,93);assert.ok(current.projects.every(p=>p.status==='completed'))
 const decorations=await scene(`(()=>{const counts={beds:0,lamps:0};scene?.traverse(o=>{if(o.name==='funded-flower-bed')counts.beds++;if(o.name==='funded-plaza-light')counts.lamps++});return counts})()`);assert.deepEqual(decorations,{beds:2,lamps:2})
 await shot('06-paid-improvements-map');checks.push('four projects charge once, original assets appear in real parcels, two paid flower beds and lamps rendered')
 await wallet();await page.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await shot('07-wallet-mobile');await page.evaluate(`document.querySelector('.neighborhood-wallet-projects').scrollIntoView()`);await shot('08-projects-mobile')
 const ledger=(await state()).economy.ledger;assert.deepEqual(ledger.map(v=>v.delta),[30,-22,-40,20,-60,-35,-50]);assert.equal(ledger.at(-1).balance,93)
 await page.call('Page.reload');await delay(600);await waitFor(page,`document.querySelector('.city-life-wallet')`,45000);current=await state();assert.equal(current.coins,93);assert.equal(current.residents.length,3);assert.equal(current.meetings[0].status,'resolved');assert.ok(current.projects.every(p=>p.status==='completed'));assert.equal(current.gifts.sketchbook,1);assert.deepEqual(current.economy.ledger,ledger)
 checks.push('wallet at 390px, persisted purchases/projects/meeting after reload, exact transaction balance')
 assert.deepEqual(page.errors,[]);assert.deepEqual(page.consoleErrors,[]);await fs.writeFile(`${out}/report.json`,JSON.stringify({checks,decorations,coins:current.coins},null,2));console.log(JSON.stringify({result:'passed',checks,images:out}))
}catch(error){await shot('failure').catch(()=>{});console.error(JSON.stringify({text:await page.evaluate('document.body.innerText.slice(0,6000)').catch(()=>''),errors:page.errors,consoleErrors:page.consoleErrors}));throw error}
finally{await page.close()}
