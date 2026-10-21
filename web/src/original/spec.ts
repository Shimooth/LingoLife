export type OriginalMotion='idle'|'wave'|'walk'|'talk'|'receive'|'eat'|'happy'
export type OriginalEmotion='neutral'|'happy'|'curious'|'sad'
export type OriginalQuality='high'|'low'
export type OriginalTimeOfDay='day'|'sunset'|'night'
export type OriginalAppearance={
 version:1
 faceWidth:number;faceHeight:number;jawWidth:number;cheeks:number;chin:number;forehead:number
 eyeSize:number;eyeSpacing:number;eyeHeight:number;eyeTilt:number;irisSize:number
 browHeight:number;browAngle:number;browThickness:number
 noseWidth:number;noseLength:number;noseHeight:number
 mouthWidth:number;mouthHeight:number;lipFullness:number
 earSize:number;earHeight:number
 height:number;bodyWidth:number;shoulderWidth:number;legLength:number;armLength:number;headScale:number
 freckles:number
 skin:string;hairColor:string;eyeColor:string;topColor:string;bottomColor:string;shoeColor:string
 hair:'sweep'|'bob'|'curl'|'bun'|'crop'
 outfit:'knit'|'jacket'|'overalls'
 accessory:'none'|'glasses'|'earrings'
}
export const ORIGINAL_DEFAULT:OriginalAppearance={version:1,
 faceWidth:.5,faceHeight:.48,jawWidth:.45,cheeks:.55,chin:.48,forehead:.5,
 eyeSize:.5,eyeSpacing:.5,eyeHeight:.5,eyeTilt:.5,irisSize:.5,
 browHeight:.5,browAngle:.5,browThickness:.45,noseWidth:.45,noseLength:.5,noseHeight:.5,
 mouthWidth:.5,mouthHeight:.5,lipFullness:.45,earSize:.5,earHeight:.5,
 height:.5,bodyWidth:.45,shoulderWidth:.5,legLength:.5,armLength:.5,headScale:.5,freckles:.25,
 skin:'#eac3a0',hairColor:'#543c30',eyeColor:'#516b57',topColor:'#f0dfc1',bottomColor:'#71816b',shoeColor:'#f2e9d9',
 hair:'sweep',outfit:'knit',accessory:'none',
}
export type OriginalNumberKey={ [K in keyof OriginalAppearance]:OriginalAppearance[K] extends number?K:never }[keyof OriginalAppearance]
export type OriginalColorKey='skin'|'hairColor'|'eyeColor'|'topColor'|'bottomColor'|'shoeColor'
export const ORIGINAL_CONTROLS:{id:Exclude<OriginalNumberKey,'version'>;label:string;group:'face'|'eyes'|'features'|'body'}[]=[
 {id:'faceWidth',label:'脸部宽度',group:'face'},{id:'faceHeight',label:'脸部长度',group:'face'},
 {id:'jawWidth',label:'下颌宽度',group:'face'},{id:'cheeks',label:'脸颊饱满',group:'face'},
 {id:'chin',label:'下巴长度',group:'face'},{id:'forehead',label:'额头弧度',group:'face'},
 {id:'eyeSize',label:'眼睛大小',group:'eyes'},{id:'eyeSpacing',label:'双眼间距',group:'eyes'},
 {id:'eyeHeight',label:'眼睛位置',group:'eyes'},{id:'eyeTilt',label:'眼角倾斜',group:'eyes'},
 {id:'irisSize',label:'瞳仁大小',group:'eyes'},{id:'browHeight',label:'眉毛位置',group:'eyes'},
 {id:'browAngle',label:'眉毛角度',group:'eyes'},{id:'browThickness',label:'眉毛粗细',group:'eyes'},
 {id:'noseWidth',label:'鼻翼宽度',group:'features'},{id:'noseLength',label:'鼻尖立体感',group:'features'},
 {id:'noseHeight',label:'鼻子位置',group:'features'},{id:'mouthWidth',label:'嘴巴宽度',group:'features'},
 {id:'mouthHeight',label:'嘴巴位置',group:'features'},{id:'lipFullness',label:'嘴唇饱满',group:'features'},
 {id:'earSize',label:'耳朵大小',group:'features'},{id:'earHeight',label:'耳朵位置',group:'features'},
 {id:'freckles',label:'雀斑浓度',group:'features'},
 {id:'height',label:'身高',group:'body'},{id:'bodyWidth',label:'身形饱满',group:'body'},
 {id:'shoulderWidth',label:'肩部宽度',group:'body'},{id:'legLength',label:'腿部比例',group:'body'},
 {id:'armLength',label:'手臂长度',group:'body'},{id:'headScale',label:'头身比例',group:'body'},
]
export const ORIGINAL_PRESETS:{id:string;name:string;note:string;appearance:OriginalAppearance}[]=[
 {id:'mori',name:'沐禾',note:'温暖 · 自在',appearance:{...ORIGINAL_DEFAULT}},
 {id:'yu',name:'阿屿',note:'开朗 · 好奇',appearance:{...ORIGINAL_DEFAULT,skin:'#b97953',hair:'curl',hairColor:'#322922',eyeColor:'#594332',faceWidth:.62,jawWidth:.66,eyeSize:.38,bodyWidth:.65,shoulderWidth:.68,topColor:'#799280',bottomColor:'#d7c3a2',outfit:'jacket',freckles:0}},
 {id:'lin',name:'小林',note:'安静 · 敏锐',appearance:{...ORIGINAL_DEFAULT,hair:'bob',hairColor:'#322d31',eyeColor:'#645a45',faceWidth:.35,faceHeight:.6,eyeTilt:.62,eyeSize:.36,bodyWidth:.3,topColor:'#c58a6e',bottomColor:'#666f76',outfit:'overalls',accessory:'glasses',freckles:.12}},
 {id:'nana',name:'娜娜',note:'活泼 · 浪漫',appearance:{...ORIGINAL_DEFAULT,hair:'bun',hairColor:'#986b3e',skin:'#e0aa83',eyeColor:'#6d7c80',eyeSize:.65,cheeks:.7,headScale:.6,height:.32,topColor:'#ba8278',bottomColor:'#7a887a',accessory:'earrings',freckles:.6}},
]
export const ORIGINAL_PALETTES={
 skin:['#f0d4b8','#eac3a0','#d6a079','#b97953','#8e5e44','#614532'],
 hairColor:['#322922','#543c30','#81533a','#b28652','#d0c6b2','#9a6465'],
 eyeColor:['#594332','#516b57','#697f8b','#403339','#a47a45'],
 topColor:['#f0dfc1','#799280','#c58a6e','#ba8278','#738598','#d4b46d'],
 bottomColor:['#71816b','#d7c3a2','#666f76','#493e36','#bd8b6d'],
 shoeColor:['#f2e9d9','#685648','#a37455','#526d60'],
} satisfies Record<OriginalColorKey,string[]>
/** Import and persisted data are untrusted; finite, bounded values only. */
export function normalizeOriginalAppearance(input:unknown):OriginalAppearance{
 const raw=input&&typeof input==='object'?input as Record<string,unknown>:{}
 const result={...ORIGINAL_DEFAULT}
 for(const control of ORIGINAL_CONTROLS){const value=raw[control.id];if(typeof value==='number'&&Number.isFinite(value))result[control.id]=Math.max(0,Math.min(1,value))}
 for(const key of Object.keys(ORIGINAL_PALETTES) as OriginalColorKey[]){const value=raw[key];if(typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value))result[key]=value}
 for(const key of ['hair','outfit','accessory'] as const){const values={hair:['sweep','bob','curl','bun','crop'],outfit:['knit','jacket','overalls'],accessory:['none','glasses','earrings']};if(typeof raw[key]==='string'&&values[key].includes(raw[key] as string))Object.assign(result,{[key]:raw[key]})}
 return result
}
