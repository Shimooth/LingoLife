# LingoLife Docker Compose deployment

Ubuntu 24.04 x86_64 / 1 GB RAM。宿主机 Nginx 负责 HTTPS，并转发到
`127.0.0.1:8010` 上的单个 FastAPI 容器。玩家域名与管理域名都指向该容器，应用依据
可信的 `Host` 区分页面；两个站点的 API 均保持同源。现有占用公网 8000 端口的容器不受影响。

容器使用 UID/GID `10001`，丢弃全部 Linux capabilities，根文件系统只读，并限制为
384 MB 内存、0.75 CPU、128 个进程。SQLite 持久化在 `/opt/lingolife/data`。

## 密钥

在 VPS 交互式创建 `/etc/lingolife/lingolife.env`，不要把 Key 放入命令行、Git、镜像或
Compose YAML：

```dotenv
DEEPSEEK_API_KEY=...
ADMIN_PASSWORD=...
SESSION_SECRET_KEY=...
ADMIN_ALLOWED_ORIGIN=https://lingolife.admin.shimooth.me
ADMIN_COOKIE_SECURE=true
DEFAULT_DAILY_QUOTA=30
CHAT_PER_MINUTE=5
LOG_LEVEL=INFO
```

`ADMIN_PASSWORD` 使用专用于本管理端的长随机密码。`SESSION_SECRET_KEY` 必须与它不同，可在
本地执行 `openssl rand -hex 32` 生成后粘贴进文件。不要把命令输出发到聊天、写进 shell
历史中的命令参数或提交到 Git。修改任一值后需重新创建容器；修改会使现有管理会话失效。

Compose 会覆盖容器内的数据库和配置路径。以 root 设置权限：

```bash
chown root:lingolife-deploy /etc/lingolife/lingolife.env
chmod 0640 /etc/lingolife/lingolife.env
```

## 首次部署

旧版 `install-host.sh` 已经执行过一次，无需回滚。将当前发布包再次传到原位置后，以
root 重跑新版脚本。它可重复执行，并会把数据目录改为容器 UID 10001：

```bash
bash /home/lingolife-deploy/lingolife-release/deploy/scripts/install-host.sh
```

重新连接 `ssh lingolife-vps`，让 Docker 组权限生效。把审阅后的发布包复制到
`/opt/lingolife/app`；不要把个人 GitHub 私钥放到 VPS。以 root 只安装 Nginx 配置：

```bash
install -o root -g root -m 0644 /opt/lingolife/app/deploy/nginx/lingolife.shimooth.me.conf /etc/nginx/sites-available/lingolife.shimooth.me.conf
install -o root -g root -m 0644 /opt/lingolife/app/deploy/nginx/lingolife.admin.shimooth.me.conf /etc/nginx/sites-available/lingolife.admin.shimooth.me.conf
ln -sfn /etc/nginx/sites-available/lingolife.shimooth.me.conf /etc/nginx/sites-enabled/lingolife.shimooth.me.conf
ln -sfn /etc/nginx/sites-available/lingolife.admin.shimooth.me.conf /etc/nginx/sites-enabled/lingolife.admin.shimooth.me.conf
nginx -t
systemctl reload nginx
```

不要安装旧的 `deploy/systemd/lingolife-api.service`。若曾另外安装过，先执行
`systemctl disable --now lingolife-api.service`。随后以 `lingolife-deploy` 部署：

```bash
cd /opt/lingolife/app
deploy/scripts/deploy-release.sh
curl --resolve lingolife.shimooth.me:80:127.0.0.1 http://lingolife.shimooth.me/api/v1/health
```

HTTP 成功后申请证书并验证：

```bash
certbot --nginx -d lingolife.shimooth.me -d lingolife.admin.shimooth.me
certbot renew --dry-run
curl https://lingolife.shimooth.me/api/v1/health
curl https://lingolife.admin.shimooth.me/api/v1/health
```

DNS 名称不能保护管理端。上线前必须确认未认证请求无法读取用户或用量数据，管理 Cookie 使用
`Secure`、`HttpOnly`、`SameSite=Strict`，并且代理传递原始 `Host`。管理端不应通过 CORS
开放给玩家域名；二者各自使用同源 API。建议限制管理密码尝试频率，运营完毕后及时退出。

Docker 组实际上拥有 root 级权限。本方案用它让部署账户无需保存 sudo 密码即可更新服务；
不要用此账户运行不可信代码，并严格限制 SSH 私钥访问。

## 更新与回滚

更新前创建 SQLite 在线一致性备份，并记录当前 commit 与镜像 ID：

```bash
cd /opt/lingolife/app
deploy/scripts/backup-database.sh
git rev-parse HEAD
docker compose -f deploy/compose.yaml images -q api
deploy/scripts/deploy-release.sh
```

部署脚本只构建并启动本项目 `api` 服务，等待健康检查；不会执行 `compose down`，也不会
操作其他 Compose 项目或 8000 端口。回滚时，将记录的旧 commit 发布到
`/opt/lingolife/app` 后重新执行部署脚本。除非明确存在不兼容的数据库迁移，不要恢复旧库；
如需恢复，必须先停止 API 并另存当前数据库。

### 数据库恢复与迁移

备份脚本调用 SQLite Online Backup API，服务运行中也能得到一致快照。备份默认位于
`/opt/lingolife/backups/lingolife-<UTC时间>.db`。恢复属于会覆盖当前状态的操作，应在维护窗口执行：

```bash
cd /opt/lingolife/app
docker compose -f deploy/compose.yaml stop api
cp /opt/lingolife/data/lingolife.db /opt/lingolife/backups/pre-restore-$(date -u +%Y%m%dT%H%M%SZ).db
# 核对目标备份后，以 root 或 UID 10001 将它复制为 /opt/lingolife/data/lingolife.db
docker compose -f deploy/compose.yaml up -d api
curl --fail http://127.0.0.1:8010/api/v1/health
```

不要直接复制仍在写入的数据库作为备份。迁移到新 VPS 时，先部署相同 commit、停止两端 API，
传输经校验的备份和 env（env 应通过安全通道单独创建），再启动新端并验证两个域名；DNS 切换前
保留旧 VPS 和旧数据库。数据库 schema 升级必须先备份，并为降级准备兼容说明或恢复旧库。

### 应用回滚

将旧 commit 的完整发布包恢复到 `/opt/lingolife/app` 后运行 `deploy-release.sh`。脚本使用
Compose 重建单个 `api` 服务并等待健康检查，不执行 `compose down`。若新版本只修改应用且数据库
向后兼容，不恢复数据库；若 schema 不兼容，同时恢复与旧版本匹配的备份。回滚后检查玩家登录、
管理登录、一次只读管理查询和容器日志。

## 诊断

```bash
docker compose -f /opt/lingolife/app/deploy/compose.yaml ps
docker compose -f /opt/lingolife/app/deploy/compose.yaml logs --tail=100 api
curl http://127.0.0.1:8010/api/v1/health
nginx -t
```
