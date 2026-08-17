# 部署前手动操作清单

以下步骤涉及账户、DNS、密钥指纹或账单，必须由你本人完成或确认。不要把密码、私钥、API Key 发到聊天里。

## A. 准备 DeepSeek

1. 登录 DeepSeek 开放平台，创建一个仅用于 LingoLife Demo 的 API Key。
2. 确认账户有可用额度，并设置你能接受的消费告警/限额（若控制台提供）。
3. 在本机项目根目录创建 `.env`，仅填：

   ```dotenv
   DEEPSEEK_API_KEY=你的真实Key
   ```

4. 不要运行 `git add -f .env`，也不要把 Key 填入 Unity。

完成后只告诉我：“DeepSeek 已配置”，不要发送 Key。

## B. 准备 VPS SSH 公钥访问

以下命令在你自己的 Mac 终端执行。尖括号内容替换为真实值，但不要把私钥内容发给我。

1. 创建项目专用密钥（如果已有合适的专用密钥，可跳过）：

   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/lingolife_deploy -C "lingolife-deploy"
   ```

   建议设置 passphrase，并让 macOS Keychain/ssh-agent 保存它。

2. 通过 VPS 控制台或你现有的管理员连接，创建部署用户并加入公钥。不同云厂商操作不同；最终需让该用户的 `~/.ssh/authorized_keys` 包含 `~/.ssh/lingolife_deploy.pub` 的内容，目录权限为 `700`，文件权限为 `600`。

3. 在 `~/.ssh/config` 添加：

   ```sshconfig
   Host lingolife-vps
     HostName <VPS_IP或主机名>
     User lingolife-deploy
     IdentityFile ~/.ssh/lingolife_deploy
     IdentitiesOnly yes
   ```

4. 从 VPS 厂商控制台核对 SSH host key 指纹，然后测试：

   ```bash
   ssh lingolife-vps 'id && uname -a'
   ```

5. 暂时不要关闭现有管理员会话。确认新用户能登录后，再考虑关闭 SSH 密码登录和 root 登录，以免锁死服务器。

完成后只告诉我：“`ssh lingolife-vps` 已可连接”，并提供 VPS 操作系统名称/版本、CPU 架构、内存大小；这些不是秘密。

## C. 准备域名和 DNS

1. 选择 API 子域名，例如 `api.example.com`。
2. 在 DNS 控制台创建 `A` 记录指向 VPS 的公网 IPv4；有 IPv6 时再创建 `AAAA`。
3. 若使用 Cloudflare，首次签发证书或排障时可先设为 DNS only；确认 HTTPS 后再决定是否代理。
4. 在 VPS 安全组/防火墙开放 TCP `22`（最好限制为你的来源 IP）、`80`、`443`，不要开放 Uvicorn 端口。
5. 等待解析后执行：

   ```bash
   dig +short api.example.com
   ```

完成后告诉我 API 域名即可；域名不是秘密。

## D. 初始化 Git 托管

当前目录还不是 Git 仓库。请先在 GitHub/GitLab/Gitee 等创建一个空的私有仓库，不要初始化 README 或提交任何秘密。

如果你希望我后续完成本地 `git init`、首次提交和添加 remote，请只提供仓库 SSH URL，例如：

```text
git@github.com:<owner>/LingoLife.git
```

确认本机已有对应平台的 SSH 登录能力：

```bash
ssh -T git@github.com
```

平台访问令牌和私钥都不需要发给我。

## E. 回复模板

完成后可直接回复：

```text
DeepSeek：已配置
VPS SSH：ssh lingolife-vps 可连接
VPS：Ubuntu <版本> / <架构> / <内存>
API 域名：api.<你的域名>
Git SSH URL：git@<平台>:<owner>/<repo>.git
Unity 版本：<版本，未安装也可写未安装>
```

收到这些信息后，我会先做只读连通性检查，再给出实施计划，并按你的要求使用子代理分别推进后端、Unity Demo 和部署/验收。任何需要公网写入、安装软件或修改系统服务的动作都会在范围明确后执行。
