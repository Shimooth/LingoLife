import type { AvatarConfig, Message } from '../../types'
import type {WorldLayoutInteriorPlacement} from '../../worldLayout'
import type {LifeMotion} from './lifeRetarget'

export type CharacterMotion =
  | 'idle'
  | 'walk'
  | 'talk'
  | 'listen'
  | 'happy'
  | 'sad'
  | 'tired'
  | 'look_around'
  | 'run'
  | 'jump'
  | 'crouch'
  | 'push'

export type PerformanceRole =
  | 'establish'
  | 'react'
  | 'speak'
  | 'listen'
  | 'action'
  | 'resolve'
  | 'hold'

export type PerformanceFacing = 'player' | 'camera' | 'target' | 'movement' | 'free'

export type PerformanceBeat = {
  cue: CharacterMotion
  role: PerformanceRole
  duration_ms: number
  loop: boolean
  transition_ms: number
  facing: PerformanceFacing
  energy: number
}

export type CharacterPerformance = {
  version: 1
  hold_cue: CharacterMotion
  beats: PerformanceBeat[]
}

export type CharacterPerformanceMode =
  | 'ambient'
  | 'event_pending'
  | 'journey'
  | 'encounter'
  | 'conversation_speak'
  | 'conversation_listen'
  | 'conversation_react'

export type CharacterDetail = 'full' | 'portrait' | 'head'

export type Character3DProps = {
  avatar: AvatarConfig
  animation?: CharacterMotion
  detail?: CharacterDetail
  mirrored?: boolean
  name?: string
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: number
  seed?: string | number
  animationKey?: string | number
  animationLoop?: boolean
  animationSpeed?: number
  animationPaused?: boolean
  lifeMotion?: LifeMotion
  lifeAttention?: number
  lifeHandTarget?: [number,number,number]
  lifeProp?: 'cup'|'spoon'|'utensil'|'book'|'cloth'
  /** Stable frame-updated pose, used only for authored contact performances. */
  lifePerformancePose?: {time:number;handTarget?:[number,number,number];seatHeight?:number;seatWeight?:number;bodyLean?:number}
  faceExpression?: 'neutral'|'happy'|'displeased'|'sleepy'|'curious'
  faceAttention?: number
  faceSpeaking?: boolean
  animationTransitionMs?: number
  motionScale?: number
}

export type SpeechLine = {
  key?: string | number
  speaker: 'player' | 'npc'
  text: string
  translation?: string
  streaming?: boolean
}

export type ConversationAtmosphere =
  | 'home'
  | 'cafe'
  | 'park'
  | 'harbor'
  | 'office'
  | 'evening'
  | 'neutral'

export type ConversationStage3DProps = {
  npcAvatar: AvatarConfig
  playerAvatar?: AvatarConfig
  showPlayerAvatar?: boolean
  npcName: string
  playerName?: string
  place?: string
  locationKind?: string
  atmosphere?: ConversationAtmosphere
  npcAnimation?: CharacterMotion
  playerAnimation?: CharacterMotion
  performance?: CharacterPerformance | null
  performanceKey?: string | number
  liveSpeech?: SpeechLine | null
  messages?: Message[]
  language?: 'zh' | 'en'
  showTranslation?: boolean
  onTranslationChange?: (visible: boolean) => void
  className?: string
  reducedMotion?: boolean
  sceneryMode?: boolean
  interiorPlacements?: readonly WorldLayoutInteriorPlacement[]
}
