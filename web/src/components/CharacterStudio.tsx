import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { NpcProfile } from "../types";
import {isAdultProfile,ROMANCE_ADULT_AGE,romanceIsEnabled,withProfileAge,withRomancePreference} from "../profilePolicy";
import { CharacterCanvas3D } from "../three/characters";
import {
  CHARACTER_PRESETS,
  CHIBI_ACCESSORIES,
  CHIBI_HAIR,
  CHIBI_MODEL_ID,
  CHIBI_OUTFITS,
  getCharacterFamily,
  resolveChibiAccessory,
  resolveChibiHair,
  resolveChibiOutfit,
} from "../three/characters/characterAssets";
const skinTones=["#f7d7c4","#efb99b","#d99772","#b87352","#8b533b","#57372f"]
const split = (value: string, max: number) =>
  value
    .split(/[,，]/)
    .map((x) => x.trim())
    .slice(0, max);
export function CharacterStudio({
  profile,
  onChange,
  onSave,
  onClose,
  saving,
  error,
  language = "zh",
  relationshipCandidates = [],
  editingNpcId,
}: {
  profile: NpcProfile;
  onChange: (p: NpcProfile) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
  error: string;
  language?: "zh" | "en";
  relationshipCandidates?: { id: string; name: string }[];
  editingNpcId?: string;
}) {
  const reduce = useReducedMotion(),
    [tab, setTab] = useState<"story" | "relationships" | "look">("story"),
    zh = language === "zh";
  const characterFamily = getCharacterFamily(profile.avatar);
  const adult=isAdultProfile(profile),romanceEnabled=romanceIsEnabled(profile);
  const relationshipOptions=Array.from(new Map(relationshipCandidates
    .filter(candidate=>candidate.id!==editingNpcId)
    .map(candidate=>[candidate.id,candidate])).values());
  const familyIds=Array.from(new Set((profile.familyIds??[]).filter(id=>id&&id!==editingNpcId))).slice(0,4);
  const set = <K extends keyof NpcProfile>(key: K, value: NpcProfile[K]) =>
    onChange({ ...profile, [key]: value });
  const avatar = (key: string, value: string) =>
    set("avatar", { ...profile.avatar, [key]: value, strokes: [] });
  return (
    <motion.div
      className="studio-backdrop"
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <section className="studio" role="dialog" aria-modal="true">
        <header>
          <div>
            <p className="eyebrow">
              {zh ? "NPC 角色工作室" : "NPC agent studio"}
            </p>
            <h2>
              {zh ? "创造一个值得了解的人" : "Create someone worth knowing"}
            </h2>
          </div>
          <button onClick={onClose}>×</button>
        </header>
        <div className="studio-layout">
          <div className="studio-preview">
            <CharacterCanvas3D avatar={profile.avatar} animation="happy" view="full" name={profile.name} />
            <strong>{profile.name || (zh ? "角色" : "Character")}</strong>
            <span>
              {profile.relationship} · {profile.occupation}
            </span>
          </div>
          <div className="studio-editor">
            <nav>
              {(["story", "relationships", "look"] as const).map((x) => (
                <button
                  className={tab === x ? "active" : ""}
                  onClick={() => setTab(x)}
                  key={x}
                >
                  {x === "story"
                    ? zh ? "身份设定" : "Identity"
                    : x === "relationships"
                      ? zh ? "关系与居住" : "Relationships"
                      : zh ? "外观" : "Appearance"}
                </button>
              ))}
            </nav>
            <AnimatePresence mode="wait">
              <motion.div
                className="studio-fields"
                key={tab}
                initial={reduce ? false : { opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
              >
                {tab === "story" ? (
                  <>
                    <label>
                      {zh ? "名字" : "Name"}
                      <input
                        maxLength={24}
                        value={profile.name}
                        onChange={(e) =>
                          set(
                            "name",
                            e.target.value.replace(/[^\p{L}\p{N} _'-]/gu, ""),
                          )
                        }
                      />
                    </label>
                    <div className="field-grid">
                      <label>
                        {zh ? "年龄" : "Age"}
                        <input
                          type="number"
                          min={16}
                          max={100}
                          value={profile.age??''}
                          onChange={(e) => onChange(withProfileAge(profile,e.target.value ? Math.max(16,Math.min(100,Number(e.target.value))) : null))}
                        />
                      </label>
                      <label>
                        {zh ? "关系（自由填写）" : "Relationship (custom)"}
                        <input
                          maxLength={32}
                          value={profile.relationship}
                          onChange={(e) => set("relationship", e.target.value)}
                        />
                      </label>
                      <label>
                        {zh ? "职业（自由填写）" : "Occupation (custom)"}
                        <input
                          maxLength={48}
                          value={profile.occupation}
                          onChange={(e) => set("occupation", e.target.value)}
                        />
                      </label>
                    </div>
                    <label>
                      {zh
                        ? "性格（逗号分隔，最多4项）"
                        : "Personality (comma-separated, up to 4)"}
                      <input
                        value={profile.personality.join(", ")}
                        onChange={(e) =>
                          set("personality", split(e.target.value, 4))
                        }
                      />
                    </label>
                    <label>
                      {zh
                        ? "兴趣（逗号分隔，最多5项）"
                        : "Interests (comma-separated, up to 5)"}
                      <input
                        value={profile.interests.join(", ")}
                        onChange={(e) =>
                          set("interests", split(e.target.value, 5))
                        }
                      />
                    </label>
                    <label>
                      {zh ? "长期目标" : "Long-term dream"}
                      <textarea
                        maxLength={180}
                        rows={3}
                        value={profile.longTermGoal}
                        onChange={(e) => set("longTermGoal", e.target.value)}
                      />
                    </label>
                  </>
                ) : tab === "relationships" ? (
                  <>
                    <section className="studio-relationship-card" aria-labelledby="studio-household-title">
                      <div className="studio-relationship-card__heading">
                        <div>
                          <b id="studio-household-title">{zh?'居住安排':'Living arrangement'}</b>
                          <small>{zh?'这座城市的所有居民都住在同一套共享住宅。':'Everyone in your city lives together in one shared residence.'}</small>
                        </div>
                        <span>{zh?'共享住宅':'Shared home'}</span>
                      </div>
                      <p className="studio-relationship-note">{zh?'大家共住在这套住宅里，共享客厅、厨房、家务和生活资源，也可以在其中保有自己的个人空间；这些共同生活会自然产生更多日常互动。':'Everyone shares this residence, including its living room, kitchen, chores, and household resources, while keeping personal space within it—fertile ground for everyday interactions.'}</p>
                    </section>

                    <section className="studio-relationship-card" aria-labelledby="studio-family-title">
                      <div className="studio-relationship-card__heading">
                        <div>
                          <b id="studio-family-title">{zh?'家庭成员':'Family members'}</b>
                          <small>{zh?'从现有居民中选择，最多 4 人。':'Choose up to 4 existing residents.'}</small>
                        </div>
                        <span>{familyIds.length} / 4</span>
                      </div>
                      {relationshipOptions.length?<div className="studio-resident-options" role="group" aria-labelledby="studio-family-title">
                        {relationshipOptions.map(candidate=>{
                          const selected=familyIds.includes(candidate.id),disabled=!selected&&familyIds.length>=4;
                          return <button type="button" className={selected?'is-selected':''} aria-pressed={selected} disabled={disabled} onClick={()=>set("familyIds",selected?familyIds.filter(id=>id!==candidate.id):[...familyIds,candidate.id])} key={candidate.id}><span aria-hidden>{selected?'✓':'+'}</span>{candidate.name}</button>
                        })}
                      </div>:<p className="studio-empty-options">{zh?'创建更多居民后，可以在这里建立家庭关系。':'Create more residents to define family relationships here.'}</p>}
                      <p className="studio-relationship-note">{zh?'家庭关系会阻止角色彼此发展恋爱关系，但友情、竞争与冲突仍会自然发生。':'Family ties prevent romance between those characters, while friendship, rivalry, and conflict can still develop.'}</p>
                    </section>

                    <section className={`studio-romance-policy ${adult?'':'is-disabled'}`} aria-labelledby="studio-romance-title">
                      <div className="studio-romance-policy__control">
                        <div>
                          <b id="studio-romance-title">{zh?'自主恋爱关系':'Autonomous romantic relationships'}</b>
                          <small>{adult
                            ?(zh?'允许该角色在生活中自然发展恋爱关系。':'Allow this character to develop romantic relationships naturally.')
                            :(zh?`仅对年满 ${ROMANCE_ADULT_AGE} 岁的角色开放；当前已自动禁用。`:`Only available to characters aged ${ROMANCE_ADULT_AGE} or older; currently disabled.`)}</small>
                        </div>
                        <label className="studio-switch">
                          <input type="checkbox" checked={romanceEnabled} disabled={!adult} onChange={event=>onChange(withRomancePreference(profile,event.target.checked))}/>
                          <span aria-hidden/>
                          <em>{romanceEnabled?(zh?'已允许':'Allowed'):(zh?'未允许':'Not allowed')}</em>
                        </label>
                      </div>
                      <div className="studio-romance-policy__boundaries">
                        <b>{zh?'关系边界':'Relationship boundaries'}</b>
                        <ul>
                          <li>{zh?'只会与另一位已成年、也明确允许恋爱的非亲属角色发展。':'Romance can only develop with another adult, opted-in, non-family character.'}</li>
                          <li>{zh?'约会或伴侣关系需要双方都明确愿意；单方好感不会自动升级。':'Dating or partnership requires mutual willingness; one-sided attraction never upgrades automatically.'}</li>
                          <li>{zh?'关闭后只阻止新的恋爱发展，友情、竞争和冲突仍会正常发生。':'Turning this off only blocks new romance; friendship, rivalry, and conflict still develop.'}</li>
                        </ul>
                      </div>
                    </section>
                  </>
                ) : (
                  <>
                    <fieldset>
                      <legend>{zh ? "角色模型" : "Character model"}</legend>
                      <p className="studio-field-hint">
                        {zh
                          ? "奇趣角色支持发型与服装组合；城市居民是素材包中完整制作的低模预设。"
                          : "The chibi model supports mix-and-match parts; city residents are complete low-poly presets."}
                      </p>
                      <div className="avatar-preset-grid">
                        {CHARACTER_PRESETS.map((preset, index) => (
                          <button
                            type="button"
                            className={(profile.avatar.model ?? CHIBI_MODEL_ID) === preset.id ? "chosen" : ""}
                            onClick={() => avatar("model", preset.id)}
                            key={preset.id}
                          >
                            <span className={`avatar-preset-token avatar-preset-token--${preset.family}`} aria-hidden>
                              {preset.family === "chibi" ? "✦" : String(index).padStart(2, "0")}
                            </span>
                            <span>{preset.label[language]}</span>
                          </button>
                        ))}
                      </div>
                    </fieldset>

                    {characterFamily === "chibi" ? <>
                    <fieldset>
                      <legend>{zh ? "肤色" : "Skin tone"}</legend>
                      <div className="avatar-option-grid avatar-option-grid--skin">
                        {skinTones.map(value=><button type="button" className={profile.avatar.skin===value?'chosen':''} onClick={()=>avatar('skin',value)} key={value}><span className="skin-swatch skin-swatch--large" style={{background:value}}/><span>{zh?'肤色':'Tone'}</span></button>)}
                      </div>
                    </fieldset>
                    <div className="field-grid color-fields">
                      <label>
                        {zh ? "发色" : "Hair color"}
                        <input
                          type="color"
                          value={profile.avatar.hairColor}
                          onChange={(e) => avatar("hairColor", e.target.value)}
                        />
                      </label>
                      <label>
                        {zh ? "服装颜色" : "Outfit color"}
                        <input
                          type="color"
                          value={profile.avatar.outfitColor}
                          onChange={(e) =>
                            avatar("outfitColor", e.target.value)
                          }
                        />
                      </label>
                    </div>
                    <fieldset>
                      <legend>{zh ? "发型" : "Hair"}</legend>
                      <div className="avatar-option-grid avatar-option-grid--assets">
                        {CHIBI_HAIR.map((entry) => <button
                          type="button"
                          className={resolveChibiHair(profile.avatar.hair) === entry.id ? "chosen" : ""}
                          onClick={() => avatar("hair", entry.id)}
                          key={entry.id}
                        ><span className="asset-option-glyph" aria-hidden>◒</span><span>{entry.label[language]}</span></button>)}
                      </div>
                    </fieldset>
                    <fieldset>
                      <legend>{zh ? "穿着" : "Outfit"}</legend>
                      <div className="avatar-option-grid avatar-option-grid--assets">
                        {CHIBI_OUTFITS.map((entry) => <button
                          type="button"
                          className={resolveChibiOutfit(profile.avatar.outfit) === entry.id ? "chosen" : ""}
                          onClick={() => avatar("outfit", entry.id)}
                          key={entry.id}
                        ><span className="asset-option-glyph" aria-hidden>◇</span><span>{entry.label[language]}</span></button>)}
                      </div>
                    </fieldset>
                    <fieldset>
                      <legend>{zh ? "配饰" : "Accessory"}</legend>
                      <div className="avatar-option-grid avatar-option-grid--assets">
                        {CHIBI_ACCESSORIES.map((entry) => <button
                          type="button"
                          className={resolveChibiAccessory(profile.avatar.accessory) === entry.id ? "chosen" : ""}
                          onClick={() => avatar("accessory", entry.id)}
                          key={entry.id}
                        ><span className="asset-option-glyph" aria-hidden>{entry.id === "none" ? "—" : "✧"}</span><span>{entry.label[language]}</span></button>)}
                      </div>
                    </fieldset>
                    </> : <>
                      <fieldset>
                        <legend>{zh ? "发色" : "Hair color"}</legend>
                        <p className="studio-field-hint">
                          {zh
                            ? "城市角色的身体、脸部和服装是一体化模型，当前素材仅支持安全调整独立头发材质。"
                            : "City bodies, faces, and outfits are authored as one mesh; only the separate hair material can be recolored safely."}
                        </p>
                        <div className="avatar-option-grid">
                          {["#2d2323", "#65423b", "#b36b43", "#e0b06f", "#6d718d", "#d67683"].map((value) => <button
                            type="button"
                            className={profile.avatar.hairColor.toLowerCase() === value ? "chosen" : ""}
                            onClick={() => avatar("hairColor", value)}
                            key={value}
                          ><span className="skin-swatch skin-swatch--large" style={{background:value}}/><span>{zh ? "发色" : "Color"}</span></button>)}
                        </div>
                      </fieldset>
                    </>}
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
        <footer>
          {error && <p role="alert">{error}</p>}
          <span>
            {zh
              ? "你的设定会影响未来的记忆和事件。"
              : "Your choices shape future memories and events."}
          </span>
          <button
            onClick={onSave}
            disabled={
              saving || !profile.name.trim() || !profile.personality.length
            }
          >
            {saving
              ? zh
                ? "保存中…"
                : "Saving…"
              : zh
                ? "保存角色"
                : "Save character"}
          </button>
        </footer>
      </section>
    </motion.div>
  );
}
