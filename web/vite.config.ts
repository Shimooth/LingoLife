import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
 plugins:[react()],
 server:{proxy:{'/api':'http://127.0.0.1:8000'}},
 build:{rollupOptions:{output:{manualChunks(id){
  if(id.indexOf('vite/preload-helper')>=0)return 'preload-runtime'
  if(id.indexOf('/node_modules/react/')>=0||id.indexOf('/node_modules/react-dom/')>=0||id.indexOf('/node_modules/scheduler/')>=0)return 'react-runtime'
  if(id.indexOf('/node_modules/three/')>=0)return 'three-core'
  if(id.indexOf('/node_modules/@react-three/fiber/')>=0)return 'three-fiber'
  if(id.indexOf('/node_modules/@react-three/drei/')>=0)return 'three-drei'
 }}}},
})
