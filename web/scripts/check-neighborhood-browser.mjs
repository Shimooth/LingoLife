// Authenticated local acceptance; consumes only an explicitly named fresh test save.
// The save must have one level-2 resident, an unbuilt fountain proposal, and >=75 coins.
// Point QA_BASE_URL at a disposable local server when preparing this fixture.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {openQaPage,waitFor,delay} from './browser-cdp.mjs'
if(!process.env.QA_SESSION_FILE)throw new Error('Set QA_SESSION_FILE to an onboarding-test session JSON.')
const auth=JSON.parse(await fs.readFile(process.env.QA_SESSION_FILE,'utf8'))
assert.match(auth.username,/^onboarding-test(?:-|$)/)
const baseUrl=new URL(process.env.QA_BASE_URL??'http://127.0.0.1:5173')
assert.equal(baseUrl.protocol,'http:','QA must use a local HTTP server')
assert.ok(['127.0.0.1','localhost','[::1]'].includes(baseUrl.hostname),'QA must not mutate a remote account')
const out=process.env.QA_OUTPUT_DIR??'/private/tmp/lingolife-neighborhood-qa'
await fs.mkdir(out,{recursive:true})
const page=await openQaPage()
const get=path=>page.evaluate(`fetch('/api/v1/${path}',{headers:{Authorization:'Bearer '+localStorage.getItem('lingolife.session-token')}}).then(r=>{if(!r.ok)throw Error(r.status);return r.json()})`)
const state=()=>get('neighborhood')
const click=async selector=>{await waitFor(page,`document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled`,30000);await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)}
const textButton=async(text,scope='.neighborhood-panel')=>{
 const find=`[...document.querySelectorAll(${JSON.stringify(scope+' button')})].find(b=>b.textContent.trim()===${JSON.stringify(text)})`
 await waitFor(page,`${find}&&!(${find}).disabled`,30000);await page.evaluate(`(${find}).click()`)
}
const field=async(selector,value)=>{await waitFor(page,`document.querySelector(${JSON.stringify(selector)})`);await page.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`);await delay(150)}
const settled=()=>waitFor(page,`!document.querySelector('.neighborhood-footer .is-saving')`,30000)
const shot=async name=>{await delay(300);const {data}=await page.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(`${out}/${name}.png`,Buffer.from(data,'base64'));assert.ok(await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Horizontal overflow')}
const tab=async name=>{
 const find=`[...document.querySelectorAll('.neighborhood-nav button')].find(button=>button.textContent.includes(${JSON.stringify(name)}))`
 await waitFor(page,find);await page.evaluate(`(${find}).click()`);await delay(150)
}
const fundProject=async(id,newsId)=>{
 const before=await state(),project=before.projects.find(item=>item.id===id)
 assert.equal(project.status,'proposed');assert.ok(before.coins>=project.cost)
 await click(`[data-project-id="${id}"] .neighborhood-primary`)
 await waitFor(page,`document.querySelector('[data-facility-news="${newsId}"]')`,30000)
 const after=await state();assert.equal(after.projects.find(item=>item.id===id).status,'completed');assert.equal(after.coins,before.coins-project.cost)
 assert.ok(after.news.some(item=>item.id===newsId));assert.ok(after.economy.ledger.some(item=>item.delta===-project.cost))
 await click('.neighborhood-opening-actions button:last-child');await waitFor(page,`document.querySelector('.neighborhood-panel')`);await settled()
 assert.ok((await state()).news.find(item=>item.id===newsId).read)
}
const converse=async(a,b,topic)=>{
 await field('.neighborhood-pair-slot:nth-child(1) select',a);await field('.neighborhood-pair-slot:nth-child(2) select',b)
 await click('.neighborhood-meet>.neighborhood-primary');await settled();await waitFor(page,`document.querySelector('input[name="neighborhood-topic"]')`)
 await field('input[name="neighborhood-topic"]',topic);await click('.neighborhood-choice-row .neighborhood-primary');await settled()
}
const createResident=async(name,number)=>{
 await click('.neighborhood-add-resident');await waitFor(page,`document.querySelector('.studio')`)
 await field('.studio-fields input:not([type="number"]):not([type="checkbox"])',name)
 await textButton('保存角色','.studio');await waitFor(page,`document.querySelectorAll('.neighborhood-resident-strip>button[draggable]').length===${number}`,45000)
 await settled()
}
try{
 await page.call('Page.enable');await page.call('Page.bringToFront')
 await page.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})
 await page.call('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('lingolife.session-token',${JSON.stringify(auth.session_token)});localStorage.setItem('lingolife.language','zh');`})
 await page.call('Page.navigate',{url:baseUrl.href})
 await waitFor(page,`document.querySelector('.neighborhood-open-button')`,45000)
 assert.equal((await get('auth/me')).user.username,auth.username)
 const initial=await state();assert.equal(initial.residents.length,1);assert.equal(initial.wishes.available,1)
 // Reject an active or previously consumed save before any test command is sent.
 assert.equal(initial.unlocks.fountain,false,'Use a fresh disposable save: the fountain must not be built')
 assert.equal(initial.unlocks.clothing_store,false);assert.equal(initial.projects.find(item=>item.id==='fountain').status,'proposed')
 assert.equal(initial.economy.support.claimed,false);assert.equal(initial.economy.care_reward.claimed,false)
 assert.equal(initial.economy.social_reward.remaining_pairs,3);assert.equal(initial.meetings.length,0)
 assert.ok(initial.coins>=75,'Fixture needs at least 75 coins; this script never mints test funds')
 assert.ok(initial.residents[0].care.satiety<85,'Fixture resident must be able to accept a meal')
 assert.ok(!initial.news.some(item=>item.id==='fountain-open'),'A care level proposes the fountain; it does not open it')
 await click('.neighborhood-open-button');await waitFor(page,`document.querySelector('.neighborhood-panel')`)
 if(await page.evaluate(`Boolean(document.querySelector('.neighborhood-news-screen'))`)){await textButton('知道啦');await settled()}
 await tab('生活钱包');await click('[data-economy-action="claim-support"]');await settled()
 const supported=await state();assert.equal(supported.coins,initial.coins+initial.economy.support.amount);assert.equal(supported.economy.support.claimed,true)
 assert.equal(await page.evaluate(`document.querySelector('[data-economy-action="claim-support"]').disabled`),true)
 await tab('许愿喷泉');await shot('01-fountain-proposal-desktop');await fundProject('fountain','fountain-open')
 assert.equal((await state()).unlocks.fountain,true)
 await click('.neighborhood-item-grid article:first-child .neighborhood-primary');await settled()
 assert.equal((await state()).gifts.sketchbook,1);assert.equal((await state()).wishes.available,0)
 await delay(1200);await shot('02-wish-desktop')
 const wish=await state();await textButton('重播','.neighborhood-scene-controls');await settled();assert.equal((await state()).revision,wish.revision)
 await tab('居民之间');await click('.neighborhood-gifts button');await settled();assert.equal((await state()).gifts.sketchbook,0)
 await delay(1200);await shot('03-gift-desktop')
 // Lose both automatic purchase responses after the server has committed.
 const before=await state()
 await page.evaluate(`(()=>{const native=window.fetch.bind(window);let drops=2;window.fetch=async(...args)=>{const r=await native(...args);const body=JSON.parse(args[1]?.body||'{}');if(drops&&String(args[0]).endsWith('/neighborhood/command')&&body.action==='buy_food'&&body.item_id==='toast'){drops--;throw new TypeError('QA response lost')}return r}})()`)
 await click('.neighborhood-food-grid article:first-child button:first-child');await settled();await waitFor(page,`document.querySelector('.neighborhood-error')`)
 await click('.neighborhood-food-grid article:nth-child(3) button:first-child');await settled()
 await click('.neighborhood-food-grid article:first-child button:first-child');await settled()
 const after=await state();assert.equal(after.coins,before.coins-before.food_catalog[0].price-before.food_catalog[2].price);assert.equal(after.food_inventory.toast,(before.food_inventory.toast??0)+1)
 await click('.neighborhood-food-grid article:first-child button:last-child');await settled()
 const fed=await state();assert.equal(fed.residents[0].care.xp,after.residents[0].care.xp+20);assert.equal(fed.wishes.available,1);assert.equal(fed.scenes.at(-1).result.food_id,'toast');assert.equal(fed.coins,after.coins+after.economy.care_reward.amount);assert.equal(fed.economy.care_reward.claimed,true)
 await waitFor(page,`document.querySelector('.arrival-eating-progress')||document.querySelector('[data-scene-id]')`);await delay(10000);await shot('03b-meal-desktop')
 await tab('许愿喷泉');await click('.neighborhood-item-grid article:nth-child(3) .neighborhood-primary');await settled();await tab('居民之间')
 const warmthBefore=(await state()).residents[0].profile.personalityAxes.warmth
 await click('.neighborhood-gifts button');await settled();assert.equal((await state()).residents[0].profile.personalityAxes.warmth,Math.min(100,warmthBefore+8))
 await createResident('小满',2)
 await shot('04-two-residents-desktop')
 let current=await state();const ids=current.residents.map(r=>r.id)
 await field('.neighborhood-pair-slot:nth-child(1) select',ids[0]);await field('.neighborhood-pair-slot:nth-child(2) select',ids[1])
 await click('.neighborhood-meet>.neighborhood-primary');await settled();await waitFor(page,`document.querySelector('input[name="neighborhood-topic"]')`)
 await field('input[name="neighborhood-topic"]','在喷泉旁一起画画')
 await click('.neighborhood-choice-row .neighborhood-primary');await settled()
 current=await state();assert.equal(current.meetings.at(-1).status,'resolved');assert.equal(current.meetings.at(-1).topic.text,'在喷泉旁一起画画')
 assert.equal(current.coins,fed.coins+fed.economy.social_reward.amount)
 await delay(2200);await shot('05-friendship-desktop')
 await click('.neighborhood-nicknames summary');await field('.neighborhood-nicknames input:nth-of-type(1)','满满')
 // Each input is nested in its own label.
 await field('.neighborhood-nicknames label:nth-of-type(2) input','晴晴')
 await textButton('记住这两个称呼');await settled()
 assert.equal((await state()).meetings.at(-1).aliases.a_to_b,'满满')
 if(await page.evaluate(`Boolean(document.querySelector('.neighborhood-romance .neighborhood-choice-row button:last-child'))`)){
  await click('.neighborhood-romance .neighborhood-choice-row button:last-child');await settled();current=await state();assert.ok(current.meetings.at(-1).romance_advised);assert.equal(current.scenes.at(-1).kind,'romance');await delay(1600);await shot('06-romance-desktop')
 }
 await createResident('小禾',3)
 current=await state();assert.equal(current.unlocks.clothing_store,false);assert.equal(current.projects.find(item=>item.id==='clothing_store').status,'proposed')
 assert.ok(!current.news.some(item=>item.id==='clothing-open'),'Three residents plus a conversation propose the shop; funding opens it')
 // New pairs provide the remaining daily social rewards, covering the outfit naturally.
 const thirdId=current.residents[2].id,beforeMoreTalk=current.coins
 await converse(ids[0],thirdId,'傍晚在广场散步');await converse(ids[1],thirdId,'周末分享喜欢的书')
 current=await state();assert.equal(current.coins,beforeMoreTalk+40);assert.equal(current.economy.social_reward.remaining_pairs,0)
 await tab('服装小店');await shot('06b-clothing-proposal-desktop');await fundProject('clothing_store','clothing-open')
 assert.equal((await state()).unlocks.clothing_store,true)
 await click('.neighborhood-clothing-grid article:nth-child(2) .neighborhood-preview');await delay(1500);await shot('07-outfit-preview-desktop')
 await click('.neighborhood-clothing-grid article:nth-child(2) .neighborhood-clothing-actions button:first-child');await settled()
 await click('.neighborhood-clothing-grid article:nth-child(2) .neighborhood-clothing-actions button:last-child');await settled()
 current=await state();const dressed=current.residents[0];assert.equal(dressed.profile.avatar.model,'chibi');assert.equal(dressed.profile.avatar.outfit,'traveller')
 await page.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await shot('08-shop-mobile')
 await tab('居民之间');await shot('09-neighbors-mobile')
 await page.call('Page.reload');await waitFor(page,`document.querySelector('.neighborhood-open-button')`,45000)
 current=await state();assert.equal(current.wardrobe.traveller_blue,1);assert.equal(current.residents[0].profile.avatar.outfit,'traveller');assert.equal(current.residents.length,3)
 await page.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})
 await waitFor(page,`document.querySelector('.world3d-resident-dock')&&!document.querySelector('.world3d-intro')&&document.querySelectorAll('[data-neighborhood-facility]').length===2`,45000)
 const facilities=await page.evaluate(`(async()=>{const {_roots}=await import('/node_modules/.vite/deps/@react-three_fiber.js');const scene=[..._roots.values()].map(r=>r.store.getState().scene).find(s=>s.getObjectByName('neighborhood-facilities'));return ['fountain','wardrobe'].map(id=>Boolean(scene?.getObjectByName('neighborhood-'+id+'-landmark')))})()`)
 assert.deepEqual(facilities,[true,true]);await shot('10-city-facilities-desktop')
 await click('[data-neighborhood-facility="fountain"]');await waitFor(page,`document.querySelector('[data-neighborhood-tab="fountain"]')`)
 assert.deepEqual(page.errors,[]);assert.deepEqual(page.consoleErrors,[])
 console.log(JSON.stringify({result:'passed',screenshots:out,checks:['daily support and ledger','care level proposes rather than opens fountain','explicit fountain contribution and opening news','news read','earned wish','gift inventory','feeding earns another wish','micro personality updates real profile','scene replay no settlement','cross-button network retry','second and third resident from UI','daily care reward','topic friendship reward and three-pair daily limit','nicknames','three residents plus conversation propose clothing shop','explicit clothing contribution then preview purchase persistent appearance','390px layout','real map facilities','no console errors']}))
}catch(error){await shot('failure');console.error(JSON.stringify({text:await page.evaluate('document.body.innerText.slice(0,5500)'),errors:page.errors,consoleErrors:page.consoleErrors}));throw error}
finally{await page.close()}
