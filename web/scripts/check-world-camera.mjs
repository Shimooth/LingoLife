import {readFile} from 'node:fs/promises'
import {
 CAMERA_SETTLE_THRESHOLDS,
 TOP_VIEW_POLAR_ANGLE,
 cameraDampingAlpha,
 cameraPoseSettled,
 topViewOffset,
} from '../src/three/world/worldCamera.ts'

const fail=message=>{throw new Error(`World camera guard failed: ${message}`)}
const close=(a,b,tolerance=1e-10)=>Math.abs(a-b)<=tolerance

for(const height of [28,54]){
 const offset=topViewOffset(height)
 if(!offset.every(Number.isFinite))fail(`top-view offset is non-finite at height ${height}`)
 const polar=Math.atan2(Math.hypot(offset[0],offset[2]),offset[1])
 if(!close(polar,TOP_VIEW_POLAR_ANGLE))fail(`top-view polar angle drifted to ${polar}`)
 if(polar<=.01||polar>=1.22)fail(`top-view polar angle ${polar} conflicts with OrbitControls`)
}

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

console.log('World camera guard passed (top view, damping, manual takeover, stable follow).')
