import {AnimatePresence,motion,useReducedMotion} from 'motion/react'
import type {CityLandmark} from './CityMap'

type Resident={id:string;name:string;place?:string}
type Props={
 landmark:CityLandmark|null
 name?:string
 description?:string
 image?:string
 language:'zh'|'en'
 residents:Resident[]
 onClose:()=>void
 onResidentClick:(id:string)=>void
}

export function LocationInspector({landmark,name,description,image,language,residents,onClose,onResidentClick}:Props){
 const reduce=useReducedMotion(),zh=language==='zh'
 return <AnimatePresence>{landmark&&<motion.aside className="location-inspector" initial={reduce?{opacity:0}:{opacity:0,y:26,scale:.96}} animate={{opacity:1,y:0,scale:1}} exit={reduce?{opacity:0}:{opacity:0,y:16,scale:.98}} transition={{type:'spring',stiffness:260,damping:27}} aria-live="polite">
  <div className="location-inspector__image" style={image?{backgroundImage:`linear-gradient(180deg,transparent 20%,rgba(20,24,23,.72)),url(${image})`}:undefined}>
   <button type="button" onClick={onClose} aria-label={zh?'关闭地点详情':'Close place details'}>×</button>
   <span>{landmark.kind}</span><h2>{name||landmark.name}</h2><small>{landmark.district}</small>
  </div>
  <div className="location-inspector__body"><p>{description||(zh?'城市居民会按照自己的日程来到这里，故事也可能在这里自然发生。':'Residents visit this place according to their own schedules, and stories can begin here naturally.')}</p>
   <h3>{zh?'现在在这里':'Here now'}</h3>
   {residents.length?<div className="location-inspector__residents">{residents.map(resident=><button type="button" key={resident.id} onClick={()=>onResidentClick(resident.id)}><span>{resident.name.slice(0,1)}</span><b>{resident.name}</b><small>{zh?'查看并交谈':'View and talk'}</small></button>)}</div>:<p className="location-inspector__empty">{zh?'现在很安静，晚些时候再来看看。':'It is quiet right now. Check back later.'}</p>}
  </div>
 </motion.aside>}</AnimatePresence>
}
