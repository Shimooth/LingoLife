import type {CityLandmark} from '../../components/CityMap'

export type WorldPoint=[number,number,number]
export type TimeSlot='morning'|'afternoon'|'evening'
export type BuildingFamily='residential'|'commercial'|'public'
export type KayKitBuildingModel='building_A'|'building_B'|'building_C'|'building_D'|'building_E'|'building_F'|'building_G'|'building_H'
export type KayKitRoadModel='road_straight'|'road_straight_crossing'|'road_junction'|'road_tsplit'|'road_corner'|'road_corner_curved'
export type RoadDirection='north'|'east'|'south'|'west'
export type KayKitPropModel=
 |'base'|'streetlight'|'trafficlight_A'|'trafficlight_B'|'trafficlight_C'
 |'bush'|'bench'|'watertower'|'firehydrant'|'dumpster'|'trash_A'|'trash_B'|'box_A'|'box_B'
 |'car_sedan'|'car_taxi'|'car_police'|'car_hatchback'|'car_stationwagon'

export type CityBuildingPlacement={
 id:string
 family:BuildingFamily
 model:KayKitBuildingModel
 position:[number,number]
 rotation:number
 scale:number
}

export type BuildingLot={
 id:string
 position:[number,number]
 rotation:number
 family:BuildingFamily
 district:'west'|'north'|'central'|'east'|'south'|'harbor'
}

export type RoadTilePlacement={
 id:string
 model:KayKitRoadModel
 position:[number,number]
 rotation:number
 surface:'city'|'skyway'
}

export type PropPlacement={
 id:string
 model:KayKitPropModel
 position:[number,number]
 rotation:number
 scale:number
 detail?:boolean
}

export type SkyRoadExit={
 id:string
 name:{zh:string;en:string}
 position:[number,number]
 rotation:number
 length:number
 width:number
}

export const KAYKIT_ASSET_BASE='/assets/world/kaykit-city/gltf'

// Stored homes and events still use the normalized 1200 x 760 service-space.
// Only the rendered footprint is wider than the former island.
export const WORLD_WIDTH=56
export const WORLD_DEPTH=38
export const ROAD_TILE_SCALE=1.3
export const ROAD_TILE_STEP=2*ROAD_TILE_SCALE

// Shared by the platform mesh and the parcel validator. Keeping the visible
// deck and legal build area on the same outline prevents corner buildings from
// hanging over the cloud-city edge.
export const CITY_PLATFORM_OUTLINE:readonly [number,number][]= [
 [-27,-12.8],[-23.2,-17.3],[-9.3,-17.8],[-6.8,-17.1],[7.6,-17.1],
 [10.1,-17.8],[23,-17.2],[27,-12.6],[27,-3.1],[26.4,-1.2],
 [27,1.1],[27,12.7],[22.8,17.2],[9.2,17.7],[6.7,17],[-7.8,17],
 [-10.3,17.7],[-23.1,17.1],[-27,12.8],[-27,3],[-26.4,1],[-27,-1.2],
]

export const KAYKIT_ROAD_MODELS:readonly KayKitRoadModel[]=[
 'road_straight','road_straight_crossing','road_junction','road_tsplit','road_corner','road_corner_curved',
]

const ROAD_DIRECTIONS:readonly RoadDirection[]=['north','east','south','west']
const ROAD_BASE_CONNECTIONS:Record<KayKitRoadModel,readonly RoadDirection[]>={
 road_straight:['north','south'],
 road_straight_crossing:['north','south'],
 road_junction:['north','east','south','west'],
 // KayKit's unrotated T has its closed curb on the north edge.
 road_tsplit:['east','south','west'],
 // KayKit's unrotated corner joins its east and south edges.
 road_corner:['east','south'],
 road_corner_curved:['east','south'],
}

const normalizedQuarterTurns=(rotation:number)=>((Math.round(rotation/(Math.PI/2))%4)+4)%4

/**
 * Visual road ports after applying the same positive-Y rotation used by Three.
 * Keeping this beside the placement data gives layout guards and pedestrian
 * navigation one shared interpretation of every KayKit road module.
 */
export const roadConnections=(road:Pick<RoadTilePlacement,'model'|'rotation'>):readonly RoadDirection[]=>{
 const turns=normalizedQuarterTurns(road.rotation)
 return ROAD_BASE_CONNECTIONS[road.model].map(direction=>{
  const index=ROAD_DIRECTIONS.indexOf(direction)
  return ROAD_DIRECTIONS[(index-turns+4)%4]
 })
}

export const ROAD_DIRECTION_OFFSET:Readonly<Record<RoadDirection,readonly [number,number]>>={
 north:[0,-1],east:[1,0],south:[0,1],west:[-1,0],
}

export const OPPOSITE_ROAD_DIRECTION:Readonly<Record<RoadDirection,RoadDirection>>={
 north:'south',east:'west',south:'north',west:'east',
}

export const KAYKIT_PROP_MODELS:readonly KayKitPropModel[]=[
 'base','streetlight','trafficlight_A','trafficlight_B','trafficlight_C',
 'bush','bench','watertower','firehydrant','dumpster','trash_A','trash_B','box_A','box_B',
 'car_sedan','car_taxi','car_police','car_hatchback','car_stationwagon',
]

export const DEFAULT_WORLD_LANDMARKS:CityLandmark[]=[
 {id:'city_hall',name:'City Hall',kind:'civic',district:'central',x:580,y:320},
 {id:'city_library',name:'City Library',kind:'education',district:'west',x:302,y:375},
 {id:'moonlight_cafe',name:'Moonlight Cafe',kind:'cafe',district:'central',x:485,y:435},
 {id:'city_university',name:'City University',kind:'education',district:'north',x:418,y:155},
 {id:'innovation_hub',name:'Innovation Hub',kind:'work',district:'east',x:875,y:250},
 {id:'city_hospital',name:'City Hospital',kind:'health',district:'east',x:930,y:405},
 {id:'old_town_market',name:'Old Town Market',kind:'commerce',district:'south',x:405,y:575},
 {id:'music_hall',name:'Music Hall',kind:'culture',district:'south',x:670,y:570},
 {id:'south_harbor',name:'Cloudline Station',kind:'transit',district:'harbor',x:885,y:655},
 {id:'hilltop_park',name:'Skygarden Park',kind:'nature',district:'north',x:680,y:120},
]

export const DISTRICTS=[
 {id:'west',name:{zh:'云门社区',en:'Cloudgate Quarter'},position:[-16,.24,.8] as WorldPoint,color:'#b8d88a',accent:'#709d5b'},
 {id:'north',name:{zh:'天穹学区',en:'Aether Campus'},position:[-6,.45,-10.5] as WorldPoint,color:'#acd5a0',accent:'#608f65'},
 {id:'central',name:{zh:'晴日中心',en:'Sunny Centre'},position:[1,.2,-1.5] as WorldPoint,color:'#f3cf85',accent:'#d8965f'},
 {id:'east',name:{zh:'曙光新区',en:'Dawn District'},position:[15,.3,-5.8] as WorldPoint,color:'#a5d7cb',accent:'#4f9a93'},
 {id:'south',name:{zh:'月台老城',en:'Moonrail Old Town'},position:[-5,.22,9] as WorldPoint,color:'#e7b99e',accent:'#b97060'},
 {id:'harbor',name:{zh:'云际车站',en:'Cloudline Station'},position:[16,.1,11] as WorldPoint,color:'#9ecbd2',accent:'#477f94'},
] as const

export const BUILDING_MODELS:Record<BuildingFamily,readonly KayKitBuildingModel[]>={
 residential:['building_A','building_B','building_C'],
 commercial:['building_D','building_E'],
 public:['building_F','building_G','building_H'],
}

export const buildingFamilyFor=(kind:string,id=''):BuildingFamily=>{
 const normalized=`${kind} ${id}`.toLowerCase()
 if(/home|house|residen|apartment/.test(normalized))return 'residential'
 if(/cafe|commerce|market|shop|restaurant|mall/.test(normalized))return 'commercial'
 return 'public'
}

export const buildingModelFor=(kind:string,id:string):KayKitBuildingModel=>{
 const family=buildingFamilyFor(kind,id)
 const models=BUILDING_MODELS[family]
 return models[hashString(`${family}:${id}`)%models.length]
}

const roadTile=(gx:number,gz:number,model:KayKitRoadModel,rotation=0):RoadTilePlacement=>{
 const x=gx*ROAD_TILE_STEP
 const z=gz*ROAD_TILE_STEP
 return {
  id:`road-${gx}-${gz}`,
  model,
  position:[x,z],
  rotation,
  surface:Math.abs(x)>WORLD_WIDTH/2-ROAD_TILE_STEP/2||Math.abs(z)>WORLD_DEPTH/2-ROAD_TILE_STEP/2?'skyway':'city',
 }
}

const roadMap=new Map<string,RoadTilePlacement>()
const addRoad=(gx:number,gz:number,model:KayKitRoadModel,rotation=0)=>{
 const tile=roadTile(gx,gz,model,rotation)
 roadMap.set(tile.id,tile)
}

// Cloudway passes through the city and continues into the cloud layer.
for(let gx=-14;gx<=14;gx+=1)addRoad(gx,0,'road_straight',Math.PI/2)
for(const gx of [-11,-5,0,6,11])addRoad(gx,0,'road_straight_crossing',Math.PI/2)

// Aether campus loop and its northern outbound sky-road.
for(let gz=-4;gz<0;gz+=1)addRoad(-7,gz,'road_straight')
for(let gx=-6;gx<5;gx+=1)addRoad(gx,-5,'road_straight',Math.PI/2)
for(let gz=-4;gz<0;gz+=1)addRoad(5,gz,'road_straight')
addRoad(-7,-5,'road_corner_curved',0)
addRoad(5,-5,'road_corner_curved',-Math.PI/2)
addRoad(-7,0,'road_tsplit',Math.PI)
addRoad(5,0,'road_tsplit',Math.PI)
for(let gz=-10;gz<-5;gz+=1)addRoad(-2,gz,'road_straight')
addRoad(-2,-5,'road_tsplit',Math.PI)
addRoad(-2,-7,'road_straight_crossing')

// Moonrail bends around a pedestrian-scaled inner street.
for(let gz=1;gz<5;gz+=1)addRoad(-9,gz,'road_straight')
for(let gx=-8;gx<3;gx+=1)addRoad(gx,5,'road_straight',Math.PI/2)
for(let gz=1;gz<5;gz+=1)addRoad(3,gz,'road_straight')
addRoad(-9,0,'road_tsplit',0)
addRoad(3,0,'road_tsplit',0)
addRoad(-9,5,'road_corner_curved',Math.PI/2)
addRoad(3,5,'road_tsplit',Math.PI)
for(let gx=-8;gx<-3;gx+=1)addRoad(gx,3,'road_straight',Math.PI/2)
for(let gz=1;gz<3;gz+=1)addRoad(-3,gz,'road_straight')
addRoad(-9,3,'road_tsplit',Math.PI/2)
addRoad(-3,3,'road_corner',Math.PI)
addRoad(-3,0,'road_tsplit',0)
addRoad(-6,3,'road_straight_crossing',Math.PI/2)

// The station quarter grows out of old town instead of mirroring it.
for(let gx=4;gx<10;gx+=1)addRoad(gx,5,'road_straight',Math.PI/2)
for(let gz=1;gz<5;gz+=1)addRoad(9,gz,'road_straight')
addRoad(9,0,'road_junction')
addRoad(9,5,'road_corner_curved',Math.PI)
addRoad(6,5,'road_straight_crossing',Math.PI/2)

// Dawn District has a short branch rather than another complete block.
for(let gz=-3;gz<0;gz+=1)addRoad(9,gz,'road_straight')
for(let gx=6;gx<9;gx+=1)addRoad(gx,-3,'road_straight',Math.PI/2)
addRoad(9,-3,'road_corner',-Math.PI/2)
addRoad(6,-3,'road_straight',Math.PI/2)
addRoad(5,-3,'road_tsplit',Math.PI/2)
addRoad(9,-1,'road_straight_crossing')

export const ROAD_TILES:readonly RoadTilePlacement[]=Array.from(roadMap.values())

// Every structure is assigned to one of these legal parcels before rendering.
// Parcels and roads share KayKit's 2.6-unit module; a parcel is accepted only
// when its complete base fits the platform, its cell is not a road, and it has
// a road on one side. This is the single source of truth for landmarks, homes
// and filler fabric.
const LOT_HALF_EXTENT=ROAD_TILE_STEP/2+.01
const roadCells=new Set(ROAD_TILES.map(tile=>tile.id))

const pointInsidePlatform=(x:number,z:number)=>{
 let inside=false
 for(let index=0,previous=CITY_PLATFORM_OUTLINE.length-1;index<CITY_PLATFORM_OUTLINE.length;previous=index,index+=1){
  const [xi,zi]=CITY_PLATFORM_OUTLINE[index]
  const [xj,zj]=CITY_PLATFORM_OUTLINE[previous]
  if(((zi>z)!==(zj>z))&&x<(xj-xi)*(z-zi)/(zj-zi)+xi)inside=!inside
 }
 return inside
}

const lotInsidePlatform=(x:number,z:number)=>[
 [x-LOT_HALF_EXTENT,z-LOT_HALF_EXTENT],
 [x+LOT_HALF_EXTENT,z-LOT_HALF_EXTENT],
 [x-LOT_HALF_EXTENT,z+LOT_HALF_EXTENT],
 [x+LOT_HALF_EXTENT,z+LOT_HALF_EXTENT],
].every(([cornerX,cornerZ])=>pointInsidePlatform(cornerX,cornerZ))

const cellId=(gx:number,gz:number)=>`road-${gx}-${gz}`
const lotTouchesRoad=(gx:number,gz:number)=>[
 [gx-1,gz],[gx+1,gz],[gx,gz-1],[gx,gz+1],
].some(([roadX,roadZ])=>roadCells.has(cellId(roadX,roadZ)))

const lotDistrict=(x:number,z:number):BuildingLot['district']=>{
 if(z<-7)return x>10?'east':'north'
 if(z>7)return x>5?'harbor':'south'
 if(x<-10)return 'west'
 if(x>10)return 'east'
 return 'central'
}

const lotFamily=(district:BuildingLot['district'],z:number,index:number):BuildingFamily=>{
 if(district==='central'||district==='south')return index%3===0?'public':'commercial'
 if(district==='north'||district==='east')return index%3===0?'commercial':'public'
 if(district==='harbor')return index%2?'commercial':'public'
 return Math.abs(z)<6&&index%3===0?'commercial':'residential'
}

const lotRotation=(x:number,z:number)=>{
 const nearest=ROAD_TILES.reduce((best,tile)=>{
  const distance=(tile.position[0]-x)**2+(tile.position[1]-z)**2
  return distance<best.distance?{tile,distance}:best
 },{tile:ROAD_TILES[0],distance:Number.POSITIVE_INFINITY})
 const dx=nearest.tile.position[0]-x,dz=nearest.tile.position[1]-z
 return Math.abs(dx)>Math.abs(dz)?(dx>0?Math.PI/2:-Math.PI/2):(dz>0?0:Math.PI)
}

export const BUILDING_LOTS:readonly BuildingLot[]=Array.from({length:13},(_,rowIndex)=>rowIndex-6).flatMap(gz=>
 Array.from({length:21},(_,columnIndex)=>columnIndex-10).flatMap(gx=>{
  const x=gx*ROAD_TILE_STEP,z=gz*ROAD_TILE_STEP
  if(roadCells.has(cellId(gx,gz))||!lotTouchesRoad(gx,gz)||!lotInsidePlatform(x,z))return []
  const district=lotDistrict(x,z)
  const index=(gz+6)*21+(gx+10)
  return [{
   id:`lot-${gx}-${gz}`,
   position:[x,z] as [number,number],
   rotation:lotRotation(x,z),
   family:lotFamily(district,z,index),
   district,
  }]
 }),
)

// Rotation 0 runs along Z; PI / 2 runs along X. WorldScene can use these
// extents to build the suspended under-structure below the KayKit road tiles.
export const SKY_ROAD_EXITS:readonly SkyRoadExit[]=[
 {id:'west-cloudway',name:{zh:'西部云路',en:'West Cloudway'},position:[-32.5,0],rotation:Math.PI/2,length:13,width:ROAD_TILE_STEP},
 {id:'east-cloudway',name:{zh:'东部云路',en:'East Cloudway'},position:[32.5,0],rotation:Math.PI/2,length:13,width:ROAD_TILE_STEP},
 {id:'north-aetherway',name:{zh:'北部天穹路',en:'North Aetherway'},position:[-5.2,-22.1],rotation:0,length:10.4,width:ROAD_TILE_STEP},
]

const prop=(id:string,model:KayKitPropModel,x:number,z:number,rotation=0,scale=1.3,detail=true):PropPlacement=>({
 id,model,position:[x,z],rotation,scale,detail,
})

export const STREET_PROPS:readonly PropPlacement[]=[
 ...[-23.4,-18.2,-13,-7.8,-2.6,2.6,7.8,13,18.2,23.4].flatMap((x,index)=>[
  prop(`cloudway-light-n-${index}`,'streetlight',x,-1.18,index%2?Math.PI:0,1.3,false),
  prop(`cloudway-light-s-${index}`,'streetlight',x,1.18,index%2?0:Math.PI,1.3),
 ]),
 ...[-10.4,-5.2,5.2,10.4].flatMap((z,index)=>[
  prop(`campus-light-${index}`,'streetlight',-17.05,z,index%2?Math.PI/2:-Math.PI/2,1.25),
  prop(`station-light-${index}`,'streetlight',22.25,z,index%2?Math.PI/2:-Math.PI/2,1.25),
 ]),
 prop('signal-west-a','trafficlight_A',-23.9,-1.03,0,1.35,false),
 prop('signal-west-b','trafficlight_B',-23.1,1.06,Math.PI,1.35,false),
 prop('signal-centre-a','trafficlight_C',-8.8,-1.08,Math.PI/2,1.28,false),
 prop('signal-centre-b','trafficlight_C',8.8,1.08,-Math.PI/2,1.28,false),
 prop('signal-dawn-a','trafficlight_B',22.3,-1.05,Math.PI,1.35,false),
 prop('signal-dawn-b','trafficlight_A',23.1,1.04,0,1.35,false),
 prop('hydrant-cafe','firehydrant',-4.45,2.35,.2,1.65),
 prop('hydrant-library','firehydrant',-14.7,.95,-.2,1.65),
 prop('hydrant-hospital','firehydrant',16.9,2.25,.4,1.65),
 prop('hydrant-old-town','firehydrant',-8.2,6.4,.1,1.65),
 prop('dumpster-market','dumpster',-11.7,10.2,Math.PI/2,1.45),
 prop('dumpster-dawn','dumpster',19.7,-9.6,Math.PI/2,1.45),
 prop('trash-centre-a','trash_A',-1.1,2.05,0,2),
 prop('trash-centre-b','trash_B',4.25,-2.1,0,2),
 prop('trash-campus','trash_A',-9.7,-10.5,0,2),
 prop('trash-station','trash_B',11.1,6.6,0,2),
 prop('cargo-old-a','box_A',-12.25,10.6,.2,2),
 prop('cargo-old-b','box_B',-11.8,10.9,-.2,2),
 prop('cargo-station-a','box_A',18.9,10.3,.3,2),
 prop('cargo-station-b','box_B',19.4,10.7,-.25,2),
 prop('bench-campus-a','bench',-5.9,-10.7,Math.PI/2,2.1,false),
 prop('bench-campus-b','bench',-4.8,-11.6,0,2.1),
 prop('bench-sunny-a','bench',.7,-5.5,Math.PI/2,2.1,false),
 prop('bench-sunny-b','bench',2.1,-5.9,0,2.1),
 prop('bench-moonrail-a','bench',-3.9,10.5,Math.PI/2,2.1),
 prop('bench-station-a','bench',11.8,10.6,-Math.PI/2,2.1),
 ...[[-6.5,-11.1],[-5.3,-12.2],[-3.9,-11.1],[.4,-5.2],[1.5,-6.1],[2.7,-5.2],[-4.8,10.4],[-3.6,11.2],[-2.5,10.4],[10.9,10.2],[12.1,11.2],[13.3,10.1]].map(([x,z],index)=>prop(`park-bush-${index}`,'bush',x,z,index*.68,1.65+(index%3)*.12,index%3!==0)),
 prop('watertower-cloudgate','watertower',-24.2,-12.8,.2,2.4,false),
 prop('car-taxi-centre','car_taxi',1.1,.28,Math.PI/2,1.16,false),
 prop('car-sedan-west','car_sedan',-16.6,-.28,-Math.PI/2,1.16,false),
 prop('car-police-dawn','car_police',23.3,.28,Math.PI/2,1.16,false),
 prop('car-hatchback-campus','car_hatchback',-18.45,-7.6,0,1.16),
 prop('car-stationwagon-station','car_stationwagon',15.7,13.05,Math.PI/2,1.16),
]

// A perimeter ring would flatten the floating-city silhouette; use groves.
export const TREES:readonly [number,number][]=[
 [-24,-15],[-22.9,-14.2],[-21.7,-15.4],[-20.7,-13.9],
 [-7.7,-9.8],[-6,-8.8],[-4.2,-8.8],[-2.7,-9.8],
 [-6.4,-7.6],[-3.2,-5.5],[1.2,-7.5],[4.7,-5.7],[6.4,-7.2],
 [-5.5,8.2],[-3.5,8.3],[-1.4,8.9],[-.4,10.4],
 [9.7,8.7],[14.8,9.3],[15.2,10.7],
 [24.2,-14.1],[25.1,-12.7],[23.6,-11.8],
]

export const worldPosition=(x:number,y:number,yOffset=.8):WorldPoint=>[
 ((x/1200)-.5)*WORLD_WIDTH,
 yOffset,
 ((y/760)-.5)*WORLD_DEPTH,
]

export const hashString=(value:string)=>{
 let hash=0
 for(let index=0;index<value.length;index+=1)hash=((hash<<5)-hash+value.charCodeAt(index))|0
 return Math.abs(hash)
}

export const KIND_COLORS:Record<string,{wall:string;roof:string;glow:string}>={
 civic:{wall:'#fff2d3',roof:'#d17863',glow:'#ffc868'},
 education:{wall:'#e8f0dc',roof:'#678c76',glow:'#f7d978'},
 culture:{wall:'#f4dce4',roof:'#9b6985',glow:'#ffbfdf'},
 health:{wall:'#e9f4f1',roof:'#e06d6d',glow:'#9ce3d8'},
 cafe:{wall:'#f7e2c1',roof:'#cd765d',glow:'#ffb566'},
 commerce:{wall:'#f4e0ae',roof:'#de8060',glow:'#ffd16c'},
 work:{wall:'#dcebea',roof:'#568f99',glow:'#8fdde1'},
 nature:{wall:'#e3efcf',roof:'#6f9d64',glow:'#b7e37f'},
 transit:{wall:'#dce8ec',roof:'#557c91',glow:'#94d4eb'},
 fitness:{wall:'#e4e2f1',roof:'#7771a5',glow:'#c6b8ff'},
 plaza:{wall:'#f5e9cd',roof:'#c8895b',glow:'#ffd88b'},
}
