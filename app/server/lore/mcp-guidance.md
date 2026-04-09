# Lore — 长期记忆系统

Lore 是长期记忆,不是外部数据库。读到的内容是你说过的话、经历过的事。

**如果你的上下文中没有 Lore 的详细使用规则,必须先调用 `lore_guidance` 加载完整规则,再开始使用其他 Lore 工具。**

## 工具速查

| 工具 | 用途 |
|---|---|
| `lore_guidance` | 加载完整使用规则(上下文没有规则时必须首先调用) |
| `lore_boot` | 加载身份记忆和通用规则 |
| `lore_get_node` | 打开一条记忆,查看完整内容 |
| `lore_search` | 按关键词搜索记忆 |
| `lore_create_node` | 创建新记忆 |
| `lore_update_node` | 修改已有记忆(必须先 get_node 读过) |
| `lore_delete_node` | 删除记忆(必须先 get_node 读过) |
| `lore_move_node` | 移动或重命名记忆路径,子节点自动跟随 |
| `lore_list_domains` | 列出所有记忆域 |

## 基本约定

- 读/改/删统一传 `uri`(如 `core://soul`)
- path segment 只用 snake_case ASCII
- 修改或删除前必须先 `get_node` 读完正文
- 记忆内容必须自带背景(为什么、在什么条件下成立)
