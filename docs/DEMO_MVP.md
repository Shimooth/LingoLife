# LingoLife 单房间 Demo 产品与技术方案

版本：0.1
状态：待实现

## 1. Demo 要验证什么

现有设计的共同核心不是“AI 批改英语”，而是：玩家因为关心一个持续变化的 NPC，主动用英语交流，并从世界变化中感受到成长。

本 Demo 只验证一条闭环：

```text
Emma 表达烦恼
→ 玩家用英语回应
→ 服务端理解并评价表达
→ Emma 以角色身份回答
→ 关系、心情、英语经验变化
→ Unity 更新 UI 与动画
```

成功标准：首次启动后，玩家能在 3 分钟内完成至少 3 轮对话，理解数值为何发生变化，并愿意继续询问 Emma 的近况。

## 2. 功能范围

### 包含

- 一个固定房间场景
- 一个 NPC：Emma
- 一个玩家（本地匿名身份）
- 一个状态栏
- 一个聊天记录区、输入框、Send 按钮
- 三个养成值：关系、心情、英语经验
- Emma 的 idle / sad / happy 三种视觉状态（首版可用占位动画）
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
Unity Client
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
6. Unity 不包含 DeepSeek Key、VPS 密码或数据库秘密。
7. 公网只开放 HTTPS；API 文档可在生产环境关闭或限制访问。

## 10. 后续演进

验证闭环后，再按顺序加入：每日事件、第二/第三 NPC、长期记忆、语音、完整英语画像。不要在 Demo 阶段提前建设多 Agent、向量库或复杂事件池。
