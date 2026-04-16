import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db', () => ({ sql: vi.fn() }));

import { sql } from '../../../db';
import { bootView, getBootNodeSpec, getBootUris, isBootUri } from '../boot';

const mockSql = vi.mocked(sql);

describe('boot helpers', () => {
  it('exposes fixed boot URIs in deterministic order', () => {
    expect(getBootUris()).toEqual(['core://agent', 'core://soul', 'preferences://user']);
  });

  it('returns metadata for boot node lookups', () => {
    expect(getBootNodeSpec('CORE://SOUL')).toMatchObject({
      uri: 'core://soul',
      role: 'soul',
      role_label: 'style / persona / self-definition',
      dream_protection: 'protected',
    });
    expect(isBootUri('preferences://user')).toBe(true);
    expect(isBootUri('project://user')).toBe(false);
  });
});

describe('bootView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CORE_MEMORY_URIS;
  });

  it('returns object with core_memories and recent_memories arrays', async () => {
    mockSql
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'uuid-agent', priority: 5, disclosure: null, content: 'Agent rules' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'uuid-soul', priority: 1, disclosure: 'always', content: 'Soul baseline' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'uuid-user', priority: 2, disclosure: null, content: 'User profile' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const result = await bootView();
    expect(result).toHaveProperty('core_memories');
    expect(result).toHaveProperty('recent_memories');
    expect(Array.isArray(result.core_memories)).toBe(true);
    expect(Array.isArray(result.recent_memories)).toBe(true);
    expect(result.total).toBe(3);
    expect(result.loaded).toBe(3);
    expect(result.core_memories).toHaveLength(3);
  });

  it('always uses the fixed boot manifest instead of CORE_MEMORY_URIS', async () => {
    process.env.CORE_MEMORY_URIS = 'core://env/node';
    mockSql
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'agent-uuid', priority: 0, disclosure: null, content: 'Agent content' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'soul-uuid', priority: 1, disclosure: null, content: 'Soul content' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'user-uuid', priority: 2, disclosure: null, content: 'User content' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const result = await bootView();
    expect(result.total).toBe(3);
    expect(result.core_memories.map((memory) => memory.uri)).toEqual(['core://agent', 'core://soul', 'preferences://user']);
  });

  it('reports missing fixed boot nodes and keeps total at manifest size', async () => {
    mockSql
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'soul-uuid', priority: 1, disclosure: null, content: 'Soul content' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const result = await bootView();
    expect(result.total).toBe(3);
    expect(result.loaded).toBe(1);
    expect(result.failed).toEqual([
      '- core://agent: not found',
      '- preferences://user: not found',
    ]);
  });

  it('correctly populates core_memories fields and boot metadata', async () => {
    mockSql
      .mockResolvedValueOnce({
        rows: [{ node_uuid: 'agent-uuid', priority: 8, disclosure: 'when asked', content: 'Agent constitution' }],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({
        rows: [{ node_uuid: 'soul-uuid', priority: 3, disclosure: 'always', content: 'Soul definition' }],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({
        rows: [{ node_uuid: 'user-uuid', priority: 2, disclosure: null, content: 'Stable user info' }],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const result = await bootView();
    expect(result.core_memories[0]).toEqual({
      uri: 'core://agent',
      content: 'Agent constitution',
      priority: 8,
      disclosure: 'when asked',
      node_uuid: 'agent-uuid',
      boot_role: 'agent',
      boot_role_label: 'workflow constraints',
      boot_purpose: 'Working rules, collaboration constraints, and execution protocol.',
    });
    expect(result.core_memories[2]).toMatchObject({
      uri: 'preferences://user',
      boot_role: 'user',
      boot_role_label: 'stable user definition',
    });
  });

  it('correctly populates recent_memories fields', async () => {
    const ts = new Date('2025-06-15T12:00:00Z');
    mockSql
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({
        rows: [{ domain: 'core', path: 'recent/item', priority: 3, disclosure: null, created_at: ts }],
        rowCount: 1,
      } as any);

    const result = await bootView();
    expect(result.recent_memories[0]).toEqual({
      uri: 'core://recent/item',
      priority: 3,
      disclosure: null,
      created_at: ts.toISOString(),
    });
  });

  it('handles null created_at in recent memories', async () => {
    mockSql
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({
        rows: [{ domain: 'core', path: 'some/path', priority: 1, disclosure: null, created_at: null }],
        rowCount: 1,
      } as any);

    const result = await bootView();
    expect(result.recent_memories[0].created_at).toBeNull();
  });

  it('adds failed entries when SQL throws for a boot node', async () => {
    mockSql
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const result = await bootView();
    expect(result.failed).toContain('- core://agent: connection refused');
    expect(result.loaded).toBe(0);
    expect(result.total).toBe(3);
  });
});
