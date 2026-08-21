import {useEffect,useRef} from 'react'
import {useVoiceExperience} from '../audio/useVoiceExperience'

type Props={
 language:'zh'|'en'
 npcText?:string
 disabled?:boolean
 autoRead?:boolean
 onTranscript:(text:string)=>void
}

export function VoiceControls({language,npcText,disabled,autoRead=false,onTranscript}:Props){
 const voice=useVoiceExperience({onTranscript}),lastRead=useRef('')
 useEffect(()=>{
  if(autoRead&&npcText&&npcText!==lastRead.current){lastRead.current=npcText;voice.speak(npcText)}
 },[autoRead,npcText,voice])
 const zh=language==='zh',listening=voice.status==='listening',speaking=voice.status==='speaking'
 return <div className="voice-controls" aria-live="polite">
  <button type="button" className={listening?'is-active':''} disabled={disabled||!voice.recognitionAvailable} onClick={listening?voice.stopListening:voice.startListening} title={voice.recognitionAvailable?(zh?'用英语说话':'Speak in English'):(zh?'此浏览器不支持语音输入':'Voice input is unavailable in this browser')} aria-pressed={listening}>
   <span aria-hidden>{listening?'■':'●'}</span> {listening?(zh?'结束录音':'Stop'):(zh?'英语口语':'Speak')}
  </button>
  <button type="button" className={speaking?'is-active':''} disabled={!npcText||!voice.synthesisAvailable} onClick={speaking?voice.stopSpeaking:()=>voice.speak(npcText||'')} title={zh?'朗读角色最新回复':'Read the latest reply aloud'} aria-pressed={speaking}>
   <span aria-hidden>{speaking?'■':'▶'}</span> {speaking?(zh?'停止朗读':'Stop'):(zh?'英语听力':'Listen')}
  </button>
  {voice.interim&&<span className="voice-controls__interim">{voice.interim}</span>}
  {voice.status==='error'&&<span className="voice-controls__error">{zh?'语音服务暂时不可用，请继续使用文字。':'Voice is temporarily unavailable. You can keep typing.'}</span>}
 </div>
}
