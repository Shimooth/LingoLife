import {useEffect,useState} from 'react'

export type ExperienceSettings={autoReadNpc:boolean;ambientSound:boolean;quality:'auto'|'high'|'low'}

const KEY='lingolife.experience-settings'
const EVENT='lingolife:experience-settings'
const defaults:ExperienceSettings={autoReadNpc:false,ambientSound:true,quality:'auto'}

export function readExperienceSettings():ExperienceSettings{
 try{return {...defaults,...JSON.parse(localStorage.getItem(KEY)||'{}')}}catch{return defaults}
}

export function saveExperienceSettings(value:ExperienceSettings){
 try{localStorage.setItem(KEY,JSON.stringify(value))}catch{/* Storage can be unavailable in private contexts. */}
 window.dispatchEvent(new CustomEvent<ExperienceSettings>(EVENT,{detail:value}))
}

export function useExperienceSettings(){
 const [settings,setSettings]=useState<ExperienceSettings>(readExperienceSettings)
 useEffect(()=>{
  const update=(event:Event)=>setSettings((event as CustomEvent<ExperienceSettings>).detail)
  window.addEventListener(EVENT,update)
  return()=>window.removeEventListener(EVENT,update)
 },[])
 return settings
}
