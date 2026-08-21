import {Float,Html,Instances,Instance,OrbitControls,PerformanceMonitor,Sparkles,useCursor} from '@react-three/drei'
import {useFrame,useThree,type ThreeEvent} from '@react-three/fiber'
import {useEffect,useMemo,useRef,useState,type ComponentRef} from 'react'
import * as THREE from 'three'
import type {CityCharacter,CityLandmark} from '../../components/CityMap'
import {BUILDING_CLUSTERS,DISTRICTS,hashString,KIND_COLORS,TREES,worldPosition,type TimeSlot,type WorldPoint} from './worldData'

type Quality='low'|'high'
export type WorldQuality='auto'|Quality
export type WorldViewMode='isometric'|'top'

type SceneProps={
 characters:readonly CityCharacter[]
 landmarks:readonly CityLandmark[]
 activeCharacterId?:string
 language:'zh'|'en'
 timeSlot:TimeSlot
 reducedMotion:boolean
 selectedLandmarkId?:string
 focus:WorldPoint|null
 focusVersion:number
 viewMode:WorldViewMode
 qualityMode:WorldQuality
 onCharacterClick:(id:string)=>void
 onLandmarkSelect:(landmark:CityLandmark)=>void
 onQualityChange:(quality:Quality)=>void
}

const BUILDING_COLORS=[
 ['#f7dfbd','#c56d5c'],['#d9ebdd','#668c7b'],['#e9d9ef','#8675a3'],['#f4e7bf','#d08b5d'],
] as const

function CameraRig({focus,focusVersion,reducedMotion,viewMode}:{focus:WorldPoint|null;focusVersion:number;reducedMotion:boolean;viewMode:WorldViewMode}){
 const {camera}=useThree()
 const controls=useRef<ComponentRef<typeof OrbitControls>>(null)
 const moving=useRef(false)
 const desiredPosition=useRef(new THREE.Vector3(24,24,28))
 const desiredTarget=useRef(new THREE.Vector3(0,0,0))

 useEffect(()=>{
  const target=new THREE.Vector3(...(focus??[0,0,0]))
  desiredTarget.current.copy(target)
  const offset=viewMode==='top'?new THREE.Vector3(.01,focus?22:38,.01):(focus?new THREE.Vector3(10,12,13):new THREE.Vector3(24,24,28))
  desiredPosition.current.copy(target).add(offset)
  moving.current=true
  if(reducedMotion){
   camera.position.copy(desiredPosition.current)
   controls.current?.target.copy(desiredTarget.current)
   controls.current?.update()
   moving.current=false
  }
 },[camera,focus,focusVersion,reducedMotion,viewMode])

 useFrame((_,delta)=>{
  if(!moving.current||!controls.current)return
  const alpha=1-Math.exp(-delta*4.8)
  camera.position.lerp(desiredPosition.current,alpha)
  controls.current.target.lerp(desiredTarget.current,alpha)
  controls.current.update()
  if(camera.position.distanceToSquared(desiredPosition.current)<.005&&controls.current.target.distanceToSquared(desiredTarget.current)<.003){
   camera.position.copy(desiredPosition.current)
   controls.current.target.copy(desiredTarget.current)
   moving.current=false
  }
 })

 return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={reducedMotion ? 1 : .08} minZoom={22} maxZoom={70} minPolarAngle={viewMode==='top' ? .01 : .55} maxPolarAngle={1.2} enablePan screenSpacePanning maxDistance={65} minDistance={14}/>
}

function Ocean({night,reducedMotion}:{night:boolean;reducedMotion:boolean}){
 const water=useRef<THREE.Mesh>(null)
 useFrame((state)=>{
  if(reducedMotion||!water.current)return
  water.current.position.y=-.54+Math.sin(state.clock.elapsedTime*.55)*.035
 })
 return <group>
  <mesh ref={water} rotation-x={-Math.PI/2} position-y={-.55} receiveShadow>
   <circleGeometry args={[48,80]}/>
   <meshStandardMaterial color={night?'#315f78':'#78c9d4'} roughness={.34} metalness={.12}/>
  </mesh>
  {[19,23,28,34].map((radius,index)=><mesh key={radius} rotation-x={-Math.PI/2} position-y={-.515-index*.004}>
   <ringGeometry args={[radius,radius+.06,96]}/><meshBasicMaterial color={night?'#81b6c5':'#d9fcf5'} transparent opacity={.22-index*.025}/>
  </mesh>)}
 </group>
}

function IslandBase(){
 return <group>
  <mesh position-y={-.23} scale={[1.04,1,.7]} receiveShadow>
   <cylinderGeometry args={[17.3,16.6,.7,64]}/><meshStandardMaterial color="#e2c38c" roughness={.92}/>
  </mesh>
  <mesh position-y={.12} scale={[1,1,.67]} receiveShadow>
   <cylinderGeometry args={[17,16.9,.42,64]}/><meshStandardMaterial color="#91bd72" roughness={.96}/>
  </mesh>
  <mesh position={[-3,.42,-6.7]} scale={[7.8,.7,3.4]} receiveShadow>
   <sphereGeometry args={[1,24,12]}/><meshStandardMaterial color="#80ae6e" roughness={1}/>
  </mesh>
  <mesh position={[11,.2,6.5]} rotation-x={-Math.PI/2}>
   <circleGeometry args={[3.3,32]}/><meshStandardMaterial color="#66b8c6" roughness={.5}/>
  </mesh>
 </group>
}

function Road({position,scale,rotation=0}:{position:[number,number,number];scale:[number,number,number];rotation?:number}){
 return <group position={position} rotation-y={rotation}>
  <mesh receiveShadow scale={scale}><boxGeometry/><meshStandardMaterial color="#d6d3c4" roughness={1}/></mesh>
  <mesh position-y={.512} scale={[scale[0]*.9,.015,.055]}><boxGeometry/><meshBasicMaterial color="#f8ecbd"/></mesh>
 </group>
}

function RoadNetwork(){
 return <group position-y={.39}>
  <Road position={[0,0,-3.2]} scale={[13,.08,.54]}/>
  <Road position={[-2.2,0,2.8]} scale={[12.8,.08,.55]}/>
  <Road position={[-6.1,0,-.1]} scale={[.52,.08,8.1]}/>
  <Road position={[4.1,0,-.2]} scale={[.52,.08,8.2]}/>
  <Road position={[-1.1,0,-.1]} scale={[.44,.08,8.8]}/>
  <Road position={[9.7,0,1.9]} scale={[.5,.08,6.4]}/>
  <Road position={[7.3,0,6]} scale={[6,.08,.47]} rotation={-.12}/>
 </group>
}

function DistrictGround({language}:{language:'zh'|'en'}){
 return <group>
  {DISTRICTS.map((district,index)=><group key={district.id} position={[district.position[0],.345,district.position[2]]}>
   <mesh rotation-x={-Math.PI/2} scale={[index===0 ? 1.2 : 1,index===5 ? .75 : 1,1]}>
    <circleGeometry args={[3.5,32]}/><meshStandardMaterial color={district.color} transparent opacity={.34} depthWrite={false}/>
   </mesh>
   <Html center position={[0,.12,0]} distanceFactor={24} zIndexRange={[5,0]}>
    <span className="world3d-district-label" style={{'--district-accent':district.accent} as React.CSSProperties}>{district.name[language]}</span>
   </Html>
  </group>)}
 </group>
}

function TinyBuildings({quality}:{quality:Quality}){
 return <group>
  {BUILDING_CLUSTERS.map(([x,z,variant],index)=>{
   const palette=BUILDING_COLORS[(index+variant)%BUILDING_COLORS.length]
   const width=1.05+(index%3)*.18
   const height=1.05+variant*.42+(index%4)*.12
   return <group key={`${x}-${z}`} position={[x,.47,z]} rotation-y={(index%3-1)*.06}>
    <mesh castShadow={quality==='high'} receiveShadow position-y={height/2}>
     <boxGeometry args={[width,height,.92]}/><meshStandardMaterial color={palette[0]} roughness={.88}/>
    </mesh>
    <mesh castShadow={quality==='high'} position-y={height+.22} rotation-y={Math.PI/4} scale={[.82,.32,.82]}>
     <octahedronGeometry args={[width*.7,0]}/><meshStandardMaterial color={palette[1]} roughness={.82}/>
    </mesh>
    <mesh position={[0,height*.62,.466]}>
     <planeGeometry args={[.24,.3]}/><meshBasicMaterial color="#91cad1"/>
    </mesh>
   </group>
  })}
 </group>
}

function Trees({quality}:{quality:Quality}){
 return <group>
  <Instances limit={TREES.length} castShadow={quality==='high'}>
   <cylinderGeometry args={[.08,.13,.55,7]}/><meshStandardMaterial color="#77583d" roughness={1}/>
   {TREES.map(([x,z],index)=><Instance key={`trunk-${index}`} position={[x,.75,z]}/>) }
  </Instances>
  <Instances limit={TREES.length} castShadow={quality==='high'}>
   <icosahedronGeometry args={[.48,0]}/><meshStandardMaterial color="#4f9368" roughness={.96}/>
   {TREES.map(([x,z],index)=><Instance key={`crown-${index}`} position={[x,1.25+(index%3)*.06,z]} scale={[.9+(index%2)*.16,1.1,.9]}/>) }
  </Instances>
 </group>
}

function LandmarkBuilding({landmark,selected,language,night,quality,onSelect}:{landmark:CityLandmark;selected:boolean;language:'zh'|'en';night:boolean;quality:Quality;onSelect:()=>void}){
 const [hovered,setHovered]=useState(false)
 useCursor(hovered)
 const position=worldPosition(landmark.x,landmark.y,.47)
 const seed=hashString(landmark.id)
 const colors=KIND_COLORS[landmark.kind]??KIND_COLORS.civic
 const height=1.7+(seed%5)*.22
 const width=1.55+(seed%3)*.18
 const select=(event:ThreeEvent<MouseEvent>)=>{event.stopPropagation();onSelect()}
 return <group position={position} scale={selected||hovered?1.08:1} onClick={select} onPointerOver={event=>{event.stopPropagation();setHovered(true)}} onPointerOut={()=>setHovered(false)}>
  <mesh castShadow={quality==='high'} receiveShadow position-y={height/2}>
   {landmark.kind==='culture'?<cylinderGeometry args={[width*.72,width*.82,height,10]}/>:<boxGeometry args={[width,height,width*.8]}/>} 
   <meshStandardMaterial color={colors.wall} roughness={.78} emissive={selected?colors.glow:'#000000'} emissiveIntensity={selected ? .18 : 0}/>
  </mesh>
  <mesh castShadow={quality==='high'} position-y={height+.32} rotation-y={Math.PI/4} scale={[1,.45,1]}>
   <octahedronGeometry args={[width*.73,0]}/><meshStandardMaterial color={colors.roof} roughness={.75}/>
  </mesh>
  {Array.from({length:3},(_,index)=><mesh key={index} position={[(index-1)*.42,height*.55,width*.405+.008]}>
   <planeGeometry args={[.22,.3]}/><meshBasicMaterial color={night?colors.glow:'#79b9c8'} toneMapped={false}/>
  </mesh>)}
  <mesh position={[0,.22,width*.42+.015]}><planeGeometry args={[.3,.44]}/><meshStandardMaterial color={colors.roof}/></mesh>
  {(selected||hovered)&&<Html center position={[0,height+1.15,0]} distanceFactor={15} zIndexRange={[30,0]}>
   <button type="button" className={`world3d-pin world3d-pin--place ${selected?'is-selected':''}`} onClick={event=>{event.stopPropagation();onSelect()}}>
    <span aria-hidden>{landmark.kind==='nature'?'✦':'⌂'}</span><strong>{landmark.name}</strong><small>{language==='zh'?'查看地点':'View place'}</small>
   </button>
  </Html>}
  {selected&&<pointLight position={[0,height+1,0]} color={colors.glow} intensity={3} distance={5}/>} 
 </group>
}

function CharacterMarker({character,active,language,onClick}:{character:CityCharacter;active:boolean;language:'zh'|'en';onClick:()=>void}){
 const [hovered,setHovered]=useState(false)
 useCursor(hovered)
 const position=worldPosition(character.location.x,character.location.y,.9)
 const color=`hsl(${hashString(character.id)%360} 62% 63%)`
 const initials=character.name.trim().slice(0,1).toUpperCase()
 return <group position={position} onPointerOver={event=>{event.stopPropagation();setHovered(true)}} onPointerOut={()=>setHovered(false)}>
  <mesh position-y={-.54} rotation-x={-Math.PI/2}>
   <ringGeometry args={[.42,.53,24]}/><meshBasicMaterial color={active?'#ff8d5b':color} transparent opacity={active ? .95 : .62} side={THREE.DoubleSide}/>
  </mesh>
  <Html center position={[0,.35,0]} distanceFactor={13} zIndexRange={[40,10]}>
   <button type="button" className={`world3d-character ${active?'is-active':''}`} style={{'--character-color':color} as React.CSSProperties} onClick={event=>{event.stopPropagation();onClick()}} aria-label={`${language==='zh'?'与':'Talk to '}${character.name}${language==='zh'?'互动':''}`}>
    <span aria-hidden>{initials}<i/></span>
    <b>{character.name}</b>
    {(hovered||active)&&<small>{character.location.place||(language==='zh'?'正在城市中':'Around town')}</small>}
   </button>
  </Html>
 </group>
}

function Harbour({quality}:{quality:Quality}){
 return <group position={[10,.55,7]}>
  {[-2,-.8,.4,1.6].map((x,index)=><mesh key={x} position={[x,0,index%2*.4]} castShadow={quality==='high'}><boxGeometry args={[.86,.22,2.8]}/><meshStandardMaterial color="#987050" roughness={.9}/></mesh>)}
  <group position={[3,.2,-.5]} rotation-y={-.2}>
   <mesh><boxGeometry args={[1.5,.36,.65]}/><meshStandardMaterial color="#f3eee0"/></mesh>
   <mesh position={[0,.65,0]}><coneGeometry args={[.08,1.5,8]}/><meshStandardMaterial color="#755b45"/></mesh>
   <mesh position={[.35,.7,0]} rotation-z={-.15}><planeGeometry args={[.72,.72]}/><meshStandardMaterial color="#e78464" side={THREE.DoubleSide}/></mesh>
  </group>
 </group>
}

function Lighthouse({night,quality}:{night:boolean;quality:Quality}){
 return <group position={[-14,1.1,4.8]}>
  <mesh castShadow={quality==='high'}><cylinderGeometry args={[.28,.48,2.2,12]}/><meshStandardMaterial color="#f4eee0"/></mesh>
  <mesh position-y={1.18}><cylinderGeometry args={[.42,.42,.32,12]}/><meshStandardMaterial color="#c96758"/></mesh>
  <mesh position-y={1.5}><coneGeometry args={[.5,.42,12]}/><meshStandardMaterial color="#b9554b"/></mesh>
  {night&&<pointLight position={[0,1.28,0]} color="#ffe2a0" intensity={8} distance={10}/>} 
 </group>
}

function Clouds({reducedMotion}:{reducedMotion:boolean}){
 return <group>
  {[[-9,8,-8],[7,10,-7],[12,7,2]].map(([x,y,z],index)=><Float key={index} speed={reducedMotion?0:.45+index*.1} rotationIntensity={reducedMotion?0:.08} floatIntensity={reducedMotion?0:.45}>
   <group position={[x,y,z]} scale={1+index*.18}>{[-.55,0,.55].map((offset,part)=><mesh key={part} position={[offset,part%2*.15,0]}><sphereGeometry args={[.72+(part%2)*.16,12,8]}/><meshStandardMaterial color="#fffaf0" transparent opacity={.82}/></mesh>)}</group>
  </Float>)}
 </group>
}

export function WorldScene({characters,landmarks,activeCharacterId,language,timeSlot,reducedMotion,selectedLandmarkId,focus,focusVersion,viewMode,qualityMode,onCharacterClick,onLandmarkSelect,onQualityChange}:SceneProps){
 const [autoQuality,setAutoQuality]=useState<Quality>(()=>typeof navigator!=='undefined'&&(navigator.hardwareConcurrency??8)<=4?'low':'high')
 const quality=qualityMode==='auto'?autoQuality:qualityMode
 const night=timeSlot==='evening'
 const setSceneQuality=(next:Quality)=>{
  if(qualityMode!=='auto')return
  setAutoQuality(next)
  onQualityChange(next)
 }
 const stars=useMemo(()=>night?(quality==='high'?140:60):0,[night,quality])
 return <>
  {qualityMode==='auto'&&<PerformanceMonitor flipflops={2} onDecline={()=>setSceneQuality('low')} onIncline={()=>setSceneQuality('high')}/>} 
  <color attach="background" args={[night?'#21384f':timeSlot==='morning'?'#bce7e2':'#9bd4e0']}/>
  <fog attach="fog" args={[night?'#29465a':'#b9dfda',32,68]}/>
  <ambientLight intensity={night ? .55 : 1.15} color={night?'#7891c8':'#fff7e8'}/>
  <hemisphereLight args={[night?'#5b72aa':'#e7fbff',night?'#25362f':'#6a8c58',night ? .7 : 1.25]}/>
  <directionalLight castShadow={quality==='high'} position={night?[-9,15,-8]:[10,18,8]} intensity={night ? .8 : 2.1} color={night?'#91a7dd':'#fff0cd'} shadow-mapSize={[quality==='high'?1536:512,quality==='high'?1536:512]} shadow-camera-far={50} shadow-camera-left={-22} shadow-camera-right={22} shadow-camera-top={18} shadow-camera-bottom={-18}/>
  <Ocean night={night} reducedMotion={reducedMotion}/>
  <IslandBase/>
  <DistrictGround language={language}/>
  <RoadNetwork/>
  <TinyBuildings quality={quality}/>
  <Trees quality={quality}/>
  <Harbour quality={quality}/>
  <Lighthouse night={night} quality={quality}/>
  {landmarks.map(landmark=><LandmarkBuilding key={landmark.id} landmark={landmark} selected={selectedLandmarkId===landmark.id} language={language} night={night} quality={quality} onSelect={()=>onLandmarkSelect(landmark)}/>)}
  {characters.slice(0,24).map(character=><CharacterMarker key={character.id} character={character} active={character.id===activeCharacterId} language={language} onClick={()=>onCharacterClick(character.id)}/>)}
  <Clouds reducedMotion={reducedMotion}/>
  {night&&<Sparkles count={stars} scale={[42,16,30]} position={[0,11,0]} size={1.7} speed={reducedMotion?0:.15} color="#fff2c9"/>}
  <CameraRig focus={focus} focusVersion={focusVersion} reducedMotion={reducedMotion} viewMode={viewMode}/>
 </>
}
