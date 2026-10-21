import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {ResidentVoicePicker} from '../../src/components/ResidentVoicePicker'
import {DEFAULT_RESIDENT_VOICE,listResidentVoices} from '../../src/audio/residentVoice'
import type {ResidentVoiceConfig} from '../../src/audio/residentVoice'

// Read the real voice inventory but keep test playback silent and entirely local.
type Spoken={voice:string|null;lang:string;rate:number;pitch:number}
const history:Spoken[]=[]
let active:SpeechSynthesisUtterance|undefined
window.speechSynthesis.speak=utterance=>{active=utterance;history.push({voice:utterance.voice?.voiceURI??null,lang:utterance.lang,rate:utterance.rate,pitch:utterance.pitch});setTimeout(()=>{if(active===utterance){utterance.onstart?.(new Event('start') as SpeechSynthesisEvent);utterance.onend?.(new Event('end') as SpeechSynthesisEvent);active=undefined}},20)}
window.speechSynthesis.cancel=()=>{active=undefined}
type Qa={history:Spoken[];values:Record<string,ResidentVoiceConfig>;setValue:(value:ResidentVoiceConfig)=>void;voiceNames:()=>string[]}
declare global{interface Window{__residentVoiceQa:Qa}}
export function Fixture(){
 const [resident,setResident]=useState('a'),[values,setValues]=useState<Record<string,ResidentVoiceConfig>>({a:{...DEFAULT_RESIDENT_VOICE},b:{...DEFAULT_RESIDENT_VOICE}})
 const setValue=(value:ResidentVoiceConfig)=>setValues(current=>({...current,[resident]:value}))
 window.__residentVoiceQa={history,values,setValue,voiceNames:()=>listResidentVoices().map(voice=>voice.name)}
 return <><header><button type="button" onClick={()=>setResident('a')}>Resident A</button><button type="button" onClick={()=>setResident('b')}>Resident B</button><strong>{resident.toUpperCase()}</strong></header><ResidentVoicePicker key={resident} value={values[resident]} onChange={setValue} language="zh"/></>
}
createRoot(document.getElementById('root')!).render(<Fixture/>)
