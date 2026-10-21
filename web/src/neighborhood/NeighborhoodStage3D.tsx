import {Component,Suspense,useEffect,useMemo,useRef,useState,type ReactNode,type RefObject} from 'react'
import {Canvas,useFrame,useLoader,useThree} from '@react-three/fiber'
import {Html,PerspectiveCamera,RoundedBox,useGLTF,useTexture} from '@react-three/drei'
import {Box3,FileLoader,Group,MathUtils,Mesh,MeshStandardMaterial,Vector3} from 'three'
import type {AvatarConfig,NpcProfile} from '../types'
import {Character3D} from '../three/characters/Character3D'
import {getCharacterFamily} from '../three/characters/characterAssets'
import type {Character3DProps} from '../three/characters/types'
import type {LifeMotion} from '../three/characters/lifeRetarget'
import {SceneLighting,SceneLook} from '../three/rendering/SceneLook'
import {Fountain3D} from './Fountain3D'
import {ArrivalPerformance3D} from '../arrival/ArrivalPerformance3D'
import type {ArrivalFood} from '../arrival/types'

export type NeighborhoodStageMode='fountain'|'wish'|'news'|'shop'|'gift'|'meet'|'friendship'|'spark'|'food'
export type NeighborhoodStage3DProps={
 mode:NeighborhoodStageMode
 residents:{id:string;profile:NpcProfile}[]
 activeActorIds?:string[]
 speakerId?:string
 shot?:'wide'|'two_shot'|'speaker'|'reaction'
 cue?:string
 performanceKey?:string
 reducedMotion?:boolean
 language?:'zh'|'en'
 giftLabel?:string
 outfitPreview?:AvatarConfig
 newsTitle?:string
 food?:ArrivalFood
 onReady?:()=>void
 onComplete?:()=>void
}
type Clock={time:number;ready:boolean;completed:boolean}
const BASE='/assets/life/interiors'
const cream='#fbf1dc',mint='#a8c8b3',coral='#da927e',ink='#496e61'

class AssetBoundary extends Component<{children:ReactNode;fallback?:ReactNode},{failed:boolean}>{
 state={failed:false}
 static getDerivedStateFromError(){return {failed:true}}
 render(){return this.state.failed?this.props.fallback??null:this.props.children}
}

/** Normalize presentation anchors without changing the source GLTF files. */
function Model({url,height,position=[0,0,0],rotation=0,name}:{url:string;height:number;position?:[number,number,number];rotation?:number;name:string}){
 const {scene}=useGLTF(url)
 const {copy,scale,offset}=useMemo(()=>{
  const copy=scene.clone(true)
  copy.traverse(object=>{
   if(!(object instanceof Mesh))return
   object.castShadow=true;object.receiveShadow=true
   const soften=(material:MeshStandardMaterial)=>{const result=material.clone();if(result.isMeshStandardMaterial){result.roughness=Math.max(.72,result.roughness);result.metalness=Math.min(.12,result.metalness)}return result}
   object.material=Array.isArray(object.material)?object.material.map(value=>soften(value as MeshStandardMaterial)):soften(object.material as MeshStandardMaterial)
  })
  const box=new Box3().setFromObject(copy),size=box.getSize(new Vector3()),center=box.getCenter(new Vector3())
  return {copy,scale:height/Math.max(.01,size.y),offset:[-center.x,-box.min.y,-center.z] as [number,number,number]}
 },[scene,height])
 useEffect(()=>()=>{copy.traverse(object=>{if(object instanceof Mesh)for(const material of Array.isArray(object.material)?object.material:[object.material])material.dispose()})},[copy])
 return <group name={name} position={position} rotation-y={rotation} scale={scale}><primitive object={copy} position={offset} dispose={null}/></group>
}
function SafeModel(props:Parameters<typeof Model>[0]){
 return <AssetBoundary key={props.url} fallback={<RoundedBox position={props.position} args={[.5,.4,.5]} radius={.1}><meshStandardMaterial color={mint}/></RoundedBox>}><Suspense fallback={null}><Model {...props}/></Suspense></AssetBoundary>
}

export {Fountain3D as ToyFountain} from './Fountain3D'

/** Original rounded toy storefront, separate from the real outfit preview. */
export function ToyClothingShop({scale=1}:{scale?:number}){
 return <group name="toy-clothing-shop-facility" scale={scale}>
  <RoundedBox position={[0,.08,0]} args={[1.95,.16,1.95]} radius={.075} receiveShadow><meshStandardMaterial color={cream}/></RoundedBox>
  <RoundedBox position={[0,.84,-.16]} args={[1.72,1.36,1.2]} radius={.15} castShadow receiveShadow><meshStandardMaterial color={mint} roughness={.9}/></RoundedBox>
  <RoundedBox position={[0,1.59,-.12]} args={[1.86,.25,1.38]} radius={.12} castShadow><meshStandardMaterial color={coral}/></RoundedBox>
  {[-1,1].map(side=><group key={`side-window-${side}`} name="wardrobe-side-display" position={[side*.867,.88,-.16]} rotation-y={side*Math.PI/2}>
   <RoundedBox args={[.7,.67,.045]} radius={.02} receiveShadow><meshStandardMaterial color={cream} roughness={.88}/></RoundedBox>
   <RoundedBox position-z={.029} args={[.58,.55,.018]} radius={.008}><meshStandardMaterial color="#729d9b" roughness={.62}/></RoundedBox>
   <RoundedBox position-z={.043} args={[.028,.56,.015]} radius={.006}><meshStandardMaterial color={cream}/></RoundedBox>
   <RoundedBox position={[0,-.07,.043]} args={[.59,.028,.015]} radius={.006}><meshStandardMaterial color={cream}/></RoundedBox>
   <RoundedBox position={[0,-.36,.02]} args={[.77,.065,.12]} radius={.028} receiveShadow><meshStandardMaterial color="#dfc99f" roughness={.88}/></RoundedBox>
  </group>)}
  <group name="wardrobe-rear-sign" position={[0,.9,-.778]} rotation-y={Math.PI}>
   <RoundedBox args={[.79,.68,.04]} radius={.018}><meshStandardMaterial color={cream} roughness={.88}/></RoundedBox>
   <RoundedBox position={[0,-.015,.038]} args={[.22,.32,.045]} radius={.02}><meshStandardMaterial color={coral} roughness={.92}/></RoundedBox>
   {[-1,1].map(side=><RoundedBox key={side} position={[side*.13,.09,.038]} rotation-z={side*.5} args={[.12,.14,.045]} radius={.02}><meshStandardMaterial color={coral}/></RoundedBox>)}
   <RoundedBox position={[0,-.235,.031]} args={[.36,.025,.018]} radius={.008}><meshStandardMaterial color="#b99b73"/></RoundedBox>
  </group>
  <RoundedBox position={[.4,.7,.455]} args={[.55,1.06,.035]} radius={.016}><meshStandardMaterial color="#526e65"/></RoundedBox>
  <RoundedBox position={[-.38,.84,.46]} args={[.64,.74,.04]} radius={.018}><meshStandardMaterial color={cream}/></RoundedBox>
  <RoundedBox position={[-.38,.84,.49]} args={[.2,.31,.04]} radius={.018}><meshStandardMaterial color={coral}/></RoundedBox>
  {[-1,1].map(side=><RoundedBox key={side} position={[-.38+side*.13,.92,.49]} rotation-z={side*.5} args={[.12,.14,.04]} radius={.018}><meshStandardMaterial color={coral}/></RoundedBox>)}
  <mesh position={[.57,.72,.49]}><sphereGeometry args={[.032,10,8]}/><meshStandardMaterial color="#dfbf77"/></mesh>
  {[-.7,-.35,0,.35,.7].map((x,index)=><RoundedBox key={x} position={[x,1.34,.57]} args={[.36,.17,.38]} radius={.07} castShadow><meshStandardMaterial color={index%2?cream:coral}/></RoundedBox>)}
 </group>
}

function ToyGift({root,label}:{root:RefObject<Group|null>;label?:string}){
 return <group ref={root} name="neighborhood-gift" position={[-.48,.95,.92]}>
  <RoundedBox args={[.55,.5,.55]} radius={.09} smoothness={4} castShadow><meshStandardMaterial color={coral} roughness={.85}/></RoundedBox>
  <RoundedBox position={[0,.27,0]} args={[.6,.1,.6]} radius={.035} castShadow><meshStandardMaterial color="#ebb898" roughness={.85}/></RoundedBox>
  <RoundedBox position={[0,0,.285]} args={[.09,.55,.018]} radius={.006}><meshStandardMaterial color={cream}/></RoundedBox>
  {[-1,1].map(side=><mesh key={side} position={[side*.085,.38,0]} rotation={[Math.PI/2,side*.5,0]} scale={[1,.7,1]}><torusGeometry args={[.1,.025,8,20]}/><meshStandardMaterial color={cream}/></mesh>)}
  {label&&<Html center position={[0,-.5,0]} style={{pointerEvents:'none',whiteSpace:'nowrap'}}><span style={{background:'#fff9e8ed',borderRadius:15,padding:'6px 11px',font:'12px system-ui',color:ink}}>{label}</span></Html>}
 </group>
}

function ToyClothes(){
 return <group name="authored-clothes-rack" position={[2.5,0,-1.3]}>
  {[-.68,.68].map(x=><group key={x}><mesh position={[x,.95,0]}><capsuleGeometry args={[.045,1.75,4,10]}/><meshStandardMaterial color={cream}/></mesh><RoundedBox position={[x,.055,0]} args={[.35,.1,.5]} radius={.04} castShadow><meshStandardMaterial color={mint}/></RoundedBox></group>)}
  <mesh position={[0,1.88,0]} rotation-z={Math.PI/2}><capsuleGeometry args={[.045,1.4,4,10]}/><meshStandardMaterial color={cream}/></mesh>
  {[-.42,0,.42].map((x,index)=><group key={x} position={[x,1.3,0]}><mesh position={[0,.35,0]}><torusGeometry args={[.07,.012,6,12,Math.PI*1.6]}/><meshStandardMaterial color="#b7a984"/></mesh><RoundedBox args={[.3,.43,.08]} radius={.035} castShadow><meshStandardMaterial color={[coral,mint,'#e6c576'][index]}/></RoundedBox>{[-1,1].map(side=><RoundedBox key={side} position={[side*.19,.12,0]} rotation-z={side*.5} args={[.15,.2,.08]} radius={.035}><meshStandardMaterial color={[coral,mint,'#e6c576'][index]}/></RoundedBox>)}</group>)}
 </group>
}

function NewsSet({title}:{title?:string}){
 return <group name="neighborhood-news-set">
  <RoundedBox position={[0,1.85,-1.8]} args={[5.9,3.2,.2]} radius={.09} receiveShadow><meshStandardMaterial color={mint}/></RoundedBox>
  <RoundedBox position={[0,2.2,-1.65]} args={[4.9,1.35,.1]} radius={.045}><meshStandardMaterial color={cream}/></RoundedBox>
  <Html center position={[0,2.32,-1.52]} zIndexRange={[4,2]} style={{pointerEvents:'none',width:330,textAlign:'center'}}><div style={{font:'700 23px system-ui',color:ink,letterSpacing:1}}>LingoLife <span style={{color:coral}}>NEWS</span></div>{title&&<div style={{font:'12px system-ui',color:ink,marginTop:8}}>{title}</div>}</Html>
  <SafeModel name="news-desk-asset" url="/assets/neighborhood/counter_table.gltf" height={.9} position={[0,0,.7]}/>
  <RoundedBox position={[0,.75,.99]} args={[2.15,.55,.1]} radius={.045} castShadow><meshStandardMaterial color={coral}/></RoundedBox>
  <mesh position={[-.55,1.16,.65]} rotation={[0,0,.16]}><capsuleGeometry args={[.035,.28,4,10]}/><meshStandardMaterial color={ink}/></mesh>
  <mesh position={[-.53,1.35,.65]}><sphereGeometry args={[.065,12,10]}/><meshStandardMaterial color={ink}/></mesh>
 </group>
}

function HeartSprites({root}:{root:RefObject<Group|null>}){
 const texture=useTexture('/assets/neighborhood/emote_heart.png')
 return <group ref={root} name="neighborhood-heart" position={[0,2.4,.6]}>{[-1,1].map(side=><sprite key={side} position={[side*.32,side>.0?.13:0,0]} scale={[.38,.48,1]}><spriteMaterial map={texture} transparent depthWrite={false}/></sprite>)}</group>
}

function Scenery({mode,clock,reduced,giftLabel,newsTitle}:{mode:NeighborhoodStageMode;clock:Clock;reduced:boolean;giftLabel?:string;newsTitle?:string}){
 const fountain=useRef<Group>(null),gift=useRef<Group>(null),hearts=useRef<Group>(null)
 const plaza=['fountain','wish','meet','friendship','spark'].includes(mode)
 useFrame(()=>{
  const t=clock.time
  if(fountain.current)fountain.current.scale.setScalar(mode==='fountain'&&!reduced?MathUtils.lerp(.05,1,MathUtils.smoothstep(t,0,2.2)):1)
  if(gift.current){
   const reveal=reduced?1:MathUtils.smoothstep(t,.8,2.2)
   gift.current.scale.setScalar(reveal)
   gift.current.position.y=.95+(reduced?0:Math.sin(Math.min(t,6)*1.1)*.05*reveal)
   gift.current.rotation.y=reduced?0:Math.min(t,4)*.2
  }
  if(hearts.current){hearts.current.visible=reduced||t>.8;hearts.current.position.y=2.35+(reduced?0:MathUtils.smoothstep(t,.8,3)*.3);hearts.current.scale.setScalar(reduced?1:MathUtils.smoothstep(t,.8,1.8))}
 })
 return <group name={`neighborhood-scenery:${mode}`}>
  <RoundedBox position={[0,-.29,0]} args={[9,.55,6.7]} radius={.24} smoothness={5} receiveShadow><meshStandardMaterial color={plaza?'#d9e5c4':cream} roughness={.95}/></RoundedBox>
  <mesh position={[0,.004,0]} rotation-x={-Math.PI/2}><circleGeometry args={[3.15,64]}/><meshStandardMaterial color={plaza?'#efe6cf':'#edcdb6'} roughness={.95}/></mesh>
  {plaza?<>
   <group ref={fountain} position={[0,0,mode==='fountain'?-1.2:-2]} name="fountain-reveal">
    <Fountain3D assetName="wish-fountain-asset" scale={mode==='fountain'?1.55:1.2} reducedMotion={reduced}/>
   </group>
   <SafeModel name="round-park-tree" url={`${BASE}/park/tree.gltf`} height={2.8} position={[-3.6,0,-2]}/>
   <SafeModel name="park-bench" url={`${BASE}/park/bench.gltf`} height={.7} position={[3.1,0,-1.9]}/>
  </>:<>
   <RoundedBox position={[0,1.45,-2.55]} args={[8,3.4,.18]} radius={.08}><meshStandardMaterial color={mode==='news'?'#e8dcc2':'#e6ecd9'} roughness={.95}/></RoundedBox>
   <SafeModel name="round-house-plant" url={`${BASE}/plants/monstera_plant_medium_potted.gltf`} height={1.3} position={[-3.3,0,-1.8]}/>
  </>}
  {mode==='news'&&<NewsSet title={newsTitle}/>}
  {mode==='shop'&&<>
   <ToyClothes/>
   <SafeModel name="shop-counter-asset" url="/assets/neighborhood/counter_table.gltf" height={.82} position={[-2.65,0,-.9]}/>
   <SafeModel name="shop-register-asset" url="/assets/neighborhood/cash_register.gltf" height={.36} position={[-2.6,.83,-.95]}/>
   <RoundedBox position={[0,.08,.35]} args={[2.2,.16,2.2]} radius={.075} receiveShadow><meshStandardMaterial color={mint}/></RoundedBox>
  </>}
  {(mode==='gift'||mode==='wish')&&<ToyGift root={gift} label={giftLabel}/>}
  {mode==='spark'&&<AssetBoundary><Suspense fallback={null}><HeartSprites root={hearts}/></Suspense></AssetBoundary>}
 </group>
}

function Resident({person,index,count,mode,clock,speakerId,cue,preview,reduced}:{person:{id:string;profile:NpcProfile};index:number;count:number;mode:NeighborhoodStageMode;clock:Clock;speakerId?:string;cue?:string;preview?:AvatarConfig;reduced:boolean}){
 const root=useRef<Group>(null),avatar=preview??person.profile.avatar,family=getCharacterFamily(avatar)
 const speaking=person.id===speakerId
 const acting=cue&&speaking?cue:undefined
 const [walking,setWalking]=useState(mode==='meet'&&!reduced)
 const playback=useMemo(()=>({speed:0,time:0}),[])
 const life:LifeMotion|undefined=acting==='wave'?'Waving':['receive','give','wish'].includes(acting??'')?'Holding_A':undefined
 const pose=useMemo<NonNullable<Character3DProps['lifePerformancePose']>>(()=>({time:0}),[])
 const cueClock=useRef({cue:'',start:0})
 const x=count>1?(index===0?-1.05:1.05):mode==='wish'||mode==='gift'?-1.05:mode==='fountain'?-2.1:0
 useFrame(()=>{
  const t=clock.time
  if(cueClock.current.cue!==(acting??'')){cueClock.current={cue:acting??'',start:t}}
  pose.time=reduced?0:Math.min(5,t-cueClock.current.start);pose.motion=life
  if(root.current){
   const entering=mode==='meet'&&!reduced?1-MathUtils.smoothstep(t,0,1.8):0
   const distance=(1-entering)*.7,stride=family==='city'?1.58:.66,cycle=family==='city'?1:.7916666865
   playback.time=distance/stride*cycle
   if(walking&&t>=1.8)setWalking(false)
   root.current.position.set(x+(index===0?-1:1)*entering*.7,mode==='shop'?.16:0,mode==='news'?-.08:.5)
   const yaw=count>1?(index===0?.35:-.35):mode==='wish'?.15:0
   root.current.rotation.y=walking?MathUtils.lerp(index===0?Math.PI/2:-Math.PI/2,yaw,MathUtils.smoothstep(t,1.4,1.8)):yaw
   root.current.userData.neighborhood={time:t,speaking,cue:acting??'listen',family}
  }
 })
 const unhappy=acting==='disappointed',shy=acting==='shy'||mode==='spark'
 return <group ref={root} name={`neighborhood-resident:${person.id}`} position={[x,mode==='shop'?.16:0,mode==='news'?-.08:.5]}>
  <Character3D avatar={avatar} name={person.profile.name} seed={person.id} scale={family==='city'?.56:.76}
   animation={walking?'walk':unhappy?'sad':speaking?'talk':'listen'} animationClip={walking?(family==='city'?'Walk_B':'anim_walk'):undefined} animationPlayback={walking?playback:undefined} lifeMotion={!walking?life:undefined} lifePerformancePose={!walking&&life?pose:undefined} animationPaused={reduced} motionScale={0}
   socialPerformance={{speaking,listening:Boolean(speakerId&&!speaking),enabled:!reduced&&!life&&!walking,intensity:shy?.38:.6,key:`${speakerId}:${cue}`}}
   faceSpeaking={speaking&&!reduced} faceExpression={unhappy?'displeased':shy?'curious':mode==='friendship'||acting==='happy'?'happy':'neutral'} faceAttention={count>1?(index===0?.2:-.2):0}/>
  {mode!=='news'&&<Html center position={[0,-.02,.35]} zIndexRange={[4,2]} style={{pointerEvents:'none'}}><span style={{display:'block',maxWidth:125,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',padding:'5px 12px',background:speaking?ink:'#fff7e9ed',color:speaking?'#fff9e8':ink,borderRadius:20,font:'600 11px system-ui'}}>{person.profile.name}</span></Html>}
 </group>
}

function Director({clock,actors,mode,speakerId,shot,reduced,onReady,onComplete}:{clock:Clock;actors:string[];mode:NeighborhoodStageMode;speakerId?:string;shot?:NeighborhoodStage3DProps['shot'];reduced:boolean;onReady?:()=>void;onComplete?:()=>void}){
 const {scene,camera,size}=useThree(),wait=useRef(0),cameraReady=useRef(false)
 useFrame((_,delta)=>{
  wait.current+=Math.min(delta,.1)
  const loaded=actors.every(id=>{const root=scene.getObjectByName(`neighborhood-resident:${id}`);return Boolean(root&&(root.getObjectByName('Hips')||root.getObjectByName('DEF-spine')))})
  if(!clock.ready&&(loaded||wait.current>10)){clock.ready=true;onReady?.()}
  if(clock.ready&&!reduced&&!document.hidden)clock.time+=Math.min(delta,.06)
  if(clock.ready&&!clock.completed&&(reduced||clock.time>=7.5)){clock.completed=true;onComplete?.()}
  const close=!reduced&&(shot==='speaker'||shot==='reaction')&&speakerId&&actors.includes(speakerId)
  const target=new Vector3(close?(actors.indexOf(speakerId)===0&&actors.length>1?-1.05:actors.length>1?1.05:0):0,mode==='news'?1.2:1.1,0)
  const aspect=Math.max(.4,size.width/size.height),distance=Math.max(close?5.8:mode==='fountain'?9.1:8.4,(close?3.9:6.1)/aspect)
  const next=new Vector3(target.x,mode==='fountain'?3.8:2.65,distance)
  camera.position.lerp(next,reduced||!cameraReady.current?1:1-Math.exp(-Math.min(delta,.1)*3.2))
  camera.lookAt(target);cameraReady.current=true
 },-4)
 return null
}

function StageContents(props:NeighborhoodStage3DProps){
 useLoader(FileLoader,'/assets/life/motions/kaykit-life.json')
 const {mode,residents,activeActorIds,speakerId,shot,cue,reducedMotion=false,outfitPreview,onReady,onComplete}=props
 const clock=useMemo<Clock>(()=>({time:0,ready:false,completed:false}),[])
 const selected=(activeActorIds?.length?activeActorIds.flatMap(id=>residents.find(person=>person.id===id)??[]):residents).slice(0,['meet','friendship','spark'].includes(mode)?2:1)
 return <>
  <Director clock={clock} actors={selected.map(person=>person.id)} mode={mode} speakerId={speakerId} shot={shot} reduced={reducedMotion} onReady={onReady} onComplete={onComplete}/>
  <Scenery mode={mode} clock={clock} reduced={reducedMotion} giftLabel={props.giftLabel} newsTitle={props.newsTitle}/>
  {selected.map((person,index)=><Resident key={person.id} person={person} index={index} count={selected.length} mode={mode} clock={clock} speakerId={speakerId} cue={cue} preview={mode==='shop'&&index===0?outfitPreview:undefined} reduced={reducedMotion}/>)}
 </>
}

function FoodStage({person,food,reduced,onReady,onComplete,performanceKey}:{person:{id:string;profile:NpcProfile};food:ArrivalFood;reduced:boolean;onReady?:()=>void;onComplete?:()=>void;performanceKey:string}){
 const finished=useRef(false)
 const complete=()=>{if(!finished.current){finished.current=true;onComplete?.()}}
 return <ArrivalPerformance3D profile={person.profile} mode={reduced?'neutral_result':'feeding'} performanceKey={performanceKey} food={food} reduced={reduced} onReady={()=>{onReady?.();if(reduced)complete()}} onBite={()=>undefined} onFinished={complete}/>
}

/** A presentation-only toy diorama. Buttons, replay and settlement live above it. */
export function NeighborhoodStage3D(props:NeighborhoodStage3DProps){
 const key=props.performanceKey??`${props.mode}:${props.activeActorIds?.join(',')??''}`
 const diner=props.residents.find(person=>person.id===props.activeActorIds?.[0])??props.residents[0]
 return <div className="neighborhood-stage-3d" style={{width:'100%',height:'100%',minHeight:260,position:'relative',background:'#f4ecdc',borderRadius:24,overflow:'hidden'}} aria-label={props.language==='en'?'Neighborhood scene':'邻里生活场景'}>
  <AssetBoundary key={key} fallback={<div role="status" style={{padding:32,color:ink}}>{props.language==='en'?'The scene is unavailable. You can continue with the story.':'场景暂时没有加载好，可以继续阅读故事。'}</div>}>
   {props.mode==='food'&&props.food&&diner?<FoodStage key={key} person={diner} food={props.food} reduced={Boolean(props.reducedMotion)} onReady={props.onReady} onComplete={props.onComplete} performanceKey={key}/>:<Canvas shadows="percentage" dpr={[1,1.5]} gl={{antialias:true}}>
    <color attach="background" args={['#f4ecdc']}/><PerspectiveCamera makeDefault position={[0,2.65,8.4]} fov={35} near={.1} far={70}/>
    <SceneLook/><SceneLighting portrait/>
    <Suspense fallback={null}><StageContents key={key} {...props}/></Suspense>
   </Canvas>}
  </AssetBoundary>
 </div>
}
