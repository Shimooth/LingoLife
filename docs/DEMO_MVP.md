# LingoLife 单房间 Demo 产品与技术方案

版本：0.2
状态：历史验证基线；不再定义当前产品循环和下一实施阶段

本文保留用于理解早期单房间聊天 Demo、兼容旧接口和复用旧测试指标。当前目标设计与实施范围由
[`../LingoLife GDD.md`](../LingoLife%20GDD.md) 和
[`LIFE_SIMULATION_IMPLEMENTATION_PLAN.md`](LIFE_SIMULATION_IMPLEMENTATION_PLAN.md)
定义。

## 1. Demo 要验证什么

现有设计的共同核心不是“AI 批改英语”，而是：玩家因为关心一个持续变化的 NPC，主动用英语交流，并从世界变化中感受到成长。

本 Demo 只验证一条闭环：

```text
Emma 表达烦恼
→ 玩家用英语回应
→ 服务端理解并评价表达
→ Emma 以角色身份回答
→ 关系、心情、英语经验变化
→ Web 页面更新状态、反馈与角色视觉
```

产品成功标准：首次打开后，玩家能在 3 分钟内完成至少 3 轮对话，理解数值为何变化，并愿意继续询问 Emma 的近况。技术成功标准：不安装客户端即可通过链接完成测试，改动前端后无需重新打包分发。

## 2. 功能范围

### 包含

- 一个固定房间场景
- 一个 NPC：Emma
- 一个玩家（本地匿名身份）
- 一个状态栏
- 一个聊天记录区、输入框、Send 按钮
- 三个养成值：关系、心情、英语经验
- Emma 的 idle / sad / happy 三种视觉状态（首版可用 CSS 或静态占位图）
- DeepSeek 生成结构化对话结果
- SQLite 保存玩家状态和最近对话
- AI 不可用时的规则降级回复

### 不包含

- 登录注册、多人、支付、语音
- 多房间、多 NPC、自定义角色
- 向量数据库和永久记忆
- 随机事件系统、现实热点
- 完整 CEFR 测评、课程与单词系统
- 自动 CI/CD（首版先用可复核的部署脚本）
- Unity 打包、商店发布和客户端热更新

## 3. 初始内容

```text
NPC: Emma
关系 relationship: 35 / 100
心情 mood: 35 / 100
英语经验 english_xp: 0 / 100
初始状态: sad
初始台词: I had a terrible day at work...
```

三个数值分别表达：

- `relationship`：Emma 对玩家的信任与亲近程度。
- `mood`：Emma 当前情绪，只表示短期状态。
- `english_xp`：玩家通过有效英语交流获得的成长反馈；Demo 中不宣称它等同于 CEFR 等级。

所有数值由服务端裁剪在 `0..100`。单次关系和心情变化限制在 `-5..5`，英语经验变化限制在 `0..5`，避免模型直接控制游戏经济。

## 4. 界面草图

```text
┌──────────────────────────────┐
│ Emma                         │
│ ❤️ 35   😊 35   English 0   │
│                              │
│         [Emma 动画]          │
│                              │
│ Emma:                        │
│ I had a terrible day         │
│ at work...                   │
│                              │
│ [________________________]   │
│                       Send   │
└──────────────────────────────┘
```

发送期间禁用输入与按钮并显示短加载状态。失败时保留玩家输入，展示可重试提示；不要把服务端异常或密钥信息显示给玩家。

## 5. 系统结构

```text
Web Browser
  └─ HTTPS JSON
      └─ FastAPI
          ├─ 输入校验 / 限流
          ├─ 游戏规则与数值裁剪
          ├─ DeepSeek 对话适配器
          └─ SQLite（状态、最近对话）
```

DeepSeek 只负责语义判断、英语反馈和候选回复。后端负责身份、状态、范围限制、持久化和最终响应，因此客户端与模型都不能任意修改数值。

## 6. API 约定

### 健康检查

`GET /api/v1/health`

```json
{
  "status": "ok",
  "version": "0.1.0"
}
```

### 获取房间状态

`GET /api/v1/room`

请求头：`X-Player-Id: demo-player`

```json
{
  "room_id": "emma-room",
  "npc": {
    "id": "emma",
    "name": "Emma",
    "animation": "sad"
  },
  "stats": {
    "relationship": 35,
    "mood": 35,
    "english_xp": 0
  },
  "messages": [
    {"speaker": "npc", "text": "I had a terrible day at work..."}
  ]
}
```

### 发送消息

`POST /api/v1/chat`

请求头：`X-Player-Id: demo-player`、`Idempotency-Key: <uuid>`

```json
{
  "message": "Why? What happened today?"
}
```

成功响应：

```json
{
  "npc_reply": "My manager rejected the idea I worked on all week. Thanks for asking.",
  "relationship_change": 2,
  "mood_change": 3,
  "english_xp_change": 2,
  "stats": {
    "relationship": 37,
    "mood": 38,
    "english_xp": 2
  },
  "animation": "happy",
  "english_feedback": {
    "is_understandable": true,
    "corrected_text": "Why? What happened today?",
    "tip": "Natural and caring question.",
    "tags": []
  }
}
```

统一错误结构：

```json
{
  "error": {
    "code": "AI_TEMPORARILY_UNAVAILABLE",
    "message": "Emma needs a moment. Please try again."
  }
}
```

## 7. AI 输出与规则边界

模型输出使用 JSON 模式，服务端再做 schema 校验。提示词包含 Emma 的固定人格、当前状态、最近若干轮对话、玩家输入和目标 JSON 示例。

Emma 的基本设定：25 岁、善良但有些内向，在小型设计工作室工作；她需要像朋友一样自然回应。英语反馈简短、鼓励性强，不打断角色扮演，不对用户进行诊断或提供高风险专业建议。

后端规则：

- 空白、超长或控制字符异常的输入直接拒绝；首版正文上限 500 字符。
- 模型建议的变化值必须通过范围裁剪和业务规则。
- 只有可理解且与对话相关的英文输入才能增加英语经验。
- 关系变化体现关心、尊重和上下文相关性，不以语法完美程度决定。
- 模型超时、空 JSON 或校验失败时重试一次，仍失败则使用安全的规则回复。
- 日志记录请求 ID、耗时和 token 用量，不记录 API Key；玩家正文默认不写应用日志。

DeepSeek 官方接口支持 OpenAI 格式与 JSON Output；实现时使用 `https://api.deepseek.com`，并在提示词中明确要求 JSON，同时设置 `response_format={"type":"json_object"}`。模型名称只放在配置中，便于升级而不改业务代码。

## 8. 持久化最小模型

- `players`: `id`, `created_at`
- `npc_states`: `player_id`, `npc_id`, `relationship`, `mood`, `english_xp`, `updated_at`
- `messages`: `id`, `player_id`, `speaker`, `text`, `created_at`
- `chat_requests`: `idempotency_key`, `player_id`, `response_json`, `created_at`

只把最近 10 条对话发送给模型。Demo 不做向量记忆；后续可把历史压缩为事实记忆，与原 NPC Agent 文档一致。

## 9. 验收标准

1. 新玩家能看到 Emma 的初始台词和三个初始数值。
2. 正常英文消息能得到有效 JSON，UI 展示回复、反馈与新数值。
3. 重复点击或重试相同 `Idempotency-Key` 不会重复加数值。
4. 无效输入、AI 超时、非 JSON 输出均不会破坏存档。
5. 重启客户端与后端后，玩家数值和最近消息仍存在。
6. 浏览器资源不包含 DeepSeek Key、VPS 密码或数据库秘密。
7. 公网只开放 HTTPS；API 文档可在生产环境关闭或限制访问。

## 10. Web 验证指标

首轮邀请 5–10 名目标用户，每人独立体验 10–15 分钟。记录事件时间和数值，不用复杂分析平台也可先人工汇总。

- 激活：至少 80% 在 3 分钟内发出第一条有效英文消息。
- 核心循环：至少 60% 完成 3 轮对话。
- 继续意愿：至少 50% 主动完成 5 轮，或访谈中明确表示愿意次日回来。
- 反馈理解：至少 70% 能说清关系、心情、英语经验中两个数值为何变化。
- 角色牵引：至少 50% 表示下一句主要是想了解或安慰 Emma，而非只想获得英语评分。
- 稳定性：有效发送成功率至少 95%，测试中不得出现存档损坏或秘密泄露。

这些是方向性门槛，不以 5–10 人样本宣称统计结论。若“完成对话”高但“角色牵引”低，应先修改情境、人格与反馈节奏，而不是扩充技术范围。测试流程见 [WEB_PLAYTEST.md](WEB_PLAYTEST.md)。

## 11. 客户端策略与后续演进

Unity 开发暂时暂停，但保留 `unity/` 源码和已有设计，不删除、不要求与 Web 同步。Web 验证达到门槛后，再根据目标平台、表现力需求和迭代成本决定恢复 Unity、继续 Web，或采用其他壳层。

验证闭环后，再按顺序加入：每日事件、第二/第三 NPC、长期记忆、语音、完整英语画像。不要在 Demo 阶段提前建设多 Agent、向量库或复杂事件池。
