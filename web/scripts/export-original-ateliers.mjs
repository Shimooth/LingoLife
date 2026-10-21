import {writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {openQaPage,waitFor,delay} from './browser-cdp.mjs'
const page=await openQaPage()
try{
 await page.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})
 await page.call('Page.navigate',{url:'http://127.0.0.1:5173/atelier'})
 await waitFor(page,'window.originalAtelierExport && !document.querySelector(".original-loading")',45000)
 await delay(2000)
 const pack=JSON.parse(await page.evaluate('JSON.stringify(window.originalAtelierExport())'))
 const geometries=new Map()
 const pool=node=>{if(!node)return;if(node.mesh){const mesh=node.mesh,geometry={positions:mesh.positions,normals:mesh.normals,uvs:mesh.uvs,indices:mesh.indices},id=createHash('sha256').update(JSON.stringify(geometry)).digest('hex').slice(0,20);if(!geometries.has(id))geometries.set(id,{id,...geometry});for(const key of ['positions','normals','uvs','indices'])delete mesh[key];mesh.geometryId=id}node.children.forEach(pool)}
 pool(pack.root);pack.presets.forEach(preset=>pool(preset.root));Object.values(pack.props).forEach(pool);pack.geometries=[...geometries.values()]
 const serialized=JSON.stringify(pack)
 await writeFile('../native/lingolife-original/Assets/Resources/OriginalTown.json',serialized)
 console.log('Shared original asset pack:',(serialized.length/1024/1024).toFixed(1),'MB,',geometries.size,'unique geometries')
 const photos=await page.evaluate(`(async()=>{
  const THREE=await import('/node_modules/.vite/deps/three.js')
  const source=window.originalAtelierScene
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setSize(320,360);renderer.setPixelRatio(1);renderer.setClearColor(0,0);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;renderer.outputColorSpace=THREE.SRGBColorSpace
  const scene=new THREE.Scene();scene.environment=source.environment
  source.children.filter(node=>node.isLight).forEach(node=>scene.add(node.clone()))
  const camera=new THREE.PerspectiveCamera(32,320/360,.01,100);camera.position.set(.1,2.23,3.7);camera.lookAt(0,2.02,0)
  const results={};for(const id of ['mori','yu','lin','nana']){const resident=source.getObjectByName('atelier-export-resident:'+id).clone(true);resident.visible=true;scene.add(resident);renderer.render(scene,camera);results[id]=renderer.domElement.toDataURL('image/png').split(',')[1];scene.remove(resident)}
  renderer.dispose();return results
 })()`)
 await mkdir('public/assets/original/portraits',{recursive:true})
 for(const [id,data] of Object.entries(photos))await writeFile(`public/assets/original/portraits/${id}.png`,Buffer.from(data,'base64'))
 await page.call('Page.reload',{ignoreCache:true});await delay(2500)
 const screenshot=await page.call('Page.captureScreenshot',{format:'png'});await writeFile('/private/tmp/lingolife-original-integrated.png',Buffer.from(screenshot.data,'base64'))
 console.log('Four actual character portraits rendered.',page.errors,page.consoleErrors)
}finally{await page.close()}
