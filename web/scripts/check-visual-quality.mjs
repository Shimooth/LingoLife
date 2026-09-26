import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {advanceQuality,initialQuality,VISUAL_BUDGETS} from '../src/three/rendering/visualQuality.ts'
import {furnitureContactTexture} from '../src/three/rendering/grounding.ts'
import {speechPlacement} from '../src/three/characters/speechPlacement.ts'
import {trafficLoop,trafficRoutes} from '../src/three/world/ambientTraffic.ts'
import {ROAD_TILES,ROAD_TILE_STEP} from '../src/three/world/worldData.ts'
import {Box3,BoxGeometry,Group,Mesh} from 'three'
import {visibleCharacterBounds} from '../src/three/characters/visibleCharacterBounds.ts'
import './check-ambient-traffic.mjs'
import './check-traffic-parking.mjs'
import './check-city-art-direction.mjs'
import './check-streetscape.mjs'

const actor=new Group(),body=new Mesh(new BoxGeometry(1,2,1)),hiddenHair=new Mesh(new BoxGeometry(1,10,1))
hiddenHair.visible=false;actor.add(body,hiddenHair);actor.position.y=3
assert.equal(visibleCharacterBounds(actor,new Box3(),new Box3()).max.y,4,'hidden wardrobe variants must not raise head anchors')
body.geometry.dispose();hiddenHair.geometry.dispose()

assert.equal(initialQuality('auto').tier,1)
assert.equal(initialQuality('low').tier,0)
assert.equal(initialQuality('high').tier,2)
let healthy=initialQuality('auto')
for(let i=0;i<4;i++)healthy=advanceQuality(healthy,16.7)
assert.equal(healthy.tier,2,'sustained fast rendering unlocks high quality, regardless of pointer type')
assert.equal(advanceQuality(healthy,31).tier,1)
assert.equal(advanceQuality(initialQuality('auto'),40).tier,0)
let mixed=initialQuality('auto')
for(let i=0;i<80;i++)mixed=advanceQuality(mixed,i%2?16.7:23)
assert.equal(mixed.tier,1,'intermittent fast frames must not cause pumping')
let unstable=initialQuality('auto'),transitions=0
for(let i=0;i<400;i++){
 const next=advanceQuality(unstable,unstable.tier===2?40:16.7)
 if(next.tier!==unstable.tier)transitions++
 unstable=next
}
assert.ok(transitions<=4,'repeated upgrades must stop after two failed attempts')
assert.equal(advanceQuality(healthy,NaN),healthy)
assert.ok(VISUAL_BUDGETS.every(budget=>budget.shadowSize>=1024))
assert.ok(VISUAL_BUDGETS.every(budget=>budget.dpr<=1.65))
const texture=furnitureContactTexture()
assert.equal(texture,furnitureContactTexture(),'contact mask must be shared, not allocated every frame')
assert.equal(texture.image.data[3],0,'contact mask corners must be transparent')
assert.ok(texture.image.data[(32*64+32)*4+3]>240)
const source=path=>readFile(new URL(path,import.meta.url),'utf8')
for(const path of ['../src/components/HouseholdInteriorPreview.tsx','../src/components/LifeStoryEncounter.tsx','../src/components/SocialEventEncounter.tsx','../src/three/characters/CharacterCanvas3D.tsx','../src/three/characters/ConversationStage3D.tsx']){
 const text=await source(path)
 assert.match(text,/<SceneLook\//,`${path} must use the shared look`)
 assert.match(text,/<SceneLighting\b/,`${path} must use the shared light rig`)
 assert.match(text,/<Canvas\b[^>]*\bshadows\b/,`${path} must actually enable the shadow pass`)
 assert.match(text,/dpr=\{visualBudget\.dpr\}/,`${path} must preserve adaptive DPR across parent renders`)
 assert.match(text,/onTier=\{visualBudget\.onTier\}/,`${path} must synchronize the outer Canvas budget`)
 assert.match(text,/shadows="percentage"/,`${path} must not restore the deprecated default soft-shadow mode`)
}
assert.doesNotMatch(await source('../src/three/world/WorldObserver3D.tsx'),/coarsePointer|hardwareConcurrency|deviceMemory/)
assert.match(await source('../src/three/world/WorldEffects.tsx'),/viewport\.dpr/,'composer must follow adaptive DPR')
console.log('Visual quality checks passed: stable adaptive tiers, shared contact mask, five consistent scene rigs and touch-device eligibility.')
const desktop=speechPlacement(1000,650,680,220,240)
assert.ok(desktop.left+desktop.width<680-72,'desktop speech must stay to the left of the NPC silhouette')
assert.equal(680-72-desktop.left-desktop.width,16,'speech must sit next to the silhouette, not at the window edge')
assert.ok(desktop.left>150&&desktop.top>150,'desktop bubble follows the NPC both horizontally and vertically')
const mobile=speechPlacement(390,720,200,285,245)
assert.equal(720-mobile.bottom,285-16,'mobile bottom edge stays anchored just above the head')
for(const height of [64,150,300]){
 const short=speechPlacement(390,720,200,285,245,height)
 assert.equal(short.bottom,mobile.bottom,'streaming and translation must not detach the bubble from the NPC')
 assert.ok(short.top+Math.min(height,short.maxHeight)<=285-16)
}
const loop=trafficLoop(ROAD_TILES)
assert.ok(loop.length>=12,'default city must have a live traffic loop')
for(let i=0;i<loop.length;i++)assert.ok(Math.abs(Math.hypot(loop[i][0]-loop[(i+1)%loop.length][0],loop[i][1]-loop[(i+1)%loop.length][1])-ROAD_TILE_STEP)<.001,'traffic cannot shortcut across disconnected road cells')
assert.deepEqual(trafficLoop([]),[])
const routes=trafficRoutes(ROAD_TILES),open=routes.filter(r=>!r.closed)
assert.equal(open.length,6,'all three gateways must have inbound and outbound routes')
assert.equal(routes.length,16,'cover all five city blocks in both directions, plus six gateway routes; fleet count is separately bounded')
for(const route of open){
 assert.notDeepEqual(route.points[0],route.points.at(-1))
 assert.ok(open.some(other=>JSON.stringify(other.points)===JSON.stringify([...route.points].reverse())),'every gateway route has an opposite direction')
 for(let i=1;i<route.points.length;i++)assert.ok(Math.abs(Math.hypot(route.points[i][0]-route.points[i-1][0],route.points[i][1]-route.points[i-1][1])-ROAD_TILE_STEP)<.001)
}
assert.deepEqual(trafficRoutes([]),[])
assert.deepEqual(trafficLoop(ROAD_TILES.slice(0,6)),[],'an edited broken road must not produce a fake loop')
assert.doesNotMatch(await source('../src/components/LifeStoryEncounter.tsx'),/className="life-story-encounter__emotes"/,'emotes must be attached to 3D actors, not screen percentages')
console.log('Human presentation checks passed: silhouette-safe speech and connected ambient road loop.')
