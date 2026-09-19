/** Resolution/effects are presentation budgets, never simulation or asset identity. */
export type VisualTier = 0 | 1 | 2
export type QualityMode = 'auto' | 'low' | 'high'
export const VISUAL_BUDGETS = [
  { dpr: 1, shadowSize: 1024, postProcessing: false },
  { dpr: 1.25, shadowSize: 1024, postProcessing: false },
  { dpr: 1.65, shadowSize: 2048, postProcessing: true },
] as const

export type QualityHistory = { tier: VisualTier; healthyWindows: number; cooldown: number; upgrades: number }
export const initialQuality = (mode: QualityMode): QualityHistory => ({ tier: mode === 'low' ? 0 : mode === 'high' ? 2 : 1, healthyWindows: 0, cooldown: 0, upgrades: 0 })

/** Two-second windows, asymmetric thresholds and cooldown avoid visual pumping.
 * No touch-screen, user-agent or core-count exclusions: fast phones can qualify. */
export function advanceQuality(state: QualityHistory, p90Milliseconds: number): QualityHistory {
  if (!Number.isFinite(p90Milliseconds) || p90Milliseconds <= 0) return state
  if (p90Milliseconds > 27 && state.tier > 0) return { ...state, tier: (state.tier - 1) as VisualTier, healthyWindows: 0, cooldown: 8 }
  const cooldown = Math.max(0, state.cooldown - 1)
  const healthyWindows = p90Milliseconds < 19 && !cooldown ? state.healthyWindows + 1 : 0
  if (healthyWindows >= 4 && state.tier < 2 && state.upgrades < 2) return { tier: (state.tier + 1) as VisualTier, healthyWindows: 0, cooldown: 8, upgrades: state.upgrades + 1 }
  return { ...state, healthyWindows, cooldown }
}

export const STUDIO_LOOK = {
  exposure: 1.04,
  keyColor: '#fff0da', fillColor: '#bdd8e5', groundColor: '#807668',
  ambient: .3, hemisphere: .85, key: 2.7, fill: .65,
} as const
