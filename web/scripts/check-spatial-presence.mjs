import assert from 'node:assert/strict'
import {residentPresence,presentInHome,visibleOnCityMap} from '../src/life/spatialPresence.ts'

const base={home:{id:'home-1'},household_id:'shared',current_location_id:'home-1',is_home:true}
const indoors={mode:'indoor',location_id:'home-1',building_id:'home-1'}
assert.equal(visibleOnCityMap({spatialPresence:indoors}),false)
assert.equal(presentInHome({...base,spatial_presence:indoors}),true)
for(const mode of ['outdoor','traveling']){
 const resident={...base,spatial_presence:{mode,location_id:'home-1',building_id:null}}
 assert.equal(visibleOnCityMap({spatialPresence:residentPresence(resident)}),true)
 assert.equal(presentInHome(resident),false)
}
assert.equal(presentInHome({...base,is_home:false,spatial_presence:{mode:'indoor',location_id:'city_library',building_id:'city_library'}}),false)
assert.equal(residentPresence(base).mode,'indoor')
assert.equal(residentPresence({...base,current_action:{status:'traveling',location_id:'city_library'}}).mode,'traveling')
assert.equal(residentPresence({...base,current_action:{status:'traveling',location_id:'shared:kitchen:stove'}}).mode,'indoor')
assert.equal(residentPresence({...base,current_action:{status:'planned',location_id:'city_library'}}).mode,'indoor')
assert.equal(visibleOnCityMap({}),true,'Keep old city fixture/authoring consumers compatible')
console.log('Spatial presence checks passed: indoor/outdoor/travel, authoritative location and old-server fallback.')
