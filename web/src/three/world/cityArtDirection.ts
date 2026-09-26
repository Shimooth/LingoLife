import {hashString,type BuildingLot,type KayKitBuildingModel,type WorldPoint} from './worldData.ts'

/** Measured in the source glTF, before a placement's uniform scale.
 * The native doors/shop windows face +Z. The blank walls are intentional
 * kit geometry, not evidence that the road-facing building was rotated wrong.
 * A/C are narrow, B/D medium and E–H wide; the base is not the wall footprint.
 */
export const KAYKIT_FACADE_PROFILE:Readonly<Record<KayKitBuildingModel,{
 halfWidth:number;halfDepth:number;upperFloors:readonly number[];wallTop:number
 setback?:{fromFloor:number;minX:number;maxX:number}
}>>={
 building_A:{halfWidth:.6,halfDepth:.6,upperFloors:[1.22],wallTop:1.55},
 building_B:{halfWidth:.8,halfDepth:.6,upperFloors:[1.22],wallTop:1.55},
 building_C:{halfWidth:.6,halfDepth:.6,upperFloors:[1.22,1.92],wallTop:2.25},
 building_D:{halfWidth:.8,halfDepth:.6,upperFloors:[1.22,1.92],wallTop:2.25},
 building_E:{halfWidth:1,halfDepth:.6,upperFloors:[1.22,1.92],wallTop:2.25},
 building_F:{halfWidth:1,halfDepth:.6,upperFloors:[1.22,1.92],wallTop:2.25},
 building_G:{halfWidth:1,halfDepth:.6,upperFloors:[1.22,1.92],wallTop:2.25},
 building_H:{halfWidth:1,halfDepth:.6,upperFloors:[1.22,1.92,2.62],wallTop:2.95,setback:{fromFloor:2.35,minX:-1,maxX:.2}},
}

/** Only used when creating new/default fabric. Never rewrite an authored
 * model, position, rotation or scale to match the overview camera. */
export const fabricBuildingStyle=(lot:Pick<BuildingLot,'position'|'family'>):{model:KayKitBuildingModel;scale:number}=>{
 const [x,z]=lot.position,gx=Math.round(x/2.6),gz=Math.round(z/2.6)
 const variant=Math.abs(gx*31+gz*17),depth=.65*x+.76*z
 const foreground=depth>=8,background=depth<=-7
 const choices:readonly KayKitBuildingModel[]=lot.family==='residential'
  ?foreground?['building_A','building_B']:background?['building_C','building_B','building_C']:['building_A','building_B','building_C']
  :lot.family==='commercial'
   ?foreground?['building_E']:['building_D','building_E','building_E']
   :foreground?['building_F']:background?['building_G','building_H','building_F']:['building_F','building_G','building_H']
 return {model:choices[variant%choices.length],scale:Math.round(((foreground?1:background?1.08:1.035)+(variant%3)*.025)*1000)/1000}
}

export type FacadeBuilding={id:string;model:KayKitBuildingModel;position:WorldPoint;rotation:number;scale:number}
export type FacadeDetailKind='frame'|'glass'|'sill'|'pipe'
export type FacadeDetail={
 id:string;buildingId:string;kind:FacadeDetailKind;position:WorldPoint
 rotation:number;scale:WorldPoint;color:string;lit:boolean
}

const localToWorld=(building:FacadeBuilding,[x,y,z]:WorldPoint):WorldPoint=>{
 const c=Math.cos(building.rotation),s=Math.sin(building.rotation),scale=building.scale
 return [building.position[0]+(x*c+z*s)*scale,building.position[1]+y*scale,building.position[2]+(-x*s+z*c)*scale]
}

const obstructed=(owner:FacadeBuilding,point:WorldPoint,buildings:readonly FacadeBuilding[])=>buildings.some(other=>{
 if(other.id===owner.id)return false
 const profile=KAYKIT_FACADE_PROFILE[other.model]
 if(!profile||other.scale<=0)return false
 const dx=point[0]-other.position[0],dz=point[2]-other.position[2]
 const c=Math.cos(other.rotation),s=Math.sin(other.rotation)
 const x=(dx*c-dz*s)/other.scale,z=(dx*s+dz*c)/other.scale,y=(point[1]-other.position[1])/other.scale
 const setback=profile.setback&&y>profile.setback.fromFloor?profile.setback:undefined
 return x>(setback?.minX??-profile.halfWidth)-.025&&x<(setback?.maxX??profile.halfWidth)+.025&&Math.abs(z)<profile.halfDepth+.025&&y>.05&&y<profile.wallTop+.05
})

/** Decorative shell only: no doors are invented, ground-floor access stays
 * clear, and the kit's detailed +Z facade is never covered. Five instanced
 * batches maximum, independent of the number of buildings/windows. */
export const buildingFacadeDetails=(buildings:readonly FacadeBuilding[],options:{quality:'low'|'high';night?:boolean}):FacadeDetail[]=>{
 const details:FacadeDetail[]=[]
 for(const building of buildings){
  const profile=KAYKIT_FACADE_PROFILE[building.model]
  if(!profile||!Number.isFinite(building.scale)||building.scale<=0||!Number.isFinite(building.rotation)||!building.position.every(Number.isFinite))continue
  const seed=hashString(`facade:${building.id}`)
  profile.upperFloors.forEach((floor,floorIndex)=>{
   const setback=profile.setback&&floor>profile.setback.fromFloor?profile.setback:undefined
   const left=setback?.minX??-profile.halfWidth,right=setback?.maxX??profile.halfWidth,halfWidth=(right-left)/2
   const faces=[
    {id:'west',yaw:-Math.PI/2,center:[left,0,0] as WorldPoint,columns:seed%3===0?[0]:[-.27,.27]},
    // H's lower east wing ends at Z=.4 instead of .6; leave its stepped
    // front edge clear, in addition to the separate upper-floor setback.
    {id:'east',yaw:Math.PI/2,center:[right,0,0] as WorldPoint,columns:seed%3===1?[0]:building.model==='building_H'&&!setback?[-.24,.24]:[-.27,.27]},
    {id:'back',yaw:Math.PI,center:[(left+right)/2,0,-profile.halfDepth] as WorldPoint,columns:halfWidth<.7?[-.29,.29]:halfWidth<.9?[-.45,0,.45]:[-.62,0,.62]},
   ]
   for(const face of faces){
   const c=Math.cos(face.yaw),s=Math.sin(face.yaw)
   const position=(u:number,y:number,depth:number):WorldPoint=>[
    face.center[0]+u*c+depth*s,y,face.center[2]-u*s+depth*c,
   ]
   const add=(id:string,kind:FacadeDetailKind,u:number,y:number,depth:number,size:WorldPoint,color:string,lit=false)=>{
    details.push({id:`${building.id}-${face.id}-${id}`,buildingId:building.id,kind,position:localToWorld(building,position(u,y,depth)),rotation:building.rotation+face.yaw,scale:size.map(value=>value*building.scale) as WorldPoint,color,lit})
   }
   face.columns.forEach((u,column)=>{
    // Only cull a detail that would actually be inside another authored wall;
    // close, but open alleys are still allowed to have real windows.
    if(obstructed(building,localToWorld(building,position(u,floor,.065)),buildings))return
    const key=`${floorIndex}-${column}`,lit=Boolean(options.night)&&(seed+floorIndex*7+column*3+face.id.length)%5<2
    const paneColor=lit?'#ffdda0':(seed+floorIndex+column)%3===0?'#637e8b':'#455e71'
    add(`${key}-frame`,'frame',u,floor,.013,[.28,.4,.026],'#f0ead9')
    add(`${key}-pane`,'glass',u,floor+.009,.031,[.218,.326,.016],paneColor,lit)
    if(options.quality==='high')add(`${key}-sill`,'sill',u,floor-.212,.04,[.325,.04,.09],'#d8d8c7')
   })
   // An occasional copper drain gives service walls a purpose, but only one
   // side per third building. It is deliberately absent on low detail.
   if(options.quality==='high'&&floorIndex===0&&face.id==='back'&&seed%3===0){
    const u=profile.halfWidth-.055,height=(profile.setback?.fromFloor??profile.wallTop)-.2
    if(!obstructed(building,localToWorld(building,position(u,height/2+.13,.06)),buildings))add('drain','pipe',u,height/2+.13,.025,[.032,height,.032],'#a57961')
   }
   }
  })
 }
 return details
}
