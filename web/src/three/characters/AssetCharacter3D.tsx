import { useEffect, useMemo, useRef } from 'react'
import { useAnimations, useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { AnimationClip, Color, LoopOnce, LoopRepeat, MathUtils, Mesh, MeshStandardMaterial, Object3D, PropertyBinding, type AnimationAction, type AnimationMixerEventMap, type Group, type Material } from 'three'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { AvatarConfig } from '../../types'
import {
  CHIBI_ACCESSORIES,
  CHIBI_CLIPS,
  CHIBI_HAIR,
  CHIBI_OUTFITS,
  CITY_ANIMATION_URL,
  CITY_CLIPS,
  getCharacterPreset,
  resolveChibiAccessory,
  resolveChibiHair,
  resolveChibiOutfit,
  stableChoice,
} from './characterAssets'
import type { Character3DProps, CharacterMotion } from './types'

const oneShotMotions = new Set<CharacterMotion>(['happy', 'jump', 'push'])
const cityJumpSequences = {
  a: ['Jump_A_Start', 'Jump_A_InAir', 'Jump_A_Landing'],
  b: ['Jump_B_Full'],
  bParts: ['Jump_B_Start', 'Jump_B_InAir', 'Jump_B_Landing'],
  c: ['Jump_C_Full'],
  cParts: ['Jump_C_Start', 'Jump_C_InAir', 'Jump_C_Landing'],
} as const
const optionalChibiNodes = new Set([
  ...CHIBI_HAIR.map((entry) => entry.node),
  ...CHIBI_OUTFITS.flatMap((entry) => entry.nodes),
  ...CHIBI_ACCESSORIES.flatMap((entry) => entry.nodes),
])

function cloneMaterial(material: Material): Material {
  const copy = material.clone()
  if (copy instanceof MeshStandardMaterial) {
    copy.roughness = Math.max(copy.roughness, .82)
    copy.metalness = 0
  }
  return copy
}

function cloneCharacter(source: Group): Group {
  const model = cloneSkeleton(source) as Group
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return
    object.castShadow = true
    object.receiveShadow = true
    object.frustumCulled = false
    object.material = Array.isArray(object.material)
      ? object.material.map(cloneMaterial)
      : cloneMaterial(object.material)
  })
  return model
}

function materialList(object: Object3D): Material[] {
  const found: Material[] = []
  object.traverse((child) => {
    if (!(child instanceof Mesh)) return
    found.push(...(Array.isArray(child.material) ? child.material : [child.material]))
  })
  return found
}

function tintObject(object: Object3D | undefined, color: string, soften = 0): void {
  if (!object) return
  const tint = new Color(color)
  if (soften) tint.lerp(new Color('#ffffff'), soften)
  materialList(object).forEach((material) => {
    if ('color' in material && material.color instanceof Color) material.color.copy(tint)
  })
}

function prepareChibi(source: Group, avatar: AvatarConfig): Group {
  const model = cloneCharacter(source)
  const hair = CHIBI_HAIR.find((entry) => entry.id === resolveChibiHair(avatar.hair)) ?? CHIBI_HAIR[0]
  const outfit = CHIBI_OUTFITS.find((entry) => entry.id === resolveChibiOutfit(avatar.outfit)) ?? CHIBI_OUTFITS[0]
  const accessory = CHIBI_ACCESSORIES.find((entry) => entry.id === resolveChibiAccessory(avatar.accessory)) ?? CHIBI_ACCESSORIES[0]

  optionalChibiNodes.forEach((name) => {
    const object = model.getObjectByName(name)
    if (object) object.visible = false
  })

  if (accessory.id !== 'helmet') {
    const hairObject = model.getObjectByName(hair.node)
    if (hairObject) hairObject.visible = true
    tintObject(hairObject, avatar.hairColor, .08)
  }
  outfit.nodes.forEach((name) => {
    const object = model.getObjectByName(name)
    if (object) object.visible = true
    tintObject(object, avatar.outfitColor, .34)
  })
  accessory.nodes.forEach((name) => {
    const object = model.getObjectByName(name)
    if (object) object.visible = true
  })
  tintObject(model.getObjectByName('character_low'), avatar.skin, .5)
  return model
}

function prepareCity(source: Group, hairColor: string): Group {
  const model = cloneCharacter(source)
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    materials.forEach((material) => {
      if (material.name === 'Hair' && 'color' in material && material.color instanceof Color) {
        material.color.copy(new Color(hairColor).lerp(new Color('#ffffff'), .16))
      }
    })
  })
  return model
}

function clipsForModel(clips: readonly AnimationClip[], model: Group): AnimationClip[] {
  return clips.map((clip) => new AnimationClip(
    clip.name,
    clip.duration,
    clip.tracks.filter((track) => {
      const nodeName = PropertyBinding.parseTrackName(track.name).nodeName
      return !nodeName || Boolean(model.getObjectByName(nodeName))
    }),
    clip.blendMode,
  ))
}

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
) {
  const { actions, mixer } = useAnimations(clips, model)
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
    return () => {
      mixer.removeEventListener('finished', onFinished)
      started.forEach(startedAction => startedAction.fadeOut(Math.max(.1, transition * .8)))
    }
  }, [actions, family, idleName, loopOverride, mixer, motion, performanceKey, sequenceNames, speed, transitionMs])
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

function ChibiAssetCharacter(props: Character3DProps) {
  const preset = getCharacterPreset('chibi')
  const gltf = useGLTF(preset.url)
  const model = useMemo(
    () => prepareChibi(gltf.scene, props.avatar),
    [gltf.scene, props.avatar],
  )
  useCharacterAnimation(gltf.animations, model, props.animation ?? 'idle', 'chibi', props.seed ?? props.name, props.animationKey, props.animationLoop, props.animationSpeed, props.animationTransitionMs)
  return <AssetTransform family="chibi" props={props}><primitive object={model} /></AssetTransform>
}

function CityAssetCharacter(props: Character3DProps) {
  const preset = getCharacterPreset(props.avatar.model)
  const gltf = useGLTF(preset.url)
  const animationGltf = useGLTF(CITY_ANIMATION_URL)
  const model = useMemo(
    () => prepareCity(gltf.scene, props.avatar.hairColor),
    [gltf.scene, props.avatar.hairColor],
  )
  const animationClips = useMemo(() => clipsForModel(animationGltf.animations, model), [animationGltf.animations, model])
  useCharacterAnimation(animationClips, model, props.animation ?? 'idle', 'city', props.seed ?? props.name, props.animationKey, props.animationLoop, props.animationSpeed, props.animationTransitionMs)
  return <AssetTransform family="city" props={props}><primitive object={model} /></AssetTransform>
}

export function AssetCharacter3D(props: Character3DProps) {
  const preset = getCharacterPreset(props.avatar.model)
  return preset.family === 'city' ? <CityAssetCharacter {...props} /> : <ChibiAssetCharacter {...props} />
}
