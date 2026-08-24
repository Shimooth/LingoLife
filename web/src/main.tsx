import { lazy,StrictMode,Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import {LanguageProvider} from './i18n'
import {RootErrorBoundary} from './RootErrorBoundary'
import {BrandedStartupShell} from './components/BrandedStartupShell'
import './styles.css'
// Never expose the admin surface on the player hostname, even via a URL flag.
const admin=window.location.hostname==='lingolife.admin.shimooth.me'
const AdminApp=lazy(()=>import('./AdminApp').then(module=>({default:module.AdminApp})))
const AuthGate=lazy(()=>import('./AuthGate').then(module=>({default:module.AuthGate})))
// Returning players download the 3D experience in parallel with session setup.
try{if(!admin&&localStorage.getItem('lingolife.session-token'))void import('./App')}catch{/* restricted storage: AuthGate remains usable */}
const startupLanguage=(()=>{try{return (localStorage.getItem('lingolife.language')||navigator.language).toLowerCase().startsWith('zh')?'zh':'en'}catch{return 'zh'}})()
const startupMessage=admin
 ?(startupLanguage==='zh'?'正在打开管理中心…':'Opening the management centre…')
 :(startupLanguage==='zh'?'正在唤醒天空之城…':'Waking up the sky city…')
const loading=<BrandedStartupShell message={startupMessage}/>
createRoot(document.getElementById('root')!).render(<StrictMode><RootErrorBoundary><Suspense fallback={loading}>{admin?<AdminApp/>:<LanguageProvider><AuthGate/></LanguageProvider>}</Suspense></RootErrorBoundary></StrictMode>)
