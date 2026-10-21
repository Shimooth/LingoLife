import {Component,Suspense,useEffect,useMemo,type ReactNode} from 'react'
import {ContactShadows,RoundedBox,useGLTF} from '@react-three/drei'
import {Box3,Mesh,MeshStandardMaterial,Shape,Vector3} from 'three'

const base='/assets/life/interiors'
const cream='#f6e9d4',wood='#c8a279',sage='#a8b9a2',clay='#bd8670'

class FurnishingBoundary extends Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false}
 static getDerivedStateFromError(){return {failed:true}}
 render(){return this.state.failed?null:this.props.children}
}

/** Original toy architecture; keep the radius inside the thinnest dimension. */
function Block({args,position,color=cream,radius=.06,rotation=0}:{args:[number,number,number];position:[number,number,number];color?:string;radius?:number;rotation?:number}){
 return <RoundedBox args={args} position={position} rotation-y={rotation} radius={Math.min(radius,Math.min(...args)/2-.001)} smoothness={4} castShadow receiveShadow><meshStandardMaterial color={color} roughness={.86}/></RoundedBox>
}

function Furnishing({file,height,width,position,rotation=0}:{file:string;height:number;width?:number;position:[number,number,number];rotation?:number}){
 const {scene}=useGLTF(`${base}/${file}.gltf`)
 const prepared=useMemo(()=>{
  const copy=scene.clone(true)
  copy.traverse(object=>{
   if(!(object instanceof Mesh))return
   object.castShadow=true;object.receiveShadow=true
   const soften=(material:MeshStandardMaterial)=>{const next=material.clone();if(next.isMeshStandardMaterial){next.roughness=Math.max(.78,next.roughness);next.metalness=0}return next}
   object.material=Array.isArray(object.material)?object.material.map(material=>soften(material as MeshStandardMaterial)):soften(object.material as MeshStandardMaterial)
  })
  const box=new Box3().setFromObject(copy),size=box.getSize(new Vector3()),center=box.getCenter(new Vector3())
  return {copy,scale:Math.min(height/size.y,width?width/size.x:Infinity),offset:[-center.x,-box.min.y,-center.z] as [number,number,number]}
 },[scene,height,width])
 useEffect(()=>()=>prepared.copy.traverse(object=>{if(object instanceof Mesh)for(const material of Array.isArray(object.material)?object.material:[object.material])material.dispose()}),[prepared])
 return <group name={`arrival-furnishing:${file}`} position={position} rotation-y={rotation} scale={prepared.scale}><primitive object={prepared.copy} position={prepared.offset} dispose={null}/></group>
}
function SafeFurnishing(props:Parameters<typeof Furnishing>[0]){return <FurnishingBoundary><Suspense fallback={null}><Furnishing {...props}/></Suspense></FurnishingBoundary>}

const doorShape=new Shape().moveTo(-.81,0).lineTo(.81,0).lineTo(.81,2.13).absarc(0,2.13,.81,0,Math.PI,false).lineTo(-.81,0)
const rearWallShape=new Shape().moveTo(-5,0).lineTo(-.52,0).lineTo(-.52,2.14).absarc(.48,2.14,1,Math.PI,0,true).lineTo(1.48,0).lineTo(5,0).lineTo(5,3.95).lineTo(-5,3.95).closePath()

/** Uses the shipped CC0 KayKit Furniture Bits and Tiny Treats House Plants.
 * The arch, window, rug, millwork and small vase are original Three geometry. */
export function ArrivalRoom3D(){
 return <group name="arrival-home">
  <Block args={[10,.34,8.4]} position={[0,-.185,-.7]} color="#ead9bc" radius={.16}/>
  {/* A real opening with a shallow hall behind it; the resident crosses its threshold. */}
  <mesh position={[0,0,-3.56]} castShadow receiveShadow><extrudeGeometry args={[rearWallShape,{depth:.22,bevelEnabled:true,bevelSize:.035,bevelThickness:.035,bevelSegments:3,curveSegments:40}]}/><meshStandardMaterial color="#e9dfc9" roughness={.86}/></mesh>
  {([[-2.76,4.48],[3.24,3.52]] as const).map(([x,width])=><group key={x}>
   <Block args={[width,.95,.08]} position={[x,.475,-3.31]} color="#d5dfcc" radius={.035}/>
   <Block args={[width,.07,.12]} position={[x,.98,-3.28]} color={cream} radius={.025}/>
   <Block args={[width,.1,.12]} position={[x,.05,-3.27]} color={cream} radius={.04}/>
  </group>)}
  <Block args={[2.1,3.2,.15]} position={[.48,1.6,-5.03]} color="#a8b5a0" radius={.04}/>
  <Block args={[.14,3.3,1.6]} position={[-.55,1.65,-4.23]} color="#b6beaa" radius={.04}/>
  <Block args={[.14,3.3,1.6]} position={[1.51,1.65,-4.23]} color="#b6beaa" radius={.04}/>
  <Block args={[.2,3.95,5.2]} position={[-4.9,1.975,-.9]} color="#e0d8c4" radius={.08}/>
  <mesh name="arrival-woven-rug" position={[0,.008,.35]} rotation-x={-Math.PI/2} scale={[1.35,1,1]} receiveShadow><circleGeometry args={[1.7,80]}/><meshStandardMaterial color="#d0d5bc" roughness={1}/></mesh>
  <mesh position={[0,.009,.35]} rotation-x={-Math.PI/2} scale={[1.35,1,1]} receiveShadow><ringGeometry args={[1.56,1.59,80]}/><meshStandardMaterial color="#ebe8d5" roughness={1}/></mesh>

  <group name="arrival-doorway" position={[.48,0,-3.12]}>
   <Block args={[.16,2.14,.2]} position={[-.92,1.07,.035]} color={cream}/><Block args={[.16,2.14,.2]} position={[.92,1.07,.035]} color={cream}/>
   <mesh position={[0,2.14,.035]}><torusGeometry args={[.92,.08,8,48,Math.PI]}/><meshStandardMaterial color={cream} roughness={.84}/></mesh>
   <Block args={[1.98,.045,.5]} position={[0,.018,.05]} color={wood} radius={.018}/>
   <group position={[.81,0,-.02]} rotation-y={-.9}>
    <mesh position={[-.81,0,0]} castShadow receiveShadow><extrudeGeometry args={[doorShape,{depth:.075,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:.025,bevelThickness:.025,curveSegments:24}]}/><meshStandardMaterial color={sage} roughness={.8}/></mesh>
    <mesh position={[-1.43,1.28,.11]}><sphereGeometry args={[.048,14,10]}/><meshStandardMaterial color="#cfac66" roughness={.4} metalness={.25}/></mesh>
   </group>
  </group>

  <group name="arrival-window" position={[-3.1,2.3,-3.23]}>
   <Block args={[2.35,2.2,.12]} position={[0,0,0]} color={cream} radius={.055}/>
   <mesh position={[0,0,.071]}><planeGeometry args={[2.05,1.9]}/><meshBasicMaterial color="#bad2d1"/></mesh>
   <mesh position={[0,-.42,.073]}><planeGeometry args={[2.05,1.02]}/><meshBasicMaterial color="#dce0bc"/></mesh>
   <Block args={[.065,1.92,.1]} position={[0,0,.09]} color={cream} radius={.02}/>
   <Block args={[2.05,.065,.1]} position={[0,-.05,.09]} color={cream} radius={.02}/>
   <Block args={[2.5,.11,.4]} position={[0,-1.1,.12]} color={wood} radius={.045}/>
   {[-1,1].map(side=><group key={side} position={[side*1.22,0,.16]}>{[-.075,0,.075].map(x=><mesh key={x} position={[x,0,0]} scale={[.08,1.12,.07]} castShadow><sphereGeometry args={[1,12,16]}/><meshStandardMaterial color="#e7d7bc" roughness={1}/></mesh>)}</group>)}
  </group>

  <SafeFurnishing file="furniture/couch_pillows" height={1.35} width={3.05} position={[-2.8,0,-1.75]} rotation={.22}/>
  <SafeFurnishing file="furniture/table_low" height={.48} width={1.75} position={[-2.8,0,-.08]} rotation={.13}/>
  <SafeFurnishing file="furniture/shelf_B_large_decorated" height={.7} width={1.65} position={[3.65,1.78,-3.12]}/>
  <SafeFurnishing file="furniture/armchair_pillows" height={1.25} width={1.55} position={[2.9,0,-.4]} rotation={-.55}/>
  <SafeFurnishing file="furniture/lamp_standing" height={2.14} position={[2.05,0,-2.32]}/>
  <SafeFurnishing file="plants/monstera_plant_medium_potted" height={1.22} position={[-4.12,0,.55]}/>
  <group position={[-2.85,.51,-.06]}>
   <mesh castShadow><sphereGeometry args={[.12,18,12]}/><meshStandardMaterial color={clay} roughness={.82}/></mesh>
   <mesh position={[0,.13,0]}><cylinderGeometry args={[.045,.06,.14,16]}/><meshStandardMaterial color={clay} roughness={.82}/></mesh>
   {[-1,1].map(side=><mesh key={side} position={[side*.055,.26,0]} rotation-z={side*-.55} scale={[.055,.16,.027]}><sphereGeometry args={[1,12,10]}/><meshStandardMaterial color={sage} roughness={1}/></mesh>)}
  </group>
  <group position={[2.14,2.69,-3.25]} rotation-z={-.045}>
   <Block args={[.7,.84,.07]} position={[0,0,0]} color={wood} radius={.025}/>
   <mesh position={[0,0,.04]}><planeGeometry args={[.58,.72]}/><meshStandardMaterial color={cream}/></mesh>
   <mesh position={[.025,.055,.05]}><circleGeometry args={[.17,32]}/><meshStandardMaterial color="#dbb574" roughness={1}/></mesh>
   <mesh position={[-.025,-.19,.052]} scale={[1,.5,1]}><circleGeometry args={[.25,32]}/><meshStandardMaterial color={sage} roughness={1}/></mesh>
  </group>
  <ContactShadows name="arrival-contact-shadows" position={[0,.014,0]} opacity={.19} scale={11} blur={2.8} far={3.3} resolution={256} color="#8b785b"/>
 </group>
}

export function ArrivalRoomLighting(){
 return <>
  <ambientLight intensity={.26} color="#fff1dc"/>
  <hemisphereLight args={['#dce7e7','#968568',.72]}/>
  <directionalLight position={[-3.8,6,4]} color="#ffedce" intensity={2.45} castShadow shadow-mapSize={[1536,1536]} shadow-camera-left={-6} shadow-camera-right={6} shadow-camera-top={6} shadow-camera-bottom={-6} shadow-camera-near={.5} shadow-camera-far={22} shadow-normalBias={.025} shadow-bias={-.00015} shadow-radius={4} shadow-intensity={.7}/>
  <rectAreaLight position={[-3,2.5,-2.8]} rotation={[0,Math.PI,0]} width={2.1} height={1.8} color="#fff0cc" intensity={2.7}/>
  <directionalLight position={[3.5,3,5]} intensity={.65} color="#d9e6ec"/>
  <directionalLight position={[1,4,-2.5]} intensity={.65} color="#ffe4be"/>
 </>
}
