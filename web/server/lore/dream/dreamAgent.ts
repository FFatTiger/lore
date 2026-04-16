import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSettings as getSettingsBatch } from '../config/settings';
import { getNodePayload, listDomains } from '../memory/browse';
import { searchMemories } from '../search/search';
import { createNode, updateNodeByPath, deleteNodeByPath, moveNode } from '../memory/write';
import { getBootNodeSpec, type BootNodeSpec } from '../memory/boot';
import { addGlossaryKeyword, removeGlossaryKeyword, manageTriggers } from '../search/glossary';
import { getRecallStats } from '../recall/recallAnalytics';
import { getNodeWriteHistory } from '../memory/writeEvents';
import { getPathEffectiveness } from '../recall/feedbackAnalytics';
import { listMemoryViewsByNode } from '../view/memoryViewQueries';
import { resolveViewLlmConfig, type ResolvedViewLlmConfig } from '../llm/config';
import { generateTextWithTools, type ProviderMessage, type ProviderToolDefinition } from '../llm/provider';

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

interface ProtectedBootOperation {
  operation: 'update_node' | 'delete_node' | 'move_node';
  match: 'uri' | 'old_uri' | 'new_uri';
  blocked_uri: string;
  requested_old_uri?: string;
  requested_new_uri?: string;
  spec: BootNodeSpec;
  reason?: string;
}

// ---------------------------------------------------------------------------
// LLM chat with tool_calls support
// ---------------------------------------------------------------------------

export const DREAM_EVENT_CONTEXT = { source: 'dream:auto' };

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

export function parseUri(uri: string): { domain: string; path: string } {
  const value = String(uri || '').trim();
  if (value.includes('://')) {
    const [d, p] = value.split('://', 2);
    return { domain: d.trim() || 'core', path: p.replace(/^\/+|\/+$/g, '') };
  }
  return { domain: 'core', path: value.replace(/^\/+|\/+$/g, '') };
}

async function inspectNeighbors(uri: string): Promise<Record<string, unknown>> {
  const { domain, path: currentPath } = parseUri(uri);
  const current = await getNodePayload({ domain, path: currentPath });
  const aliases = Array.isArray(current.node?.aliases) ? current.node.aliases : [];
  const breadcrumbs = Array.isArray(current.breadcrumbs) ? current.breadcrumbs : [];
  const children = Array.isArray(current.children) ? current.children : [];

  const segments = currentPath.split('/').filter(Boolean);
  if (segments.length === 0) {
    return { uri: `${domain}://${currentPath}`, parent: null, siblings: [], children, aliases, breadcrumbs };
  }

  const parentPath = segments.slice(0, -1).join('/');
  const parent = await getNodePayload({ domain, path: parentPath });
  const siblings = (Array.isArray(parent.children) ? parent.children : []).filter((child) => child.uri !== uri);

  return {
    uri: `${domain}://${currentPath}`,
    parent: parent.node,
    siblings,
    children,
    aliases,
    breadcrumbs,
  };
}

function describeProtectedBootOperation(op: ProtectedBootOperation): string {
  const role = op.spec.role_label;
  switch (op.operation) {
    case 'update_node':
      return `dream:auto cannot update protected boot node ${op.blocked_uri} (${role})`;
    case 'delete_node':
      return `dream:auto cannot delete protected boot node ${op.blocked_uri} (${role})`;
    case 'move_node':
      if (op.match === 'new_uri') {
        return `dream:auto cannot move a node onto protected boot path ${op.blocked_uri} (${role})`;
      }
      return `dream:auto cannot move protected boot node ${op.blocked_uri} (${role})`;
  }
}

function getProtectedBootOperation(
  name: string,
  args: Record<string, unknown>,
): ProtectedBootOperation | null {
  if (name === 'update_node' || name === 'delete_node') {
    const spec = getBootNodeSpec(args.uri);
    if (!spec) return null;
    return {
      operation: name,
      match: 'uri',
      blocked_uri: spec.uri,
      spec,
      reason: describeProtectedBootOperation({
        operation: name,
        match: 'uri',
        blocked_uri: spec.uri,
        spec,
      }),
    };
  }

  if (name === 'move_node') {
    const oldSpec = getBootNodeSpec(args.old_uri);
    if (oldSpec) {
      return {
        operation: 'move_node',
        match: 'old_uri',
        blocked_uri: oldSpec.uri,
        requested_old_uri: String(args.old_uri || ''),
        requested_new_uri: String(args.new_uri || ''),
        spec: oldSpec,
        reason: describeProtectedBootOperation({
          operation: 'move_node',
          match: 'old_uri',
          blocked_uri: oldSpec.uri,
          requested_old_uri: String(args.old_uri || ''),
          requested_new_uri: String(args.new_uri || ''),
          spec: oldSpec,
        }),
      };
    }
    const newSpec = getBootNodeSpec(args.new_uri);
    if (!newSpec) return null;
    return {
      operation: 'move_node',
      match: 'new_uri',
      blocked_uri: newSpec.uri,
      requested_old_uri: String(args.old_uri || ''),
      requested_new_uri: String(args.new_uri || ''),
      spec: newSpec,
      reason: describeProtectedBootOperation({
        operation: 'move_node',
        match: 'new_uri',
        blocked_uri: newSpec.uri,
        requested_old_uri: String(args.old_uri || ''),
        requested_new_uri: String(args.new_uri || ''),
        spec: newSpec,
      }),
    };
  }

  return null;
}

export async function executeDreamTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    const protectedBootOp = getProtectedBootOperation(name, args);
    if (protectedBootOp) {
      return {
        error: protectedBootOp.reason,
        blocked: true,
        operation: protectedBootOp.operation,
        blocked_uri: protectedBootOp.blocked_uri,
        boot_role: protectedBootOp.spec.role,
        boot_role_label: protectedBootOp.spec.role_label,
        dream_protection: protectedBootOp.spec.dream_protection,
        requested_old_uri: protectedBootOp.requested_old_uri,
        requested_new_uri: protectedBootOp.requested_new_uri,
      };
    }
    switch (name) {
      case 'get_node': { const { domain, path: p } = parseUri(args.uri as string); return await getNodePayload({ domain, path: p }); }
      case 'search': return await searchMemories({ query: args.query as string, limit: (args.limit as number) || 10,  });
      case 'list_domains': return await listDomains();
      case 'get_node_recall_detail': return await getRecallStats({ nodeUri: args.uri as string, days: (args.days as number) || 7, limit: (args.limit as number) || 10 });
      case 'get_query_recall_detail': return await getRecallStats({ queryId: args.query_id as string || '', queryText: args.query_text as string || '', days: (args.days as number) || 7, limit: (args.limit as number) || 10 });
      case 'get_node_write_history': return await getNodeWriteHistory({ nodeUri: args.uri as string, limit: (args.limit as number) || 20 });
      case 'get_path_effectiveness_detail': return await getPathEffectiveness({ days: (args.days as number) || 7 });
      case 'inspect_neighbors': return await inspectNeighbors(args.uri as string);
      case 'inspect_views': return await listMemoryViewsByNode({ uri: args.uri as string, limit: (args.limit as number) || 12 });
      case 'create_node': {
        const { domain, path: p } = args.uri ? parseUri(args.uri as string) : { domain: 'core', path: '' };
        const segments = p.split('/').filter(Boolean);
        const title = segments.pop() || '';
        const parentPath = segments.join('/');
        return await createNode({ domain, parentPath, content: args.content as string, priority: (args.priority as number) || 2, title, disclosure: (args.disclosure as string) || null }, DREAM_EVENT_CONTEXT);
      }
      case 'update_node': { const { domain, path: p } = parseUri(args.uri as string); return await updateNodeByPath({ domain, path: p, content: args.content as string | undefined, priority: args.priority as number | undefined, disclosure: args.disclosure as string | undefined }, DREAM_EVENT_CONTEXT); }
      case 'delete_node': { const { domain, path: p } = parseUri(args.uri as string); return await deleteNodeByPath({ domain, path: p }, DREAM_EVENT_CONTEXT); }
      case 'move_node': return await moveNode({ old_uri: args.old_uri as string, new_uri: args.new_uri as string }, DREAM_EVENT_CONTEXT);
      case 'add_glossary': return await addGlossaryKeyword({ keyword: args.keyword as string, node_uuid: args.node_uuid as string }, DREAM_EVENT_CONTEXT);
      case 'remove_glossary': return await removeGlossaryKeyword({ keyword: args.keyword as string, node_uuid: args.node_uuid as string }, DREAM_EVENT_CONTEXT);
      case 'manage_triggers': return await manageTriggers({ uri: args.uri as string, add: (args.add as string[]) || [], remove: (args.remove as string[]) || [] }, DREAM_EVENT_CONTEXT);
      default: return { error: `Unknown tool: ${name}` };
    }
  } catch (err: unknown) {
    return { error: (err as Error).message };
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

## 日记格式

完成操作后,用以下格式写中文日记:
- 最终写给人看的日记尽量使用自然中文。除了 URI、节点路径、工具名、必须原样保留的关键词之外,不要夹杂 query、path、view、split、move、content 这类内部英文术语
- 多写“读取节点”“检查召回表现”“查看最近修改”“移动节点”“更新正文”这类人能直接看懂的说法

### 前次回顾
（上次做梦改了什么？从数据看效果如何？有什么教训？）

### 本次目标
（这次聚焦解决什么问题？为什么选这几个？）

### 操作记录
| 节点 | 操作 | 理由 | 预期效果 |
|---|---|---|---|

### 下次重点
（还有什么没处理？下次应该关注什么？）`;

  const report = JSON.stringify({
    health_summary: (healthData.health as Record<string, unknown>)?.classification_summary,
    dead_nodes: ((healthData.deadWrites as Record<string, unknown>)?.dead_writes as Array<Record<string, unknown>> || []).slice(0, 15).map((n) => ({ uri: n.node_uri, diagnosis: n.diagnosis, score: n.avg_score_when_seen })),
    noisy_nodes: ((healthData.health as Record<string, unknown>)?.nodes as Array<Record<string, unknown>> || []).filter((n) => n.classification === 'noisy').slice(0, 10).map((n) => ({ uri: n.node_uri, recall: n.recall_count, selected: n.selected_count })),
    underperforming: ((healthData.health as Record<string, unknown>)?.nodes as Array<Record<string, unknown>> || []).filter((n) => n.classification === 'underperforming').slice(0, 10).map((n) => ({ uri: n.node_uri, selected: n.selected_count, used: n.used_in_answer_count })),
    path_recommendations: (healthData.pathEffectiveness as Record<string, unknown>)?.recommendations || [],
    orphan_count: healthData.orphanCount,
  }, null, 2);

  // Recall drilldown data: recent queries, path-level stats, noisy nodes from recall
  const recallStats = healthData.recallStats as Record<string, unknown> || {};
  const writeStats = healthData.writeStats as Record<string, unknown> || {};
  const recentQueries = (((recallStats.recent_queries as Record<string, unknown> | undefined)?.items) as Array<Record<string, unknown>>) || [];
  const drilldown = JSON.stringify({
    activity_summary: {
      recall_merged: (recallStats.summary as Record<string, unknown>)?.merged_count || 0,
      recall_queries: (recallStats.summary as Record<string, unknown>)?.query_count || 0,
      recall_shown: (recallStats.summary as Record<string, unknown>)?.shown_count || 0,
      recall_used: (recallStats.summary as Record<string, unknown>)?.used_count || 0,
      write_events: (writeStats.summary as Record<string, unknown>)?.total_events || 0,
      write_distinct_nodes: (writeStats.summary as Record<string, unknown>)?.distinct_nodes || 0,
    },
    recall_by_path: ((recallStats.by_path as Array<Record<string, unknown>>) || []).map((p) => ({
      path: p.retrieval_path, total: p.total, selected: p.selected, used: p.used_in_answer,
      avg_score: p.avg_final_rank_score,
    })),
    recall_noisy_nodes: ((recallStats.noisy_nodes as Array<Record<string, unknown>>) || []).slice(0, 10).map((n) => ({
      uri: n.node_uri, total: n.total, selected: n.selected, avg_score: n.avg_final_rank_score,
    })),
    recent_queries: recentQueries.slice(0, 10).map((q) => ({
      query: (q.query_text as string)?.slice(0, 100), merged: q.merged_count, shown: q.shown_count, used: q.used_count,
    })),
    path_effectiveness: ((healthData.pathEffectiveness as Record<string, unknown>)?.paths as Array<Record<string, unknown>> || []).map((p) => ({
      path: p.retrieval_path, appearances: p.total_appearances, selected: p.selected_count, used: p.used_count,
      selection_rate: p.selection_rate, usage_rate: p.usage_rate,
    })),
    write_hot_nodes: ((writeStats.hot_nodes as Array<Record<string, unknown>>) || []).slice(0, 10).map((n) => ({
      uri: n.node_uri, total: n.total, creates: n.creates, updates: n.updates, deletes: n.deletes,
    })),
  }, null, 2);

  // Recent diaries so the agent knows what was already done
  let diarySection = '';
  if (recentDiaries.length > 0) {
    const diaryEntries = recentDiaries.map((d) => {
      const toolSummary = (d.tool_calls || []).map((tc) => `${tc.tool}(${JSON.stringify(tc.args).slice(0, 80)})`).join(', ');
      return `### ${d.started_at} [${d.status}]\n${d.narrative || '(无日记)'}\n\n工具调用: ${toolSummary || '(无)'}`;
    }).join('\n\n---\n\n');
    diarySection = `\n\n## 最近日记（避免重复整理）\n\n${diaryEntries}`;
  }

  return `${rules}\n\n## 今日健康报告\n\n\`\`\`json\n${report}\n\`\`\`\n\n## 近期召回与写入数据（Drill Down）\n\n\`\`\`json\n${drilldown}\n\`\`\`${diarySection}`;
}

// ---------------------------------------------------------------------------
// Agent loop
// ---------------------------------------------------------------------------

export async function runDreamAgentLoop(
  llmConfig: LlmConfig,
  healthData: HealthData,
  recentDiaries: RecentDiary[] = [],
  options: DreamAgentRunOptions = {},
): Promise<DreamAgentResult> {
  const tools = buildDreamTools();
  const systemPrompt = buildDreamSystemPrompt(healthData, recentDiaries);
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: '开始做梦。阅读健康报告中的问题节点,进行整理,完成后写日记。' },
  ];
  const toolCallLog: ToolCallLogEntry[] = [];
  let turn = 0;

  for (;;) {
    turn++;
    await options.onEvent?.('llm_turn_started', { turn });
    const response = await chatWithTools(llmConfig, messages, tools) as Record<string, unknown>;

    const responseContent = typeof response.content === 'string' ? response.content : null;
    const responseTc = Array.isArray(response.tool_calls) ? response.tool_calls as ChatMessage['tool_calls'] : [];
    if (!responseTc || responseTc.length === 0) {
      const narrative = responseContent || '';
      if (narrative) {
        await options.onEvent?.('assistant_note', { turn, message: narrative.slice(0, 1000) });
      }
      return { narrative, toolCalls: toolCallLog, turns: turn };
    }

    messages.push({ role: 'assistant', content: responseContent, tool_calls: responseTc });

    for (const tc of responseTc) {
      const fnName = tc.function?.name || '';
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.function?.arguments || '{}'); } catch {}

      await options.onEvent?.('tool_call_started', { turn, tool: fnName, args });
      console.log(`[dream] tool_call: ${fnName}`, JSON.stringify(args).slice(0, 200));
      const result = await executeDreamTool(fnName, args);
      const resultObject = result && typeof result === 'object' ? result as Record<string, unknown> : null;
      const blocked = resultObject?.blocked === true;
      const ok = !resultObject || !('error' in resultObject);
      const resultStr = JSON.stringify(result).slice(0, 4000);

      toolCallLog.push({ tool: fnName, args, result_preview: resultStr.slice(0, 500) });
      if (blocked) {
        await options.onEvent?.('protected_node_blocked', {
          turn,
          tool: fnName,
          args,
          blocked_uri: resultObject?.blocked_uri,
          boot_role: resultObject?.boot_role,
          boot_role_label: resultObject?.boot_role_label,
          dream_protection: resultObject?.dream_protection,
          reason: resultObject?.error,
          requested_old_uri: resultObject?.requested_old_uri,
          requested_new_uri: resultObject?.requested_new_uri,
        });
      }
      await options.onEvent?.('tool_call_finished', {
        turn,
        tool: fnName,
        args,
        result_preview: resultStr.slice(0, 500),
        ok,
        blocked,
      });
      messages.push({ role: 'tool', tool_call_id: tc.id, content: resultStr });
    }
  }
}
