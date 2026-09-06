import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CHARACTER_PRESETS } from '../src/three/characters/characterAssets.ts'

let total = 0
for (const preset of CHARACTER_PRESETS) {
  const bytes = readFileSync(new URL(`../public/assets/portraits/characters/${preset.id}.webp`, import.meta.url))
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF')
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP')
  assert.ok(bytes.length < 20000, `${preset.id}: portrait exceeded its size budget`)
  total += bytes.length
}
assert.ok(total < 200000)
console.log(`Character portrait guard passed (${CHARACTER_PRESETS.length} real-model WebP images, ${total} bytes).`)
