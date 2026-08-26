import {CITY_PLATFORM_OUTLINE,ROAD_TILES,ROAD_TILE_STEP,STREET_PROPS,TREES,type WorldPoint} from './worldData'

export const WORLD_DECORATION_STORAGE_KEY='lingolife.world-decorations.v1'
export const WORLD_DECORATION_LIMIT=120

export const WORLD_DECORATION_CATALOG=[
 {kind:'tree_round',icon:'🌳',label:{zh:'圆冠树',en:'Round tree'},radius:.58,baseScale:1},
 {kind:'tree_tall',icon:'🌲',label:{zh:'高树',en:'Tall tree'},radius:.55,baseScale:1},
 {kind:'flower_planter',icon:'🌼',label:{zh:'花坛',en:'Flower bed'},radius:.5,baseScale:1},
 {kind:'bush',icon:'✿',label:{zh:'灌木',en:'Bush'},radius:.45,baseScale:.92},
 {kind:'bench',icon:'▰',label:{zh:'长椅',en:'Bench'},radius:.7,baseScale:1},
 {kind:'streetlight',icon:'⌉',label:{zh:'路灯',en:'Streetlight'},radius:.38,baseScale:.95},
 {kind:'firehydrant',icon:'♜',label:{zh:'消防栓',en:'Hydrant'},radius:.3,baseScale:1},
 {kind:'crate',icon:'▧',label:{zh:'木箱',en:'Crate'},radius:.42,baseScale:.9},
] as const

export type WorldDecorationKind=typeof WORLD_DECORATION_CATALOG[number]['kind']
export type WorldDecoration={
 id:string
 kind:WorldDecorationKind
 position:[number,number]
 rotation:number
 scale:number
}
export type WorldDecorationDocument={version:1;decorations:WorldDecoration[]}
export type PlacementBlockReason='outside_city'|'road'|'building'|'character_path'|'fixed_decor'|'custom_decor'
export type PlacementValidation={valid:true}|{valid:false;reason:PlacementBlockReason}
export type DecorationPlacementConstraints={
 buildings:readonly [number,number][]
 characterRoutes:readonly {points:readonly WorldPoint[]}[]
 characterPositions:readonly [number,number][]
 customDecorations:readonly WorldDecoration[]
 excludeDecorationId?:string
}
export type WorldDecorationAudit={accepted:WorldDecoration[];rejected:{decoration:WorldDecoration;reason:PlacementBlockReason}[]}
export type WorldDecorationValidationApi={
 validate:(decoration:WorldDecoration,customDecorations:readonly WorldDecoration[],excludeDecorationId?:string)=>PlacementValidation
 audit:(document:WorldDecorationDocument)=>WorldDecorationAudit
}
export type WorldDecorationBaseConstraints=Omit<DecorationPlacementConstraints,'customDecorations'|'excludeDecorationId'>

const KINDS=new Set<WorldDecorationKind>(WORLD_DECORATION_CATALOG.map(item=>item.kind))
const catalogByKind=new Map(WORLD_DECORATION_CATALOG.map(item=>[item.kind,item]))

export const decorationDefinition=(kind:WorldDecorationKind)=>catalogByKind.get(kind)??WORLD_DECORATION_CATALOG[0]
export const decorationRadius=(decoration:Pick<WorldDecoration,'kind'|'scale'>)=>decorationDefinition(decoration.kind).radius*decoration.scale

const pointSegmentDistance=(point:readonly [number,number],start:readonly [number,number],end:readonly [number,number])=>{
 const dx=end[0]-start[0],dz=end[1]-start[1]
 const lengthSquared=dx*dx+dz*dz
 if(lengthSquared<=1e-8)return Math.hypot(point[0]-start[0],point[1]-start[1])
 const t=Math.max(0,Math.min(1,((point[0]-start[0])*dx+(point[1]-start[1])*dz)/lengthSquared))
 return Math.hypot(point[0]-(start[0]+dx*t),point[1]-(start[1]+dz*t))
}

const pointInsidePlatform=(x:number,z:number)=>{
 let inside=false
 for(let index=0,previous=CITY_PLATFORM_OUTLINE.length-1;index<CITY_PLATFORM_OUTLINE.length;previous=index,index+=1){
  const [xi,zi]=CITY_PLATFORM_OUTLINE[index], [xj,zj]=CITY_PLATFORM_OUTLINE[previous]
  if(((zi>z)!==(zj>z))&&x<(xj-xi)*(z-zi)/(zj-zi)+xi)inside=!inside
 }
 return inside
}

const platformEdgeDistance=(point:[number,number])=>CITY_PLATFORM_OUTLINE.reduce((minimum,start,index)=>{
 const end=CITY_PLATFORM_OUTLINE[(index+1)%CITY_PLATFORM_OUTLINE.length]
 return Math.min(minimum,pointSegmentDistance(point,start,end))
},Number.POSITIVE_INFINITY)

const distance=(a:[number,number],b:[number,number])=>Math.hypot(a[0]-b[0],a[1]-b[1])
type Footprint={center:readonly [number,number];half:readonly [number,number];rotation:number}
const footprintForDecoration=(decoration:Pick<WorldDecoration,'kind'|'position'|'rotation'|'scale'>):Footprint=>{
 const half:Record<WorldDecorationKind,readonly [number,number]>={
  tree_round:[.58,.58],tree_tall:[.55,.55],flower_planter:[.5,.5],bush:[.45,.45],
  bench:[.72,.3],streetlight:[.28,.28],firehydrant:[.25,.25],crate:[.42,.42],
 }
 return {center:decoration.position,half:[half[decoration.kind][0]*decoration.scale,half[decoration.kind][1]*decoration.scale],rotation:decoration.rotation}
}
const footprintForFixedProp=(item:typeof STREET_PROPS[number]):Footprint=>{
 let half:readonly [number,number]=[.34,.34]
 if(item.model==='watertower')half=[.7,.7]
 else if(item.model.startsWith('car_'))half=[.82,.4]
 else if(item.model==='bench')half=[.7,.28]
 else if(item.model==='dumpster')half=[.52,.38]
 else if(item.model.startsWith('box_'))half=[.34,.34]
 else if(item.model==='bush')half=[.42,.42]
 else if(item.model.startsWith('trafficlight_'))half=[.28,.28]
 else if(item.model==='streetlight')half=[.2,.2]
 else if(item.model==='firehydrant')half=[.22,.22]
 else if(item.model.startsWith('trash_'))half=[.24,.24]
 return {center:item.position,half:[half[0]*item.scale,half[1]*item.scale],rotation:item.rotation}
}
const footprintRadius=(footprint:Footprint)=>Math.hypot(footprint.half[0],footprint.half[1])
const footprintAxes=(rotation:number):readonly [readonly [number,number],readonly [number,number]]=>[
 [Math.cos(rotation),Math.sin(rotation)],[-Math.sin(rotation),Math.cos(rotation)],
]
const footprintsOverlap=(first:Footprint,second:Footprint,padding=0)=>{
 const delta:[number,number]=[second.center[0]-first.center[0],second.center[1]-first.center[1]]
 const firstAxes=footprintAxes(first.rotation),secondAxes=footprintAxes(second.rotation)
 return [...firstAxes,...secondAxes].every(axis=>{
  const projectedDelta=Math.abs(delta[0]*axis[0]+delta[1]*axis[1])
  const firstRadius=first.half[0]*Math.abs(firstAxes[0][0]*axis[0]+firstAxes[0][1]*axis[1])+first.half[1]*Math.abs(firstAxes[1][0]*axis[0]+firstAxes[1][1]*axis[1])
  const secondRadius=second.half[0]*Math.abs(secondAxes[0][0]*axis[0]+secondAxes[0][1]*axis[1])+second.half[1]*Math.abs(secondAxes[1][0]*axis[0]+secondAxes[1][1]*axis[1])
  return projectedDelta<=firstRadius+secondRadius+padding
 })
}
const COURTYARD_BLOCKS=[
 {center:[-.8,-6.5] as [number,number],half:[7.2,2.13] as [number,number]},
 {center:[0,6.5] as [number,number],half:[2.75,2.2] as [number,number]},
 {center:[16,6.5] as [number,number],half:[3.85,2.2] as [number,number]},
] as const

export const snapWorldDecorationPosition=(position:[number,number]):[number,number]=>[
 Math.round(position[0]*4)/4,
 Math.round(position[1]*4)/4,
]

export function validateWorldDecorationPlacement(
 position:[number,number],
 kind:WorldDecorationKind,
 scale:number,
 constraints:DecorationPlacementConstraints,
):PlacementValidation{
 const candidate:WorldDecoration={id:'candidate',kind,position,rotation:0,scale}
 return validateWorldDecoration(candidate,constraints)
}

function validateWorldDecoration(decoration:WorldDecoration,constraints:DecorationPlacementConstraints):PlacementValidation{
 const position=decoration.position
 const candidateFootprint=footprintForDecoration(decoration)
 const radius=footprintRadius(candidateFootprint)
 if(!pointInsidePlatform(position[0],position[1])||platformEdgeDistance(position)<radius+.48)return {valid:false,reason:'outside_city'}
 // KayKit buildings occupy square parcels. Measuring against the full box
 // keeps diagonal lot corners blocked as well as the building centre.
 if(constraints.buildings.some(item=>footprintsOverlap(candidateFootprint,{center:item,half:[1.48,1.48],rotation:0},.24)))return {valid:false,reason:'building'}
 if(COURTYARD_BLOCKS.some(block=>footprintsOverlap(candidateFootprint,{...block,rotation:0},.2)))return {valid:false,reason:'building'}
 if(constraints.characterPositions.some(item=>distance(position,item)<.62+radius))return {valid:false,reason:'character_path'}
 if(constraints.characterRoutes.some(route=>route.points.some((point,index)=>index>0&&pointSegmentDistance(position,[route.points[index-1][0],route.points[index-1][2]],[point[0],point[2]])<.58+radius)))return {valid:false,reason:'character_path'}
 const roadHalf=ROAD_TILE_STEP/2
 if(ROAD_TILES.some(tile=>Math.abs(position[0]-tile.position[0])<roadHalf+radius&&Math.abs(position[1]-tile.position[1])<roadHalf+radius))return {valid:false,reason:'road'}
 if(TREES.some(item=>footprintsOverlap(candidateFootprint,{center:item,half:[.58,.58],rotation:0},.08)))return {valid:false,reason:'fixed_decor'}
 if(STREET_PROPS.some(item=>footprintsOverlap(candidateFootprint,footprintForFixedProp(item),.08)))return {valid:false,reason:'fixed_decor'}
 if(constraints.customDecorations.some(item=>item.id!==constraints.excludeDecorationId&&footprintsOverlap(candidateFootprint,footprintForDecoration(item),.12)))return {valid:false,reason:'custom_decor'}
 return {valid:true}
}

/**
 * Builds the scene-owned validator once its resolved building lots and current
 * resident routes are known. Every mutation reuses this same boundary, so a
 * preview cannot disagree with the committed placement.
 */
export function createWorldDecorationValidationApi(base:WorldDecorationBaseConstraints):WorldDecorationValidationApi{
 const validate:WorldDecorationValidationApi['validate']=(decoration,customDecorations,excludeDecorationId)=>{
  const position=snapWorldDecorationPosition(decoration.position)
  return validateWorldDecoration({...decoration,position},{...base,customDecorations,excludeDecorationId})
 }
 const audit:WorldDecorationValidationApi['audit']=document=>{
  const accepted:WorldDecoration[]=[],rejected:WorldDecorationAudit['rejected']=[]
  document.decorations.forEach(decoration=>{
   const normalized={...decoration,position:snapWorldDecorationPosition(decoration.position)}
   const result=validate(normalized,accepted)
   if(result.valid)accepted.push(normalized)
   else rejected.push({decoration:normalized,reason:result.reason})
  })
  return {accepted,rejected}
 }
 return {validate,audit}
}

const finite=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)
const normalizedRotation=(value:number)=>{
 const turn=Math.PI*2
 return ((value%turn)+turn)%turn
}

function normalizedDecoration(value:unknown,index:number):WorldDecoration|null{
 if(!value||typeof value!=='object')return null
 const candidate=value as Partial<WorldDecoration>
 if(typeof candidate.kind!=='string'||!KINDS.has(candidate.kind as WorldDecorationKind))return null
 if(!Array.isArray(candidate.position)||candidate.position.length!==2||!finite(candidate.position[0])||!finite(candidate.position[1]))return null
 const position=snapWorldDecorationPosition([Number(candidate.position[0]),Number(candidate.position[1])])
 if(Math.abs(position[0])>40||Math.abs(position[1])>30)return null
 const rotation=finite(candidate.rotation)?normalizedRotation(Number(candidate.rotation)):0
 const scale=finite(candidate.scale)?Math.max(.72,Math.min(1.3,Number(candidate.scale))):1
 const id=typeof candidate.id==='string'&&candidate.id.trim()?candidate.id.trim().slice(0,80):`imported-${index}`
 return {id,kind:candidate.kind as WorldDecorationKind,position,rotation,scale}
}

export function parseWorldDecorationDocument(value:unknown):{document:WorldDecorationDocument;discarded:number}{
 const source=typeof value==='string'?JSON.parse(value):value
 if(!source||typeof source!=='object')throw new Error('Decoration document must be an object')
 const candidate=source as Partial<WorldDecorationDocument>
 if(candidate.version!==1||!Array.isArray(candidate.decorations))throw new Error('Unsupported decoration document')
 const ids=new Set<string>(),decorations:WorldDecoration[]=[]
 let discarded=0
 candidate.decorations.slice(0,WORLD_DECORATION_LIMIT*2).forEach((item,index)=>{
  const normalized=normalizedDecoration(item,index)
  if(!normalized||ids.has(normalized.id)||decorations.length>=WORLD_DECORATION_LIMIT){discarded+=1;return}
  ids.add(normalized.id);decorations.push(normalized)
 })
 discarded+=Math.max(0,candidate.decorations.length-WORLD_DECORATION_LIMIT*2)
 return {document:{version:1,decorations},discarded}
}

export function loadWorldDecorationDocument():WorldDecorationDocument{
 if(typeof window==='undefined')return {version:1,decorations:[]}
 try{
  const stored=localStorage.getItem(WORLD_DECORATION_STORAGE_KEY)
  return stored?parseWorldDecorationDocument(stored).document:{version:1,decorations:[]}
 }catch{return {version:1,decorations:[]}}
}

export function saveWorldDecorationDocument(document:WorldDecorationDocument):boolean{
 try{localStorage.setItem(WORLD_DECORATION_STORAGE_KEY,JSON.stringify(document));return true}catch{return false}
}

export const serializeWorldDecorationDocument=(document:WorldDecorationDocument)=>JSON.stringify(document,null,2)

export function newWorldDecoration(kind:WorldDecorationKind,position:[number,number]):WorldDecoration{
 const randomId=typeof crypto!=='undefined'&&'randomUUID'in crypto?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`
 return {id:`decor-${randomId}`,kind,position:snapWorldDecorationPosition(position),rotation:0,scale:decorationDefinition(kind).baseScale}
}
