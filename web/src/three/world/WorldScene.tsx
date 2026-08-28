import {Html,Instances,Instance,OrbitControls,useCursor,useGLTF} from '@react-three/drei'
import {useFrame,useThree,type ThreeEvent} from '@react-three/fiber'
import {useEffect,useMemo,useRef,useState,type ComponentRef,type MutableRefObject} from 'react'
import * as THREE from 'three'
import {defaultAvatar} from '../../avatar'
import type {CityCharacter,CityLandmark} from '../../components/CityMap'
import {deriveResidentExpression} from '../../life/characterExpression'
import {CharacterEmote,DirectedCharacter3D,type CharacterMotion,type CharacterPerformance,type CharacterPerformanceMode} from '../characters'
import {
 BUILDING_LOTS,BUILDING_MODELS,CITY_PLATFORM_OUTLINE,DISTRICTS,KAYKIT_ASSET_BASE,KAYKIT_PROP_MODELS,KAYKIT_ROAD_MODELS,KIND_COLORS,ROAD_TILES,ROAD_TILE_SCALE,SKY_ROAD_EXITS,STREET_PROPS,TREES,WORLD_DEPTH,WORLD_WIDTH,
 buildingModelFor,hashString,worldPosition,
 type BuildingLot,type CityBuildingPlacement,type KayKitBuildingModel,type KayKitPropModel,type KayKitRoadModel,type TimeSlot,type WorldPoint,
} from './worldData'
import {cameraDampingAlpha,cameraPoseSettled,topViewOffset} from './worldCamera'
import {WorldDecorationPlacementSurface} from './WorldDecorationPlacementSurface'
import {WorldDecorations3D} from './WorldDecorations3D'
import type {WorldDecorationEditorMode} from './useWorldDecorationEditor'
import {createWorldDecorationValidationApi,type WorldDecoration,type WorldDecorationKind,type WorldDecorationValidationApi} from './worldDecorations'
import {buildPedestrianRoute,samplePedestrianRoute,type PedestrianRoute} from './worldNavigation'

type Quality='low'|'high'
export type WorldQuality='auto'|Quality
export type WorldViewMode='isometric'|'top'
export type WorldDecorationSceneEditor={
 active:boolean
 mode:WorldDecorationEditorMode
 selectedKind:WorldDecorationKind
 selectedId?:string
 decorations:readonly WorldDecoration[]
 onSelect:(id?:string)=>void
 onPlace:(position:[number,number])=>void
}

type SceneProps={
 characters:readonly CityCharacter[]
 landmarks:readonly CityLandmark[]
 followedCharacterId?:string
 serverTime?:string
 language:'zh'|'en'
 timeSlot:TimeSlot
 reducedMotion:boolean
 selectedLandmarkId?:string
 focus:WorldPoint|null
 focusVersion:number
 viewMode:WorldViewMode
 quality:Quality
 decorationEditor?:WorldDecorationSceneEditor
 onDecorationValidationApi?:(api:WorldDecorationValidationApi|null)=>void
 onCharacterClick:(id:string)=>void
 onCharacterEvent:(eventId:string)=>void
 onCharacterTrouble?:(characterId:string)=>void
 onJourneyElapsed?:()=>void
 onLandmarkSelect:(landmark:CityLandmark)=>void
}

type KayKitModel=KayKitBuildingModel|KayKitRoadModel|KayKitPropModel
type InstancePlacement={id:string;position:[number,number,number];rotation:number;scale:number}
type DirectedWorldAction=NonNullable<CityCharacter['worldAction']>&{performance?:CharacterPerformance;animation_cue?:CharacterMotion}

const BUILDING_HEIGHT:Record<KayKitBuildingModel,number>={
 building_A:1.65,building_B:1.65,building_C:2.98,building_D:2.97,
 building_E:2.35,building_F:2.35,building_G:2.98,building_H:3.05,
}

const ALL_WORLD_MODELS:readonly KayKitModel[]=[
 ...BUILDING_MODELS.residential,...BUILDING_MODELS.commercial,...BUILDING_MODELS.public,
 ...KAYKIT_ROAD_MODELS,...KAYKIT_PROP_MODELS,
]

// World Html overlays intentionally have no distanceFactor. Drei multiplies it
// by orthographic camera zoom, which can create a viewport-sized translucent
// surface on mobile browsers.

function useKayKitMesh(model:KayKitModel){
 const {scene}=useGLTF(`${KAYKIT_ASSET_BASE}/${model}.gltf`)
 const anisotropy=useThree(state=>Math.min(8,state.gl.capabilities.getMaxAnisotropy()))
 return useMemo(()=>{
  let found:THREE.Mesh|undefined
  scene.traverse(object=>{if(!found&&object instanceof THREE.Mesh)found=object})
  if(!found)throw new Error(`KayKit model has no mesh: ${model}`)
  const source=Array.isArray(found.material)?found.material[0]:found.material
  const material=source.clone()
  if(material instanceof THREE.MeshStandardMaterial){
   // Preserve KayKit's softly polished miniature finish instead of flattening
   // the authored colours into a chalky, uniformly matte surface.
   material.roughness=.5
   material.metalness=.01
   material.envMapIntensity=.82
   if(material.map){material.map.anisotropy=anisotropy;material.map.needsUpdate=true}
  }
  return {geometry:found.geometry,material}
 },[anisotropy,model,scene])
}

function AssetInstances({model,items,castShadow=false,receiveShadow=false}:{model:KayKitModel;items:readonly InstancePlacement[];castShadow?:boolean;receiveShadow?:boolean}){
 const {geometry,material}=useKayKitMesh(model)
 if(!items.length)return null
 return <Instances geometry={geometry} material={material} limit={items.length} castShadow={castShadow} receiveShadow={receiveShadow} frustumCulled>
  {items.map(item=><Instance key={item.id} position={item.position} rotation={[0,item.rotation,0]} scale={item.scale}/>) }
 </Instances>
}

function AssetObject({model,item,castShadow=false,receiveShadow=false}:{model:KayKitModel;item:InstancePlacement;castShadow?:boolean;receiveShadow?:boolean}){
 const {scene}=useGLTF(`${KAYKIT_ASSET_BASE}/${model}.gltf`)
 const anisotropy=useThree(state=>Math.min(8,state.gl.capabilities.getMaxAnisotropy()))
 const object=useMemo(()=>{
  const clone=scene.clone(true)
  clone.traverse(child=>{
   if(child instanceof THREE.Mesh){
    child.castShadow=castShadow
    child.receiveShadow=receiveShadow
    const materials=(Array.isArray(child.material)?child.material:[child.material]).map(source=>{
     const material=source.clone()
     if(material instanceof THREE.MeshStandardMaterial){
      material.roughness=.5
      material.metalness=.01
      material.envMapIntensity=.82
      if(material.map){material.map.anisotropy=anisotropy;material.map.needsUpdate=true}
     }
     return material
    })
    child.material=Array.isArray(child.material)?materials:materials[0]
   }
  })
  return clone
 },[anisotropy,castShadow,receiveShadow,scene])
 return <primitive object={object} position={item.position} rotation={[0,item.rotation,0]} scale={item.scale}/>
}

type ActorRegistry=MutableRefObject<Map<string,THREE.Group>>

function CameraRig({focus,focusVersion,followedCharacterId,followCameraOffset,followWalking,actors,reducedMotion,viewMode}:{focus:WorldPoint|null;focusVersion:number;followedCharacterId?:string;followCameraOffset:WorldPoint;followWalking:boolean;actors:ActorRegistry;reducedMotion:boolean;viewMode:WorldViewMode}){
 const {camera,size}=useThree()
 const controls=useRef<ComponentRef<typeof OrbitControls>>(null)
 const moving=useRef(false)
 const desiredPosition=useRef(new THREE.Vector3(38,36,44))
 const desiredTarget=useRef(new THREE.Vector3(0,0,-1.5))
 const desiredZoom=useRef(25)
 const actorPosition=useRef(new THREE.Vector3())
 const followLookOffset=useRef(new THREE.Vector3(0,.3,0))
 const staticFollowOffset=useMemo(()=>new THREE.Vector3(...followCameraOffset),[followCameraOffset])
 const smoothedFollowOffset=useRef(new THREE.Vector3(...followCameraOffset))
 const previousFollowedCharacterId=useRef<string|undefined>(undefined)
 const manuallyControlled=useRef(false)
 const previousCameraCommand=useRef('')

 useEffect(()=>{
  const cameraCommand=[viewMode,focusVersion,followedCharacterId??'',focus?.join(',')??'',staticFollowOffset.toArray().join(',')].join(':')
  const semanticChange=cameraCommand!==previousCameraCommand.current
  previousCameraCommand.current=cameraCommand
  if(semanticChange)manuallyControlled.current=false
  // A late ResizeObserver update is common while the opening cloud layer is
  // leaving. Once the player has taken control, that layout-only update must
  // not re-arm the initial framing animation and pull the map back.
  if(!semanticChange&&manuallyControlled.current){moving.current=false;return}
  const following=Boolean(followedCharacterId)
  const actor=followedCharacterId?actors.current.get(followedCharacterId):undefined
  const target=new THREE.Vector3(...(focus??[0,0,-1.5]))
  if(actor){actor.getWorldPosition(target);target.add(followLookOffset.current)}
  desiredTarget.current.copy(target)
  const focused=Boolean(focus||following)
  if(previousFollowedCharacterId.current!==followedCharacterId){
   smoothedFollowOffset.current.copy(staticFollowOffset)
   previousFollowedCharacterId.current=followedCharacterId
  }
  const offset=following
   ?smoothedFollowOffset.current
   :viewMode==='top'
    ?new THREE.Vector3(...topViewOffset(focused?28:54))
    :(focused?new THREE.Vector3(12.5,14,15):new THREE.Vector3(38,36,44))
  desiredPosition.current.copy(target).add(offset)
  const portrait=size.height>size.width*1.25
  const overviewFit=portrait
   ?Math.min(size.width/(viewMode==='top'?42:40),size.height/(viewMode==='top'?46:48))
   :Math.min(size.width/(viewMode==='top'?52:56),size.height/(viewMode==='top'?35:33))*.96
  const focusFit=Math.min(52,Math.max(30,size.height/17))
  const followFit=portrait
   ?Math.min(108,Math.max(98,size.width/3.75))
   :Math.min(118,Math.max(104,size.height/6.35))
  desiredZoom.current=following?followFit:focused?(viewMode==='top'?Math.min(30,focusFit):focusFit):overviewFit
  moving.current=true
  if(reducedMotion){
   camera.position.copy(desiredPosition.current)
   if(camera instanceof THREE.OrthographicCamera){camera.zoom=desiredZoom.current;camera.updateProjectionMatrix()}
   controls.current?.target.copy(desiredTarget.current)
   controls.current?.update()
   moving.current=false
  }
 },[actors,camera,focus,focusVersion,followedCharacterId,reducedMotion,size.height,size.width,staticFollowOffset,viewMode])

 useFrame((_,delta)=>{
  if(followedCharacterId){
   const actor=actors.current.get(followedCharacterId)
   if(actor){
    actor.getWorldPosition(actorPosition.current)
    // Follow from one stable, parcel-aware isometric side. Re-selecting the
    // nearest road tile here used to flip the camera heading at every cell
    // boundary, especially while an actor turned at a junction.
    const followResponsiveness=followWalking?2.8:4.2
    smoothedFollowOffset.current.lerp(staticFollowOffset,cameraDampingAlpha(delta,followResponsiveness))
    desiredTarget.current.copy(actorPosition.current).add(followLookOffset.current)
    desiredPosition.current.copy(desiredTarget.current).add(smoothedFollowOffset.current)
    moving.current=true
   }
  }
  if(!moving.current||!controls.current)return
  const alpha=cameraDampingAlpha(delta,followedCharacterId&&followWalking?3.6:4.8)
  camera.position.lerp(desiredPosition.current,alpha)
  controls.current.target.lerp(desiredTarget.current,alpha)
  if(camera instanceof THREE.OrthographicCamera){
   camera.zoom=THREE.MathUtils.lerp(camera.zoom,desiredZoom.current,alpha)
   camera.updateProjectionMatrix()
  }
  controls.current.update()
  const zoomDelta=camera instanceof THREE.OrthographicCamera?camera.zoom-desiredZoom.current:0
  if(!followedCharacterId&&cameraPoseSettled(camera.position.distanceToSquared(desiredPosition.current),controls.current.target.distanceToSquared(desiredTarget.current),zoomDelta)){
   camera.position.copy(desiredPosition.current)
   if(camera instanceof THREE.OrthographicCamera){camera.zoom=desiredZoom.current;camera.updateProjectionMatrix()}
   controls.current.target.copy(desiredTarget.current)
   moving.current=false
  }
 })

 const cancelProgrammaticMove=()=>{if(!followedCharacterId){manuallyControlled.current=true;moving.current=false}}
 return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={reducedMotion?1:.08} minZoom={5} maxZoom={120} minPolarAngle={viewMode==='top' ? .01 : .5} maxPolarAngle={1.22} enablePan={!followedCharacterId} enableRotate={!followedCharacterId} enableZoom={!followedCharacterId} screenSpacePanning maxDistance={110} minDistance={2} onStart={cancelProgrammaticMove}/>
}

// A manufactured, chamfered city deck reads as one district in a much larger
// world. It deliberately avoids the organic shoreline silhouette of an island.
const createPlatformShape=(scale:number)=>{
 const shape=new THREE.Shape()
 CITY_PLATFORM_OUTLINE.forEach(([x,z],index)=>index?shape.lineTo(x*scale,z*scale):shape.moveTo(x*scale,z*scale))
 shape.closePath()
 return shape
}

const PLATFORM_SHELL=createPlatformShape(1)
const PLATFORM_TOP=createPlatformShape(.985)

const UNDERCITY_ANCHORS:readonly [number,number,number,number][]= [
 [-18,-2.3,-9,1.8],[-10,-2.45,8,2.1],[-2,-2.65,-3,2.4],[7,-2.45,8,2.15],
 [16,-2.35,-7,1.95],[20,-2.2,6,1.55],[-19,-2.2,7,1.5],[9,-2.3,-10,1.7],
]

function FloatingCityBase({quality}:{quality:Quality}){
 return <group>
  <mesh position-y={-1.06} rotation-x={-Math.PI/2} receiveShadow castShadow={quality==='high'}>
   <extrudeGeometry args={[PLATFORM_SHELL,{depth:1.06,bevelEnabled:true,bevelSize:.32,bevelThickness:.2,bevelSegments:4,curveSegments:2}]}/>
   <meshStandardMaterial color="#43535c" roughness={.64} metalness={.045}/>
  </mesh>
  <mesh position-y={.222} rotation-x={-Math.PI/2} receiveShadow>
   <shapeGeometry args={[PLATFORM_TOP]}/>
   <meshStandardMaterial color="#606d70" roughness={.76} metalness={.02}/>
  </mesh>
  <mesh position-y={.232} rotation-x={-Math.PI/2} scale={[.978,.978,1]} receiveShadow>
   <shapeGeometry args={[PLATFORM_TOP]}/>
   <meshStandardMaterial color="#707c7b" roughness={.84}/>
  </mesh>
  {UNDERCITY_ANCHORS.map(([x,y,z,scale],index)=><group key={`under-city-${index}`} position={[x,y,z]} rotation-y={index*.71}>
   <mesh castShadow={quality==='high'} scale={[scale*.88,scale*.62,scale*.78]}>
    <dodecahedronGeometry args={[1,0]}/>
    <meshStandardMaterial color={index%2?'#596267':'#677076'} roughness={.9}/>
   </mesh>
   <mesh position={[0,-scale*1.05,0]} rotation-z={Math.PI} castShadow={quality==='high'} scale={[scale*.34,scale*.82,scale*.32]}>
    <coneGeometry args={[1,2,7]}/>
    <meshStandardMaterial color="#4e585e" roughness={.94}/>
   </mesh>
  </group>)}
 </group>
}

function DistrictGround({language}:{language:'zh'|'en'}){
 return <group>
  {DISTRICTS.map(district=><group key={district.id} position={[district.position[0],.235,district.position[2]]}>
   <Html center position={[0,.14,0]} zIndexRange={[5,0]}>
    <span className="world3d-district-label" style={{'--district-accent':district.accent} as React.CSSProperties}>{district.name[language]}</span>
   </Html>
  </group>)}
 </group>
}

function RoadNetwork(){
 return <group>
  {KAYKIT_ROAD_MODELS.map(model=><AssetInstances key={model} model={model} receiveShadow items={ROAD_TILES.filter(tile=>tile.model===model).map(tile=>({id:tile.id,position:[tile.position[0],.245,tile.position[1]],rotation:tile.rotation,scale:ROAD_TILE_SCALE}))}/>) }
 </group>
}

const COURTYARD_CARS:readonly {id:string;model:KayKitPropModel;position:[number,number];rotation:number}[]=[
 {id:'station-yard-car-a',model:'car_sedan',position:[13.4,6],rotation:0},
 {id:'station-yard-car-b',model:'car_hatchback',position:[16.1,6],rotation:0},
 {id:'station-yard-car-c',model:'car_stationwagon',position:[18.7,6],rotation:0},
]

function CourtyardFeatures({quality}:{quality:Quality}){
 const cars=quality==='high'?COURTYARD_CARS:COURTYARD_CARS.slice(0,2)
 return <group>
  <group position={[-.8,.3,-6.5]}>
   <mesh receiveShadow><boxGeometry args={[14.4,.12,4.25]}/><meshStandardMaterial color="#8daf76" roughness={.96}/></mesh>
   <mesh position={[0,.075,0]} receiveShadow><boxGeometry args={[13.6,.025,.5]}/><meshStandardMaterial color="#d7d0b0" roughness={.92}/></mesh>
   <mesh position={[0,.078,0]} rotation-y={Math.PI/2} receiveShadow><boxGeometry args={[3.55,.028,.45]}/><meshStandardMaterial color="#e3d9ba" roughness={.92}/></mesh>
   <mesh position={[0,.16,0]} castShadow={quality==='high'}><cylinderGeometry args={[.62,.78,.28,20]}/><meshStandardMaterial color="#d6c7a4" roughness={.84}/></mesh>
   <mesh position={[0,.32,0]} rotation-x={-Math.PI/2}><circleGeometry args={[.5,24]}/><meshStandardMaterial color="#7fc4cf" roughness={.32} metalness={.06}/></mesh>
  </group>
  <group position={[0,.3,6.5]}>
   <mesh receiveShadow><boxGeometry args={[5.5,.12,4.4]}/><meshStandardMaterial color="#d9c89f" roughness={.9}/></mesh>
   <mesh position-y={.075} rotation-x={-Math.PI/2}><ringGeometry args={[.65,1.05,28]}/><meshStandardMaterial color="#eee2c3" roughness={.9}/></mesh>
   <mesh position-y={.25} castShadow={quality==='high'}><cylinderGeometry args={[.52,.67,.38,20]}/><meshStandardMaterial color="#b9a481" roughness={.84}/></mesh>
   <mesh position-y={.455} rotation-x={-Math.PI/2}><circleGeometry args={[.43,24]}/><meshStandardMaterial color="#77bfcd" roughness={.3} metalness={.07}/></mesh>
  </group>
  <group position={[16,.3,6.5]}>
   <mesh receiveShadow><boxGeometry args={[7.7,.12,4.4]}/><meshStandardMaterial color="#4e5a61" roughness={.88}/></mesh>
   {[-2.6,0,2.6].map(offset=><group key={offset} position={[offset,.08,0]}>{[-.63,.63].map(side=><mesh key={side} position={[side,0,0]}><boxGeometry args={[.055,.025,3.55]}/><meshBasicMaterial color="#e5e2d7"/></mesh>)}</group>)}
  </group>
  {cars.map(item=><AssetObject key={item.id} model={item.model} item={{id:item.id,position:[item.position[0],.46,item.position[1]],rotation:item.rotation,scale:1.12}} castShadow={quality==='high'} receiveShadow/>)}
 </group>
}

function SkyRoadDecks({quality}:{quality:Quality}){
 return <group>
  {SKY_ROAD_EXITS.map(exit=><group key={exit.id} position={[exit.position[0],-.2,exit.position[1]]} rotation-y={exit.rotation}>
   <mesh receiveShadow castShadow={quality==='high'}>
    <boxGeometry args={[exit.width*1.08,.86,exit.length]}/>
    <meshStandardMaterial color="#667077" roughness={.76} metalness={.025}/>
   </mesh>
   {[-1,1].map(side=><mesh key={side} position={[side*exit.width*.55,.53,0]} castShadow={quality==='high'}>
    <boxGeometry args={[.16,.24,exit.length+.12]}/>
    <meshStandardMaterial color="#c8cbc8" roughness={.82}/>
   </mesh>)}
   {[-.28,.28].map(offset=><mesh key={offset} position={[0,-.69,exit.length*offset]} castShadow={quality==='high'}>
    <boxGeometry args={[exit.width*.72,.72,.5]}/>
    <meshStandardMaterial color="#515c63" roughness={.9}/>
   </mesh>)}
  </group>)}
 </group>
}

const pointDistanceSquared=(a:[number,number],b:[number,number])=>(a[0]-b[0])**2+(a[1]-b[1])**2

type HomePlacement={character:CityCharacter;model:KayKitBuildingModel;position:WorldPoint;rotation:number;scale:number;lot:BuildingLot}
type LandmarkPlacement={landmark:CityLandmark;model:KayKitBuildingModel;position:WorldPoint;rotation:number;scale:number;lot:BuildingLot}
type ResolvedCityLayout={
 landmarkPlacements:LandmarkPlacement[]
 homePlacements:HomePlacement[]
 fillerBuildings:CityBuildingPlacement[]
 landmarkLots:Map<string,BuildingLot>
 homeLots:Map<string,BuildingLot>
 occupiedPositions:[number,number][]
}

const CITY_BUILDING_TARGET=54
const SCENIC_RESERVES:readonly {position:[number,number];radius:number}[]=[
 {position:[-5.3,-11.9],radius:3.4},
 {position:[1.6,-5.7],radius:3},
 {position:[-3.5,10.9],radius:3.1},
 {position:[12.2,10.7],radius:3.2},
 {position:[-22.8,-14.5],radius:2.7},
]

const targetPosition=(point:{x:number;y:number})=>{
 const [x,,z]=worldPosition(point.x,point.y)
 return [x,z] as [number,number]
}

const claimNearestLot=(available:BuildingLot[],target:[number,number],key:string,preferredFamily?:BuildingLot['family'])=>{
 let chosenIndex=0,chosenScore=Number.POSITIVE_INFINITY
 available.forEach((lot,index)=>{
  const familyPenalty=preferredFamily&&lot.family!==preferredFamily?2.2:0
  const score=pointDistanceSquared(lot.position,target)+familyPenalty+(hashString(`${key}:${lot.id}`)%997)/1_000_000
  if(score<chosenScore){chosenIndex=index;chosenScore=score}
 })
 return available.splice(chosenIndex,1)[0]
}

const layoutGridKey=([x,z]:[number,number])=>`${Math.max(0,Math.min(3,Math.floor((x+28)/14)))}:${Math.max(0,Math.min(2,Math.floor((z+19)/12.67)))}`
const isScenicLot=(lot:BuildingLot)=>SCENIC_RESERVES.some(reserve=>pointDistanceSquared(lot.position,reserve.position)<reserve.radius**2)

function resolveCityLayout(landmarks:readonly CityLandmark[],characters:readonly CityCharacter[]):ResolvedCityLayout{
 const available=[...BUILDING_LOTS]
 const landmarkLots=new Map<string,BuildingLot>()
 const homeLots=new Map<string,BuildingLot>()

 ;[...landmarks].sort((a,b)=>a.id.localeCompare(b.id)).forEach(landmark=>{
  const family=buildingModelFor(landmark.kind,landmark.id)
  const preferredFamily=Object.entries(BUILDING_MODELS).find(([,models])=>models.includes(family))?.[0] as BuildingLot['family']|undefined
  landmarkLots.set(landmark.id,claimNearestLot(available,targetPosition(landmark),`landmark:${landmark.id}`,preferredFamily))
 })
 ;[...characters].slice(0,5).sort((a,b)=>a.id.localeCompare(b.id)).forEach(character=>{
  homeLots.set(character.id,claimNearestLot(available,targetPosition(character.home),`home:${character.id}`,'residential'))
 })

 const landmarkPlacements=landmarks.map(landmark=>{
  const lot=landmarkLots.get(landmark.id)!
  const hash=hashString(`landmark:${landmark.id}`)
  return {landmark,lot,model:buildingModelFor(landmark.kind,landmark.id),position:[lot.position[0],.369,lot.position[1]] as WorldPoint,rotation:lot.rotation,scale:1.16+(hash%4)*.018}
 })
 const homePlacements=characters.slice(0,5).map(character=>{
  const lot=homeLots.get(character.id)!
  const hash=hashString(`home:${character.id}`)
  return {character,lot,model:BUILDING_MODELS.residential[hash%BUILDING_MODELS.residential.length],position:[lot.position[0],.369,lot.position[1]] as WorldPoint,rotation:lot.rotation,scale:1.12+(hash%3)*.025}
 })

 const occupiedLots=[...landmarkLots.values(),...homeLots.values()]
 const districtCounts=new Map<string,number>()
 const gridCounts=new Map<string,number>()
 occupiedLots.forEach(lot=>{
  districtCounts.set(lot.district,(districtCounts.get(lot.district)??0)+1)
  const grid=layoutGridKey(lot.position)
  gridCounts.set(grid,(gridCounts.get(grid)??0)+1)
 })
 const fillerBuildings:CityBuildingPlacement[]=[]
 const fillerCount=Math.max(0,Math.min(available.length,CITY_BUILDING_TARGET-occupiedLots.length))
 for(let index=0;index<fillerCount;index+=1){
  let chosenIndex=0,chosenScore=Number.POSITIVE_INFINITY
  available.forEach((lot,lotIndex)=>{
   const nearest=occupiedLots.length?Math.min(...occupiedLots.map(item=>pointDistanceSquared(item.position,lot.position))):0
   const score=(gridCounts.get(layoutGridKey(lot.position))??0)*180+(districtCounts.get(lot.district)??0)*42+(isScenicLot(lot)?10_000:0)-Math.min(nearest,110)*.32+(hashString(`fabric:${lot.id}`)%997)/1_000
   if(score<chosenScore){chosenIndex=lotIndex;chosenScore=score}
  })
  const lot=available.splice(chosenIndex,1)[0]
  occupiedLots.push(lot)
  districtCounts.set(lot.district,(districtCounts.get(lot.district)??0)+1)
  const grid=layoutGridKey(lot.position)
  gridCounts.set(grid,(gridCounts.get(grid)??0)+1)
  const depth=.65*lot.position[0]+.76*lot.position[1]
  const models=depth>=8
   ?lot.family==='residential'?BUILDING_MODELS.residential.slice(0,2):lot.family==='commercial'?(['building_E'] as const):(['building_F'] as const)
   :BUILDING_MODELS[lot.family]
  const model=models[hashString(lot.id)%models.length]
  const baseScale=depth<=-7?1.1:depth>=8?.98:1.04
  fillerBuildings.push({id:`fabric-${lot.id}`,family:lot.family,model,position:lot.position,rotation:lot.rotation,scale:baseScale+(hashString(`scale:${lot.id}`)%4)*.025})
 }

 return {
  landmarkPlacements,homePlacements,fillerBuildings,landmarkLots,homeLots,
  occupiedPositions:occupiedLots.map(lot=>lot.position),
 }
}

function CityFabric({buildings,quality}:{buildings:readonly CityBuildingPlacement[];quality:Quality}){
 return <group>
  <AssetInstances model="base" receiveShadow items={buildings.map(building=>({id:`lot-${building.id}`,position:[building.position[0],.238,building.position[1]],rotation:building.rotation,scale:ROAD_TILE_SCALE}))}/>
  {([...BUILDING_MODELS.residential,...BUILDING_MODELS.commercial,...BUILDING_MODELS.public] as KayKitBuildingModel[]).map(model=><AssetInstances key={model} model={model} castShadow={quality==='high'} receiveShadow items={buildings.filter(building=>building.model===model).map(building=>({id:building.id,position:[building.position[0],.369,building.position[1]],rotation:building.rotation,scale:building.scale}))}/>) }
 </group>
}

function ResidentialHomes({homes,quality,language,onSelect}:{homes:readonly HomePlacement[];quality:Quality;language:'zh'|'en';onSelect:(id:string)=>void}){
 return <group>
  <AssetInstances model="base" receiveShadow items={homes.map(home=>({id:`home-lot-${home.character.id}`,position:[home.position[0],.238,home.position[2]],rotation:home.rotation,scale:ROAD_TILE_SCALE}))}/>
  {BUILDING_MODELS.residential.map(model=><AssetInstances key={model} model={model} castShadow={quality==='high'} receiveShadow items={homes.filter(home=>home.model===model).map(home=>({id:`home-${home.character.id}`,position:home.position,rotation:home.rotation,scale:home.scale}))}/>) }
  {homes.map(home=><Html key={`home-label-${home.character.id}`} center position={[home.position[0],home.position[1]+BUILDING_HEIGHT[home.model]*home.scale+.58,home.position[2]]} zIndexRange={[24,2]}>
   <button type="button" className="world3d-home" onClick={event=>{event.stopPropagation();onSelect(home.character.id)}} aria-label={language==='zh'?`${home.character.name}的家`:`${home.character.name}'s home`}><span aria-hidden>⌂</span>{home.character.name}</button>
  </Html>)}
 </group>
}

const ROAD_PROPS=new Set<KayKitPropModel>(['streetlight','trafficlight_A','trafficlight_B','trafficlight_C','firehydrant','car_sedan','car_taxi','car_police','car_hatchback','car_stationwagon'])

function StreetLife({quality,occupiedPositions}:{quality:Quality;occupiedPositions:readonly [number,number][]}){
 const qualityPlacements=quality==='high'?STREET_PROPS:STREET_PROPS.filter((_,index)=>index%2===0)
 const placements=qualityPlacements.filter(item=>ROAD_PROPS.has(item.model)||occupiedPositions.every(position=>pointDistanceSquared(position,item.position)>4.4))
 const staticPlacements=placements.filter(item=>!item.model.startsWith('car_'))
 const models=Array.from(new Set(staticPlacements.map(item=>item.model)))
 const cars=placements.filter(item=>item.model.startsWith('car_'))
 return <group>
  {models.map(model=><AssetInstances key={model} model={model} castShadow={quality==='high'} receiveShadow items={staticPlacements.filter(item=>item.model===model).map(item=>({
   id:item.id,
   position:[item.position[0],.37,item.position[1]],
   rotation:item.rotation,
   scale:item.scale,
  }))}/>) }
  {cars.map(item=><AssetObject key={item.id} model={item.model} item={{id:item.id,position:[item.position[0],.47,item.position[1]],rotation:item.rotation,scale:item.scale}} castShadow={quality==='high'} receiveShadow/>)}
 </group>
}

function Trees({quality,occupiedPositions}:{quality:Quality;occupiedPositions:readonly [number,number][]}){
 const qualityTrees=quality==='high'?TREES:TREES.filter((_,index)=>index%2===0)
 const trees=qualityTrees.filter(tree=>occupiedPositions.every(position=>pointDistanceSquared(position,tree)>4.2))
 return <group>
  <Instances limit={trees.length} castShadow={quality==='high'}>
   <cylinderGeometry args={[.09,.15,.62,7]}/><meshStandardMaterial color="#75543c" roughness={1}/>
   {trees.map(([x,z],index)=><Instance key={`trunk-${index}`} position={[x,.68,z]} rotation={[0,index*.72,0]}/>) }
  </Instances>
  <Instances limit={trees.length} castShadow={quality==='high'}>
   <icosahedronGeometry args={[.52,1]}/><meshStandardMaterial color="#4f9368" roughness={.96}/>
   {trees.map(([x,z],index)=><Instance key={`crown-${index}`} position={[x,1.28+(index%3)*.07,z]} scale={[.9+(index%2)*.16,1.08,.9]}/>) }
  </Instances>
 </group>
}

function LandmarkModelInstances({model,items,selectedId,quality,onHover,onSelect}:{model:KayKitBuildingModel;items:readonly LandmarkPlacement[];selectedId?:string;quality:Quality;onHover:(id?:string)=>void;onSelect:(landmark:CityLandmark)=>void}){
 const {geometry,material}=useKayKitMesh(model)
 return <Instances geometry={geometry} material={material} limit={items.length} castShadow={quality==='high'} receiveShadow>
  {items.map(item=><Instance
   key={item.landmark.id}
   position={item.position}
   rotation={[0,item.rotation,0]}
   scale={item.landmark.id===selectedId?item.scale*1.07:item.scale}
   onClick={(event:ThreeEvent<MouseEvent>)=>{event.stopPropagation();onSelect(item.landmark)}}
   onPointerOver={event=>{event.stopPropagation();onHover(item.landmark.id)}}
   onPointerOut={()=>onHover(undefined)}
  />)}
 </Instances>
}

function LandmarkBuildings({placements,selectedId,hoveredId,language,night,quality,onHover,onSelect}:{placements:readonly LandmarkPlacement[];selectedId?:string;hoveredId?:string;language:'zh'|'en';night:boolean;quality:Quality;onHover:(id?:string)=>void;onSelect:(landmark:CityLandmark)=>void}){
 return <group>
  <AssetInstances model="base" receiveShadow items={placements.map(item=>({id:`landmark-lot-${item.landmark.id}`,position:[item.position[0],.238,item.position[2]],rotation:item.rotation,scale:ROAD_TILE_SCALE}))}/>
  {([...BUILDING_MODELS.residential,...BUILDING_MODELS.commercial,...BUILDING_MODELS.public] as KayKitBuildingModel[]).map(model=>{
   const items=placements.filter(item=>item.model===model)
   return items.length?<LandmarkModelInstances key={model} model={model} items={items} selectedId={selectedId} quality={quality} onHover={onHover} onSelect={onSelect}/>:null
  })}
  {placements.map(item=>{
   const visible=item.landmark.id===selectedId||item.landmark.id===hoveredId
   if(!visible)return null
   const colors=KIND_COLORS[item.landmark.kind]??KIND_COLORS.civic
   const height=BUILDING_HEIGHT[item.model]*item.scale
   return <group key={`overlay-${item.landmark.id}`} position={item.position}>
    <mesh rotation-x={-Math.PI/2} position-y={.035}>
     <ringGeometry args={[1.55,1.8,40]}/><meshBasicMaterial color={colors.glow} transparent opacity={item.landmark.id===selectedId ? .95 : .58} side={THREE.DoubleSide}/>
    </mesh>
    <Html center position={[0,height+.7,0]} zIndexRange={[30,0]}>
     <button type="button" className={`world3d-pin world3d-pin--place ${item.landmark.id===selectedId?'is-selected':''}`} onClick={event=>{event.stopPropagation();onSelect(item.landmark)}}>
      <span aria-hidden>{item.landmark.kind==='nature'?'✦':'⌂'}</span><strong>{item.landmark.name}</strong><small>{language==='zh'?'查看地点':'View place'}</small>
     </button>
    </Html>
    {item.landmark.id===selectedId&&<pointLight position={[0,height+.6,0]} color={colors.glow} intensity={night?5:2.4} distance={6}/>}
   </group>
  })}
 </group>
}

const waitingFacing=(lot:BuildingLot,participantIndex:number)=>{
 const side:[number,number]=[Math.cos(lot.rotation),-Math.sin(lot.rotation)]
 const direction=participantIndex%2===0?side:[-side[0],-side[1]]
 return Math.atan2(direction[0],direction[1])
}

const characterStandingPosition=(character:CityCharacter,lot?:BuildingLot):WorldPoint=>{
 const characterHash=hashString(character.id)
 const fallback=worldPosition(character.location.x,character.location.y,.375)
 if(!lot)return fallback
 const action=character.worldAction as DirectedWorldAction|undefined
 const lateral=action?.state==='waiting_at_event'?(action.participant_index ? .7 : -.7):((characterHash%5)-2)*.13
 const forward:[number,number]=[Math.sin(lot.rotation),Math.cos(lot.rotation)]
 const side:[number,number]=[Math.cos(lot.rotation),-Math.sin(lot.rotation)]
 return [
  THREE.MathUtils.clamp(lot.position[0]+forward[0]*1.56+side[0]*lateral,-WORLD_WIDTH/2+1.5,WORLD_WIDTH/2-1.5),
  .375,
  THREE.MathUtils.clamp(lot.position[1]+forward[1]*1.56+side[1]*lateral,-WORLD_DEPTH/2+1.5,WORLD_DEPTH/2-1.5),
 ]
}

function CharacterMarker({character,lot,route,active,actors,serverTime,reducedMotion,language,onClick,onEvent,onTrouble,onJourneyElapsed}:{character:CityCharacter;lot?:BuildingLot;route?:PedestrianRoute;active:boolean;actors:ActorRegistry;serverTime?:string;reducedMotion:boolean;language:'zh'|'en';onClick:()=>void;onEvent:(eventId:string)=>void;onTrouble?:()=>void;onJourneyElapsed?:()=>void}){
 const [hovered,setHovered]=useState(false)
 useCursor(hovered)
 const actor=useRef<THREE.Group>(null)
 const characterHash=hashString(character.id)
 const action=character.worldAction as DirectedWorldAction|undefined
 // Rotation points from a parcel to its nearest road. Residents stand on that
 // pavement, so moving a building to a legal parcel also moves its resident.
 const position=characterStandingPosition(character,lot)
 const serverSkew=useMemo(()=>{const parsed=Date.parse(serverTime||'');return Number.isFinite(parsed)?parsed-Date.now():0},[serverTime])
 const startedAt=Date.parse(action?.started_at||''),arrivesAt=Date.parse(action?.arrives_at||'')
 const alreadyArrived=action?.state==='walking_to_event'&&Number.isFinite(arrivesAt)&&Date.now()+serverSkew>=arrivesAt
 const desiredState=alreadyArrived?'waiting_at_event':action?.state??'idle'
 const [visualState,setVisualState]=useState(desiredState)
 const arrivalNotified=useRef('')
 useEffect(()=>setVisualState(desiredState),[desiredState])
 useEffect(()=>{
  const current=actor.current
  if(!current)return
  const registry=actors.current
  registry.set(character.id,current)
  return()=>{if(registry.get(character.id)===current)registry.delete(character.id)}
 },[actors,character.id])
 useEffect(()=>{arrivalNotified.current=''},[action?.event_id])
 const waitingRotation=visualState==='waiting_at_event'&&lot?waitingFacing(lot,action?.participant_index??0):undefined
 useFrame((_,delta)=>{
  if(!actor.current)return
  if(visualState==='waiting_at_event'&&waitingRotation!==undefined){
   const difference=Math.atan2(Math.sin(waitingRotation-actor.current.rotation.y),Math.cos(waitingRotation-actor.current.rotation.y))
   actor.current.rotation.y+=difference*(1-Math.exp(-delta*5.2))
   return
  }
  if(!route||action?.state!=='walking_to_event')return
  const duration=arrivesAt-startedAt
  const timedProgress=duration>0?(Date.now()+serverSkew-startedAt)/duration:1
  // Reduced motion may remove travel interpolation, but it must never advance
  // the server-owned arrival time or expose an event before it actually starts.
  const progress=reducedMotion?(timedProgress>=1?1:0):timedProgress
  const sample=samplePedestrianRoute(route,progress)
  actor.current.position.set(...sample.position)
  actor.current.rotation.y=sample.rotation
  if(sample.done&&action.event_id&&arrivalNotified.current!==action.event_id){
   arrivalNotified.current=action.event_id
   setVisualState('waiting_at_event')
   onJourneyElapsed?.()
  }
 })
 const avatar=character.avatar??defaultAvatar
 const cityAsset=avatar.model?.startsWith('city-')??false
 const characterScale=cityAsset?(active ? .28 : hovered ? .22 : .175):(active ? .34 : hovered ? .27 : .21)
 const color=`hsl(${characterHash%360} 62% 63%)`
 const moving=visualState==='walking_to_event'
 const waiting=visualState==='waiting_at_event'
 const expression=deriveResidentExpression({
  npcId:character.id,action:character.lifeAction,animationCue:character.animationCue,
  observableState:character.observableState,troubleSignal:character.troubleSignal,
  story:character.storyContext,relationship:character.relationshipContext,
 })
 const animation:CharacterMotion=moving
  ?(character.animationCue==='run'?'run':'walk')
  :waiting
   ?(action?.state==='walking_to_event'?'look_around':expression.motion)
   :expression.motion
 const directedPerformance=character.lifeAction?.source==='life'||waiting&&action?.state==='walking_to_event'?undefined:action?.performance
 const performanceMode:CharacterPerformanceMode=moving?'journey':waiting?'encounter':visualState==='event_pending'?'event_pending':'ambient'
 const rawJourneyDuration=(arrivesAt-startedAt)/1_000
 const journeyDurationSeconds=Number.isFinite(rawJourneyDuration)&&rawJourneyDuration>0?rawJourneyDuration:undefined
 const journeySpeed=route?.length&&journeyDurationSeconds?route.length/journeyDurationSeconds:1.18
 const playbackRate=moving?THREE.MathUtils.clamp(journeySpeed/1.18,.52,1.65):1
 const stateLabel=language==='zh'?({idle:'空闲',living:'正在生活',event_pending:'有待办',walking_to_event:'前往事件',waiting_at_event:'等待查看'} as const)[visualState]:({idle:'Idle',living:'Living their day',event_pending:'Pending',walking_to_event:'On the way',waiting_at_event:'Waiting'} as const)[visualState]
 const livingDetail=language==='zh'?character.visibleIntentZh?.trim()||character.visibleIntent?.trim():character.visibleIntent?.trim()||character.visibleIntentZh?.trim()
 const troubleCopy=language==='zh'?character.troubleSignal?.summary_zh?.trim()||'似乎遇到了一点麻烦':character.troubleSignal?.summary?.trim()||'Something seems to be troubling them'
 return <group ref={actor} position={position} rotation-y={waitingRotation??lot?.rotation??0} onClick={event=>{event.stopPropagation();onClick()}} onPointerDown={event=>event.stopPropagation()} onPointerOver={event=>{event.stopPropagation();setHovered(true)}} onPointerOut={()=>setHovered(false)}>
  <DirectedCharacter3D avatar={avatar} animation={animation} performance={directedPerformance} performanceMode={performanceMode} performanceKey={`${action?.event_id??'daily'}:${visualState}:${expression.key}:${animation}`} performanceVariant={action?.participant_index??characterHash%2} playbackRate={playbackRate} reducedMotion={reducedMotion} name={character.name} seed={character.id} scale={characterScale}/>
  <mesh position-y={.5}>
   <cylinderGeometry args={[.48,.48,1,12]}/><meshBasicMaterial transparent opacity={0} depthWrite={false}/>
  </mesh>
  {active&&<mesh position-y={.01} rotation-x={-Math.PI/2}>
   <circleGeometry args={[.47,36]}/><meshBasicMaterial color="#ff9a68" transparent opacity={.18} depthWrite={false} side={THREE.DoubleSide}/>
  </mesh>}
  <mesh position-y={.012} rotation-x={-Math.PI/2} scale={active?1.25:1}>
   <ringGeometry args={active?[.264,.376,36]:[.25,.34,32]}/><meshBasicMaterial color={active?'#ff8d5b':color} transparent opacity={active ? .94 : .62} depthWrite={false} side={THREE.DoubleSide}/>
  </mesh>
  {active&&<Html center position={[0,1.72,0]} zIndexRange={[40,10]}><CharacterEmote key={expression.key} expression={expression} language={language} size={28} className="world3d-character-follow-emote"/></Html>}
  {!active&&<Html center position={[0,1.72,0]} zIndexRange={[40,10]}>
   <div className="world3d-character-ui" style={{'--character-color':color,'--character-ui-shift':action?.event_id?`${action.participant_index ? 12 : -12}px`:'0px'} as React.CSSProperties}>
    <button type="button" className={`world3d-character-status has-expression is-${visualState} ${character.troubleSignal?'has-trouble':''}`} onPointerDown={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();if(character.troubleSignal&&onTrouble)onTrouble();else if(action?.event_id&&visualState!=='event_pending')onEvent(action.event_id);else onClick()}} aria-label={character.troubleSignal?troubleCopy:`${stateLabel} · ${expression.label[language]}`}><CharacterEmote key={expression.key} expression={expression} language={language} size={28} decorative/></button>
    <button type="button" className={`world3d-character world3d-character--model ${active?'is-active':''}`} onPointerDown={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();onClick()}} aria-label={`${language==='zh'?'跟随':'Follow '}${character.name}`}>
     <b>{character.name}</b>
     {(hovered||active||moving||waiting||visualState==='living')&&<small>{moving||waiting?stateLabel:visualState==='living'?livingDetail||stateLabel:character.location.place||(language==='zh'?'正在城市中':'Around town')}</small>}
    </button>
   </div>
  </Html>}
 </group>
}

export function WorldScene({characters,landmarks,followedCharacterId,serverTime,language,timeSlot,reducedMotion,selectedLandmarkId,focus,focusVersion,viewMode,quality,decorationEditor,onDecorationValidationApi,onCharacterClick,onCharacterEvent,onCharacterTrouble,onJourneyElapsed,onLandmarkSelect}:SceneProps){
 const night=timeSlot==='evening'
 const [hoveredLandmarkId,setHoveredLandmarkId]=useState<string>()
 const actors=useRef(new Map<string,THREE.Group>())
 const layout=useMemo(()=>resolveCityLayout(landmarks,characters),[characters,landmarks])
 const characterLot=(character:CityCharacter)=>character.locationId?layout.landmarkLots.get(character.locationId):layout.homeLots.get(character.id)
 const characterNavigation=useMemo(()=>characters.slice(0,24).map(character=>{
  const origin=character.locationId?layout.landmarkLots.get(character.locationId):layout.homeLots.get(character.id)
  const target=character.worldAction?.target_location_id?layout.landmarkLots.get(character.worldAction.target_location_id):undefined
  const participantIndex=character.worldAction?.participant_index??0
  const route=character.worldAction?.state==='walking_to_event'&&origin&&target?buildPedestrianRoute(origin,target,{seed:`${character.worldAction.event_id}:${character.id}`,startLateralOffset:participantIndex ? .28 : -.28,endLateralOffset:participantIndex ? .7 : -.7}):undefined
  return {character,origin,route}
 }),[characters,layout.homeLots,layout.landmarkLots])
 const decorationValidationApi=useMemo(()=>createWorldDecorationValidationApi({
  buildings:layout.occupiedPositions,
  characterRoutes:characterNavigation.flatMap(item=>item.route?[item.route]:[]),
  characterPositions:characterNavigation.map(item=>{const [x,,z]=characterStandingPosition(item.character,item.origin);return [x,z] as [number,number]}),
 }),[characterNavigation,layout.occupiedPositions])
 useEffect(()=>{
  onDecorationValidationApi?.(decorationValidationApi)
  return()=>onDecorationValidationApi?.(null)
 },[decorationValidationApi,onDecorationValidationApi])
 const followedCharacter=characters.find(character=>character.id===followedCharacterId)
 const followedLot=followedCharacter?characterLot(followedCharacter):undefined
 const followedLotRotation=followedLot?.rotation
 const followCameraOffset=useMemo<WorldPoint>(()=>{
  if(followedLotRotation===undefined)return [2.2,1.7,2.4]
  const rotation=followedLotRotation
  const forward:[number,number]=[Math.sin(rotation),Math.cos(rotation)]
  const side:[number,number]=[Math.cos(rotation),-Math.sin(rotation)]
  // Stay on the resident's road side of the parcel. A fixed city-wide angle can
  // put an entire building between the camera and a resident on another facade.
  return [forward[0]*1.8+side[0]*.6,1.7,forward[1]*1.8+side[1]*.6]
 },[followedLotRotation])
 const resolvedFocus=useMemo(()=>{
  if(!focus)return null
  const selectedLot=selectedLandmarkId?layout.landmarkLots.get(selectedLandmarkId):undefined
  if(selectedLot)return [selectedLot.position[0],.5,selectedLot.position[1]] as WorldPoint
  const candidates=[
   ...landmarks.map(landmark=>({raw:targetPosition(landmark),lot:layout.landmarkLots.get(landmark.id)})),
   ...characters.map(character=>({raw:targetPosition(character.location),lot:character.locationId?layout.landmarkLots.get(character.locationId):layout.homeLots.get(character.id)})),
  ].filter((item):item is {raw:[number,number];lot:BuildingLot}=>Boolean(item.lot))
  const rawFocus:[number,number]=[focus[0],focus[2]]
  const nearest=candidates.reduce<{raw:[number,number];lot:BuildingLot}|undefined>((best,item)=>!best||pointDistanceSquared(item.raw,rawFocus)<pointDistanceSquared(best.raw,rawFocus)?item:best,undefined)
  return nearest?[nearest.lot.position[0],.5,nearest.lot.position[1]] as WorldPoint:focus
 },[characters,focus,landmarks,layout.homeLots,layout.landmarkLots,selectedLandmarkId])
 const editing=decorationEditor?.active===true
 const selectedDecoration=decorationEditor?.decorations.find(item=>item.id===decorationEditor.selectedId)
 useCursor(!editing&&Boolean(hoveredLandmarkId))
 return <>
  <FloatingCityBase quality={quality}/>
  <SkyRoadDecks quality={quality}/>
  <DistrictGround language={language}/>
  <RoadNetwork/>
  <CourtyardFeatures quality={quality}/>
  <CityFabric buildings={layout.fillerBuildings} quality={quality}/>
  <ResidentialHomes homes={layout.homePlacements} quality={quality} language={language} onSelect={editing?()=>undefined:onCharacterClick}/>
  <StreetLife quality={quality} occupiedPositions={layout.occupiedPositions}/>
  <Trees quality={quality} occupiedPositions={layout.occupiedPositions}/>
  {decorationEditor&&<WorldDecorations3D
   decorations={decorationEditor.decorations}
   editing={editing}
   selectedId={decorationEditor.selectedId}
   quality={quality}
   onSelect={decorationEditor.onSelect}
  />}
  <LandmarkBuildings placements={layout.landmarkPlacements} selectedId={editing?undefined:selectedLandmarkId} hoveredId={editing?undefined:hoveredLandmarkId} language={language} night={night} quality={quality} onHover={editing?()=>undefined:setHoveredLandmarkId} onSelect={editing?()=>undefined:onLandmarkSelect}/>
  {characterNavigation.map(({character,origin,route})=><CharacterMarker key={character.id} character={character} lot={origin} route={route} active={!editing&&character.id===followedCharacterId} actors={actors} serverTime={serverTime} reducedMotion={reducedMotion} language={language} onClick={editing?()=>undefined:()=>onCharacterClick(character.id)} onEvent={editing?()=>undefined:onCharacterEvent} onTrouble={!editing&&onCharacterTrouble?()=>onCharacterTrouble(character.id):undefined} onJourneyElapsed={onJourneyElapsed}/>)}
  {decorationEditor&&editing&&<WorldDecorationPlacementSurface
   mode={decorationEditor.mode}
   selectedKind={decorationEditor.selectedKind}
   selectedDecoration={selectedDecoration}
   decorations={decorationEditor.decorations}
   validationApi={decorationValidationApi}
   onPlace={decorationEditor.onPlace}
  />}
  <CameraRig focus={resolvedFocus} focusVersion={focusVersion} followedCharacterId={followedCharacterId} followCameraOffset={followCameraOffset} followWalking={followedCharacter?.worldAction?.state==='walking_to_event'} actors={actors} reducedMotion={reducedMotion} viewMode={viewMode}/>
 </>
}

ALL_WORLD_MODELS.forEach(model=>useGLTF.preload(`${KAYKIT_ASSET_BASE}/${model}.gltf`))
