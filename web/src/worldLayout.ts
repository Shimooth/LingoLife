export type LayoutVector3={x:number;y:number;z:number}

export type WorldLayoutPlacement={
 id:string
 asset:string
 position:LayoutVector3
 rotation:LayoutVector3
 scale:LayoutVector3
}

export type WorldLayoutBuilding=WorldLayoutPlacement&{location_id?:string|null}
export type WorldLayoutInteriorPlacement=WorldLayoutPlacement&{room_id:string}
export type WorldLayoutRoom={id:string;name:string;kind:string;placements:WorldLayoutInteriorPlacement[]}
export type WorldLayoutDocument={
 version:1
 city:{
  roads:WorldLayoutPlacement[]
  buildings:WorldLayoutBuilding[]
  props:WorldLayoutPlacement[]
  decorations:WorldLayoutPlacement[]
 }
 interior:{rooms:WorldLayoutRoom[]}
}
export type WorldLayoutValidationIssue={code:string;path:string;message:string}
export type WorldLayoutValidation={
 valid:boolean
 issues:WorldLayoutValidationIssue[]
 report?:{
  road_tiles:number;road_edges:number;sky_road_exits:number;buildings:number;decorations:number
  connected_rooms:number;room_connections:number;shared_home_actions:number;private_sleep_slots:number
 }
}
export type WorldLayoutVersion={
 id:string;hash:string;note:string;author:string;is_default:boolean;is_active:boolean
 validation:WorldLayoutValidation;created_at:string;activated_at?:string|null
}
export type WorldLayoutDraft={
 layout:WorldLayoutDocument;revision:number;hash?:string|null;author?:string|null
 validation:WorldLayoutValidation;created_at?:string|null;updated_at?:string|null
}
export type WorldLayoutAudit={
 id:number;action:string;version_id?:string|null;previous_version_id?:string|null
 note:string;author:string;created_at:string
}
export type WorldLayoutResponse={
 layout:WorldLayoutDocument;updated_at?:string|null
 active_version?:Omit<WorldLayoutVersion,'is_active'|'activated_at'>
 activated_at?:string|null;activated_by?:string;activation_note?:string
}
export type WorldLayoutAdminResponse=WorldLayoutResponse&{
 draft:WorldLayoutDraft;versions:WorldLayoutVersion[];audit:WorldLayoutAudit[]
}
export type WorldLayoutCityLayer=keyof WorldLayoutDocument['city']

export type LayoutAssetDefinition={
 asset:string
 label:string
 icon:string
 defaultScale:number
 defaultY:number
}

const CITY='/assets/world/kaykit-city/gltf'
const INTERIOR='/assets/life/interiors'

const asset=(path:string,label:string,icon:string,defaultScale=1,defaultY=0):LayoutAssetDefinition=>({asset:path,label,icon,defaultScale,defaultY})

export const WORLD_LAYOUT_CITY_ASSETS:Record<WorldLayoutCityLayer,readonly LayoutAssetDefinition[]>={
 roads:[
  asset(`${CITY}/road_straight.gltf`,'直路','━',1.3,.245),
  asset(`${CITY}/road_straight_crossing.gltf`,'人行横道','╫',1.3,.245),
  asset(`${CITY}/road_junction.gltf`,'十字路口','╋',1.3,.245),
  asset(`${CITY}/road_tsplit.gltf`,'丁字路口','┳',1.3,.245),
  asset(`${CITY}/road_corner.gltf`,'直角弯道','┗',1.3,.245),
  asset(`${CITY}/road_corner_curved.gltf`,'圆角弯道','╰',1.3,.245),
 ],
 buildings:[
  ...['A','B','C'].map(model=>asset(`${CITY}/building_${model}.gltf`,`住宅 ${model}`,'⌂',1.16,.369)),
  ...['D','E'].map(model=>asset(`${CITY}/building_${model}.gltf`,`商业 ${model}`,'▤',1.16,.369)),
  ...['F','G','H'].map(model=>asset(`${CITY}/building_${model}.gltf`,`公共建筑 ${model}`,'▥',1.16,.369)),
 ],
 props:[
  asset(`${CITY}/base.gltf`,'街区地块','▦',1.3,.238),
  asset(`${CITY}/streetlight.gltf`,'路灯','⌉',1.3,.37),
  asset(`${CITY}/trafficlight_A.gltf`,'红绿灯 A','🚦',1.3,.37),
  asset(`${CITY}/trafficlight_B.gltf`,'红绿灯 B','🚦',1.3,.37),
  asset(`${CITY}/trafficlight_C.gltf`,'红绿灯 C','🚦',1.3,.37),
  asset(`${CITY}/bench.gltf`,'长椅','▰',1.8,.37),
  asset(`${CITY}/firehydrant.gltf`,'消防栓','♜',1.6,.37),
  asset(`${CITY}/watertower.gltf`,'水塔','◉',1.3,.37),
  asset(`${CITY}/dumpster.gltf`,'垃圾箱','▣',1.4,.37),
  asset(`${CITY}/trash_A.gltf`,'垃圾桶 A','♲',1.7,.37),
  asset(`${CITY}/trash_B.gltf`,'垃圾桶 B','♲',1.7,.37),
  asset(`${CITY}/box_A.gltf`,'木箱 A','□',1.7,.37),
  asset(`${CITY}/box_B.gltf`,'木箱 B','□',1.7,.37),
  asset(`${CITY}/car_sedan.gltf`,'轿车','▱',1.3,.47),
  asset(`${CITY}/car_taxi.gltf`,'出租车','▱',1.3,.47),
  asset(`${CITY}/car_police.gltf`,'警车','▱',1.3,.47),
  asset(`${CITY}/car_hatchback.gltf`,'掀背车','▱',1.3,.47),
  asset(`${CITY}/car_stationwagon.gltf`,'旅行车','▱',1.3,.47),
 ],
 decorations:[
 asset(`${INTERIOR}/park/tree.gltf`,'树','🌳',.7,.37),
  asset(`${CITY}/bush.gltf`,'城市灌木','✿',1.65,.37),
  asset(`${INTERIOR}/park/bush.gltf`,'灌木','✿',.72,.37),
  asset(`${INTERIOR}/park/bench.gltf`,'公园长椅','▰',.72,.37),
  asset(`${INTERIOR}/park/fountain.gltf`,'喷泉','◉',.62,.37),
  asset(`${INTERIOR}/plants/monstera_plant_medium_potted.gltf`,'盆栽','♧',.7,.37),
 ],
}

export const WORLD_LAYOUT_INTERIOR_ASSETS:readonly LayoutAssetDefinition[]=[
 asset(`${INTERIOR}/furniture/couch_pillows.gltf`,'沙发','▰',.55),
 asset(`${INTERIOR}/furniture/armchair_pillows.gltf`,'扶手椅','▱',.5),
 asset(`${INTERIOR}/furniture/bed_single_A.gltf`,'单人床','▭',.58),
 asset(`${INTERIOR}/furniture/table_low.gltf`,'茶几','□',.4),
 asset(`${INTERIOR}/furniture/shelf_B_large_decorated.gltf`,'书架','▥',.48),
 asset(`${INTERIOR}/furniture/lamp_standing.gltf`,'落地灯','⌉',.55),
 asset(`${INTERIOR}/furniture/rug_rectangle_A.gltf`,'地毯','▱',.8,.015),
 asset(`${INTERIOR}/kitchen/table_A.gltf`,'餐桌','□',.48),
 asset(`${INTERIOR}/kitchen/chair.gltf`,'餐椅','▱',.48),
 asset(`${INTERIOR}/kitchen/countertop_sink.gltf`,'水槽台面','▥',.5),
 asset(`${INTERIOR}/kitchen/floor_tiles_kitchen.gltf`,'厨房地砖','▦',1,.01),
 asset(`${INTERIOR}/kitchen/fridge.gltf`,'冰箱','▥',.5),
 asset(`${INTERIOR}/kitchen/stove.gltf`,'炉灶','▥',.5),
 asset(`${INTERIOR}/kitchen/kettle.gltf`,'水壶','◒',.35,.52),
 asset(`${INTERIOR}/bathroom/shower.gltf`,'淋浴间','▥',.5),
 asset(`${INTERIOR}/bathroom/bath.gltf`,'浴缸','▭',.54),
 asset(`${INTERIOR}/bathroom/cabinet_bathroom.gltf`,'浴室柜','▥',.5),
 asset(`${INTERIOR}/bathroom/floor_tiled.gltf`,'浴室地砖','▦',1,.01),
 asset(`${INTERIOR}/bathroom/mirror.gltf`,'镜子','◇',.5,1.3),
 asset(`${INTERIOR}/bathroom/toilet.gltf`,'马桶','◒',.5),
 asset(`${INTERIOR}/restaurant/dishrack_plates.gltf`,'碗碟架','▥',.48,.62),
 asset(`${INTERIOR}/restaurant/food_dinner.gltf`,'晚餐','●',.36,.46),
 asset(`${INTERIOR}/restaurant/food_burger.gltf`,'汉堡','●',.36,.46),
 asset(`${INTERIOR}/restaurant/plate.gltf`,'餐盘','○',.36,.455),
 asset(`${INTERIOR}/plants/monstera_plant_medium_potted.gltf`,'绿植','♧',.42),
 asset(`${INTERIOR}/park/tree.gltf`,'室内景观树','🌳',.62),
 asset(`${INTERIOR}/park/bush.gltf`,'室内景观灌木','✿',.46),
 asset(`${INTERIOR}/park/bench.gltf`,'室内景观长椅','▰',.58),
 asset(`${INTERIOR}/park/fountain.gltf`,'室内景观喷泉','◉',.4),
]

export const emptyWorldLayout=():WorldLayoutDocument=>({
 version:1,
 city:{roads:[],buildings:[],props:[],decorations:[]},
 interior:{rooms:[
  {id:'living-room',name:'Living room',kind:'living_room',placements:[]},
  {id:'kitchen',name:'Kitchen',kind:'kitchen',placements:[]},
  {id:'bathroom',name:'Bathroom',kind:'bathroom',placements:[]},
  {id:'bedroom',name:'Bedroom',kind:'bedroom',placements:[]},
 ]},
})

export const layoutAssetName=(path:string)=>path.split('/').pop()?.replace(/\.gltf$/,'').replaceAll('_',' ')||path
export const layoutVector=(x=0,y=0,z=0):LayoutVector3=>({x,y,z})
export const cloneWorldLayout=(value:WorldLayoutDocument):WorldLayoutDocument=>JSON.parse(JSON.stringify(value)) as WorldLayoutDocument

const objectValue=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)
const layoutVectorIsValid=(value:unknown,scale=false):value is LayoutVector3=>objectValue(value)&&['x','y','z'].every(key=>typeof value[key]==='number'&&Number.isFinite(value[key])&&(!scale||Number(value[key])>0))
const layoutPlacementIsValid=(value:unknown):value is WorldLayoutPlacement=>objectValue(value)&&typeof value.id==='string'&&Boolean(value.id)&&typeof value.asset==='string'&&Boolean(value.asset)&&layoutVectorIsValid(value.position)&&layoutVectorIsValid(value.rotation)&&layoutVectorIsValid(value.scale,true)
const interiorPlacementIsValid=(value:unknown):value is WorldLayoutInteriorPlacement=>layoutPlacementIsValid(value)&&'room_id' in value&&typeof value.room_id==='string'

/** Structural guard for local JSON imports; the protected API remains the
 * authority for asset allowlists, ids, bounds and required room semantics. */
export const isWorldLayoutDocument=(value:unknown):value is WorldLayoutDocument=>{
 if(!objectValue(value)||value.version!==1||!objectValue(value.city)||!objectValue(value.interior))return false
 const city=value.city,interior=value.interior
 if(!(['roads','buildings','props','decorations'] as const).every(layer=>Array.isArray(city[layer])&&city[layer].every(layoutPlacementIsValid)))return false
 if(!Array.isArray(interior.rooms)||!interior.rooms.every(room=>objectValue(room)&&typeof room.id==='string'&&typeof room.name==='string'&&typeof room.kind==='string'&&Array.isArray(room.placements)&&room.placements.every(interiorPlacementIsValid)))return false
 return true
}
