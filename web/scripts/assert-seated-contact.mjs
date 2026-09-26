import assert from 'node:assert/strict'
import {Vector3} from 'three'
import {prepareChibi} from '../src/three/characters/characterModel.ts'

export const contactModel=(source,family,index=0)=>family==='chibi'?prepareChibi(source,{
 hair:index?'hair-tail':'hair-variant',hairColor:'#543522',outfit:index?'traveller':'student',outfitColor:'#476879',accessory:'none',skin:'#c98b6b',
}):source

/** Sitting means the visible body is supported and the thighs remain seated.
 * Ankle height is not a seating criterion: short legs can hang naturally. */
export function assertSeatedContact(model,family,result,label,floorY=0){
 assert.ok(result,`${label}: the actual rig must support the production seat solver`)
 assert.equal(result.supportSource,'skin',`${label}: use real body skin, not a pelvis-pivot approximation`)
 assert.ok(Math.abs(result.supportError)<.01,`${label}: visible seat support error ${result.supportError}m`)
 model.updateWorldMatrix(true,true)
 const legs=[]
 for(const side of ['L','R']){
  const names=family==='city'?[`UpperLeg${side}`,`Leg${side}`,`Foot${side}`]:[`DEF-thigh${side}`,`DEF-shin${side}`,`DEF-foot${side}`]
  const [hip,knee,ankle]=names.map(name=>model.getObjectByName(name).getWorldPosition(new Vector3()))
  const thigh=knee.clone().sub(hip),thighElevation=Math.atan2(thigh.y,Math.hypot(thigh.x,thigh.z))
  const kneeAngle=hip.clone().sub(knee).angleTo(ankle.clone().sub(knee))
  assert.ok(Math.abs(thighElevation)<20*Math.PI/180,`${label}/${side}: thigh must remain near horizontal, got ${thighElevation*180/Math.PI}°`)
  assert.ok(kneeAngle>65*Math.PI/180&&kneeAngle<140*Math.PI/180,`${label}/${side}: knee must stay bent, got ${kneeAngle*180/Math.PI}°`)
  const measured=result.legs.find(leg=>leg.side===side)
  assert.ok(measured&&Number.isFinite(measured.soleY)&&measured.soleY>=floorY-.008,`${label}/${side}: actual visible shoe sole may not penetrate floor: ${measured?.soleY}m`)
  legs.push({side,thighDegrees:+(thighElevation*180/Math.PI).toFixed(2),kneeDegrees:+(kneeAngle*180/Math.PI).toFixed(2),soleMm:+(measured.soleY*1000).toFixed(2)})
 }
 return {supportErrorMm:+(result.supportError*1000).toFixed(3),legs}
}
