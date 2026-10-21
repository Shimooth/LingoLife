import {StrictMode, useEffect} from 'react'
import {createRoot} from 'react-dom/client'
import {Canvas, useThree} from '@react-three/fiber'
import {Environment, Lightformer, OrbitControls} from '@react-three/drei'
import {ACESFilmicToneMapping, Box3, Mesh} from 'three'
import {OriginalNeighborhood, ORIGINAL_LIGHTING_RECIPES, type OriginalQuality, type OriginalTimeOfDay} from './OriginalNeighborhood'
import {OriginalRoom} from './OriginalRoom'
import {OriginalResident} from '../character/OriginalResident'
import {ORIGINAL_PRESETS} from '../spec'
function Inspector(){
  const {scene,gl}=useThree()
  useEffect(()=>{
    const target=window as unknown as Record<string,unknown>
    target.inspectOriginalEnvironment=()=>{
      const assets:unknown[]=[]
      scene.traverse(object=>{if(object.name.startsWith('original-building-')||object.name==='original-wish-fountain'||object.name==='original-bench'){
        const bounds=new Box3().setFromObject(object)
        assets.push({name:object.name,min:bounds.min.toArray(),max:bounds.max.toArray()})
      }})
      let meshes=0,textureMaps=0
      scene.traverse(object=>{if(object instanceof Mesh){meshes++;const materials=Array.isArray(object.material)?object.material:[object.material];for(const material of materials)if('map' in material&&material.map)textureMaps++}})
      return {assets,meshes,textureMaps,render:gl.info.render,memory:gl.info.memory}
    }
    return()=>{delete target.inspectOriginalEnvironment}
  },[scene,gl])
  return null
}
export function Preview(){
  const params=new URLSearchParams(location.search),quality:OriginalQuality=params.get('quality')==='low'?'low':'high'
  const time:OriginalTimeOfDay=params.get('time')==='night'?'night':params.get('time')==='sunset'?'sunset':'day'
  const room=params.has('room'),lights=ORIGINAL_LIGHTING_RECIPES[time]
  return <Canvas shadows camera={{position:room?[12,9,16]:[18,14.5,22],fov:35}} dpr={1} onCreated={({gl})=>{gl.toneMapping=ACESFilmicToneMapping;gl.toneMappingExposure=1}}>
    <color attach="background" args={[lights.background]}/>
    <ambientLight intensity={lights.ambient}/><hemisphereLight args={[time==='night'?'#abc6e0':'#fff6e5',time==='night'?'#37443d':'#aba987',time==='night'?.45:1.1]}/>
    <directionalLight position={[...lights.keyPosition]} intensity={lights.key} color={lights.keyColor} castShadow shadow-mapSize={[2048,2048]} shadow-camera-left={-19} shadow-camera-right={19} shadow-camera-top={19} shadow-camera-bottom={-19} shadow-camera-near={1} shadow-camera-far={60} shadow-normalBias={.035}/>
    <directionalLight position={[8,5,6]} intensity={.5} color="#d9e4df"/>
    <Environment resolution={64}><Lightformer position={[0,10,0]} rotation-x={Math.PI/2} scale={[10,10,1]} intensity={1.2} color="#fff1d8"/></Environment>
    {room?<OriginalRoom timeOfDay={time} quality={quality}/>:<OriginalNeighborhood timeOfDay={time} quality={quality}/>}
    <group position={room?[0,0,1]:[-1.55,0,3.4]}><OriginalResident appearance={ORIGINAL_PRESETS[0].appearance} motion="idle" quality={quality}/></group>
    {!room&&<group position={[1.55,0,3.2]}><OriginalResident appearance={ORIGINAL_PRESETS[1].appearance} motion="idle" quality={quality}/></group>}
    <OrbitControls target={room?[0,1.6,0]:[0,1.6,-1.5]}/><Inspector/>
  </Canvas>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Preview/></StrictMode>)
