# LingoLife

AI 驱动的 3D 天空之城生活模拟 / 英语学习游戏。Web 是唯一玩家主流程，Unity 客户端暂停。

## 当前目标

目标玩法是让居民根据需求、欲望、习惯、关系和 Household 环境持续生活，行为碰撞后才形成 Moment、Incident 和跨日 Story Thread；玩家从 3D 天空之城观察，并在少数重要时刻用英语询问或施加有限影响。DeepSeek 负责符合角色的英文表达，服务端规则负责世界事实、数值、稳定随机性和学习结算。

截至 2026-09-04，下一版 GDD 垂直切片的规则与数据闭环已经进入当前工作树：持久首次引导与 2～8 人完整建组、单一共享住宅及 8 间私人卧室、13 种 Life Action、共享资源碰撞、四阶段 NPC–NPC 双语现场、关系/披露/跨日余波、规则证据驱动的缓慢成长，以及带草稿、拓扑校验、不可变版本和回滚的城市/住宅作者工具。已发布城市布局会实际改变地点可用性、道路旅行与未来行为机会。完整长期 GDD 仍有明确后续范围，例如听说读写独立能力、精确角色—物件 IK、独立布局作者权限和复杂群体关系；逐项状态与证据以验收矩阵和实施方案为准。

内测 P0 使用邀请码和唯一用户名进入。玩家端位于
`https://lingolife.shimooth.me`，受密码保护的管理端位于
`https://lingolife.admin.shimooth.me`；两个域名由同一个容器提供，同源调用各自的 API。

## 文档入口

- [当前进展与跨会话交接](docs/SESSION_HANDOFF.md)
- [游戏设计文档 v0.4](LingoLife%20GDD.md)
- [NPC Agent 目标设计 v0.4](NPC%20Agent%20系统设计文档.md)
- [生活模拟与涌现剧情设计 v0.4](随机事件生成系统设计文档.md)
- [生活模拟技术实施与跨环境交接方案](docs/LIFE_SIMULATION_IMPLEMENTATION_PLAN.md)
- [GDD 逐项验收矩阵](docs/GDD_ACCEPTANCE_MATRIX.md)
- [当前 NPC Agent 运行时基线](docs/NPC_AGENT_IMPLEMENTATION.md)
- [3D 主流程架构与性能预算](docs/3D_ARCHITECTURE.md)
- [管理端城市与共享住宅作者工具](docs/MAP_AUTHORING.md)
- [Demo 产品与技术方案](docs/DEMO_MVP.md)
- [配置与秘密管理](docs/CONFIGURATION.md)
- [部署前手动操作清单](docs/MANUAL_SETUP.md)
- [5–10 人 Web 测试方法](docs/WEB_PLAYTEST.md)
- [P0 内测运营手册](docs/P0_BETA_OPERATIONS.md)
- [非敏感配置模板](config/lingolife.example.yaml)
- [服务端环境变量模板](config/server.env.example)

仓库根目录的 GDD、NPC Agent 与涌现剧情文档定义目标玩法；`docs/LIFE_SIMULATION_IMPLEMENTATION_PLAN.md` 维护阶段、当前检查点和迁移进度。`docs/NPC_AGENT_IMPLEMENTATION.md` 仅是 2026-08-26 的历史运行时基线，不应覆盖更新后的检查点。

## 当前阶段边界

本地运行入口为 `backend/README.md` 和预期的 `web/README.md`；生产环境按 `deploy/README.md` 使用 Docker Compose。Web 只调用 LingoLife API，DeepSeek Key 不得进入浏览器代码。

Unity 客户端开发暂停，现有 `unity/` 源码保留，当前不维护双端一致性。本阶段不实现多 Household/多活跃住宅、第二套完整室内、普通玩家自由布局、宠物、自由行走控制、多人同步或用户上传任意 3D 模型。管理端布局作者权限不能修改 NPC 动态世界事实。
