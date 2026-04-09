import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db', () => ({ sql: vi.fn() }));

import { sql } from '../../../db';
import { markSessionRead, listSessionReads, clearSessionReads } from '../session';

const mockSql = vi.mocked(sql);

describe('markSessionRead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts a new session read row and returns it', async () => {
    const now = new Date().toISOString();
    const expected = {
      session_id: 'sess-1',
      uri: 'core://some/node',
      node_uuid: 'node-uuid-1',
      session_key: null,
      source: 'tool:get_node',
      read_count: 1,
      first_read_at: now,
      last_read_at: now,
    };
    // getNodeUuidByPath lookup
    mockSql
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'node-uuid-1' }], rowCount: 1 } as any)
      // INSERT RETURNING
      .mockResolvedValueOnce({ rows: [expected], rowCount: 1 } as any);

    const result = await markSessionRead({ session_id: 'sess-1', uri: 'core://some/node' });
    expect(result).toEqual(expected);
  });

  it('skips path lookup when node_uuid is provided directly', async () => {
    const expected = {
      session_id: 'sess-2',
      uri: 'core://direct/node',
      node_uuid: 'direct-uuid',
      session_key: null,
      source: 'tool:get_node',
      read_count: 1,
      first_read_at: '2025-01-01T00:00:00.000Z',
      last_read_at: '2025-01-01T00:00:00.000Z',
    };
    mockSql.mockResolvedValueOnce({ rows: [expected], rowCount: 1 } as any);

    const result = await markSessionRead({
      session_id: 'sess-2',
      uri: 'core://direct/node',
      node_uuid: 'direct-uuid',
    });
    // Only one sql call (no lookup)
    expect(mockSql).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expected);
  });

  it('throws 404 error when node not found by path', async () => {
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    await expect(
      markSessionRead({ session_id: 'sess-3', uri: 'core://missing/node' })
    ).rejects.toThrow("Memory at 'core://missing/node' not found.");
  });

  it('uses custom source when provided', async () => {
    const node_uuid = 'custom-source-uuid';
    mockSql.mockResolvedValueOnce({
      rows: [{ session_id: 's', uri: 'core://x', node_uuid, session_key: null, source: 'api:browse', read_count: 1, first_read_at: '', last_read_at: '' }],
      rowCount: 1,
    } as any);

    await markSessionRead({
      session_id: 's',
      uri: 'core://x',
      node_uuid,
      source: 'api:browse',
    });

    const callArgs = mockSql.mock.calls[0];
    expect(callArgs[1]).toContain('api:browse');
  });

  it('passes session_key to sql', async () => {
    const node_uuid = 'sk-uuid';
    mockSql.mockResolvedValueOnce({
      rows: [{ session_id: 's', uri: 'core://y', node_uuid, session_key: 'my-key', source: 'tool:get_node', read_count: 1, first_read_at: '', last_read_at: '' }],
      rowCount: 1,
    } as any);

    await markSessionRead({
      session_id: 's',
      uri: 'core://y',
      node_uuid,
      session_key: 'my-key',
    });

    const callArgs = mockSql.mock.calls[0];
    expect(callArgs[1]).toContain('my-key');
  });
});

describe('listSessionReads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns rows ordered by last_read_at DESC', async () => {
    const rows = [
      { session_id: 'sess-1', uri: 'core://b', node_uuid: 'u2', session_key: null, source: 'tool:get_node', read_count: 1, first_read_at: '2025-01-02', last_read_at: '2025-01-02' },
      { session_id: 'sess-1', uri: 'core://a', node_uuid: 'u1', session_key: null, source: 'tool:get_node', read_count: 2, first_read_at: '2025-01-01', last_read_at: '2025-01-01' },
    ];
    mockSql.mockResolvedValueOnce({ rows, rowCount: 2 } as any);

    const result = await listSessionReads('sess-1');
    expect(result).toHaveLength(2);
    expect(result[0].uri).toBe('core://b');
    expect(result[1].uri).toBe('core://a');
  });

  it('returns empty array for session with no reads', async () => {
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const result = await listSessionReads('empty-session');
    expect(result).toEqual([]);
  });

  it('passes sessionId as parameter to sql', async () => {
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    await listSessionReads('my-session-id');
    expect(mockSql).toHaveBeenCalledWith(expect.any(String), ['my-session-id']);
  });
});

describe('clearSessionReads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns success result with cleared count', async () => {
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 3 } as any);

    const result = await clearSessionReads('sess-clear');
    expect(result).toEqual({ success: true, session_id: 'sess-clear', cleared: 3 });
  });

  it('issues DELETE query with sessionId parameter', async () => {
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    await clearSessionReads('sess-abc');
    expect(mockSql).toHaveBeenCalledWith(expect.stringContaining('DELETE'), ['sess-abc']);
  });

  it('returns cleared: 0 when no rows matched', async () => {
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const result = await clearSessionReads('empty-sess');
    expect(result.cleared).toBe(0);
    expect(result.success).toBe(true);
  });
});
