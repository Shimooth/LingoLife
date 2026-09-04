import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import typescript from 'typescript'

const modulePath=fileURLToPath(new URL('../src/three/world/worldDecorations.ts',import.meta.url))
const worldDataUrl=new URL('../src/three/world/worldData.ts',import.meta.url).href
const source=await readFile(modulePath,'utf8')
const rewritten=source.replace("from './worldData'",`from '${worldDataUrl}'`)
if(rewritten===source)throw new Error('World decoration guard failed: data import could not be resolved')
const compiled=typescript.transpileModule(rewritten,{compilerOptions:{module:typescript.ModuleKind.ESNext,target:typescript.ScriptTarget.ES2022}}).outputText
const decorations=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const {
 createWorldDecorationValidationApi,
 parseWorldDecorationDocument,
 snapWorldDecorationPosition,
}=decorations

const fail=message=>{throw new Error(`World decoration guard failed: ${message}`)}
const make=(id,kind,position,rotation=0,scale=1)=>({id,kind,position,rotation,scale})
const emptyBase={buildings:[],characterRoutes:[],characterPositions:[]}
const baseApi=createWorldDecorationValidationApi(emptyBase)

let legal
for(let x=-24;x<=24&&!legal;x+=.25){
 for(let z=-15;z<=15;z+=.25){
  const candidate=make('legal','firehydrant',[x,z])
  if(baseApi.validate(candidate,[]).valid){legal=[x,z];break}
 }
}
if(!legal)fail('no legal decoration point exists')

const raw=[legal[0]+.11,legal[1]-.11]
const rawResult=baseApi.validate(make('raw','firehydrant',raw),[])
const snappedResult=baseApi.validate(make('snapped','firehydrant',snapWorldDecorationPosition(raw)),[])
if(JSON.stringify(rawResult)!==JSON.stringify(snappedResult))fail('validation does not use the committed snapped point')
if(baseApi.validate(make('road','firehydrant',[0,0]),[]).reason!=='road')fail('road tile was not blocked')
if(baseApi.validate(make('edge','firehydrant',[40,0]),[]).reason!=='outside_city')fail('platform edge was not blocked')
if(baseApi.validate(make('courtyard','firehydrant',[0,6.5]),[]).reason!=='building')fail('courtyard was not blocked')

const buildingApi=createWorldDecorationValidationApi({...emptyBase,buildings:[legal]})
if(buildingApi.validate(make('building','firehydrant',legal),[]).reason!=='building')fail('building lot was not blocked')
const pathApi=createWorldDecorationValidationApi({...emptyBase,characterRoutes:[{points:[[legal[0]-1,.37,legal[1]],[legal[0]+1,.37,legal[1]]]}]})
if(pathApi.validate(make('path','firehydrant',legal),[]).reason!=='character_path')fail('resident route was not blocked')
const actorApi=createWorldDecorationValidationApi({...emptyBase,characterPositions:[legal]})
if(actorApi.validate(make('actor','firehydrant',legal),[]).reason!=='character_path')fail('resident position was not blocked')

const first=make('first','firehydrant',legal)
const audit=baseApi.audit({version:1,decorations:[first,make('overlap','firehydrant',legal)]})
if(audit.accepted.length!==1||audit.rejected.length!==1||audit.rejected[0].reason!=='custom_decor')fail('document audit did not reject an overlapping item atomically')

const parsed=parseWorldDecorationDocument(JSON.stringify({version:1,decorations:[
 {...first,position:[legal[0]+.11,legal[1]-.11]},
 {id:'bad',kind:'spaceship',position:[0,0]},
]}))
if(parsed.document.decorations.length!==1||parsed.discarded!==1)fail('malformed import entries were not quarantined')
if(JSON.stringify(parsed.document.decorations[0].position)!==JSON.stringify(snapWorldDecorationPosition(raw)))fail('imported coordinates were not snapped')

const observerSource=await readFile(new URL('../src/three/world/WorldObserver3D.tsx',import.meta.url),'utf8')
if(/mapEditor|WorldDecorationEditor|useWorldDecorationEditor|decorationEditor=/.test(observerSource))fail('the player observer still exposes world-authoring capability')
const sceneSource=await readFile(new URL('../src/three/world/WorldScene.tsx',import.meta.url),'utf8')
if(/WorldDecorationPlacementSurface|WorldDecorationSceneEditor|onDecorationValidationApi/.test(sceneSource))fail('the player scene still bundles world-authoring interactions')
const adminSource=await readFile(new URL('../src/AdminApp.tsx',import.meta.url),'utf8')
if(!adminSource.includes('<AdminWorldLayoutEditor/>'))fail('the authenticated admin surface no longer owns world authoring')
const mainSource=await readFile(new URL('../src/main.tsx',import.meta.url),'utf8')
if(!mainSource.includes("window.location.hostname==='lingolife.admin.shimooth.me'"))fail('the admin bundle is no longer restricted to the dedicated hostname')
if(!mainSource.includes("import.meta.env.DEV&&new URLSearchParams(window.location.search).get('admin')==='1'"))fail('the local admin switch is not explicitly restricted to Vite development')
const editorSource=await readFile(new URL('../src/components/AdminWorldLayoutEditor.tsx',import.meta.url),'utf8')
if(!editorSource.includes('adminApi.saveWorldLayoutDraft(')||!editorSource.includes('adminApi.validateWorldLayout(')||!editorSource.includes('adminApi.publishWorldLayout('))fail('the admin editor no longer uses the protected draft, validation and publish workflow')
const hookSource=await readFile(new URL('../src/three/world/useWorldDecorationEditor.ts',import.meta.url),'utf8')
if(!hookSource.includes('validationApi.audit(parsed.document)'))fail('imports are not fully audited before rendering')
if(!hookSource.includes('validateCandidate(candidate,current.id)'))fail('move/rotation mutations no longer revalidate their final footprint')

console.log(`World decoration guard passed (snap, exclusion zones, audit, import, admin-only authoring; legal sample ${legal.join(',')}).`)
