import {useEffect,useRef,useState} from 'react'
import {listResidentVoices,rankResidentVoices,residentVoiceQuality,resolveResidentVoice,speakResident,subscribeResidentVoices} from '../audio/residentVoice'
import type {ResidentVoiceConfig} from '../audio/residentVoice'
import './ResidentVoicePicker.css'

type PreviewState='idle'|'speaking'|'error'
type Props={value:ResidentVoiceConfig;onChange:(value:ResidentVoiceConfig)=>void;language:'zh'|'en';previewText?:string;onPreviewStateChange?:(state:PreviewState)=>void}

export function ResidentVoicePicker({value,onChange,language,previewText="Hi! It's lovely to meet you. Shall we take a little walk together?",onPreviewStateChange}:Props){
 const zh=language==='zh',[voices,setVoices]=useState(listResidentVoices),[status,setStatus]=useState<PreviewState>('idle')
 const stop=useRef<()=>void>(()=>{}),mounted=useRef(true),notify=useRef(onPreviewStateChange)
 notify.current=onPreviewStateChange
 const updateStatus=(next:PreviewState)=>{if(mounted.current){setStatus(next);notify.current?.(next)}}
 useEffect(()=>{
  mounted.current=true
  const update=()=>setVoices(listResidentVoices()),unsubscribe=subscribeResidentVoices(update)
  update()
  return()=>{mounted.current=false;unsubscribe();stop.current();notify.current?.('idle')}
 },[])
 const choices=rankResidentVoices(voices,value.language),selection=resolveResidentVoice(value,voices)
 const savedVoice=voices.find(voice=>voice.voiceURI===value.voice_uri)
 const options=savedVoice&&!choices.includes(savedVoice)?[savedVoice,...choices]:choices
 const clearChoices=choices.filter(voice=>residentVoiceQuality(voice)!=='character'&&residentVoiceQuality(voice)!=='standard')
 const suggestions=[...clearChoices.slice(0,1),...choices.filter(voice=>residentVoiceQuality(voice)==='browser'),...clearChoices].filter((voice,index,all)=>all.findIndex(item=>item.voiceURI===voice.voiceURI)===index).slice(0,5)
 const silence=()=>{stop.current();updateStatus('idle')}
 const change=(update:Partial<ResidentVoiceConfig>)=>{silence();onChange({...value,...update})}
 const preview=(config=value)=>{
  stop.current();updateStatus('speaking')
  stop.current=speakResident(previewText,config,{onStart:()=>updateStatus('speaking'),onEnd:()=>updateStatus('idle'),onError:()=>updateStatus('error')})
 }
 const source=(voice:SpeechSynthesisVoice)=>voice.localService?(zh?'设备内置':'On this device'):(zh?'浏览器在线声音':'Browser online voice')
 return <section className="resident-voice-picker" aria-label={zh?'居民声音设置':'Resident voice settings'}>
  <p className="resident-voice-picker__intro">{zh?'每位居民都能选自己的声音。先试听，再决定喜欢哪一种。':'Each resident can have their own voice. Listen and choose the one you like.'}</p>
  <label>{zh?'英语口音':'English accent'}<select value={value.language} onChange={event=>change({language:event.target.value,voice_uri:''})}><option value="en-US">{zh?'美式英语':'American English'}</option><option value="en-GB">{zh?'英式英语':'British English'}</option>{!['en-US','en-GB'].includes(value.language)&&<option value={value.language}>{value.language}</option>}</select></label>
  {suggestions.length>0&&<div className="resident-voice-picker__suggestions" aria-label={zh?'先听听这些声音':'Try these voices'}>{suggestions.map(voice=><button key={voice.voiceURI} type="button" aria-pressed={value.voice_uri===voice.voiceURI} onClick={()=>{const next={...value,voice_uri:voice.voiceURI,language:voice.lang};change(next);preview(next)}}><strong>{voice.name}</strong><small>{voice.lang} · {source(voice)}</small><span>{zh?'选择并试听':'Choose & listen'} ▷</span></button>)}</div>}
  <label>{zh?'全部可用音色':'All available voices'}<select value={value.voice_uri} onChange={event=>{const voice=voices.find(item=>item.voiceURI===event.target.value);change({voice_uri:event.target.value,...(voice?{language:voice.lang}:{})})}}><option value="">{zh?'自动推荐清楚的常规声音':'Automatically choose a clear narration voice'}</option>{selection.missingSavedVoice&&<option value={value.voice_uri}>{zh?'已保存音色（本机不可用）':'Saved voice (unavailable here)'}</option>}{options.map(voice=><option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} · {voice.lang} · {source(voice)}</option>)}</select></label>
  <div className="resident-voice-picker__current" role="status"><strong>{value.voice_uri?(zh?'当前播放：':'Playing voice: '):(zh?'自动：':'Automatic: ')}{selection.voice?.name??(voices.length?(zh?'浏览器默认':'Browser default'):(zh?'正在加载设备声音…':'Loading device voices…'))}</strong><span>{selection.voice?`${selection.voice.lang} · ${source(selection.voice)}`:(zh?'可继续编辑，声音加载后即可试听。':'You can keep editing while voices load.')}</span>{selection.missingSavedVoice&&<small>{zh?'本机没有已保存的声音，暂用上述音色；原选择仍会保留。':'Your saved voice is unavailable here. This fallback does not overwrite your choice.'}</small>}{selection.voice&&!selection.voice.localService&&<small>{zh?'这个浏览器声音可能需要联网。':'This browser voice may require an internet connection.'}</small>}</div>
  <div className="resident-voice-picker__pace"><span>{zh?'表达节奏':'Speaking style'}</span>{[{name:zh?'自然原声':'Original',rate:1},{name:zh?'舒缓':'Relaxed',rate:.9},{name:zh?'轻快':'Brisk',rate:1.08}].map(preset=><button type="button" key={preset.rate} aria-pressed={value.rate===preset.rate&&value.pitch===1} onClick={()=>change({rate:preset.rate,pitch:1})}>{preset.name}</button>)}</div>
  <details><summary>{zh?'微调语速和音高':'Adjust pace and pitch'}</summary><label>{zh?'说话速度':'Pace'} <output>{value.rate.toFixed(2)}×</output><input type="range" min={.65} max={1.4} step={.01} value={value.rate} onChange={event=>change({rate:Number(event.target.value)})}/></label><label>{zh?'音高':'Pitch'} <output>{value.pitch.toFixed(2)}</output><input type="range" min={.6} max={1.5} step={.01} value={value.pitch} onChange={event=>change({pitch:Number(event.target.value)})}/></label><small>{zh?'保持音高 1.00 可听到音色本来的声音。':'Pitch 1.00 preserves the voice’s original tone.'}</small></details>
  <button type="button" className="resident-voice-picker__listen" onClick={()=>status==='speaking'?silence():preview()}>{status==='speaking'?(zh?'Ⅱ 停止试听':'Ⅱ Stop preview'):(zh?'▷ 试听当前声音':'▷ Listen to this voice')}</button>
  {status==='error'&&<p role="status">{zh?'这个声音暂时没能播放，请换一种设备内置音色再试。':'This voice could not play. Try another voice on this device.'}</p>}
  <p className="resident-voice-picker__hint">{zh?'音色来自当前设备和浏览器，换设备时可用声音可能不同。这里不会根据角色姓名或外观替你选择。':'Voices depend on this device and browser. Your resident’s name and appearance never decide their voice.'}</p>
 </section>
}
