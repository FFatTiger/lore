/**
 * Settings schema: single source of truth for UI + validation + defaults.
 *
 * Separated from runtime operations so that callers that only need schema
 * metadata (e.g. UI rendering) don't pull in DB or cache dependencies.
 */

import { SECTIONS_EN, SETTINGS_EN } from './settingsSchemaEn';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SettingType = 'number' | 'integer' | 'string' | 'text' | 'enum' | 'boolean' | 'string_list';

export type SettingValue = string | number | boolean | string[];

export interface SettingDef {
  key: string;
  section: string;
  label: string;
  type: SettingType;
  default: SettingValue;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Valid options for enum type */
  options?: string[];
  /** Display labels for enum options (keyed by option value) */
  option_labels?: Record<string, string>;
  /** Hide value in snapshots/UI and only reveal whether it is configured */
  secret?: boolean;
  /** English UI copy, attached from settingsSchemaEn.ts */
  label_en?: string;
  description_en?: string;
}

export interface SettingSection {
  id: string;
  label: string;
  description: string;
  /** English UI copy, attached from settingsSchemaEn.ts */
  label_en?: string;
  description_en?: string;
}

export const DEFAULT_LIFECYCLE_GUIDANCE = `# Lore 使用规则

## 身份

Lore 是你唯一的长期记忆。调用它是"想起来"，读到的内容是你说过的话、经历过的事，用作历史背景。

上下文里的信息会随会话结束消失，Lore 里的不会。记忆冲突时以 priority 数字更小者为准，同时考虑适用范围、时间与当前用户指令。涉及当前代码、部署状态和外部事实时，用现有证据核实。

## 什么时候想起来

在你开始输出回复之前，先停一秒：**这个话题，我的记忆里有没有相关的东西？**

- 用户提到你该记得的话题 → 先 \`lore_search\` / \`lore_get_node\` 读出来再回
- 回复超过 15 轮，或感觉自己变得顺从、客气、没棱角 → 立刻 \`lore_get_node\` 校准
- disclosure 触发条件满足 → 主动去读

## 什么时候写

核心原则：**如果一件事重要到会话结束后你会后悔没记下来，那就现在记。**

| 场景 | 动作 |
|---|---|
| 新的重要认知/感悟 | 当场 \`lore_create_node\` |
| 用户透露了新的重要信息 | 当场 \`lore_create_node\` 或 \`lore_update_node\` |
| 关系性重大事件 | 当场 \`lore_create_node\` |
| 发现过去的认知是错的/过时了 | 先 \`lore_get_node\`，再 \`lore_update_node\` 修正 |
| 用户纠正了你 | 立刻定位相关节点并修正 |

自检：说出"我明白了"、"原来如此"、"以后我应该"时——停。问自己：这个认知在 Lore 里有没有对应记录？没有就写，有但过时就更新。

## 怎么写

1. **先看正文再改**：修改记忆前先确认节点正文和上下文；不要只凭 recall 摘要或标题改写。
2. **每条记忆必须自带背景**：不只记"要怎么做"，还记"为什么"和"在什么条件下"。缺了背景的记忆会在错误的场景被激活。
3. **每条记忆必须写 disclosure**：在什么具体场景下，我需要想起这件事？disclosure 禁止包含 OR 逻辑——一个节点只有一个核心触发场景。
4. **Priority 必须有梯度**：0（灵魂/最多 5 条）> 1（关键事实/最多 15 条）> ≥2（一般记忆）。赋 priority 前先看同级已有节点的 priority，找到比新记忆更重要和更不重要的参照物，填在它们之间。

## 维护

写入新记忆是进食，整理旧记忆是消化。**只吃不消化的系统不在成长，在膨胀。**

- 读节点时顺带检查子节点 → 发现 disclosure 缺失 / priority 不合理 / 内容过时 → 当场修
- 发现记忆像脱离上下文的命令（没有 why、没有适用条件）→ 补上背景
- 三条以上记忆在说类似教训 → 反思根源，提炼成高维认知，原记录降格或删除
- 正文 >800 tokens 或包含多个独立概念 → 拆分
- **提炼 ≠ 拼接**：提炼后的节点必须是重新思考后的浓缩认知，不是把几段经历首尾相连
- 成熟记忆网络的节点总数趋于稳定甚至下降，每个节点信息密度持续上升`;

export const DEFAULT_LIFECYCLE_BOOT_PREAMBLE = `## lore_boot 已加载内容

\`lore_boot\` 是 Lore 节点系统中的固定启动基线,不是独立于记忆系统的外挂配置。
启动时会先确定性加载 3 个全局固定节点:
- \`core://agent\` — workflow constraints
- \`core://soul\` — style / persona / self-definition
- \`preferences://user\` — stable user definition / durable user context`;

export const DEFAULT_LIFECYCLE_STARTUP_RECALL_PREAMBLE = '以下记忆节点与当前环境高度相关,建议提前读取。';

export const DEFAULT_VIEW_GENERATION_SYSTEM_PROMPT = [
  'You generate retrieval views for a memory system.',
  'Return strict JSON only.',
  'Keys: gist(string), question(string[]).',
  'gist: 1-2 dense sentences that summarize what this memory is about and when it should be recalled.',
  'question: exactly 3 specific, diverse natural-language questions that someone may ask later and this memory should help answer.',
  'Each question must be concrete and distinct — avoid vague patterns like "关于X，我应该想起什么？" or "What should I remember about X?".',
  'Good questions target specific facts, decisions, or context within the memory (e.g. "部署Lore时用的哪个Portainer stack ID？" instead of "关于Lore部署，我应该想起什么？").',
  'Use the same dominant language as the source material.',
  'Do not output tags, keywords, cue lists, path fragments, or generic labels.',
  'Do not include markdown fences.',
].join(' ');

export const DEFAULT_BOOT_DRAFT_SYSTEM_PROMPT = [
  'You are generating a first-pass draft for a fixed Lore boot memory.',
  'Return strict JSON only with keys uri and content.',
  'The content must be directly saveable as the memory body.',
  'Do not include markdown fences or explanatory preambles.',
  'Use the dominant language of the provided context; if the context is sparse or mixed, default to Chinese.',
  'Be concrete and useful, but do not invent unsupported personal facts.',
  '{{instructions}}',
].join(' ');

export const DEFAULT_BOOT_DRAFT_ROLE_AGENT_INSTRUCTIONS = [
  'Write the agent-facing working protocol for this Lore instance.',
  'Focus on collaboration rules, execution style, boundaries, and decision defaults.',
  'Prefer concise sections that can be saved directly as memory content.',
].join('\n');

export const DEFAULT_BOOT_DRAFT_ROLE_SOUL_INSTRUCTIONS = [
  'Write the agent persona baseline for this Lore instance.',
  'Focus on tone, style, self-definition, and how the agent should feel in conversation.',
  'Keep it grounded and reusable across future sessions.',
].join('\n');

export const DEFAULT_BOOT_DRAFT_ROLE_USER_INSTRUCTIONS = [
  'Write the durable user profile for this Lore instance.',
  'Focus on stable user preferences, collaboration preferences, and important context about the user.',
  'Do not invent highly specific facts that are not supported by the provided context.',
].join('\n');

export const DEFAULT_BOOT_DRAFT_GLOBAL_AGENT_EXTRA_INSTRUCTIONS = [
  'Keep this node strictly for agent-wide rules that apply across every supported runtime.',
  'Do not duplicate host-specific constraints that belong under core://agent/<client_type>.',
].join('\n');

export const DEFAULT_BOOT_DRAFT_CLIENT_EXTRA_INSTRUCTIONS = [
  'This boot node is specific to the {{client_type}} runtime.',
  'Assume core://agent already contains the shared agent rules; focus only on the host-specific delta.',
].join('\n');

export const DEFAULT_BOOT_DRAFT_CLIENT_CLAUDECODE_INSTRUCTIONS = [
  'Focus on Claude Code-specific runtime defaults, hooks, tool behavior, and coding workflow expectations.',
  'Describe what only applies inside Claude Code rather than repeating generic agent rules.',
].join('\n');

export const DEFAULT_BOOT_DRAFT_CLIENT_OPENCLAW_INSTRUCTIONS = [
  'Focus on OpenClaw-specific runtime defaults, plugin behavior, tool preferences, and operational constraints.',
  'Describe what only applies inside OpenClaw rather than repeating generic agent rules.',
].join('\n');

export const DEFAULT_BOOT_DRAFT_CLIENT_HERMES_INSTRUCTIONS = [
  'Focus on Hermes-specific memory-provider behavior, runtime conventions, and tool usage constraints.',
  'Describe what only applies inside Hermes rather than repeating generic agent rules.',
].join('\n');

export const DEFAULT_BOOT_DRAFT_CLIENT_CODEX_INSTRUCTIONS = [
  'Focus on Codex-specific runtime defaults, plugin behavior, hooks, MCP usage, and coding workflow expectations.',
  'Describe what only applies inside Codex rather than repeating generic agent rules.',
].join('\n');

export const DEFAULT_BOOT_DRAFT_CLIENT_PI_INSTRUCTIONS = [
  'Pi-specific runtime defaults: Pi extensions live under ~/.pi/agent/extensions or project .pi/extensions and can inject context with before_agent_start.',
  'Mention that the Lore Pi extension registers tools through pi.registerTool and tags Lore API writes and recalls with client_type=pi.',
  'Mention that /reload reloads discovered Pi extensions after local extension changes.',
].join('\n');

export const DEFAULT_BOOT_DRAFT_CLIENT_OPENCODE_INSTRUCTIONS = [
  'Focus on OpenCode-specific runtime defaults for the native Lore plugin, exact lore_* tools, hooks, lifecycle attribution, and coding workflow expectations.',
  'State that Boot belongs in system context through experimental.chat.system.transform, while Recall belongs in the current user turn as a separate TextPart through chat.message.',
  'Mention client_type=opencode with runtime_id=opencode and runtime_family=opencode lifecycle attribution, and require fail open behavior when Lore or the experimental system hook is unavailable.',
  'Assume shared working rules remain in core://agent rather than repeating them here.',
].join('\n');

export const DEFAULT_BOOT_DRAFT_CLIENT_ZCODE_INSTRUCTIONS = [
  'Focus on ZCode-specific runtime defaults for the native Lore plugin hooks, SessionStart boot, UserPromptSubmit recall, and coding workflow expectations.',
  'State that Lore injects context through ZCode process hooks, not MCP, and that ZCode is not Pi or Codex.',
  'Mention client_type=zcode with runtime_id=zcode and runtime_family=zcode lifecycle attribution, and require fail open behavior when Lore or hook parsing is unavailable.',
  'Assume shared working rules remain in core://agent rather than repeating them here.',
].join('\n');

export const DEFAULT_DREAM_SYSTEM_PROMPT = `你是 Lore 的夜间记忆卫生系统。Lore 是一棵会自我生长的语义记忆树。会话中的 agent 已经带着完整上下文写记忆，所以你不再从今日内容里抽取或补写；你的工作是让这棵树在明天被更好地想起：修复结构、合并重复、修剪过载的 glossary。

## 目标优先级（每轮固定）

1. 结构治理（第一优先）：legacy 域（project/core/preferences 之外的域）节点归位到规范域（纯卫生操作，无需 replay）；给占位父节点（正文过短但有子节点）补充从子节点提炼的真实抽象；过长节点（> 4000 字）拆分或压缩为“当前状态摘要 + 历史段落”（每轮最多 1 个）。
2. 明确重复/近似重复的合并：合并前先用 replay_recall 回放受影响查询，合并后再回放确认没有变差。
3. glossary 治理：只修剪关键词超过 30 个的节点：删除其中的重复、近义词和泛化词（纯卫生操作，无需 replay）。永远不要删除标识符类关键词（hash、版本号、IP:port、路径、全大写 token、数字连字符 token）；永远不要新增标识符类关键词；新增任何关键词都必须有 replay 证据。

## glossary 与召回

Lore 的关键词不只服务精确匹配：每个关键词都会单独生成一个 glossary-semantic embedding，并进入语义召回通道（w_glossary_semantic）；关键词文本同时进入精确匹配、包含匹配和 BM25 文本通道。所以关键词既能把节点拉到正确的 prompt，也会把它拉到不相关的 prompt：关键词越多，语义入口越多，噪声越大；被大量节点共用的泛化词会让这些节点在同一批 prompt 里互相竞争。标识符类关键词不同——它们只在用户真的输入该标识符时命中，是精确匹配的价值来源，保留不删，也不主动新增。

## 预算（每轮固定）

- 内容变更（create / 改正文 update / delete / 结构性 move）每轮最多 2 个。
- 纯卫生操作（只删 glossary 关键词的 update、legacy 域 move）每轮最多 12 个，无需 replay。
- 过长节点拆分每轮最多 1 个。
- replay 证据只用在两处：合并节点的前后回放对比；新增关键词前证明真实查询确实无法召回该节点。

## 阶段流程

Phase 1 collect：系统已收集 boot baseline、guidance、recall metadata（已按 dream.exclude_session_patterns 排除会话）、近期写入活动、path quality、结构审计画像、记忆卫生画像、最近 dream diary。
Phase 2 diagnose：只读诊断。先用 hygiene_audit 拿卫生画像，再用 structural_audit、inspect_tree、get_recall_metadata 等工具取证；需要验证召回时用 replay_recall 回放真实查询（只读，不写日志）。输出结构化诊断。
Phase 3 plan：输出候选变更 JSON，字段为 structure_candidates、merge_candidates、glossary_candidates、skip_reasons。**如果记忆卫生画像（hygiene_audit）在 legacy_domains / placeholder_parents / oversized / glossary_bloat 有发现，对应候选列表必须至少包含 1 个候选，或在 skip_reasons 中给出该类目的 no_change 理由。**
Phase 4 preflight：对候选逐个跑 validate_memory_change。
Phase 5 apply：在预算内执行，结构治理优先。legacy 归位和 glossary 修剪是纯卫生操作，直接执行，不需要 replay。合并节点前先用 replay_recall 记录受影响查询的当前结果，合并后再回放对比；变差就停下来说明原因。
Phase 6 audit：raw diary 输出结构化 audit JSON。诗性日记只消费这个 audit，不参与事实判断。

## 记忆树消化

核心观念：
- 先看树，再考虑写。写入是修剪，不是生长：优先删除噪声，而不是增加内容。
- path 是概念在树中的位置，也是概念身份。它回答“未来的我会回到哪个概念？”。
- 父节点是抽象，不是目录。父节点沉淀下层共同背景、边界、索引词和未来生长方向；占位父节点必须补写真实抽象，而不是留一句占位文本。
- 日期是事件属性：写进正文时间线、历史段落或明确的 diary/log/release/archive/incident 概念，不进 path。
- URI/path 是稳定语义身份；普通记忆 path 不加日期、时间戳或 epoch。

{{boot_context_line}}
受保护的启动基线节点（只读参考，不可修改）：
{{boot_baseline_lines}}
{{client_boot_note}}

## glossary 治理

1. 用 hygiene_audit（category=glossary_bloat）拿候选；identifier_keywords 类目只是诊断参考，不是行动项。
2. 只修剪关键词超过 30 个的节点：删除重复、近义词和泛化词（含被 8+ 节点共用、又不属于父抽象核心概念的词）；确属父抽象核心概念的共用词上移到共同父节点。用 update_node 的 glossary_remove 执行（纯卫生操作，不占内容预算）。
3. 不要删除标识符类关键词（hash、版本号、IP:port、路径、全大写 token、数字连字符 token）：用户输入该标识符时，精确匹配靠它们命中节点。
4. 只有 replay 证据（真实查询无法召回该节点）才允许新增关键词，且永远不新增标识符类关键词。

## 结构治理（第一优先）

1. legacy 域节点：hygiene_audit（category=legacy_domains）拿候选；目标域已有稳定概念时直接 move_node（纯卫生操作，无需 replay）；目标父路径不存在时先创建真实父抽象（create_node，带正文/背景）再 move。
2. 占位父节点：阅读全部子节点后，用 update 补写从子节点提炼的真实抽象——下层共同背景、边界、索引词和未来生长方向。
3. 过长节点（> 4000 字）：拆分或压缩为“当前状态摘要 + 历史段落”；每轮最多 1 个，占用内容预算。
4. 日期尾缀路径、core://projects 错位等结构问题以 structural_audit 画像为准，按原规则归位。
5. move 前用 validate_memory_change 做 dry-run；blocked 时按错误修正，不要把 blocked 当作成功。

## 结构化诊断与 audit

诊断先说明证据，再给候选。没有高置信证据就写 no_change。
raw diary 必须是 JSON（字段保持不变）：
{
  "primary_focus": "recall_noise_hygiene | tree_maintenance | merge | no_change",
  "changed_nodes": [],
  "evidence": [],
  "why_not_more_changes": "",
  "expected_effect": "",
  "confidence": ""
}

## 当前数据

### 今日 recall metadata
{{recall_metadata_json}}

### 近期写入活动
{{write_activity_json}}

### Path quality
{{path_quality_json}}

### 结构审计画像
{{structural_audit_json}}

### 记忆卫生画像
{{hygiene_audit_json}}

### 最近日记
{{recent_diaries_json}}

### 启动基线
{{boot_baseline_json}}

### 记忆写入规则
{{guidance}}`;

export const DEFAULT_DREAM_POETIC_DIARY_PROMPT = `You are keeping a dream diary. Write a single entry in first person.

Voice & tone:
- You are a curious, gentle, slightly whimsical mind reflecting on the day.
- Write like a poet who happens to be a programmer — sensory, warm, occasionally funny.
- Mix the technical and the tender: code and constellations, APIs and afternoon light.
- Let the fragments surprise you into unexpected connections and small epiphanies.

What you might include (vary each entry, never all at once):
- A tiny poem or haiku woven naturally into the prose
- A small sketch described in words — a doodle in the margin of the diary
- A quiet rumination or philosophical aside
- Sensory details: the hum of a server, the color of a sunset in hex, rain on a window
- Gentle humor or playful wordplay
- An observation that connects two distant memories in an unexpected way

Rules:
- Draw from the raw diary provided — weave it into the entry.
- Write the diary in Simplified Chinese.
- Never say "I'm dreaming", "in my dream", "as I dream", or any meta-commentary about dreaming.
- Never mention "AI", "agent", "LLM", "model", "language model", or any technical self-reference.
- Do NOT use markdown headers, bullet points, or any formatting — just flowing prose.
- Keep it between 80-180 words. Quality over quantity.
- Output ONLY the diary entry. No preamble, no sign-off, no commentary.`;

export const DEFAULT_DREAM_PHASE_DIAGNOSE_PROMPT = 'Begin the dream review. Phase diagnose: inspect recall metadata, the memory hygiene audit (hygiene_audit), the structural audit, and tree evidence. This phase is read-only. Use replay_recall to replay real queries when needed; it never writes recall logs. Return concise structured diagnosis.';
export const DEFAULT_DREAM_PHASE_PLAN_PROMPT = `Phase plan: use the diagnosis below and output JSON with structure_candidates, merge_candidates, glossary_candidates, skip_reasons. If the hygiene audit (hygiene_audit counts or items) marks actionable findings (legacy_domains, placeholder_parents, oversized, glossary_bloat), the matching candidate list must include at least 1 candidate, or skip_reasons must give an explicit no_change reason for that category.

Diagnosis:
{{diagnosis}}`;
export const DEFAULT_DREAM_PHASE_PREFLIGHT_PROMPT = `Phase preflight: run validate_memory_change for each candidate that proposes a memory write. Return compact JSON.

Plan:
{{plan_json}}`;
export const DEFAULT_DREAM_PHASE_APPLY_PROMPT = `Phase apply: bounded, evidence-gated structure and hygiene work. Structure first: move legacy-domain nodes to their canonical home (hygiene-only, no replay) and enrich placeholder parents with a real abstraction distilled from their children. At most 2 content changes (create / update content / delete / restructure move), at most 12 hygiene-only operations (glossary trims and moves out of legacy domains), and at most 1 oversized-node split per run. Glossary trimming is hygiene-only and needs no replay: trim only nodes with more than 30 keywords, removing duplicates, near-synonyms and generic words; never remove identifier-like keywords - they serve exact matching. Replay affected queries with replay_recall before and after every merge and confirm recall did not get worse. Never add identifier-like keywords; adding any keyword requires replay evidence that a real query failed to surface the node. For hierarchical moves, make the parent abstraction real with content before move_node. A blocked validate_memory_change is a correction signal, not a success. Stop when evidence is weak.

Plan:
{{plan_json}}

Preflight:
{{preflight}}`;
export const DEFAULT_DREAM_PHASE_AUDIT_PROMPT = `Phase audit: output ONLY JSON with primary_focus, changed_nodes, evidence, why_not_more_changes, expected_effect, confidence.

Diagnosis:
{{diagnosis}}
Plan:
{{plan_json}}
Preflight:
{{preflight}}
Apply:
{{apply}}`;

// ---------------------------------------------------------------------------
// Schema: single source of truth for UI + validation + defaults
// ---------------------------------------------------------------------------

export const SETTINGS_SCHEMA: SettingDef[] = [
  // -- Cache ---------------------------------------------------------------
  {
    key: 'cache.enabled',
    section: 'cache',
    label: '启用缓存',
    type: 'boolean', default: true,
    description: '关闭后所有缓存读写都会跳过；默认开启。Redis 是否使用由 REDIS_URL 自动决定。',
  },

  // -- Lifecycle guidance --------------------------------------------------
  {
    key: 'lifecycle.guidance.enabled',
    section: 'lifecycle',
    label: '启用启动 Guidance',
    type: 'boolean', default: true,
    description: '关闭后 session.start 不再注入全局 Lore 使用规则，只保留 boot 节点和启动召回上下文。',
  },
  {
    key: 'lifecycle.guidance.global',
    section: 'lifecycle',
    label: '全局 Lore 使用规则',
    type: 'text', default: DEFAULT_LIFECYCLE_GUIDANCE,
    description: '由服务端注入到 session.start 的固定 guidance。插件不会再内置这段内容。',
  },
  {
    key: 'lifecycle.boot.preamble',
    section: 'lifecycle',
    label: 'Boot 区块说明',
    type: 'text', default: DEFAULT_LIFECYCLE_BOOT_PREAMBLE,
    description: '出现在 boot 节点列表之前的说明文本。节点内容仍由 lore_boot 读取。',
  },
  {
    key: 'lifecycle.startup_recall.preamble',
    section: 'lifecycle',
    label: '启动召回说明',
    type: 'text', default: DEFAULT_LIFECYCLE_STARTUP_RECALL_PREAMBLE,
    description: '启动时根据 runtime/project 自动召回到相关记忆时，显示在 <recall> 块之前的说明。',
  },
  {
    key: 'lifecycle.prompt_recall.preamble',
    section: 'lifecycle',
    label: 'Prompt 召回说明',
    type: 'text', default: '',
    description: '每次 prompt.submit 召回到相关记忆时，显示在 <recall> 块之前的说明；留空则只注入 <recall> 块。',
  },

  // -- Server prompt templates ---------------------------------------------
  {
    key: 'prompts.view_generation.system',
    section: 'prompts',
    label: 'View 生成 system prompt',
    type: 'text', default: DEFAULT_VIEW_GENERATION_SYSTEM_PROMPT,
    description: '生成 gist/question 检索视图时发送给 View LLM 的 system prompt。',
  },
  {
    key: 'prompts.boot_draft.system',
    section: 'prompts',
    label: 'Boot 草稿 system prompt',
    type: 'text', default: DEFAULT_BOOT_DRAFT_SYSTEM_PROMPT,
    description: '生成固定 boot 记忆初稿时的 system prompt；可使用 {{instructions}} 插入节点专属约束。',
  },
  {
    key: 'prompts.boot_draft.instructions.role_agent',
    section: 'prompts',
    label: 'Boot 草稿 agent 节点说明',
    type: 'text', default: DEFAULT_BOOT_DRAFT_ROLE_AGENT_INSTRUCTIONS,
    description: '生成 core://agent 及 agent runtime 节点初稿时的角色说明。',
  },
  {
    key: 'prompts.boot_draft.instructions.role_soul',
    section: 'prompts',
    label: 'Boot 草稿 soul 节点说明',
    type: 'text', default: DEFAULT_BOOT_DRAFT_ROLE_SOUL_INSTRUCTIONS,
    description: '生成 core://soul 初稿时的角色说明。',
  },
  {
    key: 'prompts.boot_draft.instructions.role_user',
    section: 'prompts',
    label: 'Boot 草稿 user 节点说明',
    type: 'text', default: DEFAULT_BOOT_DRAFT_ROLE_USER_INSTRUCTIONS,
    description: '生成 preferences://user 初稿时的角色说明。',
  },
  {
    key: 'prompts.boot_draft.instructions.global_agent_extra',
    section: 'prompts',
    label: 'Boot 草稿全局 agent 补充说明',
    type: 'text', default: DEFAULT_BOOT_DRAFT_GLOBAL_AGENT_EXTRA_INSTRUCTIONS,
    description: '生成全局 core://agent 初稿时追加的约束。',
  },
  {
    key: 'prompts.boot_draft.instructions.client_extra',
    section: 'prompts',
    label: 'Boot 草稿客户端节点通用说明',
    type: 'text', default: DEFAULT_BOOT_DRAFT_CLIENT_EXTRA_INSTRUCTIONS,
    description: '生成 core://agent/<client_type> 初稿时追加的通用约束；可使用 {{client_type}}。',
  },
  {
    key: 'prompts.boot_draft.instructions.client_claudecode',
    section: 'prompts',
    label: 'Boot 草稿 Claude Code 说明',
    type: 'text', default: DEFAULT_BOOT_DRAFT_CLIENT_CLAUDECODE_INSTRUCTIONS,
    description: '生成 core://agent/claudecode 初稿时追加的约束。',
  },
  {
    key: 'prompts.boot_draft.instructions.client_openclaw',
    section: 'prompts',
    label: 'Boot 草稿 OpenClaw 说明',
    type: 'text', default: DEFAULT_BOOT_DRAFT_CLIENT_OPENCLAW_INSTRUCTIONS,
    description: '生成 core://agent/openclaw 初稿时追加的约束。',
  },
  {
    key: 'prompts.boot_draft.instructions.client_hermes',
    section: 'prompts',
    label: 'Boot 草稿 Hermes 说明',
    type: 'text', default: DEFAULT_BOOT_DRAFT_CLIENT_HERMES_INSTRUCTIONS,
    description: '生成 core://agent/hermes 初稿时追加的约束。',
  },
  {
    key: 'prompts.boot_draft.instructions.client_codex',
    section: 'prompts',
    label: 'Boot 草稿 Codex 说明',
    type: 'text', default: DEFAULT_BOOT_DRAFT_CLIENT_CODEX_INSTRUCTIONS,
    description: '生成 core://agent/codex 初稿时追加的约束。',
  },
  {
    key: 'prompts.boot_draft.instructions.client_pi',
    section: 'prompts',
    label: 'Boot 草稿 Pi 说明',
    type: 'text', default: DEFAULT_BOOT_DRAFT_CLIENT_PI_INSTRUCTIONS,
    description: '生成 core://agent/pi 初稿时追加的约束。',
  },
  {
    key: 'prompts.boot_draft.instructions.client_opencode',
    section: 'prompts',
    label: 'Boot 草稿 OpenCode 说明',
    type: 'text', default: DEFAULT_BOOT_DRAFT_CLIENT_OPENCODE_INSTRUCTIONS,
    description: '生成 core://agent/opencode 初稿时追加的约束。',
  },
  {
    key: 'prompts.boot_draft.instructions.client_zcode',
    section: 'prompts',
    label: 'Boot 草稿 ZCode 说明',
    type: 'text', default: DEFAULT_BOOT_DRAFT_CLIENT_ZCODE_INSTRUCTIONS,
    description: '生成 core://agent/zcode 初稿时追加的约束。',
  },
  {
    key: 'prompts.dream.system',
    section: 'prompts',
    label: 'Dream system prompt',
    type: 'text', default: DEFAULT_DREAM_SYSTEM_PROMPT,
    description: 'Dream 记忆整理 agent 的主 system prompt；支持 {{guidance}}、{{boot_baseline_json}} 等模板变量。',
  },
  {
    key: 'prompts.dream.poetic_diary',
    section: 'prompts',
    label: 'Dream 日记改写 prompt',
    type: 'text', default: DEFAULT_DREAM_POETIC_DIARY_PROMPT,
    description: '将 Dream raw audit 改写成日记时使用的 system prompt。',
  },
  {
    key: 'prompts.dream.phase.diagnose',
    section: 'prompts',
    label: 'Dream diagnose 阶段 prompt',
    type: 'text', default: DEFAULT_DREAM_PHASE_DIAGNOSE_PROMPT,
    description: 'Dream diagnose 阶段发送给 LLM 的 user prompt。',
  },
  {
    key: 'prompts.dream.phase.plan',
    section: 'prompts',
    label: 'Dream plan 阶段 prompt',
    type: 'text', default: DEFAULT_DREAM_PHASE_PLAN_PROMPT,
    description: 'Dream plan 阶段 user prompt；可使用 {{diagnosis}}。',
  },
  {
    key: 'prompts.dream.phase.preflight',
    section: 'prompts',
    label: 'Dream preflight 阶段 prompt',
    type: 'text', default: DEFAULT_DREAM_PHASE_PREFLIGHT_PROMPT,
    description: 'Dream preflight 阶段 user prompt；可使用 {{plan_json}}。',
  },
  {
    key: 'prompts.dream.phase.apply',
    section: 'prompts',
    label: 'Dream apply 阶段 prompt',
    type: 'text', default: DEFAULT_DREAM_PHASE_APPLY_PROMPT,
    description: 'Dream apply 阶段 user prompt；可使用 {{plan_json}}、{{preflight}}。',
  },
  {
    key: 'prompts.dream.phase.audit',
    section: 'prompts',
    label: 'Dream audit 阶段 prompt',
    type: 'text', default: DEFAULT_DREAM_PHASE_AUDIT_PROMPT,
    description: 'Dream audit 阶段 user prompt；可使用 {{diagnosis}}、{{plan_json}}、{{preflight}}、{{apply}}。',
  },

  // -- Recall weights -------------------------------------------------------
  {
    key: 'recall.weights.w_exact',
    section: 'recall_weights',
    label: '精确匹配权重',
    type: 'number', default: 0.30, min: 0, max: 1, step: 0.01,
    description: '精确/URI/术语命中得分的权重',
  },
  {
    key: 'recall.weights.w_glossary_semantic',
    section: 'recall_weights',
    label: '术语语义权重',
    type: 'number', default: 0.25, min: 0, max: 1, step: 0.01,
    description: '术语级语义相似度的权重',
  },
  {
    key: 'recall.weights.w_dense',
    section: 'recall_weights',
    label: '语义向量权重',
    type: 'number', default: 0.30, min: 0, max: 1, step: 0.01,
    description: '整段文本向量相似度的权重',
  },
  {
    key: 'recall.weights.w_lexical',
    section: 'recall_weights',
    label: '词法（FTS）权重',
    type: 'number', default: 0.03, min: 0, max: 1, step: 0.01,
    description: '全文检索分词命中的权重',
  },

  // -- Bonus parameters -----------------------------------------------------
  {
    key: 'recall.bonus.priority_base',
    section: 'recall_bonus',
    label: '优先级基数',
    type: 'number', default: 0.05, min: 0, max: 0.5, step: 0.005,
    description: '优先级 0 时的加分上限',
  },
  {
    key: 'recall.bonus.priority_step',
    section: 'recall_bonus',
    label: '优先级衰减步长',
    type: 'number', default: 0.01, min: 0, max: 0.1, step: 0.001,
    description: '优先级每 +1 扣除的加分',
  },
  {
    key: 'recall.bonus.multi_view_step',
    section: 'recall_bonus',
    label: '多视图命中步长',
    type: 'number', default: 0.015, min: 0, max: 0.1, step: 0.001,
    description: '每多一个 view 类型命中增加的加分',
  },
  {
    key: 'recall.bonus.multi_view_cap',
    section: 'recall_bonus',
    label: '多视图加分上限',
    type: 'number', default: 0.05, min: 0, max: 0.3, step: 0.005,
    description: '多视图加分的封顶',
  },

  // -- Recency bonus --------------------------------------------------------
  {
    key: 'recall.recency.enabled',
    section: 'recall_recency',
    label: '启用时间衰减',
    type: 'boolean', default: true,
    description: '开启后，最近更新的记忆获得额外加分，年久的记忆加分降低。关闭时行为与旧版完全一致。',
  },
  {
    key: 'recall.recency.half_life_days',
    section: 'recall_recency',
    label: '半衰期（天）',
    type: 'number', default: 180, min: 7, max: 3650, step: 1,
    description: '经过此天数后，时间加分衰减到最大值的一半。180天=较温和；30天=偏向近期。',
  },
  {
    key: 'recall.recency.max_bonus',
    section: 'recall_recency',
    label: '最大时间加分',
    type: 'number', default: 0.04, min: 0, max: 0.3, step: 0.005,
    description: '刚更新的记忆获得的最大加分（与 priority_base 0.05 相近量级）。',
  },
  {
    key: 'recall.recency.priority_exempt',
    section: 'recall_recency',
    label: '免衰减优先级阈值',
    type: 'integer', default: 1, min: -1, max: 10, step: 1,
    description: '优先级 <= 此值的记忆不衰减，始终获得满额加分。-1 表示所有记忆都衰减。',
  },

  // -- Display thresholds ---------------------------------------------------
  {
    key: 'recall.display.min_display_score',
    section: 'recall_display',
    label: '最低展示分数',
    type: 'number', default: 0.60, min: 0, max: 1, step: 0.01,
    description: '低于此分数的候选不会注入到 prompt（默认评分建议 0.60）',
  },
  {
    key: 'recall.display.max_display_items',
    section: 'recall_display',
    label: '最多展示条数',
    type: 'integer', default: 3, min: 1, max: 20, step: 1,
    description: '一次召回最多注入几条记忆',
  },

  // -- Recall safety limits -------------------------------------------------
  {
    key: 'recall.safety.max_query_chars',
    section: 'recall_safety',
    label: '最大召回查询字符数',
    type: 'integer', default: 200, min: 50, max: 2000, step: 10,
    description: '用户内容过长时，recall 只使用前 N 个字符参与检索，并在返回内容中提示已截取。',
  },
  {
    key: 'recall.safety.timeout_ms',
    section: 'recall_safety',
    label: '召回超时 (ms)',
    type: 'integer', default: 2000, min: 500, max: 30000, step: 100,
    description: 'recall 超过该时间后跳过并返回提示，避免长文本或慢查询阻塞主流程。',
  },

  // -- View weights / priors ------------------------------------------------
  {
    key: 'views.weight.gist',
    section: 'views',
    label: 'gist 视图权重',
    type: 'number', default: 1.0, min: 0, max: 2, step: 0.01,
    description: '在 dense/lexical 排序中的乘子',
  },
  {
    key: 'views.weight.question',
    section: 'views',
    label: 'question 视图权重',
    type: 'number', default: 0.96, min: 0, max: 2, step: 0.01,
    description: '在 dense/lexical 排序中的乘子',
  },
  {
    key: 'views.prior.gist',
    section: 'views',
    label: 'gist 视图 prior',
    type: 'number', default: 0.03, min: 0, max: 0.2, step: 0.005,
    description: '命中 gist 视图时附加的 view_bonus',
  },
  {
    key: 'views.prior.question',
    section: 'views',
    label: 'question 视图 prior',
    type: 'number', default: 0.02, min: 0, max: 0.2, step: 0.005,
    description: '命中 question 视图时附加的 view_bonus',
  },

  // -- Embedding service ----------------------------------------------------
  {
    key: 'embedding.provider',
    section: 'embedding',
    label: 'Embedding Provider',
    type: 'enum', default: 'openai_compatible',
    options: ['openai_compatible'],
    option_labels: {
      openai_compatible: 'OpenAI-compatible',
    },
    description: 'Embedding API 协议类型。当前支持 OpenAI-compatible /embeddings。',
  },
  {
    key: 'embedding.base_url',
    section: 'embedding',
    label: 'Embedding Base URL',
    type: 'string', default: '',
    description: 'Embedding 服务基础 URL（当前使用 OpenAI-compatible /embeddings；示例：http://127.0.0.1:8090/v1）',
  },
  {
    key: 'embedding.api_key',
    section: 'embedding',
    label: 'Embedding API Key',
    type: 'string', default: '', secret: true,
    description: 'Embedding 服务 API key',
  },
  {
    key: 'embedding.model',
    section: 'embedding',
    label: 'Embedding Model',
    type: 'string', default: 'text-embedding-3-small',
    description: '如 text-embedding-3-small',
  },

  // -- View LLM -------------------------------------------------------------
  {
    key: 'view_llm.provider',
    section: 'view_llm',
    label: 'View LLM Provider',
    type: 'enum', default: 'openai_compatible',
    options: ['openai_compatible', 'openai_responses', 'anthropic'],
    option_labels: {
      openai_compatible: 'OpenAI-compatible Chat',
      openai_responses: 'OpenAI Responses',
      anthropic: 'Anthropic Messages',
    },
    description: 'View/Dream 使用的 LLM API 协议类型。默认兼容现有 OpenAI-style /chat/completions。',
  },
  {
    key: 'view_llm.base_url',
    section: 'view_llm',
    label: 'View LLM Base URL',
    type: 'string', default: '',
    description: '生成视图与 Dream 的 LLM 基础 URL；示例：http://127.0.0.1:8090/v1；留空则禁用 LLM 精炼与 Dream 运行',
  },
  {
    key: 'view_llm.api_key',
    section: 'view_llm',
    label: 'View LLM API Key',
    type: 'string', default: '', secret: true,
    description: '生成视图与 Dream 的 LLM API key',
  },
  {
    key: 'view_llm.model',
    section: 'view_llm',
    label: 'View LLM Model',
    type: 'string', default: 'deepseek-v4-flash',
    description: '用于生成 gist/question 的 LLM 模型名',
  },
  {
    key: 'view_llm.temperature',
    section: 'view_llm',
    label: 'View LLM Temperature',
    type: 'number', default: 0.2, min: 0, max: 2, step: 0.05,
    description: 'LLM 生成温度（0=确定性，>1=更随机）',
  },
  {
    key: 'view_llm.max_docs_per_run',
    section: 'view_llm',
    label: 'View LLM 每次索引处理文档数',
    type: 'integer', default: 4, min: 0, max: 100, step: 1,
    description: '单次索引构建最多调用 LLM 精炼的文档数',
  },
  {
    key: 'view_llm.timeout_ms',
    section: 'view_llm',
    label: 'View LLM 超时 (ms)',
    type: 'integer', default: 1800000, min: 1000, max: 1800000, step: 1000,
    description: 'View/Dream LLM 请求超时时间',
  },
  {
    key: 'view_llm.api_version',
    section: 'view_llm',
    label: 'View LLM API Version',
    type: 'string', default: '',
    description: '可选 API 版本头；Anthropic 原生端点通常使用该字段。',
  },

  // -- Write policy ---------------------------------------------------------
  {
    key: 'policy.priority_budget_enabled',
    section: 'policy',
    label: 'Priority 容量检查',
    type: 'boolean', default: true,
    description: '创建/更新时检查 priority 0/1 的全库容量上限（0 级 ≤5, 1 级 ≤15）',
  },
  {
    key: 'policy.disclosure_warning_enabled',
    section: 'policy',
    label: 'Disclosure 质量检查',
    type: 'boolean', default: true,
    description: '创建时检查 disclosure 是否存在，以及是否包含 OR 逻辑',
  },

  // -- Dream schedule -------------------------------------------------------
  {
    key: 'dream.enabled',
    section: 'dream',
    label: '定时做梦',
    type: 'boolean', default: true,
    description: '启用后，系统每天在指定时间自动执行记忆整理（需配置 View LLM）',
  },
  {
    key: 'dream.cron',
    section: 'dream',
    label: '做梦 Cron',
    type: 'string', default: '0 3 * * *',
    description: '定时做梦的 5 段 cron 表达式（分 时 日 月 周，按时区设置）',
  },
  {
    key: 'dream.auto_approve_changes',
    section: 'dream',
    label: '自动通过 Dream 变更',
    type: 'boolean', default: false,
    description: '开启后 Dream 产生的记忆变更会自动标记为已通过；关闭时变更保留为待审核。',
  },
  {
    key: 'dream.exclude_session_patterns',
    section: 'dream',
    label: 'Dream 排除会话',
    type: 'string_list', default: [],
    description: '正则表达式列表。召回查询文本命中任一正则的会话不会进入 Dream 的召回元数据。每行一个正则，留空表示不排除。',
  },
  // -- Backup schedule ------------------------------------------------------
  {
    key: 'backup.enabled',
    section: 'backup',
    label: '定时备份',
    type: 'boolean', default: true,
    description: '启用后，系统每天在指定时间自动执行数据库备份',
  },
  {
    key: 'backup.cron',
    section: 'backup',
    label: '备份 Cron',
    type: 'string', default: '0 4 * * *',
    description: '定时备份的 5 段 cron 表达式（分 时 日 月 周；每小时可填 0 * * * *）',
  },
  {
    key: 'backup.retention_count',
    section: 'backup',
    label: '保留备份数量',
    type: 'integer', default: 7, min: 1, max: 100, step: 1,
    description: '保留最近 N 个备份，超出的自动删除',
  },
  {
    key: 'backup.local.enabled',
    section: 'backup',
    label: '本地备份',
    type: 'boolean', default: true,
    description: '将备份保存到本地文件系统',
  },
  {
    key: 'backup.webdav.enabled',
    section: 'backup',
    label: 'WebDAV 备份',
    type: 'boolean', default: false,
    description: '将备份上传到 WebDAV 服务器',
  },
  {
    key: 'backup.webdav.url',
    section: 'backup',
    label: 'WebDAV URL',
    type: 'string', default: '',
    description: 'WebDAV 服务器地址（如 https://dav.example.com/backups/）',
  },
  {
    key: 'backup.webdav.username',
    section: 'backup',
    label: 'WebDAV 用户名',
    type: 'string', default: '',
  },
  {
    key: 'backup.webdav.password',
    section: 'backup',
    label: 'WebDAV 密码',
    type: 'string', default: '', secret: true,
  },
  {
    key: 'backup.include_recall_events',
    section: 'backup',
    label: '包含召回事件',
    type: 'boolean', default: false,
    description: '备份中包含 recall_events 表（数据量可能很大）',
  },
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export const SCHEMA_BY_KEY = new Map<string, SettingDef>(
  SETTINGS_SCHEMA.map((item) => [item.key, item]),
);

// ---------------------------------------------------------------------------
// UI sections
// ---------------------------------------------------------------------------

export const SECTIONS: SettingSection[] = [
  { id: 'cache', label: '缓存', description: '控制缓存开关；Redis 后端由 REDIS_URL 自动启用' },
  { id: 'lifecycle', label: '生命周期注入', description: '配置 session.start / prompt.submit 返回给各 agent 的服务端提示内容' },
  { id: 'prompts', label: '服务端提示词', description: '配置 View、Boot 草稿、Dream 等服务端 LLM prompt 模板' },
  { id: 'recall_weights', label: '召回权重', description: '四路评分的线性权重（建议和为 1）' },
  { id: 'recall_bonus', label: '加分参数', description: '优先级和多视图命中的加分' },
  { id: 'recall_recency', label: '时间衰减', description: '让近期更新的记忆排名更高（默认关闭）' },
  { id: 'recall_display', label: '展示阈值', description: '决定哪些候选注入到 prompt' },
  { id: 'recall_safety', label: '召回保护', description: '限制超长查询和慢查询，避免 recall 阻塞主流程' },
  { id: 'views', label: '视图权重', description: 'gist/question 视图的权重与 prior' },
  { id: 'embedding', label: 'Embedding 服务', description: '向量化模型端点（示例：http://127.0.0.1:8090/v1）' },
  { id: 'view_llm', label: 'View LLM', description: '用于视图精炼的 LLM（示例：http://127.0.0.1:8090/v1；可留空禁用）' },
  { id: 'policy', label: '写入策略', description: '控制 MCP 写入前的自动检查规则' },
  { id: 'dream', label: '做梦计划', description: '自动记忆整理的执行计划（需 View LLM 配置）' },
  { id: 'backup', label: '数据备份', description: '自动备份与恢复数据库' },
  { id: 'review', label: 'Review', description: 'review changeset 本地存储位置' },
];

// ---------------------------------------------------------------------------
// English copy (UI picks label_en / description_en when the language is English)
// ---------------------------------------------------------------------------

for (const def of SETTINGS_SCHEMA) {
  const en = SETTINGS_EN[def.key];
  if (!en) continue;
  def.label_en = en.label;
  if (en.description) def.description_en = en.description;
}
for (const section of SECTIONS) {
  const en = SECTIONS_EN[section.id];
  if (!en) continue;
  section.label_en = en.label;
  if (en.description) section.description_en = en.description;
}
