// Read-only real-save check. No commands, resets or game rewards are sent.
import assert from 'node:assert/strict'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {openQaPage,delay} from './browser-cdp.mjs'
assert.ok(process.env.QA_SESSION_FILE,'Provide a private QA_SESSION_FILE')
const auth=JSON.parse(await readFile(process.env.QA_SESSION_FILE,'utf8'));assert.equal(auth.username,'onboarding-test')
const dir=process.env.QA_ARTIFACT_DIR??'/private/tmp/lingolife-town-save-qa';await mkdir(dir,{recursive:true})
const page=await openQaPage()
const wait=async expression=>{for(let n=0;n<300;n++){try{if(await page.evaluate(`Boolean(${expression})`))return}catch(error){if(!/context|navigation/i.test(error.message))throw error}await delay(100)}throw Error(`Timeout: ${expression}`)}
const api=path=>page.evaluate(`fetch('/api/v1/${path}',{headers:{Authorization:'Bearer '+localStorage.getItem('lingolife.session-token')}}).then(r=>{if(!r.ok)throw Error(r.status);return r.json()})`)
const stable=s=>({coins:s.coins,wishes:s.wishes,residents:s.residents.map(r=>({id:r.id,profile:r.profile,care:r.care})),revision:s.revision})
const screenshot=async name=>{const s=await page.call('Page.captureScreenshot',{format:'png'});await writeFile(`${dir}/${name}.png`,Buffer.from(s.data,'base64'))}
try{
 await page.call('Page.enable');await page.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})
 await page.call('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('lingolife.session-token',${JSON.stringify(auth.session_token)});localStorage.setItem('lingolife.language','zh');`})
 await page.call('Page.navigate',{url:'http://127.0.0.1:5173'})
 await wait(`document.querySelector('[data-camera-action="neighborhood"]') && !document.querySelector('.world3d-intro')`)
 assert.equal((await api('auth/me')).user.username,auth.username)
 const layout=await api('world-layout');assert.equal(layout.layout.city.theme,'resident-town-v1')
 const before=stable(await api('neighborhood'))
 assert.equal(await page.evaluate(`document.querySelector('.world3d-shell').dataset.cameraFraming`),'neighborhood')
 const positions=await page.evaluate(`(async()=>{const {_roots}=await import('/node_modules/.vite/deps/@react-three_fiber.js');const {scene}=[..._roots.values()][0].store.getState();return {fountain:scene.getObjectByName('neighborhood-fountain-landmark')?.position.toArray(),home:scene.getObjectByName('town-building:shared-home')?.position.toArray()}})()`)
 assert.deepEqual(positions.fountain,[0,.369,6.5]);assert.deepEqual(positions.home,[-5.2,.369,2.6])
 await delay(1000);await screenshot('01-real-save-desktop')
 await page.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(1300);await screenshot('02-real-save-mobile')
 assert.equal(await page.evaluate('document.documentElement.scrollWidth>innerWidth'),false)
 await page.evaluate(`document.querySelector('[data-neighborhood-facility="fountain"]').click()`)
 await wait(`document.querySelector('[data-neighborhood-tab="fountain"]')`)
 assert.deepEqual(stable(await api('neighborhood')),before,'Opening the map and facility does not change saved progress')
 assert.deepEqual(page.errors,[]);assert.deepEqual(page.consoleErrors,[])
 console.log(JSON.stringify({passed:true,layoutVersion:layout.version_id??layout.version,positions,residents:before.residents.length,progressUnchanged:true,screenshots:dir}))
}finally{await page.close()}
