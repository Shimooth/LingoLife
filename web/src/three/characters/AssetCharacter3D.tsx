import { useEffect, useMemo } from 'react'
import { useAnimations, useGLTF } from '@react-three/drei'
import { AnimationClip, Color, LoopOnce, LoopRepeat, Mesh, MeshStandardMaterial, Object3D, PropertyBinding, type AnimationMixerEventMap, type Group, type Material } from 'three'
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
) {
  const { actions, mixer } = useAnimations(clips, model)
  const candidates = family === 'chibi' ? CHIBI_CLIPS[motion] : CITY_CLIPS[motion]
  const clipName = stableChoice(candidates, `${seed ?? ''}:${motion}`)
  const idleName = stableChoice(family === 'chibi' ? CHIBI_CLIPS.idle : CITY_CLIPS.idle, `${seed ?? ''}:idle`)

  useEffect(() => {
    const action = actions[clipName]
    if (!action) return
    const idleAction = actions[idleName]
    let idleStarted = false
    const settleIntoIdle = (event: AnimationMixerEventMap['finished']) => {
      if (event.action !== action || !idleAction || idleAction === action) return
      idleAction.reset().fadeIn(.2).play()
      idleStarted = true
    }
    action.reset().fadeIn(.22)
    if (oneShotMotions.has(motion)) {
      action.setLoop(LoopOnce, 1)
      action.clampWhenFinished = false
      mixer.addEventListener('finished', settleIntoIdle)
    } else {
      action.setLoop(LoopRepeat, Infinity)
    }
    action.play()
    return () => {
      mixer.removeEventListener('finished', settleIntoIdle)
      action.fadeOut(.18)
      if (idleStarted) idleAction?.fadeOut(.18)
    }
  }, [actions, clipName, idleName, mixer, motion])
}

function AssetTransform({ children, family, props }: { children: React.ReactNode; family: 'chibi' | 'city'; props: Character3DProps }) {
  const baseScale = family === 'chibi' ? 1.08 : 1.92
  const rotationY = family === 'chibi' ? 0 : Math.PI
  const position = props.position ?? [0, 0, 0]
  const rotation = props.rotation ?? [0, 0, 0]
  const scale = (props.scale ?? 1) * baseScale
  return <group
    name={props.name}
    position={position}
    rotation={[rotation[0], rotation[1] + rotationY, rotation[2]]}
    scale={[props.mirrored ? -scale : scale, scale, scale]}
  >
    {children}
  </group>
}

function ChibiAssetCharacter(props: Character3DProps) {
  const preset = getCharacterPreset('chibi')
  const gltf = useGLTF(preset.url)
  const model = useMemo(
    () => prepareChibi(gltf.scene, props.avatar),
    [gltf.scene, props.avatar],
  )
  useCharacterAnimation(gltf.animations, model, props.animation ?? 'idle', 'chibi', props.seed ?? props.name)
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
  useCharacterAnimation(animationClips, model, props.animation ?? 'idle', 'city', props.seed ?? props.name)
  return <AssetTransform family="city" props={props}><primitive object={model} /></AssetTransform>
}

export function AssetCharacter3D(props: Character3DProps) {
  const preset = getCharacterPreset(props.avatar.model)
  return preset.family === 'city' ? <CityAssetCharacter {...props} /> : <ChibiAssetCharacter {...props} />
}
