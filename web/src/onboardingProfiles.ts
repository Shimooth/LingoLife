import {defaultAvatar} from './avatar.ts'
import type {FamilyRole,NpcProfile,OnboardingFamilyBond,OnboardingSharedHistoryHook,SharedHistoryKind,SharedHistoryTone} from './types.ts'

export const ONBOARDING_MIN_RESIDENTS=2
export const ONBOARDING_MAX_RESIDENTS=8

type ResidentArchetype={
 id:string
 name:string
 age:number
 relationship:string
 occupation:string
 personality:string[]
 interests:string[]
 likes:string[]
 dislikes:string[]
 quirks:string[]
 habits:string[]
 boundaries:string[]
 longTermGoal:string
 householdRole:NpcProfile['householdRole']
 chorePreferences:NpcProfile['chorePreferences']
 privateSpacePreference:NpcProfile['privateSpacePreference']
 model:string
 hairColor:string
}

export type OnboardingResidentDraft={
 key:string
 archetypeId:string
 profile:NpcProfile
}

export type DraftFamilyBond={leftKey:string;rightKey:string;leftRole:FamilyRole;rightRole:FamilyRole}
export type DraftSharedHistoryHook={id:string;participantKeys:string[];kind:SharedHistoryKind;summary:string;tone:SharedHistoryTone}
export const FAMILY_ROLE_INVERSE:Readonly<Record<FamilyRole,FamilyRole>>={sibling:'sibling',cousin:'cousin',parent:'child',child:'parent',guardian:'dependent',dependent:'guardian'}

export type ResidentValidationIssue='name'|'age'|'relationship'|'occupation'|'personality'|'interests'|'likes'|'dislikes'|'quirks'|'habits'|'boundaries'|'chores'|'goal'|'duplicate-name'

const ARCHETYPES:readonly ResidentArchetype[]=[
 {id:'maya-gardens',name:"玛雅",age:26,relationship:"老朋友",occupation:"景观设计师",personality:["体贴","俏皮","善于观察"],interests:["城市速写","园艺","爵士乐"],likes:["阳光下的公园","手写便条","一起吃早餐"],dislikes:["浪费食物","尖刻的批评"],quirks:["给每盆绿植起名字"],habits:["早餐前给植物浇水","安静的晚上画速写"],boundaries:["挪动她的植物前先问一声","争执后给她一点思考时间"],householdRole:'caretaker',chorePreferences:['cleaning','cooking'],privateSpacePreference:'balanced',longTermGoal:"设计一座让陌生人也愿意停留的公共花园。",model:'city-01',hairColor:'#2d2323'},
 {id:'theo-coffee',name:"西奥",age:31,relationship:"新邻居",occupation:"咖啡师",personality:["热情","好奇","随性"],interests:["精品咖啡","骑行","街头摄影"],likes:["深夜聊天","浓缩咖啡","热闹的街道"],dislikes:["死板的计划","冷掉的剩饭"],quirks:["挑杯子先看杯柄好不好握"],habits:["大家醒来前先煮咖啡","傍晚出门骑车"],boundaries:["不要翻他的笔记本","邀请一大群人来家里前先商量"],householdRole:'cook',chorePreferences:['cooking','shopping'],privateSpacePreference:'low',longTermGoal:"开一家深夜也能让邻居聚在一起的小咖啡馆。",model:'city-02',hairColor:'#65423b'},
 {id:'jun-sound',name:"阿俊",age:24,relationship:"老同学",occupation:"游戏音效设计师",personality:["内向","风趣","有创造力"],interests:["氛围音乐","街机游戏","环境录音"],likes:["雨声","合作游戏","安静的陪伴"],dislikes:["惊喜派对","开免提打电话"],quirks:["喜欢录下莫名解压的小声音"],habits:["打扫时戴耳机","睡前读书"],boundaries:["进入私人空间前先敲门","不要分享尚未完成的录音"],householdRole:'free_spirit',chorePreferences:['laundry','dishes'],privateSpacePreference:'high',longTermGoal:"创作一段多年以后仍让人记得的游戏配乐。",model:'city-03',hairColor:'#2d2323'},
 {id:'nora-stories',name:"诺拉",age:35,relationship:"创作搭档",occupation:"本地记者",personality:["大胆","善解人意","执着"],interests:["本地历史","播客","夜间散步"],likes:["坦诚的回答","老建筑","辣面"],dislikes:["不守承诺","回避难回答的问题"],quirks:["把票根留着当作见闻的证据"],habits:["吃早餐时看新闻","每次聊天后记点笔记"],boundaries:["不公开私下说的故事","不要强迫她放弃追问"],householdRole:'organizer',chorePreferences:['shopping','dishes'],privateSpacePreference:'balanced',longTermGoal:"出版一本记录城市中那些被忽略的人和事的故事集。",model:'city-04',hairColor:'#b36b43'},
 {id:'leo-motion',name:"里奥",age:29,relationship:"运动伙伴",occupation:"康复治疗师",personality:["耐心","精力充沛","乐观"],interests:["攀岩","烹饪","篮球"],likes:["晨练","聚餐","实实在在的帮助"],dislikes:["轻易放弃","通道被杂物堵住"],quirks:["等水烧开时也要拉伸一下"],habits:["早起准备早餐","关心疲惫的室友"],boundaries:["讨论伤病前先征求同意","晚上十一点后保持安静"],householdRole:'caretaker',chorePreferences:['cooking','cleaning'],privateSpacePreference:'low',longTermGoal:"开一家让更多邻居都能使用的康复与运动工作室。",model:'city-05',hairColor:'#65423b'},
 {id:'iris-museum',name:"艾莉丝",age:27,relationship:"世交朋友",occupation:"博物馆策展人",personality:["细致","富有想象力","温柔"],interests:["民间传说","陶艺","老明信片"],likes:["贴好标签的架子","慢慢喝茶","认真倾听的人"],dislikes:["借走东西不归还","电视声音太大"],quirks:["每张便条都写上日期"],habits:["晚饭后收拾桌子","周日做陶艺"],boundaries:["借私人物品前先问一声","不要打断需要专注的细致工作"],householdRole:'organizer',chorePreferences:['cleaning','laundry'],privateSpacePreference:'high',longTermGoal:"策划一场让历史仿佛重新活过来的展览。",model:'city-06',hairColor:'#d67683'},
 {id:'mina-robotics',name:"米娜",age:32,relationship:"网友",occupation:"机器人工程师",personality:["理性","冷幽默","重情义"],interests:["动手改装","科幻小说","乒乓球"],likes:["能找到答案的问题","冷笑话","宵夜"],dislikes:["含糊的要求","工具用完不收回盒子"],quirks:["给原型机起夸张的名字"],habits:["下班后修理小东西","给剩菜贴上精确的标签"],boundaries:["碰她的工具前先问","有意见直接说，不要让她猜"],householdRole:'fixer',chorePreferences:['repairs','dishes'],privateSpacePreference:'balanced',longTermGoal:"发明一款真正能帮助老年人的家用机器人。",model:'city-07',hairColor:'#2d2323'},
 {id:'kai-dance',name:"凯伊",age:23,relationship:"旅伴",occupation:"舞蹈老师",personality:["外向","爱恶作剧","善于鼓励"],interests:["街舞","运动鞋设计","逛美食市场"],likes:["即兴音乐","热闹的聚餐","朋友间的小挑战"],dislikes:["憋着不满不说","严格的作息规定"],quirks:["做家务时也能跳出舞步"],habits:["午饭后练舞","邀请室友一起逛市场"],boundaries:["玩笑过头时请直接说","拍摄前先征得同意"],householdRole:'mediator',chorePreferences:['shopping','cooking'],privateSpacePreference:'low',longTermGoal:"组织一场在城市广场上让大家一起跳起来的演出。",model:'city-08',hairColor:'#b36b43'},
 {id:'hazel-books',name:"海榛",age:38,relationship:"读书会朋友",occupation:"儿童图书管理员",personality:["沉稳","敏锐","善良"],interests:["绘本","观鸟","填字游戏"],likes:["舒服的沉默","靠窗的座位","温和的幽默"],dislikes:["在屋里大喊","损坏书籍"],quirks:["到处留下小书签"],habits:["睡前读书","周六早上洗衣服"],boundaries:["争执时给她一点空间","看完书放回原来的书架"],householdRole:'mediator',chorePreferences:['laundry','cleaning'],privateSpacePreference:'high',longTermGoal:"为害羞的孩子写一本带插画的冒险故事。",model:'city-09',hairColor:'#65423b'},
 {id:'rowan-bread',name:"罗恩",age:34,relationship:"儿时邻居",occupation:"面包师",personality:["慷慨","固执","开朗"],interests:["酸种面包","民谣","社区集市"],likes:["做饭给大家吃","老食谱","一起唱歌"],dislikes:["浪费食材","临时挑刺"],quirks:["会和正在发酵的面团说话"],habits:["日出前开始烤面包","攒着劲一口气收拾厨房"],boundaries:["不要擅自改动家传食谱","拿预留的食物前先问"],householdRole:'cook',chorePreferences:['cooking','dishes'],privateSpacePreference:'balanced',longTermGoal:"把一道家传食谱做成全城最受欢迎的早餐。",model:'city-10',hairColor:'#e0b06f'},
 {id:'aria-rescue',name:"艾莉亚",age:28,relationship:"信任的熟人",occupation:"急救员",personality:["果断","有同情心","闲不下来"],interests:["急救教学","跑步","纪录片"],likes:["清晰的计划","晨跑","说到做到的人"],dislikes:["出口被堵住","被过度关照"],quirks:["走楼梯时会不自觉地数台阶"],habits:["每周检查家里的常用物资","下班后散步放松"],boundaries:["不要追问难受的出勤经历","保持公共通道畅通"],householdRole:'caretaker',chorePreferences:['shopping','repairs'],privateSpacePreference:'balanced',longTermGoal:"在每个街区开设免费的急救技能课堂。",model:'city-11',hairColor:'#6d718d'},
 {id:'felix-city',name:"费利克斯",age:36,relationship:"友好的竞争对手",occupation:"城市规划师",personality:["有抱负","善于社交","注重细节"],interests:["模型制作","公共交通","国际象棋"],likes:["有条理的讨论","高效的日常安排","城市景色"],dislikes:["总是迟到","没人负责的计划"],quirks:["忍不住把椅子摆得更整齐"],habits:["周一写好共享家务清单","吃早餐时回顾目标"],boundaries:["批评方案，不要攻击本人","共同开支要先商量"],householdRole:'organizer',chorePreferences:['cleaning','shopping'],privateSpacePreference:'low',longTermGoal:"打造一个漂亮的步行街区，让城市重新连在一起。",model:'city-12',hairColor:'#65423b'},
]

let draftSequence=0
const nextDraftKey=()=>`resident-${Date.now().toString(36)}-${(++draftSequence).toString(36)}`
const randomIndex=(length:number,random:()=>number)=>Math.min(length-1,Math.max(0,Math.floor(random()*length)))

const draftFromArchetype=(archetype:ResidentArchetype):OnboardingResidentDraft=>({
 key:nextDraftKey(),
 archetypeId:archetype.id,
 profile:{
  name:archetype.name,
  age:archetype.age,
  relationship:archetype.relationship,
  occupation:archetype.occupation,
  personality:[...archetype.personality],
	  interests:[...archetype.interests],
	  likes:[...archetype.likes],
	  dislikes:[...archetype.dislikes],
	  quirks:[...archetype.quirks],
	  habits:[...archetype.habits],
	  boundaries:[...archetype.boundaries],
	  longTermGoal:archetype.longTermGoal,
	  householdRole:archetype.householdRole,
	  chorePreferences:[...archetype.chorePreferences],
	  privateSpacePreference:archetype.privateSpacePreference,
  romanceEnabled:true,
  relationshipBoundaries:[],
  familyIds:[],
  householdWithIds:[],
  avatar:{...defaultAvatar,model:archetype.model,hairColor:archetype.hairColor,strokes:[]},
 },
})

const chooseUnused=(used:Set<string>,random:()=>number)=>{
 const available=ARCHETYPES.filter(archetype=>!used.has(archetype.id))
 const pool=available.length?available:ARCHETYPES
 return pool[randomIndex(pool.length,random)]
}

export function createOnboardingResidents(count=ONBOARDING_MIN_RESIDENTS,random:()=>number=Math.random):OnboardingResidentDraft[]{
 const requested=Number.isFinite(count)?Math.round(count):ONBOARDING_MIN_RESIDENTS
 const total=Math.max(ONBOARDING_MIN_RESIDENTS,Math.min(ONBOARDING_MAX_RESIDENTS,requested))
 const used=new Set<string>(),drafts:OnboardingResidentDraft[]=[]
 while(drafts.length<total){
  const archetype=chooseUnused(used,random)
  used.add(archetype.id)
  drafts.push(draftFromArchetype(archetype))
 }
 return drafts
}

export function addRandomOnboardingResident(drafts:readonly OnboardingResidentDraft[],random:()=>number=Math.random):OnboardingResidentDraft[]{
 if(drafts.length>=ONBOARDING_MAX_RESIDENTS)return [...drafts]
 const archetype=chooseUnused(new Set(drafts.map(draft=>draft.archetypeId)),random)
 return [...drafts,draftFromArchetype(archetype)]
}

export function rerollOnboardingResident(drafts:readonly OnboardingResidentDraft[],key:string,random:()=>number=Math.random):OnboardingResidentDraft[]{
 const used=new Set(drafts.map(draft=>draft.archetypeId))
 const archetype=chooseUnused(used,random)
 return drafts.map(draft=>draft.key===key?{...draftFromArchetype(archetype),key}:draft)
}

export function validateOnboardingResidents(drafts:readonly OnboardingResidentDraft[]):Record<string,ResidentValidationIssue[]>{
 const nameCounts=new Map<string,number>()
 drafts.forEach(({profile})=>{const name=profile.name.trim().toLocaleLowerCase();if(name)nameCounts.set(name,(nameCounts.get(name)??0)+1)})
 return Object.fromEntries(drafts.map(draft=>{
  const {profile}=draft,issues:ResidentValidationIssue[]=[]
  const normalizedName=profile.name.trim().toLocaleLowerCase()
  if(!normalizedName)issues.push('name')
  else if((nameCounts.get(normalizedName)??0)>1)issues.push('duplicate-name')
  if(typeof profile.age!=='number'||!Number.isInteger(profile.age)||profile.age<16||profile.age>100)issues.push('age')
  if(!profile.relationship.trim())issues.push('relationship')
  if(!profile.occupation.trim())issues.push('occupation')
  if(!profile.personality.some(value=>value.trim()))issues.push('personality')
	  if(!profile.interests.some(value=>value.trim()))issues.push('interests')
	  if(!profile.likes.some(value=>value.trim()))issues.push('likes')
	  if(!profile.dislikes.some(value=>value.trim()))issues.push('dislikes')
	  if(!profile.quirks.some(value=>value.trim()))issues.push('quirks')
	  if(!profile.habits.some(value=>value.trim()))issues.push('habits')
	  if(!profile.boundaries.some(value=>value.trim()))issues.push('boundaries')
	  if(!profile.chorePreferences.length)issues.push('chores')
  if(!profile.longTermGoal.trim())issues.push('goal')
  return [draft.key,issues]
 }))
}

export type OnboardingRosterDifference={valid:boolean;missingCategories:string[];tooSimilarPairs:[string,string][]}
const canonical=(value:unknown)=>JSON.stringify(value)
export function onboardingRosterDifference(drafts:readonly OnboardingResidentDraft[]):OnboardingRosterDifference{
 const dimensions=drafts.map(({profile})=>({
  personality:new Set(profile.personality.map(value=>value.trim().toLocaleLowerCase()).filter(Boolean)),
  interests:new Set([...profile.interests,...profile.likes].map(value=>value.trim().toLocaleLowerCase()).filter(Boolean)),
  schedule:profile.occupation.trim().toLocaleLowerCase(),
  chores:[profile.householdRole,[...profile.chorePreferences].sort()],
  social:[profile.privateSpacePreference,[...profile.boundaries].sort(),[...profile.habits].sort()],
 }))
 const equal=(a:unknown,b:unknown)=>a instanceof Set&&b instanceof Set
  ?a.size===b.size&&[...a].every(value=>b.has(value)):canonical(a)===canonical(b)
 const categories=(['personality','interests','schedule','chores','social'] as const)
 const missingCategories=categories.filter(category=>new Set(dimensions.map(value=>canonical(value[category] instanceof Set?[...value[category]].sort():value[category]))).size<2)
 const tooSimilarPairs:[string,string][]=[]
 for(let left=0;left<drafts.length;left++)for(let right=left+1;right<drafts.length;right++){
  const distinct=categories.filter(category=>!equal(dimensions[left][category],dimensions[right][category])).length
  if(distinct<3)tooSimilarPairs.push([drafts[left].profile.name,drafts[right].profile.name])
 }
 return {valid:missingCategories.length===0&&tooSimilarPairs.length===0,missingCategories,tooSimilarPairs}
}

export function onboardingResidentsAreValid(drafts:readonly OnboardingResidentDraft[],minimum=ONBOARDING_MIN_RESIDENTS,maximum=ONBOARDING_MAX_RESIDENTS):boolean{
 if(drafts.length<minimum||drafts.length>maximum)return false
 return Object.values(validateOnboardingResidents(drafts)).every(issues=>issues.length===0)&&onboardingRosterDifference(drafts).valid
}

export function buildOnboardingSocialContract(
 drafts:readonly OnboardingResidentDraft[],familyBonds:readonly DraftFamilyBond[],historyHooks:readonly DraftSharedHistoryHook[],
):{family_bonds:OnboardingFamilyBond[];shared_history_hooks:OnboardingSharedHistoryHook[]}{
 const indices=new Map(drafts.map((draft,index)=>[draft.key,index]))
 return {
  family_bonds:familyBonds.map(bond=>({
   left_index:indices.get(bond.leftKey)??-1,right_index:indices.get(bond.rightKey)??-1,
   left_role:bond.leftRole,right_role:bond.rightRole,
  })),
  shared_history_hooks:historyHooks.map(hook=>({
   id:hook.id,participant_indices:hook.participantKeys.map(key=>indices.get(key)??-1),
   kind:hook.kind,summary:hook.kind==='personal_connection'&&hook.summary.trim().length<3?`关系：${hook.summary.trim()}`:hook.summary.trim(),tone:hook.tone,
  })),
 }
}

export const ONBOARDING_ARCHETYPE_COUNT=ARCHETYPES.length
