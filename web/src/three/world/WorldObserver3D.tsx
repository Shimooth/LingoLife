import {Canvas} from '@react-three/fiber'
import {Suspense,useCallback,useEffect,useMemo,useRef,useState} from 'react'
import type {CityCharacter,CityLandmark} from '../../components/CityMap'
import {WorldErrorBoundary,supportsWebGL} from './WorldErrorBoundary'
import {WorldScene,type WorldQuality,type WorldViewMode} from './WorldScene'
import {DEFAULT_WORLD_LANDMARKS,hashString,worldPosition,type TimeSlot,type WorldPoint} from './worldData'
import './world.css'

export type WorldObserver3DProps={
 characters:readonly CityCharacter[]
 landmarks?:readonly CityLandmark[]
 activeCharacterId?:string
 activeLandmarkId?:string
 language?:'zh'|'en'
 timeSlot?:TimeSlot
 quality?:WorldQuality
 showPlaceCard?:boolean
 onCharacterClick:(id:string)=>void
 onLandmarkClick?:(landmark:CityLandmark)=>void
 className?:string
}

const HIGH_DPR:[number,number]=[1,1.75]
const LOW_DPR:[number,number]=[1,1.25]
const WEBGL_OPTIONS={antialias:true,alpha:false,powerPreference:'high-performance' as const}

type Copy={
 title:string;subtitle:string;loading:string;overview:string;top:string;isometric:string;quality:string
 instructions:string;fallbackTitle:string;fallbackBody:string;places:string;residents:string;close:string
 emptyResidents:string;viewPlace:string;talk:string;district:string;time:Record<TimeSlot,string>
}

const COPY:Record<'zh'|'en',Copy>={
 zh:{title:'LingoLife 岛屿城市',subtitle:'观察整座城市，选择地点或居民',loading:'正在唤醒岛屿…',overview:'返回全岛',top:'俯瞰',isometric:'微缩',quality:'画质',instructions:'拖动旋转 · 滚轮或双指缩放 · 右键平移',fallbackTitle:'暂时无法显示 3D 城市',fallbackBody:'当前浏览器或设备未能启动 WebGL。你仍然可以从下面选择地点和居民。',places:'城市地点',residents:'岛上居民',close:'关闭详情',emptyResidents:'居民正在陆续搬来',viewPlace:'查看地点',talk:'互动',district:'街区',time:{morning:'清晨',afternoon:'午后',evening:'夜晚'}},
 en:{title:'LingoLife Island City',subtitle:'Observe the city, its places and residents',loading:'Waking up the island…',overview:'Whole island',top:'Top view',isometric:'Miniature',quality:'Quality',instructions:'Drag to orbit · wheel or pinch to zoom · right-drag to pan',fallbackTitle:'The 3D city is unavailable',fallbackBody:'WebGL could not start on this browser or device. You can still choose a place or resident below.',places:'City places',residents:'Island residents',close:'Close details',emptyResidents:'New residents are on their way',viewPlace:'View place',talk:'Interact',district:'District',time:{morning:'Morning',afternoon:'Afternoon',evening:'Evening'}},
}

function WorldFallback({characters,landmarks,language,onCharacterClick,onLandmarkClick}:Pick<WorldObserver3DProps,'characters'|'language'|'onCharacterClick'|'onLandmarkClick'>&{landmarks:readonly CityLandmark[]}){
 const copy=COPY[language??'zh']
 return <div className="world3d-fallback" role="status">
  <div className="world3d-fallback__message"><span aria-hidden>🏝️</span><div><h3>{copy.fallbackTitle}</h3><p>{copy.fallbackBody}</p></div></div>
  <div className="world3d-fallback__lists">
   <section><h4>{copy.places}</h4><div>{landmarks.map(place=><button type="button" key={place.id} onClick={()=>onLandmarkClick?.(place)}><span aria-hidden>⌂</span><b>{place.name}</b><small>{copy.viewPlace} →</small></button>)}</div></section>
   <section><h4>{copy.residents}</h4>{characters.length?<div>{characters.map(character=><button type="button" key={character.id} onClick={()=>onCharacterClick(character.id)}><span className="world3d-fallback__avatar" aria-hidden>{character.name.slice(0,1)}</span><b>{character.name}</b><small>{copy.talk} →</small></button>)}</div>:<p>{copy.emptyResidents}</p>}</section>
  </div>
 </div>
}

export function WorldObserver3D({characters,landmarks=DEFAULT_WORLD_LANDMARKS,activeCharacterId,activeLandmarkId,language='zh',timeSlot='afternoon',quality:qualityMode='auto',showPlaceCard=true,onCharacterClick,onLandmarkClick,className=''}:WorldObserver3DProps){
 const copy=COPY[language]
 const reducedMotion=useMemo(()=>typeof window!=='undefined'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches,[])
 const [webglAvailable,setWebglAvailable]=useState(supportsWebGL)
 const [ready,setReady]=useState(false)
 // Auto deliberately means full quality. Runtime quality oscillation can force
 // WebGL buffers to resize repeatedly on some devices and produce visible
 // white/green flashes. Only an explicit battery-saver choice lowers detail.
 const quality=qualityMode==='low'?'low':'high'
 const [selectedLandmark,setSelectedLandmark]=useState<CityLandmark|null>(null)
 const [dismissedActiveLandmarkId,setDismissedActiveLandmarkId]=useState<string>()
 const previousActiveLandmarkId=useRef(activeLandmarkId)
 const [focus,setFocus]=useState<WorldPoint|null>(null)
 const [focusVersion,setFocusVersion]=useState(0)
 const [viewMode,setViewMode]=useState<WorldViewMode>('isometric')
 const activeLandmark=useMemo(()=>landmarks.find(landmark=>landmark.id===activeLandmarkId)??null,[activeLandmarkId,landmarks])
 const activeLandmarkX=activeLandmark?.x
 const activeLandmarkY=activeLandmark?.y
 const externalFocus=useMemo(()=>activeLandmarkX!==undefined&&activeLandmarkY!==undefined&&activeLandmarkId!==dismissedActiveLandmarkId?worldPosition(activeLandmarkX,activeLandmarkY,.5):null,[activeLandmarkId,activeLandmarkX,activeLandmarkY,dismissedActiveLandmarkId])
 const displayedLandmark=selectedLandmark??(activeLandmarkId!==dismissedActiveLandmarkId?activeLandmark:null)

 useEffect(()=>{
  if(previousActiveLandmarkId.current===activeLandmarkId)return
  previousActiveLandmarkId.current=activeLandmarkId
  setDismissedActiveLandmarkId(undefined)
  setSelectedLandmark(null)
 },[activeLandmarkId])

 const moveCamera=useCallback((next:WorldPoint|null)=>{
  setFocus(next)
  setFocusVersion(version=>version+1)
 },[])
 const selectLandmark=useCallback((landmark:CityLandmark)=>{
  setDismissedActiveLandmarkId(activeLandmarkId)
  setSelectedLandmark(landmark)
  moveCamera(worldPosition(landmark.x,landmark.y,.5))
  onLandmarkClick?.(landmark)
 },[activeLandmarkId,moveCamera,onLandmarkClick])
 const selectCharacter=useCallback((id:string)=>{
  const character=characters.find(item=>item.id===id)
  if(character)moveCamera(worldPosition(character.location.x,character.location.y,.6))
  onCharacterClick(id)
 },[characters,moveCamera,onCharacterClick])
 const showOverview=()=>{setDismissedActiveLandmarkId(activeLandmarkId);setSelectedLandmark(null);moveCamera(null)}
 const toggleView=()=>{
  setViewMode(mode=>mode==='isometric'?'top':'isometric')
  setFocusVersion(version=>version+1)
 }

 if(!webglAvailable)return <section className={`world3d-shell is-fallback ${className}`} aria-label={copy.title}><WorldFallback characters={characters} landmarks={landmarks} language={language} onCharacterClick={onCharacterClick} onLandmarkClick={onLandmarkClick}/></section>

 return <WorldErrorBoundary fallback={()=> <section className={`world3d-shell is-fallback ${className}`} aria-label={copy.title}><WorldFallback characters={characters} landmarks={landmarks} language={language} onCharacterClick={onCharacterClick} onLandmarkClick={onLandmarkClick}/></section>}>
  <section className={`world3d-shell world3d-shell--${timeSlot} ${className}`} aria-label={copy.title} data-quality={quality}>
   <header className="world3d-heading">
    <div><span className="world3d-heading__island" aria-hidden>◒</span><div><h2>{copy.title}</h2><p>{copy.subtitle}</p></div></div>
    <span className="world3d-time"><i aria-hidden>{timeSlot==='morning'?'☀':timeSlot==='afternoon'?'◐':'☾'}</i>{copy.time[timeSlot]}</span>
   </header>
   <div className="world3d-stage">
    {!ready&&<div className="world3d-loading" role="status"><span aria-hidden><i/><i/><i/></span><p>{copy.loading}</p></div>}
    <Canvas
     orthographic
     camera={{position:[24,24,28],zoom:32,near:.1,far:120}}
     dpr={quality==='high'?HIGH_DPR:LOW_DPR}
     shadows={quality==='high'}
     frameloop={reducedMotion?'demand':'always'}
     gl={WEBGL_OPTIONS}
     onCreated={({gl})=>{
      gl.setClearColor(timeSlot==='evening'?'#21384f':timeSlot==='morning'?'#bce7e2':'#9bd4e0',1)
      gl.outputColorSpace='srgb'
      gl.toneMapping=3
      gl.toneMappingExposure=1.05
      gl.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();setWebglAvailable(false)},{once:true})
      // Keep the loading cover until at least one complete scene frame has had
      // a chance to reach the compositor.
      requestAnimationFrame(()=>requestAnimationFrame(()=>setReady(true)))
     }}
     onPointerMissed={()=>setSelectedLandmark(null)}
     fallback={<WorldFallback characters={characters} landmarks={landmarks} language={language} onCharacterClick={onCharacterClick} onLandmarkClick={onLandmarkClick}/>}
    >
     <Suspense fallback={null}>
      <WorldScene characters={characters} landmarks={landmarks.slice(0,40)} activeCharacterId={activeCharacterId} language={language} timeSlot={timeSlot} reducedMotion={reducedMotion} selectedLandmarkId={activeLandmarkId!==dismissedActiveLandmarkId?activeLandmarkId:selectedLandmark?.id} focus={externalFocus??focus} focusVersion={focusVersion+(activeLandmarkId!==dismissedActiveLandmarkId&&activeLandmarkId?hashString(activeLandmarkId):0)} viewMode={viewMode} quality={quality} onCharacterClick={selectCharacter} onLandmarkSelect={selectLandmark}/>
     </Suspense>
    </Canvas>
    <div className="world3d-controls" aria-label={copy.title}>
     <button type="button" onClick={showOverview} className={!focus&&!externalFocus?'is-active':''}><span aria-hidden>⌂</span>{copy.overview}</button>
     <button type="button" onClick={toggleView}><span aria-hidden>{viewMode==='isometric'?'⊤':'◇'}</span>{viewMode==='isometric'?copy.top:copy.isometric}</button>
    </div>
    <div className="world3d-quality" title={`${copy.quality}: ${quality}`} aria-hidden><i/><i className={quality==='high'?'is-on':''}/><i className={quality==='high'?'is-on':''}/></div>
    <p className="world3d-instructions">{copy.instructions}</p>
    <div className="world3d-district-key" aria-hidden>{['west','north','central','east','south','harbor'].map(district=><i key={district} className={`is-${district}`}/>)}</div>
    {showPlaceCard&&displayedLandmark&&<aside className="world3d-place-card" aria-live="polite">
     <button type="button" className="world3d-place-card__close" onClick={()=>{setDismissedActiveLandmarkId(activeLandmarkId);setSelectedLandmark(null)}} aria-label={copy.close}>×</button>
     <span className={`world3d-place-card__icon is-${displayedLandmark.kind}`} aria-hidden>{displayedLandmark.kind==='nature'?'✦':'⌂'}</span>
     <div><small>{copy.district} · {displayedLandmark.district||displayedLandmark.kind}</small><h3>{displayedLandmark.name}</h3><button type="button" onClick={()=>selectLandmark(displayedLandmark)}>{copy.viewPlace}<span aria-hidden> →</span></button></div>
    </aside>}
   </div>
   <div className="world3d-sr-summary">
    <h3>{copy.places}</h3><ul>{landmarks.map(place=><li key={place.id}><button type="button" onClick={()=>selectLandmark(place)}>{place.name}</button></li>)}</ul>
    <h3>{copy.residents}</h3><ul>{characters.map(character=><li key={character.id}><button type="button" onClick={()=>selectCharacter(character.id)}>{character.name}</button></li>)}</ul>
   </div>
  </section>
 </WorldErrorBoundary>
}

export default WorldObserver3D
