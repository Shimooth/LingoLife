import type {CityResident,SpatialPresence} from '../types'

/** Older servers can at least distinguish home from an actual outdoor walk. */
export function residentPresence(resident:CityResident):SpatialPresence {
 if(resident.spatial_presence)return resident.spatial_presence
 const traveling=resident.current_action?.status==='traveling'||(!resident.current_action&&resident.world_action?.state==='walking_to_event')
 const target=resident.current_action?.location_id??resident.world_action?.target_location_id
 const targetHome=target===resident.home.id||Boolean(resident.household_id&&target?.startsWith(resident.household_id+':'))
 if(traveling&&target&&!(resident.is_home&&targetHome)&&target!==resident.current_location_id)
  return {mode:'traveling',location_id:resident.current_location_id,building_id:null}
 return {mode:resident.is_home?'indoor':'outdoor',location_id:resident.current_location_id,building_id:resident.is_home?resident.home.id:null}
}

export function visibleOnCityMap(character:{spatialPresence?:SpatialPresence}):boolean {
 return character.spatialPresence?.mode!=='indoor'
}

export function presentInHome(resident:CityResident):boolean {
 const presence=residentPresence(resident)
 return presence.mode==='indoor'&&presence.building_id===resident.home.id
}
