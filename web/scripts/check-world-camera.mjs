import {readFile} from 'node:fs/promises'
import {
 CAMERA_SETTLE_THRESHOLDS,
 TOP_VIEW_POLAR_ANGLE,
 cameraDampingAlpha,
 cameraPoseSettled,
 followCameraZoom,
 followViewOffset,
 topViewOffset,
} from '../src/three/world/worldCamera.ts'
import {residentSidewalkOffset,uniformBuildingScale} from '../src/three/world/worldTransforms.ts'

const fail=message=>{throw new Error(`World camera guard failed: ${message}`)}
const close=(a,b,tolerance=1e-10)=>Math.abs(a-b)<=tolerance

for(const height of [28,54]){
 const offset=topViewOffset(height)
 if(!offset.every(Number.isFinite))fail(`top-view offset is non-finite at height ${height}`)
 const polar=Math.atan2(Math.hypot(offset[0],offset[2]),offset[1])
 if(!close(polar,TOP_VIEW_POLAR_ANGLE))fail(`top-view polar angle drifted to ${polar}`)
 if(polar<=.01||polar>=1.22)fail(`top-view polar angle ${polar} conflicts with OrbitControls`)
}

for(const rotation of [undefined,0,Math.PI/2,Math.PI,Math.PI*1.5]){
 const offset=followViewOffset(rotation)
 if(!offset.every(Number.isFinite))fail(`follow offset is non-finite at rotation ${rotation}`)
 if(offset[1]<=1.9)fail(`follow camera is too low to clear foreground geometry at rotation ${rotation}`)
}
if(followCameraZoom.length!==1)fail('follow zoom accepts a viewport-height input')
if(!(followCameraZoom(390)<followCameraZoom(700)&&followCameraZoom(700)<followCameraZoom(1200)))fail('follow zoom breakpoints are not monotonic')

const repairedScale=uniformBuildingScale({x:.5,y:1.2,z:4})
if(repairedScale!==1.2)fail(`legacy non-uniform building scale was not repaired: ${repairedScale}`)
if(uniformBuildingScale({x:99,y:99,z:99})!==5)fail('building scale upper bound was not enforced')

const householdOffsets=Array.from({length:8},(_,index)=>residentSidewalkOffset(index,8))
if(new Set(householdOffsets).size!==8)fail('co-located residents overlap on the same pavement point')
if(Math.max(...householdOffsets)-Math.min(...householdOffsets)<2.5)fail('an eight-resident household is not visibly spread along its parcel')
if(householdOffsets.some(value=>Math.abs(value)>1.31))fail('resident pavement spacing can leave the authored parcel')

const fullFrame=cameraDampingAlpha(1/30,4.8)
const halfFrame=cameraDampingAlpha(1/60,4.8)
const composedHalfFrames=1-(1-halfFrame)*(1-halfFrame)
if(!close(fullFrame,composedHalfFrames))fail('camera damping is frame-rate dependent')
if(cameraDampingAlpha(-1,4.8)!==0||cameraDampingAlpha(1,-4.8)!==0)fail('invalid damping input moves the camera')

if(!cameraPoseSettled(
 CAMERA_SETTLE_THRESHOLDS.positionSquared*.5,
 CAMERA_SETTLE_THRESHOLDS.targetSquared*.5,
 CAMERA_SETTLE_THRESHOLDS.zoom*.5,
))fail('a settled camera pose was rejected')
if(cameraPoseSettled(CAMERA_SETTLE_THRESHOLDS.positionSquared*2,0,0))fail('a displaced camera pose was accepted')

const sceneSource=await readFile(new URL('../src/three/world/WorldScene.tsx',import.meta.url),'utf8')
const rigStart=sceneSource.indexOf('function CameraRig(')
const rigEnd=sceneSource.indexOf('\n// A manufactured',rigStart)
if(rigStart<0||rigEnd<0)fail('CameraRig could not be inspected')
const rigSource=sceneSource.slice(rigStart,rigEnd)
if(!rigSource.includes('onStart={cancelProgrammaticMove}'))fail('manual orbit input does not cancel programmatic framing')
if(!rigSource.includes('manuallyControlled.current=true'))fail('manual camera ownership is not retained across layout resizes')
if(rigSource.includes('nearestDistance')||rigSource.includes('for(const road of ROAD_TILES)')){
 fail('follow camera still changes its heading at nearest-road boundaries')
}
if(!rigSource.includes('smoothedFollowOffset.current.lerp(staticFollowOffset'))fail('follow offset is no longer smoothly stabilized')
if(!rigSource.includes('enableDamping={!followedCharacterId&&!reducedMotion}'))fail('follow mode can inherit OrbitControls damping drift')
if(rigSource.includes('size.height/6.35'))fail('follow zoom once again depends on collapsible canvas height')
if(!rigSource.includes('if(following&&!actor){moving.current=false;return}'))fail('a missing followed actor can pull the camera to the city origin')

const markerStart=sceneSource.indexOf('function CharacterMarker(')
const markerEnd=sceneSource.indexOf('\nexport function WorldScene(',markerStart)
if(markerStart<0||markerEnd<0)fail('CharacterMarker could not be inspected')
const markerSource=sceneSource.slice(markerStart,markerEnd)
if(!markerSource.includes('const characterScale=cityAsset?CITY_CHARACTER_MODEL_SCALE:LEGACY_CHARACTER_MODEL_SCALE'))fail('resident model scale is no longer a constant per asset family')
if(/characterScale\s*=.*(?:active|hovered)/.test(markerSource))fail('selection or hover changes resident model scale')
if(markerSource.includes('scale={active?'))fail('resident selection still enlarges a marker or model')
if(!markerSource.includes('useLayoutEffect(()=>{\n  const current=actor.current'))fail('resident actor registration can miss the first camera layout pass')

const landmarkStart=sceneSource.indexOf('function LandmarkModelInstances(')
const landmarkEnd=sceneSource.indexOf('\nfunction LandmarkBuildings(',landmarkStart)
if(landmarkStart<0||landmarkEnd<0)fail('LandmarkModelInstances could not be inspected')
const landmarkSource=sceneSource.slice(landmarkStart,landmarkEnd)
if(/scale=\{[^}]*selectedId/.test(landmarkSource))fail('landmark selection mutates the building model scale')
if(!landmarkSource.includes('scale={item.scale}')||!landmarkSource.includes('<Instance\n    scale={1}'))fail('landmark models no longer use a stable uniform parent transform')
if(!sceneSource.includes('function StableBuildingInstances(')||!sceneSource.includes('scale={item.scale}><Instance scale={1}'))fail('city buildings no longer use stable uniform parent transforms')

const cssSource=await readFile(new URL('../src/three/world/world.css',import.meta.url),'utf8')
if(!cssSource.includes('max-height:calc(100% - 92px)')||!cssSource.includes('overflow-y:auto'))fail('desktop resident status dock can overflow the map')
if(!cssSource.includes('grid-template-columns:34px minmax(0,1fr)'))fail('long resident status text can expand its dock column')
if(!cssSource.includes('contain:layout paint')||!cssSource.includes('max-width:100%;height:auto;min-width:0;overflow:hidden'))fail('resident status contents are not clipped to the dock')
if(!cssSource.includes('max-height:none;overflow-x:auto;overflow-y:hidden'))fail('mobile resident status dock is not horizontally scrollable')

const observerSource=await readFile(new URL('../src/three/world/WorldObserver3D.tsx',import.meta.url),'utf8')
if(!observerSource.includes("frameloop={paused||reducedMotion?'demand':'always'}")){
 fail('story overlays no longer pause the continuous city frame loop')
}
if(!observerSource.includes('useEffect(()=>{if(!paused)invalidate()}')){
 fail('closing a paused overlay no longer invalidates a reliable resume frame')
}

console.log('World camera guard passed (top view, damping, manual takeover, stable follow, overlay pause/resume).')
