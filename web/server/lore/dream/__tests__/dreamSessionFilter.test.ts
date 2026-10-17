import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db', () => ({ sql: vi.fn() }));
vi.mock('../../config/settings', () => ({ getSettings: vi.fn() }));

import { sql } from '../../../db';
import { getSettings } from '../../config/settings';
import {
  collectExcludedDreamQueryIds,
  dreamSessionMatches,
  filterDreamRecallReview,
  loadDreamSessionFilter,
} from '../dreamSessionFilter';

const mockSql = vi.mocked(sql);
const mockGetSettings = vi.mocked(getSettings);

function makeResult(rows: Record<string, unknown>[] = []) {
  return { rows, rowCount: rows.length } as any;
}

describe('loadDreamSessionFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('compiles the configured patterns', async () => {
    mockGetSettings.mockResolvedValueOnce({ 'dream.exclude_session_patterns': ['^bot-', 'e2e'] });
    const filter = await loadDreamSessionFilter();
    expect(filter.patterns).toHaveLength(2);
    expect(dreamSessionMatches(filter, 'bot-session-1')).toBe(true);
    expect(dreamSessionMatches(filter, 'daily work')).toBe(false);
  });

  it('treats a missing or empty setting as no filter', async () => {
    mockGetSettings.mockResolvedValueOnce({ 'dream.exclude_session_patterns': [] });
    expect((await loadDreamSessionFilter()).patterns).toHaveLength(0);
    mockGetSettings.mockRejectedValueOnce(new Error('settings down'));
    expect((await loadDreamSessionFilter()).patterns).toHaveLength(0);
  });

  it('skips stale invalid patterns instead of failing', async () => {
    mockGetSettings.mockResolvedValueOnce({ 'dream.exclude_session_patterns': ['([', 'e2e'] });
    const filter = await loadDreamSessionFilter();
    expect(filter.patterns).toHaveLength(1);
    expect(dreamSessionMatches(filter, 'e2e-run')).toBe(true);
  });
});

describe('collectExcludedDreamQueryIds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('excludes every query of a session when any query text matches', async () => {
    mockSql.mockResolvedValueOnce(makeResult([
      { query_id: 'q1', session_id: 'bot-1', query_text: 'hello' },
      { query_id: 'q2', session_id: 'bot-1', query_text: 'e2e smoke test' },
      { query_id: 'q3', session_id: 'human-1', query_text: 'real question' },
      { query_id: 'q4', session_id: '', query_text: 'bot probe' },
    ]));
    const filter = { patterns: [/e2e/, /^bot/] };
    const excluded = await collectExcludedDreamQueryIds(filter, 1);
    expect([...excluded].sort()).toEqual(['q1', 'q2', 'q4']);
  });

  it('returns nothing when the filter is disabled', async () => {
    expect(await collectExcludedDreamQueryIds({ patterns: [] }, 1)).toEqual(new Set());
    expect(mockSql).not.toHaveBeenCalled();
  });
});

describe('filterDreamRecallReview', () => {
  it('drops excluded queries from the review and recent query lists', () => {
    const review = {
      date: '2026-05-07',
      queries: [
        { query_id: 'q1', content: 'keep' },
        { query_id: 'q2', content: 'drop' },
      ],
      recent_queries: {
        items: [{ query_id: 'q1' }, { query_id: 'q2' }],
        total: 2,
      },
    };
    const filtered = filterDreamRecallReview(review, new Set(['q2']));
    expect(filtered.queries).toEqual([{ query_id: 'q1', content: 'keep' }]);
    expect(filtered.recent_queries).toEqual({ items: [{ query_id: 'q1' }], total: 2 });
    expect(filtered.excluded_by_session_filter).toBe(2);
  });

  it('leaves the review untouched when nothing is excluded', () => {
    const review = { queries: [{ query_id: 'q1' }] };
    expect(filterDreamRecallReview(review, new Set())).toBe(review);
  });
});
