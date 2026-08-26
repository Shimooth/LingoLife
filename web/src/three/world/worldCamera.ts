export type CameraPoint=readonly [number,number,number]

/**
 * Keep the authored top view just off the vertical singularity. OrbitControls
 * cannot represent a camera exactly above its target while retaining an
 * azimuth, so a target below its minimum polar angle is corrected every frame
 * and a programmatic transition can never settle.
 */
export const TOP_VIEW_POLAR_ANGLE=.035
export const TOP_VIEW_AZIMUTH=Math.PI/4

export const CAMERA_SETTLE_THRESHOLDS=Object.freeze({
 positionSquared:.005,
 targetSquared:.003,
 zoom:.015,
})

export const topViewOffset=(height:number,azimuth=TOP_VIEW_AZIMUTH):CameraPoint=>{
 const safeHeight=Number.isFinite(height)?Math.max(.01,height):.01
 const radialDistance=safeHeight*Math.tan(TOP_VIEW_POLAR_ANGLE)
 return [
  Math.sin(azimuth)*radialDistance,
  safeHeight,
  Math.cos(azimuth)*radialDistance,
 ]
}

/** Frame-rate-independent exponential damping. */
export const cameraDampingAlpha=(deltaSeconds:number,responsiveness:number)=>{
 const safeDelta=Number.isFinite(deltaSeconds)?Math.max(0,deltaSeconds):0
 const safeResponsiveness=Number.isFinite(responsiveness)?Math.max(0,responsiveness):0
 return 1-Math.exp(-safeDelta*safeResponsiveness)
}

export const cameraPoseSettled=(positionSquared:number,targetSquared:number,zoomDelta:number)=>
 positionSquared<CAMERA_SETTLE_THRESHOLDS.positionSquared&&
 targetSquared<CAMERA_SETTLE_THRESHOLDS.targetSquared&&
 Math.abs(zoomDelta)<CAMERA_SETTLE_THRESHOLDS.zoom
