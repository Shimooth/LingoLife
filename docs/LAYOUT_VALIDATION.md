# 布局拓扑与资产目录

Phase 7 的第一步把“编辑器里看起来能放”与“游戏运行时确实安全”分成两个边界：

- `config/world-asset-catalog.json` 是统一、机器可读的资产事实目录。
- `backend/lingolife/layout_validation.py` 是不访问数据库、不写文件、不修改输入的纯验证内核。
- 管理端草稿检查、显式校验、发布、历史激活和默认恢复都调用该内核；失败返回结构化 issue，且 active 版本保持不变。

## 资产目录

目录逐项覆盖当前后端五个白名单层级：

- `city.roads`
- `city.buildings`
- `city.props`
- `city.decorations`
- `interior`

同一个模型可以合法属于多个层级，例如公园树既可作为城市装饰，也可用于室内/场景切面。每个资产必须声明：

- `source_id` 和 `license_id`；源包同时记录作者、下载地址和仓库内许可证副本。
- `category` 与 `allowed_layers`。
- `footprint`：用于地面碰撞的二维矩形及是否阻挡。树木与盆栽使用树干/花盆的可行走碰撞面，完整树冠仍记录在 `bounds` 中。
- `bounds`：来自 GLTF position accessor 的完整三维尺寸，或明确标记为人工校准。
- `lod`：当前素材都是单模型一级 LOD；字段保留以便以后加入距离分级，而不是让代码猜测。
- `uses` 与 `semantic_capabilities`：例如道路端口、建筑族、座位数、资源类别及可承载的 Life Action。

当前目录包含 62 个唯一模型：38 个城市白名单模型和 29 个室内白名单模型，其中 5 个跨层复用。测试会将目录逐层与后端现有 allowlist 做集合相等比较；少一个、多一个或放错层都会失败，并确认模型和许可证副本实际存在。

## 纯验证 API

```python
from lingolife.layout_validation import (
    load_world_asset_catalog,
    validate_layout_topology,
)

report = validate_layout_topology(
    layout_dict,
    shared_home_manifest_dict,
    load_world_asset_catalog(),
)
```

成功返回不可变的 `LayoutTopologyReport`。失败抛出 `LayoutTopologyError`，其 `issues` 是一组不可变的 `LayoutValidationIssue(code, path, message)`；调用方不需要解析英文错误字符串。

`validate_layout_topology` 本身只依赖三个输入 mapping。`load_world_asset_catalog` 是单独提供的 I/O 便利函数，因此测试、草稿预览和未来发布事务可以对同一输入得到确定结果。

## 城市硬门槛

道路验证以 2.6 单位网格为准，并允许 0.03 的位置误差和 0.01 个四分之一转的角度误差。端口来自资产目录，并在旋转后逐边检查：

- 相邻道路端口必须互相同意。
- 相邻的两个封闭路缘不能伪装成道路连接。
- 整张道路图必须连通。
- 仅允许西、东、北三个已登记的天空道路出口开放。

建筑和道路使用完整、带旋转与非等比缩放的 OBB footprint 做 SAT 检测，而不是比较中心点。建筑之间也使用同一算法。城市 `decorations` 必须避开道路 footprint；车辆和交通设施属于 `props`，因为它们本来就可能布置在道路/路肩上，不适用装饰层规则。

## 共享住宅硬门槛

当前共享住宅是四个独立切面。连接关系由目录策略声明为以客厅为中心的三条连接边；每个切面唯一的开放 `entry` anchor 代表它与公共走廊的门。验证内容包括：

- 客厅、厨房、浴室、睡眠间的 ID 与 kind 必须完整匹配，连接图必须连通。
- 每个房间必须有且只有一个开放入口，入口不能被家具堵住。
- 以 0.18 单位网格和 0.28 单位角色净空，从入口验证开放站位和资源交互位可达；贴附家具的交互点允许 1.15 单位的接近半径。
- 所有 anchor 的 `fixture_id` 必须指向同房间实体；内置电视是唯一登记的合成 fixture。
- 厨房、电视和浴室资源必须存在，其 fixture 与对应 action anchor 必须有效。
- 13 类 Life Action 集合必须精确匹配。
- 容量必须保持 2/4/8，最大居民数为 8；睡眠间必须提供 1～8 号互不重复的私人睡眠 anchor。
- 所有阻挡型室内家具继续做完整 OBB 重叠检查。

验证器不会只检查一份静态住宅 manifest。它以 manifest 中的 fixture/anchor 为语义基线，再与本次 proposed layout 的 `interior.rooms[].placements` 逐房交叉验证：

- 删除或改名一个被 anchor、资源或睡眠位引用的 proposed fixture 会直接失败。
- 用不具备对应 `semantic_capabilities.life_actions` 的模型替换 fixture 会失败。
- fixture 平移或旋转后，附着 anchor 会按相对变换一起移动，入口路径检查使用变换后的 anchor 和 proposed 家具 footprint。
- proposed 房间内的家具重叠、入口封堵和 `room_id` 错配均独立报告，不会因为静态 manifest 合法而放行。

共享住宅目前没有在 manifest 中单独保存门网；验证器会优先读取未来的 `room_connections` 字段，在字段尚未加入旧 manifest 时使用目录里的同一连接策略。这样可以先形成发布门禁，而不会假装现有编辑器已经能创作墙体或门。

## 测试范围

`backend/tests/test_layout_validation.py` 使用 `default_world_layout()` 和正式 shared-home manifest 作为成功 fixture，并覆盖以下故障：

- 拆除桥接道路造成断路。
- 道路偏离网格或旋转破坏接头。
- 建筑中心不在路上、但完整 footprint 压入道路。
- 两栋旋转建筑互相重叠。
- 装饰占用主路。
- 房间缺门导致住宅连接图断开。
- proposed layout 删除语义 fixture、用错误能力的模型替换 fixture，或用家具封死入口。
- Life Action / 资源 anchor 缺失。
- 资源引用不存在的 fixture。
- 少于 8 个私人睡眠位。

`backend/tests/test_layout_publication.py` 进一步覆盖服务端草稿 CAS、非法拓扑发布拒绝、SHA-256 内容身份、重复发布幂等、不可变历史、激活/回滚、默认恢复、管理员 Cookie/Origin 以及 NPC/关系/消息/学习/故事动态事实表的发布前后指纹一致。验证内核仍保持纯函数；持久化、active 指针和审计由 Database/API 层承担。
