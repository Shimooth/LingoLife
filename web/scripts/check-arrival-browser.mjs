// Real authenticated tutorial QA. Only an explicitly supplied local test session is used.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {openQaPage,waitFor,delay} from './browser-cdp.mjs'
const base='http://127.0.0.1:5173'
const sessionFile=process.env.QA_SESSION_FILE
if(!sessionFile)throw new Error('Set QA_SESSION_FILE to a local onboarding-test session JSON file.')
const auth=JSON.parse(await fs.readFile(sessionFile,'utf8'))
assert.match(auth.username,/^onboarding-test(?:-|$)/)
const out=process.env.QA_OUTPUT_DIR??'/private/tmp/lingolife-arrival-qa'
await fs.mkdir(out,{recursive:true})
const page=await openQaPage()
const step=s=>`document.querySelector('[data-arrival-step="${s}"]')`
const readState=()=>page.evaluate(`fetch('/api/v1/arrival',{headers:{Authorization:'Bearer '+localStorage.getItem('lingolife.session-token')}}).then(r=>r.json())`)
const click=async selector=>{await waitFor(page,`document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled`);await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)}
const setInput=async(selector,value)=>{
 await waitFor(page,`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return e&&!e.disabled&&!e.closest('fieldset[disabled]')})()`)
 await page.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`)
 await delay(100)
}
const screenshot=async name=>{const {data}=await page.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(`${out}/${name}.png`,Buffer.from(data,'base64'))}
const checkWidth=async()=>assert.ok(await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Horizontal overflow')
const probeActor=()=>page.evaluate(`(async()=>{
 const {_roots}=await import('/node_modules/.vite/deps/@react-three_fiber.js');
 const {Vector3}=await import('/node_modules/.vite/deps/three.js');
 const scene=[..._roots.values()].map(root=>root.store.getState().scene).find(scene=>scene.getObjectByName('arrival-resident'));
 const actor=scene?.getObjectByName('arrival-resident'),hand=actor?.getObjectByName('DEF-handR')??actor?.getObjectByName('HandR');
 const food=scene?.getObjectByName('arrival-food-in-hand');
 return {hasRig:Boolean(hand),performance:actor?.userData.arrival,hand:hand?.getWorldPosition(new Vector3()).toArray(),food:food?.position.toArray()};
})()`)
try{
 await page.call('Page.enable')
 await page.call('Page.bringToFront')
 await page.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})
 await page.call('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('lingolife.session-token',${JSON.stringify(auth.session_token)});localStorage.setItem('lingolife.language','zh');`})
 await page.call('Page.navigate',{url:base})
 await waitFor(page,step('appearance'),30000)
 const identity=await page.evaluate(`fetch('/api/v1/auth/me',{headers:{Authorization:'Bearer '+localStorage.getItem('lingolife.session-token')}}).then(r=>r.json())`)
 assert.equal(identity.user?.username,auth.username,'The live session must belong to the named test account.')
 assert.equal((await readState()).stage,'create','Reset the test save before this QA run.')
 await delay(1600)
 await screenshot('01-appearance-desktop');await checkWidth()
 await setInput('input[name="resident-name"]','晴晴')
 // Simulate a committed draft response being lost; the hook must reconcile it.
 await page.evaluate(`(()=>{const original=window.fetch.bind(window);window.__qaDropDraft=true;window.fetch=async(...args)=>{const response=await original(...args);if(window.__qaDropDraft&&String(args[0]).endsWith('/arrival/draft')&&args[1]?.method==='PUT'){window.__qaDropDraft=false;throw new TypeError('QA lost response')}return response};})()`)
 await click('.arrival-creator__next');await waitFor(page,step('voice'))
 await waitFor(page,`document.querySelector('.arrival-creator__save')?.dataset.status==='saved'`)
 assert.equal((await readState()).draft.profile.name,'晴晴')
 await page.call('Page.reload');await waitFor(page,step('voice'))
 assert.equal(await page.evaluate(`document.querySelector('.arrival-creator__nametag strong').textContent`),'晴晴')
 await screenshot('02-voice-desktop')
 await click('.arrival-creator__next');await waitFor(page,step('personality'))
 await setInput('.arrival-creator__personality input[type="range"]','85')
 await click('.arrival-creator__next');await waitFor(page,step('personality_review'))
 await screenshot('03-personality-desktop')
 await page.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
 await delay(300);await checkWidth();await screenshot('04-personality-mobile')
 await click('.arrival-creator__next');await waitFor(page,step('introduction'))
 await click('.arrival-creator__next');await waitFor(page,step('manager'))
 await setInput('input[name="manager-name"]','岛主')
 await screenshot('05-manager-mobile');await checkWidth()
 await page.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})
 await click('.arrival-creator__next')
 await waitFor(page,`document.querySelector('.arrival-care.is-welcome')`,60000)
 await delay(4500);await screenshot('06-welcome-desktop');await checkWidth()
 assert.ok((await probeActor()).hasRig,'Welcome must use the selected resident model')
 assert.equal((await readState()).manager.name,'岛主')
 await click('.arrival-welcome-actions .arrival-primary')
 await click('.arrival-care-actions .arrival-primary')
 await waitFor(page,`document.querySelector('.arrival-food-panel')`)
 await screenshot('07-food-shop-desktop')
 await page.evaluate(`(()=>{const original=window.fetch.bind(window);window.__qaDropBuy=2;window.fetch=async(...args)=>{const response=await original(...args);if(window.__qaDropBuy&&String(args[0]).endsWith('/arrival/command')&&JSON.parse(args[1]?.body||'{}').action==='buy'&&JSON.parse(args[1].body).food_id==='toast'){window.__qaDropBuy--;throw new TypeError('QA lost purchase response')}return response};})()`)
 await click('.arrival-food-grid article:nth-child(1) button:first-child')
 await waitFor(page,`document.querySelector('.arrival-care-error')`)
 assert.equal((await readState()).coins,85)
 // A different purchase must not discard the uncertain toast request's key.
 await click('.arrival-food-grid article:nth-child(2) button:first-child')
 await waitFor(page,`document.querySelector('.arrival-money')?.textContent.includes('60')`)
 await click('.arrival-food-grid article:nth-child(1) button:first-child')
 await waitFor(page,`!document.querySelector('.arrival-food-grid article:nth-child(1) button:first-child').disabled`)
 const bought=await readState();assert.equal(bought.coins,60);assert.equal(bought.inventory.toast,1);assert.equal(bought.inventory.rice,1)
 await page.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
 await delay(300);await screenshot('08-food-shop-mobile');await checkWidth()
 await page.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})
 await click('.arrival-food-grid article:nth-child(1) button:last-child')
 await waitFor(page,`document.querySelector('.arrival-eating-progress')`)
 await delay(950);await screenshot('09-first-bite-desktop')
 const firstBite=await probeActor();assert.ok(firstBite.hasRig);assert.ok(firstBite.performance.time>0)
 console.log(JSON.stringify({feeding:firstBite}))
 await waitFor(page,`document.querySelectorAll('.arrival-eating-progress i.is-done').length>=2`)
 await screenshot('10-second-bite-desktop')
 await waitFor(page,`document.querySelector('.arrival-level-result')`,20000)
 const fed=await readState();assert.equal(fed.care.level,2);assert.equal(fed.care.xp,20);assert.equal(fed.care.satiety,70);assert.equal(fed.inventory.toast,0)
 await screenshot('11-level-up-desktop')
 await page.call('Page.reload');await waitFor(page,`document.querySelector('.arrival-level-result')`)
 assert.equal((await readState()).care.xp,20)
 await page.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
 await delay(300);await screenshot('12-level-up-mobile');await checkWidth()
 await click('.arrival-level-result .arrival-primary')
 await waitFor(page,`!document.querySelector('.arrival-care')&&!document.querySelector('.branded-startup')&&document.querySelector('canvas')`,45000)
 assert.equal((await readState()).stage,'complete')
 await page.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})
 await waitFor(page,`document.querySelector('.world3d-resident-dock')&&!document.querySelector('.world3d-intro')`,45000)
 await delay(500);await screenshot('13-city-desktop')
 assert.deepEqual(page.errors,[])
 assert.deepEqual(page.consoleErrors,[])
 console.log(JSON.stringify({result:'passed',screenshots:out,checks:['six creator steps','autosave response loss','refresh draft','manager name','welcome','distinct food purchases','cross-button purchase retry idempotency','three bite animation','real satiety','first level','refresh without extra settlement','city handoff','390px overflow','no browser errors']}))
}catch(error){
 await screenshot('failure')
 console.error(JSON.stringify({pageText:await page.evaluate('document.body.innerText.slice(0,3500)'),sessionPresent:await page.evaluate("Boolean(localStorage.getItem('lingolife.session-token'))"),errors:page.errors,consoleErrors:page.consoleErrors}))
 throw error
}finally{await page.close()}
