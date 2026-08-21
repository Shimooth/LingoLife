import {Component,type ErrorInfo,type ReactNode} from 'react'

type Props={children:ReactNode}
type State={error:Error|null}

export class RootErrorBoundary extends Component<Props,State>{
 state:State={error:null}

 static getDerivedStateFromError(error:Error):State{return {error}}

 componentDidCatch(error:Error,info:ErrorInfo){
  console.error('LingoLife failed to start',error,info.componentStack)
 }

 render(){
  if(!this.state.error)return this.props.children
  let zh=true
  try{zh=(localStorage.getItem('lingolife.language')||navigator.language).toLowerCase().startsWith('zh')}catch{/* keep Chinese default */}
  return <main className="startup-error" role="alert"><section>
   <span aria-hidden>◌</span>
   <h1>{zh?'页面加载遇到了问题':'The page could not finish loading'}</h1>
   <p>{zh?'你的账号和游戏数据不会丢失。重新加载即可再试一次。':'Your account and game data are safe. Reload the page to try again.'}</p>
   <button type="button" onClick={()=>window.location.reload()}>{zh?'重新加载':'Reload'}</button>
  </section></main>
 }
}
