import {motion,useReducedMotion} from 'motion/react'
import type {AvatarConfig,Mood} from '../types'
import {defaultAvatar} from '../avatar'

const hairAlias:Record<string,string>={waves:'swoop',pixie:'sprout',braids:'shaggy',curly:'curls',ponytail:'bun',locs:'curls',straight:'bob',mohawk:'sprout'}
const outfitAlias:Record<string,string>={sweater:'jumper',dress:'playful',tee:'jumper',cardigan:'jacket'}
const eyeAlias:Record<string,string>={round:'dot',soft:'oval',wide:'sparkle'}
const browAlias:Record<string,string>={soft:'tiny'}
const noseAlias:Record<string,string>={long:'triangle',wide:'round'}
const mouthAlias:Record<string,string>={soft:'smile',bold:'open',tiny:'pout'}

const facePaths:Record<string,string>={
 round:'M160 68c-43 0-54 27-51 68 3 44 22 71 51 71s48-27 51-71c3-41-8-68-51-68Z',
 oval:'M160 65c-36 0-48 25-46 69 2 48 20 77 46 77s44-29 46-77c2-44-10-69-46-69Z',
 bean:'M161 66c-39-3-56 23-51 70 5 45 21 70 50 72 31-5 48-31 51-75 2-39-10-64-50-67Z',
 square:'M160 68c-39 0-50 22-50 60v47l23 32h54l23-32v-47c0-38-11-60-50-60Z',
 heart:'M160 67c-44 0-56 27-50 68 6 41 23 68 50 78 27-10 44-37 50-78 6-41-6-68-50-68Z',
}
const hairPaths:Record<string,string>={
 swoop:'M104 130Q99 48 159 44q62 1 58 83-42-3-77-34-80-52-8 34-33 55Z',
 bob:'M101 179Q94 45 160 43q68 0 59 136l-20 21v-91q-43-2-68-31-5 31-12 49v73Z',
 sprout:'M107 118q0-70 54-73 56 2 53 73-28-25-56-28-28 3-51 28M156 47q-17-27 2-36 18 8 2 36m4 0q15-28 34-17-1 21-34 17',
 bun:'M106 121Q102 50 160 47q57 2 55 75-35-8-74-43-8 30-37 42M139 48q-4-37 24-39 33 3 25 44',
 curls:'M100 144q-13-31 9-45-12-32 19-39 10-28 38-14 27-17 43 13 28 12 10 41 20 27-2 47-27-30-59-64-11 35-64 61',
 shaggy:'M101 138Q95 48 160 43q67 3 60 95l-21-33-13 20-23-37-18 35-18-18-26 33',
}
const topPaths:Record<string,string>={
 jumper:'M91 302q7-87 69-91 62 4 69 91Z',hoodie:'M84 302q8-81 76-93 68 12 76 93Z',jacket:'M82 302q10-84 78-91 68 7 78 91Z',playful:'M87 302q19-89 73-89t73 89Z',overalls:'M88 302q9-85 72-91 63 6 72 91h-47l-4-63h-42l-4 63Z',blazer:'M84 302q8-84 76-91 68 7 76 91l-57-2-19-55-19 55Z',
}
const pantsPaths:Record<string,string>={
 balloon:'M108 296h51l-5 86h-50q-7-48 4-86m53 0h51q11 38 4 86h-50Z',straight:'M112 296h45l-3 89h-45Zm51 0h45l3 89h-45Z',wide:'M105 296h55l-7 89H98Zm55 0h55l7 89h-55Z',shorts:'M103 296h57l-8 47h-52Zm57 0h57l3 47h-52Z',cargo:'M106 296h52l-5 89h-49Zm54 0h52l5 89h-49Z',pleated:'M100 296h120l-13 57h-94Z',
}

function Eyes({kind}:{kind:string}){const type=eyeAlias[kind]||kind
 if(type==='sleepy')return <g fill="none" stroke="#40363a" strokeWidth="4" strokeLinecap="round"><path d="M130 124q10 7 20 0M170 124q10 7 20 0"/></g>
 if(type==='wink')return <g fill="#40363a" stroke="#40363a" strokeLinecap="round"><ellipse cx="140" cy="122" rx="5" ry="7"/><path d="M173 123q9 7 18 0" fill="none" strokeWidth="4"/></g>
 if(type==='sparkle')return <g fill="#40363a"><path d="m140 112 3 7 7 3-7 3-3 8-3-8-7-3 7-3Z"/><path d="m180 112 3 7 7 3-7 3-3 8-3-8-7-3 7-3Z"/></g>
 if(type==='curious')return <g fill="#40363a"><ellipse cx="139" cy="121" rx="5" ry="8"/><ellipse cx="181" cy="125" rx="7" ry="5"/></g>
 return <g fill="#40363a"><ellipse cx="140" cy="122" rx={type==='oval'?7:5} ry={type==='oval'?5:7}/><ellipse cx="180" cy="122" rx={type==='oval'?7:5} ry={type==='oval'?5:7}/></g>
}
function Brows({kind,color}:{kind:string;color:string}){const type=browAlias[kind]||kind,strokeWidth=type==='bold'?5:3
 const d=type==='straight'?'M126 106h25M169 106h25':type==='worried'?'M126 111q12-10 25-2M169 109q12-8 25 2':'M126 109q12-6 25 0M169 109q12-6 25 0'
 return <path d={d} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"/>
}
function Nose({kind}:{kind:string}){const type=noseAlias[kind]||kind
 if(type==='dot')return <circle cx="160" cy="141" r="2.5" fill="#b97767"/>
 if(type==='triangle')return <path d="m159 130-5 17h12" fill="none" stroke="#c18170" strokeWidth="2.5" strokeLinejoin="round"/>
 if(type==='round')return <path d="M153 142q7 8 14 0" fill="none" stroke="#c18170" strokeWidth="3" strokeLinecap="round"/>
 if(type==='heart')return <path d="M160 146c-8-5-7-12-1-10l1 2 1-2c6-2 7 5-1 10Z" fill="#c18170"/>
 return <path d="M158 132q-4 11 3 14" fill="none" stroke="#c18170" strokeWidth="2.5" strokeLinecap="round"/>
}
function Mouth({kind,mood}:{kind:string;mood:Mood}){const type=mouthAlias[kind]||kind
 const d=mood==='sad'?'M145 158q15-12 30 0':type==='open'?'M144 151q16 18 32 0-16 25-32 0Z':type==='cat'?'M143 151q9 9 17 0 8 9 17 0':type==='pout'?'M151 154q9-6 18 0-9 7-18 0':type==='tongue'?'M144 150q16 18 32 0-16 25-32 0Z':'M143 149q17 19 34 0'
 return <g><path d={d} fill={type==='open'||type==='tongue'?'#743f4c':'none'} stroke="#954d5c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>{type==='tongue'&&<path d="M153 163q7 8 14 0" stroke="#f08e9a" strokeWidth="4" strokeLinecap="round"/>}</g>
}
function TopDetails({kind}:{kind:string}){
 if(kind==='hoodie')return <path d="M135 221q25 22 50 0M151 237v28m18-28v28" fill="none" stroke="#fff" strokeOpacity=".65" strokeWidth="3"/>
 if(kind==='jacket'||kind==='blazer')return <path d="M160 217v83M137 218l23 39 24-39" fill="none" stroke="#fff" strokeOpacity=".58" strokeWidth="3"/>
 if(kind==='overalls')return <g><path d="M138 239h44v60h-44z" fill="#fff" fillOpacity=".2"/><path d="M140 216l8 32m32-32-8 32" stroke="#fff" strokeOpacity=".7" strokeWidth="5"/></g>
 if(kind==='playful')return <g fill="#fff3"><circle cx="142" cy="248" r="8"/><circle cx="177" cy="270" r="6"/><path d="m173 227 6 12 13 2-10 9 2 13-11-7-12 7 3-13-10-9 13-2Z"/></g>
 return <path d="M139 217q21 15 42 0" fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth="3"/>
}
function PantsDetails({kind}:{kind:string}){if(kind!=='cargo'&&kind!=='pleated')return null
 return kind==='cargo'?<g fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="2"><rect x="111" y="321" width="23" height="18" rx="4"/><rect x="187" y="321" width="23" height="18" rx="4"/></g>:<g stroke="#fff" strokeOpacity=".34" strokeWidth="2"><path d="M118 301l9 50m18-50 3 50m27-50-3 50m28-50-8 50"/></g>}
function Accessories({kind}:{kind:string}){if(kind==='glasses')return <g fill="none" stroke="#514a54" strokeWidth="3"><circle cx="139" cy="122" r="13"/><circle cx="181" cy="122" r="13"/><path d="M152 122h16"/></g>
 if(kind==='earrings')return <g fill="#f2b745"><circle cx="109" cy="143" r="5"/><circle cx="211" cy="143" r="5"/></g>
 if(kind==='headphones')return <path d="M109 132q0-80 51-80t51 80" fill="none" stroke="#596078" strokeWidth="11"/>
 if(kind==='scarf')return <path d="M126 204q34 25 68 0l-10 45h-49Z" fill="#e89b62"/>
 if(kind==='beanie')return <g><path d="M109 86q7-53 51-53t52 53Z" fill="#6b8e82"/><path d="M109 82h103v17H109z" fill="#52766b"/></g>
 if(kind==='frogclip')return <g fill="#7cbd63" stroke="#446b43" strokeWidth="2"><circle cx="122" cy="87" r="10"/><circle cx="135" cy="87" r="10"/><circle cx="128" cy="96" r="12"/><circle cx="125" cy="94" r="1.5" fill="#233"/><circle cx="132" cy="94" r="1.5" fill="#233"/></g>
 return null}

export function AvatarStage({mood='idle',avatar=defaultAvatar,compact=false,scene=false,preview,staticPreview=false}:{mood?:Mood;avatar?:AvatarConfig;compact?:boolean;scene?:boolean;preview?:'head'|'body';staticPreview?:boolean}){
 const reduce=useReducedMotion(),hair=hairAlias[avatar.hair]||avatar.hair,outfit=outfitAlias[avatar.outfit]||avatar.outfit,pants=avatar.pants||'balloon'
 const viewBox=preview==='head'?'85 35 150 185':preview==='body'?'78 190 164 205':scene?'70 25 180 365':'0 0 320 410'
 return <section className={`stage avatar-stage avatar-stage--v3 ${compact?'compact':''} ${scene?'scene-avatar':''} ${preview?'avatar-preview':''}`}><svg className="room-art" viewBox={viewBox} role="img" aria-label={`Character feeling ${mood}`}>
  {!scene&&!preview&&<><rect width="320" height="410" fill="#f4ddcf"/><rect y="305" width="320" height="105" fill="#d4b493"/></>}
  <motion.g animate={reduce||staticPreview?undefined:{y:mood==='happy'?[0,-5,0]:[0,2,0]}} transition={{duration:mood==='happy'?1.5:3.8,repeat:Infinity}}>
   <path d={pantsPaths[pants]||pantsPaths.balloon} fill={pants==='pleated'?'#556477':'#4f6170'}/><PantsDetails kind={pants}/>
   <path d="M117 374h38v14h-50q-7-8 12-14m48 0h38q19 6 11 14h-49Z" fill="#353c44"/>
   <path d="M112 230Q92 251 88 289M208 230q20 21 24 59" fill="none" stroke={avatar.skin} strokeWidth="17" strokeLinecap="round"/><path d="M112 230Q101 243 98 258M208 230q11 13 15 28" fill="none" stroke={avatar.outfitColor} strokeWidth="27" strokeLinecap="round"/><circle cx="87" cy="294" r="11" fill={avatar.skin}/><circle cx="233" cy="294" r="11" fill={avatar.skin}/>
   <path d="M142 173v43h36v-43Z" fill={avatar.skin}/><path d={topPaths[outfit]||topPaths.jumper} fill={avatar.outfitColor}/><TopDetails kind={outfit}/>
   <path d={hairPaths[hair]||hairPaths.swoop} fill={avatar.hairColor} stroke={avatar.hairColor} strokeWidth="16" strokeLinecap="round"/>
   <ellipse cx="111" cy="137" rx="8" ry="13" fill={avatar.skin}/><ellipse cx="209" cy="137" rx="8" ry="13" fill={avatar.skin}/><path d={facePaths[avatar.face]||facePaths.round} fill={avatar.skin} stroke="#8f5b52" strokeOpacity=".16" strokeWidth="1.5"/><path d={hairPaths[hair]||hairPaths.swoop} fill={avatar.hairColor}/>
   <Brows kind={avatar.brows} color={avatar.hairColor}/><motion.g animate={reduce||staticPreview?undefined:{scaleY:[1,1,.08,1]}} transition={{duration:5,repeat:Infinity,times:[0,.75,.78,.81]}} style={{transformOrigin:'160px 122px'}}><Eyes kind={avatar.eyes}/></motion.g><Nose kind={avatar.nose}/><Mouth kind={avatar.mouth} mood={mood}/><Accessories kind={avatar.accessory}/>
  </motion.g>
 </svg>{!compact&&!scene&&!preview&&<p className="stage-caption">Your story grows with every conversation.</p>}</section>
}
