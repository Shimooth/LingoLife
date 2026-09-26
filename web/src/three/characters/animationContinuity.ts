import {Bone,Quaternion,Vector3,type Object3D} from 'three'

type BonePose={node:Bone;position:Vector3;quaternion:Quaternion}
const capture=(nodes:Bone[]):BonePose[]=>nodes.map(node=>({node,position:node.position.clone(),quaternion:node.quaternion.clone()}))
const restore=(pose:BonePose[])=>{for(const value of pose){value.node.position.copy(value.position);value.node.quaternion.copy(value.quaternion)}}
const copyInto=(pose:BonePose[])=>{for(const value of pose){value.position.copy(value.node.position);value.quaternion.copy(value.node.quaternion)}}

/** Explicit authored times are continuous seconds, not a clamped clip fraction. */
export function sampleAnimationTime(time:number,duration:number,once=false):number{
 const value=Number.isFinite(time)?Math.max(0,time):0
 if(!Number.isFinite(duration)||duration<=0)return 0
 return once?Math.min(value,Math.max(0,duration-.00001)):value%duration
}

/** Exponential speed smoothing with its exact integral, so 15/30/60fps advance
 * the same amount of gait phase instead of integrating the end-of-frame speed. */
export function advanceAnimationSpeed(current:number,target:number,delta:number):{speed:number;average:number}{
 const step=Math.max(0,Math.min(delta,.1)),safeTarget=Number.isFinite(target)?Math.max(0,target):1
 const decay=Math.exp(-step*10),speed=safeTarget+(current-safeTarget)*decay
 return {speed,average:step?safeTarget+(current-safeTarget)*(1-decay)/(10*step):speed}
}

/** One writer at a time owns the mixer. This small pose bridge survives swapping
 * native/life players and never fades toward an unanimated bind pose. */
export class RigPoseContinuity{
 private nodes:Bone[]=[]
 private raw:BonePose[]
 private visible:BonePose[]
 private from:BonePose[]|undefined
 private elapsed=0
 private duration=0
 private presented=false
 constructor(model:Object3D){
  model.traverse(node=>{if(node instanceof Bone)this.nodes.push(node)})
  this.raw=capture(this.nodes);this.visible=capture(this.nodes)
 }
 begin(duration=.22){
  this.from=this.presented?this.visible.map(value=>({...value,position:value.position.clone(),quaternion:value.quaternion.clone()})):undefined
  this.elapsed=0;this.duration=Math.max(0,duration)
 }
 /** Constant mixer tracks may skip a write. Undo all last-frame IK/attention/
  * blending first so those corrections cannot accumulate on any bone. */
 restoreAnimation(){restore(this.raw)}
 saveAnimation(){copyInto(this.raw)}
 finish(delta:number,immediate=false){
  if(this.from){
   this.elapsed+=Math.max(0,Math.min(delta,.1))
   const t=immediate||!this.duration?1:Math.min(1,this.elapsed/this.duration),weight=t*t*(3-2*t)
   for(const value of this.from){
    value.node.position.lerp(value.position,1-weight)
    value.node.quaternion.slerp(value.quaternion,1-weight).normalize()
   }
   if(t===1)this.from=undefined
  }
  copyInto(this.visible);this.presented=true
 }
 /** A final world-space foot constraint can run after the crossfade. Keep
  * that exact visible result as the next transition's starting pose. */
 saveVisible(){copyInto(this.visible);this.presented=true}
 /** stop/uncache restores mixer originals; do not expose that cleanup pose. */
 restoreVisible(){if(this.presented)restore(this.visible)}
}

const continuityByModel=new WeakMap<Object3D,RigPoseContinuity>()
export function rigPoseContinuity(model:Object3D):RigPoseContinuity{
 let continuity=continuityByModel.get(model)
 if(!continuity){continuity=new RigPoseContinuity(model);continuityByModel.set(model,continuity)}
 return continuity
}
