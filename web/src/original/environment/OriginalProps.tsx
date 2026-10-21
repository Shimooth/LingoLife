import {Orb, SoftBox, Stem} from './primitives'
import type {OriginalQuality, OriginalTimeOfDay} from './layout'

export function OriginalTree({quality='high',variation=0}:{quality?:OriginalQuality;variation?:number}) {
  const height=variation===1?4.9:5.8
  return <group name="original-sculpted-tree">
    <Stem start={[0,0,0]} end={[.06,height*.72,0]} width={.19} color="#9a7955" quality={quality}/>
    <Stem start={[.035,height*.41,0]} end={[-.62,height*.72,.08]} width={.105} color="#9a7955" quality={quality}/>
    <Stem start={[.03,height*.48,0]} end={[.65,height*.82,-.11]} width={.11} color="#9a7955" quality={quality}/>
    <Orb position={[0,height*.78,0]} scale={[1.29,1.6,1.25]} color="#8ca879" quality={quality}/>
    <Orb position={[-.78,height*.69,.16]} scale={[.93,1.03,.99]} color="#9db688" quality={quality}/>
    <Orb position={[.65,height*.76,.31]} scale={[.96,1.27,.99]} color="#779d77" quality={quality}/>
    {quality==='high'&&<Orb position={[-.10,height*.94,-.14]} scale={[.86,.93,.89]} color="#a4bb8b" quality={quality}/>}
    <Orb position={[-.13,.12,.04]} scale={[.53,.20,.45]} color="#799361" quality={quality}/>
    {quality==='high'&&[[-.72,.08,.51],[.69,.08,-.23]].map(([x,y,z],i)=><Orb key={i} position={[x,y,z]} scale={[.20,.11,.16]} color="#d5cbb4" quality={quality}/>)}
  </group>
}

export function OriginalFlowerPot({quality='high',color='#c68061',flower='#e9b89a',large=false}:{quality?:OriginalQuality;color?:string;flower?:string;large?:boolean}) {
  const s=large?1.4:1
  return <group name="original-flower-pot" scale={s}>
    <mesh position-y={.31} castShadow receiveShadow><cylinderGeometry args={[.43,.31,.6,quality==='high'?24:12]}/><meshStandardMaterial color={color} roughness={.85}/></mesh>
    <mesh position-y={.60} rotation-x={Math.PI/2} castShadow><torusGeometry args={[.42,.065,8,quality==='high'?24:12]}/><meshStandardMaterial color={color} roughness={.8}/></mesh>
    <mesh position-y={.58}><cylinderGeometry args={[.37,.37,.06,16]}/><meshStandardMaterial color="#786850" roughness={1}/></mesh>
    {[[-.23,.71,.08],[.19,.74,.13],[0,.77,-.16]].map(([x,y,z],i)=><group key={i}>
      <Orb position={[x,y,z]} scale={[.26,.20,.24]} color={i===1?'#6d936e':'#94aa79'} quality={quality}/>
      <Stem start={[x,y,z]} end={[x,y+.27,z]} width={.018} color="#6c9469" quality={quality}/>
      <group position={[x,y+.31,z]}>
        {quality==='high'?[0,1,2,3,4].map(petal=><Orb key={petal} position={[Math.cos(petal*Math.PI*.4)*.086,0,Math.sin(petal*Math.PI*.4)*.086]} scale={[.083,.037,.072]} color={flower} quality={quality}/>):<Orb position={[0,0,0]} scale={[.15,.04,.15]} color={flower} quality={quality}/>}
        <Orb position={[0,.021,0]} scale={[.046,.039,.046]} color="#e8bd60" quality={quality}/>
      </group>
    </group>)}
  </group>
}

export function OriginalBench({quality='high',color='#718874'}:{quality?:OriginalQuality;color?:string}) {
  return <group name="original-bench" userData={{seatHeight:.87,seatWidth:2.8}}>
    {[-1,1].map(side=><group key={side}>
      <SoftBox size={[.15,.77,.14]} position={[side*1.11,.43,-.32]} rotation={[.08,0,0]} color={color} radius={.055} quality={quality}/>
      <SoftBox size={[.15,.78,.14]} position={[side*1.11,.43,.34]} rotation={[-.12,0,0]} color={color} radius={.055} quality={quality}/>
      <SoftBox size={[.14,1.30,.14]} position={[side*1.11,1.08,-.37]} rotation={[-.09,0,0]} color={color} radius={.045} quality={quality}/>
      <SoftBox size={[.19,.10,.82]} position={[side*1.28,1.25,-.015]} color={color} radius={.042} quality={quality}/>
      <SoftBox size={[.11,.39,.11]} position={[side*1.28,1.035,.30]} color={color} radius={.04} quality={quality}/>
    </group>)}
    {[-.3,0,.3].map(z=><SoftBox key={z} size={[2.82,.115,.26]} position={[0,.83,z]} color="#c59f70" radius={.044} quality={quality}/>)}
    {[1.14,1.44].map(y=><SoftBox key={y} size={[2.81,.23,.10]} position={[0,y,-.41]} rotation={[-.10,0,0]} color="#c59f70" radius={.055} quality={quality}/>)}
  </group>
}

export function OriginalStreetLamp({quality='high',timeOfDay='day'}:{quality?:OriginalQuality;timeOfDay?:OriginalTimeOfDay}) {
  const lit=timeOfDay!=='day'
  return <group name="original-street-lamp">
    <mesh position-y={.10} castShadow><cylinderGeometry args={[.28,.33,.2,16]}/><meshStandardMaterial color="#697c6b" roughness={.7}/></mesh>
    <Stem start={[0,.1,0]} end={[0,3.71,0]} width={.073} color="#617866" quality={quality}/>
    <mesh position-y={3.64} castShadow><cylinderGeometry args={[.30,.22,.12,16]}/><meshStandardMaterial color="#5e7562" roughness={.63}/></mesh>
    <mesh position-y={3.95} castShadow><sphereGeometry args={[.35,quality==='high'?20:12,quality==='high'?16:8]}/><meshStandardMaterial color={lit?'#ffe7b7':'#f2e8ca'} roughness={.27} emissive="#ffca79" emissiveIntensity={lit?2:0}/></mesh>
    <mesh position-y={4.20} castShadow><coneGeometry args={[.43,.19,quality==='high'?24:12]}/><meshStandardMaterial color="#627b65" roughness={.65}/></mesh>
    {lit&&quality==='high'&&<pointLight position={[0,3.78,0]} color="#ffc98b" intensity={8} distance={7} decay={2}/>}
  </group>
}

export function OriginalCafeTable({quality='high'}:{quality?:OriginalQuality}) {
  return <group name="original-cafe-table">
    <mesh position-y={1.22} castShadow receiveShadow><cylinderGeometry args={[.73,.73,.12,quality==='high'?32:16]}/><meshStandardMaterial color="#e2c693" roughness={.6}/></mesh>
    <Stem start={[0,.1,0]} end={[0,1.20,0]} width={.085} color="#6e826d" quality={quality}/>
    {[-1,1].map(side=><SoftBox key={side} size={[.08,.08,1.08]} position={[0,.08,0]} rotation={[0,side*Math.PI/4,0]} color="#6e826d" radius={.035} quality={quality}/>)}
    <mesh position={[.12,1.36,0]}><cylinderGeometry args={[.13,.10,.21,16]}/><meshStandardMaterial color="#ede3c9" roughness={.44}/></mesh>
    <mesh position={[.245,1.38,0]} rotation-x={Math.PI/2}><torusGeometry args={[.055,.018,6,12]}/><meshStandardMaterial color="#ede3c9" roughness={.44}/></mesh>
    <mesh position={[.12,1.471,0]} rotation-x={-Math.PI/2}><circleGeometry args={[.105,16]}/><meshStandardMaterial color="#715a42" roughness={.34}/></mesh>
    {[-1,1].map(side=><group key={side} position={[side*1.27,0,0]} rotation-y={side*Math.PI/2}>
      <SoftBox size={[.85,.13,.77]} position={[0,.845,0]} color="#748c75" radius={.105} quality={quality}/>
      <SoftBox size={[.86,.62,.13]} position={[0,1.20,-.32]} rotation={[-.1,0,0]} color="#748c75" radius={.12} quality={quality}/>
      {[-1,1].flatMap(x=>[-1,1].map(z=><Stem key={`${x}:${z}`} start={[x*.33,.06,z*.28]} end={[x*.27,.82,z*.23]} width={.045} color="#ad8b61" quality={quality}/>))}
    </group>)}
  </group>
}
