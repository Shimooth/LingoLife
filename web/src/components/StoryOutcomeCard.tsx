import type {LifeStory} from '../types'
import {storyHasOutcome,storyOutcomeCopy} from '../life/storyOutcome'
import './StoryOutcomeCard.css'

export function StoryOutcomeCard({story,language='zh'}:{story:LifeStory;language?:'zh'|'en'}){
 if(!storyHasOutcome(story))return null
 const zh=language==='zh',copy=storyOutcomeCopy(story,language)
 const reactions=story.participant_reactions??story.outcome?.participant_reactions??[]
 const consequences=story.consequences??story.outcome?.consequences??[]
 return <section className={`story-outcome-card is-${copy.tone}`} aria-label={zh?'事件结果':'Story outcome'} aria-live="polite" data-testid="story-outcome">
  <header><small>{zh?'已结算 · 不是任务评分':'SETTLED · NOT A TASK SCORE'}</small><h3>{copy.result}</h3><p>{copy.choice}</p></header>
  {copy.summary&&<p className="story-outcome-card__summary">{copy.summary}</p>}
  <div className="story-outcome-card__columns">
   <section><h4>{zh?'他们的反应':'Their reactions'}</h4>{reactions.length?reactions.map((reaction,index)=><p key={`${reaction.npc_id}:${index}`}><b>{reaction.name??story.participants?.find(person=>person.id===reaction.npc_id)?.name??(zh?'居民':'Resident')}</b><span>{zh?reaction.label_zh||reaction.label:reaction.label||reaction.label_zh}</span></p>):<p>{zh?'没有记录到公开的个人反应。':'No individual reaction was made public.'}</p>}</section>
   <section><h4>{zh?'实际留下的变化':'What actually changed'}</h4>{consequences.length?consequences.map((item,index)=><p key={`${item.kind}:${index}`} data-tone={item.tone}><span>{zh?item.translation_zh||item.text:item.text||item.translation_zh}</span></p>):<p>{zh?'暂时没有可公开确认的生活或关系变化。':'No public life or relationship change is confirmed yet.'}</p>}</section>
  </div>
  <footer>{zh?'一次回应不等于关系定型。继续观察他们的下一次行动，也可以到「城市动态 → 居民关系」回访。':'One response does not define a relationship. Watch their next action, or revisit City stories → Resident relationships.'}</footer>
 </section>
}
