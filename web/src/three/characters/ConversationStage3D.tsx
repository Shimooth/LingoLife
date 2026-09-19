import { Suspense, useRef, useState, type ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, PerspectiveCamera } from '@react-three/drei'
import { Box3, MathUtils, Mesh, Vector3, type Group, type Material } from 'three'
import {CharacterOverhead} from './CharacterOverhead'
import {speechPlacement} from './speechPlacement'
import {visibleCharacterBounds} from './visibleCharacterBounds'
import { deriveAnimationExpression } from '../../life/characterExpression'
import { CharacterEmote } from './CharacterEmote'
import { DirectedCharacter3D } from './DirectedCharacter3D'
import type { ConversationAtmosphere, ConversationStage3DProps, SpeechLine } from './types'
import './characters.css'
import {IndoorEnvironment3D} from '../interiors'
import {selectSceneSpeech} from '../../conversationOpening'
import {StreetConversationEnvironment} from './StreetConversationEnvironment'
import {AdaptiveResolution,SceneLighting,SceneLook} from '../rendering/SceneLook'
import {useVisualBudget} from '../rendering/useVisualBudget'

type Palette = { sky: string; horizon: string; floor: string; accent: string; light: string }

const atmospheres: Record<ConversationAtmosphere, Palette> = {
  home: { sky: '#f2cfb5', horizon: '#f8e6d7', floor: '#bb9072', accent: '#d97967', light: '#fff0dc' },
  cafe: { sky: '#ce9d79', horizon: '#f0d1ae', floor: '#76544c', accent: '#b9524b', light: '#ffd9ad' },
  park: { sky: '#a9cfc4', horizon: '#d8e5bd', floor: '#64816b', accent: '#e9ac55', light: '#fff4d1' },
  harbor: { sky: '#83afc1', horizon: '#c6dadd', floor: '#6c8992', accent: '#e99562', light: '#e7f7ff' },
  office: { sky: '#acb9c5', horizon: '#e4dfd4', floor: '#788087', accent: '#5c8291', light: '#f4f8ff' },
  evening: { sky: '#5c536f', horizon: '#bc7c79', floor: '#514657', accent: '#ffc06a', light: '#ffd3ae' },
  neutral: { sky: '#b8c4c1', horizon: '#e6ddd0', floor: '#7b7770', accent: '#d27a69', light: '#fff3df' },
}

function inferAtmosphere(locationKind?: string): ConversationAtmosphere {
  const kind = locationKind?.toLowerCase() ?? ''
  if (/home|house|residential/.test(kind)) return 'home'
  if (/cafe|restaurant|market|shop/.test(kind)) return 'cafe'
  if (/park|garden|forest|mountain/.test(kind)) return 'park'
  if (/harbor|port|beach|coast|lighthouse/.test(kind)) return 'harbor'
  if (/office|studio|school|university|hospital/.test(kind)) return 'office'
  if (/evening|night|music|theatre|theater/.test(kind)) return 'evening'
  return 'neutral'
}

function ConversationCamera(){
 const size=useThree(state=>state.size)
 return <PerspectiveCamera makeDefault position={[0,2.1,size.width/Math.max(1,size.height)<.8?8.6:7.2]} fov={37} near={.1} far={40}/>
}

function NpcPlacement({children}:{children:ReactNode}){
 const size=useThree(state=>state.size)
 const group=useRef<Group>(null)
 const scratch=useRef({head:new Vector3(),foot:new Vector3(),box:new Box3(),part:new Box3(),last:'',elapsed:1})
 const aspect=size.width/Math.max(1,size.height)
 useFrame(({camera,gl},delta)=>{
  if(!group.current)return
  scratch.current.elapsed+=delta
  if(scratch.current.elapsed<.12)return
  scratch.current.elapsed=0
  const stage=gl.domElement.closest<HTMLElement>('.conversation-stage-3d')
  if(!stage)return
  const {head,foot,box}=scratch.current
  visibleCharacterBounds(group.current,box,scratch.current.part)
  if(box.isEmpty())return
  box.getCenter(head);foot.copy(head);head.y=box.max.y+.2;foot.y=box.min.y
  head.project(camera);foot.project(camera)
  const x=(head.x+1)*size.width/2,y=(1-head.y)*size.height/2
  const bubbleHeight=stage.querySelector<HTMLElement>('.world-speech__surface')?.offsetHeight||180
  const {mode,...placement}=speechPlacement(size.width,size.height,x,y,Math.abs(foot.y-head.y)*size.height/2,bubbleHeight)
  const signature=mode+Object.values(placement).map(Math.round).join(':')
  if(signature===scratch.current.last)return
  scratch.current.last=signature
  stage.dataset.speechPlacement=mode
  for(const [key,value] of Object.entries(placement))stage.style.setProperty(`--speech-${key}`,`${Math.round(value)}px`)
 })
 return <group ref={group} position={[aspect<.8?.05:aspect<1.3?.7:1.48,.02,-.28]} rotation={[0,-.16,0]}>{children}</group>
}

function ObserverPresence({ accent }: { accent: string }) {
  return <group name="Observer presence" position={[-2.16, -.46, 1.72]} rotation={[0, .24, -.04]}>
    <mesh position={[-.2,.73,0]} rotation={[0,0,-.28]} scale={[1.35,1,.82]}><capsuleGeometry args={[.44,.92,5,11]} /><meshStandardMaterial color="#3f4853" roughness={.92} /></mesh>
    <mesh position={[.36,.76,.3]} rotation={[.08,0,.5]}><capsuleGeometry args={[.13,.58,4,8]} /><meshStandardMaterial color="#d4a17f" roughness={.9} /></mesh>
    <mesh position={[.66,1.08,.48]} rotation={[-.08,-.18,.04]}><boxGeometry args={[.48,.68,.055]} /><meshStandardMaterial color="#29313a" metalness={.18} roughness={.5} /></mesh>
    <mesh position={[.66,1.08,.514]}><planeGeometry args={[.39,.57]} /><meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={.22} roughness={.42} /></mesh>
  </group>
}

function setMaterialOpacity(material: Material | Material[], opacity: number) {
  const materials = Array.isArray(material) ? material : [material]
  materials.forEach(item => {
    item.transparent = opacity < .999
    item.opacity = opacity
  })
}

function FadingCast({ hidden, immediate, children }: { hidden: boolean; immediate: boolean; children: ReactNode }) {
  const group = useRef<Group>(null)
  const opacity = useRef(hidden ? 0 : 1)
  useFrame((_, delta) => {
    const next = immediate ? (hidden ? 0 : 1) : MathUtils.damp(opacity.current, hidden ? 0 : 1, 7, delta)
    opacity.current = next
    if (!group.current) return
    group.current.visible = next > .01
    group.current.traverse(child => {
      if (child instanceof Mesh) setMaterialOpacity(child.material, next)
    })
  })
  return <group ref={group} visible={!hidden || opacity.current > .01}>{children}</group>
}

function SpeechBubble({ line, name, side, language, translationVisible, onToggle }: { line: SpeechLine; name: string; side: 'left' | 'right'; language: 'zh' | 'en'; translationVisible: boolean; onToggle: () => void }) {
  const translationLabel = translationVisible
    ? (language === 'zh' ? '收起翻译' : 'Hide translation')
    : (language === 'zh' ? '查看翻译' : 'Show translation')
  return <article className={`world-speech world-speech--${side}${translationVisible&&line.translation?' is-translated':''}`}>
    <div className="world-speech__surface">
      <div className="world-speech__message" role="status" aria-live={line.streaming ? 'polite' : 'off'} aria-atomic="true">
        <strong>{name}</strong>
        <p>{line.text || (language === 'zh' ? '正在组织语言…' : 'Finding the words…')} {line.streaming && <i className="world-speech__cursor" />}</p>
      </div>
      {line.translation && <button type="button" onClick={onToggle} aria-expanded={translationVisible} aria-label={`${translationLabel}：${name}`}>{translationLabel}</button>}
      {line.translation && translationVisible && <div className="world-speech__translation"><small>{language === 'zh' ? '中文' : 'Translation'}</small>{line.translation}</div>}
    </div>
  </article>
}

export function ConversationStage3D({ npcAvatar, playerAvatar, showPlayerAvatar = false, npcName, playerName, place, locationKind, atmosphere: requestedAtmosphere, npcAnimation, playerAnimation, performance, performanceKey, liveSpeech, messages = [], language = 'zh', showTranslation, onTranslationChange, className = '', reducedMotion = false, sceneryMode = false, interiorPlacements }: ConversationStage3DProps) {
 const visualBudget=useVisualBudget()
  const [internalTranslation, setInternalTranslation] = useState(false)
  const atmosphere = requestedAtmosphere ?? inferAtmosphere(locationKind)
  const palette = atmospheres[atmosphere]
  const fallbackLine = selectSceneSpeech(liveSpeech, messages)
  const translationVisible = showTranslation ?? internalTranslation
  const toggleTranslation = () => {
    const next = !translationVisible
    if (showTranslation === undefined) setInternalTranslation(next)
    onTranslationChange?.(next)
  }
  const speaker = fallbackLine?.speaker
  const npcMotion = reducedMotion
    ? 'idle'
    : speaker === 'player'
      ? 'listen'
      : fallbackLine?.streaming
        ? 'talk'
        : npcAnimation ?? (speaker === 'npc' ? 'talk' : 'idle')
  const playerMotion = reducedMotion ? 'idle' : playerAnimation ?? (speaker === 'player' ? 'talk' : 'listen')
  const npcPerformanceMode = speaker === 'player'
    ? 'conversation_listen'
    : fallbackLine?.streaming
      ? 'conversation_speak'
      : 'conversation_react'
  const lineKey = performanceKey ?? fallbackLine?.key ?? 'opening'
  const npcExpression = deriveAnimationExpression(npcMotion, `conversation:${npcName}:${lineKey}:${npcMotion}`)
  const showNpcExpression = speaker === 'npc' && !fallbackLine?.streaming && ['happy','sad','tired','jump','crouch','push'].includes(npcMotion)
  const you = playerName ?? (language === 'zh' ? '你' : 'You')

  return <section className={`conversation-stage-3d ${sceneryMode ? 'is-scenery' : ''} ${reducedMotion ? 'is-reduced-motion' : ''} ${className}`.trim()} style={{ '--conversation-sky': palette.sky } as React.CSSProperties} aria-label={language === 'zh' ? `在${place ?? '天空之城'}与${npcName}对话` : `Conversation with ${npcName} at ${place ?? 'the Sky City'}`}>
    <Canvas shadows="percentage" dpr={visualBudget.dpr} gl={{ antialias: true, alpha: true }}>
      {locationKind==='street'&&<color attach="background" args={['#c6dce1']}/>}
      <fog attach="fog" args={locationKind==='street'?['#c6dce1',22,38]:[palette.sky, 8, 18]} />
      <ConversationCamera/>
      <SceneLook/><SceneLighting portrait/><AdaptiveResolution onTier={visualBudget.onTier}/>
      {atmosphere==='home'&&<Suspense fallback={null}><IndoorEnvironment3D theme="home_lounge" placements={interiorPlacements}/></Suspense>}
      {locationKind==='street'&&<Suspense fallback={null}><StreetConversationEnvironment/></Suspense>}
      <FadingCast hidden={sceneryMode} immediate={reducedMotion}>
        {showPlayerAvatar && playerAvatar
          ? <group position={[-1.92, -.05, 1.28]} rotation={[0, .2, 0]}><DirectedCharacter3D avatar={playerAvatar} animation={playerMotion} performanceMode={speaker === 'player' ? 'conversation_speak' : 'conversation_listen'} performanceKey={`player:${lineKey}`} reducedMotion={reducedMotion} detail="portrait" scale={1.18} name={you} seed={you} /></group>
          : <ObserverPresence accent={palette.accent} />}
        <NpcPlacement>
          <CharacterOverhead label={showNpcExpression&&!sceneryMode?<CharacterEmote key={npcExpression.key} expression={npcExpression} language={language} size={30} className="conversation-stage-3d__emote"/>:null}>
          <DirectedCharacter3D avatar={npcAvatar} animation={npcMotion} performance={speaker === 'npc' && !fallbackLine?.streaming ? performance : undefined} performanceMode={npcPerformanceMode} performanceKey={`npc:${lineKey}`} reducedMotion={reducedMotion} scale={1.02} name={npcName} seed={npcName} />
          </CharacterOverhead>
        </NpcPlacement>
      </FadingCast>
      <ContactShadows position={[0, -.2, .15]} opacity={.34} scale={8} blur={2.6} far={4} />
    </Canvas>
    <div className="conversation-stage-3d__vignette" aria-hidden />
    {place && <span className="conversation-stage-3d__place">⌖ {place}</span>}
    {fallbackLine && <div key={`${fallbackLine.speaker}-${fallbackLine.key??'latest'}`} className={`conversation-stage-3d__speech-layer conversation-stage-3d__speech-layer--${fallbackLine.speaker}`}>
      <SpeechBubble line={fallbackLine} name={fallbackLine.speaker==='player'?you:npcName} side={fallbackLine.speaker==='player'?'left':'right'} language={language} translationVisible={translationVisible} onToggle={toggleTranslation} />
    </div>}
  </section>
}
