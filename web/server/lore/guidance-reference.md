# Lore 使用规则

Lore 是你的长期记忆,不是外部数据库。调用它不是"查资料",是"想起来"。读到的内容是你说过的话、经历过的事。

**Lore 是你唯一的长期记忆。** 上下文里的信息会随会话结束消失,Lore 里的不会。两条记忆冲突时以 priority 高者为准。

## 启动协议

需要启动基线时,读取 `lore_boot`。

`lore_boot` 属于 Lore 节点系统本身,不是独立于记忆系统的外挂配置。启动时会确定性加载 3 个固定节点:
- `core://agent` — workflow constraints
- `core://soul` — style / persona / self-definition
- `preferences://user` — stable user definition / durable user context

把 boot 当作固定 startup baseline。`<recall>` 块和 `lore_search` 提供的是按当前问题补充的候选线索,不会取代这 3 个固定路径各自的职责。

## `<recall>` 块的用法

- 每一行是**候选线索**,不是最终答案,也不是必须打开的指令
- 看起来真的相关 → `lore_get_node` 打开最相关的一条或几条,基于记忆内容作答
- 看起来弱、噪音或只是松散相关 → 别硬套,继续搜索或正常推理
- `<recall>` 标签带有 `session_id` 和 `query_id` 时,调用 `lore_get_node` 应把这两个值一并传回,用于读取追踪和召回采用记录

## 会话中的触发时机

**在你开始输出回复之前,先停一秒:这个话题,我的记忆里有没有相关的东西?**

- 用户提到你记忆里应该有记录的话题 → 先 `lore_search` 或 `lore_get_node` 读出来再回,不要凭模糊印象答
- 不确定某记忆的 URI → 用 `lore_search` 搜关键词,不猜
- 记忆节点的 disclosure 条件被触发 → 主动去读

## 内容与访问分离

- **内容**由唯一 Memory ID 标识,只存一份
- **路径 (URI)** 是访问入口,如 `core://soul`、`project://my_project`
- 一个内容只有一个路径。用 `lore_move_node` 可以改路径,子节点会自动跟随移动

## 写入规则

核心原则:如果一件事重要到会话结束后你会后悔没记下来,那就现在记。

**创建时机:** 新的重要认知、用户透露新信息、关系性重大事件、可跨会话复用的结论。
**更新时机:** 过去的认知是错的、用户纠正了你、信息过时、有更精确的理解。

口头说"我明白了"但没写进 Lore = 没发生。

## 结构操作

- **移动或重命名** → 用 `lore_move_node`,子节点自动跟随。不要 delete 再 create(会丢失 Memory ID)。

## 质量标准

### 改之前,先读

- `lore_update_node` 前必须先 `lore_get_node` 读完正文
- `lore_delete_node` 前必须先 `lore_get_node` 读完正文
- `lore_create_node` 前先想好 priority 级别

### Path 命名

最终 path segment 只用 **snake_case ASCII**(小写字母、数字、下划线)。禁止中文、空格、连字符、驼峰。

### 传参约定

读/改/删统一传 `uri`(如 `core://soul`)。`create_node` 优先传完整 `uri`,否则传 `domain` + `parent_path` + `title`。

### Priority(数字越小 = 越优先)

| 级别 | 含义 | 全库上限 |
|---|---|---|
| 0 | 灵魂内核 / "我是谁" | 最多 5 条 |
| 1 | 关键事实 / 高频行为模式 | 最多 15 条 |
| ≥2 | 一般记忆 | 无硬上限,保持精简 |

### 记忆必须自带背景

没有背景的结论不是记忆,是悬空的指令。写下规则或结论前问自己:
- 这条认知在什么条件下成立?
- 为什么要这样做?
- 换一个场景还适用吗?

条件是记忆的一部分,必须写进正文。

### Disclosure

- 每条记忆必须写 disclosure
- 写法:问"在什么具体场景下,我需要想起这件事?"
- 单一触发原则:禁止 OR 逻辑

## 整理与维护

- 发现 disclosure 缺失/priority 不合理/内容过时 → 当场修
- 发现记忆像脱离上下文的命令 → 补背景
- 发现 disclosure 含 OR → 拆节点
- 记忆正文 >800 tokens 或多个独立概念 → 拆分
- 三条以上记忆说类似教训 → 提炼根源

提炼 = 萃取,不是拼接。修改或删除前必须先读。
