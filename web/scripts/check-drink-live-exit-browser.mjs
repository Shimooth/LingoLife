import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {openQaPage,waitFor,delay} from './browser-cdp.mjs'

const base=process.env.QA_BASE_URL??'http://127.0.0.1:5173'
const distance=(a,b)=>Math.hypot(...a.map((value,i)=>value-b[i]))
const cases=['city','chibi'].flatMap(family=>[.6,2.2,5.1,10].map(time=>({family,time,venue:'cafe'})))
cases.push({family:'chibi',time:6.5,venue:'home'})
for(const test of cases){
 const page=await openQaPage(),id=`${test.family}-${test.venue}-${test.time}`
 try{
  await page.call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false})
  await page.call('Page.navigate',{url:`${base}/scripts/fixtures/embodied-life.html?venue=${test.venue}&family=${test.family}&phase=active&time=${test.time}&clean=1`})
  await waitFor(page,'document.querySelector("canvas")&&window.drinkQaControls',30000)
  await page.evaluate(`import('/node_modules/.vite/deps/@react-three_fiber.js').then(m=>window.exitQaRoots=m._roots)`)
  await waitFor(page,`[...window.exitQaRoots.values()].some(r=>r.store.getState().scene.getObjectByName('drink-resident:noah')?.getObjectByName('${test.family==='city'?'HandR':'DEF-handR'}'))`,30000)
  await delay(400)
  await page.evaluate(`(()=>{
   window.exitQaFrames=[];window.exitQaDone=false
   const start=performance.now()
   const record=()=>{
    const scene=[...window.exitQaRoots.values()][0].store.getState().scene;scene.updateMatrixWorld(true)
    const actors=['mira','noah'].map(id=>scene.getObjectByName('drink-resident:'+id))
    const cups=[];scene.traverse(o=>{if(o.name==='shared-drink-physical-cup')cups.push({p:o.getWorldPosition(o.position.clone()).toArray(),beat:o.userData.beat})})
    return {wall:performance.now()-start,actors:actors.map(o=>({uuid:o.uuid,...o.userData.drink,p:o.getWorldPosition(o.position.clone()).toArray()})),cups}
   }
   window.exitQaFrames.push(record())
   const frame=()=>{
    const result=record();window.exitQaFrames.push(result)
    if(result.actors.every(a=>a.beat==='finished')&&result.wall>800){window.exitQaDone=true;return}
    requestAnimationFrame(frame)
   }
   window.drinkQaControls.setTime(undefined);window.drinkQaControls.setPhase('interrupted');requestAnimationFrame(frame)
  })()`)
  await waitFor(page,'window.exitQaDone',16000)
  const frames=await page.evaluate('window.exitQaFrames'),first=frames[0]
  let maxRoot=0,maxCup=0
  for(let i=1;i<frames.length;i++)for(let actor=0;actor<2;actor++){
   const before=frames[i-1],after=frames[i]
   assert.equal(after.actors[actor].uuid,first.actors[actor].uuid,'phase updates must preserve the rendered skeleton')
   maxRoot=Math.max(maxRoot,distance(before.actors[actor].p,after.actors[actor].p))
   maxCup=Math.max(maxCup,distance(before.cups[actor].p,after.cups[actor].p))
   assert.ok([...after.actors[actor].p,...after.cups[actor].p].every(Number.isFinite))
   if(test.time<2||test.time>=10)assert.equal(after.cups[actor].beat==='sip',false,'an interrupted walk or finished drink cannot invent another sip')
  }
  await writeFile(`/tmp/lingolife-drink-exit-${id}.json`,JSON.stringify(frames))
  console.log(JSON.stringify({case:id,frames:frames.length,maxRoot,maxCup,first:first.actors.map(a=>a.beat),last:frames.at(-1).actors.map(a=>a.beat)}))
  assert.ok(maxRoot<.14,`${id}: live phase update teleports root ${maxRoot}`)
  assert.ok(maxCup<.12,`${id}: live phase update teleports mug ${maxCup}`)
  assert.deepEqual(page.errors,[]);assert.deepEqual(page.consoleErrors,[])
 }finally{await page.close()}
}
console.log('Live exit browser passed: walking, sitting, lifting, resting and home sip interruptions preserve actors and cup continuity; no backend calls.')
