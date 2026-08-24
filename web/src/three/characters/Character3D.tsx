import { Component, Suspense, useRef, type ErrorInfo, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { MathUtils } from 'three'
import { resolveAvatar, shiftColor, stableCharacterTilt } from './avatarMappings'
import { AssetCharacter3D } from './AssetCharacter3D'
import type { Character3DProps, CharacterMotion } from './types'

const HALF_PI = Math.PI / 2

type Pose = {
  bob: number
  lean: number
  head: number
  leftArm: number
  rightArm: number
  leftLeg: number
  rightLeg: number
}

function getPose(animation: CharacterMotion, time: number): Pose {
  const slow = Math.sin(time * 1.7)
  const beat = Math.sin(time * 4.6)
  if (animation === 'walk') return { bob: Math.abs(beat) * 0.045, lean: -0.045, head: slow * 0.025, leftArm: beat * 0.55, rightArm: -beat * 0.55, leftLeg: -beat * 0.5, rightLeg: beat * 0.5 }
  if (animation === 'talk') return { bob: slow * 0.018, lean: 0.015, head: Math.sin(time * 2.2) * 0.035, leftArm: -0.15 + beat * 0.08, rightArm: -0.58 + beat * 0.24, leftLeg: 0, rightLeg: 0 }
  if (animation === 'listen') return { bob: slow * 0.012, lean: 0.018, head: -0.095 + slow * 0.018, leftArm: -0.06, rightArm: 0.09, leftLeg: 0, rightLeg: 0 }
  if (animation === 'happy') return { bob: Math.abs(beat) * 0.075, lean: 0, head: slow * 0.045, leftArm: -0.7 + beat * 0.11, rightArm: -0.7 - beat * 0.11, leftLeg: beat * 0.08, rightLeg: -beat * 0.08 }
  if (animation === 'sad') return { bob: slow * 0.008, lean: 0.09, head: 0.14, leftArm: 0.12, rightArm: 0.12, leftLeg: 0, rightLeg: 0 }
  if (animation === 'tired') return { bob: slow * 0.01, lean: 0.075, head: 0.08 + slow * 0.012, leftArm: 0.18, rightArm: 0.18, leftLeg: 0, rightLeg: 0 }
  return { bob: slow * 0.018, lean: slow * 0.012, head: slow * 0.018, leftArm: slow * 0.025, rightArm: -slow * 0.025, leftLeg: 0, rightLeg: 0 }
}

function Eye({ kind, x }: { kind: string; x: number }) {
  if (kind === 'sleepy') return <mesh position={[x, 0, 0]} rotation={[0, 0, x < 0 ? -0.15 : 0.15]}><boxGeometry args={[0.14, 0.025, 0.025]} /><meshStandardMaterial color="#40363a" /></mesh>
  if (kind === 'wink' && x > 0) return <mesh position={[x, 0, 0]} rotation={[0, 0, 0.12]}><boxGeometry args={[0.14, 0.025, 0.025]} /><meshStandardMaterial color="#40363a" /></mesh>
  if (kind === 'sparkle') return <mesh position={[x, 0, 0.008]} rotation={[0, 0, Math.PI / 4]}><octahedronGeometry args={[0.09, 0]} /><meshStandardMaterial color="#40363a" /></mesh>
  return <mesh position={[x, kind === 'curious' && x > 0 ? -0.03 : 0, 0.003]} scale={kind === 'oval' ? [1.25, 0.8, 1] : kind === 'curious' && x > 0 ? [1.25, 0.75, 1] : [1, 1.25, 1]}><sphereGeometry args={[0.065, 12, 8]} /><meshStandardMaterial color="#40363a" /></mesh>
}

function Brows({ kind, color }: { kind: string; color: string }) {
  const thick = kind === 'bold' ? 0.043 : 0.026
  const left = kind === 'worried' ? -0.18 : kind === 'straight' ? 0 : 0.08
  return <group position={[0, 2.42, 0.338]}>
    <mesh position={[-0.18, 0, 0]} rotation={[0, 0, left]}><capsuleGeometry args={[thick, 0.11, 3, 8]} /><meshStandardMaterial color={color} /></mesh>
    <mesh position={[0.18, 0, 0]} rotation={[0, 0, -left]}><capsuleGeometry args={[thick, 0.11, 3, 8]} /><meshStandardMaterial color={color} /></mesh>
  </group>
}

function Nose({ kind }: { kind: string }) {
  if (kind === 'dot') return <mesh position={[0, 2.13, 0.39]}><sphereGeometry args={[0.032, 10, 7]} /><meshStandardMaterial color="#b97767" /></mesh>
  if (kind === 'heart') return <group position={[0, 2.13, 0.39]} rotation={[0, 0, Math.PI / 4]}><mesh scale={[1, 0.85, 0.55]}><boxGeometry args={[0.075, 0.075, 0.055]} /><meshStandardMaterial color="#c18170" /></mesh></group>
  if (kind === 'triangle') return <mesh position={[0, 2.14, 0.39]} rotation={[HALF_PI, 0, 0]}><coneGeometry args={[0.055, 0.12, 3]} /><meshStandardMaterial color="#c18170" /></mesh>
  return <mesh position={[0, 2.13, 0.39]} scale={kind === 'round' ? [1.25, 0.8, 0.75] : [0.8, 1, 0.7]}><sphereGeometry args={[0.06, 10, 7]} /><meshStandardMaterial color="#c18170" /></mesh>
}

function Mouth({ kind, animation }: { kind: string; animation: CharacterMotion }) {
  const speaking = animation === 'talk'
  const sad = animation === 'sad' || animation === 'tired'
  if (speaking || kind === 'open' || kind === 'tongue') return <group position={[0, 1.96, 0.375]}>
    <mesh scale={[1.35, speaking ? 1.2 : 1, 0.55]}><sphereGeometry args={[0.085, 14, 9]} /><meshStandardMaterial color="#743f4c" /></mesh>
    {kind === 'tongue' && <mesh position={[0, -0.045, 0.045]} scale={[1, 0.45, 0.45]}><sphereGeometry args={[0.07, 10, 6]} /><meshStandardMaterial color="#f08e9a" /></mesh>}
  </group>
  if (kind === 'pout') return <mesh position={[0, 1.98, 0.39]} scale={[1.4, 0.62, 0.55]}><sphereGeometry args={[0.07, 12, 7]} /><meshStandardMaterial color="#954d5c" /></mesh>
  return <group position={[0, sad ? 1.95 : 2, 0.39]} rotation={[0, 0, sad ? Math.PI : 0]}>
    <mesh position={[-0.052, 0, 0]} rotation={[0, 0, kind === 'cat' ? -0.75 : -0.52]}><capsuleGeometry args={[0.018, 0.09, 3, 8]} /><meshStandardMaterial color="#954d5c" /></mesh>
    <mesh position={[0.052, 0, 0]} rotation={[0, 0, kind === 'cat' ? 0.75 : 0.52]}><capsuleGeometry args={[0.018, 0.09, 3, 8]} /><meshStandardMaterial color="#954d5c" /></mesh>
  </group>
}

function Hair({ kind, color }: { kind: string; color: string }) {
  const material = <meshStandardMaterial color={color} roughness={0.82} />
  if (kind === 'bob') return <group>{[-1, 0, 1].map(step => <mesh key={step} position={[step * 0.29, 2.54 - Math.abs(step) * 0.1, 0]} scale={[0.85, 1.18, 0.85]}><sphereGeometry args={[0.39, 12, 8]} />{material}</mesh>)}<mesh position={[0, 2.72, -0.1]} scale={[1.1, 0.82, 0.92]}><sphereGeometry args={[0.47, 12, 8]} />{material}</mesh></group>
  if (kind === 'bun') return <group><mesh position={[0, 2.64, -0.08]} scale={[1.05, 0.8, 0.9]}><sphereGeometry args={[0.48, 12, 8]} />{material}</mesh><mesh position={[0.15, 3.05, -0.11]}><sphereGeometry args={[0.26, 10, 7]} />{material}</mesh></group>
  if (kind === 'sprout') return <group><mesh position={[0, 2.66, -0.08]} scale={[1.04, 0.76, 0.88]}><sphereGeometry args={[0.48, 12, 8]} />{material}</mesh><mesh position={[-0.06, 3.08, 0]} rotation={[0, 0, -0.5]} scale={[0.5, 1.2, 0.45]}><sphereGeometry args={[0.14, 9, 6]} />{material}</mesh><mesh position={[0.09, 3.08, 0]} rotation={[0, 0, 0.55]} scale={[0.5, 1.2, 0.45]}><sphereGeometry args={[0.14, 9, 6]} />{material}</mesh></group>
  if (kind === 'curls') return <group>{[[-.34,2.7],[-.16,2.88],[.08,2.92],[.31,2.76],[-.43,2.48],[.43,2.5],[-.35,2.28],[.36,2.3]].map(([x, y], index) => <mesh key={index} position={[x, y, index % 2 ? -0.04 : 0]}><sphereGeometry args={[0.23, 9, 6]} />{material}</mesh>)}</group>
  if (kind === 'shaggy') return <group><mesh position={[0, 2.65, -0.08]} scale={[1.05, 0.78, 0.9]}><sphereGeometry args={[0.48, 12, 8]} />{material}</mesh>{[-.32,-.16,0,.18,.35].map((x, index) => <mesh key={x} position={[x, 2.45 + (index % 2) * .08, .31]} rotation={[0, 0, x * 1.1]}><coneGeometry args={[.13,.35,5]} />{material}</mesh>)}</group>
  return <group><mesh position={[0, 2.66, -0.08]} scale={[1.04, 0.78, 0.9]}><sphereGeometry args={[0.48, 12, 8]} />{material}</mesh><mesh position={[0.16, 2.63, 0.31]} rotation={[0, 0, -0.5]} scale={[0.65, 1.45, 0.5]}><sphereGeometry args={[0.25, 10, 7]} />{material}</mesh></group>
}

function Accessory({ kind }: { kind: string }) {
  if (kind === 'glasses') return <group position={[0, 2.25, 0.36]}><mesh position={[-.18,0,0]}><torusGeometry args={[.13,.018,6,16]} /><meshStandardMaterial color="#514a54" /></mesh><mesh position={[.18,0,0]}><torusGeometry args={[.13,.018,6,16]} /><meshStandardMaterial color="#514a54" /></mesh><mesh rotation={[0,0,HALF_PI]}><capsuleGeometry args={[.012,.08,2,6]} /><meshStandardMaterial color="#514a54" /></mesh></group>
  if (kind === 'earrings') return <group>{[-.47,.47].map(x => <mesh key={x} position={[x,2.15,.02]}><torusGeometry args={[.055,.018,5,12]} /><meshStandardMaterial color="#f2b745" metalness={.25} /></mesh>)}</group>
  if (kind === 'headphones') return <group><mesh position={[0,2.58,-.01]} rotation={[HALF_PI,0,0]}><torusGeometry args={[.5,.055,7,20,Math.PI]} /><meshStandardMaterial color="#596078" /></mesh>{[-.49,.49].map(x => <mesh key={x} position={[x,2.42,0]} scale={[.6,1,1]}><sphereGeometry args={[.13,9,7]} /><meshStandardMaterial color="#596078" /></mesh>)}</group>
  if (kind === 'scarf') return <mesh position={[0,1.58,.02]} scale={[1.25,.5,.8]}><torusGeometry args={[.31,.11,7,18]} /><meshStandardMaterial color="#e89b62" /></mesh>
  if (kind === 'beanie') return <group><mesh position={[0,2.84,-.02]} scale={[1,.65,.9]}><sphereGeometry args={[.48,12,8]} /><meshStandardMaterial color="#6b8e82" /></mesh><mesh position={[0,2.68,.02]}><torusGeometry args={[.43,.07,6,18]} /><meshStandardMaterial color="#52766b" /></mesh></group>
  if (kind === 'frogclip') return <group position={[-.3,2.78,.38]}><mesh scale={[1.2,.8,.5]}><sphereGeometry args={[.12,9,6]} /><meshStandardMaterial color="#7cbd63" /></mesh>{[-.07,.07].map(x => <mesh key={x} position={[x,.1,0]}><sphereGeometry args={[.055,8,5]} /><meshStandardMaterial color="#7cbd63" /></mesh>)}</group>
  return null
}

function Torso({ outfit, color, skin }: { outfit: string; color: string; skin: string }) {
  const dark = shiftColor(color, -22)
  return <group>
    <mesh position={[0, 1.24, 0]} scale={outfit === 'playful' ? [1.12, .96, 1] : [1, 1, 1]}><capsuleGeometry args={[.39,.62,5,10]} /><meshStandardMaterial color={color} roughness={.82} /></mesh>
    {outfit === 'hoodie' && <><mesh position={[0,1.61,-.2]} rotation={[HALF_PI,0,0]}><torusGeometry args={[.3,.08,6,16,Math.PI]} /><meshStandardMaterial color={dark} /></mesh><mesh position={[-.08,1.27,.42]}><capsuleGeometry args={[.012,.18,2,5]} /><meshStandardMaterial color="#fff3db" /></mesh><mesh position={[.08,1.27,.42]}><capsuleGeometry args={[.012,.18,2,5]} /><meshStandardMaterial color="#fff3db" /></mesh></>}
    {(outfit === 'jacket' || outfit === 'blazer') && <><mesh position={[0,1.2,.42]}><boxGeometry args={[.035,.65,.025]} /><meshStandardMaterial color="#fff7e7" /></mesh><mesh position={[-.12,1.45,.42]} rotation={[0,0,-.55]}><boxGeometry args={[.2,.42,.025]} /><meshStandardMaterial color={dark} /></mesh><mesh position={[.12,1.45,.42]} rotation={[0,0,.55]}><boxGeometry args={[.2,.42,.025]} /><meshStandardMaterial color={dark} /></mesh></>}
    {outfit === 'overalls' && <><mesh position={[0,1.18,.42]}><boxGeometry args={[.52,.5,.035]} /><meshStandardMaterial color={dark} /></mesh>{[-.19,.19].map(x => <mesh key={x} position={[x,1.58,.42]}><capsuleGeometry args={[.035,.3,3,6]} /><meshStandardMaterial color={dark} /></mesh>)}</>}
    {outfit === 'playful' && <>{[-.18,.14].map((x,index) => <mesh key={x} position={[x,1.3 + index*.18,.4]} rotation={[0,0,.5]}><octahedronGeometry args={[.08,0]} /><meshStandardMaterial color="#fff2c6" /></mesh>)}</>}
    <mesh position={[0, 1.72, 0]}><cylinderGeometry args={[.16,.18,.2,10]} /><meshStandardMaterial color={skin} roughness={.9} /></mesh>
  </group>
}

function Leg({ x, color, kind, skin, legRef }: { x: number; color: string; kind: string; skin: string; legRef: React.RefObject<Group | null> }) {
  const wide = kind === 'wide' || kind === 'balloon' ? .24 : .19
  const short = kind === 'shorts' || kind === 'pleated'
  return <group ref={legRef} position={[x,.82,0]}>
    <mesh position={[0,-.38,0]} scale={kind === 'balloon' ? [1.18,1,.98] : [1,1,1]}><capsuleGeometry args={[wide,short?.25:.58,4,9]} /><meshStandardMaterial color={color} roughness={.86} /></mesh>
    {short && <mesh position={[0,-.78,0]}><capsuleGeometry args={[.13,.42,4,8]} /><meshStandardMaterial color={skin} /></mesh>}
    {kind === 'cargo' && <mesh position={[x < 0 ? -.18:.18,-.3,.12]}><boxGeometry args={[.16,.19,.09]} /><meshStandardMaterial color={shiftColor(color,18)} /></mesh>}
    <mesh position={[0,short?-.98:-1.02,.11]} scale={[1.35,.55,1.9]}><sphereGeometry args={[.17,10,7]} /><meshStandardMaterial color="#343c46" /></mesh>
  </group>
}

export function ProceduralCharacter3D({ avatar, animation = 'idle', detail = 'full', mirrored = false, name, position = [0, 0, 0], rotation = [0, 0, 0], scale = 1, seed }: Character3DProps) {
  const root = useRef<Group>(null)
  const body = useRef<Group>(null)
  const head = useRef<Group>(null)
  const leftArm = useRef<Group>(null)
  const rightArm = useRef<Group>(null)
  const leftLeg = useRef<Group>(null)
  const rightLeg = useRef<Group>(null)
  const eyes = useRef<Group>(null)
  const resolved = resolveAvatar(avatar)
  const pantsColor = resolved.pants === 'pleated' ? '#556477' : '#4f6170'
  const characterTilt = stableCharacterTilt(seed ?? name)

  useFrame(({ clock }, delta) => {
    const pose = getPose(animation, clock.elapsedTime + characterTilt * 50)
    const ease = Math.min(1, delta * 9)
    if (root.current) {
      root.current.position.y = MathUtils.lerp(root.current.position.y, pose.bob, ease)
      root.current.rotation.z = MathUtils.lerp(root.current.rotation.z, pose.lean + characterTilt, ease)
    }
    if (body.current) body.current.rotation.x = MathUtils.lerp(body.current.rotation.x, pose.lean, ease)
    if (head.current) head.current.rotation.z = MathUtils.lerp(head.current.rotation.z, pose.head, ease)
    if (leftArm.current) leftArm.current.rotation.x = MathUtils.lerp(leftArm.current.rotation.x, pose.leftArm, ease)
    if (rightArm.current) rightArm.current.rotation.x = MathUtils.lerp(rightArm.current.rotation.x, pose.rightArm, ease)
    if (leftLeg.current) leftLeg.current.rotation.x = MathUtils.lerp(leftLeg.current.rotation.x, pose.leftLeg, ease)
    if (rightLeg.current) rightLeg.current.rotation.x = MathUtils.lerp(rightLeg.current.rotation.x, pose.rightLeg, ease)
    if (eyes.current) {
      const phase = clock.elapsedTime % 4.7
      eyes.current.scale.y = phase > 4.55 ? .08 : 1
    }
  })

  const faceScale: [number, number, number] = resolved.face === 'oval' ? [.91,1.12,.94] : resolved.face === 'square' ? [1.02,.96,.9] : resolved.face === 'heart' ? [1.04,1,.88] : resolved.face === 'bean' ? [.98,1.04,.92] : [1,1,1]
  return <group position={position} rotation={rotation} scale={[mirrored ? -scale : scale, scale, scale]} name={name}>
    <group ref={root}>
      {detail !== 'head' && <group ref={body}>
        <Leg x={-.23} color={pantsColor} kind={resolved.pants} skin={resolved.skin} legRef={leftLeg} />
        <Leg x={.23} color={pantsColor} kind={resolved.pants} skin={resolved.skin} legRef={rightLeg} />
        <Torso outfit={resolved.outfit} color={resolved.outfitColor} skin={resolved.skin} />
        <group ref={leftArm} position={[-.43,1.55,0]} rotation={[0,0,-.16]}><mesh position={[0,-.38,0]}><capsuleGeometry args={[.13,.62,4,8]} /><meshStandardMaterial color={resolved.outfitColor} /></mesh><mesh position={[0,-.78,0]}><sphereGeometry args={[.14,10,7]} /><meshStandardMaterial color={resolved.skin} /></mesh></group>
        <group ref={rightArm} position={[.43,1.55,0]} rotation={[0,0,.16]}><mesh position={[0,-.38,0]}><capsuleGeometry args={[.13,.62,4,8]} /><meshStandardMaterial color={resolved.outfitColor} /></mesh><mesh position={[0,-.78,0]}><sphereGeometry args={[.14,10,7]} /><meshStandardMaterial color={resolved.skin} /></mesh></group>
      </group>}
      <group ref={head} position={[0, detail === 'head' ? 0 : 0, 0]}>
        <mesh position={[0,2.28,0]} scale={faceScale}><sphereGeometry args={[.48,14,10]} /><meshStandardMaterial color={resolved.skin} roughness={.9} /></mesh>
        <Hair kind={resolved.hair} color={resolved.hairColor} />
        <group ref={eyes} position={[0, 2.25, .342]}><Eye kind={resolved.eyes} x={-.18} /><Eye kind={resolved.eyes} x={.18} /></group>
        <Brows kind={resolved.brows} color={resolved.hairColor} />
        <Nose kind={resolved.nose} />
        <Mouth kind={resolved.mouth} animation={animation} />
        <Accessory kind={resolved.accessory} />
      </group>
    </group>
  </group>
}

class CharacterAssetBoundary extends Component<{
  children: ReactNode
  fallback: ReactNode
  resetKey: string
}, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('LingoLife character asset failed to render; using procedural fallback.', error, info.componentStack)
  }

  componentDidUpdate(previous: Readonly<{ resetKey: string }>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false })
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export function Character3D(props: Character3DProps) {
  const fallback = <ProceduralCharacter3D {...props} />
  const resetKey = `${props.avatar.model ?? 'chibi'}:${props.avatar.hair}:${props.avatar.outfit}:${props.avatar.accessory}`
  return <CharacterAssetBoundary fallback={fallback} resetKey={resetKey}>
    <Suspense fallback={fallback}>
      <AssetCharacter3D {...props} />
    </Suspense>
  </CharacterAssetBoundary>
}
