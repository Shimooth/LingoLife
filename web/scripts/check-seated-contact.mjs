import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
import {AnimationMixer,Group,MeshStandardMaterial,Vector3} from 'three'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {retargetLifeMotion} from '../src/three/characters/lifeRetarget.ts'
import {prepareChibi,prepareCity} from '../src/three/characters/characterModel.ts'
import {solveSeatedContact} from '../src/three/characters/seatedContact.ts'
import {CAFE_DRINK_RIG} from '../src/three/world/streetscapeLayout.ts'

const defaults=JSON.parse(readFileSync(new URL('../../config/shared-home-layout.json',import.meta.url))).rooms.find(room=>room.kind==='living_room').placements
const source=readFileSync(new URL('../src/three/interiors/sharedDrinkLayout.ts',import.meta.url),'utf8').replace("import {sharedHomeDefaultPlacements} from './sharedHomeLayout'",`const sharedHomeDefaultPlacements=()=>${JSON.stringify(defaults)}`)
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {resolveSharedDrinkLayout}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const loader=new GLTFLoader().register(parser=>({name:'seated_material',loadMaterial:index=>{const m=new MeshStandardMaterial();m.name=parser.json.materials[index].name??'';return Promise.resolve(m)}}))
const library=JSON.parse(readFileSync(new URL('../public/assets/life/motions/kaykit-life.json',import.meta.url)))
const results=[]
const fixtures=[['city-01','city','city/Character_1_2_2.glb',.56*1.92],['city-03','city','city/Character_3_2_3.glb',.56*1.92],['chibi-student','chibi','chibi/all-in-one.glb',.76*1.08,'student'],['chibi-traveller','chibi','chibi/all-in-one.glb',.76*1.08,'traveller']]
for(const [location,layout]of [['cafe',CAFE_DRINK_RIG],['home',resolveSharedDrinkLayout()]])for(const [fixture,family,path,scale,outfit]of fixtures)for(const [index,seat]of layout.seats.entries()){
 const bytes=readFileSync(new URL(`../public/assets/models/characters/${path}`,import.meta.url)),{scene}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')
 const model=family==='city'?prepareCity(scene,'#695b51'):prepareChibi(scene,{hair:'hair-one',hairColor:'#695b51',outfit,outfitColor:'#84a895',accessory:'none',skin:'#e1b48e'})
 const actor=new Group(),root=new Group();actor.position.set(...seat.position);actor.rotation.y=seat.rotation;root.scale.setScalar(scale);root.rotation.y=family==='city'?Math.PI:0;root.add(model);actor.add(root)
 const mixer=new AnimationMixer(model),clip=retargetLifeMotion(library,model,family,'Sit_Chair_Idle');mixer.clipAction(clip).play();mixer.setTime(1);actor.updateMatrixWorld(true)
 const raw=new Map();model.traverse(bone=>{if(bone.isBone)raw.set(bone,{p:bone.position.clone(),q:bone.quaternion.clone(),s:bone.scale.clone()})})
 const hip=model.getObjectByName(family==='city'?'Hips':'DEF-spine'),uppers=['L','R'].map(side=>model.getObjectByName(family==='city'?`UpperLeg${side}`:`DEF-thigh${side}`))
 const restore=time=>{for(const [bone,saved]of raw){bone.position.copy(saved.p);bone.quaternion.copy(saved.q);bone.scale.copy(saved.s)}mixer.setTime(time);actor.updateMatrixWorld(true)}
 let maxSupport=0,maxThigh=0,minKnee=Infinity,maxKnee=0,minSole=Infinity,maxDangling=0,maxWeightStep=0,previousHip
 const solverTimings=[]
 for(let frame=0;frame<48;frame++){
  restore(frame*clip.duration/48)
  const authored=new Map();model.traverse(bone=>{if(bone.isBone)authored.set(bone,{p:bone.position.clone(),q:bone.quaternion.clone(),s:bone.scale.clone()})})
  const started=performance.now(),result=solveSeatedContact(model,family,{seatHeight:seat.seatTopY,floorY:0,weight:1});solverTimings.push(performance.now()-started)
  assert.equal(result.supportSource,'skin',`${fixture}: shipped residents must sit on measured skin, not fallback offsets`)
  assert.ok(Math.abs(result.supportError)<.005,`${fixture}: visible posterior skin must contact the seat`)
  maxSupport=Math.max(maxSupport,Math.abs(result.supportError))
  // Independently inspect the entire main body over the cafe's real .43m-square
  // cushion. Do not trust the solver's own selected posterior/support vertices:
  // a previous version omitted the forward butt/thigh seam and hid a 34mm sink.
  if(family==='chibi'&&location==='cafe'){
   const body=model.getObjectByName('character_low');body.skeleton.update()
   let contact=Infinity
   for(let vertex=0;vertex<body.geometry.attributes.position.count;vertex++){
    const world=body.getVertexPosition(vertex,new Vector3()).applyMatrix4(body.matrixWorld),local=actor.worldToLocal(world.clone())
    if(Math.abs(local.x)<.215&&Math.abs(local.z)<.215&&world.y>seat.seatTopY-.15)contact=Math.min(contact,world.y-seat.seatTopY)
   }
   assert.ok(contact>=-.008,`${fixture}: actual body over the physical cushion must not sink, independent of cached support mask: ${contact}m`)
  }
  for(const upper of uppers)assert.ok(upper.quaternion.equals(authored.get(upper).q),`${fixture}: floor contact must never turn a seated thigh into a standing thigh`)
  for(const [bone,saved]of authored){if(bone!==hip)assert.ok(bone.position.distanceTo(saved.p)<1e-9,'only the pelvis may translate');assert.ok(bone.scale.distanceTo(saved.s)<1e-9,'no skin or bone rescaling')}
  for(const leg of result.legs){
   assert.ok(Math.abs(leg.thighElevation)<20*Math.PI/180,`${fixture}: seated thigh stays close to horizontal`)
   assert.ok(leg.kneeAngle>65*Math.PI/180&&leg.kneeAngle<140*Math.PI/180,`${fixture}: knee must remain visibly bent`)
   assert.ok(leg.soleY>=-.008,`${fixture}: visible shoe cannot penetrate floor, ${leg.soleY}`)
   maxThigh=Math.max(maxThigh,Math.abs(leg.thighElevation));minKnee=Math.min(minKnee,leg.kneeAngle);maxKnee=Math.max(maxKnee,leg.kneeAngle);minSole=Math.min(minSole,leg.soleY);maxDangling=Math.max(maxDangling,leg.footClearance)
  }
 }
 // Seat weight is a continuous support correction, not a snap on a clip change.
 for(let step=0;step<=60;step++){
  restore(1);const weight=step/60,originalHip=hip.getWorldPosition(new Vector3())
  const result=solveSeatedContact(model,family,{seatHeight:seat.seatTopY,floorY:0,weight}),current=hip.getWorldPosition(new Vector3())
  if(!step)assert.ok(current.distanceTo(originalHip)<1e-10,'weight zero preserves raw animation exactly')
  if(previousHip)maxWeightStep=Math.max(maxWeightStep,current.distanceTo(previousHip))
  previousHip=current;assert.ok(Number.isFinite(result.supportY))
 }
 assert.ok(maxWeightStep<.01,'weighted support must not pop')
 // A low chair exercises actual shoe collision; dangling feet on normal chairs
 // do not prove the knee-only floor safeguard works.
 restore(1);const low=solveSeatedContact(model,family,{seatHeight:.2,floorY:0,weight:1})
 for(const leg of low.legs)assert.ok(leg.soleY>-.008,`${fixture}: low chair must lift a penetrating sole without rotating the thigh: ${leg.soleY}`)
 const round=value=>+(value).toFixed(2)
 const warmed=solverTimings.slice(1).sort((a,b)=>a-b)
 results.push({location,fixture,seat:index,supportMm:round(maxSupport*1000),thighDeg:round(maxThigh*180/Math.PI),kneeDeg:[round(minKnee*180/Math.PI),round(maxKnee*180/Math.PI)],soleMm:round(minSole*1000),maxDanglingMm:round(maxDangling*1000),weightStepMm:round(maxWeightStep*1000),coldSolveMs:round(solverTimings[0]),warmP95Ms:round(warmed[Math.floor(warmed.length*.95)])})
 mixer.stopAllAction();mixer.uncacheRoot(model)
}
console.log('Seated physical support:',JSON.stringify(results))
console.log('Seated contact passed: actual City-01/03 and selected Chibi student/traveller, both cafe/home seats, true butt/proximal-thigh support with independent visible-body/cushion clearance, intact seated thighs, bent knees, no shoe-floor penetration, no stretching and continuous seat weight.')
