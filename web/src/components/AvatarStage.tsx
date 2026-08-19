import {motion,useReducedMotion} from 'motion/react'
import type {AvatarConfig,Mood} from '../types'
import {defaultAvatar} from '../avatar'

const hair:Record<string,string>={waves:'M104 126Q98 42 160 40q66 0 57 92l-16-32q-43 0-67-28-5 32-30 54',bob:'M103 177Q96 42 160 43q65 0 58 134l-18 20v-90q-45-3-68-31-7 28-13 47v94z',pixie:'M111 106Q103 46 161 44q45 0 53 52-25-18-51-9-25-18-52 19',bun:'M108 112Q102 50 160 48q56 0 55 66-38-12-73-38-7 26-34 36M139 48q-2-37 25-38 31 2 24 43',braids:'M105 125Q98 44 160 42q63 0 56 83-45-9-78-47-6 28-33 47M111 113l-17 119M209 113l18 119',curly:'M102 139q-13-30 8-42-15-29 15-39 11-28 38-15 28-18 43 12 29 10 14 40 20 25-4 47-19-45-52-65-10 31-66 62',ponytail:'M105 126Q99 44 160 42q63 0 56 85-42-13-77-50-6 31-34 49M207 73q55 25 31 112-10-62-41-73',locs:'M104 123Q99 43 160 41q63 0 56 82-37-12-76-47-8 31-36 47M110 103l-12 135m31-151-7 151m77-136 17 136m-36-151 8 151',straight:'M104 190Q95 43 160 41q68 0 57 149l-21-70 5-23q-36-1-64-23-5 28-18 43z',mohawk:'M116 103q4-55 20-82l13 27 17-42 16 43 22-22 3 76q-48-27-91 0'}
const outfits:Record<string,string>={sweater:'M91 340q7-108 69-109 62 2 69 109z',hoodie:'M83 340q9-101 77-111 68 10 77 111z',blazer:'M85 340q8-99 75-108 67 9 75 108l-57-2-18-60-18 60z',dress:'M79 340q21-108 81-108t81 108z',tee:'M91 340q5-98 69-105 64 7 69 105z',overalls:'M88 340q8-99 72-105 64 6 72 105h-47l-4-70h-42l-4 70z',cardigan:'M87 340q8-101 73-106 65 5 73 106h-67l-6-67-6 67z',jacket:'M82 340q10-100 78-108 68 8 78 108h-65l-13-70-13 70z'}
const faceRx:Record<string,number>={oval:43,round:48,heart:44,square:46,long:39}
const eyes:Record<string,[number,number]>={round:[5,6],soft:[7,4],wide:[8,6],sleepy:[7,2]}
const mouths:Record<string,string>={soft:'M145 151q15 7 30 0',smile:'M142 147q18 20 36 0',bold:'M143 151q17-7 34 0-17 13-34 0',tiny:'M153 152h15'}

function ClothingDetails({kind,color}:{kind:string;color:string}){
 if(kind==='hoodie')return <g fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="2"><path d="M136 241q24 22 48 0M151 250v31m18-31v31"/><circle cx="151" cy="283" r="3" fill="#fff"/><circle cx="169" cy="283" r="3" fill="#fff"/></g>
 if(kind==='blazer')return <g fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="3"><path d="M136 237l24 44 25-44M160 281v55"/></g>
 if(kind==='overalls')return <g><path d="M137 257h46v70h-46z" fill="#fff" fillOpacity=".18"/><path d="M139 238l8 30m34-30-8 30" stroke="#fff" strokeOpacity=".6" strokeWidth="5"/><circle cx="147" cy="268" r="3" fill="#f1d08c"/><circle cx="173" cy="268" r="3" fill="#f1d08c"/></g>
 if(kind==='cardigan'||kind==='jacket')return <g fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth="2"><path d="M160 240v98"/>{kind==='cardigan'&&[270,292,314].map(y=><circle key={y} cx="160" cy={y} r="2.5" fill="#fff"/>)}</g>
 if(kind==='dress')return <path d="M111 302q49 16 98 0" fill="none" stroke="#fff" strokeOpacity=".45" strokeWidth="3"/>
 return <path d="M140 239q20 16 40 0" fill="none" stroke={color} strokeWidth="2" opacity=".35"/>
}

export function AvatarStage({mood='idle',avatar=defaultAvatar,compact=false,scene=false}:{mood?:Mood;avatar?:AvatarConfig;compact?:boolean;scene?:boolean}){
 const reduce=useReducedMotion(),eye=eyes[avatar.eyes]||eyes.round
 return <section className={`stage avatar-stage ${compact?'compact':''} ${scene?'scene-avatar':''}`}><svg className="room-art" viewBox={scene?'70 30 180 315':'0 0 320 390'} role="img" aria-label={`Character feeling ${mood}`}>
  {!scene&&<><rect width="320" height="390" fill="#f0d2bd"/><rect y="286" width="320" height="104" fill="#d7b496"/><rect x="28" y="35" width="82" height="112" rx="4" fill="#fff0df"/><rect x="36" y="43" width="66" height="96" fill="#8792a8"/><path d="M69 43v96M36 90h66" stroke="#fff0df" strokeWidth="5"/></>}
  <motion.g animate={reduce?undefined:{y:mood==='happy'?[0,-6,0]:[0,2,0]}} transition={{duration:mood==='happy'?1.4:3.8,repeat:Infinity}}>
   <path d="M122 318h35l-4 67h-43zM163 318h35l12 67h-43z" fill="#535866"/><path d="M108 380h47v10h-51q-7-4 4-10m58 0h45q11 6 3 10h-48z" fill="#3e3940"/>
   <path d="M140 174q20 13 40 0v77h-40z" fill={avatar.skin}/>
   <path d="M111 253q-20 32-24 76M209 253q20 32 24 76" fill="none" stroke={avatar.outfitColor} strokeWidth="25" strokeLinecap="round"/><circle cx="86" cy="331" r="11" fill={avatar.skin}/><circle cx="234" cy="331" r="11" fill={avatar.skin}/>
   <path d={outfits[avatar.outfit]||outfits.sweater} fill={avatar.outfitColor}/><ClothingDetails kind={avatar.outfit} color={avatar.outfitColor}/>
   <path d={hair[avatar.hair]||hair.waves} fill={avatar.hairColor} stroke={avatar.hairColor} strokeWidth="14" strokeLinecap="round"/>
   <ellipse cx="116" cy="137" rx="8" ry="13" fill={avatar.skin}/><ellipse cx="204" cy="137" rx="8" ry="13" fill={avatar.skin}/>
   <ellipse cx="160" cy="131" rx={faceRx[avatar.face]||43} ry={avatar.face==='long'?72:64} fill={avatar.skin}/><path d={hair[avatar.hair]||hair.waves} fill={avatar.hairColor}/>
   <path d={avatar.brows==='straight'?'M126 108h25M169 108h25':'M126 109q12-6 25 0M169 109q12-6 25 0'} fill="none" stroke={avatar.hairColor} strokeWidth={avatar.brows==='bold'?5:3}/>
   <motion.g animate={reduce?undefined:{scaleY:[1,1,.08,1]}} transition={{duration:5,repeat:Infinity,times:[0,.75,.78,.81]}}><ellipse cx="140" cy="122" rx={eye[0]} ry={eye[1]} fill="#3f3438"/><ellipse cx="180" cy="122" rx={eye[0]} ry={eye[1]} fill="#3f3438"/></motion.g>
   <path d={avatar.nose==='long'?'M159 124q-5 19 3 24':avatar.nose==='wide'?'M152 143q8 7 16 0':'M158 130q-3 12 3 14'} fill="none" stroke="#c98975" strokeWidth="2"/>
   <motion.path d={mouths[avatar.mouth]||mouths.soft} animate={{scaleX:mood==='sad'?.92:1,scaleY:mood==='happy'?1.08:1}} style={{transformOrigin:'160px 152px'}} fill="none" stroke="#9e5260" strokeWidth="3" strokeLinecap="round"/>
   {avatar.accessory==='glasses'&&<g fill="none" stroke="#504951" strokeWidth="3"><circle cx="139" cy="122" r="13"/><circle cx="181" cy="122" r="13"/><path d="M152 122h16"/></g>}{avatar.accessory==='earrings'&&<g fill="#dfad42"><circle cx="112" cy="142" r="5"/><circle cx="208" cy="142" r="5"/></g>}{avatar.accessory==='headphones'&&<path d="M111 132q-2-82 49-82t49 82" fill="none" stroke="#54566f" strokeWidth="10"/>}{avatar.accessory==='hairclip'&&<path d="M116 89l18-8" stroke="#f4cf55" strokeWidth="7"/>}{avatar.accessory==='necklace'&&<path d="M140 226q20 24 40 0" fill="none" stroke="#e4bc55" strokeWidth="3"/>}{avatar.accessory==='scarf'&&<path d="M126 218q34 25 68 0l-9 38h-50z" fill="#d9905e"/>}{avatar.accessory==='beanie'&&<path d="M111 87q5-52 49-52t50 52z" fill="#657d79"/>}{avatar.accessory==='freckles'&&<g fill="#aa705f"><circle cx="133" cy="139" r="1.5"/><circle cx="140" cy="141" r="1"/><circle cx="180" cy="141" r="1"/><circle cx="187" cy="139" r="1.5"/></g>}
  </motion.g>
 </svg>{!compact&&!scene&&<p className="stage-caption">Your story grows with every conversation.</p>}</section>
}
