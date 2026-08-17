import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import {AdminApp} from './AdminApp'
import {AuthGate} from './AuthGate'
import './styles.css'
// Never expose the admin surface on the player hostname, even via a URL flag.
const admin=window.location.hostname==='lingolife.admin.shimooth.me'
createRoot(document.getElementById('root')!).render(<StrictMode>{admin?<AdminApp/>:<AuthGate/>}</StrictMode>)
