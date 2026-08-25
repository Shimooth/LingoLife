import { useEffect, useMemo, useState } from 'react'
import { Character3D } from './Character3D'
import { createPerformancePlan, type DirectedPerformancePlan } from './performancePlan'
import type {
  Character3DProps,
  CharacterMotion,
  CharacterPerformance,
  CharacterPerformanceMode,
  PerformanceBeat,
} from './types'

type PlaybackProps = {
  plan: DirectedPerformancePlan
  planKey: string
  reducedMotion: boolean
  playbackRate: number
  characterProps: Character3DProps
}

function holdBeat(cue: CharacterMotion): PerformanceBeat {
  return {
    cue,
    role: 'hold',
    duration_ms: Number.POSITIVE_INFINITY,
    loop: true,
    transition_ms: 320,
    facing: 'free',
    energy: .28,
  }
}

function PerformancePlayback({ plan, planKey, reducedMotion, playbackRate, characterProps }: PlaybackProps) {
  const [cursor, setCursor] = useState(0)
  const beat = reducedMotion
    ? holdBeat(plan.holdCue === 'walk' || plan.holdCue === 'run' || plan.holdCue === 'jump' ? 'idle' : plan.holdCue)
    : plan.beats[cursor] ?? holdBeat(plan.holdCue)

  useEffect(() => {
    if (reducedMotion || !Number.isFinite(beat.duration_ms)) return
    const timer = window.setTimeout(() => {
      setCursor(current => current + 1 < plan.beats.length ? current + 1 : plan.repeat ? 0 : plan.beats.length)
    }, beat.duration_ms)
    return () => window.clearTimeout(timer)
  }, [beat.cue, beat.duration_ms, beat.role, cursor, plan.beats.length, plan.repeat, reducedMotion])

  return <Character3D
    {...characterProps}
    animation={beat.cue}
    animationKey={`${planKey}:${cursor}:${beat.role}`}
    animationLoop={beat.loop}
    animationSpeed={reducedMotion ? .72 : (.78 + beat.energy * .46) * playbackRate}
    animationTransitionMs={reducedMotion ? 0 : beat.transition_ms}
    motionScale={reducedMotion ? 0 : .38 + beat.energy * .72}
  />
}

export type DirectedCharacter3DProps = Omit<Character3DProps, 'animationKey' | 'animationLoop' | 'animationSpeed' | 'animationTransitionMs' | 'motionScale'> & {
  performance?: CharacterPerformance | null | unknown
  performanceMode: CharacterPerformanceMode
  performanceKey?: string | number
  performanceVariant?: number
  reducedMotion?: boolean
  playbackRate?: number
}

export function DirectedCharacter3D({
  performance,
  performanceMode,
  performanceKey = 'default',
  performanceVariant = 0,
  reducedMotion = false,
  playbackRate = 1,
  animation = 'idle',
  seed,
  ...characterProps
}: DirectedCharacter3DProps) {
  const plan = useMemo(() => createPerformancePlan({
    performance,
    mode: performanceMode,
    fallbackCue: animation,
    seed: seed ?? characterProps.name ?? 'lingolife',
    variant: performanceVariant,
  }), [animation, characterProps.name, performance, performanceMode, performanceVariant, seed])
  const planFingerprint = plan.beats.map(beat => `${beat.cue}.${beat.role}.${beat.duration_ms}.${beat.loop ? 1 : 0}.${beat.transition_ms}.${beat.facing}.${beat.energy}`).join('|')
  const planKey = `${performanceKey}:${performanceMode}:${animation}:${plan.authored ? 'authored' : 'fallback'}:${plan.holdCue}:${planFingerprint}`
  return <PerformancePlayback
    key={planKey}
    plan={plan}
    planKey={planKey}
    reducedMotion={reducedMotion}
    playbackRate={Math.max(.4, Math.min(1.8, playbackRate))}
    characterProps={{ ...characterProps, animation, seed }}
  />
}
