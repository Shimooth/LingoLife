import {Suspense,useEffect,useMemo,useRef,useState} from 'react'
import {AnimatePresence,motion,useReducedMotion} from 'motion/react'
import {Canvas,useThree} from '@react-three/fiber'
import {ContactShadows,PerspectiveCamera} from '@react-three/drei'
import {EncounterResident3D} from '../three/characters/EncounterResident3D'
import {useTimedStoryBeat} from '../life/useTimedStoryBeat'
import {SharedDrinkPerformance3D} from '../three/characters/SharedDrinkPerformance3D'
import {isSharedDrinkStage} from '../three/characters/sharedDrinkPerformance'
import {isCafeDrinkStory} from '../three/characters/cafeDrinkScene'
import {resolveSharedDrinkLayout,type SharedDrinkLayout} from '../three/interiors/sharedDrinkLayout'
import {CAFE_DRINK_RIG} from '../three/world/streetscapeLayout'
import {CafeDrinkFurniture3D} from '../three/world/CityStreetscape'
import {defaultAvatar} from '../avatar'
import type {AvatarConfig,LifeInterventionOption,LifeStory,LifeStoryBeat} from '../types'
import type {LifeLanguage} from '../life/lifeActionCatalog'
import {conciseSceneContext} from '../life/encounterActing'
import {IndoorEnvironment3D,INTERIOR_THEME_COPY,interiorThemeFor,type InteriorTheme} from '../three/interiors'
import type {WorldLayoutRoom} from '../worldLayout'
import './LifeStoryEncounter.css'
import {AdaptiveResolution,SceneLighting,SceneLook} from '../three/rendering/SceneLook'
import {useVisualBudget} from '../three/rendering/useVisualBudget'
import {StoryCompletionNotice} from './StoryCompletionNotice'
import {useSceneDialogue,type SceneWriter} from '../life/useSceneDialogue'

const ROLE_COPY:Record<string,[string,string]>={visitor:['来访者','Visitor'],unavailable_host:['正忙的居民','Busy resident'],host:['被拜访者','Host'],cook:['做饭的人','Cook'],diner:['用餐的人','Diner'],owner:['物品主人','Owner'],borrower:['借用者','Borrower'],initiator:['发起者','Initiator'],affected_resident:['当事人','Resident'],alone:['独处中','On their own']}

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
 onDialogue?:SceneWriter
 guideStep?:string
 guideBusy?:boolean
 guideFailed?:boolean
 reducedMotionOverride?:boolean
 performancePreviewTime?:number
 onGuideComplete?:()=>Promise<void>
 onGuideRefresh?:()=>void
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

function LifeStoryCamera({drinkLayout}:{drinkLayout?:SharedDrinkLayout}){
 const size=useThree(state=>state.size)
 if(drinkLayout){
  // Fit the entire approach/exit lane as well as the seats. A width-only
  // breakpoint cropped the departing resident on tall mobile canvases.
  const aspect=size.width/Math.max(1,size.height)
  const target=drinkLayout.target,base=drinkLayout.cameraPosition,factor=Math.max(size.width<600?1.18:1,Math.min(1.65,1.65/aspect))
  const position=base.map((value,index)=>target[index]+(value-target[index])*factor) as [number,number,number]
  return <PerspectiveCamera makeDefault position={position} onUpdate={camera=>camera.lookAt(...target)} fov={37} near={.1} far={45}/>
 }
 return <PerspectiveCamera makeDefault position={[0,2.35,size.width<600?9.5:7.8]} onUpdate={camera=>camera.lookAt(0,1.05,.15)} fov={37} near={.1} far={35}/>
}

function LifeStoryCast3D({story,participants,avatars,reducedMotion,theme,layoutRoom,activeBeat,previewTime}:{story:LifeStory;participants:{id:string;name:string}[];avatars?:Record<string,AvatarConfig>;reducedMotion:boolean;theme:InteriorTheme;language:LifeLanguage;layoutRoom?:WorldLayoutRoom;activeBeat?:LifeStoryBeat;previewTime?:number}){
 const visualBudget=useVisualBudget()
 const cast=participants.slice(0,3),count=cast.length
 const cafeDrink=isCafeDrinkStory(story)
 const drinkLayout=useMemo(()=>cafeDrink?CAFE_DRINK_RIG:resolveSharedDrinkLayout(layoutRoom?.placements),[cafeDrink,layoutRoom?.placements])
 const staging=story.presentation?.staging
 const drink=isSharedDrinkStage(staging)&&(cafeDrink||theme==='home_lounge')&&drinkLayout.usable&&staging.participant_ids.every(id=>participants.some(person=>person.id===id))
 const castAvatars=Object.fromEntries(cast.map((person,index)=>[person.id,avatars?.[person.id]??fallbackAvatar(person.id,index)]))
 return <div className="life-story-encounter__cast-3d" aria-hidden>
  <Canvas dpr={visualBudget.dpr} shadows="percentage" gl={{antialias:true,alpha:true,powerPreference:'low-power'}}>
   <LifeStoryCamera drinkLayout={drink?drinkLayout:undefined}/>
   <SceneLook/><SceneLighting portrait/><AdaptiveResolution onTier={visualBudget.onTier}/>
   <Suspense fallback={null}><IndoorEnvironment3D theme={theme} placements={layoutRoom?.placements}/></Suspense>
   {drink&&cafeDrink&&<CafeDrinkFurniture3D cups={false}/>}
   {drink?<SharedDrinkPerformance3D key={story.id} staging={staging} participants={cast} participantAvatars={castAvatars} activeBeat={activeBeat} reducedMotion={reducedMotion} placements={layoutRoom?.placements} layoutOverride={cafeDrink?drinkLayout:undefined} previewTime={previewTime}/>:cast.map((person,index)=><EncounterResident3D key={person.id} story={story} person={person} index={index} count={count} avatar={castAvatars[person.id]} activeBeat={activeBeat} reducedMotion={reducedMotion}/>)}
   <ContactShadows position={[0,-.24,.15]} opacity={.29} scale={7.4} blur={2.5} far={4}/>
  </Canvas>
 </div>
}

export function LifeStoryEncounter({story,language='zh',locationName,participantAvatars,layoutRooms=[],onClose,onObserve,onIntervene,onDialogue,guideStep,guideBusy,guideFailed,onGuideComplete,onGuideRefresh,reducedMotionOverride,performancePreviewTime}:Props){
 const systemReducedMotion=useReducedMotion(),reduce=reducedMotionOverride??systemReducedMotion,closeRef=useRef<HTMLButtonElement>(null),storyIdRef=useRef(story.id)
 const [current,setCurrent]=useState(story),[busy,setBusy]=useState(''),[error,setError]=useState(''),[observedLocally,setObservedLocally]=useState(Boolean(story.observed_at)),[revealedBeatCount,setRevealedBeatCount]=useState(reduce?(story.presentation?.beats?.length??0):Math.min(1,story.presentation?.beats?.length??0))
 useEffect(()=>{const changed=storyIdRef.current!==story.id;storyIdRef.current=story.id;setCurrent(story);setObservedLocally(Boolean(story.observed_at));if(changed){setError('');setRevealedBeatCount(reduce?(story.presentation?.beats?.length??0):Math.min(1,story.presentation?.beats?.length??0))}},[reduce,story])
 const dialogue=useSceneDialogue(current,onDialogue)
 const presentation=useMemo(()=>dialogue.enabled?{...current.presentation,...dialogue.result?.presentation,beats:dialogue.result?.presentation.beats??[]}:current.presentation,[current.presentation,dialogue.enabled,dialogue.result?.presentation])
 useEffect(()=>{setRevealedBeatCount(1)},[dialogue.key,dialogue.result?.cache_key])
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
 const interiorTheme=useMemo(()=>interiorThemeFor({locationId:current.location_id??current.presentation?.location?.id,hint:[current.title,current.title_zh,current.summary,current.summary_zh,current.presentation?.subject,current.presentation?.subject_zh].filter(Boolean).join(' ')}),[current.location_id,current.presentation?.location?.id,current.presentation?.subject,current.presentation?.subject_zh,current.summary,current.summary_zh,current.title,current.title_zh])
 const interiorCopy=INTERIOR_THEME_COPY[interiorTheme][language]
 const authoredRoomKind=interiorTheme==='home_kitchen'?'kitchen':interiorTheme==='home_bathroom'?'bathroom':interiorTheme==='home_bedroom'?'bedroom':'living_room'
 const authoredRoom=current.household_id&&interiorTheme.startsWith('home_')?layoutRooms.find(room=>room.kind===authoredRoomKind):undefined
 const beats=useMemo(()=>dialogue.result?.source==='fallback'?[]:presentation?.beats??[],[dialogue.result?.source,presentation?.beats])
 const visibleBeats=reduce?beats:beats.slice(0,revealedBeatCount)
 const activeBeat=visibleBeats.at(-1)
 const actingBeat=useTimedStoryBeat(`${current.id}:${dialogue.result?.cache_key??''}`,activeBeat,Boolean(reduce))
 // An AI request or long exchange must not consume a limited intervention window.
 const performanceComplete=dialogue.enabled||revealedBeatCount>=beats.length
 const choicesRef=useRef<HTMLDivElement>(null)
 const autoWitnessed=useRef(new Set<string>())
 // Watching is a player-facing read receipt, never a command to create NPC memory.
 useEffect(()=>{
  if(!terminal||!canObserve||guideStep||dialogue.loading||revealedBeatCount<beats.length||autoWitnessed.current.has(current.id))return
  autoWitnessed.current.add(current.id)
  let active=true
  void onObserve(current).then(result=>{if(active){setCurrent(result);setObservedLocally(true)}}).catch(()=>{
   // A failed read receipt must not block the scene or invent a memory.
  })
  return()=>{active=false}
 },[terminal,canObserve,guideStep,dialogue.loading,revealedBeatCount,beats.length,current,onObserve])

 useEffect(()=>{
  if(reduce){setRevealedBeatCount(beats.length);return}
  if(!beats.length||revealedBeatCount>=beats.length)return
  const active=beats[Math.max(0,revealedBeatCount-1)]
  const delay=Math.max(900,Math.min(active?.duration_ms??2400,4200))
  const timer=window.setTimeout(()=>setRevealedBeatCount(value=>Math.min(beats.length,value+1)),delay)
  return()=>window.clearTimeout(timer)
 },[beats,reduce,revealedBeatCount])

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
  try{const result=await onIntervene(current,action);setCurrent(result);setObservedLocally(true)}
  catch{setError(language==='zh'?'这次选择没有生效，事件可能已经继续发展了。':'That choice was not applied; the situation may have moved on.')}
  finally{setBusy('')}
 }
 return <motion.div className="life-story-encounter" role="dialog" aria-modal="true" aria-labelledby="life-story-title" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose()}}>
  <motion.article initial={reduce?false:{opacity:0,y:26,scale:.965}} animate={{opacity:1,y:0,scale:1}} exit={reduce?{opacity:0}:{opacity:0,y:18,scale:.98}} transition={{type:'spring',stiffness:270,damping:27}}>
   <header>
    <div><small>{levelLabel(current,language)}{locationName?` · ${locationName}`:''}</small><h2 id="life-story-title">{title.primary}</h2></div>
    <button ref={closeRef} type="button" onClick={onClose} disabled={Boolean(busy)} aria-label={language==='zh'?'关闭事件详情':'Close story details'}>×</button>
   </header>
   <StoryCompletionNotice story={current} language={language} ready={terminal&&!dialogue.loading&&(reduce||revealedBeatCount>=beats.length)} delay={beats.length?Math.min(4200,Math.max(1800,activeBeat?.duration_ms??2400)):300}/>
   <div className="life-story-encounter__scroll">
   <section className="life-story-encounter__scene" data-interior-theme={interiorTheme}>
    <span className="life-story-encounter__scene-kind">{interiorCopy}</span>
    <div className="life-story-encounter__cast" aria-label={language==='zh'?'参与者':'Participants'}>
     <LifeStoryCast3D story={{...current,presentation}} participants={participants} avatars={participantAvatars} reducedMotion={Boolean(reduce)} theme={interiorTheme} language={language} layoutRoom={authoredRoom} activeBeat={actingBeat} previewTime={performancePreviewTime}/>
     <div className="life-story-encounter__cast-names is-accessible-only">{participants.slice(0,3).map(person=><b key={person.id}>{person.name}{ROLE_COPY[dialogue.result?.roles[person.id]??'']&&<small>{ROLE_COPY[dialogue.result?.roles[person.id]??''][language==='zh'?0:1]}</small>}</b>)}</div>
     {participants.length>3&&<span className="life-story-encounter__more">+{participants.length-3}</span>}
    </div>
   </section>
   <section className="life-story-encounter__body">
    <p className="life-story-encounter__context">{conciseSceneContext(summary.primary)}</p>
    {guideStep&&<section className="life-story-encounter__guide" aria-label={language==='zh'?'引导提示':'Guide hint'}><p>{language==='zh'?(guideStep==='result'?'看看他们的回应。':'听听他们怎么说，再选一个回应。'):(guideStep==='result'?'See how they responded.':'Listen, then choose a response.')}</p>{guideFailed&&<button type="button" disabled={guideBusy} onClick={onGuideRefresh}>{language==='zh'?'重试同步':'Retry sync'}</button>}</section>}


    {current.level==='thread'&&aftermath.primary&&<div className="life-story-encounter__thread-note"><b>{language==='zh'?'目前留下的痕迹':'What remains so far'}</b><p>{aftermath.primary}</p></div>}
    {beats.length>0&&<div className="life-story-encounter__beats" aria-live="polite"><AnimatePresence initial={false}>{visibleBeats.map((beat,index)=>{const personIndex=participants.findIndex(item=>item.id===beat.speaker_id),person=personIndex>=0?participants[personIndex]:undefined,english=beat.text?.trim()||beat.translation_zh?.trim()||'',translation=language==='zh'&&beat.translation_zh?.trim()!==english?beat.translation_zh?.trim():'';return <motion.blockquote key={beat.id??`${beat.speaker_id??'narrator'}-${index}`} className={`${personIndex%2===1?'is-right ':''}${index===visibleBeats.length-1?'is-active':''}`} initial={reduce?false:{opacity:0,y:14,scale:.975}} animate={{opacity:1,y:0,scale:1}} transition={{type:'spring',stiffness:320,damping:27}}><b>{person?.name??(language==='zh'?'现场':'At the scene')}{beat.addressee_id&&<small> → {participants.find(item=>item.id===beat.addressee_id)?.name}</small>}</b><p lang="en">{english}</p>{translation&&<small lang="zh-CN">{translation}</small>}</motion.blockquote>})}</AnimatePresence></div>}
    {dialogue.enabled&&(dialogue.loading||dialogue.failed||dialogue.result?.source==='fallback')&&<div className="life-story-encounter__writer" role="status">{dialogue.loading?<><span>{language==='zh'?'对话加载中…':'Loading dialogue…'}</span><button type="button" onClick={dialogue.cancel}>{language==='zh'?'跳过等待':'Skip waiting'}</button></>:dialogue.result?.reason==='budget'&&dialogue.result.retryable===false?(language==='zh'?'今日对白额度已用完':'Daily dialogue limit reached'):<><span>{dialogue.failure==='timeout'?(language==='zh'?'连接超时':'Connection timed out'):dialogue.failure==='changed'?(language==='zh'?'事情有了新进展':'The situation has changed'):dialogue.failure==='cancelled'?(language==='zh'?'已跳过对白':'Dialogue skipped'):(language==='zh'?'对白未加载':'Dialogue unavailable')}</span><button type="button" onClick={dialogue.retry}>{language==='zh'?'重试':'Retry'}</button></>}</div>}
    <div ref={choicesRef}/><AnimatePresence mode="wait" initial={false}>
     {performanceComplete&&!terminal&&<motion.div key="open" className="life-story-encounter__choices" initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-6}}>
      {canObserve&&<button type="button" className="life-story-encounter__observe" disabled={Boolean(busy)} onClick={()=>void observe()}><span aria-hidden>◉</span><b>{busy==='observe'?(language==='zh'?'正在记录…':'Recording…'):(language==='zh'?'观察这一刻':'Witness this moment')}</b></button>}
      {current.status==='awaiting_management'&&current.management?.can_intervene&&options.length>0&&<section className="life-story-encounter__management"><header><h3>{language==='zh'?'你想怎么回应？':'Your response?'}</h3></header><div>{options.map(option=><button type="button" disabled={Boolean(busy)} key={option.id} title={option.description} onClick={()=>void intervene(option.id)}><b>{busy===option.id?'…':option.label}</b><i aria-hidden>›</i></button>)}</div></section>}

     </motion.div>}
     {terminal&&!guideStep&&<button type="button" className="life-story-encounter__guide-complete" onClick={onClose}>{language==='zh'?'返回城市':'Back to city'}</button>}
    </AnimatePresence>
    {error&&<p className="life-story-encounter__error" role="alert">{error}</p>}
   </section>
   </div>
   {guideStep&&<footer className="life-story-encounter__next" aria-label={language==='zh'?'引导下一步':'Next guide step'}>
    <small aria-live="polite">{guideFailed?(language==='zh'?'同步失败':'Sync failed'):terminal?(language==='zh'?'看看后续':'See what happened'):observed?(language==='zh'?'等待后续':'Waiting for the outcome'):language==='zh'?'选择下一步':'Choose your next step'}</small>
    {guideFailed?<button disabled={guideBusy} onClick={onGuideRefresh}>{language==='zh'?'重试同步':'Retry sync'}</button>:guideStep==='result'?<button disabled={guideBusy} onClick={()=>void onGuideComplete?.()}>{language==='zh'?'我看到了后果 · 完成引导':'I see the consequences · Finish guide'}</button>:canObserve?<button disabled={Boolean(busy)||Boolean(guideBusy)||(!terminal&&!performanceComplete)} onClick={()=>void observe()}>{busy?(language==='zh'?'正在同步…':'Syncing…'):terminal?(language==='zh'?'查看结果':'See what happened'):!performanceComplete?(language==='zh'?'正在观看交流…':'Watching the exchange…'):language==='zh'?'继续观察':'Keep watching'}</button>:<button onClick={onClose}>{language==='zh'?'继续逛城市，等待结果':'Explore while the outcome unfolds'}</button>}
    {!terminal&&performanceComplete&&current.management?.can_intervene&&options.length>0&&<button className="is-secondary" onClick={()=>choicesRef.current?.scrollIntoView({behavior:reduce?'instant':'smooth',block:'start'})}>{language==='zh'?'看看可以怎么帮忙':'See ways to help'}</button>}
   </footer>}
  </motion.article>
 </motion.div>
}

export default LifeStoryEncounter
