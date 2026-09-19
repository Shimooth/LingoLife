import {Box3,Mesh,SkinnedMesh,type Object3D} from 'three'

/** Hidden wardrobe variants must not raise the head anchor. Refresh animated skin bounds. */
export function visibleCharacterBounds(root:Object3D,result:Box3,scratch:Box3){
 root.updateWorldMatrix(true,true)
 result.makeEmpty()
 root.traverseVisible(object=>{
  if(!(object instanceof Mesh))return
  let bounds
  if(object instanceof SkinnedMesh){object.computeBoundingBox();bounds=object.boundingBox}
  else{if(!object.geometry.boundingBox)object.geometry.computeBoundingBox();bounds=object.geometry.boundingBox}
  if(bounds)result.union(scratch.copy(bounds).applyMatrix4(object.matrixWorld))
 })
 return result
}
