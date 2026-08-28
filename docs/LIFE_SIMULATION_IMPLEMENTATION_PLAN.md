# LingoLife 生活模拟改造技术实施方案

- 版本：0.4
- 创建日期：2026-08-26
- 方案确认：2026-08-28
- 首轮实现检查点：2026-08-28
- 目的：将当前“每日社交事件 + AI 对话”运行时迁移为“持续生活行为 → 行为碰撞 → Moment / Incident / Story Thread”，并作为家里与公司两套开发环境的跨会话交接依据。
- 设计依据：
  - [`../LingoLife GDD.md`](../LingoLife%20GDD.md)
  - [`../NPC Agent 系统设计文档.md`](../NPC%20Agent%20系统设计文档.md)
  - [`../随机事件生成系统设计文档.md`](../随机事件生成系统设计文档.md)

---

## 1. 使用规则

本文件同时承担技术方案、阶段清单和交接记录三个职责。

每次在家里或公司开始开发前：

1. `git pull --ff-only`；
2. 阅读本文件的“当前检查点”和正在进行的阶段；
3. 运行当前基线测试；
4. 只领取一个未完成的可验收步骤；
5. 完成后更新本文件的状态、验证命令和下一步；
6. 提交代码与本文件更新；
7. 需要另一台电脑继续时，将提交推送到远端。

状态统一使用：`未开始`、`进行中`、`已完成`、`阻塞`。同一时刻最多一个步骤标记为“进行中”。

不要把密码、API Key、SSH 信息、数据库内容和本机绝对路径写入本文件。

---

## 2. 当前运行时事实

以下是改造开始前已经存在的能力，不应在迁移中破坏：

- FastAPI + SQLite 后端；
- React + TypeScript + Vite 3D Web 客户端；
- 邀请码账号、会话、配额和管理端；
- DeepSeek 对话、规则 fallback 和受约束分析；
- 玩家与 NPC 的聊天、事件、学习证据和记忆；
- NPC Persona、Runtime State、Goal、Daily Plan；
- 方向性 `npc_social_edges`；
- `npc_social_events` 的 traveling / awaiting / resolved 状态；
- 3D 城市、道路移动、跟随镜头和角色动画；
- 幂等聊天和事件结算；
- 增量 SQLite schema 初始化。

当前限制：

- `daily_plan` 只有 morning / afternoon / evening 三个槽位；
- needs 主要通过时间公式衰减与恢复，没有对应可观察 Life Action；
- `SocialWorldEngine.ensure_daily()` 每个游戏日最多选择一对 NPC；
- 社交模板只有 shared interest、help goal、teamwork、misunderstanding 四类；
- 没有事件时世界动作统一为 `idle`；
- 普通社交事件会等待玩家点击后才结算；
- 管理动作使用固定 modifier，`mediate` 等动作结果过于可预测；
- 每名 NPC 只有独立 home slot，没有 Household、房间和共享资源；
- 没有 Desire、Commitment、Life Action、Unresolved Thread 和 Story Thread 持久层；
- 关系边尚无 comfort、resentment、attraction、dependency、jealousy。

当前实现事实仍由 [`NPC_AGENT_IMPLEMENTATION.md`](NPC_AGENT_IMPLEMENTATION.md) 记录；本文件描述迁移目标。

### 2.1 2026-08-28 首轮实现事实

- `LIFE_SIMULATION_V2` 主流程已经接管 world/city、角色生活上下文和 NPC–NPC 故事，旧每日事件不再双重生成；
- 13 类 Life Action、Household/Residence、厨房/电视/浴室资源、13 类碰撞场景、Moment/Incident/Thread 已进入权威世界；
- 刷新、分段推进、离线追赶和进程重启使用稳定事实时间与幂等键；SQLite 世界快照和查询投影在同一事务提交；
- 关系使用方向性十维心理边，以及可并存的结构、友情、冲突、竞争、恋爱频道；正式恋爱和停战由双方离散选择建立；
- 角色编辑器允许配置家庭、同居和自主恋爱边界；家庭与同居会改变住宅、资源和关系资格；
- 玩家可以观察普通生活、回看公开 Moment/Thread，并在有限窗口内使用上下文管理动作；NPC 在玩家不介入时继续生活并留下余波；
- DeepSeek 只负责英语表达与理解，不决定世界事实；外部模型、聊天响应、缓存重放和普通 Agent 面板都经过安全投影；
- 英语学习链路保持兼容，本轮没有扩建学习内容、等级曲线或 UI。

---

## 3. 改造约束

### 3.0 已确认的产品优先级

- 先完成可持续观察和干预的生活模拟核心，不再扩充“每日随机事件”路径；
- 关系基础从第一阶段进入运行时，友情、冲突、竞争与恋爱使用可并存频道；
- 恋爱纳入本轮核心范围，但必须遵守年龄、角色边界、明确接受与拒绝规则；
- 英语学习沿用现有链路并保持兼容，本轮不扩展学习内容、曲线和 UI；
- 现有角色住宅、消息、记忆、事件和关系数据只做增量迁移，不强制搬家或清空。

### 3.1 必须保持

- Web-first 3D 主流程；
- 玩家仅是观察者/管理者；
- 规则层拥有事实和数值；
- LLM 不运行世界状态机；
- 服务端权威时间、位置、资源和结算；
- 稳定种子、幂等和事务；
- 旧账号、角色、消息、记忆、事件和学习数据可迁移；
- DeepSeek 不可用时生活模拟完整运行；
- 当前生产 API 在迁移期间保持向后兼容。

### 3.2 第一轮不做

- 完整八人 Household 压力测试；
- 宠物；
- 婚姻、生育和代际模拟；
- 服装绘制和自由地形；
- 多人同步；
- 通用 GOAP、行为树编辑器或 ECS 重写；
- 向量数据库；
- 每 Tick 调用 LLM；
- 清空数据库重建。

---

## 4. 目标运行架构

```text
WorldClock
  ↓
LifeSimulationEngine
  ├─ advance needs / emotion
  ├─ generate desires
  ├─ choose commitment
  ├─ advance life action
  └─ reserve / release resources
  ↓
CollisionEngine
  ├─ person ↔ resource
  ├─ person ↔ person
  ├─ person ↔ responsibility
  └─ person ↔ boundary/environment
  ↓
StoryEngine
  ├─ Ambient Action
  ├─ Moment
  ├─ Incident + intervention window
  ├─ Unresolved Thread
  └─ Story Thread
  ↓
Rule-owned settlement
  ├─ runtime state
  ├─ household/resource state
  ├─ directional relationships
  ├─ subjective memories
  └─ observable aftermath
  ↓
World API → 3D presentation / optional dialogue
```

### 4.1 模块边界

首轮实际模块：

- `backend/lingolife/life.py`：Desire、Commitment、Life Action 和离线推进；
- `backend/lingolife/life_world.py`：世界推进内核、Household/资源协调和关系转折；
- `backend/lingolife/life_service.py`：事务加载、持久化投影和玩家安全 DTO；
- `backend/lingolife/collisions.py`：行为碰撞与规则模板；
- `backend/lingolife/stories.py`：Moment、Incident、Thread 和干预；
- `backend/lingolife/relationships.py`：关系证据、方向性心理边和多频道状态；
- `backend/content/life_actions.json`：行为模板；
- `backend/content/life_scenarios.json`：碰撞与响应模板；
- `backend/tests/test_life.py`；
- `backend/tests/test_household_topology.py`；
- `backend/tests/test_collisions.py`；
- `backend/tests/test_stories.py`。

现有 `social.py` 在迁移期保留。新引擎稳定后，四个旧社交模板转换为 collision/story 模板，再逐步移除“一天一个社交事件”的生成入口。

---

## 5. 数据模型与迁移

### 5.1 `npc_runtime_states`

继续使用 JSON 以兼容现有代码，升级为 `runtime-v2`：

```json
{
  "version": 2,
  "emotion": {"valence": 62, "stress": 38, "energy": 68},
  "needs": {
    "food": 72,
    "rest": 70,
    "social": 58,
    "achievement": 55,
    "love": 45,
    "privacy": 60,
    "fun": 52,
    "security": 75
  },
  "active_desire_ids": [],
  "current_commitment_id": null,
  "queued_commitment_id": null,
  "last_simulated_at": "2026-08-26T12:00:00Z"
}
```

旧状态首次读取时补默认值，不覆盖已有 emotion、needs 和 growth。

### 5.2 新表 `households`

```sql
CREATE TABLE households (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  name TEXT NOT NULL,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

`state_json` 首轮保存 cleanliness、noise、shared_budget 和默认规则。

### 5.3 新表 `household_members`

```sql
CREATE TABLE household_members (
  household_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  npc_id TEXT NOT NULL,
  private_room_id TEXT,
  role_json TEXT NOT NULL,
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (household_id, npc_id)
);
```

Residence 与 Household 分离：Residence 是地图上的住所，Household 是共同居住成员。旧 home slot 原样保留并惰性迁移为 Residence；旧角色默认不被强制合住。家人或室友可以共享 Residence，独居 NPC 形成单人 Household，NPC 也可以通过 Visit / StayOver 使用他人住宅资源。自动化测试使用一个多人 Household fixture 覆盖室友玩法。

### 5.4 新表 `household_resources`

```sql
CREATE TABLE household_resources (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  household_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  room_id TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 1,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

`state_json` 保存占用、队列、清洁度、库存和偏好上下文。资源预约与 Life Action 状态变化必须在同一事务中完成。

### 5.5 新表 `npc_desires`

```sql
CREATE TABLE npc_desires (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  npc_id TEXT NOT NULL,
  desire_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

状态：`candidate`、`committed`、`suppressed`、`expired`、`cancelled`。每名 NPC 仅保留当前和近期重要 Desire，普通候选不长期存储。

### 5.6 新表 `npc_life_actions`

```sql
CREATE TABLE npc_life_actions (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  npc_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  action_json TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  ends_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

状态：`planned`、`traveling`、`performing`、`blocked`、`retrying`、`completed`、`abandoned`、`interrupted`。

只保留当前动作和会影响持久状态的历史。纯表现动作完成后可压缩成每日摘要。

### 5.7 扩展 `npc_social_edges`

增量增加：

```sql
comfort INTEGER NOT NULL DEFAULT 50,
resentment INTEGER NOT NULL DEFAULT 0,
attraction INTEGER NOT NULL DEFAULT 0,
dependency INTEGER NOT NULL DEFAULT 0,
respect INTEGER NOT NULL DEFAULT 50,
fear INTEGER NOT NULL DEFAULT 0,
friendship_status TEXT NOT NULL DEFAULT 'stranger',
conflict_status TEXT NOT NULL DEFAULT 'none'
```

保留旧 `status` 供旧客户端读取，迁移期由多频道摘要派生并同步。A→B 与 B→A 独立；裸数值不是对玩家直接展示的关系标签。

### 5.8 新表 `npc_relationship_bonds`

保存不由心理数值自动抹除的结构关系，以及双方明确承认的关系频道：

- 结构频道：family、household、work、school、neighborhood、mentorship；
- 友情频道：emerging、friend、close_friend、estranged；
- 冲突频道：friction、open_conflict、feud、truce；
- 竞争频道：friendly、competitive、hostile；
- 恋爱频道：one_sided_interest、mutual_interest、dating、partner、separated；前两项属于隐藏心理状态，不进入普通玩家 DTO；
- 历史标志：former_friend、former_rival、ex_partner。

室友、朋友和冷战可以同时存在。约会、伴侣、分开等明确状态只能由可审计的关系转折写入，不能仅靠数值越过阈值自动发生。

### 5.9 新表 `relationship_evidence`

每次方向性变化保存唯一 evidence key、客观 fact、主观 appraisal、维度变化和规则版本。关系引擎以证据为输入，保证重复刷新不重复加减。嫉妒、排斥、债务、承诺与秘密保存为带第三人或资源上下文的 Thread / Evidence，不使用无来源的通用 jealousy 数值。

### 5.10 新表 `unresolved_threads`

```sql
CREATE TABLE unresolved_threads (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  topic TEXT NOT NULL,
  participant_ids_json TEXT NOT NULL,
  thread_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

同一 Household、主题和参与者的开放 Thread 使用稳定 key 去重。

### 5.11 新表 `life_stories`

统一保存 Moment、Incident 和 Story Thread：

```sql
CREATE TABLE life_stories (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  level TEXT NOT NULL,
  story_key TEXT NOT NULL,
  story_json TEXT NOT NULL,
  status TEXT NOT NULL,
  intervention_expires_at TEXT,
  resolution_action TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (player_id, story_key)
);
```

`npc_social_events` 继续可读。旧事件不搬迁；新世界 API 在过渡期将旧事件适配为 `life_stories` 响应结构。

### 5.12 索引与清理

- 当前动作：`(player_id, npc_id, status)`；
- 开放故事：`(player_id, status, updated_at)`；
- Household 资源：`(player_id, household_id, kind)`；
- Thread：`(player_id, status, topic)`；
- 已完成普通 Life Action 按日期压缩或删除；
- 迁移只增加表和列，不删除旧表。

---

## 6. 稳定时间与随机性

### 6.1 World time

继续使用 `GAME_TIMEZONE` 解释游戏日期。服务端返回 `server_time`，客户端只做插值。

首轮模拟方式：

- 在线：读取世界时最多推进到当前时间，不设后台常驻 worker；
- Life Action 时长：约 10 分钟～8 小时；睡眠、休息和日常行为使用符合生活节奏的持续时间；
- 在线和离线统一在“到达、动作完成、重试、资源租约、故事截止”等已保存事实时间点推进，不依赖 API 轮询频率；
- 单次 catch-up 最多精确回放最近 31 天，超出部分先恢复基础状态，再从上限起点继续事件驱动推进；
- 同一初态直接推进到目标时间，必须与分段多次推进得到相同权威状态。

### 6.2 Stable seed

统一函数：

```text
stable_number(
  player_id,
  world_rules_version,
  game_date,
  entity_ids,
  decision_kind,
  attempt_index
)
```

种子用于打破同分和产生可复现的不确定性。规则版本变化必须显式进入种子，不能依赖 Python 进程随机数。

### 6.3 幂等键

- Desire：NPC + 时间窗口 + desire type + target；
- Life Action：commitment ID；
- collision：参与实体 + 资源 + 时间窗口；
- story：collision ID + level；
- management result：story ID + action + rules version。

重复刷新、重复 POST 和进程重启必须返回相同结果。

---

## 7. 后端 API 方案

### 7.1 扩展 `GET /api/v1/world`

每名居民新增：

```json
{
  "current_action": {
    "id": "action-emma-tv-01",
    "type": "use_television",
    "status": "performing",
    "location_id": "home-1-living-room",
    "target_id": "living-room-tv",
    "started_at": "...",
    "ends_at": "...",
    "animation_cue": "idle"
  },
  "visible_intent": "Watching a favorite show",
  "trouble_signal": null,
  "household_id": "household-default"
}
```

顶层新增：

```json
{
  "world_version": "revision-token",
  "server_time": "2026-08-28T12:00:00Z",
  "next_transition_at": "2026-08-28T12:01:10Z",
  "rules_version": "life-v2",
  "households": [],
  "observable_moments": [],
  "open_incidents": [],
  "story_threads": []
}
```

迁移期保留 `social_interactions` 和 `world_action`，由适配器从新状态生成。

### 7.2 `GET /api/v1/life-stories`

查询参数：`level`、`status`、`npc_id`、`household_id`、`game_date`。默认只返回可观察内容，不返回隐藏 Desire 和隐藏关系维度。

### 7.3 `POST /api/v1/life-stories/{id}/observe`

观察不再触发世界结算。接口只记录玩家已观看并返回可见表演/摘要。若故事已经自主结算，返回当前事实。

### 7.4 `POST /api/v1/life-stories/{id}/intervene`

请求：

```json
{"action": "mediate", "idempotency_key": "..."}
```

响应包含每名参与者的独立反应、共同结果、可见余波和仍开放的 Thread。服务器校验动作是否仍允许。

### 7.5 `POST /api/v1/npcs/{id}/interactions/conversation`

服务端先检查 `current_action.interruptibility`，再决定进入会话、延后交谈或拒绝打断。`GET /room` 只读取会话场景，不再暗中停止生活动作。

### 7.6 Household API

首轮只读：

- `GET /api/v1/households`；
- `GET /api/v1/households/{id}`。

家具编辑进入后续阶段，再增加受限 PATCH。第一阶段默认 Household 由服务端惰性创建，避免提前建设复杂编辑器。

---

## 8. 前端方案

### 8.1 类型与数据层

修改：

- `web/src/types.ts`：新增 LifeAction、TroubleSignal、Household、Moment、Incident、StoryThread；
- `web/src/api.ts`：新增 stories/households/observe/intervene；
- `web/src/App.tsx`：世界刷新以 current_action 为主要居民状态，旧 world_action 仅作兼容。

### 8.2 3D 世界表现

修改 `web/src/three/world/WorldScene.tsx`：

- 状态从统一 `idle` 改为具体动作；
- current_action 决定位置、路径、动画和持续时间；
- 资源碰撞参与者允许在 Household 内靠近；
- Life Action 完成后刷新世界，但客户端不得自行结算；
- 跟随模式继续只控制摄像机。

### 8.3 现场 UI

新增组件建议：

- `ResidentActionLabel.tsx`：简短行为标签；
- `TroubleBubble.tsx`：只显示可披露烦恼；
- `MomentToast.tsx`：可选的轻量生活片段提示；
- `IncidentEncounter.tsx`：现场信息与上下文动作；
- `StoryThreadsPanel.tsx`：显示连续故事和余波，不显示待办数量；
- `HouseholdInspector.tsx`：成员、房间和共享资源状态。

迁移旧 `SocialStoryPanel` 与 `SocialEventEncounter`：先通过适配器支持新结构，稳定后再改名，避免一次大重写。

### 8.4 信息隐藏

正式玩家 UI 和普通 Agent 面板不显示：Desire/Commitment ID、精确 Need、acceptance score、隐藏 attraction、隐藏 resentment 和稳定种子。只有另行授权的开发诊断工具才能读取权威状态。

---

## 9. 内容数据

### 9.1 `life_actions.json`

每个行为模板包含：

- type；
- required need / desire source；
- required location / resource；
- duration range；
- interruptibility；
- need deltas；
- resource changes；
- animation cues；
- collision hooks；
- offline eligibility。

### 9.2 `life_scenarios.json`

每个碰撞模板包含：

- trigger；
- role assignment；
- preconditions；
- response candidates；
- Moment / Incident scoring；
- relation delta ranges；
- Thread hook；
- trouble signal rules；
- fallback presentation。

### 9.3 内容验证脚本

新增 `backend/scripts/check_life_content.py` 或测试实现以下验证：

- ID 唯一；
- 引用的资源、动作和动画存在；
- 数值范围受限；
- 至少一个自主结果；
- Incident 动作均有 fallback；
- Thread hook 指向合法类型；
- 不允许在内容文件直接写入任意 SQL、Prompt 或模型名称。

---

## 10. 分阶段实施

### Phase 0：文档与基线

状态：**已完成**

- [x] 统一 GDD、NPC Agent 和涌现剧情设计；
- [x] 写本实施方案；
- [x] 保留当前实现文档作为事实基线；
- [x] 确认后端测试和 Web lint/typecheck/build 基线可运行。

验收：文档不再同时要求任务驱动、固定事件配额和生活驱动。

### Phase 1：权威时间、关系与持久层基础

状态：**已完成**

- [x] `LIFE_SIMULATION_V2`、schema version、world revision 与事务推进器；
- [x] 扩展方向性 social edge；
- [x] relationship bonds、evidence 与 appraisal；
- [x] 多频道派生、滞回、衰减和显式恋爱转折；
- [x] Residence / Household / resources 增量迁移；
- [x] 旧关系与住宅数据兼容测试。

验收：关系变化均有幂等证据；结构关系、友情、冲突、竞争与恋爱可以并存，旧客户端仍能读取兼容状态。

### Phase 2：Life Action 与资源最小闭环

状态：**已完成**

- [x] 新增 life action 内容格式与 13 个行为；
- [x] runtime-v2 needs；
- [x] Desire 生成、评分和压抑；
- [x] Commitment 与 Life Action 状态机；
- [x] 独居与多人 Household fixture；
- [x] 厨房、电视、浴室资源；
- [x] 预约、占用、等待和释放；
- [x] 事件驱动离线推进；
- [x] 扩展 world API；
- [x] 并发与事务测试。

验收：NPC 无事件时也会持续做具体事情；两个 NPC 指向同一资源时不会重复占用；DeepSeek 关闭仍完整运行。

### Phase 3：Moment、Incident 与余波

状态：**已完成**

- [x] CollisionEngine；
- [x] 8 种室友摩擦；
- [x] 4 类友好 Moment 路径；
- [x] life_stories；
- [x] 现场 Moment 表现；
- [x] Incident 窗口和自主结算；
- [x] 主观记忆和后续余波；
- [x] 关系证据与双方独立 appraisal 结算；
- [x] 旧 social event 兼容读取并停止双重生成。

验收：观察不再是结算前置；未观察 Incident 会自主完成并留下痕迹。

### Phase 4：Unresolved Thread 与不确定干预

状态：**已完成**

- [x] unresolved_threads；
- [x] 重复主题连接与升级；
- [x] Trouble Signal；
- [x] 上下文管理动作；
- [x] 每名参与者独立 acceptance；
- [x] accepted later / refuse / backfire / mixed；
- [x] 玩家 UI 移除固定最佳答案暗示。

验收：同一调解动作跨不同情境不保证正向结果；家庭矛盾可跨日复发和解决。

### Phase 5：社会关系、恋爱与连续故事

状态：**已完成（首轮双人关系纵切）**

- [x] Story Thread 状态机；
- [x] comfort / resentment / respect / dependency 进入关系响应与派生；
- [x] 友情、疏远、竞争、敌视、误解与和解路径；
- [x] 单向心动、相互暧昧、拒绝/犹豫、约会、伴侣、分手与前任路径；
- [x] 年龄、亲属、偏好、边界和双方明确选择校验；
- [x] Story Threads Panel 与玩家安全的公开关系标签；
- [x] 家庭、同居和恋爱自主权进入角色编辑器。

验收：关系变化通过行为、记忆和连续故事可感知，而非只显示数字；恋爱不会成为友情的自动升级树，也不会绕过拒绝和边界。

### Phase 6：空间创造

状态：**等待首轮真人观察验证**

- [ ] 家具与资源放置；
- [ ] 房间用途；
- [ ] 空间改变行为可用性与碰撞概率；
- [ ] 第三人传闻、排斥、三角友情与三角恋；
- [ ] 后续评估服装、宠物和岛屿地形。

进入条件：Phase 1～5 的观察乐趣指标已经通过，不用内容编辑器掩盖生活模拟问题。

---

## 11. 测试方案

### 11.1 单元测试

- Desire 评分、压抑、过期和替代；
- Commitment 中断与重新规划；
- 资源容量、队列和释放；
- 碰撞角色分配；
- Moment / Incident 分级；
- acceptance 分支；
- Thread 创建、复发和解决；
- 关系范围与状态派生；
- 稳定种子重放。

### 11.2 数据库测试

- 从当前 schema 增量迁移；
- 旧数据读取不丢失；
- 并发 world refresh 不重复生成；
- 重复 intervention 不重复结算；
- 资源占用和 action 状态原子更新；
- 旧 social event 仍可查询。

### 11.3 API 测试

- world 响应兼容旧字段；
- 隐藏数据不泄露给玩家；
- observe 不修改已经结算的事实；
- 过期干预返回明确错误；
- 同一幂等键返回相同响应；
- 未授权用户不能读取他人 Household。

### 11.4 前端验证

- TypeScript；
- ESLint 与现有世界检查脚本；
- Vite production build；
- 10 分钟静置观察；
- 跟随、切换视角和动作完成刷新；
- 移动端及 reduced motion；
- 3D 帧率和内存；
- 无 DeepSeek 时完整玩法。

### 11.5 玩家验证指标

- 10 分钟内全城看到至少 3 次可辨认的到达、动作阶段或行为变化；真实持续数小时的睡眠/工作不要求为了指标被强制替换；
- 至少 1 次自主 NPC–NPC 碰撞；
- 玩家能描述至少 2 名角色的不同性格表现；
- 玩家主动查看或询问至少 1 个情况；
- 玩家不把所有气泡理解成必须完成的任务；
- 玩家能说出一件“我没控制但很想知道结果”的事情。

---

## 12. 发布与回滚

- 每个 Phase 使用独立小提交，不把 schema、引擎、UI 和大量内容一次提交；
- 新能力通过服务器配置开关 `LIFE_SIMULATION_V2` 分阶段启用；
- 默认先对本地和测试用户启用；
- 迁移只新增表/列，关闭开关即可回到旧生成路径；
- 不在回滚时删除新表或新数据；
- 发布前备份 SQLite；
- 发布后检查健康接口、错误日志、重复故事、卡住动作和资源泄漏；
- 确认稳定后再删除旧 social generation 路径，删除需单独方案和提交。

---

## 13. 开发命令基线

后端：

```bash
cd backend
python -m venv .venv
. .venv/bin/activate
pip install -e '.[test]'
pytest -q
uvicorn lingolife.app:app --reload
```

前端：

```bash
cd web
npm ci
npm run typecheck
npm run lint
npm run build
npm run dev
```

如果特定受限环境把 npm cache 指向不可写目录，只在该终端设置一个可写缓存目录，不要把本机绝对路径提交进仓库。

---

## 14. 跨环境交接模板

完成一个开发时段后，在本节顶部追加最新一条，不覆盖历史。每条最多包含必要事实。

```text
日期与环境：YYYY-MM-DD / 家里或公司
分支与提交：branch / commit
阶段与步骤：Phase N / step
已完成：
- ...
验证：
- command → result
未完成或已知问题：
- ...
下一步：
- 一个明确、可验收的动作
涉及文件：
- path
```

### 当前检查点

```text
日期与环境：2026-08-28 / 本地
分支与提交：main / 5bfd6e8 + 本检查点文档提交
阶段与步骤：Phase 5 / 生活表现层与室内纵切
已完成：
- 从本地 CC0 素材库导入 29 个运行时 GLTF 及完整依赖/许可证，组合成住宅、商业、公共单位、活动空间和公园等 11 组场景主题
- 住宅查看器支持客厅、厨房、浴室、卧室切换，默认聚焦有居民活动的房间；生活故事按权威地点选择室内/户外布景
- 地图、跟随、住宅、生活故事、旧社交事件和聊天统一使用行为/阶段/公开情绪驱动的动画、Kenney 状态气泡与 VFX
- 兴趣行为按音乐、绘画、摄影、健身、游戏、烹饪、阅读、写作、自然与电影分别表现；负面结果、麻烦和恋爱不再共用开心状态
- 服务端状态投影加入地点、对象、兴趣、职业/长期目标、阶段与进度的双语具体文案；修正兴趣行为权重垄断和连续重复
- sleep / shower 等私密行为只公开“在家处理私人事务”，城市隐藏精确房间/物品，住宅切面不渲染当事人
- 住宅相机明确朝向场景中心；单个室内模型加载失败时局部降级，不再拖垮整个 Canvas 或页面
验证：
- 后端 `pytest -q`：221 passed
- Web `typecheck` / `lint` / production `build`：passed
- 素材依赖、动画、世界覆盖层、布局、道路、装饰、导航、镜头和生活模拟守卫：passed
- 无头 Chrome 实际登录并打开住宅：1440×900 与 375×812 均成功渲染；角色/家具可见，移动端横向溢出为 0，页面运行时无错误
- 确定性 3 NPC / 2 天回归：81 个完成行为、12 类行为，兴趣行为占 18.5%，每名 NPC 最近 5 次至少 4 类
未完成或已知问题：
- 当前两套角色 GLB 都没有面部 Morph；“表情”由兼容身体动画、状态气泡和 VFX 表达
- KayKit / Quaternius 坐椅、躺床、进食、手持物动画与现有角色骨骼不兼容，精确物件接触仍需离线重定向和 IK 校正
- 本轮只导入会实际渲染的 1.5 MB 室内/UI 子集，原始候选素材与音频仍保留在本地素材库，未整包塞进首屏
下一步：
- 真人连续观察多名居民一天的室内/公共地点切换；确认表现密度后，离线重定向一套最高价值的坐、躺、做饭与健身动作链
涉及文件：
- backend/lingolife/life_observable.py
- backend/lingolife/life_service.py
- web/src/three/interiors/
- web/src/life/characterExpression.ts
- web/src/components/HouseholdInteriorPreview.tsx
- web/public/assets/life/
```

```text
日期与环境：2026-08-28 / 本地
分支与提交：main / 9d5047f（后端）+ 0a872a8（前端）+ 本检查点文档提交
阶段与步骤：Phase 1～5 / 首轮生活模拟纵切
已完成：
- 13 类 Life Action、13 类碰撞场景、持续时间、资源预约、离线追赶和确定性重放
- Household / Residence / 共享资源拓扑，以及合住、拆分、补货和持久化投影
- 方向性十维关系、友情、冲突、竞争、停战与自主恋爱；正式关系必须记录双方明确接受
- Moment / Incident / Story Thread、观察与限时管理干预；NPC 在玩家不介入时仍会完成生活
- 普通生活、关系频道、家庭信息、故事面板和轻量 3D 相遇演出进入 Web 主流程
- DeepSeek、聊天、流式响应和缓存重放只接收玩家可观察的安全投影
验证：
- 后端 `pytest -q`：214 passed
- Web `typecheck` / `lint` / production `build`：passed
- 3D overlay、素材、动画、布局、道路、装饰、导航、镜头和生活模拟结构守卫：passed
- 5 名 NPC 共享世界 30 天 soak：2266 个行为、1236 次规则碰撞，约 9.96 秒完成；分段推进与一次推进核心事实一致
未完成或已知问题：
- Phase 6 的空间编辑、群体/第三人关系剧情和更丰富的场景内容尚未实现
- 职业和长期目标已参与行动排序与目的地选择，但完整班次、日历和职业事件仍待实现
- 英语学习内容、等级曲线和 UI 按产品优先级暂缓，本轮仅保持兼容
- 自动化 soak 中底层碰撞数量较高；公开 UI 依靠显著性、冷却和 TTL 控制注意力密度，仍需真人长时间试玩校准
下一步：
- 本地进行一轮 10～30 分钟真人观察与干预试玩，记录故事重复度、注意力密度和恋爱/冲突可理解性；确认后再决定是否通过开关部署
涉及文件：
- backend/lingolife/life.py
- backend/lingolife/life_world.py
- backend/lingolife/life_service.py
- backend/lingolife/relationships.py
- backend/lingolife/collisions.py
- backend/lingolife/stories.py
- web/src/life/
- web/src/components/LifeStoryEncounter.tsx
```

---

## 15. 决策记录

### ADR-001：不使用 LLM 驱动每 Tick 行为

原因：成本、延迟、不可重放和世界事实不稳定。采用规则行为 + 可选 LLM 表达。

### ADR-002：不在第一步重写为通用 ECS/GOAP

原因：当前 FastAPI + JSON 状态足以验证四人 Household。先实现明确领域模型，再根据性能证据决定是否重构。

### ADR-003：关系基础先于碰撞，恋爱内容晚于生活闭环

原因：碰撞从第一天就需要方向性心理、证据和积怨；共享空间能以较低内容成本验证这些规则。恋爱数据与边界从关系基础阶段建立，告白、约会和分手内容在生活碰撞稳定后接入，避免把所有关系误写成恋爱升级树。

### ADR-004：观察不再触发结算

原因：等待玩家点击会让 NPC 看起来围绕玩家暂停生活。观察只记录观看并返回表现，规则结果由世界时间推进。

### ADR-005：固定事件配额改为注意力预算

原因：强制数量会制造不合理相遇和任务感。行为持续发生，UI 只提升值得注意的内容。

### ADR-006：保留旧表并通过适配器迁移

原因：保护现有玩家数据并保持可回滚。删除旧路径必须等新系统稳定后单独执行。

### ADR-007：Residence 与 Household 分离

原因：现有角色已经各自拥有地图住宅，不能为了室友垂直切片无解释地搬迁。独居、同居和拜访应使用同一数据模型，测试账号再显式创建多人 Household。

### ADR-008：英语扩展暂缓但保持兼容

原因：当前阶段验证重点是“世界是否真的在生活”。现有聊天、翻译、学习证据和 XP 路径继续运行，但不让英语内容扩建阻塞生活模拟核心。

### ADR-009：生活行为使用真实持续时间，验收改看状态变化

原因：把睡眠、工作或外出压缩成几十秒会让世界像循环演示，而不像生活。首轮行为使用约 10 分钟至 8 小时的领域持续时间；短时验收观察到达、阶段切换、相遇和余波，不要求每个长行为都在试玩窗口内结束。

### ADR-010：关系承诺必须来自双方离散选择

原因：连续数值适合描述好感和压力，却不能代替同意。约会、伴侣和停战等结构状态必须存在双方可审计的接受记录；犹豫、拒绝和单向吸引只影响方向性心理边，不会静默升级关系。
