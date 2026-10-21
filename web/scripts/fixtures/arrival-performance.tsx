import {StrictMode,useEffect,useRef,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {_roots,addAfterEffect} from '@react-three/fiber'
import {Vector3} from 'three'
import {ArrivalPerformance3D} from '../../src/arrival/ArrivalPerformance3D'
import {defaultAvatar} from '../../src/avatar'
import type {NpcProfile} from '../../src/types'
import type {ArrivalFood} from '../../src/arrival/types'

type Config={family:'city'|'chibi';food:'toast'|'rice'|'pudding';reduced:boolean;mode:'feeding'|'welcome';take:number}
type Sample={time:number;at:number;bite:number;scale:number|null;visible:boolean;hand:number[];food:number[];handDistance:number|null;attachmentError:number|null;bones:number[];finite:boolean;boneCount:number;camera:number[];actor:number[];welcomeBeat?:string;walkDistance?:number;walkTime?:number}
type Diagnostics={phases:string[];ready:number;finished:number;bites:number[];frames:Sample[];config:Config}
declare global {interface Window{arrivalPerformanceQa:Diagnostics;arrivalPerformanceControls:{run:(config:Omit<Config,'take'>)=>void}}}
const foods:Record<Config['food'],ArrivalFood>={
 toast:{id:'toast',name:'Toast',name_zh:'吐司',price:15,satiety:42,xp:20,emoji:'🍞',color:'#d6a25b'},
 rice:{id:'rice',name:'Rice',name_zh:'米饭',price:25,satiety:55,xp:20,emoji:'🍚',color:'#fff4df'},
 pudding:{id:'pudding',name:'Pudding',name_zh:'布丁',price:20,satiety:35,xp:20,emoji:'🍮',color:'#e5bf61'},
}
const initial:Config={family:'chibi',food:'toast',mode:'feeding',reduced:false,take:0}
const reset=(config:Config):Diagnostics=>({phases:[],ready:0,finished:0,bites:[],frames:[],config})
window.arrivalPerformanceQa=reset(initial)

export function Fixture(){
 const [config,setConfig]=useState(initial),sequence=useRef(0)
 const run=(next:Omit<Config,'take'>)=>{
  const value={...next,take:++sequence.current}
  window.arrivalPerformanceQa=reset(value);setConfig(value)
 }
 useEffect(()=>{
  window.arrivalPerformanceControls={run}
  const sample=()=>{
   const qa=window.arrivalPerformanceQa
   const state=_roots.get(document.querySelector('canvas')!)?.store.getState()
   if(state&&qa.ready&&qa.frames.length<1200){
    const scene=state.scene,actor=scene.getObjectByName('arrival-resident')!,prop=scene.getObjectByName('arrival-food-in-hand')
    const hand=actor.getObjectByName(qa.config.family==='city'?'HandR':'DEF-handR')
    const position=hand?.getWorldPosition(new Vector3()),food=prop?.getWorldPosition(new Vector3())
    const bones:number[]=[];let count=0
    actor.traverse(object=>{if('isBone' in object&&object.isBone){count++;bones.push(...object.position.toArray(),...object.quaternion.toArray(),...object.scale.toArray())}})
    const signature=[...bones,...state.camera.position.toArray(),...state.camera.quaternion.toArray(),...actor.position.toArray()]
    qa.frames.push({time:actor.userData.arrival?.time??0,at:performance.now(),bite:actor.userData.arrival?.bite??0,scale:prop?.scale.x??null,visible:prop?.visible??false,hand:position?.toArray()??[],food:food?.toArray()??[],handDistance:food&&position?food.distanceTo(position):null,attachmentError:food&&position?food.distanceTo(position.clone().add(new Vector3(0,.065,.045))):null,bones:signature,finite:signature.every(Number.isFinite),boneCount:count,camera:state.camera.position.toArray(),actor:actor.position.toArray(),welcomeBeat:actor.userData.arrival?.welcomeBeat,walkDistance:actor.userData.arrival?.walkDistance,walkTime:actor.userData.arrival?.walkTime})
   }
  }
  // Read the pose that was actually rendered. An independent RAF can run
  // between React mounting the new prop and the driver's first Three frame.
  return addAfterEffect(sample)
 },[])
 const profile:NpcProfile={name:'Arrival QA',age:24,relationship:'neighbor',occupation:'artist',personality:['warm'],interests:['music'],likes:['walks'],dislikes:['noise'],quirks:['hums'],habits:['reads'],boundaries:['ask first'],longTermGoal:'Make a home',householdRole:'free_spirit',chorePreferences:['cleaning'],privateSpacePreference:'balanced',avatar:{...defaultAvatar,model:config.family==='city'?'city-01':'chibi'}}
 return <><header><b>Production arrival stage</b><select aria-label="Performance" value={config.mode} onChange={event=>run({...config,mode:event.target.value as Config['mode']})}><option>welcome</option><option>feeding</option></select><select aria-label="Rig" value={config.family} onChange={event=>run({...config,family:event.target.value as Config['family']})}><option>chibi</option><option>city</option></select><select aria-label="Food" value={config.food} onChange={event=>run({...config,food:event.target.value as Config['food']})}><option>toast</option><option>rice</option><option>pudding</option></select><label><input type="checkbox" checked={config.reduced} onChange={event=>run({...config,reduced:event.target.checked})}/> Reduced motion</label><button onClick={()=>run(config)}>Replay</button><small>No account · No API writes</small></header><main><ArrivalPerformance3D profile={profile} mode={config.mode} performanceKey={`${config.family}-${config.food}-${config.mode}-${config.reduced}-${config.take}`} food={foods[config.food]} reduced={config.reduced} onWelcomePhase={phase=>{window.arrivalPerformanceQa.phases.push(phase)}} onReady={()=>{window.arrivalPerformanceQa.ready++}} onBite={bite=>{window.arrivalPerformanceQa.bites.push(bite)}} onFinished={()=>{window.arrivalPerformanceQa.finished++}}/></main></>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture/></StrictMode>)
