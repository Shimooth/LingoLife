import type {LifeStory} from '../../types'
import {isSharedDrinkStage} from './sharedDrinkPerformance.ts'

const CAFE_LOCATIONS=new Set(['moonlight_cafe','garden_cafe'])

/** A cafe title or a coffee-related interest is not evidence of shared drinking.
 * Only the frozen public story contract can select the cafe performance. The
 * residents remain indoors; this does not opt them into the city-map cast. */
export function isCafeDrinkStory(story:Pick<LifeStory,'location_id'|'presentation'|'participant_ids'>):boolean{
 const location=story.location_id,stage=story.presentation?.staging
 if(!location||!CAFE_LOCATIONS.has(location)||!isSharedDrinkStage(stage))return false
 if(story.location_id&&story.presentation?.location?.id&&story.location_id!==story.presentation.location.id)return false
 return story.participant_ids.length===2&&new Set(story.participant_ids).size===2
  &&stage.participant_ids.every(id=>story.participant_ids.includes(id))
}
