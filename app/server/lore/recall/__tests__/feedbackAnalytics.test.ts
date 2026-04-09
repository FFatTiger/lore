import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db', () => ({ sql: vi.fn() }));
import { sql } from '../../../db';
import {
  getMemoryHealthReport,
  getDeadWrites,
  getPathEffectiveness,
} from '../feedbackAnalytics';

const mockSql = vi.mocked(sql);

function makeResult(rows: Record<string, unknown>[] = []) {
  return { rows, rowCount: rows.length } as any;
}

// ---------------------------------------------------------------------------
// getMemoryHealthReport
// ---------------------------------------------------------------------------

describe('getMemoryHealthReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty report when no rows', async () => {
    mockSql.mockResolvedValue(makeResult([]));
    const result = await getMemoryHealthReport();
    expect(result.total_nodes).toBe(0);
    expect(result.nodes).toHaveLength(0);
    expect(result.classification_summary).toEqual({ healthy: 0, underperforming: 0, dead: 0, noisy: 0 });
  });

  it('classifies node with recall_count=0 as dead', async () => {
    mockSql.mockResolvedValue(makeResult([{
      node_uri: 'core://dead/node',
      created_at: '2025-01-01T00:00:00Z',
      last_updated_at: null,
      update_count: '0',
      recall_count: '0',
      selected_count: '0',
      used_in_answer_count: '0',
      first_selected_at: null,
      last_recalled_at: null,
      avg_selected_score: null,
    }]));
    const result = await getMemoryHealthReport();
    expect(result.nodes[0].classification).toBe('dead');
    expect(result.classification_summary.dead).toBe(1);
  });

  it('classifies node with recall_count>0 but selected_count=0 as noisy', async () => {
    mockSql.mockResolvedValue(makeResult([{
      node_uri: 'core://noisy/node',
      created_at: null,
      last_updated_at: null,
      update_count: '0',
      recall_count: '5',
      selected_count: '0',
      used_in_answer_count: '0',
      first_selected_at: null,
      last_recalled_at: null,
      avg_selected_score: null,
    }]));
    const result = await getMemoryHealthReport();
    expect(result.nodes[0].classification).toBe('noisy');
    expect(result.classification_summary.noisy).toBe(1);
  });

  it('classifies node with low conversion rate and >= 3 selected as underperforming', async () => {
    mockSql.mockResolvedValue(makeResult([{
      node_uri: 'core://underperforming/node',
      created_at: null,
      last_updated_at: null,
      update_count: '2',
      recall_count: '10',
      selected_count: '5',
      used_in_answer_count: '0',
      first_selected_at: null,
      last_recalled_at: null,
      avg_selected_score: '0.5',
    }]));
    const result = await getMemoryHealthReport();
    // conversion_rate = 0/5 = 0 < 0.1, selected_count=5 >= 3
    expect(result.nodes[0].classification).toBe('underperforming');
    expect(result.classification_summary.underperforming).toBe(1);
  });

  it('classifies node with good conversion as healthy', async () => {
    mockSql.mockResolvedValue(makeResult([{
      node_uri: 'core://healthy/node',
      created_at: null,
      last_updated_at: null,
      update_count: '1',
      recall_count: '10',
      selected_count: '8',
      used_in_answer_count: '5',
      first_selected_at: null,
      last_recalled_at: null,
      avg_selected_score: '0.9',
    }]));
    const result = await getMemoryHealthReport();
    // conversion_rate = 5/8 = 0.625 >= 0.1
    expect(result.nodes[0].classification).toBe('healthy');
    expect(result.classification_summary.healthy).toBe(1);
  });

  it('computes selection_rate and conversion_rate correctly', async () => {
    mockSql.mockResolvedValue(makeResult([{
      node_uri: 'core://rates/node',
      created_at: null,
      last_updated_at: null,
      update_count: '0',
      recall_count: '10',
      selected_count: '4',
      used_in_answer_count: '2',
      first_selected_at: null,
      last_recalled_at: null,
      avg_selected_score: null,
    }]));
    const result = await getMemoryHealthReport();
    const node = result.nodes[0];
    expect(node.selection_rate).toBe(0.4);
    expect(node.conversion_rate).toBe(0.5);
  });

  it('computes days_to_first_recall when both dates present', async () => {
    mockSql.mockResolvedValue(makeResult([{
      node_uri: 'core://timing/node',
      created_at: '2025-01-01T00:00:00Z',
      last_updated_at: null,
      update_count: '0',
      recall_count: '1',
      selected_count: '1',
      used_in_answer_count: '1',
      first_selected_at: '2025-01-04T00:00:00Z',
      last_recalled_at: '2025-01-04T00:00:00Z',
      avg_selected_score: '0.8',
    }]));
    const result = await getMemoryHealthReport();
    expect(result.nodes[0].days_to_first_recall).toBe(3);
  });

  it('sets days_to_first_recall to null when dates missing', async () => {
    mockSql.mockResolvedValue(makeResult([{
      node_uri: 'core://no-timing/node',
      created_at: null,
      last_updated_at: null,
      update_count: '0',
      recall_count: '1',
      selected_count: '1',
      used_in_answer_count: '0',
      first_selected_at: null,
      last_recalled_at: null,
      avg_selected_score: null,
    }]));
    const result = await getMemoryHealthReport();
    expect(result.nodes[0].days_to_first_recall).toBeNull();
  });

  it('uses default window_days=30', async () => {
    mockSql.mockResolvedValue(makeResult([]));
    const result = await getMemoryHealthReport();
    expect(result.window_days).toBe(30);
  });

  it('respects custom days parameter within range', async () => {
    mockSql.mockResolvedValue(makeResult([]));
    const result = await getMemoryHealthReport({ days: 7 });
    expect(result.window_days).toBe(7);
  });

  it('passes correct params to sql (safeDays, safeLimit)', async () => {
    mockSql.mockResolvedValue(makeResult([]));
    await getMemoryHealthReport({ days: 14, limit: 50 });
    const sqlParams = mockSql.mock.calls[0][1];
    expect(sqlParams![0]).toBe(14);
    expect(sqlParams![1]).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// getDeadWrites
// ---------------------------------------------------------------------------

describe('getDeadWrites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty report when no rows', async () => {
    mockSql.mockResolvedValue(makeResult([]));
    const result = await getDeadWrites();
    expect(result.total_dead_writes).toBe(0);
    expect(result.dead_writes).toHaveLength(0);
  });

  it('returns window_days=30 by default', async () => {
    mockSql.mockResolvedValue(makeResult([]));
    const result = await getDeadWrites();
    expect(result.window_days).toBe(30);
  });

  it('diagnoses never_retrieved for nodes not in near-miss', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult([{
        node_uri: 'core://forgotten/node',
        created_at: '2025-01-01T00:00:00Z',
        source: 'mcp',
        domain: 'core',
        write_event_count: '1',
        last_write_at: '2025-01-01T00:00:00Z',
      }]))
      .mockResolvedValueOnce(makeResult([])); // near-miss empty

    const result = await getDeadWrites();
    expect(result.dead_writes[0].diagnosis).toBe('never_retrieved');
    expect(result.dead_writes[0].recall_appearances).toBe(0);
  });

  it('diagnoses retrieved_not_selected for nodes in near-miss', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult([{
        node_uri: 'core://near-miss/node',
        created_at: '2025-01-01T00:00:00Z',
        source: 'api',
        domain: 'core',
        write_event_count: '2',
        last_write_at: '2025-01-02T00:00:00Z',
      }]))
      .mockResolvedValueOnce(makeResult([{
        node_uri: 'core://near-miss/node',
        recall_appearances: '3',
        avg_score_when_seen: '0.45',
      }]));

    const result = await getDeadWrites();
    const entry = result.dead_writes[0];
    expect(entry.diagnosis).toBe('retrieved_not_selected');
    expect(entry.recall_appearances).toBe(3);
    expect(entry.avg_score_when_seen).toBe(0.45);
  });

  it('issues two parallel sql calls', async () => {
    mockSql.mockResolvedValue(makeResult([]));
    await getDeadWrites();
    // ensureRecallEventsTable + ensureMemoryEventsTable are mocked, so only the 2 data queries
    expect(mockSql.mock.calls.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// getPathEffectiveness
// ---------------------------------------------------------------------------

describe('getPathEffectiveness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty paths and no recommendations when no rows', async () => {
    mockSql.mockResolvedValue(makeResult([]));
    const result = await getPathEffectiveness();
    expect(result.paths).toHaveLength(0);
    expect(result.recommendations).toHaveLength(0);
    expect(result.window_days).toBe(30);
  });

  it('computes selection_rate and usage_rate from counts', async () => {
    mockSql.mockResolvedValue(makeResult([{
      retrieval_path: 'dense',
      total_appearances: '20',
      selected_count: '10',
      used_count: '4',
      avg_score_overall: '0.6',
      avg_score_when_selected: '0.7',
      avg_score_when_used: '0.8',
      avg_score_when_not_selected: '0.4',
      avg_pre_rank_score: '0.5',
      avg_pre_rank_when_selected: '0.55',
      distinct_nodes: '8',
      distinct_selected_nodes: '5',
    }]));
    const result = await getPathEffectiveness();
    const p = result.paths[0];
    expect(p.selection_rate).toBe(0.5);
    expect(p.usage_rate).toBe(0.4);
    expect(p.distinct_nodes).toBe(8);
  });

  it('generates decrease_weight recommendation for low selection rate', async () => {
    mockSql.mockResolvedValue(makeResult([{
      retrieval_path: 'lexical',
      total_appearances: '20',
      selected_count: '2',
      used_count: '1',
      avg_score_overall: '0.4',
      avg_score_when_selected: null,
      avg_score_when_used: null,
      avg_score_when_not_selected: null,
      avg_pre_rank_score: null,
      avg_pre_rank_when_selected: null,
      distinct_nodes: '10',
      distinct_selected_nodes: '2',
    }]));
    const result = await getPathEffectiveness();
    // selection_rate = 2/20 = 0.1 < 0.15, total_appearances=20 >= 10
    const rec = result.recommendations.find((r) => r.action === 'decrease_weight');
    expect(rec).toBeDefined();
    expect(rec?.path).toBe('lexical');
    expect(rec?.severity).toBe('medium');
  });

  it('generates increase_weight recommendation for high usage rate', async () => {
    mockSql.mockResolvedValue(makeResult([{
      retrieval_path: 'exact',
      total_appearances: '10',
      selected_count: '8',
      used_count: '6',
      avg_score_overall: '0.9',
      avg_score_when_selected: '0.9',
      avg_score_when_used: '0.9',
      avg_score_when_not_selected: '0.3',
      avg_pre_rank_score: '0.85',
      avg_pre_rank_when_selected: '0.88',
      distinct_nodes: '6',
      distinct_selected_nodes: '5',
    }]));
    const result = await getPathEffectiveness();
    // usage_rate = 6/8 = 0.75 > 0.5, selected_count=8 >= 5
    const rec = result.recommendations.find((r) => r.action === 'increase_weight');
    expect(rec).toBeDefined();
    expect(rec?.severity).toBe('low');
  });

  it('generates review_threshold recommendation for high score lift', async () => {
    mockSql.mockResolvedValue(makeResult([{
      retrieval_path: 'dense',
      total_appearances: '15',
      selected_count: '8',
      used_count: '5',
      avg_score_overall: '0.5',
      avg_score_when_selected: '0.7',
      avg_score_when_used: '0.85',          // avg_score_when_used
      avg_score_when_not_selected: '0.45',  // scoreLift = 0.85 - 0.45 = 0.4 > 0.3
      avg_pre_rank_score: '0.5',
      avg_pre_rank_when_selected: '0.6',
      distinct_nodes: '10',
      distinct_selected_nodes: '7',
    }]));
    const result = await getPathEffectiveness();
    // scoreLift = 0.85 - 0.45 = 0.4 > 0.3, used_count=5 >= 3
    const rec = result.recommendations.find((r) => r.action === 'review_threshold');
    expect(rec).toBeDefined();
    expect(rec?.severity).toBe('info');
  });

  it('returns null scores for null DB values', async () => {
    // asNumber(null) → Number(null) = 0, which is finite, so returns 0 not null.
    // Only non-finite values (NaN, Infinity, undefined, non-numeric strings) return null.
    mockSql.mockResolvedValue(makeResult([{
      retrieval_path: 'exact',
      total_appearances: '5',
      selected_count: '3',
      used_count: '1',
      avg_score_overall: undefined,        // asNumber(undefined) → null
      avg_score_when_selected: undefined,
      avg_score_when_used: undefined,
      avg_score_when_not_selected: 'not-a-number', // asNumber('not-a-number') → null
      avg_pre_rank_score: undefined,
      avg_pre_rank_when_selected: undefined,
      distinct_nodes: '3',
      distinct_selected_nodes: '3',
    }]));
    const result = await getPathEffectiveness();
    const p = result.paths[0];
    expect(p.avg_score_overall).toBeNull();
    expect(p.avg_score_when_used).toBeNull();
    expect(p.avg_score_when_not_selected).toBeNull();
  });
});
