/** World dimensions use the visible standing residents, never a glTF scale
 * factor alone. Chibi is about .54 high; the tallest shipped City rig is .60. */
export const TOWN_RESIDENT_HEIGHT=.6
export const TOWN_WORLD_FLOOR=.369
export const TOWN_VEHICLE_SCALE=1.08
export const TOWN_VEHICLE_TIRE_MIN_Y=-.061042905
export const TOWN_ROAD_SURFACE_Y=.245+.07*1.3
export const vehiclePivotForSurface=(surfaceY:number,scale=TOWN_VEHICLE_SCALE)=>surfaceY-TOWN_VEHICLE_TIRE_MIN_Y*scale+.002

export type TownBuildingKind='home'|'cafe'|'community'
export const TOWN_BUILDING_DIMENSIONS:Readonly<Record<TownBuildingKind,{
 width:number;depth:number;wallHeight:number;roofHeight:number;doorWidth:number;doorHeight:number
}>>={
 home:{width:1.92,depth:1.55,wallHeight:1.75,roofHeight:2.22,doorWidth:.5,doorHeight:.81},
 cafe:{width:2.02,depth:1.54,wallHeight:1.09,roofHeight:1.53,doorWidth:.5,doorHeight:.81},
 community:{width:2.04,depth:1.54,wallHeight:1.13,roofHeight:1.41,doorWidth:.54,doorHeight:.84},
}
