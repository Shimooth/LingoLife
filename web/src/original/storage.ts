import {normalizeOriginalAppearance,ORIGINAL_PRESETS,type OriginalAppearance,type OriginalQuality,type OriginalTimeOfDay} from './spec'
export type OriginalDraft={version:1;name:string;appearance:OriginalAppearance;friendId:string;timeOfDay:OriginalTimeOfDay;quality:OriginalQuality;theme:{wall:string;roof:string;accent:string}}
export const ORIGINAL_DRAFT_KEY='lingolife.original-atelier.v1'
export const ORIGINAL_DRAFT:OriginalDraft={version:1,name:'沐禾',appearance:{...ORIGINAL_PRESETS[0].appearance},friendId:'yu',timeOfDay:'day',quality:'high',theme:{wall:'#f0dfc5',roof:'#bd7352',accent:'#738d77'}}
export function normalizeOriginalDraft(input:unknown):OriginalDraft{
 const raw=input&&typeof input==='object'?input as Record<string,unknown>:{}
 const theme=raw.theme&&typeof raw.theme==='object'?raw.theme as Record<string,unknown>:{}
 return {version:1,name:typeof raw.name==='string'?raw.name.trim().slice(0,24)||'新邻居':ORIGINAL_DRAFT.name,
 appearance:normalizeOriginalAppearance(raw.appearance),friendId:ORIGINAL_PRESETS.some(p=>p.id===raw.friendId)?raw.friendId as string:'yu',
 timeOfDay:raw.timeOfDay==='night'||raw.timeOfDay==='sunset'?raw.timeOfDay:'day',quality:raw.quality==='low'?'low':'high',
 theme:Object.fromEntries(Object.entries(ORIGINAL_DRAFT.theme).map(([key,value])=>[key,typeof theme[key]==='string'&&/^#[0-9a-f]{6}$/i.test(theme[key] as string)?theme[key]:value])) as OriginalDraft['theme']}
}
export function readOriginalDraft():OriginalDraft{try{const saved=localStorage.getItem(ORIGINAL_DRAFT_KEY);return saved?normalizeOriginalDraft(JSON.parse(saved)):{...structuredClone(ORIGINAL_DRAFT),quality:window.matchMedia('(pointer: coarse)').matches?'low':'high'}}catch{return structuredClone(ORIGINAL_DRAFT)}}
export function saveOriginalDraft(draft:OriginalDraft):boolean{try{localStorage.setItem(ORIGINAL_DRAFT_KEY,JSON.stringify(draft));return true}catch{return false}}
