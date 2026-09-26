import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {AnimationMixer,Group,MeshStandardMaterial,PropertyBinding,Quaternion,Vector3} from 'three'
import {isCafeDrinkStory} from '../src/three/characters/cafeDrinkScene.ts'
import {CAFE_DRINK_RIG} from '../src/three/world/streetscapeLayout.ts'
import {retargetLifeMotion} from '../src/three/characters/lifeRetarget.ts'
import {solveHandContact} from '../src/three/characters/handContact.ts'
import {solveSeatedContact} from '../src/three/characters/seatedContact.ts'
import {assertSeatedContact,contactModel} from './assert-seated-contact.mjs'
import {drinkLeanLimit} from '../src/three/characters/sharedDrinkChoreography.ts'
import {DRINK_CUP_RIM,drinkCupRimOffset,drinkHandOffset,drinkSipCupCenter,measureDrinkMouth} from '../src/three/characters/sharedDrinkContact.ts'
import {prepareChibi,disposeCharacterInstance} from '../src/three/characters/characterModel.ts'
import {CHIBI_HAIR} from '../src/three/characters/characterAssets.ts'

const stage={kind:'shared_drink',phase:'active',participant_ids:['a','b'],initiator_id:'a',beverage:'tea'}
const story={participant_ids:['a','b'],location_id:'moonlight_cafe',presentation:{staging:stage}}
for(const location_id of ['moonlight_cafe','garden_cafe'])for(const phase of ['invited','forming','active','completed','declined','interrupted','missed']){
 assert.equal(isCafeDrinkStory({...story,location_id,presentation:{staging:{...stage,phase}}}),true,'all factual cafe phases select the same physical furniture')
}
for(const bad of [
 {...story,location_id:'household-shared:living-room'},
 {...story,location_id:'office',title:'Coffee with a friend'},
 {...story,presentation:{}},
 {...story,location_id:undefined,presentation:{location:{id:'moonlight_cafe'},staging:stage}},
 {...story,presentation:{staging:{...stage,beverage:'wine'}}},
 {...story,presentation:{location:{id:'garden_cafe'},staging:stage}},
 {...story,participant_ids:['a','stranger']},
 {...story,participant_ids:['a','b','stranger']},
])assert.equal(isCafeDrinkStory(bad),false,'a title, missing stage or stale cast cannot create drinking')

// Load the shipped City and Chibi skeletons at their real encounter scale.
// Both opposite seats must reach the shared furniture's exact cup handles.
const loader=new GLTFLoader().register(parser=>({name:'cafe_contact_material',loadMaterial:index=>Promise.resolve(new MeshStandardMaterial({name:parser.json.materials[index].name}))}))
const library=JSON.parse(readFileSync(new URL('../public/assets/life/motions/kaykit-life.json',import.meta.url)))
const contacts=[]
for(const [family,path,scale] of [['city','city/Character_1_2_2.glb',.56*1.92],['chibi','chibi/all-in-one.glb',.76*1.08]])for(const [index,seat] of CAFE_DRINK_RIG.seats.entries()){
 const selectedPath=family==='city'&&index?'city/Character_3_2_3.glb':path
 const bytes=readFileSync(new URL(`../public/assets/models/characters/${selectedPath}`,import.meta.url))
 const {scene:source}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')
 const model=contactModel(source,family,index)
 const actor=new Group(),root=new Group();actor.position.set(...seat.position);actor.rotation.y=seat.rotation
 root.scale.setScalar(scale);root.rotation.y=family==='city'?Math.PI:0;root.add(model);actor.add(root);actor.updateMatrixWorld(true)
 const mixer=new AnimationMixer(model);mixer.clipAction(retargetLifeMotion(library,model,family,'Sit_Chair_Idle')).play();mixer.setTime(1)
 const torso=model.getObjectByName(family==='city'?'Torso':'DEF-spine001')
 actor.updateMatrixWorld(true)
 const baseBones=new Map();model.traverse(object=>{if(object.isBone)baseBones.set(object,{position:object.position.clone(),quaternion:object.quaternion.clone()})})
 const mouth=measureDrinkMouth(actor,family)
 assert.ok(mouth,`${family}: the shipped face must yield a real mouth-level skin surface`)
 const seated=assertSeatedContact(model,family,solveSeatedContact(model,family,{seatHeight:seat.seatTopY,floorY:0,weight:1}),`${family}/${index}`)
 const lengths=new Map();model.traverse(object=>{if(object.isBone)lengths.set(object.name,object.position.length())})
 const axis=new Vector3(family==='city'?-1:1,0,0).applyQuaternion(model.getWorldQuaternion(new Quaternion()))
 const world=torso.getWorldQuaternion(new Quaternion())
 torso.quaternion.copy(torso.parent.getWorldQuaternion(new Quaternion()).invert().multiply(new Quaternion().setFromAxisAngle(axis,drinkLeanLimit(family))).multiply(world))
 actor.updateMatrixWorld(true)
 const offset=drinkHandOffset(seat.rotation)
 const target=new Vector3(...CAFE_DRINK_RIG.cupRest[index]).add(offset).add(new Vector3(0,DRINK_CUP_RIM.height+.0015,0))
 solveHandContact(model,family,target,1,30)
 const hand=model.getObjectByName(family==='city'?'HandR':'DEF-handR'),error=hand.getWorldPosition(new Vector3()).distanceTo(target)
 assert.ok(error<.012,`${family} seat ${index}: cup grip error ${error.toFixed(4)}m`)
 model.traverse(object=>{if(object.isBone){assert.ok(Math.abs(object.position.length()-lengths.get(object.name))<1e-8,'contact may not stretch bones');assert.ok([...object.position.toArray(),...object.quaternion.toArray()].every(Number.isFinite),'the actual posed skeleton must remain finite')}})
 const lipErrors=[]
 for(const tilt of [0,-.06,-.12]){
  for(const [bone,base] of baseBones){bone.position.copy(base.position);bone.quaternion.copy(base.quaternion)}
  actor.updateMatrixWorld(true)
  assertSeatedContact(model,family,solveSeatedContact(model,family,{seatHeight:seat.seatTopY,floorY:0,weight:1}),`${family}/${index}/sip`)
  const target=drinkSipCupCenter(mouth,offset,tilt).add(offset)
  solveHandContact(model,family,target,1,30)
  const cup=hand.getWorldPosition(new Vector3()).sub(offset)
  const forward=mouth.forward.clone().applyQuaternion(mouth.head.getWorldQuaternion(new Quaternion()))
  const rim=drinkCupRimOffset(offset,tilt,forward).add(cup)
  const skin=mouth.head.localToWorld(mouth.point.clone()),lipError=rim.distanceTo(skin)
  assert.ok(lipError<.012,`${family} seat ${index}: physical rim must meet actual face, error=${lipError.toFixed(4)}m target=${target.toArray()} hand=${hand.getWorldPosition(new Vector3()).toArray()} skin=${skin.toArray()}`)
  assert.ok(cup.clone().sub(skin).dot(forward)>DRINK_CUP_RIM.radius*.8,`${family}: the ceramic body stays in front of the skin, not inside the head`)
  model.traverse(object=>{if(object.isBone)assert.ok(Math.abs(object.position.length()-lengths.get(object.name))<1e-8,'sip may not stretch bones')})
  lipErrors.push(lipError*1000)
 }
 contacts.push({family,seat:index,handErrorMm:+(error*1000).toFixed(2),maxRimFaceErrorMm:+Math.max(...lipErrors).toFixed(2),...seated})
 assert.ok(Math.hypot(seat.position[0]+Math.sin(seat.rotation)*.24,seat.position[2]+Math.cos(seat.rotation)*.24)>.6,'standing approach stays outside tabletop')
 mixer.stopAllAction();mixer.uncacheRoot(model)
}
// GLTFLoader removes dots from binding names. Exercise real parsed nodes, not
// a fabricated scene with the raw glTF names, for every supported hair choice.
const hairBytes=readFileSync(new URL('../public/assets/models/characters/chibi/all-in-one.glb',import.meta.url))
const {scene:hairSource}=await loader.parseAsync(hairBytes.buffer.slice(hairBytes.byteOffset,hairBytes.byteOffset+hairBytes.byteLength),'')
assert.ok(hairSource.getObjectByName('hairvariant001'),'regression asset must have the sanitized alternate hair node')
const originalVisibility=new Map();hairSource.traverse(node=>originalVisibility.set(node,node.visible))
for(const hair of CHIBI_HAIR)for(const accessory of ['none','helmet']){
 const avatar=Object.freeze({hair:hair.id,hairColor:'#543522',outfit:'student',outfitColor:'#476879',accessory,skin:'#c98b6b'})
 const prepared=prepareChibi(hairSource,avatar)
 for(const option of CHIBI_HAIR){
  const node=prepared.getObjectByName(PropertyBinding.sanitizeNodeName(option.node))
  assert.ok(node,`shipped hair node ${option.node} must resolve`)
  assert.equal(node.visible,accessory!=='helmet'&&option.id===hair.id,`${hair.id}/${accessory}: only selected hairstyle may be visible`)
 }
 assert.equal(avatar.hair,hair.id,'rendering must not change saved avatar choices')
 disposeCharacterInstance(prepared)
}
for(const [node,visible] of originalVisibility)assert.equal(node.visible,visible,'shared original asset must remain unchanged')
console.log('Cafe drink actual rig contacts:',JSON.stringify(contacts))
console.log('Cafe drink checks passed: factual scene contract, both actual rigs/seats, handle and physical rim/face contact <12mm, no skull penetration, visible seat support, seated thighs/knees, safe shoes, finite unchanged bones and all sanitized Chibi hair choices.')
