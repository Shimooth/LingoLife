import assert from 'node:assert/strict'
import {TOWN_BUILDING_DIMENSIONS,TOWN_RESIDENT_HEIGHT,TOWN_ROAD_SURFACE_Y,TOWN_VEHICLE_SCALE,TOWN_VEHICLE_TIRE_MIN_Y,vehiclePivotForSurface} from '../src/three/world/townScale.ts'
for(const [kind,d] of Object.entries(TOWN_BUILDING_DIMENSIONS)){
 assert.ok(d.doorWidth>=.45,`${kind}: doorway fits resident shoulders`)
 assert.ok(d.doorHeight-.044>=TOWN_RESIDENT_HEIGHT*1.25,`${kind}: tallest resident retains 25% headroom above finished floor`)
 assert.ok(d.width<2.4&&d.depth<2.4)

}
for(const surface of [TOWN_ROAD_SURFACE_Y,.369])assert.ok(Math.abs(vehiclePivotForSurface(surface)+TOWN_VEHICLE_TIRE_MIN_Y*TOWN_VEHICLE_SCALE-surface-.002)<1e-8,'Real tire geometry must sit 2 mm above surface')
assert.ok(.418960884*TOWN_VEHICLE_SCALE/.78<.65,'Sedan retains room in one lane')
console.log('Town scale passed: three building envelopes, tallest-resident clearance, parcel shell, shared vehicle scale and wheel grounding.')
