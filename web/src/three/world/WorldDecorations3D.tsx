import {Instance,Instances,useCursor,useGLTF} from '@react-three/drei'
import type {ThreeEvent} from '@react-three/fiber'
import {useMemo,useState} from 'react'
import * as THREE from 'three'
import {KAYKIT_ASSET_BASE,type KayKitPropModel} from './worldData'
import {type WorldDecoration,type WorldDecorationKind} from './worldDecorations'

const MODEL_BY_KIND:Partial<Record<WorldDecorationKind,KayKitPropModel>>={
 bush:'bush',bench:'bench',streetlight:'streetlight',firehydrant:'firehydrant',crate:'box_A',
}
const MODEL_SCALE:Partial<Record<WorldDecorationKind,number>>={bush:.78,bench:.88,streetlight:.82,firehydrant:.88,crate:.76}

function SelectionRing({decoration}:{decoration:WorldDecoration}){
 return <group position={[decoration.position[0],.405,decoration.position[1]]}>
  <mesh rotation-x={-Math.PI/2}><ringGeometry args={[.58*decoration.scale,.7*decoration.scale,32]}/><meshBasicMaterial color="#ff8a57" transparent opacity={.92} depthWrite={false} side={THREE.DoubleSide}/></mesh>
  <pointLight position={[0,.65,0]} color="#ff9b70" intensity={1.8} distance={2.4}/>
 </group>
}

function ModelDecorations({model,items,editing,onSelect,quality}:{model:KayKitPropModel;items:readonly WorldDecoration[];editing:boolean;onSelect:(id:string)=>void;quality:'low'|'high'}){
 const {scene}=useGLTF(`${KAYKIT_ASSET_BASE}/${model}.gltf`)
 const [hovered,setHovered]=useState(false)
 useCursor(editing&&hovered)
 const mesh=useMemo(()=>{
  let found:THREE.Mesh|undefined
  scene.traverse(object=>{if(!found&&object instanceof THREE.Mesh)found=object})
  if(!found)throw new Error(`Decoration model has no mesh: ${model}`)
  const material=Array.isArray(found.material)?found.material[0]:found.material
  return {geometry:found.geometry,material}
 },[model,scene])
 if(!items.length)return null
 return <Instances geometry={mesh.geometry} material={mesh.material} limit={items.length} castShadow={quality==='high'} receiveShadow>
  {items.map(item=><Instance key={item.id} position={[item.position[0],.37,item.position[1]]} rotation={[0,item.rotation,0]} scale={(MODEL_SCALE[item.kind]??1)*item.scale} onClick={editing?(event=>{event.stopPropagation();onSelect(item.id)}):undefined} onPointerOver={editing?(event=>{event.stopPropagation();setHovered(true)}):undefined} onPointerOut={editing?(()=>setHovered(false)):undefined}/>)}
 </Instances>
}

function ProceduralDecoration({decoration,editing,onSelect,quality}:{decoration:WorldDecoration;editing:boolean;onSelect:(id:string)=>void;quality:'low'|'high'}){
 const [hovered,setHovered]=useState(false)
 useCursor(editing&&hovered)
 const events=editing?{
  onClick:(event:ThreeEvent<MouseEvent>)=>{event.stopPropagation();onSelect(decoration.id)},
  onPointerOver:(event:ThreeEvent<PointerEvent>)=>{event.stopPropagation();setHovered(true)},
  onPointerOut:()=>setHovered(false),
 }:{}
 const tree=decoration.kind==='tree_round'||decoration.kind==='tree_tall'
 return <group position={[decoration.position[0],.37,decoration.position[1]]} rotation-y={decoration.rotation} scale={decoration.scale} {...events}>
  {tree&&<>
   <mesh position-y={decoration.kind==='tree_tall'?.55:.42} castShadow={quality==='high'}><cylinderGeometry args={[.095,.15,decoration.kind==='tree_tall'?1.1:.84,7]}/><meshStandardMaterial color="#76543e" roughness={1}/></mesh>
   {decoration.kind==='tree_tall'?<>
    <mesh position-y={1.42} castShadow={quality==='high'}><coneGeometry args={[.55,1.2,8]}/><meshStandardMaterial color="#4f8c67" roughness={.95}/></mesh>
    <mesh position-y={1.92} castShadow={quality==='high'}><coneGeometry args={[.42,.92,8]}/><meshStandardMaterial color="#5b9b71" roughness={.95}/></mesh>
   </>:<mesh position-y={1.18} scale={[1,.92,1]} castShadow={quality==='high'}><icosahedronGeometry args={[.61,1]}/><meshStandardMaterial color="#59966a" roughness={.96}/></mesh>}
  </>}
  {decoration.kind==='flower_planter'&&<>
   <mesh position-y={.16} castShadow={quality==='high'} receiveShadow><cylinderGeometry args={[.58,.64,.3,12]}/><meshStandardMaterial color="#b88361" roughness={.9}/></mesh>
   <mesh position-y={.32}><cylinderGeometry args={[.5,.53,.08,12]}/><meshStandardMaterial color="#5b694b" roughness={1}/></mesh>
   {Array.from({length:7},(_,index)=>{const angle=index/7*Math.PI*2;return <group key={index} position={[Math.cos(angle)*.34,.44,Math.sin(angle)*.34]}><mesh><sphereGeometry args={[.09,8,6]}/><meshStandardMaterial color={index%3===0?'#f5c65c':index%2?'#ef8d7e':'#f3ebe0'} roughness={.9}/></mesh><mesh position-y={-.12}><cylinderGeometry args={[.018,.022,.22,5]}/><meshStandardMaterial color="#53805d"/></mesh></group>})}
  </>}
  <mesh position-y={.75}><cylinderGeometry args={[.7,.7,1.5,10]}/><meshBasicMaterial transparent opacity={0} depthWrite={false}/></mesh>
 </group>
}

export function WorldDecorations3D({decorations,editing,selectedId,quality,onSelect}:{decorations:readonly WorldDecoration[];editing:boolean;selectedId?:string;quality:'low'|'high';onSelect:(id:string)=>void}){
 const modeled=decorations.filter(item=>MODEL_BY_KIND[item.kind])
 const procedural=decorations.filter(item=>!MODEL_BY_KIND[item.kind])
 const models=Array.from(new Set(modeled.map(item=>MODEL_BY_KIND[item.kind]!)))
 const selected=selectedId?decorations.find(item=>item.id===selectedId):undefined
 return <group name="Custom city decorations">
  {models.map(model=><ModelDecorations key={model} model={model} items={modeled.filter(item=>MODEL_BY_KIND[item.kind]===model)} editing={editing} onSelect={onSelect} quality={quality}/>)}
  {procedural.map(item=><ProceduralDecoration key={item.id} decoration={item} editing={editing} onSelect={onSelect} quality={quality}/>) }
  {selected&&<SelectionRing decoration={selected}/>}
 </group>
}

Object.values(MODEL_BY_KIND).forEach(model=>model&&useGLTF.preload(`${KAYKIT_ASSET_BASE}/${model}.gltf`))
