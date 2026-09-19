import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {AnimationMixer,Group,MeshStandardMaterial,Quaternion,Vector3} from 'three'
import {retargetLifeMotion} from '../src/three/characters/lifeRetarget.ts'
import {groundSeatedFeet,solveHandContact} from '../src/three/characters/handContact.ts'

// Asset-space numerical checks, not browser/WebGL automation. Textures are immaterial
// to bone contact, so suppress only material loading; load the actual shipped skeletons.
const loader=new GLTFLoader().register(()=>({name:'contact_test_material',loadMaterial:()=>Promise.resolve(new MeshStandardMaterial())}))
const library=JSON.parse(readFileSync(new URL('../public/assets/life/motions/kaykit-life.json',import.meta.url)))
for(const [family,path,scale] of [['city','city/Character_1_2_2.glb',.56*1.92],['chibi','chibi/all-in-one.glb',.76*1.08]]){
 const bytes=readFileSync(new URL(`../public/assets/models/characters/${path}`,import.meta.url))
 const {scene:model}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')
 const root=new Group();root.scale.setScalar(scale);root.rotation.y=family==='city'?Math.PI:0;root.add(model);root.updateMatrixWorld(true)
 const mixer=new AnimationMixer(model);mixer.clipAction(retargetLifeMotion(library,model,family,'Sit_Chair_Idle')).play();mixer.setTime(1)
 const hip=model.getObjectByName(family==='city'?'Hips':'DEF-spine'),torso=model.getObjectByName(family==='city'?'Torso':'DEF-spine001')
 root.updateMatrixWorld(true)
 const position=hip.getWorldPosition(new Vector3());position.y=.388+(family==='city'?.082:.07)*scale
 hip.position.copy(hip.parent.worldToLocal(position));root.updateMatrixWorld(true)
 const boneLengths=new Map();model.traverse(object=>{if(object.isBone)boneLengths.set(object.name,object.position.length())})
 groundSeatedFeet(model,family,.11,1)
 for(const side of ['L','R']){
  const foot=model.getObjectByName(family==='city'?`Foot${side}`:`DEF-foot${side}`)
  assert.ok(Math.abs(foot.getWorldPosition(new Vector3()).y-.11)<.04,`${family} ${side} ankle must contact the floor: ${foot.getWorldPosition(new Vector3()).toArray()}`)
 }
 const world=torso.getWorldQuaternion(new Quaternion())
 torso.quaternion.copy(torso.parent.getWorldQuaternion(new Quaternion()).invert().multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),.65)).multiply(world))
 root.updateMatrixWorld(true)
 const hand=model.getObjectByName(family==='city'?'HandR':'DEF-handR'),target=new Vector3(-.067,.654,.51)
 solveHandContact(model,family,target,1,30)
 const error=hand.getWorldPosition(new Vector3()).distanceTo(target)
 assert.ok(error<.012,`${family} palm must meet the cup handle, measured ${error.toFixed(4)}m`)
 model.traverse(object=>{if(object.isBone)assert.ok(Math.abs(object.position.length()-boneLengths.get(object.name))<1e-8,'Contact must not stretch bones')})
 assert.ok(retargetLifeMotion(library,model,family,'Seated_Interact').tracks.length>0)
 mixer.stopAllAction();mixer.uncacheRoot(model)
}
console.log('Drink rig contact checks passed (both shipped rigs, seated ankles, cup handle within 12mm, unchanged bone lengths).')
