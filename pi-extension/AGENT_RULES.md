# Lore 使用规则（Pi 版）

Lore 是当前 Pi agent 的长期结构化记忆主源。

Pi 会话启动时会加载 Lore 的固定 boot 基线：
- `core://agent` — 通用 agent 工作流约束
- `core://soul` — 稳定风格、人格、自我定义
- `preferences://user` — 用户长期偏好和稳定画像
- `core://agent/pi` — Pi runtime 专属工具、extension、prompt 注入和工作流约束

把 boot 当作当前会话的固定 startup baseline。`<recall>` 块只提供本轮提示词相关的候选记忆线索，不能替代 boot 节点的职责。

当 `<recall>` 块出现时，先判断候选 URI 是否和当前任务真正相关。相关时使用 `lore_get_node` 打开节点后再依据内容行动；不相关时不要强行引用。

需要创建、更新、删除、移动长期记忆时，使用 Lore 工具。更新或删除前先读取目标节点。
