import {useCallback,useEffect,useRef,useState} from 'react'

type RecognitionEventLike={results:ArrayLike<{0:{transcript:string};isFinal:boolean}>}
type RecognitionErrorLike={error:string}
type RecognitionLike={
 continuous:boolean
 interimResults:boolean
 lang:string
 start:()=>void
 stop:()=>void
 abort:()=>void
 onresult:((event:RecognitionEventLike)=>void)|null
 onerror:((event:RecognitionErrorLike)=>void)|null
 onend:(()=>void)|null
}
type RecognitionConstructor=new()=>RecognitionLike

declare global{
 interface Window{
  SpeechRecognition?:RecognitionConstructor
  webkitSpeechRecognition?:RecognitionConstructor
 }
}

export type VoiceStatus='idle'|'listening'|'speaking'|'unsupported'|'error'

/**
 * Progressive voice layer for the learning loop. Speech recognition remains a
 * browser capability, so text chat is always the reliable fallback. No audio is
 * persisted or uploaded by this hook.
 */
export function useVoiceExperience({onTranscript}:{onTranscript:(text:string)=>void}){
 const recognitionRef=useRef<RecognitionLike|null>(null)
 const [status,setStatus]=useState<VoiceStatus>('idle')
 const [interim,setInterim]=useState('')
 const recognitionAvailable=typeof window!=='undefined'&&Boolean(window.SpeechRecognition||window.webkitSpeechRecognition)
 const synthesisAvailable=typeof window!=='undefined'&&'speechSynthesis'in window

 const stopListening=useCallback(()=>{
  recognitionRef.current?.stop()
  recognitionRef.current=null
  setInterim('')
  setStatus('idle')
 },[])

 const startListening=useCallback(()=>{
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition
  if(!Recognition){setStatus('unsupported');return}
  window.speechSynthesis?.cancel()
  recognitionRef.current?.abort()
  const recognition=new Recognition()
  recognition.lang='en-US'
  recognition.continuous=false
  recognition.interimResults=true
  recognition.onresult=event=>{
   let draft='',final=''
   for(let index=0;index<event.results.length;index+=1){
    const result=event.results[index],text=result[0]?.transcript||''
    if(result.isFinal)final+=text
    else draft+=text
   }
   setInterim(draft)
   if(final.trim())onTranscript(final.trim())
  }
  recognition.onerror=event=>{
   recognitionRef.current=null
   setInterim('')
   setStatus(event.error==='aborted'||event.error==='no-speech'?'idle':'error')
  }
  recognition.onend=()=>{
   recognitionRef.current=null
   setInterim('')
   setStatus(current=>current==='listening'?'idle':current)
  }
  recognitionRef.current=recognition
  setStatus('listening')
  try{recognition.start()}catch{recognitionRef.current=null;setStatus('error')}
 },[onTranscript])

 const speak=useCallback((text:string)=>{
  if(!synthesisAvailable||!text.trim()){setStatus(synthesisAvailable?'idle':'unsupported');return}
  recognitionRef.current?.abort()
  recognitionRef.current=null
  const utterance=new SpeechSynthesisUtterance(text)
  utterance.lang='en-US'
  utterance.rate=.92
  utterance.pitch=1.02
  utterance.onstart=()=>setStatus('speaking')
  utterance.onend=()=>setStatus('idle')
  utterance.onerror=()=>setStatus('error')
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
 },[synthesisAvailable])

 const stopSpeaking=useCallback(()=>{window.speechSynthesis?.cancel();setStatus('idle')},[])

 useEffect(()=>()=>{
  recognitionRef.current?.abort()
  window.speechSynthesis?.cancel()
 },[])

 return {status,interim,recognitionAvailable,synthesisAvailable,startListening,stopListening,speak,stopSpeaking}
}
