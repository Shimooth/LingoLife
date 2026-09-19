import {useContext,useState} from 'react'
import {VisualQualityContext} from './VisualQualityContext'
import {initialQuality,VISUAL_BUDGETS,type VisualTier} from './visualQuality'

/** Keep the Canvas prop in sync: R3F reconfiguration otherwise restores its
 * initial DPR on any parent update, silently undoing the adaptive controller. */
export function useVisualBudget(){
 const mode=useContext(VisualQualityContext)
 const [tier,onTier]=useState<VisualTier>(()=>initialQuality(mode).tier)
 return {dpr:Math.min(typeof window==='undefined'?1:window.devicePixelRatio||1,VISUAL_BUDGETS[tier].dpr),onTier}
}
