// Read-only acceptance on an existing, completed test save. Never resets or settles gameplay.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {openQaPage,waitFor,delay} from './browser-cdp.mjs'
if(!process.env.QA_SESSION_FILE)throw Error('Set QA_SESSION_FILE to a private test session file.')
const auth=JSON.parse(await fs.readFile(process.env.QA_SESSION_FILE,'utf8'))
assert.match(auth.username,/^onboarding-test(?:-|$)/)
const out=process.env.QA_OUTPUT_DIR??'/private/tmp/lingolife-polish-qa'
await fs.mkdir(out,{recursive:true})
const page=await openQaPage()
let step='connect'
const click=async selector=>{await waitFor(page,`document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled`,30000);await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)}
const get=path=>page.evaluate(`fetch('/api/v1/${path}',{headers:{Authorization:'Bearer '+localStorage.getItem('lingolife.session-token')}}).then(r=>{if(!r.ok)throw Error(r.status);return r.json()})`)
const shot=async name=>{await delay(400);const{data}=await page.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(`${out}/${name}.png`,Buffer.from(data,'base64'));assert.ok(await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'No horizontal overflow')}
const snapshot=s=>({coins:s.coins,wishes:s.wishes,residents:s.residents.map(r=>({id:r.id,profile:r.profile,care:r.care})),revision:s.revision})
const waitAfterReload=async expression=>{
 const deadline=Date.now()+60000
 while(Date.now()<deadline){
  try{if(await page.evaluate(`Boolean(${expression})`))return}
  catch(error){if(!/navigated|Cannot find context|Execution context was destroyed|Not attached to an active page/.test(error.message))throw error}
  await delay(150)
 }
 throw Error('Reload did not finish: '+expression)
}
try{
 await page.call('Page.enable');await page.call('Page.bringToFront')
 await page.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})
 await page.call('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('lingolife.session-token',${JSON.stringify(auth.session_token)});localStorage.setItem('lingolife.language','zh');localStorage.setItem('lingolife.topbar-collapsed','0');`})
 await page.call('Page.navigate',{url:'http://127.0.0.1:5173'})
 await waitFor(page,`document.querySelector('.city-fountain-button')&&!document.querySelector('.world3d-intro')`,60000)
 assert.equal((await get('auth/me')).user.username,auth.username)
 const initial=await get('neighborhood');assert.ok(initial.news.find(n=>n.id==='fountain-open')?.read,'Read-only test requires fountain news already read')
 step='fountain';await click('.city-fountain-button')
 await waitFor(page,`document.querySelector('.neighborhood-opening-notice')`,30000)
 await delay(1400);await shot('01-fountain-building')
 await waitFor(page,`document.querySelector('.neighborhood-opening-notice>small')?.textContent.includes('已经建在地图上')`,30000)
 await delay(1000);await shot('02-fountain-desktop')
 await page.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(500);await shot('03-fountain-mobile')
 await page.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})
 await click('.neighborhood-opening-top button')
 await click('[data-neighborhood-facility="fountain"]')
 await waitFor(page,`document.querySelector('[data-neighborhood-tab="fountain"]')`)
 await click('.neighborhood-nav button:nth-child(3)')
 step='welcome';await click('.neighborhood-resident-extras button:last-child')
 await waitFor(page,`document.querySelector('.arrival-replay-dialog')?.open`)
 await waitFor(page,`document.querySelector('[data-welcome-phase="greeting"]')`,30000);await shot('04-welcome-greeting')
 await waitFor(page,`document.querySelector('[data-welcome-phase="settled"]')`,15000);await shot('05-welcome-settled')
 await page.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
 await delay(1800);await shot('06-welcome-mobile')
 const boxes=await page.evaluate(`(()=>{const els=['.arrival-welcome-copyline','.arrival-welcome-actions'];return els.map(s=>{const r=document.querySelector(s).getBoundingClientRect();return {selector:s,left:r.left,right:r.right,bottom:r.bottom,top:r.top}})})()`)
 for(const b of boxes){assert.ok(b.left>=0&&b.right<=391&&b.bottom<=845,`Mobile content on screen: ${b.selector}`)}
 await click('.arrival-welcome-actions .arrival-primary')
 await waitFor(page,`document.querySelector('[data-neighborhood-tab="residents"]')`)
 step='voice';await click('.neighborhood-resident-extras button:first-child')
 await waitFor(page,`document.querySelector('.resident-voice-picker')`)
 await waitFor(page,`/Samantha|Google|Daniel/.test(document.querySelector('.resident-voice-picker__current')?.textContent??'')`,30000)
 await shot('07-voice-mobile')
 await page.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await delay(400);await shot('08-voice-desktop')
 // Select without preview or saving, then cancel. This must preserve the actual profile.
 await page.evaluate(`(()=>{const e=document.querySelector('.resident-voice-picker__pace button:last-child');e.click()})()`)
 await click('.studio header button')
 await waitFor(page,`document.querySelector('[data-neighborhood-tab="residents"]')`)
 step='voice';await click('.neighborhood-resident-extras button:first-child')
 await waitFor(page,`document.querySelector('.resident-voice-picker')`)
 assert.equal(await page.evaluate(`document.querySelector('.resident-voice-picker__pace button[aria-pressed="true"]').textContent`),'自然原声')
 await click('.studio header button')
 assert.deepEqual(snapshot(await get('neighborhood')),snapshot(initial),'Replay and cancelled voice edits leave save unchanged')
 // Simulate an unread opening and failed acknowledgement entirely in this tab.
 // Network writes are intercepted; the real test save remains unchanged.
 step='news recovery';const mock=await page.call('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
  const native=window.fetch.bind(window);let current;window.__openingAttempts=0;window.__openingNativeFetch=native;
  window.fetch=async(...args)=>{
   const url=String(args[0]);
   if(url.endsWith('/neighborhood/command')){
    const body=JSON.parse(args[1]?.body||'{}');if(body.action!=='read_news')throw Error('Read-only QA blocked unexpected command');
    window.__openingAttempts++;if(window.__openingAttempts<=2)throw TypeError('QA temporary disconnect');
    current={...current,revision:current.revision+1,news:current.news.map(n=>n.id===body.news_id?{...n,read:true}:n)};
    return new Response(JSON.stringify(current),{headers:{'Content-Type':'application/json'}});
   }
   const result=await native(...args);
   if(url.endsWith('/neighborhood')){const data=await result.json();current??={...data,news:data.news.map(n=>n.id==='fountain-open'?{...n,read:false}:n)};return new Response(JSON.stringify(current),{headers:{'Content-Type':'application/json'}})}
   return result;
  };
 })()`})
 await page.call('Page.reload')
 await waitAfterReload(`window.__openingAttempts!==undefined&&document.querySelector('.neighborhood-opening-notice')`)
 assert.equal(await page.evaluate(`Boolean(document.querySelector('.neighborhood-panel'))`),false,'Unread opening starts on map')
 await click('.neighborhood-opening-top button')
 await waitFor(page,`document.querySelector('.neighborhood-opening-error')`)
 assert.equal(await page.evaluate('window.__openingAttempts'),2,'Failed automatic retry retains card')
 await click('.neighborhood-opening-actions button:last-child')
 await waitFor(page,`document.querySelector('[data-neighborhood-tab="fountain"]')`)
 assert.equal(await page.evaluate('window.__openingAttempts'),3,'Explicit retry opens requested facility')
 await page.call('Page.removeScriptToEvaluateOnNewDocument',{identifier:mock.identifier})
 await page.evaluate('window.fetch=window.__openingNativeFetch')
 assert.deepEqual(snapshot(await get('neighborhood')),snapshot(initial),'Mock acknowledgement never writes the real save')
 assert.deepEqual(page.errors,[]);assert.deepEqual(page.consoleErrors,[])
 console.log(JSON.stringify({result:'passed',screenshots:out,checks:['real map fountain reveal','map click opens fountain','welcome phase timing','desktop and 390px UI','existing resident voice editor','cancel restores resident and voice','unread opening stays on map','failed news acknowledgement retains card and retries','save unchanged','no browser errors']}))
}catch(error){console.error('Failed during '+step+': '+error.message);await shot('failure').catch(()=>undefined);console.error(JSON.stringify({text:await page.evaluate('document.body.innerText.slice(0,6000)').catch(()=>''),errors:page.errors,consoleErrors:page.consoleErrors}));throw error}
finally{await page.close().catch(()=>undefined)}
