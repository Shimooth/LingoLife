import {type FormEvent,type KeyboardEvent,useEffect,useRef,useState} from 'react'
import {AnimatePresence,motion,useReducedMotion} from 'motion/react'
import {ApiError,api,session} from './api'
import {defaultAvatar} from './avatar'
import {CharacterStudio} from './components/CharacterStudio'
import {EventCard} from './components/EventCard'
import {LearningPanel} from './components/LearningPanel'
import {StatBar} from './components/StatBar'
import type {CityCharacter,CityLandmark} from './components/CityMap'
import {SettingsPanel} from './components/SettingsPanel'
import {ConversationScene,type LiveSpeech} from './components/ConversationScene'
import {AgentPanel} from './components/AgentPanel'
import {VoiceControls} from './components/VoiceControls'
import {SocialStoryPanel} from './components/SocialStoryPanel'
import {SocialEventEncounter} from './components/SocialEventEncounter'
import {HouseholdInspector} from './components/HouseholdInspector'
import {LifeStoryEncounter} from './components/LifeStoryEncounter'
import {MomentToast} from './components/MomentToast'
import {StoryThreadsPanel} from './components/StoryThreadsPanel'
import {ConversationStage3D} from './three/characters'
import {WorldObserver3D} from './three/world'
import {LocationInspector} from './components/LocationInspector'
import {useLanguage} from './i18n'
import {useExperienceSettings} from './experienceSettings'
import {getLocationAsset,locationCopy} from './locationAssets'
import {lifeActionWorldPresentation,lifeStoryIsPresentable,lifeStoryViewIncludesBaseline,normalizeResidentAction,useWorldSimulation,type NormalizedResidentAction} from './life'
import {normalizeNpcProfilePolicy} from './profilePolicy'
import './ConversationRefinements.css'
import './ExperienceTransitions.css'
import './components/VoiceControls.css'
import './components/LocationInspector.css'
import './ThreeIntegration.css'
import type {ActiveEvent,AgentMemory,AgentState,AnimationCue,City,CityResident,EventUpdate,Feedback,Household,LearningProgress,LifeStory,Message,Mood,NpcEntry,NpcProfile,Quota,ResidentWorldAction,Room,SocialInteraction,Stats,User} from './types'
type Pending={message:string;key:string}
const initialProfile:NpcProfile={name:'Emma',age:25,relationship:'Friend',personality:['kind','thoughtful','quiet'],interests:['art','music','photography'],occupation:'Designer',longTermGoal:'Open a small independent design studio.',familyIds:[],householdWithIds:[],avatar:defaultAvatar}
const synchronizedWorldAction=(resident:CityResident,activeEvent:ActiveEvent|null|undefined=resident.active_event,clearMissing=false):ResidentWorldAction=>{
 const action=resident.world_action
 if(action?.state==='walking_to_event'||action?.state==='waiting_at_event')return action
 if(activeEvent){
  if(action?.state==='event_pending'&&action.event_id===activeEvent.id)return {...action,target_location_id:resident.current_location_id}
  const stageCue=activeEvent.stage.animation_cue
  const mapCue=stageCue&&stageCue!=='talk'&&stageCue!=='listen'?stageCue:resident.animation_cue
  return {state:'event_pending',event_id:activeEvent.id,target_location_id:resident.current_location_id,...(mapCue?{animation_cue:mapCue}:{})}
 }
 if(clearMissing&&action?.state==='event_pending')return {state:'idle'}
 return action||{state:'idle'}
}
const displayedWorldAction=(resident:CityResident,action:NormalizedResidentAction|null,activeEvent:ActiveEvent|null|undefined=resident.active_event,clearMissing=false):ResidentWorldAction=>{
 if(action?.source==='life')return lifeActionWorldPresentation(action)
 if(Object.prototype.hasOwnProperty.call(resident,'current_action')&&!action)return synchronizedWorldAction({...resident,world_action:undefined},activeEvent,clearMissing)
 return synchronizedWorldAction(resident,activeEvent,clearMissing)
}
const lifeStoryInCity=(snapshot:City|null,id:string)=>[...(snapshot?.open_incidents||[]),...(snapshot?.story_threads||[]),...(snapshot?.observable_moments||[])].find(story=>story.id===id)
const initialChromeCollapsed=()=>{
 try{
  const saved=localStorage.getItem('lingolife.topbar-collapsed')
  return saved===null?window.matchMedia('(max-width: 779px)').matches:saved==='1'
 }catch{return false}
}

function TopBarToggle({collapsed,language,controls,attention=false,onToggle}:{collapsed:boolean;language:'zh'|'en';controls:string;attention?:boolean;onToggle:()=>void}){
 const label=language==='zh'?(collapsed?'展开顶部栏':'收起顶部栏'):(collapsed?'Expand top bar':'Collapse top bar')
 return <button className={`topbar-toggle ${collapsed&&attention?'has-attention':''}`} type="button" aria-expanded={!collapsed} aria-controls={controls} aria-label={label} title={label} onClick={onToggle}><span aria-hidden>{collapsed?'⌄':'⌃'}</span><b>{language==='zh'?(collapsed?'展开':'收起'):(collapsed?'Expand':'Collapse')}</b>{collapsed&&attention&&<i aria-hidden/>}</button>
}

export default function App({user,initialQuota,onLogout}:{user:User;initialQuota:Quota;onLogout:()=>void}){
 const {language,t}=useLanguage(),zh=language==='zh'
 const experience=useExperienceSettings()
 const reduce=useReducedMotion(),[stats,setStats]=useState<Stats|null>(null),[mood,setMood]=useState<Mood>('sad'),[animationCue,setAnimationCue]=useState<AnimationCue>('sad'),[messages,setMessages]=useState<Message[]>([]),[feedback,setFeedback]=useState<Feedback|null>(null),[text,setText]=useState(''),[busy,setBusy]=useState(false),[ready,setReady]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState<Pending|null>(null)
 const [quota,setQuota]=useState(initialQuota)
 const [profile,setProfile]=useState<NpcProfile>(initialProfile),[studio,setStudio]=useState(false),[savingProfile,setSavingProfile]=useState(false),[profileError,setProfileError]=useState('')
 const [npcs,setNpcs]=useState<NpcEntry[]>([]),[npcId,setNpcId]=useState(localStorage.getItem('lingolife.npc-id')||'emma'),[creating,setCreating]=useState(false)
 const [city,setCity]=useState<City|null>(null),[worldSeed,setWorldSeed]=useState<City|null>(null),[view,setView]=useState<'city'|'chat'>('city'),[settingsOpen,setSettingsOpen]=useState(false),[socialOpen,setSocialOpen]=useState(false),[storiesOpen,setStoriesOpen]=useState(false),[focusedLocationId,setFocusedLocationId]=useState<string>()
 const [followedCharacterId,setFollowedCharacterId]=useState<string>(),[socialEventId,setSocialEventId]=useState<string>(),[selectedLifeStory,setSelectedLifeStory]=useState<LifeStory>()
 const [dismissedMomentIds,setDismissedMomentIds]=useState<string[]>([]),[householdId,setHouseholdId]=useState<string>(),[householdDetail,setHouseholdDetail]=useState<Household|null>(null)
 const [historyOpen,setHistoryOpen]=useState(false),[sceneryOpen,setSceneryOpen]=useState(false),[archivedCount,setArchivedCount]=useState(0),[liveSpeech,setLiveSpeech]=useState<LiveSpeech|null>(null)
 const [hasPassword,setHasPassword]=useState(Boolean(user.has_password))
 const [activeEvent,setActiveEvent]=useState<ActiveEvent|null>(null),[eventUpdate,setEventUpdate]=useState<EventUpdate|null>(null),[learning,setLearning]=useState<LearningProgress|null>(null),[learningOpen,setLearningOpen]=useState(false)
 const [agent,setAgent]=useState<AgentState|null>(null),[agentOpen,setAgentOpen]=useState(false)
 const [showOlder,setShowOlder]=useState(false)
 const [chromeCollapsed,setChromeCollapsed]=useState(initialChromeCollapsed)
 const turnRef=useRef(0),speechKeyRef=useRef(0),streamTextRef=useRef(''),appliedWorldRef=useRef<City|null>(null),selectedLifeStoryMutationRef=useRef<LifeStory|undefined>(undefined)
 const worldSimulation=useWorldSimulation({enabled:Boolean(worldSeed),initialSnapshot:worldSeed})
 const refreshWorld=worldSimulation.refresh
 useEffect(()=>{const snapshot=worldSimulation.rawSnapshot;if(!snapshot||snapshot===worldSeed||snapshot===appliedWorldRef.current)return;appliedWorldRef.current=snapshot;setCity(snapshot)},[worldSeed,worldSimulation.rawSnapshot])
 const resetSpeech=()=>{turnRef.current+=1;streamTextRef.current='';setLiveSpeech(null)}
 const showOpening=(room:Room)=>{const previous=[...room.messages].reverse().find(message=>message.speaker==='npc'&&message.text.trim()),event=room.active_event,stage=event?.stage,hasPersistedTurn=room.messages.some(message=>message.speaker==='player'),eventHasStarted=Boolean(event&&((event.stage_turns??(hasPersistedTurn?1:0))>0||event.stage_index>0)),opening=previous&&(!stage||eventHasStarted)?previous:stage?{text:stage.prompt,translation:stage.translation}:previous;if(!opening?.text)return;turnRef.current+=1;const key=++speechKeyRef.current;setLiveSpeech({key,speaker:'npc',text:opening.text,translation:opening.translation})}
 const fail=(cause:unknown,fallback:string)=>{if(cause instanceof ApiError&&(cause.status===401||cause.status===403)){session.clear();onLogout();return}if(cause instanceof ApiError&&cause.code==='RATE_LIMITED')setError(t('chat.rateLimited'));else if(cause instanceof ApiError&&cause.status===429)setError(t('chat.quotaReached'));else setError(fallback)}
 const loadNpc=async(id:string,entries?:NpcEntry[])=>{
  resetSpeech();setHistoryOpen(false);setSceneryOpen(false);setAgentOpen(false);setError('');setReady(false);setShowOlder(false)
  try{
   const list=entries||npcs,chosen=list.find(x=>x.id===id)||list[0]
   if(!chosen)throw new Error('No character')
   const room=await api.room(chosen.id)
   setNpcId(chosen.id);localStorage.setItem('lingolife.npc-id',chosen.id);setProfile(chosen.profile);setStats(room.stats);setMood(room.npc.animation);setAnimationCue(room.npc.animation_cue??room.npc.animation);setMessages(room.messages);setArchivedCount(room.messages.length);setActiveEvent(room.active_event||null);setEventUpdate(null);setFeedback(null);setAgent(room.agent||null)
   setCity(current=>current?{...current,npcs:current.npcs.map(resident=>resident.id===chosen.id?{...resident,active_event:room.active_event||undefined,world_action:synchronizedWorldAction(resident,room.active_event,true)}:resident)}:current)
   if(room.quota)setQuota(room.quota)
   setReady(true)
   return room
  }catch(cause){fail(cause,zh?'无法打开房间，请检查网络后重试。':"Couldn't open the room. Check your connection and try again.");return null}
 }
 const load=async()=>{try{const [data,cityData]=await Promise.all([api.npcs(),api.city()]);setNpcs(data.npcs);setCity(cityData);setWorldSeed(cityData);const id=data.npcs.some(x=>x.id===npcId)?npcId:data.npcs[0]?.id||'emma';await loadNpc(id,data.npcs);void api.learningProfile().then(setLearning).catch(()=>undefined)}catch(cause){fail(cause,t('character.loadError'))}}
 // The room is loaded once per authenticated mount; retries call load explicitly.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 useEffect(()=>{void load()},[])
 useEffect(()=>{try{localStorage.setItem('lingolife.topbar-collapsed',chromeCollapsed?'1':'0')}catch{/* storage is optional */}},[chromeCollapsed])
 const send=async(request:Pending,npcBase:number,turn:number)=>{let npcSpeechKey:number|undefined;const revealReply=(reply:string,streaming:boolean,translation?:string)=>{if(turnRef.current!==turn)return;npcSpeechKey??=++speechKeyRef.current;setLiveSpeech({key:npcSpeechKey,speaker:'npc',text:reply,translation,streaming})};setBusy(true);setError('');setMessages(old=>[...old,{speaker:'npc',text:''}]);try{const result=await api.chatStream(request.message,request.key,npcId,chunk=>{streamTextRef.current+=chunk;setMessages(old=>old.map((item,index)=>index===old.length-1&&item.speaker==='npc'?{...item,text:item.text+chunk}:item));setArchivedCount(npcBase);revealReply(streamTextRef.current,true)});streamTextRef.current=result.npc_reply;setMessages(old=>old.map((item,index)=>index===old.length-1&&item.speaker==='npc'?{...item,text:result.npc_reply,translation:result.npc_reply_zh}:item));setStats(result.stats);setMood(result.animation);setAnimationCue(result.animation_cue??result.animation);setCity(current=>current?{...current,npcs:current.npcs.map(resident=>{if(resident.id!==npcId)return resident;const nextActive='active_event'in result?result.active_event??undefined:resident.active_event;return {...resident,animation_cue:result.animation_cue??result.animation,active_event:nextActive,world_action:synchronizedWorldAction(resident,nextActive,'active_event'in result)}})}:current);setFeedback(result.english_feedback);if(result.quota)setQuota(result.quota);if(result.event_update)setEventUpdate(result.event_update);if('active_event'in result)setActiveEvent(result.active_event||null);if(result.learning_summary)setLearning(result.learning_summary);const nextAgent=result.agent;if(nextAgent)setAgent(old=>({...nextAgent,memories:old?.memories}));setPending(null);setText('');setArchivedCount(npcBase);revealReply(result.npc_reply,false,result.npc_reply_zh);void refreshWorld('mutation')}catch(cause){setMessages(old=>old.slice(0,-1));setArchivedCount(npcBase);if(turnRef.current===turn){turnRef.current+=1;setLiveSpeech(null)}fail(cause,zh?'回复中断了，你的消息仍保留着，请重试。':'The reply was interrupted. Your message is safe — try again.')}finally{setBusy(false)}}
 const submit=(event:FormEvent)=>{event.preventDefault();const message=text.trim();if(!message||busy||pending||!ready)return;const request={message,key:api.key()},turn=++turnRef.current,npcBase=messages.length+1;streamTextRef.current='';speechKeyRef.current+=1;setPending(request);setHistoryOpen(false);setSceneryOpen(false);setEventUpdate(null);setArchivedCount(messages.length);setLiveSpeech({key:speechKeyRef.current,speaker:'player',text:message});setMessages(old=>[...old,{speaker:'player',text:message}]);void send(request,npcBase,turn)}
 const retryPending=()=>{if(!pending)return;const turn=++turnRef.current;streamTextRef.current='';speechKeyRef.current+=1;setArchivedCount(messages.length);void send(pending,messages.length,turn)}
 const keyDown=(event:KeyboardEvent<HTMLTextAreaElement>)=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();event.currentTarget.form?.requestSubmit()}}
 const saveProfile=async()=>{setSavingProfile(true);setProfileError('');const wasCreating=creating;try{const explicitProfile=normalizeNpcProfilePolicy({...profile,avatar:{...profile.avatar,strokes:[]}},creating?undefined:npcId);const saved=creating?await api.createNpc(explicitProfile):await api.saveNpc(npcId,explicitProfile);const data=await api.npcs();setNpcs(data.npcs);await refreshWorld('mutation');setCreating(false);setStudio(false);await loadNpc(saved.id,data.npcs);if(wasCreating)setView('city')}catch(cause){setProfileError(cause instanceof ApiError&&cause.code==='NPC_LIMIT_REACHED'?t('character.limit'):t('character.saveError'))}finally{setSavingProfile(false)}}
 const beginCreate=()=>{setCreating(true);setProfile({...initialProfile,name:t('character.newName'),avatar:{...defaultAvatar,strokes:[]}});setStudio(true)}
 const openAgent=async()=>{setAgentOpen(true);try{setAgent(await api.npcAgent(npcId))}catch{setError(zh?'无法读取角色生活档案。':'Could not load the character profile.')}}
 const deleteMemory=async(memory:AgentMemory)=>{try{await api.deleteNpcMemory(npcId,memory.id);setAgent(value=>value?{...value,memories:(value.memories||[]).filter(item=>item.id!==memory.id)}:value)}catch{setError(zh?'无法删除这条记忆。':'Could not delete this memory.')}}
 const cityCharacters:CityCharacter[]=(city?.npcs||[]).map(resident=>{const location=city?.locations.find(item=>item.id===resident.current_location_id),resource=getLocationAsset(location?.id,location?.kind),lifeAction=normalizeResidentAction(resident),worldAction=displayedWorldAction(resident,lifeAction);return {id:resident.id,name:resident.name,avatar:resident.avatar,animationCue:worldAction.animation_cue??resident.animation_cue,worldAction,lifeAction,visibleIntent:resident.visible_intent,visibleIntentZh:resident.visible_intent_zh,troubleSignal:resident.trouble_signal,householdId:resident.household_id,home:{x:resident.home.x*1200/(city?.map.width||1600),y:resident.home.y*760/(city?.map.height||1000)},locationId:resident.is_home?undefined:location?.id,location:{x:resident.position.x*1200/(city?.map.width||1600),y:resident.position.y*760/(city?.map.height||1000),place:resident.is_home?t('map.location.home'):(location?locationCopy(resource,language).name:t('map.currentLocation'))}}})
 const cityLandmarks:CityLandmark[]=(city?.locations||[]).map(location=>{const resource=getLocationAsset(location.id,location.kind);return {id:location.id,name:locationCopy(resource,language).name,kind:location.kind,district:location.district,x:location.x*1200/(city?.map.width||1600),y:location.y*760/(city?.map.height||1000)}})
 const focusedLandmark=cityLandmarks.find(item=>item.id===focusedLocationId)||null
 const focusedCityLocation=city?.locations.find(item=>item.id===focusedLocationId)
 const focusedAsset=focusedCityLocation?getLocationAsset(focusedCityLocation.id,focusedCityLocation.kind):null
 const focusedResidents=(city?.npcs||[]).filter(item=>item.current_location_id===focusedLocationId).map(item=>({id:item.id,name:item.name}))
 const hasLifeStories=Boolean(city?.observable_moments?.length||city?.story_threads?.length||city?.open_incidents?.length||city?.relationships?.length)
 const cityNeedsAttention=Boolean(city?.npcs.some(resident=>resident.trouble_signal)||city?.open_incidents?.length||city?.social_interactions?.some(item=>item.status==='traveling'||item.status==='awaiting_observation'||item.status==='awaiting_management'))
 const selectedSocialEvent=city?.social_interactions?.find(event=>event.id===socialEventId)
 const socialEventLocation=selectedSocialEvent&&city?.locations.find(location=>location.id===selectedSocialEvent.location_id)
 const openChat=async(id:string)=>{const room=await loadNpc(id);if(!room)return;setFollowedCharacterId(id);setSocialEventId(undefined);setChromeCollapsed(true);setView('chat');showOpening(room)}
 const focusSocialEvent=(event:SocialInteraction)=>{setSocialOpen(false);setSocialEventId(event.id);if(event.status==='traveling'){setFocusedLocationId(undefined);setFollowedCharacterId(event.participant_ids[0])}else{setFollowedCharacterId(undefined);setFocusedLocationId(event.location_id)}}
 const focusLifeStory=(story:LifeStory)=>{selectedLifeStoryMutationRef.current=undefined;setStoriesOpen(false);setSocialOpen(false);setSocialEventId(undefined);setSelectedLifeStory(story);setView('city');if(story.location_id){setFollowedCharacterId(undefined);setFocusedLocationId(story.location_id)}else if(story.participant_ids[0]){setFocusedLocationId(undefined);setFollowedCharacterId(story.participant_ids[0])}if(story.level==='moment')setDismissedMomentIds(ids=>[...ids.filter(id=>id!==story.id),story.id].slice(-30))}
 const openCityStories=()=>{if(hasLifeStories)setStoriesOpen(true);else setSocialOpen(true)}
 const openTrouble=(residentId:string)=>{const resident=city?.npcs.find(item=>item.id===residentId),storyId=resident?.trouble_signal?.story_id,story=[...(city?.open_incidents||[]),...(city?.story_threads||[]),...(city?.observable_moments||[])].find(item=>item.id===storyId);if(story)void focusLifeStory(story);else openCityStories()}
 const openHousehold=async(id:string)=>{const embedded=city?.households?.find(item=>item.id===id);setHouseholdId(id);setHouseholdDetail(embedded??null);if(embedded)return;try{setHouseholdDetail(await api.household(id))}catch(cause){setHouseholdId(undefined);fail(cause,zh?'暂时无法打开这所住宅。':'This household is unavailable right now.')}}
 const returnToCity=async()=>{resetSpeech();setHistoryOpen(false);setView('city');await refreshWorld('mutation')}
 const currentMoment=city?.observable_moments?.find(moment=>lifeStoryIsPresentable(moment,worldSimulation.getServerNow())&&!dismissedMomentIds.includes(moment.id))
 const selectedLifeStoryId=selectedLifeStory?.id
 useEffect(()=>{
  if(!selectedLifeStoryId){selectedLifeStoryMutationRef.current=undefined;return}
  let cancelled=false
  const commit=(candidate:LifeStory|undefined)=>{
   if(!candidate||candidate.id!==selectedLifeStoryId||cancelled)return false
   const baseline=selectedLifeStoryMutationRef.current
   if(baseline?.id===selectedLifeStoryId&&!lifeStoryViewIncludesBaseline(candidate,baseline))return false
   if(baseline?.id===selectedLifeStoryId)selectedLifeStoryMutationRef.current=undefined
   setSelectedLifeStory(current=>current?.id===selectedLifeStoryId?candidate:current)
   return true
  }
  const embedded=lifeStoryInCity(city,selectedLifeStoryId)
  if(!embedded||!commit(embedded))void api.lifeStories().then(response=>commit(response.stories.find(story=>story.id===selectedLifeStoryId))).catch(()=>undefined)
  return()=>{cancelled=true}
 },[city,selectedLifeStoryId])
 const selectedHousehold=householdId?(city?.households?.find(item=>item.id===householdId)??(householdDetail?.id===householdId?householdDetail:null)):null
 const residentNames=Object.fromEntries((city?.npcs||[]).map(resident=>[resident.id,resident.name]))
 const currentResident=city?.npcs.find(resident=>resident.id===npcId),currentLocation=city?.locations.find(location=>location.id===currentResident?.current_location_id)
 const currentLocationAsset=getLocationAsset(currentResident?.is_home?'home':currentLocation?.id,currentLocation?.kind,npcId,profile.avatar.homeBackground)
 const currentPlace=currentResident?.is_home?t('map.home',{name:profile.name}):(currentLocation?locationCopy(currentLocationAsset,language).name:t('map.currentLocation'))
 const conversationPerformance=eventUpdate?.outcome?.performance??eventUpdate?.performance??activeEvent?.stage.performance
 const conversationPerformanceKey=`${activeEvent?.id??'resolved'}:${activeEvent?.stage.id??'outcome'}:${activeEvent?.stage_index??'done'}:${eventUpdate?.completed?'complete':eventUpdate?.stage_changed?'advanced':'steady'}:${liveSpeech?.key??'opening'}`
 const participantAvatars=Object.fromEntries((city?.npcs||[]).map(resident=>[resident.id,resident.avatar]))
 const lifeStoryLocation=selectedLifeStory&&city?.locations.find(location=>location.id===selectedLifeStory.location_id)
 const lifeStoryResident=selectedLifeStory&&city?.npcs.find(resident=>selectedLifeStory.participant_ids.includes(resident.id))
 const lifeStoryAsset=selectedLifeStory?(lifeStoryLocation?getLocationAsset(lifeStoryLocation.id,lifeStoryLocation.kind):getLocationAsset('home',undefined,lifeStoryResident?.id,lifeStoryResident?.avatar.homeBackground)):undefined
 const lifeStoryLocationName=selectedLifeStory?(lifeStoryLocation?locationCopy(lifeStoryAsset!,language).name:(selectedLifeStory.household_id?(zh?'居民住宅':'Resident home'):selectedLifeStory.location_id)):undefined
 const isToday=(value?:string)=>{if(!value)return true;const parsed=new Date(value.includes('T')?value:`${value.replace(' ','T')}Z`),now=new Date();return parsed.getFullYear()===now.getFullYear()&&parsed.getMonth()===now.getMonth()&&parsed.getDate()===now.getDate()}
 const archivedMessages=messages.slice(0,Math.min(archivedCount,messages.length)),olderCount=archivedMessages.filter(message=>!isToday(message.created_at)).length,visibleMessages=showOlder?archivedMessages:archivedMessages.filter(message=>isToday(message.created_at))
 const overlays=<AnimatePresence>
  {studio&&<motion.div key="studio" className="experience-overlay-layer" initial={reduce?false:{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}><CharacterStudio language={language} profile={profile} relationshipCandidates={npcs.map(entry=>({id:entry.id,name:entry.profile.name}))} editingNpcId={creating?undefined:npcId} onChange={setProfile} onSave={()=>void saveProfile()} onClose={()=>{setStudio(false);if(creating){setCreating(false);const current=npcs.find(x=>x.id===npcId);if(current)setProfile(current.profile)}}} saving={savingProfile} error={profileError}/></motion.div>}
  {learningOpen&&<motion.div key="learning" className="experience-overlay-layer" initial={reduce?false:{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}><LearningPanel progress={learning} onClose={()=>setLearningOpen(false)}/></motion.div>}
  {settingsOpen&&<motion.div key="settings" className="experience-overlay-layer" initial={reduce?false:{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}><SettingsPanel hasPassword={hasPassword} onPasswordSet={()=>setHasPassword(true)} onClose={()=>setSettingsOpen(false)}/></motion.div>}
  {storiesOpen&&<StoryThreadsPanel key="life-stories" moments={city?.observable_moments||[]} threads={city?.story_threads||[]} incidents={city?.open_incidents||[]} relationships={city?.relationships||[]} residentNames={residentNames} legacyCount={city?.social_interactions?.length||0} language={language} onClose={()=>setStoriesOpen(false)} onSelect={focusLifeStory} onOpenLegacy={()=>{setStoriesOpen(false);setSocialOpen(true)}}/>}
  {socialOpen&&<SocialStoryPanel key="social" events={city?.social_interactions||[]} language={language} onClose={()=>setSocialOpen(false)} onFocus={focusSocialEvent} onIntervene={async(event,action)=>{await api.interveneSocial(event.id,action);await refreshWorld('mutation')}}/>}
  {selectedSocialEvent&&<SocialEventEncounter key="social-event" event={selectedSocialEvent} locationName={socialEventLocation?locationCopy(getLocationAsset(socialEventLocation.id,socialEventLocation.kind),language).name:undefined} locationImage={socialEventLocation?getLocationAsset(socialEventLocation.id,socialEventLocation.kind).image:undefined} participantAvatars={participantAvatars} language={language} onClose={()=>setSocialEventId(undefined)} onObserve={async event=>{const result=await api.observeSocial(event.id);await refreshWorld('mutation');return result}} onIntervene={async(event,action)=>{const result=await api.interveneSocial(event.id,action);await refreshWorld('mutation');return result}}/>}
  {selectedLifeStory&&<LifeStoryEncounter key={`life-story:${selectedLifeStory.id}`} story={selectedLifeStory} locationName={lifeStoryLocationName} locationImage={lifeStoryAsset?.image} participantAvatars={participantAvatars} language={language} onClose={()=>{selectedLifeStoryMutationRef.current=undefined;setSelectedLifeStory(undefined)}} onObserve={async story=>{const result=await api.observeLifeStory(story.id);selectedLifeStoryMutationRef.current=result;setSelectedLifeStory(current=>current?.id===result.id?result:current);await refreshWorld('mutation');return result}} onIntervene={async(story,action)=>{const result=await api.interveneLifeStory(story.id,action,api.key());selectedLifeStoryMutationRef.current=result;setSelectedLifeStory(current=>current?.id===result.id?result:current);await refreshWorld('mutation');return result}}/>}
  {householdId&&<HouseholdInspector key="household" household={selectedHousehold} language={language} residentNames={residentNames} onClose={()=>{setHouseholdId(undefined);setHouseholdDetail(null)}} onMemberSelect={id=>{setHouseholdId(undefined);setFollowedCharacterId(id);setFocusedLocationId(undefined);setView('city')}}/>}
  {agentOpen&&<AgentPanel key="agent" name={profile.name} agent={agent} onClose={()=>setAgentOpen(false)} onDeleteMemory={memory=>void deleteMemory(memory)}/>}
 </AnimatePresence>
 const cityView=<motion.main key="city" className="city-shell experience-view" initial={reduce?false:{opacity:0,scale:.992}} animate={{opacity:1,scale:1}} exit={reduce?{opacity:0}:{opacity:0,scale:1.012}} transition={{duration:reduce?0:.3,ease:[.22,.8,.25,1]}}>
  <section className={`city-screen ${chromeCollapsed?'is-chrome-collapsed':''}`}>
   <header className="city-header">
    <div className="city-header__content" id="city-topbar-content" aria-hidden={chromeCollapsed} inert={chromeCollapsed}>
     <div className="city-header__brand"><p className="eyebrow">LingoLife</p><h1>{zh?'LingoLife 天空之城':'LingoLife Sky City'}</h1><span>{t('map.subtitle')}</span></div>
     <div className="city-actions"><button disabled={npcs.length>=5} onClick={beginCreate}>＋ {t('nav.newCharacter')}</button><button onClick={openCityStories}>✦ {zh?'城市动态':'City stories'}{cityNeedsAttention&&<i/>}</button><button onClick={()=>setLearningOpen(true)}>◒ {t('nav.progress')}</button><button onClick={()=>setSettingsOpen(true)}>⚙ {t('nav.settings')}</button><span><b>{user.username}</b><small>{t('nav.quota',{count:quota.remaining})}</small></span><button onClick={async()=>{try{await api.logout()}finally{session.clear();onLogout()}}}>{t('nav.logout')}</button></div>
    </div>
    <div className="city-header__compact" aria-hidden={!chromeCollapsed} inert={!chromeCollapsed}><strong>LingoLife</strong><span>{zh?'天空之城':'Sky City'}</span></div>
    <TopBarToggle collapsed={chromeCollapsed} language={language} controls="city-topbar-content" attention={cityNeedsAttention} onToggle={()=>setChromeCollapsed(value=>!value)}/>
   </header>
   {city?<><WorldObserver3D characters={cityCharacters} landmarks={cityLandmarks} followedCharacterId={followedCharacterId} activeLandmarkId={focusedLocationId} serverTime={city.server_time} language={language} timeSlot={city.time_slot} quality={experience.quality} paused={Boolean(selectedLifeStory)} showPlaceCard={false} onCharacterFollow={id=>{setFollowedCharacterId(id);if(id)setFocusedLocationId(undefined)}} onCharacterInteract={id=>void openChat(id)} onEventOpen={id=>setSocialEventId(id)} onTroubleOpen={openTrouble} onHouseholdOpen={id=>void openHousehold(id)} onJourneyElapsed={()=>void refreshWorld('transition')} onLandmarkClick={landmark=>{setFollowedCharacterId(undefined);setFocusedLocationId(landmark.id)}}/><LocationInspector landmark={focusedLandmark} name={focusedAsset?locationCopy(focusedAsset,language).name:undefined} description={focusedAsset?locationCopy(focusedAsset,language).description:undefined} image={focusedAsset?.image} language={language} residents={focusedResidents} onClose={()=>setFocusedLocationId(undefined)} onResidentClick={id=>void openChat(id)}/></>:<p className="city-loading">{t('common.loading')}</p>}
  </section>
 </motion.main>
 const chatView=<motion.main key="chat" className="shell experience-view" initial={reduce?false:{opacity:0,scale:.985,x:18}} animate={{opacity:1,scale:1,x:0}} exit={reduce?{opacity:0}:{opacity:0,scale:.99,x:24}} transition={{duration:reduce?0:.34,ease:[.22,.8,.25,1]}}><section className={`room dialogue-room ${chromeCollapsed?'is-chrome-collapsed':''}`}>
  <header className="dialogue-header">
   <div className="dialogue-header__content" id="chat-topbar-content" aria-hidden={chromeCollapsed} inert={chromeCollapsed}><div><button className="back-city" onClick={()=>void returnToCity()}>← {t('map.back')}</button><p className="room-location">⌖ {currentPlace}</p></div><div className="account"><select className="npc-switch" value={npcId} disabled={busy} onChange={e=>void (async()=>{const room=await loadNpc(e.target.value);if(room)showOpening(room)})()} aria-label={t('nav.switchCharacter')}>{npcs.map(x=><option key={x.id} value={x.id}>{x.profile.name}</option>)}</select><button className="learn-button" onClick={()=>setLearningOpen(true)}>◒ {t('nav.progress')}</button><button onClick={()=>setSettingsOpen(true)}>⚙ {t('nav.settings')}</button><span><b>{user.username}</b><small>{t('nav.quota',{count:quota.remaining})}</small></span></div></div>
   <div className="dialogue-header__compact" aria-hidden={!chromeCollapsed} inert={!chromeCollapsed}><button className="back-city" onClick={()=>void returnToCity()}>← {t('map.back')}</button><strong>{profile.name}</strong><span>⌖ {currentPlace}</span></div>
   <TopBarToggle collapsed={chromeCollapsed} language={language} controls="chat-topbar-content" onToggle={()=>setChromeCollapsed(value=>!value)}/>
  </header>
  <StatBar stats={stats}/>
  <section className="dialogue-main">
   <ConversationScene npcName={profile.name} playerName={zh?'我':'You'} avatar={profile.avatar} mood={mood} place={currentPlace} locationDescription={locationCopy(currentLocationAsset,language).description} locationId={currentResident?.is_home?'home':currentResident?.current_location_id} locationKind={currentLocation?.kind} locationBackground={currentLocationAsset.image} locationBackgroundPosition={currentLocationAsset.imagePosition} locationAccent={currentLocationAsset.accent} messages={visibleMessages} liveSpeech={liveSpeech} historyOpen={historyOpen} sceneryOpen={sceneryOpen} olderCount={olderCount} showOlder={showOlder} ready={ready} story={(activeEvent||eventUpdate?.completed)?<EventCard language={language} event={activeEvent} update={eventUpdate}/>:null} visualStage={<ConversationStage3D npcAvatar={profile.avatar} npcName={profile.name} place={currentPlace} locationKind={currentResident?.is_home?'home':currentLocation?.kind} npcAnimation={animationCue} performance={conversationPerformance} performanceKey={conversationPerformanceKey} liveSpeech={liveSpeech} messages={visibleMessages} language={language} sceneryMode={sceneryOpen} reducedMotion={Boolean(reduce)}/>} editLabel={t('nav.customize')} agentLabel={t('nav.agent')} language={language} onHistoryOpen={()=>{setSceneryOpen(false);setHistoryOpen(true)}} onHistoryClose={()=>setHistoryOpen(false)} onSceneryOpen={()=>{setHistoryOpen(false);setSceneryOpen(true)}} onSceneryClose={()=>setSceneryOpen(false)} onToggleOlder={()=>setShowOlder(value=>!value)} onEdit={()=>{setCreating(false);setStudio(true)}} onAgent={()=>void openAgent()}/>
   <div className={`dialogue-controls ${historyOpen?'is-history-open':''}`} aria-hidden={historyOpen} inert={historyOpen}>
    <AnimatePresence>{feedback&&<motion.aside className="feedback" initial={reduce?false:{opacity:0,y:8,height:0}} animate={{opacity:1,y:0,height:'auto'}} exit={{opacity:0,height:0}}><div><strong>✦ {zh?'英语提示':'English note'}</strong><button onClick={()=>setFeedback(null)} aria-label={zh?'关闭英语反馈':'Close English feedback'}>×</button></div><p>{feedback.tip}</p>{feedback.corrected_text&&<small>{zh?'建议表达':'Try'}: “{feedback.corrected_text}”</small>}</motion.aside>}</AnimatePresence>
    <AnimatePresence>{error&&<motion.div className="error" role="alert" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}><span>{error}</span><button onClick={()=>pending?retryPending():void load()}>{t('common.retry')}</button></motion.div>}</AnimatePresence>
    <VoiceControls language={language} npcText={liveSpeech?.speaker==='npc'&&!liveSpeech.streaming?liveSpeech.text:undefined} autoRead={experience.autoReadNpc} disabled={!ready||busy||historyOpen||sceneryOpen} onTranscript={spoken=>setText(current=>`${current}${current.trim()?' ':''}${spoken}`)}/>
    <form className="dialogue-form" onSubmit={submit}><label className="sr-only" htmlFor="message">{t('chat.inputLabel')}</label><textarea id="message" maxLength={500} rows={1} value={text} onChange={e=>setText(e.target.value)} onKeyDown={keyDown} placeholder={sceneryOpen?(zh?'点击背景返回对话…':'Click the scenery to return…'):(zh?`用英语和 ${profile.name} 聊聊…`:`Say something to ${profile.name}…`)} disabled={!ready||busy||!!pending||historyOpen||sceneryOpen}/><motion.button type="submit" disabled={!ready||busy||!!pending||!text.trim()||historyOpen||sceneryOpen} whileHover={reduce?undefined:{y:-2}} whileTap={reduce?undefined:{scale:.94}}>{busy?<span className="spinner"/>:(zh?'发送':'Send')}</motion.button><small>{zh?'Enter 发送 · Shift+Enter 换行':'Enter to send · Shift+Enter for a new line'}</small></form>
   </div>
  </section>
 </section></motion.main>
 return <><AnimatePresence mode="wait" initial={false}>{view==='city'?cityView:chatView}</AnimatePresence>{view==='city'&&currentMoment&&!selectedLifeStory&&<div className={`life-moment-layer ${chromeCollapsed?'is-collapsed':''} ${followedCharacterId?'has-follow-card':''}`}><MomentToast moment={currentMoment} language={language} onOpen={()=>focusLifeStory(currentMoment)} onDismiss={()=>setDismissedMomentIds(ids=>[...ids.filter(id=>id!==currentMoment.id),currentMoment.id].slice(-30))}/></div>}{overlays}</>
}
