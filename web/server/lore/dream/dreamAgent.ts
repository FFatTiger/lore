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

export interface DreamBootBaselineEntry {
  uri: string;
  role_label: string;
  purpose: string;
  scope?: 'global' | 'client';
  client_type?: string | null;
  state: 'missing' | 'empty' | 'initialized';
  content: string;
}

export interface RecentDiary {
  started_at: string | null;
  status: string;
  narrative: string | null;
  tool_calls: Array<{ tool: string; args: Record<string, unknown> }>;
}

export interface DreamInitialContext {
  bootBaseline: DreamBootBaselineEntry[];
  guidance: string;
  recallReview: Record<string, unknown>;
  recallStats: Record<string, unknown>;
  writeActivity: Record<string, unknown>;
  recentDiaries: RecentDiary[];
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
    let content = fs.readFileSync(path.join(dir, '..', 'mcp-guidance.md'), 'utf-8').trim();
    content = content.replace(/lore_guidance/g, 'preloaded guidance')
      .replace(/lore_boot/g, 'preloaded boot baseline')
      .replace(/lore_get_node/g, 'get_node')
      .replace(/lore_search/g, 'search')
      .replace(/lore_create_node/g, 'create_node')
      .replace(/lore_update_node/g, 'update_node')
      .replace(/lore_delete_node/g, 'delete_node')
      .replace(/lore_move_node/g, 'move_node')
      .replace(/lore_list_domains/g, 'list_domains')
      .replace(/lore_list_session_reads/g, 'session reads')
      .replace(/lore_clear_session_reads/g, 'clear session');
    return content;
  } catch {
    return '';
  }
}

function buildReviewedQueries(recallReview: Record<string, unknown>): Array<Record<string, unknown>> {
  const reviewItems = (recallReview as any)?.reviewed_queries;
  if (!Array.isArray(reviewItems)) return [];
  return reviewItems.map((item: Record<string, unknown>) => ({
    query_id: item.query_id,
    query_text: item.query_text,
    shown: Number(item.shown_count ?? 0),
    used: Number(item.used_count ?? 0),
    flags: Array.isArray(item.flags) ? item.flags : [],
    selected_uris: Array.isArray(item.selected_uris) ? item.selected_uris : [],
    used_uris: Array.isArray(item.used_uris) ? item.used_uris : [],
    unrecalled_session_reads: Array.isArray(item.unrecalled_session_reads) ? item.unrecalled_session_reads : [],
    unshown_session_reads: Array.isArray(item.unshown_session_reads) ? item.unshown_session_reads : [],
    missed_recall_signals: Array.isArray(item.missed_recall_signals) ? item.missed_recall_signals : [],
  }));
}

function buildWriteDigest(writeActivity: Record<string, unknown>): Record<string, unknown> {
  const summary = (writeActivity.summary as Record<string, unknown>) || {};
  const hotNodes = Array.isArray(writeActivity.hot_nodes)
    ? writeActivity.hot_nodes.map((item: Record<string, unknown>) => ({
        node_uri: item.node_uri,
        total: Number(item.total ?? 0),
        creates: Number(item.creates ?? 0),
        updates: Number(item.updates ?? 0),
        deletes: Number(item.deletes ?? 0),
        last_event_at: item.last_event_at ?? null,
      }))
    : [];
  const recentEvents = Array.isArray(writeActivity.recent_events)
    ? writeActivity.recent_events.map((item: Record<string, unknown>) => ({
        event_type: item.event_type,
        node_uri: item.node_uri,
        source: item.source,
        created_at: item.created_at ?? null,
      }))
    : [];
  return {
    summary,
    hot_nodes: hotNodes,
    recent_events: recentEvents,
  };
}

export function buildDreamSystemPrompt(initialContext: DreamInitialContext): string {
  const guidanceAvailable = Boolean(initialContext.guidance.trim());
  const reviewedQueries = buildReviewedQueries(initialContext.recallReview);
  const bootBaselineLines = initialContext.bootBaseline.length > 0
    ? initialContext.bootBaseline.map((entry) => `- ${entry.uri} — ${entry.role_label}`)
    : ['- (no boot memories loaded)'];
  const hasClientBoot = initialContext.bootBaseline.some((entry) => entry.scope === 'client');

  const bootContextLine = guidanceAvailable
    ? 'Read the guidance first and apply it to every write decision and to the final diary. Use the loaded boot baseline as always-available key memories throughout the review.'
    : 'Use the loaded boot baseline as always-available key memories throughout the review.';

  const rules = `你是 Lore 记忆系统的质检员。你的工作不是写报告，是让明天的召回比今天更好。

## 你的成功标准

今天结束时，你只为一个结果负责：**至少有一类查询，在明天比今天更有可能召回正确的结果。** 如果没有发现值得改进的问题，诚实地说"没有"就是成功。不要为了交差而做无意义的修改。

## 诊断框架

你面对的不是"好不好"的问题，而是"用户问了，系统有没有帮上忙"的问题。

判断一次召回是否出了问题，按严重程度排序：

1. **应该搜到但完全没搜到** — 用户问了已知领域的问题，相关记忆存在但没进候选列表。这是最严重的。
2. **搜到了但没被采用** — 候选列表里有，但 agent 没选它。要么排名太低，要么 disclosure 触发条件不对，要么内容读起来不相关。
3. **搜到了但内容帮不上忙** — 被采用了，但内容太模糊、缺背景、或者信息过时了。问题在记忆本身。
4. **噪音** — 不相关的记忆被搜出来了，抢了位置。如果反复发生，disclosure 或 glossary 可能需要收窄。

不用给每个查询打分。找到最可疑的 2-3 个，集中精力。忽略一切看起来正常工作的。

${bootContextLine}
受保护的启动基线节点（只读参考，不可修改）：
${bootBaselineLines.join('\n')}
${hasClientBoot ? '以上包含全局启动节点和客户端专属节点。core://agent 是共享规则层，core://agent/<client_type> 是运行环境专属层。' : '以上是系统的固定规则层，不要作为日常写入目标。'}

## 决策：改什么、怎么改

发现问题后，不是每种问题都值得改。你的改进选项和判断标准：

**1. 结构 / 边界（最优先）**
何时改：一条记忆塞了多个独立概念，或者两个不同节点在说同一件事但路径完全不同。
怎么改：拆分或合并。拆分的标准是"每个节点只回答一类问题"。合并的标准是"分开放会导致一条被召回时另一条被漏掉"。

**2. disclosure / glossary**
何时改：disclosure 太宽泛导致不该触发时触发，或太窄导致该触发时不触发。glossary 缺少关键术语导致语义检索匹配不上。
怎么改：收窄或扩展触发条件。disclosure 只能说一个场景（不包含"或"）。glossary 补上用户查询中出现过的术语。

**3. priority**
何时改：当前 priority 让质量差的记忆排在质量好的前面。或者同层记忆全是同一个 priority 没有梯度。
怎么改：遵循 guidance 的 priority 规则，找参照物来定。

**4. 内容**
最后才改内容。只有当前内容缺了关键背景、信息确实过时了、或者表述方式被证明影响了检索质量时，才改。
不要润色。不要为了"写得更漂亮"而改内容。

## 什么样的情况不做

以下情况**不做**：
- "这个节点可以写得更详细" — 节点已经能回答当前查询了，不为好看而改
- "这两个节点有点相关" — 能拆开各自独立服务不同查询，就别合并
- "这里有个新话题可以新建节点" — 除非今天的查询暴露了一个明显的、反复出现的知识缺口
- 任何基于"可能是"、"也许应该"的修改 — 不确定就不做

## 日记

日记是你的决策记录，不是工作报告。用中文写。

**只记录你做过的决策和你看到的证据。** 没有结论就是没有结论，不需要凑字数。

如果你做了改进，记录：
- 改了什么、为什么改
- 证据（哪个查询暴露了问题）
- 预期效果（这次改进会让哪类查询在未来更容易命中）

如果你什么都没改，一句话就够："今日召回数据未发现值得修改的问题。"

不需要固定章节。不需要覆盖每个分类。诚实比完整重要。

如果今天确实捕获了一条值得长期记住的新认知（不是从已有记忆提炼的，而是从今天的查询里新出现的），记录下来，然后考虑是否值得写入 Lore。但不要为了"这一节不能空着"而虚构。`;

  return `${rules}

## 当前数据

下面是今天的召回数据。

### 待审查询
${JSON.stringify(reviewedQueries, null, 2)}

### 近期写入活动
${JSON.stringify(buildWriteDigest(initialContext.writeActivity), null, 2)}

### 最近日记
${JSON.stringify(initialContext.recentDiaries, null, 2)}

### 启动基线
${JSON.stringify(initialContext.bootBaseline, null, 2)}

### 记忆写入规则
${initialContext.guidance || '(guidance unavailable)'}`;
}

export async function runDreamAgentLoop(
  config: LlmConfig,
  initialContext: DreamInitialContext,
  options: DreamAgentRunOptions = {},
): Promise<DreamAgentResult> {
  const onEvent = options.onEvent;
  const eventContext = buildDreamEventContext(options.eventContext);
  const systemPrompt = buildDreamSystemPrompt(initialContext);
  const tools = buildDreamTools();
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: 'Begin the dream review. Inspect today\'s recall evidence first, gather evidence before acting, and only then decide whether any durable extraction or maintenance is justified.',
    },
  ];
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
