import { lazy,StrictMode,Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import {LanguageProvider} from './i18n'
import './styles.css'
// Never expose the admin surface on the player hostname, even via a URL flag.
const admin=window.location.hostname==='lingolife.admin.shimooth.me'
const AdminApp=lazy(()=>import('./AdminApp').then(module=>({default:module.AdminApp})))
const AuthGate=lazy(()=>import('./AuthGate').then(module=>({default:module.AuthGate})))
const loading=<main className="gate"><p className="gate-loading">LingoLife…</p></main>
createRoot(document.getElementById('root')!).render(<StrictMode><Suspense fallback={loading}>{admin?<AdminApp/>:<LanguageProvider><AuthGate/></LanguageProvider>}</Suspense></StrictMode>)
