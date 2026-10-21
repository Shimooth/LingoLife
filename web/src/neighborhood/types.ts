import type {NpcProfile} from '../types'
import type {ArrivalFood,ArrivalState} from '../arrival/types'

export type NeighborhoodTopic={text:string;kind:'person'|'object'|'activity'|'other';person_id?:string}
export type NeighborhoodAliases={a_to_b:string;b_to_a:string}
export type NeighborhoodResident={id:string;profile:NpcProfile;care:ArrivalState['care'];micro_personalities:string[]}
export type NeighborhoodGift={id:string;name:string;name_zh:string;kind:'item'|'micro';description:string;description_zh:string;emoji:string;price?:number}
export type NeighborhoodClothing={id:string;name:string;name_zh:string;price:number;outfit:string;outfit_color:string;models:string[]}
export type NeighborhoodNews={id:string;kind:string;title:string;title_zh:string;body:string;body_zh:string;read:boolean;created_at:string}
export type NeighborhoodBeat={id:string;speaker_id?:string;text:string;text_zh:string;shot:'wide'|'two_shot'|'speaker'|'reaction';cue:string}
export type NeighborhoodScene={
 id:string;kind:'wish'|'gift'|'clothing'|'meeting'|'friendship'|'romance'|'food';title:string;title_zh:string;
 participant_ids:string[];beats:NeighborhoodBeat[];
 result:{outcome:string;food_id?:string;coins_awarded?:number;friendship?:string;romance?:string;choices?:{npc_id:string;choice:string}[]};created_at:string
}
export type NeighborhoodMeeting={
 id:string;npc_id:string;target_id:string;status:'awaiting_advice'|'resolved'|'declined';
 topic?:NeighborhoodTopic;friendship:string;romance:string;aliases?:NeighborhoodAliases;
 romance_eligible:boolean;romance_advised:boolean;romance_reason?:string
}
/** The hook supplies a durable idempotency key for each unresolved intent. */
export type NeighborhoodCommand={
 action:'read_news'|'wish'|'gift'|'buy_clothing'|'wear_clothing'|'meet'|'friendship'|'nicknames'|'romance'|'buy_food'|'feed'|'claim_support'|'buy_gift'|'fund_project';
 npc_id?:string;target_id?:string;item_id?:string;news_id?:string;meeting_id?:string;
 day?:string;project_id?:string;
 advice?:'encourage'|'discourage';topic?:NeighborhoodTopic;aliases?:NeighborhoodAliases
}
export type NeighborhoodReceipt={id:string;action:string;scene_id?:string;news_id?:string;item_id?:string;meeting_id?:string;project_id?:string;outcome?:string;coins_awarded?:number}
export type NeighborhoodProject={
 id:'fountain'|'clothing_store'|'flower_beds'|'plaza_lights';status:'locked'|'proposed'|'completed';cost:number;
 title:string;title_zh:string;reason:string;reason_zh:string;requester_id?:string;
 requirements:{id:string;label:string;label_zh:string;met:boolean}[];completed_at?:string
}
export type NeighborhoodEconomy={
 day:string;reset_at:string;support:{amount:number;claimed:boolean};care_reward:{amount:number;claimed:boolean};social_reward:{amount:number;remaining_pairs:number};
 ledger:{id:string;delta:number;balance:number;label:string;label_zh:string;created_at:string}[]
}
export type NeighborhoodState={
 version:1;revision:number;enabled:boolean;coins:number;residents:NeighborhoodResident[];
 unlocks:{fountain:boolean;clothing_store:boolean;resident_slots:number};
 wishes:{available:number;earned:number;spent:number};gift_catalog:NeighborhoodGift[];gifts:Record<string,number>;
 clothing_catalog:NeighborhoodClothing[];wardrobe:Record<string,number>;food_catalog:ArrivalFood[];food_inventory:Record<string,number>;
 news:NeighborhoodNews[];meetings:NeighborhoodMeeting[];scenes:NeighborhoodScene[];last_receipt?:NeighborhoodReceipt|null
 economy?:NeighborhoodEconomy;projects?:NeighborhoodProject[]
}
