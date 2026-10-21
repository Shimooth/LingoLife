import {useLayoutEffect} from 'react'
import {flushSync} from 'react-dom'
import {createRoot} from 'react-dom/client'
import {session} from '../../src/api'
import {useNeighborhood} from '../../src/neighborhood/useNeighborhood'
import type {NeighborhoodCommand,NeighborhoodState} from '../../src/neighborhood/types'

// Never forward fetch: this fixture cannot read or modify a real account.
const OWNER='qa-neighborhood-owner-a',OTHER='qa-neighborhood-owner-b',USER='qa-neighborhood-user'
const STORAGE=`lingolife.neighborhood.pending.${USER}`
const root=createRoot(document.getElementById('root')!)
type Hook=ReturnType<typeof useNeighborhood>
type RequestRecord={method:string;body:NeighborhoodCommand&{idempotency_key?:string};owner:'original'|'changed'|'missing'}
type Outcome={ok:boolean;value?:NeighborhoodState;error?:unknown}
type CaseName='queued_old_account'|'delayed_get'|'lost_response'|'recover_original_account'|'unknown_then_401'
type Report={name:CaseName;checks:string[];requests:number;commits?:number}
let hook:Hook|null=null,generation=0,requests:RequestRecord[]=[],checks:string[]=[],running=false
let handler:(request:RequestRecord)=>Promise<Response>=async()=>json(state())
const json=(value:unknown,status=200)=>Promise.resolve(new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}}))
const state=(revision=1,receipt?:NeighborhoodState['last_receipt']):NeighborhoodState=>({version:1,revision,enabled:true,coins:100, residents:[],unlocks:{fountain:true,clothing_store:false,resident_slots:2},wishes:{available:1,earned:1,spent:0},gift_catalog:[],gifts:{},clothing_catalog:[],wardrobe:{},food_catalog:[],food_inventory:{},news:[],meetings:[],scenes:[],last_receipt:receipt})
window.fetch=async(input,init)=>{
 const url=typeof input==='string'?input:input instanceof URL?input.href:input.url
 if(!/^\/api\/v1\/neighborhood(?:\/command)?$/.test(url))throw new Error(`Unexpected fixture network request: ${url}`)
 const auth=new Headers(init?.headers).get('Authorization')
 const request:RequestRecord={method:init?.method??'GET',body:JSON.parse(typeof init?.body==='string'?init.body:'{}'),owner:auth===`Bearer ${OWNER}`?'original':auth? 'changed':'missing'}
 requests.push(request)
 return handler(request)
}
const pause=()=>new Promise(resolve=>setTimeout(resolve,0))
const until=async(predicate:()=>boolean)=>{for(let count=0;count<1000;count++){if(predicate())return;await pause()}throw new Error('Fixture condition timed out')}
const requireHook=()=>{if(!hook)throw new Error('Hook is not mounted');return hook}
const check=(condition:unknown,message:string)=>{if(!condition)throw new Error(message);checks.push(message)}
const settle=(promise:Promise<NeighborhoodState>):Promise<Outcome>=>promise.then(value=>({ok:true,value}),error=>({ok:false,error}))
const pending=():[string,string][]=>JSON.parse(sessionStorage.getItem(STORAGE)||'[]')
const keyFor=(intent:NeighborhoodCommand)=>pending().find(([fingerprint])=>JSON.parse(fingerprint).action===intent.action)?.[1]
export function Harness(){
 const value=useNeighborhood(USER,'en',false)
 useLayoutEffect(()=>{hook=value})
 return <pre aria-label="Hook state">{JSON.stringify({revision:value.state?.revision??null,busy:value.busy,error:value.error},null,2)}</pre>
}
const unmount=()=>{flushSync(()=>root.render(null));hook=null}
const mount=()=>{flushSync(()=>root.render(<Harness key={++generation}/>));return requireHook()}
const reset=()=>{unmount();session.save(OWNER);sessionStorage.removeItem(STORAGE);requests=[];checks=[];mount()}
const wish:NeighborhoodCommand={action:'wish',item_id:'sketchbook'}
let recoveryKey='',commits=0
const receipts=new Map<string,NeighborhoodState>()
const commit=(request:RequestRecord)=>{
 const key=request.body.idempotency_key
 if(!key)throw new Error('Missing command idempotency key')
 if(!receipts.has(key)){commits++;receipts.set(key,state(commits+1,{id:key,action:request.body.action,item_id:request.body.item_id}))}
 return receipts.get(key)!
}
const tests:Record<CaseName,()=>Promise<void>>={
 async queued_old_account(){
  reset()
  let release:(value:Response)=>void=()=>{}
  handler=()=>new Promise(resolve=>{release=resolve})
  const original=requireHook(),first=settle(original.command(wish)),second=settle(original.command({action:'buy_food',item_id:'toast'}))
  await until(()=>requests.length===1)
  session.save(OTHER)
  release(await json(state(9)))
  const outcomes=await Promise.all([first,second]);await pause()
  check(requests.length===1,'Queued command from the old account never reaches fetch')
  check(!outcomes[1].ok,'Queued command rejects after an account change')
  check(requireHook().state===null,'Late command response cannot populate the changed account')
 },
 async delayed_get(){
  reset()
  let release:(value:Response)=>void=()=>{}
  handler=()=>new Promise(resolve=>{release=resolve})
  const result=settle(requireHook().refresh())
  await until(()=>requests.length===1)
  session.save(OTHER)
  release(await json(state(77)))
  const response=await result;await pause()
  check(!response.ok,'A GET completing after an account change rejects')
  check(requireHook().state===null,'Delayed GET does not replace the mounted account state')
  const following=await settle(requireHook().refresh())
  check(!following.ok&&requests.length===1,'A stale mounted hook does not issue a GET using the new token')
 },
 async lost_response(){
  reset();receipts.clear();commits=0
  let lose:(reason:Error)=>void=()=>{}
  handler=request=>{commit(request);return new Promise((_resolve,reject)=>{lose=reject})}
  const result=settle(requireHook().command(wish))
  await until(()=>requests.length===1)
  recoveryKey=requests[0].body.idempotency_key!
  session.save(OTHER)
  lose(new TypeError('Synthetic response loss after commit'))
  const outcome=await result
  check(!outcome.ok,'Lost response plus account change interrupts retry')
  check(requests.length===1&&commits===1,'Account change prevents a second request after the committed response was lost')
  check(keyFor(wish)===recoveryKey,'Uncertain committed operation keeps its original durable key')
 },
 async recover_original_account(){
  checks=[]
  check(Boolean(recoveryKey),'Previous lost-response scenario created a recovery key')
  unmount();session.save(OWNER);mount()
  const before=requests.length
  handler=request=>json(commit(request))
  const result=await settle(requireHook().command(wish));await pause()
  check(result.ok,'Remounted original account recovers the interrupted operation')
  check(requests.length===before+1&&requests.at(-1)?.body.idempotency_key===recoveryKey,'Recovery sends exactly one request using the persisted original key')
  check(commits===1,'Recovery does not commit or charge the operation twice')
  check(pending().length===0,'Acknowledged recovery removes the pending key')
 },
 async unknown_then_401(){
  reset();receipts.clear();commits=0
  handler=request=>{if(requests.length===1){commit(request);return Promise.reject(new TypeError('Synthetic response loss after commit'))}return json({error:{message:'Synthetic expired session'}},401)}
  const first=await settle(requireHook().command(wish)),key=requests[0].body.idempotency_key!
  check(!first.ok&&requests.length===2,'An unknown first outcome followed by a real HTTP 401 rejects')
  check(keyFor(wish)===key,'HTTP 401 after an unknown attempt preserves the pending key')
  const second=await settle(requireHook().command(wish))
  check(!second.ok&&requests.at(-1)?.body.idempotency_key===key,'Separate command invocation reuses the unresolved key')
  check(keyFor(wish)===key,'A later HTTP 401 cannot erase an earlier uncertain outcome')
  unmount();session.save(OWNER);mount()
  handler=request=>json(commit(request))
  const recovered=await settle(requireHook().command(wish))
  check(recovered.ok&&requests.at(-1)?.body.idempotency_key===key&&commits===1,'Remount recovery after repeated 401s settles once with the original key')
 }
}
const run=async(name:CaseName):Promise<Report>=>{
 if(running)throw new Error('A recovery check is already running')
 running=true
 try{await tests[name]();const report={name,checks:[...checks],requests:requests.length,...(['lost_response','recover_original_account','unknown_then_401'].includes(name)?{commits}:{})};document.getElementById('report')!.textContent=JSON.stringify(report,null,2);return report}
 finally{running=false}
}
declare global{interface Window{__neighborhoodRecoveryQa:{run:typeof run;cases:CaseName[];snapshot:()=>unknown;cleanup:()=>void}}}
window.__neighborhoodRecoveryQa={run,cases:Object.keys(tests) as CaseName[],snapshot:()=>({state:hook?.state??null,busy:hook?.busy??false,requests:requests.length,pending:pending().length}),cleanup:()=>{unmount();session.clear();sessionStorage.removeItem(STORAGE)}}
for(const name of Object.keys(tests) as CaseName[]){const button=document.createElement('button');button.textContent=name;button.onclick=()=>{void run(name).catch(error=>{document.getElementById('report')!.textContent=String(error)})};document.getElementById('controls')!.append(button)}
reset()
