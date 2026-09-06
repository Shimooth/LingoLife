import { AmbientLight, AnimationMixer, Box3, DirectionalLight, Group, HemisphereLight, Mesh, OrthographicCamera, Scene, Vector3, WebGLRenderer } from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { AvatarConfig } from '../../types'
import { CITY_ANIMATION_URL, getCharacterPreset } from './characterAssets'
import { clipsForModel, disposeCharacterInstance, prepareChibi, prepareCity } from './characterModel'

// One offscreen renderer, serialized work, small WebP output. Never one Canvas per card.
const results = new Map<string, string>()
const pending = new Map<string, Promise<string>>()
const sources = new Map<string, Promise<GLTF>>()
let queue: Promise<unknown> = Promise.resolve()
let renderer: WebGLRenderer | undefined
let releaseTimer: ReturnType<typeof setTimeout> | undefined

export function portraitKey(avatar: AvatarConfig): string {
  const preset = getCharacterPreset(avatar.model)
  return JSON.stringify(preset.family === 'city'
    ? [preset.id, avatar.hairColor]
    : [preset.id, avatar.hair, avatar.hairColor, avatar.skin, avatar.outfit, avatar.outfitColor, avatar.accessory])
}

function source(url: string): Promise<GLTF> {
  let request = sources.get(url)
  if (!request) {
    request = new GLTFLoader().loadAsync(url).catch(error => { sources.delete(url); throw error })
    sources.set(url, request)
  }
  return request
}

async function renderPortrait(avatar: AvatarConfig): Promise<string> {
  const preset = getCharacterPreset(avatar.model)
  const gltf = await source(preset.url)
  const animationGltf = preset.family === 'city' ? await source(CITY_ANIMATION_URL) : gltf
  const model = preset.family === 'city' ? prepareCity(gltf.scene, avatar.hairColor) : prepareChibi(gltf.scene, avatar)
  const mixer = new AnimationMixer(model)
  const scene = new Scene()
  const turn = new Group()
  turn.rotation.y = preset.family === 'city' ? Math.PI + .12 : .12
  turn.add(model)
  scene.add(turn)
  try {
    const clips = clipsForModel(animationGltf.animations, model)
    const clip = clips.find(item => item.name === (preset.family === 'city' ? 'Idle_A' : 'anim_iddle'))
    if (clip) { mixer.clipAction(clip).play(); mixer.update(.35) }
    scene.updateMatrixWorld(true)
    const bounds = new Box3()
    // Hidden modular clothes must not affect framing. Include the evaluated skinned pose.
    model.traverseVisible(object => {
      if (!(object instanceof Mesh)) return
      if ('computeBoundingBox' in object && typeof object.computeBoundingBox === 'function') object.computeBoundingBox()
      object.geometry.computeBoundingBox()
      const box = 'boundingBox' in object && object.boundingBox instanceof Box3 ? object.boundingBox : object.geometry.boundingBox
      if (box) bounds.union(box.clone().applyMatrix4(object.matrixWorld))
    })
    const size = bounds.getSize(new Vector3()), center = bounds.getCenter(new Vector3())
    const height = Math.max(size.y * 1.16, size.x * 256 / 216 * 1.16, .1)
    const camera = new OrthographicCamera(-height * 216 / 256 / 2, height * 216 / 256 / 2, height / 2, -height / 2, .01, 100)
    camera.position.set(center.x, center.y + size.y * .035, center.z + Math.max(5, size.z * 4))
    camera.lookAt(center)
    scene.add(new AmbientLight('#ffffff', 1.65), new HemisphereLight('#fff7ec', '#826f70', 1.6))
    const key = new DirectionalLight('#fff4df', 2.2); key.position.set(-3, 6, 5); scene.add(key)
    const fill = new DirectionalLight('#bdd5ff', .75); fill.position.set(4, 2, 3); scene.add(fill)
    clearTimeout(releaseTimer)
    renderer ??= new WebGLRenderer({ alpha: true, antialias: true })
    renderer.setSize(216, 256, false)
    renderer.setClearColor(0x000000, 0)
    renderer.render(scene, camera)
    return renderer.domElement.toDataURL('image/webp', .82)
  } finally {
    mixer.stopAllAction(); mixer.uncacheRoot(model)
    disposeCharacterInstance(model)
    // Geometry/textures belong to the cached GLTF; only cloned materials are ours.
    releaseTimer = setTimeout(() => { renderer?.dispose(); renderer?.forceContextLoss(); renderer = undefined }, 2000)
  }
}

export function getCharacterPortrait(avatar: AvatarConfig): Promise<string> {
  const key = portraitKey(avatar)
  const hit = results.get(key)
  if (hit) return Promise.resolve(hit)
  const existing = pending.get(key)
  if (existing) return existing
  const request = queue.then(() => renderPortrait(avatar)).then(url => {
    results.set(key, url)
    if (results.size > 96) results.delete(results.keys().next().value!)
    return url
  }).finally(() => pending.delete(key))
  pending.set(key, request)
  queue = request.catch(() => {})
  return request
}
