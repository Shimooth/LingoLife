import type {NpcProfile, PersonalValue} from '../types'
import type {Language} from '../i18n'
import './PersonalValuesFields.css'

const labels: Record<PersonalValue, {zh:string;en:string}> = {
 honesty:{zh:'诚实守信',en:'Honesty'},fairness:{zh:'公平互惠',en:'Fairness'},
 care:{zh:'照顾他人',en:'Care'},autonomy:{zh:'自主与边界',en:'Independence'},
 belonging:{zh:'陪伴与归属',en:'Belonging'},achievement:{zh:'成长与成就',en:'Achievement'},
}

/** Optional authoring, never a live view into a resident's private thoughts. */
export function PersonalValuesFields({profile,language,onChange}:{
 profile:NpcProfile;language:Language;onChange:(change:Pick<NpcProfile,'values'|'selfImage'>)=>void
}){
 const selected=profile.values??[]
 const zh=language==='zh'
 return <details className="personal-values">
  <summary>{zh?'内心设定（选填）':'Inner character (optional)'}</summary>
  <fieldset>
   <legend>{zh?'在意的事 · 按选择顺序，最多 3 项':'What matters · in priority order, up to 3'}</legend>
   <div className="personal-values__choices">
    {(Object.keys(labels) as PersonalValue[]).map(value=>{
     const order=selected.indexOf(value)
     return <label key={value}>
      <input type="checkbox" checked={order>=0} disabled={order<0&&selected.length>=3}
       onChange={()=>onChange({values:order>=0?selected.filter(item=>item!==value):[...selected,value]})}/>
      <span>{labels[value][language]}{order>=0?` · ${order+1}`:''}</span>
     </label>
    })}
   </div>
  </fieldset>
  <label>{zh?'希望自己是怎样的人':'The person they hope to be'}
   <textarea rows={2} maxLength={180} value={profile.selfImage??''}
    onChange={event=>onChange({selfImage:event.target.value})}/>
  </label>
 </details>
}
