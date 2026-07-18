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

export function formatSearchResults(data: unknown, domain?: string | null): string {
  const payload = record(data);
  const results = Array.isArray(data) ? data.map(record) : array(payload.results).map(record);
  if (results.length === 0) {
    return `No matching memories found${domain ? ` in domain ${domain}` : ''}.`;
  }

  return results.map((item, index) => {
    const score = finiteNumber(item.score_display) ?? finiteNumber(item.score);
    const metadata = [`priority: ${item.priority ?? ''}`];
    if (score !== null) metadata.push(`score: ${score}`);
    const lines = [`${index + 1}. ${text(item.uri)} (${metadata.join(', ')})`];
    const cues = array(item.cues).map(text).filter(Boolean);
    if (cues.length > 0) lines.push(`   via: ${cues.join(', ')}`);
    if (text(item.content)) lines.push('   ---', text(item.content));
    else if (text(item.snippet)) lines.push(`   ${text(item.snippet)}`);
    return lines.join('\n');
  }).join('\n\n');
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
