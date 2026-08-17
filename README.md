# LingoLife

AI 驱动的生活模拟 / 英语学习游戏。目前优先用 Web Demo 验证核心玩法，不以客户端技术栈作为验证前提。

## 当前目标

玩家在一个房间里与 NPC Emma 用英语聊天；服务端生成角色回复、简短英语反馈和三项数值变化，浏览器立即呈现结果。目标是验证“因为关心 NPC 而愿意持续用英语交流”是否成立。

## 文档入口

- [Demo 产品与技术方案](docs/DEMO_MVP.md)
- [配置与秘密管理](docs/CONFIGURATION.md)
- [部署前手动操作清单](docs/MANUAL_SETUP.md)
- [5–10 人 Web 测试方法](docs/WEB_PLAYTEST.md)
- [非敏感配置模板](config/lingolife.example.yaml)
- [服务端环境变量模板](config/server.env.example)

原始设计文档保留在仓库根目录，是后续系统扩展的设计依据。

## 阶段边界

本地运行入口为 `backend/README.md` 和预期的 `web/README.md`；生产环境按 `deploy/README.md` 使用 Docker Compose。Web 只调用 LingoLife API，DeepSeek Key 不得进入浏览器代码。

Unity 客户端开发暂停，现有 `unity/` 源码保留，验证结果支持继续投入后再恢复。当前不要求安装 Unity、制作客户端包或维护双端功能一致性。
