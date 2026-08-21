import type { AvatarConfig } from '../../types'

export const hairAliases: Record<string, string> = {
  waves: 'swoop',
  pixie: 'sprout',
  braids: 'shaggy',
  curly: 'curls',
  ponytail: 'bun',
  locs: 'curls',
  straight: 'bob',
  mohawk: 'sprout',
}

export const outfitAliases: Record<string, string> = {
  sweater: 'jumper',
  dress: 'playful',
  tee: 'jumper',
  cardigan: 'jacket',
}

const eyeAliases: Record<string, string> = { round: 'dot', soft: 'oval', wide: 'sparkle' }
const browAliases: Record<string, string> = { soft: 'tiny' }
const noseAliases: Record<string, string> = { long: 'triangle', wide: 'round' }
const mouthAliases: Record<string, string> = { soft: 'smile', bold: 'open', tiny: 'pout' }

export type ResolvedAvatar = Omit<AvatarConfig, 'pants'> & { pants: string }

export function resolveAvatar(avatar: AvatarConfig): ResolvedAvatar {
  return {
    ...avatar,
    hair: hairAliases[avatar.hair] ?? avatar.hair,
    eyes: eyeAliases[avatar.eyes] ?? avatar.eyes,
    brows: browAliases[avatar.brows] ?? avatar.brows,
    nose: noseAliases[avatar.nose] ?? avatar.nose,
    mouth: mouthAliases[avatar.mouth] ?? avatar.mouth,
    outfit: outfitAliases[avatar.outfit] ?? avatar.outfit,
    pants: avatar.pants ?? 'balloon',
  }
}

export function shiftColor(hex: string, amount: number): string {
  const clean = hex.replace('#', '')
  if (!/^[\da-f]{6}$/i.test(clean)) return hex
  const value = Number.parseInt(clean, 16)
  const part = (offset: number) => Math.max(0, Math.min(255, ((value >> offset) & 255) + amount))
  return `#${[part(16), part(8), part(0)].map(channel => channel.toString(16).padStart(2, '0')).join('')}`
}

export function stableCharacterTilt(seed: string | number | undefined): number {
  const source = String(seed ?? 'lingolife')
  let hash = 0
  for (let index = 0; index < source.length; index += 1) hash = (hash * 31 + source.charCodeAt(index)) | 0
  return ((Math.abs(hash) % 9) - 4) * 0.008
}

