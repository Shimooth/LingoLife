import {useCallback, useEffect, useRef, useState} from 'react'
import {useReducedMotion} from 'motion/react'
import type {NeighborhoodCommand, NeighborhoodScene, NeighborhoodState, NeighborhoodResident} from '../neighborhood/types'
import {NeighborhoodStage3D} from '../neighborhood/NeighborhoodStage3D'
import type {NeighborhoodStageMode} from '../neighborhood/NeighborhoodStage3D'
import {CharacterPortrait} from './CharacterPortrait'
import {NeighborhoodEconomy} from './NeighborhoodEconomy'
import {NeighborhoodProjectCards} from './NeighborhoodProjectCards'
import {speakResident} from '../audio/residentVoice'
import './NeighborhoodPanel.css'

type Props = {
  state: NeighborhoodState
  language: 'zh' | 'en'
  busy: boolean
  error: string
  initialTab?: 'today' | 'fountain' | 'residents' | 'wardrobe' | 'news' | 'wallet'
  initialResidentId?: string
  initialMeetingId?: string
  initialPair?: [string,string]
  onCommand: (command: NeighborhoodCommand) => Promise<NeighborhoodState>
  onCreateResident: () => void
  onEditVoice?: (id:string) => void
  onReplayArrival?: (resident:NeighborhoodResident) => void
  onProjectCompleted?: (projectId:string) => void
  onClose: () => void
}
type Tab = 'today' | 'fountain' | 'residents' | 'shop' | 'news' | 'wallet'
type News = NeighborhoodState['news'][number]
type TopicKind = 'person' | 'object' | 'activity' | 'other'
const TABS: {id: Tab; icon: string; zh: string; en: string}[] = [
  {id:'today',icon:'☀',zh:'今日小事',en:'Today'}, {id:'fountain',icon:'✦',zh:'许愿喷泉',en:'Wishes'},
  {id:'residents',icon:'☺',zh:'居民之间',en:'Neighbors'}, {id:'shop',icon:'♧',zh:'服装小店',en:'Clothes'},
  {id:'wallet',icon:'●',zh:'生活钱包',en:'Wallet'}, {id:'news',icon:'▤',zh:'小城新闻',en:'News'},
]
const sceneMode: Record<NeighborhoodScene['kind'], NeighborhoodStageMode> = {wish:'wish',gift:'gift',clothing:'shop',meeting:'meet',friendship:'friendship',romance:'spark',food:'food'}
const relationLabels: Record<string, [string, string]> = {
  none:['还在认识彼此','Getting acquainted'], emerging:['渐渐熟悉','Getting closer'], friend:['朋友','Friends'], close_friend:['亲密朋友','Close friends'], estranged:['有些疏远','Some distance'],
  one_sided_interest:['一方有些在意','One person is interested'], mutual_interest:['互有好感','Mutual interest'], dating:['正在约会','Dating'], partner:['伴侣','Partners'], separated:['已经分开','Separated'],
}

export function NeighborhoodPanel({state,language,busy,error,initialTab='today',initialResidentId,initialMeetingId,initialPair,onCommand,onCreateResident,onClose,onEditVoice,onReplayArrival,onProjectCompleted}: Props) {
  const zh=language==='zh',reduced=Boolean(useReducedMotion())
  const [tab,setTab]=useState<Tab>(initialMeetingId||initialPair?'residents':initialTab==='wardrobe'?'shop':initialTab)
  const [actorId,setActorId]=useState(()=>state.residents.find(resident=>resident.id===(initialResidentId??initialPair?.[0]))?.id??state.residents[0]?.id??'')
  const [pair,setPair]=useState<[string,string]>(initialPair??[state.residents[0]?.id??'',state.residents[1]?.id??''])
  const [meetingId,setMeetingId]=useState(initialMeetingId??'')
  const [topic,setTopic]=useState(''),[topicKind,setTopicKind]=useState<TopicKind>('activity'),[topicPerson,setTopicPerson]=useState('')
  const [aliases,setAliases]=useState({meetingId:'',a_to_b:'',b_to_a:''})
  const [scene,setScene]=useState<NeighborhoodScene|null>(()=>initialMeetingId?state.scenes.find(item=>item.id===initialMeetingId&&item.kind==='meeting')??null:null),[news,setNews]=useState<News|null>(()=>!initialMeetingId&&!initialPair&&initialTab==='today'?state.news.find(item=>!item.read)??null:null)
  const [beatIndex,setBeatIndex]=useState(0),[playing,setPlaying]=useState(Boolean(initialMeetingId)),[take,setTake]=useState(0)
  const [stageReady,setStageReady]=useState(false),[foodDone,setFoodDone]=useState(false)
  const [pageVisible,setPageVisible]=useState(()=>!document.hidden)
  const [previewItem,setPreviewItem]=useState(''),[dragged,setDragged]=useState('')
  const [pending,setPending]=useState(false),[localError,setLocalError]=useState(''),[notice,setNotice]=useState('')
  const dialog=useRef<HTMLElement>(null),navigation=useRef<HTMLElement>(null),closeButton=useRef<HTMLButtonElement>(null),mounted=useRef(true),commandLock=useRef(false),cancelVoice=useRef<()=>void>(()=>{})
  const knownResidents=useRef(new Set(state.residents.map(item=>item.id))),manuallyChosenSlots=useRef(new Set<number>())
  const locked=busy||pending
  const resident=state.residents.find(item=>item.id===actorId)??state.residents[0]
  const meeting=state.meetings.find(item=>item.id===meetingId)??state.meetings[state.meetings.length-1]
  const nameOf=(id:string)=>state.residents.find(item=>item.id===id)?.profile.name??(zh?'居民':'Resident')
  const beat=scene?.beats[beatIndex]
  const unread=state.news.filter(item=>!item.read).length
  const giftCount=Object.values(state.gifts).reduce((sum,value)=>sum+value,0)
  const selectedOutfit=state.clothing_catalog.find(item=>item.id===previewItem)
  const fountainProject=state.projects?.find(project=>project.id==='fountain')
  const clothingProject=state.projects?.find(project=>project.id==='clothing_store')
  const nextProjects=state.projects?.filter(project=>project.status!=='completed').slice(0,2)??[]
  const canWear=(item:NeighborhoodState['clothing_catalog'][number])=>Boolean(resident&&item.models.includes(resident.profile.avatar.model??'chibi'))
  const stageMode:NeighborhoodStageMode=news?'news':scene?(scene.kind==='romance'&&scene.result.outcome!=='dating'?'friendship':sceneMode[scene.kind]):tab==='shop'?'shop':tab==='residents'?'meet':'fountain'
  const actorIds=scene?.participant_ids??(tab==='residents'?pair.filter(Boolean):resident?[resident.id]:[])
  const canInvite=state.residents.length<state.unlocks.resident_slots
  const plannedProject=!news&&!scene?tab==='shop'&&!state.unlocks.clothing_store?clothingProject:(tab==='fountain'||tab==='today')&&!state.unlocks.fountain?fountainProject:undefined:undefined
  const markStageReady=useCallback(()=>setStageReady(true),[])
  const finishFood=useCallback(()=>{
    if(scene?.kind==='food'){setFoodDone(true);setBeatIndex(Math.min(1,scene.beats.length-1))}
  },[scene])

  useEffect(()=>{
    const nav=navigation.current
    if(!nav)return
    const keepSelectedVisible=()=>{
      const selected=nav.querySelector<HTMLElement>('[aria-current="page"]')
      if(!selected||nav.scrollWidth<=nav.clientWidth)return
      const frame=nav.getBoundingClientRect(),button=selected.getBoundingClientRect()
      const inset=Number.parseFloat(getComputedStyle(nav).paddingLeft)||0
      if(button.left<frame.left+inset)nav.scrollLeft+=button.left-frame.left-inset
      else if(button.right>frame.right-inset)nav.scrollLeft+=button.right-frame.right+inset
    }
    keepSelectedVisible()
    const observer=new ResizeObserver(keepSelectedVisible)
    observer.observe(nav)
    return()=>observer.disconnect()
  },[tab,language,unread])

  useEffect(()=>{
    mounted.current=true
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null
    const visibility=()=>setPageVisible(!document.hidden)
    document.addEventListener('visibilitychange',visibility)
    closeButton.current?.focus()
    return()=>{mounted.current=false;document.removeEventListener('visibilitychange',visibility);cancelVoice.current();previous?.focus()}
  },[])
  useEffect(()=>{
    const added=state.residents.filter(item=>!knownResidents.current.has(item.id))
    knownResidents.current=new Set(state.residents.map(item=>item.id))
    if(added.length)setPair(current=>{
      const next:[string,string]=[...current]
      for(const index of [0,1] as const)if(!next[index]&&!manuallyChosenSlots.current.has(index)){
        next[index]=added.find(item=>!next.includes(item.id))?.id??''
      }
      return next
    })
  },[state.residents])
  useEffect(()=>{
    if(!scene||stageReady)return
    // A failed 3D asset never blocks the already-persisted story or its controls.
    const timeout=setTimeout(()=>{setStageReady(true);if(scene.kind==='food')setFoodDone(true)},10000)
    return()=>clearTimeout(timeout)
  },[scene,stageReady,take])
  useEffect(()=>{
    if(!scene||!playing||!beat||!stageReady||!pageVisible||(scene.kind==='food'&&!foodDone&&beatIndex===0))return
    const duration=Math.max(2400,Math.min(6200,(zh?beat.text_zh:beat.text).length*(zh?140:55)))
    const timer=setTimeout(()=>{
      if(beatIndex<scene.beats.length-1)setBeatIndex(value=>value+1)
      else setPlaying(false)
    },duration)
    return()=>clearTimeout(timer)
  },[scene,playing,beat,beatIndex,zh,stageReady,foodDone,pageVisible])
  const playScene=(value:NeighborhoodScene)=>{cancelVoice.current();setStageReady(false);setFoodDone(false);setScene(value);setNews(null);setBeatIndex(0);setPlaying(true);setTake(value=>value+1);setPreviewItem('')}
  const clearStage=()=>{cancelVoice.current();setScene(null);setNews(null);setPlaying(false);setPreviewItem('')}
  const switchTab=(value:Tab)=>{setTab(value);clearStage();setNotice('');setLocalError('')}
  const run=async(command:NeighborhoodCommand)=>{
    if(commandLock.current)return
    commandLock.current=true;setPending(true);setLocalError('');setNotice('')
    try{
      const next=await onCommand(command)
      if(!mounted.current)return
      const receipt=next.last_receipt
      const produced=receipt?.action===command.action&&receipt.scene_id?next.scenes.find(item=>item.id===receipt.scene_id):undefined
      if(produced)playScene(produced)
      if(command.action==='meet'){
        const created=[...next.meetings].reverse().find(item=>item.npc_id===command.npc_id&&item.target_id===command.target_id)
        if(created)setMeetingId(created.id)
      }
      if(command.action==='buy_clothing'||command.action==='buy_food'||command.action==='buy_gift')setNotice(zh?'放进你的物品篮啦。':'Added to your basket.')
      if(command.action==='claim_support')setNotice(zh?'今日社区补助已经到账，收支也记下来了。':'Today’s city grant has arrived and is recorded in your wallet.')
      if(command.action==='fund_project'&&command.project_id&&next.projects?.some(project=>project.id===command.project_id&&project.status==='completed')){
        setNotice(zh?'筹备完成，回到地图看看大家的新地方。':'The contribution is complete. Visit the map to see what changed.')
        onProjectCompleted?.(command.project_id)
      }
      if(command.action==='nicknames')setNotice(zh?'两人记住了新的称呼。':'They will remember these names.')
    }catch{if(mounted.current)setLocalError(zh?'这一步暂时没有完成，请再试一次。':'That step could not finish. Please try again.')}
    finally{commandLock.current=false;if(mounted.current)setPending(false)}
  }
  const readNews=(value:News)=>{clearStage();setNews(value);setTake(current=>current+1);if(!value.read)void run({action:'read_news',news_id:value.id})}
  const dismissNews=()=>{const value=news;clearStage();if(value&&!(state.news.find(item=>item.id===value.id)?.read??value.read))void run({action:'read_news',news_id:value.id})}
  const say=(text:string,speakerId?:string)=>{
    cancelVoice.current()
    const profile=state.residents.find(item=>item.id===speakerId)?.profile??resident?.profile
    cancelVoice.current=speakResident(text,profile?.voice??{voice_uri:'',language:'en-US',rate:.92,pitch:1},{onError:()=>{if(mounted.current)setNotice(zh?'声音暂时不可用，可以继续阅读。':'Audio is unavailable. You can keep reading.')}})
  }
  const setSlot=(index:0|1,id:string)=>{
    if(id&&!state.residents.some(item=>item.id===id))return
    manuallyChosenSlots.current.add(index)
    if(id&&pair[index===0?1:0]===id)manuallyChosenSlots.current.add(index===0?1:0)
    setPair(current=>index===0?[id,current[1]===id?'':current[1]]:[current[0]===id?'':current[0],id])
    clearStage()
  }
  const friend=(advice:'encourage'|'discourage')=>{
    if(!meeting)return
    if(advice==='encourage'&&!topic.trim()){setLocalError(zh?'给他们一个简单的话题吧。':'Give them a little something to talk about.');return}
    void run({action:'friendship',meeting_id:meeting.id,advice,...(advice==='encourage'?{topic:{text:topic.trim(),kind:topicKind,...(topicKind==='person'?{person_id:topicPerson||meeting.target_id}:{})}}:{})})
  }
  const currentAliases=meeting&&aliases.meetingId===meeting.id?aliases:{meetingId:meeting?.id??'',a_to_b:meeting?.aliases?.a_to_b??(meeting?nameOf(meeting.target_id):''),b_to_a:meeting?.aliases?.b_to_a??(meeting?nameOf(meeting.npc_id):'')}
  const residentSelect=(label:string)=><label className="neighborhood-select">{label}<select value={resident?.id??''} onChange={event=>{setActorId(event.target.value);setPreviewItem('');clearStage()}}>{state.residents.map(item=><option key={item.id} value={item.id}>{item.profile.name}</option>)}</select></label>
  const lockCard=(icon:string,title:string,detail:string)=><div className="neighborhood-locked"><span aria-hidden>{icon}</span><h3>{title}</h3><p>{detail}</p></div>

  return <div className="neighborhood-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}>
    <section className="neighborhood-panel" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="neighborhood-title" data-neighborhood-tab={tab} onKeyDown={event=>{
      if(event.key==='Escape'){event.preventDefault();onClose()}
      if(event.key==='Tab'){
        const nodes=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')??[]).filter(node=>node.getClientRects().length)
        const first=nodes[0],last=nodes[nodes.length-1]
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
      }
    }}>
      <header className="neighborhood-header"><div><p>{zh?'LINGOLIFE · 每天都有小惊喜':'LINGOLIFE · LITTLE EVERYDAY SURPRISES'}</p><h1 id="neighborhood-title">{zh?'小城生活':'Neighborhood life'}<span aria-hidden>✿</span></h1></div><div className="neighborhood-header-actions"><button type="button" className="neighborhood-wallet" aria-label={zh?`生活钱包，余额 ${state.coins} 生活币`:`Open wallet, ${state.coins} coins`} onClick={()=>switchTab('wallet')}><i aria-hidden>●</i>{state.coins}<small>{zh?'生活币':'coins'}</small><span aria-hidden>↗</span></button><button type="button" className="neighborhood-close" ref={closeButton} onClick={onClose} aria-label={zh?'回到城市':'Back to the city'}>×</button></div></header>
      <nav className="neighborhood-nav" ref={navigation} aria-label={zh?'小城生活功能':'Neighborhood activities'}>{TABS.map(item=><button type="button" key={item.id} aria-current={tab===item.id?'page':undefined} onClick={()=>switchTab(item.id)}><span aria-hidden>{item.icon}</span>{item[language]}{item.id==='news'&&unread>0&&<b>{unread}</b>}</button>)}</nav>
      <div className="neighborhood-layout">
        <section className="neighborhood-stage" aria-label={zh?'居民故事舞台':'Neighborhood story stage'}>
          {tab==='wallet'&&!news&&!scene||plannedProject?<div className="neighborhood-planning-stage"><span className="neighborhood-planning-icon" aria-hidden>{tab==='wallet'?'●':plannedProject?.id==='fountain'?'⛲':'♧'}</span><p>{zh?'小心愿，让社区慢慢变好':'LITTLE IDEAS, A GROWING NEIGHBORHOOD'}</p><h2>{tab==='wallet'?(zh?'把心意，留在生活里。':'A little care goes a long way.'):zh?plannedProject?.title_zh:plannedProject?.title}</h2><div>{tab==='wallet'?(zh?'一份早餐、一件礼物、一处大家都喜欢的风景。生活币用在看得见的日常变化里。':'A breakfast, a little gift, a favorite corner of the square. Put your coins into everyday changes.'):zh?plannedProject?.reason_zh:plannedProject?.reason}</div><small>{zh?'已有的城市照常运转，新的设施由你和居民一起筹备。':'The city is already here. New neighborhood facilities grow from shared needs.'}</small></div>:<NeighborhoodStage3D mode={stageMode} residents={state.residents} activeActorIds={actorIds} speakerId={playing?beat?.speaker_id:undefined} shot={beat?.shot} cue={beat?.cue} language={language} performanceKey={scene?`${scene.id}-${take}`:news?`${news.id}-${take}`:`${tab}-${actorIds.join('-')}`} reducedMotion={reduced} onReady={markStageReady} onComplete={finishFood} food={scene?.kind==='food'?state.food_catalog.find(item=>item.id===scene.result.food_id):undefined} giftLabel={scene?.kind==='gift'?(zh?scene.title_zh:scene.title):undefined} outfitPreview={selectedOutfit&&resident&&canWear(selectedOutfit)?{...resident.profile.avatar,outfit:selectedOutfit.outfit,outfitColor:selectedOutfit.outfit_color}:undefined} newsTitle={news?(zh?news.title_zh:news.title):undefined}/> }
          {!news&&!scene&&tab!=='wallet'&&!plannedProject&&<div className="neighborhood-stage-label"><small>{zh?'那些慢慢熟悉的日子':'LITTLE MOMENTS, GROWING CONNECTIONS'}</small><strong>{tab==='fountain'?(zh?'把一个愿望，轻轻放进水里。':'A little wish, a little wonder.'):tab==='shop'?(zh?'今天，换个新模样。':'A fresh look for today.'):tab==='residents'?(zh?'故事从一次相遇开始。':'Every story starts with a hello.'):(zh?'这里的每个人，都有自己的故事。':'Every neighbor has a story.')}</strong></div>}
          {news&&<article className="neighborhood-news-screen"><span>{zh?'小城新闻':'NEIGHBORHOOD NEWS'}</span><h2>{zh?news.title_zh:news.title}</h2><p>{zh?news.body_zh:news.body}</p><div><button type="button" onClick={()=>say(news.body)}>{zh?'▷ 听听播报':'▷ Listen'}</button><button type="button" onClick={()=>setTake(value=>value+1)}>{zh?'重播画面':'Replay'}</button><button type="button" onClick={dismissNews}>{zh?'知道啦':'Got it'}</button></div><button type="button" className="neighborhood-skip" onClick={dismissNews}>{zh?'跳过播报':'Skip news'}</button></article>}
          {scene&&<div className="neighborhood-scene-player" data-scene-id={scene.id}>
            <div className="neighborhood-scene-top"><span>{zh?scene.title_zh:scene.title}</span><button type="button" onClick={clearStage} aria-label={zh?'收起片段':'Close the scene'}>×</button></div>
            <div className="neighborhood-dialogue" aria-live="polite"><strong>{beat?.speaker_id?nameOf(beat.speaker_id):(zh?'小城记事':'A neighborhood moment')}</strong><p lang="en">{beat?.text}</p><small lang="zh">{beat?.text_zh}</small></div>
            <div className="neighborhood-scene-controls"><button type="button" disabled={!beatIndex} onClick={()=>{setPlaying(false);setBeatIndex(value=>Math.max(0,value-1))}} aria-label={zh?'上一句':'Previous line'}>‹</button><span>{Math.min(beatIndex+1,scene.beats.length)} / {scene.beats.length}</span><button type="button" disabled={beatIndex>=scene.beats.length-1} onClick={()=>{setPlaying(false);setBeatIndex(value=>Math.min(scene.beats.length-1,value+1))}} aria-label={zh?'下一句':'Next line'}>›</button><button type="button" onClick={()=>setPlaying(value=>!value)}>{playing?(zh?'暂停字幕':'Pause text'):(zh?'播放字幕':'Play text')}</button><button type="button" onClick={()=>playScene(scene)}>{zh?'重播':'Replay'}</button><button type="button" onClick={()=>{cancelVoice.current();setFoodDone(true);setBeatIndex(Math.max(0,scene.beats.length-1));setPlaying(false)}}>{zh?'看结果':'Result'}</button>{beat&&<button type="button" onClick={()=>say(beat.text,beat.speaker_id)} aria-label={zh?'朗读这一句':'Read this line'}>♪</button>}</div>
            {!playing&&beatIndex===scene.beats.length-1&&<p className="neighborhood-scene-result">{scene.result.coins_awarded?`+${scene.result.coins_awarded} ${zh?'生活币':'coins'} · `:''}{zh?'这一刻，已经成为小城的回忆。':'A new moment to remember.'}</p>}
          </div>}
        </section>

        <section className="neighborhood-content">
          {tab==='today'&&<>
            <div className="neighborhood-section-heading"><p>{zh?'今天，想做点什么？':'WHAT SHALL WE DO TODAY?'}</p><h2>{zh?'一点关心，一点新故事。':'A little care. A new little story.'}</h2></div>
            {unread>0&&<button type="button" className="neighborhood-news-teaser" onClick={()=>{setTab('news');readNews(state.news.find(item=>!item.read)!)}}><span aria-hidden>▤</span><div><small>{zh?'有新消息':'BREAKING LITTLE NEWS'}</small><strong>{zh?state.news.find(item=>!item.read)?.title_zh:state.news.find(item=>!item.read)?.title}</strong></div><b>→</b></button>}
            <div className="neighborhood-today-grid"><button type="button" onClick={()=>switchTab('fountain')}><span aria-hidden>⛲</span><strong>{zh?'许个小愿望':'Make a wish'}</strong><small>{state.unlocks.fountain?(zh?`还有 ${state.wishes.available} 次愿望`:`${state.wishes.available} wishes waiting`):(fountainProject?.status==='proposed'?(zh?'居民已有提议，去看看筹备':'A resident has an idea to prepare'):(zh?'照顾居民，听听新的心愿':'Care for residents and hear their ideas'))}</small></button><button type="button" onClick={()=>switchTab('residents')}><span aria-hidden>🎁</span><strong>{zh?'去看看居民':'Visit a neighbor'}</strong><small>{zh?`${giftCount} 份礼物在等着送出`:`${giftCount} gifts to share`}</small></button></div>
            <button type="button" className="neighborhood-wide-action neighborhood-wallet-teaser" onClick={()=>switchTab('wallet')}><span aria-hidden>●</span><div><strong>{zh?'生活币，可以做点什么？':'What can your coins do?'}</strong><small>{zh?'买食物和礼物、添新衣、一起改善广场。':'Food, gifts, new outfits, and a nicer square.'}</small></div><b>→</b></button>
            {nextProjects.length>0&&<section className="neighborhood-today-projects"><h3>{zh?'听见一个小心愿':'A little idea from the neighborhood'}</h3><NeighborhoodProjectCards projects={nextProjects} residents={state.residents} coins={state.coins} language={language} busy={locked} onFund={id=>void run({action:'fund_project',project_id:id})} onOpenWallet={()=>switchTab('wallet')}/></section>}
            {state.residents.length===1&&<article className="neighborhood-lonely"><CharacterPortrait avatar={state.residents[0].profile.avatar} live/><div><strong>{state.residents[0].profile.name}</strong><p>{zh?'“如果再有一个人住进来，就能一起聊天啦。”':'“It would be nice to have someone else here to talk to.”'}</p><button type="button" className="neighborhood-primary" disabled={locked||!canInvite} onClick={onCreateResident}>{zh?'邀请第二位居民':'Invite a second resident'}</button>{!canInvite&&<small>{zh?'先陪居民完成眼前的小心愿。':'Share a little more everyday life first.'}</small>}</div></article>}
            {state.residents.length>1&&<button type="button" className="neighborhood-wide-action" onClick={()=>switchTab('residents')}><span>☺</span><div><strong>{zh?'让两个人打个招呼':'Bring two neighbors together'}</strong><small>{zh?'给他们一个话题，再看看会发生什么。':'Offer a topic and see where the conversation goes.'}</small></div><b>→</b></button>}
            {state.scenes.length>0&&<div className="neighborhood-recent"><h3>{zh?'刚刚发生的小事':'Recent little moments'}</h3>{[...state.scenes].reverse().slice(0,3).map(item=><button type="button" key={item.id} onClick={()=>playScene(item)}><span>▷</span><strong>{zh?item.title_zh:item.title}</strong><small>{zh?'回看':'Replay'}</small></button>)}</div>}
          </>}

          {tab==='fountain'&&<>
            <div className="neighborhood-section-heading"><p>{zh?'每次成长，都值得一个愿望':'A LITTLE WISH FOR EVERY LEVEL'}</p><h2>{zh?'许愿喷泉':'The wishing fountain'}</h2></div>
            {state.unlocks.fountain?<><div className="neighborhood-wish-count"><span aria-hidden>✦</span><div><strong>{state.wishes.available}</strong><small>{zh?'次可以实现的小愿望':'little wishes to make'}</small></div></div><p className="neighborhood-help">{zh?'居民满足度每升一级，就多一次许愿。挑一份小礼物吧。':'Each happiness level brings a wish. Choose a little gift.'}</p><div className="neighborhood-item-grid">{state.gift_catalog.map(item=><article key={item.id}><span className="neighborhood-item-icon" aria-hidden>{item.emoji}</span><small>{item.kind==='micro'?(zh?'微个性':'Little personality'):(zh?'小道具':'Little treasure')}</small><h3>{zh?item.name_zh:item.name}</h3><p>{zh?item.description_zh:item.description}</p><button type="button" className="neighborhood-primary" disabled={locked||state.wishes.available<1} onClick={()=>void run({action:'wish',item_id:item.id})}>{zh?'许愿得到它':'Wish for this'}<span>✦ 1</span></button></article>)}</div></>:fountainProject?<NeighborhoodProjectCards projects={[fountainProject]} residents={state.residents} coins={state.coins} language={language} busy={locked} onFund={id=>void run({action:'fund_project',project_id:id})} onOpenWallet={()=>switchTab('wallet')}/>:lockCard('⛲',zh?'为广场筹备一个许愿角落':'A wishing corner for the square',zh?'先照顾好居民，听听他们对广场的想法，再一起筹备。':'Care for residents, hear their ideas for the square, then help prepare it together.')}
          </>}

          {tab==='residents'&&<>
            <div className="neighborhood-section-heading"><p>{zh?'陪伴，让生活有了回声':'A LITTLE COMPANY GOES A LONG WAY'}</p><h2>{zh?'居民之间':'Between neighbors'}</h2></div>
            <div className="neighborhood-resident-strip">{state.residents.map(item=><button type="button" key={item.id} draggable={!locked} aria-pressed={resident?.id===item.id} onClick={()=>{setActorId(item.id);clearStage()}} onDragStart={event=>{event.dataTransfer.setData('application/x-lingolife-resident',item.id);event.dataTransfer.effectAllowed='move';setDragged(item.id)}} onDragEnd={()=>setDragged('')}><CharacterPortrait avatar={item.profile.avatar} live/><strong>{item.profile.name}</strong><small>Lv. {item.care.level}</small></button>)}{canInvite&&<button type="button" className="neighborhood-add-resident" disabled={locked} onClick={onCreateResident}><span>＋</span><strong>{zh?'新居民':'New neighbor'}</strong></button>}</div>
            {resident&&(onEditVoice||onReplayArrival)&&<div className="neighborhood-resident-extras">{onEditVoice&&<button type="button" disabled={locked} onClick={()=>onEditVoice(resident.id)}>♪ {zh?'选择这个角色的声音':'Choose their voice'}</button>}{onReplayArrival&&<button type="button" disabled={locked} onClick={()=>onReplayArrival(resident)}>▷ {zh?'回看入住':'Replay arrival'}</button>}</div>}
            {resident&&<details className="neighborhood-care" open={state.residents.length<2}><summary><span>🎁</span>{zh?`照顾${resident.profile.name}`:`Care for ${resident.profile.name}`}<small>{zh?'吃东西 · 送礼物':'Food · Gifts'}</small></summary><div className="neighborhood-care-inner"><div className="neighborhood-care-stat"><span>{zh?'满足度':'Happiness'}</span><progress max={20} value={resident.care.xp%20} aria-label={zh?'满足度升级进度':'Progress to the next happiness level'}/><b>Lv. {resident.care.level}</b></div><div className="neighborhood-care-stat"><span>{zh?'饱腹度':'Fullness'}</span><progress max={100} value={resident.care.satiety} aria-label={zh?'饱腹度':'Fullness'}/><b>{resident.care.satiety}%</b></div><div className="neighborhood-gifts">{state.gift_catalog.filter(item=>(state.gifts[item.id]??0)>0).map(item=><button type="button" key={item.id} disabled={locked||(item.kind==='micro'&&resident.micro_personalities.includes(item.id))} onClick={()=>void run({action:'gift',npc_id:resident.id,item_id:item.id})}><span>{item.emoji}</span><div><strong>{zh?item.name_zh:item.name}</strong><small>× {state.gifts[item.id]}</small></div><b>{item.kind==='micro'&&resident.micro_personalities.includes(item.id)?(zh?'已学会':'Learned'):(zh?'赠送':'Give')}</b></button>)}</div>{!giftCount&&<p className="neighborhood-help">{zh?'礼物篮空空的。可以用生活币买普通礼物，也可以去喷泉许愿。':'Your gift basket is empty. Buy ordinary gifts with coins, or make a wish at the fountain.'}</p>}<h3>{zh?'来点好吃的':'Something delicious'}</h3><div className="neighborhood-food-grid">{state.food_catalog.map(food=><article key={food.id}><span>{food.emoji}</span><strong>{zh?food.name_zh:food.name}</strong><small>{food.price} {zh?'币':'coins'} · {zh?'篮中':'basket'} {state.food_inventory[food.id]??0}</small><div><button type="button" disabled={locked||state.coins<food.price} onClick={()=>void run({action:'buy_food',npc_id:resident.id,item_id:food.id})}>{zh?'买一份':'Buy'}</button><button type="button" disabled={locked||resident.care.satiety>=85||!(state.food_inventory[food.id]>0)} onClick={()=>void run({action:'feed',npc_id:resident.id,item_id:food.id})}>{zh?'喂食':'Serve'}</button></div></article>)}</div>{resident.micro_personalities.length>0&&<p className="neighborhood-micro">✦ {resident.micro_personalities.map(id=>{const item=state.gift_catalog.find(gift=>gift.id===id);return item?(zh?item.name_zh:item.name):(zh?'新的小习惯':'A little habit')}).join(' · ')}</p>}</div></details>}
            {state.residents.length>=2?<>
              <article className="neighborhood-meet"><h3>{zh?'让两位居民见个面':'Bring two neighbors together'}</h3><p>{zh?'把居民拖进小圆圈，或直接选择名字。':'Drag neighbors into the circles, or choose their names.'}</p><div className="neighborhood-pair">{([0,1] as const).map(index=>{const chosen=state.residents.find(item=>item.id===pair[index]);return <div className={`neighborhood-pair-slot${dragged?' is-dropping':''}`} key={index} onDragOver={event=>{event.preventDefault();event.dataTransfer.dropEffect='move'}} onDrop={event=>{event.preventDefault();setSlot(index,event.dataTransfer.getData('application/x-lingolife-resident'));setDragged('')}}><span>{chosen?<CharacterPortrait avatar={chosen.profile.avatar} live/>:<b>＋</b>}</span><select aria-label={zh?`第 ${index+1} 位居民`:`Neighbor ${index+1}`} value={pair[index]} onChange={event=>setSlot(index,event.target.value)}><option value="">{zh?'选一位居民':'Choose a neighbor'}</option>{state.residents.map(item=><option key={item.id} value={item.id}>{item.profile.name}</option>)}</select></div>})}<span className="neighborhood-pair-heart" aria-hidden>↔</span></div><button type="button" className="neighborhood-primary" disabled={locked||!pair[0]||!pair[1]||pair[0]===pair[1]} onClick={()=>void run({action:'meet',npc_id:pair[0],target_id:pair[1]})}>{zh?'一起打个招呼':'Say hello together'}<span>→</span></button></article>
              {meeting&&<article className="neighborhood-meeting-card"><header><span aria-hidden>☏</span><div><h3>{nameOf(meeting.npc_id)} &amp; {nameOf(meeting.target_id)}</h3><small>{relationLabels[meeting.friendship]?.[zh?0:1]??meeting.friendship}</small></div></header>
                {meeting.status==='awaiting_advice'?<><p>{zh?`${nameOf(meeting.npc_id)}想和对方多聊聊。你觉得呢？`:`${nameOf(meeting.npc_id)} would like to talk a little more. What do you think?`}</p><label>{zh?'可以聊点什么？':'What could they talk about?'}<input name="neighborhood-topic" maxLength={100} placeholder={zh?'比如：周末一起去公园散步':'For example: a walk in the park this weekend'} value={topic} onChange={event=>setTopic(event.target.value)}/></label><div className="neighborhood-topic-kinds" aria-label={zh?'话题类别':'Topic category'}>{(['person','object','activity','other'] as const).map((kind,index)=><button type="button" key={kind} aria-pressed={topicKind===kind} onClick={()=>setTopicKind(kind)}>{(zh?['人','物','做的事情','其他']:['Person','Thing','Activity','Other'])[index]}</button>)}</div>{topicKind==='person'&&<label>{zh?'聊到的是谁？':'Who is the topic about?'}<select value={topicPerson||meeting.target_id} onChange={event=>setTopicPerson(event.target.value)}>{state.residents.map(item=><option key={item.id} value={item.id}>{item.profile.name}</option>)}</select></label>}<div className="neighborhood-choice-row"><button type="button" disabled={locked} onClick={()=>friend('discourage')}>{zh?'还是算了吧':'Perhaps another time'}</button><button type="button" className="neighborhood-primary" disabled={locked} onClick={()=>friend('encourage')}>{zh?'挺好的，去聊聊':'Go have a chat'}</button></div></>:<>
                  <p className="neighborhood-relationship-result">{meeting.status==='declined'?(zh?'这次先留一点空间。以后还有机会慢慢认识。':'A little space for now. There will be other chances to connect.'):(zh?'他们有了自己的回应。关系会随着以后的相处继续变化。':'They have made their own choices. Their connection will keep growing through everyday life.')}</p>
                  {meeting.status==='resolved'&&<details className="neighborhood-nicknames"><summary>{zh?'两人怎样称呼彼此？':'What will they call each other?'}</summary><label>{zh?`${nameOf(meeting.npc_id)}称${nameOf(meeting.target_id)}为`:`${nameOf(meeting.npc_id)} calls ${nameOf(meeting.target_id)}`}<input name="nickname-a-to-b" maxLength={24} value={currentAliases.a_to_b} onChange={event=>setAliases({...currentAliases,a_to_b:event.target.value})}/></label><label>{zh?`${nameOf(meeting.target_id)}称${nameOf(meeting.npc_id)}为`:`${nameOf(meeting.target_id)} calls ${nameOf(meeting.npc_id)}`}<input name="nickname-b-to-a" maxLength={24} value={currentAliases.b_to_a} onChange={event=>setAliases({...currentAliases,b_to_a:event.target.value})}/></label><button type="button" disabled={locked||!currentAliases.a_to_b.trim()||!currentAliases.b_to_a.trim()} onClick={()=>void run({action:'nicknames',meeting_id:meeting.id,aliases:{a_to_b:currentAliases.a_to_b.trim(),b_to_a:currentAliases.b_to_a.trim()}})}>{zh?'记住这两个称呼':'Remember these names'}</button></details>}
                  {meeting.status==='resolved'&&meeting.romance_eligible&&!meeting.romance_advised&&<div className="neighborhood-romance"><span aria-hidden>♡</span><h4>{zh?'刚才那一瞬间，有一点不一样。':'Something felt a little different.'}</h4><p>{zh?'也许只是开心，也许有些在意。你的建议，会由他们自己考虑。':'Maybe it was a happy moment. Maybe a little interest. They will decide what your suggestion means to them.'}</p><div className="neighborhood-choice-row"><button type="button" disabled={locked} onClick={()=>void run({action:'romance',meeting_id:meeting.id,advice:'discourage'})}>{zh?'可能是错觉':'Maybe just a moment'}</button><button type="button" disabled={locked} onClick={()=>void run({action:'romance',meeting_id:meeting.id,advice:'encourage'})}>{zh?'也许是喜欢呢':'Maybe you like them'}</button></div></div>}
                  {meeting.romance_advised&&<p className="neighborhood-romance-result">♡ {meeting.romance==='none'?(zh?'这次没有开始恋爱。留给彼此慢慢了解的时间。':'No romance began this time. There is room to get to know each other.'):(relationLabels[meeting.romance]?.[zh?0:1]??meeting.romance)}</p>}
                </>}
              </article>}
              {state.meetings.length>1&&<label className="neighborhood-select">{zh?'回顾之前的相遇':'An earlier meeting'}<select value={meeting?.id??''} onChange={event=>{setMeetingId(event.target.value);clearStage()}}>{[...state.meetings].reverse().map(item=><option key={item.id} value={item.id}>{nameOf(item.npc_id)} &amp; {nameOf(item.target_id)} · {item.status==='awaiting_advice'?(zh?'等待建议':'Awaiting advice'):(zh?'已有回应':'Responded')}</option>)}</select></label>}
            </>:lockCard('☺',zh?'多一位邻居，就多一个故事':'Another neighbor, another story',zh?'邀请第二位居民后，可以介绍他们认识。':'Invite a second resident, then introduce them to each other.')}
          </>}

          {tab==='shop'&&<>
            <div className="neighborhood-section-heading"><p>{zh?'把今天穿成喜欢的样子':'DRESS FOR A LOVELY LITTLE DAY'}</p><h2>{zh?'服装小店':'The clothing shop'}</h2></div>
            {state.unlocks.clothing_store?<>{residentSelect(zh?'想给谁挑一套？':'Who are we shopping for?')}<div className="neighborhood-item-grid neighborhood-clothing-grid">{state.clothing_catalog.map(item=><article key={item.id} data-preview={previewItem===item.id}><span className="neighborhood-item-icon neighborhood-outfit-icon" aria-hidden>{resident?<CharacterPortrait avatar={{...resident.profile.avatar,model:'chibi',outfit:item.outfit,outfitColor:item.outfit_color}} live/>:'👕'}</span><h3>{zh?item.name_zh:item.name}</h3><p>{item.price} {zh?'生活币':'coins'}<span>{zh?'衣橱':'Owned'} {state.wardrobe[item.id]??0}</span></p>{canWear(item)?<><button type="button" className="neighborhood-preview" onClick={()=>{clearStage();setPreviewItem(item.id)}}>{zh?'试试看':'Try it on'}</button><div className="neighborhood-clothing-actions"><button type="button" disabled={locked||state.coins<item.price||Boolean(state.wardrobe[item.id])} onClick={()=>void run({action:'buy_clothing',item_id:item.id})}>{state.wardrobe[item.id]?(zh?'已拥有':'Owned'):(zh?'买下来':'Buy')}</button><button type="button" className="neighborhood-primary" disabled={locked||!(state.wardrobe[item.id]>0)||!resident} onClick={()=>resident&&void run({action:'wear_clothing',npc_id:resident.id,item_id:item.id})}>{zh?'送给居民':'Give & wear'}</button></div></>:<p className="neighborhood-compatibility">{zh?'这套衣服适合奇趣换装角色。':'This outfit fits the mix-and-match chibi.'}</p>}</article>)}</div></>:clothingProject?<NeighborhoodProjectCards projects={[clothingProject]} residents={state.residents} coins={state.coins} language={language} busy={locked} onFund={id=>void run({action:'fund_project',project_id:id})} onOpenWallet={()=>switchTab('wallet')}/>:lockCard('🧵',zh?'服装小店还在准备中':'The shop is getting ready',zh?'认识更多邻居，听听大家对新衣服的期待，再一起筹备小店。':'Meet more neighbors, hear what they would like to wear, then help prepare the shop.')}
          </>}

          {tab==='wallet'&&<NeighborhoodEconomy state={state} language={language} busy={locked} onCommand={command=>void run(command)} onResidents={()=>switchTab('residents')} onShop={()=>switchTab('shop')}/>}

          {tab==='news'&&<>
            <div className="neighborhood-section-heading"><p>{zh?'小城在长大，故事也在增加':'OUR LITTLE NEIGHBORHOOD IS GROWING'}</p><h2>{zh?'小城新闻':'Neighborhood news'}</h2></div><div className="neighborhood-news-list">{[...state.news].reverse().map(item=><button type="button" key={item.id} onClick={()=>readNews(item)}><span className="neighborhood-news-icon" aria-hidden>{item.id.includes('fountain')?'⛲':item.id.includes('cloth')?'🧵':'☀'}</span><div><small>{item.read?(zh?'可以再次回看':'Watch again'):(zh?'新消息':'NEW')}</small><strong>{zh?item.title_zh:item.title}</strong><p>{zh?item.body_zh:item.body}</p></div><b>▷</b></button>)}</div>{!state.news.length&&lockCard('▤',zh?'下一条好消息，正在路上':'The next little headline is on its way',zh?'居民成长、朋友入住，都会让小城多一点变化。':'Growing residents and new neighbors bring fresh stories.')}
            {state.scenes.length>0&&<div className="neighborhood-recent"><h3>{zh?'生活片段回放':'Little stories to replay'}</h3>{[...state.scenes].reverse().map(item=><button type="button" key={item.id} onClick={()=>playScene(item)}><span>▷</span><strong>{zh?item.title_zh:item.title}</strong><small>{zh?'回看':'Replay'}</small></button>)}</div>}
          </>}
          {(localError||error)&&<p className="neighborhood-error" role="alert">{error||localError}</p>}
          {notice&&<p className="neighborhood-notice" role="status">{notice}</p>}
        </section>
      </div>
      <footer className="neighborhood-footer"><span role="status"><i className={locked?'is-saving':''} aria-hidden>{locked?'◌':'✓'}</i>{locked?(zh?'正在保存这件小事…':'Saving this little moment…'):(zh?'生活里的变化，已经记住了。':'These little changes are remembered.')}</span><button type="button" onClick={onClose}>{zh?'回到城市':'Back to the city'}<span>↗</span></button></footer>
    </section>
  </div>
}

export default NeighborhoodPanel
