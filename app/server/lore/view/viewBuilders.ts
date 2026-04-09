import crypto from 'crypto';
import { sql } from '../../db';
import { dedupeTerms, truncate } from '../core/utils';
import { getSettings as getSettingsBatch } from '../config/settings';

// ---------------------------------------------------------------------------
// FTS configuration detection
// ---------------------------------------------------------------------------

let _ftsConfig: string | null = null;
let _ftsQueryConfig: string | null = null;

export async function getFtsConfig(): Promise<string> {
  if (_ftsConfig !== null) return _ftsConfig;
  // Try pg_jieba first (better Chinese dictionary, active jieba project)
  try {
    await sql(`SELECT to_tsvector('jiebacfg', '测试')`);
    _ftsConfig = 'jiebacfg';
    _ftsQueryConfig = 'jiebaqry';
    return _ftsConfig;
  } catch {}
  // Fall back to zhparser (older SCWS dictionary)
  try {
    await sql(`SELECT to_tsvector('zhparser', '测试')`);
    _ftsConfig = 'zhparser';
    _ftsQueryConfig = 'zhparser';
    return _ftsConfig;
  } catch {}
  // Final fallback: simple (no Chinese tokenization)
  _ftsConfig = 'simple';
  _ftsQueryConfig = 'simple';
  return _ftsConfig;
}

export async function getFtsQueryConfig(): Promise<string> {
  if (_ftsQueryConfig === null) await getFtsConfig();
  return _ftsQueryConfig!;
}

/**
 * Count jieba-tokenized tokens for a query string, as the ts_query sees them.
 * Used by scoring strategies that need to damp ts_rank_cd by query length.
 * Returns 1 as floor (never 0).
 */
export async function countQueryTokens(query: unknown): Promise<number> {
  const cleanedQuery = String(query || '').trim();
  if (!cleanedQuery) return 1;
  const ftsQuery = await getFtsQueryConfig();
  try {
    const result = await sql(
      `SELECT GREATEST(1, COALESCE(array_length(string_to_array(plainto_tsquery('${ftsQuery}', $1)::text, ' & '), 1), 0)) AS tokens`,
      [cleanedQuery],
    );
    return Number(result.rows[0]?.tokens || 1);
  } catch {
    // Fallback: rough char-based estimate (CJK ~1 token per 3 chars, ASCII ~1 per word)
    return Math.max(1, Math.round(cleanedQuery.length / 3));
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const VIEW_GENERATOR_VERSION = 'phase1-v2-llm';
export const GENERATED_SOURCE = 'generated';

// ---------------------------------------------------------------------------
// Hash / Weight / Prior helpers
// ---------------------------------------------------------------------------

export function hashPayload(payload: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export async function loadViewWeights(): Promise<{ gist: unknown; question: unknown }> {
  const s = await getSettingsBatch(['views.weight.gist', 'views.weight.question']);
  return { gist: s['views.weight.gist'], question: s['views.weight.question'] };
}

export async function loadViewPriors(): Promise<{ gist: unknown; question: unknown }> {
  const s = await getSettingsBatch(['views.prior.gist', 'views.prior.question']);
  return { gist: s['views.prior.gist'], question: s['views.prior.question'] };
}

// Default weights/priors used as fallbacks when settings haven't been loaded
// and as fixtures for tests. Production code should call loadViewWeights /
// loadViewPriors (or read via settings) to honor runtime overrides.
export function viewWeight(viewType: string): number {
  if (viewType === 'gist') return 1.0;
  if (viewType === 'question') return 0.96;
  return 1.0;
}

export function viewPrior(viewType: string): number {
  if (viewType === 'gist') return 0.03;
  if (viewType === 'question') return 0.02;
  return 0;
}

// ---------------------------------------------------------------------------
// Document builder helpers
// ---------------------------------------------------------------------------

export function normalizeList(values: unknown[], maxItems = 8): string[] {
  return dedupeTerms(Array.isArray(values) ? values.map((item) => truncate(item, 140)) : [], maxItems);
}

export function buildGlossaryTerms(doc: { glossary_keywords?: unknown[] }): string[] {
  return dedupeTerms(Array.isArray(doc.glossary_keywords) ? doc.glossary_keywords : [], 8);
}

export function buildQuestionLines(doc: { path?: string; uri?: string; disclosure?: string; glossary_terms?: string[] }): string[] {
  const topic = doc.path || doc.uri;
  const lines: string[] = [
    `关于 ${topic}，我应该想起什么？`,
    doc.disclosure ? `在"${doc.disclosure}"这个场景下，应该召回哪条记忆？` : `当话题涉及 ${doc.uri} 时，应该召回哪条记忆？`,
  ];
  if (doc.glossary_terms?.[0]) lines.push(`当有人提到"${doc.glossary_terms[0]}"时，哪条既有规则最相关？`);
  else lines.push(`关于 ${topic}，已有的相关规则是什么？`);
  return dedupeTerms(lines, 3) as string[];
}

export function buildRuleBasedViewText(
  doc: { body_preview?: string; disclosure?: string; glossary_terms?: string[]; path?: string; uri?: string },
  viewType: string,
): string {
  const summary = truncate(doc.body_preview, 420);
  const disclosure = truncate(doc.disclosure, 140);

  if (viewType === 'gist') {
    return [
      summary,
      disclosure || '',
    ].filter(Boolean).join('\n');
  }

  return buildQuestionLines(doc).join('\n');
}

export function buildSourceDocument(row: Record<string, unknown>): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    domain: row.domain,
    path: row.path,
    node_uuid: row.node_uuid,
    memory_id: row.memory_id,
    uri: row.uri,
    priority: Number(row.priority || 0),
    disclosure: (row.disclosure as string) || '',
    glossary_keywords: Array.isArray(row.glossary_keywords) ? row.glossary_keywords : [],
    glossary_text: (row.glossary_text as string) || '',
    body_preview: truncate(row.latest_content, 900),
  };
  doc.glossary_terms = buildGlossaryTerms(doc as { glossary_keywords?: unknown[] });
  doc.source_signature = hashPayload({
    uri: doc.uri,
    path: doc.path,
    node_uuid: doc.node_uuid,
    memory_id: doc.memory_id,
    priority: doc.priority,
    disclosure: doc.disclosure,
    glossary_keywords: doc.glossary_keywords,
    body_preview: doc.body_preview,
    generator: VIEW_GENERATOR_VERSION,
  });
  return doc;
}

// Re-export utils for backward compatibility (memoryViews.js previously exported these)
export { dedupeTerms, truncate };

// ---------------------------------------------------------------------------
// Test-support: reset cached FTS config (used by tests only)
// ---------------------------------------------------------------------------

export function _resetFtsCache(): void {
  _ftsConfig = null;
  _ftsQueryConfig = null;
}
