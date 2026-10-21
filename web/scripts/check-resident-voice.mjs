import assert from 'node:assert/strict'
import {DEFAULT_RESIDENT_VOICE,listResidentVoices,rankResidentVoices,resolveResidentVoice,speakResident,subscribeResidentVoices} from '../src/audio/residentVoice.ts'

const voice=(name,lang='en-US',localService=true,extra={})=>({name,lang,voiceURI:name,localService,default:false,...extra})
const albert=voice('Albert'),samantha=voice('Samantha'),daniel=voice('Daniel','en-GB'),google=voice('Google US English','en-US',false),enhanced=voice('Ava (Enhanced)'),french=voice('Amélie','fr-CA')
class Synthesis extends EventTarget{
 voices=[];spoken=[];cancels=0;activeListeners=new Set()
 get listeners(){return this.activeListeners.size}
 getVoices(){return this.voices}
 speak(value){this.spoken.push(value)}
 cancel(){this.cancels++}
 addEventListener(...args){this.activeListeners.add(args[1]);super.addEventListener(...args)}
 removeEventListener(...args){this.activeListeners.delete(args[1]);super.removeEventListener(...args)}
 load(voices){this.voices=voices;this.dispatchEvent(new Event('voiceschanged'))}
}
class Utterance{constructor(text){this.text=text;this.voice=null}}
const synthesis=new Synthesis()
globalThis.window={speechSynthesis:synthesis}
globalThis.SpeechSynthesisUtterance=Utterance
const config={...DEFAULT_RESIDENT_VOICE},all=[albert,google,daniel,samantha,french]
let count=0
const check=(condition,message)=>{assert.ok(condition,message);count++}
check(rankResidentVoices(all,'en-US')[0]===samantha,'Automatic US voice chooses clear narration instead of alphabetical Albert')
check(rankResidentVoices(all,'en-GB')[0]===daniel,'Automatic UK voice respects the requested accent')
check(rankResidentVoices([albert,samantha,enhanced],'en-US')[0]===enhanced,'Explicit enhanced quality metadata is preferred')
check(resolveResidentVoice({...config,voice_uri:'Albert'},all).voice===albert,'A manual saved voice wins even when it is a character voice')
check(resolveResidentVoice({...config,voice_uri:'Google US English'},all).voice===google,'A manual online voice is preserved')
check(resolveResidentVoice({...config,voice_uri:'Daniel',language:'en-US'},all).voice===daniel,'A saved explicit URI wins over the fallback language')
const missing={...config,voice_uri:'Installed on another device'},before=JSON.stringify(missing)
check(resolveResidentVoice(missing,all).voice===samantha&&resolveResidentVoice(missing,all).missingSavedVoice,'Missing saved URI uses a visible language-compatible fallback')
check(JSON.stringify(missing)===before,'Fallback selection does not overwrite the saved per-resident URI')
check(resolveResidentVoice(config,[french]).voice===undefined,'An unrelated-language voice is never assigned as the English fallback')
check(rankResidentVoices([samantha,samantha,google]).length===2,'Duplicate device voice URIs appear only once')
synthesis.load(all)
check(listResidentVoices().length===5,'Voice inventory reflects the loaded device list')
let notifications=0
const unsubscribe=subscribeResidentVoices(()=>notifications++)
synthesis.load(all);unsubscribe();synthesis.load(all)
check(notifications===1&&synthesis.listeners===0,'Voice subscription removes its listener cleanly')
let ended=0,started=0,errors=0
let cancel=speakResident('A warm hello.',config,{onStart:()=>started++,onEnd:()=>ended++,onError:()=>errors++})
const spoken=synthesis.spoken.at(-1)
check(spoken.voice===samantha&&spoken.pitch===1&&spoken.rate===1,'Playback uses the selected original tone rather than forcing a high pitch')
spoken.onstart();spoken.onend();cancel()
check(started===1&&ended===1&&errors===0,'Playback callbacks finish once')
synthesis.load([])
const previous=synthesis.spoken.length
cancel=speakResident('Wait for voices.',config)
check(synthesis.spoken.length===previous,'Empty asynchronous inventory does not immediately choose the browser default')
synthesis.load([albert,samantha]);synthesis.load([albert,samantha,google])
check(synthesis.spoken.length===previous+1&&synthesis.spoken.at(-1).voice===samantha,'voiceschanged resolves and plays exactly once')
cancel();check(synthesis.listeners===0,'Async playback removes voice listeners')
synthesis.load([google])
const savedStart=synthesis.spoken.length
cancel=speakResident('Use my saved voice.',{...config,voice_uri:'Samantha'})
check(synthesis.spoken.length===savedStart,'Wait for a saved installed voice after browser voices arrive first')
synthesis.load([google,albert,samantha])
check(synthesis.spoken.length===savedStart+1&&synthesis.spoken.at(-1).voice===samantha,'Late installed saved voice keeps precedence')
cancel()
synthesis.load([])
const cancelledStart=synthesis.spoken.length
cancel=speakResident('Do not speak after leaving.',config);cancel();synthesis.load(all)
check(synthesis.spoken.length===cancelledStart&&synthesis.listeners===0,'Cancelling during asynchronous voice load never speaks later')
cancel=speakResident('A missing saved voice can still speak.',missing)
await new Promise(resolve=>setTimeout(resolve,1700))
check(synthesis.spoken.at(-1).voice===samantha,'Permanently unavailable URI safely falls back after the loading deadline')
cancel()
const old=speakResident('First resident.',config),current=speakResident('Second resident.',{...config,voice_uri:'Daniel'})
const cancels=synthesis.cancels;old()
check(synthesis.cancels===cancels&&synthesis.spoken.at(-1).voice===daniel,'A stale resident cancel callback cannot stop a newer resident')
current()
const invalid=speakResident(' ',config,{onError:()=>errors++});invalid()
check(errors===1,'Empty text fails without submitting an utterance')
delete globalThis.window
speakResident('Unsupported.',config,{onError:reason=>check(reason==='unsupported','Unsupported browser reports an explicit fallback')})
console.log(`Resident voice passed: ${count} checks for actual selection, saved preferences, asynchronous loading, missing voices, cancellation and original pitch.`)
