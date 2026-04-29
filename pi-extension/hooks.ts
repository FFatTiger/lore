import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { basename } from 'node:path';
import { fetchJson, hasRecallConfig } from './api';
import { normalizeUriList, formatRecallBlock } from './formatters';

const CLIENT_BOOT_URI = 'core://agent/pi';

// ---- Pending recall usage map (session-scoped) ----

export const pendingRecallUsage = new Map<string, { queryId: string; nodeUris: string[]; createdAt: number }>();

export function setPendingRecallUsage(sessionId: string | undefined, payload: any) {
  if (!sessionId) return;
  const now = Date.now();
  for (const [key, value] of pendingRecallUsage.entries()) {
    if (!value?.createdAt || now - value.createdAt > 30 * 60 * 1000) pendingRecallUsage.delete(key);
  }
  const queryId = String(payload?.queryId || '').trim();
  const nodeUris = normalizeUriList(payload?.nodeUris);
  if (!queryId || nodeUris.length === 0) {
    pendingRecallUsage.delete(sessionId);
    return;
  }
  pendingRecallUsage.set(sessionId, {
    queryId,
    nodeUris,
    createdAt: now,
  });
}

export function consumePendingRecallUsage(sessionId: string | undefined) {
  if (!sessionId) return null;
  const value = pendingRecallUsage.get(sessionId) || null;
  pendingRecallUsage.delete(sessionId);
  return value;
}

// ---- Message text extraction helpers ----

export function extractMessageText(message: any) {
  if (!message || typeof message !== 'object') return '';
  const content = message.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .filter((block: any) => block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
    .map((block: any) => block.text.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

// ---- Session read helpers ----

export async function fetchRecallBlock(pluginCfg: any, query: string, sessionId: string | undefined) {
  if (!hasRecallConfig(pluginCfg)) return null;
  const payload = { query, session_id: sessionId };
  const data = await fetchJson(pluginCfg, '/browse/recall', { method: 'POST', body: JSON.stringify(payload) });
  const queryId = data?.event_log?.query_id || '';
  const block = formatRecallBlock(data?.items || [], 2, sessionId, queryId);
  return block ? { block, data } : null;
}

export async function markSessionRead(pluginCfg: any, { sessionId, uri, nodeUuid, source = 'tool:get_node' }: { sessionId: string; uri: string; nodeUuid?: string; source?: string }) {
  if (!sessionId || !uri) return;
  const body: any = { session_id: sessionId, uri, source };
  if (nodeUuid) body.node_uuid = nodeUuid;
  try {
    await fetchJson(pluginCfg, '/browse/session/read', { method: 'POST', body: JSON.stringify(body) });
  } catch {
    // best effort only
  }
}

export async function clearSessionReads(pluginCfg: any, sessionId: string | undefined) {
  if (!sessionId) return;
  try {
    const qs = new URLSearchParams({ session_id: sessionId });
    await fetchJson(pluginCfg, `/browse/session/read?${qs.toString()}`, { method: 'DELETE' });
  } catch {
    // best effort only
  }
}

// ---- Project context detection ----

interface ProjectInfo {
  dirName: string;
  repoName: string | null;
}

function detectProjectInfo(): ProjectInfo {
  const dirName = basename(process.cwd());

  let repoName: string | null = null;
  try {
    const remote = execSync('git remote', { encoding: 'utf-8', timeout: 2000, stdio: ['pipe', 'pipe', 'pipe'] }).trim().split('\n')[0];
    const remoteUrl = execSync(`git remote get-url ${remote}`, {
      encoding: 'utf-8',
      timeout: 2000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const match = remoteUrl.match(/\/([^/.]+?)(?:\.git)?$/);
    if (match?.[1]) repoName = match[1];
  } catch {}

  return { dirName, repoName };
}

// ---- Boot content cache (fetched once per process) ----

let cachedBootSection: string | null = null;
const cachedStartupRecallSections = new Map<string, string>();

function formatBootSection(data: any): string {
  const core = Array.isArray(data?.core_memories) ? data.core_memories : [];
  const recent = Array.isArray(data?.recent_memories) ? data.recent_memories : [];
  if (core.length === 0 && recent.length === 0) return '';

  const lines: string[] = [
    '## lore_boot 已加载内容',
    '',
    '`lore_boot` 是 Lore 节点系统中的固定启动基线,不是独立于记忆系统的外挂配置。',
    '启动时会先确定性加载 3 个全局固定节点:',
    '- `core://agent` — workflow constraints',
    '- `core://soul` — style / persona / self-definition',
    '- `preferences://user` — stable user definition / durable user context',
    '',
    'Pi 会话还会额外加载 1 个 agent 特化节点:',
    `- \`${CLIENT_BOOT_URI}\` — pi runtime constraints`,
    '',
    '把 boot 当作本会话的稳定 startup baseline。`core://agent` 提供通用 agent 规则, `core://agent/pi` 提供 Pi 环境专属规则。`<recall>` 和 `lore_search` 提供的是按当前问题补充的候选线索,不会取代这些固定路径各自的职责。',
    '',
  ];

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

async function fetchStartupRecallSection(pluginCfg: any, sessionId: string | undefined): Promise<string> {
  const sessionKey = sessionId || '__global__';
  const cached = cachedStartupRecallSections.get(sessionKey);
  if (cached !== undefined) return cached;

  try {
    const info = detectProjectInfo();
    const recallFetch = (query: string) =>
      fetchJson(pluginCfg, '/browse/recall', {
        method: 'POST',
        body: JSON.stringify({ query, session_id: 'boot' }),
      }).catch(() => ({ items: [] }));

    const recallQueries: { source: string; query: string; promise: Promise<any> }[] = [
      { source: 'channel', query: 'pi', promise: recallFetch('pi') },
      { source: 'project-dir', query: info.dirName, promise: recallFetch(info.dirName) },
    ];
    if (info.repoName && info.repoName !== info.dirName) {
      recallQueries.push({ source: 'project-repo', query: info.repoName, promise: recallFetch(info.repoName) });
    }

    const recallResults = await Promise.all(recallQueries.map(q => q.promise));
    const blocks = recallQueries
      .map((q, i) => formatRecallBlock(recallResults[i]?.items || [], 2, sessionId, recallResults[i]?.event_log?.query_id))
      .filter(Boolean);

    const recallText = blocks.length > 0
      ? '以下记忆节点与当前环境高度相关,建议提前读取。\n\n' + blocks.join('\n\n')
      : '';

    cachedStartupRecallSections.set(sessionKey, recallText);
    return recallText;
  } catch {
    cachedStartupRecallSections.set(sessionKey, '');
    return '';
  }
}

// ---- Prompt guidance ----

export const DEFAULT_GUIDANCE = [
  'Lore is the primary long-term memory system for this Pi agent.',
  'lore_boot is a fixed startup baseline inside Lore, not a separate config layer.',
  'At startup, Lore loads core://agent, core://soul, preferences://user, and core://agent/pi for Pi-specific runtime constraints.',
  'Use recall and search to add prompt-specific memory leads, not to replace the role of those fixed paths.',
  'Use lore_get_node to open relevant recalled nodes before relying on them.',
  'Use Lore tools to create, revise, delete, or move durable memory.',
].join('\n');

export function loadPromptGuidance(): string {
  try {
    const content = readFileSync(new URL('./AGENT_RULES.md', import.meta.url), 'utf8').trim();
    return content || DEFAULT_GUIDANCE;
  } catch {
    return DEFAULT_GUIDANCE;
  }
}

// ---- Session ID helper ----

function getSessionId(ctx: any): string | undefined {
  const manager = ctx?.sessionManager;
  if (manager && typeof manager.getSessionId === 'function') return manager.getSessionId();
  return typeof manager?.sessionId === 'string' ? manager.sessionId : undefined;
}

// ---- Hook registration ----

export function registerHooks(pi: any, pluginCfg: any, guidance: string) {
  pi.on('session_start', async (_event: any, ctx: any) => {
    if (!pluginCfg.startupHealthcheck) return;
    try {
      await fetchJson(pluginCfg, '/health', { method: 'GET' });
      ctx?.ui?.notify?.(`Lore connected: ${pluginCfg.baseUrl}`, 'info');
    } catch (error: any) {
      pi.logger?.warn?.(`lore: startup health check failed (${pluginCfg.baseUrl}): ${error.message}`);
    }
  });

  pi.on('tool_call', async (event: any, ctx: any) => {
    if (event?.toolName !== 'lore_get_node') return;
    const sessionId = getSessionId(ctx);
    if (!sessionId) return;
    event.input = { ...(event.input || {}), __session_id: sessionId };
  });

  pi.on('session_shutdown', async (_event: any, ctx: any) => {
    const sessionId = getSessionId(ctx);
    pendingRecallUsage.delete(sessionId || '');
    cachedStartupRecallSections.delete(sessionId || '__global__');
    await clearSessionReads(pluginCfg, sessionId);
  });

  pi.on('before_agent_start', async (event: any, ctx: any) => {
    const sessionId = getSessionId(ctx);
    const out: any = {};

    if (pluginCfg.injectPromptGuidance) {
      if (cachedBootSection === null) {
        try {
          const bootData = await fetchJson(pluginCfg, '/browse/boot', { method: 'GET' });
          cachedBootSection = formatBootSection(bootData) || '';
        } catch (error: any) {
          pi.logger?.warn?.(`lore: boot fetch failed: ${error.message}`);
          cachedBootSection = '';
        }
      }

      out.systemPrompt = [event?.systemPrompt || '', guidance, cachedBootSection]
        .filter(Boolean)
        .join('\n\n');
    }

    if (hasRecallConfig(pluginCfg) && typeof event?.prompt === 'string' && event.prompt.trim()) {
      try {
        const recalled = await fetchRecallBlock(pluginCfg, event.prompt, sessionId);
        if (recalled?.block) {
          out.message = {
            customType: 'lore-recall',
            content: recalled.block,
            display: false,
            details: { source: 'lore', session_id: sessionId },
          };
          setPendingRecallUsage(sessionId, {
            queryId: recalled?.data?.event_log?.query_id,
            nodeUris: recalled?.data?.items,
          });
        } else {
          pendingRecallUsage.delete(sessionId);
        }
      } catch (error: any) {
        pendingRecallUsage.delete(sessionId);
        pi.logger?.warn?.(`lore: prompt recall failed: ${error.message}`);
      }
    }

    return Object.keys(out).length > 0 ? out : undefined;
  });
}
