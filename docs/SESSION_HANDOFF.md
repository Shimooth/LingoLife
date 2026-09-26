# LingoLife 双设备与 Codex 交接手册

最后更新：2026-09-26（Asia/Shanghai）

这是公司 Mac、家用 Windows 和所有 Codex 会话的唯一交接入口。每次换设备前更新“当前交接状态”，提交并推送本文件；另一台设备只相信远端 Git、当前工作树和实时检查，不根据旧聊天猜测状态。

本文只能记录可提交的非敏感信息。密码、私钥、API Key、Cookie、Token、数据库内容和 `.env` 的值不得写入本文、Git、Codex 提示词或终端命令参数。

Git 提交约定：今后的提交标题与正文统一使用中文，必要的文件名、标识符和产品名保留英文；不重写历史提交。仓库根目录 `AGENTS.md` 同步记录此规则，Mac 与 Windows 均遵循。

## 1. 当前交接状态

### 2026-09-26 发布完成：个人社交、城市视觉与自然动作

- 应用提交 **`d625244907270d180edee7e9bf376a3468270f46`** 已推送 `origin/main` 并部署 VPS，包含以下 9 月 26 日累计实现。该记录为后续纯文档提交，不需要重新部署应用；以下“未提交／未部署”按历史记录理解，以本节为准。
- 本轮重新运行后端全量 **882 passed**；发布脚本从干净提交执行 `npm ci`、完整 lint、typecheck、生产 build 全部通过，保留已有 Three 大包及依赖弃用提醒。打包前检查 103 个暂存文件，未包含环境文件、私钥或数据库；新素材许可仅统一行尾格式，文字不变。
- 线上 `.source-revision` 一致，Compose healthy，启动日志正常；玩家／管理 HTTPS 首页与健康接口均 200，未认证身份／管理用户接口均 401。主页、App／AdminApp／入口 JS 与 CSS、两份生活动作 JSON 的 SHA-256 均与本地生产构建一致。生活模拟开启、开发万能密码禁用。
- 隔离无账号 Chrome 已实际检查线上 1280px 玩家入口、390px 玩家／管理入口，登录表单正常，无脚本错误或横向溢出，并查看截图。没有登录真实玩家、重置数据或主动调用线上 AI；此为发布入口冒烟验收，不冒充完整线上生活玩法验收。动作与车流的连续画面验收见前述本地记录。
- SQLite 在线备份 `/opt/lingolife/backups/lingolife-20260926T151826Z.db`，断网、只读挂载校验 `PRAGMA quick_check=ok`。上一版代码回滚树 `/home/lingolife-deploy/lingolife-releases/rollback-20260926T151824Z`；旧镜像 `9e04c466a68bd1c4f8b73e9d88294d853fe99c748290c2b23b6e812ee2a56a0e`。回滚应用时不要直接覆盖玩家数据库。
- 发布包 `/home/lingolife-deploy/lingolife-d625244.tar`，SHA-256 `091f9d30efe5c0d0b0d0c998f077b6df33c3e3a8b5dc222e717331c27721080f`。既有策略保留最新三个回滚树，本次移除最旧 `rollback-20260919T144148Z` 代码副本；数据库备份和旧发布包未删除。发布后容器空闲快照约 74.24 MiB／384 MiB、CPU 1.29%，不是负载测试。
- 另一台设备执行 `git pull --ff-only` 即可接续；线上刷新即可体验，无需重新创建居民或修改配置。首次旧存档续接可能涉及离线推进，大存档与长时间离线性能仍是后续关注项。本机 Git 身份仍为系统推导值，尚未替用户设置 GitHub 邮箱。

### 2026-09-26 发布准备：个人社交、城市视觉与自然动作

- 用户要求提交并部署本地累计改动：个人视角与持续社交、创建时的内心设定、全城车流／停车避障、街景与建筑细节、咖啡馆共同饮品，以及两套角色的落座、端杯、说话倾听和椅边换步。以下各轮“未提交／未部署”为当时记录；最终发布结果另行记录。
- 发布前已核对远端 `main` 与本地基线一致，另一台设备没有新增提交。SSH 通过现有 macOS 钥匙串直接连接，无需重新提供私钥口令；VPS 旧版为 `8779fb9`，服务健康，磁盘剩余约 7.1 GB。
- 使用已提交源码的本地生产构建包，上传后核验 SHA-256，再走现有数据库在线备份和自动回滚流程。不会重置账号、存档、邀请码或修改生产环境秘密；开发万能密码不随发布包启用。
- 本次发布前重新执行后端全量 **882 passed**（87.25 秒），前端完整 lint／typecheck／生产构建通过，保留既有弃用和大包提醒。提交检查发现新许可文件的原始 CRLF／行尾空格，仅做格式统一并同步导入脚本、许可证哈希，不改许可文字或动画内容。

### 2026-09-26 本地动作继续打磨：交谈、倾听与椅边换步

- 接入本机已下载且附带 CC0 许可的 Quaternius 站立／坐姿说话动作，仅打包双臂所需数据（99,340 bytes），保留许可证及可复现导入脚本。按真实骨段方向适配 City／Chibi，运行时只覆盖六条上臂、前臂、手腕旋转，不替换骨盆、腿、头部或人物外观。来源与边界见 [动作素材计划](CHARACTER_MOTION_ASSET_PLAN.md)。
- 生活片段发言时平滑加入手势，倾听时退回克制待机并在新一轮回应时轻点头；最后一句的文字继续保留，但动作按句时长结束。相同片段轮询不重播。City `Idle_B` 会大幅摆臂，`Idle_A` 虽手腕安静但肘部不停循环，因此改用 `Idle_A_Pose`；Chibi 用 `anim_iddle.001`。原生与生活控制器均在保存未修正姿态后叠加手势，避免越播越扭。
- 共享饮品中的手势只在邀请、等待和坐谈时启用；伸手、持杯、饮用、起身、走路由物体接触优先，不同时播放摆臂说话。椅边转身加入两次交替抬脚／落脚、支撑脚世界位置约束和有限重心转移，不拉长骨骼。
- 连续浏览器检查抓到三项仅看静态图或求解器单测无法发现的问题：首次生活动画加载耗掉转身大部分时长；切换的两帧混合额外压低鞋底；近乎伸直的原始膝盖使弯曲方向不稳定，脚踝突然拧转。分别用演出前准备素材／模型就绪后推进计时、保留末帧行走时间并先锚定可见脚位、连续膝盖弯曲方向修复。没有放宽原接触和关节角速度阈值。
- 转身真实浏览器八段通过，支撑脚区间漂移低于 6mm；City 原生行走末帧约 9.7mm 的鞋底接触误差在转身中平滑消除，没有宣称所有原生行走都已贴地。连续喝饮品 City 918 帧／Chibi 923 帧通过，实际杯口／脸面误差约 6.1mm；九组实时离席和两套角色 × 两类家具四组真实坐姿回归通过。实际侧面臀腿支撑误差仍约 0／1.84mm，没有退回半站姿。
- 前端完整 lint、类型检查和生产构建通过，保留已有大包警告；真实骨架上身动作、80 组转身／交接及原生姿态无累计污染检查接入 lint。最终浏览器四组桌面站谈／坐谈、两组减少动态效果、Chibi 390px 站谈／坐谈均通过；实看桌面和窄屏截图。发言结束约 0.56～0.73 秒内双手回到安静姿态附近，坐谈不改变腿部落座。这不代表手机真机 GPU 或真实 AI 台词质量验收。
- 本轮仅覆盖生活片段的站谈与共享饮品坐谈／转身，**不是所有玩家聊天、全城足部 IK、手指握紧、唇形同步、阅读／吃饭／做饭动作均已完成**。没有修改后端、账号、数据库或 AI 预算。**未提交、推送、部署**，保留此前其他工作树改动。
- 无需账号预览：[站立交谈](http://127.0.0.1:5173/scripts/fixtures/social-motion.html?case=standing)、[坐姿交谈](http://127.0.0.1:5173/scripts/fixtures/social-motion.html?case=seated)、[完整入座](http://127.0.0.1:5173/scripts/fixtures/social-motion.html?case=arrival)。顶部可换人物、重播或收尾离开；入口使用虚构事实和手写 QA 台词。详见 [饮品演出与复验命令](SHARED_DRINK_PRESENTATION.md)。

### 2026-09-26 本地坐姿纠正：实际落座，不再半站

- 用户指出“没有完全坐下来”，本轮低机位侧面复查确认上一轮验收遗漏：`Hips` 固定偏移不是可见臀部；旧 `groundSeatedFeet` 为让短腿碰地，把原本近水平的大腿拉成约 68°（City）／36°（Chibi），不能用手杯接触通过代替坐姿通过。
- `LifeRigAnimation` 改用 `seatedContact.ts`：按实际可见臀部和近端大腿皮肤支撑座面，保留原屈膝动作；短腿可自然悬脚，只处理鞋底穿地，不移动子骨位置或拉伸骨骼。Chibi 候选包含真实股骨权重，修掉独立复验抓到的 34mm 臀腿过渡穿垫；裙摆不作为身体支撑。支持坐下／起身权重连续进入退出。
- 住宅 `armchair_pillows` 真实原始座面为 0.5，默认缩放后的 0.400 已修正；咖啡馆自建座面仍为 0.388。正式演出及布局测试同步，不靠改用户人物／家具尺寸解决。
- 独立浏览器直接测量真实关节、皮肤与实物家具射线：City 大腿约 1°／膝约 110°，Chibi 大腿约 6°／膝约 115°；近臀身体到实座面误差分别约 0／1.83mm。两类人物 × 咖啡馆／住宅四组通过并实际查看侧面截图；住宅扶手会遮臀腿，无遮挡咖啡侧面与同模型几何共同验收，没有隐藏实物家具制造通过。
- 新 `check-seated-contact.mjs` 接入完整 Web lint，覆盖 City-01／03、Chibi 所选 student／traveller、两种家具、低椅鞋底与连续权重。旧三项手杯检查迁移正式求解器，取消错误脚踝贴地标准；保留手杯 <12mm、骨长与 Chibi 头桌 >80mm。最终前倾保持 .45rad，真实最小头桌净空咖啡约 105.8mm／住宅约 125.8mm，完整坐姿周期可够杯柄。
- 最终前端完整 lint、类型与生产构建通过（保留既有大包提醒）。浏览器完整播放覆盖两类演员从走近到倾听、实际阶段切换后的起身离开，以及跳过坐稳直接回看；手杯仍对齐，最后九组中途离席回归也通过。此前测试页在并行抢焦点时，固定延时可能读到旧时间帧，已改为切到前台并等待双方实际到达目标帧，保留原误差阈值。侧面验收及 390px 构图不是移动真机性能测试。
- 无需新素材，本轮只修共享饮品演出的座椅接触，并非已为所有通用室内动作加入全身 IK。**未提交、推送、部署**，保留其他本地未提交改动；无后端／账号／存档变更。
- 侧面复验：`cd web && node scripts/check-seated-browser.mjs`（需本地 Vite、隔离 Chrome CDP 19226）。无需账号的连续回放：`http://127.0.0.1:5173/scripts/fixtures/embodied-life.html?venue=cafe`。详情见 [饮品演出](SHARED_DRINK_PRESENTATION.md)。

### 2026-09-26 本地动作打磨：连续播放、自然手杯接触与实时收尾

- 本轮按用户同意的动作优化方案实施，三条子代理分别检查播放连续性、真实手臂接触和本地素材。**未提交、推送、部署**，此前所有社交／交通／美术改动保留；没有清库、读取密码或调用真实 AI。
- 共用原生／生活动画控制器新增可见姿态交接、连续时间和变速播放，修复换片段时旧动画读取新时间导致的单帧大跳；取消错误的坐姿小段时钟重置。性能修正每帧从原动画姿态重新施加，头和手腕不会累计扭转。
- 咖啡馆／共享住宅的饮品演出加入走停、转向、坐稳、弧线伸手、视线和克制倾听；按真实骨架标定 City `Walk_B`／Chibi 的距离步相。采用有限范围的自然手臂 IK，身体、杯柄与腕方向统一；动作目标／骨骼／杯子的帧顺序固定，解决实物杯跟手延迟。连续采样还抓到 Chibi 退手目标越过肩线的问题，已改回身侧，不用骨骼拉伸或加大阈值掩盖。
- 服务端阶段刷新不再重新挂载演员；中途离席从当前走位和持杯高度衔接，已经落桌的杯子不会重新举起。文档与入口见 [饮品演出](SHARED_DRINK_PRESENTATION.md)，新增 [动作素材盘点与接入计划](CHARACTER_MOTION_ASSET_PLAN.md)。没有新增付费资产或增加运行时动画包。
- 最后增加独立的嘴位校准后，抓到旧“行走时缓存嘴锚”的假阳性：连续播放杯口实际曾侧偏约 309mm，固定姿势截图和同一缓存自对照没发现。已改为在生活动画原始坐姿上、前倾／低头之前测量，也覆盖从取杯阶段直接打开的回看；QA 另建骨架副本校准标准嘴位再映射到实时头部，不读运行时缓存、不改 live 骨架，避免用随低头／转头变化的世界水平射线当作固定嘴位。最终 City 919 帧／Chibi 920 帧，各 216 个饮用采样，杯口误差约 6mm；跳过坐稳直接回看也低于 20mm，杯子同帧跟手无延迟。咖啡近景转为更可读的双人侧视角。
- 前端 lint／类型检查／生产构建通过（保留既有大包提醒）；新真实骨架连续性、接触和生命周期专项已接入 lint。隔离浏览器 12 组画面检查、9 组实时中断检查通过，并对连续动画进行逐帧轨迹检查。实际查看 City 桌面与 Chibi 手机截图；不是移动真机性能测试，也不是 AI 台词验收。此次仅改前端，后端 882 passed 是上一轮结果，未冒充本轮重新执行。
- 本地无需账号的完整回放：`http://127.0.0.1:5173/scripts/fixtures/embodied-life.html?venue=cafe`，顶部可换人物、事实阶段和重播。不要带 `time` 参数观看连续动作；`time=6.5` 只用于固定姿势。没有新增独立产品路由，正式活动仍走原游戏入口。
- 明确边界：尚未导入 Quaternius 更自然的坐姿／站立说话片段；没有专门起步／收步／转身素材、全身足部锁定、手指握紧或任意物体抓握。该轮首先打磨一个完整场景，不能宣称所有生活动作都达到相同质量。

### 2026-09-26 本地视觉升级：立面、街角和咖啡馆共同活动

- 用户要求继续实现视觉建议，使用三条子代理分别负责立面／灯光审查、街景避障和真实咖啡馆共同活动。**未提交、推送、部署**；此前社交重构和交通修复全部保留，没有登录或重置玩家、读取密钥或调用真实 DeepSeek。
- 8 种 KayKit 楼体新增贴合真实墙面的侧／背窗、窗台和落水管，晚间部分窗暖光；白天暖主光／冷填光、地台重新配色。新默认街区有高低主次，管理员既有布局不重排。新增细节批处理，低档保留窗框玻璃。
- 默认地图新增 54 地块铺装、6 连接步道、2 咖啡馆外摆和 2 小树池，真实 glTF footprint 避让现有路、楼、道具和停车；无安全位置则不放。两处外摆共用近景桌椅 rig，室内居民不在地图重复显示；不是全城路网或所有空地的重做。
- 两名居民实际同在咖啡馆、空闲、有饮品兴趣且愿意时可触发共同喝饮品；沿用邀请／等待／参与／完成／拒绝／中断／错过的事实链和既有 AI 预算。工作、吃饭、不同地点、赶路不会套此演出；旧住宅活动及管理员不兼容家具降级仍保留。
- 修复布局异步变大导致实例缓冲区不足、建筑仅剩标签的问题；数量变化时必要重建，视角或选择变化不重挂。实看补修双人离场构图、喝杯穿头／被手完全挡住，以及 Chibi 默认发型未隐藏导致的斑驳。新增 `sharedDrinkContact.ts` 按真实蒙皮表面校准杯口，骨骼不拉伸；不改变用户保存的发型，6 种发型×戴／不戴头盔回归通过。
- 验证：Python 3.12 后端全量 **882 passed**，新增地图／咖啡馆专项 **16 passed**；前端 lint、类型及生产构建通过（保留 Three 大包提示）。隔离 Chrome 实际渲染城市桌面／390px 低档／傍晚／减少动画四组，以及咖啡馆七阶段／两套人物／窄屏；此前交通六组浏览器回归也通过。杯口与真实面部接触的数值回归误差小于 3mm，并看过修正后截图；不宣称手机真机 GPU 已达标。
- 无账号查看：`http://127.0.0.1:5173/scripts/fixtures/traffic-city.html?source=production`；人物近景 `http://127.0.0.1:5173/scripts/fixtures/embodied-life.html?venue=cafe`。夹具使用静态世界几何和手写 QA 对白，不是 AI 输出质量证明。范围与复现命令见 [视觉升级记录](VISUAL_NEXT_STAGE.md)。

### 2026-09-26 本地修复：全城车流、云路出口与停车穿模

- 用户线上观察到仅左侧车辆运动、无进出城车流、穿过静态车。本轮并行修复并做本地实际渲染验收，**未提交、推送、部署**；此前 NPC 个人视角重构等工作树改动全部保留。
- 只读公开线上地图确认 100 块道路及三辆路中静态车，没有登录、读取账号或改写发布配置。根因是 authored 道路丢失出口语义，加上旧逻辑只生成首个环路。
- 默认发布布局现有 16 条路线覆盖 100 块道路，三个云路出口双向通行；高／低档分别最多 28／20 辆。增加车体间距、路口预约和出口空间检查，端部透明淡出；轮胎按 glTF 实际底部对齐道路，局部云团遮住截断。
- 旧已发布布局的非法道路停车仅在渲染时过滤；合法停车保留。后端只改新默认停车位置与高度，无配置迁移、无玩家数据修改。非平面／异形缩放道路暂不加入交通图。
- 20／28／32 辆各 10 分钟模拟，合计 1,034 次行程无车体碰撞、无一分钟死锁；浏览器六场景通过，桌面与 390px 低档实际可见全城车流并已检查截图。前端 lint／typecheck／build 及布局相关后端 **63 passed**。本轮没有重跑所有生活模拟业务测试；上一轮 866 passed 为其当时结果。
- 入口、边界与复现见 [城市车流验收](CITY_TRAFFIC_QA.md)；无账号预览 `http://127.0.0.1:5173/scripts/fixtures/traffic-city.html?source=published`。手机预览不是移动真机性能测试。

### 2026-09-26 本地重构：个人视角与持续社交

- 用户要求先实现“把 NPC 作为人”的重构，再讨论事件丰富度。本轮为本地第一版，**未提交、推送、部署**；线上仍以前述已发布版本为准。保留账号、密码、居民、历史、数据库；没有读取密钥、调用真实 DeepSeek 或重置测试账号。
- 新增 `social_mind.py`：个人价值/自我形象、真实事实与各自见闻、方向性解释。新增 `social_continuity.py`：有限心事、基于关系与见闻选人、实际再次会面、承诺回执、单跳公开转告。规则与现有世界转换共用时钟，没有第二个 AI 自主循环。
- 借物等部分冲突、帮助、错过与邀约可以产生后续；对方可听取、知悉、推迟或保持距离。未到场不谈话、遗忘来源不复活、听到解释不自动原谅。双方实际共同完成才记兑现承诺并给一次性小幅信任证据；拒绝或错过不自动判定背叛。
- 创建居民/角色工作室复用「内心设定（选填）」：六项价值最多选三项并按选择顺序排序，另有自我形象。中英文跟随界面设置；旧资料无需补填。修改即时影响后续认知，保留旧片段冻结视角。
- AI 表达接入发言者自己的安全视角，保留原调用次数、缓存、流式与翻译；历史片段去掉当前关系印象，避免昨天对白提前知道今天的恋爱关系。私人心事不直接提供给玩家；公开转告的不在场人物只提供冻结 ID/姓名，不变成额外说话人。
- 设计与边界见 [个人视角与持续社交](NPC_PERSON_SOCIAL_REFACTOR.md)；NPC 主设计和玩家旅程已增加本轮入口，旧图片未重新生成。尚无自由 AI 长程规划、群体规范、多跳传闻、新动作或全部个人目标玩法，不能将它们标记完成。
- 确定性虚构探针：4 人 48 小时有 153 次完成行动、81 个碰撞片段，其中 15 次有来源续谈和 1 次公开转告；8 人 168 小时有 1049 次完成行动、593 个碰撞片段，含 128 次续谈、16 次转告，8 次真实兑现、19 次错过、2 次尚在约定中。日常 solo 另计；玩家展示仍有关注筛选，不会把所有片段逐条推给玩家。数量不代表剧情或台词质量达标。
- 性能观察仅来自本机虚构纯规则探针：8 人一周离线推进约 18 秒（与测试并行时测得），完整状态 JSON 约 6.95 MB、历史保留 360 条、事实 128 条。不是线上压测；后续上线前应关注大存档保存与离线追赶延迟，优先去重复快照/分层存储，不通过伪造事件或缩减美术解决。
- 新回归覆盖知情隔离、三人链、丢弃记忆、真实约定、拒绝边界、旧存档/编辑即时刷新及按 7 段在线推进与一次离线推进一致。旧 `test_life_api._install_open_story` 曾在随机账号和晚间初始化时错误假定“赶路中也已有碰撞”，旧版 baseline 同样可复现；改成明确到场后调用生产检测，保留授权/干预断言并补三个时段。
- 前端完整 lint、typecheck、生产 build 通过，保留已有 Three 大包警告；隔离 Chrome 实际验证选填折叠、三项上限与顺序、切换居民不串值、自我形象输入、390×844 触屏布局、中英文标签和最终表单内容，并实看截图。预览不写账号，不代表移动真机性能或真实模型对白试听。
- 最终冻结后全量后端 **866 passed**（78.57 秒，保留 Starlette 弃用警告），前端完整 lint/typecheck/build 与 diff 检查通过。复现命令和隔离预览入口见设计文档；没有为本轮启动/重启真实后端。跨设备续接前仍需用户授权提交推送，本地未提交内容尚不在另一台机器上。

### 2026-09-20 发布完成：入住修复与关系区域精简

- 最终应用版本 **`8779fb9d132843da3bb44d5ab206043cee55fc98`** 已推送并部署，覆盖中间版本 `b69bc3a`；包含可选成员关系、旧账号入住续接、翻译回填兼容及中英文多余说明删除。下面的“未部署”是各轮当时记录，以本节为准。
- 全量后端 **784 passed**，发布脚本重新 npm ci、lint、typecheck、build 通过。正式镜像在断网、只读根文件系统、临时内存目录中复制最新 SQLite 备份，**3 个待入住账号副本**分别确认 complete=201、同请求重试=201、city=200；原居民档案、消息、记忆逐行保留。没有挂载生产数据库、使用生产登录会话或调用 DeepSeek；不是直接替玩家完成线上入住。
- 线上 revision 一致、Compose healthy、启动日志正常；玩家和管理 HTTPS 健康接口均 200，玩家入口和 App JS/CSS 与本地构建哈希一致，已删除的解释句不在运行时 App 包中，未登录身份／管理用户接口均 401。未做本轮完整线上浏览器操作，关系界面的实际交互验收为前述本地隔离预览。
- 最新数据库备份 `/opt/lingolife/backups/lingolife-20260920T023241Z.db`，隔离验证前 quick_check=ok；本轮首份备份 `/opt/lingolife/backups/lingolife-20260920T022232Z.db` 也保留。最终发布前代码回滚树 `/home/lingolife-deploy/lingolife-releases/rollback-20260920T023239Z` 为中间版；若需退回本轮之前的 `cd11f15`，使用 `rollback-20260920T022230Z` 及对应旧发布包。不要因应用回滚直接覆盖玩家数据库。
- 最终包 `/home/lingolife-deploy/lingolife-8779fb9.tar`，SHA-256 `36d7ce0c2f7130d5b624d5a3e94a5b29ffe0b3671e80cc534ae671df603e6f89`；此次补丁用 SSH rsync 增量传输完整包后仍校验全包 SHA。中间包 `lingolife-b69bc3a.tar` 保留。发布脚本仅保留最新三个代码回滚树，清理旧 `rollback-20260904T095552Z`、`rollback-20260906T173607Z`；数据库备份没有清理。服务器的 `lingolife-onboarding-probe-db.py` 仅为隔离测试用源码，不是运行服务文件，不含账号数据。
- 另一台设备 `git pull --ff-only` 即可接续；用户刷新线上页面后按正常入住流程操作，无需清库、重设密码或手动修改引导标志。此发布记录为后续纯文档提交，无需重复部署。

### 2026-09-20 发布准备

- 首次发布 `b69bc3a` 后，用断网容器中的线上备份副本验收发现：旧迁移盘点的消息哈希早于中文翻译回填，完整性检查误报。追加补丁把保护基线固定在本次入住开始时；原迁移盘点仍保留，新基线跨中断重试保留，成功后移入审计并从引导状态移除。实际旧消息没有被此次入住改变。新增用例后全量 **784 passed**；不以首次健康检查代表业务修复成功。
- 用户要求提交并部署上述入住修复和可选关系设置，并追加删除关系区域的中英文解释段落；页面只保留标题、选填标记和操作控件。保留必要的错误反馈和旧存档保留说明，不改变关系规则。
- 按干净 Git 提交打包、校验、线上数据库备份与现有自动回滚流程发布，不重置任何账号。实际发布结果见后续完成记录。

### 2026-09-20 本地修复：旧账号入住冲突与可选成员关系

- 线上只读诊断：09:09:46（北京时间）`POST /onboarding/complete` 返回 409（103 bytes）；两份单居民旧存档同时具有旧 `completed=true` 和迁移 `needs_onboarding`。隔离复现得到相同 `ONBOARDING_ALREADY_COMPLETED`，并非 AI 等待或服务器性能不足。
- 修复仅允许通过完整性检查的不足两人旧阵容续接初始化；保留原居民、消息和记忆，完成时原子同步迁移 ready、活跃名单与审计记录。失败可用同一请求重试，不重复创建；超容量或完整性失败的管理员审查不能绕过。介绍确认不再制造兼容 Emma 的孤立数据。旧账号在当前创建页新增一批居民，原有居民额外保留并计入总上限，页面有说明。
- 初始创建合并为「与其他成员的关系（选填）」：默认空白，主动选择成员后添加、编辑、移除；切换居民显示同一条关系，亲属自动保存反向角色。不要求逐对填写。自定义背景通过 `personal_connection` 保存到实际双方合同，不直接设置关系数值或绕过正式恋爱同意。原有每人 4 条背景、全组 12 条背景容量限制仍保留；单人工作室可读取／编辑新的背景类型，正式亲属编辑权限不扩张。
- 入住请求增加 45 秒上限、地图布局读取 8 秒上限及中文错误；已完成的跨设备重复提交重新读取账号状态。新增 7 项回归，后端全量 **783 passed**，前端完整 lint／类型检查／构建通过。浏览器扩展通道超时后改用原生 Chrome 验收，实际点击空关系提交、添加中文「死党」、切换双方、亲属反向和移除后再次零关系提交均通过，并实看关系卡片；使用隔离预览，无账号或 AI 写入，不宣称手机真机验收。
- 本轮仅本地实现，**未提交、推送或部署**，没有修改线上账号／密码／存档。线上仍为 `cd11f15`；部署后旧账号按正常界面完成入住即可，不需要手动清库或改标志。前端预览运行于 `http://127.0.0.1:5173/`，后端 API 验收使用临时测试数据库。

### 2026-09-19 发布完成

- 应用提交 **`cd11f159390e0d4eff30b30d952d0fcb6d7fb697`** 已推送 `origin/main` 并部署 VPS，包含以下本地累计改动；本记录为后续纯文档提交，不需要重新构建应用。另一台设备 `git pull --ff-only` 后即可继续开发。
- 发布脚本重新执行 `npm ci`、完整 lint、类型检查及生产构建通过；后端全量 **776 passed**，额外对白加载／共同喝饮品／室内布局／两套真实骨架接触／表情／说话倾听检查通过。仍有已有 Three 大包警告。
- 线上 `.source-revision` 一致，Compose healthy，启动日志无错误；玩家与管理 HTTPS 首页／健康接口均 200，玩家首页及 App／入口 JS、CSS 的 SHA-256 与本地构建完全一致；未登录玩家身份／管理用户接口均 401。生产生活模拟启用、开发万能密码禁用，记忆筛选每日预算为每账号 8 次、全服 200 次。
- 此轮浏览器入口验收工具超时，未完成线上交互验收；未登录真实玩家、未重置数据、未主动调用线上 DeepSeek，不把 HTTP／资源校验当作完整玩法验收。前述本地浏览器与真实 AI 验证仍为本地结果。发布后空闲容器快照约 81.79 MiB / 384 MiB、CPU 0.35%，不是负载测试。
- 数据库备份：`/opt/lingolife/backups/lingolife-20260919T144150Z.db`，只读 `PRAGMA quick_check` 为 `ok`；上一版代码回滚树：`/home/lingolife-deploy/lingolife-releases/rollback-20260919T144148Z`；旧镜像：`4069a2462096b961194b845a5a3331339e8d726f54b3949d14df65df7246d104`。
- 发布包：`/home/lingolife-deploy/lingolife-cd11f15.tar`，SHA-256 `c5cec6bcd0a27d7194d9b2e798d677f3b51e5780d147fe6cf760dd318ec08883`。既有发布脚本保留最新三个代码回滚树，清理了最旧的 `rollback-20260904T011513Z` 副本；未清理数据库备份或玩家数据。

### 2026-09-19 发布准备：生活表现、共同活动与 NPC 记忆

- 用户已明确要求提交并部署本地累计修改；包含此前视觉优化、对白加载修复、简洁结果提示、中文随机资料、共同活动／客厅双人表演及双向主观记忆。以下历史“未提交／未部署”描述为各轮当时状态，最终结果以本节后续发布记录为准。
- 发布前重新执行 Python 3.12 后端全量测试：**776 passed**。生产继续使用 Docker Python 3.12，开发专用万能密码哈希、环境文件、虚拟环境与本地存档均不进入发布包，不更改线上账号密码。
- Git 远端已检查，无另一台设备新增提交。VPS 当前旧版为 `b37d83b`，磁盘剩余约 7.9 GB；使用现有发布包校验、SQLite 在线备份和自动回滚流程，不重置玩家数据。
- 本机 SSH agent 暂无身份；显式 `ssh -o BatchMode=yes -o UseKeychain=yes lingolife-vps` 已成功使用现有钥匙串连接。不需要复制私钥或把口令写入项目；Windows 不使用该 macOS 专用选项。

### 2026-09-19 最新本地进展：双向主观记忆与持续遗忘

- 移除普通 NPC 片段“记下这一刻”，看完自动写玩家已看标记（不写 NPC 记忆）；新手引导改“查看结果”，实际浏览器验证能到“完成引导”。
- 新增 `pair_memory.py` 和 `pair_memory_service.py`。真实结算自动形成方向性短期印象，后台 AI 按 owner 人格／关系筛选 discard/recent/lasting；不改事件事实或关系数值。每个方向近期 12／深刻 6、同题材每层 2，3 天淡化、14 天忘普通事、30 天深刻经历留大意。
- 游戏确定性转换做时间压缩；活跃用户由 lifespan 后台批处理，离线回来补算。默认每用户每日 8 次、全服务 200 次筛选（独立预算），AI 不持有世界锁；版本合并、重置迟到回包、重复缓存与失败降级有保护。`PAIR_MEMORY_DAILY_LIMIT=0` 可关 AI 筛选但保留时间压缩。
- 后续 NPC 对话和碰撞回应只检索仍可回忆内容；不从旧 memory_seeds 重新恢复忘掉的细节。对白排除当前事件及该片段之后的新事件。整体关系、未解决问题及历史回放不删除。
- 核心设计与局限见 `docs/NPC_PAIR_MEMORY.md`，NPC设计主文档／玩家旅程／引导文档已同步。结构化压缩，不是AI反复改写长摘要；本轮不重构玩家个人信息记忆。
- 已完成后端全量 **776 passed**，覆盖并发合并、超时降级、对白投影、离线重要记忆和关系转折；共同活动最终阶段接入后专项 **42 passed**。前端 lint/build 通过；本地后台缓存已有 6 批 source=ai 的真实记忆筛选，已确认AI选择写回世界状态，没把规则降级当AI成功。未提交、推送、部署或重置账号。此前未提交改动全部保留。

### 2026-09-19 最新本地进展：并行完成客厅双人表演样板

- 按用户授权使用三条子代理，分别完成实际骨架／道具接触、原生眼睛表情、室内布局与实况接入；主线程接玩法、对白事实合同、信息布局及浏览器验收。范围详见 `docs/VISUAL_NEXT_STAGE.md` 新增落地节。
- 新增 `drink_break` 真实共同活动：明确饮品兴趣、公共客厅、真实参与后才能完成。七阶段服务端 `presentation.staging` 驱动表现；AI 不能改参与者或结算。拒绝、过敏／戒饮品、旧同意回放、旧完成回放和旧存档兼容均有测试。
- 生活片段和住宅实况复用 `SharedDrinkPerformance3D`；数值检验真实 City/Chibi 骨架的手杯与足部目标，不靠截图假定接触。管理员不兼容编辑布局降级普通行为，不改数据库布局。
- 默认客厅桌椅比例／取物点校准；通用对话分说话和倾听，移除挡表演的大摘要。12款City支持原生眼形；4款不适配City原样保留，Chibi在CUA发现眼窝问题后禁用压眼／眨眼。无嘴型同步；并非所有角色／场景的美术已统一。
- 本地后端全量 **754 passed**；前端完整 lint、类型检查、生产构建和 diff 检查通过，保留 Three 大包提示。桌面／Chrome 390×844 已实看邀请、参与、拒绝、两套角色、住宅实况／定位及近景眼睛；发现并修复邀请穿椅、Chibi眼窝、窄屏溢出和独立住宅姓名样式未加载。未宣称手机真机性能达标。旧环境／数据保留。本轮未提交、推送、部署或重置数据。

### 2026-09-19 最新本地进展：对白加载恢复与短结果提示

- 视觉现状、后续优先级及验收标准见 `docs/VISUAL_NEXT_STAGE.md`。本轮主要修加载和结果展示，未宣称完成新的美术／动作重构。
- 本地 Python 3.9 后台出现数据库相关请求阻塞，原生采样多个线程停在系统 SQLite 的 `purgeableCacheShrink`；健康接口正常并不能证明账号／对白可用。已使用本机现有 Python 3.12 创建 `backend/.runtime/.venv`，SQLite 3.53.2，安装项目声明依赖并重启 reload。旧 `backend/.venv` 和存档保留。`backend/.venv/bin/python backend/scripts/dev_server.py` 会在旧版本下转交新环境；也可直接运行 `backend/.runtime/.venv/bin/python backend/scripts/dev_server.py`。新环境忽略不提交，跨设备应按项目版本要求重新创建，Windows 不使用 Mac 的虚拟环境路径。
- 旧存档居民缺可编辑资料时，物品标签回填曾触发 KeyError；已兼容而不删历史居民。旧账号事件列表实测 200，40 个有限并发账号读取全为 200。系统 SQLite 阻塞的底层触发条件仍未完全确定，不把一次环境更换当作长期压力测试。
- 前端对白请求统一 60 秒上限；支持跳过／失败／手动重试，拒绝过期结果；服务端版本变化不再反复轮询旧版本；回调引用改变不重启计时。轮询重试任务仅首次携带 retry，防止轮询自动授权下一次生成。
- 移除生活片段底部结果卡和强制滚动，最后一句后显示短结果通知，约 6.5 秒收起、可关闭、悬停／聚焦暂停；优先实际活动／关系／资源事实，不拼接重复意图。拒绝／负面结果保留，当前标签页同一结果去重；引导仍需明确点击完成。历史数据保留，刷新页面后提示记录重新建立。
- 验证：Python 3.12 环境全量 **709 passed**；新增无响应、pending 超时、版本错位、取消、晚回包、明确重试与付费轮询保护、结果文案／去重守卫。真实浏览器已收到并播放一条 4 句 AI 场景，缓存 source=ai；未重置账号。桌面及 Chrome 390×844 预览检查短提示、双语对白、取消等待；控制台只有 Three Clock 弃用警告，无红色报错。尺寸预览不是手机真机性能验收。
- Web 全量 lint、类型检查／生产构建及 diff 检查通过；仍有 Three 主包体积提示。本轮未提交、推送或部署。无账号验收页 `web/scripts/fixtures/life-dialogue.html` 可手动切换正常／断网／无响应、模拟世界刷新及回看。保留其他轮次的所有未提交改动。

### 2026-09-19 后续本地小改：对话气泡距离与中文默认资料

- NPC 气泡改为紧贴投影人物左上侧，而非固定在画面左边／顶部。窄屏锚定气泡下边缘至人物头顶上方；流式内容增长或展开翻译时仍贴着人物，长内容保留内部滚动。气泡尖角指向人物，并平滑跟随位置变化；减少动态效果设置有效。
- 12 套新人随机预设的所有自然语言资料改为中文（包括姓名）；新增、单人重抽、全部重抽都复用这些资料。普通角色工作室的默认资料也改为中文。字段名、枚举、模型 ID 保持不变；已有角色和用户手写内容不被覆盖，NPC 对话仍为英文。
- Web lint／构建及完整前端守卫通过，新增近身间距、窄屏底部锚点、不同文本高度及全部预设中文检查。桌面实际看过气泡与展开翻译的构图；本轮手机浏览器验收因原生 UI 工具无响应未完成，不能当作移动真机验收。新增无存档写入的 `scripts/fixtures/onboarding-preview.html` 方便后续复查创建界面。
- 本轮未改后端、未重置数据、未提交／推送／部署。以下共同活动是上一轮实现，仍保留在工作树中。

### 2026-09-19 最新本地进展：共同活动与进出城车流

- 本轮用户要求优化事件玩法并增加城市车流；**未要求提交、推送或部署**。保留此前未提交的视觉、AI 表达、本地登录及界面精简改动，不重置账号或数据库。
- `shared_activities.py` 接入三种有真实行动的住宅共同活动：一起阅读、带对方试爱好、共同练习。经历邀请／等待／参与／完成或中断，只有两人真实行动完成且重叠参与至少一分钟才算完成。角色兴趣、已有安排和意愿优先；结果影响后续邀请冷却及活动／题材选择。普通重复片段增加人物组合／账号主题展示预算，仍保留后台结算和升级事件。
- 公开状态、生活片段结果、AI 的事实和身份约束同步活动阶段；室内复用阅读及练习动作，选中居民的头顶状态说明共同活动对象。详见 `docs/LIFE_FEEDBACK_AND_PRESENTATION.md` 的「共同活动与城市车流」。
- 车流默认 **18 辆**：12 辆往返东西／北部三条出入口，6 辆城内双向循环；从真实连通道路求路，编辑后无通路不发车。仍是环境动画，尚无完整路口让行或车间碰撞系统。
- 验证：Backend **708 passed**（含 17 个共同活动／重复预算用例），Web lint/build 和 diff 检查通过。三种活动真实引擎行动链、拒绝／中断、离线与在线一致性、重复结算和 30 天容量验证通过。长测改为检查整个运行期间真实发生的冲突证据，不强求温和角色在第 30 天结束时仍在争执；不是关闭冲突检查。
- 桌面浏览器实际看过城市进出车流、手动镜头及室内共同阅读选中状态，无脚本错误。视觉夹具支持 `scripts/fixtures/visual-review.html?activity=read` 或 `?activity=practice_hobby`，使用虚构居民、无认证、无 AI／存档写入；夹具不是端到端服务端玩法测试。本轮未做移动真机性能或真实 AI 台词质量抽检；Three 大包体积提示仍存在。
- 本地 Vite `http://127.0.0.1:5173/` 和后端 `http://127.0.0.1:8000/api/v1/health` 已确认可用，后端开发启动器继续 reload。历史片段不会被改写，更新后自然产生的合适机会才启用新活动。

以下表格为此前各轮记录，按日期和上面的最新进展理解，不代表本轮又执行过其中的部署或重置动作。

| 项目 | 当前记录 |
|---|---|
| 上一工作设备 | 公司 Mac |
| 2026-09-19 本地万能密码与室内精简 | 用户明确要求开发用万能密码。新增 `backend/scripts/dev_server.py`，本机 `.env.local-auth` 仅存 PBKDF2 哈希、600 权限且被 Git 忽略；仅 development＋loopback 主机／客户端且无代理转发头可使用。现有／新建本地账号均可用，原密码仍有效，不放行不存在／禁用账号，不影响管理员密码或生产。专项 30 项通过，实际本地代理登录 200。室内移除定位说明、金圈教程、实时切面／人数状态汇总和重复住宅介绍；按钮移至左下角并保留真正的生活事实。浏览器已检查选中居民与简洁布局。事件生成只审计解释，未改模板数量或玩法规则；见 `docs/LIFE_FEEDBACK_AND_PRESENTATION.md` 新节。未提交／部署 |
| 2026-09-19 本地登录恢复与密码重设 | 用户授权重启及统一本地账号密码。旧 worker 卡在 SQLite 原生操作，热重载等待后台任务结束，健康接口无响应；已停止旧进程并重新启动。3 个本地账号均使用用户本轮指定密码（明文不记录），逐个哈希验证通过，旧会话已撤销；保留居民、历史、进度与邀请码。修改前 SQLite 备份及 quick_check 通过，备份位于本机临时目录 `/private/tmp/lingolife-local-recovery.BfspAf/before-password-reset.db`。后端继续 reload，仅监听 `backend/lingolife`，增加 10 秒优雅退出等待；这不是 SQLite 卡顿根因修复。后端／前端代理健康接口 200，`liangchaowei` 实际登录 200，测试会话已注销。未修改生产账号、未提交／部署 |
| 2026-09-19 生活反馈与人物表现 | 本地新增：自主片段按双方实际决定展示结果，关系按具体维度表述；NPC 表达增加性格语气、独立事实终审与客套／虚构经历护栏；表情绑定可见模型边界，气泡按人物投影避让；全城微缩默认放大 18%，增加道路循环车辆和云层漂移。Backend **684 passed**，Web lint/build 通过；桌面表情、长对白、城市车辆移动及手动镜头保持已实看，440×956 手机模拟双语气泡检查通过（模拟器异常缩放需恢复 100%）。真实 AI 多轮抽检：共餐／忙碌拜访改善，受阻场景最终通过；借物争执最终仍有一次因虚构前情回退，不能宣称对白质量全通过。未重置账号、未清缓存、未提交／推送／部署。流程及边界见 `docs/LIFE_FEEDBACK_AND_PRESENTATION.md`；保留上一轮视觉改动 |
| 2026-09-19 第一轮视觉优化 | 优化前基线已提交为 `1c2472e`，未推送。本轮新增视觉改动仍在本地工作树：统一人物／室内光照、木地板与家具接地阴影、住宅大场景及头像定位、窄屏构图与双语气泡、自适应画质及城市云层。最终 Web lint/typecheck/build 与 diff 检查通过，已实际检查桌面和 440×956 手机模拟、真实账号城市→住宅定位。不是手机真机性能验收；未部署、未重置数据。详情及待办见 `docs/VISUAL_UPGRADE.md` |
| 2026-09-19 本地登录排查 | 验收中旧后端连接报 `file is not a database`，只读 SQLite quick_check 返回 `ok`；触发现有 reload 重建连接后原账号登录恢复。未覆盖数据库、未修改密码或后端业务代码；根本触发原因尚未确定，复发时应查文件同步／替换和并发进程 |
| 2026-09-19 优化前基线 | 用户要求先提交当前版本再优化视觉。本次提交收录下述 9 月 15～18 日累计对白、提示词、人设、道路背景与去重改动，取代其“未提交”状态。提交前重新验证 Backend **675 passed**、Web lint/typecheck/build、`git diff --check`；远端已同步，无新更新。未重置账号，未部署。本轮后续视觉优化另行记录，不与基线混在一起 |
| 2026-09-18 生活对白与重复事件 | 修复借物必定越界、双方抽到不属于自己身份的回应、补问后无人作具体回答。越界需真实借物行动与已有物品，并按性格／边界／近期冲突稳定判定；补齐双语逻辑物品名称，历史名称不重写。当前动态合并同组同题已结算事件，已记下片段退出当前栏，未看过的旧片段也受 24 小时展示时限约束，保留历史和待介入事件。AI 增加准确物主／借用者角色、首次观看、中文回应意图、独立终审及针对性语义护栏。新增 `test_life_dialogue_variety.py`，后端全量 **675 passed**，`git diff --check` 通过；多轮真实 DeepSeek 虚构场景抽检，最终三种走向均成功。后端 reload 与前端代理健康检查正常。未清空存档／成功缓存，未提交／推送／部署；详见 `docs/NPC_AI_LIFE_DIALOGUE.md` 最新章节 |
| 2026-09-18 玩家聊天人设纠偏 | 针对明确兴趣被通用劝告覆盖：新增公开 `character_facts` 和历史之后的固定系统级本轮提醒，当前人设优先、承接短句话题、旧对白不当成人设／经历、玩家改语言／改人设不能覆盖规则。版本 `agent-v2-persona-grounding`；保留单次流式生成、原分析／翻译／结算。新增 `test_dialogue_persona_grounding.py` 和 `scripts/preview_persona_dialogue.py --live`（每次最多六次付费请求、不打开数据库）。三轮各六条真实 DeepSeek 抽检后，最终六条主要预期符合；模型仍可能扩展细节，未实现输出后语义判定器。专项 **27 passed**、后端全量 **656 passed**、`git diff --check` 通过。未清空聊天／账号，未提交／推送／部署。详见 `docs/NPC_DIALOGUE_VOICE.md` |
| 2026-09-18 提示词中文化 | 角色对话、关系边界、分析、翻译、动态目标、生活片段创作／校对／修复指令已等义改为中文。旧事件目标仅在模型侧本地化；JSON 字段、枚举、英文对白、用户资料、历史缓存不变。新增 `test_prompt_localization.py`，后端全量 **651 passed**，`git diff --check` 通过；未调用真实 AI，未提交／部署，未修改真实存档，也未借此改变人设行为规则 |
| 2026-09-16 道路会话背景 | 修复赶路居民仍使用出发建筑背景：会话按 `spatial_presence` 优先解析，途中使用复用 KayKit 建筑／路灯的 3D 街道布景（不是当前位置的地图截图），名称和简介中英文同步；抵达后恢复建筑／住宅，住宅内换房不误判上街。新增 `check-conversation-location.mjs`（接入 lint）和无账号浏览器夹具 `check-conversation-street-browser.mjs`。仅本地，未提交／部署，未改动账号数据 |
| 2026-09-15 后续修复与最新验收 | 用户报告对白回退和提示过多。新增失败片段手动重试、独立预算记录、并发合并、初稿续审、脱敏错误码；去掉说明式常驻提示，结果卡精简并折叠详情。全量 Backend 637 passed，随后新增并发重试专项后表达测试 34 passed；Web lint/typecheck/build 通过，隔离浏览器完整回归和手机截图检查通过，真实 DeepSeek 3 场景＋2 开场全部成功。**此行取代下面早先“复验被阻止”的状态**；仍未提交／推送／部署，无账号重置。历史 2 条失败缓存未删除，用户刷新后可点“重试” |
| 2026-09-15 本地 AI 对白改造 | 按用户要求开始优化生活片段：按需 DeepSeek 整段创作＋第二轮事实校对、双语、说话人／听话人／角色身份、单人独白、结果对应续接、冻结回放和独立预算；玩家开场人设化，正式聊天上下文不再引用旧模板对白。详见 `docs/NPC_AI_LIFE_DIALOGUE.md`。**未提交、未推送、未部署、未重置真实账号** |
| 本轮质量抽检与待办 | 首轮 3 场景＋2 开场的真实 DeepSeek 调用使用虚构成年人物和内存库，成功返回结构化双语，但发现虚构细节／跨场景污染；已去掉无关场景台词、加强事实边界、加入第二轮校对。**收紧后真实复验尚未完成**：审批服务连续返回模型容量不足，不是 API 配置或 SSH 问题，不可声称最终对白质量已验收 |
| 本轮浏览器状态 | 独立 Chrome、无账号夹具已走过生成提示、6 句播放、轮询保留、介入续接、390px 翻译、英文切换、旧请求隔离和失败提示；测试脚本末尾因直接序列化 DOM 元素报错，已改为 Boolean；最终脚本重跑同样被审批服务容量故障阻止，**未标记全通过**。`node web/scripts/check-life-dialogue-browser.mjs`。本轮未以截图完成最终视觉验收 |
| 本轮本地环境 | Vite 在 `127.0.0.1:5173`，后端 `127.0.0.1:8000` 已按用户要求启动并开启 reload，使用 `backend/data/lingolife.db` 原存档及根目录本地 DeepSeek 配置。独立 QA Chrome CDP `19226`，临时配置 `/private/tmp/lingolife-expression-qa`。开始下一轮先核实端口；生成脚本 `backend/scripts/preview_life_dialogue.py --live` 最多 10 次模型请求，仅内存库 |
| 本轮开场性能保护 | 默认房间／资料加载只复用开场缓存，不新调用 AI；实际进入聊天和切换聊天人物才携带 `author_opening=true`。避免登录进城时等待 AI。正式聊天使用同一开场缓存，初次直调聊天 API 时仍按当前行动生成 |
| 本轮最终自动化验收 | Backend 全量 **633 passed**（新增 29 项表达测试）；开场／场景 API 专项 40 passed；Web lint、typecheck/build、`git diff --check` 通过。构建仍有既有 Three.js 大包提示。待审批恢复后重跑上述浏览器脚本与真实模型脚本，人工检查无捏造细节再考虑提交部署 |
| Git 仓库 | `git@github.com:Shimooth/LingoLife.git` |
| 主分支 | `main` |
| 2026-09-10 文档交接 | `docs/PLAYER_JOURNEY_AND_SYSTEMS.md` 已改为玩家视角的五张 PNG 图解，涵盖入住、生活循环、共餐设计、聊天体验和优化顺序；明确区分现状与建议。原完整技术内容保留于 `docs/PLAYER_JOURNEY_TECHNICAL_REFERENCE.md`，图片 SVG 和生成脚本也随本轮提交。仅文档与协作约定变动，不部署；后续玩法建议从图解文档第 5 节继续 |
| 已推送应用提交 | `b37d83bf6347040d6c3b760c2a66bbd0fcae93b3`；发布验收记录由后续仅文档提交补充，拉取时以 origin/main 为准 |
| 已部署提交 | `b37d83bf6347040d6c3b760c2a66bbd0fcae93b3`，2026-09-07（Asia/Shanghai）已验证 |
| 2026-09-06 本地后续改动 | 会话按游戏日与行动实例隔离，旧消息保留历史；新玩家旅程文档；账号级进城实操引导（跟随→真实故事→旁观/介入→结果确认），集中双语结果卡及移动端统一滚动；新增 `docs/CITY_PRACTICE_GUIDE.md`；本轮尚未提交部署 |
| 后续改动验证 | Backend `446 passed`，含 6 项实操引导测试；Web lint（含会话开场和结果语义检查）/typecheck/build 通过；本轮未调用真实 DeepSeek |
| 本轮浏览器验收 | 隔离 QA 账号、生产构建，1440×1000 桌面与 390×844 手机：真实点击跟随→双人现场→安慰→结果卡→手机刷新续接→确认→刷新不重播；设置切换英文、重新开始与暂停后刷新也通过；最终完整流程无 JavaScript 异常或横向溢出 |
| 上一已部署版本验证 | Backend `434 passed`；Web lint/typecheck/build；桌面与移动 WebGL smoke |
| 2026-09-06 居民安排界面 | 修复长表单撑高预览导致人物巨幅裁切；动画 Mixer 与模型骨架实例绑定，换装不再沿用旧骨架。保留单 Canvas，加入站立/走动/开心预览与减少动态效果支持；资料/外观分栏切换，入住名单展示实时造型缩略图，17 个实际模型 WebP 选项共 82,500 bytes，角色工作室同步复用。仅本地修改，未提交或部署 |
| 居民预览验收 | `npm --prefix web run check:resident-browser` 使用隔离 Chrome（CDP 19226）与无 API 写入夹具，验证 17 模型切换、画布/资料不重置、5 类换装后的新骨架继续动画、390px 手机、中英文与减少动态效果；缩略图校验纳入 lint。生成方式见 `web/public/assets/portraits/characters/README.md`。本轮未重置账号 |
| 2026-09-06 共享住宅生活优化 | 现有 CC0 KayKit 素材提取 12 个动作，运行时适配城市/Chibi 骨架，补坐下/起身/台面动作、手骨道具和台面接触、家具避让路线及双人注视；真实饭菜分享倾向和餐具痕迹，普通餐具不立即升级冲突；住宅增加放大观察与镜头操作。详见 `docs/HOUSEHOLD_LIFE_PRESENTATION.md`，未提交/部署、未重置账号、未调用 DeepSeek |
| 生活优化验证 | Backend 全量 `452 passed`（含 30 天模拟与 6 项新增生活测试）；Web lint/typecheck/build；独立浏览器 17 个模型、新骨架动画、非瞬移行动切换、厨房物件状态、390px 手机与动态减少动画设置通过。无账号验收页 `/scripts/fixtures/household-life.html` 只在开发服务使用，不是生产游戏路由 |
| 2026-09-06 室内外衔接 | 后端新增 `spatial_presence`，明确区分室内/室外/路上；室内居民不绘制地图模型或标记，仍保留在居民列表和建筑详情。住宅内换房间不上街，出门后不再留在室内；点击室内居民/跟随到达时打开住宅或对应建筑详情。修复回家路径与无旧事件 ID 的生活行程到达刷新，手机居民卡拓宽。仅本地，未提交/部署/重置账号 |
| 室内外验收 | Backend 全量 `491 passed`（新增 39 项位置投影用例）；Web lint/typecheck/build 通过；隔离 Chrome 无账号浏览器测试实际城市 actors、住宅保留、室内换房、去咖啡馆/回家移动与到达切换、手机与减少动画模式通过。`npm --prefix web run check:spatial-presence-browser`，夹具 `/scripts/fixtures/spatial-presence.html`；React 错误边界的控制台错误也纳入验收，不将错误回退当成成功 |
| 当前产品事实 | GDD 当前纵切见 `docs/GDD_ACCEPTANCE_MATRIX.md`；长期缺口见 `docs/LIFE_SIMULATION_IMPLEMENTATION_PLAN.md` |
| 2026-09-06 P0＋共餐纵切 | 向导区分现场/回顾/等待结果，事件底部固定下一步，故事绑定与繁忙同步防抢跑。住宅新增「一起吃顿饭」：提议/自主发起→条件与意愿回应→收尾闲暇活动→实际准备/用餐→洗碗或保留家务，复用真实库存、行动及共享食物关系证据；一次/游戏日，工作睡眠和急需优先。详见 `docs/SHARED_MEAL_VERTICAL_SLICE.md`。未提交/部署/重置账号，未调用 DeepSeek |
| P0＋共餐验收 | Backend 全量 `502 passed`，共餐新增 11 项含 API 归属/重复/跨设备、工作保护、在线离线一致；Web lint/typecheck/build。隔离手机浏览器点通回顾→记录见证→完成，底部按钮无需滚动；验证共餐真实引擎快照各阶段、物件人数计数、中英文及厨房放大入口。`npm --prefix web run check:practice-dinner-browser`；无账号夹具 `/scripts/fixtures/practice-dinner.html`，共餐快照来自内存世界，非生产快进功能 |
| 2026-09-06 NPC 说话风格 | `interaction-scene-v2`：16 类生活话题口语化，高频意图五类完整句子语气；拒绝后接话、熟人打趣、矛盾不强行和解、已吃完的食物不重放邀请。共餐阶段共享语气，餐次内冻结，不再自己谢自己。详见 `docs/NPC_DIALOGUE_VOICE.md`。规则台词层，无新增 AI 调用、不改行动／关系结算；旧保存对话不重写。仅本地，未提交／部署／重置账号 |
| NPC 台词验收 | Backend 全量 `603 passed`，含本轮 101 项新增语气／话题／事实／回放测试；专项 `118 passed`；Python 编译与 `git diff --check` 通过。本轮未改前端布局，未新增浏览器验收；本地 reload 后 `/api/v1/health` 返回正常 |
| 2026-09-07 居民定位修复 | 地图点击室内居民向住宅传递 NPC ID；公共区域自动切到当前房间、显示脚下金圈，支持同住宅切换居民、实时换房、手动浏览后重新定位；修复 kitchen/living_room 与展示房间 ID 别名。私人活动明确说明已在家中找到但不公开具体房间／模型，不从资源占用反推隐私。离家提示返回地图。仅本地，未提交／部署／改账号数据 |
| 居民定位验收 | Web lint/typecheck/build 通过；`node web/scripts/check-household-location-browser.mjs` 验证私人说明、公共房间模型和圈、房间迁移、手动浏览、切换目标、出门、中英文和 390px 手机；`check-spatial-presence-browser.mjs` 回归实际地图点击 NPC ID 传递、室内外衔接与减少动画模式。无账号测试夹具 `/scripts/fixtures/household-location.html`，不属于生产路由；本轮未改后端 |
| 2026-09-07 最新房间表现选择 | 用户要求人物真正出现在房间里，**取代上面“不展示私人活动人物／房间”的表现规则**。公开实际 `current_room_id`，内心、私人意图、资源目标与打断权限仍受限；室内可见，城市仍隐藏室内人物。卧室使用全名单固定归属，睡眠横卧与被子轻呼吸，洗浴着装模型＋不透明遮挡；卧室定位镜头靠近所选房间。详见 `docs/HOUSEHOLD_LIFE_PRESENTATION.md` 新节。未提交／部署／重置账号 |
| 房间生活验证 | Backend 全量 `603 passed`，其中位置与隐私 API 专项 `50 passed`；Web lint/typecheck/build；浏览器通过人物卧室可见、8 床位及名单过滤／重排不换床、睡眠／洗浴、定位与换房、英文和手机，已查看实际睡眠／洗浴截图。测试在无账号夹具中执行 |
| 2026-09-07 床铺与状态修正 | 修复睡姿／床垫高度与预览坐标错位，被子改为下垂曲面并裁切被覆盖衣物；城市／Chibi 分别校准。睡觉、休息、洗澡和其他活动明确区分，准备／等待／打断／放弃不冒充完成或进行中。洗澡改为遮身体露头的雾团，保留着装与私人打断限制。Backend 全量 `604 passed`，补充阶段后专项 `21 passed`；Web lint/typecheck/build、定位浏览器回归及两类模型实际截图检查通过。详见房间表现文档；未提交／部署／重置账号 |
| 素材资料交接 | `docs/ASSET_ACQUISITION_MANIFEST.md`、`docs/ASSET_IMPORT_SHORTLIST.md` 两份历史素材清单随本轮提交保存，原始素材包仍在仓库外；其中“待导入”是整理时记录，当前实际导入情况以房间生活文档与运行时资产为准 |
| 2026-09-07 发布准备 | 用户已要求提交并部署以上本地累计改动。SSH 已确认可直接连接，远端 main 与发布前本地 HEAD 一致；发布使用干净 Git 提交打包、本地构建、SHA-256 校验、线上 SQLite 备份与现有回滚脚本，不重置账号。最终部署版本与验收在发布成功后另行记录 |
| 2026-09-07 发布完成 | 上述 9 月 6～7 日累计功能／修复已随 `b37d83b` 提交、推送并部署，取代各历史行“仅本地／未提交／未部署”的状态。包含会话隔离、实操引导、共餐、NPC 台词、生活动作、居民缩略图、室内外定位、床铺贴合、状态区分和洗浴雾团。工作树交出前保持干净；线上应用与后续文档提交仅差交接记录 |
| 本次发布验证 | Backend 全量 `604 passed`；发布脚本重新 npm ci、lint、typecheck、build 全部通过；本地无账号室内定位浏览器回归通过。线上 `.source-revision` 一致、Compose healthy、启动日志正常；玩家／管理 HTTPS 首页与健康接口通过，首页内容及新版应用脚本、动作、头像、锅具资产 SHA-256 与本地一致；隔离浏览器 390px 两域名登录入口无 JS 错误／横向溢出。未登录真实账号、未调用 DeepSeek、未重置数据；不把入口冒烟测试等同完整线上玩法验收 |
| 本次备份与回滚 | SQLite `/opt/lingolife/backups/lingolife-20260906T173609Z.db`；回滚目录 `/home/lingolife-deploy/lingolife-releases/rollback-20260906T173607Z`；发布包 `/home/lingolife-deploy/lingolife-b37d83b.tar`，SHA-256 `971cc2a5f23ad394132852428b26419dd7b3fa3b8c3cc2004ffe0c7bed7c6f32`。备份目录由容器 UID 10001 管理，部署用户直接 test -s 不可用，使用只读挂载核验。发布后空闲快照约 84 MiB / 384 MiB、CPU 1.15%，不是负载测试 |
| 备份完整性验收 | 本次 SQLite 备份已通过 `PRAGMA quick_check`（`ok`）。只读挂载下以 `mode=ro&immutable=1` 打开已经完成的备份，避免 WAL 辅助文件写入；此参数不可用于仍在写入的生产数据库 |
| 下一步 | 另一台设备执行 `git pull --ff-only` 即可取得本次实现及交接资料；可在线上按 `docs/CITY_PRACTICE_GUIDE.md` 试玩。已有账号从「设置 → 进城实操引导」进入，观察首个可参与故事的等待时间；本次没有重置任何账号 |

开始工作时必须重新运行第 5 节检查；上表中的提交、测试和生产状态只是最近一次记录，不是永久事实。

## 2. 两台设备的职责与配置基线

| 项目 | 公司 Mac | 家用 Windows |
|---|---|---|
| 用途 | 工作日小改动、审查、紧急修复 | 周末完整开发、较长测试和视觉调试 |
| 仓库路径 | `/Users/shiyongqiang/Projects/LingoLife` | 建议 `%USERPROFILE%\Projects\LingoLife` |
| Git remote | `origin = git@github.com:Shimooth/LingoLife.git` | 必须相同 |
| 默认分支 | `main` | `main` |
| Git 身份 | 当前尚未显式配置，提交曾使用系统推导身份 | 初始化时必须显式配置，并与 Mac 相同 |
| 行尾 | 建议 Git 统一保存 LF | 必须关闭自动 CRLF 转换，保存 LF |
| VPS SSH alias | `lingolife-vps` 已配置 | 待按第 4 节配置 |
| VPS 私钥 | `~/.ssh/lingolife_deploy` | 使用独立的 `~/.ssh/lingolife_deploy_win` |
| GitHub 私钥 | 使用本机已有 GitHub SSH 配置 | 使用独立的 `~/.ssh/lingolife_github_win` |
| 本地依赖 | 当前 Node 26；Backend venv 是 Python 3.9，低于项目声明的 3.11+，应迁移到 Python 3.12 | 使用 Node 22 LTS、Python 3.12 |
| 本地秘密/数据 | 本机 `.env`、`.venv`、`node_modules`、SQLite | Windows 单独创建，绝不通过 Git 同步 |

两台电脑不要共享私钥。每台机器各生成 GitHub 和 VPS 密钥，分别登记公钥；丢失一台设备时可以只吊销该设备，不影响另一台。

## 3. Git 一次性配置

两台设备使用同一个 GitHub 已验证姓名和邮箱。以下尖括号内容由用户在本机填写，不得让 Codex 猜测邮箱。

### 3.1 Mac

```bash
git config --global user.name "<你的 GitHub 显示名>"
git config --global user.email "<你的 GitHub 已验证邮箱或 noreply 邮箱>"
git config --global init.defaultBranch main
git config --global pull.ff only
git config --global fetch.prune true
git config --global core.autocrlf false
git config --global core.eol lf
```

### 3.2 Windows PowerShell

```powershell
git config --global user.name "<与 Mac 完全相同的名字>"
git config --global user.email "<与 Mac 完全相同的邮箱>"
git config --global init.defaultBranch main
git config --global pull.ff only
git config --global fetch.prune true
git config --global core.autocrlf false
git config --global core.eol lf
```

验证两台设备的输出一致：

```bash
git config --global --get user.name
git config --global --get user.email
git config --global --get pull.ff
git config --global --get core.autocrlf
git remote -v
```

不使用 `git config credential.helper store` 保存明文密码。本项目 remote 使用 SSH，不需要把 GitHub Token 写入仓库或脚本。

## 4. SSH 一次性配置

### 4.1 Mac 当前配置与建议

当前有效别名：

```sshconfig
Host lingolife-vps
  HostName <VPS 主机名或 IP，沿用本机现值>
  User lingolife-deploy
  IdentityFile ~/.ssh/lingolife_deploy
  IdentitiesOnly yes
```

为避免每次重启后重复输入私钥口令，macOS 可补充：

```sshconfig
Host lingolife-vps
  AddKeysToAgent yes
  UseKeychain yes
```

然后在普通 Terminal（不是受限子进程）执行一次：

```bash
eval "$(ssh-agent -s)"
ssh-add --apple-use-keychain ~/.ssh/lingolife_deploy
ssh -o BatchMode=yes lingolife-vps 'id'
ssh -T git@github.com
```

私钥口令由用户创建，项目和 Codex 都不知道。Keychain 保存的是解锁能力，不会把私钥放进仓库。

### 4.2 Windows 生成独立密钥

在 PowerShell 执行：

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.ssh" | Out-Null
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\lingolife_github_win" -C "lingolife-github-home-win"
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\lingolife_deploy_win" -C "lingolife-vps-home-win"
```

两把密钥都应设置口令。只把 `.pub` 公钥分别添加到 GitHub SSH Keys 和 VPS 的 `/home/lingolife-deploy/.ssh/authorized_keys`；不要复制 Mac 私钥，也不要把 Windows 私钥发到聊天。

Windows 的 `%USERPROFILE%\.ssh\config`：

```sshconfig
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/lingolife_github_win
  IdentitiesOnly yes

Host lingolife-vps
  HostName <与 Mac 相同的 VPS 主机名或 IP>
  User lingolife-deploy
  IdentityFile ~/.ssh/lingolife_deploy_win
  IdentitiesOnly yes
```

用管理员 PowerShell 启用 Windows OpenSSH Agent，再用普通 PowerShell 添加密钥：

```powershell
Get-Service ssh-agent | Set-Service -StartupType Automatic
Start-Service ssh-agent
ssh-add "$env:USERPROFILE\.ssh\lingolife_github_win"
ssh-add "$env:USERPROFILE\.ssh\lingolife_deploy_win"
git config --global core.sshCommand "C:/Windows/System32/OpenSSH/ssh.exe"
ssh -T git@github.com
ssh -o BatchMode=yes lingolife-vps "id"
```

这条 `core.sshCommand` 避免 Git for Windows 调用其内置 SSH、却把密钥加入 Windows 系统 SSH Agent 后两者互相看不见。

首次连接时必须通过 VPS 控制台核对 host key 指纹。若以后出现 host key 变化，立即停止，不得使用跳过验证参数。

## 5. 每次接手工作的固定流程

必须确保另一台设备已经完成第 6 节交出流程，然后再开始：

```bash
git fetch --prune origin
git status --short --branch
git log -1 --oneline --decorate
git branch -vv
git pull --ff-only
```

Windows PowerShell 使用相同 Git 命令。检查规则：

1. `main` 必须与 `origin/main` 一致，或明确知道自己正在接手哪个 `wip/*` 分支；
2. 不得覆盖另一台电脑未推送的改动；
3. 不认识的 modified/untracked 文件先停止并查看本文件的交接状态；
4. 禁止以 `git reset --hard`、`git clean` 或覆盖式 checkout 来“处理”陌生改动；
5. `git stash` 只存在当前电脑，不能作为跨设备交接工具。

首次在该设备克隆：

```bash
mkdir -p ~/Projects
cd ~/Projects
git clone git@github.com:Shimooth/LingoLife.git
cd LingoLife
git switch main
```

Windows PowerShell 把 `~/Projects` 替换为 `$env:USERPROFILE\Projects`。

## 6. 每次离开设备前的固定交出流程

### 6.1 已完成且测试通过

```bash
git status --short
git diff --check
cd backend && .venv/bin/pytest -q
cd ../ && npm --prefix web run lint
npm --prefix web run typecheck
npm --prefix web run build
git add <本次明确修改的文件>
git commit -m "<中文类型>：<清楚的中文描述>"
git push origin HEAD
```

Windows 后端测试命令为：

```powershell
backend\.venv\Scripts\python.exe -m pytest -q backend\tests
```

提交前更新本文件第 1 节的设备、分支、提交、验证、未完成项和下一步。推送后确认：

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse '@{u}'
```

除明确列出的本地文件外，工作树应为空，两个 SHA 应相同。

### 6.2 工作未完成或暂时不能通过测试

不要把破损代码提交到 `main`，也不要只存在本地 stash。建立可推送的 WIP 分支：

```bash
git switch -c wip/<简短主题>
git add <本次相关文件>
git commit -m "进行中：<用中文说明当前做到哪里>"
git push -u origin HEAD
```

在第 1 节记录失败测试、剩余问题和精确下一步。另一台设备接手：

```bash
git fetch --prune origin
git switch wip/<简短主题>
git pull --ff-only
```

完成后再把经过测试的结果合并到 `main`。同一分支同一时间只能有一台设备写入。

## 7. 本地环境不通过 Git 同步

以下目录或文件均已被 `.gitignore` 排除，每台设备独立创建：

- `.env`、`config/lingolife.local.yaml`：本地秘密和覆盖配置；
- `backend/.venv`：Python 虚拟环境；
- `web/node_modules`、`web/dist`：Node 依赖和构建产物；
- `data/`、`*.db`、`*.sqlite*`：本地运行数据；
- IDE 配置、日志、备份和 Unity 生成目录。

推荐统一工具版本：Python 3.12、Node 22 LTS。不要复制虚拟环境或 `node_modules`；在各设备根据锁文件重建。

Mac/Linux：

```bash
cd backend
python3.12 -m venv .venv
. .venv/bin/activate
python -m pip install -e '.[test]'
cd ../web
npm ci
```

Windows PowerShell：

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[test]"
cd ..\web
npm ci
```

DeepSeek Key 建议为每台设备建立可独立吊销的 Key，并分别写入本机 `.env`。如果只做规则层和 fallback 测试，可以不配置本地 DeepSeek。生产秘密只在 VPS `/etc/lingolife/lingolife.env`。

本地 SQLite 不用于设备间同步游戏进度。需要可重复测试时使用测试 fixture 或受限的 `onboarding-test` 重置流程；不要复制生产数据库。外部原始素材包也不通过 Git 同步，只有经筛选、具备许可证记录且进入运行时的资源才提交仓库。

## 8. 本地启动

当前 Mac 若需要开发专用万能密码，从项目根目录启动：

```bash
backend/.venv/bin/python backend/scripts/dev_server.py
```

Windows 使用 `backend\.venv\Scripts\python.exe backend\scripts\dev_server.py`。启动器明确绑定本机并使用本地数据库，读取被 Git 忽略的 `.env.local-auth` 哈希文件；该文件不会随 Git 到另一台设备，另一台需单独配置。无此文件则不开启万能密码。不要将该启动器用于 VPS／Docker；原有正常登录仍可使用下面的启动方式。密码和哈希内容都不放进本文或提交。

终端一，后端：

```bash
cd backend
. .venv/bin/activate
uvicorn lingolife.app:app --reload --host 127.0.0.1 --port 8000
```

Windows PowerShell：

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn lingolife.app:app --reload --host 127.0.0.1 --port 8000
```

终端二，前端：

```bash
npm --prefix web run dev
```

玩家端通常为 `http://localhost:5173`。本地管理端细节和测试账号重置见 `web/README.md` 与 `docs/P0_BETA_OPERATIONS.md`。

## 9. 部署规则

任一设备只有在 Git 工作树干净、提交已经推送、全量检查通过且用户明确要求部署时，才能执行 `deploy/README.md` 的发布包流程：

```text
package-release.sh → scp → promote-release.sh → 双域名健康检查
```

VPS 统一使用：

- SSH alias：`lingolife-vps`
- 用户：`lingolife-deploy`
- 应用：`/opt/lingolife/app`
- 数据：`/opt/lingolife/data`
- 备份：`/opt/lingolife/backups`
- 环境文件：`/etc/lingolife/lingolife.env`

不要在 VPS `git pull`，不要复制 GitHub 私钥到 VPS，不要把生产 env 下载到本地。发布前在线备份 SQLite；发布后核对 `.source-revision`、Compose health、近期日志和两个 HTTPS 域名。

## 10. Codex 新会话开场提示词

Mac 或 Windows 均可直接发送：

```text
先完整阅读 docs/SESSION_HANDOFF.md，再检查当前设备的 Git 分支、远端、工作树和工具版本。不要覆盖或提交不属于本次任务的改动，不要读取或输出秘密。先告诉我当前交接状态是否一致，再继续我的任务；只有我明确要求时才提交、推送或部署。
```

若是从另一台设备接手未完成分支，再追加：

```text
本次接手 docs/SESSION_HANDOFF.md 中记录的 wip 分支。先拉取并运行交接记录中的失败/验证命令，确认现状后继续，不要从 main 重新实现。
```

## 11. 最小原则

1. Git 是源码和交接记录的唯一同步源，不是密码、依赖或数据库同步工具。
2. 一台设备一套私钥；只共享公钥和非敏感 SSH alias。
3. 一次只有一台设备写同一分支。
4. 完成内容提交到 `main`；未完成内容提交到 `wip/*`；不用 stash 交接。
5. 离开前 push，接手前 fetch/pull，任何陌生改动先停下核对。
6. Codex 依据本文件、Git 和测试恢复上下文，不依赖另一窗口的聊天历史。
