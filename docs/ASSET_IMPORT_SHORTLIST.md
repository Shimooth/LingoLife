# LingoLife 第一批素材导入候选

- 整理日期：2026-08-28
- 路径基准：素材暂存目录下的 `02_extracted/`
- 用途：从完整免费素材包中选出生活模拟垂直切片所需的最小运行时集合

## 选择原则

1. Tiny Treats Charming Kitchen 负责住宅公共墙体和厨房主体。
2. KayKit Restaurant Bits 只补食物阶段、成品食物和干净/脏餐具，避免两个厨房包重复进入运行时。
3. Furniture Bits 负责卧室和客厅；Bubbly Bathroom 负责浴室。
4. 每个 `.gltf` 必须连同同名 `.bin` 和所属素材包的公共纹理一起复制。
5. 以下是候选清单，不应在筛选前把完整解压目录提交到 Git。

## 路径别名

```text
F = kaykit/KayKit_Furniture_Bits_Free/KayKit_Furniture_Bits_1.0_FREE/Assets/gltf
R = kaykit/KayKit_Restaurant_Bits_Free/KayKit_Restaurant_Bits_1.0_FREE/Assets/gltf
K = tiny_treats/Tiny_Treats_Charming_Kitchen_Free_1.1/Tiny_Treats_Charming_Kitchen_1.1_FREE/Assets/gltf
B = tiny_treats/Tiny_Treats_Bubbly_Bathroom_Free_1.1/Tiny_Treats_Bubbly_Bathroom_1.1_FREE/Assets/gltf
H = tiny_treats/Tiny_Treats_Homely_House_Free/Tiny_Treats_Homely_House_1.0_FREE/Assets/gltf
A = tiny_treats/Tiny_Treats_Bakery_Interior_Free_1.1/Tiny_Treats_Bakery_Interior_1.1_FREE/Assets/gltf
P = tiny_treats/Tiny_Treats_Pretty_Park_Free/Tiny_Treats_Pretty_Park_1.0_FREE/Assets/gltf
I = tiny_treats/Tiny_Treats_Pleasant_Picnic_Free/Tiny_Treats_Pleasant_Picnic_1.0_FREE/Assets/gltf
N = tiny_treats/Tiny_Treats_House_Plants_Free/Tiny_Treats_House_Plants_1.0_FREE/Assets/gltf
G = kaykit/KayKit_Board_Game_Bits_Free/KayKit_BoardGameBits_1.0_FREE/Assets/gltf
```

## 3D 模型候选

### 住宅结构

- `A/floor_wood.gltf`
- `K/floor_tiles_kitchen.gltf`
- `B/floor_tiled.gltf`
- `K/door_modular.gltf`
- `K/wall_modular_plain_kitchen_straight_A.gltf`
- `K/wall_modular_plain_kitchen_corner_inner_A.gltf`
- `K/wall_modular_plain_kitchen_window_large_A.gltf`
- `K/wall_modular_tiles_kitchen_doorway.gltf`
- `B/wall_modular_tiled_straight_A.gltf`
- `B/wall_modular_tiled_corner_inner_A.gltf`
- `B/wall_modular_tiled_doorway.gltf`
- `H/house.gltf`
- `H/floor_base.gltf`

### 厨房

- `K/fridge.gltf`
- `K/stove.gltf`
- `K/countertop_sink.gltf`
- `K/countertop_straight_A.gltf`
- `K/wall_cabinet_straight.gltf`
- `K/table_A.gltf`
- `K/chair.gltf`
- `K/cuttingboard.gltf`
- `K/pan.gltf`
- `K/pot.gltf`
- `K/kettle.gltf`
- `K/toaster.gltf`

### 卧室和客厅

- `F/bed_double_A.gltf`
- `F/bed_single_A.gltf`
- `F/couch_pillows.gltf`
- `F/armchair_pillows.gltf`
- `F/table_low.gltf`
- `F/lamp_standing.gltf`
- `F/lamp_table.gltf`
- `F/shelf_B_large_decorated.gltf`
- `F/book_single.gltf`
- `F/rug_rectangle_A.gltf`

### 浴室

- `B/shower.gltf`
- `B/bath.gltf`
- `B/toilet.gltf`
- `B/cabinet_bathroom.gltf`，导入前确认是否包含所需洗手池台面
- `B/mirror.gltf`
- `B/bin.gltf`
- `B/towel_blue.gltf`

### 食物和餐具状态

- `R/plate.gltf`、`R/plate_dirty.gltf`
- `R/bowl.gltf`、`R/bowl_dirty.gltf`
- `R/dishrack.gltf`、`R/dishrack_plates.gltf`
- `R/food_dinner.gltf`、`R/food_stew.gltf`、`R/food_burger.gltf`
- `R/food_ingredient_tomato.gltf`、`R/food_ingredient_tomato_slices.gltf`
- `R/food_ingredient_burger_uncooked.gltf`、`R/food_ingredient_burger_cooked.gltf`
- 后续按 `R/food_ingredient_*_{chopped,cooked,pieces,slice,slices}.gltf` 补充少量状态链

### 爱好和装饰

- `G/D6_A.gltf`
- `G/meeple_blue.gltf`、`G/meeple_green.gltf`、`G/meeple_red.gltf`、`G/meeple_yellow.gltf`
- 从 `G/domino_tile_*.gltf` 选择 7 至 10 张，不导入全部换色
- `I/radio.gltf`、`I/frisbee.gltf`
- `N/monstera_plant_medium_potted.gltf`、`N/watering_can_A.gltf`

### 户外

- `H/mailbox.gltf`、`H/package.gltf`、`H/fence_straight.gltf`、`H/gate_single.gltf`
- `P/bench.gltf`、`P/fountain.gltf`、`P/street_lantern.gltf`、`P/trashcan.gltf`
- `P/tree.gltf`、`P/tree_large.gltf`、`P/bush.gltf`、`P/hedge_straight.gltf`、`P/flower_A.gltf`

## UI、状态和 VFX 候选

路径相对 `02_extracted/kenney/`：

- 主状态图集：`kenney_emotes-pack/Spritesheets/vector_style6.png` 与 `vector_style6.xml`
- 无气泡备选：`kenney_emotes-pack/Spritesheets/vector_style8.png` 与 `vector_style8.xml`
- 空闲：`emote_dots3`
- 待完成事件：`emote_exclamation`
- 冲突：`emote_alert` 或 `emote_exclamations`
- 疑惑：`emote_question`
- 疲惫：`emote_sleep` 或 `emote_sleeps`
- 开心、难过、生气：`emote_faceHappy`、`emote_faceSad`、`emote_faceAngry`
- 关系变化：`emote_heart`、`emote_hearts`、`emote_heartBroken`
- 灰尘：`kenney_particle-pack/PNG (Transparent)/dirt_01.png`、`dirt_02.png`
- 蒸汽：`smoke_03.png`、`smoke_06.png`
- 完成反馈：`star_01.png`、`star_02.png`、`light_01.png`
- 冲突反馈：`spark_01.png`

粒子素材必须使用透明版本，并在运行时缩小、柔化和着色。

## 音频候选

路径相对 `02_extracted/kenney/`：

- UI：`select_002.ogg`、`click_003.ogg`、`open_002.ogg`、`close_002.ogg`、`switch_002.ogg`
- 结果：`confirmation_002.ogg`、`question_001.ogg`、`error_003.ogg`、`scratch_002.ogg`、`bong_001.ogg`
- 脚步随机池：`kenney_rpg-audio/Audio/footstep00.ogg` 至 `footstep09.ogg`
- 门：`doorOpen_1.ogg`、`doorOpen_2.ogg`、`doorClose_1.ogg`、`doorClose_2.ogg`
- 读书：`bookOpen.ogg`、`bookFlip1.ogg` 至 `bookFlip3.ogg`、`bookClose.ogg`、`bookPlace1.ogg`
- 做饭：`chop.ogg`、`knifeSlice.ogg`、`knifeSlice2.ogg`、`metalPot1.ogg` 至 `metalPot3.ogg`
- 物品和家具：`cloth1.ogg` 至 `cloth4.ogg`、`creak1.ogg` 至 `creak3.ogg`、`dropLeather.ogg`、`metalClick.ogg`

## 动画候选

第一阶段以 KayKit `Rig_Medium` 为主动画源；Quaternius Standard 只补说话、桌面拿取、推物和少数循环动作。两者都不是当前 Chibi / RG Poly 的原生骨骼，必须经过离线重定向，不能直接替换运行时 clip。

### Life Action 语义映射

| 语义 | KayKit 首选 | Quaternius 补充 | 注意事项 |
|---|---|---|---|
| `idle` | `Idle_A`、`Idle_B` | `Idle_Loop` | 可直接循环 |
| `walk` | `Walking_A/B/C`、`Walking_Backwards` | `Walk_Loop` | 由寻路代码负责位移 |
| `run` | `Running_A/B` | `Jog_Fwd_Loop`、`Sprint_Loop` | 禁用 Root Motion |
| `prepare_food` | `Chop` → `Chopping` | `Work_A/B/C` | 需台面和工具锚点 |
| `pick_up_item` | `PickUp` | `PickUp_Table` | 分地面与桌面目标 |
| `carry_item` | `Holding_A/B/C` | — | 需手持点 |
| `use_item` | `Use_Item`、`Interact` | `Interact` | 通用交互 |
| `discard_item` | `Throw` | — | 只适合扔垃圾，不适合轻放 |
| `sleep` | `Lie_Down` → `Lie_Idle` → `Lie_StandUp` | — | 需床锚点 |
| `sit_chair` | `Sit_Chair_Down` → `Sit_Chair_Idle` → `Sit_Chair_StandUp` | `Sitting_Enter/Idle_Loop/Exit` | 需椅子锚点 |
| `sit_floor` | `Sit_Floor_Down` → `Sit_Floor_Idle` → `Sit_Floor_StandUp` | — | 可用于独处和兴趣行为 |
| `watch_tv` | 坐椅动作链 | `Sitting_Idle_Loop` | 暂无遥控器动作 |
| `read` | 坐椅动作链 | `Sitting_Idle_Loop` | 暂无可靠翻书上半身动作 |
| `exercise` | `Push_Ups`、`Sit_Ups` | — | 可直接形成兴趣行为 |
| `craft_repair` | `Hammer/Hammering`、`Saw/Sawing`、`Lockpick/Lockpicking`、`Dig/Digging` | `Fixing_Kneeling` | 需工具模型 |
| `clean_shared_space` | `Work_A/B/C`、`Working_A/B/C` | `Push_Loop` | 第一版只能近似清洁动作 |
| `greet` | `Waving` | — | 可直接使用 |
| `talk_standing` | `Interact` | `Idle_Talking_Loop` | Quaternius 更自然 |
| `talk_sitting` | `Sit_Chair_Idle` | `Sitting_Talking_Loop` | 对话双方需朝向约束 |
| `listen` | `Idle_A/B`、`Sit_Chair_Idle` | `Idle_Loop`、`Sitting_Idle_Loop` | 采用轻微视线变化 |
| `happy` | `Cheering` | `Dance_Loop` | 与情绪 VFX 联动 |
| `proud_showoff` | `Flexing` | — | 适合搞怪性格 |
| `push_object` | — | `Push_Loop` | 需物件速度同步 |
| `crouch_inspect` | `Crouching`、`Crawling` | `Crouch_Idle_Loop` | 用于检查、维修和寻找物品 |

KayKit `Rig_Large` 生活动作很少，第一阶段不接入。Quaternius 只使用 `UAL1_Standard.glb`，不使用 `UAL1_Standard_RM.glb`，否则动画位移会与 Three.js 寻路位移叠加并造成抖动、穿透或偏离道路。

### 重定向约束

- 以关节旋转通道为主，保留目标角色自身骨长；
- 只保留 root/pelvis 必要位移；
- 坐、躺、取物和工具动作增加臀部、脚部、双手及目标物锚点；
- Chibi 大头短肢比例需要额外 IK 修正；
- 首轮只为一种标准运行时骨骼建立完整动作集，验证后再批量迁移到第二套角色骨骼。

## 已确认缺口

- 电视、遥控器、电脑、手机；
- 扫帚、拖把、海绵、吸尘器、垃圾袋；
- 洗衣机、衣物篮；
- 画架、乐器和更多兴趣道具；
- 空/满垃圾桶、开/关电视、整洁/凌乱房间状态；
- 独立的客厅和卧室模块化墙体；
- 城市、住宅、厨房、浴室、咖啡馆、公园和天空风声环境循环；
- 水龙头、淋浴、冲水、洗碗、煎炒、吃喝、清洁和电子设备声音；
- BGM 与 NPC 非语言声。
- 吃饭、咀嚼、喝水、搅拌、煎炒、端盘动画；
- 洗碗、扫地、拖地、倒垃圾、洗澡、刷牙和洗手动画；
- 阅读、翻书、手机、遥控器及轻放物品动画；
- 拒绝、悲伤、哭泣、愤怒、道歉、嫉妒和尴尬动作；
- 安慰、递物/接物、握手、击掌、拥抱和争执等双人同步动作。
