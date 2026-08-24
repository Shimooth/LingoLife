import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import typescript from 'typescript'
import {BUILDING_LOTS,ROAD_TILE_STEP} from '../src/three/world/worldData.ts'

// Browser-oriented TypeScript correctly uses an extensionless import, while
// Node's lightweight type stripper does not resolve that specifier. Compile a
// data-URL copy for this guard and point its one runtime import at worldData.ts;
// the application source itself stays valid for TypeScript and Vite.
const navigationPath=fileURLToPath(new URL('../src/three/world/worldNavigation.ts',import.meta.url))
const worldDataUrl=new URL('../src/three/world/worldData.ts',import.meta.url).href
const navigationSource=await readFile(navigationPath,'utf8')
const rewrittenSource=navigationSource.replace("from './worldData'",`from '${worldDataUrl}'`)
if(rewrittenSource===navigationSource)throw new Error('World navigation guard failed: could not resolve the navigation data import')
const compiledSource=typescript.transpileModule(rewrittenSource,{
 compilerOptions:{module:typescript.ModuleKind.ESNext,target:typescript.ScriptTarget.ES2022},
}).outputText
const navigationModule=await import(`data:text/javascript;base64,${Buffer.from(compiledSource).toString('base64')}`)
const {
 PEDESTRIAN_NAVIGATION_STATS,
 PEDESTRIAN_SIDEWALK_OFFSET,
 buildPedestrianRoute,
 samplePedestrianRoute,
}=navigationModule

const fail=message=>{throw new Error(`World navigation guard failed: ${message}`)}
const close=(a,b,tolerance=1e-6)=>Math.abs(a-b)<=tolerance
const samePoint=(a,b)=>a.every((value,index)=>close(value,b[index]))

if(!BUILDING_LOTS.length)fail('there are no legal parcels to navigate')
if(PEDESTRIAN_NAVIGATION_STATS.roadTileCount<1||PEDESTRIAN_NAVIGATION_STATS.nodeCount<4){
 fail('the pedestrian graph is empty')
}
if(!(PEDESTRIAN_SIDEWALK_OFFSET>0&&PEDESTRIAN_SIDEWALK_OFFSET<ROAD_TILE_STEP/2)){
 fail(`sidewalk offset ${PEDESTRIAN_SIDEWALK_OFFSET} is outside its road cell`)
}

const anchor=BUILDING_LOTS[0]
let checkedSamples=0
for(const lot of BUILDING_LOTS){
 const seed=`guard:${lot.id}`
 const route=buildPedestrianRoute(lot,anchor,{seed})
 const repeated=buildPedestrianRoute(lot,anchor,{seed})
 if(!route.reachable)fail(`${lot.id} cannot reach ${anchor.id}`)
 if(JSON.stringify(route)!==JSON.stringify(repeated))fail(`${lot.id} produces a non-deterministic route`)
 if(!route.points.length||route.cumulativeLengths.length!==route.points.length){
  fail(`${lot.id} produced an incomplete route`)
 }
 if(!route.points.every(point=>point.every(Number.isFinite)))fail(`${lot.id} produced a non-finite waypoint`)
 for(let index=1;index<route.cumulativeLengths.length;index+=1){
  if(route.cumulativeLengths[index]<=route.cumulativeLengths[index-1]){
   fail(`${lot.id} contains a zero-length or reversed segment`)
  }
 }
 if(!close(route.cumulativeLengths.at(-1)??0,route.length))fail(`${lot.id} has inconsistent route length`)
 for(const progress of [0,.17,.5,.83,1]){
  const sample=samplePedestrianRoute(route,progress)
  if(!sample.position.every(Number.isFinite)||!Number.isFinite(sample.rotation)){
   fail(`${lot.id} produced a non-finite route sample`)
  }
  if(!close(sample.distance,route.length*progress))fail(`${lot.id} is not interpolated by path length`)
  checkedSamples+=1
 }
 const first=samplePedestrianRoute(route,0)
 const last=samplePedestrianRoute(route,1)
 if(!samePoint(first.position,route.points[0]))fail(`${lot.id} does not start at its first waypoint`)
 if(!samePoint(last.position,route.points.at(-1)))fail(`${lot.id} does not finish at its final waypoint`)
 if(!last.done)fail(`${lot.id} never reports arrival`)
}

const unreachable={...anchor,id:'guard-unreachable',position:[9999,9999]}
const stopped=buildPedestrianRoute(anchor,unreachable,{seed:'unreachable'})
const stoppedStart=samplePedestrianRoute(stopped,0)
const stoppedEnd=samplePedestrianRoute(stopped,1)
if(stopped.reachable||stopped.length!==0)fail('an unreachable route was reported as traversable')
if(!samePoint(stoppedStart.position,stoppedEnd.position))fail('an unreachable actor did not remain at its origin')
if(stoppedEnd.done)fail('an unreachable actor incorrectly reported arrival')

console.log(`World navigation guard passed (${BUILDING_LOTS.length} parcels, ${PEDESTRIAN_NAVIGATION_STATS.nodeCount} pavement nodes, ${checkedSamples} samples).`)
