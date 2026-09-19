import { BufferAttribute, BufferGeometry, Group, Mesh, type Object3D } from 'three'

export type FaceExpression = 'neutral' | 'happy' | 'displeased' | 'sleepy' | 'curious'
type EyeRegion = { indices: number[]; center: number[]; height: number; width: number; side: number }
type FaceSurface = { geometry: BufferGeometry; original: Float32Array; regions: EyeRegion[]; horizontal: 0 | 2 }
export type FaceController = { surfaces: FaceSurface[]; family: 'chibi' | 'city' }
const faces = new WeakMap<Object3D, FaceController>()

/** Position welding is only used to identify authored disconnected facial parts.
 * The render topology, UVs, skin weights, normals and source GLTF remain intact. */
export function connectedGeometryRegions(geometry: BufferGeometry): number[][] {
  const positions = geometry.getAttribute('position')
  const parents = Array.from({ length: positions.count }, (_, index) => index)
  const root = (index: number): number => parents[index] === index ? index : (parents[index] = root(parents[index]))
  const join = (a: number, b: number) => { parents[root(a)] = root(b) }
  const welded = new Map<string, number>()
  for (let index = 0; index < positions.count; index++) {
    const key = [positions.getX(index), positions.getY(index), positions.getZ(index)].map(value => value.toFixed(5)).join(',')
    const previous = welded.get(key)
    if (previous !== undefined) join(previous, index)
    else welded.set(key, index)
  }
  const indices = geometry.getIndex()
  for (let index = 0; index < (indices?.count ?? positions.count); index += 3) {
    const a = indices?.getX(index) ?? index
    join(a, indices?.getX(index + 1) ?? index + 1)
    join(a, indices?.getX(index + 2) ?? index + 2)
  }
  const regions = new Map<number, number[]>()
  parents.forEach((_, index) => {
    const key = root(index)
    const region = regions.get(key) ?? []
    region.push(index)
    regions.set(key, region)
  })
  return [...regions.values()]
}

function regionFor(geometry: BufferGeometry, indices: number[], horizontal: 0 | 2): EyeRegion {
  const positions = geometry.getAttribute('position')
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  indices.forEach(index => {
    for (let axis = 0; axis < 3; axis++) {
      const value = positions.getComponent(index, axis)
      min[axis] = Math.min(min[axis], value)
      max[axis] = Math.max(max[axis], value)
    }
  })
  const center = min.map((value, axis) => (value + max[axis]) / 2)
  return { indices, center, height: max[1] - min[1], width: max[horizontal] - min[horizontal], side: Math.sign(center[horizontal]) }
}

export function prepareCharacterFace(model: Group, family: 'chibi' | 'city'): void {
  const surfaces: FaceSurface[] = []
  model.traverse(object => {
    if (!(object instanceof Mesh)) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    const horizontal = family === 'city' ? 2 : 0
    let regions: EyeRegion[] = []
    if (family === 'chibi' && object.name === 'eyes') {
      // These are the two existing black eye meshes, not face/head vertices.
      const positions = object.geometry.getAttribute('position')
      regions = [-1, 1].map(side => regionFor(object.geometry,
        Array.from({ length: positions.count }, (_, index) => index).filter(index => Math.sign(positions.getX(index)) === side), horizontal))
    } else if (family === 'city' && materials.length === 1 && materials[0].name === 'City Atlas') {
      // Audited City Builder character eyes are discrete 28/38/48-vertex parts.
      // Glasses, helmets, facial hair, skin and eyes welded to a head are deliberately
      // unsupported: never deform a nearby part just to claim expression support.
      regions = connectedGeometryRegions(object.geometry)
        .filter(indices => [28, 38, 48].includes(indices.length))
        .map(indices => regionFor(object.geometry, indices, horizontal))
        .filter(region => region.center[0] < -.15 && region.center[1] > 1.28 && region.center[1] < 1.54
          && Math.abs(region.center[2]) > .055 && Math.abs(region.center[2]) < .17
          && region.width < .085 && region.height > .035 && region.height < .10)
    }
    // Only a confidently identified complete pair can be animated.
    if (regions.length !== 2 || regions[0].side === regions[1].side) return
    const geometry = object.geometry.clone()
    geometry.userData.lingolifeFaceOwned = true
    object.geometry = geometry
    surfaces.push({ geometry, original: Float32Array.from(geometry.getAttribute('position').array), regions, horizontal })
  })
  faces.set(model, { surfaces, family })
}

export function characterFace(model: Object3D): FaceController | undefined { return faces.get(model) }

export function facePose(expression: FaceExpression, side: number) {
  switch (expression) {
    case 'happy': return { openness: .58, slope: 0, curve: .22, lift: .05 }
    case 'displeased': return { openness: .62, slope: side * .30, curve: 0, lift: -.03 }
    case 'sleepy': return { openness: .38, slope: side * -.09, curve: 0, lift: -.08 }
    case 'curious': return { openness: side > 0 ? 1.13 : .72, slope: side > 0 ? -.1 : 0, curve: 0, lift: side > 0 ? .08 : 0 }
    default: return { openness: 1, slope: 0, curve: 0, lift: 0 }
  }
}

/** Stylised City eye shapes, not eyelid simulation or speech visemes. Edits are
 * in bind space so skinning follows the head. Chibi has exposed eye sockets:
 * shrinking its eye geometry reveals holes, so it only receives subtle gaze. */
export function updateCharacterFace(controller: FaceController, expression: FaceExpression, amount: number, blink: number, gaze: number): void {
  for (const surface of controller.surfaces) {
    const position = surface.geometry.getAttribute('position') as BufferAttribute
    for (const region of surface.regions) {
      const pose = facePose(expression, region.side)
      const openness = (1 + (pose.openness - 1) * amount) * (1 - .96 * blink)
      for (const index of region.indices) {
        const offset = index * 3
        const lateral = surface.original[offset + surface.horizontal] - region.center[surface.horizontal]
        const normalized = lateral / Math.max(.001, region.width / 2)
        const vertical = surface.original[offset + 1] - region.center[1]
        position.setComponent(index, surface.horizontal, surface.original[offset + surface.horizontal] + gaze * region.width * .065)
        position.setY(index, controller.family === 'chibi' ? surface.original[offset + 1]
          : region.center[1] + vertical * openness
            + amount * region.height * (pose.slope * normalized + pose.curve * (1 - normalized * normalized) + pose.lift) * (1 - blink))
      }
    }
    position.needsUpdate = true
  }
}

/** Each resident has its own quiet, non-synchronised blink interval. */
export function blinkAmount(time: number, phase: number): number {
  const period = 3.7 + (phase % 1.8)
  const elapsed = (time + phase) % period
  return elapsed < .18 ? Math.sin(Math.PI * elapsed / .18) ** 2 : 0
}
