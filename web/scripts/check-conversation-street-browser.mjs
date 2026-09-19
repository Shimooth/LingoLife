import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {openQaPage,waitFor,delay} from './browser-cdp.mjs'
const page=await openQaPage()
try{
 await page.call('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false})
 await page.call('Page.navigate',{url:`${process.env.QA_WEB_URL??'http://127.0.0.1:5173'}/scripts/fixtures/conversation-street.html`})
 await waitFor(page,`document.querySelector('.conversation-stage-3d canvas')`)
 await delay(4500)
 assert.equal(await page.evaluate(`Boolean(document.querySelector('.location-backdrop--street'))`),true)
 assert.equal(await page.evaluate(`Boolean(document.querySelector('.location-backdrop__art'))`),false)
 assert.match(await page.evaluate(`document.querySelector('.conversation-stage-3d__place').textContent`),/街道上/)
 await page.evaluate(`document.querySelector('.world-speech button').click()`)
 assert.match(await page.evaluate(`document.querySelector('.world-speech__translation').textContent`),/一起走/)
 if(process.env.QA_SCREENSHOT){const shot=await page.call('Page.captureScreenshot',{format:'png'});await writeFile(process.env.QA_SCREENSHOT,Buffer.from(shot.data,'base64'))}
 await page.evaluate(`document.querySelector('.scene-scenery-trigger').click()`)
 await waitFor(page,`document.querySelector('.scenery-info')`)
 assert.match(await page.evaluate(`document.querySelector('.scenery-info').textContent`),/人行道/)
 await page.evaluate(`window.qaMode('home')`)
 await waitFor(page,`document.querySelector('.location-backdrop--home')`)
 assert.match(await page.evaluate(`document.querySelector('.location-backdrop__art').style.backgroundImage`),/homes/)
 await page.evaluate(`window.qaMode('office')`)
 await waitFor(page,`document.querySelector('.location-backdrop--work')`)
 assert.match(await page.evaluate(`document.querySelector('.location-backdrop__art').style.backgroundImage`),/innovation_hub/)
 await page.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
 await page.call('Page.reload')
 await waitFor(page,`window.qaLanguage&&document.querySelector('.conversation-stage-3d canvas')`)
 await page.evaluate(`window.qaLanguage('en')`)
 await delay(1800)
 assert.match(await page.evaluate(`document.querySelector('.conversation-stage-3d__place').textContent`),/On the street/)
 assert.equal(await page.evaluate(`document.documentElement.scrollWidth`),390)
 if(process.env.QA_SCREENSHOT){const shot=await page.call('Page.captureScreenshot',{format:'png'});await writeFile(process.env.QA_SCREENSHOT.replace('.png','-mobile.png'),Buffer.from(shot.data,'base64'))}
 assert.deepEqual(page.errors,[]);assert.deepEqual(page.consoleErrors,[])
 console.log('Street conversation browser passed: road, arrival/home/office, translation, scenery, English and mobile. No account writes.')
}finally{await page.close()}
