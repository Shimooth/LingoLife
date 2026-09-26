import type {SharedDrinkStaging} from '../../types'
import type {DrinkPoint,SharedDrinkSeat} from '../interiors/sharedDrinkLayout'
import {drinkEase,type DrinkPose} from './sharedDrinkPerformance.ts'
import type {StandingTurnPose} from './standingTurn'

const mix=(a:DrinkPoint,b:DrinkPoint,t:number):DrinkPoint=>a.map((value,index)=>value+(b[index]-value)*t) as DrinkPoint
const heading=(a:DrinkPoint,b:DrinkPoint)=>Math.atan2(b[0]-a[0],b[2]-a[2])
const angleMix=(a:number,b:number,t:number)=>a+Math.atan2(Math.sin(b-a),Math.cos(b-a))*t
const length=(a:DrinkPoint,b:DrinkPoint)=>Math.hypot(b[0]-a[0],b[2]-a[2])
export const drinkSeatFront=(seat:SharedDrinkSeat):DrinkPoint=>[seat.position[0]+Math.sin(seat.rotation)*.24,seat.position[1],seat.position[2]+Math.cos(seat.rotation)*.24]

export type DrinkDeparture={position:DrinkPoint;rotation:number}
/** A live outcome starts from the visible action, not the historical result's
 * first tableau. A held cup is lowered from its current height; an actor who
 * has not sat down turns and leaves from where they actually are. */
export function planDrinkExit(pose:DrinkPose,position:DrinkPoint,rotation:number){
 let offset=1.9,finishSitting=false,departure:DrinkDeparture|undefined
 if(pose.beat==='sit')finishSitting=true
 else if(pose.cup==='hand'){
  // Invert smoothstep to enter the lowering curve at the current hand height.
  let low=0,high=1
  for(let i=0;i<28;i++){const mid=(low+high)/2;if(drinkEase(mid)<1-pose.handProgress)low=mid;else high=mid}
  offset=(low+high)/2*1.15
 }else if(pose.beat==='release')offset=1.15+pose.linearProgress*.75
 else if(!pose.seated){offset=3.05;departure={position:[...position],rotation}}
 return {offset,finishSitting,departure}
}

/** Stop next to a chair, turn to its actual facing, then sit. On departure
 * stand into the same open space before turning. No rotation on a seated hip. */
export function sampleDrinkPlacement(pose:DrinkPose,seat:SharedDrinkSeat,phase:SharedDrinkStaging['phase'],initiator:boolean,liveDeparture?:DrinkDeparture){
 const front=drinkSeatFront(seat),departure=liveDeparture?.position??(phase==='declined'?seat.approach:front)
 const approachHeading=heading(seat.approach,front),exitHeading=heading(departure,seat.exit)
 let position:DrinkPoint=seat.approach,rotation=seat.rotation,walkDistance=0,walkSpeed=0,standingTurn:Omit<StandingTurnPose,'root'|'key'>|undefined
 if(pose.beat==='approach'||pose.beat==='leave'){
  const start=pose.beat==='approach'?seat.approach:departure,end=pose.beat==='approach'?front:seat.exit
  const distance=length(start,end),u=pose.linearProgress
  position=mix(start,end,pose.progress);rotation=heading(start,end)
  walkDistance=distance*pose.progress
  walkSpeed=distance*6*u*(1-u)/pose.duration
 }else if(pose.beat==='align'){
  position=front;rotation=angleMix(approachHeading,seat.rotation,pose.progress)
  standingTurn={startYaw:approachHeading,endYaw:seat.rotation,progress:pose.linearProgress}
 }else if(pose.beat==='sit')position=mix(front,seat.position,pose.progress)
 else if(pose.beat==='stand')position=mix(seat.position,front,pose.progress)
 else if(pose.beat==='depart_turn'){
  position=departure;rotation=angleMix(liveDeparture?.rotation??seat.rotation,exitHeading,pose.progress)
  standingTurn={startYaw:liveDeparture?.rotation??seat.rotation,endYaw:exitHeading,progress:pose.linearProgress}
 }else if(pose.seated)position=seat.position
 else if(pose.beat==='finished'&&(phase==='completed'||phase==='interrupted'||phase==='declined'&&!initiator)){
  position=seat.exit;rotation=exitHeading
 }
 return {position,rotation,walkDistance,walkSpeed,standingTurn,walking:pose.beat==='approach'||pose.beat==='leave',lookYaw:Math.max(-.24,Math.min(.24,Math.atan2(Math.sin(seat.rotation-rotation),Math.cos(seat.rotation-rotation))))}
}

/** Rounded lift/lower path with zero endpoint offsets. The original seated
 * clip supplies body motion; this adds a restrained, continuous reach layer. */
export function drinkHandArc(start:DrinkPoint,end:DrinkPoint,progress:number,lateral=0):DrinkPoint{
 const point=mix(start,end,progress),arc=4*progress*(1-progress)
 point[1]+=.045*arc
 point[2]+=lateral*arc
 return point
}

/** Return beside the lap, not behind the shoulder along the diagonal handle. */
export function drinkReleaseTarget(position:DrinkPoint,seat:SharedDrinkSeat):DrinkPoint{
 return [position[0]-.22*Math.cos(seat.rotation)+.06*Math.sin(seat.rotation),seat.seatTopY+.24,position[2]+.22*Math.sin(seat.rotation)+.06*Math.cos(seat.rotation)]
}

export const drinkLeanLimit=(family:'city'|'chibi')=>family==='chibi'?.45:.65

export function sampleDrinkUpperBody(pose:DrinkPose,maxLean=.65){
 const p=pose.progress
 const lean=pose.beat==='reach'?maxLean*p:pose.beat==='lift'?maxLean*(1-p):pose.beat==='lower'?maxLean*p:pose.beat==='release'?maxLean*(1-p):0
 const reachWeight=pose.beat==='reach'?drinkEase(Math.min(1,pose.localTime/.32)):pose.beat==='release'?1-drinkEase(Math.max(0,(pose.localTime-.28)/.47)):['lift','sip','lower'].includes(pose.beat)?1:0
 const lookDown=pose.beat==='settle'?drinkEase(Math.max(0,(pose.localTime-.3)/.35)):
  pose.beat==='reach'?1:pose.beat==='lift'?1-p:pose.beat==='lower'?p:pose.beat==='release'?1-p:0
 // Listening acknowledgements now belong to the actual speech turn, not a
 // perpetual clock that keeps nodding after the conversation is over.
 return {lean,handWeight:reachWeight,headPitch:.1*lookDown}
}
