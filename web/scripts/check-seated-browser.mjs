import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {openQaPage,waitFor,delay} from './browser-cdp.mjs'

// Isolated browser only. --baseline records a known-bad pose and NEVER calls it
// a pass. This script measures rendered geometry, not the solver's own targets.
// No account/API mutation, character transform edits or production camera edits.
const baseline=process.argv.includes('--baseline'),label=baseline?'before':'after'
const base=process.env.QA_BASE_URL??'http://127.0.0.1:5173'
const families=(process.env.QA_SEATED_FAMILIES??'city,chibi').split(',')
const venues=(process.env.QA_SEATED_VENUES??'cafe,home').split(',')
const reports=[]
for(const venue of venues)for(const family of families){
 const page=await openQaPage()
 try{
  await page.call('Emulation.setDeviceMetricsOverride',{width:1400,height:1000,deviceScaleFactor:1,mobile:false})
  await page.call('Page.navigate',{url:`${base}/scripts/fixtures/embodied-life.html?venue=${venue}&family=${family}&phase=active&time=10.5&clean=1`})
  await page.call('Page.bringToFront')
  await waitFor(page,'document.querySelector("canvas")',30000)
  await page.evaluate(`Promise.all([import('/node_modules/.vite/deps/@react-three_fiber.js'),import('/node_modules/.vite/deps/three.js'),import('/src/three/world/streetscapeLayout.ts'),import('/src/three/interiors/sharedDrinkLayout.ts')]).then(([fiber,three,cafe,home])=>{window.seatedQa={roots:fiber._roots,three,layout:${JSON.stringify(venue)}==='cafe'?cafe.CAFE_DRINK_RIG:home.resolveSharedDrinkLayout()}})`)
  await waitFor(page,`[...seatedQa.roots.values()].some(root=>['mira','noah'].every(id=>Math.abs((root.store.getState().scene.getObjectByName('drink-resident:'+id)?.userData.drink?.elapsed??-1)-10.5)<.002))`,30000)
  await delay(1200)
  const report=await page.evaluate(`(()=>{
   const {three,layout}=seatedQa,state=[...seatedQa.roots.values()][0].store.getState(),scene=state.scene
   const style=document.createElement('style');style.textContent='.encounter-resident-name{visibility:hidden!important}';document.head.append(style)
   const first=layout.seats[0],forward=new three.Vector3(Math.sin(first.rotation),0,Math.cos(first.rotation)),side=new three.Vector3(-Math.cos(first.rotation),0,Math.sin(first.rotation))
   // The west side of the authored lounge is a wall; inspect from its open
   // central aisle, not from outside that wall with a fully occluded camera.
   if(${JSON.stringify(venue)}==='home')side.multiplyScalar(-1)
   const target=new three.Vector3(first.position[0],.8,first.position[2]).addScaledVector(forward,.1)
   const camera=state.camera;camera.position.copy(target).addScaledVector(side,3.4);camera.lookAt(target);camera.fov=36;camera.updateProjectionMatrix();camera.updateMatrixWorld(true)
   scene.updateMatrixWorld(true)
   const family=${JSON.stringify(family)},point=object=>object.getWorldPosition(new three.Vector3())
   const visible=object=>{for(let node=object;node;node=node.parent)if(!node.visible)return false;return true}
   const inActor=object=>{for(let node=object;node;node=node.parent)if(node.name.startsWith('drink-resident:')||node.name==='shared-drink-physical-cup')return true;return false}
   const furniture=[];scene.traverse(object=>{if(object.isMesh&&!object.isSkinnedMesh&&visible(object)&&!inActor(object)&&object.name!=='furniture-contact')furniture.push(object)})
   const ray=new three.Raycaster(),down=new three.Vector3(0,-1,0)
   const actors=['mira','noah'].map((id,index)=>{
    const actor=scene.getObjectByName('drink-resident:'+id),seat=layout.seats[index],facing=new three.Vector3(Math.sin(seat.rotation),0,Math.cos(seat.rotation)),across=new three.Vector3(Math.cos(seat.rotation),0,-Math.sin(seat.rotation))
    const pelvis=actor.getObjectByName(family==='city'?'Hips':'DEF-spine'),names=side=>family==='city'?['UpperLeg'+side,'Leg'+side,'Foot'+side]:['DEF-thigh'+side,'DEF-shin'+side,'DEF-foot'+side]
    const joints=['L','R'].map(side=>{
     const [hip,knee,ankle]=names(side).map(name=>point(actor.getObjectByName(name)))
     const thigh=knee.clone().sub(hip),shin=ankle.clone().sub(knee),kneeInterior=thigh.clone().negate().angleTo(shin)*180/Math.PI
     return {side,hip:hip.toArray(),knee:knee.toArray(),ankle:ankle.toArray(),thighDownDegrees:Math.atan2(-thigh.y,Math.hypot(thigh.x,thigh.z))*180/Math.PI,kneeInteriorDegrees:kneeInterior,kneeForward:thigh.dot(facing),ankleForward:ankle.clone().sub(knee).dot(facing)}
    })
    ray.set(new three.Vector3(seat.position[0],seat.seatTopY+.25,seat.position[2]),down);ray.far=.7
    const surfaces=ray.intersectObjects(furniture,false).map(hit=>({y:hit.point.y,mesh:hit.object.name,point:hit.point.toArray()}))
    const support=surfaces.find(hit=>Math.abs(hit.y-seat.seatTopY)<.06)
    const hipCenter=new three.Vector3().fromArray(joints[0].hip).add(new three.Vector3().fromArray(joints[1].hip)).multiplyScalar(.5),supportVertices=[],clothingVertices=[],footVertices={L:[],R:[]}
    actor.traverse(mesh=>{
     if(!mesh.isSkinnedMesh||!visible(mesh))return
     const positions=mesh.geometry.getAttribute('position'),indices=mesh.geometry.getAttribute('skinIndex'),weights=mesh.geometry.getAttribute('skinWeight')
     if(!positions||!indices||!weights)return
     mesh.skeleton.update()
     for(let vertex=0;vertex<positions.count;vertex++){
      let supportWeight=0,lowerWeight=0;const footWeight={L:0,R:0},influences=[]
      for(let component=0;component<4;component++){
       const bone=mesh.skeleton.bones[indices.getComponent(vertex,component)]?.name??'',weight=weights.getComponent(vertex,component)
       if(weight>0)influences.push({bone,weight})
       if(bone===pelvis.name||['L','R'].some(side=>bone===names(side)[0]))supportWeight+=weight
       if(['L','R'].some(side=>bone===names(side)[1]||bone===names(side)[2]))lowerWeight+=weight
       for(const side of ['L','R'])if(bone===names(side)[2])footWeight[side]+=weight
      }
      if(supportWeight<.6&&footWeight.L<.5&&footWeight.R<.5)continue
      const p=mesh.getVertexPosition(vertex,new three.Vector3()).applyMatrix4(mesh.matrixWorld),offset=p.clone().sub(hipCenter)
      // Independently sample the rear body band around real thigh sockets.
      // A Chibi skirt/pants hem can hang below a cushion without being skin.
      if(supportWeight>=.6&&lowerWeight<.15&&offset.dot(facing)<.03&&offset.dot(facing)>-.18&&Math.abs(offset.dot(across))<.2){
       const surface=family==='chibi'&&mesh.name!=='character_low'?clothingVertices:supportVertices
       surface.push({y:p.y,point:p.toArray(),mesh:mesh.name,vertex,influences})
      }
      for(const side of ['L','R'])if(footWeight[side]>=.5)footVertices[side].push(p.y)
     }
    })
    supportVertices.sort((a,b)=>a.y-b.y);clothingVertices.sort((a,b)=>a.y-b.y)
    const skinSupport=supportVertices[0]??null
    let skinSupportSurface=null
    if(skinSupport){
     ray.set(new three.Vector3(skinSupport.point[0],seat.seatTopY+.25,skinSupport.point[2]),down)
     const hit=ray.intersectObjects(furniture,false).find(hit=>Math.abs(hit.point.y-seat.seatTopY)<.06)
     if(hit)skinSupportSurface={point:hit.point.toArray(),y:hit.point.y,mesh:hit.object.name}
    }
    return {id,elapsed:actor.userData.drink.elapsed,beat:actor.userData.drink.beat,root:point(actor).toArray(),pelvis:point(pelvis).toArray(),seat,surfaces,support,skinSupport,skinSupportSurface,clothingHem:clothingVertices[0]??null,skinSeatGap:skinSupportSurface&&skinSupport?skinSupport.y-skinSupportSurface.y:null,supportVertexCount:supportVertices.length,soleMinY:Object.fromEntries(['L','R'].map(side=>[side,footVertices[side].length?Math.min(...footVertices[side]):null])),joints}
   })
   const rect=document.querySelector('canvas').getBoundingClientRect()
   return {family,venue:${JSON.stringify(venue)},time:10.5,camera:{position:camera.position.toArray(),target:target.toArray(),fov:camera.fov},actors,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}}
  })()`)
  await delay(500)
  const stem=`/tmp/lingolife-seat-${label}-${venue}-${family}`
  const image=await page.call('Page.captureScreenshot',{format:'png',clip:{...report.rect,scale:1},captureBeyondViewport:false})
  // Preserve the first failing baseline for before/after comparison.
  await writeFile(`${stem}.png`,Buffer.from(image.data,'base64'),baseline?{flag:'wx'}:undefined)
  await writeFile(`${stem}.json`,JSON.stringify(report,null,2),baseline?{flag:'wx'}:undefined)
  reports.push(report)
  console.log(JSON.stringify({family,venue,artifact:stem,actors:report.actors.map(({id,pelvis,support,skinSeatGap,soleMinY,joints})=>({id,pelvis,support,skinSeatGap,soleMinY,joints})),errors:page.errors,consoleErrors:page.consoleErrors}))
  assert.deepEqual(page.errors,[]);assert.deepEqual(page.consoleErrors,[])
  for(const actor of report.actors){
   assert.ok(Math.abs(actor.elapsed-10.5)<.002,'capture the requested stable pose, not a stale frame')
   assert.ok(actor.joints.every(joint=>[...joint.hip,...joint.knee,...joint.ankle,joint.thighDownDegrees,joint.kneeInteriorDegrees].every(Number.isFinite)),'all real joint geometry must be finite')
   assert.ok(actor.support,'a ray must intersect the actual cushion surface, not merely a configured seat target')
   if(!baseline){
    const context=`${venue}/${family}/${actor.id}`
    assert.ok(Math.abs(actor.support.y-actor.seat.seatTopY)<.002,`${context}: configured support must agree with actual furniture within 2mm`)
    assert.ok(actor.skinSupport&&actor.skinSupportSurface&&actor.supportVertexCount>0,`${context}: actual body skin and an actual seat surface beneath it are required`)
    assert.ok(actor.skinSeatGap>=-.003&&actor.skinSeatGap<=.02,`${context}: near-hip skin must touch, not penetrate or float above the actual seat; gap=${actor.skinSeatGap}`)
    for(const joint of actor.joints){
     assert.ok(Math.abs(joint.thighDownDegrees)<20,`${context}/${joint.side}: thigh must lie near horizontal rather than stand downward; ${joint.thighDownDegrees} degrees`)
     assert.ok(joint.kneeInteriorDegrees>70&&joint.kneeInteriorDegrees<130,`${context}/${joint.side}: knee must be visibly bent, not almost straight; ${joint.kneeInteriorDegrees} degrees`)
     assert.ok(joint.kneeForward>.12,`${context}/${joint.side}: knee must extend ahead of the actual hip socket`)
     assert.ok(Number.isFinite(actor.soleMinY[joint.side])&&actor.soleMinY[joint.side]>=-.01,`${context}/${joint.side}: real shoe must not penetrate the floor; short legs may naturally dangle`)
    }
   }
  }
 }finally{await page.close()}
}
await writeFile(`/tmp/lingolife-seat-${label}-report.json`,JSON.stringify(reports,null,2),baseline?{flag:'wx'}:undefined)
console.log(baseline?'Seated baseline recorded without posture assertions; this is NOT a posture pass.':'Seated browser checks passed: both rigs in cafe/home, actual hip/knee/ankle geometry, visibly bent knees, near-horizontal thighs, real skin/cushion contact and no shoe/floor penetration. Side-view screenshots remain required for visual review.')
