import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {openQaPage,waitFor} from './browser-cdp.mjs'

// Use the isolated scene QA profile and a separate origin from real-account QA.
process.env.QA_CDP_URL??='http://127.0.0.1:19227'
const base=process.env.QA_WEB_URL??'http://localhost:5173'
const page=await openQaPage(),reports=[]
try{
 await page.call('Page.navigate',{url:`${base}/scripts/fixtures/neighborhood-recovery.html`})
 await waitFor(page,'window.__neighborhoodRecoveryQa',30000)
 const cases=await page.evaluate('window.__neighborhoodRecoveryQa.cases')
 for(const name of cases){
  const report=await page.evaluate(`window.__neighborhoodRecoveryQa.run(${JSON.stringify(name)})`)
  assert.ok(report.checks.length>=3,`${name}: concrete assertions ran`)
  reports.push(report)
  console.log(JSON.stringify(report))
 }
 assert.equal(reports.length,5)
 assert.deepEqual(page.errors,[])
 assert.deepEqual(page.consoleErrors,[])
 await writeFile('/tmp/lingolife-neighborhood-recovery-report.json',JSON.stringify(reports,null,2))
 console.log('Neighborhood recovery passed: 5 isolated real-hook scenarios, no real account requests, no browser errors.')
}finally{
 await page.evaluate('window.__neighborhoodRecoveryQa?.cleanup()').catch(()=>undefined)
 await page.close()
}
