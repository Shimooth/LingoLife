import type {CityLocation,CityResident} from '../types'
import {getLocationAsset,type LocationAsset} from '../locationAssets.ts'
import {presentInHome,residentPresence} from './spatialPresence.ts'

const street:LocationAsset={
 id:'street',icon:'walk',image:'',accent:'#859c91',
 zh:{name:'街道上',category:'城市道路',description:'在街边停下来聊一会儿。身旁是人行道和来往的车道，居民还没有抵达目的地。',hours:'全天开放',highlights:['人行道','沿街建筑','城市道路']},
 en:{name:'On the street',category:'City street',description:'A quick chat on the sidewalk beside the road. Your neighbor is still on the way, not yet at their destination.',hours:'Always open',highlights:['Sidewalk','Streetfronts','City roads']},
}

/** A location ID can still name the departure building while a resident travels. */
export function conversationLocation(resident:CityResident|undefined,locations:CityLocation[]=[]){
 if(resident&&residentPresence(resident).mode==='traveling')return {id:'street',kind:'street',asset:street,isHome:false}
 const isHome=Boolean(resident&&presentInHome(resident))
 const presence=resident&&residentPresence(resident)
 const id=isHome?'home':presence?.building_id??presence?.location_id??resident?.current_location_id
 const location=locations.find(item=>item.id===id)
 return {id,kind:isHome?'home':location?.kind,asset:getLocationAsset(id,location?.kind),isHome}
}
