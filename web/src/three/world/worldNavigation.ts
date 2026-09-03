import {
 OPPOSITE_ROAD_DIRECTION,
 ROAD_DIRECTION_OFFSET,
 ROAD_TILES,
 ROAD_TILE_STEP,
 roadConnections,
 type BuildingLot,
 type RoadDirection,
 type RoadTilePlacement,
 type WorldPoint,
} from './worldData'

type Point2=[number,number]
type CornerName='nw'|'ne'|'se'|'sw'

type NavigationNode={
 id:string
 position:Point2
}

type LotEntry={
 point:Point2
 cornerIds:readonly [string,string]
 normal:Point2
 road:RoadTilePlacement
}

export type PedestrianRouteOptions={
 /** Stable tie-breaker when two sidewalk paths have exactly the same length. */
 seed?:string|number
 /** World-space height of the character root. */
 y?:number
 /** Sideways adjustment along the origin pavement, useful for separated actors. */
 startLateralOffset?:number
 /** Sideways adjustment along the destination pavement, useful for event groups. */
 endLateralOffset?:number
}

export type PedestrianRoute={
 points:readonly WorldPoint[]
 cumulativeLengths:readonly number[]
 length:number
 reachable:boolean
 initialRotation:number
}

export type PedestrianRouteSample={
 position:WorldPoint
 rotation:number
 distance:number
 segmentIndex:number
 done:boolean
}

const EPSILON=1e-7

// KayKit road cells are 2.6 units wide. Keeping the route at 40% of that
// width places pedestrians on the authored pavement while retaining a small
// clearance from the neighbouring building parcel, whose edge is at 50%.
export const PEDESTRIAN_SIDEWALK_OFFSET=ROAD_TILE_STEP*.4
export const PEDESTRIAN_HEIGHT=.375

const CORNERS:Record<CornerName,Point2>={
 nw:[-PEDESTRIAN_SIDEWALK_OFFSET,-PEDESTRIAN_SIDEWALK_OFFSET],
 ne:[PEDESTRIAN_SIDEWALK_OFFSET,-PEDESTRIAN_SIDEWALK_OFFSET],
 se:[PEDESTRIAN_SIDEWALK_OFFSET,PEDESTRIAN_SIDEWALK_OFFSET],
 sw:[-PEDESTRIAN_SIDEWALK_OFFSET,PEDESTRIAN_SIDEWALK_OFFSET],
}

const CARDINAL_DIRECTIONS:readonly Point2[]=[[1,0],[-1,0],[0,1],[0,-1]]
const cellKey=(gx:number,gz:number)=>`${gx},${gz}`
const cellForPoint=([x,z]:Point2):Point2=>[Math.round(x/ROAD_TILE_STEP),Math.round(z/ROAD_TILE_STEP)]
const nodeId=(road:RoadTilePlacement,corner:CornerName)=>`${road.id}:${corner}`

const navigationNodes=new Map<string,NavigationNode>()
const navigationEdges=new Map<string,Map<string,number>>()
const roadsByCell=new Map<string,RoadTilePlacement>()
const roadPorts=new Map<string,ReadonlySet<RoadDirection>>()

const distance2=(a:Point2,b:Point2)=>Math.hypot(b[0]-a[0],b[1]-a[1])
const edgeMap=(id:string)=>{
 let edges=navigationEdges.get(id)
 if(!edges){edges=new Map();navigationEdges.set(id,edges)}
 return edges
}
const addEdge=(from:string,to:string)=>{
 const a=navigationNodes.get(from),b=navigationNodes.get(to)
 if(!a||!b)return
 const distance=distance2(a.position,b.position)
 edgeMap(from).set(to,distance)
 edgeMap(to).set(from,distance)
}

for(const road of ROAD_TILES){
 const [gx,gz]=cellForPoint(road.position)
 roadsByCell.set(cellKey(gx,gz),road)
 roadPorts.set(road.id,new Set(roadConnections(road)))
 for(const [corner,offset] of Object.entries(CORNERS) as [CornerName,Point2][]){
  const id=nodeId(road,corner)
  navigationNodes.set(id,{id,position:[road.position[0]+offset[0],road.position[1]+offset[1]]})
 }
 addEdge(nodeId(road,'nw'),nodeId(road,'ne'))
 addEdge(nodeId(road,'ne'),nodeId(road,'se'))
 addEdge(nodeId(road,'se'),nodeId(road,'sw'))
 addEdge(nodeId(road,'sw'),nodeId(road,'nw'))
}

const roadsConnect=(road:RoadTilePlacement,neighbour:RoadTilePlacement,direction:RoadDirection)=>
 roadPorts.get(road.id)?.has(direction)===true&&
 roadPorts.get(neighbour.id)?.has(OPPOSITE_ROAD_DIRECTION[direction])===true

// Join the matching pavement edges of neighbouring road modules. Only east
// and south are considered here because addEdge is bidirectional. A physical
// neighbour alone is not enough: the painted KayKit road ports must agree, so
// pedestrians can no longer cross a curb hidden by a mismatched road model.
for(const road of ROAD_TILES){
 const [gx,gz]=cellForPoint(road.position)
 const east=roadsByCell.get(cellKey(gx+1,gz))
 if(east&&roadsConnect(road,east,'east')){
  addEdge(nodeId(road,'ne'),nodeId(east,'nw'))
  addEdge(nodeId(road,'se'),nodeId(east,'sw'))
 }
 const south=roadsByCell.get(cellKey(gx,gz+1))
 if(south&&roadsConnect(road,south,'south')){
  addEdge(nodeId(road,'sw'),nodeId(south,'nw'))
  addEdge(nodeId(road,'se'),nodeId(south,'ne'))
 }
}

export const PEDESTRIAN_NAVIGATION_STATS=Object.freeze({
 roadTileCount:ROAD_TILES.length,
 nodeCount:navigationNodes.size,
 sidewalkOffset:PEDESTRIAN_SIDEWALK_OFFSET,
})

const stableHash=(value:string)=>{
 let hash=2166136261
 for(let index=0;index<value.length;index+=1){
  hash^=value.charCodeAt(index)
  hash=Math.imul(hash,16777619)
 }
 return hash>>>0
}

const clampLateral=(value:number|undefined)=>{
 if(!Number.isFinite(value))return 0
 const limit=PEDESTRIAN_SIDEWALK_OFFSET*.72
 return Math.max(-limit,Math.min(limit,value??0))
}

const entryCandidates=(lot:BuildingLot,lateralOffset=0):LotEntry[]=>{
 const [gx,gz]=cellForPoint(lot.position)
 const lateral=clampLateral(lateralOffset)
 const result:LotEntry[]=[]
 for(const [dx,dz] of CARDINAL_DIRECTIONS){
  const road=roadsByCell.get(cellKey(gx+dx,gz+dz))
  if(!road)continue
  // normal points from the road centre back toward the building parcel.
  const normal:[number,number]=[-dx,-dz]
  const tangent:[number,number]=[-normal[1],normal[0]]
  let corners:readonly [CornerName,CornerName]
  if(normal[0]<0)corners=['nw','sw']
  else if(normal[0]>0)corners=['ne','se']
  else if(normal[1]<0)corners=['nw','ne']
  else corners=['sw','se']
  result.push({
   road,
   normal,
   point:[
    road.position[0]+normal[0]*PEDESTRIAN_SIDEWALK_OFFSET+tangent[0]*lateral,
    road.position[1]+normal[1]*PEDESTRIAN_SIDEWALK_OFFSET+tangent[1]*lateral,
   ],
   cornerIds:[nodeId(road,corners[0]),nodeId(road,corners[1])],
  })
 }
 return result
}

const primaryEntry=(lot:BuildingLot,lateralOffset=0)=>{
 const candidates=entryCandidates(lot,lateralOffset)
 if(!candidates.length)return undefined
 const desired:[number,number]=[Math.sin(lot.rotation),Math.cos(lot.rotation)]
 return candidates.reduce((best,candidate)=>{
  const towardRoad:[number,number]=[-candidate.normal[0],-candidate.normal[1]]
  const score=desired[0]*towardRoad[0]+desired[1]*towardRoad[1]
  const bestToward:[number,number]=[-best.normal[0],-best.normal[1]]
  const bestScore=desired[0]*bestToward[0]+desired[1]*bestToward[1]
  return score>bestScore+EPSILON||(Math.abs(score-bestScore)<=EPSILON&&candidate.road.id<best.road.id)?candidate:best
 },candidates[0])
}

const fallbackPoint=(lot:BuildingLot,y:number,lateralOffset=0):WorldPoint=>{
 const entry=primaryEntry(lot,lateralOffset)
 return entry?[entry.point[0],y,entry.point[1]]:[lot.position[0],y,lot.position[1]]
}

const shortestNodePath=(startId:string,endId:string,seed:string):string[]|null=>{
 if(startId===endId)return [startId]
 const goal=navigationNodes.get(endId)
 if(!navigationNodes.has(startId)||!goal)return null
 const open=new Set([startId])
 const previous=new Map<string,string>()
 const costs=new Map<string,number>([[startId,0]])

 while(open.size){
  let current:string|undefined
  let currentScore=Number.POSITIVE_INFINITY
  let currentHeuristic=Number.POSITIVE_INFINITY
  let currentTie=Number.POSITIVE_INFINITY
  for(const candidate of open){
   const node=navigationNodes.get(candidate)!
   const heuristic=distance2(node.position,goal.position)
   const score=(costs.get(candidate)??Number.POSITIVE_INFINITY)+heuristic
   const tie=stableHash(`${seed}:${candidate}`)
   if(score<currentScore-EPSILON||
      (Math.abs(score-currentScore)<=EPSILON&&(heuristic<currentHeuristic-EPSILON||
       (Math.abs(heuristic-currentHeuristic)<=EPSILON&&tie<currentTie)))){
    current=candidate
    currentScore=score
    currentHeuristic=heuristic
    currentTie=tie
   }
  }
  if(!current)return null
  if(current===endId){
   const path=[current]
   while(path[0]!==startId){
    const parent=previous.get(path[0])
    if(!parent)return null
    path.unshift(parent)
   }
   return path
  }
  open.delete(current)
  const neighbours=[...(navigationEdges.get(current)?.entries()??[])].sort(([a],[b])=>{
   const hashDifference=stableHash(`${seed}:${a}`)-stableHash(`${seed}:${b}`)
   return hashDifference||a.localeCompare(b)
  })
  for(const [neighbour,edgeLength] of neighbours){
   const nextCost=(costs.get(current)??Number.POSITIVE_INFINITY)+edgeLength
   if(nextCost+EPSILON>=(costs.get(neighbour)??Number.POSITIVE_INFINITY))continue
   costs.set(neighbour,nextCost)
   previous.set(neighbour,current)
   open.add(neighbour)
  }
 }
 return null
}

const simplifyPoints=(points:readonly WorldPoint[])=>{
 const deduplicated:WorldPoint[]=[]
 for(const point of points){
  const last=deduplicated[deduplicated.length-1]
  if(!last||Math.hypot(point[0]-last[0],point[2]-last[2])>EPSILON)deduplicated.push([...point])
 }
 if(deduplicated.length<3)return deduplicated
 const simplified:WorldPoint[]=[deduplicated[0]]
 for(let index=1;index<deduplicated.length-1;index+=1){
  const previous=simplified[simplified.length-1]
  const current=deduplicated[index]
  const next=deduplicated[index+1]
  const ax=current[0]-previous[0],az=current[2]-previous[2]
  const bx=next[0]-current[0],bz=next[2]-current[2]
  const cross=ax*bz-az*bx
  const dot=ax*bx+az*bz
  if(Math.abs(cross)>EPSILON||dot<0)simplified.push(current)
 }
 simplified.push(deduplicated[deduplicated.length-1])
 return simplified
}

const makeRoute=(input:readonly WorldPoint[],reachable:boolean,initialRotation:number):PedestrianRoute=>{
 const points=simplifyPoints(input)
 const safePoints=points.length?points:[[0,PEDESTRIAN_HEIGHT,0] as WorldPoint]
 const cumulativeLengths=[0]
 for(let index=1;index<safePoints.length;index+=1){
  const previous=safePoints[index-1],current=safePoints[index]
  cumulativeLengths.push(cumulativeLengths[index-1]+Math.hypot(
   current[0]-previous[0],current[1]-previous[1],current[2]-previous[2],
  ))
 }
 return {points:safePoints,cumulativeLengths,length:cumulativeLengths[cumulativeLengths.length-1],reachable,initialRotation}
}

/**
 * Build a deterministic pavement route between two legal city parcels.
 * An unreachable destination returns a zero-length route at the origin; it
 * never falls back to a straight line that could cross roads or buildings.
 */
export function buildPedestrianRoute(origin:BuildingLot,target:BuildingLot,options:PedestrianRouteOptions={}):PedestrianRoute{
 const y=Number.isFinite(options.y)?Number(options.y):PEDESTRIAN_HEIGHT
 const seed=String(options.seed??`${origin.id}:${target.id}`)
 const start=primaryEntry(origin,options.startLateralOffset)
 const end=primaryEntry(target,options.endLateralOffset)
 const stationary=fallbackPoint(origin,y,options.startLateralOffset)
 if(!start||!end)return makeRoute([stationary],false,origin.rotation)

 const startPoint:[number,number,number]=[start.point[0],y,start.point[1]]
 const endPoint:[number,number,number]=[end.point[0],y,end.point[1]]
 if(origin.id===target.id||distance2(origin.position,target.position)<=EPSILON){
  return makeRoute([startPoint,endPoint],true,origin.rotation)
 }

 let best:PedestrianRoute|undefined
 let bestTie=Number.POSITIVE_INFINITY
 for(const startCorner of start.cornerIds){
  for(const endCorner of end.cornerIds){
   const nodePath=shortestNodePath(startCorner,endCorner,seed)
   if(!nodePath)continue
   const points:WorldPoint[]=[startPoint,...nodePath.map(id=>{
    const point=navigationNodes.get(id)!.position
    return [point[0],y,point[1]] as WorldPoint
   }),endPoint]
   const candidate=makeRoute(points,true,origin.rotation)
   const tie=stableHash(`${seed}:${startCorner}:${endCorner}`)
   if(!best||candidate.length<best.length-EPSILON||
      (Math.abs(candidate.length-best.length)<=EPSILON&&tie<bestTie)){
    best=candidate
    bestTie=tie
   }
  }
 }
 return best??makeRoute([stationary],false,origin.rotation)
}

/**
 * Route against an administrator-authored road document.  The default city
 * keeps using the richer prebuilt pavement graph above; this compact graph is
 * rebuilt only when a published layout supplies a different road network.
 */
export function buildPedestrianRouteForRoads(origin:BuildingLot,target:BuildingLot,roads:readonly RoadTilePlacement[],options:PedestrianRouteOptions={}):PedestrianRoute{
 if(!roads.length)return buildPedestrianRoute(origin,target,options)
 const y=Number.isFinite(options.y)?Number(options.y):PEDESTRIAN_HEIGHT
 const byCell=new Map<string,RoadTilePlacement>(),ports=new Map<string,ReadonlySet<RoadDirection>>()
 roads.forEach(road=>{const [gx,gz]=cellForPoint(road.position);byCell.set(cellKey(gx,gz),road);ports.set(road.id,new Set(roadConnections(road)))})
 const entry=(lot:BuildingLot,lateralOffset=0)=>{
  const [gx,gz]=cellForPoint(lot.position),desired:[number,number]=[Math.sin(lot.rotation),Math.cos(lot.rotation)]
  const candidates=CARDINAL_DIRECTIONS.flatMap(([dx,dz])=>{
   const road=byCell.get(cellKey(gx+dx,gz+dz));if(!road)return []
   const normal:[number,number]=[-dx,-dz],tangent:[number,number]=[-normal[1],normal[0]],lateral=clampLateral(lateralOffset)
   const towardRoad:[number,number]=[-normal[0],-normal[1]]
   return [{road,score:desired[0]*towardRoad[0]+desired[1]*towardRoad[1],point:[road.position[0]+normal[0]*PEDESTRIAN_SIDEWALK_OFFSET+tangent[0]*lateral,road.position[1]+normal[1]*PEDESTRIAN_SIDEWALK_OFFSET+tangent[1]*lateral] as Point2}]
  })
  return candidates.sort((a,b)=>b.score-a.score||a.road.id.localeCompare(b.road.id))[0]
 }
 const start=entry(origin,options.startLateralOffset),end=entry(target,options.endLateralOffset)
 if(!start||!end)return makeRoute([[origin.position[0],y,origin.position[1]]],false,origin.rotation)
 if(start.road.id===end.road.id)return makeRoute([[start.point[0],y,start.point[1]],[end.point[0],y,end.point[1]]],true,origin.rotation)
 const previous=new Map<string,string>(),queue=[start.road.id],visited=new Set(queue)
 const roadById=new Map(roads.map(road=>[road.id,road]))
 while(queue.length){
  const currentId=queue.shift()!,current=roadById.get(currentId);if(!current)continue
  if(currentId===end.road.id)break
  const [gx,gz]=cellForPoint(current.position)
  const neighbours=(Object.entries(ROAD_DIRECTION_OFFSET) as [RoadDirection,readonly [number,number]][]).flatMap(([direction,[dx,dz]])=>{
   if(!ports.get(current.id)?.has(direction))return []
   const candidate=byCell.get(cellKey(gx+dx,gz+dz))
   return candidate&&ports.get(candidate.id)?.has(OPPOSITE_ROAD_DIRECTION[direction])?[candidate]:[]
  }).sort((a,b)=>stableHash(`${options.seed??''}:${a.id}`)-stableHash(`${options.seed??''}:${b.id}`)||a.id.localeCompare(b.id))
  for(const neighbour of neighbours){if(visited.has(neighbour.id))continue;visited.add(neighbour.id);previous.set(neighbour.id,currentId);queue.push(neighbour.id)}
 }
 if(!visited.has(end.road.id))return makeRoute([[start.point[0],y,start.point[1]]],false,origin.rotation)
 const path=[end.road.id]
 while(path[0]!==start.road.id){const parent=previous.get(path[0]);if(!parent)break;path.unshift(parent)}
 const centres=path.map(id=>roadById.get(id)!).map(road=>[road.position[0],y,road.position[1]] as WorldPoint)
 return makeRoute([[start.point[0],y,start.point[1]],...centres,[end.point[0],y,end.point[1]]],true,origin.rotation)
}

/** Sample a route at normalized progress using cumulative world-space length. */
export function samplePedestrianRoute(route:PedestrianRoute,progress:number):PedestrianRouteSample{
 const normalized=Number.isFinite(progress)?Math.max(0,Math.min(1,progress)):0
 const first=route.points[0]??[0,PEDESTRIAN_HEIGHT,0]
 if(route.length<=EPSILON||route.points.length<2){
  return {position:[first[0],first[1],first[2]],rotation:route.initialRotation,distance:0,segmentIndex:0,done:route.reachable}
 }
 const distance=route.length*normalized
 let low=1,high=route.cumulativeLengths.length-1
 while(low<high){
  const middle=Math.floor((low+high)/2)
  if(route.cumulativeLengths[middle]<distance)low=middle+1
  else high=middle
 }
 const endIndex=low
 const startIndex=endIndex-1
 const startDistance=route.cumulativeLengths[startIndex]
 const segmentLength=route.cumulativeLengths[endIndex]-startDistance
 const local=segmentLength<=EPSILON?0:(distance-startDistance)/segmentLength
 const start=route.points[startIndex],end=route.points[endIndex]
 return {
  position:[
   start[0]+(end[0]-start[0])*local,
   start[1]+(end[1]-start[1])*local,
   start[2]+(end[2]-start[2])*local,
  ],
  rotation:Math.atan2(end[0]-start[0],end[2]-start[2]),
  distance,
  segmentIndex:startIndex,
  done:route.reachable&&normalized>=1,
 }
}
