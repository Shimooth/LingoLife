import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'

const read=relative=>readFile(new URL(relative,import.meta.url),'utf8')
const [types,panel,styles]=await Promise.all([
 read('../src/types.ts'),
 read('../src/components/AgentPanel.tsx'),
 read('../src/components/AgentDevelopment.css'),
])

const developmentType=types.split('\n').find(line=>line.startsWith('export type ResidentDevelopment='))||''
assert.match(types,/AgentState=\{[^\n]*development\?:ResidentDevelopment/,'AgentState must carry the public resident-development projection')
for(const band of ['fragile','growing','steady','grounded','new','forming','established','ingrained','untried','emerging','practiced','reliable']){
 assert.ok(types.includes(`'${band}'`),`public development types are missing the qualitative ${band} band`)
}
for(const privateField of ['practice_count','successful_commitments','setbacks','applied_evidence']){
 assert.ok(!developmentType.includes(privateField),`public ResidentDevelopment exposes private field ${privateField}`)
}
assert.ok(!developmentType.includes('number'),'public ResidentDevelopment must not expose numeric confidence, habit strength, or strategy practice')

assert.match(panel,/const development=agent\?\.development/,'AgentPanel must consume the Agent DTO development projection')
assert.match(panel,/confidenceLabels\[development\.confidence\]/,'confidence must render from a qualitative label map')
assert.match(panel,/habitStrengthLabels\[habit\.strength\]/,'habit strength must render from a qualitative label map')
assert.match(panel,/strategyPracticeLabels\[practice\]/,'relationship practice must render from a qualitative label map')
for(const copy of ['成长轨迹','Development','养成中的习惯','Declared habits','相处方式练习','Relationship practice']){
 assert.ok(panel.includes(copy),`AgentPanel is missing bilingual copy: ${copy}`)
}
for(const privateAccess of ['confidence.value','practice_count','successful_commitments','applied_evidence']){
 assert.ok(!panel.includes(privateAccess),`AgentPanel accesses private development data: ${privateAccess}`)
}
assert.match(styles,/@media \(max-width: 430px\)/,'development layout needs a compact mobile breakpoint')
assert.match(styles,/grid-template-columns: 1fr/,'relationship practice must collapse to one column on narrow screens')

console.log('Agent development guard passed (qualitative bilingual projection; private evidence and scores remain hidden).')
