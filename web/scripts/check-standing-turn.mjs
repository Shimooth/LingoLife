import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {AnimationMixer,Group,MeshStandardMaterial,SkinnedMesh,Vector3} from 'three'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {retargetLifeMotion} from '../src/three/characters/lifeRetarget.ts'
import {prepareStandingTurn,solveStandingTurn} from '../src/three/characters/standingTurn.ts'
import {RigPoseContinuity} from '../src/three/characters/animationContinuity.ts'
import {clipsForModel} from '../src/three/characters/characterModel.ts'
import {contactModel} from './assert-seated-contact.mjs'

const loader=new GLTFLoader().register(()=>({name:'turn_test_material',loadMaterial:()=>Promise.resolve(new MeshStandardMaterial())}))
const library=JSON.parse(readFileSync(new URL('../public/assets/life/motions/kaykit-life.json',import.meta.url)))
const cityAnimationBytes=readFileSync(new URL('../public/assets/models/characters/city/animations/animations.glb',import.meta.url))
const cityAnimations=await loader.parseAsync(cityAnimationBytes.buffer.slice(cityAnimationBytes.byteOffset,cityAnimationBytes.byteOffset+cityAnimationBytes.byteLength),'')
const sources=[['city','city/Character_1_2_2.glb',.56*1.92,0],['city','city/Character_3_2_3.glb',.56*1.92,0],['chibi','chibi/all-in-one.glb',.76*1.08,0],['chibi','chibi/all-in-one.glb',.76*1.08,1]]
const visible=object=>{for(let node=object;node;node=node.parent)if(!node.visible)return false;return true}
const shoes=(model,foot)=>{
 const meshes=[]
 model.traverse(mesh=>{
  if(!(mesh instanceof SkinnedMesh)||!visible(mesh))return
  const indices=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight,members=new Set()
  mesh.skeleton.bones.forEach((bone,index)=>{for(let node=bone;node;node=node.parent)if(node===foot){members.add(index);break}})
  const vertices=[]
  for(let vertex=0;vertex<indices.count;vertex++){
   let weight=0;for(let k=0;k<4;k++)if(members.has(indices.getComponent(vertex,k)))weight+=weights.getComponent(vertex,k)
   if(weight>=.6)vertices.push(vertex)
  }
  if(vertices.length)meshes.push({mesh,vertices})
 })
 return ()=>{
  let y=Infinity;const point=new Vector3()
  for(const {mesh,vertices}of meshes){mesh.skeleton.update();for(const vertex of vertices){mesh.getVertexPosition(vertex,point).applyMatrix4(mesh.matrixWorld);y=Math.min(y,point.y)}}
  return y
 }
}
for(const [family,path,scale,outfit]of sources){
 const bytes=readFileSync(new URL(`../public/assets/models/characters/${path}`,import.meta.url))
 const source=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')
 const model=contactModel(source.scene,family,outfit),actor=new Group(),asset=new Group()
 actor.add(asset);asset.add(model);asset.scale.setScalar(scale);asset.rotation.y=family==='city'?Math.PI:0
 const mixer=new AnimationMixer(model),clip=retargetLifeMotion(library,model,family,'Idle_A')
 mixer.clipAction(clip).play();mixer.setTime(0);actor.updateMatrixWorld(true)
 const bones=[];model.traverse(bone=>{if(bone.isBone)bones.push({bone,p:bone.position.clone(),q:bone.quaternion.clone(),scale:bone.scale.clone()})})
 const feet=['L','R'].map(side=>{const node=model.getObjectByName(family==='city'?`Foot${side}`:`DEF-foot${side}`);return {side,node,sole:shoes(model,node)}})
 const reports=[]
 for(const angle of [-1.74,-1.26,1.26,1.74]){
  let previous,minimumSole=Infinity,maximumLift=0,maximumSupportDrift=0,maximumDrop=0
  for(let i=0;i<=120;i++){
   const p=i/120,ease=p*p*(3-2*p)
   for(const {bone,p,q}of bones){bone.position.copy(p);bone.quaternion.copy(q)}
   mixer.setTime(p*.4);actor.rotation.y=angle*ease;actor.updateMatrixWorld(true)
   const result=solveStandingTurn(model,family,{root:actor,key:String(angle),startYaw:0,endYaw:angle,progress:p})
   assert.ok(result,`${family}/${outfit}/${angle}/${p}: production turn must solve`)
   maximumDrop=Math.max(maximumDrop,result.pelvisDrop)
   const measured=feet.map(({side,node,sole})=>({side,p:node.getWorldPosition(new Vector3()),sole:sole()}))
   for(const value of result.feet){
    assert.ok(value.error<.001,`${family}/${angle}/${p}: ankle target error ${value.error}m`)
    const sample=measured.find(item=>item.side===value.side)
    minimumSole=Math.min(minimumSole,sample.sole);maximumLift=Math.max(maximumLift,sample.sole)
    if(previous&&value.planted&&previous.result.feet.find(item=>item.side===value.side).planted){
     const last=previous.measured.find(item=>item.side===value.side).p,drift=Math.hypot(sample.p.x-last.x,sample.p.z-last.z)
     maximumSupportDrift=Math.max(maximumSupportDrift,drift)
     assert.ok(drift<.001,`${family}/${angle}: support foot slid ${drift}m`)
    }
   }
   for(const {bone,p,scale}of bones){
    if(bone.name!==(family==='city'?'Hips':'DEF-spine'))assert.ok(bone.position.distanceTo(p)<1e-8,`${family}: turning cannot translate child bones`)
    assert.ok(bone.scale.distanceTo(scale)<1e-8,`${family}: turning cannot scale bones`)
   }
   previous={result,measured}
  }
  assert.ok(minimumSole>-.006,`${family}/${outfit}/${angle}: shoes penetrate floor: ${minimumSole}`)
  assert.ok(maximumLift>.028,`${family}/${outfit}/${angle}: a visible foot must actually lift: ${maximumLift}`)
  reports.push({minimumSole,maximumLift,maximumSupportDrift,maximumDrop})
 }
 // A clean idle test is not enough: production enters the turn from a sampled
 // walk or from its last standing-up frame, while the .22s pose bridge runs.
 for(const entrance of ['walk','stand'])for(const fps of [30,60])for(const initialProgress of [0,1/24,1/12,.5]){
  const angle=entrance==='walk'?-1.26:-1.74,walkClip=clipsForModel(family==='city'?cityAnimations.animations:source.animations,model).find(clip=>clip.name===(family==='city'?'Walk_B':'anim_walk'))
  assert.ok(walkClip,`${family}: real shipped walk source must be present`)
  for(const {bone,p,q}of bones){bone.position.copy(p);bone.quaternion.copy(q)}
  mixer.stopAllAction();actor.rotation.y=0
  const from=entrance==='walk'?walkClip:retargetLifeMotion(library,model,family,'Sit_Chair_StandUp')
  const fromAction=mixer.clipAction(from).reset().play()
  fromAction.time=entrance==='walk'?(Math.hypot(.24,.75)/(family==='city'?1.58:.66)*(family==='city'?1:.7916666865))%from.duration:from.duration-.0001
  mixer.update(0);actor.updateMatrixWorld(true)
  const continuity=new RigPoseContinuity(model);continuity.saveAnimation();continuity.finish(0);continuity.begin(.22)
  mixer.stopAllAction();continuity.restoreAnimation();mixer.clipAction(clip).reset().play()
  let previous,minimumSole=Infinity,landedMinimum=Infinity,initialMinimum=Infinity,maximumSupportDrift=0,maximumDrop=0,maximumFirstFrameShift=0,maximumAnkleRate=0
  for(let i=0;i<=Math.round(.4*fps);i++){
   const p=initialProgress+(1-initialProgress)*i/(.4*fps),ease=p*p*(3-2*p)
   actor.rotation.y=angle*ease
   continuity.restoreAnimation();mixer.setTime((entrance==='walk'?1.25:3.05)+p*.4);continuity.saveAnimation();actor.updateMatrixWorld(true)
   const pose={root:actor,key:`${entrance}-${fps}-${initialProgress}`,startYaw:0,endYaw:angle,progress:p}
   prepareStandingTurn(model,family,pose);continuity.finish(i?1/fps:0);actor.updateMatrixWorld(true)
   const before=feet.map(({node})=>node.getWorldPosition(new Vector3()))
   if(i===0)initialMinimum=Math.min(...feet.map(({sole})=>sole()))
   const result=solveStandingTurn(model,family,pose)
   assert.ok(result,`${family}/${entrance}/${fps}/${p}: visible source bridge must be solvable`)
   continuity.saveVisible();maximumDrop=Math.max(maximumDrop,result.pelvisDrop)
   const measured=feet.map(({side,node,sole})=>({side,p:node.getWorldPosition(new Vector3()),q:node.quaternion.clone().normalize(),sole:sole()}))
   if(previous)for(const foot of measured){
    const rate=foot.q.angleTo(previous.measured.find(value=>value.side===foot.side).q)*fps
    maximumAnkleRate=Math.max(maximumAnkleRate,rate)
    assert.ok(rate<24,`${family}/${entrance}/${fps}: a planted ankle must not whip as the source knee straightens, ${rate}rad/s`)
   }
   if(i===0)for(let foot=0;foot<feet.length;foot++){
    const distance=before[foot].distanceTo(measured[foot].p);maximumFirstFrameShift=Math.max(maximumFirstFrameShift,distance)
    assert.ok(distance<.001,'the first turn frame must not drag an airborne shoe to the floor')
   }
   for(const value of result.feet){
    assert.ok(value.error<.001,`${family}/${entrance}/${fps}: bridge ankle error ${value.error}`)
    const sample=measured.find(item=>item.side===value.side);minimumSole=Math.min(minimumSole,sample.sole);if((p-initialProgress)/(1-initialProgress)>=.2)landedMinimum=Math.min(landedMinimum,sample.sole)
    if(previous&&value.planted&&previous.result.feet.find(item=>item.side===value.side).planted){
     const last=previous.measured.find(item=>item.side===value.side).p,drift=Math.hypot(sample.p.x-last.x,sample.p.z-last.z)
     maximumSupportDrift=Math.max(maximumSupportDrift,drift)
     assert.ok(drift<.001,`${family}/${entrance}/${fps}: bridged support foot slid ${drift}m`)
    }
   }
   previous={result,measured}
  }
  assert.ok(minimumSole>=Math.min(-.006,initialMinimum-.002),`${family}/${entrance}/${fps}: solver worsened native shoe contact: ${minimumSole} vs initial ${initialMinimum}`)
  assert.ok(landedMinimum>-.006,`${family}/${entrance}/${fps}: landed shoes penetrate floor: ${landedMinimum}`)
  reports.push({initialMinimum,minimumSole,landedMinimum,maximumSupportDrift,maximumDrop,maximumFirstFrameShift,maximumAnkleRate})
 }
 console.log(JSON.stringify({family,path,outfit,cases:reports.length,
  initialNativeSole:Math.min(...reports.map(value=>value.initialMinimum??Infinity)),
  landedMinimum:Math.min(...reports.map(value=>value.landedMinimum??Infinity)),
  maximumFirstFrameShift:Math.max(...reports.map(value=>value.maximumFirstFrameShift??0)),
  maximumSupportDrift:Math.max(...reports.map(value=>value.maximumSupportDrift)),maximumDrop:Math.max(...reports.map(value=>value.maximumDrop)),
  maximumAnkleRate:Math.max(...reports.map(value=>value.maximumAnkleRate??0)),
 }))
 mixer.stopAllAction();mixer.uncacheRoot(model)
}
console.log('Standing turn passed: shipped City-01/03 + two Chibi outfits, both turning directions, selected visible shoes, stationary support foot, alternate lift, unchanged bone lengths.')
