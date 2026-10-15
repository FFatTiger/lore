const DEFAULT_RECALL_SCORE_PRECISION = 2;

export function formatNode(data: any) {
  const node = data?.node || {};
  const children = Array.isArray(data?.children) ? data.children : [];
  const lines: string[] = [];
  lines.push(`URI: ${node.uri || ''}`);
  if (node.node_uuid) lines.push(`Node UUID: ${node.node_uuid}`);
  lines.push(`Priority: ${node.priority ?? ''}`);
  if (node.disclosure) lines.push(`Disclosure: ${node.disclosure}`);
  if (Array.isArray(node.aliases) && node.aliases.length > 0) {
    lines.push(`Aliases: ${node.aliases.join(', ')}`);
  }
  lines.push('');
  lines.push(node.content || '(empty)');
  if (children.length > 0) {
    lines.push('');
    lines.push('Children:');
    for (const child of children) {
      lines.push(`- ${child.uri} (priority: ${child.priority ?? ''})`);
      if (child.content_snippet) lines.push(`  ${child.content_snippet}`);
    }
  }
  if (Array.isArray(node.glossary_keywords) && node.glossary_keywords.length > 0) {
    lines.push('');
    lines.push(`Glossary keywords: ${node.glossary_keywords.join(', ')}`);
  }
  return lines.join('\n');
}

export function formatBootView(data: any) {
  const coreMemories = Array.isArray(data?.core_memories) ? data.core_memories : [];
  const recentMemories = Array.isArray(data?.recent_memories) ? data.recent_memories : [];
  const failed = Array.isArray(data?.failed) ? data.failed : [];
  const loaded = Number.isFinite(data?.loaded) ? data.loaded : coreMemories.length;
  const total = Number.isFinite(data?.total) ? data.total : coreMemories.length;
  const clientBootMemories = coreMemories.filter((memory: any) => memory?.scope === 'client');
  const lines: string[] = [];

  lines.push('# Core Memories');
  lines.push(`# Loaded: ${loaded}/${total} memories`);
  lines.push('');

  if (failed.length > 0) {
    lines.push('## Failed to load:');
    lines.push(...failed);
    lines.push('');
  }

  if (coreMemories.length > 0) {
    lines.push('## Fixed boot baseline:');
    lines.push('');
    lines.push('Lore boot deterministically loads three global startup nodes inside Lore:');
    lines.push('- core://agent — workflow constraints');
    lines.push('- core://soul — style / persona / self-definition');
    lines.push('- preferences://user — stable user definition / durable user context');
    lines.push('');
    if (clientBootMemories.length > 0) {
      lines.push(clientBootMemories.length === 1
        ? 'This boot view also includes the active client-specific agent node:'
        : 'This boot view also includes the client-specific agent nodes:');
      for (const memory of clientBootMemories) {
        lines.push(`- ${memory?.uri || ''} — ${memory?.boot_role_label || 'client-specific agent constraints'}`);
      }
      lines.push('');
    }
    for (const memory of coreMemories) {
      lines.push(`### ${memory?.uri || ''}`);
      if (memory?.boot_role_label) lines.push(`Role: ${memory.boot_role_label}`);
      if (memory?.boot_purpose) lines.push(`Purpose: ${memory.boot_purpose}`);
      if (Number.isFinite(memory?.priority)) lines.push(`Priority: ${memory.priority}`);
      if (memory?.disclosure) lines.push(`Disclosure: ${memory.disclosure}`);
      if (memory?.node_uuid) lines.push(`Node UUID: ${memory.node_uuid}`);
      lines.push('');
      lines.push(memory?.content || '(empty)');
      lines.push('');
    }
  } else {
    lines.push('(No core memories loaded.)');
  }

  if (recentMemories.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('# Recent Memories');
    lines.push('These are context hints. Some legacy URIs may carry date-shaped segments; read those dates as event time or archive context while ordinary memory identity stays with durable concepts.');
    for (const memory of recentMemories) {
      const meta: string[] = [];
      if (Number.isFinite(memory?.priority)) meta.push(`priority: ${memory.priority}`);
      if (memory?.created_at) meta.push(`created: ${memory.created_at}`);
      const suffix = meta.length > 0 ? ` (${meta.join(', ')})` : '';
      lines.push(`- ${memory?.uri || ''}${suffix}`);
      if (memory?.disclosure) lines.push(`  Disclosure: ${memory.disclosure}`);
    }
  }

  return lines.join('\n').trim();
}

export function readCueList(item: any) {
  const cues = Array.isArray(item?.cues) ? item.cues : [];
  const cleaned = cues.map((x: any) => String(x || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  return cleaned.slice(0, 3);
}

export function formatRecallBlock(items: any, precision = DEFAULT_RECALL_SCORE_PRECISION, sessionId?: string, queryId?: string) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const attrs = [sessionId && `session_id="${sessionId}"`, queryId && `query_id="${queryId}"`].filter(Boolean).join(' ');
  const lines = [attrs ? `<recall ${attrs}>` : '<recall>'];
  for (const item of items) {
    const score = Number.isFinite(item?.score_display) ? Number(item.score_display).toFixed(precision) : String(item?.score ?? '');
    const cues = readCueList(item);
    const cueText = cues.join(' · ').trim();
    lines.push(`${score} | ${item?.uri || ''}${cueText ? ` | ${cueText}` : ''}`);
  }
  lines.push('</recall>');
  return lines.join('\n');
}

export function normalizeSearchResults(data: any) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

const SEARCH_SNIPPET_MAX_CHARS = 300;
const SEARCH_DISCLOSURE_MAX_CHARS = 160;
const SEARCH_CLOSING_CUE = 'Open a node with lore_get_node for full content.';

export function collapseWhitespace(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncateText(value: string, max: number) {
  return value.length > max ? value.slice(0, max) : value;
}

function searchResultScore(item: any) {
  const score = Number.isFinite(item?.score_display) ? item.score_display : (Number.isFinite(item?.score) ? item.score : null);
  return score === null ? '' : Number(score).toFixed(2);
}

function searchResultDate(item: any) {
  const raw = typeof item?.updated_at === 'string' ? item.updated_at.trim() : '';
  return raw ? raw.slice(0, 10) : '';
}

function searchResultPassage(item: any) {
  const snippet = collapseWhitespace(item?.snippet);
  if (snippet) return truncateText(snippet, SEARCH_SNIPPET_MAX_CHARS);
  return truncateText(collapseWhitespace(item?.content), SEARCH_SNIPPET_MAX_CHARS);
}

export function formatSearchResults(results: any, opts: { full?: boolean } = {}) {
  const items = Array.isArray(results) ? results : [];
  if (items.length === 0) return '';
  const lines: string[] = [];
  items.forEach((item: any, idx: number) => {
    const meta: string[] = [];
    const score = searchResultScore(item);
    if (score) meta.push(score);
    const date = searchResultDate(item);
    if (date) meta.push(date);
    const metaText = meta.length > 0 ? `  (${meta.join(' · ')})` : '';
    lines.push(`${idx + 1}. ${item?.uri || ''}${metaText}`);
    const disclosure = collapseWhitespace(item?.disclosure);
    if (disclosure) lines.push(`   when: ${truncateText(disclosure, SEARCH_DISCLOSURE_MAX_CHARS)}`);
    const passage = searchResultPassage(item);
    if (passage) lines.push(`   > ${passage}`);
  });
  const first = items[0] || {};
  if (opts.full && typeof first?.content === 'string' && first.content.trim()) {
    lines.push('', '---', '', first.content);
  }
  lines.push('', SEARCH_CLOSING_CUE);
  return lines.join('\n');
}

export const SEARCH_RESULT_LIMIT_MAX = 20;
export const SEARCH_RESULT_LIMIT_DEFAULT = 5;

export function resolveSearchLimit(value: unknown) {
  return Number.isFinite(value as number) ? Math.max(1, Math.min(SEARCH_RESULT_LIMIT_MAX, Number(value))) : SEARCH_RESULT_LIMIT_DEFAULT;
}

export function normalizeKeywordList(values: any) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const out: string[] = [];
  for (const value of values) {
    const keyword = String(value || '').trim();
    if (!keyword) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(keyword);
  }
  return out;
}

export function normalizeUriList(items: any) {
  if (!Array.isArray(items)) return [];
  return [...new Set(items.map((item: any) => String(item?.uri || item || '').trim()).filter(Boolean))];
}
