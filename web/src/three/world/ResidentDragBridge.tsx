import {useThree} from '@react-three/fiber'
import {useEffect,useRef,type MutableRefObject} from 'react'
import * as THREE from 'three'
import {residentBodyDistance,type ResidentDragController} from './residentDrag'
import {WORLD_DEPTH,WORLD_WIDTH} from './worldData'

/** Canvas geometry stays local; the common controller also accepts dock avatars. */
export function ResidentDragBridge({actors,drag}:{actors:MutableRefObject<Map<string,THREE.Group>>;drag:ResidentDragController}){
 const {camera,gl,controls,invalidate}=useThree()
 const registerMap=drag.registerMap
 const savedEnabled=useRef<boolean|undefined>(undefined)
 useEffect(()=>{
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),plane=new THREE.Plane(new THREE.Vector3(0,1,0),-.375),intersection=new THREE.Vector3()
  const feet=new THREE.Vector3(),head=new THREE.Vector3()
  const orbit=controls as unknown as {enabled:boolean}|null
  return registerMap({
   lock(value){
    if(value){if(savedEnabled.current===undefined)savedEnabled.current=orbit?.enabled;if(orbit)orbit.enabled=false}
    else if(savedEnabled.current!==undefined){if(orbit)orbit.enabled=savedEnabled.current;savedEnabled.current=undefined}
    invalidate()
   },
   project(x,y){
    const rect=gl.domElement.getBoundingClientRect()
    pointer.set((x-rect.left)/rect.width*2-1,-(y-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera)
    if(!raycaster.ray.intersectPlane(plane,intersection))return undefined
    return [THREE.MathUtils.clamp(intersection.x,-WORLD_WIDTH/2,WORLD_WIDTH/2),.7,THREE.MathUtils.clamp(intersection.z,-WORLD_DEPTH/2,WORLD_DEPTH/2)]
   },
   pick(x,y,sourceId){
    const rect=gl.domElement.getBoundingClientRect()
    if(x<rect.left||x>rect.right||y<rect.top||y>rect.bottom)return undefined
    let winner:string|undefined,distance=Infinity
    for(const [id,actor] of actors.current){
     if(id===sourceId||!actor.visible)continue
     actor.getWorldPosition(feet);head.copy(feet);head.y+=.62;feet.project(camera);head.project(camera)
     if(feet.z<-1||feet.z>1||Math.abs(feet.x)>1.1||Math.abs(feet.y)>1.1)continue
     const score=residentBodyDistance(x,y,{x:rect.left+(feet.x+1)*rect.width/2,y:rect.top+(1-feet.y)*rect.height/2},{x:rect.left+(head.x+1)*rect.width/2,y:rect.top+(1-head.y)*rect.height/2})
     const radius=Math.max(18,Math.min(42,camera instanceof THREE.OrthographicCamera?camera.zoom*.48:28))
     if(score<=radius&&score<distance){winner=id;distance=score}
    }
    return winner
   },
  })
 },[actors,camera,controls,registerMap,gl,invalidate])
 return null
}
