import type { ClientType } from '../../auth';

const DEFAULT_RECALL_SCORE_PRECISION = 2;

export interface LifecycleProject {
  dirName: string;
  repoName: string | null;
}

export interface LifecycleBootMemory {
  uri?: string;
  content?: string;
  priority?: number;
  disclosure?: string | null;
  node_uuid?: string;
  created_at?: string | null;
  boot_role_label?: string;
  boot_purpose?: string;
  scope?: string;
  client_type?: string | null;
}

export interface LifecycleBootResponse {
  core_memories?: LifecycleBootMemory[];
  recent_memories?: LifecycleBootMemory[];
}

const CLIENT_LABELS: Partial<Record<ClientType, string>> = {
  claudecode: 'Claude Code',
  codex: 'Codex',
  openclaw: 'OpenClaw',
  hermes: 'Hermes',
  pi: 'Pi',
  opencode: 'OpenCode',
  zcode: 'ZCode',
  mcp: 'MCP',
  admin: 'Admin',
};

const CLIENT_BOOT_LABELS: Partial<Record<ClientType, string>> = {
  claudecode: 'claude code runtime constraints',
  codex: 'codex runtime constraints',
  openclaw: 'openclaw runtime constraints',
  hermes: 'hermes runtime constraints',
  pi: 'pi runtime constraints',
  opencode: 'opencode runtime constraints',
  zcode: 'zcode runtime constraints',
  mcp: 'mcp runtime constraints',
  admin: 'admin runtime constraints',
};

function cleanText(value: unknown): string {
  return String(value || '').trim();
}

export function normalizeLifecycleProject(project: unknown): LifecycleProject {
  const value = project && typeof project === 'object' ? project as Record<string, unknown> : {};
  const dirName = cleanText(value.dir_name ?? value.dirName);
  const repoName = cleanText(value.repo_name ?? value.repoName);
  return { dirName, repoName: repoName || null };
}

export function buildStartupQueries(channel: string, project: LifecycleProject): string[] {
  const seen = new Set<string>();
  const queries: string[] = [];
  for (const value of [channel, project.dirName, project.repoName]) {
    const text = cleanText(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    queries.push(text);
  }
  return queries;
}

function readCueList(item: any): string[] {
  const cues = Array.isArray(item?.cues) ? item.cues : [];
  return cues.map((x: any) => String(x || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 3);
}

export function formatLifecycleRecallBlock(
  items: unknown,
  sessionId?: string,
  queryId?: string,
  phase?: 'startup' | 'prompt',
): string {
  if (!Array.isArray(items) || items.length === 0) return '';
  const attrs = [
    sessionId && `session_id="${sessionId}"`,
    queryId && `query_id="${queryId}"`,
    phase && `phase="${phase}"`,
  ].filter(Boolean).join(' ');
  const lines = [attrs ? `<recall ${attrs}>` : '<recall>'];
  for (const item of items) {
    const score = Number.isFinite(item?.score_display) ? Number(item.score_display).toFixed(DEFAULT_RECALL_SCORE_PRECISION) : String(item?.score ?? '');
    const cues = readCueList(item);
    const cueText = cues.join(' · ').trim();
    lines.push(`${score} | ${item?.uri || ''}${cueText ? ` | ${cueText}` : ''}`);
  }
  lines.push('</recall>');
  return lines.join('\n');
}

export function extractNodeUris(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const uri = cleanText(item?.uri);
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    out.push(uri);
  }
  return out;
}

export function formatLifecycleBootSection(
  data: LifecycleBootResponse | undefined,
  clientType: ClientType | null,
  preamble?: string,
): string {
  const core = Array.isArray(data?.core_memories) ? data.core_memories : [];
  const recent = Array.isArray(data?.recent_memories) ? data.recent_memories : [];
  if (core.length === 0 && recent.length === 0) return '';

  const label = clientType ? CLIENT_LABELS[clientType] || clientType : 'Agent';
  const clientBoot = core.find((mem) => mem?.scope === 'client' || (clientType && mem?.client_type === clientType));
  const clientBootUri = clientBoot?.uri || (clientType ? `core://agent/${clientType}` : '');
  const clientBootLabel = clientBoot?.boot_role_label || (clientType ? CLIENT_BOOT_LABELS[clientType] || `${clientType} runtime constraints` : 'client runtime constraints');

  const resolvedPreamble = cleanText(preamble);
  const lines: string[] = resolvedPreamble ? [resolvedPreamble, ''] : [];

  if (clientBootUri) {
    lines.push(`${label} 会话还会额外加载 1 个 agent 特化节点:`);
    lines.push(`- \`${clientBootUri}\` — ${clientBootLabel}`);
    lines.push('');
  }

  if (clientType) {
    lines.push(`把 boot 当作本会话的稳定 startup baseline。\`core://agent\` 提供通用 agent 规则, \`core://agent/${clientType}\` 提供 ${label} 环境专属规则。\`<recall>\` 和 \`lore_search\` 提供的是按当前问题补充的候选线索,不会取代这些固定路径各自的职责。`);
  } else {
    lines.push('把 boot 当作本会话的稳定 startup baseline。`core://agent` 提供通用 agent 规则。`<recall>` 和 `lore_search` 提供的是按当前问题补充的候选线索,不会取代这些固定路径各自的职责。');
  }
  lines.push('');

  for (const mem of core) {
    lines.push(`### ${mem?.uri || ''}`);
    if (mem?.boot_role_label) lines.push(`Role: ${mem.boot_role_label}`);
    if (mem?.boot_purpose) lines.push(`Purpose: ${mem.boot_purpose}`);
    if (Number.isFinite(mem?.priority)) lines.push(`Priority: ${mem.priority}`);
    if (mem?.disclosure) lines.push(`Disclosure: ${mem.disclosure}`);
    if (mem?.node_uuid) lines.push(`Node UUID: ${mem.node_uuid}`);
    lines.push('');
    lines.push(mem?.content || '(empty)');
    lines.push('');
  }

  if (recent.length > 0) {
    lines.push('### 近期记忆');
    for (const mem of recent) {
      const parts: string[] = [];
      if (Number.isFinite(mem?.priority)) parts.push(`priority: ${mem.priority}`);
      if (mem?.created_at) parts.push(`created: ${mem.created_at}`);
      const suffix = parts.length > 0 ? ` (${parts.join(', ')})` : '';
      lines.push(`- ${mem?.uri || ''}${suffix}`);
      if (mem?.disclosure) lines.push(`  Disclosure: ${mem.disclosure}`);
    }
  }

  return lines.join('\n').trim();
}

export function joinLifecycleContext(parts: Array<string | null | undefined>): string {
  return parts.map((part) => cleanText(part)).filter(Boolean).join('\n\n');
}
