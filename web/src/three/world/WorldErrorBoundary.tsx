import {Component,type ErrorInfo,type ReactNode} from 'react'

type Props={children:ReactNode;fallback:(error:Error)=>ReactNode}
type State={error:Error|null}

export class WorldErrorBoundary extends Component<Props,State>{
 state:State={error:null}

 static getDerivedStateFromError(error:Error):State{return {error}}

 componentDidCatch(error:Error,info:ErrorInfo){
  console.error('LingoLife 3D world failed to render',error,info.componentStack)
 }

 render(){return this.state.error?this.props.fallback(this.state.error):this.props.children}
}

export function supportsWebGL(){
 if(typeof document==='undefined')return false
 try{
  const canvas=document.createElement('canvas')
  return Boolean(window.WebGL2RenderingContext&&canvas.getContext('webgl2'))||Boolean(window.WebGLRenderingContext&&canvas.getContext('webgl'))
 }catch{return false}
}
