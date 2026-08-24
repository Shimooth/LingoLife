import {AnimatePresence,motion,useReducedMotion} from 'motion/react'
import {useState} from 'react'
import type {SocialAction,SocialInteraction} from '../types'
import './SocialStoryPanel.css'

const labels:Record<'zh'|'en',Record<SocialAction,string>>={
 zh:{mediate:'帮忙调解',encourage:'鼓励他们',give_space:'给彼此空间',let_them_handle_it:'让他们自己处理'},
 en:{mediate:'Mediate',encourage:'Encourage them',give_space:'Give them space',let_them_handle_it:'Let them handle it'},
}
const chineseStory=(event:SocialInteraction)=>{
 const [a,b]=event.participants.map(item=>item.name)
 const copy:Record<string,[string,string]>={
  shared_interest_chat:['聊得很投机',`${a} 和 ${b} 发现了共同的兴趣，谈话变得格外热烈。`],
  help_with_goal:['及时伸出的手',`${a} 主动帮助 ${b} 推进一个很重要的个人目标。`],
  unexpected_teamwork:['意外的默契',`${a} 和 ${b} 一起解决了一个小问题，发现彼此配合得很好。`],
  small_misunderstanding:['一场小误会',`${a} 和 ${b} 对事情的期待不同，彼此之间出现了一点紧张。`],
 }
 return copy[event.template_id]||[event.title,event.summary]
}

export function SocialStoryPanel({events,language,onClose,onFocus,onIntervene}:{events:SocialInteraction[];language:'zh'|'en';onClose:()=>void;onFocus:(event:SocialInteraction)=>void;onIntervene:(event:SocialInteraction,action:SocialAction)=>Promise<void>}){
 const zh=language==='zh',reduce=useReducedMotion(),[busy,setBusy]=useState(''),[error,setError]=useState('')
 const act=async(event:SocialInteraction,action:SocialAction)=>{setBusy(`${event.id}:${action}`);setError('');try{await onIntervene(event,action)}catch{setError(zh?'这件事已经发生变化，请刷新后再试。':'This situation has changed. Refresh and try again.')}finally{setBusy('')}}
 return <motion.aside className="social-story-panel" role="dialog" aria-modal="true" aria-label={zh?'城市动态':'City stories'} initial={reduce?{opacity:0}:{opacity:0,x:24,scale:.97}} animate={{opacity:1,x:0,scale:1}} exit={{opacity:0,x:15}}>
  <header><div><small>{zh?'观察者简报':'OBSERVER BRIEFING'}</small><h2>{zh?'天空之城正在发生':'Happening in the Sky City'}</h2></div><button type="button" onClick={onClose}>×</button></header>
 <div className="social-story-panel__list">{events.length?events.map(event=>{const story=zh?chineseStory(event):[event.title,event.summary];return <motion.article layout key={event.id} className={event.status==='awaiting_management'?'needs-manager':''}>
   <button className="social-story-panel__focus" type="button" onClick={()=>onFocus(event)}><span>⌖ {event.time_slot}</span><h3>{story[0]}</h3><p>{story[1]}</p><small>{event.participants.map(item=>item.name).join(' · ')}</small></button>
   {event.status==='awaiting_management'&&<div className="social-story-panel__actions"><b>{zh?'需要管理者决定':'Manager decision'}</b>{event.management.actions.map(action=><button type="button" disabled={Boolean(busy)} key={action} onClick={()=>void act(event,action)}>{busy===`${event.id}:${action}`?'…':labels[language][action]}</button>)}</div>}
   {event.status==='traveling'&&<span className="social-story-panel__resolved">{zh?'两位居民正在前往事件地点。点击可以跟随他们。':'The residents are walking to the scene. Select them to follow along.'}</span>}
   {event.status==='awaiting_observation'&&<span className="social-story-panel__resolved">{zh?'他们已经到达，正在等待你来看看。':'They have arrived and are waiting for you to watch.'}</span>}
   {(event.status==='resolved_autonomously'||event.status==='resolved_with_management')&&<span className="social-story-panel__resolved">{event.status==='resolved_autonomously'?(zh?'居民们已经推进了这段生活。':'The residents carried this moment forward themselves.'):(zh?'这段故事已经产生结果。':'This story has reached an outcome.')}</span>}
  </motion.article>}):<p className="social-story-panel__empty">{zh?'今天城里还没有居民间的新动态。创建第二位角色后，关系网络会开始自然运转。':'There are no new resident stories in the city yet. Create a second character and their social world will begin to move.'}</p>}</div>
  <AnimatePresence>{error&&<motion.p className="social-story-panel__error" role="alert" initial={{opacity:0}} animate={{opacity:1}}>{error}</motion.p>}</AnimatePresence>
 </motion.aside>
}
