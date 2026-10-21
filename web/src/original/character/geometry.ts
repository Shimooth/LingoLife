import {BufferGeometry,Float32BufferAttribute,Vector3,CatmullRomCurve3,Color} from 'three'
import type {OriginalAppearance} from '../spec'

export const shade=(color:string,amount:number)=>new Color(color).lerp(new Color(amount<0?'#312524':'#fff2dd'),Math.abs(amount)).getStyle()
export const mix=(a:number,b:number,t:number)=>a+(b-a)*t
export type HeadDimensions={width:number;height:number;depth:number;jaw:number;cheeks:number;chin:number;forehead:number}
export function headDimensions(a:OriginalAppearance):HeadDimensions{return {width:mix(.405,.495,a.faceWidth),height:mix(.415,.485,a.faceHeight),depth:.385,jaw:a.jawWidth,cheeks:a.cheeks,chin:a.chin,forehead:a.forehead}}

/** A closed, continuously deformed portrait surface. Face controls alter the source
 * vertices; every attached feature samples the same surface, including the back. */
export function headPoint(d:HeadDimensions,theta:number,phi:number,inflate=0):Vector3{
 const y=Math.cos(theta),ring=Math.sin(theta),front=Math.max(0,Math.cos(phi))
 const lower=Math.max(0,-y),jaw=1-lower*mix(.29,.06,d.jaw)
 const cheek=1+Math.exp(-(((y+.17)/.33)**2))*mix(0,.1,d.cheeks)
 const x=Math.sin(phi)*ring*(d.width+inflate)*jaw*cheek
 const py=y*(d.height+inflate)-Math.max(0,-y)**4*mix(-.025,.055,d.chin)
 const forehead=1+Math.max(0,y)*mix(-.055,.07,d.forehead)
 const flattened=Math.sign(Math.cos(phi))*Math.pow(Math.abs(Math.cos(phi)),.69)
 const z=flattened*ring*(d.depth+inflate)*forehead+front*.02*Math.exp(-(((y+.05)/.6)**2))
 return new Vector3(x,py,z)
}
export function faceDepth(d:HeadDimensions,x:number,y:number){
 const yn=Math.max(-.97,Math.min(.97,y/d.height)),theta=Math.acos(yn),ring=Math.sin(theta)
 const lower=Math.max(0,-yn),jaw=1-lower*mix(.29,.06,d.jaw),cheek=1+Math.exp(-(((yn+.17)/.33)**2))*mix(0,.1,d.cheeks)
 const phi=Math.asin(Math.max(-.985,Math.min(.985,x/(d.width*ring*jaw*cheek))))
 return headPoint(d,theta,phi).z
}
function meshSurface(rows:number,columns:number,sample:(u:number,v:number)=>Vector3){
 const position:number[]=[],uv:number[]=[],index:number[]=[]
 for(let j=0;j<=rows;j++)for(let i=0;i<=columns;i++){const p=sample(j/rows,i/columns);position.push(p.x,p.y,p.z);uv.push(i/columns,1-j/rows)}
 for(let j=0;j<rows;j++)for(let i=0;i<columns;i++){const a=j*(columns+1)+i,b=a+columns+1;index.push(a,b,a+1,b,b+1,a+1)}
 const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(position,3));geometry.setAttribute('uv',new Float32BufferAttribute(uv,2));geometry.setIndex(index);geometry.computeVertexNormals();geometry.computeBoundingSphere();return geometry
}
export function createHead(d:HeadDimensions,detail:number){return meshSurface(detail,detail*2,(u,v)=>headPoint(d,.00001+u*(Math.PI-.00002),v*Math.PI*2))}
export function createScalp(d:HeadDimensions,style:OriginalAppearance['hair'],detail:number){
 return meshSurface(detail,detail*2,(u,v)=>{const phi=v*Math.PI*2,front=Math.max(0,Math.cos(phi)),back=Math.max(0,-Math.cos(phi));const edge=(style==='crop'?1.68:1.79)-front*.70+back*(style==='bob'?.3:.1);const p=headPoint(d,.0001+u*edge,phi,.027);if(style==='bob'){const side=Math.abs(Math.sin(phi));p.x*=1+.09*u*side;p.y-=u**5*.08*(1-front)}return p})
}
/** Sculpted tapered hair ribbon; elliptical sections follow a curve without
 * adding floating balls or flat camera-facing cards. */
export function createLock(points:[number,number,number][],width:number,thickness:number,detail=18){
 const curve=new CatmullRomCurve3(points.map(p=>new Vector3(...p)))
 return meshSurface(detail,12,(u,v)=>{const p=curve.getPoint(u),tangent=curve.getTangent(u),axis=new Vector3(-tangent.y,tangent.x,0).normalize();if(axis.lengthSq()<.1)axis.set(1,0,0);const normal=new Vector3().crossVectors(tangent,axis).normalize();const taper=Math.sin(Math.PI*(.035+u*.955))**.52;const angle=-v*Math.PI*2;return p.addScaledVector(axis,Math.cos(angle)*width*taper).addScaledVector(normal,Math.sin(angle)*thickness*taper)})
}
/** Elliptical tailoring profile: y, horizontal radius, depth radius. */
export function createTailoredSurface(profile:[number,number,number][],detail=48){
 const points=profile.map(p=>new Vector3(...p)),curve=new CatmullRomCurve3(points)
 return meshSurface(32,detail,(u,v)=>{const p=curve.getPoint(1-u),angle=v*Math.PI*2;return new Vector3(Math.sin(angle)*Math.max(.0001,p.y),p.x,Math.cos(angle)*Math.max(.0001,p.z))})
}

export type OriginalBodyDimensions={hip:number;shoulder:number;head:number;width:number;shoulderX:number;upperArm:number;forearm:number;thigh:number;shin:number}
export function bodyDimensions(a:OriginalAppearance):OriginalBodyDimensions{
 const thigh=mix(.30,.43,a.legLength),shin=mix(.30,.40,a.legLength),hip=.19+thigh+shin,width=mix(.265,.375,a.bodyWidth)
 const head=headDimensions(a),headScale=mix(.9,1.12,a.headScale)
 return {hip,shoulder:hip+.65,head:hip+.76+(head.height+mix(-.025,.055,a.chin))*headScale,width,shoulderX:width+mix(.005,.072,a.shoulderWidth),upperArm:mix(.27,.35,a.armLength),forearm:mix(.25,.34,a.armLength),thigh,shin}
}
