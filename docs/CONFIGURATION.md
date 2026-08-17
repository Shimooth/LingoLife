# 配置与秘密管理

## 1. 原则

仓库只保存配置结构和非敏感默认值。真实密码、API Key、SSH 私钥、令牌不得写入 YAML、文档、Unity 工程、聊天消息或 Git 历史。

配置分三层：

1. `config/lingolife.example.yaml`：可提交的结构模板。
2. `config/lingolife.local.yaml`：本机非秘密覆盖，可包含主机名与用户名，但默认被 Git 忽略。
3. 服务端 `/etc/lingolife/lingolife.env`：真实秘密，仅 VPS root、部署组与容器可用，所有者
   `root:lingolife-deploy`、权限 `0640`。

本地开发使用 `.env`，也被 Git 忽略。`config/server.env.example` 只列变量名。

## 2. 无密码让 AI/自动化连接 VPS

“不透露密码”应通过 SSH 公钥认证实现，不是保存或混淆密码：

- 私钥只保存在你的电脑（建议放系统 Keychain/ssh-agent 中）。
- VPS 只保存公钥。
- 给部署使用独立用户 `lingolife-deploy`，不直接使用 root。
- 关闭该用户的密码登录；只允许公钥。
- 如需重启服务，只授予精确的 `systemctl` sudo 权限，不授予任意 root shell。
- 本项目通过 SSH host alias（例如 `lingolife-vps`）连接，配置文件中无需 IP、密码或私钥内容。

这样，在你明确授权执行部署时，AI 可调用本机 `ssh lingolife-vps ...` 操作 VPS；AI 不需要知道账户密码。首次连接产生的 host key 必须由你核对 VPS 控制台提供的指纹。

## 3. 配置字段

`config/lingolife.example.yaml` 记录：

- 应用环境、API 路径和版本
- VPS 的 SSH alias、部署目录、Docker Compose 项目
- 玩家/管理域名、HTTPS 与 CORS 来源
- Git remote、默认分支、部署分支
- DeepSeek base URL、模型名、超时和 token 上限
- 数据库路径、日志与备份策略

敏感字段只通过环境变量引用，例如 `${DEEPSEEK_API_KEY}`，模板内不出现真实值。

## 4. Git 安全

在第一次提交前执行秘密扫描。若秘密曾被提交，仅删除文件不够：必须立即吊销/轮换秘密，并清理 Git 历史。Unity 客户端属于不可信环境，任何打进包内的 Key 都应视为公开。

## 5. 运行环境建议

Demo 推荐 Ubuntu LTS、Docker Compose、FastAPI/Uvicorn、SQLite，以及宿主机 Nginx。数据库和备份目录不放进 Git。公网入口由 Nginx 提供 HTTPS，API 容器端口只绑定 `127.0.0.1`；具体命令以 `deploy/README.md` 为准。

首版部署建议保留简单可审计的结构：

```text
/opt/lingolife/app       应用代码
/opt/lingolife/data      SQLite 数据
/etc/lingolife           环境变量（秘密）
Docker Compose           API 构建、健康检查与日志
宿主机 Nginx             HTTPS 与反向代理
```

## 6. DeepSeek 配置

`DEEPSEEK_API_KEY` 仅存在于本机 `.env` 或 VPS 的 env 文件。后端调用 DeepSeek，Web 与暂停中的 Unity 客户端都只能调用 LingoLife API。

`ADMIN_PASSWORD` 保护管理界面，`SESSION_SECRET_KEY` 只用于签名登录会话。两者必须使用不同的
高熵随机值，只存于同一秘密 env 文件；域名本身不是访问控制。玩家端与管理端使用不同 Host，
但由同一容器服务并各自同源调用 API。

官方资料：

- [JSON Output](https://api-docs.deepseek.com/guides/json_mode/)
- [Chat Completion API](https://api-docs.deepseek.com/api/create-chat-completion)

JSON 模式保证语法层面的有效 JSON；业务端仍必须做类型、长度、枚举和数值范围校验。
