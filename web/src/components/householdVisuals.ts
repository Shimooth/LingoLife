import type {AnimationCue,AvatarConfig,ObservableLifeState} from '../types'
import type {NormalizedResidentAction} from '../life/normalizeWorldSnapshot'

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
