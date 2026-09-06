import { useEffect, useState } from 'react'
import type { AvatarConfig } from '../types'
import { getCharacterPreset } from '../three/characters/characterAssets'
import { getCharacterPortrait, portraitKey } from '../three/characters/characterPortrait'

export function CharacterPortrait({ avatar, live = false }: { avatar: AvatarConfig; live?: boolean }) {
  const key = portraitKey(avatar)
  const [rendered, setRendered] = useState<{ key: string; url: string }>()
  const [failed, setFailed] = useState<string>()
  useEffect(() => {
    if (!live) return
    let active = true
    getCharacterPortrait(avatar).then(url => { if (active) setRendered({ key, url }) }).catch(() => { /* Keep the pre-rendered model portrait when WebGL is unavailable. */ })
    return () => { active = false }
  }, [avatar, key, live])
  const url = rendered?.key === key ? rendered.url : `/assets/portraits/characters/${getCharacterPreset(avatar.model).id}.webp`
  return <span className="character-portrait" aria-hidden="true">
    {failed !== url ? <img src={url} alt="" width={216} height={256} loading="lazy" decoding="async" onError={() => setFailed(url)} /> : <span className="character-portrait__fallback">♙</span>}
  </span>
}
