import {BufferAttribute,Mesh,InstancedMesh,Matrix4,MeshStandardMaterial,Object3D,Color} from 'three'
import type {OriginalAppearance} from './spec'
export type OriginalExportNode={name:string;visible:boolean;position:number[];rotation:number[];scale:number[];children:OriginalExportNode[];mesh?:{positions:number[];normals:number[];uvs?:number[];indices:number[];material:{color:number[];roughness:number;metalness:number;emissive:number[];opacity:number;transparent:boolean}}}
const round=(n:number)=>Math.round(n*1e6)/1e6
export function exportOriginalNode(node:Object3D):OriginalExportNode{
 const output:OriginalExportNode={name:node.name||node.type,visible:node.visible,position:node.position.toArray().map(round),rotation:node.quaternion.toArray().map(round),scale:node.scale.toArray().map(round),children:node.children.filter(child=>!child.name.startsWith('no-export:')).map(exportOriginalNode)}
 if(node instanceof InstancedMesh){
  const transform=new Matrix4(),tint=new Color(),instance=new Mesh(node.geometry,node.material)
  for(let i=0;i<node.count;i++){node.getMatrixAt(i,transform);transform.decompose(instance.position,instance.quaternion,instance.scale);instance.name=`${node.name}:${i}`;const item=exportOriginalNode(instance);if(node.instanceColor&&item.mesh){node.getColorAt(i,tint);item.mesh.material.color=item.mesh.material.color.map((value,index)=>round(value*tint.toArray()[index]))}output.children.push(item)}
  return output
 }
 if(node instanceof Mesh){
  const geometry=node.geometry,position=geometry.getAttribute('position') as BufferAttribute,normal=geometry.getAttribute('normal') as BufferAttribute
  const source=Array.isArray(node.material)?node.material[0]:node.material
  const material=source as MeshStandardMaterial
  if(position){output.mesh={positions:Array.from(position.array,round),normals:normal?Array.from(normal.array,round):[],indices:geometry.index?Array.from(geometry.index.array):Array.from({length:position.count},(_,i)=>i),material:{color:(material.color??new Color('#ffffff')).toArray().map(round),roughness:material.roughness??.65,metalness:material.metalness??0,emissive:(material.emissive??new Color('#000000')).clone().multiplyScalar(material.emissiveIntensity??1).toArray().map(round),opacity:material.opacity??1,transparent:material.transparent??false}}
   const uv=geometry.getAttribute('uv');if(uv)output.mesh.uvs=Array.from(uv.array,round)
  }
 }
 return output
}
export function exportOriginalPack(scene:Object3D,presets:{id:string;name:string;appearance:OriginalAppearance}[]){
 const root=scene.getObjectByName('atelier-export-town')
 if(!root)throw new Error('Town assets are not ready')
 const props=Object.fromEntries(['gift','cookie-whole','cookie-bitten'].map(id=>{const object=scene.getObjectByName(`orig-prop-${id}`);return [id.replace(/-([a-z])/g,(_,letter:string)=>letter.toUpperCase()),object?exportOriginalNode(object):null]}))
 return {version:1,title:'LingoLife Original Atelier',units:'meter',coordinateSystem:'right-handed-y-up',source:'Original procedural geometry authored for LingoLife',root:exportOriginalNode(root),props,presets:presets.map(preset=>{const resident=scene.getObjectByName(`atelier-export-resident:${preset.id}`);if(!resident)throw new Error('Resident assets are not ready');return {...preset,root:exportOriginalNode(resident)}})}
}
export function downloadOriginalFile(name:string,data:Blob|string,type='application/json'){
 const blob=typeof data==='string'?new Blob([data],{type}):data,url=URL.createObjectURL(blob)
 const link=document.createElement('a');link.href=url;link.download=name;link.click();window.setTimeout(()=>URL.revokeObjectURL(url),30000)
}
