// Build a small, mesh-free motion library from the user's CC0 KayKit download.
// Usage: node web/scripts/import-life-motions.mjs /path/to/05_curated_candidates
import fs from 'node:fs'
import path from 'node:path'
import {AnimationClip, QuaternionKeyframeTrack, VectorKeyframeTrack, PropertyBinding} from 'three'

const directory = process.argv[2]
if (!directory) throw new Error('Pass the curated CC0 asset directory')
const selections = {
  Simulation: ['Sit_Chair_Down','Sit_Chair_Idle','Sit_Chair_StandUp','Waving'],
  General: ['Idle_A','Interact','Use_Item'],
  Tools: ['Chop','Chopping','Holding_A','Holding_B','Working_A'],
}
const output = {version:1, source:'KayKit Character Animations 1.1 (CC0)', packs:[]}
for (const [pack, names] of Object.entries(selections)) {
  const bytes = fs.readFileSync(path.join(directory, `animations/kaykit_medium/Rig_Medium_${pack}.glb`))
  const length = bytes.readUInt32LE(12)
  const json = JSON.parse(bytes.subarray(20,20+length))
  const binary = bytes.subarray(28+length)
  function accessor(index) {
    const a=json.accessors[index], v=json.bufferViews[a.bufferView]
    if (a.componentType!==5126 || a.sparse) throw new Error('Expected dense float animation data')
    const width={SCALAR:1,VEC3:3,VEC4:4}[a.type], values=[]
    for(let row=0;row<a.count;row++) for(let axis=0;axis<width;axis++) values.push(binary.readFloatLE((v.byteOffset??0)+(a.byteOffset??0)+row*(v.byteStride??width*4)+axis*4))
    return values
  }
  const nodes=json.nodes.map(node=>({name:PropertyBinding.sanitizeNodeName(node.name??''), children:node.children??[], position:node.translation??[0,0,0], quaternion:node.rotation??[0,0,0,1], scale:node.scale??[1,1,1]}))
  const clips=names.map(name=>{
    const animation=json.animations.find(value=>value.name===name)
    if(!animation) throw new Error(`Missing ${name}`)
    const tracks=animation.channels.filter(channel=>['rotation','translation'].includes(channel.target.path)).map(channel=>{
      const sampler=animation.samplers[channel.sampler], property=channel.target.path==='rotation'?'quaternion':'position'
      if(sampler.interpolation && sampler.interpolation!=='LINEAR')throw new Error('Unexpected interpolation')
      const Track=property==='quaternion'?QuaternionKeyframeTrack:VectorKeyframeTrack
      return new Track(`${nodes[channel.target.node].name}.${property}`,accessor(sampler.input),accessor(sampler.output))
    })
    return AnimationClip.toJSON(new AnimationClip(name,-1,tracks))
  })
  output.packs.push({nodes, roots:json.scenes[json.scene??0].nodes, clips})
}
const target=new URL('../public/assets/life/motions/',import.meta.url)
fs.mkdirSync(target,{recursive:true})
fs.writeFileSync(new URL('kaykit-life.json',target),JSON.stringify(output,(_,value)=>typeof value==='number'?Math.round(value*1e6)/1e6:value))
fs.copyFileSync(path.join(directory,'licenses/kaykit__KayKit_Character_Animations_Free_1.1__License.txt'),new URL('License-KayKit.txt',target))
console.log('Imported 12 mesh-free CC0 life clips:',fs.statSync(new URL('kaykit-life.json',target)).size,'bytes')
