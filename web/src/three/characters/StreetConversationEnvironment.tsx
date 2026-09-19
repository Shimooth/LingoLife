import {useGLTF} from '@react-three/drei'
import {useMemo} from 'react'
import {Box3,Vector3} from 'three'

const base='/assets/world/kaykit-city/gltf'

function StreetModel({model,position,height,rotation=0}:{model:string;position:[number,number,number];height:number;rotation?:number}){
 const {scene}=useGLTF(`${base}/${model}.gltf`)
 const {copy,scale,offset}=useMemo(()=>{
  const copy=scene.clone(true),box=new Box3().setFromObject(copy),size=box.getSize(new Vector3()),center=box.getCenter(new Vector3())
  return {copy,scale:height/size.y,offset:[-center.x,-box.min.y,-center.z] as [number,number,number]}
 },[scene,height])
 return <group position={position} rotation={[0,rotation,0]} scale={scale}><primitive object={copy} position={offset} dispose={null}/></group>
}

/** Match the map's KayKit streetfronts; keep the conversational foreground on the sidewalk. */
export function StreetConversationEnvironment(){
 return <group name="Street conversation environment">
  <mesh position={[0,-.25,-4]}><boxGeometry args={[60,.1,30]}/><meshStandardMaterial color="#7a8389" roughness={.9}/></mesh>
  <mesh position={[0,-.11,1]}><boxGeometry args={[60,.2,5]}/><meshStandardMaterial color="#c6c1b5" roughness={.85}/></mesh>
  <mesh position={[0,-.08,-1.55]}><boxGeometry args={[60,.26,.16]}/><meshStandardMaterial color="#ece2d1"/></mesh>
  <mesh position={[0,-.1,-8.3]}><boxGeometry args={[60,.22,2.4]}/><meshStandardMaterial color="#c6c1b5"/></mesh>
  {Array.from({length:17},(_,i)=><mesh key={i} position={[(i-8)*3,-.19,-4.2]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[1.5,.09]}/><meshStandardMaterial color="#fff2d8"/></mesh>)}
  <mesh position={[0,-.19,-2]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[60,.07]}/><meshStandardMaterial color="#efc875"/></mesh>
  {(['building_A','building_D','building_B','building_E','building_A'] as const).map((model,index)=><StreetModel key={index} model={model} height={6+(index%2)} position={[(index-2)*6.4,.02,-10.5]}/>)}
  <StreetModel model="streetlight" height={4.8} position={[-4.4,0,-1.1]}/>
  <StreetModel model="streetlight" height={4.8} position={[5.8,0,-7.4]} rotation={Math.PI}/>
  <StreetModel model="bench" height={.85} position={[-3.2,0,-.4]} rotation={Math.PI}/>
 </group>
}
