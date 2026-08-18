import {motion,useReducedMotion} from 'motion/react'
import type {Stats} from '../types'
import {useLanguage,type TranslationKey} from '../i18n'
const items=[{key:'relationship',icon:'♥',label:'stats.bond'},{key:'mood',icon:'☀',label:'stats.mood'},{key:'english_xp',icon:'A',label:'stats.english'}] as const
export function StatBar({stats}:{stats:Stats|null}){const reduce=useReducedMotion(),{t}=useLanguage();return <div className="stats">{items.map(({key,icon,label})=><div className={`stat ${key}`} key={key}><span className="stat-icon" aria-hidden>{icon}</span><span><small>{t(label as TranslationKey)}</small><motion.strong key={stats?.[key]} initial={reduce?false:{scale:1.3,color:'#b95650'}} animate={{scale:1,color:'#352e32'}}>{stats?.[key]??'--'}</motion.strong></span><div className="meter"><motion.i initial={false} animate={{width:`${stats?.[key]??0}%`}} transition={{type:'spring',stiffness:90,damping:18}}/></div></div>)}</div>}
