# LingoLife GDD 垂直切片验收证据矩阵

- 审计日期：2026-09-04
- 设计基线：[`LingoLife GDD.md`](../LingoLife%20GDD.md) v0.4、[`NPC Agent 系统设计文档.md`](../NPC%20Agent%20系统设计文档.md) v0.4、[`随机事件生成系统设计文档.md`](../随机事件生成系统设计文档.md) v0.4
- 实施基线：[`LIFE_SIMULATION_IMPLEMENTATION_PLAN.md`](LIFE_SIMULATION_IMPLEMENTATION_PLAN.md) v0.7
- 审计对象：当前工作树。代码、内容数据、数据库迁移、自动测试、Web 静态守卫和真实浏览器检查共同构成证据；历史勾选或单独出现一个字段不算通过。

## 1. 判定规则与结论

| 状态 | 含义 |
|---|---|
| **通过** | 当前主链路已实现，并有直接自动证据；涉及画面的项目还需有真实浏览器检查。 |
| **部分** | 已有可运行纵切，但设计合同仍有明确未闭合部分。 |
| **缺失** | 当前没有对应主链路或硬性验收证据。 |
| **不计入** | GDD 12.3 或正文明确放在本轮之后。 |

当前工作树已经大幅超过原先的“聊天 Demo”：生活行为、碰撞、关系、跨日 Thread、有限干预、首次建组、共享住宅、布局发布、迁移审计、居民成长和城市布局运行语义均形成了规则化纵切。GDD 12.2 与 12.4 的当前纵切项均已有直接自动或真实浏览器证据，但这仍不等于“整个长期 GDD 已全部完成”：听说读写分维度、复杂秘密与群体社会系统、通用城市扩张语义，以及最终美术/动画、低端 GPU、多账号压力和权限硬化仍未完成。

## 2. 当前阶段边界

以下内容不作为本轮失败项：多 Household、多活跃 Residence、独居与搬家、第二套正式室内主题、宠物、完整服装绘制、自由地形、多玩家同步、无边界任意行为和 LLM 运行世界状态机。三角关系、群体传闻、小团体、婚姻与代际也仍属后续扩展。

## 3. GDD 第 2～11 章运行契约

### 3.1 玩家、生活循环与世界

| ID | 设计要求 | 当前代码与测试证据 | 判定 |
|---|---|---|---|
| 2.1 | 观察者查看位置、行为、情绪迹象与关系故事；跟随只改变镜头 | `WorldObserver3D.tsx`、`WorldScene.tsx`、`ResidentActionLabel.tsx`、`StoryThreadsPanel.tsx`；`check-world-navigation.mjs`、`check-world-camera.mjs` | **通过**。角色路线和结算仍由服务端事实决定。 |
| 2.2 | 管理者可询问、建议、调解、帮助或给空间；NPC 可接受、延迟、拒绝或反效果 | `LifeWorldEngine._offer_story_interventions/_participant_acceptance`、`settle_story_with_management`；`test_management_action_and_each_participants_reaction_change_rule_owned_consequences`、`test_high_tension_low_trust_can_backfire_through_the_engine` | **通过**。动作集合按碰撞上下文生成，并逐参与者结算。 |
| 2.3 | 玩家不能直接写内部状态、强制关系/相遇或刷新重抽；布局不能改写动态事实 | 玩家 API 只接受公开 Profile、chat 和受限 Management Action；布局 schema 禁止额外字段 | **通过**。`test_public_snapshot_hides_attraction_internal_policy_and_deterministic_state`、`test_layout_mutations_require_admin_origin_and_reject_unknown_fields`、`test_publish_failure_success_and_rollback_never_mutate_dynamic_world_facts`。 |
| 2.4-a | 介绍确认后一次创建 2～8 人；少于 2 人不能进入正式世界 | `OnboardingFlow.tsx`、统一 `require_world_ready`、可恢复 setup saga | **通过**。`test_main_world_apis_share_ready_gate_and_open_after_completion` 与四个故障边界的 `test_setup_saga_recovers_from_each_projection_boundary_without_duplicates`。 |
| 2.4-b | 默认 Agent 合同完整、可编辑、整组有差异且刷新不重抽 | 12 个完整公开原型、`NpcProfile`、`normalize_profile_contract`、`avatar_contract.py`、Onboarding/CharacterStudio | **通过（首轮合同）**。亲属以阵容索引原子提交并校验同阵容、无自指、合法互反角色；共同历史 Hook 使用受限类型/语气/长度和每人上限并可持久编辑；Avatar 的 model、子部件和材质颜色全部经过服务端白名单。`test_onboarding_social_contract.py` 直接覆盖 2/4/8、非法引用/资产及重启恢复。 |
| 3.1～3.3 | NPC 首先生活；事件由行为碰撞提升；玩家只改变倾向 | `life.py` → `life_world.py` → `collisions.py` → `stories.py` | **通过**。Ambient 与 Incident 分流，普通 Tick 无模型依赖，干预结果由规则和稳定种子决定。 |
| 3.4 | 优先琐碎生活摩擦 | `life_scenarios.json` 覆盖八类指定摩擦；真实食物所有权、垃圾负载、私人物品与家务事实进入碰撞 | **通过**。`test_each_required_roommate_friction_is_rule_reachable_with_three_reactions` 及垃圾、私有/共享食物、借物的自然可达测试。 |
| 3.5 | 同一事实允许不对称主观解释 | 每名参与者独立 response、appraisal、directional evidence 和 memory seed | **通过**。`test_autonomous_resolution_is_deterministic_directional_and_rule_owned`；主观记忆还会有界影响后续同主题 response，见 `test_subjective_memory_biases_but_does_not_lock_a_future_response`。 |
| 4.1～4.2 | 分钟级观察闭环；日级 Need → Desire → Commitment → Action → Collision → Thread | `LifeWorldEngine.advance`、story observe/intervene、离线追赶 | **通过**。精确十分钟、分段/离线等价和 30 天 soak 均有自动测试。 |
| 4.3 | 回访发现昨日余波、连续故事、目标进展与对玩家的记忆 | `recent_aftermath`、Story panel、对话记忆/摘要、`development.py` | **通过（当前纵切）**。完成的 Life Action 与已结算 Story/Thread 进入同一幂等 Evidence ledger，缓慢推进目标、习惯、信心和关系策略，并以安全的定性 DTO 随城市/Agent 返回。旧聊天事件目标路径仍保留为兼容入口。 |
| 5.1 | 地点是行为条件 | Life Action 的 location/resource 约束、职业/目标地点排序、同地点碰撞 | **通过（规则地点）**。`test_occupation_and_free_form_goal_change_schedule_ranking_and_destination`、`test_behavior_facts_naturally_reach_borrowed_item_noise_and_closed_facility_scenarios`。 |
| 5.2 | 单一 Household/Residence、私人空间、共享区与持续家庭状态 | canonical shared home、稳定 `private_room_id`/sleep anchor、personal inventory、shared rule expectations、厨房/电视/浴室、清洁/噪声/库存/预算/责任 | **通过（空间合同）**。同一 Residence 内已有 8 间边界独立、带门/床/灯/个人痕迹的卧室，稳定 slot 唯一绑定 active NPC，并通过连续走廊接入共享区；`test_shared_home_layout.py` 与 `check-shared-home.mjs` 校验 2/4/8、净空和锚点。新视觉的实机品质验收另见 12.2 第 4 项。 |
| 5.3 | 管理端白名单作者工具、拓扑校验、预览、版本发布/回滚 | schema v4 的 CAS 草稿、SHA-256 不可变版本、active 指针、审计；纯拓扑校验与管理 UI | **通过（首轮作者闭环）**。断路、压路、完整占地重叠、挡门、缺锚点/fixture 均拒绝；发布/回滚不改写 NPC 动态事实。独立“布局作者”角色和按需 3D 分包是生产硬化项。 |

### 3.2 Agent、关系与涌现剧情

| ID | 设计要求 | 当前代码与测试证据 | 判定 |
|---|---|---|---|
| 6.1 | Persona、偏好/怪癖、动态状态、日程、欲望、目标、关系、记忆、边界与 Household 责任 | `profile_contract.py`、`compile_persona`、runtime-v2、Daily Plan、Desire stack、relationship graph、`development.py`、shared history、personal inventory/rule expectations | **部分（长期内容）**。首轮合同、亲属/共同历史、目标/习惯成长和隐藏 Trouble 已闭合；更通用的长期秘密内容、职业日历和群体社会记忆仍未达到完整 GDD 范围。 |
| 6.2 | Daily Plan 是工作/课程/睡眠/已接受邀约约束；即时行为可中断并留下后果 | 持久 `daily_plans[date].blocks`、reciprocal invitation、迟到/疲劳/失约 consequence、reasoned transition log | **通过**。`test_daily_plans_are_deterministic_persisted_and_include_reciprocal_invitation`、`test_urgent_need_can_break_a_plan_and_leaves_a_reasoned_consequence`。 |
| 6.3 | 多 Desire、压抑/替换/过期、一个主 Commitment 和一个排队意图 | 持久 `desire_stack`、`queued_commitment`、frustration/disappointment aftermath | **通过**。`test_desire_stack_has_authoritative_lifecycle_queue_and_is_not_public`。 |
| 6.4 | 只公开动作与有限迹象，不公开隐藏需要、欲望、关系与概率 | 多层 allowlist 投影；私密 sleep/shower 折叠为 `private_time`；按关系阶段过滤记忆 | **通过**。`test_private_action_and_restricted_memories_never_reach_api_or_provider` 与 DeepSeek prompt 二次投影测试。 |
| 7.1 | A→B / B→A 分离；十维心理边；第三人影响有来源 | `relationships.py` 的 directional edges、Evidence/Thread | **通过**。没有裸 `jealousy` 数值；第三人影响必须引用事件/Thread。 |
| 7.2 | 结构、友情、冲突、竞争和恋爱频道并存；恋爱需资格和双方选择 | RelationshipPair/bonds/state transitions | **通过（双人纵切）**。覆盖单向心动、暧昧、约会、伴侣、拒绝、分开和前任。 |
| 7.3 | Unresolved Thread 保存主题、双方视角、复发、升级和主题匹配修复 | `update_unresolved_thread`、关系证据与三日 fixture | **通过**。`test_one_thread_recurs_escalates_and_is_repaired_across_three_days`。 |
| 7.4 | 传闻、排斥、三角关系与小团体 | 数据结构允许多参与者和第三人 Evidence | **不计入**。完整群体玩法尚未实现。 |
| 8.1 | Ambient / Moment / Incident / Story Thread 四层 | `stories.py`、公共 world DTO | **通过**。分级、TTL、观察不触发结算均有测试。 |
| 8.2 | Trouble Signal 取决于披露意愿；无气泡也可有故事 | `disclosure.py` 使用强度、玩家信任、disclosure style、自尊、隐私边界与可信室友；决定持久化 | **通过**。`test_live_collision_persists_who_tells_player_and_who_confides_elsewhere`，刷新/编辑不会重抽。 |
| 8.3 | 干预可立即/延迟/拒绝/误解/反效果/双方不同反应/事后改变，并稳定幂等 | `settle_story_with_management` 和参与者独立接受度 | **通过**。`misunderstood` 已是不同于拒绝和反效果的规则分支，拥有独立 outcome、关系变化、记忆种子和双语余波；`test_misunderstood_is_distinct_from_refusal_and_backfire` 与引擎级测试直接覆盖。 |
| 8.4 | 未观察内容自主推进，并留下关系、环境、记忆、计划或 Thread 痕迹 | deadline settlement、memory seed、aftermath、schedule consequence、recent recap | **通过**。 |

### 3.3 英语、成长与 AI 边界

| ID | 设计要求 | 当前代码与测试证据 | 判定 |
|---|---|---|---|
| 9.1 | 跟踪听说读写和知识点，按能力/前沿/兴趣/历史适配 | `learning.py`、A2/B1 catalog、浏览器语音输入/朗读 | **部分**。知识点 mastery、复习与总体难度已实现；服务端尚未把听、说、读、写建成四个独立能力维度或保存语音测评证据。 |
| 9.2 | 只有玩家相关语言行为产生学习证据 | chat analysis → constrained evidence → `LearningEngine`；Life simulator 不产生学习证据 | **部分**。文字对话已闭环；事件调解、公共阅读和语音结果尚无独立 evidence 来源。 |
| 9.3 | 同一知识点随人物和生活情境变化 | Prompt 含安全 Persona、当前 Life/Story、记忆和 learning targets | **部分**。输入合同已具备，但缺跨多个角色/场景的自动表达质量评测。 |
| 9.4 | 优先交流；语法不直接决定关系；规则层更新 XP/掌握度 | `TurnAnalysis` 只允许 semantic signals、learning evidence、memory candidates 和 animation cue；`chat_rules.py` 计算关系/情绪/XP | **通过**。`test_turn_analysis_rejects_model_authored_gameplay_numbers`、`test_language_errors_do_not_cancel_an_understandable_caring_intent`。 |
| 10.1 | 重复经历缓慢改变信心、习惯与关系策略 | `development.py` 的统一 Evidence ledger、relationship evidence/decay/hysteresis、runtime axis growth | **通过（规则/数据纵切）**。只有已完成 Life Action 与已结算 Story/Thread 产生有来源、可指纹校验的成长证据；重复 ID 不重复推进、冲突 ID 失败关闭、单次变化很小且有界，公开层不泄露 ledger。`test_development.py` 直接覆盖。 |
| 10.2 | 形成朋友、竞争、敌对、恋人、前任等差异化社会结构 | 多频道关系状态机和 30 天 soak | **通过（双人关系）**。 |
| 10.3 | 城市/住宅改变应改变行为条件、稀缺与碰撞概率 | `layout_runtime.py` 编译 active 城市建筑锚点、building family、道路图、地点机会和住宅 fixture/容量；`LifeWorldEngine` 消费版本化运行合同 | **部分（首轮城市/住宅语义闭环）**。移动建筑会改变保存的最短道路路线和 journey duration；替换 building family 会关闭不兼容的 reading/dining 等机会资源；布局换版保留在途旧 journey、关系和故事。任意新资源类型、动态营业/施工和真正城市扩张仍未泛化。 |
| 10.4 | 服装、家具、宠物和地形创作进入行为反馈 | — | **不计入**。当前只实现运营布局作者工具及首组三类住宅资源语义。 |
| 11.1 | 规则层拥有事实、状态机、关系、记忆、幂等、干预和学习结算 | LifeWorld/Collision/Story/Relationship/Learning/ChatRule engines，SQLite CAS 与事务/恢复日志 | **通过（当前纵切）**。玩家 chat 的 provider 数值已失效；对话响应与后续效果使用持久 journal/幂等恢复链路。 |
| 11.2 | LLM 只表达既定事实和受约束语义；失败时模板接管 | 安全投影、DeepSeek schema、`ResilientProvider`、规则化 NPC–NPC interaction scene | **通过**。`test_deepseek_disabled_still_runs_onboarding_world_simulation_and_chat`。 |

## 4. GDD 12.2 范围逐项核对

| # | 12.2 要求 | 当前最强证据 | 判定 |
|---:|---|---|---|
| 1 | 首次介绍、身份引导、不可跳过的 2～8 人门槛 | intro acknowledgement、服务端统一 ready gate、可恢复 setup saga、`check:onboarding` | **通过**。 |
| 2 | 完整、随机、可编辑并促进阵容差异的默认设定 | 12 个完整公开原型；前后端字段/roster difference；原子亲属与共同历史合同；Avatar 全字段白名单；2/4/8 重启测试 | **通过**。共同历史只种下过去事实和语气，不预写友情、敌意或恋爱结果。 |
| 3 | 所有 active 居民归属一个 Household/Residence | canonical reconciliation、active-only roster、shared-home tests | **通过**。 |
| 4 | 一套正式品质、必要房间和资源锚点齐全的共享住宅 | 共享客厅/厨房/浴室、13 行为锚点、3 类资源，以及带墙/门/床/灯/个人痕迹的 8 间独立卧室；单一 manifest 同时驱动后端与 Web | **通过（当前纵切）**：空间、容量、唯一绑定和程序化 3D 表现有自动证据；1440×900 与 390×844 真实 Chrome/WebGL 验证 8 个卧室标签可见、dock/follow 稳定且无 console exception。骨骼重定向/IK 和最终独立美术打磨是长期品质项，不阻塞当前纵切验收。 |
| 5 | 管理端使用批准资产编辑并发布城市/住宅 | 62 项机器可读资产目录、CAS draft、validate、immutable publish/history/activate/rollback | **通过**。 |
| 6 | 13 种个人行为 | `life_actions.json` 与 `test_catalog_defines_all_core_actions_and_bounded_resources` | **通过**。 |
| 7 | 厨房、电视、浴室至少 3 类共享资源 | reservation/queue/release、2/4/8 fixture、布局容量编译 | **通过**。 |
| 8 | 8 种室友摩擦 | 八类逐项内容合同；垃圾、食物、借物有权威事实链路 | **通过**。 |
| 9 | 4 种友好 Moment | 分享食物、共同娱乐、顺手帮助、安静陪伴逐项可选并分级为双人 Moment | **通过**。 |
| 10 | Desire、Commitment 和行为中断 | 持久 stack、queue、压抑/替代/过期余波、reasoned transitions | **通过**。 |
| 11 | 1 条跨三天的 Unresolved Thread | `test_one_thread_recurs_escalates_and_is_repaired_across_three_days` | **通过**。 |
| 12 | 友情、冲突、竞争与恋爱频道及首组转折 | directional multi-channel engine 与 romance consent tests | **通过**。 |
| 13 | Trouble Signal 与隐藏问题 | 持久 disclosure decision、可信室友分流、公开投影 | **通过**。 |
| 14 | 干预可成功、拒绝、延迟或反效果 | contextual intervention 和每参与者独立结算 | **通过**。 |
| 15 | 自主结算、主观记忆与次日余波 | autonomous deadline、memory feedback、`recent_aftermath` API/UI | **通过**。 |

汇总：12.2 的 **15 项当前纵切全部通过**；没有“部分”或“缺失”项。这不能被解释成“整个长期 GDD 已经完成”：骨骼重定向/IK、最终美术打磨和低端 GPU 性能仍在长期品质清单中。

## 5. GDD 12.4 核心验收逐项核对

| # | 12.4 硬性验收 | 当前最强证据 | 判定 |
|---:|---|---|---|
| 1 | 静置十分钟有 ≥3 次行为变化和 ≥1 次自主 NPC–NPC 碰撞 | `test_fixed_ten_minute_observation_has_three_changes_and_one_autonomous_npc_collision` | **通过**。使用固定世界时钟推进，不依赖 CI 实时等待。 |
| 2 | 同一碰撞因人格/关系出现至少 3 种反应 | `test_same_collision_has_three_persona_or_relationship_dependent_reactions` | **通过**。事实不变，只改变 Persona/关系。 |
| 3 | 同一管理动作在不同情境不保证相同结果 | mixed/backfire/contextual acceptance tests | **通过**。 |
| 4 | 未观察 Incident 自主结算并在次日留下可见余波 | `test_autonomous_settlement_waits_for_deadline_and_is_effect_idempotent` + `test_city_projects_only_previous_week_resolved_aftermath` | **通过（规则/API 接缝）**。真实跨日浏览器回访仍属于人工体验回归。 |
| 5 | 家庭矛盾可复发、升级或修复 | 三日 Thread fixture | **通过**。 |
| 6 | 关闭、刷新、重启不重复结算或重抽 | stable IDs/seeds、world revision CAS、DB reopen、intervention/chat idempotency 与恢复测试 | **通过**。 |
| 7 | 普通环境行为不调用 LLM | 纯规则模块与无 DeepSeek 完整循环测试 | **通过**。 |
| 8 | 新账号 <2 不能进城，2～8 一次创建，>8 禁止新增 | 服务端 ready gate、Pydantic、setup saga、limit tests | **通过**。 |
| 9 | 默认字段完整且有差异；编辑后年龄、亲属、边界和资产校验 | `NpcProfile`、`avatar_contract.py`、`materialize_onboarding_profiles`、前端 social contract editor、`test_onboarding_social_contract.py` | **通过**。直接覆盖 2/4/8 人，亲属同阵容/无自指/合法互反，Hook 类型/长度/参与者/上限，所有 Avatar 子部件与颜色白名单，以及旧别名、编辑、刷新和进程重启持久化。 |
| 10 | 2/4/8 人在同一住宅完成占用、排队、碰撞与离线推进 | 参数化 `test_two_four_and_eight_residents_share_one_home_and_survive_resource_pressure_and_offline_time` | **通过**。还校验稳定私人睡眠绑定及无独立住宅回退。 |
| 11 | 布局拒绝非白名单、断路、压路、缺锚点和重叠；发布/回滚不改 NPC 事实 | `test_layout_validation.py`、`test_layout_publication.py`、`test_layout_runtime_simulation.py` | **通过**。缩容时不驱逐在途 lease。 |
| 12 | 旧账号迁移不丢事实；异常账号有报告、不静默截断 | schema v5 inventory、SHA-256 before/after、管理员显式选 2～8、其余 archive 不删除、active-only simulation、重建复核 | **通过**。`test_migration_audit.py` 同时覆盖故障事务回滚与非法旧 fixture 隔离。 |

汇总：12.4 的 **12 项全部通过**。这是当前垂直切片的自动验收结论，不代表 12.3 明确暂缓内容或长期 GDD 的生产质量、内容规模和性能验收已经完成。

## 6. NPC Agent 文档“首轮验收”逐项核对

| # | 验收项 | 判定与证据 |
|---:|---|---|
| 1 | 介绍及 2～8 门槛 | **通过**：intro 持久化、统一 API gate、setup saga。 |
| 2 | 完整合同、2/4/8 差异与持久化 | **通过**：公开 Persona/Household 字段、阵容差异、原子互反亲属、共同历史 Hook、Avatar 全字段白名单和进程重启持久化均有直接测试。 |
| 3 | 单一住宅、日程、回家、私人空间和共享资源 | **通过（数据/空间合同）**：稳定绑定 8 间独立私人卧室、personal inventory、shared rules 与共享资源；最终实机视觉质量单列为产品硬化，不否定 Agent 合同。 |
| 4 | 十分钟内 ≥3 次行为/阶段变化 | **通过**：精确时间 fixture。 |
| 5 | Need 触发可观察行为 | **通过**：低 food 选择 eat，紧急需求可打断计划并留下 consequence。 |
| 6 | 共享资源产生至少 3 种人格化处理 | **通过**：`test_each_shared_resource_has_three_persona_or_relationship_driven_reactions` 固定厨房、电视、浴室事实，分别只改变 Persona/关系上下文并逐资源命中 3 种不同处理及关系后果。 |
| 7 | 被压抑 Desire 可过期、替代或留余波 | **通过**：stack/queue/frustration/disappointment 测试。 |
| 8 | A/B 保存不同记忆 | **通过**：方向性 appraisal/memory seeds；旧记忆会有界影响后续同主题反应。 |
| 9 | 干预覆盖成功、延迟、拒绝、反效果 | **通过**。 |
| 10 | Thread 跨日复发并由对应行为解决 | **通过**：三日 recurrence/escalation/repair。 |
| 11 | 无玩家时自主行为和关系推进 | **通过**：deadline settlement、离线推进、30 天 soak。 |
| 12 | 无 DeepSeek 时完整运行 | **通过**：onboarding → world → chat fallback 的端到端测试。 |
| 13 | 布局只接受批准资产/拓扑；发布回滚不改动态事实 | **通过**。 |
| 14 | 旧账号保留事实；超限不静默丢失 | **通过**：v5 迁移审计与 roster review。 |

汇总：NPC Agent 文档的 **14 项首轮验收全部通过**。这不包含文档中更长期的群体社会、通用秘密内容和内容规模目标。

## 7. 涌现剧情文档“验收标准”逐项核对

| # | 验收项 | 判定与证据 |
|---:|---|---|
| 1 | 2/4/8 人持续行为，公开密度受注意力预算控制 | **通过**：`story_attention_budget` 随 2/4/8 人次线性扩张并分别给 desktop/compact 上限；选择器综合强度、时效与主题重复，紧急 Incident 保留；服务端报告 suppressed 数，前端按视口二次收束。`test_story_attention.py` 直接覆盖。 |
| 2 | 至少 3 类共享资源产生等待、让步、协商和冲突 | **通过**：厨房、浴室、电视的四响应模板和队列碰撞测试。 |
| 3 | 同一模板有至少 3 种人格/关系反应 | **通过**：固定碰撞三上下文测试。 |
| 4 | 大部分生活行为不进入事件列表 | **通过**：Ambient 无 Trouble Signal，不进入 Incident；完成后仅保留有限摘要。 |
| 5 | Incident 某天可为零，不强补配额 | **通过（架构）**：V2 只由事实碰撞提升，初始化与推进没有每日事件配额调用；冷却阻止轮询造新事件。 |
| 6 | Trouble Signal 仅对愿意披露的 NPC | **通过**：披露/可信室友/隐藏三条路径及持久化。 |
| 7 | 同一动作跨情境不固定正向 | **通过**：接受、延迟、拒绝、misunderstood、mixed、backfire。 |
| 8 | 未观察 Incident 自主结算并有次日余波 | **通过（规则/API 接缝）**。 |
| 9 | 重复家务连接同一 Thread | **通过**：稳定 topic key、recurrence、三日修复。 |
| 10 | 刷新、重复请求和重启不改变结果 | **通过**：稳定种子、CAS、幂等和持久 journal。 |
| 11 | 普通生活不依赖 LLM | **通过**：无 DeepSeek 完整循环。 |

汇总：涌现剧情文档的 **11 项验收全部通过**。注意力参数仍需要真人长时校准，但已经不是固定上限或缺失的运行合同。

## 8. 本轮五个用户缺陷的实际结果

| 缺陷 | 当前结果 | 验证 |
|---|---|---|
| NPC–NPC 每人一句即结束 | 每个新碰撞把已经结算的 response 编译为 setup / exchange / reaction / closure 四阶段、至少 5 个双语 beat；双方至少各两句，Persona、关系阶段和 response 会改变台词、情绪与动作；历史场景持久化后不受后来改档影响 | `interaction.py`、`test_life_interactions.py`、`test_collision_story_persists_its_replayable_multistage_interaction`、`check-life-simulation.mjs`。它是有限内容库而非无限自由对话，扩内容仍有价值。 |
| 左上人物状态溢出 | desktop 的 2/4/8 人 dock 限高并只在自身区域滚动；mobile 只在 dock 内横滚，body `overflowX=0`；长标签收束/省略 | 1440×900 与 390×844 的 8 人真实 Chrome/WebGL 检查，无溢出。 |
| 选中人物放大 | hover/active/idle 使用同一模型比例；只使用脚下圈和状态 UI | camera guard + overview/top/follow 浏览器检查。 |
| 人物视角建筑变形 | 建筑 mesh 等比缩放，占地修正放在稳定父容器；视角切换不重写 geometry scale | `worldTransforms.ts`、`check-world-camera.mjs` 与近景浏览器检查。 |
| 室内简陋/不自然 | 单一 shared-home manifest 现定义共享客厅/厨房/浴室和连续卧室走廊；8 间私人卧室各有完整边界、墙体、门洞、床、灯和不同个人痕迹，并按 active roster 稳定唯一绑定 | `IndoorEnvironment3D.tsx`、`sharedHomeLayout.ts`、`test_shared_home_layout.py` 与 `check-shared-home.mjs`；1440×900 和 390×844 真实 Chrome 中 8 个卧室标签可见、follow 稳定且无 console exception。这已不是共用 sleeping hall；最终独立美术、低端 GPU 与精确动作接触仍属长期品质项。 |

## 9. 仍需继续的真实缺口

1. 新八卧室翼已通过桌面/移动 Chrome smoke；仍需更严格的最终材质/遮挡打磨和低端 GPU 性能验收。坐/躺/进食/手持物件仍需骨骼重定向或 IK，面部 Morph 仍无源资产支持。
2. 城市运行合同现已使用 active 建筑锚点、building family、道路最短路和地点机会；下一步是把任意新资源/建筑能力、动态营业/施工和真正的城市扩张统一成可版本化语义，而不是继续增加特例。
3. 英语系统继续按已确认优先级暂缓：听说读写分维度、语音测评、阅读/调解 evidence 与跨场景表达质量评测均未完成。
4. 三角关系、传闻、排斥、小团体、复杂秘密传播和群体场景仍是长期范围；当前关系与现场表达的强证据主要集中在双人纵切。
5. 布局作者仍共用管理员角色，Web 3D 编辑器尚未按需分包；还需低端移动设备帧率/内存、并发多账号和发布中运行世界的压力测试。
6. 自适应注意力已经按人数、视口、强度、时效和重复工作，但阈值仍需 8 人长时间真人试玩校准；真实跨日浏览器回访也应加入发布回归。
7. shared-history Hook 已进入持久 Persona 合同；后续内容扩展应让它在更多候选行为和场景台词中产生可解释差异，同时继续禁止预写关系结局。

## 10. 验证基线

本次当前工作树已经得到以下结果：

- `cd backend && .venv/bin/pytest -q`：**434 passed**；
- onboarding 亲属/共同历史/Avatar 合同：**30 项直接测试通过**；另有 onboarding/Phase 6 相关组合 **63 passed（9.18s）**；
- 自适应注意力 **3 项**、统一成长 Evidence **7 项**、shared-home **8 项**、layout runtime **9 项**聚焦测试均包含在全量结果中；`misunderstood` 另有规则层与引擎层直接测试；
- Web `npm run typecheck`、完整 `npm run lint`（含全部世界/素材/动画/作者/onboarding/shared-home 静态守卫）与 production build：**passed**；
- 最新真实 Chrome/WebGL：**1440×900 与 390×844 通过**；8 人 dock 无溢出、follow 稳定、8 个 bedroom labels 可见，NPC 现场共 5 个双语 beats（Felix 3 / Theo 2），无 console exception。

最终集成仍应运行：

```bash
backend/.venv/bin/pytest -q backend/tests
npm --prefix web run typecheck
npm --prefix web run lint
npm --prefix web run build
npm --prefix web run check:onboarding
npm --prefix web run check:life-simulation
npm --prefix web run check:world-camera
npm --prefix web run check:world-authoring
npm --prefix web run check:shared-home
```

本文件只记录已经存在的证据，不把测试名当成测试结果。上述数字是 2026-09-04 当前工作树的检查点；之后若代码继续变化，必须重跑，任一测试失败时相应“通过”项自动降级为“未验证”。
