import {Suspense,useEffect,useMemo,useRef,useState} from 'react'
import {AnimatePresence,motion,useReducedMotion} from 'motion/react'
import {Canvas} from '@react-three/fiber'
import {ContactShadows,PerspectiveCamera} from '@react-three/drei'
import {defaultAvatar} from '../avatar'
import type {AvatarConfig,LifeInterventionOption,LifeStory} from '../types'
import type {LifeLanguage} from '../life/lifeActionCatalog'
import {deriveLifeStoryParticipantExpression} from '../life/characterExpression'
import {CharacterEmote,DirectedCharacter3D,type CharacterMotion} from '../three/characters'
import {IndoorEnvironment3D,INTERIOR_THEME_COPY,interiorThemeFor,type InteriorTheme} from '../three/interiors'
import type {WorldLayoutRoom} from '../worldLayout'
import './LifeStoryEncounter.css'

type Props={
 story:LifeStory
 language?:LifeLanguage
 locationName?:string
 locationImage?:string
 participantAvatars?:Record<string,AvatarConfig>
 layoutRooms?:readonly WorldLayoutRoom[]
 onClose:()=>void
 onObserve:(story:LifeStory)=>Promise<LifeStory>
 onIntervene:(story:LifeStory,action:string)=>Promise<LifeStory>
}

const ACTION_COPY:Record<string,{zh:string;en:string;descriptionZh:string;descriptionEn:string}>={
 ask:{zh:'问问发生了什么',en:'Ask what happened',descriptionZh:'先听他们各自怎么理解这件事。',descriptionEn:'Listen to how they each understand the situation.'},
 comfort:{zh:'先安慰一下',en:'Offer comfort',descriptionZh:'优先照顾当事人的情绪。',descriptionEn:"Take care of the resident's feelings first."},
 advise:{zh:'给出建议',en:'Offer advice',descriptionZh:'提供一个可执行的解决方向。',descriptionEn:'Suggest a practical way forward.'},
 mediate:{zh:'帮忙调解',en:'Mediate',descriptionZh:'让双方都有机会表达和回应。',descriptionEn:'Give everyone room to speak and respond.'},
 encourage:{zh:'鼓励他们',en:'Encourage them',descriptionZh:'给他们一点继续行动的勇气。',descriptionEn:'Give them confidence to take the next step.'},
 give_space:{zh:'给彼此空间',en:'Give them space',descriptionZh:'暂时不追问，让情绪先沉淀。',descriptionEn:'Step back and let emotions settle.'},
 offer_help:{zh:'主动帮忙',en:'Offer practical help',descriptionZh:'分担眼前最具体的困难。',descriptionEn:'Help with the most immediate problem.'},
 invite_talk:{zh:'邀请他们谈谈',en:'Invite a conversation',descriptionZh:'创造一个可以平静沟通的机会。',descriptionEn:'Create a calm opportunity to talk.'},
 set_boundary:{zh:'帮助明确界限',en:'Help set a boundary',descriptionZh:'把彼此可以接受的范围说清楚。',descriptionEn:'Make acceptable limits clear to everyone.'},
 support_confession:{zh:'支持坦白心意',en:'Support an honest confession',descriptionZh:'鼓励真诚表达，但不替任何人决定。',descriptionEn:'Encourage honesty without deciding for anyone.'},
 let_them_handle_it:{zh:'让他们自己处理',en:'Let them handle it',descriptionZh:'继续观察，尊重居民自己的选择。',descriptionEn:'Keep observing and respect their own choices.'},
 start_dating:{zh:'支持开始约会',en:'Support dating',descriptionZh:'双方都愿意时，让关系自然向前一步。',descriptionEn:'Let the relationship move forward when both agree.'},
 become_partners:{zh:'确认伴侣关系',en:'Become partners',descriptionZh:'双方明确同意后，确认这段关系。',descriptionEn:'Confirm the relationship only with mutual consent.'},
 separate:{zh:'支持他们分开',en:'Support separation',descriptionZh:'尊重结束关系的意愿，并给彼此空间。',descriptionEn:'Respect the choice to end the relationship and make space.'},
}

const TERMINAL=new Set<LifeStory['status']>(['resolved_autonomously','resolved_with_management','closed'])
const palette=['#d98162','#678f82','#7183af','#d0a052','#9875a0']

const localized=(english:string|undefined,chinese:string|undefined,language:LifeLanguage)=>{
 const en=english?.trim()||chinese?.trim()||''
 const zh=chinese?.trim()||english?.trim()||''
 return language==='zh'?{primary:zh,secondary:en!==zh?en:''}:{primary:en,secondary:zh!==en?zh:''}
}

const fallbackAvatar=(id:string,index:number):AvatarConfig=>{
 let hash=0
 for(let cursor=0;cursor<id.length;cursor+=1)hash=(hash*31+id.charCodeAt(cursor))|0
 const choice=Math.abs(hash+index)
 return {...defaultAvatar,hair:['swoop','bob','bun','curls','shaggy'][choice%5],outfit:['jumper','hoodie','jacket','overalls','playful'][choice%5],outfitColor:palette[choice%palette.length],strokes:[]}
}

const actionOption=(option:LifeInterventionOption,language:LifeLanguage)=>{
 const fallback=ACTION_COPY[option.id]
 const label=language==='zh'?option.label_zh?.trim()||fallback?.zh||option.label||option.id.replaceAll('_',' '):option.label?.trim()||fallback?.en||option.id.replaceAll('_',' ')
 const description=language==='zh'?option.description_zh?.trim()||fallback?.descriptionZh||option.description:option.description?.trim()||fallback?.descriptionEn||option.description_zh
 return {id:option.id,label,description}
}

const levelLabel=(story:LifeStory,language:LifeLanguage)=>{
 if(story.level==='thread')return language==='zh'?'延续中的生活线索':'ONGOING LIFE THREAD'
 if(story.level==='incident')return language==='zh'?'正在发生的生活事件':'LIFE EVENT IN PROGRESS'
 return language==='zh'?'城市里的生活片段':'A MOMENT IN THE CITY'
}

const statusLabel=(story:LifeStory,observed:boolean,language:LifeLanguage)=>{
 if(story.status==='resolved_with_management')return language==='zh'?'你参与了这个结果':'You helped shape this outcome'
 if(story.status==='resolved_autonomously'||story.status==='closed')return language==='zh'?'居民已经自行走过这一刻':'The residents carried on by themselves'
 if(story.level==='thread')return language==='zh'?'这条生活线索仍在延续':'This life thread is still unfolding'
 if(story.status==='awaiting_management')return language==='zh'?'可以选择是否介入':'You may choose whether to step in'
 if(observed)return language==='zh'?'已记录为亲眼见证':'Marked as witnessed'
 return language==='zh'?'尚未观察':'Not witnessed yet'
}

function LifeStoryCast3D({story,participants,avatars,reducedMotion,theme,language,layoutRoom}:{story:LifeStory;participants:{id:string;name:string}[];avatars?:Record<string,AvatarConfig>;reducedMotion:boolean;theme:InteriorTheme;language:LifeLanguage;layoutRoom?:WorldLayoutRoom}){
 const cast=participants.slice(0,3),count=cast.length
 // Keep the authored furniture readable and reserve the right side for the
 // story card. The cast remains in a clear foreground lane instead of being
 // hidden behind tables, shelves, or UI.
 const positions=count===1?[-1.55]:count===2?[-2.45,-.55]:[-2.95,-1.5,-.05]
 const expressions=cast.map((person,index)=>deriveLifeStoryParticipantExpression(story,person.id,index))
 return <div className="life-story-encounter__cast-3d" aria-hidden>
  <Canvas dpr={[1,1.3]} shadows gl={{antialias:true,alpha:true,powerPreference:'low-power'}}>
   <PerspectiveCamera makeDefault position={[0,2.42,8.9]} fov={37} near={.1} far={28}/>
   <ambientLight intensity={1.15}/><hemisphereLight args={['#fff6df','#627a72',1.45]}/>
   <directionalLight position={[-4,6,5]} intensity={2.05} color="#fff0d8" castShadow shadow-mapSize={[512,512]}/>
   <pointLight position={[3,2.4,2]} intensity={5.5} distance={8} color="#f1a67d"/>
   <Suspense fallback={null}><IndoorEnvironment3D theme={theme} placements={layoutRoom?.placements}/></Suspense>
   {cast.map((person,index)=>{
    const authoredCue=story.presentation?.beats?.find(beat=>beat.speaker_id===person.id)?.animation_cue
    const animation=(authoredCue??expressions[index].motion) as CharacterMotion
    const x=positions[index]??0,rotation=x===0?0:x<0?.42:-.42
    return <group key={person.id} position={[x,-.15,.42+(index===1&&count===3?.12:0)]} rotation={[0,rotation,0]}>
     <DirectedCharacter3D avatar={avatars?.[person.id]??fallbackAvatar(person.id,index)} animation={animation} performance={story.presentation?.performance} performanceMode="encounter" performanceKey={`${story.id}:${story.status}:${animation}`} performanceVariant={index} reducedMotion={reducedMotion} name={person.name} seed={person.id} scale={count===3?.65:.78}/>
    </group>
   })}
   <ContactShadows position={[0,-.24,.15]} opacity={.29} scale={7.4} blur={2.5} far={4}/>
  </Canvas>
  <div className="life-story-encounter__emotes">{cast.map((person,index)=><span key={`${person.id}:${expressions[index].key}`} title={expressions[index].label[language]}><CharacterEmote expression={expressions[index]} language={language} size={35} decorative/></span>)}</div>
 </div>
}

export function LifeStoryEncounter({story,language='zh',locationName,locationImage,participantAvatars,layoutRooms=[],onClose,onObserve,onIntervene}:Props){
 const reduce=useReducedMotion(),closeRef=useRef<HTMLButtonElement>(null)
 const [current,setCurrent]=useState(story),[busy,setBusy]=useState(''),[error,setError]=useState(''),[observedLocally,setObservedLocally]=useState(Boolean(story.observed_at)),[decision,setDecision]=useState('')
 useEffect(()=>{setCurrent(story);setObservedLocally(Boolean(story.observed_at));setDecision('');setError('')},[story])
 useEffect(()=>{closeRef.current?.focus()},[])
 useEffect(()=>{const close=(event:globalThis.KeyboardEvent)=>{if(event.key==='Escape'&&!busy)onClose()};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[busy,onClose])
 const title=localized(current.title,current.title_zh,language),summary=localized(current.summary,current.summary_zh,language),aftermath=localized(current.aftermath,current.aftermath_zh,language)
 const participants=useMemo(()=>{
  const names=new Map((current.participants??[]).map(person=>[person.id,person.name]))
  return current.participant_ids.map(id=>({id,name:names.get(id)||id}))
 },[current.participant_ids,current.participants])
 const options=useMemo(()=>(current.management?.actions??[]).map(option=>actionOption(option,language)),[current.management?.actions,language])
 const observed=observedLocally||Boolean(current.observed_at)||current.status==='observed'
 const terminal=TERMINAL.has(current.status)
 const canObserve=current.level!=='thread'&&!observed
 const managementPrompt=localized(current.management?.prompt,current.management?.prompt_zh,language)
 const subject=language==='zh'?current.presentation?.subject_zh?.trim()||current.presentation?.subject:current.presentation?.subject?.trim()||current.presentation?.subject_zh
 const interiorTheme=useMemo(()=>interiorThemeFor({locationId:current.location_id??current.presentation?.location?.id,hint:[current.title,current.title_zh,current.summary,current.summary_zh,current.presentation?.subject,current.presentation?.subject_zh].filter(Boolean).join(' ')}),[current.location_id,current.presentation?.location?.id,current.presentation?.subject,current.presentation?.subject_zh,current.summary,current.summary_zh,current.title,current.title_zh])
 const interiorCopy=INTERIOR_THEME_COPY[interiorTheme][language]
 const authoredRoomKind=interiorTheme==='home_kitchen'?'kitchen':interiorTheme==='home_bathroom'?'bathroom':interiorTheme==='home_bedroom'?'bedroom':'living_room'
 const authoredRoom=current.household_id?layoutRooms.find(room=>room.kind===authoredRoomKind):undefined
 const reactions=current.participant_reactions??current.outcome?.participant_reactions??[]
 const consequences=current.consequences??current.outcome?.consequences??[]

 const observe=async()=>{
  if(busy||observed)return
  setBusy('observe');setError('')
  try{const result=await onObserve(current);setCurrent(result);setObservedLocally(true)}
  catch{setError(language==='zh'?'这段生活刚刚发生了变化，请刷新后再试。':'This moment just changed. Refresh and try again.')}
  finally{setBusy('')}
 }
 const intervene=async(action:string)=>{
  if(busy||terminal)return
  setBusy(action);setError('')
  try{const result=await onIntervene(current,action);setCurrent(result);setObservedLocally(true);setDecision(action)}
  catch{setError(language==='zh'?'这次选择没有生效，事件可能已经继续发展了。':'That choice was not applied; the situation may have moved on.')}
  finally{setBusy('')}
 }
 const beats=current.presentation?.beats??[]

 return <motion.div className="life-story-encounter" role="dialog" aria-modal="true" aria-labelledby="life-story-title" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose()}}>
  <motion.article initial={reduce?false:{opacity:0,y:26,scale:.965}} animate={{opacity:1,y:0,scale:1}} exit={reduce?{opacity:0}:{opacity:0,y:18,scale:.98}} transition={{type:'spring',stiffness:270,damping:27}}>
   <header>
    <div><small>{levelLabel(current,language)}{locationName?` · ${locationName}`:''}</small><h2 id="life-story-title">{title.primary}</h2>{title.secondary&&<p lang={language==='zh'?'en':'zh-CN'}>{title.secondary}</p>}</div>
    <button ref={closeRef} type="button" onClick={onClose} disabled={Boolean(busy)} aria-label={language==='zh'?'关闭事件详情':'Close story details'}>×</button>
   </header>
   <section className="life-story-encounter__scene" data-interior-theme={interiorTheme} style={locationImage?{backgroundImage:`linear-gradient(180deg,rgba(229,240,233,.26),rgba(105,137,128,.5)),url("${locationImage}")`}:undefined}>
    <span className="life-story-encounter__scene-kind">{interiorCopy}</span>
    <div className="life-story-encounter__cast" aria-label={language==='zh'?'参与者':'Participants'}>
     <LifeStoryCast3D story={current} participants={participants} avatars={participantAvatars} reducedMotion={Boolean(reduce)} theme={interiorTheme} language={language} layoutRoom={authoredRoom}/>
     <div className="life-story-encounter__cast-names">{participants.slice(0,3).map((person,index)=><motion.b key={person.id} initial={reduce?false:{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{delay:reduce?0:index*.08}}>{person.name}</motion.b>)}</div>
     {participants.length>3&&<span className="life-story-encounter__more">+{participants.length-3}</span>}
    </div>
    <div className="life-story-encounter__summary">
     {subject&&<small>{subject}</small>}
     <p>{summary.primary}</p>{summary.secondary&&<blockquote lang={language==='zh'?'en':'zh-CN'}>{summary.secondary}</blockquote>}
    </div>
   </section>
   <section className="life-story-encounter__body">
    <div className={`life-story-encounter__status is-${terminal?'resolved':current.status}`}><span aria-hidden>{terminal?'✓':observed||current.level==='thread'?'◉':'○'}</span><div><b>{statusLabel(current,observed,language)}</b><small>{language==='zh'?(terminal?'结果会成为居民记忆与后续生活的一部分。':current.level==='thread'?'它会随着新的经历继续发展，而不是一项必须完成的任务。':observed?'观察不会替居民做决定，生活仍会继续。':'先观察，可以记住这一刻而不改变结果。'):(terminal?'The outcome becomes part of their memory and future life.':current.level==='thread'?'It evolves through new experiences and is not a task to complete.':observed?'Observing does not decide for residents; life continues.':'Witnessing records the moment without changing its outcome.')}</small></div></div>
    {current.level==='thread'&&aftermath.primary&&<div className="life-story-encounter__thread-note"><b>{language==='zh'?'目前留下的痕迹':'What remains so far'}</b><p>{aftermath.primary}</p>{aftermath.secondary&&<small>{aftermath.secondary}</small>}</div>}
    {beats.length>0&&<div className="life-story-encounter__beats">{beats.map((beat,index)=>{const person=participants.find(item=>item.id===beat.speaker_id),english=beat.text?.trim()||beat.translation_zh?.trim()||'',translation=language==='zh'&&beat.translation_zh?.trim()!==english?beat.translation_zh?.trim():'';return <motion.blockquote key={`${beat.speaker_id??'narrator'}-${index}`} className={index%2?'is-right':''} initial={reduce?false:{opacity:0,y:9}} animate={{opacity:1,y:0}} transition={{delay:reduce?0:.08+index*.1}}><b>{person?.name??(language==='zh'?'现场':'At the scene')}</b><p lang="en">{english}</p>{translation&&<small lang="zh-CN">{translation}</small>}</motion.blockquote>})}</div>}
    {canObserve&&terminal&&<button type="button" className="life-story-encounter__observe is-terminal" disabled={Boolean(busy)} onClick={()=>void observe()}><span aria-hidden>◉</span><b>{busy==='observe'?(language==='zh'?'正在记录…':'Recording…'):(language==='zh'?'记下这一刻':'Remember this moment')}</b><small>{language==='zh'?'结果已经发生；记录只表示你见证过，不会改写居民的选择。':'The outcome already happened; witnessing records it without changing anyone’s choice.'}</small></button>}
    {terminal&&(reactions.length>0||consequences.length>0)&&<section className="life-story-encounter__result-details" aria-label={language==='zh'?'可见结果':'Visible outcome'}>
     {reactions.length>0&&<div><b>{language==='zh'?'他们的反应':'Their reactions'}</b><ul>{reactions.map(reaction=>{const copy=localized(reaction.label,reaction.label_zh,language);return <li key={`${reaction.npc_id}:${reaction.reaction??''}`}><span>{reaction.name??participants.find(person=>person.id===reaction.npc_id)?.name??reaction.npc_id}</span><p>{copy.primary}</p>{copy.secondary&&<small>{copy.secondary}</small>}</li>})}</ul></div>}
     {consequences.length>0&&<div><b>{language==='zh'?'生活留下的变化':'What changed'}</b><ul>{consequences.map((consequence,index)=>{const copy=localized(consequence.text,consequence.translation_zh,language);return <li className={`is-${consequence.tone??'neutral'}`} key={`${consequence.kind}:${index}`}><span aria-hidden>{consequence.kind==='relationship'?'↔':consequence.kind==='resource'?'⌂':'◇'}</span><p>{copy.primary}</p>{copy.secondary&&<small>{copy.secondary}</small>}</li>})}</ul></div>}
    </section>}
    <AnimatePresence mode="wait" initial={false}>
     {!terminal&&<motion.div key="open" className="life-story-encounter__choices" initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-6}}>
      {canObserve&&<button type="button" className="life-story-encounter__observe" disabled={Boolean(busy)} onClick={()=>void observe()}><span aria-hidden>◉</span><b>{busy==='observe'?(language==='zh'?'正在记录…':'Recording…'):(language==='zh'?'观察这一刻':'Witness this moment')}</b><small>{language==='zh'?'只标记为已经看见，不会结算或改变事件。':'Marks it as seen without settling or changing it.'}</small></button>}
      {current.status==='awaiting_management'&&current.management?.can_intervene&&options.length>0&&<section className="life-story-encounter__management"><header><div><small>{language==='zh'?'管理者视角':'MANAGER VIEW'}</small><h3>{managementPrompt.primary||(language==='zh'?'你想怎样回应？':'How would you respond?')}</h3>{managementPrompt.secondary&&<p>{managementPrompt.secondary}</p>}</div><span aria-hidden>◇</span></header><div>{options.map(option=><button type="button" disabled={Boolean(busy)} key={option.id} onClick={()=>void intervene(option.id)}><b>{busy===option.id?'…':option.label}</b>{option.description&&<small>{option.description}</small>}<i aria-hidden>›</i></button>)}</div></section>}
      {(observed||current.level==='thread'||current.status==='awaiting_management')&&(!current.management?.can_intervene||!options.length)&&<p className="life-story-encounter__continue">{language==='zh'?'你可以回到城市继续观察；居民会按照自己的性格和处境行动。':'Return to the city and keep observing; residents will act from their own personalities and circumstances.'}</p>}
     </motion.div>}
     {terminal&&<motion.div key="resolved" className="life-story-encounter__outcome" initial={reduce?false:{opacity:0,scale:.97,y:8}} animate={{opacity:1,scale:1,y:0}}><span aria-hidden>✓</span><div><b>{decision?(language==='zh'?'你的选择已经融入这段生活':'Your choice is now part of this life'):(language==='zh'?'这段生活有了新的结果':'This moment has reached an outcome')}</b>{aftermath.primary&&<p>{aftermath.primary}</p>}{aftermath.secondary&&<small>{aftermath.secondary}</small>}</div><button type="button" onClick={onClose}>{language==='zh'?'回到城市':'Back to city'}</button></motion.div>}
    </AnimatePresence>
    {error&&<p className="life-story-encounter__error" role="alert">{error}</p>}
   </section>
  </motion.article>
 </motion.div>
}

export default LifeStoryEncounter
