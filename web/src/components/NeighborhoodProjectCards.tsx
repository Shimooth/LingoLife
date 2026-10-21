import type {NeighborhoodProject,NeighborhoodResident} from '../neighborhood/types'

type Props={projects:NeighborhoodProject[];residents:NeighborhoodResident[];coins:number;language:'zh'|'en';busy:boolean;onFund:(id:string)=>void;onOpenWallet?:()=>void}
const icons={fountain:'⛲',clothing_store:'♧',flower_beds:'✿',plaza_lights:'☼'}
const completedCopy={
 fountain:['居民照料等级每升一级，就多一次许愿。可以在这里挑选礼物和微个性。','Each care level brings a wish for a gift or little personality.'],
 clothing_store:['小店已经开门。买过的衣服保留在共享衣橱里，适合的居民可以重复换装。','The shop is open. Purchased outfits stay in the shared wardrobe for compatible residents.'],
 flower_beds:['新的花坛已种在喷泉旁，回到地图就能看到广场多出的颜色。','New flower beds are planted beside the fountain. Visit the map to see their colors.'],
 plaza_lights:['夜灯已经安装好，入夜后会照亮喷泉旁的散步小路。','The lamps are installed and light the walking paths beside the fountain after dusk.'],
}

export function NeighborhoodProjectCards({projects,residents,coins,language,busy,onFund,onOpenWallet}:Props){
 const zh=language==='zh'
 return <div className="neighborhood-projects">{projects.map(project=>{
  const requester=residents.find(resident=>resident.id===project.requester_id)
  const complete=project.status==='completed',ready=project.status==='proposed',affordable=coins>=project.cost
  return <article className="neighborhood-project" key={project.id} data-project-id={project.id} data-project-status={project.status}>
   <header><span aria-hidden>{icons[project.id]}</span><div><small>{complete?(zh?'已经成为日常':'PART OF EVERYDAY LIFE'):requester?(zh?`${requester.profile.name}的小心愿`:`${requester.profile.name}'s idea`):(zh?'社区的下一步':'OUR NEXT LITTLE STEP')}</small><h3>{zh?project.title_zh:project.title}</h3></div>{complete&&<b aria-label={zh?'已完成':'Completed'}>✓</b>}</header>
   <p>{complete?completedCopy[project.id][zh?0:1]:zh?project.reason_zh:project.reason}</p>
   {!complete&&<><ul aria-label={zh?'筹备条件':'Preparation checklist'}>{project.requirements.map(requirement=><li key={requirement.id} data-met={requirement.met}><span aria-hidden>{requirement.met?'✓':'○'}</span>{zh?requirement.label_zh:requirement.label}</li>)}</ul><div className="neighborhood-project-cost"><span>{zh?'一次筹备投入':'One-time contribution'}</span><strong>{project.cost} {zh?'生活币':'coins'}</strong></div><button type="button" className="neighborhood-primary" disabled={busy||!ready||!affordable} onClick={()=>onFund(project.id)}>{!ready?(zh?'先完成上面的准备':'Complete the checklist first'):!affordable?(zh?`还差 ${project.cost-coins} 生活币`:`${project.cost-coins} more coins needed`):(zh?`完成筹备 · ${project.cost} 生活币`:`Make it happen · ${project.cost} coins`)}</button>{ready&&!affordable&&onOpenWallet&&<button type="button" className="neighborhood-project-wallet" onClick={onOpenWallet}>{zh?'去钱包看看怎样攒生活币':'See how to earn coins'} →</button>}</>}
   {complete&&<small className="neighborhood-project-complete">{zh?'已在地图上开放 · 不再收费':'Open on the map · No further contribution needed'}</small>}
  </article>
 })}</div>
}
