import {useEffect,useMemo} from 'react'
import {useLoader} from '@react-three/fiber'
import {FileLoader,type Group} from 'three'
import type {CharacterFamily} from './characterAssets'
import {retargetSocialMotion,SOCIAL_MOTION_URL,type SocialMotionLibrary} from './socialRetarget'
import {registerSocialPerformance} from './socialPerformance'

/** Loaded only for a close-up social actor; the city and portraits do not pay
 * for the extra motion library or have their current animation suspended. */
export function SocialMotionLoader({model,family}:{model:Group;family:CharacterFamily}){
 const text=useLoader(FileLoader,SOCIAL_MOTION_URL) as string
 const library=useMemo(()=>JSON.parse(text) as SocialMotionLibrary,[text])
 const clips=useMemo(()=>[
  retargetSocialMotion(library,model,family,'Idle_Talking_Loop'),
  retargetSocialMotion(library,model,family,'Sitting_Talking_Loop'),
 ],[library,model,family])
 useEffect(()=>registerSocialPerformance(model,clips[0],clips[1]),[model,clips])
 return null
}
