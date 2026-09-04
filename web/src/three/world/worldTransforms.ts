export type WorldScaleVector={x:number;y:number;z:number}

export const MIN_BUILDING_SCALE=.1
export const MAX_BUILDING_SCALE=5

/**
 * City buildings are authored as uniformly scaled miniatures. Older layout
 * documents may contain a non-uniform vector, so use its median component as a
 * conservative scalar and never pass that vector into a building model.
 */
export const uniformBuildingScale=(scale:WorldScaleVector)=>{
 const components=[scale.x,scale.y,scale.z]
  .filter(value=>Number.isFinite(value)&&value>0)
  .sort((a,b)=>a-b)
 const value=components.length===3?components[1]:components[0]??1
 return Math.max(MIN_BUILDING_SCALE,Math.min(MAX_BUILDING_SCALE,value))
}

/** Stable, bounded pavement spacing for residents who share one parcel. */
export const residentSidewalkOffset=(index:number,count:number)=>{
 const safeCount=Math.max(1,Math.min(8,Math.round(Number.isFinite(count)?count:1)))
 const safeIndex=Math.max(0,Math.min(safeCount-1,Math.round(Number.isFinite(index)?index:0)))
 if(safeCount===1)return 0
 const spacing=Math.min(.42,2.6/(safeCount-1))
 return (safeIndex-(safeCount-1)/2)*spacing
}
