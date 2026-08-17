import {type FormEvent,type KeyboardEvent,useEffect,useRef,useState} from 'react'
import {AnimatePresence,motion,useReducedMotion} from 'motion/react'
import {ApiError,api,quotaText,session} from './api'
import {EmmaStage} from './components/EmmaStage'
import {StatBar} from './components/StatBar'
import type {Feedback,Message,Mood,Quota,Stats,User} from './types'
type Pending={message:string;key:string}
export default function App({user,initialQuota,onLogout}:{user:User;initialQuota:Quota;onLogout:()=>void}){
 const reduce=useReducedMotion(),[stats,setStats]=useState<Stats|null>(null),[mood,setMood]=useState<Mood>('sad'),[messages,setMessages]=useState<Message[]>([]),[feedback,setFeedback]=useState<Feedback|null>(null),[text,setText]=useState(''),[busy,setBusy]=useState(false),[ready,setReady]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState<Pending|null>(null),log=useRef<HTMLDivElement>(null)
 const [quota,setQuota]=useState(initialQuota)
 const fail=(cause:unknown,fallback:string)=>{if(cause instanceof ApiError&&(cause.status===401||cause.status===403)){session.clear();onLogout();return}if(cause instanceof ApiError&&cause.code==='RATE_LIMITED')setError("You're sending messages quickly. Wait a minute, then try again.");else if(cause instanceof ApiError&&cause.status===429)setError("You've used today's messages. Come back tomorrow to continue with Emma.");else setError(fallback)}
 const load=async()=>{setError('');try{const room=await api.room();setStats(room.stats);setMood(room.npc.animation);setMessages(room.messages);if(room.quota)setQuota(room.quota);setReady(true)}catch(cause){fail(cause,"Couldn't open Emma's room. Check your connection and try again.");setReady(false)}}
 // The room is loaded once per authenticated mount; retries call load explicitly.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 useEffect(()=>{void load()},[])
 useEffect(()=>{log.current?.scrollTo({top:log.current.scrollHeight,behavior:reduce?'auto':'smooth'})},[messages,busy,reduce])
 const send=async(request:Pending)=>{setBusy(true);setError('');try{const result=await api.chat(request.message,request.key);setMessages(old=>[...old,{speaker:'npc',text:result.npc_reply}]);setStats(result.stats);setMood(result.animation);setFeedback(result.english_feedback);if(result.quota)setQuota(result.quota);setPending(null);setText('')}catch(cause){fail(cause,'The reply was interrupted. Your message is safe — try again.')}finally{setBusy(false)}}
 const submit=(event:FormEvent)=>{event.preventDefault();const message=text.trim();if(!message||busy||pending||!ready)return;const request={message,key:api.key()};setPending(request);setMessages(old=>[...old,{speaker:'player',text:message}]);void send(request)}
 const keyDown=(event:KeyboardEvent<HTMLTextAreaElement>)=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();event.currentTarget.form?.requestSubmit()}}
 return <main className="shell"><motion.section className="room" initial={reduce?false:{opacity:0,y:12}} animate={{opacity:1,y:0}}>
  <header><div><p className="eyebrow">Emma's room</p><h1>A quiet evening</h1></div><div className="account"><span><b>{user.username}</b><small>{quotaText(quota)}</small></span><button onClick={async()=>{try{await api.logout()}finally{session.clear();onLogout()}}}>Exit</button></div></header>
  <StatBar stats={stats}/><EmmaStage mood={mood}/>
  <section className="conversation" aria-label="与 Emma 的对话"><div className="messages" ref={log} role="log" aria-live="polite">
   {!ready&&!error&&<p className="empty">Opening the door…</p>}
   <AnimatePresence initial={false}>{messages.map((item,index)=><motion.article className={`message ${item.speaker}`} key={`${index}-${item.text}`} initial={reduce?false:{opacity:0,y:12,scale:.98}} animate={{opacity:1,y:0,scale:1}}>{item.speaker==='npc'&&<span className="avatar" aria-hidden>E</span>}<div className="bubble">{item.speaker==='npc'&&<b>EMMA</b>}<p>{item.text}</p></div></motion.article>)}</AnimatePresence>
   {busy&&<motion.article className="message npc" initial={{opacity:0}} animate={{opacity:1}}><span className="avatar" aria-hidden>E</span><div className="bubble typing" aria-label="Emma is typing"><i/><i/><i/></div></motion.article>}
  </div>
  <AnimatePresence>{feedback&&<motion.aside className="feedback" initial={reduce?false:{opacity:0,y:8,height:0}} animate={{opacity:1,y:0,height:'auto'}} exit={{opacity:0,height:0}}><div><strong>✦ English note</strong><button onClick={()=>setFeedback(null)} aria-label="关闭英语反馈">×</button></div><p>{feedback.tip}</p>{feedback.corrected_text&&<small>Try: “{feedback.corrected_text}”</small>}</motion.aside>}</AnimatePresence>
  <AnimatePresence>{error&&<motion.div className="error" role="alert" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}><span>{error}</span><button onClick={()=>pending?void send(pending):void load()}>Try again</button></motion.div>}</AnimatePresence>
  <form onSubmit={submit}><label className="sr-only" htmlFor="message">Write an English reply to Emma</label><textarea id="message" maxLength={500} rows={1} value={text} onChange={e=>setText(e.target.value)} onKeyDown={keyDown} placeholder="Say something to Emma…" disabled={!ready||busy||!!pending}/><motion.button type="submit" disabled={!ready||busy||!!pending||!text.trim()} whileHover={reduce?undefined:{y:-2}} whileTap={reduce?undefined:{scale:.94}}>{busy?<span className="spinner"/>:'Send'}</motion.button><small>Enter to send · Shift+Enter for a new line</small></form>
  </section>
 </motion.section></main>
}
