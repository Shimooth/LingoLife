import {useGLTF} from '@react-three/drei'
import {useThree} from '@react-three/fiber'
import {Component,Suspense,useMemo,type ReactNode} from 'react'
import * as THREE from 'three'
import type {InteriorTheme} from './interiorThemes'

const BASE='/assets/life/interiors'

type Placement={
 id:string
 asset:string
 position:[number,number,number]
 rotation?:number
 scale?:number|[number,number,number]
}

const FURNITURE=`${BASE}/furniture`
const KITCHEN=`${BASE}/kitchen`
const BATHROOM=`${BASE}/bathroom`
const RESTAURANT=`${BASE}/restaurant`
const PLANTS=`${BASE}/plants`
const PARK=`${BASE}/park`

const SCENE_ASSETS:Record<InteriorTheme,readonly Placement[]>={
 home_lounge:[
  {id:'sofa',asset:`${FURNITURE}/couch_pillows.gltf`,position:[0,0,-2.2],scale:.55},
  {id:'shelf',asset:`${FURNITURE}/shelf_B_large_decorated.gltf`,position:[-3.45,0,-2.42],rotation:.08,scale:.48},
  {id:'lamp',asset:`${FURNITURE}/lamp_standing.gltf`,position:[2.55,0,-2.18],scale:.58},
  {id:'table',asset:`${FURNITURE}/table_low.gltf`,position:[0,0,-.92],scale:.4},
  {id:'rug',asset:`${FURNITURE}/rug_rectangle_A.gltf`,position:[0,.015,-.75],scale:[1.08,.9,.8]},
  {id:'plant',asset:`${PLANTS}/monstera_plant_medium_potted.gltf`,position:[3.45,0,-1.85],rotation:-.2,scale:.42},
 ],
 home_kitchen:[
  {id:'tile-floor',asset:`${KITCHEN}/floor_tiles_kitchen.gltf`,position:[0,.01,-.35],scale:[5,.18,3.35]},
  {id:'sink',asset:`${KITCHEN}/countertop_sink.gltf`,position:[-2.8,0,-2.45],scale:.5},
  {id:'fridge',asset:`${KITCHEN}/fridge.gltf`,position:[-4.05,0,-2.32],scale:.5},
  {id:'stove',asset:`${KITCHEN}/stove.gltf`,position:[-1.55,0,-2.44],scale:.5},
  {id:'table',asset:`${KITCHEN}/table_A.gltf`,position:[2.45,0,-1.8],scale:.48},
  {id:'chair-a',asset:`${KITCHEN}/chair.gltf`,position:[1.45,0,-1.85],rotation:-Math.PI/2,scale:.48},
  {id:'chair-b',asset:`${KITCHEN}/chair.gltf`,position:[3.46,0,-1.85],rotation:Math.PI/2,scale:.48},
  {id:'kettle',asset:`${KITCHEN}/kettle.gltf`,position:[-2.16,.52,-2.25],scale:.35},
  {id:'plant',asset:`${PLANTS}/monstera_plant_medium_potted.gltf`,position:[4.15,0,-2.3],scale:.31},
 ],
 home_bathroom:[
  {id:'tile-floor',asset:`${BATHROOM}/floor_tiled.gltf`,position:[0,.01,-.35],scale:[5,.18,3.35]},
  {id:'shower',asset:`${BATHROOM}/shower.gltf`,position:[-3.15,0,-2.35],scale:.5},
  {id:'bath',asset:`${BATHROOM}/bath.gltf`,position:[2.25,0,-2.08],rotation:-.1,scale:.54},
  {id:'cabinet',asset:`${BATHROOM}/cabinet_bathroom.gltf`,position:[-1.28,0,-2.47],scale:.5},
  {id:'mirror',asset:`${BATHROOM}/mirror.gltf`,position:[-1.28,1.3,-2.56],scale:.5},
  {id:'toilet',asset:`${BATHROOM}/toilet.gltf`,position:[3.7,0,-2.35],rotation:-.2,scale:.5},
 ],
 home_bedroom:[
  {id:'bed',asset:`${FURNITURE}/bed_single_A.gltf`,position:[-2.05,0,-1.92],rotation:.05,scale:.58},
  {id:'shelf',asset:`${FURNITURE}/shelf_B_large_decorated.gltf`,position:[3.32,0,-2.4],rotation:-.05,scale:.43},
  {id:'chair',asset:`${FURNITURE}/armchair_pillows.gltf`,position:[1.65,0,-1.93],rotation:-.28,scale:.52},
  {id:'lamp',asset:`${FURNITURE}/lamp_standing.gltf`,position:[2.48,0,-2.32],scale:.54},
  {id:'rug',asset:`${FURNITURE}/rug_rectangle_A.gltf`,position:[0,.015,-.7],scale:[1.1,.9,.78]},
 ],
 cafe:[
  {id:'counter',asset:`${KITCHEN}/countertop_sink.gltf`,position:[-3.35,0,-2.48],scale:.48},
  {id:'display',asset:`${RESTAURANT}/dishrack_plates.gltf`,position:[-3.3,.62,-2.34],scale:.48},
  {id:'table-left',asset:`${KITCHEN}/table_A.gltf`,position:[-1.9,0,-1.64],scale:.43},
  {id:'table-right',asset:`${KITCHEN}/table_A.gltf`,position:[2.75,0,-1.7],scale:.43},
  {id:'chair-left',asset:`${KITCHEN}/chair.gltf`,position:[-3.0,0,-1.6],rotation:-Math.PI/2,scale:.43},
  {id:'chair-right',asset:`${KITCHEN}/chair.gltf`,position:[3.85,0,-1.7],rotation:Math.PI/2,scale:.43},
  {id:'meal',asset:`${RESTAURANT}/food_dinner.gltf`,position:[2.75,.46,-1.7],scale:.36},
  {id:'plate',asset:`${RESTAURANT}/plate.gltf`,position:[-1.9,.455,-1.64],scale:.36},
  {id:'burger',asset:`${RESTAURANT}/food_burger.gltf`,position:[-1.9,.46,-1.64],scale:.36},
  {id:'plant',asset:`${PLANTS}/monstera_plant_medium_potted.gltf`,position:[4.45,0,-2.22],scale:.34},
 ],
 library:[
  {id:'shelf-left',asset:`${FURNITURE}/shelf_B_large_decorated.gltf`,position:[-3.75,0,-2.42],rotation:.02,scale:.48},
  {id:'shelf-right',asset:`${FURNITURE}/shelf_B_large_decorated.gltf`,position:[3.7,0,-2.42],rotation:-.03,scale:.48},
  {id:'reading-chair-left',asset:`${FURNITURE}/armchair_pillows.gltf`,position:[-1.65,0,-1.72],rotation:.3,scale:.48},
  {id:'reading-chair-right',asset:`${FURNITURE}/armchair_pillows.gltf`,position:[1.55,0,-1.72],rotation:-.3,scale:.48},
  {id:'reading-table',asset:`${FURNITURE}/table_low.gltf`,position:[0,0,-1.15],scale:.38},
  {id:'reading-lamp',asset:`${FURNITURE}/lamp_standing.gltf`,position:[2.65,0,-2.25],scale:.5},
  {id:'plant',asset:`${PLANTS}/monstera_plant_medium_potted.gltf`,position:[-2.8,0,-2.15],scale:.34},
 ],
 shop:[
  {id:'display-left',asset:`${FURNITURE}/shelf_B_large_decorated.gltf`,position:[-3.55,0,-2.42],scale:.48},
  {id:'display-right',asset:`${FURNITURE}/shelf_B_large_decorated.gltf`,position:[3.5,0,-2.42],rotation:-.04,scale:.48},
  {id:'counter',asset:`${KITCHEN}/countertop_sink.gltf`,position:[0,0,-2.42],scale:.47},
  {id:'display-table-left',asset:`${FURNITURE}/table_low.gltf`,position:[-1.75,0,-1.0],scale:.38},
  {id:'display-table-right',asset:`${FURNITURE}/table_low.gltf`,position:[1.75,0,-1.0],scale:.38},
  {id:'plant',asset:`${PLANTS}/monstera_plant_medium_potted.gltf`,position:[4.25,0,-2.1],scale:.31},
 ],
 workplace:[
  {id:'desk-left',asset:`${KITCHEN}/table_A.gltf`,position:[-2.25,0,-1.7],rotation:.05,scale:.45},
  {id:'chair-left',asset:`${KITCHEN}/chair.gltf`,position:[-2.25,0,-.75],rotation:Math.PI,scale:.44},
  {id:'desk-right',asset:`${KITCHEN}/table_A.gltf`,position:[2.15,0,-1.72],rotation:-.04,scale:.45},
  {id:'chair-right',asset:`${KITCHEN}/chair.gltf`,position:[2.15,0,-.77],rotation:Math.PI,scale:.44},
  {id:'records',asset:`${FURNITURE}/shelf_B_large_decorated.gltf`,position:[-4,0,-2.4],scale:.44},
  {id:'waiting-chair',asset:`${FURNITURE}/armchair_pillows.gltf`,position:[3.75,0,-1.75],rotation:-.3,scale:.45},
  {id:'lamp',asset:`${FURNITURE}/lamp_standing.gltf`,position:[3.0,0,-2.3],scale:.48},
 ],
 activity:[
  {id:'bench',asset:`${PARK}/bench.gltf`,position:[0,0,-2.18],scale:.52},
  {id:'equipment-left',asset:`${FURNITURE}/table_low.gltf`,position:[-2.65,0,-1.4],scale:.34},
  {id:'equipment-right',asset:`${FURNITURE}/table_low.gltf`,position:[2.65,0,-1.4],scale:.34},
  {id:'rug-left',asset:`${FURNITURE}/rug_rectangle_A.gltf`,position:[-2.3,.015,-.4],rotation:.04,scale:[.7,.7,.48]},
  {id:'rug-right',asset:`${FURNITURE}/rug_rectangle_A.gltf`,position:[2.3,.015,-.4],rotation:-.04,scale:[.7,.7,.48]},
  {id:'plant-left',asset:`${PLANTS}/monstera_plant_medium_potted.gltf`,position:[-4.05,0,-2.15],scale:.34},
  {id:'plant-right',asset:`${PLANTS}/monstera_plant_medium_potted.gltf`,position:[4.05,0,-2.15],scale:.34},
 ],
 public:[
  {id:'shelf-a',asset:`${FURNITURE}/shelf_B_large_decorated.gltf`,position:[-3.72,0,-2.4],scale:.46},
  {id:'shelf-b',asset:`${FURNITURE}/shelf_B_large_decorated.gltf`,position:[3.72,0,-2.4],rotation:-.04,scale:.46},
  {id:'chair-a',asset:`${FURNITURE}/armchair_pillows.gltf`,position:[-2.25,0,-1.78],rotation:.22,scale:.5},
  {id:'chair-b',asset:`${FURNITURE}/armchair_pillows.gltf`,position:[2.25,0,-1.78],rotation:-.22,scale:.5},
  {id:'table',asset:`${FURNITURE}/table_low.gltf`,position:[0,0,-1.25],scale:.4},
  {id:'lamp',asset:`${FURNITURE}/lamp_standing.gltf`,position:[3.0,0,-2.28],scale:.52},
  {id:'plant',asset:`${PLANTS}/monstera_plant_medium_potted.gltf`,position:[-3.02,0,-2.12],scale:.35},
 ],
 park:[
  {id:'tree-a',asset:`${PARK}/tree.gltf`,position:[-4.15,0,-2.55],rotation:.15,scale:.62},
  {id:'tree-b',asset:`${PARK}/tree.gltf`,position:[4.25,0,-2.72],rotation:-.32,scale:.58},
  {id:'bench',asset:`${PARK}/bench.gltf`,position:[0,0,-2.16],scale:.58},
  {id:'fountain',asset:`${PARK}/fountain.gltf`,position:[2.7,0,-2.48],scale:.4},
  {id:'bush-a',asset:`${PARK}/bush.gltf`,position:[-2.9,0,-2.25],scale:.46},
  {id:'bush-b',asset:`${PARK}/bush.gltf`,position:[3.82,0,-1.92],scale:.38},
 ],
}

const PALETTE:Record<InteriorTheme,{wall:string;floor:string;trim:string;sky:string}>={
 home_lounge:{wall:'#f4dfc8',floor:'#b98568',trim:'#fdf1df',sky:'#9ac8cc'},
 home_kitchen:{wall:'#e9eedb',floor:'#cba66f',trim:'#fff5dc',sky:'#91c8ce'},
 home_bathroom:{wall:'#d8ece8',floor:'#86b9b4',trim:'#f5ffff',sky:'#a8d9dc'},
 home_bedroom:{wall:'#efd9d2',floor:'#b9846e',trim:'#fff0e9',sky:'#aabfd9'},
 cafe:{wall:'#e7c8a9',floor:'#9d6d52',trim:'#ffe3bb',sky:'#d89e77'},
 library:{wall:'#d9dfd0',floor:'#9f7b5d',trim:'#fff1d3',sky:'#93bdc5'},
 shop:{wall:'#e9d9c5',floor:'#ad8164',trim:'#fff0d8',sky:'#e0a274'},
 workplace:{wall:'#d8e4e1',floor:'#879994',trim:'#f8f1df',sky:'#92b8c8'},
 activity:{wall:'#dce7d6',floor:'#76917a',trim:'#fff0d5',sky:'#9ac5d1'},
 public:{wall:'#dce6e3',floor:'#839b92',trim:'#f6f1df',sky:'#9dbfcf'},
 park:{wall:'#cce3c9',floor:'#7da26c',trim:'#f2e6c6',sky:'#9bcbd7'},
}

function InteriorAsset({placement}:{placement:Placement}){
 const {scene}=useGLTF(placement.asset)
 const anisotropy=useThree(state=>Math.min(8,state.gl.capabilities.getMaxAnisotropy()))
 const object=useMemo(()=>{
  const clone=scene.clone(true)
  clone.traverse(child=>{
   if(!(child instanceof THREE.Mesh))return
   child.castShadow=true
   child.receiveShadow=true
   const original=Array.isArray(child.material)?child.material:[child.material]
   const materials=original.map(source=>{
    const material=source.clone()
    if(material instanceof THREE.MeshStandardMaterial){
     material.roughness=Math.min(.72,material.roughness??.62)
     material.metalness=Math.min(.04,material.metalness??0)
     material.envMapIntensity=.72
     if(material.map){material.map.anisotropy=anisotropy;material.map.needsUpdate=true}
    }
    return material
   })
   child.material=Array.isArray(child.material)?materials:materials[0]
  })
  return clone
 },[anisotropy,scene])
 return <primitive object={object} position={placement.position} rotation={[0,placement.rotation??0,0]} scale={placement.scale??1}/>
}

function MissingInteriorAsset({placement}:{placement:Placement}){
 const scale=typeof placement.scale==='number'?placement.scale:.45
 return <group position={placement.position} rotation={[0,placement.rotation??0,0]} scale={scale}>
  <mesh position-y={.38} castShadow receiveShadow><boxGeometry args={[1.25,.76,.8]}/><meshStandardMaterial color="#d5aa7b" roughness={.9}/></mesh>
  <mesh position={[0,.84,0]} castShadow><boxGeometry args={[.86,.12,.62]}/><meshStandardMaterial color="#f4dfbd" roughness={.85}/></mesh>
 </group>
}

class InteriorAssetBoundary extends Component<{placement:Placement;children:ReactNode},{failed:boolean}>{
 state={failed:false}
 static getDerivedStateFromError(){return {failed:true}}
 render(){return this.state.failed?<MissingInteriorAsset placement={this.props.placement}/>:this.props.children}
}

function RoomShell({theme,preview}:{theme:InteriorTheme;preview:boolean}){
 const colors=PALETTE[theme]
 if(theme==='park')return <group>
  <mesh position={[0,-.09,-.42]} rotation-x={-Math.PI/2} receiveShadow><circleGeometry args={[5.7,48]}/><meshStandardMaterial color={colors.floor} roughness={.94}/></mesh>
  <mesh position={[0,-.15,-.45]} rotation-x={-Math.PI/2}><ringGeometry args={[4.2,5.6,48]}/><meshStandardMaterial color="#d5c397" roughness={.96}/></mesh>
  <mesh position={[0,1.65,-3.34]}><planeGeometry args={[11,4.1]}/><meshBasicMaterial color={colors.sky}/></mesh>
  <mesh position={[0,1.08,-3.28]}><planeGeometry args={[11,1.42]}/><meshBasicMaterial color="#e8f1dc"/></mesh>
 </group>
 return <group>
  <mesh position={[0,-.11,-.35]} rotation-x={-Math.PI/2} receiveShadow><planeGeometry args={[10.6,7.2]}/><meshStandardMaterial color={colors.floor} roughness={.88}/></mesh>
  <mesh position={[0,1.62,-3.18]} receiveShadow><boxGeometry args={[10.6,3.55,.12]}/><meshStandardMaterial color={colors.wall} roughness={.93}/></mesh>
  <mesh position={[-5.22,1.44,-.24]} rotation-y={Math.PI/2} receiveShadow><boxGeometry args={[5.95,3.2,.12]}/><meshStandardMaterial color={colors.trim} roughness={.94}/></mesh>
  <mesh position={[0,.13,-3.08]}><boxGeometry args={[10.2,.18,.1]}/><meshStandardMaterial color={colors.trim} roughness={.84}/></mesh>
  <group position={[1.7,2.03,-3.1]}>
   <mesh><boxGeometry args={[2.35,1.38,.09]}/><meshStandardMaterial color={colors.trim} roughness={.75}/></mesh>
   <mesh position-z={.055}><planeGeometry args={[2.07,1.1]}/><meshBasicMaterial color={colors.sky}/></mesh>
   <mesh position={[0,0,.115]}><boxGeometry args={[.08,1.12,.05]}/><meshStandardMaterial color={colors.trim}/></mesh>
   <mesh position={[0,0,.115]} rotation-z={Math.PI/2}><boxGeometry args={[.08,2.08,.05]}/><meshStandardMaterial color={colors.trim}/></mesh>
  </group>
  {preview&&<group position={[-1.4,2.28,-3.09]}>
   <mesh><boxGeometry args={[1.34,.9,.08]}/><meshStandardMaterial color={colors.trim} roughness={.8}/></mesh>
   <mesh position-z={.05}><planeGeometry args={[1.08,.64]}/><meshBasicMaterial color={theme==='home_bathroom'?'#82b1aa':'#d68667'}/></mesh>
  </group>}
 </group>
}

export function IndoorEnvironment3D({theme,mode='encounter'}:{theme:InteriorTheme;mode?:'encounter'|'preview'}){
 const preview=mode==='preview'
 return <group name={`LingoLife ${theme} environment`} position={[0,preview ? -.08 : 0,preview ? .05 : 0]} scale={preview ? .94 : 1}>
  <RoomShell theme={theme} preview={preview}/>
  {SCENE_ASSETS[theme].map(placement=><InteriorAssetBoundary key={placement.id} placement={placement}><Suspense fallback={<MissingInteriorAsset placement={placement}/>}><InteriorAsset placement={placement}/></Suspense></InteriorAssetBoundary>)}
 </group>
}
