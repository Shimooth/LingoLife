import {useEffect,useState} from 'react'
import type {LifeIncident,LifeMoment,LifeStory,PublicRelationshipSummary,StoryAttentionBudget,StoryThread} from '../types'
import type {LifeLanguage} from '../life/lifeActionCatalog'
import './StoryThreadsPanel.css'

type SelectableStory=StoryThread|LifeIncident|LifeMoment
type Props={moments?:readonly LifeMoment[];threads:readonly StoryThread[];incidents?:readonly LifeIncident[];recentAftermath?:readonly LifeStory[];relationships?:readonly PublicRelationshipSummary[];attentionBudget?:StoryAttentionBudget;residentNames?:Record<string,string>;language?:LifeLanguage;legacyCount?:number;onClose:()=>void;onSelect?:(story:SelectableStory)=>void;onOpenLegacy?:()=>void;className?:string}

const useCompactViewport=()=>{
 const query='(max-width: 720px)'
 const [compact,setCompact]=useState(()=>typeof window!=='undefined'&&window.matchMedia(query).matches)
 useEffect(()=>{const media=window.matchMedia(query),update=()=>setCompact(media.matches);update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update)},[])
 return compact
}

const urgentFirst=<T extends LifeIncident,>(values:readonly T[],limit:number)=>{
 const urgent=values.filter(value=>value.status==='awaiting_management'||Boolean(value.trouble_signal))
 const urgentIds=new Set(urgent.map(value=>value.id))
 return [...urgent,...values.filter(value=>!urgentIds.has(value.id))].slice(0,Math.max(limit,urgent.length))
}

const CHANNEL_COPY={
 friendship:{emerging:{zh:'友情萌芽',en:'New friendship'},friend:{zh:'朋友',en:'Friends'},close_friend:{zh:'好朋友',en:'Close friends'},estranged:{zh:'友情疏远',en:'Estranged'}},
 conflict:{friction:{zh:'有些摩擦',en:'Friction'},open_conflict:{zh:'正在争执',en:'Open conflict'},feud:{zh:'彼此敌对',en:'Feud'},truce:{zh:'暂时休战',en:'Truce'}},
 rivalry:{friendly:{zh:'友好竞争',en:'Friendly rivals'},competitive:{zh:'竞争对手',en:'Rivals'},hostile:{zh:'激烈竞争',en:'Hostile rivalry'}},
 romance:{dating:{zh:'正在约会',en:'Dating'},partner:{zh:'伴侣',en:'Partners'},separated:{zh:'已经分开',en:'Separated'}},
} as const

const STRUCTURAL_COPY:Record<string,{zh:string;en:string}>={
 family:{zh:'家人',en:'Family'},
 household:{zh:'同住 / 室友',en:'Housemates'},
 work:{zh:'同事',en:'Coworkers'},
 school:{zh:'同学',en:'Schoolmates'},
 neighbor:{zh:'邻居',en:'Neighbors'},
 neighborhood:{zh:'邻居',en:'Neighbors'},
 mentorship:{zh:'导师 / 学员',en:'Mentor · mentee'},
 community:{zh:'社区伙伴',en:'Community ties'},
}

const structuralLabel=(kind:string,language:LifeLanguage)=>{
 const copy=STRUCTURAL_COPY[kind]
 if(copy)return copy[language]
 return language==='zh'?'固定关系':kind.replaceAll('_',' ').replace(/\b\w/g,value=>value.toUpperCase())
}

const closenessCopy=(relationship:PublicRelationshipSummary,language:LifeLanguage)=>{
 const bands=(relationship.directions??[]).map(direction=>direction.closeness).filter(Boolean)
 const band=bands.includes('close')?'close':bands.includes('warm')?'warm':bands.includes('familiar')?'familiar':'new'
 const copy={close:{zh:'关系亲近',en:'Close'},warm:{zh:'相处融洽',en:'Warm'},familiar:{zh:'逐渐熟悉',en:'Familiar'},new:{zh:'刚刚认识',en:'New connection'}}[band]
 return copy[language]
}

function RelationshipCard({relationship,language,names}:{relationship:PublicRelationshipSummary;language:LifeLanguage;names:Record<string,string>}){
 const people=relationship.participant_ids.slice(0,2).map(id=>names[id]||id)
 const channels:(keyof typeof CHANNEL_COPY)[]=['friendship','conflict','rivalry','romance']
 const channelTags=channels.flatMap(channel=>{
  const state=relationship.channels[channel]
  if(state==='none')return []
  const copy=CHANNEL_COPY[channel][state as keyof (typeof CHANNEL_COPY)[typeof channel]] as {zh:string;en:string}|undefined
  return copy?[{kind:channel,label:copy[language],key:`${channel}:${state}`}]:[]
 })
 const structuralTags=Array.from(new Map((relationship.structural_bonds??[])
  .filter(bond=>bond.active!==false)
  .map(bond=>[bond.kind,{kind:'structural',label:structuralLabel(bond.kind,language),key:`bond:${bond.kind}`}])).values())
 const tags=[...structuralTags,...channelTags]
 return <article className="resident-relationship"><div className="resident-relationship__people"><span>{people[0]?.slice(0,1)}</span><i aria-hidden>↔</i><span>{people[1]?.slice(0,1)}</span><b>{people.join(' · ')}</b></div><div className="resident-relationship__tags">{tags.length?tags.map(tag=><em className={`is-${tag.kind}`} key={tag.key}>{tag.label}</em>):<em>{closenessCopy(relationship,language)}</em>}</div></article>
}

const statusCopy=(thread:LifeStory,language:LifeLanguage)=>{
 if(thread.status==='awaiting_management')return language==='zh'?'可以由你介入':'You may step in'
 if(thread.status==='observed')return language==='zh'?'正在被你观察':'You are observing this'
 if(thread.status==='closed'||thread.status==='resolved_autonomously'||thread.status==='resolved_with_management')return language==='zh'?'已经留下结果':'A result has taken shape'
 return language==='zh'?'故事仍在生活中延续':'Still unfolding through daily life'
}

function StoryCard({story,language,kind,onSelect}:{story:SelectableStory;language:LifeLanguage;kind:'moment'|'incident'|'thread'|'aftermath';onSelect?:Props['onSelect']}){
 const title=language==='zh'?story.title_zh?.trim()||story.title:story.title
 const summary=language==='zh'?story.summary_zh?.trim()||story.summary:story.summary
 const aftermath=language==='zh'?story.aftermath_zh?.trim()||story.aftermath:story.aftermath
 const participants=story.participants?.map(person=>person.name).filter(Boolean).join(' · ')
 const eyebrow=kind==='incident'?(language==='zh'?'此刻正在发生':'Happening now'):kind==='aftermath'?(language==='zh'?'你离开后留下的变化':'What changed while you were away'):kind==='moment'&&!['resolved_autonomously','resolved_with_management','closed'].includes(story.status)?(language==='zh'?'生活里的一个片段':'A moment from daily life'):statusCopy(story,language)
 return <article className={`story-thread is-${kind}`}><small>{eyebrow}</small><h3>{title}</h3><p>{summary}</p>{aftermath&&<blockquote>{aftermath}</blockquote>}{participants&&<span>{participants}</span>}{onSelect&&<button type="button" className="story-thread__open" onClick={()=>onSelect(story)} aria-label={language==='zh'?`查看${title}`:`Open ${title}`}><i aria-hidden>›</i></button>}</article>
}

export function StoryThreadsPanel({moments=[],threads,incidents=[],recentAftermath=[],relationships=[],attentionBudget,residentNames={},language='zh',legacyCount=0,onClose,onSelect,onOpenLegacy,className=''}:Props){
 const compact=useCompactViewport(),limits=attentionBudget?.[compact?'compact':'desktop']
 const visibleIncidents=limits?urgentFirst(incidents,limits.incidents):incidents
 const visibleMoments=limits?moments.slice(0,limits.moments):moments
 const visibleThreads=limits?threads.slice(0,limits.threads):threads
 const visibleAftermath=limits?recentAftermath.slice(0,limits.aftermath):recentAftermath
 const hiddenHere=(incidents.length-visibleIncidents.length)+(moments.length-visibleMoments.length)+(threads.length-visibleThreads.length)+(recentAftermath.length-visibleAftermath.length)
 const hiddenUpstream=attentionBudget?.suppressed?Object.values(attentionBudget.suppressed).reduce((sum,value)=>sum+value,0):0
 return <aside className={`story-threads-panel ${className}`.trim()} role="dialog" aria-modal="true" aria-label={language==='zh'?'连续故事':'Ongoing stories'}>
  <header><div><small>{language==='zh'?'城市记忆':'CITY MEMORY'}</small><h2>{language==='zh'?'仍在延续的故事':'Stories still unfolding'}</h2><p>{language==='zh'?'这里记录关系和生活留下的线索，不是必须完成的任务。':'These are traces left by relationships and daily life, not tasks you must complete.'}</p></div><button type="button" onClick={onClose} aria-label={language==='zh'?'关闭':'Close'}>×</button></header>
  <div className="story-threads-panel__list">{visibleIncidents.length>0&&<section className="story-threads-panel__section"><h3>{language==='zh'?'此刻值得留意':'Needs attention now'}</h3>{visibleIncidents.map(incident=><StoryCard key={incident.id} story={incident} kind="incident" language={language} onSelect={onSelect}/>)}</section>}{visibleAftermath.length>0&&<section className="story-threads-panel__section story-threads-panel__aftermath"><h3>{language==='zh'?'昨日与离线余波':'Since your last visit'}</h3><p>{language==='zh'?'这些事情在你没有观看时仍然继续，并留下了可以回访的结果。':'Life continued while you were away, leaving outcomes you can revisit.'}</p>{visibleAftermath.map(story=><StoryCard key={`aftermath:${story.id}`} story={story as SelectableStory} kind="aftermath" language={language} onSelect={onSelect}/>)}</section>}{visibleMoments.length>0&&<section className="story-threads-panel__section"><h3>{language==='zh'?'近日生活片段':'Recent life moments'}</h3>{visibleMoments.map(moment=><StoryCard key={moment.id} story={moment} kind="moment" language={language} onSelect={onSelect}/>)}</section>}{visibleThreads.length>0&&<section className="story-threads-panel__section"><h3>{language==='zh'?'延续中的故事':'Ongoing threads'}</h3>{visibleThreads.map(thread=><StoryCard key={thread.id} story={thread} kind="thread" language={language} onSelect={onSelect}/>)}</section>}{hiddenHere+hiddenUpstream>0&&<p className="story-threads-panel__budget-note">{language==='zh'?`另有 ${hiddenHere+hiddenUpstream} 条较弱或重复的线索暂时收起`:`${hiddenHere+hiddenUpstream} quieter or repeated traces are tucked away for now`}</p>}{relationships.length>0&&<section className="story-threads-panel__section story-threads-panel__relationships"><h3>{language==='zh'?'居民关系':'Resident relationships'}</h3><p>{language==='zh'?'这里只展示已经公开形成的关系，不显示居民尚未说出口的感受。':'Only established public relationships appear here; unspoken feelings stay private.'}</p><div>{relationships.map(relationship=><RelationshipCard key={relationship.pair_key} relationship={relationship} language={language} names={residentNames}/>)}</div></section>}{!moments.length&&!threads.length&&!incidents.length&&!recentAftermath.length&&!relationships.length&&<div className="story-threads-panel__empty"><span aria-hidden>☁</span><h3>{language==='zh'?'故事还在慢慢形成':'Stories are still taking shape'}</h3><p>{language==='zh'?'居民继续生活以后，值得记住的线索会自然出现在这里。':'As residents keep living, memorable threads will naturally appear here.'}</p></div>}</div>
  {legacyCount>0&&onOpenLegacy&&<footer><button type="button" onClick={onOpenLegacy}>{language==='zh'?`查看今日互动（${legacyCount}）`:`View today's interactions (${legacyCount})`}<span aria-hidden>›</span></button></footer>}
 </aside>
}

export default StoryThreadsPanel
