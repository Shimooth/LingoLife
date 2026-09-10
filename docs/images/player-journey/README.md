# 玩家旅程图解

这些是按项目已核对流程绘制的设计说明，不是游戏截图。每张图均区分当前实现与设计建议。

| 文件 | 内容 |
|---|---|
| `01-journey` | 初次入住、发现、参与、后果与回访 |
| `02-life-loop` | 人格、需要与环境如何形成生活循环 |
| `03-social-scene` | 共餐／分担的具体设计示例，尚非完整实现 |
| `04-conversations` | 当前会话问题与建议的玩家体验 |
| `05-roadmap` | 下一步设计顺序与体验验收 |

PNG 用于 Markdown 图片和跨设备阅读，SVG 用于无损放大。原文说明、替代文字和详细设计在 [主文档](../../PLAYER_JOURNEY_AND_SYSTEMS.md)。没有使用外部图片、AI 生成位图或新增运行时资源，不影响游戏加载体积。

## 编辑与导出

编辑 `docs/scripts/render-player-journey.mjs` 中的图中文字和布局，然后在仓库根目录运行：

```bash
node docs/scripts/render-player-journey.mjs
```

这会重新生成 SVG，无第三方依赖。PNG 导出通过单独启动的隔离 Chrome 进行：

1. 启动 Chrome，使用一个新建的临时用户目录和 `--remote-debugging-port=19226`；不要使用个人日常浏览器资料目录。
2. 执行 `node docs/scripts/render-player-journey.mjs --png`。
3. 导出完成后关闭该隔离浏览器。非默认端口通过 `QA_CDP_URL` 指定。

脚本按 1.5 倍像素密度导出，等待中文字体加载并检查文字是否超出画布。字体优先使用 Mac 的 PingFang SC、Windows 的 Microsoft YaHei；不同系统的字形可能略有差异，导出后须检查行宽和箭头。导出的 PNG 不依赖阅读设备的中文字体或 Mermaid 支持。

本目录只存文档图；没有读取账号、调用 AI 或连接生产服务器。
