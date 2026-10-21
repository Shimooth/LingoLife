import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {openQaPage,waitFor,delay} from './browser-cdp.mjs'

const output=process.env.QA_OUTPUT_DIR??'/private/tmp/lingolife-connected-home-qa'
await mkdir(output,{recursive:true})
const page=await openQaPage()
const click=selector=>page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
const shot=async name=>{const result=await page.call('Page.captureScreenshot',{format:'png'});await writeFile(`${output}/${name}.png`,Buffer.from(result.data,'base64'))}
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2])
const report={occupancy:[],navigation:[],walk:[],screenshots:[],noAccountWrites:true}
try{
 await page.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})
 await page.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]})
 await page.call('Page.navigate',{url:`${process.env.QA_WEB_URL??'http://127.0.0.1:5173'}/scripts/fixtures/connected-home.html`})
 await page.call('Page.bringToFront')
 await waitFor(page,`document.querySelector('[data-home-area="overview"]')&&document.querySelector('canvas')`)
 await page.evaluate(`(async()=>{
  const {_roots}=await import('/node_modules/.vite/deps/@react-three_fiber.js');
  const {Vector3}=await import('/node_modules/.vite/deps/three.js');
  const {CONNECTED_HOME_ROOMS,CONNECTED_HOME_CORRIDORS}=await import('/src/three/interiors/connectedHomeLayout.ts');
  window.connectedHomeProbe=()=>{
   const root=[..._roots.values()][0];
   if(!root)return {roots:[],rooms:[],portals:[],projectedFloors:[]};
   const state=root.store.getState(),scene=state.scene;
   scene.updateMatrixWorld(true);state.camera.updateMatrixWorld(true);
   const roots=[],rooms=[],portals=[],privateBeds=[],characterProps=[],targetAnchors=[];
   const visitFiber=node=>{for(let current=node;current;current=current.sibling){if(current.type?.name==='Character3D'&&current.memoizedProps?.seed){const props=current.memoizedProps;characterProps.push({id:props.seed,animation:props.animation,lifeMotion:props.lifeMotion,hasContact:Boolean(props.lifeHandTarget),hasProp:Boolean(props.lifeProp)})}if(current.type?.name==='HouseholdLifeResident'&&current.memoizedProps?.resident){const props=current.memoizedProps;targetAnchors.push({id:props.resident.id,position:props.anchor.position})}if(current.child)visitFiber(current.child)}};
   visitFiber(root.fiber.current);
   scene.traverse(object=>{
    if(object.name.startsWith('household-resident:'))roots.push({id:object.name.slice('household-resident:'.length),uuid:object.uuid,position:object.getWorldPosition(new Vector3()).toArray(),sleep:Boolean(object.getObjectByName('sleeping-in-own-bed')),shower:Boolean(object.getObjectByName('screened-shower')),bones:(()=>{let count=0;object.traverse(child=>{if(child.isBone)count++});return count})(),legs:(()=>{const result=[];object.traverse(child=>{if(child.isBone&&/leg|thigh|shin/i.test(child.name))result.push({name:child.name,quaternion:child.quaternion.toArray()})});return result})()});
    if(object.name.startsWith('connected-home-room:'))rooms.push({name:object.name,uuid:object.uuid});
    if(object.name.startsWith('connected-home-portal:'))portals.push(object.name);
    if(object.name.startsWith('bed-'))privateBeds.push(object.name);
   });
   const projectedFloors=CONNECTED_HOME_ROOMS.flatMap(room=>[room.bounds[0],room.bounds[1]].flatMap(x=>[room.bounds[2],room.bounds[3]].map(z=>new Vector3(x,-.125,z).project(state.camera).toArray())));
   return {roots,rooms,portals,privateBeds,projectedFloors,corridors:CONNECTED_HOME_CORRIDORS,characterProps,targetAnchors,
    corridor:Boolean(scene.getObjectByName('connected-home-corridor')),triangles:state.gl.info.render.triangles,
    camera:state.camera.position.toArray(),caption:document.querySelector('.household-interior-preview__caption b').textContent};
  };
 })()`)
 await waitFor(page,`connectedHomeProbe().rooms.length===4&&connectedHomeProbe().roots.length===2&&connectedHomeProbe().roots.every(actor=>actor.bones>10)`)
 await delay(1300)
 const first=await page.evaluate('connectedHomeProbe()')
 assert.equal(first.corridor,true,'The same scene has a real connecting corridor')
 assert.equal(first.portals.length,4,'All four areas have actual open doorways')
 assert.match(first.caption,/全屋/)
 assert.ok(first.projectedFloors.every(point=>point.every(Number.isFinite)&&Math.abs(point[0])<=1&&Math.abs(point[1])<=1&&point[2]>=-1&&point[2]<=1),'Overview camera includes all four floors')
 const rootIdentities=Object.fromEntries(first.roots.map(actor=>[actor.id,actor.uuid]))
 const roomIdentities=Object.fromEntries(first.rooms.map(room=>[room.name,room.uuid]))
 for(const area of ['living_room','kitchen','bathroom','bedroom','overview']){
  await click(`[data-home-area="${area}"]`)
  await delay(130)
  const snapshot=await page.evaluate('connectedHomeProbe()')
  assert.deepEqual(Object.fromEntries(snapshot.roots.map(actor=>[actor.id,actor.uuid])),rootIdentities,`${area}: camera navigation remounted residents`)
  assert.deepEqual(Object.fromEntries(snapshot.rooms.map(room=>[room.name,room.uuid])),roomIdentities,`${area}: camera navigation remounted rooms`)
  report.navigation.push({area,actors:snapshot.roots.length,rooms:snapshot.rooms.length})
 }
 await delay(900)
 await shot('desktop-overview');report.screenshots.push('desktop-overview.png')
 console.log('Connected-home QA: four actual areas, portals, whole-floor camera and stable camera navigation passed; checking a blocked doorway and real recovery walk.')
 const kitchenTarget=await page.evaluate(`(async()=>{const {resolveIndoorResidentAnchors}=await import('/src/three/interiors/sharedHomeLayout.ts');const {connectedHomePoint}=await import('/src/three/interiors/connectedHomeLayout.ts');return connectedHomePoint(resolveIndoorResidentAnchors('kitchen',[{id:'aria',actionType:'prepare_food'}],[{id:'aria',privateRoomId:'fixture-home:private-room-08'},{id:'nora',privateRoomId:'fixture-home:private-room-01'}])[0].position,'kitchen')})()`)
 await click('[data-door="block"]');await click('[data-phase="kitchen"]')
 await waitFor(page,`[...document.querySelectorAll('.household-life-label')].some(label=>label.textContent.includes('Aria')&&label.textContent.includes('等通路空出来'))`)
 const blocked=await page.evaluate(`connectedHomeProbe().roots.find(actor=>actor.id==='aria')`)
 await delay(2200)
 const blockedState=await page.evaluate('connectedHomeProbe()')
 assert.equal(blockedState.roots.find(actor=>actor.id==='aria').uuid,blocked.uuid,'A blocked doorway replaced the actor')
 assert.ok(distance(blockedState.roots.find(actor=>actor.id==='aria').position,blocked.position)<.001,'Resident walked through the sealed kitchen doorway')
 const blockedProps=blockedState.characterProps.find(actor=>actor.id==='aria')
 assert.ok(blockedProps&&!blockedProps.hasContact&&!blockedProps.hasProp&&blockedProps.lifeMotion==='Idle_A','Unreachable kitchen action activated contact or utensils remotely')
 const blockedTarget=blockedState.targetAnchors.find(actor=>actor.id==='aria').position
 report.blocked={position:blocked.position,character:blockedProps,target:blockedTarget}
 const start=blocked
 await click('[data-door="clear"]') // The stove anchor is unchanged; layout changes must still re-plan.
 await waitFor(page,`document.querySelector('[data-door="clear"]').getAttribute('aria-pressed')==='true'`)
 const clearedTarget=await page.evaluate(`connectedHomeProbe().targetAnchors.find(actor=>actor.id==='aria').position`)
 assert.deepEqual(clearedTarget,blockedTarget,'Clear must keep the exact authored kitchen anchor; only the door obstruction changes')
 report.clearedTarget=clearedTarget
 await click('[data-home-area="overview"]')
 const deadline=Date.now()+60000
 let previous=start.position,previousAt=Date.now(),arrived=false,throughHall=false,everMoved=false,walkLegsChanged=false,previousLegs
 while(Date.now()<deadline){
  await delay(240)
  const actor=await page.evaluate(`connectedHomeProbe().roots.find(actor=>actor.id==='aria')`),now=Date.now()
  assert.equal(actor.uuid,start.uuid,'Cross-room travel remounted the resident root')
  assert.ok(actor.position.every(Number.isFinite),'Walking root has non-finite coordinates')
  const traveled=distance(previous,actor.position),elapsed=(now-previousAt)/1000
  assert.ok(traveled<=Math.max(.12,elapsed*.82+.06),`Resident teleported ${traveled.toFixed(3)} m over ${elapsed.toFixed(3)} s`)
  everMoved||=distance(start.position,actor.position)>.2
  if(traveled>.01&&actor.legs.length){if(previousLegs)walkLegsChanged||=actor.legs.some((leg,index)=>leg.quaternion.some((value,axis)=>Math.abs(value-(previousLegs[index]?.quaternion[axis]??value))>.001));previousLegs=actor.legs}
  if(actor.position[2]>-1.3325&&actor.position[2]<.7395)throughHall=true
  report.walk.push({elapsed:(now-(deadline-60000))/1000,position:actor.position})
  previous=actor.position;previousAt=now
  if(distance(actor.position,kitchenTarget)<.04){arrived=true;break}
 }
 assert.ok(everMoved,'Resident did not start the actual walk')
 assert.ok(throughHall,'Living-room→kitchen walk skipped the connecting hall')
 assert.ok(walkLegsChanged,'The root moved while leg bones remained frozen')
 assert.ok(arrived,'Resident did not reach the actual kitchen anchor within 60 seconds')
 await click('[data-home-area="kitchen"]');await delay(1200)
 await shot('desktop-kitchen');report.screenshots.push('desktop-kitchen.png')
 report.walkLegsChanged=walkLegsChanged
 console.log(`Connected-home QA: clearing the doorway resumed the actual walk; arrived after ${report.walk.at(-1).elapsed.toFixed(1)} s with moving legs, stable root and no teleport.`)
 // High-occupancy and privacy checks use the product's reduced-motion mode,
 // so they do not introduce a test-only animation speed into production.
 await page.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
 for(const count of [2,4,8]){
  await click(`[data-roster="${count}"]`)
  await waitFor(page,`connectedHomeProbe().roots.length===${count}&&connectedHomeProbe().roots.every(actor=>actor.bones>10)`)
  const snapshot=await page.evaluate('connectedHomeProbe()')
  assert.equal(new Set(snapshot.roots.map(actor=>actor.id)).size,count,'Residents were duplicated across areas')
  assert.equal(snapshot.rooms.length,4)
  report.occupancy.push({count,ids:snapshot.roots.map(actor=>actor.id),triangles:snapshot.triangles})
 }
 await click('[data-phase="sleep"]')
 await waitFor(page,`connectedHomeProbe().roots.find(actor=>actor.id==='aria')?.sleep`)
 const sleeping=await page.evaluate(`connectedHomeProbe().roots.find(actor=>actor.id==='aria')`)
 assert.equal(sleeping.uuid,start.uuid,'Private animation changed the persistent resident root')
 assert.ok(distance(sleeping.position,[6.2+3.75*.99,-.17,4.6+1.83*.99+.05])<.0001,'Aria left assigned bed 08')
 await click('[data-home-area="bedroom"]')
 await waitFor(page,`document.querySelectorAll('.private-bedroom-label').length===8`)
 assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('.private-bedroom-label span')].map(element=>Number(element.textContent)).sort((a,b)=>a-b)`),[1,2,3,4,5,6,7,8])
 await shot('desktop-bedrooms');report.screenshots.push('desktop-bedrooms.png')
 await click('[data-phase="shower"]')
 await waitFor(page,`connectedHomeProbe().roots.find(actor=>actor.id==='aria')?.shower`)
 await click('[data-home-area="overview"]')
 await page.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
 await delay(750)
 assert.equal(await page.evaluate('document.documentElement.scrollWidth'),390,'Whole-home mobile view overflows horizontally')
 const mobile=await page.evaluate('connectedHomeProbe()')
 assert.ok(mobile.projectedFloors.every(point=>Math.abs(point[0])<=1&&Math.abs(point[1])<=1&&point[2]>=-1&&point[2]<=1),'Mobile overview clips a room floor')
 const buttons=await page.evaluate(`[...document.querySelectorAll('[data-home-area]')].map(button=>{const bounds=button.getBoundingClientRect();return {area:button.dataset.homeArea,left:bounds.left,right:bounds.right,top:bounds.top,bottom:bounds.bottom}})`)
 assert.ok(buttons.every(button=>button.left>=0&&button.right<=391&&button.top>=0&&button.bottom<=844),'Mobile area navigation is clipped or off screen')
 await shot('mobile-overview');report.screenshots.push('mobile-overview.png')
 assert.deepEqual(page.errors,[]);assert.deepEqual(page.consoleErrors,[])
 report.status='passed'
 await writeFile(`${output}/report.json`,JSON.stringify(report,null,2))
 console.log(`Connected-home browser checks passed: 4 connected areas, 2/4/8 real occupants, stable navigation, actual cross-room walk, assigned bedroom and covered shower, desktop/390px full-floor framing. Screenshots: ${output}. No account writes.`)
}catch(error){
 report.status='failed';report.error=String(error);report.pageErrors=page.errors;report.consoleErrors=page.consoleErrors
 await writeFile(`${output}/report.json`,JSON.stringify(report,null,2))
 await shot('failure').catch(()=>{})
 throw error
}finally{await page.close()}
