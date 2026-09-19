import {useEffect,useState} from 'react'
import {AnimatePresence,motion,useReducedMotion} from 'motion/react'
import type {LifeStory} from '../types'
import {completionLedger,storyCompletionCopy,storyCompletionKey} from '../life/storyCompletion'
import './StoryCompletionNotice.css'

const receipts=completionLedger()
export function StoryCompletionNotice({story,language,ready,delay=1800}:{story:LifeStory;language:'zh'|'en';ready:boolean;delay?:number}){
 const reduced=useReducedMotion(),key=storyCompletionKey(story),copy=storyCompletionCopy(story,language)
 const [visible,setVisible]=useState<string>(),[paused,setPaused]=useState(false)
 const eligible=Boolean(copy)&&story.level!=='thread'
 useEffect(()=>{
  if(!ready||!eligible||receipts.has(key))return
  const timer=setTimeout(()=>{receipts.mark(key);setVisible(key)},delay)
  return()=>clearTimeout(timer)
 },[key,ready,eligible,delay])
 useEffect(()=>{
  if(visible!==key||paused)return
  const timer=setTimeout(()=>setVisible(undefined),6500)
  return()=>clearTimeout(timer)
 },[visible,key,paused])
 return <div className="story-completion-slot"><AnimatePresence>{ready&&visible===key&&copy&&<motion.aside
  key={key} className="story-completion-notice" data-tone={copy.tone} data-testid="story-completion-notice"
  initial={reduced?false:{opacity:0,y:12,scale:.98}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:reduced?0:5}}
  transition={{type:'spring',stiffness:330,damping:30}}
  onMouseEnter={()=>setPaused(true)} onMouseLeave={()=>setPaused(false)} onFocus={()=>setPaused(true)} onBlur={()=>setPaused(false)}>
  <div role="status" aria-live="polite">{copy.title&&<b>{copy.title}</b>}<p>{copy.text}</p></div>
  <button type="button" aria-label={language==='zh'?'关闭结果提示':'Dismiss outcome'} onClick={()=>setVisible(undefined)}>×</button>
 </motion.aside>}</AnimatePresence></div>
}
