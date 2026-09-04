export type CameraPoint=readonly [number,number,number]

/**
 * Keep the authored top view just off the vertical singularity. OrbitControls
 * cannot represent a camera exactly above its target while retaining an
 * azimuth, so a target below its minimum polar angle is corrected every frame
 * and a programmatic transition can never settle.
 */
export const TOP_VIEW_POLAR_ANGLE=.035
export const TOP_VIEW_AZIMUTH=Math.PI/4

// Follow framing is intentionally independent from the canvas height. The
// application header can collapse while the city is visible; deriving zoom
// from that changing height made the camera breathe in and out even though the
// player had not requested a new view.
export const FOLLOW_CAMERA_HEIGHT=2.2
export const FOLLOW_CAMERA_FORWARD=2.15
export const FOLLOW_CAMERA_SIDE=.7

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

/**
 * Return one stable, parcel-facing camera offset for a followed resident.
 * Keeping this separate from the resident model means changing view mode can
 * never mutate the character or nearby building transforms.
 */
export const followViewOffset=(parcelRotation?:number):CameraPoint=>{
 if(!Number.isFinite(parcelRotation))return [1.55,FOLLOW_CAMERA_HEIGHT,1.7]
 const rotation=parcelRotation as number
 const forward:[number,number]=[Math.sin(rotation),Math.cos(rotation)]
 const side:[number,number]=[Math.cos(rotation),-Math.sin(rotation)]
 return [
  forward[0]*FOLLOW_CAMERA_FORWARD+side[0]*FOLLOW_CAMERA_SIDE,
  FOLLOW_CAMERA_HEIGHT,
  forward[1]*FOLLOW_CAMERA_FORWARD+side[1]*FOLLOW_CAMERA_SIDE,
 ]
}

/** Stable responsive steps: vertical layout changes must not alter follow zoom. */
export const followCameraZoom=(viewportWidth:number)=>{
 const width=Number.isFinite(viewportWidth)?Math.max(0,viewportWidth):0
 if(width<480)return 104
 if(width<840)return 112
 return 118
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
