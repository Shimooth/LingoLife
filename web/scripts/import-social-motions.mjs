// Extract only the two CC0 talking loops and their mesh-free upper-body rig.
// Usage: node web/scripts/import-social-motions.mjs /path/to/05_curated_candidates
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {AnimationClip,PropertyBinding,QuaternionKeyframeTrack} from 'three'

const directory=process.argv[2]
if(!directory)throw new Error('Pass the curated CC0 asset directory')
const source=path.join(directory,'animations/quaternius_standard/UAL1_Standard.glb')
const license=fs.readFileSync(path.join(directory,'licenses/quaternius__Universal_Animation_Library_Standard__License.txt'),'utf8')
if(!license.includes('CC0 1.0'))throw new Error('The source must include its CC0 licence')
const bytes=fs.readFileSync(source),length=bytes.readUInt32LE(12)
const sourceSha256=createHash('sha256').update(bytes).digest('hex')
const json=JSON.parse(bytes.subarray(20,20+length)),binary=bytes.subarray(28+length)
const parents=new Map()
json.nodes.forEach((node,index)=>(node.children??[]).forEach(child=>parents.set(child,index)))
const retained=new Set()
for(const name of ['hand_l','hand_r']){
 let index=json.nodes.findIndex(node=>node.name===name)
 if(index<0)throw new Error(`Missing source bone ${name}`)
 while(index!==undefined){retained.add(index);index=parents.get(index)}
}
const indices=[...retained].sort((a,b)=>a-b),remap=new Map(indices.map((old,index)=>[old,index]))
const nodes=indices.map(index=>{
 const node=json.nodes[index]
 return {name:PropertyBinding.sanitizeNodeName(node.name),children:(node.children??[]).filter(child=>retained.has(child)).map(child=>remap.get(child)),position:node.translation??[0,0,0],quaternion:node.rotation??[0,0,0,1],scale:node.scale??[1,1,1]}
})
function accessor(index){
 const a=json.accessors[index],v=json.bufferViews[a.bufferView],width={SCALAR:1,VEC4:4}[a.type]
 if(a.componentType!==5126||a.sparse||!width)throw new Error('Expected dense float quaternion data')
 const values=[]
 for(let row=0;row<a.count;row++)for(let axis=0;axis<width;axis++)values.push(binary.readFloatLE((v.byteOffset??0)+(a.byteOffset??0)+row*(v.byteStride??width*4)+axis*4))
 return values
}
const clips=['Idle_Talking_Loop','Sitting_Talking_Loop'].map(name=>{
 const animation=json.animations.find(value=>value.name===name)
 if(!animation)throw new Error(`Missing ${name}`)
 const tracks=animation.channels.filter(channel=>retained.has(channel.target.node)&&channel.target.path==='rotation').map(channel=>{
  const sampler=animation.samplers[channel.sampler]
  if(sampler.interpolation&&sampler.interpolation!=='LINEAR')throw new Error('Unexpected interpolation')
  return new QuaternionKeyframeTrack(`${nodes[remap.get(channel.target.node)].name}.quaternion`,accessor(sampler.input),accessor(sampler.output))
 })
 const clip=new AnimationClip(name,-1,tracks)
 // Stable import output: Three normally assigns a random UUID on every run.
 const id=createHash('sha256').update(`${sourceSha256}:${name}`).digest('hex').slice(0,32)
 clip.uuid=`${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20)}`
 return AnimationClip.toJSON(clip)
})
const output={version:1,source:'Quaternius Universal Animation Library Standard (CC0 1.0)',sourceSha256,nodes,roots:indices.filter(index=>!retained.has(parents.get(index))).map(index=>remap.get(index)),clips}
const target=new URL('../public/assets/life/motions/',import.meta.url)
fs.mkdirSync(target,{recursive:true})
fs.writeFileSync(new URL('quaternius-social.json',target),JSON.stringify(output,(_,value)=>typeof value==='number'?Math.round(value*1e6)/1e6:value))
// Preserve the licence text while normalizing source CRLF/trailing spaces for Git.
fs.writeFileSync(new URL('License-Quaternius-Social.txt',target),license.replace(/\r\n/g,'\n').split('\n').map(line=>line.trimEnd()).join('\n').trimEnd()+'\n')
console.log(`Imported ${clips.length} mesh-free, quaternion-only CC0 talking loops: ${fs.statSync(new URL('quaternius-social.json',target)).size} bytes`)
