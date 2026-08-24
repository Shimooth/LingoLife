import {Canvas,useFrame,useThree} from '@react-three/fiber'
import {Suspense,useCallback,useEffect,useMemo,useRef,useState} from 'react'
import * as THREE from 'three'
import type {CityCharacter,CityLandmark} from '../../components/CityMap'
import {WorldErrorBoundary,supportsWebGL} from './WorldErrorBoundary'
import {WorldEffects} from './WorldEffects'
import {WorldScene,type WorldQuality,type WorldViewMode} from './WorldScene'
import {DEFAULT_WORLD_LANDMARKS,hashString,worldPosition,type TimeSlot,type WorldPoint} from './worldData'
import './world.css'

export type WorldObserver3DProps={
 characters:readonly CityCharacter[]
 landmarks?:readonly CityLandmark[]
 followedCharacterId?:string
 activeLandmarkId?:string
 serverTime?:string
 language?:'zh'|'en'
 timeSlot?:TimeSlot
 quality?:WorldQuality
 showPlaceCard?:boolean
 onCharacterFollow:(id?:string)=>void
 onCharacterInteract:(id:string)=>void
 onEventOpen?:(eventId:string)=>void
 onJourneyElapsed?:()=>void
 onLandmarkClick?:(landmark:CityLandmark)=>void
 className?:string
}

const HIGH_DPR:[number,number]=[1,1.75]
const LOW_DPR:[number,number]=[1,1.25]
const WEBGL_OPTIONS={antialias:true,alpha:false,powerPreference:'high-performance' as const}

type Copy={
 title:string;subtitle:string;loading:string;warming:string;overview:string;top:string;isometric:string;quality:string
 instructions:string;fallbackTitle:string;fallbackBody:string;places:string;residents:string;close:string
 emptyResidents:string;viewPlace:string;talk:string;follow:string;viewEvent:string;district:string;retry:string;useList:string
 status:{idle:string;event_pending:string;walking_to_event:string;waiting_at_event:string};time:Record<TimeSlot,string>
}

const COPY:Record<'zh'|'en',Copy>={
 zh:{title:'LingoLife 天空之城',subtitle:'观察云端城市，选择地点或居民',loading:'正在穿过云层…',warming:'城市即将出现',overview:'全城概况',top:'俯瞰',isometric:'微缩',quality:'画质',instructions:'拖动旋转 · 滚轮或双指缩放 · 右键平移',fallbackTitle:'暂时无法显示 3D 城市',fallbackBody:'当前浏览器或设备未能启动 WebGL。你仍然可以从下面选择地点和居民。',places:'城市地点',residents:'居民视角',close:'关闭详情',emptyResidents:'居民正在陆续搬来',viewPlace:'查看地点',talk:'与角色对话',follow:'跟随视角',viewEvent:'查看互动事件',district:'街区',retry:'重试 3D',useList:'使用列表',status:{idle:'空闲',event_pending:'有件事想做',walking_to_event:'正在前往事件',waiting_at_event:'已到达 · 等待查看'},time:{morning:'清晨',afternoon:'午后',evening:'夜晚'}},
 en:{title:'LingoLife Sky City',subtitle:'Observe the city above the clouds',loading:'Passing through the clouds…',warming:'The city is almost here',overview:'City overview',top:'Top view',isometric:'Miniature',quality:'Quality',instructions:'Drag to orbit · wheel or pinch to zoom · right-drag to pan',fallbackTitle:'The 3D city is unavailable',fallbackBody:'WebGL could not start on this browser or device. You can still choose a place or resident below.',places:'City places',residents:'Resident views',close:'Close details',emptyResidents:'New residents are on their way',viewPlace:'View place',talk:'Talk to resident',follow:'Follow view',viewEvent:'Watch interaction',district:'District',retry:'Retry 3D',useList:'Use list',status:{idle:'Idle',event_pending:'Something to do',walking_to_event:'Walking to an event',waiting_at_event:'Arrived · waiting'},time:{morning:'Morning',afternoon:'Afternoon',evening:'Evening'}},
}

function WorldFallback({characters,landmarks,language,onCharacterInteract,onLandmarkClick}:Pick<WorldObserver3DProps,'characters'|'language'|'onCharacterInteract'|'onLandmarkClick'>&{landmarks:readonly CityLandmark[]}){
 const copy=COPY[language??'zh']
 return <div className="world3d-fallback" role="status">
  <div className="world3d-fallback__message"><span aria-hidden>☁️</span><div><h3>{copy.fallbackTitle}</h3><p>{copy.fallbackBody}</p></div></div>
  <div className="world3d-fallback__lists">
   <section><h4>{copy.places}</h4><div>{landmarks.map(place=><button type="button" key={place.id} onClick={()=>onLandmarkClick?.(place)}><span aria-hidden>⌂</span><b>{place.name}</b><small>{copy.viewPlace} →</small></button>)}</div></section>
   <section><h4>{copy.residents}</h4>{characters.length?<div>{characters.map(character=><button type="button" key={character.id} onClick={()=>onCharacterInteract(character.id)}><span className="world3d-fallback__avatar" aria-hidden>{character.name.slice(0,1)}</span><b>{character.name}</b><small>{copy.talk} →</small></button>)}</div>:<p>{copy.emptyResidents}</p>}</section>
  </div>
 </div>
}

function SceneFrameGate({onReady}:{onReady:()=>void}){
 const frameCount=useRef(0),reported=useRef(false)
 const invalidate=useThree(state=>state.invalidate)
 useEffect(()=>{invalidate()},[invalidate])
 useFrame(()=>{
  if(reported.current)return
  frameCount.current+=1
  if(frameCount.current>=3){reported.current=true;onReady();return}
  invalidate()
 })
 return null
}

type IntroVariant='cloud-gate'|'cloud-road'|'rise'|'quick'
type IntroPhase='loading'|'revealing'|'entered'|'failed'

function chooseIntroVariant():IntroVariant{
 if(typeof window==='undefined')return 'cloud-gate'
 try{
  if(sessionStorage.getItem('lingolife.world-intro-played'))return 'quick'
  const variants:IntroVariant[]=['cloud-gate','cloud-road','rise']
  const index=Number(localStorage.getItem('lingolife.world-intro-index')||'0')%variants.length
  localStorage.setItem('lingolife.world-intro-index',String(index+1))
  return variants[index]
 }catch{return 'cloud-gate'}
}

function WorldIntro({phase,variant,copy,reducedMotion,onRetry,onFallback}:{phase:IntroPhase;variant:IntroVariant;copy:Copy;reducedMotion:boolean;onRetry:()=>void;onFallback:()=>void}){
 if(phase==='entered')return null
 return <div className={`world3d-intro is-${phase} is-${variant} ${reducedMotion?'is-reduced':''}`} role="status" aria-live="polite">
  <div className="world3d-intro__sky"/>
  <div className="world3d-intro__road" aria-hidden><i/><i/></div>
  <div className="world3d-intro__clouds is-left" aria-hidden><i/><i/><i/></div>
  <div className="world3d-intro__clouds is-right" aria-hidden><i/><i/><i/></div>
  <div className="world3d-intro__brand">
   <span className="world3d-intro__mark" aria-hidden><i/><i/><i/><i/><i/></span>
   <b>LingoLife</b><small>{phase==='loading'?copy.loading:phase==='revealing'?copy.warming:copy.fallbackTitle}</small>
   {phase==='loading'&&<em aria-hidden><i/><i/><i/></em>}
   {phase==='failed'&&<div><button type="button" onClick={onRetry}>{copy.retry}</button><button type="button" onClick={onFallback}>{copy.useList}</button></div>}
  </div>
 </div>
}

export function WorldObserver3D({characters,landmarks=DEFAULT_WORLD_LANDMARKS,followedCharacterId,activeLandmarkId,serverTime,language='zh',timeSlot='afternoon',quality:qualityMode='auto',showPlaceCard=true,onCharacterFollow,onCharacterInteract,onEventOpen,onJourneyElapsed,onLandmarkClick,className=''}:WorldObserver3DProps){
 const copy=COPY[language]
 const reducedMotion=useMemo(()=>typeof window!=='undefined'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches,[])
 const [webglAvailable,setWebglAvailable]=useState(supportsWebGL)
 const [sceneReady,setSceneReady]=useState(false),[introPhase,setIntroPhase]=useState<IntroPhase>('loading')
 const [introVariant]=useState<IntroVariant>(chooseIntroVariant)
 const quality=qualityMode==='low'?'low':'high'
 const postProcessing=useMemo(()=>{
  if(typeof window==='undefined'||quality==='low')return false
  const coarsePointer=window.matchMedia('(pointer: coarse)').matches
  const concurrency=navigator.hardwareConcurrency||4
  const memory=(navigator as Navigator&{deviceMemory?:number}).deviceMemory??8
  return !coarsePointer&&concurrency>=6&&memory>=4
 },[quality])
 const [selectedLandmark,setSelectedLandmark]=useState<CityLandmark|null>(null)
 const [dismissedActiveLandmarkId,setDismissedActiveLandmarkId]=useState<string>()
 const previousActiveLandmarkId=useRef(activeLandmarkId)
 const [focus,setFocus]=useState<WorldPoint|null>(null)
 const [focusVersion,setFocusVersion]=useState(0)
 const [viewMode,setViewMode]=useState<WorldViewMode>('isometric')
 const activeLandmark=useMemo(()=>landmarks.find(landmark=>landmark.id===activeLandmarkId)??null,[activeLandmarkId,landmarks])
 const activeLandmarkX=activeLandmark?.x,activeLandmarkY=activeLandmark?.y
 const externalFocus=useMemo(()=>activeLandmarkX!==undefined&&activeLandmarkY!==undefined&&activeLandmarkId!==dismissedActiveLandmarkId?worldPosition(activeLandmarkX,activeLandmarkY,.5):null,[activeLandmarkId,activeLandmarkX,activeLandmarkY,dismissedActiveLandmarkId])
 const displayedLandmark=selectedLandmark??(activeLandmarkId!==dismissedActiveLandmarkId?activeLandmark:null)
 const followedCharacter=characters.find(character=>character.id===followedCharacterId)

 const revealScene=useCallback(()=>setSceneReady(true),[])
 useEffect(()=>{
  if(!sceneReady)return
  setIntroPhase('revealing')
  const duration=reducedMotion?80:introVariant==='quick'?260:introVariant==='cloud-road'?1450:introVariant==='rise'?1250:1050
  const timer=window.setTimeout(()=>{setIntroPhase('entered');try{sessionStorage.setItem('lingolife.world-intro-played','1')}catch{/* storage optional */}},duration)
  return()=>window.clearTimeout(timer)
 },[introVariant,reducedMotion,sceneReady])
 useEffect(()=>{
  if(sceneReady)return
  const timer=window.setTimeout(()=>setIntroPhase('failed'),12000)
  return()=>window.clearTimeout(timer)
 },[sceneReady])
 useEffect(()=>{
  if(previousActiveLandmarkId.current===activeLandmarkId)return
  previousActiveLandmarkId.current=activeLandmarkId;setDismissedActiveLandmarkId(undefined);setSelectedLandmark(null)
 },[activeLandmarkId])

 const moveCamera=useCallback((next:WorldPoint|null)=>{setFocus(next);setFocusVersion(version=>version+1)},[])
 const selectLandmark=useCallback((landmark:CityLandmark)=>{
  onCharacterFollow(undefined);setDismissedActiveLandmarkId(activeLandmarkId);setSelectedLandmark(landmark);moveCamera(worldPosition(landmark.x,landmark.y,.5));onLandmarkClick?.(landmark)
 },[activeLandmarkId,moveCamera,onCharacterFollow,onLandmarkClick])
 const selectCharacter=useCallback((id:string)=>{setDismissedActiveLandmarkId(activeLandmarkId);setSelectedLandmark(null);moveCamera(null);onCharacterFollow(id)},[activeLandmarkId,moveCamera,onCharacterFollow])
 const showOverview=()=>{onCharacterFollow(undefined);setDismissedActiveLandmarkId(activeLandmarkId);setSelectedLandmark(null);moveCamera(null)}
 const toggleView=()=>{setViewMode(mode=>mode==='isometric'?'top':'isometric');setFocusVersion(version=>version+1)}
 const openCharacterEvent=(character:CityCharacter)=>{const id=character.worldAction?.event_id;if(id&&character.worldAction?.state!=='event_pending')onEventOpen?.(id)}

 if(!webglAvailable)return <section className={`world3d-shell is-fallback ${className}`} aria-label={copy.title}><WorldFallback characters={characters} landmarks={landmarks} language={language} onCharacterInteract={onCharacterInteract} onLandmarkClick={onLandmarkClick}/></section>

 return <WorldErrorBoundary fallback={()=> <section className={`world3d-shell is-fallback ${className}`} aria-label={copy.title}><WorldFallback characters={characters} landmarks={landmarks} language={language} onCharacterInteract={onCharacterInteract} onLandmarkClick={onLandmarkClick}/></section>}>
  <section className={`world3d-shell world3d-shell--${timeSlot} ${className}`} aria-label={copy.title} data-quality={quality}>
   <span className="world3d-time world3d-time--floating"><i aria-hidden>{timeSlot==='morning'?'☀':timeSlot==='afternoon'?'◐':'☾'}</i>{copy.time[timeSlot]}</span>
   <div className="world3d-stage">
    <WorldIntro phase={introPhase} variant={introVariant} copy={copy} reducedMotion={reducedMotion} onRetry={()=>window.location.reload()} onFallback={()=>setWebglAvailable(false)}/>
    <Canvas orthographic camera={{position:[38,36,44],zoom:25,near:.1,far:180}} dpr={quality==='high'?HIGH_DPR:LOW_DPR} shadows={quality==='high'} frameloop={reducedMotion?'demand':'always'} gl={WEBGL_OPTIONS}
     onCreated={({gl})=>{gl.setClearColor(timeSlot==='evening'?'#21384f':timeSlot==='morning'?'#579bb9':'#3f86aa',1);gl.outputColorSpace='srgb';gl.toneMapping=THREE.ACESFilmicToneMapping;gl.toneMappingExposure=.88;gl.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();setWebglAvailable(false)},{once:true})}}
     onPointerMissed={()=>setSelectedLandmark(null)} fallback={<WorldFallback characters={characters} landmarks={landmarks} language={language} onCharacterInteract={onCharacterInteract} onLandmarkClick={onLandmarkClick}/>}>
     <Suspense fallback={null}>
      <WorldEffects timeSlot={timeSlot} quality={quality} reducedMotion={reducedMotion} postProcessing={postProcessing}/>
      <WorldScene characters={characters} landmarks={landmarks.slice(0,40)} followedCharacterId={followedCharacterId} serverTime={serverTime} language={language} timeSlot={timeSlot} reducedMotion={reducedMotion} selectedLandmarkId={activeLandmarkId!==dismissedActiveLandmarkId?activeLandmarkId:selectedLandmark?.id} focus={externalFocus??focus} focusVersion={focusVersion+(activeLandmarkId!==dismissedActiveLandmarkId&&activeLandmarkId?hashString(activeLandmarkId):0)} viewMode={viewMode} quality={quality} onCharacterClick={selectCharacter} onCharacterEvent={eventId=>onEventOpen?.(eventId)} onJourneyElapsed={onJourneyElapsed} onLandmarkSelect={selectLandmark}/>
      <SceneFrameGate onReady={revealScene}/>
     </Suspense>
    </Canvas>
    <nav className="world3d-resident-dock" aria-label={copy.residents}>
     <button type="button" className={!followedCharacterId?'is-active':''} onClick={showOverview}><span aria-hidden>⌂</span><b>{copy.overview}</b></button>
     {characters.map(character=><button type="button" key={character.id} className={character.id===followedCharacterId?'is-active':''} onClick={()=>selectCharacter(character.id)}><span aria-hidden>{character.name.slice(0,1)}<i data-state={character.worldAction?.state??'idle'}/></span><b>{character.name}</b><small>{copy.status[character.worldAction?.state??'idle']}</small></button>)}
    </nav>
    <div className="world3d-controls" aria-label={copy.title}><button type="button" onClick={showOverview} className={!focus&&!externalFocus&&!followedCharacterId?'is-active':''}><span aria-hidden>⌂</span>{copy.overview}</button><button type="button" onClick={toggleView}><span aria-hidden>{viewMode==='isometric'?'⊤':'◇'}</span>{viewMode==='isometric'?copy.top:copy.isometric}</button></div>
    {followedCharacter&&<aside className="world3d-follow-card"><button className="world3d-follow-card__close" type="button" onClick={showOverview} aria-label={copy.close}>×</button><span aria-hidden>{followedCharacter.name.slice(0,1)}<i data-state={followedCharacter.worldAction?.state??'idle'}/></span><div><small>{copy.follow}</small><h3>{followedCharacter.name}</h3><p>{copy.status[followedCharacter.worldAction?.state??'idle']}{followedCharacter.location.place?` · ${followedCharacter.location.place}`:''}</p><nav><button type="button" onClick={()=>onCharacterInteract(followedCharacter.id)}>{copy.talk}</button>{followedCharacter.worldAction?.event_id&&followedCharacter.worldAction.state!=='event_pending'&&<button type="button" className="is-event" onClick={()=>openCharacterEvent(followedCharacter)}>{copy.viewEvent}</button>}</nav></div></aside>}
    <div className="world3d-quality" title={`${copy.quality}: ${quality}`} aria-hidden><i/><i className={quality==='high'?'is-on':''}/><i className={quality==='high'?'is-on':''}/></div>
    <p className="world3d-instructions">{copy.instructions}</p>
    <div className="world3d-district-key" aria-hidden>{['west','north','central','east','south','harbor'].map(district=><i key={district} className={`is-${district}`}/>)}</div>
    {showPlaceCard&&displayedLandmark&&<aside className="world3d-place-card" aria-live="polite"><button type="button" className="world3d-place-card__close" onClick={()=>{setDismissedActiveLandmarkId(activeLandmarkId);setSelectedLandmark(null)}} aria-label={copy.close}>×</button><span className={`world3d-place-card__icon is-${displayedLandmark.kind}`} aria-hidden>{displayedLandmark.kind==='nature'?'✦':'⌂'}</span><div><small>{copy.district} · {displayedLandmark.district||displayedLandmark.kind}</small><h3>{displayedLandmark.name}</h3><button type="button" onClick={()=>selectLandmark(displayedLandmark)}>{copy.viewPlace}<span aria-hidden> →</span></button></div></aside>}
   </div>
   <div className="world3d-sr-summary"><h3>{copy.places}</h3><ul>{landmarks.map(place=><li key={place.id}><button type="button" onClick={()=>selectLandmark(place)}>{place.name}</button></li>)}</ul><h3>{copy.residents}</h3><ul>{characters.map(character=><li key={character.id}><button type="button" onClick={()=>selectCharacter(character.id)}>{character.name}</button></li>)}</ul></div>
  </section>
 </WorldErrorBoundary>
}

export default WorldObserver3D
