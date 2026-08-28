import type {TroubleSignal} from '../types'
import type {LifeLanguage} from '../life/lifeActionCatalog'
import './TroubleBubble.css'

type Props={signal?:TroubleSignal|null;language?:LifeLanguage;onOpen?:()=>void;className?:string}

export function TroubleBubble({signal,language='zh',onOpen,className=''}:Props){
 if(!signal)return null
 const subtle=signal.disclosure==='subtle'
 const copy=subtle
  ?(language==='zh'?'似乎有点心事':'Something seems to be on their mind')
  :language==='zh'?signal.summary_zh?.trim()||'似乎遇到了一点麻烦':signal.summary?.trim()||'Something seems to be troubling them'
 const content=<><span aria-hidden>{signal.kind==='conflict'?'〽':signal.kind==='blocked'?'…':'?'}</span><b>{copy}</b></>
 if(!onOpen)return <div className={`trouble-bubble is-${signal.severity??'low'} ${subtle?'is-subtle':''} ${className}`.trim()} role="status">{content}</div>
 return <button type="button" className={`trouble-bubble is-${signal.severity??'low'} ${subtle?'is-subtle':''} ${className}`.trim()} onClick={onOpen} aria-label={copy}>{content}<i aria-hidden>›</i></button>
}

export default TroubleBubble
