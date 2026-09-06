import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {openQaPage,waitFor,delay} from './browser-cdp.mjs'
const page=await openQaPage()
const click=selector=>page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
try{
 await page.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
 await page.call('Page.navigate',{url:`${process.env.QA_WEB_URL??'http://127.0.0.1:5173'}/scripts/fixtures/practice-dinner.html`})
 await page.call('Page.bringToFront')
 await waitFor(page,`document.querySelector('.city-practice-guide')`)
 assert.equal(await page.evaluate(`document.querySelector('.city-practice-guide').dataset.stage`),'recap')
 assert.match(await page.evaluate(`document.querySelector('.city-practice-guide__primary').textContent`),/回顾/)
 await click('.city-practice-guide__primary')
 await waitFor(page,`document.querySelector('.life-story-encounter__next button')`)
 await delay(800)
 const bounds=await page.evaluate(`(()=>{const r=document.querySelector('.life-story-encounter__next button').getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,viewport:innerHeight}})()`)
 assert.ok(bounds.top>=0&&bounds.bottom<=bounds.viewport&&bounds.height>=44,'Guide action must be visible without scrolling the story')
 assert.match(await page.evaluate(`document.querySelector('.life-story-encounter__next button').textContent`),/记下这一刻/)
 await click('.life-story-encounter__next button')
 await waitFor(page,`document.querySelector('.life-story-encounter__next button').textContent.includes('完成引导')`)
 if(process.env.QA_SCREENSHOT){const shot=await page.call('Page.captureScreenshot',{format:'png'});await writeFile(process.env.QA_SCREENSHOT,Buffer.from(shot.data,'base64'))}
 await click('.life-story-encounter__next button')
 await waitFor(page,`JSON.parse(document.querySelector('#qa-state').textContent).status==='completed'`)
 assert.equal(await page.evaluate(`Boolean(document.querySelector('.city-practice-guide'))`),false)
 await click('[data-mode="dinner"]')
 await waitFor(page,`document.querySelector('.household-dinner')`)
 const options=await page.evaluate(`[...document.querySelector('select').options].map(option=>({index:option.value,text:option.textContent}))`)
 for(const phase of ['preparing','eating','cleanup','completed']){
  const option=options.find(item=>item.text.includes(phase));assert.ok(option,`${phase}: no real simulation frame`)
  await page.evaluate(`(()=>{const select=document.querySelector('select');select.value=${JSON.stringify(option.index)};select.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await waitFor(page,`document.querySelector('.household-dinner').dataset.phase===${JSON.stringify(phase)}`)
 }
 assert.match(await page.evaluate(`document.querySelector('.household-dinner__facts').textContent`),/已吃饭 2 人.*余下 0 份.*餐具 0/)
 assert.match(await page.evaluate(`document.querySelector('.household-dinner__outcome').textContent`),/实际完成了收拾/)
 await click('[data-language]');await delay(100)
 assert.match(await page.evaluate(`document.querySelector('.household-dinner h3').textContent`),/A meal together/)
 assert.equal(await page.evaluate('document.documentElement.scrollWidth'),390)
 await page.call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false})
 await click('.household-dinner header button');await delay(600)
 assert.equal(await page.evaluate(`Boolean(document.querySelector('.household-inspector.is-life-expanded canvas'))`),true)
 assert.deepEqual(page.errors,[]);assert.deepEqual(page.consoleErrors,[])
 console.log('Guide + dinner browser checks passed: mobile sticky recap→result→complete, real simulator meal phases/facts, bilingual UI and kitchen view. No user/API writes.')
}catch(error){console.error(page.errors,page.consoleErrors);throw error}finally{await page.close()}
