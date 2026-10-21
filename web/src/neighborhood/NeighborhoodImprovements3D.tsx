import {RoundedBox} from '@react-three/drei'

export type NeighborhoodImprovements={flowerBeds:boolean;plazaLights:boolean}
/** Paid improvements are persistent scenery, never a second reward system. */
export function NeighborhoodImprovements3D({value,night=false,compact=false,quality='high'}:{value?:NeighborhoodImprovements;night?:boolean;compact?:boolean;quality?:'high'|'low'}){
 if(!value)return null
 const flowers=compact?[[.80,.86],[-.80,.86]]:[[1.9,2.44],[-1.9,2.44]]
 const lamps=compact?[[.79,-.71],[-.79,-.71]]:[[.85,2.45],[-.85,2.45]]
 return <group name="neighborhood-funded-improvements">
  {value.flowerBeds&&flowers.map(([x,z],index)=><group key={`flowers:${index}`} name="funded-flower-bed" position={[x,0,z]} scale={compact?.38:[1,1,.65]}>
   <RoundedBox args={[.84,.19,.32]} radius={.055} position-y={.095} receiveShadow castShadow={quality==='high'}><meshStandardMaterial color="#ccaa88" roughness={.88}/></RoundedBox>
   <mesh position-y={.2}><boxGeometry args={[.73,.025,.23]}/><meshStandardMaterial color="#7c7860" roughness={1}/></mesh>
   {[-.27,-.09,.09,.27].map((offset,i)=><group key={offset} position={[offset,.22,i%2?.055:-.045]}>
    <mesh position-y={.08}><cylinderGeometry args={[.009,.012,.16,5]}/><meshStandardMaterial color="#5f8f72"/></mesh>
    <mesh position-y={.17} rotation-x={-.3}><sphereGeometry args={[.055,8,6]}/><meshStandardMaterial color={i%2?'#eab17f':'#d78f96'}/></mesh>
    {[-1,1].map(side=><mesh key={side} position={[side*.03,.07,0]} scale={[.048,.018,.027]} rotation-z={side*.5}><sphereGeometry args={[1,6,5]}/><meshStandardMaterial color="#85a77a"/></mesh>)}
   </group>)}
  </group>)}
  {value.plazaLights&&lamps.map(([x,z],index)=><group key={`light:${index}`} name="funded-plaza-light" position={[x,0,z]} scale={compact?.65:1}>
   <mesh position-y={.045} receiveShadow><cylinderGeometry args={[.075,.095,.09,12]}/><meshStandardMaterial color="#b8ab91" roughness={.8}/></mesh>
   <mesh position-y={.44} castShadow={quality==='high'}><cylinderGeometry args={[.025,.033,.79,10]}/><meshStandardMaterial color="#5d7c6b" roughness={.6}/></mesh>
   <mesh position-y={.89}><sphereGeometry args={[.105,12,10]}/><meshStandardMaterial color="#f6e1ae" emissive="#ffd496" emissiveIntensity={night?1.1:.14} roughness={.32}/></mesh>
   <mesh position-y={1.0} castShadow={quality==='high'}><coneGeometry args={[.14,.09,12]}/><meshStandardMaterial color="#5d7c6b" roughness={.65}/></mesh>
   {night&&quality==='high'&&<pointLight position={[0,.86,0]} color="#ffcf91" intensity={.9} distance={2.8} decay={2}/>}
  </group>)}
 </group>
}
