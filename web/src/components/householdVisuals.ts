import type {AnimationCue,AvatarConfig,ObservableLifeState,SharedDrinkStaging} from '../types'
import type {NormalizedResidentAction} from '../life/normalizeWorldSnapshot'
import type {WorldLayoutInteriorPlacement} from '../worldLayout'
import {sharedHomeDefaultPlacements} from '../three/interiors/sharedHomeLayout'
import {resolveSharedDrinkLayout} from '../three/interiors/sharedDrinkLayout'

/** Observable-only resident data for a household cutaway. The backend may
 * provide an explicit room later; current actions/resources are enough for the
 * first visual placement pass without exposing hidden agent state. */
export type HouseholdResidentVisual={
 id:string
 name:string
 avatar:AvatarConfig
 isHome?:boolean
 roomId?:string|null
 privateRoomId?:string|null
 currentAction?:NormalizedResidentAction|null
 animationCue?:AnimationCue
 observableState?:ObservableLifeState|null
}

/** IndoorEnvironment3D's preview transform is applied numerically, not as a
 * parent group: the physical hand targets and cup grips are world coordinates. */
export function householdDrinkPlacements(placements?:readonly WorldLayoutInteriorPlacement[]):WorldLayoutInteriorPlacement[]{
 const source=placements??sharedHomeDefaultPlacements('living_room').map(item=>({
  id:item.id,room_id:'living-room',asset:`/assets/life/interiors/${item.asset}`,
  position:{x:item.position[0],y:item.position[1],z:item.position[2]},rotation:{x:0,y:item.rotation,z:0},
  scale:{x:item.scale[0],y:item.scale[1],z:item.scale[2]},
 }))
 return source.map(item=>({...item,
  position:{x:item.position.x*.99,y:item.position.y*.99-.08,z:item.position.z*.99+.05},
  scale:{x:item.scale.x*.99,y:item.scale.y*.99,z:item.scale.z*.99},
 }))
}

/** Only server-public, currently overlapping actions may own the two seats.
 * An invitation, an old story, or one resident's stale projection is not proof
 * that both people are drinking. Extra residents keep their ordinary behavior. */
export function householdSharedDrink(residents:readonly HouseholdResidentVisual[],roomKind:string,placements:readonly WorldLayoutInteriorPlacement[]){
 if(roomKind!=='living_room')return undefined
 const layout=resolveSharedDrinkLayout(placements)
 if(!layout.usable)return undefined
 const eligible=residents.filter(person=>{
  const action=person.currentAction,context=action?.source==='life'?action.raw.visible_context:undefined
  return person.isHome!==false&&action?.source==='life'&&action.status==='performing'&&action.type==='talk_to_resident'
   &&context?.visibility!=='private'&&context?.activity_kind==='drink_break'&&context.activity_phase==='active'
   &&typeof context.activity_id==='string'&&context.activity_id.length>0
 })
 for(const first of [...eligible].sort((a,b)=>a.id.localeCompare(b.id))){
  const action=first.currentAction!
  if(action.source!=='life')continue
  const context=action.raw.visible_context!,ids=context.activity_participant_ids
  if(!Array.isArray(ids)||ids.length!==2||new Set(ids).size!==2||!ids.includes(first.id)||!ids.includes(context.activity_initiator_id??''))continue
  const beverage=context.activity_beverage
  if(!beverage||!['tea','coffee','water'].includes(beverage))continue
  const people=ids.map(id=>eligible.find(person=>person.id===id))
  if(people.some(person=>!person))continue
  if(!people.every(person=>{
   const other=person!.currentAction
   if(other?.source!=='life'||other.locationId!==action.locationId)return false
   const value=other.raw.visible_context
   return value!==undefined&&value.activity_id===context.activity_id&&value.activity_initiator_id===context.activity_initiator_id
    &&value.activity_beverage===beverage&&value.activity_participant_ids?.length===2&&ids.every(id=>value.activity_participant_ids!.includes(id))
  }))continue
  const staging:SharedDrinkStaging={kind:'shared_drink',phase:'active',participant_ids:[...ids],initiator_id:context.activity_initiator_id!,beverage}
  return {id:context.activity_id!,staging,residents:people as HouseholdResidentVisual[],layout}
 }
 return undefined
}
