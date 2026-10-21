import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {openQaPage,waitFor} from './browser-cdp.mjs'
process.env.QA_CDP_URL??='http://127.0.0.1:19228'
const page=await openQaPage(),base=process.env.QA_WEB_URL??'http://localhost:5173'
const click=label=>page.evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(button=>button.textContent.includes(${JSON.stringify(label)}));if(!button)throw new Error('Missing button');button.click()})()`)
try{
 await page.call('Page.navigate',{url:`${base}/scripts/fixtures/resident-voice.html`})
 await waitFor(page,"window.__residentVoiceQa?.voiceNames().includes('Samantha')",30000)
 await waitFor(page,"document.body.textContent.includes('自动：Samantha')")
 const common=await page.evaluate("[...document.querySelectorAll('.resident-voice-picker__suggestions strong')].map(node=>node.textContent)")
 for(const name of ['Samantha','Google US English','Google UK English Female','Google UK English Male'])assert.ok(common.includes(name),`${name} is directly available to audition`)
 await click('Google UK English Male')
 await waitFor(page,"window.__residentVoiceQa.history.at(-1)?.voice==='Google UK English Male'")
 assert.equal(await page.evaluate('window.__residentVoiceQa.values.a.voice_uri'),'Google UK English Male')
 await click('Resident B')
 await waitFor(page,"document.body.textContent.includes('自动：Samantha')")
 await click('Daniel')
 await waitFor(page,"window.__residentVoiceQa.history.at(-1)?.voice==='Daniel'")
 assert.equal(await page.evaluate('window.__residentVoiceQa.values.b.voice_uri'),'Daniel')
 await click('Resident A')
 await waitFor(page,"document.body.textContent.includes('当前播放：Google UK English Male')")
 await click('试听当前声音')
 await waitFor(page,"window.__residentVoiceQa.history.at(-1)?.voice==='Google UK English Male'")
 await page.evaluate("window.__residentVoiceQa.setValue({voice_uri:'saved-on-other-device',language:'en-US',rate:1,pitch:1})")
 await waitFor(page,"document.body.textContent.includes('原选择仍会保留')")
 await waitFor(page,"document.querySelector('.resident-voice-picker__listen')?.textContent.includes('试听当前声音')")
 await click('试听当前声音')
 await waitFor(page,"window.__residentVoiceQa.history.at(-1)?.voice==='Samantha'")
 assert.equal(await page.evaluate('window.__residentVoiceQa.values.a.voice_uri'),'saved-on-other-device')
 const voices=await page.evaluate("speechSynthesis.getVoices().map(({name,lang,localService})=>({name,lang,localService}))")
 const history=await page.evaluate('window.__residentVoiceQa.history')
 assert.ok(history.every(utterance=>utterance.pitch===1&&utterance.rate===1),'Voice quality change preserves the original pitch and rate')
 assert.deepEqual(page.errors,[]);assert.deepEqual(page.consoleErrors,[])
 const report={voices:voices.length,english:voices.filter(voice=>voice.lang.startsWith('en')).length,common,history,scenarios:['automatic clear voice','all Google English voices in quick choices','separate resident choices','saved URI playback','missing URI fallback without overwriting'],browserErrors:0}
 await writeFile('/tmp/lingolife-resident-voice-report.json',JSON.stringify(report,null,2))
 const screenshot=await page.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})
 await writeFile('/tmp/lingolife-resident-voice-picker.png',Buffer.from(screenshot.data,'base64'))
 console.log(JSON.stringify(report))
}finally{await page.close()}
