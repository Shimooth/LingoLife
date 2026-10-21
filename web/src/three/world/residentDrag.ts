import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react'
import type {WorldPoint} from './worldData'

export const RESIDENT_DRAG_DISTANCE=7
export const RESIDENT_LONG_PRESS_MS=360
export type ResidentDragOrigin='map'|'dock'
export type ResidentDragSnapshot={pointerType:string;sourceId:string;targetId?:string;origin:ResidentDragOrigin;phase:'pressing'|'dragging';x:number;y:number;position?:WorldPoint}
export type ResidentDragMap={pick:(x:number,y:number,sourceId:string)=>string|undefined;project:(x:number,y:number)=>WorldPoint|undefined;lock:(value:boolean)=>void}
export type ResidentDragController={snapshot:ResidentDragSnapshot|null;pending:boolean;failed:boolean;begin:(event:PointerEvent,id:string,origin:ResidentDragOrigin)=>void;cancel:()=>void;suppressClick:(id:string)=>boolean;registerMap:(map:ResidentDragMap)=>()=>void}
type DockScroll={pointerId:number;element:HTMLElement;startX:number;scrollLeft:number}
type Session=ResidentDragSnapshot&{pointerId:number;pointerType:string;startX:number;startY:number;timer?:number}

/** Distance to the body on screen, rather than only to the feet or a tiny mesh. */
export function residentBodyDistance(x:number,y:number,feet:{x:number;y:number},head:{x:number;y:number}){
 const dx=head.x-feet.x,dy=head.y-feet.y,length=dx*dx+dy*dy
 const t=length?Math.max(0,Math.min(1,((x-feet.x)*dx+(y-feet.y)*dy)/length)):0
 return Math.hypot(x-feet.x-dx*t,y-feet.y-dy*t)
}
export function validResidentDrop(sourceId:string,targetId:string|undefined,ids:readonly string[]){return Boolean(targetId&&sourceId!==targetId&&ids.includes(sourceId)&&ids.includes(targetId))}

export function useResidentDrag({ids,enabled,onMeet}:{ids:readonly string[];enabled:boolean;onMeet?:(sourceId:string,targetId:string)=>void|Promise<void>}):ResidentDragController{
 const [snapshot,setSnapshot]=useState<ResidentDragSnapshot|null>(null),[pending,setPending]=useState(false),[failed,setFailed]=useState(false)
 const latest=useRef({ids,enabled,onMeet}),session=useRef<Session|null>(null),map=useRef<ResidentDragMap|null>(null),inFlight=useRef(false),mounted=useRef(true)
 const suppressed=useRef({id:'',until:0}),dockScroll=useRef<DockScroll|null>(null),dockCandidate=useRef<DockScroll|null>(null)
 useLayoutEffect(()=>{latest.current={ids,enabled,onMeet}},[enabled,ids,onMeet])
 const clear=useCallback((suppress=true)=>{
  const previous=session.current
  if(previous?.timer)window.clearTimeout(previous.timer)
  if(previous&&suppress)suppressed.current={id:previous.sourceId,until:Date.now()+700}
  session.current=null;dockScroll.current=null;dockCandidate.current=null;map.current?.lock(false)
  if(mounted.current)setSnapshot(null)
 },[])
 const targetAt=useCallback((x:number,y:number,sourceId:string)=>{
  const hit=document.elementFromPoint(x,y)
  const resident=hit?.closest<HTMLElement>('[data-resident-drop-id]')?.dataset.residentDropId
  if(resident)return validResidentDrop(sourceId,resident,latest.current.ids)?resident:undefined
  // Floating building labels must not hide a nearby resident's body on small
  // screens. Menus and cards stay excluded even if an actor is behind them.
  if(!hit?.closest('.world3d-stage')||hit.closest('nav,aside,.world3d-intro,.world3d-time,.world3d-quality'))return undefined
  return map.current?.pick(x,y,sourceId)
 },[])
 const activate=useCallback(()=>{
  const current=session.current
  if(!current||!latest.current.enabled||inFlight.current)return
  current.phase='dragging';current.timer=undefined
  current.targetId=targetAt(current.x,current.y,current.sourceId)
  current.position=map.current?.project(current.x,current.y)
  map.current?.lock(true);setSnapshot({...current})
 },[targetAt])
 const begin=useCallback((event:PointerEvent,id:string,origin:ResidentDragOrigin)=>{
  if(session.current||event.button!==0||!event.isPrimary)return
  const scrollElement=origin==='dock'&&event.pointerType==='touch'?(event.target as HTMLElement)?.closest<HTMLElement>('.world3d-resident-dock'):null
  const scrolling=scrollElement&&scrollElement.scrollWidth>scrollElement.clientWidth?{pointerId:event.pointerId,element:scrollElement,startX:event.clientX,scrollLeft:scrollElement.scrollLeft}:null
  if(!latest.current.enabled||!latest.current.onMeet||latest.current.ids.length<2||inFlight.current){
   if(scrolling&&latest.current.onMeet)dockScroll.current=scrolling
   return
  }
  if(!latest.current.ids.includes(id))return
  setFailed(false)
  const current:Session={sourceId:id,origin,phase:'pressing',pointerId:event.pointerId,pointerType:event.pointerType,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY}
  session.current=current
  dockCandidate.current=scrolling
  if(event.pointerType==='touch'){current.timer=window.setTimeout(activate,RESIDENT_LONG_PRESS_MS)}
  else if(origin==='map')map.current?.lock(true)
  setSnapshot({...current})
 },[activate])
 useEffect(()=>{
  mounted.current=true
  const move=(event:PointerEvent)=>{
   const scrolling=dockScroll.current
   if(scrolling&&event.pointerId===scrolling.pointerId){event.preventDefault();scrolling.element.scrollLeft=scrolling.scrollLeft+scrolling.startX-event.clientX;return}
   const current=session.current
   if(!current||event.pointerId!==current.pointerId)return
   current.x=event.clientX;current.y=event.clientY
   const distance=Math.hypot(current.x-current.startX,current.y-current.startY)
   if(current.phase==='pressing'){
    if(current.pointerType==='touch'){
     if(distance>RESIDENT_DRAG_DISTANCE){
      const scrolling=dockCandidate.current
      clear(Boolean(scrolling))
      if(scrolling){dockScroll.current=scrolling;scrolling.element.scrollLeft=scrolling.scrollLeft+scrolling.startX-event.clientX;event.preventDefault()}
     }
     return
    }
    if(distance<RESIDENT_DRAG_DISTANCE)return
    activate()
   }
   if(!session.current)return
   event.preventDefault()
   current.targetId=targetAt(current.x,current.y,current.sourceId)
   current.position=map.current?.project(current.x,current.y)??current.position
   setSnapshot({...current})
  }
  const end=(event:PointerEvent)=>{
   if(dockScroll.current?.pointerId===event.pointerId){dockScroll.current=null;return}
   const current=session.current
   if(!current||event.pointerId!==current.pointerId)return
   if(current.phase!=='dragging'){clear(false);return}
   event.preventDefault()
   const target=targetAt(event.clientX,event.clientY,current.sourceId)
   clear()
   if(!latest.current.enabled||!validResidentDrop(current.sourceId,target,latest.current.ids)||inFlight.current)return
   // The ref closes the gap before the parent's request/busy state renders.
   inFlight.current=true;setPending(true)
   Promise.resolve().then(()=>latest.current.onMeet?.(current.sourceId,target!)).catch(()=>{if(mounted.current)setFailed(true)}).finally(()=>{inFlight.current=false;if(mounted.current)setPending(false)})
  }
  const cancel=(event:PointerEvent)=>{if(event.pointerId===session.current?.pointerId||event.pointerId===dockScroll.current?.pointerId)clear()}
  const extraTouch=(event:PointerEvent)=>{if(event.pointerType==='touch'&&(session.current&&event.pointerId!==session.current.pointerId||dockScroll.current&&event.pointerId!==dockScroll.current.pointerId))clear()}
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'&&session.current){event.preventDefault();clear()}}
  const blur=()=>clear()
  const visibility=()=>{if(document.hidden)clear()}
  window.addEventListener('pointermove',move,{capture:true,passive:false});window.addEventListener('pointerup',end,true);window.addEventListener('pointercancel',cancel,true);window.addEventListener('pointerdown',extraTouch,true)
  window.addEventListener('keydown',key,true);window.addEventListener('blur',blur);document.addEventListener('visibilitychange',visibility)
  return()=>{mounted.current=false;clear();window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',end,true);window.removeEventListener('pointercancel',cancel,true);window.removeEventListener('pointerdown',extraTouch,true);window.removeEventListener('keydown',key,true);window.removeEventListener('blur',blur);document.removeEventListener('visibilitychange',visibility)}
 },[activate,clear,targetAt])
 useEffect(()=>{if(!enabled||snapshot&&!ids.includes(snapshot.sourceId))clear()},[clear,enabled,ids,snapshot])
 const registerMap=useCallback((value:ResidentDragMap)=>{map.current=value;return()=>{if(map.current===value){value.lock(false);map.current=null}}},[])
 const suppressClick=useCallback((id:string)=>suppressed.current.id===id&&suppressed.current.until>Date.now(),[])
 return useMemo(()=>({snapshot,pending,failed,begin,cancel:clear,suppressClick,registerMap}),[begin,clear,failed,pending,registerMap,snapshot,suppressClick])
}
