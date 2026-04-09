import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db', () => ({ sql: vi.fn() }));

import { sql } from '../../../db';
import { bootView } from '../boot';

const mockSql = vi.mocked(sql);

describe('bootView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CORE_MEMORY_URIS;
  });

  it('returns object with core_memories and recent_memories arrays', async () => {
    mockSql
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'uuid-1', priority: 5, disclosure: null, content: 'Hello world' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const result = await bootView('core://some/path');
    expect(result).toHaveProperty('core_memories');
    expect(result).toHaveProperty('recent_memories');
    expect(Array.isArray(result.core_memories)).toBe(true);
    expect(Array.isArray(result.recent_memories)).toBe(true);
  });

  it('handles empty database (no rows)', async () => {
    mockSql
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const result = await bootView('core://missing/node');
    expect(result.loaded).toBe(0);
    expect(result.total).toBe(1);
    expect(result.core_memories).toHaveLength(0);
    expect(result.recent_memories).toHaveLength(0);
    expect(result.failed).toContain('- core://missing/node: not found');
  });

  it('returns correct counts for loaded vs total', async () => {
    mockSql
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'u1', priority: 1, disclosure: null, content: 'A' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const result = await bootView('core://found/node,core://missing/node');
    expect(result.total).toBe(2);
    expect(result.loaded).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toContain('core://missing/node: not found');
  });

  it('correctly populates core_memories fields', async () => {
    const ts = new Date('2025-01-01T00:00:00Z');
    mockSql
      .mockResolvedValueOnce({
        rows: [{ node_uuid: 'abc-123', priority: 8, disclosure: 'when asked', content: 'Core content' }],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const result = await bootView('core://my/node');
    expect(result.core_memories[0]).toEqual({
      uri: 'core://my/node',
      content: 'Core content',
      priority: 8,
      disclosure: 'when asked',
      node_uuid: 'abc-123',
    });
  });

  it('correctly populates recent_memories fields', async () => {
    const ts = new Date('2025-06-15T12:00:00Z');
    // No URIs → only one SQL call (recent query)
    mockSql.mockResolvedValueOnce({
      rows: [{ domain: 'core', path: 'recent/item', priority: 3, disclosure: null, created_at: ts }],
      rowCount: 1,
    } as any);

    const result = await bootView('');
    expect(result.recent_memories[0]).toEqual({
      uri: 'core://recent/item',
      priority: 3,
      disclosure: null,
      created_at: ts.toISOString(),
    });
  });

  it('handles null created_at in recent memories', async () => {
    // No URIs → only one SQL call (recent query)
    mockSql.mockResolvedValueOnce({
      rows: [{ domain: 'core', path: 'some/path', priority: 1, disclosure: null, created_at: null }],
      rowCount: 1,
    } as any);

    const result = await bootView('');
    expect(result.recent_memories[0].created_at).toBeNull();
  });

  it('reads CORE_MEMORY_URIS from env when no arg provided', async () => {
    process.env.CORE_MEMORY_URIS = 'core://env/node';
    mockSql
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'env-uuid', priority: 2, disclosure: null, content: 'env content' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const result = await bootView();
    expect(result.total).toBe(1);
    expect(result.loaded).toBe(1);
    expect(result.core_memories[0].uri).toBe('core://env/node');
  });

  it('adds failed entries when SQL throws', async () => {
    mockSql
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const result = await bootView('core://broken/node');
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toContain('connection refused');
    expect(result.loaded).toBe(0);
  });

  it('returns empty arrays with no URIs configured', async () => {
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const result = await bootView('');
    expect(result.total).toBe(0);
    expect(result.loaded).toBe(0);
    expect(result.core_memories).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });
});
