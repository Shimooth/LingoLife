import {readFileSync} from 'node:fs'

const source=readFileSync(new URL('../src/three/world/WorldScene.tsx',import.meta.url),'utf8')
const htmlTags=source.match(/<Html\b[^>]*>/g)??[]

if(htmlTags.length<3)throw new Error(`Expected at least 3 world Html overlays, found ${htmlTags.length}`)
const scaled=htmlTags.filter(tag=>/\bdistanceFactor\s*=/.test(tag))
if(scaled.length)throw new Error(`Orthographic world Html overlays must not use distanceFactor:\n${scaled.join('\n')}`)

console.log(`World overlay guard passed (${htmlTags.length} overlays).`)
