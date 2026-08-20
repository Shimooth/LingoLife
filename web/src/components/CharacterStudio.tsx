import { useState, type CSSProperties } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { NpcProfile } from "../types";
import { AvatarStage } from "./AvatarStage";
const opts = {
  hair: [
    "waves",
    "bob",
    "pixie",
    "bun",
    "braids",
    "curly",
  ],
  face: ["oval", "round", "heart", "square"],
  eyes: ["soft", "round", "sleepy", "wide"],
  brows: ["soft", "straight", "bold"],
  nose: ["button", "long", "wide"],
  mouth: ["soft", "tiny", "bold", "smile"],
  outfit: [
    "sweater",
    "hoodie",
    "blazer",
    "dress",
    "overalls",
    "jacket",
  ],
  accessory: [
    "none",
    "glasses",
    "earrings",
    "headphones",
    "scarf",
    "beanie",
  ],
};

const sheets:Record<string,{src:string;columns:number;rows:number;order:string[]}>= {
  hair:{src:'/assets/avatar/v2/hair.jpg',columns:3,rows:2,order:opts.hair},
  face:{src:'/assets/avatar/v2/face.jpg',columns:2,rows:2,order:opts.face},
  eyes:{src:'/assets/avatar/v2/eyes.jpg',columns:4,rows:1,order:opts.eyes},
  brows:{src:'/assets/avatar/v2/brows.jpg',columns:3,rows:1,order:opts.brows},
  nose:{src:'/assets/avatar/v2/nose.jpg',columns:3,rows:1,order:opts.nose},
  mouth:{src:'/assets/avatar/v2/mouth.jpg',columns:4,rows:1,order:opts.mouth},
  outfit:{src:'/assets/avatar/v2/outfit.jpg',columns:3,rows:2,order:opts.outfit},
  accessory:{src:'/assets/avatar/v2/accessory.jpg',columns:3,rows:2,order:opts.accessory},
};

function previewStyle(group:string,value:string):CSSProperties|undefined{
  const sheet=sheets[group],index=sheet?.order.indexOf(value)??-1
  if(!sheet||index<0)return undefined
  const column=index%sheet.columns,row=Math.floor(index/sheet.columns)
  return {
    backgroundImage:`url(${sheet.src})`,
    backgroundSize:`${sheet.columns*100}% ${sheet.rows*100}%`,
    backgroundPosition:`${sheet.columns===1?0:(column/(sheet.columns-1))*100}% ${sheet.rows===1?0:(row/(sheet.rows-1))*100}%`,
  }
}
const label = (s: string) => s[0].toUpperCase() + s.slice(1);
const zhLabels: Record<string, string> = {
  hair: "发型",
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
  smile: "微笑",
  tiny: "小巧",
  outfit: "穿着",
  sweater: "毛衣",
  hoodie: "连帽衫",
  blazer: "西装",
  dress: "连衣裙",
  tee: "T恤",
  overalls: "背带装",
  cardigan: "开衫",
  jacket: "夹克",
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
  hairclip: "Hair clip",
  tee: "T-shirt",
  locs: "Locs",
};
const zhContext: Record<string, string> = {
  "face.round": "圆脸",
  "face.long": "长形脸",
  "eyes.round": "圆眼",
  "eyes.soft": "柔和眼",
  "eyes.wide": "大眼",
  "brows.soft": "柔和眉",
  "brows.bold": "浓眉",
  "nose.button": "小巧鼻",
  "nose.long": "修长鼻",
  "nose.wide": "宽鼻",
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
            <AvatarStage avatar={profile.avatar} mood="happy" compact />
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
                    <div className="field-grid">
                      <label>
                        {zh ? "肤色" : "Skin tone"}
                        <input
                          type="color"
                          value={profile.avatar.skin}
                          onChange={(e) => avatar("skin", e.target.value)}
                        />
                      </label>
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
                        <div className="preset-grid">
                          {values.map((x) => (
                            <button
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
                              <i className={`preset-art ${previewStyle(key,x)?'':'is-legacy'}`} style={previewStyle(key,x)} />
                              <span>{optionLabel(x, key)}</span>
                            </button>
                          ))}
                        </div>
                      </fieldset>
                    )})}
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
