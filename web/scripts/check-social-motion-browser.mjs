import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {openQaPage,waitFor,delay} from './browser-cdp.mjs'

const base=process.env.QA_BASE_URL??'http://127.0.0.1:5173'
const families=(process.env.QA_SOCIAL_FAMILIES??'city,chibi').split(',')
const cases=(process.env.QA_SOCIAL_CASES??'standing,seated').split(',')
const width=Number(process.env.QA_SOCIAL_WIDTH??1280),suffix=width===1280?'':`-${width}`
const distance=(a,b)=>Math.hypot(...a.map((value,index)=>value-b[index]))
const angle=(a,b)=>2*Math.acos(Math.min(1,Math.abs(a.reduce((sum,value,index)=>sum+value*b[index],0)/(Math.hypot(...a)*Math.hypot(...b)))))
const extent=points=>Math.hypot(...[0,1,2].map(axis=>Math.max(...points.map(point=>point[axis]))-Math.min(...points.map(point=>point[axis]))))
const degrees=(hip,knee,ankle)=>{
 const thigh=knee.map((value,i)=>value-hip[i]),lower=ankle.map((value,i)=>value-knee[i])
 return {thigh:Math.atan2(thigh[1],Math.hypot(thigh[0],thigh[2]))*180/Math.PI,knee:Math.acos(Math.max(-1,Math.min(1,-thigh.reduce((sum,value,i)=>sum+value*lower[i],0)/(Math.hypot(...thigh)*Math.hypot(...lower)))))*180/Math.PI}
}

for(const family of families)for(const scenario of cases){
 const reduced=scenario==='reduced',layout=reduced?'seated':scenario
 assert.ok(['standing','seated'].includes(layout),'arrival is measured by the separate full drink trajectory suite')
 const names=family==='city'?['Hips','Head','ArmL','ForeArmL','HandL','ArmR','ForeArmR','HandR','UpperLegL','LegL','FootL','UpperLegR','LegR','FootR']:['DEF-spine','DEF-spine006','DEF-upper_armL','DEF-forearmL','DEF-handL','DEF-upper_armR','DEF-forearmR','DEF-handR','DEF-thighL','DEF-shinL','DEF-footL','DEF-thighR','DEF-shinR','DEF-footR']
 const prefix=layout==='standing'?'encounter-resident:':'drink-resident:'
 const page=await openQaPage()
 try{
  await page.call('Emulation.setDeviceMetricsOverride',{width,height:width<600?844:900,deviceScaleFactor:1,mobile:width<600})
  await page.call('Page.navigate',{url:`${base}/scripts/fixtures/social-motion.html?case=${layout}&family=${family}&reduced=${reduced?1:0}&clean=1`})
  await page.call('Page.bringToFront')
  await waitFor(page,'document.querySelector("canvas")&&window.socialQaControls',30000)
  await page.evaluate(`import('/node_modules/.vite/deps/@react-three_fiber.js').then(module=>window.socialQaRoots=module._roots)`)
  await waitFor(page,`[...window.socialQaRoots.values()].some(root=>root.store.getState().scene.getObjectByName('${prefix}mira')?.getObjectByName('${names[7]}'))`,30000)
  await delay(900)
  await page.evaluate(`(async()=>{
   window.socialQaControls.replay()
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
   window.socialMotionFrames=[];window.socialMotionDone=false
   const names=${JSON.stringify(names)},prefix=${JSON.stringify(prefix)}
   let start
   const sample=()=>{
    const state=[...window.socialQaRoots.values()][0]?.store.getState()
    const people=['mira','noah'].map(id=>state?.scene.getObjectByName(prefix+id))
    if(people.every(actor=>actor?.getObjectByName(names[7]))){
     start??=performance.now();state.scene.updateMatrixWorld(true)
     const actors=people.map(actor=>({uuid:actor.uuid,id:actor.name,root:actor.getWorldPosition(actor.position.clone()).toArray(),bones:names.map(name=>{const bone=actor.getObjectByName(name),world=bone.getWorldPosition(bone.position.clone());return {name,world:world.toArray(),local:actor.worldToLocal(world.clone()).toArray(),quaternion:bone.quaternion.toArray()}})}))
     const cups=[];state.scene.traverse(object=>{if(object.name==='shared-drink-physical-cup')cups.push(object.getWorldPosition(object.position.clone()).toArray())})
     const time=(performance.now()-start)/1000
     window.socialMotionFrames.push({time,actors,cups,lineCount:document.querySelectorAll('.life-story-encounter__beats blockquote').length,labels:[...document.querySelectorAll('.encounter-resident-name.is-speaking')].map(node=>node.textContent)})
     if(time>${reduced?3:13}){window.socialMotionDone=true;return}
    }
    requestAnimationFrame(sample)
   }
   requestAnimationFrame(sample)
  })()`)
  for(const [label,time]of reduced?[['quiet',2.5]]:[['mira',1.7],['noah',4.7],['reply',7.7],['quiet',11.5]]){
   await waitFor(page,`window.socialMotionFrames.at(-1)?.time>${time}`,20000)
   const shot=await page.call('Page.captureScreenshot',{format:'png'})
   await writeFile(`/tmp/lingolife-social-${scenario}-${family}${suffix}-${label}.png`,Buffer.from(shot.data,'base64'))
  }
  await waitFor(page,'window.socialMotionDone',20000)
  const frames=await page.evaluate('window.socialMotionFrames'),metrics=[]
  await writeFile(`/tmp/lingolife-social-${scenario}-${family}${suffix}.json`,JSON.stringify({family,scenario,frames}))
  assert.ok(frames.length>(reduced?30:130),'sample rendered motion, not only declared state')
  // The story clock can start while Suspense is still resolving a real asset.
  // Anchor the authored 3-second schedule to the second visible text bubble,
  // not our later first rendered frame and not a runtime speaking flag.
  const secondLine=frames.find(frame=>frame.lineCount===2)?.time
  if(!reduced)assert.ok(secondLine!==undefined,'the production story must reveal the second sentence')
  const timelineOffset=reduced?0:secondLine-3
  for(let person=0;person<2;person++){
   const actorFrames=frames.filter(frame=>frame.time>.8)
   assert.equal(new Set(actorFrames.map(frame=>frame.actors[person].uuid)).size,1,'changing speaker must not remount the actual skeleton')
   const segments={talk:[],listen:[],quiet:[]}
   let maxRotationRate=0,maxBoneStep=0
   for(let index=1;index<actorFrames.length;index++){
    const previous=actorFrames[index-1],frame=actorFrames[index],dt=frame.time-previous.time
    const a=previous.actors[person],b=frame.actors[person]
    assert.ok(b.bones.flatMap(bone=>[...bone.world,...bone.quaternion]).every(Number.isFinite))
    for(let bone=0;bone<b.bones.length;bone++){
     maxBoneStep=Math.max(maxBoneStep,distance(a.bones[bone].world,b.bones[bone].world))
     maxRotationRate=Math.max(maxRotationRate,angle(a.bones[bone].quaternion,b.bones[bone].quaternion)/Math.max(dt,1/60))
    }
    // Segment by authored sentence times, NOT the runtime's speaking flag.
    const storyTime=frame.time-timelineOffset
    const speaker=storyTime>1&&storyTime<2.7?0:storyTime>3.8&&storyTime<5.7?1:storyTime>6.8&&storyTime<8.7?0:undefined
    const kind=storyTime>10?'quiet':speaker===undefined?undefined:speaker===person?'talk':'listen'
    if(kind){
     const angular=[2,3,5,6].reduce((sum,bone)=>sum+angle(a.bones[bone].quaternion,b.bones[bone].quaternion),0)/4
     segments[kind].push({dt,angular,hands:[b.bones[4].local,b.bones[7].local]})
    }
    if(layout==='seated'&&!reduced)for(const [hip,knee,foot]of [[8,9,10],[11,12,13]]){
     const leg=degrees(b.bones[hip].world,b.bones[knee].world,b.bones[foot].world)
     assert.ok(Math.abs(leg.thigh)<20&&leg.knee>65&&leg.knee<140,`${family}: seated speech must keep authored horizontal thighs and bent knees, ${JSON.stringify(leg)}`)
    }
   }
   const stats=Object.fromEntries(Object.entries(segments).map(([kind,values])=>[kind,{samples:values.length,armSpeed:values.reduce((sum,value)=>sum+value.angular,0)/Math.max(.001,values.reduce((sum,value)=>sum+value.dt,0)),handRange:values.length?Math.max(...[0,1].map(hand=>extent(values.map(value=>value.hands[hand])))):0}]))
   const footRange=Math.max(...[10,13].map(bone=>extent(actorFrames.map(frame=>frame.actors[person].bones[bone].world))))
   let recoverySeconds
   if(!reduced){
    const stop=timelineOffset+(person?6:9),reference=frames.find(frame=>frame.time>stop+1.3).actors[person]
    const recovered=frames.find(frame=>frame.time>stop&&frames.filter(next=>next.time>=frame.time&&next.time<frame.time+.2).every(next=>[4,7].every(bone=>distance(next.actors[person].bones[bone].local,reference.bones[bone].local)<.03)))
    recoverySeconds=recovered?.time-stop
    assert.ok(recoverySeconds>=0&&recoverySeconds<.9,`${family}/${person}: hands must visibly ease back within 30mm of calm pose in less than .9s, not stay held mid-gesture`)
   }
   console.log(JSON.stringify({family,scenario,person,stats,maxRotationRate,maxBoneStep,footRange,recoverySeconds}))
   if(reduced){
    assert.ok(maxBoneStep<.0001,`${family}: reduced motion must actually pause the posed body`)
   }else{
    assert.ok(stats.talk.samples>30&&stats.listen.samples>30&&stats.quiet.samples>30)
    assert.ok(stats.talk.handRange>.025,`${family}/${person}: a real speaking gesture must be visible in the hand trajectory`)
    assert.ok(stats.talk.armSpeed>stats.listen.armSpeed*1.2,`${family}/${person}: speaking must have more measured arm articulation than listening`)
    assert.ok(stats.quiet.armSpeed<stats.talk.armSpeed*.65,`${family}/${person}: finished speech must settle instead of looping forever`)
    assert.ok(maxRotationRate<24&&maxBoneStep<.3,`${family}: speech on/off may not flash a bind pose or snap the bones`)
    if(layout==='standing')assert.ok(footRange<.06,`${family}: standing speech may not slide planted feet, range=${footRange}m`)
   }
   metrics.push({person,stats,maxRotationRate,maxBoneStep,footRange,recoverySeconds})
  }
  if(layout==='seated'&&!reduced){
   assert.ok(frames.every(frame=>frame.cups.length===2),'both real physical cups remain present')
   for(let index=0;index<2;index++)assert.ok(extent(frames.map(frame=>frame.cups[index]))<.001,'conversational hand gestures must not move the resting cups')
  }
  if(!reduced)assert.ok(frames.filter(frame=>frame.time>10).every(frame=>frame.labels.length===0),'the final visible line must not remain a perpetual speaking cue')
  assert.deepEqual(page.errors,[]);assert.deepEqual(page.consoleErrors,[])
  const report={family,scenario,width,frames:frames.length,metrics}
  await writeFile(`/tmp/lingolife-social-${scenario}-${family}${suffix}.json`,JSON.stringify({report,frames}))
  console.log(JSON.stringify(report))
 }finally{await page.close()}
}
console.log(`Social motion browser passed for requested cases [${cases.join(', ')}]: actual bones and visible text timing, with talk/listen contrast and calm recovery for full motion, body freeze for reduced motion. This is local presentation QA, not speech audio, lip sync or AI validation.`)
