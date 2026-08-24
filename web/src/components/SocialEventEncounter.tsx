import {motion,useReducedMotion} from 'motion/react'
import {useEffect,useMemo,useState} from 'react'
import type {SocialAction,SocialInteraction} from '../types'
import './SocialEventEncounter.css'

const actionLabels:Record<'zh'|'en',Record<SocialAction,string>>={
 zh:{mediate:'帮忙调解',encourage:'鼓励他们',give_space:'给彼此空间',let_them_handle_it:'让他们自己处理'},
 en:{mediate:'Mediate',encourage:'Encourage them',give_space:'Give them space',let_them_handle_it:'Let them handle it'},
}

const beats=(event:SocialInteraction)=>{
 const [a,b]=event.participants.map(item=>item.name)
 if(event.presentation?.beats?.length){
  const names=new Map(event.participants.map(item=>[item.id,item.name]))
  return event.presentation.beats.map((beat,index)=>({speaker:names.get(beat.speaker_id)??(index?a:b),text:beat.text,zh:beat.translation_zh??''}))
 }
 const stories:Record<string,{speaker:string;text:string;zh:string}[]>={
  shared_interest_chat:[
   {speaker:a,text:'Wait, you like that too?',zh:'等等，你也喜欢这个吗？'},
   {speaker:b,text:'I do! I thought nobody else here did.',zh:'是啊！我还以为这里没人也喜欢呢。'},
  ],
  help_with_goal:[
   {speaker:a,text:'I may know a way to make this easier.',zh:'我也许知道一个能让这件事简单些的办法。'},
   {speaker:b,text:'Really? That would mean a lot to me.',zh:'真的吗？那对我真的很重要。'},
  ],
  unexpected_teamwork:[
   {speaker:a,text:'You take that side. I’ll handle this one!',zh:'你负责那边，这边交给我！'},
   {speaker:b,text:'We make a surprisingly good team.',zh:'没想到我们还挺有默契的。'},
  ],
  small_misunderstanding:[
   {speaker:a,text:'That isn’t what I meant at all.',zh:'我完全不是那个意思。'},
   {speaker:b,text:'Then I wish you had said it differently.',zh:'那我希望你当时能换一种说法。'},
  ],
 }
 return stories[event.template_id]??[
  {speaker:a,text:'Something unexpected happened today.',zh:'今天发生了一件意料之外的事。'},
  {speaker:b,text:'Let’s see where this takes us.',zh:'看看这会把我们带向哪里吧。'},
 ]
}

const preview=(event:SocialInteraction,locationName:string|undefined,language:'zh'|'en')=>{
 if(language==='en')return {title:event.title,summary:event.summary}
 const [a,b]=event.participants.map(item=>item.name)
 const place=locationName||'城里'
 const subject=event.presentation?.subject
 const stories:Record<string,{title:string;summary:string}>={
  shared_interest_chat:{title:'意外遇到同好',summary:`${a} 和 ${b} 在${place}聊起了${subject?`「${subject}」`:'共同的兴趣'}。`},
  help_with_goal:{title:'顺手帮个忙',summary:`${a} 发现 ${b} 正在为${subject?`「${subject}」`:'一件事'}发愁，决定过去看看。`},
  unexpected_teamwork:{title:'临时搭档',summary:`${a} 和 ${b} 在${place}碰上了一件需要一起解决的事。`},
  small_misunderstanding:{title:'小小的误会',summary:`${a} 和 ${b} 在${place}之间的气氛似乎有点微妙。`},
 }
 return stories[event.template_id]??{title:'城市里的偶遇',summary:`${a} 和 ${b} 在${place}遇见了彼此。`}
}

export function SocialEventEncounter({event,locationName,locationImage,language,onClose,onObserve,onIntervene}:{
 event:SocialInteraction
 locationName?:string
 locationImage?:string
 language:'zh'|'en'
 onClose:()=>void
 onObserve:(event:SocialInteraction)=>Promise<SocialInteraction>
 onIntervene:(event:SocialInteraction,action:SocialAction)=>Promise<SocialInteraction>
}){
 const zh=language==='zh',reduce=useReducedMotion(),[current,setCurrent]=useState(event),[busy,setBusy]=useState(''),[error,setError]=useState('')
 useEffect(()=>setCurrent(event),[event])
 const lines=useMemo(()=>beats(current),[current])
 const previewCopy=useMemo(()=>preview(current,locationName,language),[current,language,locationName])
 const resolved=current.status==='resolved_autonomously'||current.status==='resolved_with_management'
 const perform=async(action?:SocialAction)=>{setBusy(action??'observe');setError('');try{setCurrent(action?await onIntervene(current,action):await onObserve(current))}catch{setError(zh?'事件状态刚刚发生了变化，请稍后重试。':'The situation just changed. Please try again.')}finally{setBusy('')}}
 return <motion.div className="social-encounter" role="dialog" aria-modal="true" aria-label={zh?'居民互动事件':'Resident interaction'} initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}>
  <motion.article initial={reduce?false:{opacity:0,y:22,scale:.96}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:14,scale:.98}} transition={{type:'spring',stiffness:290,damping:27}}>
   <header><div><small>{zh?'正在发生 · ': 'HAPPENING NOW · '}{locationName||current.location_id}</small><h2>{zh?'居民之间的生活片段':'A moment between residents'}</h2></div><button type="button" onClick={onClose} aria-label={zh?'关闭':'Close'}>×</button></header>
   <section className="social-encounter__stage" style={locationImage?{backgroundImage:`linear-gradient(180deg,rgba(216,235,223,.66),rgba(185,216,214,.88)),url("${locationImage}")`}:undefined}>
    <div className="social-encounter__cast">{current.participants.map((person,index)=><span key={person.id}><i aria-hidden>{person.name.slice(0,1)}</i><b>{person.name}</b>{index===0&&<em>×</em>}</span>)}</div>
    {resolved?<div className="social-encounter__beats">{lines.map((line,index)=><motion.blockquote key={`${line.speaker}-${index}`} initial={reduce?false:{opacity:0,y:12,scale:.96}} animate={{opacity:1,y:0,scale:1}} transition={{delay:reduce?0:index*.22}} className={index%2?'is-right':''}><b>{line.speaker}</b><p>{line.text}</p>{zh&&<small>{line.zh}</small>}</motion.blockquote>)}</div>:<div className="social-encounter__preview"><span aria-hidden>{current.status==='traveling'?'➜':'!'}</span><h3>{previewCopy.title}</h3><p>{previewCopy.summary}</p></div>}
   </section>
   <footer>
    {current.status==='traveling'&&<p>{zh?'他们正在沿着城市道路前往目的地。跟随角色，看看事情会怎样发展。':'They are on their way. Follow a resident and see how the moment unfolds.'}</p>}
    {current.status==='awaiting_observation'&&<button className="social-encounter__primary" type="button" disabled={Boolean(busy)} onClick={()=>void perform()}>{busy?(zh?'正在展开故事…':'Opening the story…'):(zh?'观看这段互动':'Watch this moment')}</button>}
    {current.status==='awaiting_management'&&<div className="social-encounter__decisions"><b>{zh?'以管理者身份做出选择':'Choose as the city manager'}</b>{current.management.actions.map(action=><button type="button" disabled={Boolean(busy)} key={action} onClick={()=>void perform(action)}>{busy===action?'…':actionLabels[language][action]}</button>)}</div>}
    {resolved&&<div className="social-encounter__outcome"><span>✓</span><p><b>{zh?'这件事已成为他们共同的记忆':'This moment is now part of their shared history'}</b><small>{zh?'关系变化与记忆已经写入角色各自的 Agent 状态。':'Relationship changes and memories were applied to both agents.'}</small></p><button type="button" onClick={onClose}>{zh?'回到城市':'Back to city'}</button></div>}
    {error&&<p className="social-encounter__error" role="alert">{error}</p>}
   </footer>
  </motion.article>
 </motion.div>
}
