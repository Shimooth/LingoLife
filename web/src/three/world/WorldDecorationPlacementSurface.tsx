import type {ThreeEvent} from '@react-three/fiber'
import {useCallback,useEffect,useMemo,useState} from 'react'
import * as THREE from 'three'
import type {WorldDecorationEditorMode} from './useWorldDecorationEditor'
import {
 decorationDefinition,
 snapWorldDecorationPosition,
 type PlacementValidation,
 type WorldDecoration,
 type WorldDecorationKind,
 type WorldDecorationValidationApi,
} from './worldDecorations'

type PlacementSurfaceProps={
 mode:WorldDecorationEditorMode
 selectedKind:WorldDecorationKind
 selectedDecoration?:WorldDecoration
 decorations:readonly WorldDecoration[]
 validationApi:WorldDecorationValidationApi
 onPlace:(position:[number,number])=>void
}

type Preview={position:[number,number];validation:PlacementValidation;scale:number}

export function WorldDecorationPlacementSurface({mode,selectedKind,selectedDecoration,decorations,validationApi,onPlace}:PlacementSurfaceProps){
 const [preview,setPreview]=useState<Preview>()
 const ground=useMemo(()=>new THREE.Plane(new THREE.Vector3(0,1,0),-.37),[])
 const intersection=useMemo(()=>new THREE.Vector3(),[])

 useEffect(()=>setPreview(undefined),[mode,selectedDecoration?.id,selectedKind])

 const candidateAt=useCallback((position:[number,number])=>{
  if(mode==='move'&&!selectedDecoration)return undefined
  const snapped=snapWorldDecorationPosition(position)
  const candidate:WorldDecoration=mode==='move'&&selectedDecoration
   ?{...selectedDecoration,position:snapped}
   :{id:'editor-preview',kind:selectedKind,position:snapped,rotation:0,scale:decorationDefinition(selectedKind).baseScale}
  const validation=validationApi.validate(candidate,decorations,mode==='move'?selectedDecoration?.id:undefined)
  return {position:snapped,validation,scale:candidate.scale} satisfies Preview
 },[decorations,mode,selectedDecoration,selectedKind,validationApi])

 const positionFromEvent=useCallback((event:ThreeEvent<PointerEvent|MouseEvent>)=>{
  if(!event.ray.intersectPlane(ground,intersection))return undefined
  return [intersection.x,intersection.z] as [number,number]
 },[ground,intersection])

 const updatePreview=(event:ThreeEvent<PointerEvent>)=>{
  event.stopPropagation()
  const position=positionFromEvent(event),next=position?candidateAt(position):undefined
  setPreview(current=>current?.position[0]===next?.position[0]&&current?.position[1]===next?.position[1]&&current?.validation.valid===next?.validation.valid?current:next)
 }
 const place=(event:ThreeEvent<MouseEvent>)=>{
  event.stopPropagation()
  const position=positionFromEvent(event),next=position?candidateAt(position):undefined
  if(next)onPlace(next.position)
 }

 if(mode==='select')return null
 const valid=preview?.validation.valid===true
 return <group name="Decoration placement surface">
  <mesh position-y={5} rotation-x={-Math.PI/2} onPointerMove={updatePreview} onPointerDown={event=>event.stopPropagation()} onPointerOut={()=>setPreview(undefined)} onClick={place} renderOrder={100}>
   <planeGeometry args={[90,70]}/><meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} side={THREE.DoubleSide}/>
  </mesh>
  {preview&&<group position={[preview.position[0],.415,preview.position[1]]}>
   <mesh rotation-x={-Math.PI/2}>
    <circleGeometry args={[.58*preview.scale,32]}/><meshBasicMaterial color={valid?'#55c887':'#db6657'} transparent opacity={.28} depthWrite={false} side={THREE.DoubleSide}/>
   </mesh>
   <mesh rotation-x={-Math.PI/2}>
    <ringGeometry args={[.58*preview.scale,.65*preview.scale,32]}/><meshBasicMaterial color={valid?'#8ce5ad':'#ff8a79'} transparent opacity={.98} depthWrite={false} side={THREE.DoubleSide}/>
   </mesh>
  </group>}
 </group>
}
