import {StrictMode,useEffect,useRef,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {_roots,addAfterEffect} from '@react-three/fiber'
import {Box3,Mesh,Vector3} from 'three'
import {NeighborhoodStage3D,type NeighborhoodStageMode} from '../../src/neighborhood/NeighborhoodStage3D'
import {defaultAvatar} from '../../src/avatar'
import type {NpcProfile} from '../../src/types'

type Config={mode:NeighborhoodStageMode;family:'city'|'chibi';reduced:boolean;take:number}
declare global {interface Window{neighborhoodStageQa:{ready:number;complete:number;time:number;boneCount:number;finite:boolean;pose:number[];config:Config;rootId?:string};neighborhoodStageControls:{run:(value:Omit<Config,'take'>)=>void;setCue:(value:string)=>void;setSpeaker:(value:string)=>void;bounds:()=>unknown}}}
const initial:Config={mode:'fountain',family:'chibi',reduced:false,take:0}
const reset=(config:Config)=>({ready:0,complete:0,time:0,boneCount:0,finite:true,pose:[],config})
window.neighborhoodStageQa=reset(initial)
const modes:NeighborhoodStageMode[]=['fountain','wish','news','shop','gift','meet','friendship','spark']
export function Fixture(){
 const [config,setConfig]=useState(initial),[cue,setCue]=useState('talk'),[speaker,setSpeaker]=useState('resident-a'),sequence=useRef(0)
 const run=(value:Omit<Config,'take'>)=>{const next={...value,take:++sequence.current};window.neighborhoodStageQa=reset(next);setConfig(next);setCue(value.mode==='gift'?'receive':value.mode==='wish'?'wish':'talk');setSpeaker('resident-a')}
 useEffect(()=>{
  window.neighborhoodStageControls={run,setCue,setSpeaker,bounds:()=>{
   const scene=_roots.get(document.querySelector('canvas')!)?.store.getState().scene,result:Record<string,unknown>={}
   for(const name of ['neighborhood-resident:resident-a','neighborhood-resident:resident-b','wish-fountain-asset']){
    const object=scene?.getObjectByName(name),box=new Box3(),point=new Vector3()
    object?.traverseVisible(mesh=>{if(mesh instanceof Mesh){for(let i=0;i<(mesh.geometry.attributes.position?.count??0);i++){mesh.getVertexPosition(i,point);point.applyMatrix4(mesh.matrixWorld);box.expandByPoint(point)}}})
    result[name]={min:box.min.toArray(),max:box.max.toArray(),size:box.getSize(new Vector3()).toArray()}
   }
   const scenery=scene?.children.find(object=>object.name.startsWith('neighborhood-scenery:'))
   for(const [name,object] of [['base',scenery?.children[0]],['platform',window.neighborhoodStageQa.config.mode==='shop'?scenery?.children.at(-1):undefined]] as const){if(object){const box=new Box3().setFromObject(object);result[name]={min:box.min.toArray(),max:box.max.toArray()}}}
   return result
  }}
  return addAfterEffect(()=>{
   const qa=window.neighborhoodStageQa,scene=_roots.get(document.querySelector('canvas')!)?.store.getState().scene
   const root=scene?.getObjectByName('neighborhood-resident:resident-a')
   if(!root)return
   const pose:number[]=[];let bones=0
   root.traverse(object=>{if('isBone' in object&&object.isBone){bones++;pose.push(...object.quaternion.toArray(),...object.position.toArray())}})
   Object.assign(qa,{time:root.userData.neighborhood?.time??0,boneCount:bones,finite:pose.every(Number.isFinite),pose,rootId:root.uuid})
  })
 },[])
 const person=(id:string,name:string)=>({id,profile:{name,age:24,relationship:'neighbor',occupation:'artist',personality:['warm'],interests:['music'],likes:['walks'],dislikes:['noise'],quirks:['hums'],habits:['reads'],boundaries:['ask first'],longTermGoal:'Make a home',householdRole:'free_spirit',chorePreferences:['cleaning'],privateSpacePreference:'balanced',avatar:{...defaultAvatar,model:config.family==='city'?'city-01':'chibi',hairColor:id==='resident-a'?'#72432f':'#3a302f'}} as NpcProfile})
 return <><header><strong>Neighborhood production stage</strong><select aria-label="Mode" value={config.mode} onChange={event=>run({...config,mode:event.target.value as NeighborhoodStageMode})}>{modes.map(mode=><option key={mode}>{mode}</option>)}</select><select aria-label="Rig" value={config.family} onChange={event=>run({...config,family:event.target.value as Config['family']})}><option>city</option><option>chibi</option></select><label><input type="checkbox" checked={config.reduced} onChange={event=>run({...config,reduced:event.target.checked})}/>Reduced motion</label><button onClick={()=>run(config)}>Replay</button></header><main><NeighborhoodStage3D key={config.take} mode={config.mode} residents={[person('resident-a','Mira'),person('resident-b','Noah')]} activeActorIds={['resident-a','resident-b']} speakerId={speaker} cue={cue} shot="wide" performanceKey={`qa-${config.take}`} reducedMotion={config.reduced} newsTitle="A little wish, a new beginning" giftLabel="A thoughtful gift" outfitPreview={{...defaultAvatar,model:config.family==='city'?'city-02':'chibi',outfit:'traveller'}} onReady={()=>{if(window.neighborhoodStageQa.config.take===config.take)window.neighborhoodStageQa.ready++}} onComplete={()=>{if(window.neighborhoodStageQa.config.take===config.take)window.neighborhoodStageQa.complete++}}/></main></>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture/></StrictMode>)
