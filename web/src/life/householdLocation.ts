import type {HouseholdResidentVisual} from '../components/householdVisuals'
import type {HouseholdRoom,HouseholdResource,LifeActionType} from '../types'

export type HouseholdResidentFocus={id:string;request:number}
export const privateHouseholdActivity=(resident:HouseholdResidentVisual)=>resident.currentAction?.source==='life'&&(resident.currentAction.raw.visible_context?.visibility==='private'||resident.currentAction.type==='sleep'||resident.currentAction.type==='shower')
const ACTION_ROOM:Partial<Record<LifeActionType,string>>={prepare_food:'kitchen',eat:'kitchen',clean_shared_space:'living_room',leave_dishes:'kitchen',shower:'bathroom',sleep:'bedroom',rest_alone:'living_room',use_television:'living_room',read:'living_room',practice_hobby:'living_room',borrow_household_item:'living_room',seek_company:'living_room',talk_to_resident:'living_room'}
export function householdResidentRoom(resident:HouseholdResidentVisual,rooms:HouseholdRoom[],resources:HouseholdResource[]):string|undefined{
 // A private intention does not make the physical resident invisible. Only
 // use the public room/action; hidden thoughts and resource targets stay hidden.
 if(resident.isHome===false)return undefined
 if(resident.roomId){
  const exact=rooms.find(room=>room.id===resident.roomId)
  if(exact)return exact.id
  const aliases:Record<string,string>={'shared-kitchen':'kitchen','shared-bathroom':'bathroom','living-room':'living_room','private-bedroom':'bedroom'}
  const kind=aliases[resident.roomId]??resident.roomId
  const compatible=rooms.find(room=>room.kind===kind)
  if(compatible)return compatible.id
 }
 const action=resident.currentAction?.source==='life'?resident.currentAction:undefined
 const target=action?.targetResourceId&&resources.find(resource=>resource.id===action.targetResourceId)
 if(target&&rooms.some(room=>room.id===target.room_id))return target.room_id
 return rooms.find(room=>room.kind===(action&&ACTION_ROOM[action.type]))?.id??rooms.find(room=>/living|shared/.test(room.kind))?.id??rooms[0]?.id
}
