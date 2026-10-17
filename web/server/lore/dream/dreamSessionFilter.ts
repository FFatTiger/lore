/**
 * Session exclusion for Dream's recall metadata.
 *
 * Automated bots and test harnesses can produce recall traffic that says
 * nothing about real memory quality. A session is excluded when any of its
 * recall query texts matches one of the configured patterns
 * (`dream.exclude_session_patterns`), and every recall-metadata surface handed
 * to Dream drops the queries from that session.
 */

import { sql } from '../../db';
import { getSettings } from '../config/settings';

export interface DreamSessionFilter {
  patterns: RegExp[];
}

export function dreamSessionFilterEnabled(filter: DreamSessionFilter | null): boolean {
  return Boolean(filter && filter.patterns.length > 0);
}

export function dreamSessionMatches(filter: DreamSessionFilter | null, text: unknown): boolean {
  if (!filter) return false;
  const value = String(text ?? '');
  return filter.patterns.some((pattern) => pattern.test(value));
}

export async function loadDreamSessionFilter(): Promise<DreamSessionFilter> {
  try {
    const values = await getSettings(['dream.exclude_session_patterns']);
    const raw = values['dream.exclude_session_patterns'];
    const items = Array.isArray(raw)
      ? raw
      : typeof raw === 'string' && raw.trim()
        ? [raw]
        : [];
    const patterns: RegExp[] = [];
    for (const item of items) {
      const text = String(item ?? '').trim();
      if (!text) continue;
      try {
        patterns.push(new RegExp(text));
      } catch {
        // Invalid patterns are rejected on write; skip stale values instead of
        // failing the whole Dream run.
      }
    }
    return { patterns };
  } catch {
    return { patterns: [] };
  }
}

interface RecallQueryRow {
  query_id: string;
  session_id: string;
  query_text: string;
}

/**
 * Returns the query_ids in the lookback window that belong to excluded
 * sessions. Queries without a session_id are judged on their own text.
 */
export async function collectExcludedDreamQueryIds(
  filter: DreamSessionFilter | null,
  days: number,
): Promise<Set<string>> {
  const excluded = new Set<string>();
  if (!dreamSessionFilterEnabled(filter)) return excluded;
  const safeDays = Math.max(1, Math.min(30, Math.floor(Number(days) || 1)));
  const result = await sql(
    `SELECT query_id, COALESCE(session_id, '') AS session_id, query_text
     FROM recall_queries
     WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')`,
    [safeDays],
  );
  const queries: RecallQueryRow[] = (result.rows as Array<Record<string, unknown>>).map((row) => ({
    query_id: String(row.query_id || ''),
    session_id: String(row.session_id || ''),
    query_text: String(row.query_text || ''),
  }));
  const excludedSessions = new Set<string>();
  for (const row of queries) {
    if (!dreamSessionMatches(filter, row.query_text)) continue;
    if (row.session_id) {
      excludedSessions.add(row.session_id);
    } else {
      excluded.add(row.query_id);
    }
  }
  if (excludedSessions.size > 0) {
    for (const row of queries) {
      if (row.session_id && excludedSessions.has(row.session_id)) excluded.add(row.query_id);
    }
  }
  return excluded;
}

function filterItems(items: unknown, excluded: Set<string>): { items: unknown[]; dropped: number } {
  if (!Array.isArray(items)) return { items: [], dropped: 0 };
  const kept: unknown[] = [];
  let dropped = 0;
  for (const item of items) {
    const queryId = item && typeof item === 'object'
      ? String((item as Record<string, unknown>).query_id || '')
      : '';
    if (queryId && excluded.has(queryId)) {
      dropped += 1;
      continue;
    }
    kept.push(item);
  }
  return { items: kept, dropped };
}

/**
 * Removes excluded queries from a recall metadata payload. Handles the
 * `queries` list used by the dream recall review and the `recent_queries.items`
 * list used by recall stats.
 */
export function filterDreamRecallReview<T extends Record<string, unknown>>(
  review: T,
  excluded: Set<string>,
): T {
  if (excluded.size === 0) return review;
  const out: Record<string, unknown> = { ...review };
  let dropped = 0;

  if (Array.isArray(review.queries)) {
    const filtered = filterItems(review.queries, excluded);
    out.queries = filtered.items;
    dropped += filtered.dropped;
  }

  const recent = review.recent_queries;
  if (recent && typeof recent === 'object' && !Array.isArray(recent)) {
    const recentRecord = { ...(recent as Record<string, unknown>) };
    const filtered = filterItems(recentRecord.items, excluded);
    recentRecord.items = filtered.items;
    dropped += filtered.dropped;
    out.recent_queries = recentRecord;
  }

  if (dropped > 0) out.excluded_by_session_filter = dropped;
  return out as T;
}
