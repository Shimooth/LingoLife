import {motion,useReducedMotion} from 'motion/react'
import {useEffect,useRef} from 'react'
import type {AvatarConfig,Mood} from '../types'
import {AvatarStage} from './AvatarStage'

export function ConversationEntrance({name,line,place,avatar,mood,onComplete}:{name:string;line:string;place?:string;avatar:AvatarConfig;mood:Mood;onComplete:()=>void}){
 const reduce=useReducedMotion(),completeRef=useRef(onComplete)
 useEffect(()=>{completeRef.current=onComplete},[onComplete])
 useEffect(()=>{const timer=window.setTimeout(()=>completeRef.current(),reduce?520:2800);return()=>window.clearTimeout(timer)},[reduce])
 return <motion.div className="conversation-entrance" role="status" aria-live="polite" initial={reduce?{opacity:0}:{opacity:0}} animate={{opacity:1}} exit={reduce?{opacity:0}:{opacity:0,transition:{duration:.28}}}>
  <motion.div className="entrance-wash" aria-hidden initial={false} animate={{opacity:reduce ? .72 : [.82,.72,.58]}} transition={reduce?{duration:.01}:{duration:2.8,times:[0,.55,1]}}/>
  <motion.div className="entrance-portrait" aria-hidden initial={reduce?false:{opacity:0,x:-18,scale:.94}} animate={{opacity:1,x:0,scale:1}} exit={{opacity:0,x:-14,scale:.97}} transition={{type:'spring',stiffness:245,damping:24}}><AvatarStage avatar={avatar} mood={mood} compact/></motion.div>
  <motion.aside className="entrance-speech" initial={reduce?false:{opacity:0,x:-20,y:18,scale:.82,rotate:-1.5}} animate={reduce?{opacity:1}:{opacity:[0,1,1,.98],x:[-20,0,0,5],y:[18,0,-2,-3],scale:[.82,1.035,1,1],rotate:[-1.5,.35,0,0]}} exit={reduce?{opacity:0}:{opacity:0,x:92,y:-18,scale:.82,filter:'blur(6px)'}} transition={reduce?{duration:.01}:{duration:2.5,times:[0,.18,.72,1],ease:[.2,.85,.25,1]}}>
   <div><strong>{name}</strong>{place&&<span>⌖ {place}</span>}</div><p>{line}</p><i aria-hidden/>
  </motion.aside>
 </motion.div>
}
