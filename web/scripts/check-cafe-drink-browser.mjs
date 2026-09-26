import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {openQaPage,waitFor,delay} from './browser-cdp.mjs'

const base=process.env.QA_BASE_URL??'http://127.0.0.1:5173'
const cases=[
 ...['invited','forming','active','completed','declined','interrupted','missed'].map(phase=>({phase,family:'city',width:1280,height:900})),
 {phase:'active',family:'chibi',width:390,height:844},
 {phase:'completed',family:'city',width:390,height:844},
 {phase:'active',family:'city',width:390,height:844,reduced:true},
 {phase:'active',family:'city',width:1280,height:900,venue:'home'},
 {phase:'active',family:'chibi',width:390,height:844,venue:'home'},
]
for(const test of cases){
 const page=await openQaPage(),id=`${test.phase}-${test.family}-${test.width}${test.reduced?'-reduced':''}${test.venue?'-'+test.venue:''}`
 try{
  await page.call('Emulation.setDeviceMetricsOverride',{width:test.width,height:test.height,deviceScaleFactor:1,mobile:test.width<500})
  if(test.reduced)await page.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  await page.call('Page.navigate',{url:`${base}/scripts/fixtures/embodied-life.html?venue=${test.venue??'cafe'}&phase=${test.phase}&family=${test.family}&time=6.5&clean=1`})
  await waitFor(page,'document.querySelector("canvas")',30000)
  await page.evaluate(`import('/node_modules/.vite/deps/@react-three_fiber.js').then(module=>{window.cafeQaRoots=module._roots})`)
  await waitFor(page,`[...window.cafeQaRoots.values()].some(root=>root.store.getState().scene.getObjectByName('drink-resident:mira')?.getObjectByName('${test.family==='city'?'HandR':'DEF-handR'}'))`,30000)
  await delay(2400)
  const result=await page.evaluate(`(()=>{
   const state=[...window.cafeQaRoots.values()][0].store.getState(),scene=state.scene
   scene.updateMatrixWorld(true)
   const cups=[],actors=[],furniture=[],screenBounds=[],rimErrors=[]
   scene.traverse(object=>{
    if(object.name==='shared-drink-physical-cup'){
     cups.push(object.getWorldPosition(object.position.clone()).toArray())
     if(object.userData.beat==='sip'&&object.userData.mouthSurface){
      const geometry=object.children[0].geometry.parameters
      const skin=object.position.clone().fromArray(object.userData.mouthSurface)
      // The handle turns to meet each rig's reach. Sample the actual circular
      // rim rather than assuming the point nearest the mouth is local +Z.
      rimErrors.push(Math.min(...Array.from({length:64},(_,index)=>{
       const angle=index*Math.PI*2/64
       return object.localToWorld(object.position.clone().set(Math.cos(angle)*geometry.radiusTop,geometry.height/2,Math.sin(angle)*geometry.radiusTop)).distanceTo(skin)
      })))
     }
    }
    if(object.name.startsWith('drink-resident:')){
     actors.push(object.name)
     const origin=object.getWorldPosition(object.position.clone())
     const head=object.getObjectByName('Head')??object.getObjectByName('DEF-spine006')
     const headTop=head?head.getWorldPosition(object.position.clone()).y-origin.y+.28:1.65
     for(const height of [.04,headTop])for(const side of [-.22,.22]){
      const point=object.getWorldPosition(object.position.clone());point.x+=side;point.y+=height
      screenBounds.push(point.project(state.camera).toArray())
     }
    }
    if(object.name==='cafe-drink-furniture')furniture.push(object.name)
   })
   const canvas=document.querySelector('canvas').getBoundingClientRect()
   return {cups,actors,furniture,screenBounds,rimErrors,canvas:{width:canvas.width,height:canvas.height},overflow:document.documentElement.scrollWidth>innerWidth,text:document.body.innerText}
  })()`)
  assert.deepEqual(result.actors.sort(),['drink-resident:mira','drink-resident:noah'])
  assert.equal(result.furniture.length,test.venue==='home'?0:1,'only cafe stories use the cafe furniture rig')
  assert.equal(result.cups.length,2)
  assert.ok(result.cups.every(point=>point.every(Number.isFinite)&&point[1]>.05),'cups remain finite and above the floor')
  assert.ok(result.canvas.width>=300&&result.canvas.height>=200,'mobile must keep the acting area visible')
  assert.equal(result.overflow,false)
  assert.ok(result.screenBounds.every(([x,y])=>Math.abs(x)<1&&Math.abs(y)<1),`${id}: both residents stay in shot when approaching or leaving; ${JSON.stringify(result.screenBounds)}`)
  if(test.phase==='active'&&!test.reduced){
   assert.equal(result.rimErrors.length,2,'both actual mugs reach the sipping beat')
   assert.ok(result.rimErrors.every(error=>error<.02),`runtime cup rim stays near the face: ${JSON.stringify(result.rimErrors)}`)
  }
  assert.match(result.text,test.venue==='home'?/共享客厅/:/月光咖啡馆/)
  assert.deepEqual(page.errors,[])
  assert.deepEqual(page.consoleErrors,[])
  const shot=await page.call('Page.captureScreenshot',{format:'png'})
  await writeFile(`/tmp/lingolife-cafe-${id}.png`,Buffer.from(shot.data,'base64'))
  console.log(JSON.stringify({case:id,cups:result.cups,canvas:result.canvas}))
 }finally{await page.close()}
}
console.log('Cafe browser checks passed: seven actual presentation phases, both rigs, narrow screens and reduced motion. Fixture dialogue is not AI-quality evidence.')
