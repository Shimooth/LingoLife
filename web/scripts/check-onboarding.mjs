import {
 ONBOARDING_ARCHETYPE_COUNT,
 ONBOARDING_MAX_RESIDENTS,
 ONBOARDING_MIN_RESIDENTS,
 addRandomOnboardingResident,
 createOnboardingResidents,
 onboardingResidentsAreValid,
 onboardingRosterDifference,
 rerollOnboardingResident,
 validateOnboardingResidents,
} from '../src/onboardingProfiles.ts'

const fail=message=>{throw new Error(`Onboarding guard failed: ${message}`)}
const constantRandom=value=>()=>value

if(ONBOARDING_ARCHETYPE_COUNT<ONBOARDING_MAX_RESIDENTS)fail('there are fewer distinct archetypes than the maximum resident count')

const defaultResidents=createOnboardingResidents(undefined,constantRandom(0))
if(defaultResidents.length!==ONBOARDING_MIN_RESIDENTS)fail('the default household does not begin with two residents')
if(!onboardingResidentsAreValid(defaultResidents))fail('default resident profiles are invalid')
const socialContract=(await import('../src/onboardingProfiles.ts')).buildOnboardingSocialContract(defaultResidents,[{leftKey:defaultResidents[0].key,rightKey:defaultResidents[1].key,leftRole:'parent',rightRole:'child'}],[{id:'shared-test',participantKeys:[defaultResidents[0].key,defaultResidents[1].key],kind:'shared_project',summary:'They once made something together.',tone:'warm'}])
if(socialContract.family_bonds[0]?.left_index!==0||socialContract.family_bonds[0]?.right_role!=='child')fail('typed family bonds do not resolve stable draft keys to roster slots')
if(socialContract.shared_history_hooks[0]?.participant_indices.join(',')!=='0,1')fail('shared-history hooks do not resolve to the same roster')

let fullHouse=createOnboardingResidents(ONBOARDING_MIN_RESIDENTS,constantRandom(.17))
while(fullHouse.length<ONBOARDING_MAX_RESIDENTS)fullHouse=addRandomOnboardingResident(fullHouse,constantRandom(.31))
if(fullHouse.length!==ONBOARDING_MAX_RESIDENTS)fail('the household cannot reach eight residents')
if(new Set(fullHouse.map(draft=>draft.archetypeId)).size!==fullHouse.length)fail('random residents reused an archetype')
if(new Set(fullHouse.map(draft=>draft.profile.name.toLowerCase())).size!==fullHouse.length)fail('random residents reused a name')
if(new Set(fullHouse.map(draft=>draft.profile.occupation.toLowerCase())).size!==fullHouse.length)fail('random residents reused an occupation')
if(new Set(fullHouse.map(draft=>draft.profile.longTermGoal.toLowerCase())).size!==fullHouse.length)fail('random residents reused a goal')
if(addRandomOnboardingResident(fullHouse).length!==ONBOARDING_MAX_RESIDENTS)fail('resident limit can be exceeded')
if(!onboardingResidentsAreValid(fullHouse))fail('a full preset household is invalid')
const contractFields=['likes','dislikes','quirks','habits','boundaries','householdRole','chorePreferences','privateSpacePreference']
for(const draft of fullHouse)for(const field of contractFields)if(!draft.profile[field]||(Array.isArray(draft.profile[field])&&!draft.profile[field].length))fail(`${draft.archetypeId} has no ${field}`)
if(!onboardingRosterDifference(fullHouse).valid)fail('the eight-resident preset cast is not meaningfully differentiated')

const first=fullHouse[0],rerolled=rerollOnboardingResident(fullHouse,first.key,constantRandom(.75))
if(rerolled[0].key!==first.key)fail('reroll changed the stable editor key')
if(rerolled[0].archetypeId===first.archetypeId)fail('reroll did not select a different available archetype')
if(new Set(rerolled.map(draft=>draft.archetypeId)).size!==rerolled.length)fail('reroll collided with another resident')

const duplicate=defaultResidents.map((draft,index)=>index===1?{...draft,profile:{...draft.profile,name:defaultResidents[0].profile.name}}:draft)
const duplicateIssues=validateOnboardingResidents(duplicate)
if(!duplicate.every(draft=>duplicateIssues[draft.key].includes('duplicate-name')))fail('duplicate names are not rejected for both residents')
if(onboardingResidentsAreValid(duplicate))fail('duplicate names can complete onboarding')
if(onboardingResidentsAreValid(defaultResidents.slice(0,1)))fail('a one-resident household can complete onboarding')
const sameContract=defaultResidents.map((draft,index)=>index?{...draft,profile:{...structuredClone(defaultResidents[0].profile),name:'Distinct name'}}:draft)
if(onboardingResidentsAreValid(sameContract))fail('a renamed clone bypassed cast-level differentiation')

const flowSource=await (await import('node:fs/promises')).readFile(new URL('../src/components/OnboardingFlow.tsx',import.meta.url),'utf8')
if(!flowSource.includes("useState<'intro'|'loop'|'residents'>"))fail('the first-run experience no longer teaches the core loop before resident setup')
for(const concept of ['loopObserve','loopFollow','loopChoose','loopTalk'])if(!flowSource.includes(concept+':'))fail(`the core-loop guide is missing ${concept}`)
if(!flowSource.includes("phase==='intro'?1:phase==='loop'?2:3"))fail('the onboarding progress indicator is not a three-step journey')
if(!flowSource.includes('所有居民住在同一套共享住宅')||!flowSource.includes('Every resident lives in the same shared home'))fail('shared-home onboarding copy is not bilingual')
for(const field of contractFields)if(!flowSource.includes(field))fail(`the onboarding editor cannot edit ${field}`)
for(const field of ['familyRoleFor','setHistoryKind','FAMILY_ROLE_INVERSE'])if(!flowSource.includes(field))fail(`the onboarding social editor is missing ${field}`)
if(!flowSource.includes('onAcknowledgeIntro'))fail('intro acknowledgement is not persisted before resident setup')

const adminSource=await (await import('node:fs/promises')).readFile(new URL('../src/AdminApp.tsx',import.meta.url),'utf8')
const apiSource=await (await import('node:fs/promises')).readFile(new URL('../src/api.ts',import.meta.url),'utf8')
const mainSource=await (await import('node:fs/promises')).readFile(new URL('../src/main.tsx',import.meta.url),'utf8')
if(!adminSource.includes("username==='onboarding-test'||username.startsWith('onboarding-test-')"))fail('archive reset is exposed beyond dedicated onboarding test accounts')
if(!adminSource.includes('window.prompt')||!adminSource.includes('confirmation!==user.username'))fail('archive reset does not require an exact typed username confirmation')
if(!adminSource.includes('账号、密码、邀请码资格、AI 额度和审计记录会保留'))fail('archive reset does not explain retained account data')
if(!apiSource.includes("`/admin/users/${id}/reset-onboarding`"))fail('the admin reset action is not connected to its protected API')
if(!apiSource.includes("'/onboarding/intro/acknowledge'"))fail('the intro acknowledgement API is not connected')
if(!mainSource.includes("import.meta.env.DEV&&new URLSearchParams(window.location.search).get('admin')==='1'"))fail('the local admin route is not development-only')

console.log(`Onboarding guard passed (three-step guide, ${ONBOARDING_ARCHETYPE_COUNT} distinct presets, ${ONBOARDING_MIN_RESIDENTS}–${ONBOARDING_MAX_RESIDENTS} residents, guarded reusable test account).`)
