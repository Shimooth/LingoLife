import type {LocationIconName} from '../locationAssets'

type Props={name:LocationIconName;className?:string}

const common={fill:'none',stroke:'currentColor',strokeWidth:1.8,strokeLinecap:'round' as const,strokeLinejoin:'round' as const}

export function LocationIcon({name,className=''}:Props){
 const icon=(()=>{switch(name){
  case'train':return <><rect x="5" y="3" width="14" height="15" rx="4"/><path d="M8 7h8M8 12h.01M16 12h.01M8 21l2-3m6 0 2 3M8 21h8"/></>
  case'bus':return <><rect x="4" y="3" width="16" height="16" rx="3"/><path d="M7 7h10v6H7zM7 19v2m10-2v2M7 16h.01M17 16h.01"/></>
  case'plane':return <path d="m3 11 18-7-7 18-3-8-8-3Zm8 3 4-4"/>
  case'office':return <><path d="M5 21V4h10v17M15 9h4v12M8 8h4m-4 4h4m-4 4h4M3 21h18"/></>
  case'idea':return <><path d="M9 18h6m-5 3h4M8.5 15.5A7 7 0 1 1 15.5 15.5c-.8.7-1.1 1.4-1.2 2.5h-4.6c-.1-1.1-.4-1.8-1.2-2.5Z"/></>
  case'design':return <><path d="m4 20 4.5-1 10-10-3.5-3.5-10 10L4 20Zm9-12 3.5 3.5M14 4l2-2 4 4-2 2"/></>
  case'hospital':return <><path d="M5 21V5h14v16M3 21h18M9 9h6m-3-3v6M8 16h2m4 0h2"/></>
  case'clinic':return <><path d="M4 8h16v12H4zM8 8V5h8v3m-4 3v6m-3-3h6"/></>
  case'paw':return <><ellipse cx="12" cy="15" rx="5" ry="4"/><circle cx="6.5" cy="10" r="2"/><circle cx="10" cy="6.5" r="2"/><circle cx="14" cy="6.5" r="2"/><circle cx="17.5" cy="10" r="2"/></>
  case'tree':return <><path d="M12 21v-7M8 21h8"/><path d="M12 3 6 12h4l-3 5h10l-3-5h4L12 3Z"/></>
  case'garden':return <><path d="M12 21v-9M12 14C7 14 5 11 5 7c4 0 7 2 7 7Zm0 3c5 0 7-3 7-7-4 0-7 2-7 7Z"/></>
  case'hill':return <><path d="M3 20 10 8l3 5 2-3 6 10H3Z"/><circle cx="17" cy="5" r="2"/></>
  case'shield':return <path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6l-7-3Zm-3 9 2 2 4-5"/>
  case'hall':return <><path d="m3 9 9-5 9 5M5 10h14M6 10v8m4-8v8m4-8v8m4-8v8M3 21h18M4 18h16"/></>
  case'fire':return <path d="M13 3c1 4-2 5-1 8 1-2 3-3 4-5 3 3 4 6 3 9-1 4-4 6-7 6-5 0-8-4-7-8 1-3 3-5 6-8 0 3 0 4 2 6"/>
  case'community':return <><circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20v-3c0-3 2-5 5-5s5 2 5 5v3m0-6c3-1 6 1 6 4v2"/></>
  case'market':return <><path d="M4 9h16l-2-5H6L4 9Zm1 0v11h14V9M9 20v-6h6v6"/><path d="M4 9c0 2 3 2 4 0 0 2 3 2 4 0 0 2 3 2 4 0 1 2 4 2 4 0"/></>
  case'mall':return <><path d="M5 8h14l-1 13H6L5 8Zm3 0a4 4 0 0 1 8 0"/></>
  case'book':case'library':return <><path d="M4 5c4-1 6 0 8 2v13c-2-2-4-3-8-2V5Zm16 0c-4-1-6 0-8 2v13c2-2 4-3 8-2V5Z"/></>
  case'coffee':return <><path d="M5 9h12v5a6 6 0 0 1-12 0V9Zm12 2h2a2 2 0 0 1 0 4h-2M7 21h10M8 3v3m4-3v3m4-3v3"/></>
  case'flower':return <><circle cx="12" cy="10" r="2"/><path d="M12 8c-3-6-7-2-3 2-6-1-5 4 1 3-3 5 3 7 3 1 4 5 7 0 1-3 5-2 3-6-2-3-5 0-4 2-2-6-6-4-4 1M12 14v7"/></>
  case'restaurant':return <><path d="M7 3v8m-3-8v5c0 2 6 2 6 0V3M7 11v10m9-18v18m0-18c4 3 4 8 0 10"/></>
  case'gallery':return <><rect x="3" y="5" width="18" height="14" rx="1"/><path d="m6 16 4-5 3 3 2-2 3 4M8 9h.01"/></>
  case'museum':return <><path d="m3 9 9-5 9 5M5 10h14M6 10v8m4-8v8m4-8v8m4-8v8M3 21h18"/></>
  case'theater':return <><path d="M4 5c3 0 5-1 7-2v8c-2 3-5 4-7 2V5Zm9 7c3 0 5-1 7-2v8c-2 3-5 4-7 2v-8Z"/><path d="M6 8h.01M9 7h.01M15 15h.01M18 14h.01"/></>
  case'music':return <><path d="M9 18V6l10-2v12M9 9l10-2"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></>
  case'school':return <><path d="m3 10 9-5 9 5-9 5-9-5Zm4 3v5c3 2 7 2 10 0v-5M21 10v6"/></>
  case'university':return <><path d="m3 8 9-5 9 5-9 5-9-5Zm3 3v8m12-8v8M4 21h16M9 13v6m6-6v6"/></>
  case'sun':return <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M19 5l-1.5 1.5m-11 11L5 19"/></>
  case'fountain':return <><path d="M4 20h16M6 17h12M12 4v13M6 10c2 0 4-2 6-6 2 4 4 6 6 6M8 13c2 0 3-1 4-4 1 3 2 4 4 4"/></>
  case'gym':return <><path d="M3 9v6m3-8v10m12-10v10m3-8v6M6 12h12"/></>
  case'stadium':return <><path d="M3 8c4-4 14-4 18 0v8c-4 4-14 4-18 0V8Zm4 2c2-2 8-2 10 0v4c-2 2-8 2-10 0v-4Z"/></>
  case'walk':return <><circle cx="14" cy="4" r="2"/><path d="m12 8-3 5 4 2 2 6m-3-13 4 4 4 1M9 13l-4 7"/></>
  case'harbor':return <><circle cx="12" cy="5" r="2"/><path d="M12 7v14M5 11h14M5 16c1 3 4 5 7 5s6-2 7-5M8 11V9m8 2V9"/></>
  case'cowork':return <><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4M7 10h4v3H7zm7 0h3"/></>
 }} )()
 return <svg className={className} viewBox="0 0 24 24" aria-hidden="true" {...common}>{icon}</svg>
}
