# LingoLife backend

> 本文后半部分保留 2026-08-26 的旧 `SocialWorldEngine` 兼容接口说明，不再代表当前完整 world contract。2026-09-03 首版已经加入 onboarding、2～8 人整组创建、单一共享住宅协调与 world-layout API；完整目标、已验证范围和剩余差额以 [`../docs/LIFE_SIMULATION_IMPLEMENTATION_PLAN.md`](../docs/LIFE_SIMULATION_IMPLEMENTATION_PLAN.md) 的当前检查点为准，运行时精确接口以当前 OpenAPI 和测试为准。

Python 3.11+：

```bash
cd backend
python -m venv .venv
. .venv/bin/activate
pip install -e '.[test]'
uvicorn lingolife.app:app --reload
pytest
```

默认数据库是 `./data/lingolife.db`。生产环境通过 `LINGOLIFE_CONFIG` 指向 YAML，秘密仅通过 `DEEPSEEK_API_KEY` 和 `DATABASE_URL` 环境变量注入。未配置 DeepSeek 或调用失败时，API 自动使用安全的规则回复。

## NPC 社交世界契约

NPC 社交由 `SocialWorldEngine` 的确定性规则负责，DeepSeek 不能指定关系数值、选择结算结果或绕过管理介入窗口。

SQLite 启动时会增量迁移旧数据库：已有 `npc_social_edges` 保留，自动补充 `familiarity`、`trust`、`tension` 字段；新建 `npc_social_events`。每对居民有两条方向性边（A → B 和 B → A），字段均为 0–100：

- `familiarity`：熟悉度
- `trust`：信任
- `affinity`：好感
- `tension`：紧张程度
- `status`：由以上数值计算的 `stranger`、`acquaintance`、`friend`、`close_friend` 或 `strained`

`GET /api/v1/city`（别名 `GET /api/v1/world`）是每日世界的惰性刷新入口。首次读取某个游戏日期时，服务端依据日期、日程交集、地点、人格、兴趣、长期目标、当前需求/压力、关系状态和近期社交历史选择参与者。事件 ID 由玩家、日期和参与者稳定散列得到，数据库同时以 `(player_id, game_date, event_key)` 去重；当天重复读取、进程重启和并发插入都不会重复结算。

城市响应新增：

- 顶层 `social_interactions`：当天可观察的 NPC 间互动，含地点、时段、参与者、关联角色、重要度、状态和管理契约。
- 每名居民的 `social_interaction_ids` 与 `related_npc_ids`。
- 每名参与者的 `world_action`：包含 `walking_to_event` / `waiting_at_event` 状态、共同目的地、出发/到达时间和参与者序号；顶层 `server_time` 供客户端做平滑插值。

事件创建后先进入 `traveling`。NPC 从各自的当前位置沿客户端确定性人行道路线前往共同地点；到达后，普通事件进入 `awaiting_observation`，高影响事件进入 `awaiting_management`。在玩家观看或管理前，关系、记忆和情绪不会提前结算。普通事件通过观察接口展开：

```http
POST /api/v1/social-events/{event_id}/observe
Authorization: Bearer <session>
```

高影响事件提供有限的管理动作：

```http
POST /api/v1/social-events/{event_id}/intervene
Authorization: Bearer <session>
Content-Type: application/json

{"action":"mediate"}
```

动作限定为 `mediate`、`encourage`、`give_space`、`let_them_handle_it`。观察和管理接口均幂等：重复请求返回同一结果，关系规则原子更新两条方向边，并为每位参与者写入各自视角的 `social` 记忆。未观看事件不会永久卡住世界；下一游戏日首次读取时会惰性自主结算，再为新的一天评估事件。`GET /api/v1/social-events` 可用可选的 `game_date`、`npc_id` 查询，角色 Agent/房间响应也会暴露与该角色相关的 `social_interactions`。
