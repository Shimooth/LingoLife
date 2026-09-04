# 旧账号单一共享住宅迁移

当前迁移版本为 `single-household-v1`，审计格式为 `single-household-audit-v2`。迁移只改变“哪些角色参与实时模拟”和可重建的世界/住宅投影，不删除 NPC 档案或历史数据。

## 自动盘点

后端首次打开 pre-v5 数据库时，会在同一个 SQLite 事务中为每个旧玩家生成基线快照和持久审计报告。快照不包含聊天、记忆或档案正文，只保存逐表行数、整表 SHA-256、逐行 SHA-256 和全部 NPC ID。

盘点覆盖角色档案与状态、NPC 关系、消息与幂等聊天结果、记忆、随机事件、学习状态、Persona/Runtime/Goal/Daily Plan、生活行动与故事、关系证据，以及 `life_world_states`、住宅、家庭成员和家庭资源投影。

状态规则：

- 0–1 人：`needs_onboarding`，不假装世界已准备完成。
- 2–8 人：`ready`，全员进入模拟阵容。
- 9 人及以上：`needs_roster_review`，进入城市前阻断，等待管理员明确选择 2–8 人。
- 孤儿 NPC 引用或损坏 JSON：`blocked_invalid_fixture`，隔离该存档但不阻止服务器启动。

## 超员账号处理

管理员在“内测管理后台 → 旧账号迁移审计”中逐个勾选 2–8 位活跃角色，并输入完整用户名确认。服务端同时要求当前迁移 revision，防止两个管理页面覆盖彼此。

未选中的角色只会写入 `archived_npc_ids_json`：

- `npc_profiles` 行仍然存在；
- 该角色的消息、记忆、关系、事件与学习事实不删除；
- 玩家城市、共享住宅、生活事件和 NPC-NPC 模拟只接收 `active_npc_ids`；
- 同一选择重试是幂等的，不会重复写报告。

选择事务会先后采集快照并做严格比较；状态更新和审计报告任一写入失败时，整个选择回滚。

## 世界重建后的第二次校验

玩家第一次成功打开城市后，生活模拟会用活跃阵容建立单一共享住宅。随后系统只执行一次 post-world 校验：

- 角色 ID 必须全部仍在（包括已归档角色）；
- 档案、消息、记忆、学习等受保护事实必须保持相同校验和；
- 住宅与世界投影允许重建，但前后行数和校验和会保留在报告中；
- 派生模拟表允许更新或增加，不允许行数减少；
- 任何不符合预期的变化会将存档置为 `blocked_verification_failed`。

## 管理 API

- `GET /api/v1/admin/roster-migrations?status=needs_roster_review`
- `GET /api/v1/admin/users/{user_id}/roster-migration`
- `GET /api/v1/admin/users/{user_id}/roster-migration/reports`（即使测试账号后来重置，也可读取保留的历史报告）
- `POST /api/v1/admin/users/{user_id}/roster-migration/select`

写接口需要管理员安全 Cookie、正确的管理域名 Origin、完整用户名确认、迁移 revision，以及 2–8 个唯一且属于该旧档的 NPC ID。
