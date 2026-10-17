/**
 * Memory hygiene audit.
 *
 * Dream uses this to measure what is actually wrong with the tree before it
 * changes anything: nodes that have grown too long, glossaries that became a
 * keyword dump, keywords shared by many nodes, parents that are only
 * placeholders, and nodes stranded in legacy domains.
 *
 * Without a category the audit returns counts only; pass a category to page
 * through the matching candidates.
 */

import { sql } from '../../db';
import { isCanonicalDomain, isIdentifierGlossaryKeyword } from './pathRules';
import { loadStructuralPaths, uriFor, type StructuralPathRow } from './structuralAudit';

export type HygieneAuditCategory =
  | 'oversized'
  | 'glossary_bloat'
  | 'identifier_keywords'
  | 'shared_keywords'
  | 'placeholder_parents'
  | 'legacy_domains'
  | '';

export interface HygieneAuditOptions {
  category?: HygieneAuditCategory | string;
  limit?: number;
  offset?: number;
}

export interface HygieneCandidate {
  uri?: string;
  category: string;
  reason: string;
  chars?: number;
  keyword_count?: number;
  keywords?: string[];
  keyword?: string;
  node_count?: number;
  nodes?: string[];
  common_parent?: string;
  child_count?: number;
  domain?: string;
}

export interface HygieneAuditSummary {
  counts: Record<string, number>;
  items?: HygieneCandidate[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface HygieneAuditIndex {
  paths: StructuralPathRow[];
  uuidToUri: Map<string, string>;
  childCounts: Map<string, number>;
  keywordsByUuid: Map<string, string[]>;
  uuidsByKeyword: Map<string, string[]>;
}

export const OVERSIZED_CONTENT_CHARS = 4000;
export const GLOSSARY_BLOAT_KEYWORDS = 30;
export const SHARED_KEYWORD_NODES = 8;
export const PLACEHOLDER_PARENT_CHARS = 200;

function clampLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 10;
  return Math.min(100, Math.floor(parsed));
}

function clampOffset(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function charCount(value: string): number {
  return [...value].length;
}

function sortedUuidsWithUri(index: HygieneAuditIndex): string[] {
  return [...index.uuidToUri.keys()].sort();
}

function buildOversizedCandidates(paths: StructuralPathRow[]): HygieneCandidate[] {
  return paths.flatMap((row) => {
    const chars = charCount(row.content);
    if (chars <= OVERSIZED_CONTENT_CHARS) return [];
    return [{
      uri: uriFor(row.domain, row.path),
      category: 'oversized',
      reason: 'content_over_4000_chars',
      chars,
    }];
  });
}

function buildGlossaryBloatCandidates(index: HygieneAuditIndex): HygieneCandidate[] {
  return sortedUuidsWithUri(index).flatMap((uuid) => {
    const keywordCount = (index.keywordsByUuid.get(uuid) || []).length;
    if (keywordCount <= GLOSSARY_BLOAT_KEYWORDS) return [];
    return [{
      uri: index.uuidToUri.get(uuid) as string,
      category: 'glossary_bloat',
      reason: 'glossary_over_30_keywords',
      keyword_count: keywordCount,
    }];
  });
}

function buildIdentifierKeywordCandidates(index: HygieneAuditIndex): HygieneCandidate[] {
  return sortedUuidsWithUri(index).flatMap((uuid) => {
    const keywords = (index.keywordsByUuid.get(uuid) || []).filter(isIdentifierGlossaryKeyword);
    if (keywords.length === 0) return [];
    return [{
      uri: index.uuidToUri.get(uuid) as string,
      category: 'identifier_keywords',
      reason: 'identifier_like_glossary_keywords',
      keywords,
    }];
  });
}

function commonPathPrefix(a: string, b: string): string {
  const segmentsA = a.split('/');
  const segmentsB = b.split('/');
  const shared: string[] = [];
  for (let i = 0; i < segmentsA.length && i < segmentsB.length; i += 1) {
    if (segmentsA[i] !== segmentsB[i]) break;
    shared.push(segmentsA[i]);
  }
  return shared.join('/');
}

function commonParentUri(index: HygieneAuditIndex, uuids: string[]): string {
  let domain = '';
  let prefix = '';
  let resolved = false;
  for (const uuid of uuids) {
    const uri = index.uuidToUri.get(uuid);
    if (!uri) continue;
    const separator = uri.indexOf('://');
    if (separator < 0) continue;
    const currentDomain = uri.slice(0, separator);
    const currentPath = uri.slice(separator + 3);
    if (!resolved) {
      domain = currentDomain;
      prefix = currentPath;
      resolved = true;
      continue;
    }
    if (currentDomain !== domain) return '';
    prefix = commonPathPrefix(prefix, currentPath);
  }
  if (!resolved || prefix === '') return '';
  return uriFor(domain, prefix);
}

function buildSharedKeywordCandidates(index: HygieneAuditIndex): HygieneCandidate[] {
  const groups: Array<{ keyword: string; uuids: string[] }> = [];
  for (const [keyword, uuids] of index.uuidsByKeyword.entries()) {
    const withUri = uuids.filter((uuid) => index.uuidToUri.has(uuid)).sort();
    if (withUri.length < SHARED_KEYWORD_NODES) continue;
    groups.push({ keyword, uuids: withUri });
  }
  groups.sort((a, b) => (
    a.uuids.length === b.uuids.length
      ? a.keyword.localeCompare(b.keyword)
      : b.uuids.length - a.uuids.length
  ));
  return groups.map((group) => {
    const nodes = group.uuids.map((uuid) => index.uuidToUri.get(uuid) as string);
    const candidate: HygieneCandidate = {
      category: 'shared_keywords',
      reason: 'keyword_shared_by_8_or_more_nodes',
      keyword: group.keyword,
      node_count: nodes.length,
      nodes,
    };
    const commonParent = commonParentUri(index, group.uuids);
    if (commonParent) candidate.common_parent = commonParent;
    return candidate;
  });
}

function buildPlaceholderParentCandidates(index: HygieneAuditIndex): HygieneCandidate[] {
  return index.paths.flatMap((row) => {
    const childCount = index.childCounts.get(row.node_uuid) || 0;
    if (childCount === 0) return [];
    const chars = charCount(row.content);
    if (chars >= PLACEHOLDER_PARENT_CHARS) return [];
    return [{
      uri: uriFor(row.domain, row.path),
      category: 'placeholder_parents',
      reason: 'thin_parent_with_children',
      chars,
      child_count: childCount,
    }];
  });
}

function buildLegacyDomainCandidates(paths: StructuralPathRow[]): HygieneCandidate[] {
  return paths
    .filter((row) => !isCanonicalDomain(row.domain))
    .map((row) => ({
      uri: uriFor(row.domain, row.path),
      category: 'legacy_domains',
      reason: 'domain_outside_canonical_set',
      domain: row.domain,
    }));
}

function pageCandidates(items: HygieneCandidate[], limit: number, offset: number): HygieneCandidate[] {
  if (offset > items.length) return [];
  return items.slice(offset, offset + limit);
}

/** Pure audit builder: classification and pagination without database access. */
export function buildHygieneAudit(
  index: HygieneAuditIndex,
  options: HygieneAuditOptions = {},
): HygieneAuditSummary {
  const limit = clampLimit(options.limit);
  const offset = clampOffset(options.offset);
  const byCategory: Record<string, HygieneCandidate[]> = {
    oversized: buildOversizedCandidates(index.paths),
    glossary_bloat: buildGlossaryBloatCandidates(index),
    identifier_keywords: buildIdentifierKeywordCandidates(index),
    shared_keywords: buildSharedKeywordCandidates(index),
    placeholder_parents: buildPlaceholderParentCandidates(index),
    legacy_domains: buildLegacyDomainCandidates(index.paths),
  };
  const counts = Object.fromEntries(
    Object.entries(byCategory).map(([category, items]) => [category, items.length]),
  ) as Record<string, number>;
  const summary: HygieneAuditSummary = { counts, total: 0, limit, offset, has_more: false };
  const category = String(options.category ?? '').trim();
  const items = byCategory[category];
  if (items) {
    summary.items = pageCandidates(items, limit, offset);
    summary.total = items.length;
    summary.has_more = offset + summary.items.length < items.length;
    return summary;
  }
  summary.total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return summary;
}

export async function loadHygieneAuditIndex(): Promise<HygieneAuditIndex> {
  const paths = await loadStructuralPaths();
  const index: HygieneAuditIndex = {
    paths,
    uuidToUri: new Map(),
    childCounts: new Map(),
    keywordsByUuid: new Map(),
    uuidsByKeyword: new Map(),
  };
  for (const row of paths) {
    if (!index.uuidToUri.has(row.node_uuid)) {
      index.uuidToUri.set(row.node_uuid, uriFor(row.domain, row.path));
    }
  }

  const childResult = await sql(
    `SELECT e.parent_uuid, COUNT(DISTINCT e.child_uuid)::int AS child_count
     FROM edges e
     JOIN paths p ON p.edge_id = e.id
     GROUP BY e.parent_uuid`,
  );
  for (const row of childResult.rows as Array<Record<string, unknown>>) {
    index.childCounts.set(String(row.parent_uuid || ''), Number(row.child_count || 0));
  }

  const glossaryResult = await sql(
    `SELECT node_uuid, keyword FROM glossary_keywords ORDER BY node_uuid, keyword`,
  );
  for (const row of glossaryResult.rows as Array<Record<string, unknown>>) {
    const uuid = String(row.node_uuid || '');
    const keyword = String(row.keyword || '');
    const keywords = index.keywordsByUuid.get(uuid) || [];
    keywords.push(keyword);
    index.keywordsByUuid.set(uuid, keywords);
    const uuids = index.uuidsByKeyword.get(keyword) || [];
    uuids.push(uuid);
    index.uuidsByKeyword.set(keyword, uuids);
  }
  return index;
}

export async function getHygieneAudit(
  options: HygieneAuditOptions = {},
): Promise<HygieneAuditSummary> {
  const index = await loadHygieneAuditIndex();
  return buildHygieneAudit(index, options);
}
