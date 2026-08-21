import { Canvas } from '@react-three/fiber'
import { ContactShadows, PerspectiveCamera } from '@react-three/drei'
import type { AvatarConfig } from '../../types'
import { Character3D } from './Character3D'
import type { CharacterMotion } from './types'
import './characters.css'

export type CharacterCanvas3DProps = {
  avatar: AvatarConfig
  animation?: CharacterMotion
  view?: 'full' | 'portrait' | 'head'
  name?: string
  className?: string
  background?: string
  staticPreview?: boolean
}

export function CharacterCanvas3D({ avatar, animation = 'idle', view = 'full', name = 'Character', className = '', background = 'transparent', staticPreview = false }: CharacterCanvas3DProps) {
  const head = view === 'head'
  const portrait = view === 'portrait'
  const cameraPosition: [number, number, number] = head ? [0, 2.28, 4] : portrait ? [0, 1.84, 5.2] : [0, 1.43, 6]
  const fieldOfView = head ? 18 : portrait ? 28 : 31
  return <section className={`character-canvas-3d character-canvas-3d--${view} ${className}`.trim()} aria-label={`${name} 3D character preview`}>
    <Canvas dpr={[1, 1.75]} frameloop={staticPreview ? 'demand' : 'always'} gl={{ antialias: true, alpha: true }} style={{ background }}>
      <PerspectiveCamera makeDefault position={cameraPosition} fov={fieldOfView} near={0.1} far={100} />
      <ambientLight intensity={1.65} />
      <hemisphereLight args={['#fff7ec', '#826f70', 1.6]} />
      <directionalLight position={[-3, 6, 5]} intensity={2.2} color="#fff4df" />
      <directionalLight position={[4, 2, 3]} intensity={.75} color="#bdd5ff" />
      <Character3D avatar={avatar} animation={staticPreview ? 'idle' : animation} detail={head ? 'head' : portrait ? 'portrait' : 'full'} name={name} seed={name} />
      {!head && <ContactShadows position={[0, -.22, 0]} opacity={.24} scale={4.5} blur={2.5} far={3} />}
    </Canvas>
  </section>
}
