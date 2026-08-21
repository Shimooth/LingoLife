# LingoLife Demo API

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

普通事件立即以 `resolved_autonomously` 结算，规则原子更新两条方向边，并为每位参与者写入各自视角的 `social` 记忆。若进程在“生成”和“结算”之间退出，下一次世界读取会继续推进而不是重复创建。高影响冲突保持 `awaiting_management`，不预先修改关系；介入窗口会跨日保留，并暂缓生成下一件社交事件，避免冲突被悄悄覆盖：

```http
POST /api/v1/social-events/{event_id}/intervene
Authorization: Bearer <session>
Content-Type: application/json

{"action":"mediate"}
```

动作限定为 `mediate`、`encourage`、`give_space`、`let_them_handle_it`。相同动作重试返回同一结算结果；事件结算后改用另一动作返回 `409 SOCIAL_EVENT_CLOSED`。`GET /api/v1/social-events` 可用可选的 `game_date`、`npc_id` 查询，角色 Agent/房间响应也会暴露与该角色相关的 `social_interactions`。
