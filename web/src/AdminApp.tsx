import {type FormEvent,useCallback,useEffect,useState} from 'react'
import {adminApi,ApiError} from './api'
import type {AdminSummary,AdminUser,AgentTrace,InviteRecord} from './types'
import {AdminRosterMigrationPanel} from './components/AdminRosterMigrationPanel'
import {AdminWorldLayoutEditor} from './components/AdminWorldLayoutEditor'
import './AdminRefinements.css'

const date=(value?:string|null)=>value?new Intl.DateTimeFormat('zh-CN',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value.includes('T')?value:`${value.replace(' ','T')}Z`)):'从未'
const quota=(user:AdminUser)=>`今日剩余 ${user.quota.remaining} 条${user.quota.bonus_credits?`（赠送余额 ${user.quota.bonus_credits}）`:''}`
const isOnboardingTestUser=(user:AdminUser)=>{const username=user.username.normalize('NFKC').toLowerCase();return username==='onboarding-test'||username.startsWith('onboarding-test-')}
const migrationStatusText=(value:string)=>(({ready:'已验证',needs_onboarding:'待补角色',needs_roster_review:'待审核',blocked_invalid_fixture:'存档异常',blocked_verification_failed:'校验失败'} as Record<string,string>)[value]??value)

export function AdminApp(){
 const [authenticated,setAuthenticated]=useState(false),[checking,setChecking]=useState(true),[password,setPassword]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const [summary,setSummary]=useState<AdminSummary|null>(null),[users,setUsers]=useState<AdminUser[]>([]),[query,setQuery]=useState(''),[invites,setInvites]=useState<InviteRecord[]>([]),[traces,setTraces]=useState<AgentTrace[]>([]),[inviteCount,setInviteCount]=useState(5),[busy,setBusy]=useState(false)
 const load=useCallback(async(q='')=>{try{const [s,u,i,a]=await Promise.all([adminApi.summary(),adminApi.users(q),adminApi.unusedInvites(),adminApi.agentTraces(50)]);setSummary(s);setUsers(u.users);setInvites(i.invites);setTraces(a.traces)}catch(cause){if(cause instanceof ApiError&&cause.status===401)setAuthenticated(false);else setError('无法加载管理数据，请稍后重试。')}},[])
 useEffect(()=>{adminApi.session().then(()=>{setAuthenticated(true);void load()}).catch(()=>setAuthenticated(false)).finally(()=>setChecking(false))},[load])
 const login=async(e:FormEvent)=>{e.preventDefault();setBusy(true);setError('');setNotice('');try{await adminApi.login(password);setPassword('');setAuthenticated(true);await load()}catch{setError('密码错误或尝试次数过多，请稍后再试。')}finally{setBusy(false)}}
 const update=async(user:AdminUser,body:{disabled?:boolean;quota_delta?:number})=>{setBusy(true);setError('');setNotice('');try{await adminApi.updateUser(user.id,body);await load(query)}catch{setError('无法更新用户。')}finally{setBusy(false)}}
 const createInvites=async()=>{setBusy(true);setError('');setNotice('');try{await adminApi.invites(inviteCount,30);await load(query)}catch{setError('无法创建邀请码。')}finally{setBusy(false)}}
 const resetOnboarding=async(user:AdminUser)=>{
  const confirmation=window.prompt(`危险操作：重置“${user.username}”的存档与新手流程\n\n将永久删除该账号的全部角色、对话、关系、生活事件、学习记录和世界进度。账号、密码、邀请码资格、AI 额度和审计记录会保留。\n\n请输入完整用户名 ${user.username} 以确认：`)
  if(confirmation===null)return
  if(confirmation!==user.username){setNotice('');setError('用户名不完全匹配，未执行任何删除操作。');return}
  setBusy(true);setError('');setNotice('')
  try{
   await adminApi.resetOnboarding(user.id,{confirm_username:confirmation})
   await load(query)
   setNotice(`账号“${user.username}”已重置。账号和密码仍然有效，下次登录会重新进入新手引导。`)
  }catch(cause){setError(cause instanceof ApiError?`无法重置新手流程：${cause.message}`:'无法重置新手流程，请稍后重试。')}
  finally{setBusy(false)}
 }
 if(checking)return <main className="admin-login"><p>正在检查安全会话…</p></main>
 if(!authenticated)return <main className="admin-login"><form onSubmit={login}><p className="admin-mark">LL</p><h1>内测管理后台</h1><p>仅限管理员访问。登录状态保存在安全的 HttpOnly Cookie 中。</p><label>管理密码<input type="password" required autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<p className="gate-error">{error}</p>}<button disabled={busy}>{busy?'正在验证…':'登录'}</button></form></main>
 return <main className="admin"><nav><div><b>LingoLife</b><span>内测管理后台</span></div><button onClick={async()=>{await adminApi.logout();setAuthenticated(false)}}>退出登录</button></nav><section className="admin-body"><header><div><p className="eyebrow">实时概览</p><h1>内测运营</h1></div><button onClick={()=>void load(query)}>刷新</button></header>{error&&<p className="admin-alert" role="alert">{error}</p>}{notice&&<p className="admin-notice" role="status">{notice}</p>}
 <div className="summary">{([['用户总数',summary?.total_users],['今日活跃',summary?.active_today],['今日 AI 对话',summary?.chats_today],['已禁用',summary?.disabled_users]] as const).map(([label,value])=><article key={label}><span>{label}</span><strong>{value??'—'}</strong></article>)}</div>
 <AdminRosterMigrationPanel/>
 <AdminWorldLayoutEditor/>
 <section className="admin-panel"><div className="panel-head"><div><h2>内测用户</h2><p>名称为 onboarding-test 或 onboarding-test-* 的专用测试账号可重复重置，无需重新消耗邀请码；账号、密码、额度和审计记录会保留。</p></div><form onSubmit={e=>{e.preventDefault();void load(query)}}><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索用户名"/><button>搜索</button></form></div><div className="table-wrap"><table><thead><tr><th>用户</th><th>最后活跃</th><th>今日额度</th><th>迁移</th><th>状态</th><th>操作</th></tr></thead><tbody>{users.map(user=><tr key={user.id}><td><b>{user.username}</b><small>#{user.id}</small></td><td>{date(user.last_active_at)}</td><td>{quota(user)}</td><td>{user.roster_migration?<><span className={`tag ${user.roster_migration.status==='ready'?'on':'off'}`}>{migrationStatusText(user.roster_migration.status)}</span><small>{user.roster_migration.active_resident_count}/{user.roster_migration.total_resident_count} 模拟中</small></>:'—'}</td><td><span className={`tag ${user.disabled?'off':'on'}`}>{user.disabled?'已禁用':'正常'}</span></td><td className="controls"><button disabled={busy} onClick={()=>void update(user,{quota_delta:10})}>赠送 10 条</button><button disabled={busy} onClick={()=>void update(user,{disabled:!user.disabled})}>{user.disabled?'启用':'禁用'}</button>{isOnboardingTestUser(user)&&<button className="admin-danger-button" disabled={busy} onClick={()=>void resetOnboarding(user)}>重置存档 / 新手流程</button>}</td></tr>)}</tbody></table>{!users.length&&<p className="no-data">没有找到用户。</p>}</div></section>
 <section className="admin-panel invite-panel"><div><h2>邀请码</h2><p>每个邀请码只能注册一个唯一账号，使用后会自动从列表消失。</p></div><div className="invite-create"><label>创建数量<input type="number" min="1" max="100" value={inviteCount} onChange={event=>setInviteCount(Math.max(1,Math.min(100,Number(event.target.value)||1)))}/></label><button disabled={busy} onClick={()=>void createInvites()}>{busy?'处理中…':'创建邀请码'}</button></div><div className="invite-list"><div className="invite-list-title"><b>未使用邀请码</b><span>{invites.length} 个</span></div>{invites.map(invite=><code key={invite.code}><b>{invite.code}</b><small>每日 {invite.daily_quota} 条 · 创建于 {date(invite.created_at)}</small></code>)}{!invites.length&&<p className="no-data">暂无未使用的邀请码。</p>}</div></section>
 <section className="admin-panel agent-traces"><div className="panel-head"><div><h2>Agent 运行记录</h2><p>用于检查人格版本、记忆召回、延迟与降级情况，不保存聊天正文。</p></div></div><div className="table-wrap"><table><thead><tr><th>用户 / 角色</th><th>模型</th><th>人格</th><th>延迟</th><th>记忆</th><th>状态</th><th>时间</th></tr></thead><tbody>{traces.map(trace=><tr key={trace.id}><td><b>{trace.username||'未知用户'}</b><small>{trace.npc_id}</small></td><td>{trace.model||'—'}</td><td><small>{trace.persona_version||'—'}</small></td><td>回复 {trace.dialogue_ms}ms<small>分析 {trace.analysis_ms}ms</small></td><td>{trace.memory_ids.length} 条</td><td><span className={`tag ${trace.fallback_used?'off':'on'}`}>{trace.fallback_used?'已降级':'正常'}</span>{trace.error_type&&<small>{trace.error_type}</small>}</td><td>{date(trace.created_at)}</td></tr>)}</tbody></table>{!traces.length&&<p className="no-data">还没有 Agent 对话记录。</p>}</div></section>
 </section></main>
}
