import {Environment,Instance,Instances,Lightformer} from '@react-three/drei'
import {useFrame,useThree} from '@react-three/fiber'
import {useEffect,useMemo,useRef} from 'react'
import * as THREE from 'three'
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js'
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js'
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js'
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js'
import {SMAAPass} from 'three/addons/postprocessing/SMAAPass.js'
import {WORLD_DEPTH,WORLD_WIDTH,type TimeSlot} from './worldData'

type Quality='low'|'high'

type WorldEffectsProps={
 timeSlot:TimeSlot
 quality:Quality
 reducedMotion:boolean
 postProcessing:boolean
}

type Palette={
 zenith:string
 horizon:string
 lowerSky:string
 sun:string
 sunFill:string
 groundBounce:string
 cloudLight:string
 cloudShade:string
 exposure:number
}

const PALETTES:Record<TimeSlot,Palette>={
 morning:{zenith:'#388bb8',horizon:'#e3b892',lowerSky:'#64a8c8',sun:'#ffe1ad',sunFill:'#8bc2de',groundBounce:'#6b6363',cloudLight:'#fff7e9',cloudShade:'#9ebdca',exposure:1.02},
 afternoon:{zenith:'#337fac',horizon:'#78b3ce',lowerSky:'#5598bc',sun:'#fff0cd',sunFill:'#7bb4d4',groundBounce:'#586365',cloudLight:'#fff8e9',cloudShade:'#9abcca',exposure:1.04},
 evening:{zenith:'#233653',horizon:'#bd7f74',lowerSky:'#536a83',sun:'#ffc58f',sunFill:'#7890c2',groundBounce:'#343b49',cloudLight:'#ddd9de',cloudShade:'#78899c',exposure:.94},
}

function RendererTuning({palette,quality}:{palette:Palette;quality:Quality}){
 const {gl}=useThree()
 useEffect(()=>{
  const previousToneMapping=gl.toneMapping
  const previousExposure=gl.toneMappingExposure
  const previousShadowType=gl.shadowMap.type
  const previousShadowEnabled=gl.shadowMap.enabled
  gl.outputColorSpace=THREE.SRGBColorSpace
  gl.toneMapping=THREE.ACESFilmicToneMapping
  gl.toneMappingExposure=palette.exposure
  gl.shadowMap.enabled=quality==='high'
  gl.shadowMap.type=THREE.PCFSoftShadowMap
  gl.shadowMap.autoUpdate=true
  return ()=>{
   gl.toneMapping=previousToneMapping
   gl.toneMappingExposure=previousExposure
   gl.shadowMap.type=previousShadowType
   gl.shadowMap.enabled=previousShadowEnabled
  }
 },[gl,palette.exposure,quality])
 return null
}

function SkyBackdrop({palette}:{palette:Palette}){
 const {scene}=useThree()
 const texture=useMemo(()=>{
  const width=2,height=256
  const data=new Uint8Array(width*height*4)
  const lower=new THREE.Color(palette.lowerSky)
  const horizon=new THREE.Color(palette.horizon)
  const zenith=new THREE.Color(palette.zenith)
  const color=new THREE.Color()
  const encoded=new THREE.Color()
  for(let row=0;row<height;row+=1){
   const progress=row/(height-1)
   if(progress<.48)color.copy(lower).lerp(horizon,THREE.MathUtils.smoothstep(progress,0,.48))
   else color.copy(horizon).lerp(zenith,THREE.MathUtils.smoothstep(progress,.48,1))
   encoded.copy(color).convertLinearToSRGB()
   for(let column=0;column<width;column+=1){
    const offset=(row*width+column)*4
    data[offset]=Math.round(encoded.r*255)
    data[offset+1]=Math.round(encoded.g*255)
    data[offset+2]=Math.round(encoded.b*255)
    data[offset+3]=255
   }
  }
  const result=new THREE.DataTexture(data,width,height,THREE.RGBAFormat)
  result.colorSpace=THREE.SRGBColorSpace
  result.magFilter=THREE.LinearFilter
  result.minFilter=THREE.LinearFilter
  result.needsUpdate=true
  return result
 },[palette])
 useEffect(()=>{
  const previous=scene.background
  scene.background=texture
  return ()=>{if(scene.background===texture)scene.background=previous;texture.dispose()}
 },[scene,texture])
 return null
}

type CloudPuff={position:[number,number,number];scale:[number,number,number];rotation:number}

function createCloudPuffs(clusterCount:number):CloudPuff[]{
 const localOffsets:readonly [number,number,number][]= [
  [0,0,1],[-1.65,-.08,.78],[1.7,.05,.72],[-.72,.52,.58],[.82,-.48,.62],
 ]
 return Array.from({length:clusterCount},(_,cluster)=>{
  const angle=(cluster/clusterCount)*Math.PI*2+(cluster%2)*.08
  const wave=Math.sin(cluster*12.9898)*.5+.5
  const baseX=Math.cos(angle)*(WORLD_WIDTH*.5+8+wave*5.8)
  const baseZ=Math.sin(angle)*(WORLD_DEPTH*.5+6+(1-wave)*4.6)
  const tangentX=-Math.sin(angle)
  const tangentZ=Math.cos(angle)
  const radialX=Math.cos(angle)
  const radialZ=Math.sin(angle)
  return localOffsets.map(([along,outward,size],part)=>({
   position:[
    baseX+tangentX*along+radialX*outward,
    -2.65+(part%3)*.24+(cluster%2)*.09,
    baseZ+tangentZ*along+radialZ*outward,
   ] as [number,number,number],
   scale:[(2.45+(part%3)*.34)*size,(.92+(part%2)*.16)*size,(1.75+((part+cluster)%3)*.28)*size] as [number,number,number],
   rotation:angle+part*.17,
  }))
 }).flat()
}

function CloudRim({palette,quality,reducedMotion}:{palette:Palette;quality:Quality;reducedMotion:boolean}){
 const group=useRef<THREE.Group>(null)
 const puffs=useMemo(()=>createCloudPuffs(quality==='high'?11:8),[quality])
 useFrame(({clock})=>{
  if(reducedMotion||!group.current)return
  group.current.position.y=Math.sin(clock.elapsedTime*.18)*.16
 })
 return <group ref={group} renderOrder={-20}>
  <Instances limit={puffs.length} frustumCulled>
   <sphereGeometry args={[1,quality==='high'?16:10,quality==='high'?10:7]}/>
   <meshStandardMaterial color={palette.cloudLight} roughness={1} depthWrite/>
   {puffs.map((puff,index)=><Instance key={index} position={puff.position} scale={puff.scale} rotation={[0,puff.rotation,0]}/>) }
  </Instances>
 </group>
}

function StudioEnvironment({palette,quality}:{palette:Palette;quality:Quality}){
 return <Environment resolution={quality==='high'?192:64} frames={1} environmentIntensity={quality==='high'?.62:.42}>
  <color attach="background" args={[palette.horizon]}/>
  <Lightformer form="rect" intensity={4.2} color={palette.sun} position={[-8,10,-6]} rotation-x={Math.PI/2} scale={[10,10,1]}/>
  <Lightformer form="rect" intensity={2.2} color={palette.sunFill} position={[10,4,5]} rotation-y={-Math.PI/2} scale={[8,5,1]}/>
  <Lightformer form="ring" intensity={1.4} color={palette.horizon} position={[0,1,-8]} scale={12}/>
 </Environment>
}

function WorldLighting({palette,quality}:{palette:Palette;quality:Quality}){
 const shadowWidth=Math.max(36,WORLD_WIDTH*.68)
 const shadowDepth=Math.max(28,WORLD_DEPTH*.82)
 return <>
  <ambientLight intensity={.12} color={palette.horizon}/>
  <hemisphereLight args={[palette.sunFill,palette.groundBounce,.56]}/>
  <directionalLight
   castShadow={quality==='high'}
   position={[-34,46,-28]}
   intensity={2.05}
   color={palette.sun}
   shadow-mapSize={[quality==='high'?2048:768,quality==='high'?2048:768]}
   shadow-bias={-.00018}
   shadow-normalBias={.035}
   shadow-radius={quality==='high'?3.2:1.4}
   shadow-camera-near={8}
   shadow-camera-far={95}
   shadow-camera-left={-shadowWidth}
   shadow-camera-right={shadowWidth}
   shadow-camera-top={shadowDepth}
   shadow-camera-bottom={-shadowDepth}
  />
  <directionalLight position={[22,18,30]} intensity={.24} color={palette.sunFill}/>
 </>
}

/**
 * A deliberately conservative post chain: AO and SMAA only. There is no
 * fullscreen bloom, fog or translucent colour wash, so a failed/slow effect
 * cannot turn the world into the opaque white veil seen in the old prototype.
 */
function WorldPostProcessing(){
 const {gl,scene,camera,size}=useThree()
 const chain=useMemo(()=>{
  const composer=new EffectComposer(gl)
  const renderPass=new RenderPass(scene,camera)
  const gtaoPass=new GTAOPass(scene,camera,1,1)
  gtaoPass.updateGtaoMaterial({
   radius:.42,
   distanceExponent:1.2,
   thickness:1.25,
   distanceFallOff:1,
   scale:1,
   samples:12,
   screenSpaceRadius:false,
  })
  gtaoPass.updatePdMaterial({
   lumaPhi:10,
   depthPhi:2,
   normalPhi:3,
   radius:6,
   radiusExponent:2,
   rings:2,
   samples:12,
  })
  gtaoPass.blendIntensity=.46
  const smaaPass=new SMAAPass()
  const outputPass=new OutputPass()
  composer.addPass(renderPass)
  composer.addPass(gtaoPass)
  composer.addPass(smaaPass)
  composer.addPass(outputPass)
  return {composer,gtaoPass,smaaPass,outputPass}
 },[camera,gl,scene])
 useEffect(()=>{
  chain.composer.setPixelRatio(Math.min(1.35,gl.getPixelRatio()))
  chain.composer.setSize(size.width,size.height)
 },[chain,gl,size.height,size.width])
 useEffect(()=>()=>{
  chain.gtaoPass.dispose()
  chain.smaaPass.dispose()
  chain.outputPass.dispose()
  chain.composer.dispose()
 },[chain])
 useFrame((_,delta)=>chain.composer.render(delta),1)
 return null
}

export function WorldEffects({timeSlot,quality,reducedMotion,postProcessing}:WorldEffectsProps){
 const palette=PALETTES[timeSlot]
 const {gl}=useThree()
 return <>
  <RendererTuning palette={palette} quality={quality}/>
  <SkyBackdrop palette={palette}/>
  <CloudRim palette={palette} quality={quality} reducedMotion={reducedMotion}/>
  <StudioEnvironment palette={palette} quality={quality}/>
  <WorldLighting palette={palette} quality={quality}/>
  {postProcessing&&gl.capabilities.isWebGL2&&<WorldPostProcessing/>}
 </>
}

export default WorldEffects
