import { useContext, useLayoutEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { ACESFilmicToneMapping, PCFShadowMap, SRGBColorSpace } from 'three'
import { advanceQuality, initialQuality, STUDIO_LOOK, VISUAL_BUDGETS, type QualityMode, type VisualTier } from './visualQuality'
import {VisualQualityContext} from './VisualQualityContext'

export function SceneLook({ exposure = STUDIO_LOOK.exposure }: { exposure?: number }) {
  const gl = useThree(state => state.gl)
  useLayoutEffect(() => {
    const previous = { tone: gl.toneMapping, exposure: gl.toneMappingExposure, color: gl.outputColorSpace, shadow: gl.shadowMap.type }
    gl.toneMapping = ACESFilmicToneMapping
    gl.toneMappingExposure = exposure
    gl.outputColorSpace = SRGBColorSpace
    gl.shadowMap.type = PCFShadowMap
    return () => { gl.toneMapping = previous.tone; gl.toneMappingExposure = previous.exposure; gl.outputColorSpace = previous.color; gl.shadowMap.type = previous.shadow }
  }, [gl, exposure])
  return null
}

/** Shared soft miniature studio rig. No remote HDR, bloom, veil or scene background. */
export function SceneLighting({ portrait = false }: { portrait?: boolean }) {
  return <>
    <ambientLight intensity={STUDIO_LOOK.ambient} color="#fff5e9" />
    <hemisphereLight args={[STUDIO_LOOK.fillColor, STUDIO_LOOK.groundColor, STUDIO_LOOK.hemisphere]} />
    <directionalLight position={[-3.5, 8, 5]} intensity={STUDIO_LOOK.key} color={STUDIO_LOOK.keyColor} castShadow
      shadow-mapSize={[1024, 1024]} shadow-camera-left={-7} shadow-camera-right={7} shadow-camera-top={7} shadow-camera-bottom={-7}
      shadow-camera-near={.5} shadow-camera-far={26} shadow-bias={-.00015} shadow-normalBias={.025} shadow-radius={4} shadow-intensity={.8} />
    <directionalLight position={[5, 3, 3]} intensity={STUDIO_LOOK.fill} color={STUDIO_LOOK.fillColor} />
    {portrait&&<directionalLight position={[0,2,7]} intensity={.65} color="#fff4e4"/>}
    <directionalLight position={[1, 5, -4]} intensity={portrait ? .9 : .45} color="#ffdfb2" />
  </>
}

export function AdaptiveResolution({ mode: requestedMode, paused = false, onTier }: { mode?: QualityMode; paused?: boolean; onTier?: (tier: VisualTier) => void }) {
  const preferredMode=useContext(VisualQualityContext)
  const mode=requestedMode??preferredMode
  const setDpr = useThree(state => state.setDpr)
  const gl = useThree(state => state.gl)
  const history = useRef(initialQuality(mode))
  const samples = useRef<number[]>([])
  const elapsed = useRef(0)
  const warmup = useRef(3)
  useLayoutEffect(() => {
    history.current = initialQuality(mode); samples.current = []; elapsed.current = 0; warmup.current = 3
    setDpr(Math.min(window.devicePixelRatio || 1, VISUAL_BUDGETS[history.current.tier].dpr))
    onTier?.(history.current.tier)
    gl.domElement.dataset.visualTier = String(history.current.tier)
  }, [mode, onTier, setDpr, gl])
  useFrame((_, delta) => {
    if (paused || mode !== 'auto' || document.hidden || delta > .2) { samples.current = []; elapsed.current = 0; return }
    if (warmup.current > 0) { warmup.current -= delta; return }
    samples.current.push(delta * 1000); elapsed.current += delta
    if (elapsed.current < 2 || samples.current.length < 20) return
    const ordered = samples.current.sort((a, b) => a - b)
    const p90 = ordered[Math.floor((ordered.length - 1) * .9)]
    const previous = history.current.tier
    history.current = advanceQuality(history.current, p90)
    samples.current = []; elapsed.current = 0
    // Exposed only as non-sensitive rendering diagnostics, not persisted or sent.
    gl.domElement.dataset.frameP90 = p90.toFixed(1)
    if (previous === history.current.tier) return
    setDpr(Math.min(window.devicePixelRatio || 1, VISUAL_BUDGETS[history.current.tier].dpr))
    gl.domElement.dataset.visualTier = String(history.current.tier)
    onTier?.(history.current.tier)
  })
  return null
}
