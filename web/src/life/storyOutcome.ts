import type {LifeStory} from '../types.ts'

export const storyHasOutcome=(story:LifeStory)=>['resolved_autonomously','resolved_with_management','closed'].includes(story.status)

/** Never turn 'settled' into 'success', or witnessing into management credit. */
export function storyOutcomeCopy(story:LifeStory,language:'zh'|'en'){
 const zh=language==='zh',outcome=story.outcome
 const labels:Record<string,[string,string]>={accepted:['接受了帮助','Help accepted'],mixed:['回应不一','Mixed reactions'],misunderstood:['产生了误解','A misunderstanding'],refused:['没有采纳建议','Advice declined'],backfired:['介入适得其反','The intervention backfired']}
 const managed=outcome?.mode==='managed'||story.status==='resolved_with_management'
 const result=managed?(labels[outcome?.result??'']?.[zh?0:1]??(zh?'居民作出了回应':'The residents responded')):(zh?'居民自行处理了这件事':'The residents handled it themselves')
 const choice=managed?(zh?outcome?.selected_action_label_zh||outcome?.selected_action_label:outcome?.selected_action_label||outcome?.selected_action_label_zh)||(zh?'你选择了介入':'You stepped in'):(story.observed_at?(zh?'你见证了这一刻，没有替他们决定':'You witnessed the moment without deciding for them'):(zh?'你未介入，这是一份结果回顾':'You did not intervene; this is an outcome recap'))
 return {result,choice,managed,tone:outcome?.tone??'neutral',summary:zh?story.aftermath_zh||outcome?.aftermath_zh||story.aftermath:story.aftermath||outcome?.aftermath||story.aftermath_zh}
}
