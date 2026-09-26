import {useEffect,useMemo} from 'react'
import {Instances,Instance} from '@react-three/drei'
import {Color,ConeGeometry,Float32BufferAttribute} from 'three'
import {CAFE_DRINK_RIG,type StreetscapeLayout} from './streetscapeLayout'
import {DRINK_CUP_RIM} from '../characters/sharedDrinkContact'

type Quality='high'|'low'
const stone='#c8c6b9',warmStone='#d5c5ac',metal='#435952',wood='#ad8057'

function CafeCup({position,color}:{position:[number,number,number];color:string}){
 const center=DRINK_CUP_RIM.height+.0015
 return <group position={position}>
  <mesh position-y={center} castShadow><cylinderGeometry args={[DRINK_CUP_RIM.radius,.06,DRINK_CUP_RIM.height*2,12,1,true]}/><meshStandardMaterial color={color} roughness={.56} side={2}/></mesh>
  <mesh position-y={center+.055} rotation-x={-Math.PI/2}><circleGeometry args={[.066,12]}/><meshStandardMaterial color="#654835" roughness={.45}/></mesh>
  <mesh position={[.086,center,0]}><torusGeometry args={[.039,.012,6,12]}/><meshStandardMaterial color={color} roughness={.56}/></mesh>
 </group>
}

/** These dimensions are the interaction rig, not lookalike miniature furniture. */
export function CafeDrinkFurniture3D({cups=true,quality='high'}:{cups?:boolean;quality?:Quality}){
 return <group name="cafe-drink-furniture">
  <mesh position={[0,.583,0]} castShadow receiveShadow><cylinderGeometry args={[.5,.5,.05,quality==='high'?32:16]}/><meshStandardMaterial color="#eedabe" roughness={.74}/></mesh>
  <mesh position={[0,.289,0]} castShadow><cylinderGeometry args={[.04,.065,.538,8]}/><meshStandardMaterial color={metal} roughness={.75}/></mesh>
  <mesh position={[0,.035,0]} receiveShadow><cylinderGeometry args={[.21,.25,.06,12]}/><meshStandardMaterial color={metal} roughness={.75}/></mesh>
  {CAFE_DRINK_RIG.seats.map((seat,index)=><group key={index} position={seat.position} rotation-y={seat.rotation}>
   <mesh position={[0,.366,0]} castShadow receiveShadow><boxGeometry args={[.43,.044,.43]}/><meshStandardMaterial color={index?'#ce9776':'#739d87'} roughness={.84}/></mesh>
   <mesh position={[0,.573,-.218]} castShadow><boxGeometry args={[.43,.33,.045]}/><meshStandardMaterial color={index?'#ce9776':'#739d87'} roughness={.84}/></mesh>
   {[-1,1].flatMap(x=>[-1,1].map(z=><mesh key={`${x}:${z}`} position={[x*.17,.184,z*.17]} castShadow><cylinderGeometry args={[.023,.028,.368,6]}/><meshStandardMaterial color={metal} roughness={.8}/></mesh>))}
  </group>)}
  {cups&&CAFE_DRINK_RIG.cupRest.map((position,index)=><CafeCup key={index} position={position} color={index?'#d89870':'#81a79b'}/>)}
 </group>
}

function CafeTerraceObjects({quality}:{quality:Quality}){
 const canopy=useMemo(()=>{
  const geometry=new ConeGeometry(1.15,.44,8,1,true).toNonIndexed(),position=geometry.getAttribute('position')
  const colors=new Float32Array(position.count*3),cream=new Color('#ead9b5'),sage=new Color('#789b87')
  for(let index=0;index<position.count;index+=3){
   const x=position.getX(index)+position.getX(index+1)+position.getX(index+2),z=position.getZ(index)+position.getZ(index+1)+position.getZ(index+2)
   const panel=Math.floor((Math.atan2(z,x)+Math.PI)/(Math.PI/4)),color=panel%2?cream:sage
   for(let corner=0;corner<3;corner++)color.toArray(colors,(index+corner)*3)
  }
  geometry.setAttribute('color',new Float32BufferAttribute(colors,3));return geometry
 },[])
 useEffect(()=>()=>canopy.dispose(),[canopy])
 return <>
  <CafeDrinkFurniture3D quality={quality}/>
  <group position={[0,0,-1.68]} name="cafe-parasol">
   <mesh position-y={1.34} castShadow><cylinderGeometry args={[.032,.036,2.68,8]}/><meshStandardMaterial color={wood} roughness={.88}/></mesh>
   <mesh position-y={2.53} geometry={canopy} castShadow><meshStandardMaterial vertexColors roughness={.94} side={2}/></mesh>
   <mesh position-y={2.31}><cylinderGeometry args={[1.15,1.15,.09,8,1,true]}/><meshStandardMaterial color="#789b87" roughness={.94} side={2}/></mesh>
   <mesh position-y={.045} receiveShadow><cylinderGeometry args={[.29,.34,.09,8]}/><meshStandardMaterial color="#818a7a" roughness={.9}/></mesh>
  </group>
  <group position={[1.72,0,.65]} rotation-y={-.26} name="cafe-menu-board">
   <mesh position={[0,.47,0]} castShadow><boxGeometry args={[.53,.69,.065]}/><meshStandardMaterial color={wood} roughness={.9}/></mesh>
   <mesh position={[0,.48,.04]}><boxGeometry args={[.44,.58,.012]}/><meshStandardMaterial color="#344f49" roughness={1}/></mesh>
   {[.63,.53,.43].map((y,index)=><mesh key={y} position={[index===0?0:-.04,y,.05]}><boxGeometry args={[index===0?.27:.21,.018,.009]}/><meshStandardMaterial color="#e6dcc4" roughness={1}/></mesh>)}
   {[-1,1].map(side=><mesh key={side} position={[side*.21,.16,.07]} rotation-x={-.14} castShadow><boxGeometry args={[.035,.34,.04]}/><meshStandardMaterial color={wood} roughness={.9}/></mesh>)}
  </group>
 </>
}

export function CityStreetscape({layout,quality='high',reducedMotion=false}:{layout:StreetscapeLayout;quality?:Quality;reducedMotion?:boolean}){
 const paving=layout.paving
 const trees=useMemo(()=>layout.planters.filter(planter=>planter.tree),[layout.planters])
 const seams=useMemo(()=>paving.flatMap(item=>[-1,1].map(side=>{
  const offset=side*(item.half[0]-.08)
  return {id:`${item.id}:${side}`,position:[item.position[0]+offset*Math.cos(item.rotation),.379,item.position[1]-offset*Math.sin(item.rotation)] as [number,number,number],rotation:item.rotation,length:item.half[1]*2-.16}
 })),[paving])
 // Geometry stays perfectly still under reduced motion; there are no ambient
 // actors or endlessly waving objects masquerading as gameplay.
 return <group name="city-streetscape" userData={{pavingCount:paving.length,planterCount:layout.planters.length,hasCafeTerrace:Boolean(layout.cafeTerrace),reducedMotion}}>
  <Instances key={`paving-${paving.length}`} limit={Math.max(1,paving.length)} receiveShadow>
   <boxGeometry args={[1,.008,1]}/><meshStandardMaterial roughness={.93}/>
   {paving.map(item=><Instance key={item.id} position={[item.position[0],.373,item.position[1]]} rotation={[0,item.rotation,0]} scale={[item.half[0]*2,1,item.half[1]*2]} color={item.tone==='warm'?warmStone:stone}/>)}
  </Instances>
  {quality==='high'&&<Instances key={`seams-${seams.length}`} limit={Math.max(1,seams.length)} receiveShadow>
   <boxGeometry args={[.025,.005,1]}/><meshStandardMaterial color="#a8ac9e" roughness={1}/>
   {seams.map(item=><Instance key={item.id} position={item.position} rotation={[0,item.rotation,0]} scale={[1,1,item.length]}/>)}
  </Instances>}
  {layout.planters.map((item,index)=><group key={item.id} name={item.id} position={[item.position[0],.38,item.position[1]]} rotation-y={item.rotation} userData={{streetscapeFootprint:{position:item.position,half:item.half,rotation:item.rotation}}}>
   <mesh position-y={.095} receiveShadow castShadow={quality==='high'}><boxGeometry args={[item.half[0]*2,.19,item.half[1]*2]}/><meshStandardMaterial color="#beb8a3" roughness={.93}/></mesh>
   <mesh position-y={.196}><boxGeometry args={[item.half[0]*2-.13,.018,item.half[1]*2-.13]}/><meshStandardMaterial color="#716c4d" roughness={1}/></mesh>
   {!item.tree&&[-.43,0,.43].map((offset,bush)=><mesh key={offset} position={[offset,.39,0]} scale={[.43,.27,.32]} castShadow={quality==='high'}><icosahedronGeometry args={[1,1]}/><meshStandardMaterial color={bush===1?'#7b985a':'#658463'} roughness={1}/></mesh>)}
   {quality==='high'&&[-1,1].map(side=><mesh key={side} position={[side*item.half[0]*.62,.23,side*.18]} scale={[.12,.08,.12]}><icosahedronGeometry args={[1,0]}/><meshStandardMaterial color={index%2?'#cfaa67':'#c98974'} roughness={.9}/></mesh>)}
  </group>)}
  <Instances key={`trunks-${trees.length}`} limit={Math.max(1,trees.length)} castShadow={quality==='high'}><cylinderGeometry args={[.065,.085,.65,7]}/><meshStandardMaterial color="#806045" roughness={1}/>
   {trees.map(item=><Instance key={item.id} position={[item.position[0],.91,item.position[1]]}/>)}
  </Instances>
  <Instances key={`canopies-${trees.length}`} limit={Math.max(1,trees.length*2)} castShadow={quality==='high'}><icosahedronGeometry args={[.44,1]}/><meshStandardMaterial roughness={.95}/>
   {trees.flatMap((item,index)=>[<Instance key={`${item.id}-low`} position={[item.position[0]-.12,1.28,item.position[1]]} scale={[1.02,.86,.96]} color={index%2?'#74936b':'#648d74'}/>,<Instance key={`${item.id}-high`} position={[item.position[0]+.1,1.52,item.position[1]+.025]} scale={[.8,.94,.83]} color={index%2?'#88a778':'#7e9f7a'}/>])}
  </Instances>
  {layout.cafeTerraces.map(terrace=><group key={terrace.locationId} name={`cafe-terrace:${terrace.locationId}`} position={terrace.position} rotation-y={terrace.rotation} scale={terrace.scale} userData={{streetscapeFootprint:terrace.footprint}}><CafeTerraceObjects quality={quality}/></group>)}
 </group>
}
