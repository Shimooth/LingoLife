import {AnimationClip, AnimationMixer, Group, Object3D, Quaternion, QuaternionKeyframeTrack, SkinnedMesh, Vector3, VectorKeyframeTrack, PropertyBinding} from 'three'
import {clone} from 'three/examples/jsm/utils/SkeletonUtils.js'
import type {CharacterFamily} from './characterAssets'

export type LifeMotion='Idle_A'|'Sit_Chair_Down'|'Sit_Chair_Idle'|'Sit_Chair_StandUp'|'Waving'|'Interact'|'Use_Item'|'Chop'|'Chopping'|'Holding_A'|'Holding_B'|'Working_A'|'Eating'|'Reading'|'Seated_Interact'
export type LifeMotionLibrary={version:number;packs:{nodes:{name:string;children:number[];position:number[];quaternion:number[];scale:number[]}[];roots:number[];clips:ReturnType<typeof AnimationClip.toJSON>[]}[]}
const clean=PropertyBinding.sanitizeNodeName
const maps:Record<CharacterFamily,Record<string,string>>={
 city:{Hips:'hips',Torso:'chest',Head:'head','Arm.L':'upperarm.l','ForeArm.L':'lowerarm.l','Hand.L':'hand.l','Arm.R':'upperarm.r','ForeArm.R':'lowerarm.r','Hand.R':'hand.r','UpperLeg.L':'upperleg.l','Leg.L':'lowerleg.l','Foot.L':'foot.l','UpperLeg.R':'upperleg.r','Leg.R':'lowerleg.r','Foot.R':'foot.r'},
 chibi:{'DEF-spine':'hips','DEF-spine.001':'spine','DEF-spine.002':'chest','DEF-spine.003':'chest','DEF-spine.006':'head','DEF-upper_arm.L':'upperarm.l','DEF-forearm.L':'lowerarm.l','DEF-hand.L':'hand.l','DEF-upper_arm.R':'upperarm.r','DEF-forearm.R':'lowerarm.r','DEF-hand.R':'hand.r','DEF-thigh.L':'upperleg.l','DEF-shin.L':'lowerleg.l','DEF-foot.L':'foot.l','DEF-thigh.R':'upperleg.r','DEF-shin.R':'lowerleg.r','DEF-foot.R':'foot.r'},
}
const cache=new WeakMap<Group,Map<string,AnimationClip>>()

/** Rest-space rotation transfer: keep target bone lengths, never copy source scale.
 * Only vertical pelvis displacement is retained; all horizontal root motion is stripped. */
export function retargetLifeMotion(library:LifeMotionLibrary,target:Group,family:CharacterFamily,name:LifeMotion):AnimationClip{
 let entries=cache.get(target)
 if(!entries){entries=new Map();cache.set(target,entries)}
 const hit=entries.get(name);if(hit)return hit
 if(name==='Eating'||name==='Reading'||name==='Seated_Interact'){
  const seated=retargetLifeMotion(library,target,family,'Sit_Chair_Idle')
  const upper=retargetLifeMotion(library,target,family,name==='Eating'?'Use_Item':name==='Seated_Interact'?'Interact':'Holding_B')
  const arm=(track:{name:string})=>/Arm|arm|Hand|hand/.test(track.name)
  const result=new AnimationClip(`life:${name}`,-1,[...seated.tracks.filter(track=>!arm(track)),...upper.tracks.filter(arm)])
  entries.set(name,result);return result
 }
 const pack=library.packs.find(value=>value.clips.some(clip=>clip.name===name))
 if(!pack)throw new Error(`Missing life clip ${name}`)
 const source=new Group(),nodes=pack.nodes.map(node=>{
  const object=new Object3D();object.name=node.name
  object.position.fromArray(node.position);object.quaternion.fromArray(node.quaternion);object.scale.fromArray(node.scale)
  return object
 })
 pack.nodes.forEach((node,index)=>node.children.forEach(child=>nodes[index].add(nodes[child])))
 pack.roots.forEach(index=>source.add(nodes[index]));source.updateMatrixWorld(true)
 const targetRest=clone(target) as Group
 targetRest.traverse(object=>{if(object instanceof SkinnedMesh)object.skeleton.pose()})
 targetRest.updateMatrixWorld(true)
 const mapping=Object.fromEntries(Object.entries(maps[family]).map(([to,from])=>[clean(to),clean(from)]))
 const targetNodes:Object3D[]=[];targetRest.traverse(object=>targetNodes.push(object))
 const rests=new Map(targetNodes.map(object=>[object.name,{local:object.quaternion.clone(),world:object.getWorldQuaternion(new Quaternion()),position:object.position.clone()}]))
 const sourceRest=new Map(nodes.map(object=>[object.name,{world:object.getWorldQuaternion(new Quaternion()),position:object.getWorldPosition(new Vector3())}]))
 const clip=AnimationClip.parse(pack.clips.find(value=>value.name===name)!)
 const mixer=new AnimationMixer(source);const action=mixer.clipAction(clip);action.play()
 const align=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),family==='city'?Math.PI:0)
 // RG Poly's bind pose points sideways even though its authored idle faces forward.
 // Derive source→target bind heading from the shoulders; a hard-coded 180° delta
 // raises the arms and twists the knees on this rig.
 const right=targetRest.getObjectByName(clean(family==='city'?'Arm.R':'DEF-upper_arm.R'))!
 const left=targetRest.getObjectByName(clean(family==='city'?'Arm.L':'DEF-upper_arm.L'))!
 const targetAcross=right.getWorldPosition(new Vector3()).sub(left.getWorldPosition(new Vector3()))
 const sourceAcross=sourceRest.get(clean('upperarm.r'))!.position.clone().sub(sourceRest.get(clean('upperarm.l'))!.position)
 const bindHeading=Math.atan2(targetAcross.x,targetAcross.z)-Math.atan2(sourceAcross.x,sourceAcross.z)
 const unalign=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),-bindHeading)
 const pelvisName=family==='city'?'Hips':'DEF-spine',pelvis=targetRest.getObjectByName(pelvisName)!
 const sourceHips=source.getObjectByName('hips')!
 const heightRatio=Math.abs(pelvis.getWorldPosition(new Vector3()).y/sourceRest.get('hips')!.position.y)
 const values=new Map<string,number[]>(),times:number[]=[],hips:number[]=[]
 Object.keys(mapping).forEach(key=>{if(targetRest.getObjectByName(key))values.set(key,[])})
 const frames=Math.max(2,Math.ceil(clip.duration*24))
 for(let frame=0;frame<=frames;frame++){
  const time=Math.min(clip.duration-.00001,frame/frames*clip.duration);times.push(frame/frames*clip.duration)
  mixer.setTime(Math.max(0,time));source.updateMatrixWorld(true)
  for(const object of targetNodes){
   const rest=rests.get(object.name)!
   object.quaternion.copy(rest.local)
   const from=mapping[object.name],animated=from&&source.getObjectByName(from)
   if(animated){
    const delta=align.clone().multiply(animated.getWorldQuaternion(new Quaternion())).multiply(sourceRest.get(from)!.world.clone().invert()).multiply(unalign)
    const desired=delta.multiply(rest.world)
    const parent=object.parent?.getWorldQuaternion(new Quaternion())??new Quaternion()
    object.quaternion.copy(parent.invert().multiply(desired)).normalize()
    values.get(object.name)!.push(...object.quaternion.toArray())
   }
   object.updateMatrixWorld(true)
  }
  const rest=rests.get(pelvisName)!.position
  const displacement=(sourceHips.getWorldPosition(new Vector3()).y-sourceRest.get('hips')!.position.y)*heightRatio
  const worldDelta=new Vector3(0,displacement,0)
  if(pelvis.parent){const origin=new Vector3();pelvis.parent.worldToLocal(worldDelta);pelvis.parent.worldToLocal(origin);worldDelta.sub(origin)}
  hips.push(rest.x+worldDelta.x,rest.y+worldDelta.y,rest.z+worldDelta.z)
 }
 mixer.stopAllAction();mixer.uncacheRoot(source)
 const tracks=[...values].map(([node,rotations])=>new QuaternionKeyframeTrack(`${node}.quaternion`,times,rotations))
 const result=new AnimationClip(`life:${name}`,clip.duration,[...tracks,new VectorKeyframeTrack(`${pelvisName}.position`,times,hips)])
 entries.set(name,result)
 return result
}
