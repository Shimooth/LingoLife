import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {openQaPage,waitFor,delay} from './browser-cdp.mjs'
// This separate QA browser keeps scene clocks visible during account-flow QA.
process.env.QA_CDP_URL??='http://127.0.0.1:19227'
const page=await openQaPage(),base=process.env.QA_WEB_URL??'http://127.0.0.1:5173',reports=[]
try{
 await page.call('Emulation.setDeviceMetricsOverride',{width:1200,height:850,deviceScaleFactor:1,mobile:false})
 await page.call('Page.navigate',{url:`${base}/scripts/fixtures/neighborhood-stage.html`})
 await page.call('Page.bringToFront')
 await waitFor(page,'window.neighborhoodStageControls && window.neighborhoodStageQa.ready',30000)
 for(const mode of ['fountain','wish','news','shop','gift','meet','friendship','spark']){
  const family=['news','shop','meet','spark'].includes(mode)?'city':'chibi'
  await page.evaluate(`window.neighborhoodStageControls.run(${JSON.stringify({mode,family,reduced:false})})`)
  await waitFor(page,'window.neighborhoodStageQa.ready === 1 && window.neighborhoodStageQa.time > 2.5',20000)
  const value=await page.evaluate('window.neighborhoodStageQa')
  assert.ok(value.boneCount>10&&value.finite,`${mode}: actual finite rig`)
  assert.equal(value.ready,1,`${mode}: ready once`)
  const screenshot=await page.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})
  const artifact=`/tmp/lingolife-neighborhood-stage-${mode}.png`
  await writeFile(artifact,Buffer.from(screenshot.data,'base64'))
  const bounds=await page.evaluate('window.neighborhoodStageControls.bounds()')
  assert.ok(bounds.base,JSON.stringify(bounds))
  assert.ok(bounds.base.max[1] <= .01, `${mode}: thin base must not fold above the floor`)
  const footY=bounds['neighborhood-resident:resident-a'].min[1]
  assert.ok(Math.abs(footY-(mode==='shop'?.16:0))<.04, `${mode}: rendered mesh feet meet the floor`)
  if(mode==='shop')assert.ok(Math.abs(bounds.platform.max[1]-.16)<.001,'preview platform has a flat 0.16m top')
  reports.push({mode,family,time:value.time,boneCount:value.boneCount,bounds,artifact})
  console.log(JSON.stringify(reports.at(-1)))
 }
 // A later dialogue beat must still animate after the entrance has finished.
 await waitFor(page,'window.neighborhoodStageQa.time > 9',20000)
 await page.evaluate("window.neighborhoodStageControls.setCue('wave')")
 await delay(250)
 const before=await page.evaluate('window.neighborhoodStageQa')
 await delay(400)
 const after=await page.evaluate('window.neighborhoodStageQa')
 assert.ok(after.time>before.time&&after.pose.some((value,index)=>Math.abs(value-before.pose[index])>.0001),'a new cue after 9 seconds still moves actual bones')
 assert.equal(after.complete,1,'visual completion fires once, independent of later dialogue')
 for(const family of ['city','chibi']){
  await page.evaluate(`window.neighborhoodStageControls.run(${JSON.stringify({mode:'meet',family,reduced:true})})`)
  await waitFor(page,'window.neighborhoodStageQa.ready === 1 && window.neighborhoodStageQa.boneCount > 10',20000)
  await delay(250)
  const start=await page.evaluate('window.neighborhoodStageQa')
  await delay(450)
  const end=await page.evaluate('window.neighborhoodStageQa')
  assert.deepEqual(end.pose,start.pose,`${family}: reduced-motion bones stay static`)
  assert.equal(end.time,0)
  assert.equal(end.complete,1)
 }
 assert.deepEqual(page.errors,[])
 assert.deepEqual(page.consoleErrors,[])
 await writeFile('/tmp/lingolife-neighborhood-stage-report.json',JSON.stringify(reports,null,2))
 console.log('Neighborhood stage passed: 8 modes, real rigs, 9-second late cue, both reduced-motion rigs, no browser errors. Review screenshots for composition.')
}finally{await page.close()}
