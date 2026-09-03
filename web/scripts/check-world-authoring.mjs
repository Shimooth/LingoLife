import {readFile} from 'node:fs/promises'
import {
 WORLD_LAYOUT_CITY_ASSETS,
 WORLD_LAYOUT_INTERIOR_ASSETS,
 emptyWorldLayout,
 isWorldLayoutDocument,
} from '../src/worldLayout.ts'

const fail=message=>{throw new Error(`World authoring guard failed: ${message}`)}
const cityRoot='/assets/world/kaykit-city/gltf'
const interiorRoot='/assets/life/interiors'
const paths=(root,names)=>names.map(name=>`${root}/${name}.gltf`)
const expectedCity=new Set([
 ...paths(cityRoot,['road_straight','road_straight_crossing','road_junction','road_tsplit','road_corner','road_corner_curved']),
 ...paths(cityRoot,[...'ABCDEFGH'].map(letter=>`building_${letter}`)),
 ...paths(cityRoot,['base','streetlight','trafficlight_A','trafficlight_B','trafficlight_C','bench','watertower','firehydrant','dumpster','trash_A','trash_B','box_A','box_B','car_sedan','car_taxi','car_police','car_hatchback','car_stationwagon']),
 `${cityRoot}/bush.gltf`,
 ...paths(interiorRoot,['park/tree','park/bush','park/bench','park/fountain','plants/monstera_plant_medium_potted']),
])
const expectedInterior=new Set(paths(interiorRoot,[
 'furniture/armchair_pillows','furniture/bed_single_A','furniture/couch_pillows','furniture/lamp_standing','furniture/rug_rectangle_A','furniture/shelf_B_large_decorated','furniture/table_low',
 'kitchen/chair','kitchen/countertop_sink','kitchen/floor_tiles_kitchen','kitchen/fridge','kitchen/kettle','kitchen/stove','kitchen/table_A',
 'bathroom/bath','bathroom/cabinet_bathroom','bathroom/floor_tiled','bathroom/mirror','bathroom/shower','bathroom/toilet',
 'restaurant/dishrack_plates','restaurant/food_burger','restaurant/food_dinner','restaurant/plate',
 'plants/monstera_plant_medium_potted','park/bench','park/bush','park/fountain','park/tree',
]))

const actualCity=new Set(Object.values(WORLD_LAYOUT_CITY_ASSETS).flat().map(item=>item.asset))
const actualInterior=new Set(WORLD_LAYOUT_INTERIOR_ASSETS.map(item=>item.asset))
const missing=(expected,actual)=>[...expected].filter(value=>!actual.has(value))
const extra=(expected,actual)=>[...actual].filter(value=>!expected.has(value))
if(missing(expectedCity,actualCity).length||extra(expectedCity,actualCity).length)fail('the city palette differs from the backend asset allowlist')
if(missing(expectedInterior,actualInterior).length||extra(expectedInterior,actualInterior).length)fail('the interior palette differs from the backend asset allowlist')
if(WORLD_LAYOUT_CITY_ASSETS.decorations.some(item=>item.defaultY<.3))fail('a city decoration starts below the platform surface')
if(WORLD_LAYOUT_CITY_ASSETS.buildings.some(item=>item.defaultScale>1.2))fail('a new building overlaps the 2.6m road grid at its default scale')

const empty=emptyWorldLayout()
if(!isWorldLayoutDocument(empty))fail('the default empty document fails import validation')
if(isWorldLayoutDocument({...empty,city:{...empty.city,roads:[{id:'broken'}]}}))fail('a malformed placement passes import validation')

const editor=await readFile(new URL('../src/components/AdminWorldLayoutEditor.tsx',import.meta.url),'utf8')
if(!editor.includes('CITY_BOUNDS={width:78,depth:44}'))fail('the editor clips the published sky-road exits')
if(!editor.includes('LAYERS.find(cityLayer=>'))fail('3D preview selection no longer resolves the selected city layer')
if(!editor.includes('isWorldLayoutDocument(candidate)'))fail('JSON imports are no longer structurally quarantined')
if(!editor.includes("?2.6:.25"))fail('new authored road/building positions no longer use the runtime grid')

const api=await readFile(new URL('../src/api.ts',import.meta.url),'utf8')
if(!api.includes('validationMessage(detail)'))fail('FastAPI validation details are no longer surfaced to the editor')
const admin=await readFile(new URL('../src/AdminApp.tsx',import.meta.url),'utf8')
if(admin.indexOf('if(!authenticated)return')>admin.indexOf('<AdminWorldLayoutEditor/>'))fail('world authoring renders before admin authentication')

console.log(`World authoring guard passed (${actualCity.size} city assets, ${actualInterior.size} interior assets, admin-only published layout).`)
