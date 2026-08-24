import {readFile,stat} from 'node:fs/promises'
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
 ...cityCharacters.map(name=>`assets/models/characters/city/${name}.glb`),
]
await Promise.all(required.map(path=>requireFile(resolve(publicRoot,path))))

for(const model of worldModels){
 const gltfPath=resolve(publicRoot,`assets/world/kaykit-city/gltf/${model}.gltf`)
 await requireFile(gltfPath)
 const document=JSON.parse(await readFile(gltfPath,'utf8'))
 const externalUris=[...(document.buffers??[]),...(document.images??[])]
  .map(entry=>entry.uri)
  .filter(uri=>uri&&!uri.startsWith('data:'))
 await Promise.all(externalUris.map(uri=>requireFile(resolve(dirname(gltfPath),uri))))
}

console.log(`Runtime asset guard passed (${cityCharacters.length} character presets, ${worldModels.length} world models).`)
