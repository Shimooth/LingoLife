import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import { blinkAmount, characterFace, facePose, prepareCharacterFace, updateCharacterFace } from '../src/three/characters/facialGeometry.ts'

function modelFromGlb(path) {
  const bytes = readFileSync(path), length = bytes.readUInt32LE(12)
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + length)), binaryOffset = 28 + length
  function attribute(index) {
    const accessor = json.accessors[index], view = json.bufferViews[accessor.bufferView]
    const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type]
    const Constructor = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array, 5121: Uint8Array }[accessor.componentType]
    assert.ok(!view.byteStride, 'audit fixture expects packed authoring attributes')
    const values = new Constructor(bytes.buffer, bytes.byteOffset + binaryOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0), accessor.count * components)
    return new BufferAttribute(values.slice(), components)
  }
  const group = new Group()
  for (const node of json.nodes.filter(node => node.mesh !== undefined)) {
    for (const primitive of json.meshes[node.mesh].primitives) {
      assert.equal(primitive.targets, undefined, 'current assets have no authored facial morphs')
      const geometry = new BufferGeometry().setAttribute('position', attribute(primitive.attributes.POSITION))
      geometry.setIndex(attribute(primitive.indices))
      const material = new MeshStandardMaterial({ name: json.materials[primitive.material].name })
      const mesh = new Mesh(geometry, material)
      mesh.name = node.name
      group.add(mesh)
    }
  }
  return group
}

const files = readdirSync(new URL('../public/assets/models/characters/city/', import.meta.url)).filter(file => file.endsWith('.glb'))
const unsupported = new Set(['Character_4_1_1.glb', 'Character_6_2_2.glb', 'Character_Z_9.glb', 'PoliceMan_A_4_1.glb'])
let supported = 0
for (const file of [...files, 'chibi']) {
  const chibi = file === 'chibi'
  const path = new URL(`../public/assets/models/characters/${chibi ? 'chibi/all-in-one.glb' : `city/${file}`}`, import.meta.url)
  const model = modelFromGlb(path)
  const originals = model.children.map(mesh => ({ geometry: mesh.geometry, values: mesh.geometry.getAttribute('position').array.slice() }))
  prepareCharacterFace(model, chibi ? 'chibi' : 'city')
  const controller = characterFace(model)
  assert.equal(controller.surfaces.length, unsupported.has(file) ? 0 : 1, `${file}: only audited eye pairs may change`)
  if (controller.surfaces.length) supported++
  for (const expression of ['neutral', 'happy', 'displeased', 'sleepy', 'curious']) {
    updateCharacterFace(controller, expression, 1, .65, .8)
    for (const surface of controller.surfaces) {
      const selected = new Set(surface.regions.flatMap(region => region.indices))
      const position = surface.geometry.getAttribute('position')
      let changed = 0
      for (let i = 0; i < position.count; i++) {
        for (let axis = 0; axis < 3; axis++) {
          const value = position.getComponent(i, axis), original = surface.original[i * 3 + axis]
          assert.ok(Number.isFinite(value))
          if (chibi && axis === 1) assert.equal(value, original, 'Chibi eye sockets must never be exposed by flattening the eyes')
          if (!selected.has(i)) assert.equal(value, original, `${file}: facial animation must not alter skin, clothes or hair`)
          else if (value !== original) changed++
        }
      }
      assert.ok(changed > 0)
    }
  }
  if (chibi) {
    updateCharacterFace(controller, 'happy', 1, 1, 0)
    for (const surface of controller.surfaces) {
      assert.deepEqual(surface.geometry.getAttribute('position').array, surface.original, 'Chibi expression/blink must remain disabled until proper eyelids exist')
    }
  }
  updateCharacterFace(controller, 'neutral', 0, 0, 0)
  model.children.forEach((mesh, index) => {
    assert.deepEqual(originals[index].geometry.getAttribute('position').array, originals[index].values, 'GLTF shared geometry must never be mutated')
    assert.deepEqual(mesh.geometry.getAttribute('position').array, originals[index].values, 'neutral restore must be exact, not cumulative')
    assert.deepEqual(mesh.scale.toArray(), [1, 1, 1], 'no whole-mesh/head squash for blinking')
    mesh.geometry.dispose()
    originals[index].geometry.dispose()
    mesh.material.dispose()
  })
}
assert.equal(supported, 13, '12 city eye pairs + chibi, retaining four unsupported presets unchanged')
assert.equal(blinkAmount(.09, 0), 1)
assert.equal(blinkAmount(1, 0), 0)
assert.notEqual(blinkAmount(.09, 0), blinkAmount(.09, 1.5), 'residents must not blink in unison')
assert.ok(facePose('sleepy', 1).openness < facePose('neutral', 1).openness)
assert.notDeepEqual(facePose('curious', 1), facePose('curious', -1))
console.log(`Facial geometry checks passed: 12 City expression/blink pairs + Chibi gaze-only, four unchanged presets, five City expressions and isolated geometry.`)
