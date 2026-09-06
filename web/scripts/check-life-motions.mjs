import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
const bytes=readFileSync(new URL('../public/assets/life/motions/kaykit-life.json',import.meta.url))
const library=JSON.parse(bytes)
assert.equal(library.version,1)
assert.ok(bytes.length<600000)
const names=new Set()
for(const pack of library.packs)for(const clip of pack.clips){
 assert.ok(clip.duration>0)
 names.add(clip.name)
 const nodes=new Set(pack.nodes.map(node=>node.name))
 for(const track of clip.tracks){
  assert.ok(nodes.has(track.name.split('.')[0]))
  assert.ok(track.values.every(Number.isFinite)&&track.times.every(Number.isFinite))
  assert.ok(!track.name.endsWith('.scale'),'Do not transfer scale or bone lengths')
 }
}
for(const name of ['Sit_Chair_Down','Sit_Chair_Idle','Sit_Chair_StandUp','Waving','Use_Item','Holding_A','Holding_B','Working_A'])assert.ok(names.has(name))
assert.match(readFileSync(new URL('../public/assets/life/motions/License-KayKit.txt',import.meta.url),'utf8'),/CC0/)
console.log(`Life motion asset checks passed (${names.size} CC0 clips, ${bytes.length} bytes).`)
