import {useCallback,useEffect,useRef,useState} from 'react'
import {useReducedMotion} from 'motion/react'
import type {NpcProfile} from '../types'
import type {ArrivalAction,ArrivalFood,ArrivalState} from '../arrival/types'
import {ArrivalWelcomeScene} from '../arrival/ArrivalWelcomeScene'
import {ArrivalPerformance3D} from '../arrival/ArrivalPerformance3D'
import {speakResident} from '../audio/residentVoice'
import './ArrivalCare.css'

type Props={state:ArrivalState;profile:NpcProfile;language:'zh'|'en';busy:boolean;error:string;onCommand:(action:ArrivalAction,foodId?:string)=>Promise<ArrivalState>;onComplete:()=>void}
type Feeding={key:string;food:ArrivalFood;before:ArrivalState['care']}

export function ArrivalCare({state,profile,language,busy,error,onCommand,onComplete}:Props){
 const zh=language==='zh',reduced=Boolean(useReducedMotion())
 const [panel,setPanel]=useState<'food'|'info'|null>(null),[ready,setReady]=useState(false)
 const [feeding,setFeeding]=useState<Feeding|null>(null),[bite,setBite]=useState(0),[pending,setPending]=useState(false)
 const [notice,setNotice]=useState(''),[localError,setLocalError]=useState('')
 const commandLock=useRef(false),cancelVoice=useRef<(()=>void)|undefined>(undefined),mounted=useRef(true)
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;cancelVoice.current?.()}},[])
 const care=feeding?.before??state.care
 const welcome=state.stage==='welcome',result=state.stage==='level_up'&&!feeding&&!pending
 const locked=busy||pending||Boolean(feeding)
 const voice=state.draft?.voice
 const say=useCallback((text:string)=>{
  cancelVoice.current?.()
  if(voice)cancelVoice.current=speakResident(text,voice)
 },[voice])
 const onReady=useCallback(()=>setReady(true),[])
 const finishFeeding=useCallback(()=>{setFeeding(null);setBite(0)},[])
 const onBite=useCallback((value:number)=>setBite(value),[])
 const run=async(action:ArrivalAction,food?:ArrivalFood)=>{
  if(commandLock.current||feeding)return
  commandLock.current=true;setPending(true);setLocalError('');cancelVoice.current?.()
  try{
   const before=state.care
   const next=await onCommand(action,food?.id)
   // The parent may remove this screen as soon as complete is persisted.
   // Refresh the city even if React has already unmounted the care component.
   if(action==='finish'){onComplete();return}
   if(!mounted.current)return
   if(action==='feed'&&food){
    setPanel(null);setNotice('')
    if(!reduced){setBite(0);setFeeding({key:next.last_receipt?.id??`feed-${next.revision}`,food,before})}
   }else if(action==='buy'&&food){setNotice(zh?`${food.name_zh}放进食物篮了。`:`${food.name} is in your food basket.`)}
   else if(action==='welcome_done')say('I would love something to eat.')
  }catch{if(mounted.current)setLocalError(zh?'这一步还没有完成，请重试。':'That step did not finish. Please try again.')}
  finally{commandLock.current=false;if(mounted.current)setPending(false)}
 }
 const preferenceText=(value:number)=>value>=2?(zh?'特别喜欢':'Favorite'):value>=1?(zh?'喜欢':'Likes'):value<=-2?(zh?'特别讨厌':'Strongly dislikes'):value<=-1?(zh?'不太喜欢':'Dislikes'):(zh?'普通':'Neutral')
 const known=Object.entries(care.preferences).map(([id,value])=>({food:state.catalog.find(item=>item.id===id),value})).filter(item=>item.food)
 const slots=[2,2,1,1,1,-1,-2]
 const counted=new Set<string>()
 const slotFoods=slots.map(score=>{
  const found=known.find(item=>item.value===score&&!counted.has(item.food!.id))
  if(found)counted.add(found.food!.id)
  return found
 })
 const receipt=state.last_receipt,ate=state.catalog.find(food=>food.id===receipt?.food_id)
 const preference=receipt?.preference??0
 const resultLine=preference<0?(zh?'谢谢你想着我，不过这个味道不太适合我。':'Thank you for thinking of me, but this is not really my taste.'):preference===0?(zh?'吃饱啦，谢谢你照顾我。':'That filled me up. Thank you for taking care of me.'):(zh?'这个真好吃，我很喜欢！':'That was delicious. I really liked it!')
 const resultVoice=preference<0?'Thank you for thinking of me, but this is not really my taste.':preference===0?'That filled me up. Thank you for taking care of me.':'That was delicious. I really liked it!'
 return <main className={`arrival-care${welcome?' is-welcome':''}${result?' is-result':''}`}>
  <header className="arrival-care-header"><a className="arrival-wordmark" href="#" onClick={event=>event.preventDefault()}>LingoLife<span>{zh?'生活，从认识你开始':'Life begins with you'}</span></a><div className="arrival-save" role="status"><i className={busy||pending?'is-saving':''}/>{busy||pending?(zh?'正在保存':'Saving'):(zh?'已保存':'Saved')}</div></header>
  <div className="arrival-care-layout">
   {!welcome&&<aside className="arrival-resident-card" aria-label={zh?'居民状态':'Resident status'}>
    <p className="arrival-eyebrow">{zh?'我的第一位居民':'MY FIRST RESIDENT'}</p><h1>{profile.name}</h1>
    <span className="arrival-resident-type">{profile.age?`${profile.age} ${zh?'岁':'years old'}`:(zh?'新居民':'New resident')} {profile.occupation?`· ${profile.occupation}`:''}</span>
    <div className="arrival-level"><span>{zh?'满足度':'Happiness'}</span><strong>Lv. {care.level}</strong></div>
    <progress className="arrival-xp" max={20} value={care.xp%20} aria-label={zh?'满足度经验':'Happiness experience'}/><small>{care.xp%20} / 20 XP</small>
    <div className="arrival-level"><span>{zh?'饱腹度':'Fullness'}</span><strong>{Math.round(care.satiety)}%</strong></div><progress max={100} value={care.satiety} aria-label={zh?'饱腹度':'Fullness'}/>
    <div className="arrival-preferences"><h2>{zh?'慢慢发现喜好':'Discover their tastes'}</h2><p>{zh?'一起吃过，才会知道。':'Every shared bite tells you more.'}</p>
     <div className="arrival-preference-slots">{slotFoods.map((item,index)=><div key={index} className={`arrival-preference-slot${item?' is-known':''}`} title={preferenceText(slots[index])}><span>{item?.food?.emoji??'?'}</span><small>{item?.food?(zh?item.food.name_zh:item.food.name):preferenceText(slots[index])}</small></div>)}</div>
     {known.filter(item=>item.value===0).map(item=><p className="arrival-neutral-taste" key={item.food!.id}>{item.food!.emoji} {zh?item.food!.name_zh:item.food!.name} · {zh?'普通':'Neutral'}</p>)}
    </div>
   </aside>}
   <section className="arrival-stage" aria-label={zh?'居民的家':'Resident home'}>
    {welcome?<ArrivalWelcomeScene profile={profile} managerName={state.manager?.name} voice={voice} language={language} busy={locked} onContinue={()=>void run('welcome_done')}/>:<>
    <ArrivalPerformance3D profile={profile} mode={feeding?'feeding':result?(preference<0?'disliked':preference===0?'neutral_result':'happy'):'idle'} performanceKey={feeding?.key??(result?'result':'idle')} food={feeding?.food} reduced={reduced} onReady={onReady} onBite={onBite} onFinished={finishFeeding}/>
    {!ready&&<div className="arrival-model-loading" role="status">{zh?'正在准备新家…':'Getting your home ready…'}</div>}
     <div className="arrival-money" aria-label={zh?'生活币余额':'Life coin balance'}><span aria-hidden>◉</span>{state.coins}<small>{zh?'生活币':'coins'}</small></div>
     <div className={`arrival-bubble${feeding?' is-eating':''}`} aria-live="polite"><span>{feeding?feeding.food.emoji:result?'✦':'◌'}</span><p>{feeding?(zh?['先尝一口…','唔，再来一口…','最后一口！','吃完啦！'][bite]:['A first bite…','One more bite…','The last bite!','All done!'][bite]):result?resultLine:(zh?'想要吃点东西。':'I would love something to eat.')}</p></div>
     {feeding&&<div className="arrival-eating-progress"><span className="arrival-eating-icon" style={{transform:`scale(${[1,.72,.43,0][bite]})`}} aria-hidden>{feeding.food.emoji}</span><div>{[0,1,2].map(index=><i key={index} className={bite>index?'is-done':''}/>)}</div><button type="button" onClick={finishFeeding}>{zh?'跳过动画':'Skip animation'}</button></div>}
     {!feeding&&!result&&<nav className="arrival-care-actions" aria-label={zh?'照料居民':'Care for resident'}><button type="button" disabled={locked} onClick={()=>setPanel(panel==='info'?null:'info')} aria-expanded={panel==='info'}><span aria-hidden>◎</span>{zh?'人物信息':'About'}</button><button type="button" className="arrival-primary" disabled={locked} onClick={()=>setPanel(panel==='food'?null:'food')} aria-expanded={panel==='food'}><span aria-hidden>♧</span>{zh?'送点吃的':'Bring food'}</button></nav>}
    </>}
   </section>
  </div>
  {panel==='food'&&!feeding&&<section className="arrival-food-panel" aria-label={zh?'食物小店':'Food shop'}><header><div><p className="arrival-eyebrow">{zh?'今天，先好好吃一顿':'A LITTLE SOMETHING TO EAT'}</p><h2>{zh?'食物小店':'Food shop'}</h2></div><button type="button" className="arrival-close" aria-label={zh?'关闭':'Close'} onClick={()=>setPanel(null)}>×</button></header><div className="arrival-food-grid">{state.catalog.map(food=><article key={food.id}><span className="arrival-food-emoji" aria-hidden>{food.emoji}</span><h3>{zh?food.name_zh:food.name}</h3><p>{food.price} {zh?'生活币':'coins'}<span>{zh?'篮中':'Basket'} {state.inventory[food.id]??0}</span></p><div><button type="button" disabled={locked||state.coins<food.price} onClick={()=>void run('buy',food)}>{zh?'购买':'Buy'}</button><button type="button" className="arrival-primary" disabled={locked||!ready||!(state.inventory[food.id]>0)} onClick={()=>void run('feed',food)}>{zh?'送给居民':'Serve'}</button></div></article>)}</div><p className="arrival-shop-note" role="status">{notice||(zh?'购买后，从食物篮中送给居民。':'Buy food, then serve it from your basket.')}</p></section>}
  {panel==='info'&&<section className="arrival-info-panel" aria-label={zh?'人物信息':'Resident information'}><button type="button" className="arrival-close" aria-label={zh?'关闭':'Close'} onClick={()=>setPanel(null)}>×</button><p className="arrival-eyebrow">{zh?'认识你的新邻居':'MEET YOUR NEW NEIGHBOR'}</p><h2>{profile.name}</h2><p>{profile.selfImage||profile.personality.join(zh?'、':', ')}</p><dl><dt>{zh?'喜欢':'Likes'}</dt><dd>{profile.likes.join(zh?'、':', ')||'—'}</dd><dt>{zh?'小习惯':'Habits'}</dt><dd>{profile.habits.join(zh?'、':', ')||'—'}</dd></dl><p>{zh?'食物喜好会在以后的相处中逐渐发现。':'You will discover food preferences as you spend time together.'}</p></section>}
  {result&&<section className="arrival-level-result" aria-live="polite"><span className="arrival-result-star" aria-hidden>✦</span><p className="arrival-eyebrow">{zh?'你们的第一个小小回忆':'YOUR FIRST LITTLE MEMORY'}</p><h2>{zh?'满足度升级！':'Happiness level up!'}</h2><strong>Lv. {state.care.level}</strong><p>{ate?`${ate.emoji} ${zh?ate.name_zh:ate.name} · ${preferenceText(receipt?.preference??0)}`:(zh?'一顿饭，让新家暖和起来。':'A little meal makes this place feel like home.')}</p>{receipt?.xp_gained!==undefined&&<span className="arrival-xp-gain">+{receipt.xp_gained} XP</span>}<button type="button" className="arrival-quiet" onClick={()=>say(resultVoice)}>{zh?'听听居民的感想':'Hear their thoughts'}</button><button type="button" className="arrival-primary" disabled={locked} onClick={()=>void run('finish')}>{zh?'去看看我们的城市':'Explore our city'}<span>→</span></button></section>}
  {(error||localError)&&<p className="arrival-care-error" role="alert">{error||localError}</p>}
  {!welcome&&!feeding&&!result&&!panel&&<p className="arrival-care-hint">{zh?'从一顿饭开始，慢慢认识彼此。':'Start with a meal. Get to know each other, little by little.'}</p>}
 </main>
}
