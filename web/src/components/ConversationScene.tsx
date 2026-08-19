import {AnimatePresence,motion,useReducedMotion} from 'motion/react'
import {useEffect,useRef,type CSSProperties,type ReactNode} from 'react'
import type {AvatarConfig,Message,Mood} from '../types'
import {AvatarStage} from './AvatarStage'
import './ConversationScene.css'

export type LiveSpeech={key:number;speaker:'player'|'npc';text:string;streaming?:boolean}

type Props={
 npcName:string
 playerName:string
 avatar:AvatarConfig
 mood:Mood
 place:string
 locationId?:string
 locationKind?:string
 messages:Message[]
 liveSpeech:LiveSpeech|null
 historyOpen:boolean
 olderCount:number
 showOlder:boolean
 ready:boolean
 story?:ReactNode
 editLabel:string
 agentLabel:string
 language:'zh'|'en'
 onHistoryOpen:()=>void
 onHistoryClose:()=>void
 onToggleOlder:()=>void
 onEdit:()=>void
 onAgent:()=>void
}

const palettes:Record<string,[string,string,string,string]>={
 home:['#d9b79f','#f0d9c5','#a97867','#73816d'],cafe:['#b86f4e','#ecc9a0','#744937','#5f775e'],restaurant:['#6d3f39','#d8a370','#513337','#879267'],
 park:['#78a58a','#c9ddbd','#56806c','#e5c47d'],waterfront:['#6997a7','#bedce0','#4e7783','#e4c68a'],transit:['#687687','#c4c9c8','#4b5665','#dd9d55'],
 education:['#8b735b','#d9c9a9','#61564b','#879b7f'],health:['#7ca1a0','#d9ebe6','#557d7c','#d4877c'],culture:['#8d667d','#ddc5d1','#60485d','#d6a267'],
 work:['#677d8c','#c7d4d8','#465b68','#d2a36b'],shopping:['#b16d75','#ead0c7','#764b59','#d9a15f'],fitness:['#5f8878','#c4d8c9','#45685c','#d28a62'],
 civic:['#7d776c','#d8d2c2','#56534d','#b98b58'],plaza:['#a17a57','#e6d2b2','#6e5948','#73927c'],default:['#8b766d','#ddc9bc','#5f5651','#7f9278'],
}

function sceneKind(kind?:string,locationId?:string){
 if(locationId?.startsWith('home-'))return 'home'
 return palettes[kind||'']?kind||'default':'default'
}

function LocationBackdrop({kind,locationId,place}:{kind?:string;locationId?:string;place:string}){
 const variant=sceneKind(kind,locationId),palette=palettes[variant]||palettes.default
 const style={'--scene-deep':palette[0],'--scene-light':palette[1],'--scene-shadow':palette[2],'--scene-accent':palette[3]} as CSSProperties
 const outdoors=variant==='park'||variant==='waterfront'||variant==='plaza'
 return <div className={`location-backdrop location-backdrop--${variant}`} style={style} aria-hidden="true">
  <svg viewBox="0 0 1200 720" preserveAspectRatio="xMidYMid slice">
   <defs><linearGradient id="scene-sky" x1="0" y1="0" x2="0" y2="1"><stop stopColor="var(--scene-light)"/><stop offset="1" stopColor="var(--scene-deep)"/></linearGradient><linearGradient id="scene-floor" x1="0" y1="0" x2="1" y2="1"><stop stopColor="var(--scene-shadow)"/><stop offset="1" stopColor="var(--scene-deep)"/></linearGradient><filter id="scene-soft"><feGaussianBlur stdDeviation="10"/></filter></defs>
   <rect width="1200" height="720" fill="url(#scene-sky)"/>
   {outdoors?<OutdoorSet variant={variant}/>:<IndoorSet variant={variant}/>}
   <rect y="570" width="1200" height="150" fill="url(#scene-floor)" opacity=".82"/>
   <path d="M0 596Q285 556 585 594t615-10v136H0z" fill="var(--scene-shadow)" opacity=".2"/>
   <g className="scene-ambient"><circle cx="108" cy="94" r="52" fill="var(--scene-accent)" opacity=".17" filter="url(#scene-soft)"/><circle cx="1050" cy="170" r="90" fill="#fff" opacity=".12" filter="url(#scene-soft)"/></g>
  </svg>
  <span className="location-backdrop__name">⌖ {place}</span>
 </div>
}

function OutdoorSet({variant}:{variant:string}){
 return <g>
  <circle cx="960" cy="105" r="52" fill="#fff4c8" opacity=".72"/>
  <path d="M0 390Q160 260 330 374t310-18q155-132 310 6t250-14v270H0z" fill="var(--scene-shadow)" opacity=".35"/>
  <path d="M0 450q230-96 454 6t424-18q168-72 322 5v180H0z" fill="var(--scene-deep)" opacity=".42"/>
  {variant==='waterfront'?<><path d="M0 420q252-42 500 4t700-14v192H0z" fill="#9fcbd1" opacity=".78"/><path d="M0 470q260-42 520 6t680-14M40 522q230-33 460 5t650-9" fill="none" stroke="#e9f7f3" strokeWidth="9" opacity=".52"/><path d="M890 365v150m-120-105h255M900 390l-65-60m65 60 71-62" fill="none" stroke="var(--scene-shadow)" strokeWidth="14" opacity=".68"/></>:<><g fill="var(--scene-shadow)" opacity=".7"><circle cx="160" cy="350" r="70"/><circle cx="270" cy="390" r="82"/><circle cx="850" cy="350" r="90"/><circle cx="1040" cy="400" r="78"/></g><g stroke="var(--scene-shadow)" strokeWidth="20"><path d="M175 360v180M850 360v190M1040 420v120"/></g><path d="M420 570q130-220 290 0" fill="none" stroke="#ead9ad" strokeWidth="58" opacity=".72"/></>}
  {variant==='plaza'&&<g fill="var(--scene-light)" stroke="var(--scene-shadow)" strokeWidth="8" opacity=".9"><rect x="70" y="210" width="210" height="310"/><rect x="920" y="180" width="220" height="340"/><path d="M520 500v-190h150v190M575 310v-90h40v90"/></g>}
 </g>
}

function IndoorSet({variant}:{variant:string}){
 const isCafe=variant==='cafe'||variant==='restaurant',isCulture=variant==='culture',isEducation=variant==='education',isTransit=variant==='transit',isHealth=variant==='health',isWork=variant==='work',isShopping=variant==='shopping',isFitness=variant==='fitness'
 return <g>
  <rect x="48" y="55" width="1104" height="500" rx="16" fill="var(--scene-light)" opacity=".52"/>
  <rect x="105" y="105" width="300" height="270" rx="8" fill="var(--scene-deep)" opacity=".52"/><path d="M255 105v270M105 240h300" stroke="#fff" strokeWidth="12" opacity=".48"/>
  {isCafe&&<><path d="M580 95v95m250-95v95" stroke="var(--scene-shadow)" strokeWidth="8"/><ellipse cx="580" cy="205" rx="75" ry="28" fill="var(--scene-accent)"/><ellipse cx="830" cy="205" rx="75" ry="28" fill="var(--scene-accent)"/><path d="M470 450h620v125H470z" fill="var(--scene-shadow)" opacity=".75"/><g fill="var(--scene-light)"><circle cx="590" cy="410" r="28"/><circle cx="680" cy="410" r="28"/><circle cx="770" cy="410" r="28"/></g></>}
  {isCulture&&<><g fill="#f5e9dc" stroke="var(--scene-shadow)" strokeWidth="12"><rect x="500" y="120" width="180" height="240"/><rect x="760" y="155" width="230" height="180"/></g><path d="M565 300q52-122 100 0M800 275q70-100 145 0" fill="var(--scene-accent)" opacity=".75"/></>}
  {isEducation&&<><g fill="var(--scene-shadow)" opacity=".78"><rect x="475" y="95" width="565" height="310" rx="9"/><rect x="485" y="430" width="510" height="34"/></g><g stroke="var(--scene-light)" strokeWidth="9" opacity=".55"><path d="M510 155h490M510 220h490M510 285h490M590 110v280M730 110v280M870 110v280"/></g></>}
  {isTransit&&<><path d="M485 125h620v290H485z" fill="var(--scene-shadow)" opacity=".7"/><path d="M500 190h590M500 345h590" stroke="var(--scene-light)" strokeWidth="15"/><rect x="550" y="220" width="170" height="92" rx="8" fill="var(--scene-accent)"/><path d="M380 550h760M420 590h720" stroke="#eee1bb" strokeWidth="18"/></>}
  {isHealth&&<><rect x="650" y="105" width="320" height="270" rx="15" fill="#eef7f3" opacity=".8"/><path d="M810 155v170M725 240h170" stroke="var(--scene-accent)" strokeWidth="42"/><path d="M460 470h550v105H460z" fill="#edf5f1" opacity=".72"/></>}
  {isWork&&<><g fill="var(--scene-shadow)" opacity=".68"><rect x="500" y="390" width="220" height="120" rx="8"/><rect x="810" y="390" width="220" height="120" rx="8"/></g><g fill="#dce8e7"><rect x="535" y="300" width="150" height="105" rx="8"/><rect x="845" y="300" width="150" height="105" rx="8"/></g><path d="M610 510v70m310-70v70" stroke="var(--scene-shadow)" strokeWidth="15"/></>}
  {isShopping&&<><g fill="var(--scene-shadow)" opacity=".7"><rect x="480" y="100" width="260" height="390"/><rect x="800" y="100" width="260" height="390"/></g><g fill="var(--scene-accent)" opacity=".9"><path d="M460 115h300l-25 70H485z"/><path d="M780 115h300l-25 70H805z"/></g><g fill="var(--scene-light)" opacity=".65"><rect x="520" y="230" width="180" height="180"/><rect x="840" y="230" width="180" height="180"/></g></>}
  {isFitness&&<><rect x="480" y="105" width="560" height="300" fill="var(--scene-shadow)" opacity=".5"/><g stroke="var(--scene-accent)" strokeWidth="18"><path d="M550 430v110m410-110v110M520 500h470"/><path d="M670 240h180m-140-55v110m100-110v110"/></g></>}
  {!isCafe&&!isCulture&&!isEducation&&!isTransit&&!isHealth&&!isWork&&!isShopping&&!isFitness&&<><rect x="520" y="140" width="210" height="170" rx="8" fill="#f5e7d9" opacity=".85"/><path d="M560 270q65-125 130 0" fill="var(--scene-accent)" opacity=".65"/><path d="M470 490q230-110 480 0v90H470z" fill="var(--scene-shadow)" opacity=".72"/><path d="M890 185v310m-54-310h108" stroke="var(--scene-accent)" strokeWidth="18"/></>}
 </g>
}

function PlayerHead({name}:{name:string}){
 return <motion.div className="scene-player" aria-label={name} initial={{x:-36,y:28,opacity:0}} animate={{x:0,y:0,opacity:1}} transition={{type:'spring',stiffness:170,damping:24}}>
  <svg viewBox="0 0 270 250" aria-hidden><path d="M18 250q10-107 117-107t118 107" fill="#52616f"/><path d="M112 145h50l8 54H103z" fill="#d9a98b"/><ellipse cx="137" cy="111" rx="72" ry="92" fill="#493533"/><path d="M75 103Q87 22 137 19q57 4 67 92-30-46-70-61-29 18-59 53" fill="#58403d"/><path d="M88 137q50 37 99 0" fill="none" stroke="#684b47" strokeWidth="7" opacity=".5"/><path d="M112 39q24-14 49 0" fill="none" stroke="#81615a" strokeWidth="8" strokeLinecap="round" opacity=".45"/></svg>
  <span>{name}</span>
 </motion.div>
}

export function ConversationScene({npcName,playerName,avatar,mood,place,locationId,locationKind,messages,liveSpeech,historyOpen,olderCount,showOlder,ready,story,editLabel,agentLabel,language,onHistoryOpen,onHistoryClose,onToggleOlder,onEdit,onAgent}:Props){
 const reduce=useReducedMotion(),historyRef=useRef<HTMLDivElement>(null),zh=language==='zh'
 useEffect(()=>{if(historyOpen)requestAnimationFrame(()=>historyRef.current?.scrollTo({top:historyRef.current.scrollHeight,behavior:reduce?'auto':'smooth'}))},[historyOpen,messages,reduce])
 useEffect(()=>{if(!historyOpen)return;const close=(event:KeyboardEvent)=>{if(event.key==='Escape')onHistoryClose()};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[historyOpen,onHistoryClose])
 const ghost=messages.slice(-5)
 return <section className={`dialogue-scene ${historyOpen?'is-reviewing':''}`} aria-label={zh?`在${place}与${npcName}对话`:`Conversation with ${npcName} at ${place}`}>
  <LocationBackdrop kind={locationKind} locationId={locationId} place={place}/>
  <button className="scene-history-trigger" type="button" onClick={onHistoryOpen} aria-label={zh?'打开历史回顾':'Open conversation history'}><span>{zh?'点击背景回顾对话':'Tap the scene to revisit your conversation'}</span></button>
  <div className="scene-ghost-history" aria-hidden="true">{ghost.map((item,index)=><motion.p key={`${item.created_at||'ghost'}-${index}`} layout initial={reduce?false:{opacity:0,y:10}} animate={{opacity:1,y:0}} className={item.speaker}><b>{item.speaker==='player'?playerName:npcName}</b>{item.text||'…'}</motion.p>)}</div>
  <PlayerHead name={playerName}/>
  <motion.div className="scene-npc" initial={reduce?false:{x:40,opacity:0,scale:.96}} animate={{x:0,opacity:1,scale:1}} transition={{type:'spring',stiffness:165,damping:22}}><AvatarStage avatar={avatar} mood={mood} compact scene/><span>{npcName}</span></motion.div>
  <button className="scene-edit" type="button" onClick={onEdit}>✦ {editLabel}</button>
  <button className="scene-agent" type="button" onClick={onAgent}>◎ {agentLabel}</button>
  <AnimatePresence mode="wait">{liveSpeech&&<motion.aside layout key={liveSpeech.key} className={`live-speech live-speech--${liveSpeech.speaker}`} initial={reduce?false:{opacity:0,scale:.68,y:26,rotate:liveSpeech.speaker==='player'?-2:2}} animate={{opacity:1,scale:1,y:0,rotate:0}} exit={reduce?{opacity:0}:{opacity:0,scale:.74,y:-48,filter:'blur(5px)'}} transition={{type:'spring',stiffness:300,damping:23,mass:.75}}>
   <strong>{liveSpeech.speaker==='player'?playerName:npcName}</strong><p>{liveSpeech.text}</p>{liveSpeech.streaming&&<i className="live-speech__cursor"/>}
  </motion.aside>}</AnimatePresence>
  <AnimatePresence>{!liveSpeech&&story&&<motion.div className="scene-story" initial={reduce?false:{opacity:0,y:-12,scale:.97}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0}} transition={{type:'spring',stiffness:220,damping:24}}>{story}</motion.div>}</AnimatePresence>
  {!ready&&<p className="scene-loading">{zh?'正在走近…':'Getting closer…'}</p>}
  <AnimatePresence>{historyOpen&&<motion.div className="history-review" role="dialog" aria-modal="true" aria-label={zh?'历史回顾':'Conversation history'} onClick={event=>{if(event.target===event.currentTarget)onHistoryClose()}} initial={reduce?{opacity:0}:{opacity:0,backdropFilter:'blur(0px)'}} animate={{opacity:1,backdropFilter:'blur(13px)'}} exit={{opacity:0,backdropFilter:'blur(0px)'}}>
   <motion.section initial={reduce?false:{opacity:0,y:38,scale:.95}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:24,scale:.97}} transition={{type:'spring',stiffness:210,damping:25}}>
    <header><div><small>⌖ {place}</small><h2>{zh?'对话回顾':'Conversation history'}</h2></div><button type="button" onClick={onHistoryClose} aria-label={zh?'返回聊天':'Back to conversation'}>×</button></header>
    <div className="history-review__messages" ref={historyRef} role="log">{olderCount>0&&<button className="history-older" type="button" onClick={onToggleOlder}>{showOlder?(zh?'收起更早记录':'Hide earlier messages'):(zh?`展开更早的 ${olderCount} 条记录`:`Show ${olderCount} earlier messages`)}</button>}{messages.length?messages.map((item,index)=><motion.article layout key={`${item.created_at||'history'}-${index}`} className={item.speaker} initial={reduce?false:{opacity:0,y:12}} animate={{opacity:1,y:0}}><small>{item.speaker==='player'?playerName:npcName}</small><p>{item.text}</p></motion.article>):<p className="history-empty">{zh?'故事从下一句话开始。':'Your story begins with the next line.'}</p>}</div>
   </motion.section>
  </motion.div>}</AnimatePresence>
 </section>
}
