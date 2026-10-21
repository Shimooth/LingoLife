import {useEffect, useLayoutEffect, useMemo, useRef} from 'react'
import {Color, ExtrudeGeometry, InstancedMesh, Object3D, Shape} from 'three'
import {RoundedBoxGeometry} from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import {Arch, Orb, SoftBox, Stem} from './primitives'
import type {OriginalQuality, OriginalTheme, OriginalTimeOfDay} from './layout'

/** Each shingle is a genuine exportable mesh instance. No image maps or fonts. */
function TiledRoof({width,depth,rise,color,quality}:{width:number;depth:number;rise:number;color:string;quality:OriginalQuality}) {
  const angle=Math.atan2(rise,width/2), slope=Math.hypot(width/2,rise)
  const rows=quality==='high'?6:4, columns=quality==='high'?Math.ceil(depth/.43):Math.ceil(depth/.72)
  const instance=useRef<InstancedMesh>(null)
  const geometry=useMemo(()=>new RoundedBoxGeometry(slope/rows+.035,.115,depth/columns-.014,quality==='high'?2:1,.048),[slope,rows,depth,columns,quality])
  useEffect(()=>()=>geometry.dispose(),[geometry])
  useLayoutEffect(()=>{
    const target=instance.current;if(!target)return
    const dummy=new Object3D(), tint=new Color();let index=0
    for(const side of [-1,1])for(let row=0;row<rows;row++)for(let col=0;col<columns;col++) {
      const fraction=(row+.5)/rows
      dummy.position.set(side*width/2*(1-fraction),rise*fraction+.085,-depth/2+(col+.5)*depth/columns)
      dummy.rotation.set(0,0,-side*angle)
      dummy.updateMatrix();target.setMatrixAt(index,dummy.matrix)
      tint.set(color).multiplyScalar(1+((row*7+col*3)%5-2)*.024)
      target.setColorAt(index,tint);index++
    }
    target.instanceMatrix.needsUpdate=true
    if(target.instanceColor)target.instanceColor.needsUpdate=true
    target.computeBoundingSphere()
  },[width,depth,rise,color,columns,rows,angle])
  return <group name="original-terracotta-tile-roof">
    {[-1,1].map(side=><SoftBox key={side} size={[slope+.17,.24,depth+.14]} position={[side*width/4,rise/2-.08,0]} rotation={[0,0,-side*angle]} color={color} radius={.095} quality={quality}/>)}
    <instancedMesh ref={instance} args={[geometry,undefined,rows*columns*2]} castShadow receiveShadow><meshStandardMaterial color="white" roughness={.82}/></instancedMesh>
    <mesh position={[0,rise+.095,0]} rotation-x={Math.PI/2} castShadow><cylinderGeometry args={[.15,.15,depth+.2,quality==='high'?16:8]}/><meshStandardMaterial color={color} roughness={.77}/></mesh>
  </group>
}

function Gable({width,depth,rise,color,quality}:{width:number;depth:number;rise:number;color:string;quality:OriginalQuality}) {
  const geometry=useMemo(()=>{
    const shape=new Shape();shape.moveTo(-width/2,0);shape.lineTo(width/2,0);shape.lineTo(0,rise);shape.closePath()
    const result=new ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelSize:.05,bevelThickness:.05,bevelSegments:quality==='high'?2:1})
    result.translate(0,0,-depth/2);return result
  },[width,depth,rise,quality])
  useEffect(()=>()=>geometry.dispose(),[geometry])
  return <mesh geometry={geometry} castShadow receiveShadow><meshStandardMaterial color={color} roughness={.87}/></mesh>
}

function Window({position,width=1.25,height=1.8,accent,quality,night,arch=false,shutters=false}:{position:[number,number,number];width?:number;height?:number;accent:string;quality:OriginalQuality;night:boolean;arch?:boolean;shutters?:boolean}) {
  const glass=night?'#efd09b':'#83aaa3'
  return <group position={position} name="original-framed-window">
    {arch?<><Arch width={width+.22} height={height+.12} depth={.16} color="#f9edd7" quality={quality}/><Arch width={width-.08} height={height-.07} depth={.08} color={glass} position={[0,.04,.105]} glow={night?.8:.03} quality={quality}/></>:<>
      <SoftBox size={[width+.22,height+.22,.16]} position={[0,height/2,0]} color="#f9edd7" radius={.13} quality={quality}/>
      <SoftBox size={[width-.06,height-.06,.08]} position={[0,height/2,.105]} color={glass} emissive={glass} glow={night?.8:.03} radius={.055} roughness={.28} quality={quality}/>
    </>}
    <SoftBox size={[.075,height-.08,.12]} position={[0,height/2,.185]} color={accent} radius={.024} quality={quality}/>
    <SoftBox size={[width-.06,.075,.12]} position={[0,height*.49,.185]} color={accent} radius={.022} quality={quality}/>
    <SoftBox size={[width+.39,.17,.38]} position={[0,-.055,.10]} color="#eadbc0" radius={.065} quality={quality}/>
    {shutters&&[-1,1].map(side=><group key={side} position={[side*(width*.5+.38),height/2,.065]} rotation-y={side*.14}>
      <SoftBox size={[.43,height,.13]} color={accent} radius={.07} quality={quality}/>
      {quality==='high'&&[-.45,-.15,.15,.45].map(y=><SoftBox key={y} size={[.29,.065,.025]} position={[0,y,.082]} color="#82917b" radius={.018} quality={quality}/>)}
    </group>)}
  </group>
}

function Door({accent,quality,night}:{accent:string;quality:OriginalQuality;night:boolean}) {
  return <group name="original-door-3.5m">
    <Arch width={1.91} height={3.74} depth={.2} color="#f6e6ca" quality={quality}/>
    <Arch width={1.61} height={3.53} depth={.12} color={accent} position={[0,.025,.15]} quality={quality}/>
    <Arch width={1.24} height={1.68} depth={.045} color={night?'#efd09b':'#8eafa6'} position={[0,1.47,.23]} quality={quality} glow={night?.7:0}/>
    <SoftBox size={[.07,1.52,.06]} position={[0,2.25,.272]} color="#e7d9b8" radius={.024} quality={quality}/>
    <SoftBox size={[1.21,.07,.06]} position={[0,2.22,.272]} color="#e7d9b8" radius={.024} quality={quality}/>
    <SoftBox size={[1.17,.86,.07]} position={[0,.69,.23]} color={accent} radius={.10} quality={quality}/>
    <mesh position={[.56,1.29,.32]} castShadow><sphereGeometry args={[.085,12,8]}/><meshStandardMaterial color="#d0ac63" roughness={.25} metalness={.7}/></mesh>
    <SoftBox size={[2.13,.15,.62]} position={[0,.02,.11]} color="#e9d9ba" radius={.075} quality={quality}/>
  </group>
}

function ShopEmblem({type,accent,quality}:{type:'cafe'|'wardrobe';accent:string;quality:OriginalQuality}) {
  return <group>
    <SoftBox size={[1.35,1.07,.19]} color={accent} radius={.18} quality={quality}/>
    {type==='cafe'?<group position={[0,-.08,.13]}>
      <mesh><cylinderGeometry args={[.25,.19,.35,16]}/><meshStandardMaterial color="#f5e9cf" roughness={.56}/></mesh>
      <mesh position={[.26,.025,0]} rotation-x={Math.PI/2}><torusGeometry args={[.115,.038,8,16]}/><meshStandardMaterial color="#f5e9cf" roughness={.56}/></mesh>
      <SoftBox size={[.62,.055,.21]} position={[0,-.21,0]} color="#f5e9cf" radius={.025} quality={quality}/>
      <Stem start={[-.075,.25,0]} end={[-.02,.37,0]} width={.018} color="#f5e9cf" quality={quality}/>
    </group>:<group position={[0,0,.15]}>
      <SoftBox size={[.40,.47,.095]} position={[0,-.045,0]} color="#f5e9cf" radius={.045} quality={quality}/>
      {[-1,1].map(side=><SoftBox key={side} size={[.21,.32,.095]} position={[side*.245,.05,0]} rotation={[0,0,side*.5]} color="#f5e9cf" radius={.04} quality={quality}/>)}
      <mesh position={[0,.21,.054]}><circleGeometry args={[.075,16]}/><meshStandardMaterial color={accent}/></mesh>
    </group>}
  </group>
}

export function OriginalBuilding({kind,theme,quality,timeOfDay}:{kind:'home'|'cafe'|'wardrobe';theme:OriginalTheme;quality:OriginalQuality;timeOfDay:OriginalTimeOfDay}) {
  const home=kind==='home', cafe=kind==='cafe', night=timeOfDay!=='day'
  const width=home?5.5:cafe?5.8:5.3, depth=home?5.4:cafe?5.3:3.3, height=home?6.15:cafe?4.65:4.8
  const face=depth/2+.09, accent=kind==='wardrobe'?'#788695':theme.accent
  return <group name={`original-building-${kind}`} userData={{assetFamily:'lingolife-original-v1',doorHeight:3.5,kind}}>
    <SoftBox size={[width+.23,.26,depth+.23]} position={[0,.05,0]} color="#cbbb9f" radius={.18} quality={quality}/>
    <SoftBox size={[width,height,depth]} position={[0,height/2+.12,0]} color={theme.wall} radius={.23} quality={quality}/>
    <SoftBox size={[width+.08,.40,depth+.09]} position={[0,.27,0]} color="#e0c8a2" radius={.08} quality={quality}/>
    <SoftBox size={[width+.25,.22,depth+.20]} position={[0,height+.03,0]} color="#f7e9d0" radius={.08} quality={quality}/>
    <group position={[0,height+.17,0]}><Gable width={width} depth={depth} rise={home?1.96:1.50} color={theme.wall} quality={quality}/></group>
    <group position={[0,height+.22,0]}><TiledRoof width={width+.95} depth={depth+.83} rise={home?2.25:1.8} color={theme.roof} quality={quality}/></group>
    <group position={[0,.14,face]}><Door accent={accent} quality={quality} night={night}/></group>
    {home?<>
      {[-1.55,1.55].map(x=><Window key={x} position={[x,4.19,face]} width={1.03} height={1.41} accent={accent} quality={quality} night={night} shutters/>)}
      {[-1.73,1.73].map(x=><Window key={x} position={[x,1.23,face]} width={.80} height={1.36} accent={accent} quality={quality} night={night} arch/>)}
      <SoftBox size={[width+.11,.17,.25]} position={[0,3.99,face-.01]} color="#e9d6b6" radius={.05} quality={quality}/>
      <group position={[0,height+1.05,depth/2+.19]}><Window position={[0,0,0]} width={.83} height={.9} accent={accent} quality={quality} night={night} arch/></group>
    </>:<>
      {[-1.9,1.9].map(x=><Window key={x} position={[x,.95,face]} width={1.26} height={2.06} accent={accent} quality={quality} night={night} arch/>)}
      <group position={[0,4.26,face+.1]}><ShopEmblem type={kind} accent={accent} quality={quality}/></group>
      {cafe&&<group position={[0,3.79,face+.70]} rotation-x={-.14}>
        <SoftBox size={[5.85,.17,1.31]} color="#dfc58f" radius={.08} quality={quality}/>
        {[-2.5,-1.67,-.84,0,.84,1.67,2.5].map(x=><SoftBox key={x} size={[.41,.025,1.28]} position={[x,.102,0]} color="#f5ead3" radius={.01} quality={quality}/>)}
        <SoftBox size={[5.82,.32,.15]} position={[0,-.10,.60]} color="#e7d29c" radius={.065} quality={quality}/>
      </group>}
    </>}
    {[-1,1].map(side=><group key={side} position={[side*(width/2+.085),1.60,-.48]} rotation-y={side*Math.PI/2}>
      <Window position={[0,0,0]} width={1.36} height={1.76} accent={accent} quality={quality} night={night} shutters={home}/>
    </group>)}
    <SoftBox size={[.76,1.73,.81]} position={[-width*.29,height+1.33,-.6]} color={theme.wall} radius={.10} quality={quality}/>
    <SoftBox size={[.94,.22,.97]} position={[-width*.29,height+2.18,-.6]} color="#cfbea1" radius={.075} quality={quality}/>
    {/* Door lanterns are luminous ceramic, rather than additional shadow lights. */}
    <group position={[1.09,2.76,face+.17]}>
      <SoftBox size={[.12,.58,.12]} color={accent} radius={.035} quality={quality}/>
      <Orb position={[0,-.05,.17]} scale={[.15,.21,.15]} color={night?'#ffe7b6':'#e9debb'} quality={quality}/>
      {night&&<mesh position={[0,-.05,.17]}><sphereGeometry args={[.151,12,8]}/><meshStandardMaterial color="#ffe7b6" emissive="#ffc277" emissiveIntensity={1.8} roughness={.5}/></mesh>}
    </group>
  </group>
}
