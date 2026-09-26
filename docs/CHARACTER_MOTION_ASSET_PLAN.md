# 人物动作素材盘点：咖啡桌前的自然行动

盘点日期：2026-09-26。本文依据本机已有文件的 GLB 动画通道、二进制关键帧及骨架采样，不把商品宣传名单视为已接入功能。后续本地优化已从原有 Quaternius 包提取两段交谈，见下方“交谈素材实际接入”；其他候选仍未接入。控制器、City `Walk_B` 选用和饮品动作打磨另见 [实施记录](SHARED_DRINK_PRESENTATION.md)。

## 交谈素材实际接入

- 从已下载的 CC0 UAL Standard 提取 `Idle_Talking_Loop` 和 `Sitting_Talking_Loop`，精简 JSON 共 99,340 字节，不将 7.62MB 原包加入首屏。导入入口为 `web/scripts/import-social-motions.mjs`，运行时来源、指纹和许可保存在 `web/public/assets/life/motions/README-Quaternius-Social.md`。
- 单独适配 City／Chibi 的骨段方向与绑定姿态，只输出左右上臂、前臂和手的 6 条旋转轨道。不改骨盆、腿、骨长、缩放、头部注视或实际家具接触；坐着说话不会重新站起。
- 发言层渐入，讲话结束后约半秒收势。原动画时间持续前进，换一句话不重播第一帧。实际轮到倾听时轻点一次头，不在最后一句留屏后一直摆手或周期性点头。拿杯、饮用、行走期间优先原行动，不让交谈手势抢占杯柄接触。
- 安静底层必须测整条手臂，不能只看动作名或手腕。City `Idle_B` 双腕摆幅超过半米；`Idle_A` 手腕近乎固定，但其肘部仍以短周期摆动。最终选用 `Idle_A_Pose`，保留现有低幅度身体／面部表现；Chibi 使用较安静的 `anim_iddle.001`。
- 本轮范围是 NPC 生活片段中的站立交流及共享饮品坐谈。没有据此替换全部玩家聊天导演、城市远景居民、阅读／吃饭等动作；没有新增手指、口型或衣裙物理。

复验：`cd web && node scripts/check-social-motions.mjs`、`node scripts/check-social-performance.mjs`。浏览器站谈／坐谈入口为 `/scripts/fixtures/social-motion.html?case=standing` 或 `?case=seated`，`family=chibi` 切换人物族。该入口使用生产组件和虚构验收对白，不是 AI 台词验收。

## 先说结论

当前最值得改的是**动作之间的衔接**，不是继续增加十几个动作名。已有素材能覆盖走近、坐下、倾听、伸手、挥手、起身；没有发现适合日常生活的独立起步、收步、左／右原地转身片段。

因此，本轮应先让同一套现有动作稳定地完成：减速靠近 → 身体转向 → 坐稳 → 取杯 → 交谈 → 放杯 → 起身 → 转向离开。短距离转向不能只转人物外层模型而让双脚纹丝不动，也不能拿闪避、受击或跳跃动作来充当收步。

本地的 Quaternius 包确实有比通用交互更有针对性的站立／坐姿说话动画，但不是当前骨架的即插即用替代品。后续已完成两段的专门重定向和精简导入，没有把完整 7.62 MB 动画包塞进首屏。

## 实际拥有的内容

路径约定：`CANDIDATES` 表示本机 `LingoLifeAssets/05_curated_candidates` 素材暂存目录。不要把完整下载包提交进仓库。

| 来源 | 已检查文件 | 实际数量 | 当前可用程度 |
| --- | --- | ---: | --- |
| City／RG Poly | `web/public/assets/models/characters/city/animations/animations.glb` | 47 段 | 对 City 原生骨架可直接播放；很多是战斗、僵尸和跳跃，不是 47 种生活行为 |
| Chibi | `web/public/assets/models/characters/chibi/all-in-one.glb` | 11 段 | 对 Chibi 原生骨架可播放；含两个同名系列待机，缺坐姿和自然社交 |
| 已导入 KayKit 生活子集 | `web/public/assets/life/motions/kaykit-life.json` | 12 段原始片段 | 通过现有 `retargetLifeMotion` 适配两套角色；另有 3 个运行时组合动作 |
| KayKit Medium 完整下载 | `02_extracted/.../Animations/gltf/Rig_Medium/` | 8 个 GLB，139 条记录，132 个唯一名称 | 包内 `T-Pose` 重复；不能用宣传总数替代实际 Medium 清单 |
| Quaternius Standard | `CANDIDATES/animations/quaternius_standard/UAL1_Standard.glb` | 43 段 | 已精简接入 2 段交谈上身，其余未导入；使用独立源骨架映射 |

已导入的 12 段：`Sit_Chair_Down`、`Sit_Chair_Idle`、`Sit_Chair_StandUp`、`Waving`、`Idle_A`、`Interact`、`Use_Item`、`Chop`、`Chopping`、`Holding_A`、`Holding_B`、`Working_A`。

组合动作是 `Eating`、`Reading`、`Seated_Interact`。它们不是新录制的动画，而是坐姿下身与已有上肢轨道拼合。

## 这一轮可以直接利用什么

下表时长来自真实关键帧时间。位移使用原文件坐标、包含节点父级变换，未乘游戏中的人物缩放；数值不能直接当作角色在地图上应走的米数。`ΔXZ = 0` 表示片段首尾没有水平位移，不表示手脚没有动作。

| 需求 | 精确片段／来源 | 时长 | 根与髋部实测 | 使用建议 |
| --- | --- | ---: | --- | --- |
| City 日常走路 | `Walk_A`／City | 1.066667 s | `Root` 全程不动；髋部 Y 范围 0.053680 | 已可用；必须按真实速度驱动步相，避免慢速位移配快速踏步 |
| 更轻的 City 步态候选 | `Walk_C`／City | 1.066667 s | `Root` 不动；髋部 Y 范围 0.027731，Z 范围 0.000864 | 上下起伏约为 A 的一半，适合试作桌边轻步；这只是数值优势，仍需实际近景对比 |
| City 另一原生步态 | `Walk_B`／City | 1.000000 s | `Root` 不动；髋部 Y 范围 0.045940 | 可作为个性差异，但不要每次刷新随机换步态 |
| Chibi 日常走路 | `anim_walk`／Chibi | 0.791667 s | 无独立已动画化 `root`；`DEF-spine` 首尾 ΔX=-0.001711、ΔY=-0.003297、ΔZ=0 | 保留现有 Chibi 原生步态，检查循环接缝与落脚；不能直接用 City 动画名替代 |
| 较长周期的待机 | `Idle_B`／City | 3.000000 s | `Root` 不动；髋部 Y 范围 0.016379 | 后续实测双腕摆幅超过半米，不适合安静倾听；不能凭周期长就当作克制动作 |
| 轻微环顾 | `LookingAround`／City | 3.333333 s | `Root` 不动；髋部 X 范围 0.022448 | 适合偶发环顾，不应让倾听者一直左右张望 |
| 坐下／起身 | `Sit_Chair_Down` / `Sit_Chair_StandUp`／KayKit Simulation | 各 0.800000 s | `root` 不动；坐下的 `hips` ΔY=+0.089219、ΔZ=-0.396889；起身反向 | 已经重定向可用；源骨架坐姿髋部升高，不代表游戏椅子也应升高。保留实际座面／脚部约束 |
| 坐稳倾听 | `Sit_Chair_Idle`／KayKit Simulation | 3.600000 s | 根和髋部位置全程固定 | 用连续时间维持姿势，头／眼轻关注对方，不重复播放坐下 |
| 邀请／简短表达 | `Interact`／KayKit General | 1.300000 s | `root` 不动；髋部范围 X=0.021706、Y=0.015093、Z=0.007901 | 可播一小段克制手势后回到倾听，不给双方同时无限循环 |
| 拿物使用的基础 | `Use_Item`／KayKit General | 1.600000 s | `root` 不动；髋部 Y 范围 0.001809、Z 范围 0.010853 | 不是完整喝水动作；仍需明确杯位、手柄朝向、取放接触和视线 |
| 远处打招呼 | `Waving`／KayKit Simulation | 2.133333 s | 根／髋部位置不动 | 适合一开始打招呼，不作为桌边每句话的默认表演 |

### 两个容易误判的细节

1. KayKit 原始坐下动画带有约 `-0.397` 的髋部前后偏移；现有重定向刻意去掉水平髋部运动、只保留垂直部分。因此不能把原始源片段位移再叠到外层走位上，否则会重复移动、穿椅子。
2. 当前 `Seated_Interact` 拼接了 `Sit_Chair_Idle` 的 3.6 秒下身与 `Interact` 的 1.3 秒上肢。自动推断片段长度会取最长轨道；上肢到末帧后可能保持到下一轮。这不能被称为一段天然连续的坐姿说话循环，优化应使用明确的手势窗口与混合，而不是重新挂载角色。

## 已经下载、值得下一步加工的片段

这些内容存在于真实本地文件中；两个 talking loop 已接入，其他内容“已找到”不等于“已在目标骨架验收通过”。

| 精确片段 | 源文件 | 时长 | 原始位移检查 | 加工／用途 |
| --- | --- | ---: | --- | --- |
| `Idle_Talking_Loop` | `quaternius_standard/UAL1_Standard.glb` | 2.933333 s | `root` 全程固定；pelvis 范围 X=0.005187、Y=0.005688、Z=0.001322，首尾归位 | 首选站立说话候选。需映射新骨架，只提取需要的上身轨道，并制作平静／较活跃的混合权重 |
| `Sitting_Talking_Loop` | 同上 | 2.933333 s | 根／pelvis 位置全程固定 | 首选桌边说话候选。先保留已验证的目标座位与下身，再比较完整姿态与上身蒙版方案 |
| `PickUp_Table` | 同上 | 0.833333 s | `root` 固定；pelvis Z 范围 0.024616，首尾归位 | 比地面 `PickUp` 更适合桌面，但仍不是“准确抓当前杯柄”的成品动作；需目标物 IK 和取放时序 |
| `Sitting_Enter` | 同上 | 1.300000 s | pelvis ΔY=-0.335636、ΔZ=-0.244987 | 比现有 0.8 秒坐下更长的候选；只在真实两套目标骨架和当前椅子上优于现有结果时替换 |
| `Sitting_Exit` | 同上 | 1.033333 s | pelvis ΔY=+0.335636、ΔZ=+0.244987 | 与 Enter 配套验证，不把源骨盆位移直接复制给小人 |
| `Walk_Formal_Loop` | 同上 | 1.333333 s | `root` 固定；pelvis X 范围 0.040731、Y 范围 0.034422 | 备选端正步态；普通 `Walk_Loop` 同时长，X 范围 0.070832、Y 范围 0.052638 |
| `Walking_Backwards` | `kaykit_medium/Rig_Medium_MovementAdvanced.glb` | 1.066667 s | 根固定，髋部首尾归位，Y 范围 0.053844 | 适合椅边少量倒退离位，但不是原地转身；骨架与现有 KayKit 源一致，导入难度小于 UAL |
| `Idle_B` | `kaykit_medium/Rig_Medium_General.glb` | 2.133333 s | 根固定；髋部 Y 范围 0.057657、Z 范围 0.007207 | 可作有性格的等候，不一定比现有 `Idle_A` 更安静，不能因名字是 B 就视为品质更高 |

完整 Medium 名单中没有自然 `Walk_Start`、`Walk_Stop`、`Turn_Left`、`Turn_Right` 或 `Pivot`。有 `Dodge_Left/Right`、`Running_Strafe_Left/Right`、`Jump_Start`，但语义与日常桌边行动不符。此次也没有找到同步双人递杯、微笑点头、自然拒绝或完整喝水的原生片段。

## 追加实测：步相应跟随多少行走距离

这是**实际目标骨架**的标定，不直接使用动画 GLB 的源骨架。City 动画源文件的父级朝向与 `Character_1_2_2.glb` 不同，单独采样源骨架会看到脚主要沿 X 摆动；生产模型必须经过同样的 `clipsForModel()`、人物外层 Y 轴 `π` 旋转和缩放后，才用游戏前后轴 Z 计算。

本次使用 Three.js `GLTFLoader` 载入真实目标模型与原生动画，采样一个完整周期的 2,401 个时刻。City 最终缩放 `.56 × 1.92 = 1.0752`，Chibi 最终缩放 `.76 × 1.08 = .8208`。未叠加寻路位移、程序摆动和 IK。

| 人物／片段 | 精确周期 | 左／右脚前后扫幅 | `2 × 扫幅` 几何参照 | 脚踝 Y 抬升范围 |
| --- | ---: | --- | --- | --- |
| City `Walk_B` | 1.0000000000 s | 0.586965 / 0.586953 | 1.173930 / 1.173906 | 0.080475 / 0.080336 |
| City `Walk_C` | 1.0666667223 s | 0.676747 / 0.676734 | 1.353493 / 1.353467 | 0.154757 / 0.154595 |
| Chibi `anim_walk` | 0.7916666865 s | 0.249415 / 0.249421 | 0.498830 / 0.498841 | 0.070384 / 0.070382 |

`2 × 扫幅` 是容易复现的几何参照，**不是精确的实际步幅，也不是保证成立的数学下界**。为了估计不滑脚的移动速度，另外取“该脚踝高度处于自身抬升范围最低 18%”的最长连续区间，计算脚相对于 root 的后退距离除以时间。这样得到的支撑相近似结果为：

| 片段／脚 | 时间区间 | 相对后退距离 | 对应移动速度 | 速度 × 完整周期得到的 stride |
| --- | --- | ---: | ---: | ---: |
| City `Walk_B` 左 | 0.137500–0.473333 s | 0.520000 | 1.548387 /s | 1.548387 |
| City `Walk_B` 右 | 0.604167–0.931667 s | 0.525943 | 1.605932 /s | 1.605932 |
| City `Walk_C` 左 | 0.204000–0.380000 s | 0.337734 | 1.918945 /s | 2.046874 |
| City `Walk_C` 右 | 0.728000–0.899556 s | 0.315530 | 1.839227 /s | 1.961843 |
| Chibi 左 | 0.447292–0.694028 s | 0.207723 | 0.841883 /s | 0.666491 |
| Chibi 右 | 0.041892–0.278403 s | 0.194484 | 0.822308 /s | 0.650994 |

最简初始标定可用：City `Walk_B` 的 `stride ≈ 1.58 / cycle = 1.0`；若保留 `Walk_C`，则 `stride ≈ 2.00 / cycle ≈ 1.066667`；Chibi `stride ≈ .66 / cycle ≈ .791667`。按行走距离推进动画时，`animationSeconds = distance / stride × cycle`。若角色缩放改变，stride 应同比缩放，cycle 不变。

不要继续把 Chibi 周期当作 1 秒；这会让同样走位距离的步相偏快约 26%。City `Walk_C` 若使用 `.82` 的 stride，则相对于上述近地速度估计会出现约 2.4 倍的踏步频率。由于原始动画脚掌滚动和踝关节高度也在变，这些建议仍需真正脚底接触检查：将“近地”阈值放宽至 25% 时，City `Walk_C` 的 stride 估计约 1.92–2.00，Chibi 约 .614–.623，说明单个常数不能代替落脚约束。

另一个重要对照：同一个 City 目标模型、同样缩放，`Walk_A` 左足抬升约 `.198927`，`Walk_B` 约 `.080475`，`Walk_C` 约 `.154757`。因此，**C 的髋部起伏较小，不意味着它的脚步也最克制**。City-01 播放 `Idle_A` 起始帧时，真实蒙皮包围盒身高约 `1.7301`；C 的踝抬升约为身高 9%，B 约为 4.65%，B 更适合先作桌边克制步态候选。这里测量的是踝关节高度变化，**不是鞋底实际离地净空**，不能把“0.15”直接当成角色鞋底悬空 15 厘米。

`Walk_B` 的 25% 近地阈值反推 stride 为左 `1.440952`／右 `1.392511`，与较窄 18% 窗口的约 `1.58` 存在差异；先用 `1.58` 的统一标定作视觉比较，若仍有残余滑步再检查鞋掌接触和步相。不要只把 stride 持续调小来掩盖动作与走位不一致，也不能换 B 后继续沿用 C 的参数。

## 骨架兼容性：为什么不是复制文件就能用

| 骨架 | 本次实测蒙皮关节数 | 代表命名 | 接入边界 |
| --- | ---: | --- | --- |
| City | 32 | `Root`, `Hips`, `Torso`, `Arm.R`, `ForeArm.R`, `Hand.R` | 原生 City 47 段直接匹配；加载时 Three 会处理名称中的点 |
| Chibi | 78 | `DEF-spine`, `DEF-spine.001`, `DEF-upper_arm.R`, `DEF-hand.R` | 原生 11 段直接匹配；脸／眼及更多辅助骨不能被 City 轨道覆盖 |
| KayKit Medium | 23 | `root`, `hips`, `chest`, `upperarm.r`, `lowerarm.r`, `hand.r` | 现有 `lifeRetarget.ts` 已为此命名和绑定姿势建立映射；不会复制源骨长或缩放 |
| Quaternius UAL Standard | 65 | `root`, `pelvis`, `spine_01..03`, `clavicle_r`, `upperarm_r`, `lowerarm_r`, `hand_r` | **当前重定向入口不能直接用**：既不是同名骨架，也不是同一绑定姿势，需要独立源适配器或离线烘焙 |

同一 `Idle_A` 名称在 City 和 KayKit 中分别是 0.666667 秒与 1.066667 秒，不是同一动画。缓存和选片必须带来源／人物族，不能只按片段字符串跨库取用。

## 可复现盘点与导入步骤

1. 先从暂存目录复制源路径到命令参数，不改项目配置中的用户路径。用下列只读命令确认实际片段名和时长：

   ```sh
   node --input-type=module - "/path/to/asset.glb" <<'JS'
   import {readFileSync} from 'node:fs'
   const bytes=readFileSync(process.argv[2])
   const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)))
   for(const clip of gltf.animations??[]) {
     const duration=Math.max(...clip.samplers.map(s=>gltf.accessors[s.input].max?.[0]??0))
     console.log(clip.name, duration, clip.channels.length)
   }
   JS
   ```

2. 本文位移是解码 accessor 后，以 Three.js `AnimationMixer`、`LoopOnce` 和 `clampWhenFinished` 重建节点层级，均匀采样 101 个时间点，再计算 `getWorldPosition()` 首尾差及每轴范围。需要同时观察 root 和 hips／pelvis：只检查根节点会漏掉坐下的骨盆偏移。普通采样范围是数值近似，不宣称捕获所有插值极值。
3. 现有 KayKit 子集的可复现导入入口是：

   ```sh
   node web/scripts/import-life-motions.mjs "/path/to/LingoLifeAssets/05_curated_candidates"
   ```

   **这条命令会重写运行时 `kaykit-life.json`，盘点时不执行。** 当前脚本只从 Simulation、General、Tools 提取上述 12 段，不会自动导入 Walking 或 UAL。增加片段需要同步明确选择列表、类型／语义映射和回归测试。
4. UAL 应另做源骨架适配／离线烘焙：统一绑定朝向 → 建立 pelvis、spine、clavicle、四肢映射 → 保留目标骨长 → 分离需要的垂直骨盆运动与寻路水平位移 → 烘焙两套目标骨架 → 只打包实际采用的片段。不要让原始 UAL Root Motion 和世界寻路同时移动角色。
5. 导入后至少运行 `check-life-motions.mjs`、`check-drink-rig-contact.mjs`、`check-cafe-drink.mjs`，然后对 City／Chibi 各连续观看完整流程。纯数值通过不能代替手腕朝向、肩肘弯曲、脚底滑移、坐面贴合与过渡镜头的实测。

### 本次源文件指纹

用于另一台电脑确认拿到的是同一包；不是要求把这些源文件全部上传到 Git。

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| City `animations.glb` | 1,717,216 | `fedd1aac9638c18cc6f220ff2e43ca4ccb862947f4e46009b776d179109ea239` |
| Chibi `all-in-one.glb` | 14,280,300 | `f9f5c0268ff9996b4da5cd493348d0d42f7aefb7b87fec4b44e182a998fc499e` |
| 当前 `kaykit-life.json` | 489,800 | `6304d963985f980826428134dcd552462d4fbd897646713fff2639f7c0fd3332` |
| `Rig_Medium_General.glb` | 828,240 | `5f725c0f745f36078c7238968cd5c04843cbc6260689eb6e7f5e2bbd7ffdd7ad` |
| `Rig_Medium_Simulation.glb` | 855,904 | `ab6ffeed40c8281dd0ce0506534eadf7385151f1c266643a10fa2a0f0a7ba3b1` |
| `Rig_Medium_MovementBasic.glb` | 689,624 | `11422afd50abf7e8c92ea107e2e0bc94abd38023d6d15f55ad580347efbfa29e` |
| `Rig_Medium_MovementAdvanced.glb` | 719,628 | `8b2317cf81e3f24149e4b791c27e1932bebd46cd378ed962e7d27d642fad8c56` |
| `UAL1_Standard.glb` | 7,618,436 | `69591853d817488edaa8fd9bf8fc1d821eaeaf789f8627b3cd23b41c4ed67997` |

KayKit 1.1 与 UAL Standard 本地原包均已核对附带 CC0 文本；派生内容应继续保留许可证和来源记录。City／Chibi 的许可不因两套动画包为 CC0 而自动改变，仍沿用各自已有素材许可。

## 优先级

1. **本轮**：先完成现有片段的连续时间、速度匹配、落脚／转向、座面和手杯接触，避免重载或瞬移；不扩素材。
2. **交谈已接入**：UAL 两个 talking loop 已做目标骨架适配；`PickUp_Table` 尚未接入，仍用已验收的手杯路径与接触。
3. **仍需补做**：左右小步转身、最后半步收脚、椅旁侧移、温和拒绝／点头，以及从拿杯到放杯的成套细节。若未来采购／寻找新素材，应优先这几个具体缺口，而不是再找一整包战斗和跳跃。
