import {KAYKIT_ROAD_MODELS,roadConnections,ROAD_TILE_SCALE,ROAD_TILE_STEP,ROAD_DIRECTION_OFFSET,OPPOSITE_ROAD_DIRECTION,SKY_ROAD_EXITS,type RoadDirection,type RoadTilePlacement} from './worldData.ts'
import type {WorldLayoutPlacement} from '../../worldLayout.ts'

type Point=[number,number]
type RoadGraph={roads:RoadTilePlacement[];neighbours:Map<string,RoadTilePlacement[]>}
export type TrafficRoute={id:string;points:Point[];closed:boolean;tileIds?:string[];junctionIds?:string[]}
const DIRECTIONS:readonly RoadDirection[]=['north','east','south','west']
const EPSILON=.001
const HALF_TILE=ROAD_TILE_STEP/2
export const TRAFFIC_LANE_OFFSET=.4
const pointKey=([x,z]:readonly number[])=>`${x.toFixed(3)}:${z.toFixed(3)}`
const heading=(from:Point,to:Point):Point=>{const length=Math.hypot(to[0]-from[0],to[1]-from[1]);return [(to[0]-from[0])/length,(to[1]-from[1])/length]}
const cross=(a:Point,b:Point)=>a[0]*b[1]-a[1]*b[0]
const modulo=(value:number,length:number)=>((value%length)+length)%length
const quarterTurn=(angle:number)=>Math.abs(angle-Math.round(angle/(Math.PI/2))*Math.PI/2)<.001

/** Published layouts omit surface. Recover it from the visible cloudway decks,
 * and ignore transforms that cannot match the fixed-size reciprocal tile graph. */
export function trafficRoadsFromLayout(placements:readonly WorldLayoutPlacement[]):RoadTilePlacement[]{
 return placements.flatMap(placement=>{
  const model=placement.asset.split('/').pop()?.replace(/\.gltf$/,'')
  if(!KAYKIT_ROAD_MODELS.includes(model as RoadTilePlacement['model'])||!quarterTurn(placement.rotation.y)||Math.abs(placement.rotation.x)>EPSILON||Math.abs(placement.rotation.z)>EPSILON||Math.abs(placement.position.y-.245)>EPSILON||(['x','y','z'] as const).some(axis=>Math.abs(placement.scale[axis]-ROAD_TILE_SCALE)>EPSILON))return []
  const position:Point=[placement.position.x,placement.position.z]
  const skyway=SKY_ROAD_EXITS.some(exit=>{
   const horizontal=Math.abs(Math.sin(exit.rotation))>.5
   return Math.abs(position[horizontal?1:0]-exit.position[horizontal?1:0])<exit.width/2&&Math.abs(position[horizontal?0:1]-exit.position[horizontal?0:1])<=exit.length/2+EPSILON
  })
  return [{id:placement.id,model:model as RoadTilePlacement['model'],position,rotation:placement.rotation.y,surface:skyway?'skyway':'city'}]
 })
}

function roadGraph(input:readonly RoadTilePlacement[]):RoadGraph{
 const counts=new Map<string,number>()
 for(const road of input)counts.set(pointKey(road.position),(counts.get(pointKey(road.position))??0)+1)
 const roads=input.filter(road=>counts.get(pointKey(road.position))===1&&quarterTurn(road.rotation))
 const cells=new Map(roads.map(road=>[pointKey(road.position),road]))
 const neighbours=new Map(roads.map(road=>[road.id,roadConnections(road).flatMap(direction=>{
  const [dx,dz]=ROAD_DIRECTION_OFFSET[direction]
  const next=cells.get(pointKey([road.position[0]+dx*ROAD_TILE_STEP,road.position[1]+dz*ROAD_TILE_STEP]))
  return next&&roadConnections(next).includes(OPPOSITE_ROAD_DIRECTION[direction])?[next]:[]
 })]))
 return {roads,neighbours}
}

/** Only registered outward cloudway ports can recycle a vehicle. An edited
 * city dead end is never mistaken for a gateway, even if marked skyway. */
function graphExits(graph:RoadGraph):RoadTilePlacement[]{
 return SKY_ROAD_EXITS.flatMap(exit=>{
  const horizontal=Math.abs(Math.sin(exit.rotation))>.5,axis=horizontal?0:1
  const sign=Math.sign(exit.position[axis]),direction:RoadDirection=horizontal?(sign>0?'east':'west'):(sign>0?'south':'north')
  const tip=exit.position[axis]+sign*exit.length/2
  const candidates=graph.roads.filter(road=>Math.abs(road.position[1-axis]-exit.position[1-axis])<EPSILON&&Math.abs(tip-road.position[axis])<=ROAD_TILE_STEP+EPSILON&&sign*(tip-road.position[axis])>=HALF_TILE-EPSILON&&roadConnections(road).includes(direction)&&graph.neighbours.get(road.id)?.length===1)
  candidates.sort((a,b)=>sign*(b.position[axis]-a.position[axis]))
  return candidates.slice(0,1)
 })
}

function graphLoops(graph:RoadGraph):RoadTilePlacement[][]{
 const seenEdges=new Set<string>(),loops:RoadTilePlacement[][]=[]
 for(const start of graph.roads)for(const first of graph.neighbours.get(start.id)??[]){
  if(seenEdges.has(`${start.id}>${first.id}`))continue
  let current=start,next=first
  const path:RoadTilePlacement[]=[],seenTiles=new Set<string>()
  for(let step=0;step<=graph.roads.length*2;step++){
   const edge=`${current.id}>${next.id}`
   if(seenEdges.has(edge)){
    if(current===start&&next===first&&path.length>=4){
     const area=path.reduce((sum,tile,index)=>sum+cross(tile.position,path[(index+1)%path.length].position),0)
     if(area>EPSILON)loops.push(path)
    }
    break
   }
   seenEdges.add(edge)
   // A face that revisits a vertex or doubles back around a broken branch is
   // not a driveable simple loop. Do not bridge its endpoints artificially.
   if(seenTiles.has(current.id))break
   path.push(current);seenTiles.add(current.id)
   const incoming=heading(current.position,next.position)
   const direction=DIRECTIONS.findIndex(d=>ROAD_DIRECTION_OFFSET[d][0]===incoming[0]&&ROAD_DIRECTION_OFFSET[d][1]===incoming[1])
   const options=graph.neighbours.get(next.id)??[]
   const onward=[1,0,3,2].flatMap(turn=>{
    const offset=ROAD_DIRECTION_OFFSET[DIRECTIONS[(direction+turn)%4]]
    const tile=options.find(candidate=>Math.abs(candidate.position[0]-next.position[0]-offset[0]*ROAD_TILE_STEP)<EPSILON&&Math.abs(candidate.position[1]-next.position[1]-offset[1]*ROAD_TILE_STEP)<EPSILON)
    return tile?[tile]:[]
   })[0]
   if(!onward||onward===current)break
   current=next;next=onward
  }
 }
 return loops
}

/** Reciprocal graph routes cover all bounded city blocks plus every connected
 * pair of registered gateways. Surface metadata is not needed for routing. */
export function trafficRoutes(roads:readonly RoadTilePlacement[]):TrafficRoute[]{
 const graph=roadGraph(roads),exits=graphExits(graph),routes:TrafficRoute[]=[]
 const add=(id:string,path:RoadTilePlacement[],closed:boolean)=>routes.push({id,points:path.map(road=>[...road.position]),tileIds:path.map(road=>road.id),junctionIds:path.filter(road=>(graph.neighbours.get(road.id)?.length??0)>2).map(road=>road.id),closed})
 for(const start of exits)for(const finish of exits){
  if(start===finish)continue
  const queue=[start],parents=new Map<string,RoadTilePlacement|null>([[start.id,null]])
  for(let i=0;i<queue.length&&!parents.has(finish.id);i++)for(const next of graph.neighbours.get(queue[i].id)??[])if(!parents.has(next.id)){parents.set(next.id,queue[i]);queue.push(next)}
  if(!parents.has(finish.id))continue
  const path:RoadTilePlacement[]=[]
  for(let current:RoadTilePlacement|null=finish;current;current=parents.get(current.id)??null)path.unshift(current)
  if(path.length>2)add(`${start.id}>${finish.id}`,path,false)
 }
 graphLoops(graph).forEach((loop,index)=>{add(`city-loop-${index}-forward`,loop,true);add(`city-loop-${index}-reverse`,[...loop].reverse(),true)})
 return routes
}

/** Compatibility helper for geometry guards; unlike an arbitrary DFS path,
 * this is an actual bounded face whose closing edge has reciprocal ports. */
export function trafficLoop(roads:readonly RoadTilePlacement[]):Point[]{return graphLoops(roadGraph(roads))[0]?.map(road=>[...road.position])??[]}

type TrafficSegment={start:number;length:number;from:Point;to:Point;tileId:string;center?:Point;angle?:number;sweep?:number;radius?:number}
type TrafficJunction={id:string;start:number;end:number}
export type PreparedTrafficRoute=TrafficRoute&{length:number;segments:TrafficSegment[];junctions:TrafficJunction[]}
export type TrafficPose={position:Point;tangent:Point;opacity:number;tileId:string}

/** Each tile owns one straight or circular lane segment. Tangents match at
 * tile boundaries, and quarter-circle turns stay inside that tile's pavement. */
export function prepareTrafficRoute(route:TrafficRoute):PreparedTrafficRoute{
 const segments:TrafficSegment[]=[],junctions:TrafficJunction[]=[]
 let length=0
 route.points.forEach((center,index)=>{
  const previous=route.points[index-1]??(route.closed?route.points.at(-1):undefined)
  const next=route.points[index+1]??(route.closed?route.points[0]:undefined)
  if(!previous&&!next)return
  const incoming=previous?heading(previous,center):heading(center,next!),outgoing=next?heading(center,next):incoming
  // The whole body must still be above the final asphalt tile when it fades
  // out; sampling a vehicle centre at the tile edge would overhang its nose.
  const entryExtent=HALF_TILE-(previous?0:TRAFFIC_VEHICLE_HALF_LENGTH+.03)
  const exitExtent=HALF_TILE-(next?0:TRAFFIC_VEHICLE_HALF_LENGTH+.03)
  const from:Point=[center[0]-incoming[0]*entryExtent+incoming[1]*TRAFFIC_LANE_OFFSET,center[1]-incoming[1]*entryExtent-incoming[0]*TRAFFIC_LANE_OFFSET]
  const to:Point=[center[0]+outgoing[0]*exitExtent+outgoing[1]*TRAFFIC_LANE_OFFSET,center[1]+outgoing[1]*exitExtent-outgoing[0]*TRAFFIC_LANE_OFFSET]
  const turn=cross(incoming,outgoing),tileId=route.tileIds?.[index]??pointKey(center)
  let segment:TrafficSegment
  if(Math.abs(turn)>.5){
   const arcCenter:Point=[center[0]-incoming[0]*HALF_TILE+outgoing[0]*HALF_TILE,center[1]-incoming[1]*HALF_TILE+outgoing[1]*HALF_TILE]
   const radius=Math.hypot(from[0]-arcCenter[0],from[1]-arcCenter[1])
   segment={start:length,length:radius*Math.PI/2,from,to,tileId,center:arcCenter,radius,angle:Math.atan2(from[1]-arcCenter[1],from[0]-arcCenter[0]),sweep:turn*Math.PI/2}
  }else segment={start:length,length:Math.hypot(to[0]-from[0],to[1]-from[1]),from,to,tileId}
  segments.push(segment)
  if(route.junctionIds?.includes(tileId))junctions.push({id:tileId,start:length,end:length+segment.length})
  length+=segment.length
 })
 return {...route,length,segments,junctions}
}

/** Pure arc-length sampling shared by the renderer and deterministic checks. */
export function sampleTrafficRoute(route:PreparedTrafficRoute,distance:number):TrafficPose{
 const travel=route.closed?modulo(distance,route.length):Math.max(0,Math.min(route.length,distance))
 const segment=route.segments.find(item=>travel<=item.start+item.length+1e-8)??route.segments.at(-1)
 if(!segment)return {position:[0,0],tangent:[0,1],opacity:0,tileId:''}
 const progress=Math.min(1,Math.max(0,(travel-segment.start)/segment.length))
 let position:Point,tangent:Point
 if(segment.center&&segment.radius!==undefined&&segment.angle!==undefined&&segment.sweep!==undefined){
  const angle=segment.angle+segment.sweep*progress,sign=Math.sign(segment.sweep)
  position=[segment.center[0]+Math.cos(angle)*segment.radius,segment.center[1]+Math.sin(angle)*segment.radius]
  tangent=[-Math.sin(angle)*sign,Math.cos(angle)*sign]
 }else {position=[segment.from[0]+(segment.to[0]-segment.from[0])*progress,segment.from[1]+(segment.to[1]-segment.from[1])*progress];tangent=heading(segment.from,segment.to)}
 const fade=route.closed?1:Math.max(0,Math.min(1,travel/ROAD_TILE_STEP,(route.length-travel)/ROAD_TILE_STEP))
 return {position,tangent,opacity:fade*fade*(3-2*fade),tileId:segment.tileId}
}

export type TrafficVehicle={id:string;route:PreparedTrafficRoute;distance:number;speed:number;cruiseSpeed:number;pose:TrafficPose;modelIndex:number;trips:number}
export type TrafficFleet={vehicles:TrafficVehicle[];junctionOwners:Map<string,string>;time:number}
// KayKit's sedan at renderer scale 1.08 is .453 wide and 1.014 long.
// These slightly larger rectangles leave visible following clearance.
export const TRAFFIC_VEHICLE_HALF_LENGTH=.62
export const TRAFFIC_VEHICLE_HALF_WIDTH=.27
// The shortest link between neighbouring junctions has one 2.6-unit tile.
// Keep room for a waiting car AND the rear clearance of the previous car;
// overlarge stop margins would deadlock two opposing intersection queues.
const JUNCTION_CLEARANCE=TRAFFIC_VEHICLE_HALF_LENGTH+.02

/** Separating-axis check on lane-aligned vehicle footprints. Opposite lanes
 * remain independent; merging, following and crossing paths cannot overlap. */
export function trafficPosesOverlap(a:TrafficPose,b:TrafficPose):boolean{
 const delta:Point=[b.position[0]-a.position[0],b.position[1]-a.position[1]]
 if(Math.hypot(...delta)>TRAFFIC_VEHICLE_HALF_LENGTH*2+TRAFFIC_VEHICLE_HALF_WIDTH*2)return false
 const normalA:Point=[a.tangent[1],-a.tangent[0]],normalB:Point=[b.tangent[1],-b.tangent[0]]
 const dot=(x:Point,y:Point)=>x[0]*y[0]+x[1]*y[1]
 return [a.tangent,normalA,b.tangent,normalB].every(axis=>Math.abs(dot(delta,axis))<TRAFFIC_VEHICLE_HALF_LENGTH*(Math.abs(dot(a.tangent,axis))+Math.abs(dot(b.tangent,axis)))+TRAFFIC_VEHICLE_HALF_WIDTH*(Math.abs(dot(normalA,axis))+Math.abs(dot(normalB,axis))))
}

function junctionWindows(vehicle:TrafficVehicle){
 const {route,distance}=vehicle
 return route.junctions.flatMap(junction=>{
  const shifts=route.closed?[-route.length,0,route.length]:[0]
  return shifts.map(shift=>({...junction,start:junction.start+shift-JUNCTION_CLEARANCE,end:junction.end+shift+JUNCTION_CLEARANCE})).filter(window=>window.end>=distance-EPSILON&&window.start<=distance+ROAD_TILE_STEP)
 })
}

export function createTrafficFleet(routes:readonly TrafficRoute[],options:{maxVehicles?:number;speed?:number}={}):TrafficFleet{
 const prepared=routes.map(prepareTrafficRoute).filter(route=>route.length>0),vehicles:TrafficVehicle[]=[]
 const maxVehicles=Math.min(32,Math.max(0,options.maxVehicles??28)),count=Math.min(maxVehicles,prepared.length*2)
 const fleet:TrafficFleet={vehicles,junctionOwners:new Map(),time:0}
 for(let index=0;index<count;index++){
  const route=prepared[index%prepared.length],cruiseSpeed=options.speed??1.45
  const vehicle:TrafficVehicle={id:`traffic-${index}`,route,distance:0,speed:cruiseSpeed,cruiseSpeed,pose:sampleTrafficRoute(route,0),modelIndex:index%3,trips:0}
  // Populate every route first. Search deterministic offsets for a clear lane
  // and junction, so initial loading never presents stacked parked cars.
  for(let attempt=0;attempt<100;attempt++){
   vehicle.distance=modulo((index*.381966+attempt*.073)*route.length,route.length)
   vehicle.pose=sampleTrafficRoute(route,vehicle.distance)
   const occupied=junctionWindows(vehicle).filter(window=>window.start<=vehicle.distance)
   if(occupied.some(window=>fleet.junctionOwners.has(window.id))||vehicles.some(other=>trafficPosesOverlap(vehicle.pose,other.pose)))continue
   vehicles.push(vehicle)
   occupied.forEach(window=>fleet.junctionOwners.set(window.id,vehicle.id))
   break
  }
 }
 return fleet
}

/** Bounded fixed substeps, early junction reservations and footprint checks
 * keep the anonymous fleet coherent without resident simulation or React state. */
export function advanceTrafficFleet(fleet:TrafficFleet,delta:number):void{
 let remaining=Math.min(.25,Math.max(0,delta))
 while(remaining>1e-8){
  const step=Math.min(1/30,remaining);remaining-=step;fleet.time+=step
  for(const [junctionId,owner] of fleet.junctionOwners){
   const vehicle=fleet.vehicles.find(item=>item.id===owner)
   if(!vehicle||!junctionWindows(vehicle).some(window=>window.id===junctionId&&window.start<=vehicle.distance+EPSILON&&window.end>=vehicle.distance-EPSILON))fleet.junctionOwners.delete(junctionId)
  }
  for(const vehicle of fleet.vehicles){
   let target=vehicle.distance+vehicle.cruiseSpeed*step
   const claims:string[]=[]
   for(const window of junctionWindows(vehicle)){
    if(window.start>target)continue
    const owner=fleet.junctionOwners.get(window.id)
    if(owner&&owner!==vehicle.id){target=Math.min(target,Math.max(vehicle.distance,window.start-1e-5));continue}
    // Do not enter a junction unless the exit lane has room for the entire
    // car. Otherwise two nearby turning queues can each hold the junction
    // that the other needs to clear, despite never physically colliding.
    if(!owner&&window.start>=vehicle.distance-EPSILON){
     const exitPose=sampleTrafficRoute(vehicle.route,window.end+.05)
     if(fleet.vehicles.some(other=>other!==vehicle&&trafficPosesOverlap(exitPose,other.pose))){target=Math.min(target,Math.max(vehicle.distance,window.start-1e-5));continue}
    }
    claims.push(window.id)
   }
   let pose=sampleTrafficRoute(vehicle.route,target)
   if(fleet.vehicles.some(other=>other!==vehicle&&trafficPosesOverlap(pose,other.pose))){target=vehicle.distance;pose=vehicle.pose;claims.length=0}
   vehicle.speed=(target-vehicle.distance)/step
   vehicle.distance=target;vehicle.pose=pose
   if(target>0)claims.forEach(id=>fleet.junctionOwners.set(id,vehicle.id))
   if(vehicle.distance>=vehicle.route.length){
    if(vehicle.route.closed){vehicle.distance=modulo(vehicle.distance,vehicle.route.length);vehicle.trips++}
    else {
     // Endpoints have zero opacity before recycling. Admission waits until
     // the off-city incoming lane is clear; no visible rescale or city jump.
     vehicle.distance=vehicle.route.length;vehicle.pose=sampleTrafficRoute(vehicle.route,vehicle.route.length)
     const entrance=sampleTrafficRoute(vehicle.route,0)
     if(!fleet.vehicles.some(other=>other!==vehicle&&trafficPosesOverlap(entrance,other.pose))){vehicle.distance=0;vehicle.pose=entrance;vehicle.trips++}
    }
   }
  }
 }
}
