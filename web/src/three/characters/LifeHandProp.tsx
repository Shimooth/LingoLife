import {createPortal} from '@react-three/fiber'
import type {Group} from 'three'
import type {CharacterFamily} from './characterAssets'

/** Small code-native props: actual children of the wrist, never floating near the avatar. */
export function LifeHandProp({model,family,kind}:{model:Group;family:CharacterFamily;kind:'cup'|'spoon'|'utensil'|'book'|'cloth'}){
 const hand=model.getObjectByName(family==='city'?'HandR':'DEF-handR')
 if(!hand)return null
 const scale=family==='city'?.8:1.2
 return createPortal(<group name={`life-prop:${kind}`} position={[0,.09,0]} rotation={[Math.PI/2,0,0]} scale={scale}>
  {kind==='cup'?<group><mesh castShadow><cylinderGeometry args={[.07,.055,.13,14,1,true]}/><meshStandardMaterial color="#dfaa6c" side={2}/></mesh><mesh position={[0,.045,0]}><cylinderGeometry args={[.06,.06,.005,14]}/><meshStandardMaterial color="#6a4633"/></mesh><mesh position={[.072,0,0]}><torusGeometry args={[.037,.012,6,12]}/><meshStandardMaterial color="#dfaa6c"/></mesh></group>
   :kind==='book'?<group><mesh><boxGeometry args={[.2,.025,.15]}/><meshStandardMaterial color="#739d8b"/></mesh><mesh position={[0,.018,0]}><boxGeometry args={[.18,.014,.135]}/><meshStandardMaterial color="#fff5de"/></mesh></group>
   :kind==='cloth'?<mesh><boxGeometry args={[.16,.018,.13]}/><meshStandardMaterial color="#e8c19d" roughness={1}/></mesh>
   :<group><mesh><cylinderGeometry args={[.009,.009,.17,6]}/><meshStandardMaterial color={kind==='utensil'?'#a2764d':'#b7bfc1'} metalness={.2}/></mesh><mesh position={[0,.1,0]} scale={[1,.5,1.3]}><sphereGeometry args={[kind==='utensil'?.035:.025,8,6]}/><meshStandardMaterial color={kind==='utensil'?'#a2764d':'#b7bfc1'}/></mesh></group>}
 </group>,hand)
}
