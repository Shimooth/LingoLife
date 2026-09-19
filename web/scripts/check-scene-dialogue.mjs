import assert from 'node:assert/strict'
import {requestSceneDialogue,sceneOutcomeKey} from '../src/life/sceneDialogueRequest.ts'
import {storyCompletionCopy,completionLedger,storyCompletionKey} from '../src/life/storyCompletion.ts'

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const ready={status:'ready',source:'ai',outcome:null,aftermath:null,presentation:{beats:[]}}
const run=(writer,extra={})=>new Promise(resolve=>requestSceneDialogue({id:'scene',outcomeKey:sceneOutcomeKey({}),writer,timeoutMs:45,pollMs:2,onResult:result=>resolve({result}),onFailure:failure=>resolve({failure}),...extra}))
assert.equal(sceneOutcomeKey({outcome:{b:2,a:1}}),sceneOutcomeKey({outcome:{a:1,b:2},aftermath:null}))
assert.equal((await run(async()=>ready)).result.source,'ai')
let calls=0
assert.equal((await run(async()=>++calls<3?{...ready,status:'pending'}:ready)).result.status,'ready')
assert.equal(calls,3)
assert.equal((await run(()=>new Promise(()=>{}))).failure,'timeout','A hung transport must leave loading')
assert.equal((await run(async()=>({...ready,status:'pending'}))).failure,'timeout','Polling cannot reset the deadline')
calls=0
assert.equal((await run(async()=>{calls++;return {...ready,outcome:{result:'refused'}}})).failure,'changed')
assert.equal(calls,1,'Do not repeatedly request AI for an obsolete outcome')
assert.equal((await run(async()=>{throw Error('offline')})).failure,'network')
let retryFlag=false
await run(async(_id,_signal,retry)=>{retryFlag=retry;return ready},{retry:true})
assert.equal(retryFlag,true)
const flags=[]
await run(async(_id,_signal,retry)=>{flags.push(retry);return flags.length<3?{...ready,status:'pending'}:ready},{retry:true})
assert.deepEqual(flags,[true,false,false],'Polling an explicit retry cannot authorize another paid generation')
let late,events=[]
const cancelled=requestSceneDialogue({id:'x',outcomeKey:sceneOutcomeKey({}),writer:()=>new Promise(resolve=>{late=resolve}),timeoutMs:45,onResult:()=>events.push('ready'),onFailure:reason=>events.push(reason)})
cancelled.cancel();late(ready);await wait(55)
assert.deepEqual(events,['cancelled'],'A late response cannot resurrect skipped dialogue')
events=[]
const disposed=requestSceneDialogue({id:'x',outcomeKey:sceneOutcomeKey({}),writer:()=>new Promise(resolve=>{late=resolve}),timeoutMs:20,onResult:()=>events.push('ready'),onFailure:reason=>events.push(reason)})
disposed.dispose();late(ready);await wait(30);assert.deepEqual(events,[],'Unmounts must not publish state')

const story={id:'s',status:'resolved_autonomously',outcome:{mode:'autonomous',result:'autonomous'},consequences:[{kind:'wellbeing',translation_zh:'甲想让对方参与。乙想让对方参与。'},{kind:'relationship',tone:'mixed',text:'A little closer, but still tense.',translation_zh:'更亲近了，也留下了一点摩擦。'}]}
assert.equal(storyCompletionCopy(story,'zh').text,'更亲近了，也留下了一点摩擦。')
assert.equal(storyCompletionCopy(story,'en').text,'A little closer, but still tense.')
assert.equal(storyCompletionCopy(story,'zh').tone,'mixed')
assert.equal(storyCompletionCopy({...story,status:'open'},'zh'),null)
assert.equal(storyCompletionCopy({...story,status:'resolved_with_management',outcome:{mode:'managed',result:'backfired'}},'zh').title,'介入适得其反')
assert.equal(storyCompletionCopy({...story,consequences:[...story.consequences,{kind:'shared_activity',translation_zh:'他们约好稍后一起读书。'}]},'zh').text,'他们约好稍后一起读书。','An invitation is not a completed activity')
const ledger=completionLedger(2),key=storyCompletionKey(story)
ledger.mark(key);assert.equal(ledger.has(storyCompletionKey({...story,updated_at:'new'})),true)
assert.notEqual(storyCompletionKey({...story,outcome:{result:'refused'}}),key)
ledger.mark('b');ledger.mark('c');assert.equal(ledger.has(key),false)
console.log('Scene dialogue: ready/pending/timeout/version-change/retry/cancel/unmount passed; concise factual outcomes and bounded deduplication passed.')
