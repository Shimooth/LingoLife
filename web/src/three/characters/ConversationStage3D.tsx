import { useRef, useState, type ReactNode } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { ContactShadows, Html, PerspectiveCamera } from '@react-three/drei'
import { MathUtils, Mesh, type Group, type Material } from 'three'
import { Character3D } from './Character3D'
import type { ConversationAtmosphere, ConversationStage3DProps, SpeechLine } from './types'
import './characters.css'

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

function SetDressing({ atmosphere, palette }: { atmosphere: ConversationAtmosphere; palette: Palette }) {
  const building = atmosphere === 'home' || atmosphere === 'cafe' || atmosphere === 'office'
  return <group>
    <mesh position={[0, 2, -2.8]}><planeGeometry args={[16, 8]} /><meshBasicMaterial color={palette.horizon} /></mesh>
    <mesh position={[0, -.2, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[16, 14]} /><meshStandardMaterial color={palette.floor} roughness={1} /></mesh>
    {building ? <>
      <mesh position={[-3.2, 1.4, -2.35]}><boxGeometry args={[2.4, 3.5, .25]} /><meshStandardMaterial color={palette.sky} /></mesh>
      <mesh position={[3.4, 1.55, -2.35]}><boxGeometry args={[2.8, 3.8, .25]} /><meshStandardMaterial color={palette.sky} /></mesh>
      {[-3.55, -2.8, 3, 3.8].map(x => <mesh key={x} position={[x,1.75,-2.18]}><boxGeometry args={[.48,.85,.08]} /><meshStandardMaterial color={palette.light} emissive={palette.light} emissiveIntensity={.16} /></mesh>)}
    </> : <>
      {[-4.2,-3.3,3.2,4.1].map((x,index) => <group key={x} position={[x,0,-2.25]}><mesh position={[0,.8,0]}><cylinderGeometry args={[.09,.14,1.7,7]} /><meshStandardMaterial color="#63564d" /></mesh><mesh position={[0,1.75,0]} scale={[1,index % 2 ? .8 : 1.15,1]}><dodecahedronGeometry args={[.72,0]} /><meshStandardMaterial color={atmosphere === 'harbor' ? '#7aa0a1' : '#6f916f'} /></mesh></group>)}
      {atmosphere === 'harbor' && <mesh position={[0,.23,-2.15]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[8,2.6]} /><meshStandardMaterial color="#75aab6" metalness={.08} roughness={.32} /></mesh>}
    </>}
    <mesh position={[0, 4, -2.6]}><circleGeometry args={[1.1, 24]} /><meshBasicMaterial color={palette.accent} transparent opacity={atmosphere === 'evening' ? .34 : .16} /></mesh>
  </group>
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
  return <Html center distanceFactor={6.7} zIndexRange={[12, 0]} style={{ pointerEvents: 'auto' }}>
    <article className={`world-speech world-speech--${side}`} role="status" aria-live={line.streaming ? 'polite' : 'off'}>
      <strong>{name}</strong>
      <p>{line.text || (language === 'zh' ? '正在组织语言…' : 'Finding the words…')} {line.streaming && <i className="world-speech__cursor" />}</p>
      {line.translation && <button type="button" onClick={onToggle} aria-expanded={translationVisible}>{translationVisible ? (language === 'zh' ? '收起翻译' : 'Hide translation') : (language === 'zh' ? '查看翻译' : 'Show translation')}</button>}
      {line.translation && translationVisible && <div className="world-speech__translation"><small>{language === 'zh' ? '中文' : 'Translation'}</small>{line.translation}</div>}
    </article>
  </Html>
}

export function ConversationStage3D({ npcAvatar, playerAvatar, showPlayerAvatar = false, npcName, playerName, place, locationKind, atmosphere: requestedAtmosphere, npcAnimation, playerAnimation, liveSpeech, messages = [], language = 'zh', showTranslation, onTranslationChange, className = '', reducedMotion = false, sceneryMode = false }: ConversationStage3DProps) {
  const [internalTranslation, setInternalTranslation] = useState(false)
  const atmosphere = requestedAtmosphere ?? inferAtmosphere(locationKind)
  const palette = atmospheres[atmosphere]
  const fallbackLine: SpeechLine | null = liveSpeech ?? (messages.length ? { ...messages[messages.length - 1], key: messages[messages.length - 1].created_at } : null)
  const translationVisible = showTranslation ?? internalTranslation
  const toggleTranslation = () => {
    const next = !translationVisible
    if (showTranslation === undefined) setInternalTranslation(next)
    onTranslationChange?.(next)
  }
  const speaker = fallbackLine?.speaker
  const npcMotion = reducedMotion ? 'idle' : npcAnimation ?? (speaker === 'npc' ? 'talk' : 'listen')
  const playerMotion = reducedMotion ? 'idle' : playerAnimation ?? (speaker === 'player' ? 'talk' : 'listen')
  const you = playerName ?? (language === 'zh' ? '你' : 'You')

  return <section className={`conversation-stage-3d ${sceneryMode ? 'is-scenery' : ''} ${reducedMotion ? 'is-reduced-motion' : ''} ${className}`.trim()} style={{ '--conversation-sky': palette.sky } as React.CSSProperties} aria-label={language === 'zh' ? `在${place ?? '岛上'}与${npcName}对话` : `Conversation with ${npcName} at ${place ?? 'the island'}`}>
    <Canvas dpr={[1, 1.65]} gl={{ antialias: true, alpha: false }}>
      <color attach="background" args={[palette.sky]} />
      <fog attach="fog" args={[palette.sky, 8, 18]} />
      <PerspectiveCamera makeDefault position={[0, 2.1, 7.2]} fov={37} near={.1} far={40} />
      <ambientLight intensity={1.15} />
      <hemisphereLight args={[palette.light, palette.floor, 1.7]} />
      <directionalLight position={[-4, 7, 6]} intensity={2.4} color={palette.light} castShadow />
      <pointLight position={[4, 3, 2]} intensity={10} distance={9} color={palette.accent} />
      <SetDressing atmosphere={atmosphere} palette={palette} />
      <FadingCast hidden={sceneryMode} immediate={reducedMotion}>
        {showPlayerAvatar && playerAvatar
          ? <group position={[-1.92, -.05, 1.28]} rotation={[0, .2, 0]}><Character3D avatar={playerAvatar} animation={playerMotion} detail="portrait" scale={1.18} name={you} seed={you} /></group>
          : <ObserverPresence accent={palette.accent} />}
        {fallbackLine?.speaker === 'player' && <group position={[-1.35, 3.68, .55]}><SpeechBubble line={fallbackLine} name={you} side="left" language={language} translationVisible={translationVisible} onToggle={toggleTranslation} /></group>}
        <group position={[1.48, .02, -.28]} rotation={[0, -.16, 0]}>
          <Character3D avatar={npcAvatar} animation={npcMotion} scale={1.02} name={npcName} seed={npcName} />
          {fallbackLine?.speaker === 'npc' && <group position={[.68, 3.58, .2]}><SpeechBubble line={fallbackLine} name={npcName} side="right" language={language} translationVisible={translationVisible} onToggle={toggleTranslation} /></group>}
        </group>
      </FadingCast>
      <ContactShadows position={[0, -.2, .15]} opacity={.34} scale={8} blur={2.6} far={4} />
    </Canvas>
    <div className="conversation-stage-3d__vignette" aria-hidden />
    {place && <span className="conversation-stage-3d__place">⌖ {place}</span>}
  </section>
}
