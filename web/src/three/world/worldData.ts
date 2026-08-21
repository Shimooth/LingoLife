import type {CityLandmark} from '../../components/CityMap'

export type WorldPoint=[number,number,number]
export type TimeSlot='morning'|'afternoon'|'evening'

export const WORLD_WIDTH=34
export const WORLD_DEPTH=23

export const DEFAULT_WORLD_LANDMARKS:CityLandmark[]=[
 {id:'city_hall',name:'City Hall',kind:'civic',district:'central',x:580,y:320},
 {id:'city_library',name:'City Library',kind:'education',district:'west',x:302,y:375},
 {id:'moonlight_cafe',name:'Moonlight Cafe',kind:'cafe',district:'central',x:485,y:435},
 {id:'city_university',name:'City University',kind:'education',district:'north',x:418,y:155},
 {id:'innovation_hub',name:'Innovation Hub',kind:'work',district:'east',x:875,y:250},
 {id:'city_hospital',name:'City Hospital',kind:'health',district:'east',x:930,y:405},
 {id:'old_town_market',name:'Old Town Market',kind:'commerce',district:'south',x:405,y:575},
 {id:'music_hall',name:'Music Hall',kind:'culture',district:'south',x:670,y:570},
 {id:'south_harbor',name:'South Harbor',kind:'transit',district:'harbor',x:885,y:655},
 {id:'hilltop_park',name:'Hilltop Park',kind:'nature',district:'north',x:680,y:120},
]

export const DISTRICTS=[
 {id:'west',name:{zh:'绿荫社区',en:'Green Quarter'},position:[-10,.24,-1] as WorldPoint,color:'#b8d88a',accent:'#709d5b'},
 {id:'north',name:{zh:'山丘学区',en:'Hill Campus'},position:[-3,.45,-6.2] as WorldPoint,color:'#acd5a0',accent:'#608f65'},
 {id:'central',name:{zh:'晴日中心',en:'Sunny Centre'},position:[0,.2,-.2] as WorldPoint,color:'#f3cf85',accent:'#d8965f'},
 {id:'east',name:{zh:'新湾新区',en:'New Bay'},position:[9,.3,-1.7] as WorldPoint,color:'#a5d7cb',accent:'#4f9a93'},
 {id:'south',name:{zh:'月港老城',en:'Moonport Old Town'},position:[-3,.22,6.5] as WorldPoint,color:'#e7b99e',accent:'#b97060'},
 {id:'harbor',name:{zh:'南部港湾',en:'South Harbour'},position:[9,.1,7] as WorldPoint,color:'#9ecbd2',accent:'#477f94'},
] as const

export const BUILDING_CLUSTERS=[
 [-12,-4.9,0],[-9.7,-5.5,1],[-7.7,-5.1,2],[-12,-1.9,2],[-9.3,-2.1,0],[-7,-1.6,1],
 [-4.5,-7.2,1],[-1.8,-7.2,0],[1,-6.9,2],[-4.6,-4.4,2],[-1.6,-4.2,1],[1,-3.9,0],
 [-4.1,-1.5,0],[-1.2,-1.8,2],[2,-1.4,1],[-4,1.7,2],[-1,1.4,0],[2,1.7,1],
 [6.2,-5.4,0],[9,-5.2,2],[11.7,-4.8,1],[6,-2.1,1],[9,-2,0],[12,-1.6,2],
 [5.8,1.1,2],[8.8,1.5,1],[11.8,1.2,0],[6.2,4.1,0],[9.1,4.4,2],[12,4,1],
 [-10.8,3.4,1],[-8,3.7,0],[-5.1,4,2],[-10,6.4,2],[-7,6.9,1],[-4.3,7.1,0],
 [-1,5.1,0],[1.9,5.4,1],[-1.5,7.8,2],[1.5,7.9,0],
] as const

export const TREES=[
 [-14,-6],[-12.8,-7.4],[-10.8,-7.8],[-7.8,-8.5],[-5.7,-8.8],[-2.5,-9],[.3,-8.8],[3.4,-8.6],[7,-8.2],[10,-7.5],[13,-5.8],[14,-3.5],[14.5,.2],[14,3.2],[13,5.6],[11.8,7.6],[8.4,9.2],[5.5,9.7],[2.3,9.5],[-1.5,9.7],[-5,9.3],[-8.3,8.7],[-11.2,7.7],[-13.2,5.8],[-14.5,3],[-14.7,0],
 [-6.3,-6],[-5.7,-5.3],[-6.7,-4.9],[3.4,-6.7],[4.3,-6.2],[3.7,-5.5],[-12.6,.2],[-11.8,.8],[-12.3,1.5],[3.6,3.4],[4.5,3.8],[3.8,4.4],[-10.8,5.3],[-10.1,4.7],[-9.5,5.4],
] as const

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
