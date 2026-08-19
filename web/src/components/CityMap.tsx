import {useCallback,useEffect,useRef,useState} from 'react'
import './CityMap.css'
import './CityMapExpansion.css'

export type CityPoint={x:number;y:number}
export type CityLandmark=CityPoint&{id:string;name:string;kind:string}
export type CityCharacter={
  id:string
  name:string
  avatar?:{skin?:string;hairColor?:string;outfitColor?:string}
  home:CityPoint
  location:CityPoint&{place?:string}
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

function AvatarPin({character,active,onSelect}:{character:CityCharacter;active:boolean;onSelect:()=>void}){
  const skin=character.avatar?.skin||'#e8b99a',hair=character.avatar?.hairColor||'#4b342d',outfit=character.avatar?.outfitColor||'#738ca5'
  return <button className={`city-avatar ${active?'is-active':''}`} style={{left:`${character.location.x/12}%`,top:`${character.location.y/7.6}%`}} onClick={onSelect} aria-label={`${character.name}${character.location.place?`, ${character.location.place}`:''}`}>
    <span className="city-avatar__portrait" aria-hidden="true">
      <svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="23" fill="#fff"/><path d="M7 48q2-17 17-17t17 17" fill={outfit}/><ellipse cx="24" cy="22" rx="11" ry="13" fill={skin}/><path d="M13 22Q12 7 24 7t12 15q-8-2-14-8-2 6-9 8" fill={hair}/><circle cx="20" cy="22" r="1"/><circle cx="28" cy="22" r="1"/><path d="M21 27q3 2 6 0" fill="none" stroke="#9b5960" strokeWidth="1.5" strokeLinecap="round"/></svg>
    </span>
    <span className="city-avatar__label"><strong>{character.name}</strong>{character.location.place&&<small>{character.location.place}</small>}</span>
  </button>
}

function HomePin({character,homeLabel,onSelect}:{character:CityCharacter;homeLabel:string;onSelect:()=>void}){
 const skin=character.avatar?.skin||'#e8b99a',hair=character.avatar?.hairColor||'#4b342d',outfit=character.avatar?.outfitColor||'#738ca5'
 return <button className="city-home-avatar" style={{left:`${character.home.x/12}%`,top:`${character.home.y/7.6}%`}} onClick={onSelect} aria-label={`${character.name} · ${homeLabel}`}><span className="city-avatar__portrait" aria-hidden><svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="23" fill="#fff"/><path d="M7 48q2-17 17-17t17 17" fill={outfit}/><ellipse cx="24" cy="22" rx="11" ry="13" fill={skin}/><path d="M13 22Q12 7 24 7t12 15q-8-2-14-8-2 6-9 8" fill={hair}/><circle cx="20" cy="22" r="1"/><circle cx="28" cy="22" r="1"/></svg></span><strong>{character.name}</strong></button>
}

export function CityMap({characters,landmarks=DEFAULT_LANDMARKS,activeCharacterId,language='zh',onCharacterClick,className=''}:CityMapProps){
  const viewport=useRef<HTMLDivElement>(null)
  const gesture=useRef<{x:number;y:number;panX:number;panY:number;distance?:number}|null>(null)
  const [view,setView]=useState({zoom:1,panX:0,panY:0})
  const copy=language==='zh'?{label:'城市地图',home:'家',park:'绿荫公园',cafe:'橘子咖啡',school:'城市学校',hospital:'中心医院',shops:'商业街',station:'中央车站',office:'创意办公区',river:'月川',plus:'放大地图',minus:'缩小地图',reset:'重置地图'}:{label:'City map',home:'Home',park:'Green Park',cafe:'Orange Café',school:'City School',hospital:'Central Hospital',shops:'Market Street',station:'Central Station',office:'Creative District',river:'Moon River',plus:'Zoom in',minus:'Zoom out',reset:'Reset map'}
  const constrain=useCallback((zoom:number,panX:number,panY:number)=>{
    const el=viewport.current;if(!el)return {zoom,panX,panY}
    const maxX=Math.max(0,(el.clientWidth*(zoom-1))/2),maxY=Math.max(0,(el.clientHeight*(zoom-1))/2)
    return {zoom,panX:clamp(panX,-maxX,maxX),panY:clamp(panY,-maxY,maxY)}
  },[])
  const zoomBy=useCallback((amount:number)=>setView(v=>constrain(clamp(v.zoom+amount,MIN_ZOOM,MAX_ZOOM),v.panX,v.panY)),[constrain])
  useEffect(()=>{const el=viewport.current;if(!el)return;const wheel=(event:WheelEvent)=>{event.preventDefault();zoomBy(event.deltaY>0?-.16:.16)};el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel)},[zoomBy])
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
          <defs><pattern id="city-grid" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M28 0H0v28" fill="none" stroke="#cfd8cf" strokeOpacity=".28"/></pattern><filter id="city-shadow"><feDropShadow dx="0" dy="5" stdDeviation="6" floodOpacity=".16"/></filter></defs>
          <rect width="1200" height="760" rx="36" fill="#e9ede4"/><rect width="1200" height="760" rx="36" fill="url(#city-grid)"/>
          <path className="city-river" d="M-30 620C180 530 288 700 477 628s319-134 475-42 215 32 288-24"/><path className="city-river-line" d="M-30 620C180 530 288 700 477 628s319-134 475-42 215 32 288-24"/><text x="1035" y="657" className="city-water-label">{copy.river}</text>
          <g className="city-roads"><path d="M64 144H1130M68 365H1140M160 38V555M412 35V680M705 45V700M968 40V570"/><path d="M35 510L1160 250"/></g>
          <g className="city-road-lines"><path d="M64 144H1130M68 365H1140M160 38V555M412 35V680M705 45V700M968 40V570"/><path d="M35 510L1160 250"/></g>
          <g filter="url(#city-shadow)"><path className="city-park" d="M462 186h190q25 0 25 25v105q0 25-25 25H462q-25 0-25-25V211q0-25 25-25z"/><g className="city-tree"><circle cx="491" cy="234" r="17"/><circle cx="536" cy="284" r="20"/><circle cx="620" cy="228" r="22"/><circle cx="639" cy="296" r="15"/></g><path d="M462 314q90-102 187-99" fill="none" stroke="#e4d9ae" strokeWidth="9" strokeLinecap="round"/><text x="550" y="250" className="city-place-label">{copy.park}</text></g>
          <g className="city-building city-school" transform="translate(212 188)"><path d="M0 40L76 0l76 40v105H0z"/><path d="M18 62h116M61 65h31v80H61z"/><text x="76" y="172">{copy.school}</text></g>
          <g className="city-building city-hospital" transform="translate(1014 178)"><rect width="130" height="140" rx="10"/><path d="M65 32v66M32 65h66"/><text x="65" y="168">{copy.hospital}</text></g>
          <g className="city-building city-cafe" transform="translate(224 402)"><rect width="132" height="100" rx="12"/><path d="M0 30h132M22 0v30m24-30v30m24-30v30m24-30v30"/><path d="M45 56h43v24H45m43-18h9q13 0 3 14H88" fill="none"/><text x="66" y="128">{copy.cafe}</text></g>
          <g className="city-building city-shops" transform="translate(758 400)"><rect width="160" height="104" rx="10"/><path d="M0 32h160M22 0v32m38-32v32m40-32v32m38-32v32M27 58h42v46M92 58h42v25H92z"/><text x="80" y="132">{copy.shops}</text></g>
          <g className="city-building city-office" transform="translate(756 186)"><rect width="162" height="132" rx="8"/><path d="M28 22h28v24H28zm52 0h28v24H80zm52 0h16v24h-16zM28 62h28v24H28zm52 0h28v24H80zm52 0h16v24h-16z"/><text x="81" y="160">{copy.office}</text></g>
          <g className="city-building city-station" transform="translate(488 434)"><path d="M0 82V18Q0 0 18 0h164q18 0 18 18v64z"/><path d="M22 82V34h156v48M47 18h106M50 103h100M62 82l-14 42m90-42 14 42"/><text x="100" y="153">{copy.station}</text></g>
          <g className="city-houses">{characters.slice(0,5).map((c,index)=><g key={c.id} transform={`translate(${c.home.x-19} ${c.home.y-22})`}><path d="M0 18L19 0l19 18v27H0z"/><rect x="15" y="27" width="9" height="18"/><circle cx="34" cy="4" r="8" className="city-house-light"/><text x="19" y="60">{c.name} · {copy.home}</text><title>{c.name} — {copy.home} {index+1}</title></g>)}</g>
        </svg>
        <div className="city-landmarks" aria-hidden>{landmarks.filter(place=>!['central_station','business_center','city_hospital','riverside_park','old_town_market','moonlight_cafe','community_school'].includes(place.id)).map(place=><span key={place.id} className={`city-landmark city-landmark--${place.kind}`} style={{left:`${place.x/12}%`,top:`${place.y/7.6}%`}}><i>{place.kind==='culture'?'◆':place.kind==='education'?'▤':place.kind==='fitness'?'●':place.kind==='civic'?'★':place.kind==='health'?'+':'•'}</i><b>{place.name}</b></span>)}</div>
        <div className="city-map__characters">{characters.slice(0,5).map(c=><HomePin key={`home-${c.id}`} character={c} homeLabel={copy.home} onSelect={()=>onCharacterClick(c.id)}/>)}{characters.slice(0,5).map(c=><AvatarPin key={c.id} character={c} active={c.id===activeCharacterId} onSelect={()=>onCharacterClick(c.id)}/>)}</div>
      </div>
    </div>
  </section>
}
