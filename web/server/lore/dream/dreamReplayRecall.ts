/**
 * Read-only recall replay for Dream.
 *
 * Dream replays historical queries through the normal recall path to see what
 * the current tree would surface. Replays never write recall queries, events,
 * or usage rows, so they can be run freely before and after a merge.
 */

import { sql } from '../../db';
import { recallMemories } from '../recall/recall';
import { dreamSessionMatches, loadDreamSessionFilter } from './dreamSessionFilter';

export const MAX_DREAM_REPLAY_QUERIES = 10;

export interface DreamReplayRecallInput {
  query_ids?: unknown;
  queries?: unknown;
}

interface ReplayEntry {
  source: 'query_id' | 'raw';
  query_id?: string;
  query_text?: string;
  items?: Array<{ uri: string; score: number }>;
  error?: string;
}

function stringItems(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const text = String(item ?? '').trim();
    return text ? [text] : [];
  });
}

async function replayOne(entry: ReplayEntry, queryText: string): Promise<void> {
  const response = await recallMemories({ query: queryText }, { logEvents: false });
  entry.items = response.items.map((item) => ({ uri: item.uri, score: item.score_display }));
}

export async function replayRecall(input: DreamReplayRecallInput): Promise<Record<string, unknown>> {
  const seen = new Set<string>();
  const queryIds: string[] = [];
  for (const id of stringItems(input.query_ids)) {
    if (seen.has(id)) continue;
    seen.add(id);
    queryIds.push(id);
    if (queryIds.length >= MAX_DREAM_REPLAY_QUERIES) break;
  }
  const queries: string[] = [];
  for (const query of stringItems(input.queries)) {
    if (seen.has(`query:${query}`)) continue;
    seen.add(`query:${query}`);
    if (queryIds.length + queries.length >= MAX_DREAM_REPLAY_QUERIES) break;
    queries.push(query);
  }
  if (queryIds.length + queries.length === 0) {
    return {
      blocked: true,
      code: 'validation',
      error: `provide at least one query_id or query to replay (max ${MAX_DREAM_REPLAY_QUERIES} total)`,
    };
  }

  const filter = await loadDreamSessionFilter();
  const replays: ReplayEntry[] = [];

  for (const id of queryIds) {
    const entry: ReplayEntry = { source: 'query_id', query_id: id };
    const result = await sql(
      `SELECT query_text FROM recall_queries WHERE query_id = $1 LIMIT 1`,
      [id],
    );
    const queryText = result.rows[0] ? String((result.rows[0] as Record<string, unknown>).query_text || '') : '';
    if (!queryText) {
      entry.error = 'query_id not found';
      replays.push(entry);
      continue;
    }
    entry.query_text = queryText;
    if (dreamSessionMatches(filter, queryText)) {
      entry.error = 'query_id belongs to an excluded session';
      replays.push(entry);
      continue;
    }
    await replayOne(entry, queryText);
    replays.push(entry);
  }

  for (const queryText of queries) {
    const entry: ReplayEntry = { source: 'raw', query_text: queryText };
    await replayOne(entry, queryText);
    replays.push(entry);
  }

  return {
    replays,
    note: 'Read-only replay through the normal recall path; no recall queries, events, or usage are written.',
  };
}
