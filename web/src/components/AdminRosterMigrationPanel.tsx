import {useCallback,useEffect,useState} from 'react'
import {adminApi,ApiError} from '../api'
import type {RosterMigration,RosterMigrationStatus} from '../types'
import './AdminRosterMigrationPanel.css'

const statusText:Record<RosterMigrationStatus,string>={
 ready:'已验证',needs_onboarding:'等待补足角色',needs_roster_review:'需要阵容审核',
 blocked_invalid_fixture:'存档异常，已阻断',blocked_verification_failed:'迁移校验失败，已阻断',
}
const shortHash=(value?:string)=>value?`${value.slice(0,12)}…`:'—'

export function AdminRosterMigrationPanel(){
 const [migrations,setMigrations]=useState<RosterMigration[]>([])
 const [filter,setFilter]=useState<'all'|RosterMigrationStatus>('needs_roster_review')
 const [selected,setSelected]=useState<Record<string,string[]>>({})
 const [confirmations,setConfirmations]=useState<Record<string,string>>({})
 const [details,setDetails]=useState<Record<string,RosterMigration>>({})
 const [busy,setBusy]=useState<string|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const load=useCallback(async()=>{
  setError('')
  try{const result=await adminApi.rosterMigrations(filter==='all'?undefined:filter);setMigrations(result.migrations)}
  catch(cause){setError(cause instanceof ApiError?cause.message:'无法加载迁移审计。')}
 },[filter])
 useEffect(()=>{void load()},[load])
 const toggle=(migration:RosterMigration,npcId:string)=>{
  setSelected(current=>{const values=current[migration.player_id]??[];if(values.includes(npcId))return {...current,[migration.player_id]:values.filter(value=>value!==npcId)};if(values.length>=8){setError('一个模拟阵容最多 8 人。');return current}return {...current,[migration.player_id]:[...values,npcId]}})
 }
 const showDetails=async(migration:RosterMigration)=>{
  if(!migration.user_id)return
  setBusy(migration.player_id);setError('')
  try{const value=await adminApi.rosterMigration(migration.user_id);setDetails(current=>({...current,[migration.player_id]:value}))}
  catch(cause){setError(cause instanceof ApiError?cause.message:'无法读取审计报告。')}
  finally{setBusy(null)}
 }
 const submit=async(migration:RosterMigration)=>{
  if(!migration.user_id||!migration.username){setError('该存档没有关联账号，暂时不能选择阵容。');return}
  const active=selected[migration.player_id]??[]
  if(active.length<2||active.length>8){setError('请明确勾选 2–8 位活跃角色。');return}
  if(confirmations[migration.player_id]!==migration.username){setError(`请输入完整用户名 ${migration.username} 以确认。`);return}
  setBusy(migration.player_id);setError('');setNotice('')
  try{
   const result=await adminApi.selectRoster(migration.user_id,{active_npc_ids:active,expected_revision:migration.revision,confirm_username:migration.username,note:'管理员在迁移审核页确认活跃阵容；其余角色仅归档，不删除任何数据。',request_key:`roster-${crypto.randomUUID?.()??Date.now()}`})
   setNotice(`已启用 ${result.active_npc_ids.length} 位角色，归档 ${result.archived_npc_ids.length} 位；原始角色和历史数据均保留。`)
   setSelected(current=>({...current,[migration.player_id]:[]}));setConfirmations(current=>({...current,[migration.player_id]:''}));await load()
  }catch(cause){setError(cause instanceof ApiError?cause.message:'阵容选择失败，数据库未发生变更。')}
  finally{setBusy(null)}
 }
 return <section className="admin-panel roster-audit">
  <div className="panel-head"><div><h2>旧账号迁移审计</h2><p>迁移到单一共享住宅。超过 8 人必须人工选择模拟阵容；未选中的角色仅归档，档案、关系、消息、记忆与事件不会删除。</p></div><div className="roster-audit__filters"><select aria-label="审计状态" value={filter} onChange={event=>setFilter(event.target.value as typeof filter)}><option value="needs_roster_review">待审核</option><option value="blocked_invalid_fixture">异常存档</option><option value="ready">已验证</option><option value="needs_onboarding">待补角色</option><option value="all">全部</option></select><button onClick={()=>void load()}>刷新</button></div></div>
  {error&&<p className="admin-alert" role="alert">{error}</p>}{notice&&<p className="admin-notice" role="status">{notice}</p>}
  <div className="roster-audit__list">{migrations.map(migration=>{const picked=selected[migration.player_id]??[];const detail=details[migration.player_id];return <article key={migration.player_id} className={`roster-audit__card is-${migration.status}`}>
   <header><div><strong>{migration.username||'未关联账号'}</strong><small>{migration.player_id}</small></div><span>{statusText[migration.status]}</span></header>
   <div className="roster-audit__metrics"><span>总角色 <b>{migration.candidates.length}</b></span><span>启用 <b>{migration.active_npc_ids.length}</b></span><span>归档 <b>{migration.archived_npc_ids.length}</b></span><span>报告 <b>{migration.report_count}</b></span><span>基线 <code>{shortHash(migration.baseline_snapshot.protected_facts_sha256)}</code></span></div>
   <div className="roster-audit__candidates">{migration.candidates.map(candidate=><label key={candidate.id} className={candidate.active?'is-active':candidate.archived?'is-archived':''}><input type="checkbox" disabled={migration.status!=='needs_roster_review'} checked={migration.status==='needs_roster_review'?picked.includes(candidate.id):candidate.active} onChange={()=>toggle(migration,candidate.id)}/><span><b>{candidate.name}</b><small>{candidate.id}{candidate.archived?' · 已归档':candidate.active?' · 模拟中':''}</small></span></label>)}</div>
   {migration.status==='needs_roster_review'&&<div className="roster-audit__confirm"><p>已选择 {picked.length}/8。请输入账号用户名确认；此操作不会删除任何角色。</p><input aria-label={`确认 ${migration.username||migration.player_id}`} value={confirmations[migration.player_id]??''} onChange={event=>setConfirmations(current=>({...current,[migration.player_id]:event.target.value}))} placeholder={migration.username||'用户名'}/><button disabled={busy===migration.player_id||picked.length<2} onClick={()=>void submit(migration)}>{busy===migration.player_id?'保存中…':'确认活跃阵容'}</button></div>}
   {migration.integrity.issues.length>0&&<ul className="roster-audit__issues">{migration.integrity.issues.map((issue,index)=><li key={`${issue.code}-${index}`}><b>{issue.code}</b>{issue.table&&` · ${issue.table}`}{issue.npc_ids?.length?` · ${issue.npc_ids.join(', ')}`:''}</li>)}</ul>}
   <footer><button disabled={!migration.user_id||busy===migration.player_id} onClick={()=>void showDetails(migration)}>{detail?'刷新审计详情':'查看审计详情'}</button></footer>
   {detail?.reports&&<div className="roster-audit__reports">{detail.reports.map(report=><details key={report.id}><summary><b>{report.action}</b><span>{report.comparison.verified?'校验通过':'校验失败'} · {report.created_at}</span></summary><p>前：<code>{shortHash(report.comparison.before_sha256)}</code><span> · 后：</span><code>{shortHash(report.comparison.after_sha256)}</code></p><p>受保护表 {Object.keys(report.before_snapshot.tables).length} 个；变化 {report.comparison.changed_tables.length} 个；意外变化 {report.comparison.unexpected_changes.length} 个。</p><small>{report.note}</small></details>)}</div>}
  </article>})}{!migrations.length&&<p className="no-data">当前筛选下没有迁移记录。</p>}</div>
 </section>
}
