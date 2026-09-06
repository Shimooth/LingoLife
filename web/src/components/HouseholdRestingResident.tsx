import {useEffect,useMemo,useRef,type ReactNode} from 'react'
import {useFrame} from '@react-three/fiber'
import {Html} from '@react-three/drei'
import {BufferGeometry,Float32BufferAttribute,Group,Mesh,Plane,Vector3,DoubleSide} from 'three'
import {Character3D} from '../three/characters/Character3D'
import {getCharacterFamily} from '../three/characters/characterAssets'
import type {HouseholdResidentVisual} from './householdVisuals'
import type {SharedHomeResolvedAnchor} from '../three/interiors/sharedHomeLayout'
import type {LifeLanguage} from '../life/lifeActionCatalog'

// Mattress y=.5, bed scale=.46, preview scale/offset=.99/-.08, anchor y=-.17.
const BED_SURFACE=.5*.46*.99-.08+.17

function Duvet({reducedMotion}:{reducedMotion:boolean}){
 const mesh=useRef<Mesh>(null)
 const geometry=useMemo(()=>{
  const vertices:number[]=[],indices:number[]=[],nx=24,nz=22
  for(let z=0;z<=nz;z++)for(let x=0;x<=nx;x++){
   const u=(x/nx)*2-1,v=z/nz
   const arch=Math.pow(Math.max(0,Math.cos(u*Math.PI/2)),.7)
   const loft=.235*arch*(.93+.07*Math.sin(v*Math.PI))
   vertices.push(u*.47,BED_SURFACE-.018+loft,-.18+v*.85)
   if(x<nx&&z<nz){const i=z*(nx+1)+x;indices.push(i,i+nx+1,i+1,i+1,i+nx+1,i+nx+2)}
  }
  const result=new BufferGeometry();result.setAttribute('position',new Float32BufferAttribute(vertices,3));result.setIndex(indices);result.computeVertexNormals();return result
 },[])
 useEffect(()=>()=>geometry.dispose(),[geometry])
 useFrame(({clock})=>{if(mesh.current)mesh.current.position.y=reducedMotion?0:Math.sin(clock.elapsedTime*1.5)*.002})
 return <mesh ref={mesh} name="draped-duvet" geometry={geometry} castShadow receiveShadow><meshStandardMaterial color="#98b9aa" roughness={1} side={DoubleSide}/></mesh>
}

function UnderDuvet({children}:{children:ReactNode}){
 const root=useRef<Group>(null)
 const plane=useMemo(()=>new Plane(),[]),local=useMemo(()=>new Plane(new Vector3(0,0,-1),-.175),[])
 const clipping=useMemo(()=>[plane],[plane])
 useFrame(()=>{
  const group=root.current;if(!group)return
  group.updateWorldMatrix(true,false);plane.copy(local).applyMatrix4(group.matrixWorld)
  // Models own cloned materials: clip only the covered part, never shared assets.
  group.traverse(object=>{if(!(object instanceof Mesh))return;for(const material of Array.isArray(object.material)?object.material:[object.material])if(material.clippingPlanes!==clipping){material.clippingPlanes=clipping;material.clipShadows=true;material.needsUpdate=true}})
 })
 return <group ref={root} name="covered-sleeper">{children}</group>
}

function ShowerSteam({chibi,reducedMotion}:{chibi:boolean;reducedMotion:boolean}){
 const root=useRef<Group>(null),height=chibi?.40:.56
 useFrame(({clock})=>{if(root.current)root.current.rotation.y=reducedMotion?0:Math.sin(clock.elapsedTime*.55)*.025})
 return <group ref={root} name="shower-steam" position-y={height}>
  {/* Opaque core covers the body from every angle, softer puffs suggest steam. */}
  <mesh scale={[.67,height+.06,.57]}><sphereGeometry args={[1,20,14]}/><meshBasicMaterial color="#e3eeed"/></mesh>
  {Array.from({length:10},(_,i)=>{const angle=i*Math.PI/5;return <mesh key={i} position={[Math.cos(angle)*.44,((i%3)-1)*.10,Math.sin(angle)*.35]} scale={[.33,chibi?.28:.37,.32]}><sphereGeometry args={[1,12,10]}/><meshBasicMaterial color={i%2?'#eff5f2':'#e5efee'}/></mesh>})}
  {[-1,1].map(side=><mesh key={side} position={[side*.37,.18,0]} scale={[.43,.28,.4]}><sphereGeometry args={[1,14,12]}/><meshBasicMaterial color="#f4f9f5" transparent opacity={.22} depthWrite={false}/></mesh>)}
 </group>
}

export function HouseholdRestingResident({resident,anchor,selected,language,reducedMotion}:{resident:HouseholdResidentVisual;anchor:SharedHomeResolvedAnchor;selected:boolean;language:LifeLanguage;reducedMotion:boolean}){
 const sleeping=resident.currentAction?.source==='life'&&resident.currentAction.type==='sleep'
 const chibi=getCharacterFamily(resident.avatar)==='chibi'
 const position:[number,number,number]=sleeping?[anchor.position[0]*.99,anchor.position[1],anchor.position[2]*.99+.05]:anchor.position
 return <group name={`household-resident:${resident.id}`} position={position} rotation-y={anchor.rotation}>
  {selected&&<mesh name="household-focus-ring" rotation-x={-Math.PI/2} position={[0,.045,0]}><ringGeometry args={[sleeping?.67:.72,sleeping?.73:.78,48]}/><meshBasicMaterial color="#e9aa4d" depthWrite={false}/></mesh>}
  {sleeping?<group name="sleeping-in-own-bed">
   <UnderDuvet><group name="mattress-aligned-pose" position={[0,chibi?.47:.49,.6]} rotation-x={-Math.PI/2}>
    <Character3D avatar={resident.avatar} name={resident.name} seed={resident.id} scale={chibi?.49:.36} animation="idle" lifeMotion="Idle_A" animationPaused motionScale={0}/>
   </group></UnderDuvet>
   <Duvet reducedMotion={reducedMotion}/>
   <Html center position={[0,1.15,-.45]} zIndexRange={[8,5]}><div className={`household-life-label${selected?' is-selected':''}`}><b>{resident.name}</b><span>{language==='zh'?'☾ 正在睡觉':'☾ Sleeping'}</span></div></Html>
  </group>:<group name="screened-shower">
   <Character3D avatar={resident.avatar} name={resident.name} seed={resident.id} scale={chibi?.76:.56} animation="idle" lifeMotion="Idle_A" animationPaused={reducedMotion} motionScale={.1}/>
   <ShowerSteam chibi={chibi} reducedMotion={reducedMotion}/>
   <Html center position={[0,chibi?2.0:2.15,0]} zIndexRange={[8,5]}><div className={`household-life-label${selected?' is-selected':''}`}><b>{resident.name}</b><span>{language==='zh'?'正在洗澡 · 稍后再聊':'Showering · talk later'}</span></div></Html>
  </group>}
 </group>
}
