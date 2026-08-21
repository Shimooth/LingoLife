import { lazy,StrictMode,Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import {LanguageProvider} from './i18n'
import {RootErrorBoundary} from './RootErrorBoundary'
import './styles.css'
// Never expose the admin surface on the player hostname, even via a URL flag.
const admin=window.location.hostname==='lingolife.admin.shimooth.me'
const AdminApp=lazy(()=>import('./AdminApp').then(module=>({default:module.AdminApp})))
const AuthGate=lazy(()=>import('./AuthGate').then(module=>({default:module.AuthGate})))
// Returning players download the 3D experience in parallel with session setup.
try{if(!admin&&localStorage.getItem('lingolife.session-token'))void import('./App')}catch{/* restricted storage: AuthGate remains usable */}
const loading=<main className="gate startup-loading" role="status"><div className="startup-mark"><i/><i/><i/></div><p>LingoLife</p><small>正在唤醒小岛…</small></main>
createRoot(document.getElementById('root')!).render(<StrictMode><RootErrorBoundary><Suspense fallback={loading}>{admin?<AdminApp/>:<LanguageProvider><AuthGate/></LanguageProvider>}</Suspense></RootErrorBoundary></StrictMode>)
