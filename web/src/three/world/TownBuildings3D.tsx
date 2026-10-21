import {useEffect,useMemo} from 'react'
import {RoundedBox} from '@react-three/drei'
import {ExtrudeGeometry,Shape} from 'three'
import {TOWN_BUILDING_DIMENSIONS,type TownBuildingKind} from './townScale'

type Point=[number,number,number]
const PALETTE={cream:'#eee4ce',trim:'#faf1dd',wood:'#bd9570',sage:'#879c82',darkSage:'#5e796e',glass:'#668486',stone:'#c9c6b0',terracotta:'#c18c71'}

function Block({size,position=[0,0,0],rotation=[0,0,0],color=PALETTE.cream,radius=.025,name}:{size:Point;position?:Point;rotation?:Point;color?:string;radius?:number;name?:string}){
 return <RoundedBox name={name} args={size} radius={Math.min(radius,...size.map(value=>value*.48))} smoothness={2} position={position} rotation={rotation} castShadow receiveShadow><meshStandardMaterial color={color} roughness={.86} metalness={0}/></RoundedBox>
}

function FrontWall({kind,color}:{kind:TownBuildingKind;color:string}){
 const d=TOWN_BUILDING_DIMENSIONS[kind]
 const geometry=useMemo(()=>{
  const w=d.width/2,h=d.wallHeight,r=.035,door=d.doorWidth/2,s=new Shape()
  // One continuous U-shaped facade avoids seams between separate wall boxes.
  s.moveTo(-w+r,0);s.lineTo(-door,0);s.lineTo(-door,d.doorHeight);s.lineTo(door,d.doorHeight);s.lineTo(door,0);s.lineTo(w-r,0)
  s.quadraticCurveTo(w,0,w,r);s.lineTo(w,h-r);s.quadraticCurveTo(w,h,w-r,h);s.lineTo(-w+r,h);s.quadraticCurveTo(-w,h,-w,h-r);s.lineTo(-w,r);s.quadraticCurveTo(-w,0,-w+r,0)
  return new ExtrudeGeometry(s,{depth:.13,steps:1,bevelEnabled:false,curveSegments:4})
 },[d])
 useEffect(()=>()=>geometry.dispose(),[geometry])
 return <mesh name="town-front-shell" geometry={geometry} position-z={d.depth/2-.065} castShadow receiveShadow><meshStandardMaterial color={color} roughness={.86}/></mesh>
}

function Window({position,width=.44,height=.43,rotation=0,shutters=false}:{position:Point;width?:number;height?:number;rotation?:number;shutters?:boolean}){
 return <group position={position} rotation-y={rotation}>
  <Block size={[width+.09,height+.09,.067]} color={PALETTE.trim} radius={.037}/>
  <Block size={[width,height,.012]} position={[0,0,.038]} color={PALETTE.glass} radius={.018}/>
  <Block size={[.021,height,.024]} position={[0,0,.05]} color={PALETTE.trim} radius={.008}/>
  <Block size={[width,.019,.024]} position={[0,0,.05]} color={PALETTE.trim} radius={.008}/>
  <Block size={[width+.13,.045,.105]} position={[0,-height/2-.057,.025]} color={PALETTE.wood} radius={.017}/>
  {shutters&&[-1,1].map(side=><Block key={side} size={[.10,height+.045,.03]} position={[side*(width/2+.105),0,-.005]} color={PALETTE.sage} radius={.015}/>)}
 </group>
}

function GableRoof({width,depth,baseY,color}:{width:number;depth:number;baseY:number;color:string}){
 const rise=.35,half=width/2,angle=Math.atan2(rise,half),length=Math.hypot(half,rise)+.1
 const geometry=useMemo(()=>{
  const shape=new Shape();shape.moveTo(-width/2,0);shape.lineTo(width/2,0);shape.lineTo(0,rise);shape.closePath()
  return new ExtrudeGeometry(shape,{depth:depth-.1,steps:1,bevelEnabled:true,bevelSegments:2,bevelSize:.025,bevelThickness:.025,curveSegments:3})
 },[width,depth])
 useEffect(()=>()=>geometry.dispose(),[geometry])
 return <group position-y={baseY}>
  <mesh geometry={geometry} position={[0,0,-(depth-.1)/2]} castShadow receiveShadow><meshStandardMaterial color={PALETTE.cream} roughness={.86}/></mesh>
  {[-1,1].map(side=><Block key={side} name="town-roof-slope" size={[length,.115,depth+.18]} position={[side*half/2,rise/2+.05,0]} rotation={[0,0,-side*angle]} color={color} radius={.052}/>)}
  <Block size={[.105,.105,depth+.19]} position={[0,rise+.052,0]} color={color} radius={.05}/>
 </group>
}

function Door({kind}:{kind:TownBuildingKind}){
 const d=TOWN_BUILDING_DIMENSIONS[kind],front=d.depth/2
 return <group name="town-door-opening" userData={{clearWidth:d.doorWidth,clearHeight:d.doorHeight}}>
  {/* The dark foyer and inset glazing sit behind the opening, making its
      thickness and threshold legible from the map's oblique camera. */}
  <Block size={[d.doorWidth-.028,d.doorHeight-.028,.025]} position={[0,d.doorHeight/2,front-.18]} color={kind==='home'?PALETTE.wood:PALETTE.darkSage} radius={.025}/>
  <Block size={[d.doorWidth-.13,d.doorHeight*.5,.015]} position={[0,d.doorHeight*.64,front-.157]} color={kind==='home'?'#91a299':PALETTE.glass} radius={.025}/>
  {[-1,1].map(side=><Block key={side} size={[.064,d.doorHeight+.06,.075]} position={[side*(d.doorWidth/2+.032),(d.doorHeight+.06)/2,front+.035]} color={PALETTE.trim} radius={.022}/>)}
  <Block size={[d.doorWidth+.128,.065,.075]} position={[0,d.doorHeight+.0325,front+.035]} color={PALETTE.trim} radius={.022}/>
  <mesh position={[d.doorWidth*.29,d.doorHeight*.46,front-.127]}><sphereGeometry args={[.019,8,6]}/><meshStandardMaterial color="#d8b56f" roughness={.48}/></mesh>
  <Block size={[d.doorWidth+.16,.042,.3]} position={[0,.012,front+.11]} color={PALETTE.stone} radius={.02}/>
 </group>
}

function Planter({position,color=PALETTE.terracotta}:{position:Point;color?:string}){
 return <group position={position}>
  <mesh position-y={.07} castShadow receiveShadow><cylinderGeometry args={[.088,.071,.14,10]}/><meshStandardMaterial color={color} roughness={.9}/></mesh>
  <mesh position={[0,.16,0]} scale={[1,.85,1]} castShadow><icosahedronGeometry args={[.12,1]}/><meshStandardMaterial color={PALETTE.sage} roughness={.95}/></mesh>
 </group>
}

function CafeCupSign({position}:{position:Point}){
 return <group position={position}>
  <Block size={[.28,.22,.024]} color={PALETTE.wood} radius={.032}/>
  <mesh position={[-.025,.005,.04]} castShadow><cylinderGeometry args={[.052,.043,.08,14]}/><meshStandardMaterial color={PALETTE.trim} roughness={.8}/></mesh>
  <mesh position={[.035,.005,.045]}><torusGeometry args={[.029,.009,6,12]}/><meshStandardMaterial color={PALETTE.trim} roughness={.8}/></mesh>
 </group>
}

export type TownBuilding3DProps={kind:TownBuildingKind;id?:string;position?:Point;rotation?:number;scale?:number;quality?:'high'|'low'}

/** Original, code-native toy-town buildings. Facing +Z and grounded at local
 * y=0; the full roof/step footprint stays within a 2.6-unit city parcel. */
export function TownBuilding3D({kind,id=kind,position=[0,0,0],rotation=0,scale=1,quality='high'}:TownBuilding3DProps){
 const d=TOWN_BUILDING_DIMENSIONS[kind],isHome=kind==='home',front=d.depth/2
 const wallColor=kind==='community'?'#e2e5cd':PALETTE.cream,roofColor=kind==='cafe'?PALETTE.terracotta:PALETTE.sage
 return <group name={`town-building:${id}`} position={position} rotation-y={rotation} scale={scale} userData={{townBuilding:kind,doorHeight:d.doorHeight,doorWidth:d.doorWidth}}>
  <Block size={[d.width+.12,.065,d.depth+.14]} position={[0,-.003,0]} color={PALETTE.stone} radius={.032}/>
  <Block size={[d.width,.07,d.depth]} position={[0,.009,0]} color="#ded4bd" radius={.025}/>
  <Block size={[d.width,d.wallHeight,.13]} position={[0,d.wallHeight/2,-d.depth/2]} color={wallColor} radius={.055}/>
  {[-1,1].map(side=><Block key={side} size={[.13,d.wallHeight,d.depth]} position={[side*(d.width/2-.065),d.wallHeight/2,0]} color={wallColor} radius={.04}/>)}
  <FrontWall kind={kind} color={wallColor}/>
  <Door kind={kind}/>
  {isHome?<>
   <Block size={[d.width+.08,.065,d.depth+.1]} position={[0,.985,0]} color={PALETTE.trim} radius={.026}/>
   <GableRoof width={d.width+.11} depth={d.depth} baseY={d.wallHeight-.015} color={roofColor}/>
   {[-.52,.52].map(x=><Window key={x} position={[x,1.36,front+.073]} width={.34} height={.37} shutters={quality==='high'}/>)}
   <Window position={[-.56,.51,front+.073]} width={.3} height={.32}/>
   <Window position={[d.width/2+.006,.52,-.18]} width={.42} height={.36} rotation={Math.PI/2}/>
   <Block size={[.2,.44,.24]} position={[-.62,d.wallHeight+.20,-.30]} color={PALETTE.cream} radius={.032}/>
   <Block size={[.25,.065,.28]} position={[-.62,d.wallHeight+.425,-.30]} color={PALETTE.trim} radius={.026}/>
   {quality==='high'&&<Planter position={[.58,0,front+.12]}/>}
  </>:<>
   {[-.63,.63].map(x=><Window key={x} position={[x,.48,front+.073]} width={.41} height={.53}/>)}
   {kind==='cafe'?<>
    <GableRoof width={d.width+.10} depth={d.depth} baseY={d.wallHeight-.03} color={roofColor}/>
    <Block size={[1.9,.075,.41]} position={[0,1.015,front+.17]} rotation={[-.12,0,0]} color={PALETTE.sage} radius={.035}/>
    {quality==='high'&&[-.8,-.4,0,.4,.8].map(x=><Block key={x} size={[.17,.027,.41]} position={[x,1.057,front+.17]} rotation={[-.12,0,0]} color={PALETTE.trim} radius={.01}/>)}
    <CafeCupSign position={[.64,1.235,front+.125]}/>
   </>:<>
    <Block size={[d.width+.13,.16,d.depth+.17]} position={[0,1.12,0]} color={PALETTE.sage} radius={.064}/>
    <Block size={[1.83,.21,.16]} position={[0,1.23,front+.045]} color={PALETTE.wood} radius={.045}/>
    <Block size={[.56,.10,.018]} position={[0,1.24,front+.134]} color={PALETTE.trim} radius={.027}/>
    <mesh position={[0,1.242,front+.151]} rotation-z={Math.PI/4}><boxGeometry args={[.044,.044,.009]}/><meshStandardMaterial color={PALETTE.sage} roughness={.9}/></mesh>
    <Block size={[d.width-.13,.095,d.depth-.12]} position={[0,1.24,0]} color={PALETTE.sage} radius={.047}/>
   </>}
   {quality==='high'&&<Planter position={[-.97,0,front+.13]} color={PALETTE.wood}/>}
  </>}
 </group>
}
