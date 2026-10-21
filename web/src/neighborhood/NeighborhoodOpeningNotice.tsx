import type {NeighborhoodNews} from './types'
import './NeighborhoodOpeningNotice.css'
export function NeighborhoodOpeningNotice({news,language,ready,complete,busy=false,error='',onEnter,onDismiss}:{news:NeighborhoodNews;language:'zh'|'en';ready:boolean;complete:boolean;busy?:boolean;error?:string;onEnter:()=>void;onDismiss:()=>void}){
 const zh=language==='zh',fountain=news.id==='fountain-open'
 return <aside className="neighborhood-opening-notice" aria-labelledby="facility-news-heading" data-facility-news={news.id}>
  <div className="neighborhood-opening-top"><span><i aria-hidden/> {zh?'小城新闻 · 社区新进展':'NEIGHBORHOOD NEWS · A SHARED IMPROVEMENT'}</span><button type="button" disabled={busy} aria-label={zh?'继续逛逛':'Keep exploring'} onClick={onDismiss}>×</button></div>
  <h2 id="facility-news-heading">{zh?news.title_zh:news.title}</h2>
  <p>{zh?news.body_zh:news.body}</p>
  <small role="status">{complete?(zh?'已在地图上开放 · 随时点击进入':"Open on the map · Visit whenever you like"):ready?(zh?'一起走近看看吧…':'Let’s take a closer look…'):(zh?'正在前往生活街区…':'Heading to the neighborhood…')}</small>
  {error&&<p className="neighborhood-opening-error" role="alert">{error}</p>}
  <div className="neighborhood-opening-actions"><button type="button" disabled={busy} onClick={onDismiss}>{zh?'先逛逛小城':'Explore a little'}</button><button type="button" disabled={busy} onClick={onEnter}>{fountain?(zh?'去许个愿':'Make a wish'):(zh?'逛逛新店':'Visit the shop')}<span aria-hidden>↗</span></button></div>
 </aside>
}
