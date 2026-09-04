import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { FamilyRole, NpcProfile, SharedHistoryKind, SharedHistoryTone } from "../types";
import {AVATAR_HAIR_COLORS,AVATAR_OUTFIT_COLORS,AVATAR_SKIN_COLORS} from "../avatar";
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
const familyLabels:Record<FamilyRole,{zh:string;en:string}>={sibling:{zh:'兄弟姐妹',en:'Sibling'},cousin:{zh:'表/堂亲',en:'Cousin'},parent:{zh:'父母',en:'Parent'},child:{zh:'子女',en:'Child'},guardian:{zh:'监护人',en:'Guardian'},dependent:{zh:'被监护人',en:'Dependent'}}
const historyKinds:Record<SharedHistoryKind,{zh:string;en:string}>={grew_up_together:{zh:'一起长大',en:'Grew up together'},studied_together:{zh:'曾经同学',en:'Studied together'},worked_together:{zh:'曾经共事',en:'Worked together'},shared_project:{zh:'合作过项目',en:'Shared a project'},weathered_hardship:{zh:'共同度过难关',en:'Weathered hardship'},family_tradition:{zh:'共享家庭传统',en:'Family tradition'},friendly_rivalry:{zh:'长期友好竞争',en:'Friendly rivalry'}}
const historyTones:Record<SharedHistoryTone,{zh:string;en:string}>={warm:{zh:'温暖',en:'Warm'},neutral:{zh:'平静',en:'Neutral'},complicated:{zh:'复杂',en:'Complicated'}}
const split = (value: string, max: number) =>
  value
    .split(/[,，]/)
    .map((x) => x.trim())
    .filter(Boolean)
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
  const familyRelations=profile.familyRelations??[];
  const sharedHistory=profile.shared_history_hooks??[];
  const set = <K extends keyof NpcProfile>(key: K, value: NpcProfile[K]) =>
    onChange({ ...profile, [key]: value });
  const avatar = (key: string, value: string) =>
    set("avatar", { ...profile.avatar, [key]: value, strokes: [] });
  const updateHistory=(id:string,change:{kind?:SharedHistoryKind;summary?:string;tone?:SharedHistoryTone})=>set('shared_history_hooks',sharedHistory.map(hook=>hook.id===id?{...hook,...change}:hook));
  const removeHistory=(id:string)=>set('shared_history_hooks',sharedHistory.filter(hook=>hook.id!==id));
  const addHistory=(candidate:{id:string;name:string})=>{
    if(!editingNpcId||sharedHistory.length>=4)return;
    const id=`history-${Date.now().toString(36)}-${editingNpcId.slice(-5)}-${candidate.id.slice(-5)}`;
    set('shared_history_hooks',[...sharedHistory,{id,participantIds:[editingNpcId,candidate.id],kind:'shared_project',summary:`${profile.name} and ${candidate.name} once completed an important project together.`,tone:'neutral'}]);
  };
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
                    <div className="field-grid">
                      <label>{zh?"喜欢（最多6项）":"Likes (up to 6)"}<input value={profile.likes.join(", ")} onChange={e=>set("likes",split(e.target.value,6))}/></label>
                      <label>{zh?"不喜欢（最多6项）":"Dislikes (up to 6)"}<input value={profile.dislikes.join(", ")} onChange={e=>set("dislikes",split(e.target.value,6))}/></label>
                      <label>{zh?"小怪癖（最多4项）":"Quirks (up to 4)"}<input value={profile.quirks.join(", ")} onChange={e=>set("quirks",split(e.target.value,4))}/></label>
                      <label>{zh?"日常习惯（最多4项）":"Habits (up to 4)"}<input value={profile.habits.join(", ")} onChange={e=>set("habits",split(e.target.value,4))}/></label>
                    </div>
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
                          <small>{zh?'客观亲属关系会在首次建组时由双方共同确认。':'Objective family ties are confirmed by both residents during initial setup.'}</small>
                        </div>
                        <span>{familyIds.length} / 4</span>
                      </div>
                      {familyIds.length?<div className="studio-resident-options" role="list" aria-labelledby="studio-family-title">{familyIds.map(id=>{const candidate=relationshipOptions.find(item=>item.id===id),relation=familyRelations.find(item=>item.targetId===id);return <span className="studio-relation-fact" role="listitem" key={id}><i aria-hidden>✓</i>{candidate?.name??id}<small>{relation?familyLabels[relation.role][language]:(zh?'旧版亲属记录':'Legacy family record')}</small></span>})}</div>:<p className="studio-empty-options">{zh?'当前没有已确认的亲属关系。':'No confirmed family ties.'}</p>}
                      <p className="studio-relationship-note">{zh?'为避免单方改写客观事实，亲属关系不能在单人编辑器中增删；它仍会阻止角色彼此发展恋爱关系。':'To prevent one-sided rewrites of an objective fact, family ties cannot be added or removed in this single-resident editor. They still prevent romance between those characters.'}</p>
                    </section>

                    <section className="studio-relationship-card" aria-labelledby="studio-history-title">
                      <div className="studio-relationship-card__heading"><div><b id="studio-history-title">{zh?'共同历史 Hook':'Shared-history hooks'}</b><small>{zh?'可编辑的故事起点，不会直接写死友情、恋爱或冲突结果。':'Editable story seeds that never pre-write friendship, romance, or conflict outcomes.'}</small></div><span>{sharedHistory.length} / 4</span></div>
                      {sharedHistory.length?<div className="studio-history-hooks">{sharedHistory.map(hook=><article key={hook.id}><div><select aria-label={zh?'共同历史类型':'Shared-history type'} value={hook.kind} onChange={event=>updateHistory(hook.id,{kind:event.target.value as SharedHistoryKind})}>{(Object.entries(historyKinds) as [SharedHistoryKind,{zh:string;en:string}][]).map(([kind,label])=><option value={kind} key={kind}>{label[language]}</option>)}</select><select aria-label={zh?'共同历史氛围':'Shared-history tone'} value={hook.tone} onChange={event=>updateHistory(hook.id,{tone:event.target.value as SharedHistoryTone})}>{(Object.entries(historyTones) as [SharedHistoryTone,{zh:string;en:string}][]).map(([tone,label])=><option value={tone} key={tone}>{label[language]}</option>)}</select><button type="button" onClick={()=>removeHistory(hook.id)} aria-label={zh?'删除共同历史':'Delete shared history'}>×</button></div><textarea maxLength={180} rows={2} value={hook.summary} onChange={event=>updateHistory(hook.id,{summary:event.target.value})}/></article>)}</div>:<p className="studio-empty-options">{zh?'还没有共同历史。你可以为当前角色和另一位居民添加一段。':'No shared history yet. Add one with another resident.'}</p>}
                      {sharedHistory.length<4&&relationshipOptions.length>0&&<div className="studio-resident-options" role="group" aria-label={zh?'添加共同历史':'Add shared history'}>{relationshipOptions.filter(candidate=>!sharedHistory.some(hook=>hook.participantIds.includes(candidate.id))).map(candidate=><button type="button" onClick={()=>addHistory(candidate)} key={candidate.id}><span aria-hidden>＋</span>{candidate.name}</button>)}</div>}
                    </section>

                    <section className="studio-relationship-card" aria-labelledby="studio-life-contract-title">
                      <div className="studio-relationship-card__heading"><div><b id="studio-life-contract-title">{zh?'共同生活方式':'Shared-life style'}</b><small>{zh?'这些选择会实际影响日常行为、资源碰撞和冲突反应。':'These choices directly shape daily actions, resource collisions, and conflict responses.'}</small></div></div>
                      <div className="field-grid">
                        <label>{zh?'家庭角色':'Household role'}<select value={profile.householdRole} onChange={e=>set('householdRole',e.target.value as NpcProfile['householdRole'])}><option value="organizer">{zh?'组织者':'Organizer'}</option><option value="caretaker">{zh?'照顾者':'Caretaker'}</option><option value="mediator">{zh?'协调者':'Mediator'}</option><option value="cook">{zh?'主厨':'Cook'}</option><option value="fixer">{zh?'维修担当':'Fixer'}</option><option value="free_spirit">{zh?'自由派':'Free spirit'}</option></select></label>
                        <label>{zh?'私人空间需求':'Private-space preference'}<select value={profile.privateSpacePreference} onChange={e=>set('privateSpacePreference',e.target.value as NpcProfile['privateSpacePreference'])}><option value="low">{zh?'喜欢共享空间':'Enjoys shared space'}</option><option value="balanced">{zh?'平衡':'Balanced'}</option><option value="high">{zh?'需要较多独处':'Needs more solitude'}</option></select></label>
                      </div>
                      <label>{zh?'生活边界（逗号分隔，最多8项）':'Everyday boundaries (comma-separated, up to 8)'}<textarea rows={2} value={profile.boundaries.join(', ')} onChange={e=>set('boundaries',split(e.target.value,8))}/></label>
                      <div><b>{zh?'偏好的家务（最多3项）':'Preferred chores (up to 3)'}</b><div className="studio-resident-options">{([['cooking',zh?'做饭':'Cooking'],['dishes',zh?'洗碗':'Dishes'],['cleaning',zh?'清洁':'Cleaning'],['shopping',zh?'采购':'Shopping'],['repairs',zh?'维修':'Repairs'],['laundry',zh?'洗衣':'Laundry']] as [NpcProfile['chorePreferences'][number],string][]).map(([value,label])=>{const selected=profile.chorePreferences.includes(value);return <button type="button" className={selected?'is-selected':''} aria-pressed={selected} onClick={()=>set('chorePreferences',selected?profile.chorePreferences.filter(item=>item!==value):[...profile.chorePreferences,value].slice(-3))} key={value}><span aria-hidden>{selected?'✓':'+'}</span>{label}</button>})}</div></div>
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
                        {AVATAR_SKIN_COLORS.map(value=><button type="button" className={profile.avatar.skin.toLowerCase()===value?'chosen':''} onClick={()=>avatar('skin',value)} key={value}><span className="skin-swatch skin-swatch--large" style={{background:value}}/><span>{zh?'肤色':'Tone'}</span></button>)}
                      </div>
                    </fieldset>
                    <fieldset><legend>{zh ? "发色" : "Hair color"}</legend><div className="avatar-option-grid avatar-option-grid--skin">{AVATAR_HAIR_COLORS.map(value=><button type="button" className={profile.avatar.hairColor.toLowerCase()===value?'chosen':''} onClick={()=>avatar('hairColor',value)} key={value}><span className="skin-swatch skin-swatch--large" style={{background:value}}/><span>{zh?'发色':'Color'}</span></button>)}</div></fieldset>
                    <fieldset><legend>{zh ? "服装颜色" : "Outfit color"}</legend><div className="avatar-option-grid avatar-option-grid--skin">{AVATAR_OUTFIT_COLORS.map(value=><button type="button" className={profile.avatar.outfitColor.toLowerCase()===value?'chosen':''} onClick={()=>avatar('outfitColor',value)} key={value}><span className="skin-swatch skin-swatch--large" style={{background:value}}/><span>{zh?'服装色':'Color'}</span></button>)}</div></fieldset>
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
                          {AVATAR_HAIR_COLORS.map((value) => <button
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
