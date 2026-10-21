import {useCallback,useEffect,useRef,useState} from 'react'
import {useReducedMotion} from 'motion/react'
import type {NpcProfile} from '../types'
import type {ResidentVoiceConfig} from '../audio/residentVoice'
import {speakResident} from '../audio/residentVoice'
import {ArrivalPerformance3D} from './ArrivalPerformance3D'
import './ArrivalWelcomeScene.css'

type Phase='arriving'|'greeting'|'settled'
type Props={profile:NpcProfile;managerName?:string;voice?:ResidentVoiceConfig;language:'zh'|'en';busy?:boolean;replay?:boolean;onContinue:()=>void}
/** A presentation-only arrival film, shared by first-time welcome and memories. */
export function ArrivalWelcomeScene({profile,managerName,voice,language,busy=false,replay=false,onContinue}:Props){
 const zh=language==='zh',reduced=Boolean(useReducedMotion())
 const [phase,setPhase]=useState<Phase>(reduced?'settled':'arriving'),[ready,setReady]=useState(false),[take,setTake]=useState(0)
 const [speaking,setSpeaking]=useState(false),[voiceError,setVoiceError]=useState(false)
 const cancel=useRef<()=>void>(()=>{}),mounted=useRef(true)
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;cancel.current()}},[])
 const onReady=useCallback(()=>setReady(true),[]),onBite=useCallback(()=>{},[]),onFinished=useCallback(()=>{},[])
 const greet=()=>{
  cancel.current();setVoiceError(false);setSpeaking(true)
  cancel.current=speakResident(`Hi! It's lovely to meet you. I think I'm going to like it here.`,voice??profile.voice??{voice_uri:'',language:'en-US',rate:1,pitch:1},{
   onEnd:()=>{if(mounted.current)setSpeaking(false)},onError:()=>{if(mounted.current){setSpeaking(false);setVoiceError(true)}},
  })
 }
 return <div className={`arrival-welcome-scene is-${phase}`} data-welcome-phase={phase}>
  <div className="arrival-welcome-film"><ArrivalPerformance3D profile={profile} mode="welcome" performanceKey={`arrival-film-${take}`} reduced={reduced} onReady={onReady} onBite={onBite} onFinished={onFinished} onWelcomePhase={setPhase}/></div>
  <div className="arrival-welcome-vignette" aria-hidden/>
  <div className="arrival-welcome-chapter"><i aria-hidden/><span>{zh?'第一天 · 新的家':'DAY ONE · A PLACE TO CALL HOME'}</span></div>
  {!ready&&<p className="arrival-welcome-loading" role="status">{zh?'阳光已经照进新家…':'Letting the sunshine in…'}</p>}
  <div className="arrival-welcome-caption" aria-live="polite">
   <div className="arrival-welcome-copyline"><span>{zh?'新居民入住':'A NEW NEIGHBOR'}</span><h1>{profile.name}</h1><p>{phase==='arriving'?(zh?'一个人走进来，小城多了一个故事。':'One arrival. The beginning of a new story.'):(zh?`${managerName?managerName+'，':''}以后请多关照。这里，看起来很不错。`:'It’s lovely to meet you. I think I’m going to like it here.')}</p></div>
   <div className="arrival-welcome-actions">
    <button type="button" className="arrival-primary" disabled={busy} onClick={()=>{cancel.current();onContinue()}}>{replay?(zh?'回到小城':'Back to the neighborhood'):(zh?'开始我们的生活':'Begin our life')}<span aria-hidden>↗</span></button>
    <button type="button" className="arrival-quiet" disabled={!ready} onClick={()=>{if(speaking){cancel.current();setSpeaking(false)}else greet()}}>{speaking?(zh?'停止朗读':'Stop voice'):(zh?'听听我的声音':'Hear my voice')}</button>
    {replay&&<button type="button" className="arrival-quiet" onClick={()=>{cancel.current();setSpeaking(false);setPhase(reduced?'settled':'arriving');setTake(value=>value+1)}}>{zh?'再看一次':'Replay'}</button>}
   </div>
   {voiceError&&<small role="status">{zh?'暂时没有可用的语音，可以稍后在角色的「声音」中重新选择。':'Voice is unavailable. You can choose another in the resident’s Voice settings.'}</small>}
  </div>
 </div>
}

export function ArrivalReplayDialog({profile,managerName,language,onClose}:Pick<Props,'profile'|'managerName'|'language'>&{onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null)
 useEffect(()=>{const element=dialog.current;element?.showModal();return()=>element?.close()},[])
 return <dialog ref={dialog} className="arrival-replay-dialog" aria-label={language==='zh'?'回看居民入住':'Replay resident arrival'} onCancel={event=>{event.preventDefault();onClose()}}><ArrivalWelcomeScene profile={profile} managerName={managerName} language={language} replay onContinue={onClose}/></dialog>
}
