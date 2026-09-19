import {sharedHomeDefaultPlacements} from './sharedHomeLayout'
import type {WorldLayoutInteriorPlacement} from '../../worldLayout'

export type DrinkPoint=[number,number,number]
export type SharedDrinkSeat={position:DrinkPoint;rotation:number;seatTopY:number;approach:DrinkPoint;exit:DrinkPoint}
export type SharedDrinkLayout={
 seats:[SharedDrinkSeat,SharedDrinkSeat]
 table:{position:DrinkPoint;topY:number;rotation:number;scale:DrinkPoint}
 cupRest:[DrinkPoint,DrinkPoint]
 target:DrinkPoint
 cameraPosition:DrinkPoint
 /** An edited room can move/remove furniture. Do not reach across the room or invent missing chairs. */
 usable:boolean
}

const point=(position:WorldLayoutInteriorPlacement['position']):DrinkPoint=>[position.x,position.y,position.z]
const localPoint=(position:DrinkPoint,rotation:number,scale:DrinkPoint,local:DrinkPoint):DrinkPoint=>{
 const x=local[0]*scale[0],z=local[2]*scale[2],c=Math.cos(rotation),s=Math.sin(rotation)
 return [position[0]+x*c+z*s,position[1]+local[1]*scale[1],position[2]-x*s+z*c]
}

/** The same authored furniture drives both the shared home and the close-up.
 * Heights are measured from the shipped KayKit geometry: seat cushion .485,
 * coffee table .5. No separate, arbitrarily-scaled encounter furniture. */
export function resolveSharedDrinkLayout(placements?:readonly WorldLayoutInteriorPlacement[]):SharedDrinkLayout{
 const defaults=sharedHomeDefaultPlacements('living_room')
 const find=(id:string)=>{
  const authored=placements?.find(item=>item.id===id),fallback=defaults.find(item=>item.id===id)!
  return authored?{position:point(authored.position),rotation:authored.rotation.y,scale:point(authored.scale),asset:authored.asset}:
   {position:[...fallback.position] as DrinkPoint,rotation:fallback.rotation,scale:[...fallback.scale] as DrinkPoint,asset:fallback.asset}
 }
 const coffee=find('living-coffee-table'),topY=coffee.position[1]+.5*coffee.scale[1]
 const seats=['living-chair-north','living-chair-south'].map((id,index)=>{
  const chair=find(id),position=localPoint(chair.position,chair.rotation,chair.scale,[0,0,.25])
  // Approach from the open side; the coffee table is never a walk-through waypoint.
  const side=index===0?1:-1
  return {position,rotation:chair.rotation,seatTopY:chair.position[1]+.485*chair.scale[1],
   approach:localPoint(chair.position,chair.rotation,chair.scale,[1.3*side,0,.25]),
   exit:localPoint(chair.position,chair.rotation,chair.scale,[2*side,0,.35])}
 }) as [SharedDrinkSeat,SharedDrinkSeat]
 const cupRest=seats.map(seat=>{
  const dx=seat.position[0]-coffee.position[0],dz=seat.position[2]-coffee.position[2],c=Math.cos(coffee.rotation),s=Math.sin(coffee.rotation)
  const localX=(dx*c-dz*s)/coffee.scale[0],localZ=(dx*s+dz*c)/coffee.scale[2]
  // Reserve a full cup radius inside the tabletop, even after authoring rotation/scale.
  const marginX=Math.min(1.1,.085/coffee.scale[0]),marginZ=Math.min(.65,.085/coffee.scale[2])
  return localPoint(coffee.position,coffee.rotation,coffee.scale,[Math.max(-1.2+marginX,Math.min(1.2-marginX,localX)),.5,Math.max(-.75+marginZ,Math.min(.75-marginZ,localZ))])
 }) as [DrinkPoint,DrinkPoint]
 const fixtures=['living-chair-north','living-chair-south','living-coffee-table']
 const present=!placements||fixtures.every(id=>placements.some(item=>item.id===id))
 const compatible=/table_low\.gltf$/.test(coffee.asset)&&['living-chair-north','living-chair-south'].every(id=>/armchair(?:_pillows)?\.gltf$/.test(find(id).asset))
 const usable=present&&compatible&&seats.every((seat,i)=>Math.hypot(seat.position[0]-cupRest[i][0],seat.position[2]-cupRest[i][2])<=.72&&Math.abs(topY-seat.seatTopY)<.35)
 const target:DrinkPoint=[coffee.position[0],.95,coffee.position[2]]
 return {seats,table:{position:coffee.position,topY,rotation:coffee.rotation,scale:coffee.scale},cupRest,target,
  cameraPosition:[target[0]+4.3,3.2,target[2]+5.2],usable}
}
