# LingoLife 免费素材采购清单

- 整理日期：2026-08-28
- 状态：已下载并解压至仓库外暂存目录，尚未导入运行时
- 视觉基准：KayKit / Tiny Treats 低多边形、微缩玩具、温暖配色
- 许可证：本清单中的 18 个下载包均附带 CC0 许可证；正式导入时仍需保留各包原始 `License.txt`

## 目录约定

素材暂存目录采用以下结构：

```text
LingoLifeAssets/
├── 01_source_archives/  # 未修改的官方下载压缩包
├── 02_extracted/        # 按作者和素材包分类的完整解压内容
├── 03_licenses/         # 每个包的许可证副本
├── 04_inventory/        # SHA-256、格式统计和本说明
└── 05_curated_candidates/ # 已筛选的首批模型、动画、UI、VFX 与音效候选
```

原始压缩包和完整解压内容不应直接提交到 Git。项目只导入经过筛选、规范化和压缩的运行时子集。

`05_curated_candidates` 当前约 23 MB，包含 85 组 GLTF/BIN 模型、7 个动画 GLB、45 个 OGG、50 个 PNG、2 个图集 XML、18 份许可证以及独立 SHA-256 清单。所有 GLTF 外部依赖均已验证存在；该目录仍是导入候选，不是最终 Web 运行包。

## 已下载素材

| 来源 | 素材包 | 官方页面 | 下载内容 | 主要用途 | 接入状态 |
|---|---|---|---|---|---|
| KayKit | Furniture Bits | https://kaylousberg.itch.io/furniture-bits | Free | 床、桌椅、沙发、书架等 | GLTF 可筛选导入 |
| KayKit | Restaurant Bits | https://kaylousberg.itch.io/restaurant-bits | Free | 厨具、餐具、食材及食物状态 | GLTF 可筛选导入 |
| KayKit | Forest Nature Pack | https://kaylousberg.itch.io/kaykit-forest | Free | 树、灌木、草和岩石 | GLTF 可筛选导入 |
| KayKit | Character Animations | https://kaylousberg.itch.io/kaykit-character-animations | Free 1.1 | 161 个移动、交互、情绪和工具动作 | GLB/FBX，需骨骼重定向 |
| KayKit | Board Game Bits | https://kaylousberg.itch.io/board-game-bits | Free | 桌游、棋子、骰子和娱乐道具 | GLTF 可筛选导入 |
| Tiny Treats | Charming Kitchen | https://tinytreats.itch.io/charming-kitchen | Free 1.1 | 模块化厨房、门窗、家具 | GLTF 可筛选导入 |
| Tiny Treats | Bubbly Bathroom | https://tinytreats.itch.io/bubbly-bathroom | Free 1.1 | 模块化浴室和卫浴用品 | GLTF 可筛选导入 |
| Tiny Treats | House Plants | https://tinytreats.itch.io/house-plants | Free | 植物、枝叶与花盆组合 | GLTF 可筛选导入 |
| Tiny Treats | Bakery Interior | https://tinytreats.itch.io/bakery-interior | Free 1.1 | 咖啡机、烤箱、柜台和商业室内 | GLTF 可筛选导入 |
| Tiny Treats | Pretty Park | https://tinytreats.itch.io/pretty-park | Free | 喷泉、树篱和公园地面 | GLTF 可筛选导入 |
| Tiny Treats | Pleasant Picnic | https://tinytreats.itch.io/pleasant-picnic | Free | 野餐、分享食物场景 | GLTF 可筛选导入 |
| Tiny Treats | Fun Playground | https://tinytreats.itch.io/fun-playground | Free | 秋千、滑梯和游乐设施 | GLTF 可筛选导入 |
| Tiny Treats | Homely House | https://tinytreats.itch.io/homely-house | Free | 住宅外观、围栏和庭院装饰 | GLTF 可筛选导入 |
| Kenney | Emotes Pack | https://kenney.nl/assets/emotes-pack | 完整免费包 | NPC 情绪、事件和头顶状态 | PNG/SVG 可筛选导入 |
| Kenney | Particle Pack | https://kenney.nl/assets/particle-pack | 完整免费包 | 蒸汽、灰尘、爱心和瞬时反馈 | PNG 可筛选导入 |
| Kenney | Interface Sounds | https://kenney.nl/assets/interface-sounds | 完整免费包 | UI 点击、确认、警告 | OGG 可筛选导入 |
| Kenney | RPG Audio | https://kenney.nl/assets/rpg-audio | 完整免费包 | 脚步、物件和生活 Foley | OGG 可筛选导入 |
| Quaternius | Universal Animation Library | https://quaternius.com/packs/universalanimationlibrary.html | Standard | 通用移动、坐、推和表情动作 | GLB/FBX，需骨骼重定向 |

## 接入分级

### 可直接进入筛选流程

- KayKit 与 Tiny Treats 的 GLTF 静态模型；
- Kenney 的 PNG/SVG 表情和特效；
- Kenney 的 OGG 音效。

进入项目之前仍需统一命名、比例、原点、材质、碰撞体、交互锚点和缩略图，并只保留实际使用的文件。

### 必须加工

- KayKit 和 Quaternius 动画需要重定向到项目选定的标准角色骨骼；
- 坐、睡、使用家具和双人互动必须配置角色与物件锚点；
- 吃饭、喝水、做饭、洗碗、打扫、洗澡及同步拥抱等动作仍需从现有动作派生或补做；
- 干净/脏餐具、空/满垃圾桶、开/关电视等状态需要从现有模型派生。

## 供应链规则

1. 以 `04_inventory/SHA256SUMS.txt` 校验原始压缩包。
2. 每个运行时素材记录作者、官方页面、原包、许可证和派生操作。
3. 优先使用 GLTF/GLB；FBX 只进入离线转换和动画重定向流程。
4. 不把完整素材包、未使用格式和重复贴图加入 Web 首屏。
5. 不混入来源不明、仅限个人使用或禁止商业使用的免费素材。
