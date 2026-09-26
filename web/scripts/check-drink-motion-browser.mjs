import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {openQaPage,waitFor,delay} from './browser-cdp.mjs'

const base=process.env.QA_BASE_URL??'http://127.0.0.1:5173'
const families=(process.env.QA_DRINK_FAMILIES??'city,chibi').split(',')
for(const family of families){
 const page=await openQaPage()
 try{
  await page.call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false})
  await page.call('Page.navigate',{url:`${base}/scripts/fixtures/embodied-life.html?venue=cafe&phase=active&family=${family}&time=2.4`})
  await page.call('Page.bringToFront')
  await waitFor(page,'document.querySelector("canvas")',30000)
  await page.evaluate(`import('/node_modules/.vite/deps/@react-three_fiber.js').then(module=>window.drinkMotionRoots=module._roots)`)
  await waitFor(page,`[...window.drinkMotionRoots.values()].some(root=>root.store.getState().scene.getObjectByName('drink-resident:mira')?.getObjectByName('${family==='city'?'HandR':'DEF-handR'}'))`,30000)
  await delay(350)
  await page.evaluate(`(async()=>{
   const {clone}=await import('/node_modules/.vite/deps/three_examples_jsm_utils_SkeletonUtils__js.js')
   const {AnimationMixer}=await import('/node_modules/.vite/deps/three.js')
   const {retargetLifeMotion}=await import('/src/three/characters/lifeRetarget.ts')
   const {measureDrinkMouth}=await import('/src/three/characters/sharedDrinkContact.ts')
   const library=await fetch('/assets/life/motions/kaykit-life.json').then(response=>response.json())
   window.independentDrinkMouth=actor=>{
    // The copied AssetTransform/performance group keeps the real scale/facing.
    // Only its cloned skeleton is animated; live bones/materials never change.
    const ghost=clone(actor),model=ghost.children[0].children[0].children[0]
    const clip=retargetLifeMotion(library,model,${JSON.stringify(family)},'Sit_Chair_Idle'),mixer=new AnimationMixer(model)
    const action=mixer.clipAction(clip).play();action.time=actor.userData.drink.motionTime%clip.duration;mixer.update(0);ghost.updateMatrixWorld(true)
    const anchor=measureDrinkMouth(ghost,${JSON.stringify(family)})
    const result=anchor?{head:actor.getObjectByName(anchor.head.name),point:anchor.point.clone()}:undefined
    mixer.stopAllAction();mixer.uncacheRoot(model)
    const skeletons=new Set();ghost.traverse(object=>{if(object.isSkinnedMesh)skeletons.add(object.skeleton)});skeletons.forEach(skeleton=>skeleton.dispose())
    return result
   }
  })()`)
  // Start mid-sit and skip settle entirely. Calibration must use the source
  // pose, not the bent-forward reach visible at the moment the model is ready.
  await page.evaluate('window.drinkQaControls.setTime(4.2)')
  await waitFor(page,`['mira','noah'].every(id=>Math.abs(([...window.drinkMotionRoots.values()][0].store.getState().scene.getObjectByName('drink-resident:'+id)?.userData.drink?.elapsed??-1)-4.2)<.002)`)
  await delay(450)
  await page.evaluate(`(()=>{const scene=[...window.drinkMotionRoots.values()][0].store.getState().scene;window.drinkSeekAnchors=Object.fromEntries(['mira','noah'].map(id=>[id,window.independentDrinkMouth(scene.getObjectByName('drink-resident:'+id))]))})()`)
  await page.evaluate('window.drinkQaControls.setTime(6.5)')
  await waitFor(page,`['mira','noah'].every(id=>Math.abs(([...window.drinkMotionRoots.values()][0].store.getState().scene.getObjectByName('drink-resident:'+id)?.userData.drink?.elapsed??-1)-6.5)<.002)`)
  await delay(450)
  const seekRim=await page.evaluate(`(async()=>{
   const scene=[...window.drinkMotionRoots.values()][0].store.getState().scene,cups=[];scene.updateMatrixWorld(true)
   scene.traverse(object=>{if(object.name==='shared-drink-physical-cup')cups.push(object)})
   return ['mira','noah'].map((id,index)=>{
    const actor=scene.getObjectByName('drink-resident:'+id),anchor=window.drinkSeekAnchors?.[id]??window.independentDrinkMouth(actor)
    if(!anchor)return null
    const skin=anchor.head.localToWorld(anchor.point.clone()),cup=cups[index],geometry=cup.children[0].geometry.parameters
    return Math.min(...Array.from({length:64},(_,i)=>cup.localToWorld(actor.position.clone().set(Math.cos(i*Math.PI/32)*geometry.radiusTop,geometry.height/2,Math.sin(i*Math.PI/32)*geometry.radiusTop)).distanceTo(skin)))
   })
  })()`)
  const seekShot=await page.call('Page.captureScreenshot',{format:'png'})
  await writeFile(`/tmp/lingolife-drink-seek-${family}.png`,Buffer.from(seekShot.data,'base64'))
  assert.ok(seekRim.every(error=>error!==null&&error<.02),`${family}: skipped-settle calibration must keep the mug at the mouth, errors=${JSON.stringify(seekRim)}`)
  await page.evaluate(`(async()=>{
   const {drinkHandOffset}=await import('/src/three/characters/sharedDrinkContact.ts')
   window.drinkMotionFrames=[];window.drinkMotionDone=false;window.drinkMotionStarted=false
   let closingRequested=false
   const mouthAnchors=new Map()
   const names=${JSON.stringify(family==='city'?['Hips','Head','ArmR','ForeArmR','HandR','FootL','FootR']:['DEF-spine','DEF-spine006','DEF-upper_armR','DEF-forearmR','DEF-handR','DEF-footL','DEF-footR'])}
   const frame=()=>{
    const state=[...window.drinkMotionRoots.values()][0]?.store.getState()
    if(state){
     state.scene.updateMatrixWorld(true)
     const people=['mira','noah'].map(id=>state.scene.getObjectByName('drink-resident:'+id))
     if(people.every(actor=>actor?.userData.drink&&actor.getObjectByName(names[4]))){
      const elapsed=people[0].userData.drink.elapsed
      if(elapsed>.001)window.drinkMotionStarted=true
      if(window.drinkMotionStarted){
       const actors=people.map(actor=>({id:actor.name,...actor.userData.drink,root:actor.getWorldPosition(actor.position.clone()).toArray(),rotation:actor.quaternion.toArray(),bones:names.map(name=>{const bone=actor.getObjectByName(name);return {name,position:bone.getWorldPosition(actor.position.clone()).toArray(),quaternion:bone.quaternion.toArray()}})}))
       for(const actor of people)if(!mouthAnchors.has(actor.uuid)&&['settle','reach','lift','sip','lower','release','listen'].includes(actor.userData.drink.beat))mouthAnchors.set(actor.uuid,window.independentDrinkMouth(actor))
       const cups=[],cupObjects=[];state.scene.traverse(object=>{if(object.name==='shared-drink-physical-cup'){cupObjects.push(object);cups.push({position:object.getWorldPosition(object.position.clone()).toArray(),rotation:object.quaternion.toArray(),beat:object.userData.beat})}})
       const gripErrors=cups.map((cup,index)=>{
        if(!['lift','sip','lower'].includes(cup.beat))return 0
        const actor=people[index],hand=actor.getObjectByName(names[4])
        return actor.position.clone().fromArray(cup.position).add(drinkHandOffset(actor.rotation.y)).distanceTo(hand.getWorldPosition(actor.position.clone()))
       })
       const realRimErrors=cups.map((cup,index)=>{
        if(cup.beat!=='sip')return null
        const actor=people[index]
        const anchor=mouthAnchors.get(actor.uuid)
        if(!anchor)return null
        // Read the CURRENT head, not the driver's previous-frame mouth cache.
        const skin=anchor.head.localToWorld(anchor.point.clone()),physical=cupObjects[index],geometry=physical.children[0].geometry.parameters
        return Math.min(...Array.from({length:64},(_,i)=>{
         const angle=i*Math.PI/32
         return physical.localToWorld(actor.position.clone().set(Math.cos(angle)*geometry.radiusTop,geometry.height/2,Math.sin(angle)*geometry.radiusTop)).distanceTo(skin)
        }))
       })
       const closing=Boolean(state.scene.getObjectByName('shared-drink-performance:completed'))
       window.drinkMotionFrames.push({elapsed,closing,wall:performance.now(),actors,cups,gripErrors,realRimErrors})
       if(!closingRequested&&elapsed>=12){closingRequested=true;window.drinkQaControls.setPhase('completed')}
       if(closing&&actors.every(actor=>actor.beat==='finished')){window.drinkMotionDone=true;return}
      }
     }
    }
    requestAnimationFrame(frame)
   }
   requestAnimationFrame(frame)
   window.drinkQaControls.replay()
  })()`)
  await waitFor(page,'window.drinkMotionDone',45000)
  const frames=await page.evaluate('window.drinkMotionFrames')
  assert.ok(frames.length>100,'sample actual rendered frames, not a few static screenshots')
  const distance=(a,b)=>Math.hypot(...a.map((value,index)=>value-b[index]))
  const angle=(a,b)=>{const dot=a.reduce((sum,value,index)=>sum+value*b[index],0)/(Math.hypot(...a)*Math.hypot(...b));return 2*Math.acos(Math.min(1,Math.abs(dot)))}
  const worst={root:{value:0},bone:{value:0},rotation:{value:0},rotationRate:{value:0},cup:{value:0}},changes=[]
  let maxGripError=0,maxRealRimError=0,rimSamples=0
  for(let i=1;i<frames.length;i++){
   const before=frames[i-1],after=frames[i]
   const dt=after.elapsed>before.elapsed&&after.closing===before.closing?after.elapsed-before.elapsed:Math.min(.1,(after.wall-before.wall)/1000)
   assert.ok(dt<=.101,'the live driver uses bounded deltas, including low-fps rendering')
   for(let index=0;index<2;index++){
    const a=before.actors[index],b=after.actors[index],meta={time:after.elapsed,closing:after.closing,dt,actor:b.id,from:a.beat,to:b.beat}
    maxGripError=Math.max(maxGripError,after.gripErrors[index])
    if(after.cups[index].beat==='sip'){
     assert.notEqual(after.realRimErrors[index],null,'each sipping resident must resolve an actual skin anchor')
     maxRealRimError=Math.max(maxRealRimError,after.realRimErrors[index]);rimSamples++
    }
    if(a.beat!==b.beat)changes.push(meta)
    const root=distance(a.root,b.root),cup=distance(before.cups[index].position,after.cups[index].position)
    if(root>worst.root.value)worst.root={value:root,...meta}
    if(cup>worst.cup.value)worst.cup={value:cup,...meta}
    for(let bone=0;bone<a.bones.length;bone++){
     const position=distance(a.bones[bone].position,b.bones[bone].position),rotation=angle(a.bones[bone].quaternion,b.bones[bone].quaternion)
     if(position>worst.bone.value)worst.bone={value:position,bone:b.bones[bone].name,...meta}
     if(rotation>worst.rotation.value)worst.rotation={value:rotation,bone:b.bones[bone].name,...meta}
     const rate=rotation/Math.max(dt,1/60)
     if(rate>worst.rotationRate.value)worst.rotationRate={value:rate,bone:b.bones[bone].name,...meta}
    }
    assert.ok([...b.root,...b.rotation,...b.bones.flatMap(bone=>[...bone.position,...bone.quaternion]),...after.cups[index].position].every(Number.isFinite),'all actual rendered transforms stay finite')
   }
  }
  const report={family,frames:frames.length,activeSeconds:frames.find(frame=>frame.closing)?.elapsed,closingSeconds:frames.at(-1).elapsed,maxGripError,maxRealRimError,rimSamples,seekRim,worst,changes}
  await writeFile(`/tmp/lingolife-drink-motion-${family}.json`,JSON.stringify({report,frames}))
  console.log(JSON.stringify(report))
  assert.deepEqual(page.errors,[]);assert.deepEqual(page.consoleErrors,[])
  // High enough for a 15fps intentional arm move; low enough to catch a bind
  // pose flash or a root teleport. Detailed maxima remain in the JSON artifact.
  assert.ok(worst.root.value<.14,`${family}: unexpected root teleport`)
  assert.ok(worst.bone.value<.3,`${family}: unexpected bone position jump`)
  assert.ok(worst.rotation.value<1.1,`${family}: unexpected single-frame bone rotation jump`)
  assert.ok(worst.rotationRate.value<24,`${family}: abrupt joint rotation (${worst.rotationRate.value.toFixed(2)}rad/s) must not hide below a low-fps absolute threshold`)
  assert.ok(worst.cup.value<.18,`${family}: unexpected physical cup jump`)
  assert.ok(maxGripError<.003,`${family}: cup must follow the same-frame hand, not last frame's pose`)
  assert.ok(rimSamples>40&&maxRealRimError<.02,`${family}: actual current-frame face/rim contact ${maxRealRimError.toFixed(4)}m must stay below 20mm`)
 }finally{await page.close()}
}
console.log('Drink live-motion browser passed: 0→12s active then live completed/stand/leave, both real residents, actual root/bones/cups, same-frame grip, finite transforms and bounded per-frame movement. This is isolated presentation QA, not an AI or gameplay test.')
