import {useEffect,useMemo,useRef,type ReactNode} from 'react'
import {Html,RoundedBox} from '@react-three/drei'
import {useFrame,useThree} from '@react-three/fiber'
import {Group,Mesh,MeshBasicMaterial} from 'three'
import {ToyClothingShop,ToyFountain} from './NeighborhoodStage3D'
import {isTownCenterLayout} from '../three/world/townCenterLayout'
import {NeighborhoodImprovements3D,type NeighborhoodImprovements} from './NeighborhoodImprovements3D'
import {resolveNeighborhoodPlots} from './neighborhoodFacilityPlacement'
import type {StreetscapeConstraints,StreetscapeLayout} from '../three/world/streetscapeLayout'
import type {WorldPoint} from '../three/world/worldData'
import type {WorldLayoutDocument} from '../worldLayout'
import './neighborhoodIntegration.css'

export type NeighborhoodFacility='fountain'|'wardrobe'
export type NeighborhoodReveal={facility:NeighborhoodFacility;key:string}
export type NeighborhoodFacilityFocus={key:string;position:WorldPoint}
export type NeighborhoodFacilities={
 fountain:boolean
 clothingStore:boolean
 improvements?:NeighborhoodImprovements
 pendingProjects?:{fountain:boolean;clothingStore:boolean}
 onOpen:(tab:NeighborhoodFacility)=>void
 /** Explicit presentation request, supplied only for a newly unlocked facility. */
 reveal?:NeighborhoodReveal
 /** Focus an existing place after a surrounding improvement, without replaying opening news. */
 focus?:NeighborhoodReveal
 onRevealReady?:(facility:NeighborhoodFacility)=>void
 onRevealComplete?:(facility:NeighborhoodFacility)=>void
}
type Props={facilities:NeighborhoodFacilities;language:'zh'|'en';worldLayout?:WorldLayoutDocument;constraints:StreetscapeConstraints;streetscape:StreetscapeLayout;reducedMotion:boolean;revealEnabled:boolean;onRevealFocus:(focus:NeighborhoodFacilityFocus)=>void}

function FacilityLandmark({facility,position,rotation,children,label,action,facilities,reducedMotion,revealEnabled,onRevealFocus}:Omit<Props,'language'|'worldLayout'|'constraints'|'streetscape'>&{facility:NeighborhoodFacility;position:WorldPoint;rotation:number;children:ReactNode;label:string;action:string}){
 const model=useRef<Group>(null),ring=useRef<Mesh>(null),sparkles=useRef<Group>(null)
 const animation=useRef({key:'',elapsed:0,running:false}),played=useRef(new Set<string>())
 const latest=useRef({facilities,onRevealFocus,position})
 const invalidate=useThree(state=>state.invalidate)
 latest.current={facilities,onRevealFocus,position}
 const reveal=facilities.reveal?.facility===facility?facilities.reveal:undefined
 const focusKey=facilities.focus?.facility===facility?facilities.focus.key:undefined
 useEffect(()=>{
  if(focusKey)latest.current.onRevealFocus({key:focusKey,position:latest.current.position})
 },[focusKey])
 const revealKey=reveal?.key
 useEffect(()=>{
  if(!revealKey){
   animation.current.running=false
   model.current?.scale.setScalar(1)
   if(ring.current)ring.current.visible=false
   if(sparkles.current)sparkles.current.visible=false
   invalidate();return
  }
  if(played.current.has(revealKey))return
  if(!revealEnabled){model.current?.scale.setScalar(.001);return}
  played.current.add(revealKey)
  animation.current={key:revealKey,elapsed:0,running:!reducedMotion}
  model.current?.scale.setScalar(reducedMotion?1:.001)
  if(ring.current)ring.current.visible=!reducedMotion
  if(sparkles.current)sparkles.current.visible=!reducedMotion
  latest.current.onRevealFocus({key:revealKey,position:latest.current.position})
  latest.current.facilities.onRevealReady?.(facility)
  if(reducedMotion)latest.current.facilities.onRevealComplete?.(facility)
  invalidate()
 },[facility,invalidate,reducedMotion,revealEnabled,revealKey])
 useFrame((_,delta)=>{
  const current=animation.current
  if(!current.running||!revealEnabled||document.hidden)return
  current.elapsed+=Math.min(delta,.05)
  const progress=Math.min(1,current.elapsed/2.8),rise=Math.min(1,Math.max(0,(current.elapsed-.35)/1.55))
  // The whole reveal stays within the validated parcel, including the halo.
  model.current?.scale.setScalar(Math.max(.001,1-(1-rise)**3))
  if(ring.current){ring.current.scale.setScalar(.3+progress*.7);(ring.current.material as MeshBasicMaterial).opacity=Math.sin(progress*Math.PI)*.72}
  sparkles.current?.children.forEach((particle,index)=>{
   const angle=index*Math.PI/4,radius=.5+progress*.24
   particle.position.set(Math.cos(angle)*radius,.2+Math.sin(progress*Math.PI)*(.9+index%3*.16),Math.sin(angle)*radius)
   particle.scale.setScalar(Math.sin(progress*Math.PI)*.07)
  })
  if(progress===1){
   current.running=false
   model.current?.scale.setScalar(1)
   if(ring.current)ring.current.visible=false
   if(sparkles.current)sparkles.current.visible=false
   latest.current.facilities.onRevealComplete?.(facility)
  }
 })
 return <group name={`neighborhood-${facility}-landmark`} position={position} onClick={event=>{event.stopPropagation();facilities.onOpen(facility)}}>
  <group ref={model} rotation-y={rotation}>{children}</group>
  <mesh ref={ring} rotation-x={-Math.PI/2} position-y={.025} visible={false}><ringGeometry args={[.85,.96,40]}/><meshBasicMaterial color="#f3d397" transparent opacity={0} depthWrite={false}/></mesh>
  <group ref={sparkles} visible={false}>{Array.from({length:8},(_,index)=><mesh key={index} scale={0}><octahedronGeometry args={[1]}/><meshBasicMaterial color={index%2?'#f0cc88':'#a3d5c1'}/></mesh>)}</group>
  <Html center position={[0,facility==='fountain'?1.65:2.15,0]} zIndexRange={[8,0]}><button type="button" data-neighborhood-facility={facility} className={`neighborhood-map-label${reveal?' is-new':''}`} onClick={event=>{event.stopPropagation();facilities.onOpen(facility)}}><span aria-hidden>{facility==='fountain'?'✧':'♧'}</span><span><strong>{label}</strong><small>{action} ↗</small></span></button></Html>
 </group>
}

function ProjectPlot({facility,position,language,onOpen}:{facility:NeighborhoodFacility;position:WorldPoint;language:'zh'|'en';onOpen:(value:NeighborhoodFacility)=>void}){
 const fountain=facility==='fountain'
 return <group name={`neighborhood-project:${facility}`} position={position} onClick={event=>{event.stopPropagation();onOpen(facility)}}>
  <mesh position-y={.015} rotation-x={-Math.PI/2}><ringGeometry args={[.48,.51,32]}/><meshStandardMaterial color="#d6b37a" roughness={1}/></mesh>
  <mesh position-y={.27}><cylinderGeometry args={[.026,.035,.54,8]}/><meshStandardMaterial color="#9e896d"/></mesh>
  <RoundedBox args={[.46,.30,.045]} radius={.018} position-y={.51} rotation-y={.6} castShadow><meshStandardMaterial color="#f3e5c9" roughness={.8}/></RoundedBox>
  <Html center position={[0,.98,0]} zIndexRange={[8,0]}><button type="button" className="neighborhood-map-label neighborhood-project-label" data-neighborhood-project={facility} onClick={event=>{event.stopPropagation();onOpen(facility)}}><span aria-hidden>{fountain?'⛲':'♧'}</span><span><strong>{language==='zh'?(fountain?'广场提议':'小店提议'):(fountain?'Square proposal':'Shop proposal')}</strong><small>{language==='zh'?'看看居民的想法':'Hear the neighbors'} ↗</small></span></button></Html>
 </group>
}

/** Both parcels are reserved by deterministic geometry, before either unlock. */
export function NeighborhoodLandmarks3D({facilities,language,worldLayout,constraints,streetscape,reducedMotion,revealEnabled,onRevealFocus}:Props){
 const plots=useMemo(()=>resolveNeighborhoodPlots(constraints,streetscape,worldLayout),[constraints,streetscape,worldLayout])
 const entries=[{plot:plots[0],shown:facilities.fountain,facility:'fountain' as const,label:language==='zh'?'许愿喷泉':'Wishing fountain',action:language==='zh'?'点击许愿':'Make a wish',model:<ToyFountain reducedMotion={reducedMotion} paused={!revealEnabled}/>},
  {plot:plots[1],shown:facilities.clothingStore,facility:'wardrobe' as const,label:language==='zh'?'小小衣橱':'Little wardrobe',action:language==='zh'?'点击逛店':'Browse outfits',model:<ToyClothingShop/>}]
 return <group name="neighborhood-facilities">{entries.map(entry=>entry.plot&&<group key={entry.facility}>
  {entry.shown?<FacilityLandmark facility={entry.facility} position={[entry.plot.position[0],.369,entry.plot.position[1]]} rotation={entry.plot.rotation} label={entry.label} action={entry.action} facilities={facilities} reducedMotion={reducedMotion} revealEnabled={revealEnabled} onRevealFocus={onRevealFocus}>{entry.model}</FacilityLandmark>:facilities.pendingProjects?.[entry.facility==='fountain'?'fountain':'clothingStore']&&<ProjectPlot facility={entry.facility} position={[entry.plot.position[0],.369,entry.plot.position[1]]} language={language} onOpen={facilities.onOpen}/>}
  {entry.facility==='fountain'&&entry.shown&&!isTownCenterLayout(worldLayout)&&<group position={[entry.plot.position[0],.369,entry.plot.position[1]]}><NeighborhoodImprovements3D value={facilities.improvements} compact/></group>}
 </group>)}</group>
}
