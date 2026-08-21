# LingoLife

AI 驱动的 3D 小岛生活模拟 / 英语学习游戏。Web 是唯一玩家主流程，Unity 客户端暂停。

## 当前目标

玩家每天从 3D 小岛观察视角查看居民、地点、日程和事件，再以管理者身份聚焦居民、用英语对话或介入重要生活事件。居民拥有可自定义的统一 3D 外观、人格、状态、目标、记忆、日程和方向性社交关系；DeepSeek 负责符合角色的英文表达，服务端规则负责世界事实、数值和学习结算。

内测 P0 使用邀请码和唯一用户名进入。玩家端位于
`https://lingolife.shimooth.me`，受密码保护的管理端位于
`https://lingolife.admin.shimooth.me`；两个域名由同一个容器提供，同源调用各自的 API。

## 文档入口

- [当前进展与跨会话交接](docs/SESSION_HANDOFF.md)
- [3D 主流程架构与性能预算](docs/3D_ARCHITECTURE.md)
- [Demo 产品与技术方案](docs/DEMO_MVP.md)
- [配置与秘密管理](docs/CONFIGURATION.md)
- [部署前手动操作清单](docs/MANUAL_SETUP.md)
- [5–10 人 Web 测试方法](docs/WEB_PLAYTEST.md)
- [P0 内测运营手册](docs/P0_BETA_OPERATIONS.md)
- [非敏感配置模板](config/lingolife.example.yaml)
- [服务端环境变量模板](config/server.env.example)

原始设计文档保留在仓库根目录，是后续系统扩展的设计依据。

## 当前阶段边界

本地运行入口为 `backend/README.md` 和预期的 `web/README.md`；生产环境按 `deploy/README.md` 使用 Docker Compose。Web 只调用 LingoLife API，DeepSeek Key 不得进入浏览器代码。

Unity 客户端开发暂停，现有 `unity/` 源码保留，当前不维护双端一致性。本阶段不实现宠物、自由行走控制、多人同步或用户上传任意 3D 模型。
