import { Suspense, useEffect, useMemo, useRef } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { AnimationMixer, LoopOnce, LoopRepeat, MathUtils, type AnimationClip, type AnimationAction, type AnimationMixerEventMap, type Group } from 'three'
import { clipsForModel, disposeCharacterInstance, prepareChibi, prepareCity } from './characterModel'
import {
  CHIBI_CLIPS,
  CITY_ANIMATION_URL,
  CITY_CLIPS,
  getCharacterPreset,
  stableChoice,
} from './characterAssets'
import type { Character3DProps, CharacterMotion } from './types'
import {LifeRigAnimation} from './LifeRigAnimation'
import {LifeHandProp} from './LifeHandProp'

const oneShotMotions = new Set<CharacterMotion>(['happy', 'jump', 'push'])
const cityJumpSequences = {
  a: ['Jump_A_Start', 'Jump_A_InAir', 'Jump_A_Landing'],
  b: ['Jump_B_Full'],
  bParts: ['Jump_B_Start', 'Jump_B_InAir', 'Jump_B_Landing'],
  c: ['Jump_C_Full'],
  cParts: ['Jump_C_Start', 'Jump_C_InAir', 'Jump_C_Landing'],
} as const
// Model preparation is shared by live avatars and compressed portraits.

function useCharacterAnimation(
  clips: AnimationClip[],
  model: Group,
  motion: CharacterMotion,
  family: 'chibi' | 'city',
  seed?: string | number,
  performanceKey?: string | number,
  loopOverride?: boolean,
  speed = 1,
  transitionMs = 220,
  paused = false,
) {
  // Actions must belong to this skeleton, including when only a Chibi outfit changes.
  // useAnimations caches actions by clip name and can retain the previous root.
  const mixer = useMemo(() => new AnimationMixer(model), [model])
  const actions = useMemo(() => {
    const bound: Record<string, AnimationAction> = {}
    clips.forEach(clip => Object.defineProperty(bound, clip.name, { get: () => mixer.clipAction(clip, model) }))
    return bound
  }, [clips, mixer, model])
  useFrame((_, delta) => { if (!paused) mixer.update(Math.min(delta, .05)) })
  useEffect(() => () => {
    mixer.stopAllAction()
    mixer.uncacheRoot(model)
  }, [mixer, model])
  const previousMotion = useRef<CharacterMotion | undefined>(undefined)
  const candidates = family === 'chibi' && motion === 'crouch'
    ? (loopOverride === false ? ['anim_crouch'] : ['anim_crouchiddle'])
    : family === 'chibi' ? CHIBI_CLIPS[motion] : CITY_CLIPS[motion]
  const clipName = stableChoice(candidates, `${seed ?? ''}:${motion}:${performanceKey ?? ''}`)
  const idleName = stableChoice(family === 'chibi' ? CHIBI_CLIPS.idle : CITY_CLIPS.idle, `${seed ?? ''}:idle:${performanceKey ?? ''}`)
  const jumpSequenceKey = stableChoice(Object.keys(cityJumpSequences), `${seed ?? ''}:${motion}:${performanceKey ?? ''}:jump`) as keyof typeof cityJumpSequences
  const sequenceNames = useMemo<readonly string[]>(
    () => family === 'city' && (motion === 'jump' || motion === 'happy') && loopOverride !== true
      ? cityJumpSequences[jumpSequenceKey]
      : [clipName],
    [clipName, family, jumpSequenceKey, loopOverride, motion],
  )

  useEffect(() => {
    const sequence = sequenceNames.map(name => actions[name]).filter((action): action is AnimationAction => Boolean(action))
    const action = sequence[0]
    if (!action) return
    const settleName = family === 'chibi' && motion === 'crouch' ? 'anim_crouchiddle' : idleName
    const idleAction = actions[settleName]
    const transition = Math.max(0, Math.min(2.5, transitionMs / 1_000))
    const enteringFromCrouch = family === 'chibi' && previousMotion.current === 'crouch' && motion !== 'crouch'
    previousMotion.current = motion
    const exitCrouchAction = enteringFromCrouch ? actions.anim_uncrouch : undefined
    const started = new Set<AnimationAction>()
    let sequenceIndex = 0
    const settleIntoIdle = () => {
      if (!idleAction || idleAction === sequence[sequence.length - 1]) return
      idleAction.reset().setEffectiveTimeScale(Math.max(.2, speed * .88)).fadeIn(Math.max(.12, transition)).play()
      started.add(idleAction)
    }
    const startSequenceAction = (index: number) => {
      const next = sequence[index]
      if (!next) {
        settleIntoIdle()
        return
      }
      const sequenceContinues = index < sequence.length - 1
      const oneShot = sequenceContinues || loopOverride === false || (loopOverride === undefined && oneShotMotions.has(motion))
      next.reset().setEffectiveTimeScale(Math.max(.2, speed)).fadeIn(index ? Math.min(.1, transition) : transition)
      next.clampWhenFinished = false
      next.setLoop(oneShot ? LoopOnce : LoopRepeat, oneShot ? 1 : Infinity)
      next.play()
      started.add(next)
    }
    const onFinished = (event: AnimationMixerEventMap['finished']) => {
      if (event.action === exitCrouchAction) {
        startSequenceAction(0)
        return
      }
      if (event.action !== sequence[sequenceIndex]) return
      sequenceIndex += 1
      startSequenceAction(sequenceIndex)
    }
    mixer.addEventListener('finished', onFinished)
    if (exitCrouchAction) {
      exitCrouchAction.reset().setEffectiveTimeScale(Math.max(.2, speed)).fadeIn(Math.min(.12, transition)).setLoop(LoopOnce, 1).play()
      exitCrouchAction.clampWhenFinished = false
      started.add(exitCrouchAction)
    } else startSequenceAction(0)
    // Demand-rendered portraits still need one fully evaluated idle pose, not a T-pose.
    if (paused) mixer.update(.35)
    return () => {
      mixer.removeEventListener('finished', onFinished)
      started.forEach(startedAction => startedAction.fadeOut(Math.max(.1, transition * .8)))
    }
  }, [actions, family, idleName, loopOverride, mixer, motion, paused, performanceKey, sequenceNames, speed, transitionMs])
}

function AssetTransform({ children, family, props }: { children: React.ReactNode; family: 'chibi' | 'city'; props: Character3DProps }) {
  const performanceRoot = useRef<Group>(null)
  const baseScale = family === 'chibi' ? 1.08 : 1.92
  const rotationY = family === 'chibi' ? 0 : Math.PI
  const position = props.position ?? [0, 0, 0]
  const rotation = props.rotation ?? [0, 0, 0]
  const scale = (props.scale ?? 1) * baseScale
  const motionScale = props.motionScale ?? 1
  const phase = useMemo(() => {
    const source = String(props.seed ?? props.name ?? 'lingolife')
    let hash = 0
    for (let index = 0; index < source.length; index += 1) hash = (hash * 31 + source.charCodeAt(index)) | 0
    return Math.abs(hash % 628) / 100
  }, [props.name, props.seed])
  useFrame(({ clock }, delta) => {
    const root = performanceRoot.current
    if (!root) return
    if (props.animationPaused) return
    const time = clock.elapsedTime * (props.animationSpeed ?? 1) + phase
    const talk = props.animation === 'talk' ? 1 : 0
    const listen = props.animation === 'listen' ? 1 : 0
    const calm = props.animation === 'idle' || props.animation === 'sad' || props.animation === 'tired' ? 1 : 0
    const targetY = (Math.sin(time * 1.7) * .008 * calm + Math.sin(time * 2.4) * .012 * talk) * motionScale
    const targetX = (Math.sin(time * 2.1) * .012 * talk + Math.sin(time * 1.15) * .009 * listen) * motionScale
    const targetZ = (Math.sin(time * 1.6) * .018 * talk - .018 * listen) * motionScale
    const ease = 1 - Math.exp(-delta * 7)
    root.position.y = MathUtils.lerp(root.position.y, targetY, ease)
    root.rotation.x = MathUtils.lerp(root.rotation.x, targetX, ease)
    root.rotation.z = MathUtils.lerp(root.rotation.z, targetZ, ease)
  })
  return <group
    name={props.name}
    position={position}
    rotation={[rotation[0], rotation[1] + rotationY, rotation[2]]}
    scale={[props.mirrored ? -scale : scale, scale, scale]}
  >
    <group ref={performanceRoot}>{children}</group>
  </group>
}

function NativeAnimation({clips,model,family,props}:{clips:AnimationClip[];model:Group;family:'chibi'|'city';props:Character3DProps}) {
  useCharacterAnimation(clips, model, props.animation ?? 'idle', family, props.seed ?? props.name, props.animationKey, props.animationLoop, props.animationSpeed, props.animationTransitionMs, props.animationPaused)
  return null
}

function RigPlayback({clips,model,family,props}:{clips:AnimationClip[];model:Group;family:'chibi'|'city';props:Character3DProps}) {
 const native=<NativeAnimation clips={clips} model={model} family={family} props={props}/>
 return <>
  {props.lifeMotion?<Suspense fallback={native}><LifeRigAnimation model={model} family={family} motion={props.lifeMotion} attention={props.lifeAttention} handTarget={props.lifeHandTarget} paused={props.animationPaused}/></Suspense>:native}
  {props.lifeProp&&<LifeHandProp model={model} family={family} kind={props.lifeProp}/>}
 </>
}

function ChibiAssetCharacter(props: Character3DProps) {
  const preset = getCharacterPreset('chibi')
  const gltf = useGLTF(preset.url)
  const {hair,hairColor,outfit,outfitColor,accessory,skin}=props.avatar
  const model = useMemo(
    () => prepareChibi(gltf.scene, {hair,hairColor,outfit,outfitColor,accessory,skin}),
    [gltf.scene,hair,hairColor,outfit,outfitColor,accessory,skin],
  )
  useEffect(() => () => disposeCharacterInstance(model), [model])
  return <AssetTransform family="chibi" props={props}><primitive object={model} /><RigPlayback clips={gltf.animations} model={model} family="chibi" props={props}/></AssetTransform>
}

function CityAssetCharacter(props: Character3DProps) {
  const preset = getCharacterPreset(props.avatar.model)
  const gltf = useGLTF(preset.url)
  const animationGltf = useGLTF(CITY_ANIMATION_URL)
  const model = useMemo(
    () => prepareCity(gltf.scene, props.avatar.hairColor),
    [gltf.scene, props.avatar.hairColor],
  )
  useEffect(() => () => disposeCharacterInstance(model), [model])
  const animationClips = useMemo(() => clipsForModel(animationGltf.animations, model), [animationGltf.animations, model])
  return <AssetTransform family="city" props={props}><primitive object={model} /><RigPlayback clips={animationClips} model={model} family="city" props={props}/></AssetTransform>
}

export function AssetCharacter3D(props: Character3DProps) {
  const preset = getCharacterPreset(props.avatar.model)
  return preset.family === 'city' ? <CityAssetCharacter {...props} /> : <ChibiAssetCharacter {...props} />
}
