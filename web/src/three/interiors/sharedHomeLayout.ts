import sharedHomeSource from '../../../../config/shared-home-layout.json'
import type {LifeActionType} from '../../types'
import type {WorldLayoutInteriorPlacement} from '../../worldLayout'

export type SharedHomeRoomKind='living_room'|'kitchen'|'bathroom'|'bedroom'
export type SharedHomePrivacy='open'|'private'

export type SharedHomePlacement={
 id:string
 asset:string
 position:readonly [number,number,number]
 rotation:number
 scale:readonly [number,number,number]
}

export type SharedHomeAnchor={
 id:string
 kind:string
 position:readonly [number,number,number]
 rotation:number
 privacy:SharedHomePrivacy
 fixture_id?:string
 slot?:number
 actions:readonly LifeActionType[]
}

export type SharedHomeBounds=readonly [minX:number,maxX:number,minZ:number,maxZ:number]

export type SharedHomeCorridor={
 id:string
 bounds:SharedHomeBounds
 entry_anchor_id:string
 minimum_clearance:number
}

export type SharedHomePrivateSpace={
 id:string
 slot:number
 bounds:SharedHomeBounds
 door:{
  wall:'north'|'south'
  center_x:number
  width:number
  approach:readonly [number,number,number]
 }
 fixture_ids:readonly [bedId:string,lightId:string,personalTraceId:string]
 bed_anchor_id:string
 door_anchor_id:string
 accent:string
 trace:'sketchbook'|'books'|'music'|'camera'|'plants'|'crafts'|'games'|'travel'
}

export type SharedHomeRoom={
 id:string
 name:string
 kind:SharedHomeRoomKind
 placements:readonly SharedHomePlacement[]
 anchors:readonly SharedHomeAnchor[]
 corridors?:readonly SharedHomeCorridor[]
 private_spaces?:readonly SharedHomePrivateSpace[]
}

export type SharedHomeResourceContract={
 kind:'kitchen'|'television'|'bathroom'
 room_id:string
 capacity:number
 fixture_ids:readonly string[]
}

type SharedHomeManifest={
 version:1
 max_residents:8
 occupancy_scenarios:readonly [2,4,8]
 room_bounds:{width:number;depth:number;center_z:number}
 room_connections:readonly (readonly [from:string,to:string])[]
 resources:readonly SharedHomeResourceContract[]
 asset_footprints:Readonly<Record<string,readonly [number,number]>>
 rooms:readonly SharedHomeRoom[]
}

/**
 * One checked-in manifest is consumed by the browser, backend defaults and
 * static guards. It describes the only production-quality shared residence;
 * the eight private-bed anchors live inside eight physically separated,
 * resident-owned bedrooms connected by one walkable hall.
 */
export const SHARED_HOME_MANIFEST=sharedHomeSource as unknown as SharedHomeManifest
export const SHARED_HOME_MAX_RESIDENTS=SHARED_HOME_MANIFEST.max_residents
export const SHARED_HOME_OCCUPANCY_SCENARIOS=SHARED_HOME_MANIFEST.occupancy_scenarios
export const SHARED_HOME_RESOURCES=SHARED_HOME_MANIFEST.resources
export const SHARED_HOME_PRIVATE_SPACES=SHARED_HOME_MANIFEST.rooms.find(room=>room.kind==='bedroom')?.private_spaces??[]

export const sharedHomeRoomForKind=(kind:string):SharedHomeRoom=>
 SHARED_HOME_MANIFEST.rooms.find(room=>room.kind===kind)??SHARED_HOME_MANIFEST.rooms[0]

export const sharedHomeDefaultPlacements=(kind:string):readonly SharedHomePlacement[]=>
 sharedHomeRoomForKind(kind).placements

const stableIndex=(value:string,modulo:number)=>{
 let hash=2166136261
 for(let index=0;index<value.length;index+=1){hash^=value.charCodeAt(index);hash=Math.imul(hash,16777619)}
 return modulo?Math.abs(hash)%modulo:0
}

const placementTuple=(placement:WorldLayoutInteriorPlacement|SharedHomePlacement)=>{
 const source=placement.position
 if(Array.isArray(source))return source as unknown as readonly [number,number,number]
 const vector=source as WorldLayoutInteriorPlacement['position']
 return [vector.x,vector.y,vector.z] as const
}

const placementRotation=(placement:WorldLayoutInteriorPlacement|SharedHomePlacement)=>
 typeof placement.rotation==='number'?placement.rotation:placement.rotation.y

function authoredAnchor(anchor:SharedHomeAnchor,room:SharedHomeRoom,placements:readonly WorldLayoutInteriorPlacement[]):SharedHomeAnchor{
 if(!anchor.fixture_id)return anchor
 const authored=placements.find(item=>item.id===anchor.fixture_id)
 const original=room.placements.find(item=>item.id===anchor.fixture_id)
 if(!authored||!original)return anchor
 const [originalX,originalY,originalZ]=placementTuple(original)
 const [authoredX,authoredY,authoredZ]=placementTuple(authored)
 const difference=placementRotation(authored)-placementRotation(original)
 const offsetX=anchor.position[0]-originalX,offsetZ=anchor.position[2]-originalZ
 const cosine=Math.cos(difference),sine=Math.sin(difference)
 return {...anchor,
  position:[authoredX+offsetX*cosine-offsetZ*sine,authoredY+(anchor.position[1]-originalY),authoredZ+offsetX*sine+offsetZ*cosine],
  rotation:anchor.rotation+difference,
 }
}

export type SharedHomeResidentAnchorInput={id:string;actionType?:LifeActionType|null}
export type SharedHomeResolvedAnchor={id:string;position:[number,number,number];rotation:number}
export type SharedHomePrivateSpaceInput={id:string;privateRoomId?:string|null}
export type SharedHomePrivateSpaceAssignment={residentId:string;slot:number;space:SharedHomePrivateSpace}

const explicitPrivateSlot=(privateRoomId?:string|null)=>{
 const match=privateRoomId?.match(/private-room-(\d{2})$/)
 const slot=match?Number(match[1]):0
 return SHARED_HOME_PRIVATE_SPACES.some(space=>space.slot===slot)?slot:undefined
}

/**
 * Mirrors the server's durable sorted-roster binding while honoring an
 * explicit private_room_id when it is present. Input order only controls the
 * returned order; it cannot reshuffle somebody's bedroom between renders.
 */
export function resolveSharedHomePrivateSpaces(
 residents:readonly SharedHomePrivateSpaceInput[],
):SharedHomePrivateSpaceAssignment[]{
 const bySlot=new Map(SHARED_HOME_PRIVATE_SPACES.map(space=>[space.slot,space]))
 const sorted=[...residents].sort((first,second)=>first.id.localeCompare(second.id))
 const assigned=new Map<string,number>(),used=new Set<number>()
 for(const resident of sorted){
  const slot=explicitPrivateSlot(resident.privateRoomId)
  if(slot&&!used.has(slot)){assigned.set(resident.id,slot);used.add(slot)}
 }
 const available=SHARED_HOME_PRIVATE_SPACES.map(space=>space.slot).filter(slot=>!used.has(slot))
 for(const resident of sorted){
  if(assigned.has(resident.id))continue
  const slot=available.shift()
  if(slot)assigned.set(resident.id,slot)
 }
 return residents.flatMap(resident=>{
  const slot=assigned.get(resident.id),space=slot?bySlot.get(slot):undefined
  return slot&&space?[{residentId:resident.id,slot,space}]:[]
 })
}

/**
 * Allocates collision-free observable staging points. Resource contention is
 * still server-owned; excess residents fall back to a nearby idle/queue point
 * instead of occupying the same chair, counter or doorway in the renderer.
 */
export function resolveSharedHomeResidentAnchors(
 roomKind:string,
 residents:readonly SharedHomeResidentAnchorInput[],
 placements:readonly WorldLayoutInteriorPlacement[]=[],
):SharedHomeResolvedAnchor[]{
 const room=sharedHomeRoomForKind(roomKind)
 const resolved=room.anchors.map(anchor=>authoredAnchor(anchor,room,placements))
 const idle=resolved.filter(anchor=>anchor.privacy==='open'&&anchor.kind==='idle')
 const entry=resolved.filter(anchor=>anchor.privacy==='open'&&anchor.kind==='entry')
 const used=new Set<string>()
 return residents.map((resident,residentIndex)=>{
  const actionCandidates=resident.actionType
   ?resolved.filter(anchor=>anchor.privacy==='open'&&anchor.actions.includes(resident.actionType as LifeActionType))
   :[]
  const candidates=[...actionCandidates,...idle,...entry,...resolved.filter(anchor=>anchor.privacy==='open')]
  const unique=candidates.filter((anchor,index)=>candidates.findIndex(value=>value.id===anchor.id)===index)
  const start=stableIndex(`${resident.id}:${resident.actionType??'idle'}:${residentIndex}`,Math.max(1,actionCandidates.length||idle.length||unique.length))
  const chosen=[...unique.slice(start),...unique.slice(0,start)].find(anchor=>!used.has(anchor.id))??unique[0]
  if(!chosen)return {id:`fallback-${resident.id}`,position:[-.9+residentIndex*.9,-.17,.8],rotation:residentIndex%2?.25:-.25}
  used.add(chosen.id)
  return {id:chosen.id,position:[...chosen.position],rotation:chosen.rotation}
 })
}
