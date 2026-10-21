import assert from 'node:assert/strict'
import {openQaPage, waitFor, delay} from './browser-cdp.mjs'

const page=await openQaPage()
const base=process.env.QA_WEB_URL??'http://127.0.0.1:5173'
try{
 await page.call('Page.navigate',{url:`${base}/scripts/fixtures/life-rig-lifecycle.html`})
 await page.call('Page.bringToFront')
 await waitFor(page,'window.lifeRigControls && window.lifeRigScene')
 await page.evaluate(`window.lifeRigBones=()=>{const bones=[];window.lifeRigScene.traverse(object=>{if(object.isBone)bones.push({id:object.uuid,pose:[...object.position.toArray(),...object.quaternion.toArray()]})});return bones}`)
 await waitFor(page,'window.lifeRigLifecycle.setups >= 2 && window.lifeRigLifecycle.cleanups >= 1')
 const counters=await page.evaluate('window.lifeRigLifecycle')
 assert.ok(counters.setups>=2&&counters.cleanups>=1,'The fixture must actually replay effects under StrictMode')
 for(const family of ['chibi','city']){
  await page.evaluate(`window.lifeRigControls.setFamily(${JSON.stringify(family)})`)
  await waitFor(page,'window.lifeRigBones().length > 10')
  await waitFor(page,`window.lifeRigScene.getObjectByName(${JSON.stringify(family==='city'?'Head':'DEF-spine006')})?.isBone`)
  for(const motion of ['Use_Item','Waving','Holding_A','Use_Item']){
   await page.evaluate(`window.lifeRigControls.setMotion(${JSON.stringify(motion)})`)
   await delay(200)
   const before=await page.evaluate('window.lifeRigBones()')
   await delay(250)
   const after=await page.evaluate('window.lifeRigBones()')
   assert.ok(before.length>10&&after.length===before.length,`${family}/${motion}: keep the real skeleton, never a procedural fallback`)
   assert.equal(before[0].id,after[0].id,`${family}/${motion}: frame playback must not replace the rig`)
   assert.ok(after.every(bone=>bone.pose.every(Number.isFinite)),`${family}/${motion}: finite bone transforms`)
   if(motion==='Use_Item')assert.ok(before.some((bone,index)=>bone.pose.some((value,axis)=>Math.abs(value-after[index].pose[axis])>.00001)),`${family}/${motion}: animation must advance`)
  }
  const previous=await page.evaluate('window.lifeRigBones()[0].id')
  await page.evaluate('window.lifeRigControls.setVisible(false)')
  await waitFor(page,'window.lifeRigBones().length === 0')
  await page.evaluate('window.lifeRigControls.setVisible(true)')
  await waitFor(page,'window.lifeRigBones().length > 10')
  await delay(250)
  assert.notEqual(await page.evaluate('window.lifeRigBones()[0].id'),previous,`${family}: remount owns a fresh skeleton`)
 }
 assert.deepEqual(page.errors,[])
 assert.deepEqual(page.consoleErrors,[],'Caught render/effect exceptions must also fail the test')
 console.log('Life rig lifecycle passed: actual StrictMode replay, both shipped rigs, repeated clip changes and remounts, advancing real bones, no runtime or caught errors.')
}finally{await page.close()}
