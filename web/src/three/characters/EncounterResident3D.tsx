import {useRef} from 'react'
import {useFrame} from '@react-three/fiber'
import {Html} from '@react-three/drei'
import {MathUtils,type Group} from 'three'
import type {AvatarConfig,LifeStory,LifeStoryBeat} from '../../types'
import {Character3D} from './Character3D'
import './CharacterLabels.css'
import {encounterActing} from '../../life/encounterActing'

export function EncounterResident3D({story,person,index,count,avatar,activeBeat,reducedMotion}:{story:LifeStory;person:{id:string;name:string};index:number;count:number;avatar:AvatarConfig;activeBeat?:LifeStoryBeat;reducedMotion:boolean}){
 const root=useRef<Group>(null),plan=encounterActing(story,person.id,index,activeBeat)
 const x=count===1?0:count===2?(index===0?-1:1):(index-1)*1.25
 useFrame((_,delta)=>{if(root.current)root.current.rotation.y=MathUtils.damp(root.current.rotation.y,plan.bodyYaw,4,reducedMotion?1:Math.min(.05,delta))})
 return <group position={[x,0,.6]} name={`encounter-resident:${person.id}`}>
  <group ref={root}>
   <Character3D avatar={avatar} name={person.name} seed={person.id} scale={count===3?.7:.78}
    animation={plan.animation} animationKey={activeBeat?.id??'waiting'} animationSpeed={plan.speaking?.83:.72}
    animationTransitionMs={350} animationPaused={reducedMotion} motionScale={.18}
    faceExpression={plan.expression} faceSpeaking={plan.speaking} faceAttention={plan.direction*.35}/>
  </group>
  <Html center position={[0,.04,1]} zIndexRange={[5,3]} style={{pointerEvents:'none'}}>
   <span className={`encounter-resident-name${plan.speaking?' is-speaking':''}`}>{person.name}</span>
  </Html>
 </group>
}
