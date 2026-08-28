import type {LifeMoment} from '../types'
import type {LifeLanguage} from '../life/lifeActionCatalog'
import './MomentToast.css'

type Props={moment:LifeMoment;language?:LifeLanguage;onOpen?:()=>void;onDismiss?:()=>void;className?:string}

export function MomentToast({moment,language='zh',onOpen,onDismiss,className=''}:Props){
 const title=language==='zh'?moment.title_zh?.trim()||moment.title:moment.title
 const summary=language==='zh'?moment.summary_zh?.trim()||moment.summary:moment.summary
 const people=moment.participants?.map(person=>person.name).filter(Boolean).join(' · ')
 return <article className={`moment-toast ${className}`.trim()} role="status" aria-live="polite">
  <span className="moment-toast__mark" aria-hidden>✦</span>
  <div><small>{language==='zh'?'生活片段':'A life moment'}{people?` · ${people}`:''}</small><h3>{title}</h3><p>{summary}</p></div>
  <nav>{onOpen&&<button type="button" onClick={onOpen}>{language==='zh'?'看看现场':'See the moment'}</button>}{onDismiss&&<button type="button" className="is-quiet" onClick={onDismiss} aria-label={language==='zh'?'暂时忽略':'Dismiss for now'}>×</button>}</nav>
 </article>
}

export default MomentToast
