import type { AvatarConfig } from '../types'
import type { Language } from '../i18n'
import { CHARACTER_PRESETS, getCharacterPreset } from '../three/characters/characterAssets'
import { CharacterPortrait } from './CharacterPortrait'
import './CharacterModelPicker.css'

export function CharacterModelPicker({ avatar, language, onChange }: { avatar: AvatarConfig; language: Language; onChange: (model: string) => void }) {
  const selected = getCharacterPreset(avatar.model).id
  return <div className="character-model-picker" role="group" aria-label={language === 'zh' ? '选择角色外观' : 'Choose an appearance'}>
    {CHARACTER_PRESETS.map(preset => <button type="button" key={preset.id} aria-pressed={selected === preset.id} className={selected === preset.id ? 'is-selected' : ''} onClick={() => onChange(preset.id)}>
      <CharacterPortrait avatar={{ ...avatar, model: preset.id }} />
      <span>{preset.label[language]}</span>
      <small>{preset.family === 'chibi' ? (language === 'zh' ? '可搭配换装' : 'Mix & match') : (language === 'zh' ? '完整造型' : 'Complete outfit')}</small>
      {selected === preset.id && <i aria-hidden="true">✓</i>}
    </button>)}
  </div>
}
