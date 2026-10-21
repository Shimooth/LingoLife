import {useOwnedGeometry} from './useOwnedGeometry'
import {useMemo} from 'react'
import type {OriginalAppearance,OriginalQuality} from '../spec'
import {createTailoredSurface,type OriginalBodyDimensions,shade} from './geometry'
import {Button,Orb,Seam} from './parts'

export function OriginalTorso({appearance:a,body:b,quality}:{appearance:OriginalAppearance;body:OriginalBodyDimensions;quality:OriginalQuality}){
 const coat=a.outfit==='jacket',overalls=a.outfit==='overalls',w=b.width
 const shell=useMemo(()=>createTailoredSurface([[0,0,0],[.01,w*.69,.162],[.04,w*.96,.187],[.11,w,.202],[.30,w*.98,.201],[.48,w*.95,.177],[.61,b.shoulderX*.87,.143],[.66,.138,.117],[.68,.121,.109],[.68,0,0]],quality==='high'?48:28),[w,b.shoulderX,quality])
 useOwnedGeometry(shell)
 const cloth=coat?shade(a.topColor,-.08):a.topColor
 return <group name={`orig-outfit-${a.outfit}`} position={[0,b.hip-.035,0]}>
  <mesh geometry={shell} castShadow receiveShadow><meshStandardMaterial color={cloth} roughness={a.outfit==='knit'?.94:.83}/></mesh>
  <Orb name="orig-neck" color={a.skin} position={[0,.71,0]} scale={[.105,.15,.095]}/>
  <mesh name="orig-collar" position={[0,.669,0]} rotation-x={Math.PI/2} scale={[1,1,.82]}><torusGeometry args={[.132,coat?.019:.026,10,40]}/><meshStandardMaterial color={shade(a.topColor,-.09)} roughness={.94}/></mesh>
  {a.outfit==='knit'&&<>
   {Array.from({length:quality==='high'?35:19},(_,i)=>{const count=quality==='high'?35:19,x=(i/(count-1)*2-1)*w*.93;const z=.192*Math.sqrt(Math.max(.05,1-(x/w)**2));return <Seam key={i} color={shade(a.topColor,-.09)} radius={.003} points={[[x,.035,z],[x,.097,z+.008]]}/>})}
   {Array.from({length:quality==='high'?15:7},(_,i)=>{const count=quality==='high'?15:7,x=(i/(count-1)*2-1)*w*.78,z=.216*Math.sqrt(1-(x/(w*1.04))**2);return <Seam key={i} radius={.0016} color={shade(a.topColor,.16)} points={[[x,.14,z],[x+.003,.23,z+.002],[x,.32,z],[x+.003,.42,z-.007]]}/>})}
   <group name="orig-knit-label" position={[w*.63,.10,.16]}><Orb color={shade(a.topColor,-.21)} scale={[.023,.033,.006]}/><Seam color={shade(a.topColor,.4)} radius={.002} points={[[-.01,.01,.008],[.01,.01,.008]]}/></group>
  </>}
  {coat&&<>
   <Orb color="#eee4cb" position={[0,.37,.174]} scale={[.102,.267,.04]}/>
   <Seam color={shade(a.topColor,-.25)} radius={.009} points={[[-.075,.65,.12],[-.13,.52,.184],[-.093,.04,.2]]}/>
   <Seam color={shade(a.topColor,-.25)} radius={.009} points={[[.075,.65,.12],[.13,.52,.184],[.093,.04,.2]]}/>
   {[-1,1].map(side=><group key={side}>
    <Orb color={shade(a.topColor,.11)} position={[side*.116,.564,.17]} rotation-z={side*.37} scale={[.052,.085,.022]}/>
    <Seam color={shade(a.topColor,-.25)} radius={.006} points={[[side*.165,.27,.19],[side*.27,.28,.151]]}/>
    <Seam color={shade(a.topColor,.14)} radius={.003} points={[[side*.168,.258,.195],[side*.27,.268,.156]]}/>
   </group>)}
   {[.16,.31,.47].map(y=><Button key={y} position={[.079,y,.215]} color="#b49e7b" scale={.014}/>)}
  </>}
  {overalls&&<>
   <Orb color={a.bottomColor} position={[0,.145,.018]} scale={[w*1.016,.20,.206]}/>
   <Orb color={a.bottomColor} position={[0,.33,.18]} scale={[.215,.213,.031]}/>
   <Seam color={shade(a.bottomColor,.35)} radius={.003} points={[[-.137,.355,.208],[-.132,.247,.218],[0,.231,.222],[.132,.247,.218],[.137,.355,.208]]}/>
   {[-1,1].map(side=><group key={side}>
    <Seam color={a.bottomColor} radius={.032} points={[[side*.13,.41,.193],[side*.145,.56,.153],[side*.15,.646,.063],[side*.15,.615,-.126],[side*.15,.40,-.202]]}/>
    <Seam color={shade(a.bottomColor,.34)} radius={.0025} points={[[side*.148,.425,.217],[side*.163,.55,.171],[side*.16,.628,.082]]}/>
    <Button position={[side*.135,.422,.222]} color="#cca75d"/>
   </group>)}
  </>}
 </group>
}
export function OriginalHand({skin,side}:{skin:string;side:number}){
 return <group name={`orig-hand-${side===-1?'right':'left'}`}>
  <Orb color={skin} scale={[.079,.106,.046]}/>
  {[0,1,2,3].map(i=><Orb key={i} color={skin} position={[(i-1.5)*.031,-.073+(i===0||i===3?.009:0),.007]} scale={[.019,.047-(i===3?.009:0),.026]}/>)}
  <Orb color={skin} position={[-side*.071,-.013,.02]} rotation-z={side*-.49} scale={[.031,.06,.034]}/>
 </group>
}
export function OriginalShoe({appearance:a}:{appearance:OriginalAppearance}){
 return <group name="orig-shoe" position={[0,.082,.035]}>
  <Orb color={shade(a.shoeColor,-.04)} position={[0,-.038,.035]} scale={[.134,.04,.209]}/>
  <Orb color={a.shoeColor} position={[0,.014,.039]} scale={[.126,.081,.195]}/>
  <Orb color={shade(a.shoeColor,-.1)} position={[0,.04,-.054]} scale={[.094,.08,.092]}/>
  <Seam color={shade(a.shoeColor,-.2)} radius={.004} points={[[-.111,-.008,.139],[0,-.015,.228],[.111,-.008,.139]]}/>
  {[.025,.065,.104].map(z=><Seam key={z} color="#fff5df" radius={.004} points={[[-.06,.079,z],[0,.083,z+.003],[.06,.079,z]]}/>)}
 </group>
}
