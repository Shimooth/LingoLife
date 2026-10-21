import config from '../../../../config/town-center.json' with {type:'json'}
import type {WorldLayoutDocument} from '../../worldLayout.ts'
import type {BuildingLot,WorldPoint} from './worldData.ts'

type Point2=[number,number]
type TownCenterConfig={
 theme:'resident-town-v1'
 plaza:{location_id:string;entrance:Point2;center:Point2;bounds:{min:Point2;max:Point2};paving:{position:Point2;half:Point2};clearance:number}
 facilities:Record<'fountain'|'wardrobe',{position:Point2;rotation:number;half:Point2}>
 building_roles:Record<string,'home'|'cafe'|'community'|'plaza'>
 relocations:Record<string,{position:Point2;rotation:number}>
 walkways:{id:string;points:Point2[];width:number}[]
 building_envelope:{half:Point2;ground_y:number;scale:number}
 camera:{target:WorldPoint;position:WorldPoint}
 pedestrian:{road_portal:{position:Point2;road_position:Point2;corners:['sw','se']};destinations:Record<string,{position:Point2;rotation:number}>;resident_radius:number}
}
/** One shared source for published geometry, rendering and runtime walking. */
export const TOWN_CENTER=config as unknown as TownCenterConfig
export const isTownCenterLayout=(layout?:WorldLayoutDocument|null)=>layout?.city.theme===TOWN_CENTER.theme

export function townDestination(lot:BuildingLot){
 return Object.entries(TOWN_CENTER.pedestrian.destinations).find(([id])=>{
  const placement=TOWN_CENTER.relocations[id]
  return lot.id===id||lot.id===`published-${id}`||Boolean(placement&&Math.hypot(lot.position[0]-placement.position[0],lot.position[1]-placement.position[1])<.01)
 })?.[1]
}
/** Local residents stand by the real front door or in the open plaza. */
export function townStandingPosition(lot:BuildingLot,lateralOffset=0,y=.375):WorldPoint|undefined{
 const destination=townDestination(lot)
 if(!destination)return undefined
 // Preserve all eight evenly spaced roster slots instead of clamping several
 // neighbours onto the same endpoint. Route endpoints use this same mapping.
 const lateral=Math.max(-1.3,Math.min(1.3,Number.isFinite(lateralOffset)?lateralOffset:0))*.57
 return [destination.position[0]+Math.cos(destination.rotation)*lateral,y,destination.position[1]-Math.sin(destination.rotation)*lateral]
}

export const TOWN_CENTER_RESERVE={position:[0,5.3] as Point2,half:[6.5,3.8] as Point2,rotation:0}
