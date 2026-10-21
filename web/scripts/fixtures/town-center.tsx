import {StrictMode,useCallback,useEffect,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {WorldObserver3D} from '../../src/three/world/WorldObserver3D'
import {DEFAULT_WORLD_LANDMARKS} from '../../src/three/world/worldData'
import {defaultAvatar} from '../../src/avatar'
import {getLocationAsset,locationCopy} from '../../src/locationAssets'
import type {CityCharacter} from '../../src/components/CityMap'
import type {WorldLayoutDocument} from '../../src/worldLayout'
import type {NeighborhoodReveal} from '../../src/neighborhood/NeighborhoodLandmarks3D'
import fixture from './city-published-layout.json'
import '../../src/styles.css'
import '../../src/ThreeIntegration.css'

const initial:CityCharacter[]=[
 {id:'town-qa-home',name:'小禾',avatar:{...defaultAvatar,model:'chibi',hair:'hair-one'},home:{x:480,y:430},homeLocationId:'shared-home',householdId:'town-qa-household',location:{x:480,y:430,place:'住宅门前'},worldAction:{state:'living'},spatialPresence:{mode:'outdoor',location_id:'shared-home',building_id:null}},
 {id:'town-qa-plaza',name:'小满',avatar:{...defaultAvatar,model:'city-03'},home:{x:480,y:430},homeLocationId:'shared-home',householdId:'town-qa-household',locationId:'sunny_plaza',location:{x:600,y:480,place:'阳光广场'},worldAction:{state:'living'},spatialPresence:{mode:'outdoor',location_id:'sunny_plaza',building_id:null}},
 {id:'town-qa-cafe',name:'小晴',avatar:{...defaultAvatar,model:'city-01'},home:{x:480,y:430},homeLocationId:'shared-home',householdId:'town-qa-household',locationId:'moonlight_cafe',location:{x:480,y:500,place:'月光咖啡馆'},worldAction:{state:'living'},spatialPresence:{mode:'outdoor',location_id:'moonlight_cafe',building_id:null}},
]
const previewLandmarks=fixture.layout.city.buildings.filter(place=>place.location_id).map(place=>DEFAULT_WORLD_LANDMARKS.find(landmark=>landmark.id===place.location_id)??({id:place.location_id!,kind:'civic',name:place.location_id!,x:600,y:380}))
const params=new URLSearchParams(location.search)
export default function Preview(){
 const [layout,setLayout]=useState(fixture.layout as WorldLayoutDocument),[residents,setResidents]=useState(initial)
 const [meetings,setMeetings]=useState<Array<[string,string]>>([]),[meetingBusy,setMeetingBusy]=useState(false)
 const [follow,setFollow]=useState<string>(),[active,setActive]=useState<string>(),[notice,setNotice]=useState('')
 const [reveal,setReveal]=useState<NeighborhoodReveal>(),[unlocked,setUnlocked]=useState(params.get('locked')!=='1')
 const time=params.get('time')==='evening'?'evening':'afternoon'
 const walk=useCallback(()=>{
  const now=Date.now()
  setResidents(values=>values.map((resident,index)=>index?resident:{...initial[0],animationCue:'walk',worldAction:{state:'walking_to_event',event_id:'town-qa-walk',target_location_id:'sunny_plaza',started_at:new Date(now).toISOString(),arrives_at:new Date(now+12000).toISOString()}}))
 },[])
 const arrive=()=>setResidents(values=>values.map((resident,index)=>index?resident:{...resident,locationId:'sunny_plaza',animationCue:'idle',location:{x:600,y:480,place:'阳光广场'},worldAction:{state:'living'},spatialPresence:{mode:'outdoor',location_id:'sunny_plaza',building_id:null}}))
 useEffect(()=>{Object.assign(window,{townPreview:{setLayout,walk,setUnlocked,setMeetingBusy,setResidents,meetings,follow:setFollow,showFountain:()=>{setUnlocked(true);setReveal({facility:'fountain',key:String(Date.now())})}}})},[meetings,walk])
 return <><header className="town-preview-toolbar"><strong>生活街区</strong><span>虚构居民 · 不读写存档</span><button onClick={walk}>从住宅走到喷泉</button><button onClick={()=>{setUnlocked(true);setReveal({facility:'fountain',key:String(Date.now())})}}>喷泉落成</button>{notice&&<output>{notice}</output>}</header>
  <main className="town-preview-world"><WorldObserver3D residentMeetingBusy={meetingBusy} onResidentsMeet={async(source,target)=>{setMeetings(values=>[...values,[source,target]]);setNotice('相遇：'+source+' → '+target);await new Promise(resolve=>window.setTimeout(resolve,250))}} characters={residents} landmarks={previewLandmarks.map(place=>({...place,name:locationCopy(getLocationAsset(place.id,place.kind),'zh').name}))} layout={layout} language="zh" timeSlot={time} quality={params.get('quality')==='low'?'low':'high'} followedCharacterId={follow} activeLandmarkId={active} onCharacterFollow={setFollow} onCharacterInteract={id=>setNotice(`查看居民 ${id}`)} onHouseholdOpen={()=>setNotice('共享住宅入口可用')} onLandmarkClick={place=>{setActive(place.id);setNotice(place.name)}} onJourneyElapsed={arrive} neighborhood={{fountain:unlocked,clothingStore:unlocked,improvements:params.get('improvements')==='1'?{flowerBeds:true,plazaLights:true}:undefined,reveal,onOpen:tab=>setNotice(tab==='fountain'?'许愿喷泉入口可用':'服装店入口可用')}}/></main>
  <style>{`html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}.town-preview-toolbar{height:52px;display:flex;align-items:center;gap:16px;padding:8px 20px;background:#fffaf0;color:#435e4d;font:13px system-ui;box-sizing:border-box}.town-preview-toolbar button{border:1px solid #d7dfcf;background:#eef3e6;border-radius:12px;padding:8px 12px;color:inherit;cursor:pointer}.town-preview-toolbar span{opacity:.65}.town-preview-toolbar output{font-size:11px}.town-preview-world{height:calc(100% - 52px)}.town-preview-world>.world3d-shell{height:100%;min-height:0}@media(max-width:600px){.town-preview-toolbar{padding:8px;gap:7px;font-size:11px}.town-preview-toolbar span,.town-preview-toolbar output{display:none}.town-preview-toolbar button{padding:7px;font-size:10px}}`}</style>
 </>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Preview/></StrictMode>)
