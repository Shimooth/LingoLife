import {useOwnedGeometry} from './useOwnedGeometry'
import {useMemo} from 'react'
import type {OriginalAppearance,OriginalQuality} from '../spec'
import {createLock,createScalp,type HeadDimensions,shade} from './geometry'
import {Orb} from './parts'

function Lock({points,width,thickness,color,detail}:{points:[number,number,number][];width:number;thickness:number;color:string;detail:number}){
 const geometry=useMemo(()=>createLock(points,width,thickness,detail),[points,width,thickness,detail])
 useOwnedGeometry(geometry)
 return <mesh geometry={geometry} castShadow receiveShadow><meshStandardMaterial color={color} roughness={.59}/></mesh>
}
export function OriginalHair({appearance:a,dimensions:d,quality}:{appearance:OriginalAppearance;dimensions:HeadDimensions;quality:OriginalQuality}){
 const cap=useMemo(()=>createScalp(d,a.hair,quality==='high'?24:14),[d,a.hair,quality])
 useOwnedGeometry(cap)
 const strands=useMemo(()=>{
  const locks:{points:[number,number,number][];width:number;thickness:number;color:string}[]=[]
  if(a.hair==='sweep'||a.hair==='crop'||a.hair==='bun'){
   const count=a.hair==='crop'?5:6
   for(let i=0;i<count;i++){
    const offset=(i-(count-1)/2)*.051,short=a.hair==='crop'?.065:0
    locks.push({points:[[.24+offset,.38,.205],[.08+offset,.43,.32],[-.12+offset,.32+short,.395],[-.31+offset*.35,.105+short+i*.021,.31]],width:.072,thickness:.04,color:shade(a.hairColor,i%3*.032)})
   }
   for(const side of [-1,1])locks.push({points:[[side*.39,.22,.03],[side*.446,.07,.045],[side*.421,-.06,.083]],width:.055,thickness:.043,color:a.hairColor})
  }
  if(a.hair==='bob'){
   for(let i=0;i<7;i++){const x=(i-3)*.098;locks.push({points:[[x*.78,.37,.25],[x,.285,.367-Math.abs(x)*.1],[x*1.08,.135+Math.abs(x)*.15,.378-Math.abs(x)*.19]],width:.066,thickness:.035,color:shade(a.hairColor,i%3*.025)})}
   for(const side of [-1,1])for(let i=0;i<3;i++)locks.push({points:[[side*(.365+i*.025),.19,.18-i*.085],[side*(.45+i*.018),-.1,.17-i*.085],[side*(.394+i*.038),-.49,.105-i*.085]],width:.085,thickness:.075,color:shade(a.hairColor,i*.028)})
  }
  return locks
 },[a.hair,a.hairColor])
 const scale:[number,number,number]=[d.width/.45,d.height/.45,1]
 return <group name={`orig-hair-${a.hair}`}>
  <mesh geometry={cap} castShadow receiveShadow><meshStandardMaterial color={a.hairColor} roughness={.63}/></mesh>
  <group scale={scale}>{strands.map((strand,i)=><Lock key={`${a.hair}-${i}`} {...strand} detail={quality==='high'?18:10}/>)}
   {a.hair==='curl'&&Array.from({length:19},(_,i)=>{const angle=i*2.39996,r=Math.sqrt(i/19)*.42,x=Math.cos(angle)*r,z=Math.sin(angle)*r,y=.23+Math.sqrt(Math.max(0,.22-r*r))*.6;return <Orb key={i} name="orig-hair-curl" position={[x,y,z]} scale={[.125+(i%3)*.012,.12,.125]} color={shade(a.hairColor,(i%4)*.025)}/>})}
   {a.hair==='curl'&&[-1,1].map(side=><Orb key={side} position={[side*.43,.13,.015]} scale={[.08,.13,.11]} color={a.hairColor}/>)}
   {a.hair==='bun'&&<group position={[0,.37,-.24]} rotation-x={-.2}><Orb color={a.hairColor} scale={[.245,.215,.215]}/>{Array.from({length:7},(_,i)=><Orb key={i} color={shade(a.hairColor,i%2*.045)} rotation-z={i*Math.PI/7} position={[Math.sin(i*.9)*.07,Math.cos(i*.9)*.04,.025]} scale={[.072,.198,.19]}/>)}<mesh position={[0,-.16,.018]} rotation-x={Math.PI/2}><torusGeometry args={[.145,.015,8,30]}/><meshStandardMaterial color={shade(a.topColor,-.15)} roughness={.7}/></mesh></group>}
  </group>
 </group>
}
