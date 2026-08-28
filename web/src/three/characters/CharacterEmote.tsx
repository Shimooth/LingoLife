import type {CSSProperties} from 'react'
import type {CharacterEmote as CharacterEmoteKind,CharacterExpressionPlan,CharacterExpressionVfx} from '../../life/characterExpression'
import './characterEmote.css'

const ATLAS='/assets/life/ui/emotes/vector_style6.png'
const COORDINATES:Record<CharacterEmoteKind,readonly [number,number]>={
 alert:[160,114],anger:[160,76],cloud:[128,114],dots:[96,152],drop:[96,114],drops:[96,76],
 exclamation:[96,38],exclamations:[96,0],faceAngry:[160,152],faceHappy:[64,114],faceSad:[64,76],
 heart:[64,38],heartBroken:[64,0],hearts:[32,152],idea:[32,114],laugh:[32,76],music:[32,38],
 question:[32,0],sleep:[0,152],sleeps:[0,114],star:[0,76],stars:[0,38],swirl:[0,0],
}
const VFX:Record<CharacterExpressionVfx,string>={
 sparkle:'/assets/life/ui/vfx/star_02.png',tension:'/assets/life/ui/vfx/spark_01.png',
 steam:'/assets/life/ui/vfx/smoke_03.png',dust:'/assets/life/ui/vfx/dirt_01.png',
}

export type CharacterEmoteProps={
 expression:Pick<CharacterExpressionPlan,'emote'|'tone'|'vfx'|'intensity'|'label'|'key'>
 language?:'zh'|'en'
 size?:number
 className?:string
 decorative?:boolean
}

/** Kenney's authored speech-bubble sprite, used without cropping it into a generic emoji. */
export function CharacterEmote({expression,language='zh',size=32,className='',decorative=false}:CharacterEmoteProps){
 const [x,y]=COORDINATES[expression.emote]
 const height=size*38/32
 const spriteStyle={
  width:size,height,
  backgroundImage:`url("${ATLAS}")`,backgroundSize:`${size*6}px ${height*5}px`,
  backgroundPosition:`-${x/32*size}px -${y/38*height}px`,
 } satisfies CSSProperties
 const label=expression.label[language]
 return <span
  className={`character-emote is-${expression.tone} is-intensity-${expression.intensity} ${className}`.trim()}
  data-expression-key={expression.key}
  aria-hidden={decorative||undefined}
  role={decorative?undefined:'img'}
  aria-label={decorative?undefined:label}
  title={decorative?undefined:label}
 >
  {expression.vfx&&<img className="character-emote__vfx" src={VFX[expression.vfx]} alt="" aria-hidden/>}
  <span className="character-emote__sprite" style={spriteStyle}/>
 </span>
}

export default CharacterEmote
