import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db', () => ({ sql: vi.fn() }));
import { sql } from '../../../db';
import {
  logMemoryEvent,
  getWriteEventStats,
  getNodeWriteHistory,
} from '../writeEvents';

const mockSql = vi.mocked(sql);

// Helper: build a minimal QueryResult-like mock
function makeResult(rows: Record<string, unknown>[] = [], rowCount = rows.length) {
  return { rows, rowCount } as any;
}

// ---------------------------------------------------------------------------
// logMemoryEvent
// ---------------------------------------------------------------------------

describe('logMemoryEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // ensureMemoryEventsTable is cached, but since we reset mocks we still need
    // sql to succeed for the table-check path if it re-runs
    mockSql.mockResolvedValue(makeResult());
  });

  it('inserts a create event via pool-level sql', async () => {
    await logMemoryEvent({
      event_type: 'create',
      node_uri: 'core://agent/prefs',
      node_uuid: 'uuid-1',
      domain: 'core',
      path: 'agent/prefs',
      source: 'mcp:lore_create_node',
      session_id: 'sess-1',
      after_snapshot: { content: 'hello', priority: 2 },
      details: { test: true },
    });

    const insertCall = mockSql.mock.calls.find((c) => c[0].includes('INSERT INTO memory_events'));
    expect(insertCall).toBeDefined();
    const values = insertCall![1] as unknown[];
    expect(values[0]).toBe('create');
    expect(values[1]).toBe('core://agent/prefs');
    expect(values[2]).toBe('uuid-1');
    expect(values[6]).toBe('sess-1');
    expect(values[8]).toContain('hello'); // after_snapshot stringified
  });

  it('inserts an update event with before and after snapshots', async () => {
    await logMemoryEvent({
      event_type: 'update',
      node_uri: 'core://agent/prefs',
      before_snapshot: { content: 'old', priority: 2 },
      after_snapshot: { content: 'new', priority: 1 },
    });

    const insertCall = mockSql.mock.calls.find((c) => c[0].includes('INSERT INTO memory_events'));
    expect(insertCall).toBeDefined();
    const values = insertCall![1] as unknown[];
    expect(values[0]).toBe('update');
    expect(values[7]).toContain('old'); // before_snapshot
    expect(values[8]).toContain('new'); // after_snapshot
  });

  it('inserts a delete event with null snapshots', async () => {
    await logMemoryEvent({
      event_type: 'delete',
      node_uri: 'core://agent/prefs',
    });

    const insertCall = mockSql.mock.calls.find((c) => c[0].includes('INSERT INTO memory_events'));
    expect(insertCall).toBeDefined();
    const values = insertCall![1] as unknown[];
    expect(values[0]).toBe('delete');
    expect(values[7]).toBeNull(); // before_snapshot
    expect(values[8]).toBeNull(); // after_snapshot
  });

  it('uses client.query when a transaction client is provided', async () => {
    const mockClient = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };

    await logMemoryEvent({
      event_type: 'create',
      node_uri: 'core://test/node',
      client: mockClient as any,
    });

    expect(mockClient.query).toHaveBeenCalledOnce();
    const [query, values] = mockClient.query.mock.calls[0];
    expect(query).toContain('INSERT INTO memory_events');
    expect(values[0]).toBe('create');
  });

  it('does not call sql() for insert when client is provided', async () => {
    const mockClient = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    const sqlCallsBefore = mockSql.mock.calls.length;

    await logMemoryEvent({
      event_type: 'update',
      node_uri: 'core://test/node',
      client: mockClient as any,
    });

    // sql() should not have been called for the INSERT (only for ensureTable if needed)
    const insertCalls = mockSql.mock.calls.slice(sqlCallsBefore).filter((c) => c[0].includes('INSERT INTO memory_events'));
    expect(insertCalls).toHaveLength(0);
  });

  it('persists normalized client_type into details', async () => {
    await logMemoryEvent({
      event_type: 'create',
      node_uri: 'core://agent/prefs',
      client_type: 'ClaudeCode',
      details: { test: true },
    });

    const insertCall = mockSql.mock.calls.find((c) => c[0].includes('INSERT INTO memory_events'));
    const values = insertCall![1] as unknown[];
    expect(JSON.parse(values[9] as string)).toMatchObject({ test: true, client_type: 'claudecode' });
  });

  it('does not persist invalid client_type values', async () => {
    await logMemoryEvent({
      event_type: 'create',
      node_uri: 'core://agent/prefs',
      client_type: 'web',
      details: { test: true },
    });

    const insertCall = mockSql.mock.calls.find((c) => c[0].includes('INSERT INTO memory_events'));
    const values = insertCall![1] as unknown[];
    expect(JSON.parse(values[9] as string)).toEqual({ test: true });
  });

  it('uses default values for optional fields', async () => {
    await logMemoryEvent({
      event_type: 'create',
      node_uri: 'core://defaults',
    });

    const insertCall = mockSql.mock.calls.find((c) => c[0].includes('INSERT INTO memory_events'));
    expect(insertCall).toBeDefined();
    const values = insertCall![1] as unknown[];
    expect(values[2]).toBeNull();
    expect(values[3]).toBe('core');
    expect(values[4]).toBe('');
    expect(values[5]).toBe('unknown');
    expect(values[6]).toBeNull();
    expect(values[9]).toBe('{}');
  });
});

// ---------------------------------------------------------------------------
// getWriteEventStats
// ---------------------------------------------------------------------------

describe('getWriteEventStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupStatsMocks(overrides?: {
    summary?: Record<string, unknown>;
    byType?: Record<string, unknown>[];
    bySource?: Record<string, unknown>[];
    hotNodes?: Record<string, unknown>[];
    recent?: Record<string, unknown>[];
  }) {
    const now = new Date().toISOString();
    // ensureMemoryEventsTable calls (may already be cached)
    // Promise.all fires 5 concurrent sql() calls
    mockSql
      .mockResolvedValueOnce(makeResult([{ total_events: '10', distinct_nodes: '3', last_event_at: now, ...(overrides?.summary || {}) }]))
      .mockResolvedValueOnce(makeResult(overrides?.byType || [{ event_type: 'create', total: '7' }, { event_type: 'update', total: '3' }]))
      .mockResolvedValueOnce(makeResult(overrides?.bySource || [{ source: 'mcp', total: '10' }]))
      .mockResolvedValueOnce(makeResult(overrides?.hotNodes || [{ node_uri: 'core://a/b', total: '5', creates: '3', updates: '2', deletes: '0', last_event_at: now }]))
      .mockResolvedValueOnce(makeResult(overrides?.recent || []));
  }

  it('returns summary aggregation for default window', async () => {
    setupStatsMocks();
    const result = await getWriteEventStats();

    expect(result.window_days).toBe(7);
    expect(result.summary.total_events).toBe(10);
    expect(result.summary.distinct_nodes).toBe(3);
    expect(result.filters).toBeNull();
  });

  it('returns by_event_type breakdown', async () => {
    setupStatsMocks();
    const result = await getWriteEventStats();

    expect(result.by_event_type).toHaveLength(2);
    expect(result.by_event_type[0]).toEqual({ event_type: 'create', total: 7 });
    expect(result.by_event_type[1]).toEqual({ event_type: 'update', total: 3 });
  });

  it('returns hot_nodes with numeric counts', async () => {
    setupStatsMocks();
    const result = await getWriteEventStats();

    expect(result.hot_nodes).toHaveLength(1);
    const node = result.hot_nodes[0];
    expect(node.node_uri).toBe('core://a/b');
    expect(node.total).toBe(5);
    expect(node.creates).toBe(3);
    expect(node.updates).toBe(2);
    expect(node.deletes).toBe(0);
  });

  it('populates filters object when eventType filter is applied', async () => {
    setupStatsMocks();
    const result = await getWriteEventStats({ eventType: 'create' });

    expect(result.filters).not.toBeNull();
    expect(result.filters?.event_type).toBe('create');
    expect(result.filters?.node_uri).toBeNull();
    expect(result.filters?.source).toBeNull();
  });

  it('clamps days to allowed range (1–90)', async () => {
    setupStatsMocks();
    const result = await getWriteEventStats({ days: 200 });
    // clampLimit(200, 1, 90, 7) => 90
    expect(result.window_days).toBe(90);
  });

  it('returns null last_event_at when no events exist', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult([{ total_events: '0', distinct_nodes: '0', last_event_at: null }]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([]));

    const result = await getWriteEventStats();
    expect(result.summary.last_event_at).toBeNull();
    expect(result.summary.total_events).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getNodeWriteHistory
// ---------------------------------------------------------------------------

describe('getNodeWriteHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty history when neither nodeUri nor nodeUuid is provided', async () => {
    const result = await getNodeWriteHistory({});
    expect(result).toEqual({ events: [] });
    // sql should not have been called for the history query
    const historyCalls = mockSql.mock.calls.filter((c) => c[0].includes('SELECT id, event_type'));
    expect(historyCalls).toHaveLength(0);
  });

  it('queries by nodeUri and returns ordered timeline', async () => {
    mockSql.mockResolvedValue(makeResult());
    const now = new Date().toISOString();
    const rows = [
      { id: '1', event_type: 'create', node_uri: 'core://a/b', node_uuid: 'u1', domain: 'core', path: 'a/b', source: 'mcp', session_id: null, before_snapshot: null, after_snapshot: { content: 'hi' }, details: {}, created_at: now },
      { id: '2', event_type: 'update', node_uri: 'core://a/b', node_uuid: 'u1', domain: 'core', path: 'a/b', source: 'api', session_id: 's1', before_snapshot: { content: 'hi' }, after_snapshot: { content: 'bye' }, details: { reason: 'test' }, created_at: now },
    ];
    mockSql.mockResolvedValue(makeResult(rows));

    const result = await getNodeWriteHistory({ nodeUri: 'core://a/b' });
    expect(result).toHaveProperty('events');
    const r = result as { node_uri: string | null; node_uuid: string | null; events: unknown[] };
    expect(r.node_uri).toBe('core://a/b');
    expect(r.events).toHaveLength(2);
    expect((r.events[0] as any).event_type).toBe('create');
    expect((r.events[1] as any).event_type).toBe('update');
  });

  it('queries by nodeUuid when nodeUri is not given', async () => {
    mockSql.mockResolvedValue(makeResult());
    const rows = [
      { id: '3', event_type: 'delete', node_uri: 'core://x/y', node_uuid: 'uuid-x', domain: 'core', path: 'x/y', source: 'mcp', session_id: null, before_snapshot: null, after_snapshot: null, details: {}, created_at: null },
    ];
    mockSql.mockResolvedValue(makeResult(rows));

    const result = await getNodeWriteHistory({ nodeUuid: 'uuid-x' });
    const r = result as { node_uri: string | null; node_uuid: string | null; events: unknown[] };
    expect(r.node_uuid).toBe('uuid-x');
    expect(r.node_uri).toBeNull();
    expect(r.events).toHaveLength(1);
  });

  it('returns formatted events with numeric ids and ISO timestamps', async () => {
    mockSql.mockResolvedValue(makeResult());
    const ts = '2025-06-01T12:00:00.000Z';
    const rows = [
      { id: '42', event_type: 'create', node_uri: 'core://p/q', node_uuid: null, domain: 'core', path: 'p/q', source: 'test', session_id: null, before_snapshot: null, after_snapshot: null, details: {}, created_at: ts },
    ];
    mockSql.mockResolvedValue(makeResult(rows));

    const result = await getNodeWriteHistory({ nodeUri: 'core://p/q' });
    const r = result as { events: any[] };
    expect(r.events[0].id).toBe(42);
    expect(r.events[0].created_at).toBe(new Date(ts).toISOString());
  });
});
