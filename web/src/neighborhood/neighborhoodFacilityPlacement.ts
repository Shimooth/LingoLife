import {BUILDING_LOTS,KAYKIT_ASSET_BASE,STREET_PROPS,TREES} from '../three/world/worldData.ts'
import {streetscapeObstacleFromAuthored,validateStreetscapeFootprint,type StreetscapeConstraints,type StreetscapeLayout} from '../three/world/streetscapeLayout.ts'
import {TOWN_CENTER,isTownCenterLayout} from '../three/world/townCenterLayout.ts'
import type {WorldLayoutDocument} from '../worldLayout.ts'

export type NeighborhoodPlot={id:string;position:[number,number];rotation:number}

/** The order depends on published geometry, never unlocks, roster order or time. */
export function resolveNeighborhoodPlots(constraints:StreetscapeConstraints,streetscape:StreetscapeLayout,worldLayout?:WorldLayoutDocument):(NeighborhoodPlot|undefined)[]{
 const authored=worldLayout?[...worldLayout.city.props,...worldLayout.city.decorations].map(streetscapeObstacleFromAuthored):[
  ...STREET_PROPS.map(item=>streetscapeObstacleFromAuthored({id:item.id,asset:`${KAYKIT_ASSET_BASE}/${item.model}.gltf`,position:{x:item.position[0],y:.37,z:item.position[1]},rotation:{x:0,y:item.rotation,z:0},scale:{x:item.scale,y:item.scale,z:item.scale}})),
  ...TREES.map(position=>({position,half:[.65,.65] as [number,number],rotation:0})),
 ]
 const obstacles=[...(constraints.obstacles??[]),...authored,...streetscape.planters,...streetscape.cafeTerraces.map(item=>item.footprint)]
 if(isTownCenterLayout(worldLayout)){
  return (['fountain','wardrobe'] as const).map(facility=>{
   const footprint=TOWN_CENTER.facilities[facility]
   // An authored obstruction is reported as unavailable, never silently moved
   // to an unrelated edge parcel. These two parcels belong to the town plan.
   if(validateStreetscapeFootprint(footprint,{...constraints,townCenter:true,obstacles},true))return undefined
   return {id:`town-${facility}`,position:footprint.position,rotation:footprint.rotation}
  })
 }
 const available=[...BUILDING_LOTS].sort((a,b)=>(Math.abs(a.position[0])+Math.abs(a.position[1]-10))-(Math.abs(b.position[0])+Math.abs(b.position[1]-10))||a.id.localeCompare(b.id))
 const selected:typeof available=[]
 for(const lot of available){
  const footprint={position:lot.position,half:[.99,.99] as [number,number],rotation:0}
  if(validateStreetscapeFootprint(footprint,{...constraints,obstacles}))continue
  selected.push(lot);obstacles.push(footprint)
  if(selected.length===2)break
 }
 return selected
}
