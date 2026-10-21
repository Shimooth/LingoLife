/* eslint-disable react-refresh/only-export-components -- Standalone visual QA entry point. */
import {Suspense,useMemo,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Canvas,useFrame,useThree} from '@react-three/fiber'
import {useGLTF} from '@react-three/drei'
import {Box3,Vector3,Raycaster} from 'three'
import {TownBuilding3D} from '/src/three/world/TownBuildings3D'
import {TOWN_VEHICLE_SCALE,vehiclePivotForSurface} from '/src/three/world/townScale'
import {Character3D} from '/src/three/characters/Character3D'
import {defaultAvatar} from '/src/avatar'
import {SceneLook,SceneLighting} from '/src/three/rendering/SceneLook'

const modes=['door','car','street'] as const
const copy={door:['居民与门口','门洞按最高 .60 的居民校准，净高至少 .766、净宽 .50；住宅两层，咖啡馆与小店一层。'],car:['居民与汽车','行驶和停放车辆共用 1.08 倍资产比例；轿车高 .398，约为居民身高的 ⅔～¾。'],street:['一条可以生活的街道','2.60 宽道路保留：双车道 1.56，人行空间各 .52。人物、门口、汽车在同一个世界尺度下对照。']}
function Person({model='chibi',position,name}:{model?:string;position:[number,number,number];name:string}){return <Character3D name={name} avatar={{...defaultAvatar,model,hair:'hair-one',outfit:'student',accessory:'none'}} animation="idle" animationPaused motionScale={0} position={position} scale={model==='chibi'?.21:.175}/>}
function Car({position=[0,0,0],rotation=0}:{position?:[number,number,number];rotation?:number}){
 const {scene}=useGLTF('/assets/world/kaykit-city/gltf/car_sedan.gltf'),object=useMemo(()=>scene.clone(true),[scene])
 return <group name="qa-town-car" position={[position[0],vehiclePivotForSurface(position[1]),position[2]]} rotation-y={rotation}><primitive object={object} scale={TOWN_VEHICLE_SCALE}/></group>
}
function Camera({mode}:{mode:string}){
 const camera=useThree(s=>s.camera),size=useThree(s=>s.size)
 useFrame(()=>{const mobile=size.width<600;camera.position.set(...(mode==='car'?[2.8,2.15,4.3]:mode==='door'?[4,3.25,6.6]:[5.9,5.6,7.9]) as [number,number,number]);camera.lookAt(0,mode==='door'?.85:mode==='street'?.55:.30,mode==='street'?-.8:0);camera.zoom=mode==='car'?(mobile?150:200):mode==='door'?(mobile?68:155):(mobile?48:124);camera.updateProjectionMatrix()})
 return null
}
function Probe({mode}:{mode:string}){
 useFrame(({scene,gl})=>{
  const buildings=[],cars=[];let skeletons=0
  scene.traverse(o=>{if(o.userData.townBuilding){const box=new Box3().setFromObject(o);buildings.push({name:o.name,kind:o.userData.townBuilding,size:box.getSize(new Vector3()).toArray(),min:box.min.toArray(),max:box.max.toArray(),doorHeight:o.userData.doorHeight,doorWidth:o.userData.doorWidth,doorBlocked:(()=>{const ray=new Raycaster(o.localToWorld(new Vector3(0,.42,2)),new Vector3(0,0,-1).transformDirection(o.matrixWorld));return ray.intersectObject(o.getObjectByName('town-front-shell'),false).length>0})()})}if(o.name==='qa-town-car'){const box=new Box3().setFromObject(o);cars.push({size:box.getSize(new Vector3()).toArray(),min:box.min.toArray()})}if(o.isSkinnedMesh)skeletons++})
  window.townScaleQa={mode,buildings,cars,skeletons,drawCalls:gl.info.render.calls,ready:skeletons>0}
 })
 return null
}
function Street(){return <>
 <mesh position={[0,-.032,0]} receiveShadow><boxGeometry args={[5.6,.055,2.6]}/><meshStandardMaterial color="#858d85" roughness={1}/></mesh>
 {[-1,1].map(side=><mesh key={side} position={[0,.009,side*1.04]} receiveShadow><boxGeometry args={[5.6,.05,.52]}/><meshStandardMaterial color="#d7d4bf" roughness={.94}/></mesh>)}
 {[-2,-1,0,1,2].map(x=><mesh key={x} position={[x,0,0]}><boxGeometry args={[.38,.009,.035]}/><meshStandardMaterial color="#f1ead1"/></mesh>)}
 <TownBuilding3D kind="home" id="home" position={[-1.6,.035,-2.28]}/><TownBuilding3D kind="community" id="shop" position={[1.1,.035,-2.28]}/>
 <Car position={[-.45,0,.39]} rotation={Math.PI/2}/><Person name="street-chibi" position={[.55,.035,1.02]}/><Person name="street-city" model="city-03" position={[-.5,.035,-1.07]}/>
 </>}
function App(){
 const [mode,setMode]=useState(new URLSearchParams(location.search).get('mode')??'door')
 return <><header><div><h1>生活街区 · 比例样板</h1><p>同一把尺，三组实景对照 · 虚构预览，不连接账号</p></div><nav>{modes.map(m=><button key={m} aria-pressed={mode===m} onClick={()=>setMode(m)}>{m==='door'?'人 × 门':m==='car'?'人 × 车':'一条街'}</button>)}</nav></header><main><Canvas orthographic shadows dpr={[1,1.5]} camera={{position:[4,3,7],zoom:140,near:.01,far:80}} gl={{antialias:true}}><color attach="background" args={['#eeeddf']}/><SceneLook/><SceneLighting/><Camera mode={mode}/><mesh rotation-x={-Math.PI/2} position-y={-.045} receiveShadow><planeGeometry args={[200,200]}/><meshStandardMaterial color="#eeeddf" roughness={1}/></mesh><Suspense fallback={null}>{mode==='door'?<><TownBuilding3D kind="home" id="home" position={[-1.3,0,0]}/><TownBuilding3D kind="cafe" id="cafe" position={[1.3,0,0]}/><Person name="door-chibi" position={[-1.08,0,1.18]}/><Person name="door-city" model="city-03" position={[1.57,0,1.18]}/></>:mode==='car'?<><Car rotation={Math.PI/2}/><Person name="car-chibi" position={[-.78,0,.23]}/><Person name="car-city" model="city-03" position={[.7,0,.23]}/></>:<Street/>}<Probe mode={mode}/></Suspense></Canvas><aside className="qa-copy"><b>{copy[mode][0]}</b><span>{copy[mode][1]}</span></aside></main></>
}
createRoot(document.getElementById('root')!).render(<App/> )
