import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {isTownCenterLayout,TOWN_CENTER} from '../src/three/world/townCenterLayout.ts'
import {resolveNeighborhoodPlots} from '../src/neighborhood/neighborhoodFacilityPlacement.ts'
import {resolveStreetscapeLayout,streetscapeFootprintsOverlap,streetscapeObstacleFromAuthored,validateStreetscapeFootprint} from '../src/three/world/streetscapeLayout.ts'

const {layout}=JSON.parse(await readFile(new URL('./fixtures/city-published-layout.json',import.meta.url),'utf8'))
const townCenter=isTownCenterLayout(layout)
const constraints={
 townCenter,
 roads:layout.city.roads.map(item=>({id:item.id,model:item.asset.split('/').pop().replace('.gltf',''),position:[item.position.x,item.position.z],rotation:item.rotation.y,scale:Math.max(item.scale.x,item.scale.z)})),
 buildings:layout.city.buildings.map(item=>({id:item.id,position:[item.position.x,item.position.z],rotation:item.rotation.y,scale:Math.max(item.scale.x,item.scale.y,item.scale.z)})),
 landmarks:[],obstacles:[...layout.city.props,...layout.city.decorations].map(streetscapeObstacleFromAuthored),
}
const streetscape=resolveStreetscapeLayout(constraints)
const before=JSON.stringify({layout,constraints,streetscape})
const plots=resolveNeighborhoodPlots(constraints,streetscape,layout)
assert.equal(plots.filter(Boolean).length,2,'the published city has distinct legal fountain and wardrobe parcels')
const footprints=plots.map((plot,index)=>({position:plot.position,half:townCenter?TOWN_CENTER.facilities[index?'wardrobe':'fountain'].half:[.99,.99],rotation:plot.rotation}))
const allObstacles=[...constraints.obstacles,...streetscape.planters,...streetscape.cafeTerraces.map(item=>item.footprint)]
for(const footprint of footprints)assert.equal(validateStreetscapeFootprint(footprint,{...constraints,obstacles:allObstacles},townCenter),null,'facility clears roads, buildings, courtyards, authored props and street furniture')
assert.equal(streetscapeFootprintsOverlap(...footprints,.16),false,'unlocking the shop never overlaps the fountain')
assert.deepEqual(resolveNeighborhoodPlots({...constraints,roads:[...constraints.roads].reverse(),buildings:[...constraints.buildings].reverse(),obstacles:[...constraints.obstacles].reverse()},streetscape,layout),plots,'geometry iteration order cannot move unlocked facilities')
assert.equal(JSON.stringify({layout,constraints,streetscape}),before,'facility placement cannot move or rewrite published scenery')
const obstructed={...constraints,obstacles:[...constraints.obstacles,footprints[0]]}
const replacements=resolveNeighborhoodPlots(obstructed,streetscape,layout)
assert.ok(replacements.filter(Boolean).every(plot=>plot.id!==plots[0].id),'a new authored obstacle takes precedence over a preferred facility parcel')
const blocked={...constraints,obstacles:[{position:[0,0],half:[100,100],rotation:0}]}
assert.deepEqual(resolveNeighborhoodPlots(blocked,streetscape,layout).filter(Boolean),[],'an occupied city must never force a facility onto a road or building')
const legacy=structuredClone(layout);delete legacy.city.theme
const legacyPlots=resolveNeighborhoodPlots({...constraints,townCenter:false},streetscape,legacy)
assert.ok(legacyPlots.length>0&&legacyPlots.every(plot=>plot.id.startsWith('lot-')),'older published maps retain their available-parcel placement')
console.log(`Neighborhood placement passed (stable parcels ${plots.map(plot=>plot.id).join(', ')}, published geometry preserved, no unsafe fallback).`)
