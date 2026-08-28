import {motion,useReducedMotion} from 'motion/react'
import {useEffect} from 'react'
import {useLanguage} from '../i18n'
import type {AgentMemory,AgentState} from '../types'
import './AgentPanel.css'

const stageZh:Record<string,string>={stranger:'陌生人',acquaintance:'熟人',friend:'朋友',close_friend:'亲密朋友'}
const labelZh:Record<string,string>={familiarity:'熟悉',trust:'信任',closeness:'亲密',valence:'愉悦',stress:'压力',energy:'精力',food:'饮食',rest:'休息',social:'社交',achievement:'成就',fun:'乐趣',morning:'上午',afternoon:'下午',evening:'晚上',sentence_length:'句子长度',directness:'表达方式',emotional_expression:'情感表达',humor_style:'幽默风格',question_frequency:'提问频率',short:'简短',medium:'适中',varied:'灵活',gentle:'温和',balanced:'平衡',direct:'直接',subtle:'克制',open:'开放',rare:'很少',playful:'活泼',dry:'冷幽默',low:'较低',natural:'自然',subdued:'低落',bright:'愉快',radiant:'神采奕奕',calm:'平静',noticeable:'有些压力',tense:'紧张',overwhelmed:'压力很大',tired:'疲惫',steady:'平稳',energetic:'精力充足',lively:'活力满满',urgent:'亟需照顾',strained:'有些不足',comfortable:'很充足'}
const memoryKindZh:Record<string,string>={player_fact:'关于你',episodic:'共同经历',relationship:'关系记忆',language:'语言习惯',event:'故事记忆'}
const activityZh:Record<string,string>={work:'处理日常工作',personal_interest:'享受个人兴趣',goal:'推进长期目标',recover_connect:'休息或与人联络'}
const locationZh:Record<string,string>={city_hospital:'市立医院',community_school:'社区学校',design_studio:'运河设计工作室',music_hall:'南岸音乐厅',community_gallery:'社区画廊',innovation_hub:'创新中心',business_center:'商务中心',old_town_market:'老城市场',botanical_garden:'植物园',city_library:'城市图书馆',moonlight_cafe:'月光咖啡馆',riverside_park:'河畔公园',maple_bookshop:'枫叶书店',city_museum:'城市博物馆',greenway_gym:'绿道健身房'}

function Meter({label,value}:{label:string;value:number}){return <div className="agent-meter"><span>{label}</span><i><b style={{width:`${Math.max(0,Math.min(100,value))}%`}}/></i><strong>{Math.round(value)}</strong></div>}

export function AgentPanel({name,agent,onClose,onDeleteMemory}:{name:string;agent:AgentState|null;onClose:()=>void;onDeleteMemory:(memory:AgentMemory)=>void}){
 const {language}=useLanguage(),zh=language==='zh',reduce=useReducedMotion()
 useEffect(()=>{const close=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose()};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[onClose])
 const word=(value:string)=>zh?(labelZh[value]||value):value.replaceAll('_',' ')
 const activeMilestone=agent?.goal.milestones.find(item=>item.status==='active')
 return <motion.div className="agent-panel-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}} initial={reduce?false:{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}><motion.section className="agent-panel" role="dialog" aria-modal="true" aria-label={zh?`${name}的生活档案`:`${name}'s life profile`} initial={reduce?false:{opacity:0,y:30,scale:.96}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:18,scale:.98}} transition={{type:'spring',stiffness:230,damping:25}}>
  <header><div><small>NPC AGENT</small><h2>{name}</h2><p>{zh?'角色正在城市中持续生活、记忆并成长。':'A persistent life shaped by memory, needs, and goals.'}</p></div><button onClick={onClose} aria-label={zh?'关闭':'Close'}>×</button></header>
  {!agent?<p className="agent-panel-empty">{zh?'正在读取角色状态…':'Loading character state…'}</p>:<div className="agent-panel-body">
   <section><h3>{zh?'关系':'Relationship'} <em>{zh?(stageZh[agent.relationship.stage]||agent.relationship.stage):agent.relationship.stage.replace('_',' ')}</em></h3><div className="agent-meter-grid">{(['familiarity','trust','closeness'] as const).map(key=><Meter key={key} label={word(key)} value={agent.relationship[key]}/>)}</div></section>
   <section><h3>{zh?'此刻状态':'Current state'}</h3><div className="agent-need-grid">{Object.entries(agent.runtime_state.emotion).map(([key,value])=><div key={key}><span>{word(key)}</span><b>{word(value)}</b></div>)}</div><h4>{zh?'可观察需求':'Observable needs'}</h4><div className="agent-need-grid">{Object.entries(agent.runtime_state.needs).map(([key,value])=><div key={key}><span>{word(key)}</span><b>{word(value)}</b></div>)}</div></section>
   <section><h3>{zh?'长期目标':'Long-term goal'}</h3><div className="agent-goal"><div><strong>{agent.goal.title}</strong><span>{agent.goal.progress}%</span></div><i><b style={{width:`${agent.goal.progress}%`}}/></i><ol>{agent.goal.milestones.map(item=><li className={item.status} key={item.id}><span>{item.status==='completed'?'✓':item.status==='active'?'◆':'○'}</span>{zh?(item.name_zh||item.name):item.name}</li>)}</ol></div></section>
   <section><h3>{zh?'今天的生活':'Today’s life'}</h3><div className="agent-schedule">{Object.entries(agent.daily_plan.slots).map(([slot,item])=><article className={slot===agent.current_slot?'current':''} key={slot}><small>{word(slot)}</small><p>{item.activity_id==='goal'&&activeMilestone?(zh?(activeMilestone.name_zh||activeMilestone.name):activeMilestone.name):(zh?(activityZh[item.activity_id||'']||item.activity):item.activity)}</p><span>{zh?(locationZh[item.location_id]||item.location_id):item.location_id.replaceAll('_',' ')}</span></article>)}</div></section>
   {agent.persona&&<section><h3>{zh?'人格表现':'Persona behavior'}</h3><div className="agent-voice">{Object.entries(agent.persona.voice).map(([key,value])=><span key={key}><small>{word(key)}</small>{word(value)}</span>)}</div></section>}
   <section><h3>{zh?'角色记得的事':'Memories'} <em>{agent.memories?.length||0}</em></h3><p className="agent-privacy">{zh?'这些记忆只属于你和这个角色。错误或不希望保留的内容可以删除。':'These memories belong only to you and this character. You can remove anything incorrect or unwanted.'}</p><div className="agent-memories">{agent.memories?.map(memory=><article key={memory.id}><small>{zh?(memoryKindZh[memory.kind]||memory.kind):memory.kind.replace('_',' ')}</small><p>{memory.content}</p><button onClick={()=>{if(window.confirm(zh?'确定永久删除这条角色记忆吗？':'Permanently delete this character memory?'))onDeleteMemory(memory)}}>{zh?'删除':'Delete'}</button></article>)}{!agent.memories?.length&&<p>{zh?'还没有形成长期记忆。':'No long-term memories yet.'}</p>}</div></section>
  </div>}
 </motion.section></motion.div>
}
