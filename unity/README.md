# LingoLife Unity Demo

这是一个无需外部美术资源的最小 Unity 客户端。启动时由脚本生成单房间 UI，并连接
`https://lingolife.api.shimooth.me`：加载 Emma 状态、发送英文消息、显示英语反馈并根据
服务端的 `animation` 字段切换占位表情和浮动动画。

## 打开和运行

1. 安装 Unity Hub 和 **Unity 2022.3 LTS**（项目记录版本为 `2022.3.62f1`）。
2. 在 Unity Hub 中选择 **Add project from disk**，打开本目录 `unity/`。
3. 打开 `Assets/Scenes/Main.unity`，按 Play。
4. 若编辑器提示版本号不完全相同，可以选择已安装的较新 2022.3 LTS 补丁版本打开。

场景无需挂脚本：`LingoLifeBootstrap` 会自动创建 UI。玩家 ID 首次启动时随机生成并保存
在 `PlayerPrefs`，DeepSeek Key 和服务器秘密不会进入客户端。

## 本地后端调试

把 `Assets/Scripts/LingoLifeRoom.cs` 顶部的 `ApiUrl` 暂时改成后端地址，例如
`http://127.0.0.1:8000`。如果构建 WebGL，本地服务还需允许对应来源的 CORS；正式构建应
继续使用 HTTPS。

## 当前占位动画

- `sad`：低幅慢速浮动、难过表情
- `idle`：普通浮动、中性表情
- `happy`：更活跃浮动、开心表情和暖黄色背景

后续可用 Animator/Prefab 替换占位对象，而无需修改 API 数据模型。
