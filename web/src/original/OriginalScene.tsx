import {Canvas,useFrame,useThree} from '@react-three/fiber'
import {OrbitControls,RoundedBox,Environment,Lightformer} from '@react-three/drei'
import {useEffect,useMemo,useRef,useState,type MutableRefObject} from 'react'
import {ACESFilmicToneMapping,Vector3,PCFSoftShadowMap,SRGBColorSpace,Group} from 'three'
import type {OrbitControls as OrbitControlsType} from 'three-stdlib'
import {OriginalResident} from './character/OriginalResident'
import {bodyDimensions,mix} from './character/geometry'
import {OriginalNeighborhood} from './environment/OriginalNeighborhood'
import {ORIGINAL_PRESETS,type OriginalAppearance,type OriginalMotion,type OriginalEmotion,type OriginalQuality,type OriginalTimeOfDay} from './spec'
import {originalStoryBeat,ORIGINAL_STORY_DURATION} from './story'
import {exportOriginalPack} from './exportScene'
export type OriginalView='create'|'town'|'story'
export type OriginalFrame='full'|'face'
export type OriginalSceneProps={view:OriginalView;frame:OriginalFrame;appearance:OriginalAppearance;friend:OriginalAppearance;quality:OriginalQuality;timeOfDay:OriginalTimeOfDay;theme:{wall:string;roof:string;accent:string};motion:OriginalMotion;emotion:OriginalEmotion;playing:boolean;playhead:MutableRefObject<number>;onTime:(time:number)=>void;onFinish:()=>void;resetCamera:number;onReady:()=>void}
function StudioSet(){return <group name="atelier-studio-set">
 <mesh rotation-x={-Math.PI/2} position-y={-.08} receiveShadow><planeGeometry args={[200,200]}/><meshStandardMaterial color="#e8ddc7" roughness={1}/></mesh>
 <mesh position-y={-.035} receiveShadow><cylinderGeometry args={[2.25,2.32,.12,80]}/><meshStandardMaterial color="#f8efdd" roughness={.79}/></mesh>
 <mesh position-y={-.09}><cylinderGeometry args={[2.32,2.25,.13,80]}/><meshStandardMaterial color="#cbb995" roughness={.75}/></mesh>
 <RoundedBox position={[-2.6,.14,-1.6]} args={[.75,.3,.75]} radius={.11} rotation-y={.2} castShadow receiveShadow><meshStandardMaterial color="#bb7e62"/></RoundedBox>
 <group position={[-2.6,.32,-1.6]}>{[-1,0,1].map((i)=><mesh key={i} position={[i*.12,.35+Math.abs(i)*.05,0]} rotation-z={i*.6} scale={[.2,.58,.12]} castShadow><sphereGeometry args={[1,18,12]}/><meshStandardMaterial color={i?'#81947b':'#567361'} roughness={.67}/></mesh>)}</group>
 </group>}
function CameraDirector({view,frame,resetCamera,controls,headY}:{view:OriginalView;frame:OriginalFrame;resetCamera:number;controls:MutableRefObject<OrbitControlsType|null>;headY:number}){
 const {camera,size,invalidate}=useThree(),request=useRef({active:true,position:new Vector3(),target:new Vector3()})
 useEffect(()=>{const portrait=view==='create',face=portrait&&frame==='face',mobile=size.width<600,aspect=size.width/Math.max(1,size.height)
  const offset=portrait?(face?new Vector3(.14,headY+.1,3.5):new Vector3(4.4,3.1,7.5)):view==='story'?new Vector3(7.8,5.1,13.5):new Vector3(18,14.5,22)
  const target=portrait?new Vector3(0,face?headY:1.38,0):view==='story'?new Vector3(0,mobile?.8:1.3,2.3):new Vector3(0,1.6,-1.5)
  if(mobile&&!face)offset.sub(target).multiplyScalar(Math.max(1,1/(aspect*1.35))).add(target)
  request.current={active:true,position:offset,target};invalidate()
 },[camera,frame,headY,invalidate,resetCamera,size.height,size.width,view])
 useEffect(()=>{const current=controls.current;if(!current)return;const cancel=()=>{request.current.active=false};current.addEventListener('start',cancel);return()=>current.removeEventListener('start',cancel)},[controls])
 useFrame((_,dt)=>{if(!request.current.active)return;const target=request.current,ease=1-Math.exp(-Math.min(dt,.05)*7);camera.position.lerp(target.position,ease);controls.current?.target.lerp(target.target,ease);controls.current?.update();if(camera.position.distanceTo(target.position)<.008)request.current.active=false})
 return null
}
function SceneContents(props:OriginalSceneProps){
 const {view,frame,appearance,friend,quality,timeOfDay,theme,motion,emotion,playing,playhead,onTime,onFinish,resetCamera,onReady}=props
 const controls=useRef<OrbitControlsType>(null),poseTime=useRef(0),lastReport=useRef(0),ready=useRef(false)
 const playerRoot=useRef<Group>(null),friendRoot=useRef<Group>(null)
 const {scene,gl,camera}=useThree(),[reportedTime,setReportedTime]=useState(playhead.current),[pageVisible,setPageVisible]=useState(()=>!document.hidden)
 const beat=originalStoryBeat(reportedTime),story=view==='story',night=view!=='create'&&timeOfDay==='night',sunset=view!=='create'&&timeOfDay==='sunset'
 const beatTime=useMemo(()=>({get current(){return Math.max(0,playhead.current-beat.start)}}),[beat.start,playhead])
 useEffect(()=>{poseTime.current=0},[motion])
 useEffect(()=>{const changed=()=>setPageVisible(!document.hidden);document.addEventListener('visibilitychange',changed);return()=>document.removeEventListener('visibilitychange',changed)},[])
 useEffect(()=>{if(!import.meta.env.DEV)return;const target=window as unknown as Record<string,unknown>;target.originalAtelierScene=scene;target.originalAtelierExport=()=>exportOriginalPack(scene,ORIGINAL_PRESETS);target.originalAtelierInspect=()=>({meshes:gl.info.render.calls,triangles:gl.info.render.triangles,memory:{...gl.info.memory}});return()=>{delete target.originalAtelierScene;delete target.originalAtelierExport;delete target.originalAtelierInspect}},[gl,scene])
 useEffect(()=>{const target=window as unknown as Record<string,unknown>;target.originalAtelierPhoto=()=>{gl.render(scene,camera);return gl.domElement.toDataURL('image/png')};return()=>{delete target.originalAtelierPhoto}},[camera,gl,scene])
 useFrame((_,dt)=>{
  if(!ready.current){ready.current=true;onReady()}
  if(!pageVisible)return
  poseTime.current+=Math.min(dt,.05)
  if(story&&playing){playhead.current=Math.min(ORIGINAL_STORY_DURATION,playhead.current+Math.min(dt,.05));if(playhead.current>=ORIGINAL_STORY_DURATION)onFinish()}
  const t=story?playhead.current:0,walk=Math.max(0,Math.min(1,(t-10)/5)),distance=walk*1.6
  const turn=t>=10&&t<15?Math.sin(Math.PI*walk)**.25:0
  if(playerRoot.current){playerRoot.current.position.set(-1.55,0,3.4-distance);playerRoot.current.rotation.y=story?.55+(Math.PI-.55)*turn:.12}
  if(friendRoot.current){friendRoot.current.position.set(1.55,0,3.2-distance);friendRoot.current.rotation.y=story?-.55-(Math.PI-.55)*turn:-.2}
  if(Math.abs(playhead.current-reportedTime)>.07||performance.now()-lastReport.current>150){lastReport.current=performance.now();setReportedTime(playhead.current);onTime(playhead.current)}
 })
 return <>
  <color attach="background" args={[night?'#223a3e':sunset?'#dec3a1':'#e8ddc7']}/>
  <fog attach="fog" args={[night?'#223a3e':sunset?'#dec3a1':'#e8ddc7',45,110]}/>
  <ambientLight intensity={night?.55:.7} color={night?'#b3ccdf':'#fff4df'}/>
  <hemisphereLight args={[night?'#abc6e0':'#fff8e9',night?'#37443d':'#b8b59d',night?.6:1.2]}/>
  <directionalLight name="atelier-key" position={[-9,14,10]} intensity={night?.9:sunset?3.1:2.8} color={night?'#b7c8ec':sunset?'#ffd4a5':'#fff0d8'} castShadow shadow-mapSize={[quality==='high'?2048:1024,quality==='high'?2048:1024]} shadow-camera-left={view==='create'?-5:-19} shadow-camera-right={view==='create'?5:19} shadow-camera-top={view==='create'?5:19} shadow-camera-bottom={view==='create'?-5:-19} shadow-radius={3} shadow-camera-near={1} shadow-camera-far={60} shadow-normalBias={.035} shadow-bias={-.00006}/>
  <directionalLight position={[6,5,6]} intensity={night?.5:.65} color="#d7e6df"/>
  <Environment resolution={quality==='high'?128:64}><Lightformer position={[0,8,0]} rotation-x={Math.PI/2} scale={[10,10,1]} intensity={1.4} color="#fff1d8"/><Lightformer position={[8,4,2]} rotation-y={-Math.PI/2} scale={[6,8,1]} intensity={1} color="#dce8e1"/></Environment>
  <group visible={view==='create'}><StudioSet/><group name="atelier-live-resident"><OriginalResident appearance={appearance} motion={motion} emotion={emotion} time={poseTime} paused={!pageVisible} quality={quality}/></group></group>
  <group name="atelier-export-town" visible={view!=='create'}><OriginalNeighborhood timeOfDay={timeOfDay} quality={quality} theme={theme} paused={!pageVisible}/></group>
  {view!=='create'&&<group name="atelier-live-cast">
   <group ref={playerRoot} name="atelier-player" position={[-1.55,0,3.4]} rotation-y={story?.55:.12}><OriginalResident appearance={appearance} motion={story?beat.motion:'idle'} emotion={story?beat.emotion:'happy'} time={story?beatTime:poseTime} paused={!pageVisible||story&&!playing} quality={quality}/></group>
   <group ref={friendRoot} name="atelier-friend" position={[1.55,0,3.2]} rotation-y={story?-.55:-.2}><OriginalResident appearance={friend} motion={story?beat.friend:'idle'} emotion={story?beat.emotion:'neutral'} time={story?beatTime:poseTime} paused={!pageVisible||story&&!playing} quality={quality}/></group>
  </group>}
  {import.meta.env.DEV&&ORIGINAL_PRESETS.map(preset=><group key={preset.id} name={`atelier-export-resident:${preset.id}`} visible={false}><OriginalResident appearance={preset.appearance} motion="idle" emotion="neutral" time={0} paused quality="high"/></group>)}
  {import.meta.env.DEV&&<group name="no-export:props" visible={false}><OriginalResident appearance={ORIGINAL_PRESETS[0].appearance} motion="receive" time={0} paused/><OriginalResident appearance={ORIGINAL_PRESETS[0].appearance} motion="eat" time={0} paused/></group>}
  <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={.12} minDistance={view==='create'?2.3:5} maxDistance={view==='create'?14:45} minPolarAngle={.28} maxPolarAngle={1.55} enablePan target={[0,1.4,0]}/>
  <CameraDirector view={view} frame={frame} resetCamera={resetCamera} controls={controls} headY={frame==='face'?bodyDimensions(appearance).head*mix(.9,1.1,appearance.height):2.15}/>
 </>
}
export function OriginalScene(props:OriginalSceneProps){return <Canvas className="original-canvas" shadows dpr={props.quality==='high'?[1,1.6]:1} camera={{position:[4.4,3.1,7.5],fov:35,near:.05,far:180}} gl={{antialias:true,alpha:false,powerPreference:'high-performance'}} onCreated={({gl})=>{gl.toneMapping=ACESFilmicToneMapping;gl.toneMappingExposure=1;gl.outputColorSpace=SRGBColorSpace;gl.shadowMap.type=PCFSoftShadowMap}}><SceneContents {...props}/></Canvas>}
