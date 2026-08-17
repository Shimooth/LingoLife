# NPC Agent 系统设计文档

版本：0.1

项目：《LingoLife》

# 一、系统概述

## 1.1 设计目标

NPC Agent 是游戏世界中的智能角色系统。

每个 NPC 不只是一个聊天机器人，而是拥有：

- 独立人格
- 长期记忆
- 当前状态
- 个人目标
- 社交关系
- 行为倾向

的虚拟生命。

NPC 的目标：

> 让玩家感觉自己生活在一个持续运行、有情感、有变化的世界中。

# 二、NPC Agent 核心结构

一个 NPC 由以下模块组成：

```
NPC Agent

├── 人格系统 Personality
│
├── 状态系统 State
│
├── 记忆系统 Memory
│
├── 关系系统 Relationship
│
├── 目标系统 Goal
│
├── 行为决策系统 Behavior
│
├── 对话系统 Dialogue
│
└── 学习交互系统 Language Interaction
```

# 三、人格系统（Personality System）

## 3.1 基础信息

每个 NPC 拥有固定身份：

```
{
"name":"Lisa",
"age":25,
"occupation":"music producer",
"location":"island town"
}
```

## 3.2 性格模型

人格影响：

- 说话方式
- 行为选择
- 事件类型
- 对玩家反馈

示例：

```
{
"traits":[
"creative",
"introverted",
"kind"
]
}
```

效果：

创造型 NPC：

- 更容易产生创作相关事件

内向型 NPC：

- 不主动交流
- 需要提高关系后开放更多内容

# 四、兴趣系统（Interest System）

NPC 拥有兴趣标签：

例如：

```
Music
Technology
Cooking
Sports
Travel
Art
```

兴趣影响：

## 事件生成

音乐家：

可能：

- 邀请玩家制作歌曲
- 寻找乐器
- 举办音乐会

厨师：

可能：

- 开发新菜品
- 寻找食材
- 参加比赛

# 五、状态系统（State System）

NPC 每天拥有动态状态。

## 5.1 情绪状态

例如：

```
Happy
Sad
Angry
Excited
Lonely
Tired
```

影响：

- 对话内容
- 事件概率
- 玩家互动反馈

## 5.2 当前需求

类似模拟人生：

```
Need:

Food
Rest
Social
Achievement
Love
```

NPC 会主动产生行为。

# 六、记忆系统（Memory System）

NPC 必须拥有长期记忆，否则无法形成真实关系。

## 6.1 短期记忆

保存：

最近事件：

```
Yesterday:

Player helped Lisa find guitar.

Relationship +10
```

有效期：

数天。

## 6.2 长期记忆

保存重要信息：

例如：

```
Player likes electronic music.

Player helped me when I was sad.

Player often makes grammar mistakes.
```

长期影响：

NPC 后续行为。

## 6.3 记忆检索

生成对话时：

流程：

```
当前对话

↓

检索相关记忆

↓

生成符合历史的回复
```

避免：

NPC 前后矛盾。

# 七、关系系统（Relationship System）

NPC 与玩家拥有关系值：

```
0-20 Stranger

20-50 Acquaintance

50-80 Friend

80-100 Close Friend
```

关系影响：

## 对话权限

低关系：

普通聊天。

高关系：

分享秘密、个人故事。

## 事件类型

陌生：

请求帮助。

朋友：

邀请活动。

亲密：

共同目标。

# 八、目标系统（Goal System）

每个 NPC 有长期目标。

例如：

Lisa：

```
Goal:
Hold a personal concert
```

阶段：

```
寻找乐器

↓

练习歌曲

↓

邀请朋友

↓

举办演出
```

玩家可以参与目标推进。

# 九、行为决策系统（Behavior System）

NPC 每日生成行为。

输入：

```
人格

+

状态

+

目标

+

历史事件

+

岛屿环境
```

输出：

```
今天行动
```

例如：

Lisa：

```
Morning:
Practice guitar

Afternoon:
Talk with player

Night:
Write songs
```

# 十、对话系统（Dialogue System）

## 10.1 对话目标

NPC 对话不是自由聊天。

每次交流应该有目的：

例如：

- 获取信息
- 建立关系
- 完成任务
- 解决问题

## 10.2 对话生成输入

LLM Prompt 包含：

```
NPC identity

Personality

Current emotion

Relationship

Relevant memories

Current event

Player English level
```

# 十一、英语学习融合系统

NPC 是英语使用场景。

不是老师。

## 11.1 难度适配

根据玩家等级：

A1：

```
Where is the shop?
```

B2：

```
Could you explain why the supply chain was interrupted?
```

## 11.2 错误反馈

NPC 不直接批改。

自然反馈：

玩家：

"I go yesterday."

NPC：

"Oh, you went yesterday? That sounds interesting."

通过自然纠正学习。

# 十二、NPC Agent 数据结构示例

```
{
"name":"Lisa",

"personality":{
"creative":90,
"friendly":70,
"shy":60
},

"interest":[
"music",
"photography"
],

"memory":[
{
"event":"player helped me",
"importance":80
}
],

"relationship":{
"player":65
},

"goal":{
"concert":40
},

"state":{
"mood":"happy",
"energy":70
}
}
```

# 十三、未来扩展方向

## 多 NPC 社交网络

NPC之间拥有：

- 友情
- 冲突
- 恋爱
- 合作

形成动态社会。

## NPC 自主成长

NPC经历：

事件 → 学习 → 改变人格。

例如：

害羞角色：

经过玩家帮助：

逐渐变得自信。

# 十四、设计原则

1. NPC 首先是生命，其次才是教学工具。
2. 玩家应该因为关心 NPC 而使用英语。
3. 语言学习应该隐藏在互动过程中。
4. NPC 的记忆和一致性比随机生成数量更重要。

目标：

创造一个玩家愿意每天回来的 AI 世界，而英语只是连接人与人的方式。