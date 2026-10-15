interface MemoryNode {
  uri?: unknown;
  node_uuid?: unknown;
  priority?: unknown;
  disclosure?: unknown;
  aliases?: unknown;
  content?: unknown;
  glossary_keywords?: unknown;
}

interface ChildNode {
  uri?: unknown;
  priority?: unknown;
  content_snippet?: unknown;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function formatNode(data: unknown): string {
  const payload = record(data);
  const node = record(payload.node) as MemoryNode;
  const children = array(payload.children).map(record) as ChildNode[];
  const aliases = array(node.aliases).map(text).filter(Boolean);
  const keywords = array(node.glossary_keywords).map(text).filter(Boolean);
  const lines = [`URI: ${text(node.uri)}`];

  if (text(node.node_uuid)) lines.push(`Node UUID: ${text(node.node_uuid)}`);
  lines.push(`Priority: ${node.priority ?? ''}`);
  if (text(node.disclosure)) lines.push(`Disclosure: ${text(node.disclosure)}`);
  if (aliases.length > 0) lines.push(`Aliases: ${aliases.join(', ')}`);
  lines.push('', text(node.content) || '(empty)');

  if (children.length > 0) {
    lines.push('', 'Children:');
    for (const child of children) {
      lines.push(`- ${text(child.uri)} (priority: ${child.priority ?? ''})`);
      if (text(child.content_snippet)) lines.push(`  ${text(child.content_snippet)}`);
    }
  }
  if (keywords.length > 0) lines.push('', `Glossary keywords: ${keywords.join(', ')}`);
  return lines.join('\n');
}

export function formatBootView(data: unknown): string {
  const payload = record(data);
  const coreMemories = array(payload.core_memories).map(record);
  const recentMemories = array(payload.recent_memories).map(record);
  const failed = array(payload.failed).map(text).filter(Boolean);
  const loaded = finiteNumber(payload.loaded) ?? coreMemories.length;
  const total = finiteNumber(payload.total) ?? coreMemories.length;
  const clientMemories = coreMemories.filter((memory) => memory.scope === 'client');
  const lines = ['# Core Memories', `# Loaded: ${loaded}/${total} memories`, ''];

  if (failed.length > 0) lines.push('## Failed to load:', ...failed, '');

  if (coreMemories.length === 0) {
    lines.push('(No core memories loaded.)');
  } else {
    lines.push(
      '## Fixed boot baseline:',
      '',
      'Lore boot deterministically loads three global startup nodes inside Lore:',
      '- core://agent — workflow constraints',
      '- core://soul — style / persona / self-definition',
      '- preferences://user — stable user definition / durable user context',
      '',
    );
    if (clientMemories.length > 0) {
      lines.push(clientMemories.length === 1
        ? 'This boot view also includes the active client-specific agent node:'
        : 'This boot view also includes the client-specific agent nodes:');
      for (const memory of clientMemories) {
        lines.push(`- ${text(memory.uri)} — ${text(memory.boot_role_label) || 'client-specific agent constraints'}`);
      }
      lines.push('');
    }
    for (const memory of coreMemories) {
      lines.push(`### ${text(memory.uri)}`);
      if (text(memory.boot_role_label)) lines.push(`Role: ${text(memory.boot_role_label)}`);
      if (text(memory.boot_purpose)) lines.push(`Purpose: ${text(memory.boot_purpose)}`);
      if (finiteNumber(memory.priority) !== null) lines.push(`Priority: ${memory.priority}`);
      if (text(memory.disclosure)) lines.push(`Disclosure: ${text(memory.disclosure)}`);
      if (text(memory.node_uuid)) lines.push(`Node UUID: ${text(memory.node_uuid)}`);
      lines.push('', text(memory.content) || '(empty)', '');
    }
  }

  if (recentMemories.length > 0) {
    lines.push(
      '---',
      '',
      '# Recent Memories',
      'These are context hints. Some legacy URIs may carry date-shaped segments; read those dates as event time or archive context while ordinary memory identity stays with durable concepts.',
    );
    for (const memory of recentMemories) {
      const metadata: string[] = [];
      if (finiteNumber(memory.priority) !== null) metadata.push(`priority: ${memory.priority}`);
      if (text(memory.created_at)) metadata.push(`created: ${text(memory.created_at)}`);
      lines.push(`- ${text(memory.uri)}${metadata.length > 0 ? ` (${metadata.join(', ')})` : ''}`);
      if (text(memory.disclosure)) lines.push(`  Disclosure: ${text(memory.disclosure)}`);
    }
  }

  return lines.join('\n').trim();
}

const SEARCH_SNIPPET_MAX_CHARS = 300;
const SEARCH_DISCLOSURE_MAX_CHARS = 160;
const SEARCH_CLOSING_CUE = 'Open a node with lore_get_node for full content.';

function collapseWhitespace(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function truncateText(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function searchResultScore(item: Record<string, unknown>): string {
  const score = finiteNumber(item.score_display) ?? finiteNumber(item.score);
  return score === null ? '' : score.toFixed(2);
}

function searchResultDate(item: Record<string, unknown>): string {
  const raw = text(item.updated_at).trim();
  return raw ? raw.slice(0, 10) : '';
}

function searchResultPassage(item: Record<string, unknown>): string {
  const snippet = collapseWhitespace(item.snippet);
  if (snippet) return truncateText(snippet, SEARCH_SNIPPET_MAX_CHARS);
  return truncateText(collapseWhitespace(item.content), SEARCH_SNIPPET_MAX_CHARS);
}

export function formatSearchResults(data: unknown, domain?: string | null, full = false): string {
  const payload = record(data);
  const results = (Array.isArray(data) ? data : array(payload.results)) as unknown[];
  if (results.length === 0) {
    return `No matching memories found${domain ? ` in domain ${domain}` : ''}.`;
  }

  const items = results.map(record);
  const lines: string[] = [];
  items.forEach((item, index) => {
    const meta: string[] = [];
    const score = searchResultScore(item);
    if (score) meta.push(score);
    const date = searchResultDate(item);
    if (date) meta.push(date);
    const metaText = meta.length > 0 ? `  (${meta.join(' · ')})` : '';
    lines.push(`${index + 1}. ${text(item.uri)}${metaText}`);
    const disclosure = collapseWhitespace(item.disclosure);
    if (disclosure) lines.push(`   when: ${truncateText(disclosure, SEARCH_DISCLOSURE_MAX_CHARS)}`);
    const passage = searchResultPassage(item);
    if (passage) lines.push(`   > ${passage}`);
  });
  const first = items[0];
  if (full && typeof first.content === 'string' && first.content.trim()) {
    lines.push('', '---', '', first.content);
  }
  lines.push('', SEARCH_CLOSING_CUE);
  return lines.join('\n');
}

export function normalizeKeywordList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const keyword = String(value ?? '').trim();
    const normalized = keyword.toLowerCase();
    if (!keyword || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(keyword);
  }
  return output;
}
