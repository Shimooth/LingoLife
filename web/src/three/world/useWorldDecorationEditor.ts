import {useCallback,useEffect,useMemo,useState} from 'react'
import {
 WORLD_DECORATION_LIMIT,
 WORLD_DECORATION_STORAGE_KEY,
 loadWorldDecorationDocument,
 newWorldDecoration,
 parseWorldDecorationDocument,
 saveWorldDecorationDocument,
 serializeWorldDecorationDocument,
 snapWorldDecorationPosition,
 type PlacementBlockReason,
 type WorldDecoration,
 type WorldDecorationDocument,
 type WorldDecorationKind,
 type WorldDecorationValidationApi,
} from './worldDecorations'

export type WorldDecorationEditorMode='place'|'select'|'move'
export type EditorNotice={tone:'info'|'success'|'error';text:string}

const COPY={
 zh:{
  saved:'本机草稿已保存',storageError:'浏览器未能保存本机草稿，请先导出备份',added:'装饰已放置',moved:'装饰已移动',rotated:'装饰已旋转',deleted:'装饰已删除',selected:'已选中装饰',chooseMove:'先选中要移动的装饰',limit:`最多可放置 ${WORLD_DECORATION_LIMIT} 个装饰`,reset:'本机草稿已重置',imported:(count:number,discarded:number)=>`已导入 ${count} 个装饰${discarded?`，忽略 ${discarded} 条格式错误数据`:''}`,invalidImport:'无法导入：请选择 LingoLife 导出的 JSON 文件',blockedImport:(count:number,reason:string)=>`导入未生效：${count} 个装饰位于禁放区（${reason}）`,draftBlocked:(count:number)=>`本机草稿中有 ${count} 个装饰因城市布局变化而暂时隐藏，请检查后清理`,cleaned:(count:number)=>`已清理 ${count} 个无效装饰`,loading:'城市校验器仍在加载，请稍后重试',exported:'本机草稿 JSON 已导出',
  reasons:{outside_city:'超出天空之城平台',road:'道路禁放区',building:'建筑或院落禁放区',character_path:'居民路径禁放区',fixed_decor:'已有城市设施',custom_decor:'装饰互相重叠'} as Record<PlacementBlockReason,string>,
 },
 en:{
  saved:'Local draft saved',storageError:'The browser could not save this local draft. Export a backup first.',added:'Decoration placed',moved:'Decoration moved',rotated:'Decoration rotated',deleted:'Decoration deleted',selected:'Decoration selected',chooseMove:'Select a decoration to move first',limit:`You can place up to ${WORLD_DECORATION_LIMIT} decorations`,reset:'Local draft reset',imported:(count:number,discarded:number)=>`Imported ${count} decorations${discarded?`; ignored ${discarded} malformed entries`:''}`,invalidImport:'Import failed. Choose a JSON file exported by LingoLife.',blockedImport:(count:number,reason:string)=>`Import cancelled: ${count} decorations are blocked (${reason})`,draftBlocked:(count:number)=>`${count} decorations in this local draft are hidden because the city layout changed. Review and clean them.`,cleaned:(count:number)=>`Removed ${count} invalid decorations`,loading:'The city validator is still loading. Try again shortly.',exported:'Local draft JSON exported',
  reasons:{outside_city:'outside the Sky City platform',road:'road exclusion zone',building:'building or courtyard exclusion zone',character_path:'resident path exclusion zone',fixed_decor:'existing city prop',custom_decor:'overlapping decorations'} as Record<PlacementBlockReason,string>,
 },
} as const

export function useWorldDecorationEditor(language:'zh'|'en',validationApi:WorldDecorationValidationApi|null){
 const copy=COPY[language]
 const [document,setDocument]=useState<WorldDecorationDocument>(loadWorldDecorationDocument)
 const [enabled,setEnabledState]=useState(false)
 const [mode,setMode]=useState<WorldDecorationEditorMode>('place')
 const [selectedKind,setSelectedKind]=useState<WorldDecorationKind>('tree_round')
 const [selectedId,setSelectedId]=useState<string>()
 const [notice,setNotice]=useState<EditorNotice>({tone:'info',text:copy.saved})

 const audit=useMemo(()=>validationApi?.audit(document)??{accepted:[],rejected:[]},[document,validationApi])
 const invalidIds=useMemo(()=>audit.rejected.map(item=>item.decoration.id),[audit.rejected])
 const visibleDocument=useMemo<WorldDecorationDocument>(()=>({version:1,decorations:audit.accepted}),[audit.accepted])

 useEffect(()=>{
  if(!saveWorldDecorationDocument(document))setNotice({tone:'error',text:copy.storageError})
 },[copy.storageError,document])

 useEffect(()=>{
  const sync=(event:StorageEvent)=>{
   if(event.key!==WORLD_DECORATION_STORAGE_KEY||!event.newValue)return
   try{setDocument(parseWorldDecorationDocument(event.newValue).document)}catch{/* keep current valid draft */}
  }
  window.addEventListener('storage',sync)
  return()=>window.removeEventListener('storage',sync)
 },[])

 const validateCandidate=useCallback((candidate:WorldDecoration,excludeId?:string)=>{
  if(!validationApi)return null
  return validationApi.validate(candidate,audit.accepted,excludeId)
 },[audit.accepted,validationApi])

 const place=useCallback((rawPosition:[number,number])=>{
  if(mode==='select'){setSelectedId(undefined);return}
  if(!validationApi){setNotice({tone:'error',text:copy.loading});return}
  const position=snapWorldDecorationPosition(rawPosition)
  if(mode==='move'){
   const current=document.decorations.find(item=>item.id===selectedId)
   if(!current){setNotice({tone:'error',text:copy.chooseMove});return}
   const candidate={...current,position}
   const validation=validateCandidate(candidate,current.id)
   if(!validation?.valid){setNotice({tone:'error',text:copy.reasons[validation?.reason??'outside_city']});return}
   setDocument(value=>({...value,decorations:value.decorations.map(item=>item.id===current.id?candidate:item)}))
   setMode('select');setNotice({tone:'success',text:copy.moved});return
  }
  if(document.decorations.length>=WORLD_DECORATION_LIMIT){setNotice({tone:'error',text:copy.limit});return}
  const candidate=newWorldDecoration(selectedKind,position)
  const validation=validateCandidate(candidate)
  if(!validation?.valid){setNotice({tone:'error',text:copy.reasons[validation?.reason??'outside_city']});return}
  setDocument(value=>({...value,decorations:[...value.decorations,candidate]}))
  setSelectedId(candidate.id);setNotice({tone:'success',text:copy.added})
 },[copy,document.decorations,mode,selectedId,selectedKind,validateCandidate,validationApi])

 const select=useCallback((id?:string)=>{
  setSelectedId(id)
  if(id){setMode('select');setNotice({tone:'info',text:copy.selected})}
 },[copy.selected])

 const removeSelected=useCallback(()=>{
  if(!selectedId)return
  setDocument(current=>({...current,decorations:current.decorations.filter(item=>item.id!==selectedId)}))
  setSelectedId(undefined);setMode('place');setNotice({tone:'success',text:copy.deleted})
 },[copy.deleted,selectedId])

 const rotateSelected=useCallback((amount:number)=>{
  if(!selectedId||!validationApi)return
  const current=document.decorations.find(item=>item.id===selectedId)
  if(!current)return
  const candidate={...current,rotation:current.rotation+amount}
  const validation=validateCandidate(candidate,current.id)
  if(!validation?.valid){setNotice({tone:'error',text:copy.reasons[validation?.reason??'outside_city']});return}
  setDocument(value=>({...value,decorations:value.decorations.map(item=>item.id===current.id?candidate:item)}))
  setNotice({tone:'success',text:copy.rotated})
 },[copy.reasons,copy.rotated,document.decorations,selectedId,validateCandidate,validationApi])

 const reset=useCallback(()=>{
  setDocument({version:1,decorations:[]});setSelectedId(undefined);setMode('place');setNotice({tone:'success',text:copy.reset})
 },[copy.reset])

 const importJson=useCallback((json:string)=>{
  try{
   if(!validationApi){setNotice({tone:'error',text:copy.loading});return false}
   const parsed=parseWorldDecorationDocument(json),nextAudit=validationApi.audit(parsed.document)
   if(nextAudit.rejected.length){
    const first=nextAudit.rejected[0].reason
    setNotice({tone:'error',text:copy.blockedImport(nextAudit.rejected.length,copy.reasons[first])});return false
   }
   setDocument(parsed.document);setSelectedId(undefined);setMode('place')
   setNotice({tone:'success',text:copy.imported(parsed.document.decorations.length,parsed.discarded)})
   return true
  }catch{setNotice({tone:'error',text:copy.invalidImport});return false}
 },[copy,validationApi])

 const exportJson=useCallback(()=>{
  const blob=new Blob([serializeWorldDecorationDocument(document)],{type:'application/json'})
  const url=URL.createObjectURL(blob),link=window.document.createElement('a')
  link.href=url;link.download=`lingolife-city-layout-${new Date().toISOString().slice(0,10)}.json`;link.click()
  window.setTimeout(()=>URL.revokeObjectURL(url),0)
  setNotice({tone:'success',text:copy.exported})
 },[copy.exported,document])

 const cleanInvalid=useCallback(()=>{
  if(!invalidIds.length)return
  const blocked=new Set(invalidIds)
  setDocument(current=>({...current,decorations:current.decorations.filter(item=>!blocked.has(item.id))}))
  setSelectedId(current=>current&&blocked.has(current)?undefined:current)
  setNotice({tone:'success',text:copy.cleaned(invalidIds.length)})
 },[copy,invalidIds])

 const setEnabled=useCallback((value:boolean)=>{
  setEnabledState(value)
  if(!value){setMode('place');setSelectedId(undefined)}
  else if(invalidIds.length)setNotice({tone:'error',text:copy.draftBlocked(invalidIds.length)})
 },[copy,invalidIds.length])

 return {
  enabled,document,visibleDocument,invalidIds,mode,selectedKind,selectedId,notice,
  setEnabled,setMode,setSelectedKind,place,select,removeSelected,rotateSelected,reset,importJson,exportJson,cleanInvalid,
 }
}

export type WorldDecorationEditorController=ReturnType<typeof useWorldDecorationEditor>
