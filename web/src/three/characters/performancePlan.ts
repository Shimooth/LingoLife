import type {
  CharacterMotion,
  CharacterPerformance,
  CharacterPerformanceMode,
  PerformanceBeat,
  PerformanceFacing,
  PerformanceRole,
} from './types'

const MOTIONS = new Set<CharacterMotion>([
  'idle', 'walk', 'talk', 'listen', 'happy', 'sad', 'tired', 'look_around',
  'run', 'jump', 'crouch', 'push',
])
const ROLES = new Set<PerformanceRole>(['establish', 'react', 'speak', 'listen', 'action', 'resolve', 'hold'])
const FACINGS = new Set<PerformanceFacing>(['player', 'camera', 'target', 'movement', 'free'])
const ONE_SHOT = new Set<CharacterMotion>(['happy', 'jump', 'crouch', 'push'])
const expressiveDuration = (motion: CharacterMotion, fallback: number) => motion === 'happy' || motion === 'jump' ? 3_200 : fallback

export type DirectedPerformancePlan = {
  beats: PerformanceBeat[]
  holdCue: CharacterMotion
  repeat: boolean
  authored: boolean
}

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value))
const finiteNumber = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback

function hashString(value: string | number): number {
  const source = String(value)
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function cue(value: unknown, fallback: CharacterMotion): CharacterMotion {
  return typeof value === 'string' && MOTIONS.has(value as CharacterMotion) ? value as CharacterMotion : fallback
}

function beat(
  motion: CharacterMotion,
  role: PerformanceRole,
  duration: number,
  options: Partial<Pick<PerformanceBeat, 'loop' | 'transition_ms' | 'facing' | 'energy'>> = {},
): PerformanceBeat {
  return {
    cue: motion,
    role,
    duration_ms: duration,
    loop: options.loop ?? !ONE_SHOT.has(motion),
    transition_ms: options.transition_ms ?? 260,
    facing: options.facing ?? 'free',
    energy: options.energy ?? .5,
  }
}

function normalizedBeat(value: unknown, fallbackCue: CharacterMotion): PerformanceBeat | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<PerformanceBeat>
  const motion = cue(candidate.cue, fallbackCue)
  const role = typeof candidate.role === 'string' && ROLES.has(candidate.role as PerformanceRole)
    ? candidate.role as PerformanceRole
    : 'action'
  const facing = typeof candidate.facing === 'string' && FACINGS.has(candidate.facing as PerformanceFacing)
    ? candidate.facing as PerformanceFacing
    : 'free'
  return beat(motion, role, clamp(finiteNumber(candidate.duration_ms, 1_800), 320, 20_000), {
    loop: typeof candidate.loop === 'boolean' ? candidate.loop : !ONE_SHOT.has(motion),
    transition_ms: clamp(finiteNumber(candidate.transition_ms, 240), 0, 2_500),
    facing,
    energy: clamp(finiteNumber(candidate.energy, .5), 0, 1),
  })
}

function fallbackBeats(mode: CharacterPerformanceMode, requested: CharacterMotion, seed: string | number, variant: number): PerformanceBeat[] {
  const jitter = hashString(`${seed}:${mode}`) % 700
  const stationaryRequested = mode !== 'journey' && (requested === 'walk' || requested === 'run') ? 'look_around' : requested
  const expressive = stationaryRequested === 'idle' || stationaryRequested === 'talk' || stationaryRequested === 'listen' ? 'look_around' : stationaryRequested

  if (mode === 'journey') {
    const travelCue = requested === 'run' ? 'run' : 'walk'
    return [
      beat(travelCue, 'action', 5_100 + jitter, { facing: 'movement', energy: travelCue === 'run' ? .88 : .62 }),
      beat(travelCue, 'action', 6_000 + (700 - jitter), { facing: 'movement', energy: travelCue === 'run' ? .82 : .55 }),
    ]
  }

  if (mode === 'event_pending') return [
    beat(expressive, 'establish', ONE_SHOT.has(expressive) ? expressiveDuration(expressive, 1_500) : 2_400, { facing: 'camera', energy: .68 }),
    beat('idle', 'hold', 3_200 + jitter, { facing: 'free', energy: .36 }),
    beat('look_around', 'react', 2_800, { facing: 'target', energy: .48 }),
    beat('idle', 'hold', 4_600 + (700 - jitter), { facing: 'free', energy: .32 }),
  ]

  if (mode === 'encounter') {
    const firstSpeaker = variant % 2 === 0
    return firstSpeaker ? [
      beat(expressive, 'react', ONE_SHOT.has(expressive) ? expressiveDuration(expressive, 1_500) : 2_000, { facing: 'target', energy: .7 }),
      beat('talk', 'speak', 3_000 + jitter, { facing: 'target', energy: .58 }),
      beat('listen', 'listen', 3_700, { facing: 'target', energy: .38 }),
      beat('idle', 'hold', 2_800, { facing: 'target', energy: .3 }),
    ] : [
      beat('listen', 'listen', 2_600 + jitter, { facing: 'target', energy: .38 }),
      beat(expressive, 'react', ONE_SHOT.has(expressive) ? expressiveDuration(expressive, 1_500) : 2_000, { facing: 'target', energy: .66 }),
      beat('talk', 'speak', 3_100, { facing: 'target', energy: .56 }),
      beat('idle', 'hold', 3_200, { facing: 'target', energy: .3 }),
    ]
  }

  if (mode === 'conversation_speak') return [
    beat('talk', 'speak', 3_300 + jitter, { facing: 'player', energy: .6 }),
    beat('talk', 'speak', 4_100 + (700 - jitter), { facing: 'player', energy: .48 }),
  ]

  if (mode === 'conversation_listen') return [
    beat('listen', 'listen', 3_700 + jitter, { facing: 'player', energy: .38 }),
    beat('idle', 'hold', 2_100, { facing: 'player', energy: .28 }),
    beat('listen', 'listen', 3_200, { facing: 'player', energy: .34 }),
    beat('look_around', 'react', 1_800, { facing: 'player', energy: .42 }),
  ]

  if (mode === 'conversation_react') return [
    beat(stationaryRequested === 'idle' ? 'talk' : stationaryRequested, 'react', ONE_SHOT.has(stationaryRequested) ? expressiveDuration(stationaryRequested, 1_700) : 2_300, { facing: 'player', energy: .72 }),
    beat('talk', 'speak', 3_000 + jitter, { facing: 'player', energy: .52 }),
    beat('listen', 'listen', 3_400, { facing: 'player', energy: .34 }),
  ]

  if (stationaryRequested === 'sad' || stationaryRequested === 'tired') return [
    beat(stationaryRequested, 'hold', 4_600 + jitter, { energy: stationaryRequested === 'tired' ? .16 : .24 }),
    beat('idle', 'hold', 2_400, { energy: .24 }),
    beat(stationaryRequested, 'hold', 4_100 + (700 - jitter), { energy: .2 }),
  ]
  if (stationaryRequested !== 'idle' && stationaryRequested !== 'talk' && stationaryRequested !== 'listen') return [
    beat(stationaryRequested, 'react', ONE_SHOT.has(stationaryRequested) ? expressiveDuration(stationaryRequested, 1_500) : 2_100, { energy: .68 }),
    beat('idle', 'hold', 4_300 + jitter, { energy: .34 }),
    beat('look_around', 'react', 2_600, { energy: .42 }),
    beat('idle', 'hold', 5_200 + (700 - jitter), { energy: .3 }),
  ]
  return [
    beat('idle', 'hold', 4_200 + jitter, { energy: .3 }),
    beat('look_around', 'react', 2_700, { energy: .44 }),
    beat('idle', 'hold', 5_300 + (700 - jitter), { energy: .27 }),
    beat('listen', 'listen', 2_400, { energy: .34 }),
  ]
}

export function createPerformancePlan({
  performance,
  mode,
  fallbackCue = 'idle',
  seed = 'lingolife',
  variant = 0,
}: {
  performance?: CharacterPerformance | null | unknown
  mode: CharacterPerformanceMode
  fallbackCue?: CharacterMotion
  seed?: string | number
  variant?: number
}): DirectedPerformancePlan {
  if (performance && typeof performance === 'object') {
    const candidate = performance as Partial<CharacterPerformance>
    const holdCue = cue(candidate.hold_cue, fallbackCue)
    const beats = Array.isArray(candidate.beats)
      ? candidate.beats.slice(0, 12).map(value => normalizedBeat(value, fallbackCue)).filter((value): value is PerformanceBeat => Boolean(value))
      : []
    // A finite ambient plan such as walk -> idle is unsafe while the actor's
    // world transform is still travelling: the feet stop but the body glides.
    // Journey choreography is accepted only when every visible beat and the
    // final hold are locomotion clips.
    const journeySafe = mode !== 'journey'
      || ((holdCue === 'walk' || holdCue === 'run') && beats.every(item => item.cue === 'walk' || item.cue === 'run'))
    if (beats.length && journeySafe) {
      const directedBeats = mode === 'journey' ? beats : beats.map(item => item.cue === 'walk' || item.cue === 'run'
        ? {...item,cue:'look_around' as const,role:'react' as const,loop:true}
        : item)
      const directedHold = mode !== 'journey' && (holdCue === 'walk' || holdCue === 'run') ? 'idle' : holdCue
      return { beats: directedBeats, holdCue: directedHold, repeat: false, authored: true }
    }
  }
  const beats = fallbackBeats(mode, fallbackCue, seed, variant)
  return {
    beats,
    holdCue: mode === 'journey' ? (fallbackCue === 'run' ? 'run' : 'walk') : mode === 'conversation_speak' ? 'talk' : mode === 'conversation_listen' ? 'listen' : 'idle',
    repeat: mode !== 'conversation_react',
    authored: false,
  }
}

export const PERFORMANCE_MOTIONS = MOTIONS
