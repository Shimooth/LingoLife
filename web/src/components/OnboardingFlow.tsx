import {AnimatePresence,motion,useReducedMotion} from 'motion/react'
import {useMemo,useState,type FormEvent} from 'react'
import type {Language} from '../i18n'
import {
 addRandomOnboardingResident,
 buildOnboardingSocialContract,
 createOnboardingResidents,
 FAMILY_ROLE_INVERSE,
 onboardingResidentsAreValid,
 onboardingRosterDifference,
 rerollOnboardingResident,
 validateOnboardingResidents,
 type OnboardingResidentDraft,
 type DraftFamilyBond,
 type DraftSharedHistoryHook,
 type ResidentValidationIssue,
} from '../onboardingProfiles'
import {normalizeNpcProfilePolicy,withProfileAge,withRomancePreference} from '../profilePolicy'
import {CharacterCanvas3D} from '../three/characters'
import {CHARACTER_PRESETS} from '../three/characters/characterAssets'
import type {FamilyRole,NpcProfile,OnboardingCompleteRequest,SharedHistoryKind,SharedHistoryTone} from '../types'
import './OnboardingFlow.css'

const COPY={
 zh:{
  stepIntro:'认识你的身份',stepLoop:'了解一天怎样展开',stepResidents:'建立共享住宅',introEyebrow:'欢迎来到 LingoLife',introTitle:'这里不是任务清单，而是一座会自己生活的城市。',introBody:'你将以两个互补的身份陪伴居民。即使你不操作，他们也会工作、休息、交朋友、闹矛盾，并继续追逐自己的目标。',
  observer:'观察者',observerBody:'俯瞰城市，跟随居民，看看他们此刻在做什么，以及关系如何自然发展。',manager:'管理者',managerBody:'在重要事件发生时介入、提供建议，或直接和任意居民用英语交谈。',home:'共享住宅',homeBody:'你现在创建的所有居民都会住进同一套共享住宅，共用客厅、厨房和日常生活。',
  begin:'看看生活如何展开',loopEyebrow:'城市的核心循环',loopTitle:'观察、陪伴、选择，然后看生活继续。',loopBody:'城市时间和居民日程会持续推进。你不必把每件事都变成任务：有些时刻适合见证，有些时刻值得介入。',loopObserve:'读懂城市状态',loopObserveBody:'从城市概况看到谁在忙碌、谁遇到了事情，以及关系留下的新动向。',loopFollow:'跟随居民生活',loopFollowBody:'选择一位居民，跟着他们走向地点、完成日常活动或抵达正在发生的事件。',loopChoose:'旁观或介入',loopChooseBody:'重要时刻由居民先行动；你可以只记录，也可以用管理者身份给出有限而有后果的选择。',loopTalk:'交流并继续演化',loopTalkBody:'随时和居民用英语交谈。对话、事件和共同生活会进入记忆，影响之后的关系、心情和日程。',loopBack:'返回身份介绍',loopBegin:'安排第一批居民',setupEyebrow:'你的第一间共享住宅',setupTitle:'谁会一起住进来？',setupBody:'先安排 2–8 名居民。预设已经彼此区分，你可以逐项修改，也可以重新随机。以后仍可在角色工作室调整外观和设定。',sharedTitle:'所有居民住在同一套共享住宅',sharedBody:'他们会共享空间、家务和生活资源，也会因此成为朋友、竞争对手，甚至发生冲突或恋爱。关系会从这里开始，但不会被这里写死。',
  roster:'入住名单',residentCount:(count:number,max:number)=>`${count} / ${max} 名居民`,add:'增加居民',randomAll:'全部重新随机',remove:'移除',reroll:'重新随机此人',residentHome:'共享住宅居民',
  name:'姓名',age:'年龄',relationship:'与你的初始关系',occupation:'职业',personality:'人格特征',personalityHint:'用逗号分隔，最多 4 项',interests:'兴趣',interestsHint:'用逗号分隔，最多 5 项',goal:'长期目标',appearance:'初始外观',model:'角色模型',romance:'允许自主发展恋爱关系',romanceHint:'只会在双方均成年、均允许且不存在亲属关系时发展。',
  likes:'喜欢',dislikes:'不喜欢',quirks:'怪癖',habits:'习惯',boundaries:'生活边界',listHint:'用逗号分隔',householdRole:'家庭角色',chores:'偏好的家务',privateSpace:'私人空间需求',roles:{organizer:'组织者',caretaker:'照顾者',mediator:'协调者',cook:'主厨',fixer:'维修担当',free_spirit:'自由派'},privacy:{low:'喜欢共享空间',balanced:'平衡',high:'需要较多独处'},choreNames:{cooking:'做饭',dishes:'洗碗',cleaning:'清洁',shopping:'采购',repairs:'维修',laundry:'洗衣'},familyTitle:'与同住者的亲属关系',familyHint:'亲属事实会由服务端成对保存，单方设置或自我引用无法进入世界。',notFamily:'不是亲属',familyRoles:{sibling:'兄弟姐妹',cousin:'表/堂亲',parent:'对方的父母',child:'对方的子女',guardian:'对方的监护人',dependent:'由对方监护'},historyTitle:'共同历史 Hook',historyHint:'最多为每人设置 4 段已发生的共同经历；它只提供故事起点，不预写友情、恋爱或冲突结果。',noHistory:'没有预设共同历史',historyKinds:{grew_up_together:'一起长大',studied_together:'曾经同学',worked_together:'曾经共事',shared_project:'合作过项目',weathered_hardship:'共同度过难关',family_tradition:'共享家庭传统',friendly_rivalry:'长期友好竞争'},historyTones:{warm:'温暖',neutral:'平静',complicated:'复杂'},historySummary:'共同经历摘要',historyDefault:(a:string,b:string)=>`${a} and ${b} once completed an important project together.`,
  back:'返回玩法介绍',enter:'完成并进入城市',entering:'正在安置居民…',invalid:'请补全标记的设定，并让阵容在人格、兴趣、日程、家务和社交方式上有明显差异。',differenceGood:'阵容差异清晰：居民会从相似生活条件中做出不同选择。',differenceBad:'阵容过于相似，请调整职业、家庭角色、家务或社交边界。',introError:'暂时无法保存介绍进度，请重试。',required:'需要填写',duplicate:'姓名不能与其他居民重复',min:(count:number)=>`至少需要 ${count} 名居民才能让城市开始运转。`,max:'共享住宅已经住满了。',savedHint:'这些资料会影响角色说话方式、生活选择、随机事件和长期关系。',
 },
 en:{
  stepIntro:'Meet your role',stepLoop:'See how a day unfolds',stepResidents:'Build the shared home',introEyebrow:'Welcome to LingoLife',introTitle:'This is not a task list. It is a city that keeps living.',introBody:'You accompany its residents through two complementary roles. Even when you do nothing, they work, rest, make friends, clash, and pursue goals of their own.',
  observer:'Observer',observerBody:'Look across the city, follow residents, and see what they are doing and how their relationships evolve naturally.',manager:'Manager',managerBody:'Step into important moments, offer guidance, or talk with any resident in English.',home:'Shared home',homeBody:'Everyone you create now moves into one shared residence, with a common living room, kitchen, and everyday life.',
  begin:'See how life unfolds',loopEyebrow:'The city’s core loop',loopTitle:'Observe, accompany, choose—and watch life continue.',loopBody:'City time and resident schedules keep moving. You do not need to turn every moment into a task: some are best witnessed, while others invite your involvement.',loopObserve:'Read the city',loopObserveBody:'The overview shows who is busy, who has run into something, and where relationships are starting to shift.',loopFollow:'Follow a resident',loopFollowBody:'Choose someone and stay with them as they travel, carry out everyday activities, or arrive at a live event.',loopChoose:'Witness or step in',loopChooseBody:'Residents act first. At important moments, you can simply remember what happened or make a limited choice as manager—with consequences.',loopTalk:'Connect and let life evolve',loopTalkBody:'Talk with anyone in English at any time. Conversations, events, and shared life become memories that shape later relationships, moods, and schedules.',loopBack:'Back to roles',loopBegin:'Set up the first residents',setupEyebrow:'Your first shared residence',setupTitle:'Who will live here together?',setupBody:'Set up 2–8 residents. The presets start deliberately different; edit every detail or reroll anyone. Appearance and identity remain editable later in the character studio.',sharedTitle:'Every resident lives in the same shared home',sharedBody:'They share space, chores, and household resources. That can lead to friendship, rivalry, conflict, or romance. Relationships start here, but are never frozen here.',
  roster:'Move-in list',residentCount:(count:number,max:number)=>`${count} / ${max} residents`,add:'Add resident',randomAll:'Reroll everyone',remove:'Remove',reroll:'Reroll this person',residentHome:'Shared-home resident',
  name:'Name',age:'Age',relationship:'Initial relationship to you',occupation:'Occupation',personality:'Personality traits',personalityHint:'Comma-separated, up to 4',interests:'Interests',interestsHint:'Comma-separated, up to 5',goal:'Long-term goal',appearance:'Starting appearance',model:'Character model',romance:'Allow autonomous romance',romanceHint:'Romance only develops between consenting adults who are not family.',
  likes:'Likes',dislikes:'Dislikes',quirks:'Quirks',habits:'Habits',boundaries:'Everyday boundaries',listHint:'Comma-separated',householdRole:'Household role',chores:'Preferred chores',privateSpace:'Private-space preference',roles:{organizer:'Organizer',caretaker:'Caretaker',mediator:'Mediator',cook:'Cook',fixer:'Fixer',free_spirit:'Free spirit'},privacy:{low:'Enjoys shared space',balanced:'Balanced',high:'Needs more solitude'},choreNames:{cooking:'Cooking',dishes:'Dishes',cleaning:'Cleaning',shopping:'Shopping',repairs:'Repairs',laundry:'Laundry'},familyTitle:'Family ties within the household',familyHint:'The server saves family facts as reciprocal pairs; one-sided links and self-references cannot enter the world.',notFamily:'Not family',familyRoles:{sibling:'Sibling',cousin:'Cousin',parent:'Their parent',child:'Their child',guardian:'Their guardian',dependent:'Their dependent'},historyTitle:'Shared-history hooks',historyHint:'Give each resident up to four experiences that already happened. Hooks seed stories without pre-writing friendship, romance, or conflict outcomes.',noHistory:'No preset shared history',historyKinds:{grew_up_together:'Grew up together',studied_together:'Studied together',worked_together:'Worked together',shared_project:'Shared a project',weathered_hardship:'Weathered hardship',family_tradition:'Family tradition',friendly_rivalry:'Friendly rivalry'},historyTones:{warm:'Warm',neutral:'Neutral',complicated:'Complicated'},historySummary:'Shared experience summary',historyDefault:(a:string,b:string)=>`${a} and ${b} once completed an important project together.`,
  back:'Back to gameplay guide',enter:'Finish and enter the city',entering:'Moving residents in…',invalid:'Complete every marked field and make the cast distinct in personality, interests, schedule, chores, and social style.',differenceGood:'The cast is distinct enough to make different choices under the same conditions.',differenceBad:'This cast is too similar. Change occupations, household roles, chores, or social boundaries.',introError:'Could not save introduction progress. Try again.',required:'Required',duplicate:'Name must be different from every other resident',min:(count:number)=>`At least ${count} residents are needed before the city can begin.`,max:'The shared home is full.',savedHint:'These details shape each resident’s voice, daily choices, random events, and long-term relationships.',
 },
} as const

const split=(value:string,max:number)=>value.split(/[,，]/).map(item=>item.trim()).filter(Boolean).slice(0,max)
const issueFor=(issues:readonly ResidentValidationIssue[],field:ResidentValidationIssue)=>issues.includes(field)

export function OnboardingFlow({language,minimum,maximum,introAcknowledged,saving,error,onAcknowledgeIntro,onComplete}:{
 language:Language
 minimum:number
 maximum:number
 introAcknowledged:boolean
 saving:boolean
 error:string
 onAcknowledgeIntro:()=>Promise<void>
 onComplete:(setup:Omit<OnboardingCompleteRequest,'household_name'>)=>void
}){
 const copy=COPY[language],reduce=useReducedMotion()
 const safeMinimum=Math.max(2,Math.min(8,minimum)),safeMaximum=Math.max(safeMinimum,Math.min(8,maximum))
 const [phase,setPhase]=useState<'intro'|'loop'|'residents'>(introAcknowledged?'loop':'intro')
 const [acknowledging,setAcknowledging]=useState(false),[introError,setIntroError]=useState('')
 const [drafts,setDrafts]=useState<OnboardingResidentDraft[]>(()=>createOnboardingResidents(safeMinimum))
 const [familyBonds,setFamilyBonds]=useState<DraftFamilyBond[]>([])
 const [historyHooks,setHistoryHooks]=useState<DraftSharedHistoryHook[]>([])
 const [selectedKey,setSelectedKey]=useState(()=>drafts[0].key)
 const [attempted,setAttempted]=useState(false)
 const issues=useMemo(()=>validateOnboardingResidents(drafts),[drafts])
 const difference=useMemo(()=>onboardingRosterDifference(drafts),[drafts])
 const selected=drafts.find(draft=>draft.key===selectedKey)??drafts[0]
 const otherDrafts=drafts.filter(draft=>draft.key!==selected.key)
 const selectedIssues=issues[selected.key]??[]
 const socialValid=historyHooks.every(hook=>hook.summary.trim().length>=3&&hook.participantKeys.every(key=>drafts.some(draft=>draft.key===key)))
 const valid=onboardingResidentsAreValid(drafts,safeMinimum,safeMaximum)&&socialValid
 const updateProfile=(change:(profile:NpcProfile)=>NpcProfile)=>setDrafts(current=>current.map(draft=>draft.key===selected.key?{...draft,profile:change(draft.profile)}:draft))
 const setField=<K extends keyof NpcProfile>(field:K,value:NpcProfile[K])=>updateProfile(profile=>({...profile,[field]:value}))
 const addResident=()=>{
  if(drafts.length>=safeMaximum)return
  const next=addRandomOnboardingResident(drafts)
  setDrafts(next);setSelectedKey(next[next.length-1].key);setAttempted(false)
 }
 const removeResident=()=>{
  if(drafts.length<=safeMinimum)return
  const index=drafts.findIndex(draft=>draft.key===selected.key),next=drafts.filter(draft=>draft.key!==selected.key)
  setDrafts(next);setFamilyBonds(current=>current.filter(bond=>bond.leftKey!==selected.key&&bond.rightKey!==selected.key));setHistoryHooks(current=>current.filter(hook=>!hook.participantKeys.includes(selected.key)));setSelectedKey(next[Math.min(Math.max(index,0),next.length-1)].key);setAttempted(false)
 }
 const rerollSelected=()=>{setDrafts(current=>rerollOnboardingResident(current,selected.key));setFamilyBonds(current=>current.filter(bond=>bond.leftKey!==selected.key&&bond.rightKey!==selected.key));setHistoryHooks(current=>current.filter(hook=>!hook.participantKeys.includes(selected.key)));setAttempted(false)}
 const rerollAll=()=>{const next=createOnboardingResidents(drafts.length);setDrafts(next);setFamilyBonds([]);setHistoryHooks([]);setSelectedKey(next[0].key);setAttempted(false)}
 const beginGuide=async()=>{setAcknowledging(true);setIntroError('');try{await onAcknowledgeIntro();setPhase('loop')}catch{setIntroError(copy.introError)}finally{setAcknowledging(false)}}
 const toggleChore=(value:NpcProfile['chorePreferences'][number])=>setField('chorePreferences',selected.profile.chorePreferences.includes(value)?selected.profile.chorePreferences.filter(item=>item!==value):[...selected.profile.chorePreferences,value].slice(-3))
 const bondFor=(otherKey:string)=>familyBonds.find(bond=>(bond.leftKey===selected.key&&bond.rightKey===otherKey)||(bond.rightKey===selected.key&&bond.leftKey===otherKey))
 const familyRoleFor=(otherKey:string)=>{const bond=bondFor(otherKey);return bond?(bond.leftKey===selected.key?bond.leftRole:bond.rightRole):''}
 const familyCount=(key:string)=>familyBonds.filter(bond=>bond.leftKey===key||bond.rightKey===key).length
 const setFamilyRole=(otherKey:string,role:FamilyRole|'')=>setFamilyBonds(current=>{
  const rest=current.filter(bond=>!((bond.leftKey===selected.key&&bond.rightKey===otherKey)||(bond.rightKey===selected.key&&bond.leftKey===otherKey)))
  if(!role)return rest
  const count=(key:string)=>current.filter(bond=>bond.leftKey===key||bond.rightKey===key).length
  if(count(selected.key)>=4||count(otherKey)>=4)return current
  return [...rest,{leftKey:selected.key,rightKey:otherKey,leftRole:role,rightRole:FAMILY_ROLE_INVERSE[role]}]
 })
 const historyFor=(otherKey:string)=>historyHooks.find(hook=>hook.participantKeys.length===2&&hook.participantKeys.includes(selected.key)&&hook.participantKeys.includes(otherKey))
 const historyCount=(key:string)=>historyHooks.filter(hook=>hook.participantKeys.includes(key)).length
 const setHistoryKind=(other:OnboardingResidentDraft,kind:SharedHistoryKind|'')=>setHistoryHooks(current=>{
  const existing=historyFor(other.key),rest=current.filter(hook=>hook.id!==existing?.id)
  if(!kind)return rest
  const count=(key:string)=>current.filter(hook=>hook.participantKeys.includes(key)).length
  if(!existing&&(count(selected.key)>=4||count(other.key)>=4))return current
  const id=existing?.id??`history-${Date.now().toString(36)}-${selected.key.slice(-5)}-${other.key.slice(-5)}`
  return [...rest,existing?{...existing,kind}:{id,participantKeys:[selected.key,other.key],kind,summary:copy.historyDefault(selected.profile.name,other.profile.name),tone:'neutral'}]
 })
 const updateHistory=(id:string,change:Partial<Pick<DraftSharedHistoryHook,'summary'|'tone'>>)=>setHistoryHooks(current=>current.map(hook=>hook.id===id?{...hook,...change}:hook))
 const submit=(event:FormEvent)=>{
  event.preventDefault();setAttempted(true)
  if(!valid||saving)return
  const social=buildOnboardingSocialContract(drafts,familyBonds,historyHooks)
  onComplete({residents:drafts.map(draft=>normalizeNpcProfilePolicy({...draft.profile,avatar:{...draft.profile.avatar,strokes:[]}})),...social})
 }
 const invalid=(field:ResidentValidationIssue)=>attempted&&issueFor(selectedIssues,field)
 const fieldMessage=(field:ResidentValidationIssue)=>invalid(field)?<small className="onboarding-field-error">{field==='duplicate-name'?copy.duplicate:copy.required}</small>:null

 return <main className="onboarding-shell">
  <div className="onboarding-atmosphere" aria-hidden><i/><i/><i/><span/><span/></div>
  <header className="onboarding-topbar">
   <strong>LingoLife</strong>
   <div aria-label={`${phase==='intro'?1:phase==='loop'?2:3} / 3`}><i className="is-complete"/><i className={phase!=='intro'?'is-complete':''}/><i className={phase==='residents'?'is-complete':''}/><span>{phase==='intro'?copy.stepIntro:phase==='loop'?copy.stepLoop:copy.stepResidents}</span></div>
  </header>
  <AnimatePresence mode="wait" initial={false}>
   {phase==='intro'?<motion.section className="onboarding-intro" key="intro" initial={reduce?false:{opacity:0,y:16}} animate={{opacity:1,y:0}} exit={reduce?{opacity:0}:{opacity:0,y:-14}} transition={{duration:reduce?0:.42,ease:[.22,.8,.25,1]}}>
    <div className="onboarding-intro__copy"><p>{copy.introEyebrow}</p><h1>{copy.introTitle}</h1><span>{copy.introBody}</span></div>
    <div className="onboarding-role-grid">
     <article><b aria-hidden>◉</b><div><h2>{copy.observer}</h2><p>{copy.observerBody}</p></div></article>
     <article><b aria-hidden>✦</b><div><h2>{copy.manager}</h2><p>{copy.managerBody}</p></div></article>
     <article className="is-home"><b aria-hidden>⌂</b><div><h2>{copy.home}</h2><p>{copy.homeBody}</p></div></article>
    </div>
    {introError&&<strong className="onboarding-field-error" role="alert">{introError}</strong>}
    <motion.button className="onboarding-primary" type="button" disabled={acknowledging} onClick={()=>void beginGuide()} whileHover={reduce?undefined:{y:-2}} whileTap={reduce?undefined:{scale:.98}}>{copy.begin}<span aria-hidden>→</span></motion.button>
   </motion.section>:phase==='loop'?<motion.section className="onboarding-intro onboarding-loop" key="loop" initial={reduce?false:{opacity:0,x:18}} animate={{opacity:1,x:0}} exit={reduce?{opacity:0}:{opacity:0,x:-14}} transition={{duration:reduce?0:.38,ease:[.22,.8,.25,1]}}>
    <div className="onboarding-intro__copy"><p>{copy.loopEyebrow}</p><h1>{copy.loopTitle}</h1><span>{copy.loopBody}</span></div>
    <div className="onboarding-role-grid onboarding-loop-grid">
     <article><b aria-hidden>◉</b><div><h2>{copy.loopObserve}</h2><p>{copy.loopObserveBody}</p></div></article>
     <article><b aria-hidden>↝</b><div><h2>{copy.loopFollow}</h2><p>{copy.loopFollowBody}</p></div></article>
     <article><b aria-hidden>◇</b><div><h2>{copy.loopChoose}</h2><p>{copy.loopChooseBody}</p></div></article>
     <article><b aria-hidden>✦</b><div><h2>{copy.loopTalk}</h2><p>{copy.loopTalkBody}</p></div></article>
    </div>
    <div className="onboarding-intro__actions"><button type="button" onClick={()=>setPhase('intro')}>{copy.loopBack}</button><motion.button className="onboarding-primary" type="button" onClick={()=>setPhase('residents')} whileHover={reduce?undefined:{y:-2}} whileTap={reduce?undefined:{scale:.98}}>{copy.loopBegin}<span aria-hidden>→</span></motion.button></div>
   </motion.section>:<motion.section className="onboarding-setup" key="residents" initial={reduce?false:{opacity:0,x:18}} animate={{opacity:1,x:0}} exit={{opacity:0}} transition={{duration:reduce?0:.38,ease:[.22,.8,.25,1]}}>
    <header className="onboarding-setup__heading"><div><p>{copy.setupEyebrow}</p><h1>{copy.setupTitle}</h1><span>{copy.setupBody}</span></div><button type="button" onClick={rerollAll}>↻ {copy.randomAll}</button></header>
    <aside className="onboarding-home-banner"><span aria-hidden>⌂</span><div><strong>{copy.sharedTitle}</strong><p>{copy.sharedBody}</p></div></aside>
    <div className="onboarding-workspace">
     <aside className="onboarding-roster">
      <header><strong>{copy.roster}</strong><span>{copy.residentCount(drafts.length,safeMaximum)}</span></header>
      <div>{drafts.map((draft,index)=>{
       const draftIssues=issues[draft.key]??[],hasIssue=attempted&&draftIssues.length>0
       return <button type="button" className={`${draft.key===selected.key?'is-selected':''} ${hasIssue?'has-error':''}`} onClick={()=>setSelectedKey(draft.key)} key={draft.key}><i style={{background:draft.profile.avatar.hairColor}}>{index+1}</i><span><b>{draft.profile.name||copy.required}</b><small>{draft.profile.occupation||copy.required}</small></span><em aria-hidden>{hasIssue?'!':'›'}</em></button>
      })}</div>
      <button className="onboarding-add" type="button" disabled={drafts.length>=safeMaximum} onClick={addResident}>＋ {copy.add}</button>
      <small>{drafts.length>=safeMaximum?copy.max:copy.min(safeMinimum)}</small>
     </aside>
     <section className="onboarding-resident">
      <div className="onboarding-preview">
       <CharacterCanvas3D key={`${selected.key}:${selected.profile.avatar.model}`} avatar={selected.profile.avatar} animation="idle" view="full" name={selected.profile.name||'Resident'}/>
       <div><span>⌂ {copy.residentHome}</span><strong>{selected.profile.name||copy.required}</strong><small>{selected.profile.relationship} · {selected.profile.occupation}</small></div>
      </div>
      <form className="onboarding-editor" onSubmit={submit} noValidate>
       <div className="onboarding-editor__actions"><button type="button" onClick={rerollSelected}>↻ {copy.reroll}</button><button type="button" disabled={drafts.length<=safeMinimum} onClick={removeResident}>− {copy.remove}</button></div>
       <div className="onboarding-field-grid">
        <label className={invalid('name')||invalid('duplicate-name')?'has-error':''}>{copy.name}<input maxLength={24} value={selected.profile.name} onChange={event=>setField('name',event.target.value.replace(/[^\p{L}\p{N} _'-]/gu,''))}/>{fieldMessage(invalid('duplicate-name')?'duplicate-name':'name')}</label>
        <label className={invalid('age')?'has-error':''}>{copy.age}<input type="number" min={16} max={100} value={selected.profile.age??''} onChange={event=>updateProfile(profile=>withProfileAge(profile,event.target.value?Math.max(16,Math.min(100,Number(event.target.value))):null))}/>{fieldMessage('age')}</label>
        <label className={invalid('relationship')?'has-error':''}>{copy.relationship}<input maxLength={32} value={selected.profile.relationship} onChange={event=>setField('relationship',event.target.value)}/>{fieldMessage('relationship')}</label>
        <label className={invalid('occupation')?'has-error':''}>{copy.occupation}<input maxLength={48} value={selected.profile.occupation} onChange={event=>setField('occupation',event.target.value)}/>{fieldMessage('occupation')}</label>
       </div>
       <label className={invalid('personality')?'has-error':''}>{copy.personality}<small>{copy.personalityHint}</small><input maxLength={120} value={selected.profile.personality.join(', ')} onChange={event=>setField('personality',split(event.target.value,4))}/>{fieldMessage('personality')}</label>
       <label className={invalid('interests')?'has-error':''}>{copy.interests}<small>{copy.interestsHint}</small><input maxLength={160} value={selected.profile.interests.join(', ')} onChange={event=>setField('interests',split(event.target.value,5))}/>{fieldMessage('interests')}</label>
       <div className="onboarding-contract-grid">
        <label className={invalid('likes')?'has-error':''}>{copy.likes}<small>{copy.listHint}</small><input maxLength={240} value={selected.profile.likes.join(', ')} onChange={event=>setField('likes',split(event.target.value,6))}/>{fieldMessage('likes')}</label>
        <label className={invalid('dislikes')?'has-error':''}>{copy.dislikes}<small>{copy.listHint}</small><input maxLength={240} value={selected.profile.dislikes.join(', ')} onChange={event=>setField('dislikes',split(event.target.value,6))}/>{fieldMessage('dislikes')}</label>
        <label className={invalid('quirks')?'has-error':''}>{copy.quirks}<small>{copy.listHint}</small><input maxLength={240} value={selected.profile.quirks.join(', ')} onChange={event=>setField('quirks',split(event.target.value,4))}/>{fieldMessage('quirks')}</label>
        <label className={invalid('habits')?'has-error':''}>{copy.habits}<small>{copy.listHint}</small><input maxLength={240} value={selected.profile.habits.join(', ')} onChange={event=>setField('habits',split(event.target.value,4))}/>{fieldMessage('habits')}</label>
       </div>
       <label className={invalid('boundaries')?'has-error':''}>{copy.boundaries}<small>{copy.listHint}</small><input maxLength={360} value={selected.profile.boundaries.join(', ')} onChange={event=>setField('boundaries',split(event.target.value,8))}/>{fieldMessage('boundaries')}</label>
       <div className="onboarding-field-grid">
        <label>{copy.householdRole}<select value={selected.profile.householdRole} onChange={event=>setField('householdRole',event.target.value as NpcProfile['householdRole'])}>{Object.entries(copy.roles).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
        <label>{copy.privateSpace}<select value={selected.profile.privateSpacePreference} onChange={event=>setField('privateSpacePreference',event.target.value as NpcProfile['privateSpacePreference'])}>{Object.entries(copy.privacy).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
       </div>
       <fieldset className={invalid('chores')?'has-error':''}><legend>{copy.chores}</legend><div className="onboarding-chore-options">{(Object.entries(copy.choreNames) as [NpcProfile['chorePreferences'][number],string][]).map(([value,label])=><button type="button" className={selected.profile.chorePreferences.includes(value)?'is-selected':''} aria-pressed={selected.profile.chorePreferences.includes(value)} onClick={()=>toggleChore(value)} key={value}>{selected.profile.chorePreferences.includes(value)?'✓ ':'＋ '}{label}</button>)}</div>{fieldMessage('chores')}</fieldset>
       <label className={invalid('goal')?'has-error':''}>{copy.goal}<textarea rows={3} maxLength={180} value={selected.profile.longTermGoal} onChange={event=>setField('longTermGoal',event.target.value)}/>{fieldMessage('goal')}</label>
       <fieldset className="onboarding-social-contract"><legend>{copy.familyTitle}</legend><p>{copy.familyHint}</p><div className="onboarding-social-contract__rows">{otherDrafts.map(other=>{const currentRole=familyRoleFor(other.key),atLimit=!currentRole&&(familyCount(selected.key)>=4||familyCount(other.key)>=4);return <label key={other.key}><span>{other.profile.name}</span><select value={currentRole} disabled={atLimit} onChange={event=>setFamilyRole(other.key,event.target.value as FamilyRole|'')}><option value="">{copy.notFamily}</option>{(Object.entries(copy.familyRoles) as [FamilyRole,string][]).map(([role,label])=><option value={role} key={role}>{label}</option>)}</select></label>})}</div></fieldset>
       <fieldset className={`onboarding-social-contract ${attempted&&!socialValid?'has-error':''}`}><legend>{copy.historyTitle}</legend><p>{copy.historyHint}</p><div className="onboarding-history-list">{otherDrafts.map(other=>{const hook=historyFor(other.key),atLimit=!hook&&(historyCount(selected.key)>=4||historyCount(other.key)>=4);return <section key={other.key}><label><span>{other.profile.name}</span><select value={hook?.kind??''} disabled={atLimit} onChange={event=>setHistoryKind(other,event.target.value as SharedHistoryKind|'')}><option value="">{copy.noHistory}</option>{(Object.entries(copy.historyKinds) as [SharedHistoryKind,string][]).map(([kind,label])=><option value={kind} key={kind}>{label}</option>)}</select></label>{hook&&<div><label>{copy.historySummary}<input maxLength={180} value={hook.summary} onChange={event=>updateHistory(hook.id,{summary:event.target.value})}/></label><label><span className="onboarding-visually-hidden">Tone</span><select value={hook.tone} onChange={event=>updateHistory(hook.id,{tone:event.target.value as SharedHistoryTone})}>{(Object.entries(copy.historyTones) as [SharedHistoryTone,string][]).map(([tone,label])=><option value={tone} key={tone}>{label}</option>)}</select></label></div>}</section>})}</div></fieldset>
       <fieldset><legend>{copy.appearance}</legend><label>{copy.model}<select value={selected.profile.avatar.model} onChange={event=>setField('avatar',{...selected.profile.avatar,model:event.target.value,strokes:[]})}>{CHARACTER_PRESETS.map(preset=><option value={preset.id} key={preset.id}>{preset.label[language]}</option>)}</select></label></fieldset>
       <label className="onboarding-romance"><input type="checkbox" checked={Boolean(selected.profile.romanceEnabled)} disabled={(selected.profile.age??0)<18} onChange={event=>updateProfile(profile=>withRomancePreference(profile,event.target.checked))}/><span><b>{copy.romance}</b><small>{copy.romanceHint}</small></span></label>
       <footer>
        <div>{attempted&&!valid&&<strong role="alert">{copy.invalid}</strong>}{error&&<strong role="alert">{error}</strong>}<small className={difference.valid?'is-valid':'is-warning'}>{difference.valid?'✓ ':''}{difference.valid?copy.differenceGood:copy.differenceBad}</small><small>{copy.savedHint}</small></div>
        <button type="button" onClick={()=>setPhase('loop')}>{copy.back}</button>
        <motion.button className="onboarding-primary" type="submit" disabled={saving} whileTap={reduce?undefined:{scale:.98}}>{saving?copy.entering:copy.enter}<span aria-hidden>→</span></motion.button>
       </footer>
      </form>
     </section>
    </div>
   </motion.section>}
  </AnimatePresence>
 </main>
}

export default OnboardingFlow
