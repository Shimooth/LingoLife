export type ResidentVoiceConfig = {
  voice_uri: string
  language: string
  rate: number
  pitch: number
}

export type ResidentVoiceCallbacks = {
  onStart?: () => void
  onEnd?: () => void
  onError?: (reason: 'unsupported' | 'unavailable' | 'timeout') => void
}

export const DEFAULT_RESIDENT_VOICE: ResidentVoiceConfig = {voice_uri: '', language: 'en-US', rate: 1, pitch: 1}

// Web Speech exposes neither age nor gender nor a universal quality score.
// These are ordinary narration voices, not an inference about the resident.
const narrationNames = /^(Samantha|Daniel|Karen|Moira|Tessa|Rishi|Ava|Allison|Susan|Victoria|Tom|Alex|Serena|Oliver|Fiona)(?:\b|$)/i
const characterNames = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Fred|Good News|Grandma|Grandpa|Jester|Junior|Kathy|Organ|Ralph|Superstar|Trinoids|Whisper|Wobble|Zarvox)(?:\b|$)/i
const normalizedLanguage = (language: string) => language.replaceAll('_', '-').toLowerCase()
export function residentVoiceQuality(voice: SpeechSynthesisVoice): 'enhanced' | 'narration' | 'browser' | 'character' | 'standard' {
  if (/premium|enhanced|natural|neural|增强|优质/i.test(`${voice.name} ${voice.voiceURI}`)) return 'enhanced'
  if (characterNames.test(voice.name)) return 'character'
  if (narrationNames.test(voice.name)) return 'narration'
  if (/^Google\b/.test(voice.name)) return 'browser'
  return 'standard'
}

/** Stable, language-aware recommendation; explicit saved URIs always win. */
export function rankResidentVoices(voices: SpeechSynthesisVoice[], language = 'en-US'): SpeechSynthesisVoice[] {
  const requested = normalizedLanguage(language), family = requested.split('-')[0]
  const score = (voice: SpeechSynthesisVoice) => {
    const quality = residentVoiceQuality(voice)
    const qualityScore = {enhanced: 100, narration: 65, browser: 55, standard: 10, character: -100}[quality]
    return qualityScore + (normalizedLanguage(voice.lang) === requested ? 25 : 0) + (voice.localService ? 5 : 0) + (voice.default ? 1 : 0)
  }
  return voices.filter(voice => normalizedLanguage(voice.lang).split('-')[0] === family)
    .filter((voice, index, all) => all.findIndex(other => other.voiceURI === voice.voiceURI) === index)
    .sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name) || a.voiceURI.localeCompare(b.voiceURI))
}

export function resolveResidentVoice(config: ResidentVoiceConfig, voices: SpeechSynthesisVoice[] = listResidentVoices()) {
  const saved = config.voice_uri ? voices.find(voice => voice.voiceURI === config.voice_uri) : undefined
  return {voice: saved ?? rankResidentVoices(voices, config.language)[0], saved: Boolean(saved), missingSavedVoice: Boolean(config.voice_uri && !saved)}
}

export function listResidentVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return []
  return window.speechSynthesis.getVoices()
}

export function subscribeResidentVoices(listener: () => void): () => void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return () => {}
  window.speechSynthesis.addEventListener('voiceschanged', listener)
  return () => window.speechSynthesis.removeEventListener('voiceschanged', listener)
}

/** Call from a user gesture; voice playback never advances or commits game state. */
export function speakResident(text: string, config: ResidentVoiceConfig, callbacks: ResidentVoiceCallbacks = {}): () => void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
    callbacks.onError?.('unsupported')
    return () => {}
  }
  if (!text.trim()) {
    callbacks.onError?.('unavailable')
    return () => {}
  }
  const synthesis = window.speechSynthesis
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = config.language || 'en-US'
  utterance.rate = Math.min(1.4, Math.max(.65, Number.isFinite(config.rate) ? config.rate : .92))
  utterance.pitch = Math.min(1.5, Math.max(.6, Number.isFinite(config.pitch) ? config.pitch : 1))
  let finished = false
  let watchdog: ReturnType<typeof setTimeout> | undefined
  let loadingTimer: ReturnType<typeof setTimeout> | undefined
  let unsubscribe = () => {}
  let started = false
  const cleanup = () => {
    if (watchdog) clearTimeout(watchdog)
    if (loadingTimer) clearTimeout(loadingTimer)
    unsubscribe()
    if (activeSpeech === cancel) activeSpeech = undefined
    utterance.onstart = null
    utterance.onend = null
    utterance.onerror = null
  }
  const finish = (error?: 'unavailable' | 'timeout') => {
    if (finished) return
    finished = true
    cleanup()
    if (error) callbacks.onError?.(error)
    else callbacks.onEnd?.()
  }
  utterance.onstart = () => { if (!finished) callbacks.onStart?.() }
  utterance.onend = () => finish()
  utterance.onerror = () => finish('unavailable')
  const cancel = () => {
    if (finished) return
    const ownsPlayback = activeSpeech === cancel
    finished = true
    cleanup()
    if (ownsPlayback) synthesis.cancel()
  }
  activeSpeech?.()
  activeSpeech = cancel
  const begin = () => {
    if (finished || started) return
    started = true
    if (loadingTimer) clearTimeout(loadingTimer)
    unsubscribe()
    const selected = resolveResidentVoice(config, synthesis.getVoices()).voice
    if (selected) { utterance.voice = selected; utterance.lang = selected.lang }
    synthesis.cancel()
    try {
      synthesis.speak(utterance)
      if (!finished) watchdog = setTimeout(() => {
        // Cancel this utterance before invoking callbacks that might start another.
        synthesis.cancel()
        finish('timeout')
      }, Math.max(20000, Math.min(60000, text.length * 140)))
    } catch { finish('unavailable') }
  }
  const ready = () => {
    const available = synthesis.getVoices()
    return available.length > 0 && (!config.voice_uri || available.some(voice => voice.voiceURI === config.voice_uri))
  }
  if (ready()) begin()
  else {
    // Chrome loads browser and installed voices in separate events. Give a
    // saved voice time to arrive before temporarily falling back on this device.
    unsubscribe = subscribeResidentVoices(() => { if (ready()) begin() })
    loadingTimer = setTimeout(begin, 1600)
    if (ready()) begin()
  }
  return cancel
}

let activeSpeech: (() => void) | undefined
