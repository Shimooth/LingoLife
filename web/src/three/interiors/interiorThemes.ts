export type InteriorTheme=
 |'home_lounge'
 |'home_kitchen'
 |'home_bathroom'
 |'home_bedroom'
 |'cafe'
 |'library'
 |'shop'
 |'workplace'
 |'activity'
 |'public'
 |'park'

type InteriorThemeInput={
 locationId?:string|null
 roomKind?:string|null
 hint?:string|null
}

const includes=(value:string,pattern:RegExp)=>pattern.test(value.toLowerCase())

/**
 * Converts server-owned location/room semantics into a finite authored scene
 * set. Story prose is only a secondary hint for rooms inside a residence; it
 * never invents a location or changes simulation state.
 */
export function interiorThemeFor({locationId='',roomKind='',hint=''}:InteriorThemeInput):InteriorTheme{
 const room=`${roomKind}`.toLowerCase()
 if(includes(room,/bath|shower|浴/))return 'home_bathroom'
 if(includes(room,/kitchen|dining|厨房|餐厅/))return 'home_kitchen'
 if(includes(room,/bed|private|卧室/))return 'home_bedroom'
 if(room)return 'home_lounge'

 const location=`${locationId}`.toLowerCase()
 const privateHome=location==='home'||location.startsWith('home-')||includes(location,/house|residen|apartment/)
 if(privateHome){
  if(includes(`${hint}`,/shower|bath|wash|浴|淋浴/))return 'home_bathroom'
  if(includes(`${hint}`,/cook|food|meal|dish|kitchen|吃|饭|厨房|做饭|餐具/))return 'home_kitchen'
  if(includes(`${hint}`,/sleep|bed|nap|rest|睡|卧室|休息/))return 'home_bedroom'
  return 'home_lounge'
 }
 if(includes(location,/library|bookshop|book_store|education|school|academy/))return 'library'
 if(includes(location,/cafe|restaurant|bakery|dining/))return 'cafe'
 if(includes(location,/market|mall|shop|commerce|store/))return 'shop'
 if(includes(location,/office|work|company|hospital|clinic|public|government|station/))return 'workplace'
 if(includes(location,/music|concert|theatre|theater|studio|gym|stadium|fitness|activity/))return 'activity'
 if(includes(location,/park|garden|walk|plaza|harbor|nature|greenway/))return 'park'
 return 'public'
}

export const INTERIOR_THEME_COPY:Record<InteriorTheme,{zh:string;en:string}>={
 home_lounge:{zh:'客厅',en:'Living room'},
 home_kitchen:{zh:'厨房',en:'Kitchen'},
 home_bathroom:{zh:'浴室',en:'Bathroom'},
 home_bedroom:{zh:'卧室',en:'Bedroom'},
 cafe:{zh:'店内',en:'Inside the venue'},
 library:{zh:'书店与阅览空间',en:'Book and reading space'},
 shop:{zh:'商店内部',en:'Inside the shop'},
 workplace:{zh:'工作与公共空间',en:'Work and civic interior'},
 activity:{zh:'活动与练习空间',en:'Activity and practice space'},
 public:{zh:'公共空间',en:'Public interior'},
 park:{zh:'户外场景',en:'Outdoor scene'},
}
