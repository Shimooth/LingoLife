import {Component,Suspense,useEffect,useMemo,useRef,type ReactNode} from 'react'
import {useFrame} from '@react-three/fiber'
import {useGLTF} from '@react-three/drei'
import {Box3,BufferAttribute,Color,DataTexture,Group,LinearFilter,RepeatWrapping,Mesh,MeshBasicMaterial,MeshPhysicalMaterial,MeshStandardMaterial,QuadraticBezierCurve3,TubeGeometry,Vector3} from 'three'

const SOURCE='/assets/life/interiors/park/fountain.gltf'
// The original four-lobed basin is 4 units wide. Preserve its proportions and
// keep every visible part inside the map's existing 1.98 × 1.98 reservation.
const MODEL_SCALE=.48,PLINTH_TOP=.045
const LOWER_WATER=PLINTH_TOP+.5*MODEL_SCALE,UPPER_WATER=PLINTH_TOP+1.435303688*MODEL_SCALE
const WATER_COLOR='#5bbdc8'
const LANDINGS:[[number,number],[number,number],[number,number],[number,number]]=[[.52,0],[0,.54],[-.57,-.14],[-.17,-.49]]

class FountainBoundary extends Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false}
 static getDerivedStateFromError(){return {failed:true}}
 render(){return this.state.failed?<mesh position-y={.07}><cylinderGeometry args={[.78,.85,.14,32]}/><meshStandardMaterial color="#d5cab4"/></mesh>:this.props.children}
}

function FountainAsset({name,reducedMotion,paused}:{name:string;reducedMotion:boolean;paused:boolean}){
 const elapsed=useRef(0)
 const {scene}=useGLTF(SOURCE)
 const prepared=useMemo(()=>{
  const copy=scene.clone(true),materials:MeshStandardMaterial[]=[],waterGeometries:Mesh['geometry'][]=[]
  // A small local height field supplies moving highlights, without transmission
  // or a second scene render. Source geometry and atlas are never mutated.
  const pixels=new Uint8Array(64*64*4)
  for(let y=0;y<64;y++)for(let x=0;x<64;x++){
   const u=x/64*Math.PI*2,v=y/64*Math.PI*2
   const value=Math.round(128+28*Math.sin(u*3+v*2)+18*Math.sin(v*5-u)+12*Math.cos(u*4-v*3))
   const index=(y*64+x)*4;pixels[index]=pixels[index+1]=pixels[index+2]=value;pixels[index+3]=255
  }
  const rippleTexture=new DataTexture(pixels,64,64)
  rippleTexture.wrapS=rippleTexture.wrapT=RepeatWrapping
  rippleTexture.minFilter=rippleTexture.magFilter=LinearFilter
  rippleTexture.needsUpdate=true
  copy.traverse(object=>{
   if(!(object instanceof Mesh))return
   const water=object.name==='fountain_water',leaves=object.name==='fountain_leaves'
   const original=(Array.isArray(object.material)?object.material[0]:object.material) as MeshStandardMaterial
   const material=water?new MeshPhysicalMaterial({
    bumpMap:rippleTexture,bumpScale:.055,color:WATER_COLOR,roughness:.18,metalness:0,ior:1.333,clearcoat:.7,clearcoatRoughness:.12,envMapIntensity:.9,
   }):original.clone()
   if(water){
    object.geometry=object.geometry.clone();waterGeometries.push(object.geometry)
    const positions=object.geometry.getAttribute('position'),uv=new Float32Array(positions.count*2)
    for(let index=0;index<positions.count;index++){uv[index*2]=positions.getX(index)/4+.5;uv[index*2+1]=positions.getZ(index)/4+.5}
    object.geometry.setAttribute('uv',new BufferAttribute(uv,2))
   }else{
    material.roughness=leaves?.68:.52
    material.metalness=0
    material.envMapIntensity=.45
    if(!leaves)material.color.multiply(new Color('#f7ecda'))
   }
   // Water and stone share one atlas in the source file. Only the water gets
   // a separate material; the original stone gradient and leaves stay intact.
   material.name=water?'fountain-water-glaze':leaves?'fountain-leaf-atlas':'fountain-stone-atlas'
   materials.push(material);object.material=material
   object.castShadow=!water;object.receiveShadow=true
  })
  const bounds=new Box3().setFromObject(copy),center=bounds.getCenter(new Vector3())
  return {copy,materials,rippleTexture,waterGeometries,offset:[-center.x,-bounds.min.y,-center.z] as [number,number,number]}
 },[scene])
 useEffect(()=>()=>{prepared.materials.forEach(material=>material.dispose());prepared.waterGeometries.forEach(geometry=>geometry.dispose());prepared.rippleTexture.dispose()},[prepared])
 useFrame((_,delta)=>{
  if(reducedMotion||paused||document.hidden)return
  elapsed.current+=Math.min(delta,.05)
  prepared.rippleTexture.offset.set(elapsed.current*.022,-elapsed.current*.017)
 })
 return <group name={name} position-y={PLINTH_TOP} scale={MODEL_SCALE}><primitive object={prepared.copy} position={prepared.offset} dispose={null}/></group>
}

function FlowingWater({reducedMotion,paused}:{reducedMotion:boolean;paused:boolean}){
 const droplets=useRef<Group>(null),ripples=useRef<Group>(null),time=useRef(0)
 const streams=useMemo(()=>LANDINGS.map(([endX,endZ])=>{
  const length=Math.hypot(endX,endZ),x=endX/length,z=endZ/length
  const curve=new QuadraticBezierCurve3(new Vector3(x*.025,UPPER_WATER+.005,z*.025),new Vector3(x*.26,1.44,z*.26),new Vector3(endX,LOWER_WATER+.008,endZ))
  return {curve,geometry:new TubeGeometry(curve,32,.009,6,false),end:curve.getPoint(1)}
 }),[])
 useEffect(()=>()=>streams.forEach(stream=>stream.geometry.dispose()),[streams])
 useFrame((_,delta)=>{
  if(reducedMotion||paused||document.hidden)return
  time.current+=Math.min(delta,.05)
  droplets.current?.children.forEach((drop,index)=>{
   const stream=streams[Math.floor(index/3)],phase=(time.current*.68+(index%3)/3)%1
   drop.position.copy(stream.curve.getPoint(phase))
   drop.scale.setScalar(.8+Math.sin(phase*Math.PI)*.35)
  })
  ripples.current?.children.forEach((ring,index)=>{
   const phase=(time.current*.72+(index%2)*.5)%1
   ring.scale.setScalar(.35+phase*.65)
   const material=(ring as Mesh).material as MeshBasicMaterial
   material.opacity=(1-phase)*.36
  })
 })
 return <group name="fountain-flowing-water" userData={{lowerWaterY:LOWER_WATER,upperWaterY:UPPER_WATER}}>
  {streams.map((stream,index)=><mesh key={index} name="fountain-water-stream" geometry={stream.geometry}><meshPhysicalMaterial color="#bbe9e8" roughness={.12} clearcoat={1} transparent opacity={.62} depthWrite={false}/></mesh>)}
  <group ref={droplets} name="fountain-flow-droplets">{streams.flatMap((stream,index)=>[0,1,2].map(phase=><mesh key={`${index}:${phase}`} position={stream.curve.getPoint(phase/3)}><sphereGeometry args={[.016,7,6]}/><meshStandardMaterial color="#dbf6ee" roughness={.2}/></mesh>))}</group>
  <group ref={ripples} name="fountain-impact-ripples">{streams.flatMap((stream,index)=>[0,1].map(phase=><mesh key={`${index}:${phase}`} position={[stream.end.x,LOWER_WATER+.011+phase*.0005,stream.end.z]} rotation-x={-Math.PI/2} scale={phase?.8:.5}><ringGeometry args={[.065,.071,32]}/><meshBasicMaterial color="#ddf3e7" transparent opacity={phase?.15:.3} depthWrite={false}/></mesh>))}</group>
  <mesh position={[0,UPPER_WATER+.011,0]} rotation-x={-Math.PI/2}><ringGeometry args={[.048,.058,32]}/><meshBasicMaterial color="#e0f4e5" transparent opacity={.65} depthWrite={false}/></mesh>
 </group>
}

/** Shared by the real city and the close-up story stage, with no gameplay side effects. */
export function Fountain3D({scale=1,reducedMotion=false,paused=false,assetName='toy-fountain-asset'}:{scale?:number;reducedMotion?:boolean;paused?:boolean;assetName?:string}){
 return <group name="toy-fountain-facility" scale={scale}>
  <mesh position-y={.015} receiveShadow><cylinderGeometry args={[.97,.97,.03,64]}/><meshStandardMaterial color="#c4b393" roughness={.76}/></mesh>
  <mesh position-y={.036} receiveShadow><cylinderGeometry args={[.93,.955,.018,64]}/><meshStandardMaterial color="#e9ddc5" roughness={.56}/></mesh>
  <FountainBoundary><Suspense fallback={null}><FountainAsset name={assetName} reducedMotion={reducedMotion} paused={paused}/><FlowingWater reducedMotion={reducedMotion} paused={paused}/></Suspense></FountainBoundary>
 </group>
}
