import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import typescript from 'typescript'

const asDataModule=source=>`data:text/javascript;base64,${Buffer.from(typescript.transpileModule(source,{compilerOptions:{module:typescript.ModuleKind.ESNext,target:typescript.ScriptTarget.ES2022}}).outputText).toString('base64')}`
const source=async relative=>readFile(fileURLToPath(new URL(relative,import.meta.url)),'utf8')

const catalogUrl=asDataModule(await source('../src/life/lifeActionCatalog.ts'))
const catalog=await import(catalogUrl)
assert.equal(catalog.LIFE_ACTION_TYPES.length,13,'Life Action catalog must expose all thirteen first-phase actions')
assert.equal(new Set(catalog.LIFE_ACTION_TYPES).size,13,'Life Action types must be unique')
for(const type of catalog.LIFE_ACTION_TYPES){
 const contract=catalog.LIFE_ACTION_CATALOG[type]
 assert.ok(contract,`Missing presentation contract for ${type}`)
 assert.ok(contract.loop.length,`${type} has no performing loop`)
 assert.ok(contract.label.zh&&contract.label.en,`${type} is missing bilingual labels`)
}

const normalizeSource=(await source('../src/life/normalizeWorldSnapshot.ts')).replace("from './lifeActionCatalog'",`from '${catalogUrl}'`)
const normalizeUrl=asDataModule(normalizeSource)
const normalized=await import(normalizeUrl)
const scheduleSource=(await source('../src/life/worldSchedule.ts')).replace("from './normalizeWorldSnapshot'",`from '${normalizeUrl}'`)
const schedule=await import(asDataModule(scheduleSource))

const avatar={model:'city-01',hair:'',hairColor:'#000000',face:'',skin:'#ffffff',eyes:'',brows:'',nose:'',mouth:'',outfit:'',outfitColor:'#ffffff',accessory:'',strokes:[]}
const resident={id:'emma',name:'Emma',avatar,home:{id:'home-emma',x:1,y:1},current_location_id:'home-emma',position:{x:1,y:1},is_home:true,world_action:{state:'walking_to_event',event_id:'legacy-event',target_location_id:'cafe',started_at:'2026-08-28T10:00:00Z',arrives_at:'2026-08-28T10:01:00Z'}}
const base={date:'2026-08-28',server_time:'2026-08-28T10:00:00Z',map:{width:1600,height:1000},locations:[],npcs:[resident]}

const legacy=normalized.normalizeWorldSnapshot(base)
assert.equal(legacy.residents[0].action.source,'legacy')
assert.equal(legacy.residents[0].action.status,'traveling')

const lifeAction={id:'life-read',type:'read',status:'performing',location_id:'home-emma-study',started_at:'2026-08-28T10:00:00Z',ends_at:'2026-08-28T10:02:00Z',visible_intent:'Reading a photography magazine at home',visible_intent_zh:'正在家中读一本摄影杂志',visible_context:{icon:'▤',activity:'read a photography magazine',activity_zh:'读一本摄影杂志',topic:'photography',phase:'performing',phase_label:'In progress',phase_label_zh:'正在进行',progress_kind:'timed',location:'Home',location_zh:'家中'},observable_state:{mood:'calm',energy:'steady',attention:'focused',phase:'performing'},presentation:{version:2,progress:{kind:'timed',started_at:'2026-08-28T10:00:00Z',ends_at:'2026-08-28T10:02:00Z'}}}
const life=normalized.normalizeWorldSnapshot({...base,world_version:4,npcs:[{...resident,current_action:lifeAction}]})
assert.equal(life.residents[0].action.source,'life','current_action must take precedence over legacy world_action')
assert.equal(life.residents[0].action.type,'read')
assert.equal(life.residents[0].action.raw.visible_context.activity_zh,'读一本摄影杂志','observable action detail must survive normalization')
assert.equal(life.residents[0].action.raw.observable_state.mood,'calm','coarse observable state must survive normalization')
const livingPresentation=normalized.lifeActionWorldPresentation(life.residents[0].action)
assert.equal(livingPresentation.state,'living','performing life actions must be presented as ordinary living, never idle')
assert.equal(livingPresentation.event_id,undefined,'ordinary living must not look like a player-required event')
for(const status of ['planned','blocked','retrying']){
 const snapshot=normalized.normalizeWorldSnapshot({...base,npcs:[{...resident,current_action:{...lifeAction,status}}]})
 assert.equal(normalized.lifeActionWorldPresentation(snapshot.residents[0].action).state,'living',`${status} life activity must not be presented as a pending event`)
}
const legacyLiving=normalized.normalizeWorldSnapshot({...base,npcs:[{...resident,world_action:{state:'living'}}]})
assert.equal(legacyLiving.residents[0].action.type,'living','the compatibility adapter must accept living from a mixed-version world')
const explicitEmpty=normalized.normalizeWorldSnapshot({...base,npcs:[{...resident,current_action:null}]})
assert.equal(explicitEmpty.residents[0].action,null,'an explicit null current_action must not resurrect stale legacy state')
assert.equal(normalized.compareWorldVersions('12','9'),1)
assert.equal(normalized.compareWorldVersions('world-b','world-a'),undefined,'opaque versions must not be guessed')

const now=Date.parse('2026-08-28T10:00:00Z')
const scheduled=normalized.normalizeWorldSnapshot({...base,next_transition_at:'2026-08-28T10:00:20Z',npcs:[{...resident,current_action:{...lifeAction,ends_at:'2026-08-28T10:00:10Z'}}]})
const options={maxVisibleStalenessMs:30_000,minimumDelayMs:800,pastDueRetryMs:5_000,transitionGraceMs:220}
assert.equal(schedule.nextWorldRefreshDelay(scheduled,now,0,options),10_220,'the earliest authoritative action end must drive refresh')
const traveling=normalized.normalizeWorldSnapshot({...base,next_transition_at:undefined,npcs:[{...resident,current_action:{...lifeAction,status:'traveling',ends_at:null,arrives_at:'2026-08-28T10:00:12Z'}}]})
assert.equal(schedule.nextWorldRefreshDelay(traveling,now,0,options),12_220,'traveling actions must schedule from arrives_at rather than ends_at')
assert.equal(schedule.nextWorldRefreshDelay(scheduled,now+20_000,0,options),5_000,'past transitions must use bounded retry backoff')
const completed=normalized.normalizeWorldSnapshot({...base,npcs:[{...resident,current_action:{...lifeAction,status:'completed',ends_at:'2026-08-28T09:00:00Z'}}]})
assert.equal(schedule.nextWorldRefreshDelay(completed,now,0,options),30_000,'completed actions must not create a stale timer loop')

const profilePolicy=await import(asDataModule(await source('../src/profilePolicy.ts')))
const profile={age:25,romanceEnabled:undefined,relationshipBoundaries:[]}
assert.equal(profilePolicy.romanceIsEnabled(profile),true,'old adult profiles must retain the server opt-in default')
assert.equal(profilePolicy.normalizeNpcProfilePolicy({...profile,age:17}).romanceEnabled,false,'minor profiles must be explicitly disabled when saved')
assert.equal(profilePolicy.romanceIsEnabled({...profile,relationshipBoundaries:['no_romance']}),false,'legacy no-romance boundaries must remain authoritative')
assert.equal(profilePolicy.withRomancePreference({...profile,relationshipBoundaries:['no_romance','private']},true).relationshipBoundaries.join(','),'private','explicit opt-in must remove only legacy blocker aliases')
const linkedProfile=profilePolicy.normalizeNpcProfilePolicy({...profile,familyIds:['self','ava','ava','bo','cy','di','extra'],householdWithIds:['self','bo','ava']},'self')
assert.deepEqual(linkedProfile.familyIds,['ava','bo','cy','di'],'family links must be unique, exclude the edited NPC, and stop at four')
assert.deepEqual(linkedProfile.householdWithIds,['bo'],'a cohabitation choice must exclude the edited NPC and remain single-select')

const storyPresentation=await import(asDataModule(await source('../src/life/lifeStoryPresentation.ts')))
assert.equal(storyPresentation.lifeStoryIsPresentable({presentable:undefined,presentation_expires_at:undefined,observed_at:null},now),true,'mixed-version observable moments must stay visible')
assert.equal(storyPresentation.lifeStoryIsPresentable({presentable:true,presentation_expires_at:'2026-08-28T09:59:00Z',observed_at:null},now),true,'the authoritative presentable flag keeps an unwitnessed settled moment visible')
assert.equal(storyPresentation.lifeStoryIsPresentable({presentable:false,presentation_expires_at:'2026-08-28T10:01:00Z'},now),false,'the authoritative presentable flag must hide expired moments')
assert.equal(storyPresentation.lifeStoryIsPresentable({presentable:undefined,presentation_expires_at:'2026-08-28T09:59:00Z',observed_at:null},now),true,'an unwitnessed moment must survive its minimum TTL')
assert.equal(storyPresentation.lifeStoryIsPresentable({presentable:undefined,presentation_expires_at:'2026-08-28T09:59:00Z',observed_at:'2026-08-28T09:58:00Z'},now),false,'an observed mixed-version moment may expire from the live toast')
const openStory={id:'story-1',level:'incident',status:'awaiting_management',title:'Story',summary:'Summary',participant_ids:['emma'],updated_at:'2026-08-28T10:00:00Z'}
const observedStory={...openStory,observed_at:'2026-08-28T10:00:05Z',updated_at:'2026-08-28T10:00:05Z'}
const settledStory={...observedStory,status:'resolved_with_management',updated_at:'2026-08-28T10:00:10Z'}
assert.equal(storyPresentation.lifeStoryViewIncludesBaseline(openStory,observedStory),false,'a stale city story must not erase a mutation observation')
assert.equal(storyPresentation.lifeStoryViewIncludesBaseline(openStory,settledStory),false,'a stale open story must not replace a terminal mutation result')
assert.equal(storyPresentation.lifeStoryViewIncludesBaseline(settledStory,observedStory),true,'a newer terminal story may advance an observed baseline')

const appSource=await source('../src/App.tsx')
assert.match(appSource,/hasLifeStories=Boolean\(city\?\.observable_moments\?\.length/,'city stories must include life moments')
assert.doesNotMatch(appSource,/cityNeedsAttention[^\n]+status==='planned'/,'ordinary planned actions must not create a city attention alert')
assert.match(appSource,/api\.lifeStories\(\)\.then/,'a selected story missing from the city slice must reconcile from story history')
assert.match(appSource,/selectedLifeStoryMutationRef\.current=result;setSelectedLifeStory[^\n]+await refreshWorld/,'a direct story mutation result must be retained before world refresh')
assert.match(appSource,/paused=\{Boolean\(selectedLifeStory\|\|selectedSocialEvent\|\|householdId\)\}/,'the city renderer must pause behind full-screen life, social, and household encounters')
assert.match(appSource,/relationshipCandidates=\{npcs\.map/,'the character editor must receive existing residents as relationship candidates')
assert.match(appSource,/editingNpcId=\{creating\?undefined:npcId\}/,'the character editor must know which resident to exclude')
const studioSource=await source('../src/components/CharacterStudio.tsx')
assert.match(studioSource,/所有居民都住在同一套共享住宅/,'the character editor must explain the single shared-home rule')
assert.doesNotMatch(studioSource,/set\("householdWithIds"/,'the character editor must not offer obsolete per-character housing choices')
assert.doesNotMatch(studioSource,/profile\.avatar\.homeBackground/,'the character editor must not present private room themes for one shared interior')
assert.doesNotMatch(studioSource,/每个人拥有自己的房间|Each resident has a private room/,'the character editor must not claim that private rooms are already assigned')
assert.match(studioSource,/familyIds\.length>=4/,'family selection must enforce its four-resident cap')
assert.doesNotMatch(appSource,/getLocationAsset\([^\n]+homeBackground/,'shared-home scenes must not vary by resident appearance settings')
assert.match(appSource,/currentResident\?\.is_home\?t\('map\.home'\)/,'home conversations must use the shared-home label')
const locationAssetSource=await source('../src/locationAssets.ts')
assert.match(locationAssetSource,/zh:\{name:'共享住宅'/,'the authoritative home asset must describe the shared residence')
assert.doesNotMatch(locationAssetSource,/HOME_SCENES/,'the shared-home background must not vary per resident')
const worldObserverSource=await source('../src/three/world/WorldObserver3D.tsx')
assert.match(worldObserverSource,/onHouseholdOpen=\{onHouseholdOpen\}/,'the shared-home marker must forward household navigation')
const storyPanelSource=await source('../src/components/StoryThreadsPanel.tsx')
assert.match(storyPanelSource,/structural_bonds\?\?\[\]/,'public structural bonds must be rendered in the relationship panel')
assert.match(storyPanelSource,/filter\(bond=>bond\.active!==false\)/,'inactive structural bonds must remain hidden')
const encounterSource=await source('../src/components/LifeStoryEncounter.tsx')
assert.match(encounterSource,/const canObserve=current\.level!==['"]thread['"]&&!observed\b/,'settled but unwitnessed moments must remain observable')
assert.match(encounterSource,/<p lang="en">\{english\}<\/p>/,'NPC story beats must keep English as the primary dialogue')
const actionLabelSource=await source('../src/components/ResidentActionLabel.tsx')
assert.match(actionLabelSource,/raw\.visible_context/,'resident labels must consume concrete server-owned observable detail')
assert.match(actionLabelSource,/phase_label_zh/,'resident labels must expose bilingual action phase semantics')
assert.match(actionLabelSource,/presentation\?\.progress/,'resident labels must expose action progress semantics')
const householdPreviewSource=await source('../src/components/HouseholdInteriorPreview.tsx')
assert.match(householdPreviewSource,/camera\.lookAt\(0,\.9,-\.55\)/,'the household camera must frame the room instead of keeping Three’s default -Z direction')
assert.match(householdPreviewSource,/!privateAction\(resident\)/,'private household actions must not render a resident model in the cutaway')
assert.match(householdPreviewSource,/reducedMotion=\{Boolean\(reduce\)\}/,'the household cutaway must respect reduced-motion preferences')
const expressionSource=await source('../src/life/characterExpression.ts')
assert.match(expressionSource,/raw\.visible_context\?\.visibility===['"]private['"]/,'character expression must honor server-owned privacy')
assert.match(expressionSource,/raw\.visible_context\?\.topic/,'hobby expressions must use the concrete observable topic')
assert.ok(expressionSource.indexOf('if(troubleSignal)')<expressionSource.indexOf("action?.status==='traveling'"),'visible trouble must take priority over an ordinary journey emote')

console.log('Life simulation frontend guard passed (13 actions, shared-home editing, romance consent, v2 precedence, version safety, single-timer schedule).')
