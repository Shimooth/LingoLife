import {roadConnections,ROAD_TILE_STEP,ROAD_DIRECTION_OFFSET,OPPOSITE_ROAD_DIRECTION,type RoadDirection,type RoadTilePlacement} from './worldData.ts'

export type TrafficRoute={id:string;points:[number,number][];closed:boolean}
/** Route from one open sky-road end to another using reciprocal cells only. */
export function trafficRoutes(roads:readonly RoadTilePlacement[]):TrafficRoute[]{
 const key=(p:readonly number[])=>p.map(x=>x.toFixed(3)).join(':')
 const cells=new Map(roads.map(r=>[key(r.position),r]))
 const neighbours=(r:RoadTilePlacement)=>roadConnections(r).flatMap(d=>{
  const [x,z]=ROAD_DIRECTION_OFFSET[d],next=cells.get(key([r.position[0]+x*ROAD_TILE_STEP,r.position[1]+z*ROAD_TILE_STEP]))
  return next&&roadConnections(next).includes(OPPOSITE_ROAD_DIRECTION[d])?[next]:[]
 })
 const exits=roads.filter(r=>r.surface==='skyway'&&neighbours(r).length===1).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,3)
 const routes:TrafficRoute[]=[]
 for(const start of exits)for(const finish of exits){
  if(start===finish)continue
  const queue=[start],parents=new Map<string,RoadTilePlacement|null>([[start.id,null]])
  for(let i=0;i<queue.length&&!parents.has(finish.id);i++)for(const next of neighbours(queue[i]))if(!parents.has(next.id)){parents.set(next.id,queue[i]);queue.push(next)}
  if(!parents.has(finish.id))continue
  const path:RoadTilePlacement[]=[]
  for(let current:RoadTilePlacement|null=finish;current;current=parents.get(current.id)??null)path.unshift(current)
  if(path.length>2)routes.push({id:`${start.id}>${finish.id}`,points:path.map(r=>[...r.position]),closed:false})
 }
 const loop=trafficLoop(roads)
 if(loop.length)for(const reverse of [false,true])routes.push({id:`city-loop-${reverse}`,points:reverse?[...loop].reverse():loop,closed:true})
 return routes
}

/** Find a closed, reciprocal road loop; never shortcut across building lots. */
export function trafficLoop(roads:readonly RoadTilePlacement[]):[number,number][] {
 const key=(x:number,z:number)=>`${x.toFixed(3)}:${z.toFixed(3)}`
 const cells=new Map(roads.map(road=>[key(...road.position),road]))
 const directions:RoadDirection[]=['north','east','south','west']
 for(const start of roads)for(const first of roadConnections(start)){
  let current=start,direction=first
  const path:RoadTilePlacement[]=[start],seen=new Set([start.id])
  for(let count=0;count<roads.length;count++){
   const [dx,dz]=ROAD_DIRECTION_OFFSET[direction]
   const next=cells.get(key(current.position[0]+dx*ROAD_TILE_STEP,current.position[1]+dz*ROAD_TILE_STEP))
   if(!next||!roadConnections(next).includes(OPPOSITE_ROAD_DIRECTION[direction]))break
   if(next.id===start.id){if(path.length>=12)return path.map(p=>[...p.position]);break}
   if(seen.has(next.id))break
   seen.add(next.id);path.push(next)
   const heading=directions.indexOf(direction)
   const onward=[directions[(heading+1)%4],direction,directions[(heading+3)%4]].find(candidate=>{
    if(!roadConnections(next).includes(candidate))return false
    const [ox,oz]=ROAD_DIRECTION_OFFSET[candidate]
    const neighbour=cells.get(key(next.position[0]+ox*ROAD_TILE_STEP,next.position[1]+oz*ROAD_TILE_STEP))
    return neighbour&&roadConnections(neighbour).includes(OPPOSITE_ROAD_DIRECTION[candidate])
   })
   if(!onward)break
   current=next;direction=onward
  }
 }
 return []
}
