# NPC Agent 系统设计文档

- 版本：0.4
- 产品决定更新：2026-09-03
- 项目：LingoLife
- 文档性质：目标设计契约
- 实施计划：[`docs/LIFE_SIMULATION_IMPLEMENTATION_PLAN.md`](docs/LIFE_SIMULATION_IMPLEMENTATION_PLAN.md)

---

# 一、系统目标与边界

## 1.1 目标

NPC Agent 的目标不是让 NPC 更会聊天，而是让居民在玩家不操作时也能持续、可解释地生活。

每名 NPC 必须能够：

- 在日程约束内产生多个短期欲望；
- 根据人格、风险、关系和环境选择或压抑欲望；
- 执行、打断和重新规划生活行为；
- 与居民、住宅资源和城市环境发生碰撞；
- 对同一共同经历形成不同解释；
- 在没有玩家介入时自主推进；
- 接受、延迟、拒绝或误解玩家建议；
- 用符合其人格和玩家英语水平的语言表达已经确定的事实。

## 1.2 玩家边界

玩家始终是城市的观察者或管理者，不是 NPC 的扮演者。

玩家可以观察、询问、提供资源、建议、调解、撮合或离开，但不能直接设置 NPC 的情绪、欲望、关系和决定。所有重大行为都由规则层依据 NPC 内部状态结算。

当前阶段的城市与共享住宅布局由开发/运营人员在管理端编辑。该作者工具只定义可用地点、房间、资源锚点、道路和视觉资产，不是玩家管理动作，也不能写入某名 NPC 的动态状态、移动进度、关系、记忆、欲望、Commitment 或事件结果。

## 1.3 规则层与 LLM

规则层负责：

- 时间、位置、资源和参与资格；
- Desire、Commitment、Life Action 和中断；
- 关系、家庭、记忆、未解决问题及结果；
- 稳定种子和幂等；
- 玩家干预接受度；
- 离线推进和学习结算。

LLM 负责：

- 按既定事实生成人格化英文台词；
- 表达角色的主观解释；
- 调整语言难度；
- 提取受约束的语义与学习证据。

普通环境行为不得调用 LLM。LLM 失败时，模板表达必须能完成整个流程。

---

# 二、Agent 组成

```text
NPC Agent
├── Identity & Persona
├── Preferences & Quirks
├── Emotion & Needs
├── Daily Plan
├── Desire Stack
├── Commitment
├── Life Action
├── Goal
├── Relationship Graph
├── Household Role
├── Memory
├── Unresolved Threads
├── Observability
└── Dialogue & Learning Adapter
```

Daily Plan 是背景约束，Desire 和 Commitment 才驱动即时生活。Incident 是行为碰撞后的产物，不是 Agent 每天直接领取的任务。

当前每个玩家世界只运行一个由 2～8 名活跃居民组成的 Household。共享住宅是这些 Agent 发生日常资源碰撞的共同上下文，不允许为新居民悄悄创建独立 Household 来绕过容量、家务和关系规则。

---

# 三、身份、人格与偏好

## 3.1 固定身份

固定身份包括：姓名、年龄、职业、长期目标、家庭身份和角色边界。修改角色外观或职业不能重置已有记忆和关系。

## 3.2 人格轴

保留当前的人格轴：

- warmth；
- extraversion；
- assertiveness；
- openness；
- emotional_stability；
- humor。

人格影响行为选择、表达方式、冲突策略、求助意愿和干预接受度，但不直接决定结果。

## 3.3 行为倾向

由人格轴派生：

- initiative：主动程度；
- conflict_style：回避、协商或直接；
- support_style：倾听、实用帮助或保持距离；
- disclosure_style：公开、选择性或隐藏；
- persistence：欲望被阻碍后是否继续尝试；
- flexibility：是否容易改变计划；
- pride：是否抗拒他人介入。

## 3.4 偏好、厌恶与怪癖

兴趣不足以产生人味。每名 NPC 还需要：

- `likes`：食物、音乐、活动、地点和相处方式；
- `dislikes`：噪声、混乱、迟到、特定食物或行为；
- `quirks`：反复检查门、收藏杯子、吃饭很慢等低风险怪癖；
- `habits`：固定时间喝咖啡、睡前阅读、周末打扫等习惯；
- `boundaries`：隐私、借物、身体距离、金钱和关系边界。

这些字段必须进入候选行为和碰撞条件，而不是只进入 LLM Prompt。

## 3.5 完整默认合同与阵容差异

首次创建世界时，系统先让用户建立 2～8 名居民的阵容，再为整组居民生成完整默认 Agent 合同。“完整”不等于把所有规则数值暴露给玩家：合同分为可编辑的公开角色档案，以及由服务端编译、校验并持有的规则字段。两层合并后不得留下影响行为的未定义必填值。单名合同至少包含：

- 姓名、年龄、职业、长期目标和 Household 角色；
- 六个人格轴及派生行为倾向；
- 兴趣、喜欢、厌恶、怪癖、习惯和边界；
- 外观资产配置、私人空间偏好和家务倾向；
- 恋爱自主权、年龄/亲属限制及可披露边界；
- 与同住居民的客观结构关系，以及经规则明确允许的方向性初始熟悉度或共同历史 Hook。

随机生成以“阵容”为单位，而不是从同一个模板逐个换名。首轮从版本化完整预设池抽取不重复原型，并约束人格距离、兴趣重叠、日程分布、家务倾向和社交方式：同组居民既要存在自然共同点，也要有足以产生不同选择、互补、误解或摩擦的差异。确认前可以逐名重抽。同住会建立一致的 housemate 客观结构关系，心理边允许从中性基线开始；阵容差异的验收重点是之后在相同经历中产生不同解释和关系轨迹，不是为了“有戏”随机预写友情、敌意、约会、伴侣或世仇。

用户可以在进入世界前修改所有对外公开且安全可编辑的设定；人格轴、隐藏需求和关系心理数值等规则字段只能由服务端从公开设定编译或由随后的真实经历推进，不提供数值直改入口。前端负责即时完整性和阵容差异提示，服务端负责字段范围、资产白名单、客观结构关系双向一致性、年龄、亲属与恋爱边界的最终校验；修改任一居民后重新检查整个阵容。确认创建后，编辑姓名、职业或外观不能清空已有关系、记忆和事件，也不能用重新随机生成来重抽已经结算的世界事实。

---

# 四、动态状态

## 4.1 情绪

运行时情绪继续使用：

```json
{
  "valence": 62,
  "stress": 38,
  "energy": 68
}
```

情绪影响欲望强度、行为速度、冲突升级和干预接受度。情绪是连续状态，不用一个 `happy/sad` 标签替代。

## 4.2 需求

核心需求：

- food；
- rest；
- social；
- achievement；
- love；
- privacy；
- fun；
- security。

需求只能通过实际或离线模拟的行为改变。不能继续仅靠“每日计划暗含吃饭和睡觉”自动恢复而不产生任何生活记录。

## 4.3 状态推进

在线时按世界 Tick 惰性推进，离线时按时间段批量模拟。两种方式必须使用相同规则和稳定种子，最终事实保持一致。

为控制成本，只有状态发生可观察变化、资源被占用或产生碰撞时才持久化 Life Action；普通数值衰减可以批量结算。

---

# 五、Daily Plan

Daily Plan 表示不能轻易违背的背景约束：工作、课程、睡眠和已接受的邀约。

```json
{
  "date": "2026-08-27",
  "blocks": [
    {"start": "09:00", "end": "17:00", "kind": "work", "location_id": "innovation_hub"},
    {"start": "23:00", "end": "07:00", "kind": "sleep_window", "location_id": "room-emma"}
  ]
}
```

在空闲窗口内，NPC 根据 Desire 决定行为。紧急需求、事故或高强度关系事件可以打断计划，并留下迟到、疲惫或失约后果。

不再使用“早上工作、下午目标、晚上恢复”三槽位作为完整行为系统。

---

# 六、Desire Stack

## 6.1 数据结构

Desire 是尚未承诺执行的候选短期欲望。

```json
{
  "id": "desire-emma-tv-20260827-01",
  "type": "use_shared_resource",
  "target_id": "living-room-tv",
  "subject_id": null,
  "intensity": 68,
  "urgency": 35,
  "visibility": "observable",
  "expires_at": "2026-08-27T21:00:00+08:00",
  "blocked_by": ["resource_occupied"],
  "reason": "favorite_show",
  "source": "habit"
}
```

`visibility` 可为 `hidden`、`observable` 或 `shareable`。内部欲望分数不直接暴露给玩家。

## 6.2 欲望来源

- 低需求值；
- 日常习惯；
- 兴趣和偏好；
- 长期目标的当前步骤；
- 对某人的关系和记忆；
- Household 责任；
- 环境机会和资源稀缺；
- 最近被阻碍的欲望；
- 他人的邀请、请求或行为。

## 6.3 候选评分

```text
desire_score =
  need_pressure
  + habit_strength
  + goal_relevance
  + relationship_pull
  + environment_opportunity
  + urgency
  - schedule_conflict
  - social_risk
  - resource_cost
  - personality_inhibition
  + stable_seed_variation
```

稳定种子只制造可复现的差异，不替代逻辑条件。

## 6.4 压抑与替换

高分 Desire 仍可能因害羞、自尊、疲劳、边界、过去失败和对方状态而被压抑。压抑结果可以：

- 直接过期；
- 延后；
- 替换为更安全的行为；
- 增加 stress 或 resentment；
- 形成可观察的犹豫；
- 转化为向他人求助。

---

# 七、Commitment 与 Life Action

## 7.1 Commitment

Commitment 是 NPC 已决定尝试执行的意图，包含目标、可接受替代方案、坚持度和取消条件。

一个 NPC 同时只能拥有一个主要 Commitment，可以保留一个排队意图。新高优先级 Desire 可以中断当前承诺。

## 7.2 Life Action 状态机

```text
planned
→ traveling
→ performing
→ completed

planned / traveling / performing
→ blocked
→ retrying / substituted / abandoned

任意进行中状态
→ interrupted
→ replanned
```

每次状态变化需要记录原因，避免客户端或 LLM 猜测世界事实。

## 7.3 首轮行为库

首轮实现 13 种规则行为：

- prepare_food；
- eat；
- sleep；
- shower；
- use_television；
- read；
- practice_hobby；
- borrow_household_item；
- clean_shared_space；
- leave_dishes；
- rest_alone；
- seek_company；
- talk_to_resident。

行为模板定义需求、资源、地点、时长、动画、可中断性、完成效果和碰撞 Hook。

## 7.4 环境碰撞

当行为目标不可用或另一个 NPC 同时使用资源时，系统根据双方 Commitment、关系和人格决定：等待、协商、让步、加入、争抢、离开或求助。

碰撞先生成规则事实，再决定是否提升为 Moment 或 Incident。

---

# 八、Household Agent Context

当前产品阶段采用单一共享住宅拓扑：一个玩家只有一个活跃 Household 和一处活跃 Residence，所有 2～8 名活跃居民均属于该 Household。Residence 仍作为空间实体独立于 Household 保存，但独居、多 Household、搬家和同时运行多套住宅资源不进入本轮状态机。

## 8.1 家庭成员状态

每名成员拥有：

- household_id；
- private_room_id；
- household_role；
- chore_preferences；
- personal_inventory；
- privacy_need；
- 对共享规则的主观期待。

## 8.2 共享资源

资源包含容量、占用者、使用队列、状态和清洁度。例如电视容量可以大于 1，但节目偏好可能冲突；浴室容量通常为 1。

## 8.3 家务与责任

家务不是每日打卡任务。系统记录：

- 谁制造了工作；
- 谁预期应该处理；
- 谁实际处理；
- 是否被提醒；
- 是否形成亏欠或积怨。

重复不平衡可以形成分工、主动照顾、争吵或边界谈判。

开发/运营在管理端调整室内布局时，只能改变下一版本可用的房间、资源容量、锚点和路径条件。发布必须版本化；运行中的资源租约和 Life Action 先由服务端安全迁移、完成或重新规划，编辑器不得直接把占用者移走、清除脏盘子、解决家务 Thread 或写入关系变化。

---

# 九、关系系统

## 9.1 方向性社交边

A → B 与 B → A 分开保存：

```json
{
  "familiarity": 48,
  "trust": 57,
  "affinity": 61,
  "respect": 54,
  "tension": 24,
  "comfort": 66,
  "resentment": 18,
  "attraction": 0,
  "dependency": 12,
  "fear": 0,
  "friendship_status": "friend",
  "conflict_status": "friction"
}
```

不允许将多维关系压缩成单一“relationship +10”作为 NPC–NPC 社交的唯一结算。

## 9.2 结构关系与关系频道

家人、室友、同事、邻居、同学和导师等结构关系是客观 bond，不由心理数值推导或删除。友情、冲突、竞争和恋爱分别保存为可并存频道；例如同一对 NPC 可以同时是“室友 + 好朋友 + 冷战”，也可以是“前任 + 仍然互相信任”。

旧 `status` 只作为兼容摘要，不再作为权威关系事实。

## 9.3 关系状态机

友情状态由多维数据和共同历史共同决定。恋爱状态额外需要双方角色边界、年龄规则、吸引、熟悉、时机和明确结果。

一方心动不自动改变另一方。告白可以被拒绝；拒绝不必必然摧毁友情；分手后保留前任关系和共同记忆。

约会、伴侣、分开等双方承认的恋爱状态只能由明确关系事件写入。恋爱必须满足年龄、亲属、个人偏好和边界约束；第一版只有双方均满 18 岁且启用恋爱边界时才允许进入正式恋爱频道。

## 9.4 关系证据与第三人影响

每次关系变化保存唯一 Evidence、客观事实、NPC 的主观 appraisal、规则版本和实际维度变化。进入或退出朋友、敌对等标签还需要行为证据、持续时间和滞回，避免一次小摩擦使状态反复跳变。

jealousy、被排除感和传闻必须引用明确第三人或事件来源，不能凭空增长或保存成无上下文裸数值。群体事件在后续阶段实现，但数据结构不能假设事件永远只有两名参与者。

---

# 十、记忆与未解决问题

## 10.1 记忆类型

- episodic：具体经历；
- relationship：对某人的关系解释；
- household：共同生活和责任；
- secret：受披露边界保护的信息；
- language：与玩家学习相关的表达证据；
- player_fact：玩家自己透露的信息。

## 10.2 主观记忆

共同事件先保存客观事实，再为每名参与者生成受规则约束的主观视角。LLM 可以润色文字，但视角标签、情绪方向、责任归因和访问权限由规则决定。

## 10.3 Unresolved Thread

```json
{
  "id": "thread-dishes-emma-alex",
  "kind": "household_conflict",
  "topic": "dishwashing",
  "participant_ids": ["emma", "alex"],
  "source_event_ids": ["moment-001", "incident-004"],
  "intensity": 42,
  "recurrence_count": 2,
  "status": "unspoken",
  "perspectives": {
    "emma": "I keep cleaning up after Alex.",
    "alex": "Emma never told me it bothered her."
  }
}
```

状态包括 `unspoken`、`raised`、`escalated`、`temporarily_settled`、`resolved`、`dormant`。暂时解决可以复发，真正解决需要符合主题的行为证据。

---

# 十一、Trouble Signal 与可观察性

## 11.1 信号条件

Trouble Signal 只在 NPC 愿意对玩家披露时出现。判定考虑：

- 问题强度和紧迫度；
- 对玩家的信任；
- disclosure_style；
- 自尊和隐私边界；
- 是否已经向其他居民求助；
- 事件是否仍有有效干预窗口。

## 11.2 玩家可见层级

1. 动画、位置和环境痕迹；
2. 简短行为标签；
3. 可分享意图或烦恼气泡；
4. 玩家询问后的主观说明；
5. 关系足够深入后才开放的秘密和历史。

普通玩家可打开的 Agent 面板仍属于正式玩家界面，只展示语义化可观察状态。欲望 ID、承诺 ID、精确需求值和隐藏吸引力只能进入另行鉴权的开发诊断工具，也不能原样发送给外部对话模型。

---

# 十二、玩家干预

## 12.1 管理动作

管理动作必须针对上下文生成受限集合，例如：询问、安慰、建议、提供资源、调解、鼓励、给空间、撮合或不介入。

不能对所有 Incident 固定显示同一组四个按钮。

## 12.2 接受度

```text
acceptance_score =
  action_fit
  + trust_in_player
  + current_openness
  + relationship_context
  - pride
  - stress
  - boundary_violation
  + stable_seed_variation
```

结果分为：

- accepted_now；
- accepted_later；
- politely_refused；
- misunderstood；
- backfired；
- mixed：多名参与者反应不同。

按钮不能直接携带“最佳答案”视觉暗示。结算后应通过行为、台词和余波解释结果，而不是只显示数值。

## 12.3 幂等

结果种子至少包含玩家、Incident、动作和规则版本。相同动作的重复请求返回相同结果，不重复写入关系和记忆。

---

# 十三、对话与英语适配

## 13.1 对话输入

仅加载与当前交流相关的：人格合同、当前事实、可披露意图、关系阶段、相关记忆、未解决问题、玩家学习前沿和最近对话。

不把隐藏欲望、第三人的秘密和无关全量记忆交给模型。

## 13.2 对话目标

对话目标来自实际生活上下文：解释正在做的事、表达感受、请求帮助、回应玩家、谈论他人或继续 Story Thread。没有上下文时允许闲聊，但不能伪造新世界事件。

## 13.3 学习结算

模型只返回语义信号和学习证据。规则层决定关系变化、英语 XP、掌握度和事件推进。语法错误不直接等于不尊重或关系下降。

---

# 十四、运行与性能原则

- 生活模拟必须采用规则和模板，不能为每个 NPC Tick 调用 LLM；
- 同一玩家世界使用稳定世界种子；
- 在线只模拟可见或即将影响可见区域的详细行为；
- 离线使用批量时间段模拟，不逐秒重放；
- 客户端只表现服务端事实，不能上报位置来跳过状态机；
- 所有关系、资源、记忆和 Incident 结算必须事务化；
- 旧数据通过增量迁移保留，禁止要求清空玩家数据库。

---

# 十五、首轮验收

- 新账号先完成介绍和角色创建；少于 2 名不能启动世界，2～8 名可确认，超过 8 名不能新增；
- 随机生成的每名居民都有完整合同，2、4、8 人阵容均满足字段完整、预设不重复、人格可辨认；即使心理边共用中性基线，也能在相同生活刺激下产生可解释的不同选择和关系轨迹；确认后合同稳定持久化；
- 所有活跃居民共享同一个 Household/Residence，日程、回家、私人房间和共享资源不能回退到每人独立住宅；
- 十分钟内全城至少出现三次可辨认的到达、动作阶段或行为变化；睡眠、工作等长行为不要求被人为切碎；
- 需求变化能够触发可观察行为，不只是后台数值变化；
- 共享资源同时被两个 Commitment 指向时能产生至少三种人格化处理方式；
- 一个被压抑的 Desire 可以过期、替代或形成情绪/关系余波；
- A 和 B 对同一事件能够保存不同记忆；
- 玩家干预至少覆盖成功、延迟、拒绝和反效果；
- Unresolved Thread 能跨日复发并通过对应行为解决；
- NPC 无玩家在场时仍可自主完成行为和关系推进；
- 普通生活模拟在 DeepSeek 不可用时完整运行。
- 管理端布局编辑只接受批准资产和合法拓扑；发布与回滚不直接改变 NPC 动态事实，普通玩家无法获得作者权限；
- 旧账号统一住宅时保留 Persona、关系、记忆、消息、事件、目标和学习记录；0～1 人账号补建角色，异常超限账号不静默丢失角色。

以上标准优先于增加更多聊天模板、宏大任务和外观编辑选项。
