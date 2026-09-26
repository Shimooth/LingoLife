import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {AnimationMixer,Group,MeshStandardMaterial,Quaternion,Vector3} from 'three'
import {retargetLifeMotion} from '../src/three/characters/lifeRetarget.ts'
import {solveHandContact} from '../src/three/characters/handContact.ts'
import {solveSeatedContact} from '../src/three/characters/seatedContact.ts'
import {assertSeatedContact,contactModel} from './assert-seated-contact.mjs'
import {DRINK_CUP_RIM,drinkHandOffset} from '../src/three/characters/sharedDrinkContact.ts'
import {drinkLeanLimit} from '../src/three/characters/sharedDrinkChoreography.ts'
import {CAFE_DRINK_RIG} from '../src/three/world/streetscapeLayout.ts'

// Asset-space numerical checks, not browser/WebGL automation. Textures are immaterial
// to bone contact, so suppress only material loading; load the actual shipped skeletons.
const loader=new GLTFLoader().register(parser=>({name:'contact_test_material',loadMaterial:index=>Promise.resolve(new MeshStandardMaterial({name:parser.json.materials[index].name}))}))
const library=JSON.parse(readFileSync(new URL('../public/assets/life/motions/kaykit-life.json',import.meta.url)))
for(const [family,path,scale] of [['city','city/Character_1_2_2.glb',.56*1.92],['chibi','chibi/all-in-one.glb',.76*1.08]]){
 const bytes=readFileSync(new URL(`../public/assets/models/characters/${path}`,import.meta.url))
 const {scene:source}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')
 const model=contactModel(source,family)
 const root=new Group();root.scale.setScalar(scale);root.rotation.y=family==='city'?Math.PI:0;root.add(model);root.updateMatrixWorld(true)
 const mixer=new AnimationMixer(model);mixer.clipAction(retargetLifeMotion(library,model,family,'Sit_Chair_Idle')).play();mixer.setTime(1)
 const torso=model.getObjectByName(family==='city'?'Torso':'DEF-spine001')
 root.updateMatrixWorld(true)
 const authoredSeat=CAFE_DRINK_RIG.seats[0]
 const seat=solveSeatedContact(model,family,{seatHeight:authoredSeat.seatTopY-authoredSeat.position[1],floorY:0,weight:1})
 const seated=assertSeatedContact(model,family,seat,family)
 const boneLengths=new Map();model.traverse(object=>{if(object.isBone)boneLengths.set(object.name,object.position.length())})
 const world=torso.getWorldQuaternion(new Quaternion())
 torso.quaternion.copy(torso.parent.getWorldQuaternion(new Quaternion()).invert().multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),drinkLeanLimit(family))).multiply(world))
 root.updateMatrixWorld(true)
 // Recenter the production furniture on this forward-facing asset-space rig.
 const target=new Vector3(...CAFE_DRINK_RIG.cupRest[0]).sub(new Vector3(...authoredSeat.position)).applyAxisAngle(new Vector3(0,1,0),-authoredSeat.rotation)
 target.add(drinkHandOffset(0)).add(new Vector3(0,DRINK_CUP_RIM.height+.0015,0))
 const hand=model.getObjectByName(family==='city'?'HandR':'DEF-handR')
 solveHandContact(model,family,target,1,30)
 const error=hand.getWorldPosition(new Vector3()).distanceTo(target)
 assert.ok(error<.012,`${family} palm must meet the cup handle, measured ${error.toFixed(4)}m`)
 model.traverse(object=>{if(object.isBone)assert.ok(Math.abs(object.position.length()-boneLengths.get(object.name))<1e-8,'Contact must not stretch bones')})
 assert.ok(retargetLifeMotion(library,model,family,'Seated_Interact').tracks.length>0)
 console.log('Drink supported seat:',JSON.stringify({family,...seated}))
 mixer.stopAllAction();mixer.uncacheRoot(model)
}
console.log('Drink rig contact checks passed (both shipped rigs, visible seat support, horizontal thighs, bent knees, nonpenetrating shoes, cup handle within 12mm, unchanged bone lengths).')
