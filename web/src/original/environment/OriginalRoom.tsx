import {OriginalFlowerPot} from './OriginalProps'
import {Arch, SoftBox} from './primitives'
import type {OriginalQuality, OriginalTheme, OriginalTimeOfDay} from './layout'
import {ORIGINAL_THEME} from './layout'

/** A cutaway introduction room. The usable carpet is centred at [0,0,1]. */
export function OriginalRoom({quality='high',timeOfDay='day',theme=ORIGINAL_THEME}:{quality?:OriginalQuality;timeOfDay?:OriginalTimeOfDay;theme?:OriginalTheme}) {
  const night=timeOfDay==='night'
  return <group name="original-introduction-room" userData={{assetFamily:'lingolife-original-v1',groundY:0,seatHeight:.88}}>
    <SoftBox size={[10.8,.65,9.0]} position={[0,-.34,0]} color="#d2b68d" radius={.24} quality={quality}/>
    {Array.from({length:11},(_,i)=><SoftBox key={i} size={[.93,.05,8.68]} position={[(i-5)*.966,-.004,0]} color={i%3?'#d6bb95':'#d0b08a'} radius={.02} quality={quality}/>)}
    <SoftBox size={[10.8,5.9,.3]} position={[0,2.91,-4.36]} color={theme.wall} radius={.14} quality={quality}/>
    <SoftBox size={[.3,5.9,8.5]} position={[-5.26,2.91,-.25]} color="#e5d5b9" radius={.14} quality={quality}/>
    <SoftBox size={[10.4,.22,.18]} position={[0,.18,-4.14]} color="#fbedd4" radius={.04} quality={quality}/>
    <SoftBox size={[.18,.22,8.2]} position={[-5.06,.18,-.15]} color="#fbedd4" radius={.04} quality={quality}/>
    <group position={[-2.66,1.76,-4.15]}>
      <Arch width={2.48} height={3.15} depth={.16} color="#f7edda" quality={quality}/>
      <Arch width={2.18} height={2.93} depth={.075} color={night?'#65879b':'#bad4c5'} position={[0,.11,.11]} glow={night?.03:.25} quality={quality}/>
      <SoftBox size={[.095,2.94,.12]} position={[0,1.58,.18]} color={theme.accent} radius={.03} quality={quality}/>
      <SoftBox size={[2.20,.095,.12]} position={[0,1.34,.18]} color={theme.accent} radius={.03} quality={quality}/>
      <SoftBox size={[2.78,.19,.45]} position={[0,.035,.08]} color="#f9ebcd" radius={.065} quality={quality}/>
    </group>
    <SoftBox name="original-room-rug" size={[5.5,.055,4.4]} position={[.2,.044,.57]} color="#a6b5a0" radius={.024} quality={quality}/>
    <SoftBox size={[5.11,.012,4.01]} position={[.2,.078,.57]} color="#c6cbb0" radius={.005} quality={quality}/>
    <group position={[1.80,0,-2.82]} name="original-room-sofa">
      {[-1.33,1.33].flatMap(x=>[-.46,.46].map(z=><SoftBox key={`${x}:${z}`} size={[.14,.33,.14]} position={[x,.18,z]} color="#a5835c" radius={.045} quality={quality}/>))}
      <SoftBox size={[3.35,.65,1.44]} position={[0,.62,0]} color={theme.accent} radius={.22} quality={quality}/>
      <SoftBox size={[3.35,1.43,.4]} position={[0,1.15,-.56]} color={theme.accent} radius={.18} quality={quality}/>
      {[-.77,.77].map(x=><SoftBox key={x} size={[1.40,.26,1.13]} position={[x,.83,.06]} color="#9eaf94" radius={.11} quality={quality}/>)}
      {[-1.63,1.63].map(x=><SoftBox key={x} size={[.35,.83,1.54]} position={[x,1.0,0]} color={theme.accent} radius={.17} quality={quality}/>)}
      <SoftBox size={[.62,.62,.18]} position={[-1.07,1.3,-.26]} rotation={[.06,0,.17]} color="#e1b28e" radius={.085} quality={quality}/>
    </group>
    <group position={[-4.1,0,-2.72]}><OriginalFlowerPot quality={quality} large color="#d1ab83" flower="#e6c58d"/></group>
    <group position={[4.30,0,-2.84]}>
      <SoftBox size={[.45,.10,.45]} position={[0,.05,0]} color="#a58c66" radius={.045} quality={quality}/>
      <SoftBox size={[.07,2.77,.07]} position={[0,1.43,0]} color="#a58c66" radius={.03} quality={quality}/>
      <mesh position={[0,2.83,0]} castShadow><cylinderGeometry args={[.36,.57,.65,quality==='high'?32:16]}/><meshStandardMaterial color="#f3e1b9" emissive="#ffce91" emissiveIntensity={night?.5:.08} roughness={.86}/></mesh>
      {night&&quality==='high'&&<pointLight position={[0,2.51,.1]} color="#ffd09a" intensity={8} distance={8}/>}
    </group>
    <group position={[1.51,3.65,-4.12]}>
      <SoftBox size={[1.43,1.63,.12]} color="#b38e63" radius={.05} quality={quality}/>
      <SoftBox size={[1.22,1.42,.055]} position={[0,0,.085]} color="#ecdec0" radius={.02} quality={quality}/>
      <mesh position={[0,-.05,.128]}><circleGeometry args={[.36,24]}/><meshStandardMaterial color="#acb391" roughness={1}/></mesh>
      <mesh position={[.2,.30,.131]}><circleGeometry args={[.16,20]}/><meshStandardMaterial color="#d5ad71" roughness={1}/></mesh>
    </group>
  </group>
}
