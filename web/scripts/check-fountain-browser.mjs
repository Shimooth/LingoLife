import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {openQaPage,delay} from './browser-cdp.mjs'

process.env.QA_CDP_URL??='http://127.0.0.1:19228'
const dir=process.env.QA_ARTIFACT_DIR??'/private/tmp/lingolife-fountain-qa'
const base=process.env.QA_BASE_URL??'http://127.0.0.1:5173'
const sourceRoot=new URL('../public/assets/life/interiors/park/',import.meta.url)
const originalHashes={
 'fountain.gltf':'9ec7b207872cd6c21d18c80fa838e82dec63e7ea41831eedb4ae19e2e81548a9',
 'fountain.bin':'2d1eeb8058bbe4915147dda967577add7bc5d7af2807a8a9464aa6098b8fc75b',
 'tiny_treats_texture_1.png':'0dc04a048fd85b129183864788cf85bd63ead6fdccb788a21be98d92f2c4e408',
}
for(const [file,expected] of Object.entries(originalHashes))assert.equal(createHash('sha256').update(await readFile(new URL(file,sourceRoot))).digest('hex'),expected,`Original Tiny Treats ${file} stays intact`)
await mkdir(dir,{recursive:true})
const report={sourceHashes:originalHashes,sourceRoot:fileURLToPath(sourceRoot),screens:[]}
const page=await openQaPage()
const wait=async expression=>{for(let n=0;n<240;n++){try{if(await page.evaluate(`Boolean(${expression})`))return}catch(error){if(!/context|navigation|document/i.test(error.message))throw error}await delay(100)}throw new Error(`Timeout: ${expression}`)}
const inScene=expression=>page.evaluate(`(async()=>{const {_roots}=await import('/node_modules/.vite/deps/@react-three_fiber.js');const state=_roots.get(document.querySelector('canvas'))?.store.getState();if(!state)return null;const {scene,camera}=state;const fountain=scene.getObjectByName('toy-fountain-facility');const THREE=await import('/node_modules/.vite/deps/three.js');return ${expression}})()`)
const ready=async()=>{
 await wait(`window.townPreview && document.querySelector('canvas') && !document.querySelector('.world3d-loading')`)
 for(let n=0;n<150;n++){if(await inScene(`Boolean(fountain?.getObjectByName('fountain_water')&&fountain?.getObjectByName('fountain-flow-droplets'))`))break;await delay(100)}
 assert.equal(await inScene(`Boolean(fountain?.getObjectByName('fountain_water'))`),true,'Original water mesh loads')
 await delay(1600)
}
const snapshot=()=>inScene(`({bumpOffset:fountain.getObjectByName('fountain_water').material.bumpMap?.offset.toArray(),drops:fountain.getObjectByName('fountain-flow-droplets').children.map(o=>[...o.position.toArray(),...o.scale.toArray()]),rings:fountain.getObjectByName('fountain-impact-ripples').children.map(o=>[...o.scale.toArray(),o.material.opacity])})`)
const screenshot=async name=>{
 const image=await page.call('Page.captureScreenshot',{format:'png'})
 await writeFile(`${dir}/${name}.png`,Buffer.from(image.data,'base64'));report.screens.push(name)
}
const geometryProbe=`(()=>{
 scene.updateMatrixWorld(true)
 const inverse=fountain.matrixWorld.clone().invert(),box=new THREE.Box3(),point=new THREE.Vector3(),matrix=new THREE.Matrix4(),materials=[],streams=[]
 fountain.traverse(object=>{
  if(!object.isMesh)return
  const position=object.geometry.attributes.position;matrix.multiplyMatrices(inverse,object.matrixWorld)
  for(let i=0;i<position.count;i++)box.expandByPoint(point.fromBufferAttribute(position,i).applyMatrix4(matrix))
  if(['fountain','fountain_water','fountain_leaves'].includes(object.name))materials.push({mesh:object.name,material:object.material.name,uuid:object.material.uuid,roughness:object.material.roughness,metalness:object.material.metalness,clearcoat:object.material.clearcoat??0,hasAtlas:Boolean(object.material.map),textureWidth:object.material.map?.image?.width??null})
  if(object.name==='fountain-water-stream'){
   const path=object.geometry.parameters.path
   streams.push({start:path.getPoint(0).applyMatrix4(matrix).toArray(),end:path.getPoint(1).applyMatrix4(matrix).toArray()})
  }
 })
 // Extract the actual mesh triangles into fountain coordinates. A ray through
 // the XZ plane is equivalent to the top-down water/leaf footprint projection.
 const triangles=mesh=>{
  const result=[],position=mesh.geometry.attributes.position,index=mesh.geometry.index,m=new THREE.Matrix4().multiplyMatrices(inverse,mesh.matrixWorld)
  for(let i=0;i<(index?.count??position.count);i+=3){const triangle=[];for(let j=0;j<3;j++)triangle.push(new THREE.Vector3().fromBufferAttribute(position,index?index.getX(i+j):i+j).applyMatrix4(m).toArray());result.push(triangle)}
  return result
 }
 const water=triangles(fountain.getObjectByName('fountain_water')),leaves=triangles(fountain.getObjectByName('fountain_leaves'))
 const lowerY=Math.min(...water.flat().map(v=>v[1])),upperY=Math.max(...water.flat().map(v=>v[1]))
 const bottom=water.filter(triangle=>triangle.every(v=>Math.abs(v[1]-lowerY)<.0001))
 const inside=(x,z,t)=>{const signs=t.map((a,i)=>{const b=t[(i+1)%3];return (b[0]-a[0])*(z-a[2])-(b[2]-a[2])*(x-a[0])});return Math.min(...signs)>=-1e-8||Math.max(...signs)<=1e-8}
 const segmentDistance=(x,z,a,b)=>{const dx=b[0]-a[0],dz=b[2]-a[2],length=dx*dx+dz*dz;const t=length?Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[2])*dz)/length)):0;return Math.hypot(x-a[0]-dx*t,z-a[2]-dz*t)}
 const edges=new Map();for(const triangle of bottom)for(let i=0;i<3;i++){const edge=[triangle[i],triangle[(i+1)%3]],key=edge.map(v=>[v[0].toFixed(5),v[2].toFixed(5)].join(',')).sort().join('|');const entry=edges.get(key);if(entry)entry.count++;else edges.set(key,{edge,count:1})}
 const boundary=[...edges.values()].filter(entry=>entry.count===1).map(entry=>entry.edge)
 const impactChecks=streams.map(stream=>{
  const [x,y,z]=stream.end,radius=.071,outside=[]
  for(const fraction of [0,.25,.5,.75,1])for(let i=0;i<128;i++){const angle=i/128*Math.PI*2,px=x+Math.cos(angle)*radius*fraction,pz=z+Math.sin(angle)*radius*fraction;if(!bottom.some(triangle=>inside(px,pz,triangle)))outside.push([px,pz])}
  const hitsLeaves=leaves.some(triangle=>inside(x,z,triangle)||triangle.some((a,i)=>segmentDistance(x,z,a,triangle[(i+1)%3])<=radius))
  const waterClearance=Math.min(...boundary.map(([a,b])=>segmentDistance(x,z,a,b)))
  return {center:[x,y,z],maxRadius:radius,outsideSamples:outside.length,waterClearance,hitsLeaves}
 })
 const rings=fountain.getObjectByName('fountain-impact-ripples').children.map(o=>({position:o.position.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,o.parent.matrixWorld)).toArray(),outerRadius:o.geometry.parameters.outerRadius,scale:o.scale.x}))
 const worldBox=new THREE.Box3().setFromObject(fountain),corners=[]
 for(const x of [worldBox.min.x,worldBox.max.x])for(const y of [worldBox.min.y,worldBox.max.y])for(const z of [worldBox.min.z,worldBox.max.z])corners.push(new THREE.Vector3(x,y,z).project(camera).toArray())
 return {bounds:{min:box.min.toArray(),max:box.max.toArray()},materials,streams,rings,water:{lowerY,upperY,bottomTriangles:bottom.length},impactChecks,projected:corners}
})()`
try{
 await page.call('Page.enable')
 await page.call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false})
 await page.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]})
 await page.call('Page.navigate',{url:`${base}/scripts/fixtures/town-center.html`});await ready()
 const geometry=await inScene(geometryProbe);report.geometry=geometry;await writeFile(`${dir}/geometry.json`,JSON.stringify(geometry,null,2))
 assert.deepEqual(geometry.materials.map(o=>o.mesh).sort(),['fountain','fountain_leaves','fountain_water'])
 assert.equal(new Set(geometry.materials.map(o=>o.uuid)).size,3,'Stone, water and leaves have separate materials')
 const stone=geometry.materials.find(o=>o.mesh==='fountain'),water=geometry.materials.find(o=>o.mesh==='fountain_water'),leaves=geometry.materials.find(o=>o.mesh==='fountain_leaves')
 assert.ok(stone.hasAtlas&&leaves.hasAtlas&&stone.textureWidth===1024&&leaves.textureWidth===1024,'Original gradient atlas remains on stone and leaves')
 assert.ok(!water.hasAtlas&&water.roughness<.3&&water.clearcoat>0,'Water has its own reflective material')
 assert.ok(stone.roughness<leaves.roughness&&water.roughness<stone.roughness,'The three surfaces respond differently to light')
 for(const axis of [0,2])assert.ok(geometry.bounds.min[axis]>=-.9901&&geometry.bounds.max[axis]<=.9901,'Full fountain stays inside the existing plot')
 assert.equal(geometry.streams.length,4);assert.equal(geometry.rings.length,8)
 for(const check of geometry.impactChecks){assert.equal(check.outsideSamples,0,'The full .071 impact disk stays inside the real lower basin');assert.ok(check.waterClearance>=.071-.00001,'Exact basin boundary keeps the full ripple disk inside');assert.equal(check.hitsLeaves,false,'Water impact and expanding rings avoid original lilies');assert.ok(Math.abs(check.center[1]-geometry.water.lowerY)<.02,'Streams end at the actual lower water surface')}
 for(const ring of geometry.rings){assert.ok(ring.outerRadius<=.0711,'Ripple geometry fits the tested disk');assert.ok(geometry.streams.some(stream=>Math.hypot(stream.end[0]-ring.position[0],stream.end[2]-ring.position[2])<.0001),'Ripple center matches an actual stream impact')}
 const movingBefore=await snapshot(),motionSamples=[];for(let i=0;i<28;i++){await delay(110);motionSamples.push(await snapshot())}const movingAfter=motionSamples.at(-1);for(const sample of motionSamples)assert.ok(sample.rings.every(r=>r[0]<=1&&r[1]<=1&&r[2]<=1),'Animated ripple never exceeds its tested radius');assert.equal(movingBefore.bumpOffset.length,2,'Water bump texture is present');assert.notDeepEqual(movingBefore.bumpOffset,movingAfter.bumpOffset,'Water surface highlights move');assert.notDeepEqual(movingBefore.drops,movingAfter.drops,'Water droplets visibly travel');assert.notDeepEqual(movingBefore.rings,movingAfter.rings,'Impact rings expand and fade');report.motion={animated:true}
 await page.evaluate('window.townPreview.showFountain()');await delay(3800)
 assert.equal(await page.evaluate(`document.querySelector('.world3d-shell').dataset.cameraFraming`),'facility')
 await screenshot('01-fountain-desktop-close')
 for(const viewport of [{width:1440,height:900,mobile:false},{width:390,height:844,mobile:true}]){
  await page.call('Emulation.setDeviceMetricsOverride',{...viewport,deviceScaleFactor:1});await delay(1800)
  const framed=await inScene(geometryProbe)
  assert.ok(framed.projected.every(p=>Math.abs(p[0])<1&&Math.abs(p[1])<1&&p[2]>-1&&p[2]<1),'Whole fountain is visible in close-up')
  assert.equal(await page.evaluate('document.documentElement.scrollWidth>innerWidth'),false,'Viewport has no horizontal overflow')
  if(viewport.mobile)await screenshot('02-fountain-mobile-close')
 }
 await page.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
 await page.call('Page.navigate',{url:`${base}/scripts/fixtures/town-center.html?quality=low`});await ready()
 assert.equal(await page.evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`),true)
 // Force frames even in demand mode to test the fountain callback's own guard.
 await inScene(`state.setFrameloop('always')`)
 const stillBefore=await snapshot();await delay(700);const stillAfter=await snapshot();assert.deepEqual(stillAfter,stillBefore,'Reduced motion freezes drops and ripples even when frames render')
 await inScene(`state.setFrameloop('demand')`);report.motion.reducedMotionFrozen=true
 await page.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]})
 await page.call('Emulation.setDeviceMetricsOverride',{width:1200,height:850,deviceScaleFactor:1,mobile:false})
 await page.call('Page.navigate',{url:`${base}/scripts/fixtures/neighborhood-stage.html`})
 await wait(`window.neighborhoodStageControls && window.neighborhoodStageQa.ready === 1`)
 const stageBefore=await snapshot();await delay(650);const stageAfter=await snapshot()
 assert.notDeepEqual(stageAfter.drops,stageBefore.drops,'Default fountain story stage keeps its water flowing after ready')
 assert.notDeepEqual(stageAfter.bumpOffset,stageBefore.bumpOffset,'Default story stage water surface keeps moving after ready')
 report.stage={defaultMotion:true}
 await page.evaluate(`window.neighborhoodStageControls.run({mode:'fountain',family:'chibi',reduced:true})`)
 await wait(`window.neighborhoodStageQa.ready === 1 && window.neighborhoodStageQa.config.reduced`)
 for(let n=0;n<100;n++){if(await inScene(`Boolean(fountain?.getObjectByName('fountain_water'))`))break;await delay(50)}
 const stageStillBefore=await snapshot();await delay(650);assert.deepEqual(await snapshot(),stageStillBefore,'Story stage reduced motion freezes all fountain animation')
 report.stage.reducedMotionFrozen=true
 assert.deepEqual(page.errors,[]);assert.deepEqual(page.consoleErrors,[])
 await writeFile(`${dir}/report.json`,JSON.stringify(report,null,2))
 console.log(`Fountain browser passed: original CC0 assets, separate materials, existing plot bounds, real basin/lily-safe impacts, animation/reduced motion, desktop/mobile close-ups. Screenshots: ${dir}`)
}finally{await page.close()}
