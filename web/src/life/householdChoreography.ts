import type {LifeActionType} from '../types'
import type {LifeMotion} from '../three/characters/lifeRetarget'

export type HouseholdBeat={motion:LifeMotion;duration:number;prop?:'cup'|'spoon'|'utensil'|'book'|'cloth';label:{zh:string;en:string}}
const beat=(motion:LifeMotion,duration:number,zh:string,en:string,prop?:HouseholdBeat['prop']):HouseholdBeat=>({motion,duration,label:{zh,en},prop})
export const HOME_BEATS:Partial<Record<LifeActionType,readonly HouseholdBeat[]>>={
 prepare_food:[beat('Working_A',11,'正在处理食材','Preparing ingredients','utensil'),beat('Idle_A',2.5,'停下来看看火候','Checking the cooking'),beat('Use_Item',6,'尝尝味道','Checking the flavor','utensil'),beat('Working_A',9,'继续准备这顿饭','Continuing the meal','utensil')],
 eat:[beat('Eating',9,'慢慢吃着饭','Enjoying the meal','spoon'),beat('Sit_Chair_Idle',4,'放下餐具，歇一会儿','Pausing between bites'),beat('Eating',7,'吃一口，再喝点水','Taking another bite','cup')],
 read:[beat('Reading',16,'读到有意思的地方','Reading a passage','book'),beat('Sit_Chair_Idle',4,'抬头想了想','Thinking about the book')],
 use_television:[beat('Sit_Chair_Idle',13,'靠着坐一会儿','Settling in to watch'),beat('Reading',3,'调整手里的遥控器','Adjusting the remote')],
 clean_shared_space:[beat('Working_A',8,'擦拭，再检查一下','Wiping the surface','cloth'),beat('Idle_A',3,'看看还有哪里没收拾','Checking the remaining mess')],
 leave_dishes:[beat('Holding_A',4,'把餐具放到一边','Setting the dishes aside'),beat('Interact',3,'整理一下手边的东西','Moving things out of the way')],
 rest_alone:[beat('Sit_Chair_Idle',18,'安静地坐一会儿','Taking a quiet moment')],
 talk_to_resident:[beat('Interact',5,'说到这里，停下来听听','Speaking, then listening'),beat('Idle_A',5,'听对方说完','Listening to the other resident')],
 seek_company:[beat('Waving',3,'打个招呼','Saying hello'),beat('Idle_A',9,'等对方回应','Giving them time to respond')],
}
export const seatedAction=(type?:LifeActionType|null)=>Boolean(type&&['eat','read','use_television','rest_alone'].includes(type))
export function householdBeat(type:LifeActionType|undefined,elapsed:number,seed:number):HouseholdBeat|undefined{
 const plan=type&&HOME_BEATS[type];if(!plan)return undefined
 const total=plan.reduce((sum,item)=>sum+item.duration,0)
 let cursor=(Math.max(0,elapsed)+Math.abs(seed)%7)%total
 for(const item of plan){if(cursor<item.duration)return item;cursor-=item.duration}
 return plan[0]
}
export function residentSeed(id:string){let hash=0;for(const c of id)hash=(Math.imul(hash,31)+c.charCodeAt(0))|0;return Math.abs(hash)}

/** Visual attention is not a new conversation or a relationship result.
 * Both residents must already be present, and only real social actions initiate it. */
export function attentionPartner(actor:{id:string;type?:LifeActionType;targetNpcId?:string},others:readonly {id:string;type?:LifeActionType}[]):string|undefined{
 if(!['talk_to_resident','seek_company'].includes(actor.type??''))return undefined
 if(actor.targetNpcId)return others.find(other=>other.id===actor.targetNpcId)?.id
 return undefined
}
