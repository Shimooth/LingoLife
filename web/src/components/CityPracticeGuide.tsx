import {motion,useReducedMotion} from 'motion/react'
import type {CityPractice,CityResident,LifeStory} from '../types'
import {practicePresentation} from '../life/practicePresentation'
import './CityPracticeGuide.css'

type Props={data:CityPractice|null;residents:CityResident[];language:'zh'|'en';busy:boolean;failed:boolean;onFollow:(id:string)=>void;onOpen:(story:LifeStory)=>void;onPause:()=>void;onResume:()=>void;onRefresh:()=>void;onHome?:()=>void}
export function CityPracticeGuide({data,residents,language,busy,failed,onFollow,onOpen,onPause,onResume,onRefresh,onHome}:Props){
 const reduce=useReducedMotion(),zh=language==='zh',progress=data?.progress
 if(!progress&&!failed)return null
 if(progress?.status==='not_started'||progress?.status==='completed')return null
 if(progress?.status==='paused')return <button className="city-practice-resume" disabled={busy} onClick={onResume}>{zh?'◎ 继续进城引导':'◎ Continue city guide'}{failed&&(zh?' · 重试':' · Retry')}</button>
 const resident=residents.find(item=>item.id===progress?.npc_id)??residents[0]
 const story=data?.story??data?.candidate,step=progress?.step??'discover',copy=practicePresentation(data,language)
 return <motion.aside className="city-practice-guide" data-stage={copy.kind} aria-label={zh?'进城实操引导':'Hands-on city guide'} initial={reduce?false:{opacity:0,y:16}} animate={{opacity:1,y:0}}>
  <header><small>{zh?'你的第一段城市生活':'YOUR FIRST CITY EXPERIENCE'}</small><button disabled={busy} onClick={onPause} aria-label={zh?'暂时收起引导':'Pause guide'}>−</button></header>
  <ol aria-label={zh?'引导进度':'Guide progress'}>{(zh?['发现事情','参与其中','看到后果']:['Discover','Participate','Consequences']).map((label,index)=><li key={label} aria-current={index===(step==='result'?2:step==='discover'?0:1)?'step':undefined}>{index+1} · {label}</li>)}</ol>
  <div aria-live="polite"><h3>{copy.title}</h3><p>{copy.detail}</p>{story&&<p className="city-practice-guide__story">{zh?story.title_zh||story.title:story.title}</p>}</div>
  <button className="city-practice-guide__primary" disabled={busy||(!resident&&!story)} onClick={()=>{if(step==='discover'&&resident)onFollow(resident.id);else if(story)onOpen(story);else if(onHome)onHome();else if(resident)onFollow(resident.id)}}>{copy.button} →</button>
  {failed&&<p role="alert">{zh?'尚未同步成功；不要重复操作事件，请先重试同步。':'Not synced yet. Retry sync before repeating a story action.'}</p>}
  {(failed||copy.kind==='waiting_story'||copy.kind==='waiting_result')&&<button className="city-practice-guide__retry" disabled={busy} onClick={onRefresh}>{zh?'检查最新进度':'Check latest progress'}</button>}
 </motion.aside>
}
