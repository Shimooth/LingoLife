import type {NpcProfile} from '../types'

export type ResidentVoice = {voice_uri:string;language:string;rate:number;pitch:number}
export type PersonalityAxes = {
 warmth:number;extraversion:number;assertiveness:number;openness:number;
 emotional_stability:number;humor:number
}
export type ManagerProfile = {name:string;birthday_month:number|null;birthday_day:number|null}
export type ArrivalDraft = {
 step:string;profile:NpcProfile;voice:ResidentVoice;personality:PersonalityAxes;manager:ManagerProfile
}
export type ArrivalAction = 'welcome_done'|'buy'|'feed'|'finish'
export type ArrivalFood = {id:string;name:string;name_zh:string;price:number;satiety:number;xp:number;emoji:string;color:string}
export type ArrivalReceipt = {
 id:string;action:string;food_id?:string;preference?:number;xp_gained?:number;
 leveled_up?:boolean;idempotency_key?:string
}
export type ArrivalState = {
 version:1;revision:number;enabled:boolean;
 stage:'create'|'welcome'|'hungry'|'level_up'|'complete';
 draft:ArrivalDraft|null;npc_id:string|null;manager:ManagerProfile|null;
 coins:number;inventory:Record<string,number>;
 care:{xp:number;level:number;satiety:number;preferences:Record<string,number>};
 catalog:ArrivalFood[];last_receipt?:ArrivalReceipt|null
}
