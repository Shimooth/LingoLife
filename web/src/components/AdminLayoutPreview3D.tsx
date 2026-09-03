import {Canvas,useThree} from '@react-three/fiber'
import {ContactShadows,OrbitControls,useGLTF} from '@react-three/drei'
import {Component,Suspense,useEffect,useMemo,type ReactNode} from 'react'
import * as THREE from 'three'
import type {WorldLayoutPlacement} from '../worldLayout'

type Props={
 mode:'city'|'interior'
 items:readonly WorldLayoutPlacement[]
 selectedId?:string
 onSelect:(id:string)=>void
}

function CameraSetup({mode}:{mode:Props['mode']}){
 const camera=useThree(state=>state.camera)
 useEffect(()=>{
  if(mode==='city')camera.position.set(52,46,58)
  else camera.position.set(8.2,5.8,9.2)
  camera.lookAt(0,0,0)
  if(camera instanceof THREE.OrthographicCamera){camera.zoom=mode==='city'?7.5:42;camera.updateProjectionMatrix()}
 },[camera,mode])
 return null
}

function FallbackAsset({placement}:{placement:WorldLayoutPlacement}){
 const building=placement.asset.includes('/building_')
 return <group position={[placement.position.x,placement.position.y,placement.position.z]} rotation={[placement.rotation.x,placement.rotation.y,placement.rotation.z]} scale={[placement.scale.x,placement.scale.y,placement.scale.z]}>
  <mesh castShadow receiveShadow scale={building?[1.35,2,1.35]:[.7,.7,.7]}>
   <boxGeometry args={[1,1,1]}/><meshStandardMaterial color={building?'#e8a76f':'#85a98d'} roughness={.88}/>
  </mesh>
 </group>
}

class AssetBoundary extends Component<{placement:WorldLayoutPlacement;children:ReactNode},{failed:boolean}>{
 state={failed:false}
 static getDerivedStateFromError(){return {failed:true}}
 componentDidUpdate(previous:{placement:WorldLayoutPlacement}){if(previous.placement.asset!==this.props.placement.asset&&this.state.failed)this.setState({failed:false})}
 render(){return this.state.failed?<FallbackAsset placement={this.props.placement}/>:this.props.children}
}

function LayoutAsset({placement,selected,onSelect}:{placement:WorldLayoutPlacement;selected:boolean;onSelect:()=>void}){
 const {scene}=useGLTF(placement.asset)
 const object=useMemo(()=>{
  const clone=scene.clone(true)
  clone.traverse(child=>{
   if(!(child instanceof THREE.Mesh))return
   child.castShadow=true;child.receiveShadow=true
  })
  return clone
 },[scene])
 const scale=placement.scale
 return <group position={[placement.position.x,placement.position.y,placement.position.z]} rotation={[placement.rotation.x,placement.rotation.y,placement.rotation.z]} scale={[scale.x,scale.y,scale.z]} onClick={event=>{event.stopPropagation();onSelect()}}>
  <primitive object={object}/>
  {selected&&<mesh position-y={.025} rotation-x={-Math.PI/2} scale={[1/Math.max(scale.x,.01),1/Math.max(scale.z,.01),1]}>
   <ringGeometry args={[.7,.9,32]}/><meshBasicMaterial color="#ff8b61" transparent opacity={.9} depthWrite={false} side={THREE.DoubleSide}/>
  </mesh>}
 </group>
}

export function AdminLayoutPreview3D({mode,items,selectedId,onSelect}:Props){
 const visible=items.slice(0,420)
 return <div className={`admin-layout-preview3d is-${mode}`}>
  <Canvas orthographic camera={{position:[52,46,58],zoom:7.5,near:.1,far:220}} dpr={[1,1.35]} shadows gl={{antialias:true,alpha:true,powerPreference:'low-power'}} onPointerMissed={()=>onSelect('')}>
   <CameraSetup mode={mode}/>
   <color attach="background" args={[mode==='city'?'#9bc8d7':'#e7e7dd']}/>
   <ambientLight intensity={1.12}/><hemisphereLight args={['#fff9e7','#637a78',1.25]}/>
   <directionalLight position={[-8,16,10]} intensity={2.6} color="#fff2d9" castShadow shadow-mapSize={[1024,1024]}/>
   {mode==='city'?<>
    <mesh position-y={-.05} rotation-x={-Math.PI/2} receiveShadow><planeGeometry args={[80,46]}/><meshStandardMaterial color="#8ebd83" roughness={.96}/></mesh>
    <gridHelper args={[78,30,'#ffffff55','#47746c33']} position-y={.01}/>
   </>:<>
    <mesh position={[0,-.08,0]} rotation-x={-Math.PI/2} receiveShadow><planeGeometry args={[10.6,7.2]}/><meshStandardMaterial color="#b98568" roughness={.92}/></mesh>
    <mesh position={[0,1.55,-3.38]} receiveShadow><boxGeometry args={[10.6,3.2,.12]}/><meshStandardMaterial color="#f4dfc8" roughness={.94}/></mesh>
    <mesh position={[-5.24,1.45,0]} rotation-y={Math.PI/2} receiveShadow><boxGeometry args={[6.8,3,.12]}/><meshStandardMaterial color="#fff0dc" roughness={.94}/></mesh>
    <gridHelper args={[10,20,'#ffffff55','#7b594831']} position-y={.01}/>
   </>}
   <Suspense fallback={null}>{visible.map(placement=><AssetBoundary key={placement.id} placement={placement}><LayoutAsset placement={placement} selected={placement.id===selectedId} onSelect={()=>onSelect(placement.id)}/></AssetBoundary>)}</Suspense>
   <ContactShadows position={[0,-.04,0]} opacity={.22} scale={mode==='city'?80:11} blur={2.5} far={8}/>
   <OrbitControls makeDefault enableDamping dampingFactor={.12} enablePan minZoom={mode==='city'?5:25} maxZoom={mode==='city'?28:85} maxPolarAngle={Math.PI*.47}/>
  </Canvas>
  <span>{mode==='city'?'拖动旋转 · 滚轮缩放 · 点击选择模型':'共享住宅实时 3D 预览'}</span>
 </div>
}

export default AdminLayoutPreview3D
