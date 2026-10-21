import {useCallback, useEffect, useRef, useState} from 'react'
import type {CSSProperties} from 'react'
import {useReducedMotion} from 'motion/react'
import type {ArrivalDraft, ArrivalState} from '../arrival/types'
import {DEFAULT_PERSONALITY, PERSONALITY_AXES, describePersonality, normalizePersonality, residentIntroduction} from '../arrival/personality'
import {AVATAR_HAIR_COLORS, AVATAR_OUTFIT_COLORS, AVATAR_SKIN_COLORS, defaultAvatar} from '../avatar'
import {speakResident} from '../audio/residentVoice'
import {ResidentVoicePicker} from './ResidentVoicePicker'
import {normalizeNpcProfilePolicy, withProfileAge} from '../profilePolicy'
import type {AvatarConfig, NpcProfile} from '../types'
import {CharacterCanvas3D} from '../three/characters'
import type {CharacterMotion} from '../three/characters/types'
import {CHIBI_ACCESSORIES, CHIBI_HAIR, CHIBI_OUTFITS, getCharacterFamily, resolveChibiAccessory, resolveChibiHair, resolveChibiOutfit} from '../three/characters/characterAssets'
import {CharacterModelPicker} from './CharacterModelPicker'
import './ArrivalCreator.css'

type Props = {
  state: ArrivalState
  language: 'zh' | 'en'
  saving: boolean
  error: string
  onSaveDraft: (draft: ArrivalDraft) => Promise<void>
  onCreate: (draft: ArrivalDraft) => Promise<void>
}
const STEPS = ['appearance', 'voice', 'personality', 'personality_review', 'introduction', 'manager'] as const
type Step = typeof STEPS[number]
type SaveStatus = 'unsaved' | 'saving' | 'saved' | 'error'

function initialDraft(state: ArrivalState): ArrivalDraft {
  if (state.draft) return {...state.draft, personality: normalizePersonality(state.draft.personality)}
  return {
    step: 'appearance',
    profile: {
      name: '小晴', age: 24, relationship: '新邻居', occupation: '自由职业者',
      personality: describePersonality(DEFAULT_PERSONALITY).traits, interests: ['散步', '音乐'],
      likes: [], dislikes: [], quirks: [], habits: [], boundaries: [], longTermGoal: '在这里找到舒服的生活节奏，认识值得信任的朋友。',
      householdRole: 'free_spirit', chorePreferences: ['cleaning'], privateSpacePreference: 'balanced',
      romanceEnabled: true, familyIds: [], familyRelations: [], householdWithIds: [], shared_history_hooks: [], relationshipBoundaries: [],
      avatar: {...defaultAvatar, model: 'chibi'},
    },
    voice: {voice_uri: '', language: 'en-US', rate: .92, pitch: 1},
    personality: {...DEFAULT_PERSONALITY},
    manager: state.manager ?? {name: '', birthday_month: null, birthday_day: null},
  }
}

function preparedDraft(draft: ArrivalDraft): ArrivalDraft {
  const personality = normalizePersonality(draft.personality)
  return {...draft, personality, profile: normalizeNpcProfilePolicy({
    ...draft.profile, name: draft.profile.name.trim(),
    occupation: draft.profile.occupation.trim() || '自由职业者',
    interests: draft.profile.interests.length ? draft.profile.interests : ['散步', '音乐'],
    personality: describePersonality(personality).traits,
  })}
}

export function ArrivalCreator({state, language, saving, error, onSaveDraft, onCreate}: Props) {
  const zh = language === 'zh', reducedMotion = Boolean(useReducedMotion())
  const [draft, setDraft] = useState<ArrivalDraft>(() => initialDraft(state))
  const [interestsText, setInterestsText] = useState(() => initialDraft(state).profile.interests.join('，'))
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(state.draft ? 'saved' : 'unsaved')
  const [localError, setLocalError] = useState('')
  const [transitioning, setTransitioning] = useState(false)
  const [creating, setCreating] = useState(false)
  const [voiceStatus, setVoiceStatus] = useState<'idle' | 'speaking' | 'error'>('idle')
  const [previewMotion, setPreviewMotion] = useState<CharacterMotion>('idle')
  const [previewTake, setPreviewTake] = useState(0)
  const draftRef = useRef(draft)
  const editVersion = useRef(0)
  const lastSaved = useRef(state.draft ? JSON.stringify(draft) : '')
  const saveCallback = useRef(onSaveDraft)
  const stopVoice = useRef<() => void>(() => {})
  const mounted = useRef(true)
  const busyRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const busy = transitioning || creating
  const step: Step = STEPS.includes(draft.step as Step) ? draft.step as Step : 'appearance'
  const stepIndex = STEPS.indexOf(step)
  const portrait = describePersonality(draft.personality)
  const intro = residentIntroduction(draft.profile.name, draft.personality)
  const chibi = getCharacterFamily(draft.profile.avatar) === 'chibi'
  const progress = step === 'appearance' ? 0 : step === 'voice' ? 1 : step === 'personality' || step === 'personality_review' ? 2 : 3
  const visibleError = localError || error

  useEffect(() => { saveCallback.current = onSaveDraft }, [onSaveDraft])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; stopVoice.current(); if (timerRef.current) clearTimeout(timerRef.current) }
  }, [])
  // The server may echo an older autosave while the user is still editing.
  // A mounted editing session owns its local draft; a refresh starts from state.draft.
  const edit = (update: (current: ArrivalDraft) => ArrivalDraft) => {
    if (busyRef.current) return
    const next = update(draftRef.current)
    editVersion.current += 1
    draftRef.current = next
    setDraft(next)
    setSaveStatus('unsaved')
    setLocalError('')
  }
  const persist = useCallback(async (snapshot: ArrivalDraft) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    const version = editVersion.current
    if (JSON.stringify(snapshot) === lastSaved.current) return true
    setSaveStatus('saving')
    try {
      await saveCallback.current(snapshot)
      if (!mounted.current) return false
      lastSaved.current = JSON.stringify(snapshot)
      if (version === editVersion.current) setSaveStatus('saved')
      return true
    } catch {
      if (mounted.current && version === editVersion.current) setSaveStatus('error')
      return false
    }
  }, [])
  useEffect(() => {
    if (busy || !draft.profile.name.trim() || JSON.stringify(draft) === lastSaved.current) return
    timerRef.current = setTimeout(() => { void persist(draft) }, 850)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [draft, busy, persist])

  const changeProfile = (update: (profile: NpcProfile) => NpcProfile) => edit(current => ({...current, profile: update(current.profile)}))
  const changeAvatar = (key: keyof AvatarConfig, value: string) => changeProfile(profile => ({...profile, avatar: {...profile.avatar, [key]: value, strokes: []}}))
  const silence = () => { stopVoice.current(); setVoiceStatus('idle'); setPreviewMotion('idle') }
  const playVoice = (introduction = false, source = draftRef.current) => {
    stopVoice.current()
    setVoiceStatus('speaking')
    setPreviewMotion('talk')
    setPreviewTake(value => value + 1)
    const text = introduction ? residentIntroduction(source.profile.name, source.personality).en
      : `Hi, I'm ${source.profile.name.trim() || 'your new neighbor'}. It's lovely to meet you.`
    stopVoice.current = speakResident(text, source.voice, {
      onStart: () => { if (mounted.current) { setVoiceStatus('speaking'); setPreviewMotion('talk') } },
      onEnd: () => { if (mounted.current) { setVoiceStatus('idle'); setPreviewMotion('idle') } },
      onError: () => { if (mounted.current) { setVoiceStatus('error'); setPreviewMotion('idle') } },
    })
  }
  const changeVoice = (update: Partial<ArrivalDraft['voice']>) => {
    silence()
    edit(current => ({...current, voice: {...current.voice, ...update}}))
  }
  const advance = async (next: Step) => {
    if (busyRef.current) return
    if (!draftRef.current.profile.name.trim()) { setLocalError(zh ? '先为这位居民取个名字吧。' : 'Give your resident a name first.'); return }
    silence()
    const snapshot = preparedDraft({...draftRef.current, step: next})
    edit(() => snapshot)
    busyRef.current = true
    setTransitioning(true)
    if (next === 'introduction') playVoice(true, snapshot)
    await persist(snapshot)
    if (mounted.current) { busyRef.current = false; setTransitioning(false) }
  }
  const create = async () => {
    if (busyRef.current) return
    const snapshot = preparedDraft(draftRef.current)
    snapshot.manager = {...snapshot.manager, name: snapshot.manager.name.trim()}
    if (!snapshot.manager.name) { setLocalError(zh ? '告诉我该怎么称呼你吧。' : 'Tell me what I should call you.'); return }
    const {birthday_month: month, birthday_day: day} = snapshot.manager
    if ((month === null) !== (day === null) || (month !== null && day !== null && (month < 1 || month > 12 || day < 1 || day > new Date(2000, month, 0).getDate()))) {
      setLocalError(zh ? '生日请填完整的月份和日期，也可以暂时留空。' : 'Enter both a valid month and day, or leave both blank.'); return
    }
    silence()
    busyRef.current = true
    setCreating(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    try {
      if (!await persist(snapshot)) return
      await onCreate(snapshot)
    } catch (cause) {
      if (mounted.current) setLocalError(cause instanceof Error ? cause.message : (zh ? '暂时没能完成入住，请再试一次。' : 'The move could not be completed. Please try again.'))
    } finally {
      if (mounted.current) { busyRef.current = false; setCreating(false) }
    }
  }
  const swatches = (title: string, field: keyof AvatarConfig, colors: readonly string[]) => <fieldset className="arrival-creator__swatches"><legend>{title}</legend><div>{colors.map((color, index) => <button type="button" key={color} aria-label={`${title} ${index + 1}`} aria-pressed={draft.profile.avatar[field] === color} style={{backgroundColor: color}} onClick={() => changeAvatar(field, color)}>{draft.profile.avatar[field] === color ? '✓' : ''}</button>)}</div></fieldset>
  const saveLabel = creating ? (zh ? '正在办理入住' : 'Moving in') : saving || saveStatus === 'saving' ? (zh ? '正在保存' : 'Saving') : saveStatus === 'saved' ? (zh ? '草稿已保存' : 'Draft saved') : saveStatus === 'error' ? (zh ? '保存失败 · 点击重试' : 'Save failed · Retry') : (zh ? '等待保存' : 'Unsaved changes')
  const titles: Record<Step, [string, string, string, string]> = {
    appearance: ['你好，新邻居。', 'Hello, new neighbor.', '先从一个合眼缘的模样开始。', 'Start with a look that feels like them.'],
    voice: ['听听你的声音。', 'A voice of their own.', '一句简单的招呼，也有自己的温度。', 'Even a little hello can feel personal.'],
    personality: ['你会怎样生活？', 'How will they see the world?', '没有正确答案，跟着你的感觉选择。', 'There are no right answers. Follow your feeling.'],
    personality_review: ['原来是这样的你。', 'So this is who you are.', '看看这份第一印象，合不合你的心意。', 'Does this first impression feel like them?'],
    introduction: ['正式认识一下。', 'Let’s meet properly.', '属于这里的故事，从这一声你好开始。', 'Their story here starts with a little hello.'],
    manager: ['以后怎么称呼你？', 'What should I call you?', '现在，也让我认识一下你吧。', 'Now, let me get to know you a little.'],
  }

  return <main className="arrival-creator" data-arrival-step={step} data-reduced-motion={reducedMotion}>
    <header className="arrival-creator__topbar"><a className="arrival-creator__brand" href="#" onClick={event => event.preventDefault()}>LingoLife<span>little lives, lovely stories</span></a><button className="arrival-creator__save" type="button" data-status={saving ? 'saving' : saveStatus} onClick={() => { if (saveStatus === 'error' || saveStatus === 'unsaved') void persist(draftRef.current) }} disabled={saveStatus === 'saving' || saving || busy} aria-live="polite"><span aria-hidden="true">{saving || saveStatus === 'saving' ? '◌' : saveStatus === 'saved' ? '✓' : saveStatus === 'error' ? '↻' : '·'}</span>{saveLabel}</button></header>
    <ol className="arrival-creator__progress" aria-label={zh ? '创建进度' : 'Creation progress'}>{(zh ? ['模样', '声音', '性格', '初次见面'] : ['Appearance', 'Voice', 'Personality', 'First hello']).map((label, index) => <li key={label} data-current={index === progress} data-complete={index < progress} aria-current={index === progress ? 'step' : undefined}><span>{index < progress ? '✓' : index + 1}</span>{label}</li>)}</ol>
    <section className="arrival-creator__workspace">
      <aside className="arrival-creator__stage">
        <div className="arrival-creator__stage-caption"><span>{zh ? '一个新故事，即将开始' : 'A new little story is about to begin'}</span><span aria-hidden="true">✧</span></div>
        <div className="arrival-creator__halo" aria-hidden="true"/>
        <CharacterCanvas3D avatar={draft.profile.avatar} name={draft.profile.name || 'Resident'} animation={previewMotion} animationKey={previewTake} staticPreview={reducedMotion} socialPerformance={{speaking: voiceStatus === 'speaking', enabled: !reducedMotion, intensity: .65}} faceSpeaking={voiceStatus === 'speaking'} view="full" className="arrival-creator__character"/>
        <div className="arrival-creator__nametag"><span>{zh ? '很高兴认识你' : 'Lovely to meet you'}</span><strong>{draft.profile.name || (zh ? '新邻居' : 'New neighbor')}</strong><small>{stepIndex >= 3 ? portrait.name[language] : (zh ? '让日常多一点故事' : 'A little more story in every day')}</small></div>
        {step === 'appearance' && <div className="arrival-creator__stage-actions">{([{id: 'idle', zh: '站一站', en: 'Stand'}, {id: 'walk', zh: '走两步', en: 'Walk'}, {id: 'happy', zh: '打个招呼', en: 'Say hello'}] as const).map(item => <button type="button" key={item.id} aria-pressed={previewMotion === item.id} disabled={reducedMotion} onClick={() => {setPreviewMotion(item.id); setPreviewTake(value => value + 1)}}>{item[language]}</button>)}</div>}
        {(step === 'introduction' || step === 'manager') && <div className="arrival-creator__speech"><span aria-hidden="true">“</span><p>{step === 'manager' ? (zh ? '我该怎么称呼你呢？' : 'What should I call you?') : intro.en}</p>{step === 'introduction' && <small lang="zh">{intro.zh}</small>}</div>}
      </aside>

      <section className="arrival-creator__editor" aria-labelledby="arrival-title">
        <header><p className="arrival-creator__eyebrow">{String(stepIndex + 1).padStart(2, '0')} / 06 · {zh ? '初次相遇' : 'FIRST ENCOUNTER'}</p><h1 id="arrival-title">{titles[step][zh ? 0 : 1]}</h1><p>{titles[step][zh ? 2 : 3]}</p></header>
        <fieldset className="arrival-creator__body" disabled={busy}>
          {step === 'appearance' && <>
            <div className="arrival-creator__identity"><label>{zh ? '名字' : 'Name'}<input name="resident-name" autoComplete="off" maxLength={24} value={draft.profile.name} onChange={event => changeProfile(profile => ({...profile, name: event.target.value.replace(/[^\p{L}\p{N} _'-]/gu, '')}))}/></label><label>{zh ? '年龄' : 'Age'}<input type="number" min={16} max={100} value={draft.profile.age ?? 24} onChange={event => changeProfile(profile => withProfileAge(profile, Math.max(16, Math.min(100, Number(event.target.value) || 16))))}/></label></div>
            <div className="arrival-creator__model"><h2>{zh ? '选一个模样' : 'Choose a look'}</h2><CharacterModelPicker avatar={draft.profile.avatar} language={language} onChange={model => changeAvatar('model', model)}/></div>
            {chibi && <><fieldset className="arrival-creator__options"><legend>{zh ? '发型' : 'Hair'}</legend><div>{CHIBI_HAIR.map(option => <button type="button" key={option.id} aria-pressed={resolveChibiHair(draft.profile.avatar.hair) === option.id} onClick={() => changeAvatar('hair', option.id)}>{option.label[language]}</button>)}</div></fieldset><fieldset className="arrival-creator__options"><legend>{zh ? '穿搭' : 'Outfit'}</legend><div>{CHIBI_OUTFITS.map(option => <button type="button" key={option.id} aria-pressed={resolveChibiOutfit(draft.profile.avatar.outfit) === option.id} onClick={() => changeAvatar('outfit', option.id)}>{option.label[language]}</button>)}</div></fieldset><fieldset className="arrival-creator__options"><legend>{zh ? '配饰' : 'Accessory'}</legend><div>{CHIBI_ACCESSORIES.map(option => <button type="button" key={option.id} aria-pressed={resolveChibiAccessory(draft.profile.avatar.accessory) === option.id} onClick={() => changeAvatar('accessory', option.id)}>{option.label[language]}</button>)}</div></fieldset>{swatches(zh ? '肤色' : 'Skin tone', 'skin', AVATAR_SKIN_COLORS)}{swatches(zh ? '衣服颜色' : 'Outfit color', 'outfitColor', AVATAR_OUTFIT_COLORS)}</>}
            {swatches(zh ? '发色' : 'Hair color', 'hairColor', AVATAR_HAIR_COLORS)}
            <details className="arrival-creator__optional"><summary>{zh ? '再添一点生活细节（选填）' : 'A few everyday details (optional)'}</summary><label>{zh ? '职业' : 'Occupation'}<input maxLength={48} value={draft.profile.occupation} onChange={event => changeProfile(profile => ({...profile, occupation: event.target.value}))}/></label><label>{zh ? '兴趣，用逗号分隔' : 'Interests, separated by commas'}<input maxLength={160} value={interestsText} onChange={event => { const value = event.target.value; setInterestsText(value); const interests = value.split(/[,，]/).map(item => item.trim()).filter(Boolean).slice(0, 5); changeProfile(profile => ({...profile, interests: interests.length ? interests : ['散步', '音乐']})) }}/></label></details>
          </>}

          {step === 'voice' && <>
            <div className="arrival-creator__quote"><span>“</span><p>Hi, I'm {draft.profile.name}.<br/>It's lovely to meet you.</p><small>{zh ? '你好，我是' + draft.profile.name + '。很高兴认识你。' : 'A little hello, in their own voice.'}</small></div>
            <ResidentVoicePicker value={draft.voice} onChange={changeVoice} language={language} previewText={`Hi, I'm ${draft.profile.name.trim() || 'your new neighbor'}. It's lovely to meet you.`} onPreviewStateChange={status=>{setVoiceStatus(status);setPreviewMotion(status==='speaking'?'talk':'idle')}}/>
          </>}

          {step === 'personality' && <div className="arrival-creator__personality">{PERSONALITY_AXES.map(axis => <label className="arrival-creator__range" key={axis.key}><span>{axis.label[language]}<output>{draft.personality[axis.key]}</output></span><input type="range" min={0} max={100} step={5} value={draft.personality[axis.key]} onChange={event => edit(current => { const personality = {...current.personality, [axis.key]: Number(event.target.value)}; return {...current, personality, profile: {...current.profile, personality: describePersonality(personality).traits}} })}/><small><span>{axis.low[language]}</span><span>{axis.high[language]}</span></small></label>)}</div>}

          {step === 'personality_review' && <article className="arrival-creator__personality-card" style={{'--personality-color': portrait.color} as CSSProperties}><div className="arrival-creator__personality-seal" aria-hidden="true">✧</div><p>{portrait.group[language]}</p><h2>{portrait.name[language]}</h2><div className="arrival-creator__traits">{portrait.traitLabels[language].map(trait => <span key={trait}>{trait}</span>)}</div><hr/><small>{zh ? '第一印象' : 'FIRST IMPRESSION'}</small><p>{portrait.impression[language]}</p><small>{zh ? '相处之后，你会发现' : 'AS YOU GET TO KNOW THEM'}</small><p>{portrait.description[language]}</p><footer>{zh ? '这只是故事的起点。之后的经历，也会让这个人慢慢成长。' : 'This is a starting point. Their experiences will help them grow.'}</footer></article>}

          {step === 'introduction' && <div className="arrival-creator__introduction"><span className="arrival-creator__greeting" aria-hidden="true">✺</span><p>{zh ? '我已经准备好开始新生活了。' : 'I’m ready for a new chapter.'}</p><span>{zh ? '这里会发生什么，我们一起慢慢发现。' : 'Let’s find out what everyday life has in store.'}</span><button className="arrival-creator__listen" type="button" onClick={() => voiceStatus === 'speaking' ? silence() : playVoice(true)}>{voiceStatus === 'speaking' ? (zh ? 'Ⅱ 停止播放' : 'Ⅱ Stop') : (zh ? '▷ 再听一次自我介绍' : '▷ Hear the introduction again')}</button><small>{zh ? '随时可以继续，声音不会阻挡入住。' : 'Continue whenever you like. Audio is optional.'}</small></div>}

          {step === 'manager' && <div className="arrival-creator__manager"><label>{zh ? '我可以叫你…' : 'I can call you…'}<input name="manager-name" maxLength={24} autoComplete="nickname" placeholder={zh ? '你希望居民怎样称呼你' : 'The name your neighbors will use'} value={draft.manager.name} onChange={event => edit(current => ({...current, manager: {...current.manager, name: event.target.value}}))}/></label><fieldset className="arrival-creator__birthday"><legend>{zh ? '生日（选填）' : 'Birthday (optional)'}</legend><div><label><span>{zh ? '月份' : 'Month'}</span><select value={draft.manager.birthday_month ?? ''} onChange={event => edit(current => ({...current, manager: {...current.manager, birthday_month: event.target.value ? Number(event.target.value) : null, birthday_day: null}}))}><option value="">{zh ? '选择月份' : 'Month'}</option>{Array.from({length: 12}, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}{zh ? ' 月' : ''}</option>)}</select></label><label><span>{zh ? '日期' : 'Day'}</span><select value={draft.manager.birthday_day ?? ''} disabled={!draft.manager.birthday_month} onChange={event => edit(current => ({...current, manager: {...current.manager, birthday_day: event.target.value ? Number(event.target.value) : null}}))}><option value="">{zh ? '选择日期' : 'Day'}</option>{Array.from({length: draft.manager.birthday_month ? new Date(2000, draft.manager.birthday_month, 0).getDate() : 31}, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label></div></fieldset><p className="arrival-creator__hint">{zh ? '生日只需月和日，不需要填写年份。' : 'Just the month and day. No year needed.'}</p><div className="arrival-creator__ready"><span aria-hidden="true">⌂</span><p>{zh ? '一位居民，一个新开始。' : 'One neighbor. A fresh beginning.'}<small>{zh ? '接下来，一起看看这位新邻居的第一天。' : 'Next, share a little of their very first day.'}</small></p></div></div>}
        </fieldset>
        {voiceStatus === 'error' && <p className="arrival-creator__audio-fallback" role="status">{zh ? '这次没能播放声音。可以重试，也可以直接继续。' : 'Audio could not play this time. Try again or continue.'}</p>}
        {visibleError && <p className="arrival-creator__error" role="alert">{visibleError}</p>}
        {saveStatus === 'error' && <p className="arrival-creator__error" role="status">{zh ? '草稿还没有保存成功，请点击右上角重试。' : 'Your draft is not saved yet. Retry using the save button above.'}</p>}
        <footer className="arrival-creator__footer"><button type="button" className="arrival-creator__back" disabled={busy || stepIndex === 0} onClick={() => void advance(STEPS[Math.max(0, stepIndex - 1)])}>{zh ? '返回' : 'Back'}</button><button type="button" className="arrival-creator__next" disabled={busy || (step === 'manager' && saving)} onClick={() => step === 'manager' ? void create() : void advance(STEPS[stepIndex + 1])}>{creating ? (zh ? '正在安置居民…' : 'Moving in…') : step === 'manager' ? (zh ? '一起开始新生活' : 'Let’s begin') : step === 'personality' ? (zh ? '看看这个人的性格' : 'Meet their personality') : step === 'personality_review' ? (zh ? '就是这样的你' : 'That feels like them') : step === 'introduction' ? (zh ? '继续认识彼此' : 'A little about you') : (zh ? '继续' : 'Continue')}<span aria-hidden="true">→</span></button></footer>
      </section>
    </section>
  </main>
}

export default ArrivalCreator
