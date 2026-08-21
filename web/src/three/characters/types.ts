import type { AvatarConfig, Message } from '../../types'

export type CharacterMotion =
  | 'idle'
  | 'walk'
  | 'talk'
  | 'listen'
  | 'happy'
  | 'sad'
  | 'tired'

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
  liveSpeech?: SpeechLine | null
  messages?: Message[]
  language?: 'zh' | 'en'
  showTranslation?: boolean
  onTranslationChange?: (visible: boolean) => void
  className?: string
  reducedMotion?: boolean
  sceneryMode?: boolean
}
