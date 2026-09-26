import {CITY_PLATFORM_OUTLINE,ROAD_TILE_SCALE,type RoadTilePlacement,type WorldPoint} from './worldData.ts'
import type {WorldLayoutPlacement} from '../../worldLayout.ts'
import type {SharedDrinkLayout} from '../interiors/sharedDrinkLayout.ts'

type Point2=readonly [number,number]
export type StreetscapeFootprint={position:Point2;half:Point2;rotation:number}
export type StreetscapeBuilding={id?:string;position:Point2;rotation:number;scale:number}
export type StreetscapeLandmark=StreetscapeBuilding&{locationId:string;kind:string}
export type StreetscapeConstraints={
 roads:readonly (RoadTilePlacement&{scale?:number})[]
 buildings:readonly StreetscapeBuilding[]
 landmarks:readonly StreetscapeLandmark[]
 /** Include authored decorations and props, not just the default map. */
 obstacles?:readonly StreetscapeFootprint[]
 characterRoutes?:readonly {points:readonly WorldPoint[]}[]
 characterPositions?:readonly Point2[]
}
export type StreetscapePaving={id:string;position:[number,number];half:[number,number];rotation:number;tone:'stone'|'warm'}
export type StreetscapePlanter={id:string;position:[number,number];rotation:number;half:[number,number];tree:boolean}
export type CafeTerrace={locationId:string;position:WorldPoint;rotation:number;scale:number;footprint:StreetscapeFootprint;rig:SharedDrinkLayout}
export type StreetscapeLayout={paving:StreetscapePaving[];planters:StreetscapePlanter[];cafeTerraces:CafeTerrace[];cafeTerrace:CafeTerrace|null}

/** Native furniture dimensions shared by the street exterior and the encounter.
 * Character and furniture are scaled together on the city map, never separately. */
export const CAFE_DRINK_RIG:SharedDrinkLayout={
 seats:[
  {position:[-.88,0,0],rotation:Math.PI/2,seatTopY:.388,approach:[-.88,0,.75],exit:[-.88,0,1.45]},
  {position:[.88,0,0],rotation:-Math.PI/2,seatTopY:.388,approach:[.88,0,.75],exit:[.88,0,1.45]},
 ],
 table:{position:[0,0,0],topY:.608,rotation:0,scale:[1,1,1]},
 cupRest:[[-.37,.608,0],[.37,.608,0]],target:[0,.72,.45],cameraPosition:[.65,2.35,4.8],usable:true,
}
export const CAFE_CITY_SCALE=.3125

const axes=(rotation:number)=>[[Math.cos(rotation),-Math.sin(rotation)],[Math.sin(rotation),Math.cos(rotation)]] as const
export function streetscapeFootprintsOverlap(a:StreetscapeFootprint,b:StreetscapeFootprint,padding=0){
 const delta=[b.position[0]-a.position[0],b.position[1]-a.position[1]],aa=axes(a.rotation),ba=axes(b.rotation)
 return [...aa,...ba].every(axis=>{
  const radius=(item:StreetscapeFootprint,itemAxes:ReturnType<typeof axes>)=>item.half.reduce((sum,extent,index)=>sum+extent*Math.abs(itemAxes[index][0]*axis[0]+itemAxes[index][1]*axis[1]),0)
  return Math.abs(delta[0]*axis[0]+delta[1]*axis[1])<=radius(a,aa)+radius(b,ba)+padding
 })
}
const transform=(position:Point2,rotation:number,offset:Point2):[number,number]=>[
 position[0]+offset[0]*Math.cos(rotation)+offset[1]*Math.sin(rotation),
 position[1]-offset[0]*Math.sin(rotation)+offset[1]*Math.cos(rotation),
]
const corners=(item:StreetscapeFootprint)=>[-1,1].flatMap(x=>[-1,1].map(z=>transform(item.position,item.rotation,[item.half[0]*x,item.half[1]*z])))
const insidePlatform=([x,z]:Point2)=>{
 let inside=false
 for(let i=0,j=CITY_PLATFORM_OUTLINE.length-1;i<CITY_PLATFORM_OUTLINE.length;j=i++){
  const [xi,zi]=CITY_PLATFORM_OUTLINE[i],[xj,zj]=CITY_PLATFORM_OUTLINE[j]
  if((zi>z)!==(zj>z)&&x<(xj-xi)*(z-zi)/(zj-zi)+xi)inside=!inside
 }
 return inside
}
const distanceToSegment=(point:Point2,start:Point2,end:Point2)=>{
 const dx=end[0]-start[0],dz=end[1]-start[1],square=dx*dx+dz*dz
 const t=square?Math.max(0,Math.min(1,((point[0]-start[0])*dx+(point[1]-start[1])*dz)/square)):0
 return Math.hypot(point[0]-start[0]-dx*t,point[1]-start[1]-dz*t)
}
const fixedCourtyards:readonly StreetscapeFootprint[]=[
 {position:[-.8,-6.5],half:[7.2,2.13],rotation:0},
 {position:[0,6.5],half:[2.75,2.2],rotation:0},
 {position:[16,6.5],half:[3.85,2.2],rotation:0},
]
export type StreetscapeRejection='road'|'building'|'courtyard'|'obstacle'|'pedestrian'|'outside'
/** Reserve full visual road modules, including the sidewalks. Never compensate
 * a bad authored layout by moving user objects or obstructing navigation. */
export function validateStreetscapeFootprint(item:StreetscapeFootprint,constraints:StreetscapeConstraints):StreetscapeRejection|null{
 if(corners(item).some(point=>!insidePlatform(point)||CITY_PLATFORM_OUTLINE.some((start,index)=>distanceToSegment(point,start,CITY_PLATFORM_OUTLINE[(index+1)%CITY_PLATFORM_OUTLINE.length])<.2)))return 'outside'
 if(constraints.roads.some(road=>streetscapeFootprintsOverlap(item,{position:road.position,half:[road.scale??ROAD_TILE_SCALE,road.scale??ROAD_TILE_SCALE],rotation:road.rotation},.22)))return 'road'
 if(constraints.buildings.some(building=>streetscapeFootprintsOverlap(item,{position:building.position,half:[Math.max(1.3,1.021*building.scale),Math.max(1.3,1.021*building.scale)],rotation:building.rotation},.22)))return 'building'
 if(fixedCourtyards.some(courtyard=>streetscapeFootprintsOverlap(item,courtyard,.16)))return 'courtyard'
 if(constraints.obstacles?.some(obstacle=>streetscapeFootprintsOverlap(item,obstacle,.16)))return 'obstacle'
 // Radius is deliberately conservative around diagonals: a new tree cannot
 // intrude into the character's shoulders even when the path cuts a corner.
 const radius=Math.hypot(...item.half)+.34
 if(constraints.characterPositions?.some(point=>Math.hypot(point[0]-item.position[0],point[1]-item.position[1])<radius))return 'pedestrian'
 if(constraints.characterRoutes?.some(route=>route.points.some((point,index)=>index>0&&distanceToSegment(item.position,[route.points[index-1][0],route.points[index-1][2]],[point[0],point[2]])<radius)))return 'pedestrian'
 return null
}

/** Conservative authored bounds. Unknown assets reserve more space, not less. */
export function streetscapeObstacleFromAuthored(item:WorldLayoutPlacement):StreetscapeFootprint{
 const name=item.asset.split('/').pop()??''
 let half:Point2=[1.25,1.25]
 if(/car_/.test(name))half=[.22,.48]
 else if(/trafficlight_C/.test(name))half=[.77,.15]
 else if(/streetlight|trafficlight/.test(name))half=[.25,.15]
 else if(/firehydrant/.test(name))half=[.08,.08]
 else if(/bench/.test(name))half=[.23,.1]
 else if(/tree/.test(name))half=[1.25,1.2]
 else if(/bush/.test(name))half=[.13,.13]
 else if(/flower/.test(name))half=[.65,.65]
 else if(/trash/.test(name))half=[.08,.08]
 else if(/box_/.test(name))half=[.12,.12]
 else if(/dumpster/.test(name))half=[.3,.19]
 else if(/watertower/.test(name))half=[.27,.27]
 // An author can tilt an asset. With no runtime mesh bounds yet, keep a
 // generous three-dimensional envelope rather than assume it remains upright.
 if(Math.abs(Math.sin(item.rotation.x))>.0001||Math.abs(Math.sin(item.rotation.z))>.0001)half=[Math.max(...half,4),Math.max(...half,4)]
 return {position:[item.position.x,item.position.z],half:[half[0]*Math.abs(item.scale.x),half[1]*Math.abs(item.scale.z)],rotation:item.rotation.y}
}

export function resolveStreetscapeLayout(constraints:StreetscapeConstraints):StreetscapeLayout{
 const paving:StreetscapePaving[]=[],planters:StreetscapePlanter[]=[]
 // Flush paving is confined to the existing parcel, below door thresholds.
 // It never paints over a road, another authored object, or an occupied lane.
 for(const [index,building] of constraints.buildings.entries()){
  const half=Math.max(1.3,1.021*building.scale)
  const apron:StreetscapePaving={id:`parcel-apron-${building.id??index}`,position:[...building.position],half:[half,half],rotation:building.rotation,tone:index%4===0?'warm':'stone'}
  if(constraints.roads.some(road=>streetscapeFootprintsOverlap(apron,{position:road.position,half:[(road.scale??1.3)-.035,(road.scale??1.3)-.035],rotation:road.rotation})))continue
  if(corners(apron).every(insidePlatform))paving.push(apron)
 }
 // Stitch neighbouring parcels across vacant lots. These flush paths join
 // existing door aprons instead of scattering isolated squares over the city.
 // Only collinear parcels within two empty cells qualify; no road crossing,
 // fountain, parking bay, authored object or intermediate building is painted.
 const parcels=[...paving]
 for(let first=0;first<parcels.length;first++)for(let second=first+1;second<parcels.length;second++){
  const a=parcels[first],b=parcels[second],dx=b.position[0]-a.position[0],dz=b.position[1]-a.position[1]
  const horizontal=Math.abs(dz)<.02,vertical=Math.abs(dx)<.02
  if(!horizontal&&!vertical)continue
  const distance=Math.abs(horizontal?dx:dz),gap=distance-a.half[horizontal?0:1]-b.half[horizontal?0:1]
  if(gap<.15||distance>7.81)continue
  const position:[number,number]=[(a.position[0]+b.position[0])/2,(a.position[1]+b.position[1])/2]
  const half:[number,number]=horizontal?[gap/2+.025,.54]:[.54,gap/2+.025]
  const connector:StreetscapePaving={id:`walk-link-${first}-${second}`,position,half,rotation:0,tone:'stone'}
  if(corners(connector).some(point=>!insidePlatform(point)))continue
  if(constraints.roads.some(road=>streetscapeFootprintsOverlap(connector,{position:road.position,half:[road.scale??1.3,road.scale??1.3],rotation:road.rotation},.01)))continue
  if(fixedCourtyards.some(item=>streetscapeFootprintsOverlap(connector,item,.05)))continue
  if(constraints.obstacles?.some(item=>streetscapeFootprintsOverlap(connector,item,.05)))continue
  if(parcels.some((item,index)=>index!==first&&index!==second&&streetscapeFootprintsOverlap(connector,item,.01)))continue
  if(paving.some(item=>item.id.startsWith('walk-link-')&&streetscapeFootprintsOverlap(connector,item,.05)))continue
  paving.push(connector)
 }
 const cafeTerraces:CafeTerrace[]=[]
 const cafes=constraints.landmarks.filter(item=>item.kind==='cafe'||item.locationId==='moonlight_cafe').sort((a,b)=>Number(b.locationId==='moonlight_cafe')-Number(a.locationId==='moonlight_cafe'))
 for(const cafe of cafes){
  // Prefer a garden-side terrace next to the actual cafe; authored buildings
  // and roads can invalidate every candidate, in which case render none.
  const candidates:Point2[]=[]
  for(const radius of [2.6,2.8,3.6,4.4,5.2])for(const direction of [[0,-1],[-1,0],[1,0],[0,1],[-.707,-.707],[.707,-.707],[-.707,.707],[.707,.707]])candidates.push(transform(cafe.position,cafe.rotation,[direction[0]*radius,direction[1]*radius]))
  for(const position of candidates){
   const footprint:StreetscapeFootprint={position,half:[.9,.9],rotation:cafe.rotation}
   if(validateStreetscapeFootprint(footprint,{...constraints,obstacles:[...(constraints.obstacles??[]),...cafeTerraces.map(item=>item.footprint)]}))continue
   cafeTerraces.push({locationId:cafe.locationId,position:[position[0],.378,position[1]],rotation:cafe.rotation,scale:CAFE_CITY_SCALE,footprint,rig:CAFE_DRINK_RIG})
   paving.push({id:`cafe-terrace-paving-${cafe.locationId}`,position:[...position],half:[.91,.91],rotation:cafe.rotation,tone:'warm'})
   break
  }
 }
 const accepted:StreetscapeFootprint[]=cafeTerraces.map(item=>item.footprint)
 // Deliberately clustered garden nodes; not a random prop in every empty gap.
 const gardens:Point2[]=[[-22.4,-14.7],[-18.1,-14.4],[-12.4,-13.6],[4.4,-12.4],[11.6,-12.8],[23.8,-12.6],[-19.1,8.5],[-16.4,8.3],[-11.5,5.6],[-4.1,5.6],[3.5,9.6],[10.2,9.5],[22.6,9.6],[23.1,14.8]]
 for(const [index,anchor] of gardens.entries()){
  const tree=index%3!==1,half:[number,number]=tree?[.72,.72]:[.84,.44],rotation=index%2?Math.PI/2:0
  for(const offset of [[0,0],[-.6,0],[.6,0],[0,-.6],[0,.6],[-.6,-.6],[.6,.6],[-1.2,0],[1.2,0],[0,-1.2],[0,1.2]] as const){
   const position:[number,number]=[anchor[0]+offset[0],anchor[1]+offset[1]],candidate={position,half,rotation}
   if(validateStreetscapeFootprint(candidate,{...constraints,obstacles:[...(constraints.obstacles??[]),...accepted]}))continue
   planters.push({id:`street-garden-${index}`,position,half,rotation,tree});accepted.push(candidate);break
  }
 }
 return {paving,planters,cafeTerraces,cafeTerrace:cafeTerraces[0]??null}
}
