import type {ChatResponse,Room} from './types'
const storageKey='lingolife.player-id'
const randomId=(prefix:string)=>`${prefix}-${crypto.randomUUID?.()??`${Date.now()}-${Math.random().toString(36).slice(2)}`}`
function playerId(){try{const saved=localStorage.getItem(storageKey);if(saved&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(saved))return saved;const id=randomId('web').slice(0,64);localStorage.setItem(storageKey,id);return id}catch{return randomId('guest').slice(0,64)}}
const player=playerId()
async function request<T>(path:string,init?:RequestInit):Promise<T>{const response=await fetch(`/api/v1${path}`,{...init,headers:{'X-Player-Id':player,...init?.headers}});const data=await response.json().catch(()=>null);if(!response.ok)throw new Error(data?.error?.message||"Emma couldn't hear you just now.");return data}
export const api={room:()=>request<Room>('/room'),chat:(message:string,key:string)=>request<ChatResponse>('/chat',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({message})}),key:()=>randomId('chat')}
