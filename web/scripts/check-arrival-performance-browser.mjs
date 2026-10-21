import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {openQaPage,waitFor,delay} from './browser-cdp.mjs'

// Real shipped models, real frame callbacks, and the actual production stage.
// No accounts, world settlement, artificial skeletons, or sampled pose clocks.
process.env.QA_CDP_URL??='http://127.0.0.1:19227'
const welcomeOnly=process.argv.includes('--welcome-only')
const page=await openQaPage(),base=process.env.QA_WEB_URL??'http://127.0.0.1:5173',reports=[]
const snapshot=()=>page.evaluate(`(()=>{
 const qa=window.arrivalPerformanceQa,frames=qa.frames
 const movement=(a,b)=>Math.hypot(...a.map((value,index)=>value-b[index]))
 const handFrames=frames.filter(frame=>frame.hand.length===3)
 const first=handFrames[0]
 return {config:qa.config,phases:qa.phases,ready:qa.ready,finished:qa.finished,bites:qa.bites,frameCount:frames.length,
  allFinite:frames.every(frame=>frame.finite),minBones:Math.min(...frames.map(frame=>frame.boneCount)),
  maxHandMovement:first?Math.max(...handFrames.map(frame=>movement(frame.hand,first.hand))):0,
  maxAttachmentError:Math.max(...frames.filter(frame=>frame.visible&&frame.attachmentError!==null).map(frame=>frame.attachmentError),0),
  maxHandDistance:Math.max(...frames.filter(frame=>frame.visible&&frame.handDistance!==null).map(frame=>frame.handDistance),0),
  scales:[...new Set(frames.map(frame=>frame.scale))],last:frames.at(-1),
  invalidVisible:frames.some(frame=>frame.bite===3&&frame.visible),
  staticDelta:frames.length>20?frames.slice(20).reduce((maximum,frame)=>Math.max(maximum,...frame.bones.map((value,index)=>Math.abs(value-frames[20].bones[index]))),0):0}
})()`)
try{
 await page.call('Emulation.setDeviceMetricsOverride',{width:1200,height:850,deviceScaleFactor:1,mobile:false})
 await page.call('Page.navigate',{url:`${base}/scripts/fixtures/arrival-performance.html`})
 await page.call('Page.bringToFront')
 await waitFor(page,'window.arrivalPerformanceControls && window.arrivalPerformanceQa.ready > 0',30000)
 for(const family of ['city','chibi']){
  await page.evaluate(`window.arrivalPerformanceControls.run(${JSON.stringify({family,food:'toast',reduced:false,mode:'welcome'})})`)
  for(const [name,time] of [['entrance',.55],['greeting',4.75],['settled',7.3]]){
   await waitFor(page,`window.arrivalPerformanceQa.frames.at(-1)?.time >= ${time}`,20000)
   const picture=await page.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})
   await writeFile(`/tmp/lingolife-arrival-welcome-${family}-${name}.png`,Buffer.from(picture.data,'base64'))
  }
  const report=await snapshot(),frames=await page.evaluate('window.arrivalPerformanceQa.frames')
  assert.deepEqual(report.phases,['arriving','greeting','settled'],`${family}: one greeting followed by a settled idle`)
  assert.equal(report.ready,1)
  assert.ok(report.allFinite&&report.minBones>10,`${family}: real finite welcome rig`)
  assert.ok(frames.some(frame=>frame.welcomeBeat==='stopping'),`${family}: pauses and plants feet before greeting`)
  const walking=frames.filter(frame=>frame.welcomeBeat==='arriving'&&frame.time>.4)
  const stride=family==='city'?1.58*(.73/.56):.66*(.95/.76),cycle=family==='city'?1:.7916666865
  assert.ok(walking.every(frame=>Math.abs(frame.walkTime-frame.walkDistance/stride*cycle)<1e-7),`${family}: gait follows travelled metres`)
  const jump=Math.max(...frames.slice(1).map((frame,index)=>Math.hypot(...frame.actor.map((value,axis)=>value-frames[index].actor[axis]))))
  assert.ok(jump<.15,`${family}: root never teleports between walking and standing; ${jump}`)
  assert.ok(Math.abs(report.last.actor[2]-.2)<.001,`${family}: reaches the welcome mark`)
  assert.ok(report.last.hand[1]<1.6,`${family}: hand comes down after the greeting`)
  delete report.last.bones
  reports.push(report)
  console.log(JSON.stringify({case:`${family}/welcome`,phases:report.phases,maxRootStep:jump,artifacts:`/tmp/lingolife-arrival-welcome-${family}-*.png`}))
 }
 for(const family of ['city','chibi'])for(const food of welcomeOnly?[]:['toast','rice','pudding']){
  const context=`${family}/${food}`,config={family,food,reduced:false,mode:'feeding'}
  await page.evaluate(`window.arrivalPerformanceControls.run(${JSON.stringify(config)})`)
  await waitFor(page,'window.arrivalPerformanceQa.bites.length === 1',20000)
  const picture=await page.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})
  const artifact=`/tmp/lingolife-arrival-performance-${family}-${food}.png`
  await writeFile(artifact,Buffer.from(picture.data,'base64'))
  await waitFor(page,'window.arrivalPerformanceQa.finished === 1',20000)
  await delay(350)
  const report=await snapshot()
  assert.equal(report.ready,1,`${context}: one readiness callback for the actual mounted rig`)
  assert.deepEqual(report.bites,[1,2,3],`${context}: exactly three bite callbacks`)
  assert.equal(report.finished,1,`${context}: completion callback runs only once`)
  assert.ok(report.frameCount>=40&&report.minBones>10&&report.allFinite,`${context}: continuous finite real bone transforms`)
  assert.ok(report.maxHandMovement>.15,`${context}: the actual hand must move, not only the food icon`)
  for(const scale of [1,.72,.43,0])assert.ok(report.scales.includes(scale),`${context}: missing food scale ${scale}`)
  assert.ok(report.maxAttachmentError<.001,`${context}: food must follow the visible wrist within 1mm; got ${report.maxAttachmentError}`)
  assert.ok(report.maxHandDistance<.09,`${context}: food must stay by the actual hand, not float in front of the character`)
  assert.equal(report.invalidVisible,false,`${context}: food disappears after the third bite`)
  assert.equal(report.last.scale,0)
  assert.equal(report.last.visible,false)
  delete report.last.bones
  reports.push({...report,artifact})
  console.log(JSON.stringify({case:context,frames:report.frameCount,bites:report.bites,handMovement:report.maxHandMovement,attachmentError:report.maxAttachmentError,artifact}))
 }
 for(const family of ['city','chibi'])for(const mode of ['welcome','feeding']){
  const mobile=family==='chibi'&&mode==='welcome'
  if(mobile)await page.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
  const config={family,food:'toast',reduced:true,mode}
  await page.evaluate(`window.arrivalPerformanceControls.run(${JSON.stringify(config)})`)
  await waitFor(page,'window.arrivalPerformanceQa.ready === 1 && window.arrivalPerformanceQa.frames.length > 35',20000)
  await delay(700)
  const report=await snapshot()
  if(mobile){const picture=await page.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile('/tmp/lingolife-arrival-welcome-chibi-mobile.png',Buffer.from(picture.data,'base64'));await page.call('Emulation.setDeviceMetricsOverride',{width:1200,height:850,deviceScaleFactor:1,mobile:false})}
  assert.ok(report.minBones>10&&report.allFinite,`${family}/${mode}/reduced: finite real skeleton`)
  assert.ok(report.staticDelta<1e-8,`${family}/${mode}/reduced: bones, root and camera remain still; delta=${report.staticDelta}`)
  assert.deepEqual(report.bites,[],`${family}/${mode}/reduced: no automatic eating progression`)
  assert.equal(report.finished,0)
  delete report.last.bones
  reports.push(report)
  console.log(JSON.stringify({case:`${family}/${mode}/reduced`,frames:report.frameCount,staticDelta:report.staticDelta}))
 }
 assert.deepEqual(page.errors,[],'No uncaught browser errors')
 assert.deepEqual(page.consoleErrors,[],'No caught React/Three render errors')
 await writeFile(welcomeOnly?'/tmp/lingolife-arrival-welcome-report.json':'/tmp/lingolife-arrival-performance-report.json',JSON.stringify(reports,null,2))
 console.log(welcomeOnly?'Arrival welcome passed: two paced entrances and four reduced-motion cases. Screenshots saved.':'Arrival production performance passed: two paced welcome entrances, 2 rigs × 3 foods, exactly 3 bites, physical wrist contact, finite bones and four static reduced-motion cases. Screenshots saved for visual review.')
}finally{await page.close()}
