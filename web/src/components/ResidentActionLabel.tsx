import type {NormalizedResidentAction} from '../life/normalizeWorldSnapshot'
import {lifeActionContract,lifeActionIntent,lifeActionStatusLabel,type LifeLanguage} from '../life/lifeActionCatalog'
import './ResidentActionLabel.css'

type Props={
 action?:NormalizedResidentAction|null
 language?:LifeLanguage
 intent?:string
 intentZh?:string
 compact?:boolean
 showStatus?:boolean
 className?:string
}

const legacyCopy=(action:Extract<NormalizedResidentAction,{source:'legacy'}>,language:LifeLanguage)=>{
 if(action.type==='idle')return language==='zh'?'正在城市里度过日常':'Going about the day'
 if(action.type==='living')return language==='zh'?'正在过自己的生活':'Living their day'
 if(action.status==='traveling')return language==='zh'?'正走向一段生活片段':'Heading toward a moment'
 if(action.status==='planned')return language==='zh'?'似乎有件事放在心上':'Something is on their mind'
 return language==='zh'?'正在经历一段生活片段':'In the middle of a life moment'
}

export function ResidentActionLabel({action,language='zh',intent,intentZh,compact=false,showStatus=false,className=''}:Props){
 if(!action)return <span className={`resident-action-label is-quiet ${compact?'is-compact':''} ${className}`.trim()}><i aria-hidden>·</i><span>{language==='zh'?'正在过自己的生活':'Living their day'}</span></span>
 const life=action.source==='life'
 const contract=life?lifeActionContract(action.type):null
 const context=life?action.raw.visible_context:undefined
 const text=language==='zh'
  ?intentZh?.trim()||(life?lifeActionIntent(action.raw,'zh'):legacyCopy(action,'zh'))
  :intent?.trim()||(life?lifeActionIntent(action.raw,'en'):legacyCopy(action,'en'))
 const status=showStatus?(life?(language==='zh'?context?.phase_label_zh:context?.phase_label)||lifeActionStatusLabel(action.status,language):action.status==='traveling'?(language==='zh'?'正在前往':'On the way'):undefined):undefined
 const progressKind=life?action.raw.presentation?.progress?.kind??context?.progress_kind:undefined
 return <span className={`resident-action-label is-${action.status} ${compact?'is-compact':''} ${className}`.trim()} title={text}>
  <i aria-hidden>{context?.icon??contract?.glyph??(action.status==='traveling'?'➜':'◌')}</i>
  <span><span className="resident-action-label__intent">{text}</span>{status&&<small>{status}</small>}{showStatus&&progressKind&&<em className={`resident-action-label__progress is-${progressKind}`} aria-hidden><i/></em>}</span>
 </span>
}

export default ResidentActionLabel
