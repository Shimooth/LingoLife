import {resolveSharedDrinkLayout} from './sharedDrinkLayout'
import type {WorldLayoutInteriorPlacement} from '../../worldLayout'

/** Small, purposeful details attach to the real edited table, not fixed world
 * coordinates. Animated cups belong to the performance, so none are duplicated here. */
export function LivingRoomAccents({placements}:{placements?:readonly WorldLayoutInteriorPlacement[]}){
 const layout=resolveSharedDrinkLayout(placements)
 const hasTable=!placements||placements.some(item=>item.id==='living-coffee-table'&&/table_low\.gltf$/.test(item.asset))
 if(!hasTable)return null
 return <group name="living-room-used-not-cluttered">
  {layout.cupRest.map((position,index)=><mesh key={index} name={`drink-coaster-${index}`} position={[position[0],position[1]+.002,position[2]]} receiveShadow>
   <cylinderGeometry args={[.078,.078,.004,20]}/><meshStandardMaterial color={index?'#bfa487':'#709186'} roughness={.97}/>
  </mesh>)}
  <group name="shared-reading-on-the-table" position={[layout.table.position[0],layout.table.topY+.007,layout.table.position[2]]} rotation-y={layout.table.rotation+.06}>
   <mesh position-y={.017} castShadow receiveShadow><boxGeometry args={[.36,.034,.24]}/><meshStandardMaterial color="#73978e" roughness={.96}/></mesh>
   <mesh position={[.014,.035,.002]}><boxGeometry args={[.335,.014,.215]}/><meshStandardMaterial color="#f6e8ce" roughness={1}/></mesh>
   <mesh position={[.015,.046,.004]} rotation-y={-.12} castShadow><boxGeometry args={[.3,.012,.21]}/><meshStandardMaterial color="#cf977b" roughness={.95}/></mesh>
   <mesh position={[.06,.054,.075]} rotation-y={-.12}><boxGeometry args={[.036,.002,.07]}/><meshStandardMaterial color="#f4d895" roughness={.96}/></mesh>
  </group>
 </group>
}
