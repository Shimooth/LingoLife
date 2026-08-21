import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { NpcProfile } from "../types";
import { AvatarStage } from "./AvatarStage";
import { CharacterCanvas3D } from "../three/characters";
const opts = {
  hair: ["swoop", "bob", "sprout", "bun", "curls", "shaggy"],
  face: ["round", "oval", "bean", "square", "heart"],
  eyes: ["dot", "oval", "sleepy", "wink", "sparkle", "curious"],
  brows: ["tiny", "straight", "worried", "bold", "soft"],
  nose: ["button", "dot", "triangle", "round", "heart"],
  mouth: ["smile", "open", "cat", "pout", "tongue"],
  outfit: ["jumper", "hoodie", "jacket", "playful", "overalls", "blazer"],
  pants: ["balloon", "straight", "wide", "shorts", "cargo", "pleated"],
  accessory: ["none", "glasses", "earrings", "headphones", "scarf", "beanie", "frogclip"],
};
const skinTones=["#f7d7c4","#efb99b","#d99772","#b87352","#8b533b","#57372f"]
const homeBackgrounds=["bubble","book","plant","retro","space","harbor"]
const label = (s: string) => s[0].toUpperCase() + s.slice(1);
const zhLabels: Record<string, string> = {
  hair: "发型",
  swoop:"俏皮侧分",sprout:"小芽短发",curls:"蓬松卷发",shaggy:"乱翘短发",
  waves: "波浪长发",
  bob: "波波头",
  pixie: "精灵短发",
  bun: "丸子头",
  braids: "编发",
  curly: "卷发",
  ponytail: "马尾",
  locs: "锁发",
  straight: "直发",
  mohawk: "莫西干",
  face: "脸型",
  oval: "椭圆脸",
  round: "圆形",
  heart: "心形脸",
  square: "方形脸",
  long: "长形脸",
  eyes: "眼睛",
  soft: "柔和",
  wide: "大眼",
  sleepy: "慵懒",
  brows: "眉毛",
  bold: "浓眉",
  nose: "鼻子",
  button: "小巧",
  mouth: "嘴型",
  open:"开心张嘴",cat:"猫猫嘴",pout:"嘟嘟嘴",tongue:"吐舌头",
  smile: "微笑",
  tiny: "小巧",
  outfit: "穿着",
  jumper:"软糯套头衫",playful:"搞怪上衣",
  sweater: "毛衣",
  hoodie: "连帽衫",
  blazer: "西装",
  dress: "连衣裙",
  tee: "T恤",
  overalls: "背带装",
  cardigan: "开衫",
  jacket: "夹克",
  pants:"裤子",balloon:"灯笼裤",shorts:"短裤",cargo:"工装裤",pleated:"百褶短裤",
  accessory: "配饰",
  none: "无",
  glasses: "眼镜",
  earrings: "耳环",
  headphones: "耳机",
  hairclip: "发夹",
  necklace: "项链",
  scarf: "围巾",
  beanie: "针织帽",
  freckles: "雀斑",
  frogclip:"青蛙发夹",
  bean:"豆豆脸",dot:"小圆点",sparkle:"星星眼",curious:"好奇眼",wink:"眨眨眼",worried:"八字眉",triangle:"三角鼻",
  homeBackground:"家的背景",bubble:"糖果阁楼",book:"书香小窝",plant:"奇趣植物屋",retro:"复古波普屋",space:"太空舱",harbor:"海港木屋",
};
const enLabels: Record<string, string> = {
  hair: "Hair",
  face: "Face shape",
  eyes: "Eyes",
  brows: "Eyebrows",
  nose: "Nose",
  mouth: "Mouth",
  outfit: "Clothing",
  accessory: "Accessories",
  pants:"Pants",homeBackground:"Home background",swoop:"Swoop",sprout:"Sprout",curls:"Curls",shaggy:"Shaggy",bean:"Bean",dot:"Dot",sparkle:"Sparkle",curious:"Curious",wink:"Wink",tiny:"Tiny",worried:"Worried",triangle:"Triangle",open:"Open smile",cat:"Cat mouth",pout:"Pout",tongue:"Tongue",jumper:"Jumper",playful:"Playful top",balloon:"Balloon pants",straight:"Straight pants",shorts:"Shorts",cargo:"Cargo pants",pleated:"Pleated shorts",frogclip:"Frog clip",bubble:"Candy loft",book:"Book nest",plant:"Plant lab",retro:"Retro pop",space:"Space pod",harbor:"Harbor cabin",
  hairclip: "Hair clip",
  tee: "T-shirt",
  locs: "Locs",
};
const zhContext: Record<string, string> = {
  "face.round": "圆脸",
  "face.long": "长形脸",
  "eyes.round": "圆眼",
  "eyes.oval": "椭圆眼",
  "eyes.dot": "豆豆眼",
  "eyes.soft": "柔和眼",
  "eyes.wide": "大眼",
  "brows.soft": "柔和眉",
  "brows.bold": "浓眉",
  "brows.tiny": "小弯眉",
  "pants.straight": "直筒裤",
  "nose.button": "小巧鼻",
  "nose.long": "修长鼻",
  "nose.wide": "宽鼻",
  "nose.round": "圆圆鼻",
  "nose.heart": "爱心鼻",
  "mouth.soft": "自然嘴型",
  "mouth.bold": "饱满嘴型",
  "mouth.tiny": "小巧嘴型",
};
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
}: {
  profile: NpcProfile;
  onChange: (p: NpcProfile) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
  error: string;
  language?: "zh" | "en";
}) {
  const reduce = useReducedMotion(),
    [tab, setTab] = useState<"story" | "look">("story"),
    zh = language === "zh";
  const set = <K extends keyof NpcProfile>(key: K, value: NpcProfile[K]) =>
    onChange({ ...profile, [key]: value });
  const avatar = (key: string, value: string) =>
    set("avatar", { ...profile.avatar, [key]: value, strokes: [] });
  const previewAvatar=(key:string,value:string)=>({...profile.avatar,[key]:value,strokes:[]})
  const optionLabel = (value: string, group?: string) =>
    zh
      ? zhContext[`${group}.${value}`] || zhLabels[value] || value
      : enLabels[value] || label(value);
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
              {(["story", "look"] as const).map((x) => (
                <button
                  className={tab === x ? "active" : ""}
                  onClick={() => setTab(x)}
                  key={x}
                >
                  {x === "story"
                    ? zh
                      ? "身份设定"
                      : "Identity"
                    : zh
                      ? "外观"
                      : "Appearance"}
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
                          onChange={(e) => set("age", e.target.value ? Math.max(16,Math.min(100,Number(e.target.value))) : null)}
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
                ) : (
                  <>
                    <fieldset>
                      <legend>{zh ? "肤色" : "Skin tone"}</legend>
                      <div className="avatar-option-grid avatar-option-grid--skin">
                        {skinTones.map(value=><button type="button" className={profile.avatar.skin===value?'chosen':''} onClick={()=>avatar('skin',value)} key={value}><span className="skin-swatch" style={{background:value}}/><AvatarStage avatar={previewAvatar('skin',value)} preview="head" compact staticPreview/><span>{zh?'肤色':'Tone'}</span></button>)}
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
                    {Object.entries(opts).map(([key, curated]) => {
                      const current=String(profile.avatar[key as keyof typeof profile.avatar]||'')
                      const values=curated.includes(current)?curated:[current,...curated]
                      return (
                      <fieldset key={key}>
                        <legend>{optionLabel(key)}</legend>
                        <div className="avatar-option-grid">
                          {values.map((x) => (
                            <button
                              type="button"
                              className={
                                profile.avatar[
                                  key as keyof typeof profile.avatar
                                ] === x
                                  ? "chosen"
                                  : ""
                              }
                              onClick={() => avatar(key, x)}
                              key={x}
                            >
                              <span className="avatar-option-visual"><AvatarStage avatar={previewAvatar(key,x)} preview={key==='outfit'||key==='pants'?'body':'head'} compact staticPreview/></span>
                              <span>{optionLabel(x, key)}</span>
                            </button>
                          ))}
                        </div>
                      </fieldset>
                    )})}
                    <fieldset>
                      <legend>{optionLabel('homeBackground')}</legend>
                      <div className="home-option-grid">
                        {homeBackgrounds.map(value=><button type="button" className={profile.avatar.homeBackground===value?'chosen':''} onClick={()=>avatar('homeBackground',value)} key={value}><img src={`/assets/homes/v3/${value}.jpg`} alt=""/><span>{optionLabel(value,'homeBackground')}</span></button>)}
                      </div>
                    </fieldset>
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
