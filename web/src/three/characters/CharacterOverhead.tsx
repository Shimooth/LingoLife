import {useMemo,useRef,type ReactNode} from 'react'
import {useFrame} from '@react-three/fiber'
import {Html} from '@react-three/drei'
import {Box3,Vector3,type Group} from 'three'
import {visibleCharacterBounds} from './visibleCharacterBounds'

/** Legacy procedural avatars and imported models have different heights. */
export function CharacterOverhead({children,label}:{children:ReactNode;label:ReactNode}){
 const subject=useRef<Group>(null),anchor=useRef<Group>(null),elapsed=useRef(1)
 const scratch=useMemo(()=>({box:new Box3(),part:new Box3(),point:new Vector3()}),[])
 useFrame((_,delta)=>{
  elapsed.current+=delta
  if(elapsed.current<.12||!subject.current||!anchor.current?.parent)return
  elapsed.current=0
  visibleCharacterBounds(subject.current,scratch.box,scratch.part)
  if(scratch.box.isEmpty())return
  scratch.box.getCenter(scratch.point);scratch.point.y=scratch.box.max.y+.22
  anchor.current.parent.worldToLocal(scratch.point)
  anchor.current.position.copy(scratch.point)
  anchor.current.visible=true
 })
 return <><group ref={subject}>{children}</group><group ref={anchor} visible={false}>{label&&<Html center zIndexRange={[6,4]} style={{pointerEvents:'none'}}>{label}</Html>}</group></>
}
