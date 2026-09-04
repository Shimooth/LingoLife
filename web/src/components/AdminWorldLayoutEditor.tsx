import {type ChangeEvent,type PointerEvent as ReactPointerEvent,useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {adminApi,ApiError} from '../api'
import {
 cloneWorldLayout,isWorldLayoutDocument,layoutAssetName,layoutVector,WORLD_LAYOUT_CITY_ASSETS,WORLD_LAYOUT_INTERIOR_ASSETS,
 type LayoutAssetDefinition,type WorldLayoutBuilding,type WorldLayoutCityLayer,type WorldLayoutDocument,
 type WorldLayoutAdminResponse,type WorldLayoutInteriorPlacement,type WorldLayoutPlacement,type WorldLayoutValidation,
} from '../worldLayout'
import {AdminLayoutPreview3D} from './AdminLayoutPreview3D'
import './AdminWorldLayoutEditor.css'

type Mode='city'|'interior'
type BoardItem={placement:WorldLayoutPlacement;layer?:WorldLayoutCityLayer}
const LAYERS:WorldLayoutCityLayer[]=['roads','buildings','props','decorations']
const LAYER_COPY:Record<WorldLayoutCityLayer,{label:string;icon:string}>={
 roads:{label:'道路',icon:'═'},buildings:{label:'建筑',icon:'▥'},props:{label:'街道设施',icon:'⌉'},decorations:{label:'绿化与装饰',icon:'✦'},
}
// The published cloudway reaches x=±36.4. Keep the full connected road exits
// visible and draggable instead of clipping them to the central city platform.
const CITY_BOUNDS={width:78,depth:44}
const INTERIOR_BOUNDS={width:10.6,depth:7.2}

const safeNumber=(value:number,fallback=0)=>Number.isFinite(value)?value:fallback
const rounded=(value:number,step=.25)=>Math.round(value/step)*step
const idFor=(prefix:string)=>`${prefix}-${crypto.randomUUID?.()??`${Date.now()}-${Math.random().toString(36).slice(2)}`}`
const scalar=(placement:WorldLayoutPlacement)=>Math.round(((placement.scale.x+placement.scale.y+placement.scale.z)/3)*100)/100
const degrees=(radians:number)=>Math.round(radians*180/Math.PI)
const nearestOpenPosition=(placements:readonly WorldLayoutPlacement[],step:number,clearance:number,bounds:{width:number;depth:number})=>{
 const maxRing=Math.ceil(Math.max(bounds.width,bounds.depth)/(step*2))
 for(let ring=0;ring<=maxRing;ring+=1){
  for(let gridZ=-ring;gridZ<=ring;gridZ+=1){
   for(let gridX=-ring;gridX<=ring;gridX+=1){
    if(ring&&Math.abs(gridX)!==ring&&Math.abs(gridZ)!==ring)continue
    const x=rounded(gridX*step,step),z=rounded(gridZ*step,step)
    if(Math.abs(x)>bounds.width/2||Math.abs(z)>bounds.depth/2)continue
    if(placements.every(item=>Math.hypot(item.position.x-x,item.position.z-z)>=clearance))return [x,z] as const
   }
  }
 }
 return [0,0] as const
}

function placementLabel(placement:WorldLayoutPlacement){
 const definitions=[...Object.values(WORLD_LAYOUT_CITY_ASSETS).flat(),...WORLD_LAYOUT_INTERIOR_ASSETS]
 return definitions.find(item=>item.asset===placement.asset)?.label??layoutAssetName(placement.asset)
}
const humanize=(value:string)=>value.replaceAll(/[-_]+/g,' ').replace(/\b\w/g,letter=>letter.toUpperCase())
function placementIdentity(placement:WorldLayoutPlacement){
 const location='location_id' in placement&&typeof placement.location_id==='string'&&placement.location_id?humanize(placement.location_id):''
 const identity=placement.id==='shared-home'?'共享住宅':location||humanize(placement.id)
 return `${identity} · ${placementLabel(placement)}`
}

function LayoutBoard({mode,items,selectedId,activeLayer,onSelect,onMove}:{mode:Mode;items:readonly BoardItem[];selectedId?:string;activeLayer?:WorldLayoutCityLayer;onSelect:(id:string,layer?:WorldLayoutCityLayer)=>void;onMove:(id:string,x:number,z:number,layer?:WorldLayoutCityLayer)=>void}){
 const board=useRef<HTMLDivElement>(null)
 const bounds=mode==='city'?CITY_BOUNDS:INTERIOR_BOUNDS
 const coordinates=(event:ReactPointerEvent,itemLayer?:WorldLayoutCityLayer)=>{
  const rect=board.current?.getBoundingClientRect()
  if(!rect)return [0,0] as const
  const rawX=(event.clientX-rect.left)/rect.width*bounds.width-bounds.width/2
  const rawZ=(event.clientY-rect.top)/rect.height*bounds.depth-bounds.depth/2
  const step=mode==='city'&&(itemLayer==='roads'||itemLayer==='buildings')?2.6:.25
  return [rounded(rawX,step),rounded(rawZ,step)] as const
 }
 const move=(event:ReactPointerEvent<HTMLButtonElement>,item:BoardItem)=>{
  if(!event.currentTarget.hasPointerCapture(event.pointerId))return
  const [x,z]=coordinates(event,item.layer);onMove(item.placement.id,x,z,item.layer)
 }
 return <div ref={board} className={`admin-layout-board is-${mode}`} onPointerDown={event=>{if(event.target===event.currentTarget)onSelect('')}}>
  {mode==='city'&&<><i className="admin-layout-board__roadline is-horizontal"/><i className="admin-layout-board__roadline is-vertical"/></>}
  {items.map(item=>{
   const {placement,layer}=item
   const left=(placement.position.x+bounds.width/2)/bounds.width*100,top=(placement.position.z+bounds.depth/2)/bounds.depth*100
   const definition=(layer?WORLD_LAYOUT_CITY_ASSETS[layer]:WORLD_LAYOUT_INTERIOR_ASSETS).find(entry=>entry.asset===placement.asset)
   const muted=Boolean(mode==='city'&&activeLayer&&layer!==activeLayer)
   return <button type="button" key={`${layer??'room'}:${placement.id}`} className={`admin-layout-board__item is-${layer??'furniture'} ${placement.id===selectedId?'is-selected':''} ${muted?'is-muted':''}`} style={{left:`${left}%`,top:`${top}%`,'--layout-rotation':`${placement.rotation.y}rad`,'--layout-scale':String(Math.max(.65,Math.min(1.5,scalar(placement))))} as React.CSSProperties} title={placementIdentity(placement)} onPointerDown={event=>{event.preventDefault();event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);onSelect(placement.id,layer)}} onPointerMove={event=>move(event,item)} onPointerUp={event=>event.currentTarget.releasePointerCapture(event.pointerId)}>
    <span aria-hidden>{definition?.icon??'◇'}</span><small>{definition?.label??layoutAssetName(placement.asset)}</small>
   </button>
  })}
 </div>
}

function AssetPalette({assets,onAdd}:{assets:readonly LayoutAssetDefinition[];onAdd:(asset:LayoutAssetDefinition)=>void}){
 return <div className="admin-layout-palette">{assets.map(item=><button type="button" key={item.asset} onClick={()=>onAdd(item)} title={`添加${item.label}`}><span aria-hidden>{item.icon}</span><b>{item.label}</b></button>)}</div>
}

export function AdminWorldLayoutEditor(){
 const [response,setResponse]=useState<WorldLayoutAdminResponse|null>(null),[draft,setDraft]=useState<WorldLayoutDocument|null>(null)
 const [mode,setMode]=useState<Mode>('city'),[layer,setLayer]=useState<WorldLayoutCityLayer>('buildings'),[roomId,setRoomId]=useState('')
 const [selectedId,setSelectedId]=useState(''),[selectedLayer,setSelectedLayer]=useState<WorldLayoutCityLayer>()
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState('正在读取已发布布局…'),[error,setError]=useState('')
 const [validation,setValidation]=useState<WorldLayoutValidation|null>(null),[publishNote,setPublishNote]=useState('调整城市与共享住宅布局')
 const fileInput=useRef<HTMLInputElement>(null)
 const load=useCallback(async()=>{
  setBusy(true);setError('')
  try{const value=await adminApi.worldLayout();setResponse(value);setDraft(cloneWorldLayout(value.draft.layout));setValidation(value.draft.validation);setRoomId(value.draft.layout.interior.rooms[0]?.id??'');setSelectedId('');setSelectedLayer(undefined);setNotice(value.draft.revision?`已载入服务器草稿 r${value.draft.revision}`:value.updated_at?`已载入发布版本 · ${new Date(value.updated_at).toLocaleString('zh-CN')}`:'已载入默认布局')}
  catch(cause){setError(cause instanceof ApiError?cause.message:'无法读取布局')}
  finally{setBusy(false)}
 },[])
 useEffect(()=>{void load()},[load])

 const dirty=Boolean(draft&&response&&JSON.stringify(draft)!==JSON.stringify(response.draft.layout))
 const room=draft?.interior.rooms.find(item=>item.id===roomId)??draft?.interior.rooms[0]
 const boardItems=useMemo<BoardItem[]>(()=>{
  if(!draft)return []
  if(mode==='interior')return (room?.placements??[]).map(placement=>({placement}))
  return LAYERS.flatMap(cityLayer=>draft.city[cityLayer].map(placement=>({placement,layer:cityLayer})))
 },[draft,mode,room])
 const selected=useMemo(()=>{
  if(!draft||!selectedId)return undefined
  if(mode==='interior')return room?.placements.find(item=>item.id===selectedId)
  return draft.city[selectedLayer??layer].find(item=>item.id===selectedId)
 },[draft,layer,mode,room,selectedId,selectedLayer])
 const selectItem=(id:string,itemLayer?:WorldLayoutCityLayer)=>{
  setSelectedId(id)
  if(mode!=='city'||!id){setSelectedLayer(undefined);return}
  setSelectedLayer(itemLayer??LAYERS.find(cityLayer=>draft?.city[cityLayer].some(item=>item.id===id)))
 }

 const replaceSelected=(producer:(value:WorldLayoutPlacement)=>WorldLayoutPlacement)=>setDraft(current=>{
  if(!current||!selectedId)return current
  const next=cloneWorldLayout(current)
  if(mode==='interior'){
   const target=next.interior.rooms.find(item=>item.id===(room?.id??roomId));if(!target)return current
   target.placements=target.placements.map(item=>item.id===selectedId?{...producer(item),room_id:target.id}:item as WorldLayoutInteriorPlacement)
  }else{
   const cityLayer=selectedLayer??layer
   next.city[cityLayer]=next.city[cityLayer].map(item=>item.id===selectedId?producer(item) as WorldLayoutBuilding:item as WorldLayoutBuilding)
  }
  return next
 })
 const moveItem=(id:string,x:number,z:number,itemLayer?:WorldLayoutCityLayer)=>{
  setSelectedId(id);if(itemLayer)setSelectedLayer(itemLayer)
  const step=mode==='city'&&(itemLayer==='roads'||itemLayer==='buildings')?2.6:.25
  const bounds=mode==='city'?CITY_BOUNDS:INTERIOR_BOUNDS
  setDraft(current=>{
   if(!current)return current
   const next=cloneWorldLayout(current),position=(value:WorldLayoutPlacement)=>({...value,position:{...value.position,x:Math.max(-bounds.width/2,Math.min(bounds.width/2,rounded(x,step))),z:Math.max(-bounds.depth/2,Math.min(bounds.depth/2,rounded(z,step)))}})
   if(mode==='interior'){
    const target=next.interior.rooms.find(value=>value.id===(room?.id??roomId));if(target)target.placements=target.placements.map(item=>item.id===id?{...position(item),room_id:target.id}:item)
   }else if(itemLayer)next.city[itemLayer]=next.city[itemLayer].map(item=>item.id===id?position(item) as WorldLayoutBuilding:item as WorldLayoutBuilding)
   return next
  })
 }
 const addAsset=(definition:LayoutAssetDefinition)=>{
  if(!draft)return
  const next=cloneWorldLayout(draft)
  const gridStep=mode==='city'&&(layer==='roads'||layer==='buildings')?2.6:.25
  const clearance=mode==='city'?(layer==='roads'||layer==='buildings'?2.5:1.4):.65
  const occupied=mode==='city'?LAYERS.flatMap(cityLayer=>next.city[cityLayer]):room?.placements??[]
  const [x,z]=nearestOpenPosition(occupied,gridStep,clearance,mode==='city'?CITY_BOUNDS:INTERIOR_BOUNDS)
  const base:WorldLayoutPlacement={id:idFor(mode==='city'?layer.slice(0,-1):'furniture'),asset:definition.asset,position:layoutVector(x,definition.defaultY,z),rotation:layoutVector(),scale:layoutVector(definition.defaultScale,definition.defaultScale,definition.defaultScale)}
  if(mode==='city'){
   next.city[layer].push(base as WorldLayoutBuilding)
  }else{
   const target=next.interior.rooms.find(value=>value.id===(room?.id??roomId));if(!target)return
   target.placements.push({...base,room_id:target.id})
  }
  setDraft(next);setSelectedId(base.id);setSelectedLayer(mode==='city'?layer:undefined)
 }
 const removeSelected=()=>{
  if(!draft||!selectedId)return
  const next=cloneWorldLayout(draft)
  if(mode==='interior'){
   const target=next.interior.rooms.find(item=>item.id===(room?.id??roomId));if(target)target.placements=target.placements.filter(item=>item.id!==selectedId)
  }else{const cityLayer=selectedLayer??layer;next.city[cityLayer]=next.city[cityLayer].filter(item=>item.id!==selectedId)}
  setDraft(next);setSelectedId('');setSelectedLayer(undefined)
 }
 const duplicateSelected=()=>{
  if(!draft||!selected)return
  const next=cloneWorldLayout(draft)
  const cityLayer=selectedLayer??layer
  const step=mode==='city'&&(cityLayer==='roads'||cityLayer==='buildings')?2.6:.25
  const copy={...JSON.parse(JSON.stringify(selected)) as WorldLayoutPlacement,id:idFor(mode==='city'?cityLayer.slice(0,-1):'furniture'),position:{...selected.position,x:rounded(selected.position.x+step,step),z:rounded(selected.position.z+step,step)}}
  if(mode==='city'&&cityLayer==='buildings'&&'location_id' in copy)delete copy.location_id
  if(mode==='interior'){
   const target=next.interior.rooms.find(item=>item.id===(room?.id??roomId));if(target)target.placements.push({...copy,room_id:target.id})
  }else next.city[cityLayer].push(copy as WorldLayoutBuilding)
  setDraft(next);setSelectedId(copy.id)
 }
 const saveDraft=async()=>{
  if(!draft||!response)return null
  setBusy(true);setError('')
  try{const saved=await adminApi.saveWorldLayoutDraft(draft,response.draft.revision);setResponse(current=>current?{...current,draft:saved}:current);setDraft(cloneWorldLayout(saved.layout));setValidation(saved.validation);setNotice(`草稿已保存为 r${saved.revision} · 尚未影响玩家世界`);return saved}
  catch(cause){setError(cause instanceof ApiError?cause.message:'草稿未能保存');return null}
  finally{setBusy(false)}
 }
 const validate=async()=>{
  if(!draft)return null
  setBusy(true);setError('')
  try{const result=await adminApi.validateWorldLayout(draft);setValidation(result);setNotice(result.valid?'校验通过，可以发布':'校验未通过，请按问题清单修正');return result}
  catch(cause){setError(cause instanceof ApiError?cause.message:'无法校验布局');return null}
  finally{setBusy(false)}
 }
 const publish=async()=>{
  if(!draft||!response)return
  if(!publishNote.trim()){setError('请填写本次发布说明');return}
  setBusy(true);setError('')
  try{
   let revision=response.draft.revision
   if(dirty){const saved=await adminApi.saveWorldLayoutDraft(draft,revision);revision=saved.revision;setDraft(cloneWorldLayout(saved.layout));setResponse(current=>current?{...current,draft:saved}:current)}
   const checked=await adminApi.validateWorldLayout(draft);setValidation(checked)
   if(!checked.valid){setNotice('发布已阻止：布局未通过拓扑校验');return}
   const value=await adminApi.publishWorldLayout(revision,publishNote.trim());setResponse(value);setDraft(cloneWorldLayout(value.draft.layout));setValidation(value.draft.validation);setNotice(`发布完成 · ${value.active_version?.id.slice(0,19)??'新版本'}`)
  }catch(cause){setError(cause instanceof ApiError?cause.message:'布局未能发布')}
  finally{setBusy(false)}
 }
 const activate=async(versionId:string)=>{
  if(!window.confirm('激活这个历史版本？当前动态世界事实不会被改动。'))return
  setBusy(true);setError('')
  try{const value=await adminApi.activateWorldLayout(versionId,'从管理端回滚到历史布局');setResponse(value);setNotice('历史版本已激活；NPC、关系、消息与故事事实保持不变')}
  catch(cause){setError(cause instanceof ApiError?cause.message:'无法激活历史版本')}
  finally{setBusy(false)}
 }
 const reset=async()=>{
  if(!window.confirm('发布项目默认城市和住宅为新版本？历史版本仍可回滚。'))return
  setBusy(true);setError('')
  try{await adminApi.resetWorldLayout();await load();setMode('city');setLayer('buildings');setNotice('已发布并激活默认布局，历史版本仍然保留')}
  catch(cause){setError(cause instanceof ApiError?cause.message:'无法恢复默认布局')}
  finally{setBusy(false)}
 }
 const exportJson=()=>{
  if(!draft)return
  const blob=new Blob([JSON.stringify(draft,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a')
  link.href=url;link.download='lingolife-world-layout.json';link.click();URL.revokeObjectURL(url)
 }
 const importJson=async(event:ChangeEvent<HTMLInputElement>)=>{
  const file=event.target.files?.[0];event.target.value='';if(!file)return
  if(file.size>2_000_000){setError('无法导入：布局 JSON 不能超过 2 MB');return}
  try{const candidate:unknown=JSON.parse(await file.text());if(!isWorldLayoutDocument(candidate))throw new Error();setDraft(cloneWorldLayout(candidate));setMode('city');setLayer('buildings');setSelectedId('');setSelectedLayer(undefined);setRoomId(candidate.interior.rooms[0]?.id??'');setError('');setNotice('JSON 已导入为未发布草稿，请检查后发布')}
  catch{setError('无法导入：请选择 LingoLife 世界布局 JSON')}
 }

 if(!draft||!response)return <section className="admin-panel admin-world-layout"><div className="admin-layout-loading"><i/><p>{error||notice}</p>{error&&<button type="button" onClick={()=>void load()}>重试</button>}</div></section>
 const previewItems=mode==='city'?boardItems.map(item=>item.placement):room?.placements??[]
 return <section className="admin-panel admin-world-layout">
  <header className="admin-layout-header"><div><p className="eyebrow">WORLD AUTHORING</p><h2>城市与共享住宅编辑器</h2><p>草稿保存在服务器并使用修订号防止互相覆盖。只有通过完整拓扑校验的不可变版本才能进入玩家世界。</p></div><div className="admin-layout-actions"><button type="button" onClick={exportJson}>导出 JSON</button><button type="button" onClick={()=>fileInput.current?.click()}>导入草稿</button><button type="button" disabled={busy||!dirty} onClick={()=>void saveDraft()}>保存草稿</button><button type="button" disabled={busy} onClick={()=>void validate()}>校验布局</button><button type="button" className="is-danger" disabled={busy} onClick={()=>void reset()}>发布默认布局</button><button type="button" className="is-primary" disabled={busy||(!dirty&&response.draft.revision<1)} onClick={()=>void publish()}>{busy?'正在处理…':'发布新版本'}</button><input ref={fileInput} hidden type="file" accept="application/json,.json" onChange={event=>void importJson(event)}/></div></header>
  <div className="admin-layout-status"><span className={dirty?'is-dirty':validation?.valid?'is-clean':'is-invalid'}>{dirty?'● 有本地修改':validation?.valid?'✓ 草稿校验通过':'! 草稿待修正'}</span><p>{error||notice}</p></div>
  <div className="admin-layout-publish"><label>发布说明<input value={publishNote} maxLength={240} onChange={event=>setPublishNote(event.target.value)} placeholder="说明本次道路、建筑或室内调整"/></label><small>当前草稿 r{response.draft.revision} · 活跃版本 {response.active_version?.id.slice(0,19)??'内置默认'}</small></div>
  {validation&&!validation.valid&&<section className="admin-layout-validation" aria-live="polite"><b>校验问题（{validation.issues.length}）</b><ul>{validation.issues.slice(0,20).map((issue,index)=><li key={`${issue.code}:${issue.path}:${index}`}><code>{issue.path}</code><span>{issue.message}</span></li>)}</ul>{validation.issues.length>20&&<p>另有 {validation.issues.length-20} 个问题，请导出 JSON 后检查。</p>}</section>}
  <nav className="admin-layout-mode" aria-label="编辑区域"><button type="button" className={mode==='city'?'is-active':''} onClick={()=>{setMode('city');setSelectedId('');setSelectedLayer(undefined)}}>☁ 城市地图</button><button type="button" className={mode==='interior'?'is-active':''} onClick={()=>{setMode('interior');setSelectedId('');setSelectedLayer(undefined)}}>⌂ 共享住宅室内</button></nav>
  {mode==='city'?<nav className="admin-layout-layers" aria-label="城市图层">{LAYERS.map(value=><button type="button" key={value} className={layer===value?'is-active':''} onClick={()=>{setLayer(value);setSelectedLayer(undefined);setSelectedId('')}}><span>{LAYER_COPY[value].icon}</span><b>{LAYER_COPY[value].label}</b><small>{draft.city[value].length}</small></button>)}</nav>:<nav className="admin-layout-rooms" aria-label="住宅房间">{draft.interior.rooms.map(value=><button type="button" key={value.id} className={room?.id===value.id?'is-active':''} onClick={()=>{setRoomId(value.id);setSelectedId('')}}><b>{value.name}</b><small>{value.placements.length} 件物品</small></button>)}</nav>}
  <div className="admin-layout-workspace">
   <div className="admin-layout-canvas"><LayoutBoard mode={mode} items={boardItems} selectedId={selectedId} activeLayer={mode==='city'?layer:undefined} onSelect={selectItem} onMove={moveItem}/><small>按住资产拖动 · 道路自动吸附 2.6m 网格 · 家具与装饰吸附 0.25m</small></div>
   <AdminLayoutPreview3D mode={mode} items={previewItems} selectedId={selectedId} onSelect={id=>selectItem(id)}/>
  </div>
  <div className="admin-layout-tools">
   <section><header><b>添加资产</b><span>{mode==='city'?LAYER_COPY[layer].label:room?.name}</span></header><AssetPalette assets={mode==='city'?WORLD_LAYOUT_CITY_ASSETS[layer]:WORLD_LAYOUT_INTERIOR_ASSETS} onAdd={addAsset}/></section>
   <section className="admin-layout-selection"><header><b>选中资产</b><span>{selected?placementIdentity(selected):'请在画布或 3D 预览中选择'}</span></header>{selected?<>
    <div className="admin-layout-fields"><label>X<input type="number" step=".25" value={selected.position.x} onChange={event=>replaceSelected(value=>({...value,position:{...value.position,x:safeNumber(Number(event.target.value),value.position.x)}}))}/></label><label>Y<input type="number" step=".05" value={selected.position.y} onChange={event=>replaceSelected(value=>({...value,position:{...value.position,y:safeNumber(Number(event.target.value),value.position.y)}}))}/></label><label>Z<input type="number" step=".25" value={selected.position.z} onChange={event=>replaceSelected(value=>({...value,position:{...value.position,z:safeNumber(Number(event.target.value),value.position.z)}}))}/></label><label>朝向<input type="number" step="15" value={degrees(selected.rotation.y)} onChange={event=>replaceSelected(value=>({...value,rotation:{...value.rotation,y:safeNumber(Number(event.target.value))*Math.PI/180}}))}/><small>度</small></label><label>缩放<input type="number" min=".1" max="5" step=".05" value={scalar(selected)} onChange={event=>{const next=Math.max(.1,Math.min(5,safeNumber(Number(event.target.value),1)));replaceSelected(value=>({...value,scale:layoutVector(next,next,next)}))}}/></label></div>
    <div className="admin-layout-transform"><button type="button" onClick={()=>replaceSelected(value=>({...value,rotation:{...value.rotation,y:value.rotation.y-Math.PI/2}}))}>↶ 左转 90°</button><button type="button" onClick={()=>replaceSelected(value=>({...value,rotation:{...value.rotation,y:value.rotation.y+Math.PI/2}}))}>↷ 右转 90°</button><button type="button" onClick={duplicateSelected}>⧉ 复制</button><button type="button" className="is-danger" onClick={removeSelected}>× 删除</button></div>
   </>:<p>选择一个资产后可精确调整位置、朝向和缩放。</p>}</section>
  </div>
  <section className="admin-layout-history"><header><div><p className="eyebrow">VERSION HISTORY</p><h3>发布历史与回滚</h3></div><p>版本内容按 SHA-256 哈希去重且发布后不可修改；激活旧版本只切换布局指针。</p></header>{response.versions.length?<div className="admin-layout-history__list">{response.versions.map(version=><article key={version.id} className={version.is_active?'is-active':''}><div><b>{version.is_active?'当前版本':'历史版本'}</b><code>{version.hash.slice(0,12)}</code></div><p>{version.note}</p><small>{version.author} · {new Date(version.created_at).toLocaleString('zh-CN')}</small>{!version.is_active&&<button type="button" disabled={busy} onClick={()=>void activate(version.id)}>激活 / 回滚</button>}</article>)}</div>:<p className="admin-layout-history__empty">尚无已发布版本；当前玩家看到项目内置默认布局。</p>}</section>
 </section>
}

export default AdminWorldLayoutEditor
