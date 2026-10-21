import type {NeighborhoodFacilities,NeighborhoodFacilityFocus} from '../../neighborhood/NeighborhoodLandmarks3D'
import {Canvas,useFrame,useThree} from '@react-three/fiber'
import {Suspense,useCallback,useEffect,useMemo,useRef,useState} from 'react'
import * as THREE from 'three'
import type {CityCharacter,CityLandmark} from '../../components/CityMap'
import {WorldErrorBoundary,supportsWebGL} from './WorldErrorBoundary'
import {WorldEffects} from './WorldEffects'
import {WorldScene,type WorldQuality,type WorldViewMode} from './WorldScene'
import {DEFAULT_WORLD_LANDMARKS,hashString,worldPosition,type TimeSlot,type WorldPoint} from './worldData'
import {ResidentActionLabel} from '../../components/ResidentActionLabel'
import {TroubleBubble} from '../../components/TroubleBubble'
import {visibleOnCityMap} from '../../life/spatialPresence'
import './world.css'
import type {WorldLayoutDocument} from '../../worldLayout'
import {AdaptiveResolution} from '../rendering/SceneLook'
import {initialQuality,VISUAL_BUDGETS,type VisualTier} from '../rendering/visualQuality'
import {CharacterPortrait} from '../../components/CharacterPortrait'
import {useResidentDrag} from './residentDrag'

export type WorldObserver3DProps={
 characters:readonly CityCharacter[]
 landmarks?:readonly CityLandmark[]
 followedCharacterId?:string
 activeLandmarkId?:string
 serverTime?:string
 language?:'zh'|'en'
 timeSlot?:TimeSlot
 quality?:WorldQuality
 layout?:WorldLayoutDocument
 neighborhood?:NeighborhoodFacilities
 paused?:boolean
 showPlaceCard?:boolean
 onCharacterFollow:(id?:string)=>void
 onCharacterInteract:(id:string)=>void
 onResidentsMeet?:(sourceId:string,targetId:string)=>void|Promise<void>
 residentMeetingBusy?:boolean
 onEventOpen?:(eventId:string)=>void
 onTroubleOpen?:(characterId:string)=>void
 onHouseholdOpen?:(householdId:string,npcId?:string)=>void
 onJourneyElapsed?:()=>void
 onLandmarkClick?:(landmark:CityLandmark)=>void
 className?:string
}

const WEBGL_OPTIONS={antialias:true,alpha:false,powerPreference:'high-performance' as const}

type Copy={
 title:string;subtitle:string;loading:string;warming:string;overview:string;top:string;isometric:string;quality:string
 instructions:string;fallbackTitle:string;fallbackBody:string;places:string;residents:string;close:string
 emptyResidents:string;viewPlace:string;talk:string;follow:string;viewEvent:string;district:string;retry:string;useList:string
 status:{idle:string;living:string;event_pending:string;walking_to_event:string;waiting_at_event:string};time:Record<TimeSlot,string>
}

const COPY:Record<'zh'|'en',Copy>={
 zh:{title:'LingoLife 天空之城',subtitle:'观察云端城市，选择地点或居民',loading:'正在穿过云层…',warming:'城市即将出现',overview:'全城概况',top:'俯瞰',isometric:'微缩',quality:'画质',instructions:'拖动旋转 · 滚轮或双指缩放 · 右键平移',fallbackTitle:'暂时无法显示 3D 城市',fallbackBody:'当前浏览器或设备未能启动 WebGL。你仍然可以从下面选择地点和居民。',places:'城市地点',residents:'居民视角',close:'关闭详情',emptyResidents:'居民正在陆续搬来',viewPlace:'查看地点',talk:'与角色对话',follow:'跟随视角',viewEvent:'查看互动事件',district:'街区',retry:'重试 3D',useList:'使用列表',status:{idle:'空闲',living:'正在生活',event_pending:'有件事想做',walking_to_event:'正在前往事件',waiting_at_event:'已到达 · 等待查看'},time:{morning:'清晨',afternoon:'午后',evening:'夜晚'}},
 en:{title:'LingoLife Sky City',subtitle:'Observe the city above the clouds',loading:'Passing through the clouds…',warming:'The city is almost here',overview:'City overview',top:'Top view',isometric:'Miniature',quality:'Quality',instructions:'Drag to orbit · wheel or pinch to zoom · right-drag to pan',fallbackTitle:'The 3D city is unavailable',fallbackBody:'WebGL could not start on this browser or device. You can still choose a place or resident below.',places:'City places',residents:'Resident views',close:'Close details',emptyResidents:'New residents are on their way',viewPlace:'View place',talk:'Talk to resident',follow:'Follow view',viewEvent:'Watch interaction',district:'District',retry:'Retry 3D',useList:'Use list',status:{idle:'Idle',living:'Living their day',event_pending:'Something to do',walking_to_event:'Walking to an event',waiting_at_event:'Arrived · waiting'},time:{morning:'Morning',afternoon:'Afternoon',evening:'Evening'}},
}

function WorldFallback({characters,landmarks,language,neighborhood,onCharacterInteract,onLandmarkClick}:Pick<WorldObserver3DProps,'characters'|'language'|'neighborhood'|'onCharacterInteract'|'onLandmarkClick'>&{landmarks:readonly CityLandmark[]}){
 const copy=COPY[language??'zh']
 const reported=useRef('')
 useEffect(()=>{if(neighborhood?.reveal&&reported.current!==neighborhood.reveal.key){reported.current=neighborhood.reveal.key;neighborhood.onRevealComplete?.(neighborhood.reveal.facility)}},[neighborhood])
 return <div className="world3d-fallback" role="status">
  <div className="world3d-fallback__message"><span aria-hidden>☁️</span><div><h3>{copy.fallbackTitle}</h3><p>{copy.fallbackBody}</p></div></div>
  <div className="world3d-fallback__lists">
   <section><h4>{copy.places}</h4><div>{neighborhood?.fountain&&<button type="button" onClick={()=>neighborhood.onOpen('fountain')}><span aria-hidden>✧</span><b>{language==='en'?'Wishing fountain':'许愿喷泉'}</b><small>{language==='en'?'Make a wish':'点击许愿'} →</small></button>}{neighborhood?.clothingStore&&<button type="button" onClick={()=>neighborhood.onOpen('wardrobe')}><span aria-hidden>♧</span><b>{language==='en'?'Little wardrobe':'小小衣橱'}</b><small>{copy.viewPlace} →</small></button>}{landmarks.map(place=><button type="button" key={place.id} onClick={()=>onLandmarkClick?.(place)}><span aria-hidden>⌂</span><b>{place.name}</b><small>{copy.viewPlace} →</small></button>)}</div></section>
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

function WorldFrameLoopControl({paused}:{paused:boolean}){
 const invalidate=useThree(state=>state.invalidate)
 useEffect(()=>{if(!paused)invalidate()},[invalidate,paused])
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

export function WorldObserver3D({characters,landmarks=DEFAULT_WORLD_LANDMARKS,followedCharacterId,activeLandmarkId,serverTime,language='zh',timeSlot='afternoon',quality:qualityMode='auto',layout,neighborhood,paused=false,showPlaceCard=true,onCharacterFollow,onCharacterInteract,onResidentsMeet,residentMeetingBusy=false,onEventOpen,onTroubleOpen,onHouseholdOpen,onJourneyElapsed,onLandmarkClick,className=''}:WorldObserver3DProps){
 const copy=COPY[language]
 const shellRef=useRef<HTMLElement>(null)
 const reducedMotion=useMemo(()=>typeof window!=='undefined'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches,[])
 const [webglAvailable,setWebglAvailable]=useState(supportsWebGL)
 const [sceneReady,setSceneReady]=useState(false),[introPhase,setIntroPhase]=useState<IntroPhase>('loading')
 const [introVariant]=useState<IntroVariant>(chooseIntroVariant)
 const quality=qualityMode==='low'?'low':'high'
 const [visualTier,setVisualTier]=useState<VisualTier>(()=>initialQuality(qualityMode).tier)
 const postProcessing=VISUAL_BUDGETS[visualTier].postProcessing
 const [selectedLandmark,setSelectedLandmark]=useState<CityLandmark|null>(null)
 const [dismissedActiveLandmarkId,setDismissedActiveLandmarkId]=useState<string>()
 const previousActiveLandmarkId=useRef(activeLandmarkId)
 const [focus,setFocus]=useState<WorldPoint|null>(null)
 const [focusVersion,setFocusVersion]=useState(0)
 const [facilityFocus,setFacilityFocus]=useState<NeighborhoodFacilityFocus>()
 const [viewMode,setViewMode]=useState<WorldViewMode>('isometric')
 const [overviewRequested,setOverviewRequested]=useState(false)
 const hasTownCenter=layout?.city.theme==='resident-town-v1'
 const neighborhoodView=hasTownCenter&&!overviewRequested
 const sceneLandmarks=useMemo(()=>landmarks.slice(0,40),[landmarks])
 const activeLandmark=useMemo(()=>landmarks.find(landmark=>landmark.id===activeLandmarkId)??null,[activeLandmarkId,landmarks])
 const activeLandmarkX=activeLandmark?.x,activeLandmarkY=activeLandmark?.y
 const externalFocus=useMemo(()=>activeLandmarkX!==undefined&&activeLandmarkY!==undefined&&activeLandmarkId!==dismissedActiveLandmarkId?worldPosition(activeLandmarkX,activeLandmarkY,.5):null,[activeLandmarkId,activeLandmarkX,activeLandmarkY,dismissedActiveLandmarkId])
 const displayedLandmark=selectedLandmark??(activeLandmarkId!==dismissedActiveLandmarkId?activeLandmark:null)
 const followedCharacter=characters.find(character=>character.id===followedCharacterId)

 const residentIds=useMemo(()=>characters.map(character=>character.id),[characters])
 const drag=useResidentDrag({ids:residentIds,enabled:Boolean(onResidentsMeet)&&!residentMeetingBusy&&!paused&&introPhase==='entered',onMeet:onResidentsMeet})
 const held=drag.snapshot?.phase==='dragging'?drag.snapshot:null
 const heldResident=characters.find(character=>character.id===held?.sourceId),targetResident=characters.find(character=>character.id===held?.targetId)

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

 const moveCamera=useCallback((next:WorldPoint|null)=>{setFacilityFocus(undefined);setFocus(next);setFocusVersion(version=>version+1)},[])
 const revealFacility=useCallback((next:NeighborhoodFacilityFocus)=>{
  onCharacterFollow(undefined);setDismissedActiveLandmarkId(activeLandmarkId);setSelectedLandmark(null);setViewMode('isometric');setFacilityFocus(next)
 },[activeLandmarkId,onCharacterFollow])
 const selectLandmark=useCallback((landmark:CityLandmark)=>{
  onCharacterFollow(undefined);setDismissedActiveLandmarkId(activeLandmarkId);setSelectedLandmark(landmark);moveCamera(worldPosition(landmark.x,landmark.y,.5));onLandmarkClick?.(landmark)
 },[activeLandmarkId,moveCamera,onCharacterFollow,onLandmarkClick])
 const selectCharacter=useCallback((id:string)=>{
  const character=characters.find(item=>item.id===id)
  setViewMode('isometric');setDismissedActiveLandmarkId(activeLandmarkId);setSelectedLandmark(null)
  if(character&&!visibleOnCityMap(character)){
   onCharacterFollow(undefined)
   const building=landmarks.find(item=>item.id===character.spatialPresence?.building_id)
   if(building){selectLandmark(building);return}
   moveCamera(worldPosition(character.home.x,character.home.y,.5))
   if(character.householdId)onHouseholdOpen?.(character.householdId,character.id)
   return
  }
  moveCamera(null);onCharacterFollow(id)
 },[activeLandmarkId,characters,landmarks,moveCamera,onCharacterFollow,onHouseholdOpen,selectLandmark])
 // Follow the authoritative arrival into the building, not a now-hidden actor.
 // A ref prevents repeated opens if a host holds onto a controlled follow ID.
 const enteredBuilding=useRef('')
 useEffect(()=>{
  const key=followedCharacter&&!visibleOnCityMap(followedCharacter)?`${followedCharacter.id}:${followedCharacter.spatialPresence?.building_id}`:''
  if(!key){enteredBuilding.current='';return}
  if(enteredBuilding.current===key)return
  enteredBuilding.current=key
  selectCharacter(followedCharacter!.id)
 },[followedCharacter,selectCharacter])
 const showOverview=()=>{setOverviewRequested(true);onCharacterFollow(undefined);setDismissedActiveLandmarkId(activeLandmarkId);setSelectedLandmark(null);moveCamera(null)}
 const showNeighborhood=()=>{setOverviewRequested(false);setViewMode('isometric');onCharacterFollow(undefined);setDismissedActiveLandmarkId(activeLandmarkId);setSelectedLandmark(null);moveCamera(null)}
 const toggleView=()=>{setViewMode(mode=>mode==='isometric'?'top':'isometric');setFocusVersion(version=>version+1)}
 const openCharacterEvent=(character:CityCharacter)=>{const id=character.worldAction?.event_id;if(id&&character.worldAction?.state!=='event_pending')onEventOpen?.(id)}

 if(!webglAvailable)return <section className={`world3d-shell is-fallback ${className}`} aria-label={copy.title}><WorldFallback characters={characters} landmarks={landmarks} language={language} neighborhood={neighborhood} onCharacterInteract={onCharacterInteract} onLandmarkClick={onLandmarkClick}/></section>

 return <WorldErrorBoundary fallback={()=> <section className={`world3d-shell is-fallback ${className}`} aria-label={copy.title}><WorldFallback characters={characters} landmarks={landmarks} language={language} neighborhood={neighborhood} onCharacterInteract={onCharacterInteract} onLandmarkClick={onLandmarkClick}/></section>}>
  <section ref={shellRef} className={`world3d-shell world3d-shell--${timeSlot} ${className}`} aria-label={copy.title} data-resident-draggable={Boolean(onResidentsMeet)} data-resident-drag={held?'dragging':drag.snapshot?'pressing':'idle'} data-resident-drag-source={held?.sourceId} data-resident-drag-target={held?.targetId} data-quality={quality} data-camera-framing={facilityFocus?'facility':followedCharacterId?'resident':neighborhoodView?'neighborhood':'city'}>
   <span className="world3d-time world3d-time--floating"><i aria-hidden>{timeSlot==='morning'?'☀':timeSlot==='afternoon'?'◐':'☾'}</i>{copy.time[timeSlot]}</span>
   <div className="world3d-stage" onContextMenu={event=>{if(drag.snapshot)event.preventDefault()}}>
    <WorldIntro phase={introPhase} variant={introVariant} copy={copy} reducedMotion={reducedMotion} onRetry={()=>window.location.reload()} onFallback={()=>setWebglAvailable(false)}/>
    <Canvas orthographic camera={{position:[38,36,44],zoom:25,near:.025,far:220}} dpr={Math.min(window.devicePixelRatio||1,VISUAL_BUDGETS[visualTier].dpr)} shadows="percentage" frameloop={paused||reducedMotion?'demand':'always'} gl={WEBGL_OPTIONS}
     onCreated={({gl})=>{gl.setClearColor(timeSlot==='evening'?'#21384f':timeSlot==='morning'?'#579bb9':'#3f86aa',1);gl.outputColorSpace='srgb';gl.toneMapping=THREE.ACESFilmicToneMapping;gl.toneMappingExposure=.88;gl.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();setWebglAvailable(false)},{once:true})}}
     onPointerMissed={()=>setSelectedLandmark(null)} fallback={<WorldFallback characters={characters} landmarks={landmarks} language={language} neighborhood={neighborhood} onCharacterInteract={onCharacterInteract} onLandmarkClick={onLandmarkClick}/>}>
     <WorldFrameLoopControl paused={paused}/>
     <AdaptiveResolution mode={qualityMode} paused={paused||reducedMotion||!sceneReady} onTier={setVisualTier}/>
     <Suspense fallback={null}>
      <WorldEffects timeSlot={timeSlot} quality={quality} reducedMotion={reducedMotion} postProcessing={postProcessing} shadowSize={VISUAL_BUDGETS[visualTier].shadowSize}/>
      <WorldScene residentDrag={drag} characters={characters} landmarks={sceneLandmarks} followedCharacterId={followedCharacterId} serverTime={serverTime} language={language} timeSlot={timeSlot} reducedMotion={reducedMotion} selectedLandmarkId={activeLandmarkId!==dismissedActiveLandmarkId?activeLandmarkId:selectedLandmark?.id} focus={externalFocus??focus} focusVersion={focusVersion+(activeLandmarkId!==dismissedActiveLandmarkId&&activeLandmarkId?hashString(activeLandmarkId):0)} viewMode={viewMode} neighborhoodView={neighborhoodView} quality={quality} layout={layout} neighborhood={neighborhood} facilityFocus={facilityFocus} facilityRevealEnabled={introPhase==='entered'&&!paused} onFacilityRevealFocus={revealFacility} onCharacterClick={selectCharacter} onCharacterEvent={eventId=>onEventOpen?.(eventId)} onCharacterTrouble={onTroubleOpen} onHouseholdOpen={onHouseholdOpen} onJourneyElapsed={onJourneyElapsed} onLandmarkSelect={selectLandmark}/>
      <SceneFrameGate onReady={revealScene}/>
     </Suspense>
    </Canvas>
    <nav className="world3d-resident-dock" aria-label={copy.residents}>
     <button type="button" className={'world3d-resident-button is-overview '+(!followedCharacterId&&(!hasTownCenter||neighborhoodView)?'is-active':'')} onClick={hasTownCenter?showNeighborhood:showOverview}><span className="world3d-resident-avatar" aria-hidden>⌂</span><b>{hasTownCenter?(language==='zh'?'生活街区':'Neighborhood'):copy.overview}</b></button>
     {characters.map(character=><div className={character.troubleSignal?'world3d-resident-entry has-trouble':'world3d-resident-entry'} key={character.id}><button type="button" className={'world3d-resident-button '+(character.id===followedCharacterId?'is-active':'')} data-resident-drop-id={character.id} data-resident-drag-source={held?.sourceId===character.id||undefined} data-resident-drag-target={held?.targetId===character.id||undefined} onPointerDown={event=>drag.begin(event.nativeEvent,character.id,'dock')} onContextMenu={event=>{if(onResidentsMeet)event.preventDefault()}} onClick={()=>{if(!drag.suppressClick(character.id))selectCharacter(character.id)}}><span className="world3d-resident-avatar" aria-hidden>{character.avatar?<CharacterPortrait avatar={character.avatar}/>:character.name.slice(0,1)}<i data-state={character.worldAction?.state??'idle'}/></span><b title={character.name}>{character.name}</b>{!visibleOnCityMap(character)&&<small className="world3d-presence-label">{language==='zh'?'室内 · ':'Inside · '}{character.location.place}</small>}<ResidentActionLabel action={character.lifeAction} language={language} intent={character.visibleIntent} intentZh={character.visibleIntentZh} compact className="world3d-resident-dock__action"/></button>{character.troubleSignal&&onTroubleOpen&&<button type="button" className="world3d-resident-trouble" onClick={()=>onTroubleOpen(character.id)} aria-label={language==='zh'?character.troubleSignal.summary_zh?.trim()||character.name+'似乎遇到了麻烦':character.troubleSignal.summary?.trim()||character.name+' seems troubled'}>?</button>}</div>)}
    </nav>
    <div className="world3d-controls" aria-label={copy.title}>{hasTownCenter&&<button type="button" data-camera-action="neighborhood" onClick={showNeighborhood} className={neighborhoodView&&!focus&&!externalFocus&&!followedCharacterId&&!facilityFocus?'is-active':''}><span aria-hidden>✿</span>{language==='zh'?'生活街区':'Neighborhood'}</button>}<button type="button" data-camera-action="overview" onClick={showOverview} className={!neighborhoodView&&!focus&&!externalFocus&&!followedCharacterId&&!facilityFocus?'is-active':''}><span aria-hidden>⌂</span>{copy.overview}</button>{!followedCharacterId&&<button type="button" onClick={toggleView}><span aria-hidden>{viewMode==='isometric'?'⊤':'◇'}</span>{viewMode==='isometric'?copy.top:copy.isometric}</button>}</div>
    {followedCharacter&&<aside className="world3d-follow-card"><button className="world3d-follow-card__close" type="button" onClick={showOverview} aria-label={copy.close}>×</button><span aria-hidden>{followedCharacter.name.slice(0,1)}<i data-state={followedCharacter.worldAction?.state??'idle'}/></span><div><small>{copy.follow}</small><h3>{followedCharacter.name}</h3><ResidentActionLabel action={followedCharacter.lifeAction} language={language} intent={followedCharacter.visibleIntent} intentZh={followedCharacter.visibleIntentZh} compact showStatus className="world3d-follow-card__action"/>{followedCharacter.troubleSignal&&<TroubleBubble signal={followedCharacter.troubleSignal} language={language} onOpen={onTroubleOpen?()=>onTroubleOpen(followedCharacter.id):undefined} className="world3d-follow-card__trouble"/>}<p>{followedCharacter.location.place||copy.status[followedCharacter.worldAction?.state??'idle']}</p><nav><button type="button" onClick={()=>onCharacterInteract(followedCharacter.id)}>{copy.talk}</button>{followedCharacter.householdId&&onHouseholdOpen&&<button type="button" onClick={()=>onHouseholdOpen(followedCharacter.householdId!)}>{language==='zh'?'查看住宅':'View home'}</button>}{followedCharacter.worldAction?.event_id&&followedCharacter.worldAction.state!=='event_pending'&&<button type="button" className="is-event" onClick={()=>openCharacterEvent(followedCharacter)}>{copy.viewEvent}</button>}</nav></div></aside>}
    <div className="world3d-quality" title={`${copy.quality}: ${quality}`} aria-hidden><i/><i className={quality==='high'?'is-on':''}/><i className={quality==='high'?'is-on':''}/></div>
    <p className="world3d-instructions">{onResidentsMeet&&characters.length>1?(language==='zh'?'拖动居民相遇 · 手机长按后拖动 · 拖空地旋转':'Drag residents to meet · Touch and hold on mobile · Drag ground to orbit'):copy.instructions}</p>
    {heldResident&&<div className="world3d-resident-drag-preview" style={{left:Math.max(80,Math.min(window.innerWidth-(window.innerWidth<600?80:170),held!.x)),top:Math.max((shellRef.current?.getBoundingClientRect().top??0)+(window.innerWidth<600?150:54),held!.y)}} aria-hidden><span>{heldResident.avatar?<CharacterPortrait avatar={heldResident.avatar}/>:heldResident.name.slice(0,1)}</span><b>{heldResident.name}</b></div>}
    {(heldResident||drag.pending||residentMeetingBusy||drag.failed)&&<div className={`world3d-meeting-hint ${held?.targetId?'has-target':''}`} role="status" aria-live="polite">{drag.pending||residentMeetingBusy?(language==='zh'?'正在安排相遇…':'Arranging a meeting…'):drag.failed?(language==='zh'?'暂时未能安排相遇，请稍后再试':'The meeting could not start. Please try again.'):targetResident?(language==='zh'?`松手，让 ${heldResident!.name} 和 ${targetResident.name} 见面`:`Release to introduce ${heldResident!.name} to ${targetResident.name}`):(language==='zh'?'拖到另一位居民或头像上 · 松在空地取消':'Drag onto another resident or portrait · Drop on empty ground to cancel')}<small>{heldResident?(language==='zh'?'Esc 取消':'Esc to cancel'):''}</small></div>}
    <div className="world3d-district-key" aria-hidden>{['west','north','central','east','south','harbor'].map(district=><i key={district} className={`is-${district}`}/>)}</div>
    {showPlaceCard&&displayedLandmark&&<aside className="world3d-place-card" aria-live="polite"><button type="button" className="world3d-place-card__close" onClick={()=>{setDismissedActiveLandmarkId(activeLandmarkId);setSelectedLandmark(null)}} aria-label={copy.close}>×</button><span className={`world3d-place-card__icon is-${displayedLandmark.kind}`} aria-hidden>{displayedLandmark.kind==='nature'?'✦':'⌂'}</span><div><small>{copy.district} · {displayedLandmark.district||displayedLandmark.kind}</small><h3>{displayedLandmark.name}</h3><button type="button" onClick={()=>selectLandmark(displayedLandmark)}>{copy.viewPlace}<span aria-hidden> →</span></button></div></aside>}
   </div>
   <div className="world3d-sr-summary"><h3>{copy.places}</h3><ul>{landmarks.map(place=><li key={place.id}><button type="button" onClick={()=>selectLandmark(place)}>{place.name}</button></li>)}</ul><h3>{copy.residents}</h3><ul>{characters.map(character=><li key={character.id}><button type="button" onClick={()=>selectCharacter(character.id)}>{character.name}</button></li>)}</ul></div>
  </section>
 </WorldErrorBoundary>
}

export default WorldObserver3D
