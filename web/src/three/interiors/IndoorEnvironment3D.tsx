import {useGLTF} from '@react-three/drei'
import {useThree} from '@react-three/fiber'
import {Component,Suspense,useMemo,type ReactNode} from 'react'
import * as THREE from 'three'
import type {InteriorTheme} from './interiorThemes'
import type {WorldLayoutInteriorPlacement} from '../../worldLayout'
import {
 SHARED_HOME_PRIVATE_SPACES,sharedHomeDefaultPlacements,
 type SharedHomePrivateSpace,type SharedHomeRoomKind,
} from './sharedHomeLayout'

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

const SHARED_HOME_THEME_KIND:Partial<Record<InteriorTheme,SharedHomeRoomKind>>={
 home_lounge:'living_room',home_kitchen:'kitchen',home_bathroom:'bathroom',home_bedroom:'bedroom',
}

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

const sharedHomeAssets=(kind:SharedHomeRoomKind):Placement[]=>sharedHomeDefaultPlacements(kind).map(item=>({
 id:item.id,
 asset:`${BASE}/${item.asset}`,
 position:[...item.position],
 rotation:item.rotation,
 scale:[...item.scale],
}))

function defaultSceneAssets(theme:InteriorTheme):readonly Placement[]{
 const sharedKind=SHARED_HOME_THEME_KIND[theme]
 return sharedKind?sharedHomeAssets(sharedKind):SCENE_ASSETS[theme]
}

const PALETTE:Record<InteriorTheme,{wall:string;floor:string;trim:string;sky:string;accent:string;deep:string}>={
 home_lounge:{wall:'#edcfb0',floor:'#a96e50',trim:'#fff1dd',sky:'#8fc8d2',accent:'#d9755f',deep:'#5a4a43'},
 home_kitchen:{wall:'#dfe9ce',floor:'#c2955e',trim:'#fff4d9',sky:'#83bfca',accent:'#7fa88a',deep:'#4f665c'},
 home_bathroom:{wall:'#cee8e3',floor:'#6ca9a5',trim:'#f5ffff',sky:'#91cbd0',accent:'#dfa37f',deep:'#48716e'},
 home_bedroom:{wall:'#ebcdc8',floor:'#aa7059',trim:'#fff0e8',sky:'#99b8d5',accent:'#c17c8d',deep:'#63506b'},
 cafe:{wall:'#e7c8a9',floor:'#9d6d52',trim:'#ffe3bb',sky:'#d89e77',accent:'#c86f50',deep:'#5f4137'},
 library:{wall:'#d9dfd0',floor:'#9f7b5d',trim:'#fff1d3',sky:'#93bdc5',accent:'#728d70',deep:'#4f5e52'},
 shop:{wall:'#e9d9c5',floor:'#ad8164',trim:'#fff0d8',sky:'#e0a274',accent:'#cc765d',deep:'#63504a'},
 workplace:{wall:'#d8e4e1',floor:'#879994',trim:'#f8f1df',sky:'#92b8c8',accent:'#668e89',deep:'#455f5d'},
 activity:{wall:'#dce7d6',floor:'#76917a',trim:'#fff0d5',sky:'#9ac5d1',accent:'#de9761',deep:'#4c6654'},
 public:{wall:'#dce6e3',floor:'#839b92',trim:'#f6f1df',sky:'#9dbfcf',accent:'#9a7865',deep:'#506762'},
 park:{wall:'#cce3c9',floor:'#7da26c',trim:'#f2e6c6',sky:'#9bcbd7',accent:'#dba165',deep:'#416849'},
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
 componentDidUpdate(previous:{placement:Placement}){
  if(this.state.failed&&previous.placement.asset!==this.props.placement.asset)this.setState({failed:false})
 }
 render(){return this.state.failed?<MissingInteriorAsset placement={this.props.placement}/>:this.props.children}
}

const BED_POD_COLORS=['#c98272','#6f9286','#827fa0','#c59b61','#aa7482','#6d929b','#958064','#78916e'] as const

function WindowAssembly({theme}:{theme:InteriorTheme}){
 const colors=PALETTE[theme]
 const bathroom=theme==='home_bathroom'
 const bedroom=theme==='home_bedroom'
 const centerX=bathroom?2.9:theme==='home_kitchen'?2.82:1.72
 const width=bathroom?1.72:2.58,height=bathroom?1.14:1.52
 return <group position={[centerX,2.02,-3.105]}>
  <mesh castShadow><boxGeometry args={[width+.26,height+.26,.1]}/><meshStandardMaterial color={colors.trim} roughness={.68}/></mesh>
  <mesh position-z={.058}><planeGeometry args={[width,height]}/><meshStandardMaterial color={colors.sky} emissive={colors.sky} emissiveIntensity={bathroom?.09:.16} roughness={bathroom?.48:.24}/></mesh>
  <mesh position={[0,0,.12]} castShadow><boxGeometry args={[.075,height+.02,.055]}/><meshStandardMaterial color={colors.trim} roughness={.7}/></mesh>
  <mesh position={[0,0,.12]} rotation-z={Math.PI/2} castShadow><boxGeometry args={[.075,width+.02,.055]}/><meshStandardMaterial color={colors.trim} roughness={.7}/></mesh>
  <mesh position={[0,-height/2-.12,.08]} castShadow><boxGeometry args={[width+.45,.12,.32]}/><meshStandardMaterial color={colors.trim} roughness={.78}/></mesh>
  {bathroom&&<mesh position={[0,0,.135]}><planeGeometry args={[width-.08,height-.08]}/><meshPhysicalMaterial color="#dff6f2" transparent opacity={.56} roughness={.72}/></mesh>}
  {(bedroom||theme==='home_lounge')&&<>
   <mesh position={[-width/2-.28,.02,.16]} castShadow><boxGeometry args={[.42,height+.46,.13]}/><meshStandardMaterial color={colors.accent} roughness={.88}/></mesh>
   <mesh position={[width/2+.28,.02,.16]} castShadow><boxGeometry args={[.42,height+.46,.13]}/><meshStandardMaterial color={colors.accent} roughness={.88}/></mesh>
  </>}
 </group>
}

function PersonalBedroomTrace({space}:{space:SharedHomePrivateSpace}){
 const [minX,maxX,minZ,maxZ]=space.bounds
 const x=(minX+maxX)/2+.63,z=space.door.wall==='south'?minZ+.28:maxZ-.28
 const rotation=space.door.wall==='south'?0:Math.PI
 const color=space.accent
 return <group name={`${space.trace} personal trace`} position={[x,.42,z]} rotation-y={rotation}>
  {space.trace==='sketchbook'&&<><mesh rotation-x={-.08}><boxGeometry args={[.46,.035,.34]}/><meshStandardMaterial color="#f7e8c9" roughness={.98}/></mesh><mesh position={[.04,.024,0]}><boxGeometry args={[.025,.012,.3]}/><meshStandardMaterial color={color}/></mesh></>}
  {space.trace==='books'&&[-.13,0,.13].map((offset,index)=><mesh key={offset} position={[offset,index*.025,0]} rotation-z={(index-1)*.07}><boxGeometry args={[.12,.28,.32]}/><meshStandardMaterial color={BED_POD_COLORS[(space.slot+index)%BED_POD_COLORS.length]} roughness={.9}/></mesh>)}
  {space.trace==='music'&&<><mesh><boxGeometry args={[.5,.34,.22]}/><meshStandardMaterial color={color} roughness={.72}/></mesh>{[-.13,.13].map(offset=><mesh key={offset} position={[offset,0,.13]}><circleGeometry args={[.085,16]}/><meshStandardMaterial color="#f6e9d3" roughness={.55}/></mesh>)}</>}
  {space.trace==='camera'&&<><mesh><boxGeometry args={[.42,.3,.22]}/><meshStandardMaterial color={color} roughness={.65}/></mesh><mesh position={[0,0,.17]} rotation-x={Math.PI/2}><cylinderGeometry args={[.1,.13,.13,16]}/><meshStandardMaterial color="#4d5158" metalness={.2} roughness={.38}/></mesh></>}
  {space.trace==='plants'&&<><mesh position-y={-.12}><cylinderGeometry args={[.13,.1,.25,12]}/><meshStandardMaterial color="#d4976f" roughness={.9}/></mesh>{[-.12,0,.12].map((offset,index)=><mesh key={offset} position={[offset*.55,.15+index*.035,0]} rotation-z={offset*2.2} scale={[1,.72,.62]}><sphereGeometry args={[.13,12,8]}/><meshStandardMaterial color={index===1?'#6f9c79':'#82ad83'} roughness={.84}/></mesh>)}</>}
  {space.trace==='crafts'&&<>{[-.16,0,.16].map((offset,index)=><mesh key={offset} position={[offset,index*.035,0]} rotation-y={index*.36}><boxGeometry args={[.15,.18,.28]}/><meshStandardMaterial color={BED_POD_COLORS[(space.slot+index+2)%BED_POD_COLORS.length]} roughness={.93}/></mesh>)}</>}
  {space.trace==='games'&&<>{[[-.16,0],[0,.03],[.16,0]].map(([offset,y],index)=><mesh key={offset} position={[offset,y,0]} rotation-y={index*.4}><boxGeometry args={[.14,.14,.25]}/><meshStandardMaterial color={BED_POD_COLORS[(space.slot+index+4)%BED_POD_COLORS.length]} roughness={.86}/></mesh>)}</>}
  {space.trace==='travel'&&<><mesh><boxGeometry args={[.44,.34,.2]}/><meshStandardMaterial color={color} roughness={.86}/></mesh><mesh position={[0,.23,0]}><torusGeometry args={[.11,.025,7,14,Math.PI]}/><meshStandardMaterial color="#5f5148" roughness={.68}/></mesh><mesh position={[.08,.02,.112]}><circleGeometry args={[.055,12]}/><meshStandardMaterial color="#f1d29d"/></mesh></>}
 </group>
}

function PrivateBedroomDoor({space}:{space:SharedHomePrivateSpace}){
 const [, ,minZ,maxZ]=space.bounds
 const facingSouth=space.door.wall==='south',wallZ=facingSouth?maxZ:minZ
 const hingeX=space.door.center_x-space.door.width/2
 const swing=facingSouth?-1.02:1.02
 return <group name={`${space.id} door`}>
  <mesh position={[hingeX,.7,wallZ]} castShadow><boxGeometry args={[.1,1.42,.13]}/><meshStandardMaterial color="#fff0e3" roughness={.82}/></mesh>
  <mesh position={[hingeX+space.door.width,.7,wallZ]} castShadow><boxGeometry args={[.1,1.42,.13]}/><meshStandardMaterial color="#fff0e3" roughness={.82}/></mesh>
  <mesh position={[space.door.center_x,1.38,wallZ]} castShadow><boxGeometry args={[space.door.width+.12,.12,.13]}/><meshStandardMaterial color="#fff0e3" roughness={.82}/></mesh>
  <group position={[hingeX,.65,wallZ]} rotation-y={swing}>
   <mesh position-x={space.door.width/2} castShadow receiveShadow><boxGeometry args={[space.door.width-.08,1.24,.07]}/><meshStandardMaterial color={space.accent} roughness={.83}/></mesh>
   <mesh position={[space.door.width*.74,.02,facingSouth?.045:-.045]}><sphereGeometry args={[.045,10,7]}/><meshStandardMaterial color="#b7834e" metalness={.34} roughness={.42}/></mesh>
  </group>
 </group>
}

function PrivateBedroomSuite({occupiedSlots}:{occupiedSlots:readonly number[]}){
 const occupied=new Set(occupiedSlots)
 return <group name="eight separated private bedrooms">
  <mesh position={[0,-.027,-.04]} rotation-x={-Math.PI/2} receiveShadow><planeGeometry args={[10.16,.94]}/><meshStandardMaterial color="#d8b28b" roughness={.94}/></mesh>
  {[-3.76,-1.26,1.24,3.74].map(x=><group key={x} position={[x,2.62,-.04]}>
   <mesh position-y={-.33} castShadow><cylinderGeometry args={[.18,.3,.34,16]}/><meshStandardMaterial color="#f0d6b5" roughness={.73}/></mesh>
   <mesh position-y={.08}><cylinderGeometry args={[.018,.018,.55,8]}/><meshStandardMaterial color="#785e55" roughness={.62}/></mesh>
   <pointLight position-y={-.48} color="#ffd4a3" intensity={.36} distance={2.6}/>
  </group>)}
  {SHARED_HOME_PRIVATE_SPACES.map(space=>{
   const [minX,maxX,minZ,maxZ]=space.bounds,width=maxX-minX,depth=maxZ-minZ
   const centerX=(minX+maxX)/2,centerZ=(minZ+maxZ)/2
   const facingSouth=space.door.wall==='south',wallZ=facingSouth?maxZ:minZ
   const outerZ=facingSouth?minZ:maxZ
   const doorLeft=space.door.center_x-space.door.width/2,doorRight=space.door.center_x+space.door.width/2
   const leftLength=Math.max(0,doorLeft-minX),rightLength=Math.max(0,maxX-doorRight)
   const partitionHeight=facingSouth?1.6:1.08,frontHeight=facingSouth?1.42:.5
   const isOccupied=occupied.has(space.slot)
   return <group key={space.id} name={space.id}>
    <mesh position={[centerX,-.026,centerZ]} rotation-x={-Math.PI/2} receiveShadow><planeGeometry args={[width-.12,depth-.12]}/><meshStandardMaterial color={space.accent} roughness={.96}/></mesh>
    <mesh position={[centerX,-.018,centerZ]} rotation-x={-Math.PI/2}><planeGeometry args={[width-.26,depth-.26]}/><meshStandardMaterial color="#f5dcc7" transparent opacity={isOccupied?.74:.48} roughness={.98}/></mesh>
    <mesh position={[maxX,partitionHeight/2,centerZ]} castShadow receiveShadow><boxGeometry args={[.1,partitionHeight,depth]}/><meshStandardMaterial color="#f6e4da" roughness={.9}/></mesh>
    {space.slot%4===1&&<mesh position={[minX,partitionHeight/2,centerZ]} castShadow receiveShadow><boxGeometry args={[.1,partitionHeight,depth]}/><meshStandardMaterial color="#f6e4da" roughness={.9}/></mesh>}
    {!facingSouth&&<mesh position={[centerX,frontHeight/2,outerZ]} castShadow receiveShadow><boxGeometry args={[width,frontHeight,.1]}/><meshStandardMaterial color="#ead2cb" roughness={.92}/></mesh>}
    {facingSouth&&<group position={[centerX,1.8,outerZ+.015]}>
     <mesh castShadow><boxGeometry args={[.88,.76,.07]}/><meshStandardMaterial color="#fff2e5" roughness={.78}/></mesh>
     <mesh position-z={.045}><planeGeometry args={[.7,.58]}/><meshStandardMaterial color="#9fc7ce" emissive="#8ebdc5" emissiveIntensity={.14} roughness={.3}/></mesh>
    </group>}
    {leftLength>.02&&<mesh position={[(minX+doorLeft)/2,frontHeight/2,wallZ]} castShadow receiveShadow><boxGeometry args={[leftLength,frontHeight,.1]}/><meshStandardMaterial color="#ead2cb" roughness={.92}/></mesh>}
    {rightLength>.02&&<mesh position={[(doorRight+maxX)/2,frontHeight/2,wallZ]} castShadow receiveShadow><boxGeometry args={[rightLength,frontHeight,.1]}/><meshStandardMaterial color="#ead2cb" roughness={.92}/></mesh>}
    <PrivateBedroomDoor space={space}/>
    <mesh position={[centerX,.03,centerZ+(facingSouth?.42:-.42)]} rotation-x={-Math.PI/2} receiveShadow><planeGeometry args={[1.2,.58]}/><meshStandardMaterial color={BED_POD_COLORS[(space.slot+2)%BED_POD_COLORS.length]} roughness={.98}/></mesh>
    <group position={[centerX,.72,outerZ+(facingSouth?.1:-.1)]} rotation-y={facingSouth?0:Math.PI}>
     <mesh castShadow><boxGeometry args={[.56,.64,.07]}/><meshStandardMaterial color="#fff0df" roughness={.84}/></mesh>
     <mesh position-z={.045}><circleGeometry args={[.17,18]}/><meshStandardMaterial color={space.accent} roughness={.82} emissive={space.accent} emissiveIntensity={isOccupied?.18:0}/></mesh>
     <mesh position={[0,-.23,.046]}><boxGeometry args={[.31,.045,.02]}/><meshStandardMaterial color="#7b655d" roughness={.75}/></mesh>
    </group>
    <PersonalBedroomTrace space={space}/>
    <mesh position={[space.door.center_x,.015,facingSouth?maxZ+.14:minZ-.14]} rotation-x={-Math.PI/2}><planeGeometry args={[.7,.3]}/><meshStandardMaterial color={isOccupied?space.accent:'#c8b5a4'} roughness={.98}/></mesh>
   </group>
  })}
 </group>
}

function SharedHomeRoomDetails({theme,occupiedPrivateSlots}:{theme:InteriorTheme;occupiedPrivateSlots:readonly number[]}){
 const colors=PALETTE[theme]
 if(theme==='home_lounge')return <group>
  <group name="builtin-television" position={[-5.02,.82,-.45]} rotation-y={Math.PI/2}>
   <mesh position={[0,-.53,.04]} castShadow receiveShadow><boxGeometry args={[1.72,.48,.48]}/><meshStandardMaterial color={colors.deep} roughness={.75}/></mesh>
   <mesh castShadow><boxGeometry args={[1.88,1.15,.16]}/><meshStandardMaterial color="#3b4648" roughness={.3}/></mesh>
   <mesh position-z={.091}><planeGeometry args={[1.62,.91]}/><meshStandardMaterial color="#79aeb1" emissive="#5a969d" emissiveIntensity={.34} roughness={.2}/></mesh>
   <mesh position={[0,-.72,.02]} castShadow><boxGeometry args={[2.15,.12,.68]}/><meshStandardMaterial color="#825d4c" roughness={.84}/></mesh>
  </group>
  <group position={[-1.42,2.12,-3.085]}>
   {[-1,0,1].map((offset,index)=><group key={offset} position-x={offset*.69} rotation-z={(index-1)*.035}>
    <mesh castShadow><boxGeometry args={[.56,.72,.09]}/><meshStandardMaterial color={colors.trim} roughness={.8}/></mesh>
    <mesh position-z={.052}><planeGeometry args={[.4,.56]}/><meshStandardMaterial color={BED_POD_COLORS[index+1]} roughness={.87}/></mesh>
   </group>)}
  </group>
 </group>
 if(theme==='home_kitchen')return <group>
  <mesh position={[-2.08,.38,-2.99]} castShadow receiveShadow><boxGeometry args={[4.95,.76,.42]}/><meshStandardMaterial color="#658275" roughness={.86}/></mesh>
  <mesh position={[-2.08,.8,-2.78]} castShadow receiveShadow><boxGeometry args={[5.02,.12,.82]}/><meshStandardMaterial color="#f0d8ae" roughness={.67}/></mesh>
  <mesh position={[-1.95,1.03,-3.075]} receiveShadow><boxGeometry args={[4.7,1.25,.12]}/><meshStandardMaterial color="#d6b783" roughness={.73}/></mesh>
  {[-3.78,-3.08,-2.38,-1.68,-.98,-.28].map((x,index)=><mesh key={x} position={[x,.99,-2.998]} rotation-z={index%2?Math.PI/4:-Math.PI/4}><boxGeometry args={[.018,1.16,.03]}/><meshBasicMaterial color="#f8e6c4"/></mesh>)}
  {[-3.12,-1.5,.12].map((x,index)=><group key={x} position={[x,.4,-2.755]}>
   <mesh castShadow><boxGeometry args={[.62,.64,.07]}/><meshStandardMaterial color={index===1?'#78978b':'#87a69a'} roughness={.9}/></mesh>
   <mesh position={[.2,.03,.045]}><boxGeometry args={[.14,.035,.025]}/><meshStandardMaterial color="#5e665e" metalness={.18} roughness={.48}/></mesh>
  </group>)}
  {[-2.2,-1.18].map((x,index)=><group key={x} position={[x,2.15,-3.02]}>
   <mesh castShadow><boxGeometry args={[.86,.72,.34]}/><meshStandardMaterial color={index?'#829f8f':'#739484'} roughness={.88}/></mesh>
   <mesh position={[0,-.12,.185]}><boxGeometry args={[.24,.04,.025]}/><meshStandardMaterial color="#f1d8aa" metalness={.08} roughness={.55}/></mesh>
  </group>)}
  <mesh position={[-1.7,1.69,-2.79]}><boxGeometry args={[2.22,.055,.11]}/><meshStandardMaterial color="#f9d797" emissive="#f2b96b" emissiveIntensity={.4}/></mesh>
  <mesh position={[-1.78,.35,-.2]} castShadow receiveShadow><boxGeometry args={[1.38,.68,.76]}/><meshStandardMaterial color={colors.deep} roughness={.82}/></mesh>
  <mesh position={[-1.78,.72,-.2]} castShadow receiveShadow><boxGeometry args={[1.58,.1,.94]}/><meshStandardMaterial color="#ead0a4" roughness={.68}/></mesh>
  <mesh position={[-1.5,-.025,1.35]} rotation-x={-Math.PI/2} receiveShadow><planeGeometry args={[2.45,.72]}/><meshStandardMaterial color="#b26e55" roughness={.92}/></mesh>
  <mesh position={[2.35,-.026,-.48]} rotation-x={-Math.PI/2} receiveShadow><planeGeometry args={[3.45,2.48]}/><meshStandardMaterial color="#cc8668" roughness={.95}/></mesh>
  {[[-.36,-.23],[.36,-.23],[-.36,.23],[.36,.23]].map(([x,z],index)=><group key={`${x}:${z}`} position={[2.35+x,.68,-.5+z]}>
   <mesh><boxGeometry args={[.42,.025,.28]}/><meshStandardMaterial color={index%2?'#e0b379':'#76998d'} roughness={.84}/></mesh>
   <mesh position={[.12,.1,0]}><cylinderGeometry args={[.065,.08,.16,12]}/><meshStandardMaterial color="#f4e4c6" roughness={.72}/></mesh>
  </group>)}
  <group position={[2.35,.78,-.5]}><mesh><sphereGeometry args={[.18,12,8]}/><meshStandardMaterial color="#d67858" roughness={.8}/></mesh><mesh position={[-.16,.03,.02]}><sphereGeometry args={[.13,12,8]}/><meshStandardMaterial color="#e6b553" roughness={.8}/></mesh></group>
  {[-1.75,2.35].map((x,index)=><group key={x} position={[x,3.05,index?-.48:-.18]}>
   <mesh position-y={-.35}><cylinderGeometry args={[.3,.5,.42,18]}/><meshStandardMaterial color={index?colors.accent:colors.deep} roughness={.62}/></mesh>
   <mesh position-y={.18}><cylinderGeometry args={[.025,.025,.7,8]}/><meshStandardMaterial color={colors.deep}/></mesh>
   <pointLight position-y={-.55} color="#ffd8a6" intensity={.85} distance={3.2}/>
  </group>)}
 </group>
 if(theme==='home_bathroom')return <group>
  <mesh position={[0,1.0,-3.065]} receiveShadow><boxGeometry args={[10.1,1.46,.08]}/><meshStandardMaterial color="#9dcac3" roughness={.82}/></mesh>
  {[-3.8,-2.6,-1.4,-.2,1,2.2,3.4].map(x=><mesh key={x} position={[x,1,-3.015]}><boxGeometry args={[.026,1.38,.02]}/><meshBasicMaterial color="#e8f5ed"/></mesh>)}
  <mesh position={[-3.18,1.16,-1.92]} rotation-y={Math.PI/2} castShadow><boxGeometry args={[1.55,2.28,.075]}/><meshPhysicalMaterial color="#b7dcda" transparent opacity={.48} roughness={.36}/></mesh>
  <mesh position={[1.08,.48,-1.72]} rotation-y={Math.PI/2} castShadow><boxGeometry args={[2.28,.92,.1]}/><meshStandardMaterial color={colors.trim} roughness={.9}/></mesh>
  <mesh position={[1.08,1.34,-1.72]} rotation-y={Math.PI/2} castShadow><boxGeometry args={[2.28,.74,.055]}/><meshPhysicalMaterial color="#cce9e4" transparent opacity={.42} roughness={.32}/></mesh>
  <mesh position={[-3.75,-.025,-1.46]} rotation-x={-Math.PI/2} receiveShadow><planeGeometry args={[1.82,2.55]}/><meshStandardMaterial color="#77b9b2" roughness={.9}/></mesh>
  <mesh position={[2.22,-.025,-1.58]} rotation-x={-Math.PI/2} receiveShadow><planeGeometry args={[2.42,2.82]}/><meshStandardMaterial color="#81bdb6" roughness={.9}/></mesh>
  <mesh position={[-2.42,-.02,-1.42]} rotation-x={-Math.PI/2} receiveShadow><planeGeometry args={[1.65,.8]}/><meshStandardMaterial color="#f6dfbd" roughness={.96}/></mesh>
  <mesh position={[.22,-.02,1.46]} rotation-x={-Math.PI/2} receiveShadow><planeGeometry args={[2.48,.72]}/><meshStandardMaterial color="#efd2ae" roughness={.98}/></mesh>
  <group position={[-2.42,.93,-2.46]}>
   {[-.32,.28].map((x,index)=><group key={x} position-x={x}><mesh><cylinderGeometry args={[.07,.08,.24,12]}/><meshStandardMaterial color={index?'#d58b72':'#6e9a94'} roughness={.7}/></mesh><mesh position-y={.145}><cylinderGeometry args={[.025,.025,.08,8]}/><meshStandardMaterial color="#f7e3c1"/></mesh></group>)}
  </group>
  <group position={[4.08,.39,-1.42]}>
   <mesh castShadow><cylinderGeometry args={[.3,.25,.72,16]}/><meshStandardMaterial color="#d7aa74" roughness={.92}/></mesh>
   <mesh position-y={.39}><torusGeometry args={[.2,.026,8,18]}/><meshStandardMaterial color={colors.deep} roughness={.6}/></mesh>
  </group>
  <group position={[.28,1.55,-2.97]}>
   <mesh><boxGeometry args={[1.35,.08,.08]}/><meshStandardMaterial color={colors.deep} metalness={.12} roughness={.48}/></mesh>
   <mesh position={[-.34,-.34,.035]}><boxGeometry args={[.48,.65,.07]}/><meshStandardMaterial color="#dfa47f" roughness={.95}/></mesh>
   <mesh position={[.28,-.27,.04]}><boxGeometry args={[.48,.52,.07]}/><meshStandardMaterial color="#f1d5b4" roughness={.95}/></mesh>
  </group>
  <group position={[4,.62,.48]} rotation-y={Math.PI}>
   {[0,.16,.32].map((y,index)=><mesh key={y} position={[0,y,-.25]}><boxGeometry args={[.58,.12,.34]}/><meshStandardMaterial color={index===1?'#d5a083':'#f3d6ba'} roughness={.96}/></mesh>)}
  </group>
  <group position={[2.85,.24,1.48]}>
   <mesh castShadow receiveShadow><boxGeometry args={[1.72,.42,.5]}/><meshStandardMaterial color="#a8795e" roughness={.92}/></mesh>
   <mesh position-y={.27} castShadow><boxGeometry args={[1.82,.14,.56]}/><meshStandardMaterial color="#e9c6a0" roughness={.96}/></mesh>
   {[-.48,.05,.48].map((x,index)=><mesh key={x} position={[x,-.04,.27]}><boxGeometry args={[.38,.24,.04]}/><meshStandardMaterial color={index===1?'#769c91':'#6b887f'} roughness={.9}/></mesh>)}
   {[0,.13].map((y,index)=><mesh key={y} position={[-.55,.42+y,0]}><boxGeometry args={[.46,.1,.34]}/><meshStandardMaterial color={index?'#d9a889':'#f4dfc2'} roughness={.97}/></mesh>)}
  </group>
 </group>
 if(theme==='home_bedroom')return <PrivateBedroomSuite occupiedSlots={occupiedPrivateSlots}/>
 return null
}

function RoomShell({theme,preview,occupiedPrivateSlots}:{theme:InteriorTheme;preview:boolean;occupiedPrivateSlots:readonly number[]}){
 const colors=PALETTE[theme]
 if(theme==='park')return <group>
  <mesh position={[0,-.09,-.42]} rotation-x={-Math.PI/2} receiveShadow><circleGeometry args={[5.7,48]}/><meshStandardMaterial color={colors.floor} roughness={.94}/></mesh>
  <mesh position={[0,-.15,-.45]} rotation-x={-Math.PI/2}><ringGeometry args={[4.2,5.6,48]}/><meshStandardMaterial color="#d5c397" roughness={.96}/></mesh>
  <mesh position={[0,1.65,-3.34]}><planeGeometry args={[11,4.1]}/><meshBasicMaterial color={colors.sky}/></mesh>
  <mesh position={[0,1.08,-3.28]}><planeGeometry args={[11,1.42]}/><meshBasicMaterial color="#e8f1dc"/></mesh>
 </group>
 return <group>
  <mesh position={[0,-.16,-.35]} receiveShadow><boxGeometry args={[10.72,.2,7.32]}/><meshStandardMaterial color={colors.deep} roughness={.95}/></mesh>
  <mesh position={[0,-.045,-.35]} rotation-x={-Math.PI/2} receiveShadow><planeGeometry args={[10.55,7.15]}/><meshStandardMaterial color={colors.floor} roughness={.76}/></mesh>
  {(theme==='home_lounge'||theme==='home_bedroom')&&[-2.95,-2.08,-1.21,-.34,.53,1.4,2.27].map(z=><mesh key={z} position={[0,-.036,z]} receiveShadow><boxGeometry args={[10.4,.012,.018]}/><meshStandardMaterial color={colors.deep} transparent opacity={.22} roughness={.9}/></mesh>)}
  <mesh position={[0,1.62,-3.18]} receiveShadow castShadow><boxGeometry args={[10.62,3.55,.14]}/><meshStandardMaterial color={colors.wall} roughness={.88}/></mesh>
  {theme==='home_bedroom'?<>
   <mesh position={[-5.22,1.57,-2.28]} rotation-y={Math.PI/2} receiveShadow castShadow><boxGeometry args={[3.34,3.42,.14]}/><meshStandardMaterial color={colors.trim} roughness={.9}/></mesh>
   <mesh position={[-5.22,1.57,1.86]} rotation-y={Math.PI/2} receiveShadow castShadow><boxGeometry args={[2.74,3.42,.14]}/><meshStandardMaterial color={colors.trim} roughness={.9}/></mesh>
   <mesh position={[-5.22,2.91,-.04]} rotation-y={Math.PI/2} receiveShadow castShadow><boxGeometry args={[1.14,.74,.14]}/><meshStandardMaterial color={colors.trim} roughness={.9}/></mesh>
   <group name="bedroom-wing entry door" position={[-5.11,1.02,-.55]} rotation-y={-.96}>
    <mesh position-z={.51} castShadow><boxGeometry args={[.08,1.9,.94]}/><meshStandardMaterial color={colors.accent} roughness={.84}/></mesh>
    <mesh position={[.052,0,.82]}><sphereGeometry args={[.052,12,8]}/><meshStandardMaterial color="#a77545" metalness={.3} roughness={.4}/></mesh>
   </group>
  </>:<>
   <mesh position={[-5.22,1.57,-1.37]} rotation-y={Math.PI/2} receiveShadow castShadow><boxGeometry args={[5.25,3.42,.14]}/><meshStandardMaterial color={colors.trim} roughness={.9}/></mesh>
   <mesh position={[-5.22,1.57,2.88]} rotation-y={Math.PI/2} receiveShadow castShadow><boxGeometry args={[.75,3.42,.14]}/><meshStandardMaterial color={colors.trim} roughness={.9}/></mesh>
   <mesh position={[-5.22,2.91,1.875]} rotation-y={Math.PI/2} receiveShadow castShadow><boxGeometry args={[1.25,.74,.14]}/><meshStandardMaterial color={colors.trim} roughness={.9}/></mesh>
   <mesh position={[-4.64,1.08,2.48]} castShadow><boxGeometry args={[1.08,2.12,.1]}/><meshStandardMaterial color={colors.accent} roughness={.8}/></mesh>
   <mesh position={[-4.64,1.08,2.415]}><boxGeometry args={[.72,1.74,.035]}/><meshStandardMaterial color={colors.trim} roughness={.85}/></mesh>
   <mesh position={[-4.2,1.08,2.35]}><sphereGeometry args={[.055,12,8]}/><meshStandardMaterial color="#805e3c" metalness={.35} roughness={.42}/></mesh>
  </>}
  <mesh position={[0,.13,-3.07]} castShadow><boxGeometry args={[10.26,.18,.13]}/><meshStandardMaterial color={colors.trim} roughness={.76}/></mesh>
  <mesh position={[-5.11,.13,-.4]} rotation-y={Math.PI/2} castShadow><boxGeometry args={[5.28,.18,.13]}/><meshStandardMaterial color={colors.wall} roughness={.82}/></mesh>
  {theme!=='home_bedroom'&&<WindowAssembly theme={theme}/>}
  {preview&&<group position={[-1.42,2.22,-3.085]}>
   <mesh castShadow><boxGeometry args={[1.42,.92,.1]}/><meshStandardMaterial color={colors.trim} roughness={.8}/></mesh>
   <mesh position-z={.056}><planeGeometry args={[1.14,.65]}/><meshStandardMaterial color={theme==='home_bathroom'?'#70a8a5':colors.accent} roughness={.82}/></mesh>
  </group>}
  <SharedHomeRoomDetails theme={theme} occupiedPrivateSlots={occupiedPrivateSlots}/>
 </group>
}

export function IndoorEnvironment3D({theme,mode='encounter',placements,occupiedPrivateSlots=[]}:{theme:InteriorTheme;mode?:'encounter'|'preview';placements?:readonly WorldLayoutInteriorPlacement[];occupiedPrivateSlots?:readonly number[]}){
 const preview=mode==='preview'
 const sceneAssets=placements?.map(item=>({
  id:item.id,asset:item.asset,
  position:[item.position.x,item.position.y,item.position.z] as [number,number,number],
  rotation:item.rotation.y,
  scale:[item.scale.x,item.scale.y,item.scale.z] as [number,number,number],
 }))??defaultSceneAssets(theme)
 return <group name={`LingoLife ${theme} environment`} position={[0,preview ? -.08 : 0,preview ? .05 : 0]} scale={preview ? .99 : 1}>
  <RoomShell theme={theme} preview={preview} occupiedPrivateSlots={occupiedPrivateSlots}/>
  {sceneAssets.map(placement=><InteriorAssetBoundary key={placement.id} placement={placement}><Suspense fallback={<MissingInteriorAsset placement={placement}/>}><InteriorAsset placement={placement}/></Suspense></InteriorAssetBoundary>)}
 </group>
}
