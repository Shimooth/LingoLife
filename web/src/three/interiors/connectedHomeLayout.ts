import {SHARED_HOME_MANIFEST,SHARED_HOME_PRIVATE_SPACES,sharedHomeRoomForKind} from './sharedHomeLayout'
import type {SharedHomeRoomKind} from './sharedHomeLayout'
import type {WorldLayoutInteriorPlacement} from '../../worldLayout'

export type HomePoint=[number,number,number]
export type HomeBounds=readonly [minX:number,maxX:number,minZ:number,maxZ:number]
export type HomeWall={id:string;kind:SharedHomeRoomKind;position:HomePoint;size:readonly [width:number,depth:number];private?:boolean}
export type ConnectedHomeRoom={
 kind:SharedHomeRoomKind
 offset:HomePoint
 bounds:HomeBounds
 portal:{wall:'north'|'south'|'west';center:HomePoint;localCenter:HomePoint;width:number}
 walls:readonly HomeWall[]
}

const PREVIEW_SCALE=.99
const LOCAL_BOUNDS:HomeBounds=[-5.3,5.3,-3.95,3.25]
const OUTER_WALL=.14*PREVIEW_SCALE
const PARTITION_WALL=.1*PREVIEW_SCALE
const ACTOR_CLEARANCE=.14
const GRID_STEP=.16
const offsets:Record<SharedHomeRoomKind,HomePoint>={
 living_room:[-6.2,0,4.6],kitchen:[-6.2,0,-4.6],bathroom:[6.2,0,-4.6],bedroom:[6.2,0,4.6],
}

export function connectedHomeOffset(kind:string):HomePoint{
 return [...(offsets[kind as SharedHomeRoomKind]??offsets.living_room)]
}

/** Resident anchors already describe feet in the preview. Do not scale them again. */
export function connectedHomePoint(point:readonly number[],kind:string):HomePoint{
 const offset=connectedHomeOffset(kind)
 return [point[0]+offset[0],point[1]+offset[1],point[2]+offset[2]]
}

/** Authored furniture, room shells and fixture contact targets use the preview transform. */
export function connectedHomeFixturePoint(point:readonly number[],kind:string):HomePoint{
 return connectedHomePoint([point[0]*PREVIEW_SCALE,point[1]*PREVIEW_SCALE-.08,point[2]*PREVIEW_SCALE+.05],kind)
}

function wall(kind:SharedHomeRoomKind,id:string,bounds:HomeBounds,privateWall=false):HomeWall{
 const [minX,maxX,minZ,maxZ]=bounds
 return {id,kind,position:[(minX+maxX)/2,0,(minZ+maxZ)/2],size:[maxX-minX,maxZ-minZ],...(privateWall?{private:true}:{})}
}

function room(kind:SharedHomeRoomKind):ConnectedHomeRoom{
 const [minX,,minZ]=connectedHomeFixturePoint([LOCAL_BOUNDS[0],0,LOCAL_BOUNDS[2]],kind)
 const [maxX,,maxZ]=connectedHomeFixturePoint([LOCAL_BOUNDS[1],0,LOCAL_BOUNDS[3]],kind)
 const portalWall=kind==='living_room'?'north':kind==='bedroom'?'west':'south'
 const localCenter:HomePoint=portalWall==='west'?[-5.3,0,-.04]:[0,0,portalWall==='north'?-3.95:3.25]
 const portal={wall:portalWall,center:connectedHomeFixturePoint(localCenter,kind),localCenter,width:(kind==='bedroom'?1.3:1.5)*PREVIEW_SCALE} as ConnectedHomeRoom['portal']
 const walls:HomeWall[]=[]
 for(const side of ['north','south','west','east'] as const){
  const horizontal=side==='north'||side==='south'
  const edge=side==='north'?minZ:side==='south'?maxZ:side==='west'?minX:maxX
  const start=horizontal?minX:minZ,end=horizontal?maxX:maxZ
  const segments=side===portal.wall?[[start,(horizontal?portal.center[0]:portal.center[2])-portal.width/2],[(horizontal?portal.center[0]:portal.center[2])+portal.width/2,end]]:[[start,end]]
  for(const [index,[low,high]] of segments.entries()){
   walls.push(wall(kind,`${kind}-${side}-${index}`,horizontal?[low,high,edge-OUTER_WALL/2,edge+OUTER_WALL/2]:[edge-OUTER_WALL/2,edge+OUTER_WALL/2,low,high]))
  }
 }
 return {kind,offset:connectedHomeOffset(kind),bounds:[minX,maxX,minZ,maxZ],portal,walls}
}

export const CONNECTED_HOME_ROOMS:readonly ConnectedHomeRoom[]=(['living_room','kitchen','bathroom','bedroom'] as const).map(room)
const roomByKind=new Map(CONNECTED_HOME_ROOMS.map(item=>[item.kind,item]))
const west=roomByKind.get('living_room')!,east=roomByKind.get('bedroom')!,north=roomByKind.get('kitchen')!
export const CONNECTED_HOME_BOUNDS:HomeBounds=[west.bounds[0],east.bounds[1],north.bounds[2],east.bounds[3]]
export const CONNECTED_HOME_CORRIDORS:readonly HomeBounds[]=[
 [west.bounds[0],east.bounds[1],north.bounds[3],west.bounds[2]],
 [west.bounds[1],east.bounds[0],north.bounds[2],east.bounds[3]],
]

function privateWalls():HomeWall[]{
 const result:HomeWall[]=[]
 for(const space of SHARED_HOME_PRIVATE_SPACES){
  const [minX,,minZ]=connectedHomeFixturePoint([space.bounds[0],0,space.bounds[2]],'bedroom')
  const [maxX,,maxZ]=connectedHomeFixturePoint([space.bounds[1],0,space.bounds[3]],'bedroom')
  const front=space.door.wall==='south'?maxZ:minZ,back=space.door.wall==='south'?minZ:maxZ
  const center=connectedHomeFixturePoint([space.door.center_x,0,0],'bedroom')[0],halfDoor=space.door.width*PREVIEW_SCALE/2
  for(const [id,bounds] of [
   ['west',[minX-PARTITION_WALL/2,minX+PARTITION_WALL/2,minZ,maxZ]],
   ['east',[maxX-PARTITION_WALL/2,maxX+PARTITION_WALL/2,minZ,maxZ]],
   ['back',[minX,maxX,back-PARTITION_WALL/2,back+PARTITION_WALL/2]],
   ['front-left',[minX,center-halfDoor,front-PARTITION_WALL/2,front+PARTITION_WALL/2]],
   ['front-right',[center+halfDoor,maxX,front-PARTITION_WALL/2,front+PARTITION_WALL/2]],
  ] as const)result.push(wall('bedroom',`${space.id}-${id}`,bounds,true))
 }
 return result
}

/** The renderer and navigator consume the same openings rather than guessing wall locations. */
export const CONNECTED_HOME_WALLS:readonly HomeWall[]=[...CONNECTED_HOME_ROOMS.flatMap(item=>item.walls),...privateWalls()]
type Obstacle={id:string;x:number;z:number;halfX:number;halfZ:number;angle:number;wall:boolean}
type HomeAuthoredRoom={kind:string;placements?:readonly WorldLayoutInteriorPlacement[]}
type NavigationGrid={obstacles:Obstacle[];open:Uint8Array;width:number;depth:number;minX:number;minZ:number}
let cachedKey='',cachedGrid:NavigationGrid|undefined
const inBounds=(x:number,z:number,bounds:HomeBounds)=>x>=bounds[0]&&x<=bounds[1]&&z>=bounds[2]&&z<=bounds[3]
const onFloor=(x:number,z:number)=>CONNECTED_HOME_ROOMS.some(item=>inBounds(x,z,item.bounds))||CONNECTED_HOME_CORRIDORS.some(bounds=>inBounds(x,z,bounds))
const contains=(box:Obstacle,x:number,z:number,padding=ACTOR_CLEARANCE)=>{
 const dx=x-box.x,dz=z-box.z,c=Math.cos(box.angle),s=Math.sin(box.angle)
 return Math.abs(dx*c-dz*s)<box.halfX+padding&&Math.abs(dx*s+dz*c)<box.halfZ+padding
}

function navigationGrid(rooms:readonly HomeAuthoredRoom[]):NavigationGrid{
 const key=JSON.stringify(rooms)
 if(cachedGrid&&cachedKey===key)return cachedGrid
 const obstacles:Obstacle[]=CONNECTED_HOME_WALLS.map(item=>({id:item.id,x:item.position[0],z:item.position[2],halfX:item.size[0]/2,halfZ:item.size[1]/2,angle:0,wall:true}))
 for(const room of CONNECTED_HOME_ROOMS){
  const authored=rooms.find(item=>item.kind===room.kind)?.placements
  const placements=authored!==undefined?authored.map(item=>({id:item.id,asset:item.asset,position:[item.position.x,item.position.y,item.position.z],rotation:item.rotation.y,scale:[item.scale.x,item.scale.y,item.scale.z]})):sharedHomeRoomForKind(room.kind).placements
  for(const item of placements){
   if(/floor|rug|lamp|book|dish|meal|plate|kettle|plant/.test(item.asset))continue
   const footprint=SHARED_HOME_MANIFEST.asset_footprints[item.asset.replace('/assets/life/interiors/','')]
   if(!footprint)continue
   const [x,,z]=connectedHomeFixturePoint(item.position,room.kind)
   obstacles.push({id:`${room.kind}:${item.id}`,x,z,halfX:footprint[0]*item.scale[0]*PREVIEW_SCALE/2,halfZ:footprint[1]*item.scale[2]*PREVIEW_SCALE/2,angle:item.rotation,wall:false})
  }
 }
 const [minX,maxX,minZ,maxZ]=CONNECTED_HOME_BOUNDS,width=Math.ceil((maxX-minX)/GRID_STEP)+1,depth=Math.ceil((maxZ-minZ)/GRID_STEP)+1
 const open=new Uint8Array(width*depth)
 for(let id=0;id<open.length;id++){
  const x=minX+(id%width)*GRID_STEP,z=minZ+Math.floor(id/width)*GRID_STEP
  if(onFloor(x,z)&&!obstacles.some(box=>contains(box,x,z)))open[id]=1
 }
 cachedKey=key;cachedGrid={obstacles,open,width,depth,minX,minZ}
 return cachedGrid
}

/** Routes between all four rooms through their real doors and the central hall.
 * A chair/bed anchor may have one short contact segment into its own fixture;
 * no wall is waived, and unreachable authoring returns no route. */
export function connectedHomeWalkPath(from:readonly number[],to:readonly number[],rooms:readonly HomeAuthoredRoom[]=[]):HomePoint[]{
 if(from.length<3||to.length<3||!from.every(Number.isFinite)||!to.every(Number.isFinite)||!onFloor(from[0],from[2])||!onFloor(to[0],to[2]))return []
 const grid=navigationGrid(rooms)
 const point=(id:number):HomePoint=>[grid.minX+(id%grid.width)*GRID_STEP,to[1],grid.minZ+Math.floor(id/grid.width)*GRID_STEP]
 const endpointCells=(endpoint:readonly number[])=>{
  const touching=grid.obstacles.filter(box=>contains(box,endpoint[0],endpoint[2]))
  if(touching.some(box=>box.wall)||touching.length>1)return []
  const candidates:{id:number;distance:number}[]=[]
  for(let id=0;id<grid.open.length;id++){
   if(!grid.open[id])continue
   const candidate=point(id),distance=Math.hypot(candidate[0]-endpoint[0],candidate[2]-endpoint[2])
   if(distance<=1.25)candidates.push({id,distance})
  }
  candidates.sort((a,b)=>a.distance-b.distance)
  return candidates.filter(({id})=>{
   const candidate=point(id),length=Math.hypot(candidate[0]-endpoint[0],candidate[2]-endpoint[2]),steps=Math.max(1,Math.ceil(length/.045))
   for(let step=0;step<=steps;step++){
    const x=endpoint[0]+(candidate[0]-endpoint[0])*step/steps,z=endpoint[2]+(candidate[2]-endpoint[2])*step/steps
    if(!onFloor(x,z)||grid.obstacles.some(box=>!touching.includes(box)&&contains(box,x,z)))return false
   }
   return true
  }).map(item=>item.id)
 }
 const starts=endpointCells(from),ends=endpointCells(to)
 if(!starts.length||!ends.length)return []
 const parents=new Int32Array(grid.open.length);parents.fill(-2)
 const queue=new Int32Array(grid.open.length);let count=0
 for(const start of starts){parents[start]=-1;queue[count++]=start}
 for(let cursor=0;cursor<count;cursor++){
  const id=queue[cursor],column=id%grid.width,row=Math.floor(id/grid.width)
  for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
   const x=column+dx,z=row+dz,next=z*grid.width+x
   if(x<0||x>=grid.width||z<0||z>=grid.depth||!grid.open[next]||parents[next]!==-2)continue
   parents[next]=id;queue[count++]=next
  }
 }
 const end=ends.find(id=>parents[id]!==-2)
 if(end===undefined)return []
 const ids:number[]=[]
 for(let cursor=end;cursor!==-1;cursor=parents[cursor])ids.push(cursor)
 ids.reverse()
 const route:HomePoint[]=[]
 for(let index=0;index<ids.length;index++){
  const previous=ids[index-1],current=ids[index],next=ids[index+1]
  if(previous===undefined||next===undefined||current-previous!==next-current)route.push(point(current))
 }
 const last=route.at(-1)!
 if(Math.hypot(last[0]-to[0],last[2]-to[2])>.001)route.push([to[0],to[1],to[2]])
 return route
}
