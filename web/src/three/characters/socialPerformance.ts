import {Quaternion,QuaternionKeyframeTrack,type Group,type Object3D,type AnimationClip} from 'three'

export type SocialPerformance={speaking:boolean;listening?:boolean;seated?:boolean;key?:string;intensity?:number;enabled?:boolean}
// Measure elbows as well as wrists: City Idle_A keeps its hands still while
// cycling its elbows; Idle_B gestures widely. The Pose clip is the calm base.
export const QUIET_SOCIAL_CLIPS={city:'Idle_A_Pose',chibi:'anim_iddle.001'} as const
type Channel={node:Object3D;sample:(time:number)=>ArrayLike<number>;strength:number}
type Layer={standing:Channel[];seated:Channel[];durations:[number,number];time:number;weight:number;nod:number;wasListening:boolean;head?:Object3D}
const layers=new WeakMap<Group,Layer>()
const smooth=(value:number)=>{const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t)}

/** Register only upper-body rotations. Raw lower-body animation, furniture
 * contact and the active hand constraint remain owned by their controllers. */
export function registerSocialPerformance(model:Group,standing:AnimationClip,seated:AnimationClip){
 const channels=(clip:AnimationClip):Channel[]=>clip.tracks.flatMap(track=>{
  if(!(track instanceof QuaternionKeyframeTrack)||!track.name.endsWith('.quaternion'))return []
  const node=model.getObjectByName(track.name.slice(0,-11));if(!node)return []
  const interpolation=track.InterpolantFactoryMethodLinear()
  const strength=/Head|spine006/.test(node.name)?.3:/Torso|spine00[123]/.test(node.name)?.5:1
  return [{node,sample:time=>interpolation.evaluate(time),strength}]
 })
 const layer:Layer={standing:channels(standing),seated:channels(seated),durations:[standing.duration,seated.duration],time:0,weight:0,nod:0,wasListening:false,head:model.getObjectByName('Head')??model.getObjectByName('DEF-spine006')}
 layers.set(model,layer)
 return ()=>{if(layers.get(model)===layer)layers.delete(model)}
}

/** Called after sampling/saving raw animation and before seat/hand constraints.
 * This is not a second mixer and never rewrites the raw-pose cache. */
export function applySocialPerformance(model:Group,input:SocialPerformance|undefined,delta:number,paused=false){
 const layer=layers.get(model);if(!layer)return
 const step=Math.max(0,Math.min(.1,delta)),enabled=Boolean(input&&input.enabled!==false&&!paused)
 layer.time+=paused?0:step
 const speaking=enabled&&input!.speaking,listening=enabled&&!speaking&&Boolean(input!.listening)
 const energy=Math.max(.25,Math.min(1,input?.intensity??.72))
 // A small quiet interval between gestures leaves room for a resting pose.
 // Keep clip time continuous through speaker changes; never jump to frame zero.
 const duration=layer.durations[input?.seated?1:0],phase=(layer.time*.9)%duration
 const phrase=phase/duration,gesture=.65+.35*smooth(Math.min(phrase/.12,(1-phrase)/.2))
 const desired=speaking?energy*gesture:0
 layer.weight+= (desired-layer.weight)*(1-Math.exp(-step/(speaking?.16:.22)))
 if(!enabled)layer.weight=0
 const target=new Quaternion()
 if(layer.weight>.0001)for(const channel of input?.seated?layer.seated:layer.standing){
  target.fromArray(channel.sample(phase)).normalize()
  channel.node.quaternion.slerp(target,layer.weight*channel.strength).normalize()
 }
 // One acknowledgement on a new listening turn, not an endless head bob.
 if(listening&&!layer.wasListening)layer.nod=.001
 layer.wasListening=listening
 if(layer.nod>0){
  layer.nod+=step
  if(layer.nod>.85||!listening)layer.nod=0
  else if(layer.head)layer.head.rotateX(.035*Math.sin(Math.PI*layer.nod/.85)**2)
 }
}
