# LingoLife Docker Compose deployment

Ubuntu 24.04 x86_64 / 1 GB RAM。宿主机 Nginx 负责 HTTPS，并转发到
`127.0.0.1:8010` 上的单个 FastAPI 容器。现有占用公网 8000 端口的容器不受影响。

容器使用 UID/GID `10001`，丢弃全部 Linux capabilities，根文件系统只读，并限制为
384 MB 内存、0.75 CPU、128 个进程。SQLite 持久化在 `/opt/lingolife/data`。

## 密钥

在 VPS 交互式创建 `/etc/lingolife/lingolife.env`，不要把 Key 放入命令行、Git、镜像或
Compose YAML：

```dotenv
DEEPSEEK_API_KEY=...
LOG_LEVEL=INFO
```

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
install -o root -g root -m 0644 /opt/lingolife/app/deploy/nginx/lingolife.api.shimooth.me.conf /etc/nginx/sites-available/lingolife.api.shimooth.me.conf
ln -sfn /etc/nginx/sites-available/lingolife.api.shimooth.me.conf /etc/nginx/sites-enabled/lingolife.api.shimooth.me.conf
nginx -t
systemctl reload nginx
```

不要安装旧的 `deploy/systemd/lingolife-api.service`。若曾另外安装过，先执行
`systemctl disable --now lingolife-api.service`。随后以 `lingolife-deploy` 部署：

```bash
cd /opt/lingolife/app
deploy/scripts/deploy-release.sh
curl --resolve lingolife.api.shimooth.me:80:127.0.0.1 http://lingolife.api.shimooth.me/api/v1/health
```

HTTP 成功后申请证书并验证：

```bash
certbot --nginx -d lingolife.api.shimooth.me
certbot renew --dry-run
curl https://lingolife.api.shimooth.me/api/v1/health
```

Docker 组实际上拥有 root 级权限。本方案用它让部署账户无需保存 sudo 密码即可更新服务；
不要用此账户运行不可信代码，并严格限制 SSH 私钥访问。

## 更新与回滚

更新前创建 SQLite 在线一致性备份，并记录当前 commit：

```bash
cd /opt/lingolife/app
deploy/scripts/backup-database.sh
git rev-parse HEAD
deploy/scripts/deploy-release.sh
```

部署脚本只构建并启动本项目 `api` 服务，等待健康检查；不会执行 `compose down`，也不会
操作其他 Compose 项目或 8000 端口。回滚时，将记录的旧 commit 发布到
`/opt/lingolife/app` 后重新执行部署脚本。除非明确存在不兼容的数据库迁移，不要恢复旧库；
如需恢复，必须先停止 API 并另存当前数据库。

## 诊断

```bash
docker compose -f /opt/lingolife/app/deploy/compose.yaml ps
docker compose -f /opt/lingolife/app/deploy/compose.yaml logs --tail=100 api
curl http://127.0.0.1:8010/api/v1/health
nginx -t
```
