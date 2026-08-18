import {useEffect,useRef} from 'react'
import {useLanguage,type Language} from '../i18n'
import './SettingsPanel.css'

export function SettingsPanel({onClose}:{onClose:()=>void}){
 const {language,setLanguage,t}=useLanguage(),closeRef=useRef<HTMLButtonElement>(null)
 useEffect(()=>{closeRef.current?.focus();const close=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose()};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[onClose])
 const option=(value:Language,label:string,detail:string)=><label className={`settings-language-option ${language===value?'selected':''}`}><input type="radio" name="interface-language" value={value} checked={language===value} onChange={()=>setLanguage(value)}/><span aria-hidden>{language===value?'✓':''}</span><b>{label}</b><small>{detail}</small></label>
 return <div className="settings-backdrop" onMouseDown={event=>{if(event.currentTarget===event.target)onClose()}}><section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title"><header><div><p>{t('settings.general')}</p><h2 id="settings-title">{t('settings.title')}</h2><span>{t('settings.subtitle')}</span></div><button ref={closeRef} type="button" onClick={onClose} aria-label={t('common.close')}>×</button></header><div className="settings-groups"><section className="settings-group"><div className="settings-group-heading"><span className="settings-icon" aria-hidden>文</span><div><h3>{t('settings.language')}</h3><p>{t('settings.languageHint')}</p></div></div><div className="settings-language-options">{option('zh',t('settings.chinese'),'中文')}{option('en',t('settings.english'),'English')}</div></section><section className="settings-group settings-future" aria-disabled="true"><div className="settings-group-heading"><span className="settings-icon" aria-hidden>＋</span><div><h3>{t('settings.future')} <small>{t('common.comingSoon')}</small></h3><p>{t('settings.futureHint')}</p></div></div></section></div></section></div>
}

