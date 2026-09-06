# LingoLife 双设备与 Codex 交接手册

最后更新：2026-09-07（Asia/Shanghai）

这是公司 Mac、家用 Windows 和所有 Codex 会话的唯一交接入口。每次换设备前更新“当前交接状态”，提交并推送本文件；另一台设备只相信远端 Git、当前工作树和实时检查，不根据旧聊天猜测状态。

本文只能记录可提交的非敏感信息。密码、私钥、API Key、Cookie、Token、数据库内容和 `.env` 的值不得写入本文、Git、Codex 提示词或终端命令参数。

## 1. 当前交接状态

| 项目 | 当前记录 |
|---|---|
| 上一工作设备 | 公司 Mac |
| Git 仓库 | `git@github.com:Shimooth/LingoLife.git` |
| 主分支 | `main` |
| 已推送应用提交 | `b37d83bf6347040d6c3b760c2a66bbd0fcae93b3`；发布验收记录由后续仅文档提交补充，拉取时以 origin/main 为准 |
| 已部署提交 | `b37d83bf6347040d6c3b760c2a66bbd0fcae93b3`，2026-09-07（Asia/Shanghai）已验证 |
| 2026-09-06 本地后续改动 | 会话按游戏日与行动实例隔离，旧消息保留历史；新玩家旅程文档；账号级进城实操引导（跟随→真实故事→旁观/介入→结果确认），集中双语结果卡及移动端统一滚动；新增 `docs/CITY_PRACTICE_GUIDE.md`；本轮尚未提交部署 |
| 后续改动验证 | Backend `446 passed`，含 6 项实操引导测试；Web lint（含会话开场和结果语义检查）/typecheck/build 通过；本轮未调用真实 DeepSeek |
| 本轮浏览器验收 | 隔离 QA 账号、生产构建，1440×1000 桌面与 390×844 手机：真实点击跟随→双人现场→安慰→结果卡→手机刷新续接→确认→刷新不重播；设置切换英文、重新开始与暂停后刷新也通过；最终完整流程无 JavaScript 异常或横向溢出 |
| 上一已部署版本验证 | Backend `434 passed`；Web lint/typecheck/build；桌面与移动 WebGL smoke |
| 2026-09-06 居民安排界面 | 修复长表单撑高预览导致人物巨幅裁切；动画 Mixer 与模型骨架实例绑定，换装不再沿用旧骨架。保留单 Canvas，加入站立/走动/开心预览与减少动态效果支持；资料/外观分栏切换，入住名单展示实时造型缩略图，17 个实际模型 WebP 选项共 82,500 bytes，角色工作室同步复用。仅本地修改，未提交或部署 |
| 居民预览验收 | `npm --prefix web run check:resident-browser` 使用隔离 Chrome（CDP 19226）与无 API 写入夹具，验证 17 模型切换、画布/资料不重置、5 类换装后的新骨架继续动画、390px 手机、中英文与减少动态效果；缩略图校验纳入 lint。生成方式见 `web/public/assets/portraits/characters/README.md`。本轮未重置账号 |
| 2026-09-06 共享住宅生活优化 | 现有 CC0 KayKit 素材提取 12 个动作，运行时适配城市/Chibi 骨架，补坐下/起身/台面动作、手骨道具和台面接触、家具避让路线及双人注视；真实饭菜分享倾向和餐具痕迹，普通餐具不立即升级冲突；住宅增加放大观察与镜头操作。详见 `docs/HOUSEHOLD_LIFE_PRESENTATION.md`，未提交/部署、未重置账号、未调用 DeepSeek |
| 生活优化验证 | Backend 全量 `452 passed`（含 30 天模拟与 6 项新增生活测试）；Web lint/typecheck/build；独立浏览器 17 个模型、新骨架动画、非瞬移行动切换、厨房物件状态、390px 手机与动态减少动画设置通过。无账号验收页 `/scripts/fixtures/household-life.html` 只在开发服务使用，不是生产游戏路由 |
| 2026-09-06 室内外衔接 | 后端新增 `spatial_presence`，明确区分室内/室外/路上；室内居民不绘制地图模型或标记，仍保留在居民列表和建筑详情。住宅内换房间不上街，出门后不再留在室内；点击室内居民/跟随到达时打开住宅或对应建筑详情。修复回家路径与无旧事件 ID 的生活行程到达刷新，手机居民卡拓宽。仅本地，未提交/部署/重置账号 |
| 室内外验收 | Backend 全量 `491 passed`（新增 39 项位置投影用例）；Web lint/typecheck/build 通过；隔离 Chrome 无账号浏览器测试实际城市 actors、住宅保留、室内换房、去咖啡馆/回家移动与到达切换、手机与减少动画模式通过。`npm --prefix web run check:spatial-presence-browser`，夹具 `/scripts/fixtures/spatial-presence.html`；React 错误边界的控制台错误也纳入验收，不将错误回退当成成功 |
| 当前产品事实 | GDD 当前纵切见 `docs/GDD_ACCEPTANCE_MATRIX.md`；长期缺口见 `docs/LIFE_SIMULATION_IMPLEMENTATION_PLAN.md` |
| 2026-09-06 P0＋共餐纵切 | 向导区分现场/回顾/等待结果，事件底部固定下一步，故事绑定与繁忙同步防抢跑。住宅新增「一起吃顿饭」：提议/自主发起→条件与意愿回应→收尾闲暇活动→实际准备/用餐→洗碗或保留家务，复用真实库存、行动及共享食物关系证据；一次/游戏日，工作睡眠和急需优先。详见 `docs/SHARED_MEAL_VERTICAL_SLICE.md`。未提交/部署/重置账号，未调用 DeepSeek |
| P0＋共餐验收 | Backend 全量 `502 passed`，共餐新增 11 项含 API 归属/重复/跨设备、工作保护、在线离线一致；Web lint/typecheck/build。隔离手机浏览器点通回顾→记录见证→完成，底部按钮无需滚动；验证共餐真实引擎快照各阶段、物件人数计数、中英文及厨房放大入口。`npm --prefix web run check:practice-dinner-browser`；无账号夹具 `/scripts/fixtures/practice-dinner.html`，共餐快照来自内存世界，非生产快进功能 |
| 2026-09-06 NPC 说话风格 | `interaction-scene-v2`：16 类生活话题口语化，高频意图五类完整句子语气；拒绝后接话、熟人打趣、矛盾不强行和解、已吃完的食物不重放邀请。共餐阶段共享语气，餐次内冻结，不再自己谢自己。详见 `docs/NPC_DIALOGUE_VOICE.md`。规则台词层，无新增 AI 调用、不改行动／关系结算；旧保存对话不重写。仅本地，未提交／部署／重置账号 |
| NPC 台词验收 | Backend 全量 `603 passed`，含本轮 101 项新增语气／话题／事实／回放测试；专项 `118 passed`；Python 编译与 `git diff --check` 通过。本轮未改前端布局，未新增浏览器验收；本地 reload 后 `/api/v1/health` 返回正常 |
| 2026-09-07 居民定位修复 | 地图点击室内居民向住宅传递 NPC ID；公共区域自动切到当前房间、显示脚下金圈，支持同住宅切换居民、实时换房、手动浏览后重新定位；修复 kitchen/living_room 与展示房间 ID 别名。私人活动明确说明已在家中找到但不公开具体房间／模型，不从资源占用反推隐私。离家提示返回地图。仅本地，未提交／部署／改账号数据 |
| 居民定位验收 | Web lint/typecheck/build 通过；`node web/scripts/check-household-location-browser.mjs` 验证私人说明、公共房间模型和圈、房间迁移、手动浏览、切换目标、出门、中英文和 390px 手机；`check-spatial-presence-browser.mjs` 回归实际地图点击 NPC ID 传递、室内外衔接与减少动画模式。无账号测试夹具 `/scripts/fixtures/household-location.html`，不属于生产路由；本轮未改后端 |
| 2026-09-07 最新房间表现选择 | 用户要求人物真正出现在房间里，**取代上面“不展示私人活动人物／房间”的表现规则**。公开实际 `current_room_id`，内心、私人意图、资源目标与打断权限仍受限；室内可见，城市仍隐藏室内人物。卧室使用全名单固定归属，睡眠横卧与被子轻呼吸，洗浴着装模型＋不透明遮挡；卧室定位镜头靠近所选房间。详见 `docs/HOUSEHOLD_LIFE_PRESENTATION.md` 新节。未提交／部署／重置账号 |
| 房间生活验证 | Backend 全量 `603 passed`，其中位置与隐私 API 专项 `50 passed`；Web lint/typecheck/build；浏览器通过人物卧室可见、8 床位及名单过滤／重排不换床、睡眠／洗浴、定位与换房、英文和手机，已查看实际睡眠／洗浴截图。测试在无账号夹具中执行 |
| 2026-09-07 床铺与状态修正 | 修复睡姿／床垫高度与预览坐标错位，被子改为下垂曲面并裁切被覆盖衣物；城市／Chibi 分别校准。睡觉、休息、洗澡和其他活动明确区分，准备／等待／打断／放弃不冒充完成或进行中。洗澡改为遮身体露头的雾团，保留着装与私人打断限制。Backend 全量 `604 passed`，补充阶段后专项 `21 passed`；Web lint/typecheck/build、定位浏览器回归及两类模型实际截图检查通过。详见房间表现文档；未提交／部署／重置账号 |
| 素材资料交接 | `docs/ASSET_ACQUISITION_MANIFEST.md`、`docs/ASSET_IMPORT_SHORTLIST.md` 两份历史素材清单随本轮提交保存，原始素材包仍在仓库外；其中“待导入”是整理时记录，当前实际导入情况以房间生活文档与运行时资产为准 |
| 2026-09-07 发布准备 | 用户已要求提交并部署以上本地累计改动。SSH 已确认可直接连接，远端 main 与发布前本地 HEAD 一致；发布使用干净 Git 提交打包、本地构建、SHA-256 校验、线上 SQLite 备份与现有回滚脚本，不重置账号。最终部署版本与验收在发布成功后另行记录 |
| 2026-09-07 发布完成 | 上述 9 月 6～7 日累计功能／修复已随 `b37d83b` 提交、推送并部署，取代各历史行“仅本地／未提交／未部署”的状态。包含会话隔离、实操引导、共餐、NPC 台词、生活动作、居民缩略图、室内外定位、床铺贴合、状态区分和洗浴雾团。工作树交出前保持干净；线上应用与后续文档提交仅差交接记录 |
| 本次发布验证 | Backend 全量 `604 passed`；发布脚本重新 npm ci、lint、typecheck、build 全部通过；本地无账号室内定位浏览器回归通过。线上 `.source-revision` 一致、Compose healthy、启动日志正常；玩家／管理 HTTPS 首页与健康接口通过，首页内容及新版应用脚本、动作、头像、锅具资产 SHA-256 与本地一致；隔离浏览器 390px 两域名登录入口无 JS 错误／横向溢出。未登录真实账号、未调用 DeepSeek、未重置数据；不把入口冒烟测试等同完整线上玩法验收 |
| 本次备份与回滚 | SQLite `/opt/lingolife/backups/lingolife-20260906T173609Z.db`；回滚目录 `/home/lingolife-deploy/lingolife-releases/rollback-20260906T173607Z`；发布包 `/home/lingolife-deploy/lingolife-b37d83b.tar`，SHA-256 `971cc2a5f23ad394132852428b26419dd7b3fa3b8c3cc2004ffe0c7bed7c6f32`。备份目录由容器 UID 10001 管理，部署用户直接 test -s 不可用，使用只读挂载核验。发布后空闲快照约 84 MiB / 384 MiB、CPU 1.15%，不是负载测试 |
| 备份完整性验收 | 本次 SQLite 备份已通过 `PRAGMA quick_check`（`ok`）。只读挂载下以 `mode=ro&immutable=1` 打开已经完成的备份，避免 WAL 辅助文件写入；此参数不可用于仍在写入的生产数据库 |
| 下一步 | 另一台设备执行 `git pull --ff-only` 即可取得本次实现及交接资料；可在线上按 `docs/CITY_PRACTICE_GUIDE.md` 试玩。已有账号从「设置 → 进城实操引导」进入，观察首个可参与故事的等待时间；本次没有重置任何账号 |

开始工作时必须重新运行第 5 节检查；上表中的提交、测试和生产状态只是最近一次记录，不是永久事实。

## 2. 两台设备的职责与配置基线

| 项目 | 公司 Mac | 家用 Windows |
|---|---|---|
| 用途 | 工作日小改动、审查、紧急修复 | 周末完整开发、较长测试和视觉调试 |
| 仓库路径 | `/Users/shiyongqiang/Projects/LingoLife` | 建议 `%USERPROFILE%\Projects\LingoLife` |
| Git remote | `origin = git@github.com:Shimooth/LingoLife.git` | 必须相同 |
| 默认分支 | `main` | `main` |
| Git 身份 | 当前尚未显式配置，提交曾使用系统推导身份 | 初始化时必须显式配置，并与 Mac 相同 |
| 行尾 | 建议 Git 统一保存 LF | 必须关闭自动 CRLF 转换，保存 LF |
| VPS SSH alias | `lingolife-vps` 已配置 | 待按第 4 节配置 |
| VPS 私钥 | `~/.ssh/lingolife_deploy` | 使用独立的 `~/.ssh/lingolife_deploy_win` |
| GitHub 私钥 | 使用本机已有 GitHub SSH 配置 | 使用独立的 `~/.ssh/lingolife_github_win` |
| 本地依赖 | 当前 Node 26；Backend venv 是 Python 3.9，低于项目声明的 3.11+，应迁移到 Python 3.12 | 使用 Node 22 LTS、Python 3.12 |
| 本地秘密/数据 | 本机 `.env`、`.venv`、`node_modules`、SQLite | Windows 单独创建，绝不通过 Git 同步 |

两台电脑不要共享私钥。每台机器各生成 GitHub 和 VPS 密钥，分别登记公钥；丢失一台设备时可以只吊销该设备，不影响另一台。

## 3. Git 一次性配置

两台设备使用同一个 GitHub 已验证姓名和邮箱。以下尖括号内容由用户在本机填写，不得让 Codex 猜测邮箱。

### 3.1 Mac

```bash
git config --global user.name "<你的 GitHub 显示名>"
git config --global user.email "<你的 GitHub 已验证邮箱或 noreply 邮箱>"
git config --global init.defaultBranch main
git config --global pull.ff only
git config --global fetch.prune true
git config --global core.autocrlf false
git config --global core.eol lf
```

### 3.2 Windows PowerShell

```powershell
git config --global user.name "<与 Mac 完全相同的名字>"
git config --global user.email "<与 Mac 完全相同的邮箱>"
git config --global init.defaultBranch main
git config --global pull.ff only
git config --global fetch.prune true
git config --global core.autocrlf false
git config --global core.eol lf
```

验证两台设备的输出一致：

```bash
git config --global --get user.name
git config --global --get user.email
git config --global --get pull.ff
git config --global --get core.autocrlf
git remote -v
```

不使用 `git config credential.helper store` 保存明文密码。本项目 remote 使用 SSH，不需要把 GitHub Token 写入仓库或脚本。

## 4. SSH 一次性配置

### 4.1 Mac 当前配置与建议

当前有效别名：

```sshconfig
Host lingolife-vps
  HostName <VPS 主机名或 IP，沿用本机现值>
  User lingolife-deploy
  IdentityFile ~/.ssh/lingolife_deploy
  IdentitiesOnly yes
```

为避免每次重启后重复输入私钥口令，macOS 可补充：

```sshconfig
Host lingolife-vps
  AddKeysToAgent yes
  UseKeychain yes
```

然后在普通 Terminal（不是受限子进程）执行一次：

```bash
eval "$(ssh-agent -s)"
ssh-add --apple-use-keychain ~/.ssh/lingolife_deploy
ssh -o BatchMode=yes lingolife-vps 'id'
ssh -T git@github.com
```

私钥口令由用户创建，项目和 Codex 都不知道。Keychain 保存的是解锁能力，不会把私钥放进仓库。

### 4.2 Windows 生成独立密钥

在 PowerShell 执行：

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.ssh" | Out-Null
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\lingolife_github_win" -C "lingolife-github-home-win"
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\lingolife_deploy_win" -C "lingolife-vps-home-win"
```

两把密钥都应设置口令。只把 `.pub` 公钥分别添加到 GitHub SSH Keys 和 VPS 的 `/home/lingolife-deploy/.ssh/authorized_keys`；不要复制 Mac 私钥，也不要把 Windows 私钥发到聊天。

Windows 的 `%USERPROFILE%\.ssh\config`：

```sshconfig
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/lingolife_github_win
  IdentitiesOnly yes

Host lingolife-vps
  HostName <与 Mac 相同的 VPS 主机名或 IP>
  User lingolife-deploy
  IdentityFile ~/.ssh/lingolife_deploy_win
  IdentitiesOnly yes
```

用管理员 PowerShell 启用 Windows OpenSSH Agent，再用普通 PowerShell 添加密钥：

```powershell
Get-Service ssh-agent | Set-Service -StartupType Automatic
Start-Service ssh-agent
ssh-add "$env:USERPROFILE\.ssh\lingolife_github_win"
ssh-add "$env:USERPROFILE\.ssh\lingolife_deploy_win"
git config --global core.sshCommand "C:/Windows/System32/OpenSSH/ssh.exe"
ssh -T git@github.com
ssh -o BatchMode=yes lingolife-vps "id"
```

这条 `core.sshCommand` 避免 Git for Windows 调用其内置 SSH、却把密钥加入 Windows 系统 SSH Agent 后两者互相看不见。

首次连接时必须通过 VPS 控制台核对 host key 指纹。若以后出现 host key 变化，立即停止，不得使用跳过验证参数。

## 5. 每次接手工作的固定流程

必须确保另一台设备已经完成第 6 节交出流程，然后再开始：

```bash
git fetch --prune origin
git status --short --branch
git log -1 --oneline --decorate
git branch -vv
git pull --ff-only
```

Windows PowerShell 使用相同 Git 命令。检查规则：

1. `main` 必须与 `origin/main` 一致，或明确知道自己正在接手哪个 `wip/*` 分支；
2. 不得覆盖另一台电脑未推送的改动；
3. 不认识的 modified/untracked 文件先停止并查看本文件的交接状态；
4. 禁止以 `git reset --hard`、`git clean` 或覆盖式 checkout 来“处理”陌生改动；
5. `git stash` 只存在当前电脑，不能作为跨设备交接工具。

首次在该设备克隆：

```bash
mkdir -p ~/Projects
cd ~/Projects
git clone git@github.com:Shimooth/LingoLife.git
cd LingoLife
git switch main
```

Windows PowerShell 把 `~/Projects` 替换为 `$env:USERPROFILE\Projects`。

## 6. 每次离开设备前的固定交出流程

### 6.1 已完成且测试通过

```bash
git status --short
git diff --check
cd backend && .venv/bin/pytest -q
cd ../ && npm --prefix web run lint
npm --prefix web run typecheck
npm --prefix web run build
git add <本次明确修改的文件>
git commit -m "<类型>: <清楚描述>"
git push origin HEAD
```

Windows 后端测试命令为：

```powershell
backend\.venv\Scripts\python.exe -m pytest -q backend\tests
```

提交前更新本文件第 1 节的设备、分支、提交、验证、未完成项和下一步。推送后确认：

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse '@{u}'
```

除明确列出的本地文件外，工作树应为空，两个 SHA 应相同。

### 6.2 工作未完成或暂时不能通过测试

不要把破损代码提交到 `main`，也不要只存在本地 stash。建立可推送的 WIP 分支：

```bash
git switch -c wip/<简短主题>
git add <本次相关文件>
git commit -m "wip: <当前做到哪里>"
git push -u origin HEAD
```

在第 1 节记录失败测试、剩余问题和精确下一步。另一台设备接手：

```bash
git fetch --prune origin
git switch wip/<简短主题>
git pull --ff-only
```

完成后再把经过测试的结果合并到 `main`。同一分支同一时间只能有一台设备写入。

## 7. 本地环境不通过 Git 同步

以下目录或文件均已被 `.gitignore` 排除，每台设备独立创建：

- `.env`、`config/lingolife.local.yaml`：本地秘密和覆盖配置；
- `backend/.venv`：Python 虚拟环境；
- `web/node_modules`、`web/dist`：Node 依赖和构建产物；
- `data/`、`*.db`、`*.sqlite*`：本地运行数据；
- IDE 配置、日志、备份和 Unity 生成目录。

推荐统一工具版本：Python 3.12、Node 22 LTS。不要复制虚拟环境或 `node_modules`；在各设备根据锁文件重建。

Mac/Linux：

```bash
cd backend
python3.12 -m venv .venv
. .venv/bin/activate
python -m pip install -e '.[test]'
cd ../web
npm ci
```

Windows PowerShell：

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[test]"
cd ..\web
npm ci
```

DeepSeek Key 建议为每台设备建立可独立吊销的 Key，并分别写入本机 `.env`。如果只做规则层和 fallback 测试，可以不配置本地 DeepSeek。生产秘密只在 VPS `/etc/lingolife/lingolife.env`。

本地 SQLite 不用于设备间同步游戏进度。需要可重复测试时使用测试 fixture 或受限的 `onboarding-test` 重置流程；不要复制生产数据库。外部原始素材包也不通过 Git 同步，只有经筛选、具备许可证记录且进入运行时的资源才提交仓库。

## 8. 本地启动

终端一，后端：

```bash
cd backend
. .venv/bin/activate
uvicorn lingolife.app:app --reload --host 127.0.0.1 --port 8000
```

Windows PowerShell：

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn lingolife.app:app --reload --host 127.0.0.1 --port 8000
```

终端二，前端：

```bash
npm --prefix web run dev
```

玩家端通常为 `http://localhost:5173`。本地管理端细节和测试账号重置见 `web/README.md` 与 `docs/P0_BETA_OPERATIONS.md`。

## 9. 部署规则

任一设备只有在 Git 工作树干净、提交已经推送、全量检查通过且用户明确要求部署时，才能执行 `deploy/README.md` 的发布包流程：

```text
package-release.sh → scp → promote-release.sh → 双域名健康检查
```

VPS 统一使用：

- SSH alias：`lingolife-vps`
- 用户：`lingolife-deploy`
- 应用：`/opt/lingolife/app`
- 数据：`/opt/lingolife/data`
- 备份：`/opt/lingolife/backups`
- 环境文件：`/etc/lingolife/lingolife.env`

不要在 VPS `git pull`，不要复制 GitHub 私钥到 VPS，不要把生产 env 下载到本地。发布前在线备份 SQLite；发布后核对 `.source-revision`、Compose health、近期日志和两个 HTTPS 域名。

## 10. Codex 新会话开场提示词

Mac 或 Windows 均可直接发送：

```text
先完整阅读 docs/SESSION_HANDOFF.md，再检查当前设备的 Git 分支、远端、工作树和工具版本。不要覆盖或提交不属于本次任务的改动，不要读取或输出秘密。先告诉我当前交接状态是否一致，再继续我的任务；只有我明确要求时才提交、推送或部署。
```

若是从另一台设备接手未完成分支，再追加：

```text
本次接手 docs/SESSION_HANDOFF.md 中记录的 wip 分支。先拉取并运行交接记录中的失败/验证命令，确认现状后继续，不要从 main 重新实现。
```

## 11. 最小原则

1. Git 是源码和交接记录的唯一同步源，不是密码、依赖或数据库同步工具。
2. 一台设备一套私钥；只共享公钥和非敏感 SSH alias。
3. 一次只有一台设备写同一分支。
4. 完成内容提交到 `main`；未完成内容提交到 `wip/*`；不用 stash 交接。
5. 离开前 push，接手前 fetch/pull，任何陌生改动先停下核对。
6. Codex 依据本文件、Git 和测试恢复上下文，不依赖另一窗口的聊天历史。
