/**
 * Pure helper functions for the embedded MCP server.
 *
 * Formatting, normalisation, and response wrappers used by mcpServer.ts.
 * Kept separate so they can be unit-tested without instantiating the full
 * McpServer / importing heavy dependencies.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { addGlossaryKeyword, removeGlossaryKeyword } from './lore/search/glossary';

// ── types ─────────────────────────────────────────────────────────

export interface McpTextContent {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface ResolvedUri {
  domain: string;
  path: string;
}

export interface BootMemory {
  uri?: string;
  priority?: number;
  disclosure?: string | null;
  node_uuid?: string;
  content?: string;
  created_at?: string | null;
}

export interface BootViewData {
  core_memories?: BootMemory[];
  recent_memories?: BootMemory[];
  failed?: string[];
  loaded?: number;
  total?: number;
}

export interface NodeChild {
  uri: string;
  priority?: number;
  content_snippet?: string;
}

export interface NodeData {
  node?: {
    uri?: string | null;
    node_uuid?: string | null;
    priority?: number | null;
    disclosure?: string | null;
    aliases?: string[] | null;
    content?: string | null;
    glossary_keywords?: string[] | null;
  };
  children?: NodeChild[];
}

export interface EventContext {
  source: string;
}

// ── response wrappers ─────────────────────────────────────────────

export function ok(text: string): McpTextContent {
  return { content: [{ type: 'text', text }] };
}

export function fail(prefix: string, error: unknown): McpTextContent {
  const msg = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text', text: `${prefix}: ${msg}` }], isError: true };
}

// ── string helpers ────────────────────────────────────────────────

export function formatPolicyResult(baseText: string, warnings?: string[]): string {
  if (!warnings || warnings.length === 0) return baseText;
  return `${baseText}\n\nPolicy warnings:\n${warnings.map((w) => `  \u26a0 ${w}`).join('\n')}`;
}

export function trimSlashes(value: unknown): string {
  return String(value || '').trim().replace(/^\/+|\/+$/g, '');
}

export function normalizeKeywordList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
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

export function resolveUri(args: Record<string, unknown> | undefined, defaultDomain = 'core'): ResolvedUri {
  const raw = String(args?.uri || '').trim();
  if (!raw) return { domain: defaultDomain, path: '' };
  if (raw.includes('://')) {
    const [domainPart, pathPart] = raw.split('://', 2);
    return { domain: domainPart.trim() || defaultDomain, path: trimSlashes(pathPart) };
  }
  return { domain: defaultDomain, path: trimSlashes(raw) };
}

// ── formatters ────────────────────────────────────────────────────

export function formatNode(data: NodeData | undefined): string {
  const node = data?.node || {};
  const children: NodeChild[] = Array.isArray(data?.children) ? data.children : [];
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

export function formatBootView(data: BootViewData | undefined): string {
  const coreMemories: BootMemory[] = Array.isArray(data?.core_memories) ? data!.core_memories : [];
  const recentMemories: BootMemory[] = Array.isArray(data?.recent_memories) ? data!.recent_memories : [];
  const failed: string[] = Array.isArray(data?.failed) ? data!.failed : [];
  const loaded = Number.isFinite(data?.loaded) ? data!.loaded! : coreMemories.length;
  const total = Number.isFinite(data?.total) ? data!.total! : coreMemories.length;
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
    lines.push('## Contents:');
    lines.push('');
    for (const memory of coreMemories) {
      lines.push(`### ${memory?.uri || ''}`);
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

// ── glossary batch helper ─────────────────────────────────────────

export async function applyGlossaryMutations(
  nodeUuid: string,
  mutations: { add?: string[]; remove?: string[] } = {},
  eventContext: EventContext = { source: 'mcp' },
): Promise<{ added: string[]; removed: string[] }> {
  const added: string[] = [];
  const removed: string[] = [];
  for (const keyword of normalizeKeywordList(mutations.add)) {
    await addGlossaryKeyword({ keyword, node_uuid: nodeUuid }, eventContext);
    added.push(keyword);
  }
  for (const keyword of normalizeKeywordList(mutations.remove)) {
    await removeGlossaryKeyword({ keyword, node_uuid: nodeUuid }, eventContext);
    removed.push(keyword);
  }
  return { added, removed };
}

// ── guidance loader ───────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadGuidance(): string {
  try {
    return fs.readFileSync(path.join(__dirname, 'lore', 'mcp-guidance.md'), 'utf-8');
  } catch {
    return '';
  }
}

export function loadGuidanceReference(): string {
  try {
    return fs.readFileSync(path.join(__dirname, 'lore', 'guidance-reference.md'), 'utf-8');
  } catch {
    return '';
  }
}
