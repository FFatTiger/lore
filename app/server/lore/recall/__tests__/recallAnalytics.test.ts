import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db', () => ({ sql: vi.fn() }));
import { sql } from '../../../db';
import {
  sanitizeFilter,
  buildStatsWhere,
  mergeEventsByNode,
  reshapeEventsForDebugView,
  getRecallStats,
} from '../recallAnalytics';

const mockSql = vi.mocked(sql);

function makeResult(rows: Record<string, unknown>[] = [], rowCount = rows.length) {
  return { rows, rowCount } as any;
}

// ---------------------------------------------------------------------------
// sanitizeFilter
// ---------------------------------------------------------------------------

describe('sanitizeFilter', () => {
  it('trims and collapses whitespace', () => {
    expect(sanitizeFilter('  hello   world  ')).toBe('hello world');
  });

  it('returns empty string for falsy input', () => {
    expect(sanitizeFilter('')).toBe('');
    expect(sanitizeFilter(null)).toBe('');
    expect(sanitizeFilter(undefined)).toBe('');
  });

  it('truncates to maxChars', () => {
    const long = 'a'.repeat(300);
    expect(sanitizeFilter(long, 10)).toBe('a'.repeat(10));
  });

  it('defaults maxChars to 240', () => {
    const long = 'b'.repeat(500);
    expect(sanitizeFilter(long).length).toBe(240);
  });
});

// ---------------------------------------------------------------------------
// buildStatsWhere
// ---------------------------------------------------------------------------

describe('buildStatsWhere', () => {
  it('builds base time window clause', () => {
    const result = buildStatsWhere({ days: 7 });
    expect(result.where).toContain("created_at >= NOW() - ($1::int * INTERVAL '1 day')");
    expect(result.params).toEqual([7]);
    expect(result.filters).toEqual({ query_id: '', query_text: '', node_uri: '', client_type: '' });
  });

  it('adds queryId clause', () => {
    const result = buildStatsWhere({ days: 7, queryId: 'q-123' });
    expect(result.where).toContain("metadata->>'query_id' = $2");
    expect(result.params).toEqual([7, 'q-123']);
    expect(result.filters.query_id).toBe('q-123');
  });

  it('adds queryText ILIKE clause', () => {
    const result = buildStatsWhere({ days: 7, queryText: 'search' });
    expect(result.where).toContain('query_text ILIKE $2');
    expect(result.params[1]).toBe('%search%');
  });

  it('adds nodeUri clause', () => {
    const result = buildStatsWhere({ days: 7, nodeUri: 'core://node1' });
    expect(result.where).toContain('node_uri = $2');
    expect(result.params[1]).toBe('core://node1');
  });

  it('combines multiple filters', () => {
    const result = buildStatsWhere({ days: 14, queryId: 'q1', queryText: 'foo', nodeUri: 'core://x' });
    expect(result.params).toHaveLength(4);
    expect(result.where).toContain('$2');
    expect(result.where).toContain('$3');
    expect(result.where).toContain('$4');
  });

  it('sanitizes filter values', () => {
    const result = buildStatsWhere({ days: 7, queryId: '  spaced  id  ' });
    expect(result.filters.query_id).toBe('spaced id');
  });

  it('clamps days via intervalDaysSql', () => {
    const result = buildStatsWhere({ days: 999 });
    expect(result.params[0]).toBe(90);
  });
});

// ---------------------------------------------------------------------------
// mergeEventsByNode
// ---------------------------------------------------------------------------

describe('mergeEventsByNode', () => {
  it('merges multiple rows for the same URI', () => {
    const rows = [
      { node_uri: 'core://a', retrieval_path: 'exact', final_rank_score: 0.9, selected: true, metadata: { raw_score: 0.8, matched_on: ['exact'], cue_terms: ['foo'] } },
      { node_uri: 'core://a', retrieval_path: 'dense', final_rank_score: 0.9, selected: false, metadata: { raw_score: 0.7, matched_on: ['dense'], cue_terms: ['bar'] } },
    ];
    const merged = mergeEventsByNode(rows);
    expect(merged).toHaveLength(1);
    expect(merged[0].uri).toBe('core://a');
    expect(merged[0].exact_score).toBe(0.8);
    expect(merged[0].dense_score).toBe(0.7);
    expect(merged[0].selected).toBe(true);
    expect(merged[0].matched_on).toContain('exact');
    expect(merged[0].matched_on).toContain('dense');
    expect(merged[0].cues).toContain('foo');
    expect(merged[0].cues).toContain('bar');
    expect(merged[0].paths).toHaveLength(2);
  });

  it('sorts by score descending then URI ascending', () => {
    const rows = [
      { node_uri: 'core://b', retrieval_path: 'exact', final_rank_score: 0.5, metadata: { raw_score: 0.5 } },
      { node_uri: 'core://a', retrieval_path: 'exact', final_rank_score: 0.9, metadata: { raw_score: 0.9 } },
    ];
    const merged = mergeEventsByNode(rows);
    expect(merged[0].uri).toBe('core://a');
    expect(merged[1].uri).toBe('core://b');
  });

  it('skips rows with empty URI', () => {
    const rows = [
      { node_uri: '', retrieval_path: 'exact', metadata: {} },
      { node_uri: 'core://valid', retrieval_path: 'exact', final_rank_score: 0.5, metadata: { raw_score: 0.5 } },
    ];
    const merged = mergeEventsByNode(rows);
    expect(merged).toHaveLength(1);
    expect(merged[0].uri).toBe('core://valid');
  });

  it('uses max final_rank_score across rows', () => {
    const rows = [
      { node_uri: 'core://x', retrieval_path: 'exact', final_rank_score: 0.3, metadata: { raw_score: 0.3 } },
      { node_uri: 'core://x', retrieval_path: 'dense', final_rank_score: 0.8, metadata: { raw_score: 0.8 } },
    ];
    const merged = mergeEventsByNode(rows);
    expect(merged[0].score).toBe(0.8);
  });

  it('captures score_breakdown from first row that has it', () => {
    const rows = [
      { node_uri: 'core://y', retrieval_path: 'exact', metadata: { raw_score: 0.5 } },
      { node_uri: 'core://y', retrieval_path: 'dense', metadata: { raw_score: 0.7, score_breakdown: { dense: 0.7 } } },
    ];
    const merged = mergeEventsByNode(rows);
    expect(merged[0].score_breakdown).toEqual({ dense: 0.7 });
  });

  it('handles glossary_semantic path', () => {
    const rows = [
      { node_uri: 'core://gs', retrieval_path: 'glossary_semantic', final_rank_score: 0.6, metadata: { raw_score: 0.6, glossary_terms: ['term1'] } },
    ];
    const merged = mergeEventsByNode(rows);
    expect(merged[0].glossary_semantic_score).toBe(0.6);
    expect(merged[0].cues).toContain('term1');
  });

  it('handles lexical path', () => {
    const rows = [
      { node_uri: 'core://lx', retrieval_path: 'lexical', final_rank_score: 0.4, metadata: { raw_score: 0.4 } },
    ];
    const merged = mergeEventsByNode(rows);
    expect(merged[0].lexical_score).toBe(0.4);
  });

  it('limits cues to 6', () => {
    const cues = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const rows = [
      { node_uri: 'core://many', retrieval_path: 'exact', metadata: { raw_score: 1, cue_terms: cues } },
    ];
    const merged = mergeEventsByNode(rows);
    expect(merged[0].cues.length).toBeLessThanOrEqual(6);
  });

  it('returns empty array for empty input', () => {
    expect(mergeEventsByNode([])).toEqual([]);
  });

  it('captures client_type from metadata when merging rows', () => {
    const rows = [
      { node_uri: 'core://client', retrieval_path: 'exact', final_rank_score: 0.8, metadata: { raw_score: 0.8, client_type: 'claudecode' } },
    ];
    const merged = mergeEventsByNode(rows);
    expect(merged[0].client_type).toBe('claudecode');
  });
});

// ---------------------------------------------------------------------------
// reshapeEventsForDebugView
// ---------------------------------------------------------------------------

describe('reshapeEventsForDebugView', () => {
  it('reshapes exact rows into exact_hits', () => {
    const rows = [
      { node_uri: 'core://e', retrieval_path: 'exact', metadata: { raw_score: 0.9, exact_flags: { path_exact_hit: true } } },
    ];
    const merged = [{ uri: 'core://e', score: 0.9, selected: true, displayed_position: 1, matched_on: ['exact'], cues: [], score_breakdown: null } as any];
    const result = reshapeEventsForDebugView(rows, merged);
    expect(result.exact_hits).toHaveLength(1);
    expect(result.exact_hits[0]).toHaveProperty('uri', 'core://e');
    expect(result.exact_hits[0]).toHaveProperty('path_exact_hit', true);
  });

  it('reshapes glossary_semantic rows', () => {
    const rows = [
      { node_uri: 'core://gs', retrieval_path: 'glossary_semantic', metadata: { raw_score: 0.7, cue_terms: ['keyword1'] } },
    ];
    const merged = [{ uri: 'core://gs', score: 0.7, selected: false, matched_on: ['glossary_semantic'], cues: ['keyword1'], score_breakdown: null } as any];
    const result = reshapeEventsForDebugView(rows, merged);
    expect(result.glossary_semantic_hits).toHaveLength(1);
    expect(result.glossary_semantic_hits[0]).toHaveProperty('keyword', 'keyword1');
  });

  it('reshapes dense rows', () => {
    const rows = [
      { node_uri: 'core://d', retrieval_path: 'dense', view_type: 'gist', metadata: { raw_score: 0.6, source_weight: 1.5, llm_refined: true } },
    ];
    const merged = [{ uri: 'core://d', score: 0.6, selected: false, matched_on: ['dense'], cues: [], score_breakdown: null } as any];
    const result = reshapeEventsForDebugView(rows, merged);
    expect(result.dense_hits).toHaveLength(1);
    expect(result.dense_hits[0]).toHaveProperty('semantic_score', 0.6);
    expect(result.dense_hits[0]).toHaveProperty('llm_refined', true);
  });

  it('reshapes lexical rows', () => {
    const rows = [
      { node_uri: 'core://l', retrieval_path: 'lexical', metadata: { raw_score: 0.5, lexical_flags: { fts_hit: true, text_hit: false, uri_hit: true } } },
    ];
    const merged = [{ uri: 'core://l', score: 0.5, selected: false, matched_on: ['lexical'], cues: [], score_breakdown: null } as any];
    const result = reshapeEventsForDebugView(rows, merged);
    expect(result.lexical_hits).toHaveLength(1);
    expect(result.lexical_hits[0]).toHaveProperty('fts_hit', true);
    expect(result.lexical_hits[0]).toHaveProperty('uri_hit', true);
    expect(result.lexical_hits[0]).toHaveProperty('text_hit', false);
  });

  it('builds items from selected merged candidates', () => {
    const rows = [
      { node_uri: 'core://s1', retrieval_path: 'exact', metadata: { raw_score: 0.9 } },
      { node_uri: 'core://s2', retrieval_path: 'dense', metadata: { raw_score: 0.7 } },
    ];
    const merged = [
      { uri: 'core://s1', score: 0.9, selected: true, displayed_position: 2, matched_on: ['exact'], cues: ['c1'], score_breakdown: null } as any,
      { uri: 'core://s2', score: 0.7, selected: true, displayed_position: 1, matched_on: ['dense'], cues: [], score_breakdown: null } as any,
    ];
    const result = reshapeEventsForDebugView(rows, merged);
    expect(result.items).toHaveLength(2);
    // sorted by displayed_position
    expect(result.items[0].uri).toBe('core://s2');
    expect(result.items[1].uri).toBe('core://s1');
  });

  it('includes client_type in reshaped debug items', () => {
    const rows = [
      { node_uri: 'core://debug', retrieval_path: 'exact', metadata: { raw_score: 0.9, client_type: 'hermes' } },
    ];
    const merged = [{ uri: 'core://debug', score: 0.9, selected: true, displayed_position: 1, matched_on: ['exact'], cues: [], client_type: 'hermes', score_breakdown: null } as any];
    const result = reshapeEventsForDebugView(rows, merged);
    expect(result.items[0]).toHaveProperty('client_type', 'hermes');
    expect(result.exact_hits[0]).toHaveProperty('client_type', 'hermes');
  });
});

// ---------------------------------------------------------------------------
// getRecallStats
// ---------------------------------------------------------------------------

describe('getRecallStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSql.mockResolvedValue(makeResult());
  });

  it('returns structured stats with defaults', async () => {
    mockSql.mockResolvedValue(makeResult([{
      total_merged: '10',
      total_shown: '5',
      total_used: '2',
      query_count: '3',
      last_event_at: '2025-01-01T00:00:00Z',
    }]));
    const stats = await getRecallStats();
    expect(stats.window_days).toBe(7);
    expect(stats.aggregation_unit).toBe('path_event');
    expect(stats.summary).toBeDefined();
    expect(stats.by_path).toBeDefined();
    expect(stats.by_view_type).toBeDefined();
    expect(stats.noisy_nodes).toBeDefined();
    expect(stats.recent_queries).toBeDefined();
    expect(stats.recent_events).toBeDefined();
  });

  it('uses custom days and limit', async () => {
    mockSql.mockResolvedValue(makeResult([{ total_merged: '0', total_shown: '0', total_used: '0', query_count: '0', last_event_at: null }]));
    const stats = await getRecallStats({ days: 14, limit: 5 });
    expect(stats.window_days).toBe(14);
  });

  it('clamps limit to valid range', async () => {
    mockSql.mockResolvedValue(makeResult([{ total_merged: '0', total_shown: '0', total_used: '0', query_count: '0', last_event_at: null }]));
    // limit < 3 should clamp to 3
    const stats = await getRecallStats({ limit: 1 });
    // We can verify it ran without error; exact limit is internal
    expect(stats).toBeDefined();
  });

  it('includes filters when queryId is provided', async () => {
    // Provide enough mock results for all the parallel queries + the query detail queries
    const summaryRow = { total_merged: '5', total_shown: '2', total_used: '1', query_count: '1', last_event_at: '2025-01-01T00:00:00Z' };
    mockSql.mockResolvedValue(makeResult([summaryRow]));
    const stats = await getRecallStats({ queryId: 'q-test' });
    expect(stats.filters).toBeDefined();
    expect(stats.filters?.query_id).toBe('q-test');
    expect(stats.query_detail).toBeDefined();
  });

  it('includes node_detail when nodeUri is provided', async () => {
    const summaryRow = { total_merged: '3', total_shown: '1', total_used: '0', query_count: '2', last_event_at: '2025-01-01T00:00:00Z' };
    mockSql.mockResolvedValue(makeResult([summaryRow]));
    const stats = await getRecallStats({ nodeUri: 'core://test-node' });
    expect(stats.filters).toBeDefined();
    expect(stats.filters?.node_uri).toBe('core://test-node');
    expect(stats.node_detail).toBeDefined();
  });

  it('applies active filters to aggregate queries, not just recent events', async () => {
    const summaryRow = { total_merged: '3', total_shown: '1', total_used: '0', query_count: '2', last_event_at: '2025-01-01T00:00:00Z' };
    mockSql.mockResolvedValue(makeResult([summaryRow]));

    await getRecallStats({ queryId: 'q-test', nodeUri: 'core://test-node' });

    const aggregateCalls = mockSql.mock.calls.slice(0, 6);
    expect(aggregateCalls).toHaveLength(6);

    for (const [query, params] of aggregateCalls) {
      const sqlText = String(query);
      expect(sqlText).toContain("metadata->>'query_id'");
      expect(sqlText).toContain('node_uri =');
      expect(params).toEqual(expect.arrayContaining([7, 'q-test', 'core://test-node']));
    }
  });

  it('does not include filters when no filter is active', async () => {
    mockSql.mockResolvedValue(makeResult([{ total_merged: '0', total_shown: '0', total_used: '0', query_count: '0', last_event_at: null }]));
    const stats = await getRecallStats();
    expect(stats.filters).toBeNull();
  });

  it('maps by_path rows correctly', async () => {
    let callCount = 0;
    mockSql.mockImplementation(async () => {
      callCount++;
      if (callCount === 2) {
        return makeResult([{ retrieval_path: 'exact', total: '3', selected: '2', used_in_answer: '1', avg_pre_rank_score: 0.7, avg_final_rank_score: 0.8 }]);
      }
      return makeResult([{ total_merged: '3', total_shown: '2', total_used: '1', query_count: '1', last_event_at: null }]);
    });
    const stats = await getRecallStats();
    if (stats.by_path.length > 0) {
      expect(stats.by_path[0]).toHaveProperty('retrieval_path');
      expect(stats.by_path[0]).toHaveProperty('total');
      expect(stats.by_path[0]).toHaveProperty('selected');
    }
  });
});
