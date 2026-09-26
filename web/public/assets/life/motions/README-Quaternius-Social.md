# Quaternius 社交动作子集

本子集来自本机已下载、附带 CC0 1.0 许可的 **Quaternius Universal Animation Library Standard**。原始许可证完整保存在同目录 `License-Quaternius-Social.txt`；只打包所用动作，没有打包原始人体模型、纹理或其余 41 个动作。角色自身的 City／Chibi 许可仍独立适用。

## 可复现来源

- 暂存目录相对位置：`animations/quaternius_standard/UAL1_Standard.glb`。
- 原文件大小：7,618,436 bytes。
- 原文件 SHA-256：`69591853d817488edaa8fd9bf8fc1d821eaeaf789f8627b3cd23b41c4ed67997`。
- 许可暂存位置：`licenses/quaternius__Universal_Animation_Library_Standard__License.txt`。
- 运行时文件：`quaternius-social.json`，99,340 bytes；SHA-256：`6027fbf3fb9b49ce53f85f5add82c0d353a5847520dda4440fd98e8c6b3807c6`。
- 运行时许可证 SHA-256：`67e65a88def1ce573211f5cac3f514014abeface8fe48309c010491186b3a89a`（仅统一 LF 行尾、去除行末空格及末尾空行，许可文字不变）。

仓库根目录执行：

```sh
node web/scripts/import-social-motions.mjs /path/to/LingoLifeAssets/05_curated_candidates
```

导入脚本检查许可，提取 `Idle_Talking_Loop` 和 `Sitting_Talking_Loop`（各约 2.933 秒），只留双臂的必要祖先层级和旋转数据，移除全部动画位移与缩放。输出采用固定精度及按源指纹生成的稳定 UUID，相同原文件重复导入应产生相同 SHA-256。

## 运行时使用边界

`socialRetarget.ts` 按真实骨段方向和胸部参考系映射 City 的 T 形绑定姿势与 Chibi 的 A 形绑定姿势；运行时只生成双上臂、前臂与手的 **6 条 quaternion 轨道**。保留底层动作的骨盆、座面接触、腿部、躯干和头部关注方向；不复制源骨长、不拉伸、不移动角色根节点、不覆盖手指。当前素材不是嘴型同步或完整表情系统。

上层控制器在当前说话者需要表达时淡入手势，倾听时淡出。拿杯、触物与起身由现有接触／行动控制器优先控制，不可在完整取放动作上强加这组手势。

## 验证

```sh
cd web
node scripts/check-social-motions.mjs
```

此专项加载实际发布的 City-01、City-03、Chibi 两套选定衣服，检查站立和坐姿两个动作的循环、手腕连续位移、肘部方向、骨长和不变的下身，以及实际座面校正后的咖啡桌手部净空。它不代替正式界面的可视验收，也不声称所有衣袖、家具或饰品都已完成碰撞检测。
