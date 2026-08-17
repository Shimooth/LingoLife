# LingoLife Web Demo

React + TypeScript + Vite + Motion 实现的核心玩法客户端。浏览器只调用同源的 `/api/v1`，不包含任何 AI 密钥。

运行 `npm install && npm run dev`，开发服务器会把 `/api` 代理到 `127.0.0.1:8000`。

已包含：

- 匿名玩家 ID（保存在 `localStorage`）
- 房间状态与最近聊天恢复
- 聊天发送、等待状态、失败重试
- 请求幂等键；网络失败重试复用同一个键
- 关系、心情、English XP 变化反馈
- Emma 的原创分层 SVG 动画；独立组件可在有 `.riv` 素材后替换为 Rive
- 英语表达建议与基础无障碍支持

键盘操作：输入框中按 Enter 发送，Shift+Enter 换行。
