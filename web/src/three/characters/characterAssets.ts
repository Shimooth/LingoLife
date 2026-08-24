import type { AvatarConfig } from '../../types'
import type { CharacterMotion } from './types'

export type CharacterFamily = 'chibi' | 'city'

export type CharacterPreset = {
  id: string
  family: CharacterFamily
  url: string
  label: { zh: string; en: string }
}

export const CHIBI_MODEL_ID = 'chibi'
export const CITY_ANIMATION_URL = '/assets/models/characters/city/animations/animations.glb'

const cityFiles = [
  'Character_1_2_2',
  'Character_2_1_3',
  'Character_3_2_3',
  'Character_4_1_1',
  'Character_5_2_3',
  'Character_5_3_1',
  'Character_6_2_2',
  'Character_8_3_1',
  'Character_9_3_4',
  'Character_9_5_7',
  'Character_10_4_3',
  'Character_11_3_1',
  'Character_B_1',
  'Character_Z_4',
  'Character_Z_9',
  'PoliceMan_A_4_1',
] as const

export const CHARACTER_PRESETS: readonly CharacterPreset[] = [
  {
    id: CHIBI_MODEL_ID,
    family: 'chibi',
    url: '/assets/models/characters/chibi/all-in-one.glb',
    label: { zh: '奇趣换装角色', en: 'Mix-and-match chibi' },
  },
  ...cityFiles.map((file, index) => ({
    id: `city-${String(index + 1).padStart(2, '0')}`,
    family: 'city' as const,
    url: `/assets/models/characters/city/${file}.glb`,
    label: {
      zh: file.startsWith('Police') ? '城市警员' : `城市居民 ${String(index + 1).padStart(2, '0')}`,
      en: file.startsWith('Police') ? 'City officer' : `City resident ${String(index + 1).padStart(2, '0')}`,
    },
  })),
]

export const CHIBI_HAIR = [
  { id: 'hair-one', node: 'hairone', label: { zh: '圆润短发', en: 'Soft crop' } },
  { id: 'hair-t', node: 'hairT', label: { zh: '俏皮短发', en: 'Playful crop' } },
  { id: 'hair-tail', node: 'hairtail', label: { zh: '活力马尾', en: 'High ponytail' } },
  { id: 'knight-tail', node: 'hairtailknight', label: { zh: '骑士马尾', en: 'Knight ponytail' } },
  { id: 'hair-variant', node: 'hairvariant', label: { zh: '蓬松侧分', en: 'Fluffy side part' } },
  { id: 'hair-alt', node: 'hairvariant.001', label: { zh: '搞怪翘发', en: 'Quirky flick' } },
] as const

export const CHIBI_OUTFITS = [
  {
    id: 'student',
    nodes: ['shirt', 'skirt', 'shoe'],
    materials: ['schoolshirt', 'schoolskirt', 'schoolshoe'],
    label: { zh: '学院日常', en: 'Campus casual' },
  },
  {
    id: 'traveller',
    nodes: ['chemise', 'pants', 'bottes'],
    materials: ['thirdsuitchemise', 'thirdsuitpants', 'thirdsuitbottes'],
    label: { zh: '城市旅人', en: 'City traveller' },
  },
  {
    id: 'merchant',
    nodes: ['greenoutfit', 'greenoutfitbelt', 'greenoutfitneckless', 'bottesgreen'],
    materials: ['greenoutfit', 'greenbottes'],
    label: { zh: '活力店主', en: 'Lively merchant' },
  },
  {
    id: 'ninja',
    nodes: ['ninjassuit', 'ninjassuitshoe', 'ninjassuitthigh', 'ninjasuitshort'],
    materials: ['ninjasuit', 'ninjashort'],
    label: { zh: '神秘行动装', en: 'Mysterious action suit' },
  },
  {
    id: 'knight',
    nodes: ['amorarm', 'amorplastron', 'armorceinturethighs', 'armorknees', 'armorlegs', 'armorshoe', 'armorskirt', 'armorthigh'],
    materials: ['armorarm', 'armorplastron', 'armorlegs', 'armorshoe', 'armorskirt', 'armorthights'],
    label: { zh: '天空骑士', en: 'Sky knight' },
  },
] as const

export const CHIBI_ACCESSORIES = [
  { id: 'none', nodes: [], label: { zh: '无', en: 'None' } },
  { id: 'bag', nodes: ['bag'], label: { zh: '随身背包', en: 'Backpack' } },
  { id: 'hat', nodes: ['hat'], label: { zh: '旅行帽', en: 'Travel hat' } },
  { id: 'helmet', nodes: ['armorhelmet'], label: { zh: '骑士头盔', en: 'Knight helmet' } },
  { id: 'mask', nodes: ['ninjassuitmask'], label: { zh: '行动面罩', en: 'Action mask' } },
] as const

const legacyHair: Record<string, string> = {
  swoop: 'hair-variant',
  bob: 'hair-t',
  sprout: 'hair-one',
  bun: 'hair-tail',
  curls: 'hair-alt',
  shaggy: 'knight-tail',
  waves: 'hair-variant',
  pixie: 'hair-one',
  braids: 'knight-tail',
  curly: 'hair-alt',
  ponytail: 'hair-tail',
  locs: 'hair-alt',
  straight: 'hair-t',
  mohawk: 'hair-one',
}

const legacyOutfit: Record<string, string> = {
  jumper: 'student',
  sweater: 'student',
  tee: 'student',
  hoodie: 'traveller',
  cardigan: 'traveller',
  jacket: 'merchant',
  blazer: 'merchant',
  overalls: 'traveller',
  playful: 'ninja',
  dress: 'student',
}

const legacyAccessory: Record<string, string> = {
  beanie: 'hat',
  scarf: 'none',
  glasses: 'none',
  earrings: 'none',
  headphones: 'none',
  frogclip: 'none',
  hairclip: 'none',
  necklace: 'none',
  freckles: 'none',
}

export function getCharacterPreset(model?: string): CharacterPreset {
  return CHARACTER_PRESETS.find((entry) => entry.id === model) ?? CHARACTER_PRESETS[0]
}

export function getCharacterFamily(avatar: AvatarConfig): CharacterFamily {
  return getCharacterPreset(avatar.model).family
}

export function resolveChibiHair(value: string): string {
  const resolved = legacyHair[value] ?? value
  return CHIBI_HAIR.some((entry) => entry.id === resolved) ? resolved : CHIBI_HAIR[0].id
}

export function resolveChibiOutfit(value: string): string {
  const resolved = legacyOutfit[value] ?? value
  return CHIBI_OUTFITS.some((entry) => entry.id === resolved) ? resolved : CHIBI_OUTFITS[0].id
}

export function resolveChibiAccessory(value: string): string {
  const resolved = legacyAccessory[value] ?? value
  return CHIBI_ACCESSORIES.some((entry) => entry.id === resolved) ? resolved : CHIBI_ACCESSORIES[0].id
}

export const CITY_CLIPS: Record<CharacterMotion, readonly string[]> = {
  idle: ['Idle_A', 'Idle_B'],
  talk: ['Idle_A'],
  listen: ['LookingAround', 'Idle_B'],
  happy: ['Jump_C_Full', 'Jump_B_Full'],
  sad: ['Idle_B'],
  tired: ['Idle_B'],
  look_around: ['LookingAround'],
  walk: ['Walk_A', 'Walk_B', 'Walk_C'],
  run: ['Runing_A', 'Runing_B'],
  jump: ['Jump_B_Full', 'Jump_C_Full'],
  crouch: ['Idle_B'],
  push: ['LookingAround'],
}

export const CHIBI_CLIPS: Record<CharacterMotion, readonly string[]> = {
  idle: ['anim_iddle', 'anim_iddle.001'],
  talk: ['anim_iddle.001'],
  listen: ['anim_iddle'],
  happy: ['anim_jump', 'anim_flip'],
  sad: ['anim_crouchiddle'],
  tired: ['anim_crouchiddle'],
  look_around: ['anim_iddle.001'],
  walk: ['anim_walk'],
  run: ['anim_run'],
  jump: ['anim_jump'],
  crouch: ['anim_crouchiddle', 'anim_crouch'],
  push: ['anim_push'],
}

export function stableChoice(values: readonly string[], seed?: string | number): string {
  if (values.length === 1) return values[0]
  const source = String(seed ?? 'lingolife')
  let hash = 0
  for (let index = 0; index < source.length; index += 1) hash = (hash * 31 + source.charCodeAt(index)) | 0
  return values[Math.abs(hash) % values.length]
}
