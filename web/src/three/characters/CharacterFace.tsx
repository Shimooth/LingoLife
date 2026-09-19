import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Vector3, type Group } from 'three'
import { blinkAmount, characterFace, updateCharacterFace, type FaceExpression } from './facialGeometry'
import type { Character3DProps } from './types'

function inferredExpression(props: Character3DProps): FaceExpression {
  if (props.faceExpression) return props.faceExpression
  if (props.animation === 'happy') return 'happy'
  if (props.animation === 'sad') return 'displeased'
  if (props.animation === 'tired') return 'sleepy'
  if (props.animation === 'look_around') return 'curious'
  return 'neutral'
}

export function CharacterFace({ model, props }: { model: Group; props: Character3DProps }) {
  const controller = characterFace(model)
  const expression = inferredExpression(props)
  const phase = useMemo(() => {
    let value = 0
    for (const letter of String(props.seed ?? props.name ?? 'resident')) value = (value * 31 + letter.charCodeAt(0)) >>> 0
    return (value % 1000) / 137
  }, [props.name, props.seed])
  const state = useRef({ time: 0, last: -1, gaze: 0, expression, amount: 0 })
  const position = useMemo(() => new Vector3(), [])
  useFrame(({ camera }, delta) => {
    if (!controller?.surfaces.length) return
    const current = state.current
    if (props.animationPaused) {
      if (current.last !== -2 || current.expression !== expression) updateCharacterFace(controller, expression, 1, 0, 0)
      current.expression = expression
      current.last = -2
      return
    }
    current.time += Math.min(delta, .1)
    // Face geometry is only useful near the camera. No per-vertex work for tiny
    // city residents, and at most 30 updates/s for close-up mobile scenes.
    model.getWorldPosition(position)
    if (camera.position.distanceToSquared(position) > 225) return
    if (current.time - current.last < 1 / 30) return
    const step = Math.min(.1, current.time - Math.max(0, current.last))
    current.last = current.time
    if (current.expression !== expression) {
      current.amount = Math.max(0, current.amount - step * 5)
      if (current.amount === 0) current.expression = expression
    } else current.amount = Math.min(1, current.amount + step * 4)
    const target = Math.max(-1, Math.min(1, props.faceAttention ?? 0))
    current.gaze += (target - current.gaze) * (1 - Math.exp(-step * 7))
    updateCharacterFace(controller, current.expression, current.amount,
      blinkAmount(current.time, phase), current.gaze)
  })
  return null
}
