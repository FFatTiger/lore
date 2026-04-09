import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db', () => ({ sql: vi.fn() }));
import { sql } from '../../../db';
import {
  logRecallEvents,
  markRecallEventsUsedInAnswer,
  intervalDaysSql,
  asNumber,
  asObject,
  normalizeUriList,
  truncateText,
} from '../recallEventLog';

const mockSql = vi.mocked(sql);

function makeResult(rows: Record<string, unknown>[] = [], rowCount = rows.length) {
  return { rows, rowCount } as any;
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

describe('intervalDaysSql', () => {
  it('clamps to range 1..90 with default 7', () => {
    expect(intervalDaysSql(0)).toBe(7); // 0 is falsy, fallback kicks in
    expect(intervalDaysSql(-5)).toBe(1); // -5 is a valid number, clamped to min
    expect(intervalDaysSql(30)).toBe(30);
    expect(intervalDaysSql(200)).toBe(90);
    expect(intervalDaysSql(null)).toBe(7);
    expect(intervalDaysSql(undefined)).toBe(7);
  });
});

describe('asNumber', () => {
  it('returns finite numbers', () => {
    expect(asNumber(42)).toBe(42);
    expect(asNumber(0)).toBe(0);
    expect(asNumber(3.14)).toBe(3.14);
    expect(asNumber(-1)).toBe(-1);
  });

  it('returns null for non-finite values', () => {
    expect(asNumber(NaN)).toBeNull();
    expect(asNumber(Infinity)).toBeNull();
    expect(asNumber(-Infinity)).toBeNull();
    expect(asNumber(undefined)).toBeNull();
    expect(asNumber('abc')).toBeNull();
  });

  it('coerces string numbers', () => {
    expect(asNumber('123')).toBe(123);
    expect(asNumber('0')).toBe(0);
  });
});

describe('asObject', () => {
  it('returns the object if value is an object', () => {
    const obj = { a: 1 };
    expect(asObject(obj)).toBe(obj);
  });

  it('returns empty object for non-objects', () => {
    expect(asObject(null)).toEqual({});
    expect(asObject(undefined)).toEqual({});
    expect(asObject(42)).toEqual({});
    expect(asObject('hello')).toEqual({});
  });
});

describe('normalizeUriList', () => {
  it('deduplicates and trims URIs', () => {
    expect(normalizeUriList(['a', ' b ', 'a', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('filters out empty strings and falsy values', () => {
    expect(normalizeUriList(['', null, undefined, 'x'])).toEqual(['x']);
  });

  it('returns empty array for non-array input', () => {
    expect(normalizeUriList(null)).toEqual([]);
    expect(normalizeUriList('string')).toEqual([]);
    expect(normalizeUriList(undefined)).toEqual([]);
  });
});

describe('truncateText', () => {
  it('returns empty string for falsy input', () => {
    expect(truncateText('')).toBe('');
    expect(truncateText(null)).toBe('');
    expect(truncateText(undefined)).toBe('');
  });

  it('collapses whitespace', () => {
    expect(truncateText('hello   world\n\tfoo')).toBe('hello world foo');
  });

  it('truncates long text with ellipsis', () => {
    const longText = 'a'.repeat(300);
    const result = truncateText(longText, 280);
    expect(result.length).toBe(280);
    expect(result.endsWith('\u2026')).toBe(true);
  });

  it('returns short text as-is', () => {
    expect(truncateText('short')).toBe('short');
  });
});

// ---------------------------------------------------------------------------
// logRecallEvents
// ---------------------------------------------------------------------------

describe('logRecallEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSql.mockResolvedValue(makeResult());
  });

  it('returns 0 for empty query', async () => {
    const result = await logRecallEvents({ queryText: '' });
    expect(result).toEqual({ inserted_count: 0 });
  });

  it('inserts exact rows', async () => {
    const result = await logRecallEvents({
      queryText: 'test query',
      exactRows: [{ uri: 'core://node1', exact_score: 0.9, weight: 1.0 }],
    });
    expect(result.inserted_count).toBe(1);
    expect(result.query_id).toBeDefined();
    // table init + insert
    const insertCalls = mockSql.mock.calls.filter(([q]) =>
      typeof q === 'string' && q.includes('INSERT INTO recall_events'),
    );
    expect(insertCalls).toHaveLength(1);
    const params = insertCalls[0][1] as unknown[];
    expect(params[0]).toBe('test query');
    expect(params[1]).toBe('core://node1');
    expect(params[2]).toBe('exact');
  });

  it('inserts glossary_semantic rows', async () => {
    const result = await logRecallEvents({
      queryText: 'glossary test',
      glossarySemanticRows: [{ uri: 'core://node2', glossary_semantic_score: 0.8, keyword: 'key' }],
    });
    expect(result.inserted_count).toBe(1);
    const insertCalls = mockSql.mock.calls.filter(([q]) =>
      typeof q === 'string' && q.includes('INSERT INTO recall_events'),
    );
    const params = insertCalls[0][1] as unknown[];
    expect(params[2]).toBe('glossary_semantic');
  });

  it('inserts dense rows', async () => {
    const result = await logRecallEvents({
      queryText: 'dense test',
      denseRows: [{ uri: 'core://node3', semantic_score: 0.7, weight: 1.2 }],
    });
    expect(result.inserted_count).toBe(1);
    const insertCalls = mockSql.mock.calls.filter(([q]) =>
      typeof q === 'string' && q.includes('INSERT INTO recall_events'),
    );
    const params = insertCalls[0][1] as unknown[];
    expect(params[2]).toBe('dense');
  });

  it('inserts lexical rows with flags', async () => {
    const result = await logRecallEvents({
      queryText: 'lexical test',
      lexicalRows: [{ uri: 'core://node4', lexical_score: 0.6, weight: 1, fts_hit: true, text_hit: false, uri_hit: true }],
    });
    expect(result.inserted_count).toBe(1);
    const insertCalls = mockSql.mock.calls.filter(([q]) =>
      typeof q === 'string' && q.includes('INSERT INTO recall_events'),
    );
    const params = insertCalls[0][1] as unknown[];
    expect(params[2]).toBe('lexical');
    const meta = JSON.parse(params[7] as string);
    expect(meta.lexical_flags.fts_hit).toBe(true);
    expect(meta.lexical_flags.uri_hit).toBe(true);
    expect(meta.lexical_flags.text_hit).toBe(false);
  });

  it('inserts multiple signal types in one call', async () => {
    const result = await logRecallEvents({
      queryText: 'multi signal',
      exactRows: [{ uri: 'core://a', exact_score: 1 }],
      denseRows: [{ uri: 'core://b', semantic_score: 0.5 }],
      lexicalRows: [{ uri: 'core://c', lexical_score: 0.3 }],
    });
    expect(result.inserted_count).toBe(3);
  });

  it('marks selected when URI is in displayedItems', async () => {
    await logRecallEvents({
      queryText: 'selected test',
      exactRows: [{ uri: 'core://sel' }],
      displayedItems: [{ uri: 'core://sel' }],
    });
    const insertCalls = mockSql.mock.calls.filter(([q]) =>
      typeof q === 'string' && q.includes('INSERT INTO recall_events'),
    );
    const params = insertCalls[0][1] as unknown[];
    expect(params[6]).toBe(true); // selected
  });

  it('uses provided queryId', async () => {
    const result = await logRecallEvents({
      queryId: 'custom-id-123',
      queryText: 'id test',
      exactRows: [{ uri: 'core://x' }],
    });
    expect(result.query_id).toBe('custom-id-123');
    const insertCalls = mockSql.mock.calls.filter(([q]) =>
      typeof q === 'string' && q.includes('INSERT INTO recall_events'),
    );
    const meta = JSON.parse(insertCalls[0][1]![7] as string);
    expect(meta.query_id).toBe('custom-id-123');
  });

  it('skips rows with empty uri', async () => {
    const result = await logRecallEvents({
      queryText: 'skip empty',
      exactRows: [{ uri: '' }, { uri: '  ' }, { uri: 'core://valid' }],
    });
    expect(result.inserted_count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// markRecallEventsUsedInAnswer
// ---------------------------------------------------------------------------

describe('markRecallEventsUsedInAnswer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSql.mockResolvedValue(makeResult([], 0));
  });

  it('returns 0 for empty queryId', async () => {
    const result = await markRecallEventsUsedInAnswer({ queryId: '' });
    expect(result).toEqual({ updated_count: 0, query_id: null });
  });

  it('returns 0 when success is false', async () => {
    const result = await markRecallEventsUsedInAnswer({ queryId: 'q1', success: false });
    expect(result).toEqual({ updated_count: 0, query_id: 'q1' });
  });

  it('updates matching rows', async () => {
    mockSql.mockResolvedValue({ rows: [], rowCount: 3 } as any);
    const result = await markRecallEventsUsedInAnswer({
      queryId: 'q-abc',
      nodeUris: ['core://a', 'core://b'],
      assistantText: 'The answer is 42',
      source: 'agent_end',
      success: true,
    });
    expect(result.updated_count).toBe(3);
    expect(result.query_id).toBe('q-abc');
    expect(result.node_uris).toEqual(['core://a', 'core://b']);

    const updateCalls = mockSql.mock.calls.filter(([q]) =>
      typeof q === 'string' && q.includes('UPDATE recall_events'),
    );
    expect(updateCalls).toHaveLength(1);
  });

  it('includes answer_preview in metadata patch when text is provided', async () => {
    mockSql.mockResolvedValue({ rows: [], rowCount: 1 } as any);
    await markRecallEventsUsedInAnswer({
      queryId: 'q-preview',
      assistantText: 'Some answer text',
      success: true,
    });
    const updateCalls = mockSql.mock.calls.filter(([q]) =>
      typeof q === 'string' && q.includes('UPDATE recall_events'),
    );
    const metaPatch = JSON.parse(updateCalls[0][1]![2] as string);
    expect(metaPatch.answer_preview).toBe('Some answer text');
    expect(metaPatch.answer_signal_source).toBe('agent_end');
  });

  it('passes null for empty nodeUris', async () => {
    mockSql.mockResolvedValue({ rows: [], rowCount: 0 } as any);
    await markRecallEventsUsedInAnswer({ queryId: 'q-no-uris', success: true });
    const updateCalls = mockSql.mock.calls.filter(([q]) =>
      typeof q === 'string' && q.includes('UPDATE recall_events'),
    );
    const params = updateCalls[0][1] as unknown[];
    expect(params[1]).toBeNull(); // null = no URI filter
  });
});
