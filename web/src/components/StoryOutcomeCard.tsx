import type {LifeStory} from '../types'
import {storyHasOutcome,storyOutcomeCopy} from '../life/storyOutcome'
import './StoryOutcomeCard.css'

export function StoryOutcomeCard({story,language='zh'}:{story:LifeStory;language?:'zh'|'en'}){
 if(!storyHasOutcome(story))return null
 const zh=language==='zh',copy=storyOutcomeCopy(story,language)
 const reactions=story.participant_reactions??story.outcome?.participant_reactions??[]
 const consequences=story.consequences??story.outcome?.consequences??[]
 return <section className={`story-outcome-card is-${copy.tone}`} aria-label={zh?'事件结果':'Story outcome'} aria-live="polite" data-testid="story-outcome">
  <header><h3>{copy.result}</h3>{copy.choice&&<p>{zh?'你的选择：':'Your choice: '}{copy.choice}</p>}</header>
  {consequences.slice(0,2).map((item,index)=><p className="story-outcome-card__summary" key={`${item.kind}:${index}`} data-tone={item.tone}>{zh?item.translation_zh||item.text:item.text||item.translation_zh}</p>)}
  {(reactions.length>0||consequences.length>2||copy.summary)&&<details>
   <summary>{zh?'查看详情':'Details'}</summary>
   {copy.summary&&<p className="story-outcome-card__summary">{copy.summary}</p>}
   <div className="story-outcome-card__columns">
    {reactions.length>0&&<section><h4>{zh?'他们的反应':'Their reactions'}</h4>{reactions.map((reaction,index)=><p key={`${reaction.npc_id}:${index}`}><b>{reaction.name??story.participants?.find(person=>person.id===reaction.npc_id)?.name??(zh?'居民':'Resident')}</b><span>{zh?reaction.label_zh||reaction.label:reaction.label||reaction.label_zh}</span></p>)}</section>}
    {consequences.length>2&&<section><h4>{zh?'其他变化':'Other changes'}</h4>{consequences.slice(2).map((item,index)=><p key={`${item.kind}:${index}`} data-tone={item.tone}><span>{zh?item.translation_zh||item.text:item.text||item.translation_zh}</span></p>)}</section>}
   </div>
  </details>}
 </section>
}
