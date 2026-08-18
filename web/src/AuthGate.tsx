import {type FormEvent,useEffect,useState} from 'react'
import {motion,useReducedMotion} from 'motion/react'
import App from './App'
import {ApiError,api,session} from './api'
import type {Quota,User} from './types'
import {useLanguage} from './i18n'

export function AuthGate(){
 const reduce=useReducedMotion(),[user,setUser]=useState<User|null>(null),[quota,setQuota]=useState<Quota|null>(null),[checking,setChecking]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[username,setUsername]=useState(''),[code,setCode]=useState('')
 const {t}=useLanguage()
 useEffect(()=>{if(!session.token()){setChecking(false);return}api.me().then(data=>{setUser(data.user);setQuota(data.quota)}).catch(()=>session.clear()).finally(()=>setChecking(false))},[])
 const submit=async(event:FormEvent)=>{event.preventDefault();setBusy(true);setError('');try{const data=await api.register(username.trim(),code.trim());session.save(data.session_token);setUser(data.user);setQuota(data.quota)}catch(cause){setError(cause instanceof ApiError?t('auth.error'):t('error.network'))}finally{setBusy(false)}}
 if(checking)return <main className="gate"><p className="gate-loading">{t('common.loading')}</p></main>
 if(user&&quota)return <App user={user} initialQuota={quota} onLogout={()=>{setUser(null);setQuota(null)}}/>
 return <main className="gate"><motion.section className="gate-card" initial={reduce?false:{opacity:0,y:18}} animate={{opacity:1,y:0}}><div className="gate-art"><div className="gate-moon"/><span>✦</span><div className="gate-window"><i/><i/><i/></div></div><div className="gate-copy"><p className="eyebrow">LingoLife</p><h1>{t('auth.title')}</h1><p>{t('auth.subtitle')}</p><form onSubmit={submit} className="gate-form"><label>{t('auth.username')}<input required minLength={3} maxLength={32} pattern="[A-Za-z0-9_-]+" autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} placeholder={t('auth.usernamePlaceholder')}/></label><label>{t('auth.invite')}<input required autoCapitalize="characters" value={code} onChange={e=>setCode(e.target.value)} placeholder={t('auth.invitePlaceholder')}/></label>{error&&<p className="gate-error" role="alert">{error}</p>}<motion.button disabled={busy} whileTap={reduce?undefined:{scale:.98}}>{busy?t('auth.entering'):t('auth.enter')}</motion.button></form><small>{t('settings.languageHint')}</small></div></motion.section></main>
}
