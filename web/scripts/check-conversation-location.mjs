import assert from 'node:assert/strict'
import {conversationLocation} from '../src/life/conversationLocation.ts'

const locations=[{id:'innovation_hub',kind:'work'},{id:'city_library',kind:'education'}]
const base={home:{id:'home-1'},household_id:'shared',is_home:false,current_location_id:'innovation_hub'}
const traveler={...base,current_action:{status:'traveling',location_id:'home-1'},spatial_presence:{mode:'traveling',location_id:'innovation_hub',building_id:null}}
for(const resident of [traveler,{...traveler,is_home:true},{...traveler,current_location_id:'home-1'},{...traveler,spatial_presence:undefined}]){
 const scene=conversationLocation(resident,locations)
 assert.equal(scene.kind,'street')
 assert.equal(scene.id,'street')
 assert.equal(scene.asset.image,'','Do not reuse the departure or destination interior image')
 assert.equal(scene.isHome,false)
 assert.equal(scene.asset.zh.name,'街道上')
 assert.equal(scene.asset.en.name,'On the street')
}
assert.equal(conversationLocation({...base,spatial_presence:{mode:'indoor',location_id:'innovation_hub',building_id:'innovation_hub'}},locations).asset.id,'innovation_hub')
const arrived={...traveler,is_home:true,current_location_id:'home-1',spatial_presence:{mode:'indoor',location_id:'home-1',building_id:'home-1'}}
assert.equal(conversationLocation(arrived,locations).isHome,true,'Arrival restores the shared home, even when legacy action data lags')
assert.equal(conversationLocation(arrived,locations).kind,'home')
assert.equal(conversationLocation({...base,spatial_presence:{mode:'indoor',location_id:'city_library',building_id:'city_library'}},locations).asset.id,'city_library','Authoritative presence wins over stale location')
assert.equal(conversationLocation({...arrived,spatial_presence:undefined,current_action:{status:'traveling',location_id:'shared:kitchen:stove'}},locations).kind,'home','Indoor room changes are not street travel')
assert.equal(conversationLocation(undefined).isHome,false)
console.log('Conversation location checks passed: travel, arrival, indoor transitions, authoritative location and bilingual street copy.')
