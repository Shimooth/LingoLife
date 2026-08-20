import {AnimatePresence,motion,useReducedMotion} from 'motion/react'
import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {DISTRICT_NAMES,getLocationAsset,HOME_LOCATION_ASSET,locationCopy,type LocationAsset} from '../locationAssets'
import {LocationIcon} from './LocationIcon'
import './CityMap.css'
import './CityMapExpansion.css'

export type CityPoint={x:number;y:number}
export type CityLandmark=CityPoint&{id:string;name:string;kind:string;district?:string}
export type CityCharacter={
  id:string
  name:string
  avatar?:{skin?:string;hairColor?:string;outfitColor?:string}
  home:CityPoint
  location:CityPoint&{place?:string}
  locationId?:string
}
export type CityMapProps={
  characters:CityCharacter[]
  landmarks?:CityLandmark[]
  activeCharacterId?:string
  language?:'zh'|'en'
  onCharacterClick:(id:string)=>void
  className?:string
}

const WIDTH=1200,HEIGHT=760,MIN_ZOOM=1,MAX_ZOOM=3.2
const DEFAULT_LANDMARKS:CityLandmark[]=[
 {id:'city_library',name:'City Library',kind:'education',x:236,y:460},
 {id:'community_gallery',name:'Community Gallery',kind:'culture',x:353,y:600},
 {id:'greenway_gym',name:'Greenway Gym',kind:'fitness',x:773,y:372},
 {id:'neighborhood_clinic',name:'Neighborhood Clinic',kind:'health',x:319,y:236},
 {id:'police_station',name:'Police Station',kind:'civic',x:1043,y:597},
 {id:'sunny_plaza',name:'Sunny Plaza',kind:'plaza',x:570,y:327},
]
const clamp=(value:number,min:number,max:number)=>Math.min(max,Math.max(min,value))

function Portrait({character}:{character:CityCharacter}){
 const skin=character.avatar?.skin||'#e8b99a',hair=character.avatar?.hairColor||'#4b342d',outfit=character.avatar?.outfitColor||'#738ca5'
 return <span className="city-avatar__portrait" aria-hidden><svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="23" fill="#fff"/><path d="M7 48q2-17 17-17t17 17" fill={outfit}/><ellipse cx="24" cy="22" rx="11" ry="13" fill={skin}/><path d="M13 22Q12 7 24 7t12 15q-8-2-14-8-2 6-9 8" fill={hair}/><circle cx="20" cy="22" r="1"/><circle cx="28" cy="22" r="1"/><path d="M21 27q3 2 6 0" fill="none" stroke="#9b5960" strokeWidth="1.5" strokeLinecap="round"/></svg></span>
}

function HomeMarker({character,homeLabel,onSelect}:{character:CityCharacter;homeLabel:string;onSelect:()=>void}){
 return <button type="button" className="city-home-marker" style={{left:`${clamp(character.home.x,24,1176)/12}%`,top:`${clamp(character.home.y,35,725)/7.6}%`}} aria-label={`${character.name} · ${homeLabel}`} onClick={onSelect}>
  <i aria-hidden/><small>{character.name} · {homeLabel}</small>
 </button>
}

function CharacterPin({character,active,onSelect}:{character:CityCharacter;active:boolean;onSelect:()=>void}){
 return <button className={`city-avatar ${active?'is-active':''}`} style={{left:`${clamp(character.location.x,25,1175)/12}%`,top:`${clamp(character.location.y,35,725)/7.6}%`}} onClick={onSelect} aria-label={`${character.name}${character.location.place?` · ${character.location.place}`:''}`}>
  <Portrait character={character}/>
  <span className="city-avatar__label"><strong>{character.name}</strong>{character.location.place&&<small>{character.location.place}</small>}</span>
 </button>
}

const BUILDING_BLOCKS=[
 [24,24,112,91,4],[190,28,184,88,5],[445,25,220,91,6],[744,26,185,88,5],[1003,25,157,89,4],
 [24,184,116,134,5],[184,184,186,132,6],[736,184,190,134,5],[996,184,170,134,5],
 [22,404,142,119,5],[194,404,180,119,5],[430,400,238,120,6],[741,400,190,120,5],[990,399,176,123,5],
 [45,552,158,112,5],[244,560,148,106,4],[730,554,200,109,5],[978,552,175,112,4],
] as const
const MICRO_PARKS=[[27,336,100,47],[1010,335,146,40],[270,682,104,48],[760,682,162,46]] as const

function CityFabric(){
 return <g aria-hidden="true">
  <g className="city-neighborhoods">{BUILDING_BLOCKS.map(([x,y,w,h,count],block)=><g key={block}>{Array.from({length:count},(_,index)=>{const columns=Math.ceil(Math.sqrt(count));const gap=7,bw=(w-gap*(columns-1))/columns,bh=Math.min(37,(h-gap)/Math.ceil(count/columns));const bx=x+(index%columns)*(bw+gap),by=y+Math.floor(index/columns)*(bh+gap);return <g key={index} transform={`translate(${bx} ${by})`}><rect width={bw} height={bh} rx="3"/><path d={`M5 ${Math.min(10,bh/2)}h${Math.max(4,bw-10)}M5 ${Math.min(20,bh-5)}h${Math.max(4,bw-10)}`}/></g>})}</g>)}</g>
  <g className="city-pocket-parks">{MICRO_PARKS.map(([x,y,w,h],index)=><g key={index}><rect x={x} y={y} width={w} height={h} rx="10"/><circle cx={x+18} cy={y+18} r="8"/><circle cx={x+w-18} cy={y+h-16} r="10"/><path d={`M${x+9} ${y+h-8}L${x+w-10} ${y+8}`}/></g>)}</g>
  <g className="city-rail"><path d="M4 706C260 677 449 723 684 691s345 1 516-25"/><path d="M4 716C260 687 449 733 684 701s345 1 516-25"/>{Array.from({length:30},(_,i)=><path key={i} d={`M${i*43-10} 694l8 28`}/>)}</g>
  <g className="city-vehicles">{[[93,137],[322,371],[651,139],[849,358],[1075,145],[406,506],[696,474],[958,281]].map(([x,y],index)=><g key={index} transform={`translate(${x} ${y}) rotate(${index%3===0?90:0})`}><rect width="20" height="9" rx="4"/><circle cx="5" cy="9" r="2"/><circle cx="15" cy="9" r="2"/></g>)}</g>
 </g>
}

export function CityMap({characters,landmarks=DEFAULT_LANDMARKS,activeCharacterId,language='zh',onCharacterClick,className=''}:CityMapProps){
  const reduce=useReducedMotion()
  const viewport=useRef<HTMLDivElement>(null)
  const gesture=useRef<{x:number;y:number;panX:number;panY:number;distance?:number}|null>(null)
  const [view,setView]=useState({zoom:1,panX:0,panY:0})
  const [selected,setSelected]=useState<{landmark?:CityLandmark;homeCharacter?:CityCharacter}|null>(null)
  const selectedAsset=useMemo(()=>selected?.landmark?getLocationAsset(selected.landmark.id,selected.landmark.kind):selected?.homeCharacter?HOME_LOCATION_ASSET:null,[selected])
  const copy=language==='zh'?{label:'城市地图',home:'家',park:'绿荫公园',cafe:'橘子咖啡',school:'城市学校',hospital:'中心医院',shops:'商业街',station:'中央车站',office:'创意办公区',river:'月川',plus:'放大地图',minus:'缩小地图',reset:'重置地图'}:{label:'City map',home:'Home',park:'Green Park',cafe:'Orange Café',school:'City School',hospital:'Central Hospital',shops:'Market Street',station:'Central Station',office:'Creative District',river:'Moon River',plus:'Zoom in',minus:'Zoom out',reset:'Reset map'}
  const constrain=useCallback((zoom:number,panX:number,panY:number)=>{
    const el=viewport.current;if(!el)return {zoom,panX,panY}
    const maxX=Math.max(0,(el.clientWidth*(zoom-1))/2),maxY=Math.max(0,(el.clientHeight*(zoom-1))/2)
    return {zoom,panX:clamp(panX,-maxX,maxX),panY:clamp(panY,-maxY,maxY)}
  },[])
  const zoomBy=useCallback((amount:number)=>setView(v=>constrain(clamp(v.zoom+amount,MIN_ZOOM,MAX_ZOOM),v.panX,v.panY)),[constrain])
  useEffect(()=>{const el=viewport.current;if(!el)return;const wheel=(event:WheelEvent)=>{event.preventDefault();zoomBy(event.deltaY>0?-.16:.16)};el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel)},[zoomBy])
  useEffect(()=>{if(!selected)return;const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setSelected(null)};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[selected])
  const distance=(touches:React.TouchList)=>Math.hypot(touches[0].clientX-touches[1].clientX,touches[0].clientY-touches[1].clientY)
  return <section className={`city-map ${className}`} aria-label={copy.label}>
    <div className="city-map__toolbar" aria-label={copy.label}>
      <button onClick={()=>zoomBy(-.25)} disabled={view.zoom<=MIN_ZOOM} aria-label={copy.minus}>−</button>
      <button onClick={()=>setView({zoom:1,panX:0,panY:0})} aria-label={copy.reset}>{Math.round(view.zoom*100)}%</button>
      <button onClick={()=>zoomBy(.25)} disabled={view.zoom>=MAX_ZOOM} aria-label={copy.plus}>+</button>
    </div>
    <div ref={viewport} className="city-map__viewport"
      onPointerDown={event=>{if((event.target as HTMLElement).closest('button'))return;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);gesture.current={x:event.clientX,y:event.clientY,panX:view.panX,panY:view.panY}}}
      onPointerMove={event=>{const g=gesture.current;if(!g||g.distance)return;setView(v=>constrain(v.zoom,g.panX+event.clientX-g.x,g.panY+event.clientY-g.y))}}
      onPointerUp={()=>{gesture.current=null}} onPointerCancel={()=>{gesture.current=null}}
      onTouchStart={event=>{if(event.touches.length===2)gesture.current={x:0,y:0,panX:view.panX,panY:view.panY,distance:distance(event.touches)}}}
      onTouchMove={event=>{const g=gesture.current;if(event.touches.length!==2||!g?.distance)return;const next=clamp(view.zoom*(distance(event.touches)/g.distance),MIN_ZOOM,MAX_ZOOM);gesture.current={...g,distance:distance(event.touches)};setView(v=>constrain(next,v.panX,v.panY))}}
    >
      <div className="city-map__canvas" style={{transform:`translate3d(${view.panX}px,${view.panY}px,0) scale(${view.zoom})`}}>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-labelledby="city-title city-desc">
          <title id="city-title">{copy.label}</title><desc id="city-desc">{language==='zh'?'包含住宅、公园、商店、学校、医院、车站和办公区的可交互地图':'Interactive map with homes, park, shops, school, hospital, station and offices'}</desc>
          <defs><pattern id="city-grid" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M28 0H0v28" fill="none" stroke="#cfd8cf" strokeOpacity=".28"/></pattern><filter id="city-shadow"><feDropShadow dx="0" dy="5" stdDeviation="6" floodOpacity=".16"/></filter><linearGradient id="city-water" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#c5e3e4"/><stop offset="1" stopColor="#a8d0d9"/></linearGradient></defs>
          <rect width="1200" height="760" rx="36" fill="#e9ede4"/><rect width="1200" height="760" rx="36" fill="url(#city-grid)"/>
          <path className="city-hills" d="M0 0h1200v65q-80 35-163 1-99-39-180 9-83 49-177 2-107-53-198 0-90 51-189 0-74-39-147 6Q77 125 0 75z"/>
          <path className="city-lake" d="M968 0h232v127q-38 19-84-8-49-28-87 0-41 30-74-6-25-29 13-113z"/><path className="city-lake-shine" d="M1040 43q50-22 111 8M1018 79q64-23 146 12"/>
          <path className="city-river" d="M-30 620C180 530 288 700 477 628s319-134 475-42 215 32 288-24"/><path className="city-river-line" d="M-30 620C180 530 288 700 477 628s319-134 475-42 215 32 288-24"/><text x="1035" y="657" className="city-water-label">{copy.river}</text>
          <g className="city-roads city-roads--major"><path d="M64 144H1130M68 365H1140M160 38V555M412 35V680M705 45V700M968 40V570"/><path d="M35 510L1160 250"/></g>
          <g className="city-roads city-roads--minor"><path d="M18 167H1180M18 336H1180M20 542H1170M18 681H1170M181 8V690M394 12V738M724 12V740M948 9V735M1176 140v575"/><path d="M5 278h395m315 0h480M209 525v179m820-210v200"/></g>
          <g className="city-road-lines"><path d="M64 144H1130M68 365H1140M160 38V555M412 35V680M705 45V700M968 40V570"/><path d="M35 510L1160 250"/></g>
          <CityFabric/>
          <g filter="url(#city-shadow)"><path className="city-park" d="M462 186h190q25 0 25 25v105q0 25-25 25H462q-25 0-25-25V211q0-25 25-25z"/><g className="city-tree"><circle cx="491" cy="234" r="17"/><circle cx="536" cy="284" r="20"/><circle cx="620" cy="228" r="22"/><circle cx="639" cy="296" r="15"/></g><path d="M462 314q90-102 187-99" fill="none" stroke="#e4d9ae" strokeWidth="9" strokeLinecap="round"/></g>
          <g className="city-building city-school" transform="translate(212 188)"><path d="M0 40L76 0l76 40v105H0z"/><path d="M18 62h116M61 65h31v80H61z"/></g>
          <g className="city-building city-hospital" transform="translate(1014 178)"><rect width="130" height="140" rx="10"/><path d="M65 32v66M32 65h66"/></g>
          <g className="city-building city-cafe" transform="translate(224 402)"><rect width="132" height="100" rx="12"/><path d="M0 30h132M22 0v30m24-30v30m24-30v30m24-30v30"/><path d="M45 56h43v24H45m43-18h9q13 0 3 14H88" fill="none"/></g>
          <g className="city-building city-shops" transform="translate(758 400)"><rect width="160" height="104" rx="10"/><path d="M0 32h160M22 0v32m38-32v32m40-32v32m38-32v32M27 58h42v46M92 58h42v25H92z"/></g>
          <g className="city-building city-office" transform="translate(756 186)"><rect width="162" height="132" rx="8"/><path d="M28 22h28v24H28zm52 0h28v24H80zm52 0h16v24h-16zM28 62h28v24H28zm52 0h28v24H80zm52 0h16v24h-16z"/></g>
          <g className="city-building city-station" transform="translate(488 434)"><path d="M0 82V18Q0 0 18 0h164q18 0 18 18v64z"/><path d="M22 82V34h156v48M47 18h106M50 103h100M62 82l-14 42m90-42 14 42"/></g>
        </svg>
        <div className="city-landmarks">{landmarks.map(place=>{const resource=getLocationAsset(place.id,place.kind);return <motion.button type="button" key={place.id} className={`city-landmark city-landmark--${place.kind}`} style={{left:`${place.x/12}%`,top:`${place.y/7.6}%`,'--landmark-accent':resource.accent} as React.CSSProperties} onClick={()=>setSelected({landmark:place})} aria-label={language==='zh'?`查看${place.name}详情`:`View details for ${place.name}`} whileHover={reduce?undefined:{y:-3,scale:1.07}} whileTap={reduce?undefined:{scale:.94}}><i><LocationIcon name={resource.icon}/></i><b>{place.name}</b></motion.button>})}</div>
        <div className="city-map__characters">
          {characters.slice(0,5).map(c=><HomeMarker key={`home-${c.id}`} character={c} homeLabel={copy.home} onSelect={()=>setSelected({homeCharacter:c})}/>)}
          {characters.slice(0,5).map(c=><CharacterPin key={c.id} character={c} active={c.id===activeCharacterId} onSelect={()=>onCharacterClick(c.id)}/>)}
        </div>
      </div>
    </div>
    <AnimatePresence>{selected&&selectedAsset&&<LocationDetail asset={selectedAsset} landmark={selected.landmark} homeCharacter={selected.homeCharacter} characters={characters} language={language} reduce={Boolean(reduce)} onClose={()=>setSelected(null)} onCharacterClick={onCharacterClick}/>}</AnimatePresence>
  </section>
}

function LocationDetail({asset,landmark,homeCharacter,characters,language,reduce,onClose,onCharacterClick}:{asset:LocationAsset;landmark?:CityLandmark;homeCharacter?:CityCharacter;characters:CityCharacter[];language:'zh'|'en';reduce:boolean;onClose:()=>void;onCharacterClick:(id:string)=>void}){
 const base=locationCopy(asset,language)
 const name=homeCharacter?(language==='zh'?`${homeCharacter.name}的家`:`${homeCharacter.name}'s home`):landmark?.name||base.name
 const district=landmark?.district?(DISTRICT_NAMES[landmark.district]?.[language]||landmark.district):(language==='zh'?'住宅区':'Residential district')
 const visitors=homeCharacter?(homeCharacter.locationId?[]:[homeCharacter]):characters.filter(character=>character.locationId===landmark?.id)
 return <motion.aside className="location-detail" role="dialog" aria-modal="false" aria-label={language==='zh'?`${name}详情`:`Details for ${name}`} initial={reduce?{opacity:0}:{opacity:0,x:35,scale:.96}} animate={{opacity:1,x:0,scale:1}} exit={reduce?{opacity:0}:{opacity:0,x:25,scale:.97}} transition={{type:'spring',stiffness:230,damping:26}}>
  <div className="location-detail__hero" style={{'--location-accent':asset.accent,backgroundImage:`linear-gradient(180deg,transparent 25%,${asset.accent}e6 100%),url(${asset.image})`,backgroundPosition:asset.imagePosition||'center'} as React.CSSProperties}>
   <button type="button" onClick={onClose} aria-label={language==='zh'?'关闭地点详情':'Close location details'}>×</button>
   <div><span><LocationIcon name={asset.icon}/></span><p>{base.category}</p><h2>{name}</h2><small>⌖ {district}</small></div>
  </div>
  <div className="location-detail__body">
   <p>{homeCharacter?(language==='zh'?`这是 ${homeCharacter.name} 在城市里的私人空间。熟悉的收藏、窗景和生活痕迹，让这里的谈话更放松也更亲密。`:`This is ${homeCharacter.name}'s private place in the city. Familiar objects and everyday traces make conversations here quieter and more intimate.`):base.description}</p>
   <dl><div><dt>{language==='zh'?'开放时间':'Hours'}</dt><dd>{base.hours}</dd></div><div><dt>{language==='zh'?'地点特色':'Highlights'}</dt><dd>{base.highlights.join(' · ')}</dd></div></dl>
   <section><h3>{language==='zh'?'今天在这里':'Here today'}</h3>{visitors.length?<div className="location-detail__visitors">{visitors.map(character=><button type="button" key={character.id} onClick={()=>{onClose();onCharacterClick(character.id)}}><Portrait character={character}/><span><b>{character.name}</b><small>{language==='zh'?'开始对话':'Start conversation'} →</small></span></button>)}</div>:<p className="location-detail__quiet">{language==='zh'?'现在没有熟悉的角色在这里，也许晚些时候再来看看。':'No familiar character is here right now. The place may feel different later.'}</p>}</section>
  </div>
 </motion.aside>
}
