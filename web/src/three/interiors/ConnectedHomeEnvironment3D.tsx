import type {HouseholdLifeFacts} from '../../types'
import type {WorldLayoutInteriorPlacement} from '../../worldLayout'
import {IndoorEnvironment3D} from './IndoorEnvironment3D'
import {TimberFloor} from './TimberFloor'
import {
 CONNECTED_HOME_CORRIDORS,CONNECTED_HOME_ROOMS,CONNECTED_HOME_WALLS,
 type HomeWall,
} from './connectedHomeLayout'
import type {InteriorTheme} from './interiorThemes'
import type {SharedHomeRoomKind} from './sharedHomeLayout'

type RoomVisual={
 id:string
 kind:string
 placements?:readonly WorldLayoutInteriorPlacement[]
 cooking?:boolean
}

const ROOM_STYLE:Record<SharedHomeRoomKind,{theme:InteriorTheme;wall:string;floor:string;trim:string;accent:string}>={
 living_room:{theme:'home_lounge',wall:'#edcfb0',floor:'#a96e50',trim:'#fff1dd',accent:'#d9755f'},
 kitchen:{theme:'home_kitchen',wall:'#dfe9ce',floor:'#c2955e',trim:'#fff4d9',accent:'#7fa88a'},
 bathroom:{theme:'home_bathroom',wall:'#cee8e3',floor:'#6ca9a5',trim:'#f5ffff',accent:'#dfa37f'},
 bedroom:{theme:'home_bedroom',wall:'#ebcdc8',floor:'#aa7059',trim:'#fff0e8',accent:'#c17c8d'},
}

const HOME_BOUNDS=[
 Math.min(...CONNECTED_HOME_ROOMS.map(room=>room.bounds[0])),
 Math.max(...CONNECTED_HOME_ROOMS.map(room=>room.bounds[1])),
 Math.min(...CONNECTED_HOME_ROOMS.map(room=>room.bounds[2])),
 Math.max(...CONNECTED_HOME_ROOMS.map(room=>room.bounds[3])),
] as const
const FLOOR_Y=-.12455

/** Cut the near walls down so the entire connected floor plan stays readable. */
function wallHeight(wall:HomeWall){
 const [minX,,minZ]=HOME_BOUNDS
 if(Math.abs(wall.position[2]-minZ)<.2)return 2.65
 if(Math.abs(wall.position[0]-minX)<.2)return 2.65
 return .48
}

function RoomWall({wall}:{wall:HomeWall}){
 const style=ROOM_STYLE[wall.kind],height=wallHeight(wall)
 return <group name={`connected-home-wall:${wall.id}`}>
  <mesh position={[wall.position[0],FLOOR_Y+height/2,wall.position[2]]} receiveShadow castShadow>
   <boxGeometry args={[wall.size[0],height,wall.size[1]]}/><meshStandardMaterial color={style.wall} roughness={.88}/>
  </mesh>
  <mesh position={[wall.position[0],FLOOR_Y+height+.028,wall.position[2]]} receiveShadow castShadow>
   <boxGeometry args={[wall.size[0]+.025,.056,wall.size[1]+.025]}/><meshStandardMaterial color={style.trim} roughness={.78}/>
  </mesh>
  <mesh position={[wall.position[0],FLOOR_Y+.07,wall.position[2]]} receiveShadow>
   <boxGeometry args={[wall.size[0]+.015,.14,wall.size[1]+.015]}/><meshStandardMaterial color={style.trim} roughness={.85}/>
  </mesh>
 </group>
}

function OpenPortal({room}:{room:typeof CONNECTED_HOME_ROOMS[number]}){
 const {portal}=room,style=ROOM_STYLE[room.kind],sideways=portal.wall==='west'
 const [x,,z]=portal.center,width=portal.width,height=2.08
 return <group name={`connected-home-portal:${room.kind}`} position={[x,FLOOR_Y,z]} rotation-y={sideways?Math.PI/2:0}>
  {[-1,1].map(sign=><mesh key={sign} position={[sign*(width/2+.04),height/2,0]} castShadow receiveShadow>
   <boxGeometry args={[.08,height,.17]}/><meshStandardMaterial color={style.trim} roughness={.8}/>
  </mesh>)}
  <mesh position={[0,height+.045,0]} castShadow receiveShadow>
   <boxGeometry args={[width+.18,.09,.17]}/><meshStandardMaterial color={style.trim} roughness={.8}/>
  </mesh>
  <mesh position={[0,height+.125,0]} castShadow>
   <boxGeometry args={[width+.08,.045,.11]}/><meshStandardMaterial color={style.accent} roughness={.83}/>
  </mesh>
  <mesh position={[0,.013,0]} rotation-x={-Math.PI/2} receiveShadow>
   <planeGeometry args={[width,.3]}/><meshStandardMaterial color="#e0c39d" roughness={.92}/>
  </mesh>
 </group>
}

function NorthWindow({room}:{room:typeof CONNECTED_HOME_ROOMS[number]}){
 if(room.kind!=='kitchen'&&room.kind!=='bathroom')return null
 const style=ROOM_STYLE[room.kind],bathroom=room.kind==='bathroom'
 const width=bathroom?1.55:2.5,height=bathroom?1.03:1.32
 const x=room.offset[0]+(bathroom?2.9:2.82)*.99,z=room.bounds[2]+.085
 return <group name={`connected-home-window:${room.kind}`} position={[x,1.78,z]}>
  <mesh castShadow><boxGeometry args={[width+.23,height+.23,.08]}/><meshStandardMaterial color={style.trim} roughness={.72}/></mesh>
  <mesh position-z={.05}><planeGeometry args={[width,height]}/><meshStandardMaterial color={bathroom?'#b5d9d4':'#98c6cf'} emissive="#93bfc5" emissiveIntensity={.12} roughness={bathroom?.65:.3}/></mesh>
  {!bathroom&&[-.27,.16].map((offset,index)=><group key={offset} position={[offset*width,-.3,.062]}>
   <mesh scale={[1,.58,.12]}><sphereGeometry args={[index?.2:.26,12,8]}/><meshBasicMaterial color="#e7efe3" toneMapped={false}/></mesh>
   <mesh position-x={.16} scale={[1,.5,.1]}><sphereGeometry args={[.18,12,8]}/><meshBasicMaterial color="#e7efe3" toneMapped={false}/></mesh>
  </group>)}
  <mesh position-z={.08}><boxGeometry args={[.065,height+.04,.055]}/><meshStandardMaterial color={style.trim} roughness={.76}/></mesh>
  <mesh position={[0,0,.08]}><boxGeometry args={[width+.04,.065,.055]}/><meshStandardMaterial color={style.trim} roughness={.76}/></mesh>
  <mesh position={[0,-height/2-.13,.085]} castShadow><boxGeometry args={[width+.32,.1,.27]}/><meshStandardMaterial color={style.trim} roughness={.78}/></mesh>
 </group>
}

function SharedCorridor(){
 const [minX,maxX,minZ,maxZ]=HOME_BOUNDS
 return <group name="connected-home-corridor">
  <mesh position={[(minX+maxX)/2,-.36,(minZ+maxZ)/2]} receiveShadow castShadow>
   <boxGeometry args={[maxX-minX+.34,.37,maxZ-minZ+.34]}/><meshStandardMaterial color="#786154" roughness={.95}/>
  </mesh>
  <mesh position={[(minX+maxX)/2,-.148,(minZ+maxZ)/2]} receiveShadow>
   <boxGeometry args={[maxX-minX+.14,.045,maxZ-minZ+.14]}/><meshStandardMaterial color="#d0ae86" roughness={.94}/>
  </mesh>
  {CONNECTED_HOME_CORRIDORS.map(([left,right,back,front],index)=><group key={index}>
   <mesh position={[(left+right)/2,FLOOR_Y+.002,(back+front)/2]} rotation-x={-Math.PI/2} receiveShadow>
    <planeGeometry args={[right-left,front-back]}/><meshStandardMaterial color="#d7ba93" roughness={.92}/>
   </mesh>
   {[left+.09,right-.09].map(x=><mesh key={x} position={[x,FLOOR_Y+.006,(back+front)/2]} rotation-x={-Math.PI/2} receiveShadow>
    <planeGeometry args={[.035,front-back-.16]}/><meshStandardMaterial color="#b18c6b" roughness={.93}/>
   </mesh>)}
  </group>)}
  <group position={[0,FLOOR_Y+.009,-.35]} rotation-x={-Math.PI/2}>
   <mesh><circleGeometry args={[.6,32]}/><meshStandardMaterial color="#d0a57d" roughness={.97}/></mesh>
   <mesh position-z={.001}><ringGeometry args={[.48,.51,32]}/><meshStandardMaterial color="#eee0c2" roughness={.95}/></mesh>
  </group>
  <group position={[0,2.92,-.35]}>
   <mesh position-y={-.08} castShadow><cylinderGeometry args={[.23,.42,.3,20]}/><meshStandardMaterial color="#b17b58" roughness={.71}/></mesh>
   <mesh position-y={-.25} rotation-x={Math.PI/2}><circleGeometry args={[.33,20]}/><meshStandardMaterial color="#ffdfae" emissive="#ffcf91" emissiveIntensity={.45}/></mesh>
   <pointLight position-y={-.38} color="#ffdfb1" intensity={.85} distance={5.5}/>
  </group>
 </group>
}

/** One shared shell and open corridor; each room keeps its authored local furniture. */
export function ConnectedHomeEnvironment3D({rooms,occupiedPrivateSlots=[],householdLife,reducedMotion=false}:{rooms:readonly RoomVisual[];occupiedPrivateSlots?:readonly number[];householdLife?:HouseholdLifeFacts;reducedMotion?:boolean}){
 return <group name="LingoLife connected shared home">
  <SharedCorridor/>
  {CONNECTED_HOME_ROOMS.map(room=>{
   const visual=rooms.find(candidate=>candidate.kind===room.kind),style=ROOM_STYLE[room.kind]
   const [minX,maxX,minZ,maxZ]=room.bounds
   return <group key={room.kind} name={`connected-home-room:${room.kind}`}>
    <mesh position={[(minX+maxX)/2,FLOOR_Y,(minZ+maxZ)/2]} rotation-x={-Math.PI/2} receiveShadow>
     <planeGeometry args={[maxX-minX,maxZ-minZ]}/><meshStandardMaterial color={style.floor} roughness={.8}/>
    </mesh>
    {room.walls.map(wall=><RoomWall key={wall.id} wall={wall}/>)}
    <OpenPortal room={room}/>
    <NorthWindow room={room}/>
    <group position={[...room.offset]}>
     {(room.kind==='living_room'||room.kind==='bedroom')&&<group position={[0,-.08,.05]} scale={.99}><TimberFloor color={style.floor}/></group>}
     <IndoorEnvironment3D theme={style.theme} mode="preview" connectedShell placements={visual?.placements} occupiedPrivateSlots={occupiedPrivateSlots} householdLife={householdLife} cooking={visual?.cooking} reducedMotion={reducedMotion}/>
    </group>
   </group>
  })}
  {CONNECTED_HOME_WALLS.filter(wall=>wall.private&&wall.id.endsWith('-back')).map(wall=><mesh key={wall.id} name={`connected-home-private-boundary:${wall.id}`} position={[wall.position[0],FLOOR_Y+.4,wall.position[2]]} receiveShadow castShadow>
   <boxGeometry args={[wall.size[0],.8,wall.size[1]]}/><meshStandardMaterial color="#ead2cb" roughness={.92}/>
  </mesh>)}
 </group>
}
