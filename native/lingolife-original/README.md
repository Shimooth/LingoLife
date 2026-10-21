# LingoLife 原创原生视觉样板

这里是与网页原创工作室共用场景和角色网格的本地原生样板。它不连接玩家后端、不读取登录令牌、不修改任何居民存档。

## 当前交付范围

- macOS 原生程序使用 SwiftUI + SceneKit（系统框架，无第三方运行时），实际导入同一份 `OriginalTown.json`。
- 四个原创角色预设；原生版提供身高、脸宽、头身比例、身形四项粗调。
- 站立、招呼、行走、说话、接礼物、吃饼干和开心七项动作；礼盒与完整／咬过的饼干复用网页同源网格，双臂 IK 定位手部。包含眨眼、开合嘴和双人问候小片段。
- 晴日、黄昏、夜晚；高低画质；人物近景、全景、鼠标旋转和滚轮缩放。喷泉水滴与涟漪持续运动，夜晚光源位于实际路灯中。
- 网页有更完整的参数化编辑能力；原生版的粗调是对已导出预设的骨骼组和几何组缩放，不假称与网页所有捏脸参数等价。
- 不含正式网络玩法、云存档同步、完整语音、真人动作捕捉、Windows / 手机构建。这一版用于比较同源资产的真实跨渲染器表现。

Unity 6000.5.8f1 的同源 JSON 导入器、交互样板和 macOS 构建入口位于 `Assets/`。本机 Unity 许可客户端初始化超时，同源导入器、交互脚本与构建入口已用本机 Unity 自带 C# 编译器及实际引擎引用通过源码编译检查，但不能将它标记为已成功构建的 Unity 客户端。为交付可运行样板，当前 `.app` 使用上述 macOS 系统框架，不调用或变更 Unity 账号和许可。

## 构建与运行

先由网页工作室导出器生成：

```
Assets/Resources/OriginalTown.json
```

然后运行（需要 Xcode Command Line Tools）：

```sh
native/lingolife-original/scripts/build-mac-preview.sh
open 'native/lingolife-original/Builds/LingoLife Original.app'
```

产物是本机架构的 ad-hoc 签名应用，适合当前电脑的本地样板；没有完成 Developer ID 公证及外部发行。`Builds/`、Unity 缓存和用户设置已忽略。

独立验收模式在指定临时目录保存场景截图和实际断言，21 秒左右退出：

```sh
LINGOLIFE_NATIVE_QA_DIR=/private/tmp/lingolife-original-native-qa \
  'native/lingolife-original/Builds/LingoLife Original.app/Contents/MacOS/LingoLifeOriginal'
```

Unity 许可恢复后可用：

```sh
native/lingolife-original/scripts/build-unity-preview.sh
```

## 同源资产契约

`version:1`，右手坐标，Y 朝上，米制。`root` 是街区，`presets` 是命名角色母版。`geometries` 数组按 ID 复用几何，网格通过 `geometryId` 引用位置、法线、UV、索引；材质保存线性 RGB / roughness / metalness / emission / opacity。每个节点保留本地坐标、四元数、缩放和可见性。`props` 保存共用礼盒与饼干；兼容未去重的内联网格。

SceneKit 同样为右手坐标，直接导入几何和层级；颜色从 Three 的线性 RGB 编码为显式 sRGB。Unity 导入器反转 Z、四元数 X/Y 和三角形绕序，以保持外观与法线方向。跨端共享几何不意味着两个渲染器输出逐像素一致：阴影、曝光和环境光需继续用同一套审美标准校准。

角色 `orig-head`、`orig-arm-*`、`orig-forearm-*`、`orig-leg-*` 的关节用于原生动作。原生动作只驱动这些同源关节，没有拼接第三方角色或动画。

## 本机验收记录（2026-10-04）

- 最终 macOS arm64 `.app` 约 24 MB，Swift 编译、ad-hoc 签名与真实 Metal 运行通过。
- 包内 JSON 与网页最终导出文件 SHA-256 一致：`5e660f9c229a00e9fa9597c30e1f469111c2aef44b2a5af4c6d85f3cdcfb2880`。
- 自动验收记录 4 个预设、1883 个网格、914268 个三角形；实际头宽/身高变化、预设切换、低画质关闭阴影、道具显示、双臂贴手均通过。礼盒右手目标距离约 `3.85e-7` 场景单位。
- 已实看原生白天、夜间、人物近景、礼盒与咬过饼干截图。系统窗口截图包含真实 SwiftUI 面板与 3D 画面。
- 本机报告与截图：`/private/tmp/lingolife-original-native-qa/`。这是功能及画面检查，不是手机真机测试、跨设备兼容认证或帧率性能承诺。
- 源码编译复验：`scripts/check-unity-source.sh`；Unity Player 仍受本机 Licensing Client 初始化失败限制。
