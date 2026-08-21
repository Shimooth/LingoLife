import {lazy,Suspense,type FormEvent,useEffect,useState} from 'react'
import {motion,useReducedMotion} from 'motion/react'
import {ApiError,api,session} from './api'
import type {Quota,User} from './types'
import {useLanguage} from './i18n'
import './AuthGate.css'

const App=lazy(()=>import('./App'))

export function AuthGate(){
 const reduce=useReducedMotion(),{t,language}=useLanguage()
 const [user,setUser]=useState<User|null>(null),[quota,setQuota]=useState<Quota|null>(null),[checking,setChecking]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const [mode,setMode]=useState<'login'|'register'>('login'),[username,setUsername]=useState(''),[password,setPassword]=useState(''),[code,setCode]=useState('')
 useEffect(()=>{if(!session.token()){setChecking(false);return}api.me().then(data=>{setUser(data.user);setQuota(data.quota)}).catch(()=>session.clear()).finally(()=>setChecking(false))},[])
 const submit=async(event:FormEvent)=>{event.preventDefault();setBusy(true);setError('');try{const data=mode==='login'?await api.login(username.trim(),password):await api.register(username.trim(),password,code.trim());session.save(data.session_token);setUser(data.user);setQuota(data.quota)}catch(cause){if(cause instanceof ApiError&&cause.code==='INVALID_CREDENTIALS')setError(language==='zh'?'用户名或密码不正确。':'Username or password is incorrect.');else if(cause instanceof ApiError&&cause.code==='USERNAME_TAKEN')setError(language==='zh'?'用户名已被使用。':'That username is already taken.');else if(cause instanceof ApiError&&cause.code==='INVALID_INVITE')setError(language==='zh'?'邀请码无效或已被使用。':'The invite code is invalid or already used.');else setError(cause instanceof ApiError?cause.message:t('error.network'))}finally{setBusy(false)}}
 if(checking)return <main className="gate"><p className="gate-loading">{t('common.loading')}</p></main>
 if(user&&quota)return <Suspense fallback={<main className="gate"><p className="gate-loading">LingoLife…</p></main>}><App user={user} initialQuota={quota} onLogout={()=>{setUser(null);setQuota(null)}}/></Suspense>
 // Keep the recovery surface visible even when Web Animations are paused.
 return <main className="gate"><motion.section className="gate-card" initial={false} animate={{opacity:1,y:0}}><div className="gate-art"><div className="gate-moon"/><span>✦</span><div className="gate-window"><i/><i/><i/></div></div><div className="gate-copy"><p className="eyebrow">LingoLife</p><h1>{mode==='login'?t('auth.loginTitle'):t('auth.title')}</h1><p>{mode==='login'?t('auth.loginSubtitle'):t('auth.subtitle')}</p><div className="auth-tabs"><button type="button" className={mode==='login'?'active':''} onClick={()=>{setMode('login');setError('')}}>{t('auth.login')}</button><button type="button" className={mode==='register'?'active':''} onClick={()=>{setMode('register');setError('')}}>{t('auth.register')}</button></div><form onSubmit={submit} className="gate-form"><label>{t('auth.username')}<input required minLength={3} maxLength={32} pattern="[A-Za-z0-9_-]+" autoComplete="username" value={username} onChange={event=>setUsername(event.target.value)} placeholder={t('auth.usernamePlaceholder')}/></label><label>{t('auth.password')}<input required maxLength={256} type="password" autoComplete={mode==='login'?'current-password':'new-password'} value={password} onChange={event=>setPassword(event.target.value)} placeholder={t('auth.passwordPlaceholder')}/></label>{mode==='register'&&<label>{t('auth.invite')}<input required autoCapitalize="characters" value={code} onChange={event=>setCode(event.target.value)} placeholder={t('auth.invitePlaceholder')}/></label>}{error&&<p className="gate-error" role="alert">{error}</p>}<motion.button disabled={busy} whileTap={reduce?undefined:{scale:.98}}>{busy?t('auth.entering'):(mode==='login'?t('auth.loginAction'):t('auth.enter'))}</motion.button></form><small>{t('auth.passwordStored')}</small></div></motion.section></main>
}
