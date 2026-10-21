import type {OriginalMotion,OriginalEmotion} from '../spec'
export type OriginalResidentPose={bodyY:number;bodyZ:number;headX:number;headY:number;headZ:number;leftArmX:number;leftArmZ:number;rightArmX:number;rightArmZ:number;leftElbow:number;rightElbow:number;leftLeg:number;rightLeg:number;leftKnee:number;rightKnee:number;blink:number;talk:number;chew:number;lookX:number;lookY:number;smile:number}
const smooth=(x:number)=>{const t=Math.max(0,Math.min(1,x));return t*t*(3-2*t)}
/** Absolute pose sampled by time: seek, pause and native baking do not depend on
 * previous frames. Radians; local limb rest direction is -Y, portrait looks +Z. */
export function originalResidentPose(motion:OriginalMotion,emotion:OriginalEmotion,time:number):OriginalResidentPose{
 const t=Math.max(0,Number.isFinite(time)?time:0),breath=Math.sin(t*1.7),cycle=t%4.7,blink=cycle>4.42?Math.sin((cycle-4.42)/.28*Math.PI):0
 const p:OriginalResidentPose={bodyY:0,bodyZ:breath*.009,headX:breath*.011,headY:Math.sin(t*.47)*.025,headZ:Math.sin(t*.73)*.013,leftArmX:-.04+breath*.013,leftArmZ:.095,rightArmX:-.04-breath*.013,rightArmZ:-.095,leftElbow:-.08,rightElbow:-.08,leftLeg:0,rightLeg:0,leftKnee:0,rightKnee:0,blink,talk:0,chew:0,lookX:Math.sin(t*.47),lookY:Math.sin(t*.33)*.3,smile:emotion==='happy'?1:emotion==='sad'?-1:.2}
 if(motion==='wave'){const w=smooth(t*2);p.rightArmZ=-1.25*w;p.rightArmX=-.25*w;p.rightElbow=-1.3*w;p.headZ=.07*w;p.rightArmZ+=Math.sin(t*7)*.13*w}
 if(motion==='walk'){const step=Math.sin(t*6.2);p.bodyY=Math.abs(Math.cos(t*6.2))*.024;p.bodyZ=-step*.024;p.leftLeg=step*.38;p.rightLeg=-step*.38;p.leftKnee=Math.max(0,-step)*.40;p.rightKnee=Math.max(0,step)*.40;p.leftArmX=-step*.25;p.rightArmX=step*.25;p.headY=0;p.headZ=0}
 if(motion==='talk'){p.talk=(.2+Math.abs(Math.sin(t*9.1))*.58)*(Math.sin(t*2.3)>-.65?1:.08);p.headX=Math.sin(t*2.3)*.045;p.headY=Math.sin(t*.7)*.07;p.leftArmX=-.24+Math.sin(t*2)*.08;p.leftElbow=-.5+Math.sin(t*2)*.13;p.rightArmX=-.19;p.rightElbow=-.34;p.lookX=Math.sin(t*.37)}
 if(motion==='receive'){p.leftArmX=-.67;p.rightArmX=-.67;p.leftArmZ=.22;p.rightArmZ=-.22;p.leftElbow=-.84;p.rightElbow=-.84;p.headX=.06;p.smile=.65}
 if(motion==='eat'){p.rightArmX=-1.08;p.rightElbow=-1.51;p.rightArmZ=-.13;p.headX=.025;p.chew=Math.abs(Math.sin(t*7));p.talk=(t%3.4)<1.9?.15:0;p.lookY=-.8}
 if(motion==='happy'){const bob=Math.max(0,Math.sin(t*5));p.bodyY=bob*.075;p.leftArmZ=.28+bob*.14;p.rightArmZ=-.28-bob*.14;p.leftElbow=-.85;p.rightElbow=-.85;p.headZ=Math.sin(t*3)*.065;p.smile=1;p.blink=Math.max(p.blink,.3);p.talk=.28+Math.sin(t*4)*.1}
 if(emotion==='sad'){p.headX+=.075;p.headZ-=.04;p.lookY=-.75}
 if(emotion==='curious'){p.headZ+=.105;p.lookY=.35}
 return p
}
