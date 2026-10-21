import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {openQaPage,delay,waitFor} from '../../../scripts/browser-cdp.mjs'

const base=process.env.QA_WEB_URL??'http://127.0.0.1:5173'
assert.match(base,/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/)
const output=process.env.QA_OUTPUT_DIR??'/private/tmp/lingolife-original-character-qa'
await mkdir(output,{recursive:true})
const page=await openQaPage(),report={parameters:[],poses:[],errors:[],consoleErrors:[]}
try{
 await page.call('Emulation.setDeviceMetricsOverride',{width:1280,height:960,deviceScaleFactor:1,mobile:false})
 await page.call('Page.navigate',{url:`${base}/src/original/character/preview.html`});await delay(1600);await waitFor(page,'window.inspectOriginalResident&&window.originalCharacterQA')
 const controls=await page.evaluate(`(async()=>(await import('/src/original/spec.ts')).ORIGINAL_CONTROLS.map(item=>item.id))()`)
 const inspect=()=>page.evaluate('window.inspectOriginalResident()')
 const initial=await inspect()
 for(const key of controls){
  await page.evaluate(`window.originalCharacterQA.appearance({${JSON.stringify(key)}:0})`);await delay(60);const low=await inspect()
  await page.evaluate(`window.originalCharacterQA.appearance({${JSON.stringify(key)}:1})`);await delay(60);const high=await inspect()
  assert(low.finite&&high.finite,`${key} must keep finite geometry`);assert.notEqual(low.fingerprint,high.fingerprint,`${key} must alter actual rendered geometry or material`)
  report.parameters.push(key)
  await page.evaluate('window.originalCharacterQA.preset(0)');await delay(30)
 }
 for(const value of [0,1]){
  await page.evaluate(`(async()=>window.originalCharacterQA.appearance(Object.fromEntries((await import('/src/original/spec.ts')).ORIGINAL_CONTROLS.map(item=>[item.id,${value}]))))()`);await delay(120)
  assert((await inspect()).finite)
  const shot=await page.call('Page.captureScreenshot',{format:'png'});await writeFile(`${output}/extreme-${value}.png`,Buffer.from(shot.data,'base64'))
 }
 await page.evaluate('window.originalCharacterQA.preset(0)');await delay(100)
 for(const motion of ['idle','wave','walk','talk','receive','eat','happy']){
  for(const time of [0,.65,1.4,2.1,4.3,5.5]){
   await page.evaluate(`window.originalCharacterQA.pose('${motion}',${time})`);await delay(35);const state=await inspect();assert(state.finite,`${motion} ${time}`)
   assert(state.residents[0].bounds.min[1]>-.035,`${motion} must keep feet at floor`)
   if(time===1.4){const shot=await page.call('Page.captureScreenshot',{format:'png'});await writeFile(`${output}/motion-${motion}.png`,Buffer.from(shot.data,'base64'))}
  }
  report.poses.push(motion)
 }
 await page.evaluate("window.originalCharacterQA.pose('idle',0)");await delay(100)
 for(let i=0;i<16;i++){await page.evaluate(`window.originalCharacterQA.preset(${i%4})`);await delay(45)}
 await page.evaluate('window.originalCharacterQA.preset(0)');await delay(300)
 const final=await inspect();assert(final.memory.geometries<=initial.memory.geometries+3,`geometry must be released: ${initial.memory.geometries} → ${final.memory.geometries}`)
 for(let i=0;i<8;i++){await page.evaluate(`window.originalCharacterQA.preset(${i%4})`);await delay(45)}
 await page.evaluate('window.originalCharacterQA.preset(0)');await delay(250);const stable=await inspect();assert(stable.memory.geometries<=final.memory.geometries,'repeated preset cycles must converge')
 report.memory={before:initial.memory,after:final.memory,stable:stable.memory};
 await page.call('Page.navigate',{url:`${base}/src/original/character/preview.html?low`});await delay(1200);await waitFor(page,'window.inspectOriginalResident');const lowQuality=await inspect();assert(lowQuality.residents[0].vertices<initial.residents[0].vertices,'low quality must use fewer real vertices');report.quality={high:initial.residents[0].vertices,low:lowQuality.residents[0].vertices};
 report.errors=page.errors;report.consoleErrors=page.consoleErrors
 assert.deepEqual(page.errors,[]);assert.deepEqual(page.consoleErrors,[])
 await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}finally{await page.close()}
