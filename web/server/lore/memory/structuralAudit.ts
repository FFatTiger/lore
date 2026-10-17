/**
 * Structural audit of the memory tree.
 *
 * Dream uses this to find paths that hurt navigation and recall hygiene:
 * ordinary date-suffixed paths, project concepts misplaced under
 * `core://projects`, malformed domains, and nodes without active content.
 * Without a category it returns compact counts only; pass a category to page
 * through the matching candidates.
 */

import { sql } from '../../db';
import {
  hasDateTimePathSuffix,
  isAllowedDateArchivedPath,
  lastPathSegment,
  parentPathOf,
  splitDateSuffix,
} from './pathRules';

export type StructuralAuditCategory =
  | 'date_suffix'
  | 'core_projects'
  | 'malformed_domains'
  | 'empty_content'
  | '';

export interface StructuralAuditOptions {
  category?: StructuralAuditCategory | string;
  limit?: number;
  offset?: number;
  /** Include every category list (paged by limit/offset) alongside the counts. */
  includeItems?: boolean;
}

export interface StructuralCandidate {
  uri: string;
  created_at?: string;
  category: string;
  reason: string;
  parsed_date?: string;
  proposed_stable_uri?: string;
  target_exists?: boolean;
  target_parent_exists?: boolean;
  content_contains_date?: boolean;
}

export interface StructuralAuditSummary {
  counts: Record<string, number>;
  date_suffix_paths?: StructuralCandidate[];
  core_projects_paths?: StructuralCandidate[];
  malformed_domains?: StructuralCandidate[];
  empty_content_nodes?: StructuralCandidate[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface StructuralPathRow {
  domain: string;
  path: string;
  created_at: string | null;
  content: string;
  node_uuid: string;
}

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

function toIso(value: unknown): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

export function uriFor(domain: string, path: string): string {
  return `${domain}://${path}`;
}

function pageCandidates(items: StructuralCandidate[], limit: number, offset: number): StructuralCandidate[] {
  if (offset > items.length) return [];
  return items.slice(offset, offset + limit);
}

function pathExists(rows: StructuralPathRow[], domain: string, path: string): boolean {
  return rows.some((row) => row.domain === domain && row.path === path);
}

function buildDateSuffixCandidates(rows: StructuralPathRow[]): StructuralCandidate[] {
  const existing = new Set(rows.map((row) => uriFor(row.domain, row.path)));
  const out: StructuralCandidate[] = [];
  for (const row of rows) {
    if (!hasDateTimePathSuffix(row.path) || isAllowedDateArchivedPath(row.path)) continue;
    const leaf = lastPathSegment(row.path);
    const { concept, date } = splitDateSuffix(leaf);
    const parent = parentPathOf(row.path);
    const stablePath = parent ? `${parent}/${concept}` : concept;
    const stableUri = uriFor(row.domain, stablePath);
    out.push({
      uri: uriFor(row.domain, row.path),
      created_at: toIso(row.created_at),
      category: 'date_suffix',
      reason: 'ordinary_date_suffix',
      parsed_date: date,
      proposed_stable_uri: stableUri,
      target_exists: existing.has(stableUri),
      target_parent_exists: parent === '' || pathExists(rows, row.domain, parent),
      content_contains_date: date !== '' && row.content.includes(date),
    });
  }
  return out;
}

function buildCoreProjectsCandidates(rows: StructuralPathRow[]): StructuralCandidate[] {
  return rows
    .filter((row) => row.domain === 'core' && (row.path === 'projects' || row.path.startsWith('projects/')))
    .map((row) => ({
      uri: uriFor(row.domain, row.path),
      created_at: toIso(row.created_at),
      category: 'core_projects',
      reason: 'project_concept_under_core_domain',
    }));
}

function buildMalformedCandidates(rows: StructuralPathRow[]): StructuralCandidate[] {
  return rows
    .filter((row) => row.domain.includes('://'))
    .map((row) => ({
      uri: uriFor(row.domain, row.path),
      created_at: toIso(row.created_at),
      category: 'malformed_domains',
      reason: `domain_contains_uri_scheme: ${row.domain}`,
    }));
}

function buildEmptyContentCandidates(rows: StructuralPathRow[]): StructuralCandidate[] {
  return rows
    .filter((row) => row.content.trim() === '')
    .map((row) => ({
      uri: uriFor(row.domain, row.path),
      created_at: toIso(row.created_at),
      category: 'empty_content',
      reason: 'no_active_memory_content',
    }));
}

/** Pure audit builder: classification and pagination without database access. */
export function buildStructuralAudit(
  rows: StructuralPathRow[],
  options: StructuralAuditOptions = {},
): StructuralAuditSummary {
  const limit = clampLimit(options.limit);
  const offset = clampOffset(options.offset);
  const dateSuffix = buildDateSuffixCandidates(rows);
  const coreProjects = buildCoreProjectsCandidates(rows);
  const malformed = buildMalformedCandidates(rows);
  const emptyContent = buildEmptyContentCandidates(rows);
  const counts = {
    date_suffix: dateSuffix.length,
    core_projects: coreProjects.length,
    malformed_domains: malformed.length,
    empty_content: emptyContent.length,
  };
  const summary: StructuralAuditSummary = { counts, total: 0, limit, offset, has_more: false };
  const category = String(options.category ?? '').trim();
  switch (category) {
    case 'date_suffix':
      summary.date_suffix_paths = pageCandidates(dateSuffix, limit, offset);
      summary.total = dateSuffix.length;
      summary.has_more = offset + summary.date_suffix_paths.length < dateSuffix.length;
      break;
    case 'core_projects':
      summary.core_projects_paths = pageCandidates(coreProjects, limit, offset);
      summary.total = coreProjects.length;
      summary.has_more = offset + summary.core_projects_paths.length < coreProjects.length;
      break;
    case 'malformed_domains':
      summary.malformed_domains = pageCandidates(malformed, limit, offset);
      summary.total = malformed.length;
      summary.has_more = offset + summary.malformed_domains.length < malformed.length;
      break;
    case 'empty_content':
      summary.empty_content_nodes = pageCandidates(emptyContent, limit, offset);
      summary.total = emptyContent.length;
      summary.has_more = offset + summary.empty_content_nodes.length < emptyContent.length;
      break;
    default:
      summary.total = Object.values(counts).reduce((sum, count) => sum + count, 0);
      if (options.includeItems) {
        summary.date_suffix_paths = pageCandidates(dateSuffix, limit, offset);
        summary.core_projects_paths = pageCandidates(coreProjects, limit, offset);
        summary.malformed_domains = pageCandidates(malformed, limit, offset);
        summary.empty_content_nodes = pageCandidates(emptyContent, limit, offset);
      }
  }
  return summary;
}

export async function loadStructuralPaths(): Promise<StructuralPathRow[]> {
  const result = await sql(
    `SELECT p.domain, p.path, p.created_at, e.child_uuid,
            COALESCE((SELECT m.content FROM memories m
                      WHERE m.node_uuid = e.child_uuid AND m.deprecated = FALSE
                      ORDER BY m.created_at DESC LIMIT 1), '') AS content
     FROM paths p
     JOIN edges e ON p.edge_id = e.id
     WHERE p.path <> ''
     ORDER BY p.domain, p.path`,
  );
  return result.rows.map((row: Record<string, unknown>) => ({
    domain: String(row.domain || ''),
    path: String(row.path || ''),
    created_at: row.created_at ? toIso(row.created_at) : null,
    content: String(row.content || ''),
    node_uuid: String(row.child_uuid || ''),
  }));
}

export async function getStructuralAudit(
  options: StructuralAuditOptions = {},
): Promise<StructuralAuditSummary> {
  const rows = await loadStructuralPaths();
  return buildStructuralAudit(rows, options);
}

export interface PathQualityNode {
  uri: string;
  created_at: string;
  reason: string;
}

export interface PathQualitySummary {
  date_suffix_path_count: number;
  recent_bad_creates: number;
  top_nodes: PathQualityNode[];
}

/** Compact path-quality picture for Dream's initial context. */
export async function getPathQualitySummary(limit = 8): Promise<PathQualitySummary> {
  const safeLimit = Math.min(20, Math.max(1, Math.floor(Number(limit) || 8)));
  const pathsResult = await sql(
    `SELECT domain, path, created_at FROM paths ORDER BY created_at DESC`,
  );
  const summary: PathQualitySummary = { date_suffix_path_count: 0, recent_bad_creates: 0, top_nodes: [] };
  for (const row of pathsResult.rows as Array<Record<string, unknown>>) {
    const path = String(row.path || '');
    if (!hasDateTimePathSuffix(path) || isAllowedDateArchivedPath(path)) continue;
    summary.date_suffix_path_count += 1;
    if (summary.top_nodes.length < safeLimit) {
      summary.top_nodes.push({
        uri: uriFor(String(row.domain || ''), path),
        created_at: toIso(row.created_at),
        reason: 'ordinary_date_suffix',
      });
    }
  }

  const recentResult = await sql(
    `SELECT path FROM memory_events
     WHERE event_type = 'create'
       AND created_at >= NOW() - INTERVAL '7 days'
     ORDER BY created_at DESC
     LIMIT 200`,
  );
  for (const row of recentResult.rows as Array<Record<string, unknown>>) {
    const path = String(row.path || '');
    if (hasDateTimePathSuffix(path) && !isAllowedDateArchivedPath(path)) {
      summary.recent_bad_creates += 1;
    }
  }
  return summary;
}
