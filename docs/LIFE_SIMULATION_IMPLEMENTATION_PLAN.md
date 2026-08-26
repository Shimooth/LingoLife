# LingoLife 生活模拟改造技术实施方案

- 版本：0.1
- 创建日期：2026-08-26
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

---

## 3. 改造约束

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
- 恋爱完整 UI、婚姻和生育；
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

建议新增：

- `backend/lingolife/life.py`：Desire、Commitment、Life Action 和离线推进；
- `backend/lingolife/household.py`：Household、成员、房间和资源；
- `backend/lingolife/collisions.py`：行为碰撞与规则模板；
- `backend/lingolife/stories.py`：Moment、Incident、Thread 和干预；
- `backend/content/life_actions.json`：行为模板；
- `backend/content/collisions.json`：碰撞模板；
- `backend/content/household_defaults.json`：首轮住宅与资源；
- `backend/tests/test_life.py`；
- `backend/tests/test_household.py`；
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

每个玩家第一次拥有两个以上 NPC 时惰性创建默认 Household。旧 home slot 仍作为城市住宅位置，成员在该住宅内拥有逻辑房间。

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
jealousy INTEGER NOT NULL DEFAULT 0,
friendship_status TEXT NOT NULL DEFAULT 'stranger',
romance_status TEXT NOT NULL DEFAULT 'none'
```

保留旧 `status` 供旧客户端读取，迁移期由 friendship_status 派生并同步。

### 5.8 新表 `unresolved_threads`

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

### 5.9 新表 `life_stories`

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

### 5.10 索引与清理

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

首轮模拟粒度：

- 在线：读取世界时最多推进到当前时间，不设后台常驻 worker；
- Life Action 时长：约 20 秒～5 分钟；
- 离线：按 morning / afternoon / evening / night 四段批量模拟关键行为；
- 单次 catch-up 设置天数上限，超出部分只恢复基础状态并生成摘要。

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

### 7.5 Household API

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

正式玩家 UI 不显示：Desire 分数、acceptance score、隐藏 attraction、隐藏 resentment 和稳定种子。Agent/管理调试界面可在权限内显示。

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

### 9.2 `collisions.json`

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

### Phase 1：Life Action 最小闭环

状态：**未开始**

- [ ] 新增 life action 内容格式与 12 个行为；
- [ ] runtime-v2 needs；
- [ ] Desire 生成、评分和压抑；
- [ ] Commitment 与 Life Action 状态机；
- [ ] 扩展 world API；
- [ ] 3D 世界显示具体行为；
- [ ] 离线分段推进；
- [ ] 单元测试、集成测试和幂等测试。

验收：四名 NPC 无事件时也会持续做具体事情；DeepSeek 关闭仍完整运行。

### Phase 2：Household 与共享资源

状态：**未开始**

- [ ] households / members / resources 增量迁移；
- [ ] 默认四人 Household；
- [ ] 厨房、电视、浴室资源；
- [ ] 预约、占用、等待和释放；
- [ ] Household Inspector；
- [ ] 并发与事务测试。

验收：两个 NPC 同时指向同一资源时不会重复占用，并能进入碰撞规则。

### Phase 3：Moment、Incident 与余波

状态：**未开始**

- [ ] CollisionEngine；
- [ ] 8 种室友摩擦；
- [ ] 4 种友好 Moment；
- [ ] life_stories；
- [ ] 现场 Moment 表现；
- [ ] Incident 窗口和自主结算；
- [ ] 主观记忆和次日余波；
- [ ] 旧 social event 适配。

验收：观察不再是结算前置；未观察 Incident 会自主完成并留下痕迹。

### Phase 4：Unresolved Thread 与不确定干预

状态：**未开始**

- [ ] unresolved_threads；
- [ ] 重复主题连接与升级；
- [ ] Trouble Signal；
- [ ] 上下文管理动作；
- [ ] 每名参与者独立 acceptance；
- [ ] accepted later / refuse / backfire / mixed；
- [ ] 玩家 UI 移除固定最佳答案暗示。

验收：同一调解动作跨不同情境不保证正向结果；家庭矛盾可跨日复发和解决。

### Phase 5：关系扩展与连续故事

状态：**未开始**

- [ ] 扩展 social edges；
- [ ] Story Thread 状态机；
- [ ] comfort / resentment 进入行为决策；
- [ ] attraction / jealousy 数据预留与规则；
- [ ] 单向心动、暧昧、告白和拒绝的第一组内容；
- [ ] Story Threads Panel。

验收：关系变化通过行为、记忆和连续故事可感知，而非只显示数字。

### Phase 6：空间创造

状态：**未开始**

- [ ] 家具与资源放置；
- [ ] 房间用途；
- [ ] 空间改变行为可用性与碰撞概率；
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

- 10 分钟内看到至少 3 次行为变化；
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
日期与环境：2026-08-26 / 家里
分支与提交：main / 以 git log -1 为准
阶段与步骤：Phase 0 / 设计与实施方案
已完成：
- 统一生活模拟、NPC Agent 和涌现剧情设计
- 明确当前运行时与目标架构的差异
- 制定 schema、API、前端、测试、发布和六阶段迁移方案
验证：
- 后端 pytest：90 passed（改文档前基线）
- Web typecheck / lint / build：passed（改文档前基线）
未完成或已知问题：
- 尚未实现 Life Simulation v2 代码
- 当前 social.py 仍是每游戏日最多一对 NPC、四模板路径
下一步：
- Phase 1：先添加 life action 内容 schema、12 个行为模板及内容校验测试
涉及文件：
- backend/content/life_actions.json（待新增）
- backend/lingolife/life.py（待新增）
- backend/tests/test_life.py（待新增）
```

---

## 15. 决策记录

### ADR-001：不使用 LLM 驱动每 Tick 行为

原因：成本、延迟、不可重放和世界事实不稳定。采用规则行为 + 可选 LLM 表达。

### ADR-002：不在第一步重写为通用 ECS/GOAP

原因：当前 FastAPI + JSON 状态足以验证四人 Household。先实现明确领域模型，再根据性能证据决定是否重构。

### ADR-003：Household 先于完整恋爱

原因：共享空间能以更低内容成本持续制造可观察行为和关系余波，是验证“人味”的最短路径。

### ADR-004：观察不再触发结算

原因：等待玩家点击会让 NPC 看起来围绕玩家暂停生活。观察只记录观看并返回表现，规则结果由世界时间推进。

### ADR-005：固定事件配额改为注意力预算

原因：强制数量会制造不合理相遇和任务感。行为持续发生，UI 只提升值得注意的内容。

### ADR-006：保留旧表并通过适配器迁移

原因：保护现有玩家数据并保持可回滚。删除旧路径必须等新系统稳定后单独执行。
