// Read-only asset diagnostic: no server, database, or runtime mutations.
import {readFileSync} from 'node:fs'
import ts from 'typescript'
import {AnimationMixer,Group,MeshStandardMaterial,Vector3} from 'three'
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'
import {retargetLifeMotion} from '../src/three/characters/lifeRetarget.ts'
import {groundSeatedFeet} from '../src/three/characters/handContact.ts'
import {CAFE_DRINK_RIG} from '../src/three/world/streetscapeLayout.ts'

const defaults=JSON.parse(readFileSync(new URL('../../config/shared-home-layout.json',import.meta.url))).rooms.find(room=>room.kind==='living_room').placements
const source=readFileSync(new URL('../src/three/interiors/sharedDrinkLayout.ts',import.meta.url),'utf8').replace("import {sharedHomeDefaultPlacements} from './sharedHomeLayout'",`const sharedHomeDefaultPlacements=()=>${JSON.stringify(defaults)}`)
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const {resolveSharedDrinkLayout}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const loader=new GLTFLoader().register(parser=>({name:'posture_material',loadMaterial:index=>{const m=new MeshStandardMaterial();m.name=parser.json.materials[index].name??'';return Promise.resolve(m)}}))
const library=JSON.parse(readFileSync(new URL('../public/assets/life/motions/kaykit-life.json',import.meta.url)))
const round=value=>Number.isFinite(value)?+value.toFixed(2):null
const rows=[]
for(const [location,layout]of [['cafe',CAFE_DRINK_RIG],['home',resolveSharedDrinkLayout()]])for(const [family,path,scale]of [['city','city/Character_1_2_2.glb',.56*1.92],['chibi','chibi/all-in-one.glb',.76*1.08]])for(const [index,seat]of layout.seats.entries()){
 const bytes=readFileSync(new URL(`../public/assets/models/characters/${path}`,import.meta.url)),{scene:model}=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')
 const actor=new Group(),root=new Group();actor.position.set(...seat.position);actor.rotation.y=seat.rotation;root.scale.setScalar(scale);root.rotation.y=family==='city'?Math.PI:0;root.add(model);actor.add(root)
 const mixer=new AnimationMixer(model),clip=retargetLifeMotion(library,model,family,'Sit_Chair_Idle');mixer.clipAction(clip).play();mixer.setTime(1);actor.updateMatrixWorld(true)
 const hip=model.getObjectByName(family==='city'?'Hips':'DEF-spine'),forward=new Vector3(Math.sin(seat.rotation),0,Math.cos(seat.rotation)),seatOrigin=new Vector3(...seat.position)
 const point=name=>model.getObjectByName(name).getWorldPosition(new Vector3())
 const raw=new Map();model.traverse(bone=>{if(bone.isBone)raw.set(bone,{p:bone.position.clone(),q:bone.quaternion.clone()})})
 const summarize=stage=>{
  actor.updateMatrixWorld(true)
  const hipPoint=hip.getWorldPosition(new Vector3())
  const legs=['L','R'].map(side=>{
   const thigh=point(family==='city'?`UpperLeg${side}`:`DEF-thigh${side}`),knee=point(family==='city'?`Leg${side}`:`DEF-shin${side}`),ankle=point(family==='city'?`Foot${side}`:`DEF-foot${side}`)
   const upper=knee.clone().sub(thigh),lower=ankle.clone().sub(knee)
   return {side,thighElevationDeg:round(Math.atan2(upper.y,Math.hypot(upper.x,upper.z))*180/Math.PI),kneeInteriorDeg:round(upper.clone().negate().angleTo(lower)*180/Math.PI),thighForwardMm:round(upper.dot(forward)*1000),thighDropMm:round(-upper.y*1000),ankleForwardMm:round(ankle.clone().sub(hipPoint).dot(forward)*1000),ankleYmm:round(ankle.y*1000),kneeYmm:round(knee.y*1000),upperLengthMm:round(upper.length()*1000),lowerLengthMm:round(lower.length()*1000)}
  })
  // Hip-dominant rear skin is a diagnostic support-surface approximation. It
  // deliberately does not assume that the skeleton's pelvis pivot is the butt.
  const pelvisSurfaces=[]
  model.traverse(mesh=>{
   if(!mesh.isSkinnedMesh||(family==='chibi'&&!['character_low','pants','skirt'].includes(mesh.name)))return
   const hipIndex=mesh.skeleton.bones.indexOf(hip);if(hipIndex<0)return
   mesh.skeleton.update();const indices=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight,points=[]
   for(let v=0;v<indices.count;v++){
    let weight=0;for(let c=0;c<4;c++)if(indices.getComponent(v,c)===hipIndex)weight+=weights.getComponent(v,c)
    if(weight<.35)continue
    const p=mesh.getVertexPosition(v,new Vector3()).applyMatrix4(mesh.matrixWorld),relative=p.clone().sub(hipPoint)
    if(relative.dot(forward)>.015||relative.y>.04||relative.y<-.22)continue
    points.push(p)
   }
   if(points.length)pelvisSurfaces.push({mesh:mesh.name,material:mesh.material.name,vertices:points.length,minSeatGapMm:round(Math.min(...points.map(p=>p.y-seat.seatTopY))*1000),maxSeatGapMm:round(Math.max(...points.map(p=>p.y-seat.seatTopY))*1000),rearMinForwardMm:round(Math.min(...points.map(p=>p.clone().sub(seatOrigin).dot(forward)))*1000),rearMaxForwardMm:round(Math.max(...points.map(p=>p.clone().sub(seatOrigin).dot(forward)))*1000)})
  })
  return {stage,hipYmm:round(hipPoint.y*1000),hipForwardMm:round(hipPoint.clone().sub(seatOrigin).dot(forward)*1000),legs,pelvisSurfaces}
 }
 for(const time of [0,clip.duration*.25,clip.duration*.5,clip.duration*.75]){
  for(const [bone,saved]of raw){bone.position.copy(saved.p);bone.quaternion.copy(saved.q)}mixer.setTime(time);actor.updateMatrixWorld(true)
  const stages=[summarize('raw-retarget')]
  const hipPoint=hip.getWorldPosition(new Vector3());hipPoint.y=seat.seatTopY+(family==='city'?.082:.07)*scale;hip.position.copy(hip.parent.worldToLocal(hipPoint));actor.updateMatrixWorld(true)
  stages.push(summarize('pelvis-pinned'))
  groundSeatedFeet(model,family,.11,1);stages.push(summarize('feet-grounded'))
  rows.push({location,family,seat:index,time:round(time),seatTopMm:seat.seatTopY*1000,stages})
 }
 mixer.stopAllAction();mixer.uncacheRoot(model)
}
if(process.argv.includes('--full'))console.log(JSON.stringify(rows,null,2))
else console.log(JSON.stringify(rows.filter(row=>row.time===0).map(row=>({...row,stages:row.stages.map(stage=>({stage:stage.stage,hipYmm:stage.hipYmm,thighElevationDeg:stage.legs.map(leg=>leg.thighElevationDeg),kneeInteriorDeg:stage.legs.map(leg=>leg.kneeInteriorDeg),ankleYmm:stage.legs.map(leg=>leg.ankleYmm),rearSkinSeatGapMm:Math.min(...stage.pelvisSurfaces.map(surface=>surface.minSeatGapMm))}))})),null,2))
