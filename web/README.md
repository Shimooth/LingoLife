# LingoLife Web Demo

> 本页后半部分保留早期单房间 Emma Demo 的兼容摘要，不代表当前 3D 天空之城产品范围。当前客户端已经包含首次介绍、2～8 人核心预设建组、单一共享住宅视图以及管理端城市/住宅首版编辑器；完整目标与尚未完成的生产验收见 [`../docs/3D_ARCHITECTURE.md`](../docs/3D_ARCHITECTURE.md) 与 [`../docs/LIFE_SIMULATION_IMPLEMENTATION_PLAN.md`](../docs/LIFE_SIMULATION_IMPLEMENTATION_PLAN.md)。

React + TypeScript + Vite + Motion 实现的核心玩法客户端。浏览器只调用同源的 `/api/v1`，不包含任何 AI 密钥。

运行 `npm install && npm run dev`，开发服务器会把 `/api` 代理到 `127.0.0.1:8000`。

## 本地重复测试首次引导

开发模式可通过 `http://localhost:5173/?admin=1` 打开管理端；生产构建不接受该查询参数。后端需将 `ADMIN_ALLOWED_ORIGIN` 设为 `http://localhost:5173`，并使用 `ADMIN_COOKIE_SECURE=false`。

名称为 `onboarding-test` 或 `onboarding-test-*` 的专用账号会在用户列表中显示“重置存档 / 新手流程”。管理员必须手动输入完整用户名确认。该操作清除角色、对话、关系、事件、学习和世界存档，但保留账号、密码、已经使用的邀请码、现有登录会话、AI 额度与审计记录；刷新玩家页面后即可再次体验首次引导，无需重新注册。普通用户账号不能调用该重置接口。

已包含：

- 匿名玩家 ID（保存在 `localStorage`）
- 房间状态与最近聊天恢复
- 聊天发送、等待状态、失败重试
- 请求幂等键；网络失败重试复用同一个键
- 关系、心情、English XP 变化反馈
- Emma 的原创分层 SVG 动画；独立组件可在有 `.riv` 素材后替换为 Rive
- 英语表达建议与基础无障碍支持

键盘操作：输入框中按 Enter 发送，Shift+Enter 换行。
