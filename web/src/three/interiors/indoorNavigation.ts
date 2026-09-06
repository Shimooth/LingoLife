import {SHARED_HOME_MANIFEST,sharedHomeRoomForKind} from './sharedHomeLayout'
import type {WorldLayoutInteriorPlacement} from '../../worldLayout'
type Point=[number,number,number]
type Obstacle={x:number;z:number;halfX:number;halfZ:number;angle:number}

/** Small room-local grid. Authoring changes rebuild its obstacles; no backend route is rewritten. */
export function indoorWalkPath(from:Point,to:Point,kind:string,authored:readonly WorldLayoutInteriorPlacement[]=[]):Point[]{
 const placements=authored.length?authored.map(p=>({asset:p.asset,position:[p.position.x,p.position.y,p.position.z],rotation:p.rotation.y,scale:[p.scale.x,p.scale.y,p.scale.z]})):sharedHomeRoomForKind(kind).placements
 const obstacles:Obstacle[]=[]
 for(const item of placements){
  if(/floor|rug|lamp|book|dish|meal|plate|kettle|plant/.test(item.asset))continue
  const asset=item.asset.replace('/assets/life/interiors/','')
  const footprint=SHARED_HOME_MANIFEST.asset_footprints[asset]
  if(!footprint)continue
  obstacles.push({x:item.position[0],z:item.position[2],halfX:footprint[0]*item.scale[0]/2+.13,halfZ:footprint[1]*item.scale[2]/2+.13,angle:item.rotation})
 }
 const free=(x:number,z:number)=>!obstacles.some(box=>{
  const dx=x-box.x,dz=z-box.z,c=Math.cos(box.angle),s=Math.sin(box.angle)
  return Math.abs(dx*c-dz*s)<box.halfX&&Math.abs(dx*s+dz*c)<box.halfZ
 })
 const step=.22,width=45,depth=28,minX=-4.85,minZ=-2.7
 const point=(id:number):Point=>[minX+(id%width)*step,to[1],minZ+Math.floor(id/width)*step]
 const open=new Set<number>()
 for(let id=0;id<width*depth;id++){const p=point(id);if(free(p[0],p[2]))open.add(id)}
 const closest=(position:Point)=>[...open].sort((a,b)=>{
  const p=point(a),q=point(b)
  return Math.hypot(p[0]-position[0],p[2]-position[2])-Math.hypot(q[0]-position[0],q[2]-position[2])
 })[0]
 const start=closest(from),end=closest(to)
 if(start===undefined||end===undefined)return []
 const queue=[start],parent=new Map<number,number>([[start,-1]])
 for(let cursor=0;cursor<queue.length&&!parent.has(end);cursor++){
  const here=queue[cursor],x=here%width,z=Math.floor(here/width)
  for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
   const nx=x+dx,nz=z+dz,next=nz*width+nx
   if(nx<0||nx>=width||nz<0||nz>=depth||!open.has(next)||parent.has(next))continue
   parent.set(next,here);queue.push(next)
  }
 }
 if(!parent.has(end))return [] // Do not walk through furniture to rescue an invalid authoring layout.
 const ids:number[]=[];let cursor=end
 while(cursor!==-1){ids.push(cursor);cursor=parent.get(cursor)!}
 const route=ids.reverse().map(point)
 // The final short segment is the deliberate furniture approach/sit-down, not a room crossing.
 if(Math.hypot(route.at(-1)![0]-to[0],route.at(-1)![2]-to[2])<.75)route.push(to)
 return route
}
