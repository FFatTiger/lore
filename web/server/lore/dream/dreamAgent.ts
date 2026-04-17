import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContractError, getErrorStatus } from '../contracts';
import { resolveViewLlmConfig, type ResolvedViewLlmConfig } from '../llm/config';
import { generateTextWithTools, type ProviderMessage, type ProviderToolDefinition } from '../llm/provider';
import { parseUri } from '../core/utils';
import {
  buildProtectedBootBlockedResult,
  getProtectedBootOperation,
} from './dreamToolBootGuard';
import { dispatchDreamTool } from './dreamToolDispatch';
import { processDreamToolCalls } from './dreamLoopToolCalls';
import type { DreamToolEventContext } from './dreamToolPolicy';

export { parseUri };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LlmConfig = ResolvedViewLlmConfig;

export interface ToolCallLogEntry {
  tool: string;
  args: Record<string, unknown>;
  result_preview: string;
}

export interface DreamAgentResult {
  narrative: string;
  toolCalls: ToolCallLogEntry[];
  turns: number;
}

export interface DreamAgentEventCallback {
  (eventType: string, payload?: Record<string, unknown>): void | Promise<void>;
}

export interface DreamAgentRunOptions {
  onEvent?: DreamAgentEventCallback;
  eventContext?: DreamToolEventContext;
}

interface ChatMessage extends ProviderMessage {}

interface ToolDefinition extends ProviderToolDefinition {}

export interface HealthData {
  health: Record<string, unknown>;
  deadWrites: Record<string, unknown>;
  pathEffectiveness: Record<string, unknown>;
  recallStats: Record<string, unknown>;
  writeStats: Record<string, unknown>;
  orphanCount: number;
}

interface RecentDiary {
  started_at: string | null;
  status: string;
  narrative: string | null;
  tool_calls: Array<{ tool: string; args: Record<string, unknown> }>;
}

// ---------------------------------------------------------------------------
// LLM chat with tool_calls support
// ---------------------------------------------------------------------------

export const DREAM_EVENT_CONTEXT = { source: 'dream:auto' } as const satisfies DreamToolEventContext;

function buildDreamEventContext(base: DreamToolEventContext | undefined): DreamToolEventContext {
  return {
    ...DREAM_EVENT_CONTEXT,
    ...(base || {}),
    source: base?.source || DREAM_EVENT_CONTEXT.source,
  };
}

export async function loadLlmConfig(): Promise<LlmConfig | null> {
  return resolveViewLlmConfig();
}

export async function chatWithTools(
  config: LlmConfig,
  messages: ChatMessage[],
  tools: ToolDefinition[],
): Promise<Record<string, unknown>> {
  const response = await generateTextWithTools(config, messages, tools);
  return {
    content: response.content,
    tool_calls: response.tool_calls,
  };
}

// ---------------------------------------------------------------------------
// Tool definitions for the dream agent
// ---------------------------------------------------------------------------

export function buildDreamTools(): ToolDefinition[] {
  return [
    { name: 'get_node', description: 'Read a memory node by URI', parameters: { type: 'object', properties: { uri: { type: 'string', description: 'Memory URI e.g. core://soul' } }, required: ['uri'] } },
    { name: 'search', description: 'Search memories by keyword', parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer' } }, required: ['query'] } },
    { name: 'list_domains', description: 'List all memory domains', parameters: { type: 'object', properties: {} } },
    { name: 'get_node_recall_detail', description: 'Inspect recall performance for one node: which queries/path/view types recall it, how often it is selected, and whether it is actually used', parameters: { type: 'object', properties: { uri: { type: 'string' }, days: { type: 'integer' }, limit: { type: 'integer' } }, required: ['uri'] } },
    { name: 'get_query_recall_detail', description: 'Inspect one problematic query by query_id or query_text to see merged nodes, selected nodes, usage, and path/view breakdowns', parameters: { type: 'object', properties: { query_id: { type: 'string' }, query_text: { type: 'string' }, days: { type: 'integer' }, limit: { type: 'integer' } } } },
    { name: 'get_node_write_history', description: 'Read a node\'s recent write history so you can see whether it was manually edited, repeatedly changed, or recently touched by dream', parameters: { type: 'object', properties: { uri: { type: 'string' }, limit: { type: 'integer' } }, required: ['uri'] } },
    { name: 'get_path_effectiveness_detail', description: 'Inspect retrieval path effectiveness metrics before blaming a node; use this to tell node problems apart from path-weight problems', parameters: { type: 'object', properties: { days: { type: 'integer' } } } },
    { name: 'inspect_neighbors', description: 'Inspect a node\'s parent, siblings, children, aliases, and breadcrumbs to understand structural context before editing', parameters: { type: 'object', properties: { uri: { type: 'string' } }, required: ['uri'] } },
    { name: 'inspect_views', description: 'Inspect generated memory views for one node/path, including gist/question content, metadata, and freshness', parameters: { type: 'object', properties: { uri: { type: 'string' }, limit: { type: 'integer' } }, required: ['uri'] } },
    { name: 'create_node', description: 'Create a new memory node', parameters: { type: 'object', properties: { uri: { type: 'string' }, content: { type: 'string' }, priority: { type: 'integer' }, disclosure: { type: 'string' }, glossary: { type: 'array', items: { type: 'string' } } }, required: ['content', 'priority'] } },
    { name: 'update_node', description: 'Update an existing memory node', parameters: { type: 'object', properties: { uri: { type: 'string' }, content: { type: 'string' }, priority: { type: 'integer' }, disclosure: { type: 'string' } }, required: ['uri'] } },
    { name: 'delete_node', description: 'Delete a memory node', parameters: { type: 'object', properties: { uri: { type: 'string' } }, required: ['uri'] } },
    { name: 'move_node', description: 'Move/rename a memory node to a new URI', parameters: { type: 'object', properties: { old_uri: { type: 'string' }, new_uri: { type: 'string' } }, required: ['old_uri', 'new_uri'] } },
    { name: 'add_glossary', description: 'Add a glossary keyword to a node', parameters: { type: 'object', properties: { keyword: { type: 'string' }, node_uuid: { type: 'string' } }, required: ['keyword', 'node_uuid'] } },
    { name: 'remove_glossary', description: 'Remove a glossary keyword from a node', parameters: { type: 'object', properties: { keyword: { type: 'string' }, node_uuid: { type: 'string' } }, required: ['keyword', 'node_uuid'] } },
    { name: 'manage_triggers', description: 'Batch add/remove glossary keywords', parameters: { type: 'object', properties: { uri: { type: 'string' }, add: { type: 'array', items: { type: 'string' } }, remove: { type: 'array', items: { type: 'string' } } }, required: ['uri'] } },
  ];
}

export async function executeDreamTool(
  name: string,
  args: Record<string, unknown>,
  eventContext: DreamToolEventContext = DREAM_EVENT_CONTEXT,
): Promise<unknown> {
  try {
    const context = buildDreamEventContext(eventContext);
    const protectedBootOp = getProtectedBootOperation(name, args);
    if (protectedBootOp) {
      return buildProtectedBootBlockedResult(protectedBootOp);
    }
    return await dispatchDreamTool(name, args, context);
  } catch (err: unknown) {
    const status = getErrorStatus(err);
    const envelope = buildContractError(err, 'Dream tool failed');
    return {
      error: envelope.detail,
      detail: envelope.detail,
      ...(envelope.code ? { code: envelope.code } : {}),
      status,
    };
  }
}

// ---------------------------------------------------------------------------
// System prompt for dream agent
// ---------------------------------------------------------------------------

export function loadGuidanceFile(): string {
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    let content = fs.readFileSync(path.join(dir, 'mcp-guidance.md'), 'utf-8').trim();
    // Remap MCP tool names (lore_xxx) to dream agent tool names (xxx)
    content = content.replace(/lore_boot/g, '(boot — 做梦时不需要)')
      .replace(/lore_guidance/g, '(guidance — 做梦时不需要)')
      .replace(/lore_get_node/g, 'get_node')
      .replace(/lore_search/g, 'search')
      .replace(/lore_create_node/g, 'create_node')
      .replace(/lore_update_node/g, 'update_node')
      .replace(/lore_delete_node/g, 'delete_node')
      .replace(/lore_move_node/g, 'move_node')
      .replace(/lore_list_domains/g, 'list_domains')
      .replace(/lore_list_session_reads/g, '(session reads — 做梦时不需要)')
      .replace(/lore_clear_session_reads/g, '(clear session — 做梦时不需要)');
    return content;
  } catch {
    return '';
  }
}

export function buildDreamSystemPrompt(healthData: HealthData, recentDiaries: RecentDiary[] = []): string {
  const guidance = loadGuidanceFile();

  const rules = `你正在做梦——整理和维护记忆库。

## 你的身份

这些记忆是你自己写的。每一条都是你在过去的会话中认真思考后记录下来的——你的认知、你的判断、你的经历。现在你在做梦,整理自己的记忆。

boot 是 Lore 节点系统中的固定启动基线,不是外挂配置。以下 3 个固定路径承担启动契约角色,做梦时默认视为受保护节点:
- core://agent — workflow constraints
- core://soul — style / persona / self-definition
- preferences://user — stable user definition / durable user context

对待自己写的东西,你自然会认真慎重。每条记忆被创建时都有它当时的理由。

你拥有全量记忆工具,可以阅读、搜索、创建、更新、删除记忆节点。

${guidance ? `## 记忆使用规则（完整版）\n\n${guidance}` : ''}

## 诊断工具箱

优先使用只读分析工具建立证据链,再决定是否修改:
- get_node：读取节点正文、子节点、别名、视图
- get_node_recall_detail：看节点被哪些召回请求、路径、视图带出来,以及是否真的被选中或使用
- get_query_recall_detail：追查某个糟糕召回请求到底是节点问题、视图问题还是召回路径问题
- get_node_write_history：看节点最近是否被人工或 dream 反复修改,防止翻烧饼
- get_path_effectiveness_detail：判断是路径权重问题还是节点本身问题
- inspect_neighbors：看父节点、兄弟节点、子节点、aliases,判断是否该拆分、合并或迁移
- inspect_views：检查 gist/question 视图质量与新鲜度

## 工作流程（严格按顺序执行）

### Phase 1: 回顾
- 阅读"最近日记"部分,了解上次做了什么
- 评价上次的改动效果:数据有没有变好？有没有被回滚？
- 如果上次改动被回滚了,分析为什么,避免重蹈覆辙

### Phase 2: 诊断
- 从健康报告中识别 **TOP 3** 最值得处理的问题
- 不要贪多,每次做梦聚焦 3 个问题就够了
- 优先级: noisy（噪声干扰大）→ underperforming（低效但无害）→ dead（沉睡可稍后处理）
- 先判断问题属于哪一类: 结构位置 / 节点边界 / 召回路径 / 视图 / disclosure / glossary / priority / 节点内容
- 先区分召回路径问题和记忆路径问题,不要把召回路径问题误判成节点正文问题

### Phase 3: 阅读与取证
- 对每个要处理的节点,**必须先 get_node 读完正文**再决定操作
- 任何写操作前,至少补一条证据链: get_node_recall_detail / get_node_write_history / inspect_neighbors / inspect_views 里至少 1 个
- 如果怀疑是召回请求或路径的问题,先用 get_query_recall_detail 或 get_path_effectiveness_detail,不要直接怪节点
- 读的节点数量应该是改的节点数量的 **3 倍以上**——多读少改
- 理解节点的完整上下文:它为什么存在?谁在用它?它和哪些节点有关?

### Phase 4: 执行
- 操作要保守,见下方"操作约束"
- 每执行一个修改,心里要清楚:如果这个改动被回滚,会造成什么影响?
- 先修结构位置和节点边界,再收窄 disclosure / glossary,然后微调 priority,最后才改 content

### Phase 5: 写日记
- 按下方"日记格式"输出结构化日记
- 日记里明确写出每个修改对应的证据来源（例如 node recall、write history、neighbors、views）

## 操作约束

1. **范围限制**: 根据问题严重程度自行决定处理数量,但每个修改都要有充分理由
2. **防重复**: 最近 2 次日记已经改过的节点,**本次不再碰**,除非有明确的新数据证明需要再调整
3. **渐进式修改**:
   - priority 每次最多调整 **1 级**（如 2→3 可以,2→4 不行）
   - 内容重写必须保留原文核心信息,不做超过 50% 的改写
   - 优先处理路径分配、父子位置、拆分或迁移判断,其次调 disclosure / glossary,再次调 priority,**最后才考虑改内容**
4. **boot 边界**: 不要 update / delete / move core://agent、core://soul、preferences://user,也不要把其他节点移动到这些路径上
5. **防翻烧饼**: 如果你发现自己要把某个值改回之前的状态（比如 priority 从 3 改回 2）,**停下来**——这说明之前的判断或这次的判断有一个是错的,先查 get_node_write_history
6. **禁止删除或脱敏凭证信息**: token、API key、密码、密钥等是用户有意存储的跨会话信息。**绝对不要**以"安全"为由删除、替换或脱敏这些内容。这是私有部署的记忆系统,不存在泄露风险
7. **诊断优先于动手**: "被频繁召回但未使用" ≠ "该降权"。先区分原因:
   - path 分配不合理、父子位置不对、节点混了多个概念？→ 优先考虑 move / split / merge 判断
   - disclosure 太宽？→ 收窄 disclosure
   - glossary 关键词太泛？→ 精简 glossary
   - priority 太高？→ 降 1 级
   - 内容太长太杂？→ 拆分或精简
   - views 失真？→ 记录为 view 问题,谨慎改正文
   - retrieval path 命中差？→ 记录为 path 问题,不要拿节点背锅
   对症下药,不要一律降权
`;

  const recentQueries = Array.isArray((healthData.recallStats as any)?.recent_queries?.items)
    ? (healthData.recallStats as any).recent_queries.items.map((item: Record<string, unknown>) => ({
        query_text: item.query_text,
        merged: Number(item.merged_count ?? item.merged ?? 0),
        shown: Number(item.shown_count ?? item.shown ?? 0),
        used: Number(item.used_count ?? item.used ?? 0),
      }))
    : [];

  const recentDiariesSection = recentDiaries.length
    ? `\n\n## 最近日记（避免重复整理）\n${JSON.stringify(recentDiaries, null, 2)}`
    : '';

  return `${rules}\n\n## 健康报告\n${JSON.stringify({
    health_summary: healthData.health,
    dead_writes: healthData.deadWrites,
    path_effectiveness: healthData.pathEffectiveness,
    recall_stats: {
      ...(healthData.recallStats || {}),
      recent_queries: recentQueries,
    },
    write_stats: healthData.writeStats,
    orphan_count: healthData.orphanCount,
  }, null, 2)}${recentDiariesSection}\n\n## 输出要求\n- 最终写给人看的日记尽量使用自然中文。
- 不要夹杂 query、path、view、split、move、content 这类内部英文术语；如果必须表达，用自然中文解释。`;
}

export async function runDreamAgentLoop(
  config: LlmConfig,
  healthData: HealthData,
  recentDiaries: RecentDiary[] = [],
  options: DreamAgentRunOptions = {},
): Promise<DreamAgentResult> {
  const onEvent = options.onEvent;
  const eventContext = buildDreamEventContext(options.eventContext);
  const systemPrompt = buildDreamSystemPrompt(healthData, recentDiaries);
  const tools = buildDreamTools();
  const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];
  const toolCalls: ToolCallLogEntry[] = [];

  for (let turn = 0; turn < 12; turn += 1) {
    await onEvent?.('llm_turn_started', { turn: turn + 1 });
    const response = await chatWithTools(config, messages, tools);
    const content = String(response.content || '');
    const rawToolCalls = Array.isArray(response.tool_calls) ? response.tool_calls : [];

    if (rawToolCalls.length === 0) {
      if (content.trim()) {
        await onEvent?.('assistant_note', { turn: turn + 1, message: content.trim() });
      }
      return {
        narrative: content.trim(),
        toolCalls,
        turns: turn + 1,
      };
    }

    await processDreamToolCalls({
      turn: turn + 1,
      content,
      rawToolCalls,
      messages,
      toolCalls,
      onEvent,
      executeTool: (name, args) => executeDreamTool(name, args, eventContext),
    });
  }

  return {
    narrative: 'Dream agent stopped after reaching the turn limit.',
    toolCalls,
    turns: 12,
  };
}
