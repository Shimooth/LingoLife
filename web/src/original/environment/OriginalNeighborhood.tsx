import {useEffect, useLayoutEffect, useMemo, useRef} from 'react'
import {Color, InstancedMesh, Object3D} from 'three'
import {RoundedBoxGeometry} from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type {ThreeEvent} from '@react-three/fiber'
import {OriginalBuilding} from './OriginalBuildings'
import {OriginalFountain} from './OriginalFountain'
import {OriginalBench, OriginalCafeTable, OriginalFlowerPot, OriginalStreetLamp, OriginalTree} from './OriginalProps'
import {SoftBox} from './primitives'
import {ORIGINAL_NEIGHBORHOOD_LAYOUT, ORIGINAL_THEME, type OriginalQuality, type OriginalTheme, type OriginalTimeOfDay} from './layout'

export {ORIGINAL_NEIGHBORHOOD_LAYOUT, ORIGINAL_THEME, ORIGINAL_LIGHTING_RECIPES} from './layout'
export type {OriginalTimeOfDay, OriginalQuality, OriginalTheme} from './layout'

function PlazaTiles({quality}:{quality:OriginalQuality}) {
  const ref=useRef<InstancedMesh>(null), columns=12, rows=14
  const geometry=useMemo(()=>new RoundedBoxGeometry(1.06,.035,1.09,quality==='high'?2:1,.018),[quality])
  useEffect(()=>()=>geometry.dispose(),[geometry])
  useLayoutEffect(()=>{
    const target=ref.current;if(!target)return
    const dummy=new Object3D(),color=new Color();let i=0
    for(let row=0;row<rows;row++)for(let col=0;col<columns;col++) {
      dummy.position.set((col-(columns-1)/2)*1.085+(row%2)*.065,-.013,(row-(rows-1)/2)*1.115+1.0)
      dummy.updateMatrix();target.setMatrixAt(i,dummy.matrix)
      color.set(['#e4d6ba','#e8dbbf','#e3d5b9','#e7d9bc','#e1d2b7'][(row*7+col*11)%5])
      target.setColorAt(i,color);i++
    }
    target.instanceMatrix.needsUpdate=true;if(target.instanceColor)target.instanceColor.needsUpdate=true
    target.computeBoundingSphere()
  },[])
  return <instancedMesh name="original-plaza-pavers" ref={ref} args={[geometry,undefined,columns*rows]} receiveShadow><meshStandardMaterial roughness={.88} color="white"/></instancedMesh>
}

export type OriginalNeighborhoodProps = {
  timeOfDay?:OriginalTimeOfDay
  quality?:OriginalQuality
  paused?:boolean
  theme?:OriginalTheme
  onSelectBuilding?:(id:'home'|'cafe'|'wardrobe')=>void
  onSelectFountain?:()=>void
}

/** One metric scale and one material palette. All constituent geometry can
 * be exported through GLTFExporter; no downloaded models or external maps. */
export function OriginalNeighborhood({timeOfDay='day',quality='high',paused=false,theme=ORIGINAL_THEME,onSelectBuilding,onSelectFountain}:OriginalNeighborhoodProps) {
  const handleBuilding=(event:ThreeEvent<MouseEvent>,id:'home'|'cafe'|'wardrobe')=>{
    if(!onSelectBuilding)return
    event.stopPropagation();onSelectBuilding(id)
  }
  return <group name="original-lingolife-neighborhood" userData={{assetFamily:'lingolife-original-v1',units:'metres',source:'procedural-authored',layout:ORIGINAL_NEIGHBORHOOD_LAYOUT}}>
    <SoftBox name="original-diorama-ground" size={[28.2,1.15,23.1]} position={[0,-.675,-.8]} color="#91a57b" radius={.50} quality={quality}/>
    <SoftBox size={[27.96,.35,22.86]} position={[0,-1.10,-.8]} color="#ceb990" radius={.16} quality={quality}/>
    <SoftBox size={[13.55,.13,16.5]} position={[0,-.07,1.0]} color="#d3c3a4" radius={.06} quality={quality}/>
    <SoftBox size={[24.3,.12,3.50]} position={[0,-.07,.80]} color="#e4d5b8" radius={.055} quality={quality}/>
    <PlazaTiles quality={quality}/>
    <mesh position={[0,.016,-3.25]} rotation-x={-Math.PI/2} receiveShadow><ringGeometry args={[2.05,2.24,quality==='high'?64:32]}/><meshStandardMaterial color="#b2b797" roughness={.84}/></mesh>
    <mesh position={[0,.016,-3.25]} rotation-x={-Math.PI/2} receiveShadow><ringGeometry args={[2.28,2.34,quality==='high'?64:32]}/><meshStandardMaterial color="#f4e9ce" roughness={.84}/></mesh>
    <group position={[0,0,-3.25]} onClick={onSelectFountain?(e)=>{e.stopPropagation();onSelectFountain()}:undefined}><OriginalFountain quality={quality} timeOfDay={timeOfDay} paused={paused}/></group>
    {ORIGINAL_NEIGHBORHOOD_LAYOUT.buildings.map(building=><group key={building.id} position={[...building.position]} rotation-y={building.rotation} onClick={e=>handleBuilding(e,building.id)}><OriginalBuilding kind={building.id} theme={theme} quality={quality} timeOfDay={timeOfDay}/></group>)}
    {[[-11.8,-5.7],[-10.55,5.8],[11.65,-6.2],[10.9,5.8],[-5.3,-10.35],[5.05,-10.1]].map(([x,z],i)=><group key={i} position={[x,0,z]} rotation-y={i*.83}><OriginalTree quality={quality} variation={i%2}/></group>)}
    <group position={[-4.4,0,1.16]} rotation-y={.15}><OriginalBench quality={quality} color={theme.accent}/></group>
    <group position={[4.7,0,-.05]} rotation-y={-.3}><OriginalBench quality={quality} color={theme.accent}/></group>
    <group position={[8.13,0,2.70]} rotation-y={-.3}><OriginalCafeTable quality={quality}/></group>
    {[[-5.7,2.10],[5.97,1.20],[-9.72,-.04],[9.75,-.3],[-2.38,-6.30],[1.79,-6.30]].map(([x,z],i)=><group key={i} position={[x,0,z]}><OriginalFlowerPot quality={quality} color={i<2?'#decfae':'#c68a70'} flower={i%2?'#eaca84':'#e4afa0'} large={i<2}/></group>)}
    {[[-6.15,4.55],[6.15,4.55],[-3.4,-4.8],[3.45,-4.8]].map(([x,z],i)=><group key={i} position={[x,0,z]}><OriginalStreetLamp quality={quality} timeOfDay={timeOfDay}/></group>)}
    <group position={[0,0,-11.08]}>
      {[-11,-9,-7,-5,-3,-1,1,3,5,7,9,11].map(x=><SoftBox key={x} size={[.14,1.02,.15]} position={[x,.51,0]} color="#eaddbd" radius={.065} quality={quality}/>)}
      {[.38,.79].map(y=><SoftBox key={y} size={[23,.115,.13]} position={[0,y,0]} color="#eaddbd" radius={.055} quality={quality}/>)}
    </group>
    {quality==='high'&&[[-7.65,5.65],[-7.15,6.25],[7.4,6.55],[8.05,6.7],[-11.2,1.9],[11.8,2.7]].map(([x,z],i)=><group key={i} position={[x,0,z]} rotation-y={i*.63}>{[0,1,2].map(blade=><SoftBox key={blade} size={[.06,.24+blade*.09,.10]} position={[(blade-1)*.105,.10+blade*.045,0]} rotation={[0,0,(blade-1)*.3]} color="#719167" radius={.026} quality={quality}/>)}</group>)}
  </group>
}
