# 原创居民 V1

`OriginalResident` 是本次可玩视觉样板的原创参数化角色，不依赖现有 City / Chibi 模型、远程贴图或库存动画。连续头型曲面、发束曲面、衣服裁剪曲面由项目源代码生成；眉眼、手、鞋、扣子与配饰共用玩具材质语言。它是可验证的生产工具原型，尚不是经过人工拓扑整理、皮肤蒙皮与服装纠正形变制作的最终商业母模。

## 运行契约

```tsx
<OriginalResident
  appearance={appearance}
  motion="receive"
  emotion="happy"
  time={timeRef}
  quality="high"
/>
```

- 坐标为右手系，Y 向上，角色面向 +Z，脚底约为 0。默认站立高度约 2.63，四套预设约 2.61–2.76。
- 外层调用者管理位置、转向与真实行走位移。角色只管理身体表演与脚部离地补偿，不调用游戏结算。
- `appearance` 采用 `../spec.ts` 的 29 项数值参数、6 种颜色与发型 / 衣装 / 配饰选项。先使用 `normalizeOriginalAppearance` 校验外部输入。
- 头部曲面及其附着的脸部部件使用同一尺寸函数。脸型与表演分开控制；表情不会覆盖玩家外貌参数。
- `time` 可为秒数或 `{current:number}`，调用者传入当前动作片段的相对时间。显式时间支持任意 seek、暂停后定格、回放；显式时间由调用者暂停递增。未传入时间时组件自动累积，`paused` 冻结内部时钟。
- `idle / wave / walk / talk / receive / eat / happy` 均由绝对时间决定。`walk` 不修改世界位置；`eat` 在约 1.65 秒出现咬口，约 5.2 秒结束持物；重新从 0 播放会恢复完整饼干。
- `high / low` 调整头型、头发、衣服细分与针织细节密度。此版本尚未做移动真机性能认证。
- 自建 BufferGeometry 使用 `useOwnedGeometry` 释放旧 GPU 缓冲；React Three Fiber 管理声明式几何与材质。StrictMode 允许从保留的 CPU 属性重新上传。

## 导出与关节

角色根节点 `original-resident` 包含 `orig-root`；头部为 `orig-head`。手臂分别为 `orig-arm-left/right → orig-forearm-left/right → orig-hand-left/right`；腿部为 `orig-leg-left/right → orig-knee-left/right`。角色自身左侧位于正 X。

四肢静止方向为局部 -Y。`geometry.ts:bodyDimensions` 提供与外观一致的关节长度与位置，`motion.ts:originalResidentPose` 提供基础绝对姿态。接礼物与进食额外使用双段手臂 IK，直接采样基础姿态不能替代最终的 IK 结果；客户端应复用求解规则或烘焙实际关节变换。

- `orig-mouth-open` 与 `orig-mouth-closed` 保存实际可见状态；开口组的 Y 缩放控制口型。
- `orig-eye-left/right` 各包含 `orig-eyelids` 和眼球子节点。沿 Y 缩放眼睑组控制眨眼；扁平导入字典应带父节点路径，避免两个同名眼睑互相覆盖。
- `orig-prop-gift` 在 receive 模式下存在并绑到右手，左手解算至同一纸盒侧边。
- `orig-prop-cookie-whole / orig-prop-cookie-bitten` 在 eat 模式下存在，均在右手道具挂点下；导出需要保留可见性。
- 手指目前为独立造型件，尚没有逐指抓握动画或完整皮肤变形。

## 无账号验收

预览地址：`/src/original/character/preview.html`，`?face` 为近景，`?row` 为四套预设对照。

在独立 QA Chrome 中执行：

```sh
QA_CDP_URL=http://127.0.0.1:19231 QA_WEB_URL=http://127.0.0.1:5173 node src/original/character/check-browser.mjs
```

检查 29 项参数逐一改变真实网格 / 变换 / 材质、两种全参数极端组合、7 类动作的有限值与脚底、重复更换预设后的几何释放。默认报告和截图写入 `/private/tmp/lingolife-original-character-qa/`，完全不读取或修改玩家账号。
