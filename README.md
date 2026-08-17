# LingoLife

AI 驱动的生活模拟 / 英语学习游戏。当前仓库处于 Demo 设计阶段。

## 当前目标

先验证最小核心循环：玩家在一个房间里与 NPC Emma 用英语聊天，服务端同时生成 NPC 回复、英语反馈和数值变化，Unity 根据返回结果更新状态并播放反馈动画。

## 文档入口

- [Demo 产品与技术方案](docs/DEMO_MVP.md)
- [配置与秘密管理](docs/CONFIGURATION.md)
- [部署前手动操作清单](docs/MANUAL_SETUP.md)
- [非敏感配置模板](config/lingolife.example.yaml)
- [服务端环境变量模板](config/server.env.example)

原始设计文档保留在仓库根目录，是后续系统扩展的设计依据。

## 阶段边界

当前已包含可运行的 FastAPI 后端、可导入 Unity 2022.3 LTS 的客户端源码，以及 Ubuntu/Nginx/systemd 部署资产。详见 `backend/README.md`、`unity/README.md` 与 `deploy/README.md`。
