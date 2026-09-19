import { AnimationClip, Color, Mesh, MeshStandardMaterial, Object3D, PropertyBinding, SkinnedMesh, type Group, type Material, type Skeleton } from 'three'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { AvatarConfig } from '../../types'
import { CHIBI_ACCESSORIES, CHIBI_HAIR, CHIBI_OUTFITS, resolveChibiAccessory, resolveChibiHair, resolveChibiOutfit } from './characterAssets'
import { prepareCharacterFace } from './facialGeometry'

export function disposeCharacterInstance(model: Group): void {
  const skeletons = new Set<Skeleton>()
  model.traverse(object => {
    if (!(object instanceof Mesh)) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    materials.forEach(material => material.dispose())
    if (object.geometry.userData.lingolifeFaceOwned) object.geometry.dispose()
    if (object instanceof SkinnedMesh) skeletons.add(object.skeleton)
  })
  skeletons.forEach(skeleton => skeleton.dispose())
  // GLTF geometry and textures are shared with other residents and must stay alive.
}

const optionalChibiNodes = new Set([
  ...CHIBI_HAIR.map((entry) => entry.node),
  ...CHIBI_OUTFITS.flatMap((entry) => entry.nodes),
  ...CHIBI_ACCESSORIES.flatMap((entry) => entry.nodes),
])

function cloneMaterial(material: Material): Material {
  const copy = material.clone()
  if (copy instanceof MeshStandardMaterial) {
    copy.roughness = /hair|eye|shoe/i.test(material.name) ? .62 : /skin|face/i.test(material.name) ? .76 : .88
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

export function prepareChibi(source: Group, avatar: Pick<AvatarConfig,'hair'|'hairColor'|'outfit'|'outfitColor'|'accessory'|'skin'>): Group {
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
  prepareCharacterFace(model, 'chibi')
  return model
}

export function prepareCity(source: Group, hairColor: string): Group {
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
  prepareCharacterFace(model, 'city')
  return model
}

export function clipsForModel(clips: readonly AnimationClip[], model: Group): AnimationClip[] {
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
