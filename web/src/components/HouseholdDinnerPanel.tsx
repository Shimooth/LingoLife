import {useRef,useState} from 'react'
import type {HouseholdDinner} from '../types'
import './HouseholdDinnerPanel.css'

type Props={dinner?:HouseholdDinner;gameDate?:string;language:'zh'|'en';names:Record<string,string>;onCommand?:(action:'propose'|'cleanup')=>Promise<void>;onWatch?:()=>void}
const phases={proposed:['等室友忙完手头的事','Waiting for housemates to finish up'],preparing:['正在准备饭菜','Preparing the meal'],served:['饭菜已上桌','Food is on the table'],eating:['有人正在享用这顿饭','Enjoying the meal'],cleanup:['饭后，看看谁愿意收拾','After dinner · Who will help?'],completed:['这顿饭和善后都完成了','The meal and washing-up are done'],left_for_later:['告一段落，家务留到之后','Finished for now · Chores remain'],cancelled:['这次没能一起开饭','The meal could not get started']} as const
export function HouseholdDinnerPanel({dinner,gameDate,language,names,onCommand,onWatch}:Props){
 const zh=language==='zh',[busy,setBusy]=useState(false),[failed,setFailed]=useState(false),[expanded,setExpanded]=useState(false),pending=useRef(false)
 const run=async(action:'propose'|'cleanup')=>{if(pending.current||!onCommand)return;pending.current=true;setBusy(true);setFailed(false);try{await onCommand(action)}catch{setFailed(true)}finally{pending.current=false;setBusy(false)}}
 const ended=dinner&&['completed','left_for_later','cancelled'].includes(dinner.phase)
 const stage=dinner?['proposed','preparing'].includes(dinner.phase)?0:['served','eating'].includes(dinner.phase)?1:2:0
 const events=dinner?.events??[]
 return <section className="household-dinner" aria-label={zh?'室友共餐':'A meal with housemates'} data-phase={dinner?.phase??'none'}>
  <header><div><small>{zh?'一段完整的共同生活':'A SHARED SLICE OF LIFE'}</small><h3>{zh?'一起吃顿饭':'A meal together'}</h3></div>{onWatch&&<button onClick={onWatch}>{zh?'看看厨房':'Watch the kitchen'} →</button>}</header>
  {!dinner?<><p>{zh?'提议一起吃饭，居民会根据当下的状态回应；不打断工作、睡眠或急需处理的事情。也可以不提议，傍晚做饭时他们可能自行张罗。':'Suggest a meal. Residents can join later or decline; work, sleep and urgent needs come first. Evening cooking can also start a meal naturally.'}</p><button disabled={busy||!onCommand} onClick={()=>void run('propose')}>{busy?(zh?'正在询问…':'Asking…'):zh?'提议室友一起吃饭':'Suggest a shared meal'}</button></>:<>
   <ol className="household-dinner__steps">{(zh?['准备与邀请','来吃饭','饭后与后果']:['Prepare & invite','Eat','Afterward']).map((label,index)=><li key={label} aria-current={index===stage?'step':undefined}>{index+1} · {label}</li>)}</ol>
   <p role="status"><b>{phases[dinner.phase][zh?0:1]}</b><small>{dinner.source==='player'?(zh?'由你提议，居民自行决定和行动':'You suggested it; residents decide and act'):(zh?'居民自发张罗，你可以旁观':'Started by a resident; you can observe')}</small></p>
   <div className="household-dinner__responses">{Object.entries(dinner.responses).map(([id,response])=><div key={id}><b>{names[id]??(zh?'一位室友':'A housemate')}</b><span>{response.status==='declined'?(zh?'这次不参加':'Not joining'):response.status==='later'?(zh?'忙完再来':'Joining later'):zh?'愿意参加':'Willing to join'}</span><p lang="en">{response.text}</p>{zh&&<small>{response.text_zh}</small>}</div>)}</div>
   <div className="household-dinner__facts"><span>{zh?`已吃饭 ${dinner.eaten_ids.length} 人`:`${dinner.eaten_ids.length} ate`}</span><span>{zh?`余下 ${dinner.remaining_portions} 份`:`${dinner.remaining_portions} portions left`}</span><span>{zh?`待收拾餐具 ${dinner.dirty_dishes}`:`${dinner.dirty_dishes} dishes to wash`}</span></div>
   <div className="household-dinner__timeline" aria-live="polite">{(expanded?events:events.slice(-3)).map(event=><article key={event.id}><b>{event.npc_id?names[event.npc_id]??(zh?'室友':'Housemate'):zh?'发生了什么':'What happened'}</b><p lang="en">{event.text}</p>{zh&&<small>{event.text_zh}</small>}</article>)}</div>
   {events.length>3&&<button className="is-secondary" onClick={()=>setExpanded(value=>!value)}>{expanded?(zh?'收起经过':'Collapse history'):(zh?'回顾完整经过':'View the full story')}</button>}
   {dinner.phase==='cleanup'&&!dinner.requests.includes('cleanup')&&<button disabled={busy||!onCommand} onClick={()=>void run('cleanup')}>{zh?'问问谁愿意帮忙洗碗':'Ask who can help wash up'}</button>}
   {ended?<p className="household-dinner__outcome">{dinner.cleanup_by?(zh?`${names[dinner.cleanup_by]??'室友'}实际完成了收拾。`:`${names[dinner.cleanup_by]??'A housemate'} completed the washing-up.`):zh?'没完成的家务不会因为关闭窗口而消失。':'Unfinished chores do not disappear when you close this window.'} {zh?'这顿饭不自动增加所有人的好感；关系后续由实际互动规则决定。':'A meal does not grant automatic affection; actual interactions determine relationship changes.'}</p>:<p className="household-dinner__hint">{zh?'关闭面板后生活仍会继续，无需停在这里等待。':'Life continues after you close this panel. No need to wait here.'}</p>}
  </>}
  {ended&&gameDate&&gameDate!==dinner.game_date&&<button disabled={busy||!onCommand} onClick={()=>void run('propose')}>{zh?'新的一天 · 再提议一次共餐':'A new day · Suggest another meal'}</button>}
  {failed&&<p role="alert">{zh?'操作尚未确认，请重试；已有决定不会重复执行。':'Not confirmed. Retry safely; existing decisions are not repeated.'}<button disabled={busy} onClick={()=>void run(dinner?.phase==='cleanup'?'cleanup':'propose')}>{zh?'重试':'Retry'}</button></p>}
 </section>
}
