import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {openQaPage,waitFor,delay} from './browser-cdp.mjs'

const base=process.env.QA_BASE_URL??'http://127.0.0.1:5173'
const families=(process.env.QA_SOCIAL_FAMILIES??'city,chibi').split(',')
const horizontalRange=points=>Math.hypot(...[0,2].map(axis=>Math.max(...points.map(point=>point[axis]))-Math.min(...points.map(point=>point[axis]))))
const distance=(a,b)=>Math.hypot(...a.map((value,index)=>value-b[index]))
for(const family of families){
 const page=await openQaPage(),feet=family==='city'?['FootL','FootR']:['DEF-footL','DEF-footR']
 try{
  await page.call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false})
  await page.call('Page.navigate',{url:`${base}/scripts/fixtures/social-motion.html?case=arrival&family=${family}&clean=1`})
  await page.call('Page.bringToFront')
  await waitFor(page,'document.querySelector("canvas")&&window.socialQaControls',30000)
  await page.evaluate(`import('/node_modules/.vite/deps/@react-three_fiber.js').then(module=>window.arrivalRoots=module._roots)`)
  await waitFor(page,`[...window.arrivalRoots.values()].some(root=>root.store.getState().scene.getObjectByName('drink-resident:mira')?.getObjectByName('${feet[0]}'))`,30000)
  await delay(600)
  await page.evaluate(`(async()=>{
   window.socialQaControls.replay()
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
   window.arrivalFrames=[];window.arrivalDone=false
   const footNames=${JSON.stringify(feet)},surfaces=new WeakMap()
   const visible=object=>{for(let node=object;node;node=node.parent)if(!node.visible)return false;return true}
   const sole=(actor,foot)=>{
    let byFoot=surfaces.get(actor);if(!byFoot){byFoot=new Map();surfaces.set(actor,byFoot)}
    let skin=byFoot.get(foot)
    if(!skin){
     skin=[];actor.traverse(mesh=>{
      if(!mesh.isSkinnedMesh||!visible(mesh))return
      const members=new Set();mesh.skeleton.bones.forEach((bone,index)=>{for(let node=bone;node;node=node.parent)if(node===foot){members.add(index);break}})
      const indices=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight,vertices=[]
      for(let vertex=0;vertex<indices.count;vertex++){
       let influence=0;for(let component=0;component<4;component++)if(members.has(indices.getComponent(vertex,component)))influence+=weights.getComponent(vertex,component)
       if(influence>=.5)vertices.push(vertex)
      }
      if(vertices.length)skin.push({mesh,vertices})
     });byFoot.set(foot,skin)
    }
    let minimum=Infinity
    for(const {mesh,vertices}of skin){mesh.skeleton.update();for(const vertex of vertices)minimum=Math.min(minimum,mesh.getVertexPosition(vertex,foot.position.clone()).applyMatrix4(mesh.matrixWorld).y)}
    return minimum
   }
   let start,closing=false
   const sample=()=>{
    const state=[...window.arrivalRoots.values()][0]?.store.getState(),people=['mira','noah'].map(id=>state?.scene.getObjectByName('drink-resident:'+id))
    if(people.every(actor=>actor?.getObjectByName(footNames[0]))){
     start??=performance.now();state.scene.updateMatrixWorld(true)
     const actors=people.map(actor=>({uuid:actor.uuid,elapsed:actor.userData.drink?.elapsed,beat:actor.userData.drink?.beat,root:actor.getWorldPosition(actor.position.clone()).toArray(),rotation:actor.rotation.y,feet:footNames.map(name=>{const foot=actor.getObjectByName(name);return {position:foot.getWorldPosition(foot.position.clone()).toArray(),soleY:sole(actor,foot)}})}))
     const wall=(performance.now()-start)/1000
     window.arrivalFrames.push({wall,closing,actors})
     if(!closing&&actors[0].elapsed>=12){closing=true;window.socialQaControls.setPhase('completed')}
     if(closing&&actors.every(actor=>actor.beat==='finished')){window.arrivalDone=true;return}
    }
    requestAnimationFrame(sample)
   };requestAnimationFrame(sample)
  })()`)
  for(const [label,elapsed]of [['first-step',1.34],['second-step',1.54],['seated',4.2]]){
   await waitFor(page,`window.arrivalFrames.at(-1)?.actors[0].elapsed>${elapsed}`,20000)
   const shot=await page.call('Page.captureScreenshot',{format:'png'})
   await writeFile(`/tmp/lingolife-arrival-${family}-${label}.png`,Buffer.from(shot.data,'base64'))
  }
  await waitFor(page,'window.arrivalDone',35000)
  const frames=await page.evaluate('window.arrivalFrames')
  await writeFile(`/tmp/lingolife-arrival-${family}.json`,JSON.stringify({family,frames}))
  const report=[]
  for(let person=0;person<2;person++)for(const beat of ['align','depart_turn']){
   const selected=frames.filter(frame=>frame.actors[person].beat===beat)
   assert.ok(selected.length>=6,`${family}/${person}/${beat}: capture a real continuous turn`)
   // Beat is only a time-window label. All pass/fail contact values below are
   // actual bones/visible skin, not the solver's planted/target/result flags.
   const from=selected[0].actors[person].elapsed,to=selected.at(-1).actors[person].elapsed
   // Find the actual support exchange from shoe trajectories. A deferred
   // React/mixer commit can shift it a frame away from the nominal midpoint.
   // Each side must still support a substantial interval, and alternate feet.
   const splits=[]
   for(let split=Math.ceil(selected.length*.3);split<=Math.floor(selected.length*.7);split++){
    const halves=[selected.slice(0,split),selected.slice(split)]
    for(const firstFoot of [0,1]){
     const drift=halves.map((half,index)=>horizontalRange(half.map(frame=>frame.actors[person].feet[index?1-firstFoot:firstFoot].position)))
     splits.push({split,firstFoot,drift,score:Math.max(...drift)})
    }
   }
   const exchange=splits.sort((a,b)=>a.score-b.score)[0],supportDrift=exchange.drift
   const lift=[0,1].map(foot=>Math.max(...selected.map(frame=>frame.actors[person].feet[foot].soleY)))
   const minimumSole=Math.min(...selected.flatMap(frame=>frame.actors[person].feet.map(foot=>foot.soleY)))
   const allLocal=frames.filter(frame=>frame.actors[person].elapsed>=from-.12&&frame.actors[person].elapsed<=to+.12&&frame.closing===selected[0].closing)
   let maxFootStep=0
   for(let index=1;index<allLocal.length;index++)for(let foot=0;foot<2;foot++)maxFootStep=Math.max(maxFootStep,distance(allLocal[index-1].actors[person].feet[foot].position,allLocal[index].actors[person].feet[foot].position))
   const entry={person,beat,samples:selected.length,supportDrift,exchangeFrame:exchange.split,firstSupportFoot:exchange.firstFoot,lift,minimumSole,maxFootStep};report.push(entry);console.log(JSON.stringify({family,...entry}))
   assert.ok(supportDrift.every(value=>value<.012),`${family}/${person}/${beat}: one planted foot per half-turn must not slide, ${supportDrift}`)
   assert.ok(lift.every(value=>value>.018&&value<.09),`${family}/${person}/${beat}: both visible shoes need a small real lifting step, ${lift}`)
   assert.ok(minimumSole>-.01,`${family}/${person}/${beat}: actual visible shoe skin may not penetrate the ground`)
   assert.ok(maxFootStep<.08,`${family}/${person}/${beat}: turn entry/exit may not teleport the feet`)
  }
  assert.deepEqual(page.errors,[]);assert.deepEqual(page.consoleErrors,[])
  await writeFile(`/tmp/lingolife-arrival-${family}.json`,JSON.stringify({family,report,frames}))
 }finally{await page.close()}
}
console.log('Arrival browser passed: both actual shoes lift and land, alternate planted-foot world contact, finite visible skin/floor clearance and continuous turn entry/exit. No solver contact flags are used as proof.')
