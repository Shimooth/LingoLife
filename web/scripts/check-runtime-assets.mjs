import {readFile,readdir,stat} from 'node:fs/promises'
import {dirname,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const publicRoot=fileURLToPath(new URL('../public',import.meta.url))
const cityCharacters=[
 'Character_1_2_2','Character_2_1_3','Character_3_2_3','Character_4_1_1',
 'Character_5_2_3','Character_5_3_1','Character_6_2_2','Character_8_3_1',
 'Character_9_3_4','Character_9_5_7','Character_10_4_3','Character_11_3_1',
 'Character_B_1','Character_Z_4','Character_Z_9','PoliceMan_A_4_1',
]
const worldModels=[
 'building_A','building_B','building_C','building_D','building_E','building_F','building_G','building_H',
 'road_straight','road_straight_crossing','road_junction','road_tsplit','road_corner','road_corner_curved',
 'base','streetlight','trafficlight_A','trafficlight_B','trafficlight_C',
 'bush','bench','watertower','firehydrant','dumpster','trash_A','trash_B','box_A','box_B',
 'car_sedan','car_taxi','car_police','car_hatchback','car_stationwagon',
]

async function requireFile(path){
 const details=await stat(path)
 if(!details.isFile()||details.size===0)throw new Error(`Missing or empty runtime asset: ${path}`)
}

const required=[
 'assets/models/characters/README.md',
 'assets/models/characters/chibi/all-in-one.glb',
 'assets/models/characters/city/animations/animations.glb',
 'assets/world/kaykit-city/LICENSE.txt',
 'assets/world/kaykit-city/README.md',
 'assets/life/interiors/README.md',
 'assets/life/ui/README.md',
 'assets/life/interiors/licenses/kaykit__KayKit_Furniture_Bits_Free__License.txt',
 'assets/life/interiors/licenses/kaykit__KayKit_Restaurant_Bits_Free__License.txt',
 'assets/life/interiors/licenses/tiny_treats__Tiny_Treats_Bubbly_Bathroom_Free_1.1__License.txt',
 'assets/life/interiors/licenses/tiny_treats__Tiny_Treats_Charming_Kitchen_Free_1.1__License.txt',
 'assets/life/interiors/licenses/tiny_treats__Tiny_Treats_House_Plants_Free__License.txt',
 'assets/life/interiors/licenses/tiny_treats__Tiny_Treats_Pretty_Park_Free__License.txt',
 'assets/life/ui/emotes/vector_style6.png',
 'assets/life/ui/emotes/vector_style6.xml',
 'assets/life/ui/vfx/star_01.png',
 'assets/life/ui/vfx/star_02.png',
 'assets/life/ui/vfx/spark_01.png',
 'assets/life/ui/vfx/smoke_03.png',
 'assets/life/ui/vfx/dirt_01.png',
 'assets/life/ui/licenses/kenney_emotes.txt',
 'assets/life/ui/licenses/kenney_particles.txt',
 ...cityCharacters.map(name=>`assets/models/characters/city/${name}.glb`),
]
await Promise.all(required.map(path=>requireFile(resolve(publicRoot,path))))

async function collectGltf(directory){
 const entries=await readdir(directory,{withFileTypes:true})
 const nested=await Promise.all(entries.map(entry=>{
  const path=resolve(directory,entry.name)
  if(entry.isDirectory())return collectGltf(path)
  return entry.isFile()&&entry.name.endsWith('.gltf')?[path]:[]
 }))
 return nested.flat()
}

async function validateGltf(gltfPath){
 await requireFile(gltfPath)
 const document=JSON.parse(await readFile(gltfPath,'utf8'))
 const externalUris=[...(document.buffers??[]),...(document.images??[])]
  .map(entry=>entry.uri)
  .filter(uri=>uri&&!uri.startsWith('data:'))
 await Promise.all(externalUris.map(uri=>requireFile(resolve(dirname(gltfPath),uri))))
}

for(const model of worldModels){
 const gltfPath=resolve(publicRoot,`assets/world/kaykit-city/gltf/${model}.gltf`)
 await validateGltf(gltfPath)
}

const interiorModels=await collectGltf(resolve(publicRoot,'assets/life/interiors'))
await Promise.all(interiorModels.map(validateGltf))

const indoorRenderer=await readFile(fileURLToPath(new URL('../src/three/interiors/IndoorEnvironment3D.tsx',import.meta.url)),'utf8')
if(!indoorRenderer.includes('class InteriorAssetBoundary'))throw new Error('Indoor assets need a render error boundary')
if(!indoorRenderer.includes('<Suspense fallback={<MissingInteriorAsset'))throw new Error('Indoor assets need per-model loading fallbacks')

const emoteAtlas=await readFile(resolve(publicRoot,'assets/life/ui/emotes/vector_style6.xml'),'utf8')
for(const emote of ['faceHappy','faceSad','faceAngry','heart','heartBroken','sleep','idea','music','question','stars']){
 if(!emoteAtlas.includes(`name="emote_${emote}.png"`))throw new Error(`Runtime emote atlas is missing ${emote}`)
}

console.log(`Runtime asset guard passed (${cityCharacters.length} character presets, ${worldModels.length} world models, ${interiorModels.length} interior models).`)
