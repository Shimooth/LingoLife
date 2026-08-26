import {useEffect,useRef} from 'react'
import {WORLD_DECORATION_CATALOG,WORLD_DECORATION_LIMIT,decorationDefinition} from './worldDecorations'
import type {WorldDecorationEditorController} from './useWorldDecorationEditor'
import './WorldDecorationEditor.css'

const COPY={
 zh:{edit:'地图作者工具',done:'完成编辑',title:'城市装饰 · 作者工具',subtitle:'点击地图放置；内容仅保存为本机草稿',place:'放置',select:'选择',move:'移动',delete:'删除',rotateLeft:'向左旋转',rotateRight:'向右旋转',selected:'已选中',none:'点击一个装饰进行选择',layout:'本机草稿',export:'导出 JSON',import:'导入 JSON',reset:'重置',clean:'清理无效项',confirm:'确定清空所有手动放置的装饰吗？此操作不可撤销。',cleanConfirm:(count:number)=>`确定删除 ${count} 个因城市变化而落入禁放区的装饰吗？`,blocked:'禁放区：道路、建筑、居民路径与已有设施',count:(count:number)=>`${count} / ${WORLD_DECORATION_LIMIT}`},
 en:{edit:'Map author tools',done:'Finish editing',title:'City decorations · Author tools',subtitle:'Click the map to place. Changes are a local draft only.',place:'Place',select:'Select',move:'Move',delete:'Delete',rotateLeft:'Rotate left',rotateRight:'Rotate right',selected:'Selected',none:'Click a decoration to select it',layout:'Local draft',export:'Export JSON',import:'Import JSON',reset:'Reset',clean:'Clean invalid',confirm:'Remove every manually placed decoration? This cannot be undone.',cleanConfirm:(count:number)=>`Remove ${count} decorations that now overlap blocked city areas?`,blocked:'Blocked: roads, buildings, resident paths, and existing city props',count:(count:number)=>`${count} / ${WORLD_DECORATION_LIMIT}`},
} as const

export function WorldDecorationEditor({controller,language,onActivate}:{controller:WorldDecorationEditorController;language:'zh'|'en';onActivate?:()=>void}){
 const copy=COPY[language],fileInput=useRef<HTMLInputElement>(null)
 const selected=controller.document.decorations.find(item=>item.id===controller.selectedId)

 useEffect(()=>{
  if(!controller.enabled)return
  const keyboard=(event:KeyboardEvent)=>{
   const target=event.target as HTMLElement|null
   if(target?.closest('input,textarea,select,[contenteditable=true]'))return
   if((event.key==='Delete'||event.key==='Backspace')&&controller.selectedId){event.preventDefault();controller.removeSelected()}
   if(event.key==='Escape')controller.setEnabled(false)
  }
  window.addEventListener('keydown',keyboard)
  return()=>window.removeEventListener('keydown',keyboard)
 },[controller])

 const importFile=async(file:File|undefined)=>{
  if(!file||file.size>1_000_000)return
  controller.importJson(await file.text())
  if(fileInput.current)fileInput.current.value=''
 }

 if(!controller.enabled)return <button type="button" className="world3d-editor-toggle" onClick={()=>{onActivate?.();controller.setEnabled(true)}}><span aria-hidden>✦</span>{copy.edit}</button>

 return <aside className="world3d-editor" aria-label={copy.title}>
  <header><div><strong>{copy.title}</strong><small>{copy.subtitle}</small></div><button type="button" onClick={()=>controller.setEnabled(false)}>{copy.done}</button></header>
  <div className="world3d-editor__modes" role="group" aria-label={copy.title}>
   <button type="button" className={controller.mode==='place'?'is-active':''} onClick={()=>{controller.setMode('place');controller.select()}}>＋ {copy.place}</button>
   <button type="button" className={controller.mode==='select'||controller.mode==='move'?'is-active':''} onClick={()=>controller.setMode('select')}>◇ {copy.select}</button>
   <span>{copy.count(controller.document.decorations.length)}</span>
  </div>
  <div className="world3d-editor__catalog" aria-label={copy.place}>
   {WORLD_DECORATION_CATALOG.map(item=><button type="button" key={item.kind} className={controller.mode==='place'&&controller.selectedKind===item.kind?'is-active':''} onClick={()=>{controller.setSelectedKind(item.kind);controller.setMode('place');controller.select()}} title={item.label[language]}><span aria-hidden>{item.icon}</span><b>{item.label[language]}</b></button>)}
  </div>
  <p className="world3d-editor__blocked"><i aria-hidden/> {copy.blocked}</p>
  <section className="world3d-editor__selection" aria-label={copy.selected}>
   <div><small>{copy.selected}</small><b>{selected?`${decorationDefinition(selected.kind).icon} ${decorationDefinition(selected.kind).label[language]}`:copy.none}</b></div>
   <div className="world3d-editor__transform" aria-disabled={!selected}>
    <button type="button" disabled={!selected} onClick={()=>controller.rotateSelected(-Math.PI/12)} aria-label={copy.rotateLeft}>↶</button>
    <button type="button" disabled={!selected} onClick={()=>controller.rotateSelected(Math.PI/12)} aria-label={copy.rotateRight}>↷</button>
    <button type="button" disabled={!selected} className={controller.mode==='move'?'is-active':''} onClick={()=>controller.setMode('move')}>↔ {copy.move}</button>
    <button type="button" disabled={!selected} className="is-danger" onClick={controller.removeSelected}>× {copy.delete}</button>
   </div>
  </section>
  <section className="world3d-editor__files" aria-label={copy.layout}>
   <small>{copy.layout}</small><div><button type="button" onClick={controller.exportJson}>↓ {copy.export}</button><button type="button" onClick={()=>fileInput.current?.click()}>↑ {copy.import}</button>{controller.invalidIds.length>0&&<button type="button" className="is-danger" onClick={()=>{if(window.confirm(copy.cleanConfirm(controller.invalidIds.length)))controller.cleanInvalid()}}>⌫ {copy.clean} ({controller.invalidIds.length})</button>}<button type="button" className="is-danger" onClick={()=>{if(window.confirm(copy.confirm))controller.reset()}}>↺ {copy.reset}</button></div>
   <input ref={fileInput} type="file" accept="application/json,.json" onChange={event=>void importFile(event.target.files?.[0])}/>
  </section>
  <p className={`world3d-editor__notice is-${controller.notice.tone}`} role="status" aria-live="polite">{controller.notice.text}</p>
 </aside>
}
