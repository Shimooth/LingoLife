# LingoLife 会话交接记录

最后更新：2026-09-03（Asia/Shanghai）

本文件用于在新 Codex 窗口中快速恢复项目上下文。这里只记录可提交的非敏感信息；密码、私钥、API Key、令牌和服务端环境变量值不得写入本文件或聊天。

## 当前阶段

- 当前分支：`main`
- 当前本地与生产提交均必须在开始工作时用 Git/部署只读检查确认，不能由本文件中的历史提交推断。
- 当前产品方向是 3D Web-first；玩家登录后直接进入 3D 天空之城观察主流程，不设独立 `/3d` 路由。Unity 客户端开发暂停，源码保留在 `unity/`。
- 仓库已有 FastAPI 后端、React Web 玩家端/管理端、SQLite 数据层、DeepSeek 适配、Docker Compose、Nginx 配置、备份与发布脚本。
- 2026-08-28 实施检查点报告已实现 Life Simulation v2 的 Desire → Commitment → Life Action → Moment / Incident / Story Thread、共享资源、多频道关系和生活表现基础；开始新工作前仍需通过代码与测试复核，不能只依赖文档勾选。
- 2026-09-03 已确认新的产品拓扑：首次介绍后建立 2～8 名完整、随机、可编辑且能产生差异轨迹的居民；所有 active NPC 住在一个共享 Household/Residence；只先完成一套正式品质住宅室内；城市和住宅布局由管理端使用批准的现有资产编辑。
- Phase 6～7 的首个可运行切片已经进入当前工作树：首次介绍与 2～8 人核心预设建组、账号内标准化姓名唯一、整组原子创建、单共享住宅运行时协调、唯一 shared-home，以及管理端城市/四房住宅 placement 编辑与单 published layout API 已落地。完整 Agent 默认字段、服务端门禁、迁移报告、布局草稿/不可变历史/回滚、独立作者权限、高级空间校验和正式室内品质仍待完成。作者工具属于开发/运营能力，普通玩家仍是观察者/有限管理者，服务端继续独占 NPC 状态、关系、记忆与事件结算。
- 固定用户名 `onboarding-test` 用于跨设备反复验证首次引导。管理端只对该名称及 `onboarding-test-*` 开放存档重置，重置保留账号、密码、邀请码资格、额度和审计；密码、数据库和邀请/会话凭据不得写入 Git，完整操作规范见 `docs/P0_BETA_OPERATIONS.md`。
- 玩家端为 `https://lingolife.shimooth.me`，管理端为 `https://lingolife.admin.shimooth.me`。每次发布前后仍需重新验证线上即时状态。
- 主要文档入口：`README.md`、根目录 GDD/NPC Agent/涌现剧情设计、`docs/LIFE_SIMULATION_IMPLEMENTATION_PLAN.md`、`docs/3D_ARCHITECTURE.md`、`docs/MAP_AUTHORING.md`、`docs/CONFIGURATION.md`、`docs/P0_BETA_OPERATIONS.md`、`deploy/README.md`。`docs/NPC_AGENT_IMPLEMENTATION.md` 只保留为 2026-08-26 历史基线。

## 本次会话已验证

本地聚焦回归（2026-09-03，当前未提交工作树）：

```text
backend onboarding/layout + household topology: 22 passed
web onboarding guard: passed（12 个不同预设，2～8 人）
web life-simulation guard: passed
```

本地全量回归（2026-09-03，首次引导重置能力）：

```text
backend: 248 passed
web: ESLint、TypeScript、全部运行时守卫和 Vite production build passed
```

本地回归（2026-08-26）：

```text
backend: 90 passed
web: TypeScript、ESLint、运行时资产、角色动画、城市布局、道路、装饰、导航、镜头检查 passed
web: Vite production build passed
```

本地回归（2026-08-24）：

```text
backend: 84 passed
web: ESLint、运行时资产、城市布局与人行导航检查 passed
web: TypeScript passed
web: Vite production build passed
```

DeepSeek 默认模型已经由退役名称迁移到 `deepseek-v4-flash`，实时对话、分析和翻译显式使用非思考模式。

VPS SSH 公钥登录已经成功：

```text
SSH alias: lingolife-vps
部署用户: lingolife-deploy
远端主机名: racknerd-55cbd98
操作系统/内核: Ubuntu / Linux 6.8.0-134-generic
CPU 架构: x86_64
远端 uid/gid: 1000/1000
附加组: users
```

成功执行过的只读验证命令：

```bash
ssh -o PreferredAuthentications=publickey lingolife-vps 'id && uname -a'
```

本机 SSH 最终配置会使用项目专用密钥和 `IdentitiesOnly yes`。私钥仅保存在本机 `~/.ssh/`，不得复制进仓库、VPS 应用目录或聊天。

## VPS 操作须知

1. 后续自动化统一通过 `ssh lingolife-vps` 和非 root 用户 `lingolife-deploy` 操作，不索取或记录服务器密码。
2. 新窗口开始时先执行只读检查；不要因为能 SSH 登录就假定线上代码、容器、数据库、Nginx、证书或 DNS 均正常。
3. 修改服务器前先说明目标和影响范围。安装软件、修改系统服务/Nginx、防火墙、`sudoers`、生产环境变量或公网状态，必须得到用户明确授权。
4. 不授予部署用户任意 root shell；若确需提权，应只授予完成部署所需的精确命令。
5. 在确认部署用户、公钥及必要的提权能力均可用之前，不关闭现有管理员会话、密码登录或 root 登录，以免锁死服务器。
6. 生产秘密只应位于 `/etc/lingolife/lingolife.env`，建议所有者/权限为 `root:lingolife-deploy`、`0640`。读取时只检查变量是否存在，不输出变量值。
7. 预期部署路径为 `/opt/lingolife/app`，数据路径为 `/opt/lingolife/data`，备份路径为 `/opt/lingolife/backups`。操作前必须以远端实际状态为准。
8. 修改生产数据库、环境变量或部署版本前先备份；发布后检查健康接口、容器/服务状态和近期错误日志，并准备可执行的回滚方案。
9. 禁止把 DeepSeek Key、管理密码、会话签名密钥、SSH 私钥或数据库内容写入 Git、命令输出或聊天。
10. 任何 SSH host key 变化都应暂停操作，并通过 VPS 厂商控制台重新核对指纹，不能直接忽略警告。

## 新窗口建议的开场方式

可直接告诉 Codex：

```text
请先阅读 docs/SESSION_HANDOFF.md、README.md 和 deploy/README.md，检查 Git 工作区，并对 VPS 只做只读现状检查。在汇报本地与远端实际状态后，再继续我指定的任务。不要输出任何秘密，也不要未经授权修改远端系统。
```

建议的首轮只读检查包括：

```bash
git status --short --branch
git log -1 --oneline --decorate
ssh -o BatchMode=yes lingolife-vps 'id; uname -a; uptime; free -h; df -h'
```

容器、服务和站点检查应先阅读 `deploy/README.md`，再根据远端实际安装方式选择命令；不要预设 Docker 或 systemd 一定已经配置完成。

## 每次发布前仍需确认

- VPS 内存大小和磁盘余量。
- 远端当前部署的 Git 提交。
- Docker Compose、API、Nginx、TLS 证书和备份任务的实时状态。
- 生产环境变量是否完整（检查时不得显示值）。
- 玩家端和管理端域名当前是否可访问。
- 当前提交的后端测试、Web lint/build 是否全部通过。

新窗口应把这些项目视为待检查项，而不是已完成事项。
