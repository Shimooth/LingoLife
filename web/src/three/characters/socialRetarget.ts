import {AnimationClip,AnimationMixer,Group,LoopOnce,Matrix4,Object3D,PropertyBinding,Quaternion,QuaternionKeyframeTrack,SkinnedMesh,Vector3} from 'three'
import {clone} from 'three/examples/jsm/utils/SkeletonUtils.js'
import type {CharacterFamily} from './characterAssets'

export type SocialMotion='Idle_Talking_Loop'|'Sitting_Talking_Loop'
export type SocialMotionLibrary={version:number;nodes:{name:string;children:number[];position:number[];quaternion:number[];scale:number[]}[];roots:number[];clips:ReturnType<typeof AnimationClip.toJSON>[]}
export const SOCIAL_MOTION_URL='/assets/life/motions/quaternius-social.json'
const clean=PropertyBinding.sanitizeNodeName
const cache=new WeakMap<Group,WeakMap<SocialMotionLibrary,Map<string,AnimationClip>>>()

function required(root:Object3D,name:string){
 const node=root.getObjectByName(clean(name))
 if(!node)throw new Error(`Missing social-motion bone ${name}`)
 return node
}
function position(node:Object3D){return node.getWorldPosition(new Vector3())}
function world(node:Object3D){return node.getWorldQuaternion(new Quaternion()).normalize()}
/** A physical bone frame, not the author's arbitrary local Blender axes. */
function frame(direction:Vector3,forward:Vector3){
 const y=direction.clone().normalize(),z=forward.clone().addScaledVector(y,-forward.dot(y)).normalize()
 if(z.lengthSq()<.5)throw new Error('Ambiguous social-motion anatomical frame')
 const x=new Vector3().crossVectors(y,z).normalize()
 return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x,y,z)).normalize()
}

/** Upper-limb overlay only. The current idle/sitting pose retains its pelvis,
 * torso, head attention, legs and physical contacts. Transfer physical segment
 * directions in the torso's anatomical frame, so A/T-pose and bind-heading
 * differences do not lift the shoulders or turn the actor. Never transfer
 * translations, scales, root motion, fingers, or source bone lengths. */
export function retargetSocialMotion(library:SocialMotionLibrary,target:Group,family:CharacterFamily,name:SocialMotion):AnimationClip{
 let libraries=cache.get(target);if(!libraries){libraries=new WeakMap();cache.set(target,libraries)}
 let entries=libraries.get(library);if(!entries){entries=new Map();libraries.set(library,entries)}
 const key=`${family}:${name}`,hit=entries.get(key);if(hit)return hit
 const data=library.clips.find(clip=>clip.name===name)
 if(!data)throw new Error(`Missing social clip ${name}`)
 const source=new Group(),nodes=library.nodes.map(node=>{
  const object=new Object3D();object.name=node.name;object.position.fromArray(node.position);object.quaternion.fromArray(node.quaternion).normalize();object.scale.fromArray(node.scale);return object
 })
 library.nodes.forEach((node,index)=>node.children.forEach(child=>nodes[index].add(nodes[child])))
 library.roots.forEach(index=>source.add(nodes[index]));source.updateMatrixWorld(true)
 const rest=clone(target) as Group
 rest.traverse(node=>{if(node instanceof SkinnedMesh)node.skeleton.pose()});rest.updateMatrixWorld(true)
 const targetTorso=required(rest,family==='city'?'Torso':'DEF-spine.003'),sourceTorso=required(source,'spine_03')
 const armNames=(side:'L'|'R')=>family==='city'?[`Arm.${side}`,`ForeArm.${side}`,`Hand.${side}`]:[`DEF-upper_arm.${side}`,`DEF-forearm.${side}`,`DEF-hand.${side}`]
 const targetAcross=position(required(rest,armNames('R')[0])).sub(position(required(rest,armNames('L')[0]))).normalize()
 const sourceAcross=position(required(source,'upperarm_r')).sub(position(required(source,'upperarm_l'))).normalize()
 const targetForward=new Vector3().crossVectors(new Vector3(0,1,0),targetAcross).normalize()
 const sourceForward=new Vector3().crossVectors(new Vector3(0,1,0),sourceAcross).normalize()
 // Source and target chest frames remove animated trunk motion. It is already
 // supplied by the base clip, breathing/attention, and actual furniture lean.
 const heading=new Quaternion().setFromUnitVectors(sourceAcross,targetAcross)
 const sourceChestRest=world(sourceTorso),targetChestRest=world(targetTorso)
 const corrections=new Map<string,{source:Object3D;offset:Quaternion}>()
 for(const side of ['L','R'] as const){
  const names=armNames(side),from=['upperarm','lowerarm','hand'].map(bone=>required(source,`${bone}_${side.toLowerCase()}`)),to=names.map(bone=>required(rest,bone))
  for(let index=0;index<3;index++){
   const sourceDirection=index<2?position(from[index+1]).sub(position(from[index])):position(from[2]).sub(position(from[1]))
   const targetDirection=index<2?position(to[index+1]).sub(position(to[index])):position(to[2]).sub(position(to[1]))
   const sourceLocal=world(from[index]).invert().multiply(frame(sourceDirection,sourceForward))
   const targetLocal=world(to[index]).invert().multiply(frame(targetDirection,targetForward))
   corrections.set(to[index].name,{source:from[index],offset:sourceLocal.multiply(targetLocal.invert())})
  }
 }
 const base=new Map<Object3D,Quaternion>();rest.traverse(node=>base.set(node,node.quaternion.clone()))
 const ordered:Object3D[]=[];rest.traverse(node=>{if(corrections.has(node.name))ordered.push(node)})
 const clip=AnimationClip.parse(data),mixer=new AnimationMixer(source),action=mixer.clipAction(clip)
 action.setLoop(LoopOnce,1);action.clampWhenFinished=true;action.play()
 const frames=Math.max(2,Math.ceil(clip.duration*30)),times:number[]=[],values=new Map(ordered.map(node=>[node.name,[] as number[]]))
 for(let index=0;index<=frames;index++){
  const time=index/frames*clip.duration;times.push(time);mixer.setTime(time);source.updateMatrixWorld(true)
  for(const [node,q]of base)node.quaternion.copy(q)
  rest.updateMatrixWorld(true)
  const chestDelta=sourceChestRest.clone().multiply(world(sourceTorso).invert())
  // Keep all calculations in the target bind hierarchy. At playback the same
  // local rotations inherit the current base chest/pelvis, including seat IK.
  for(const node of ordered){
   const mapping=corrections.get(node.name)!
   const desired=heading.clone().multiply(chestDelta).multiply(world(mapping.source)).multiply(mapping.offset)
   // heading aligns the anatomical axes; both bind chests can be tilted.
   // Their rest tilt remains authored by the base pose, not duplicated here.
   const parent=node.parent?world(node.parent):targetChestRest
   node.quaternion.copy(parent.invert().multiply(desired)).normalize();node.updateWorldMatrix(false,true)
   const rotations=values.get(node.name)!,previous=rotations.length?new Quaternion().fromArray(rotations,rotations.length-4):undefined
   if(previous&&previous.dot(node.quaternion)<0)node.quaternion.set(-node.quaternion.x,-node.quaternion.y,-node.quaternion.z,-node.quaternion.w)
   rotations.push(...node.quaternion.toArray())
  }
 }
 mixer.stopAllAction();mixer.uncacheRoot(source)
 // SkeletonUtils clones own their skeletons but share geometry/materials with
 // the live model. Release only temporary skeleton resources, never the latter.
 const skeletons=new Set<SkinnedMesh['skeleton']>()
 rest.traverse(node=>{if(node instanceof SkinnedMesh)skeletons.add(node.skeleton)})
 skeletons.forEach(skeleton=>skeleton.dispose())
 const result=new AnimationClip(`social:${name}`,clip.duration,[...values].map(([bone,rotations])=>new QuaternionKeyframeTrack(`${bone}.quaternion`,times,rotations)))
 entries.set(key,result);return result
}
