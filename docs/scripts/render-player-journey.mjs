// Editable, text-first design diagrams. No AI calls, account access or npm dependencies.
// node docs/scripts/render-player-journey.mjs
// Add --png with an isolated Chrome on QA_CDP_URL (default localhost:19226).
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {resolve} from 'node:path'

const output=fileURLToPath(new URL('../images/player-journey/',import.meta.url))
const C={ink:'#29483f',muted:'#63736a',paper:'#f7f4ec',green:'#e2eee5',line:'#84998a',orange:'#f4e4d1',rust:'#ae6546',white:'#fffdf8'}
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
const text=(x,y,lines,size=22,color=C.ink,weight=400)=>`<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}">${[].concat(lines).map((s,i)=>`<tspan x="${x}" dy="${i?size*1.55:0}">${esc(s)}</tspan>`).join('')}</text>`
const rect=(x,y,w,h,fill=C.white)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="22" fill="${fill}"/>`
const arrow=(points,head=true)=>`<polyline points="${points}" fill="none" stroke="${C.line}" stroke-width="3" stroke-linejoin="round"${head?' marker-end="url(#arrow)"':''}/>`
const card=(x,y,w,h,label,title,lines,kind='current')=>rect(x,y,w,h,kind==='proposed'?C.orange:C.white)+text(x+24,y+33,label,17,kind==='proposed'?C.rust:C.muted,600)+text(x+24,y+72,title,26,C.ink,650)+text(x+24,y+112,lines,21)
const pill=(x,y,w,label,kind='current')=>`<rect x="${x}" y="${y}" width="${w}" height="34" rx="17" fill="${kind==='current'?C.green:C.orange}"/>`+text(x+15,y+23,label,16,kind==='current'?C.ink:C.rust,600)
function sheet(n,title,subtitle,body,h=1030){return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${h}" viewBox="0 0 1200 ${h}" role="img" aria-labelledby="title desc"><title id="title">${esc(title)}</title><desc id="desc">${esc(subtitle)}</desc><defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${C.line}"/></marker></defs><g font-family="'PingFang SC','Microsoft YaHei','Noto Sans CJK SC',sans-serif">${rect(0,0,1200,h,C.paper)}${text(48,45,`LINGOLIFE  /  玩法图解 ${n}`,17,C.rust,650)}${text(48,101,title,40,C.ink,700)}${text(48,146,subtitle,21,C.muted)}${body}<path d="M48 ${h-63} H1152" stroke="#d9dfd3"/>${text(48,h-31,'设计视角 · 2026.09.09 · 中文用于说明，游戏聊天仍为英文',16,C.muted)}${text(1020,h-31,`${n} / 05`,16,C.muted)}</g></svg>`}
const diagrams=[]
diagrams.push(['01-journey',sheet('01','从第一次入住，到愿意再回来','现有主流程｜你不扮演某个居民，而是观察他们、认识他们、适度介入。',
 pill(48,175,225,'已有流程 · 非新功能提案')+
 card(48,233,340,205,'01 · 进入','先认识这个世界',['注册或登录','认识观察者与管理者','知道这里是一群人的家'])+
 card(430,233,340,205,'02 · 安排居民','创造想关心的人',['随机默认两位，可自行修改','至少 2 人，最多 8 人','性格、关系、习惯有差别'])+
 card(812,233,340,205,'03 · 一起入住','来到共享住宅',['公共客厅、厨房和浴室','各自有私人卧室','从城市概况看大家在哪里'])+
 arrow('390,335 425,335')+arrow('772,335 807,335')+arrow('982,440 982,505')+
 card(812,510,340,205,'04 · 发现','跟随一个居民',['看他走动、做事或等待','进入住宅观察生活','发现两人之间的一件事'])+
 card(430,510,340,205,'05 · 参与','旁观，也可以建议',['看清谁遇到了什么问题','选择支持、调解或不介入','居民不一定听从你的建议'])+
 card(48,510,340,205,'06 · 看见后果','这件事留下什么',['看到回应和实际结果','关系、家务或记忆有变化','不是每件事都皆大欢喜'])+
 arrow('810,612 775,612')+arrow('428,612 393,612')+
 arrow('218,718 218,773')+rect(48,780,1104,145,C.green)+text(75,820,'再次回来，不是重新开始',28,C.ink,650)+text(75,860,['看今天谁在做什么，也看之前发生的事留下了什么影响。','引导尚无合适故事时允许继续观察；不强制制造冲突，不保证每天送事件。'],21)
)])
diagrams.push(['02-life-loop',sheet('02','“生活感”来自原因、行动和后果','已有玩法骨架｜日常可以平静，只有相遇、争用或边界问题才可能成为故事。',
 card(48,198,340,160,'原因 A','他是怎样的人',['性格、习惯、兴趣、目标'])+
 card(430,198,340,160,'原因 B','他现在需要什么',['饥饿、疲劳、陪伴、独处'])+
 card(812,198,340,160,'原因 C','周围是什么情况',['地点、资源、别人和关系'])+
 arrow('218,360 218,390 600,390',false)+arrow('600,360 600,418')+arrow('982,360 982,390 600,390',false)+
 rect(185,426,830,127,C.green)+text(218,469,'决定去做一件事',29,C.ink,650)+text(218,510,'前往地点 → 做事；遇到占用 → 等待、协商或换计划',22)+
 arrow('600,555 600,584 218,584 218,608')+arrow('600,555 600,608')+arrow('600,584 982,584 982,608')+
 card(48,616,340,164,'可能 A · 平静日常','一个人也在生活',['读书、休息、吃饭、洗澡','不需要每次都出现事件'])+
 card(430,616,340,164,'可能 B · 联系','和别人一起做事',['分享食物、聊天、陪伴','亲近来自具体共同经历'])+
 card(812,616,340,164,'可能 C · 摩擦','彼此的需要冲突',['争用厨房、借物、家务','玩家可旁观或有限介入'])+
 arrow('218,782 218,804 600,804',false)+arrow('600,782 600,828')+arrow('982,782 982,804 600,804',false)+
 rect(48,836,1104,91,C.green)+text(75,872,'事情结束 → 人与家庭留下变化 → 影响下一次选择',27,C.ink,650)+text(75,908,'不必次次加好感：也可以保留分歧、拒绝、和解或新的期待。',21)+arrow('48,881 24,881 24,489 177,489')
)])
diagrams.push(['03-social-scene',sheet('03','一件小事，怎样变成有“人味”的戏','设计示例｜以下对白与分支用于讨论体验，并非本轮已实现或实测的具体事件。',
 pill(48,175,210,'建议设计 · 共餐小故事','proposed')+
 card(48,233,525,160,'角色 A · 认真，重视公平','Aria 做好了晚饭',['她想被分担，而不只是被说一句谢谢。'],'proposed')+
 card(627,233,525,160,'角色 B · 随性，但今天疲惫','Nora 想吃饭后休息',['她不是故意占便宜，也不想立刻洗碗。'],'proposed')+
 arrow('310,395 310,425 600,425 600,450')+arrow('890,395 890,425 600,425',false)+
 rect(48,458,1104,182,C.white)+text(75,498,'冲突要来自眼前的小事，下一句要接上一句',27,C.ink,650)+
 text(75,543,['Aria：“饭在锅里。今天的碗，你来？”','Nora：“能晚一点吗？我今天真累。”','Aria：“可以。但别又留到明早。”'],22)+
 arrow('600,642 600,670 218,670 218,697')+arrow('600,642 600,697')+arrow('600,670 982,670 982,697')+
 card(48,705,340,174,'选择 A','先不插手',['让两人自己谈','不替他们判断谁对谁错'],'proposed')+
 card(430,705,340,174,'选择 B','建议晚点洗',['照顾疲劳，也承认责任','不是一句“别吵了”'],'proposed')+
 card(812,705,340,174,'选择 C','建议分着做',['可能接受，也可能拒绝','玩家建议不是强制命令'],'proposed')+
 rect(48,910,1104,123,C.orange)+text(75,950,'真正的结果要落在行动上，而不只落在台词里',27,C.ink,650)+text(75,991,'可能：洗完了、拖延了、有人帮忙，或不满延续；下次互动能看出区别。',22)
,1140)])
diagrams.push(['04-conversations',sheet('04','从“报告状态”，变成真的在和人聊天','左边是当前实现的限制；右边是下一步希望玩家感受到的体验。',
 pill(48,179,250,'当前：三种说话各走一套')+pill(627,179,245,'建议：统一人物与情境','proposed')+
 card(48,245,490,180,'进入角色会话','同一活动，常常同一句',['第一句按行动选择固定文案','两人都读书，就可能一模一样'])+
 card(662,245,490,180,'希望获得的体验','第一句就能认出这个人',['此刻在做什么＋对你的态度','带出一个具体、可以接的话题'],'proposed')+arrow('547,335 650,335')+
 card(48,475,490,180,'玩家继续说话','有角色资料，但承接仍显泛',['回复会参考人物、历史与记忆','仍可能套话，失败会用固定回复'])+
 card(662,475,490,180,'希望获得的体验','先接你的话，再推进话题',['简短也可以，不用每句都提问','记住没说完的事，也允许换话题'],'proposed')+arrow('547,565 650,565')+
 card(48,705,490,180,'NPC 之间说话','整段由有限台词拼出来',['常规双人场景固定五个片段','有口吻差异，但仍可能各说各话'])+
 card(662,705,490,180,'希望获得的体验','有立场，也有接话与留白',['朋友能打趣，生气时不强行和好','短戏自然收尾，长戏确有新进展'],'proposed')+arrow('547,795 650,795')+
 text(48,940,'共同底线：不捏造发生过的事，不替玩家决定，不靠聊天随意改写生活结果。',22,C.ink,600)
,1050)])
diagrams.push(['05-roadmap',sheet('05','接下来先打磨什么，怎样算做好了','设计建议｜先让少量人物与场景值得关心，再增加职业、地点和更多内容。',
 rect(48,205,1104,201,C.orange)+pill(74,230,185,'先做 · 对话可信','proposed')+text(74,309,'人物化开场 ＋ 连续话题',31,C.ink,650)+text(74,353,'想解决：两人同一句、答非所问、每轮都像第一次见。',22)+
 text(737,273,'玩家验收',19,C.rust,650)+text(737,318,['两人做同一件事，也有不同口吻','连续聊几轮，能接住前面的话','换行动后，不再聊过时的现场'],21)+
 arrow('600,411 600,446')+
 rect(48,454,1104,201,C.white)+pill(74,479,185,'接着做 · 一场好戏','proposed')+text(74,558,'两人互动 ＋ 具体后果',31,C.ink,650)+text(74,602,'先完整打磨“做饭—分担—回应—事后变化”。',22)+
 text(737,522,'玩家验收',19,C.rust,650)+text(737,567,['双方的话能相互接上','可以拒绝，不必强行和好','能说清自己的参与改变了什么'],21)+
 arrow('600,660 600,695')+
 rect(48,703,1104,201,C.white)+pill(74,728,185,'再扩展 · 持续牵挂','proposed')+text(74,807,'关系余波 ＋ 次日回访',31,C.ink,650)+text(74,851,'之后再拓展地点、职业、爱好和群体故事。',22)+
 text(737,771,'玩家验收',19,C.rust,650)+text(737,816,['再次回来，有想去看的人','之前的事影响了今天的相处','内容变多，但不需要更多说明'],21)+
 text(48,960,'核心问题：不用读说明，玩家能否说清“谁想做什么、我做了什么、后来怎样”？',22,C.ink,600)
,1070)])

await mkdir(output,{recursive:true})
for(const [name,svg] of diagrams)await writeFile(resolve(output,`${name}.svg`),svg)
console.log(`Generated ${diagrams.length} editable SVG diagrams.`)
if(process.argv.includes('--png')){
 const {openQaPage}=await import('../../web/scripts/browser-cdp.mjs')
 const page=await openQaPage()
 try{
  for(const [name] of diagrams){
   const svg=await readFile(resolve(output,`${name}.svg`),'utf8')
   const height=Number(svg.match(/height="(\d+)"/)[1])
   await page.call('Emulation.setDeviceMetricsOverride',{width:1200,height,deviceScaleFactor:1.5,mobile:false})
   await page.call('Page.navigate',{url:pathToFileURL(resolve(output,`${name}.svg`)).href})
   for(let i=0;i<100;i++){
    if(await page.evaluate(`document.documentElement.tagName==='svg' && location.href.includes(${JSON.stringify(name)})`))break
    await new Promise(r=>setTimeout(r,50))
   }
   await page.evaluate('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))')
   const bounds=await page.evaluate(`(()=>{const root=document.documentElement;const bad=[...document.querySelectorAll('text')].filter(t=>{const b=t.getBBox();return b.x<0||b.y<0||b.x+b.width>1200||b.y+b.height>${height}});return {root:root.tagName,bad:bad.map(t=>t.textContent)}})()`)
   if(bounds.root!=='svg'||bounds.bad.length)throw new Error(`Diagram bounds failure ${name}: ${JSON.stringify(bounds)}`)
   const shot=await page.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})
   await writeFile(resolve(output,`${name}.png`),Buffer.from(shot.data,'base64'))
   console.log(`${name}.png rendered, text within canvas`)
  }
  if(page.errors.length||page.consoleErrors.length)throw new Error(JSON.stringify([page.errors,page.consoleErrors]))
 }finally{await page.close()}
}
