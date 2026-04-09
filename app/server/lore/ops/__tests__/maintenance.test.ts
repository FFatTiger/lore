import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to mock db before importing maintenance (which does dynamic import('../db'))
vi.mock('../../../db', () => {
  const mockClient = {
    query: vi.fn(),
    release: vi.fn(),
  };
  const mockPool = { connect: vi.fn().mockResolvedValue(mockClient) };
  return {
    sql: vi.fn(),
    getPool: vi.fn().mockReturnValue(mockPool),
  };
});

vi.mock('../../memory/writeEvents', () => ({ logMemoryEvent: vi.fn().mockResolvedValue(undefined) }));

import { sql, getPool } from '../../../db';
import { logMemoryEvent } from '../../memory/writeEvents';
import {
  listOrphans,
  getOrphanDetail,
  permanentlyDeleteDeprecatedMemory,
} from '../maintenance';

const mockSql = vi.mocked(sql);
const mockGetPool = vi.mocked(getPool);
const mockLogMemoryEvent = vi.mocked(logMemoryEvent);

function makeResult(rows: Record<string, unknown>[] = []) {
  return { rows, rowCount: rows.length } as any;
}

function getClientMock() {
  return mockGetPool().connect() as unknown as Promise<{
    query: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
  }>;
}

// ---------------------------------------------------------------------------
// listOrphans
// ---------------------------------------------------------------------------

describe('listOrphans', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when no deprecated memories', async () => {
    mockSql.mockResolvedValue(makeResult([]));
    const result = await listOrphans();
    expect(result).toEqual([]);
  });

  it('returns orphaned item (no migrated_to)', async () => {
    mockSql.mockResolvedValue(makeResult([{
      id: 1,
      content: 'Short content',
      created_at: '2025-01-01T00:00:00Z',
      deprecated: true,
      migrated_to: null,
    }]));
    const result = await listOrphans();
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('orphaned');
    expect(result[0].migration_target).toBeNull();
    expect(result[0].deprecated).toBe(true);
  });

  it('truncates long content to 200 chars with ellipsis', async () => {
    const longContent = 'x'.repeat(300);
    mockSql.mockResolvedValue(makeResult([{
      id: 2,
      content: longContent,
      created_at: null,
      deprecated: true,
      migrated_to: null,
    }]));
    const result = await listOrphans();
    expect(result[0].content_snippet).toHaveLength(203); // 200 + '...'
    expect(result[0].content_snippet.endsWith('...')).toBe(true);
  });

  it('returns deprecated item with migration_target when migrated_to is set', async () => {
    // First call: main query for orphans list
    // Second call: resolveMigrationChain -> SELECT memory
    // Third call: resolveMigrationChain -> SELECT paths
    mockSql
      .mockResolvedValueOnce(makeResult([{
        id: 10,
        content: 'Old content',
        created_at: '2025-01-01T00:00:00Z',
        deprecated: true,
        migrated_to: 20,
      }]))
      .mockResolvedValueOnce(makeResult([{
        id: 20,
        node_uuid: 'uuid-20',
        content: 'New content',
        created_at: '2025-02-01T00:00:00Z',
        deprecated: false,
        migrated_to: null,
      }]))
      .mockResolvedValueOnce(makeResult([
        { domain: 'core', path: 'soul/prefs' },
      ]));

    const result = await listOrphans();
    expect(result[0].category).toBe('deprecated');
    expect(result[0].migration_target).not.toBeNull();
    expect(result[0].migration_target!.id).toBe(20);
    expect(result[0].migration_target!.paths).toContain('core://soul/prefs');
  });

  it('sets created_at to null when db value is null', async () => {
    mockSql.mockResolvedValue(makeResult([{
      id: 3,
      content: 'Content',
      created_at: null,
      deprecated: true,
      migrated_to: null,
    }]));
    const result = await listOrphans();
    expect(result[0].created_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getOrphanDetail
// ---------------------------------------------------------------------------

describe('getOrphanDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when memory not found', async () => {
    mockSql.mockResolvedValue(makeResult([]));
    const result = await getOrphanDetail(999);
    expect(result).toBeNull();
  });

  it('returns active category for non-deprecated memory', async () => {
    mockSql.mockResolvedValue(makeResult([{
      id: 1,
      content: 'Active content',
      created_at: '2025-01-01T00:00:00Z',
      deprecated: false,
      migrated_to: null,
    }]));
    const result = await getOrphanDetail(1);
    expect(result).not.toBeNull();
    expect(result!.category).toBe('active');
    expect(result!.migration_target).toBeNull();
  });

  it('returns orphaned category for deprecated with no migration', async () => {
    mockSql.mockResolvedValue(makeResult([{
      id: 5,
      content: 'Orphaned memory content',
      created_at: '2025-01-01T00:00:00Z',
      deprecated: true,
      migrated_to: null,
    }]));
    const result = await getOrphanDetail(5);
    expect(result!.category).toBe('orphaned');
    expect(result!.deprecated).toBe(true);
  });

  it('resolves migration_target when migrated_to is set', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult([{
        id: 10,
        content: 'Deprecated content',
        created_at: '2025-01-01T00:00:00Z',
        deprecated: true,
        migrated_to: 11,
      }]))
      .mockResolvedValueOnce(makeResult([{
        id: 11,
        node_uuid: 'uuid-11',
        content: 'Current content',
        created_at: '2025-02-01T00:00:00Z',
        deprecated: false,
        migrated_to: null,
      }]))
      .mockResolvedValueOnce(makeResult([
        { domain: 'core', path: 'some/path' },
      ]));

    const result = await getOrphanDetail(10);
    expect(result!.category).toBe('deprecated');
    expect(result!.migration_target).not.toBeNull();
    expect(result!.migration_target!.id).toBe(11);
    expect(result!.migration_target!.content).toBe('Current content');
    expect(result!.migration_target!.paths).toContain('core://some/path');
  });
});

// ---------------------------------------------------------------------------
// permanentlyDeleteDeprecatedMemory
// ---------------------------------------------------------------------------

describe('permanentlyDeleteDeprecatedMemory', () => {
  let mockClient: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };
    // getPool().connect() returns mockClient
    (mockGetPool().connect as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
  });

  it('throws 404 when memory not found', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }); // SELECT → not found

    await expect(permanentlyDeleteDeprecatedMemory(999)).rejects.toMatchObject({
      message: expect.stringContaining('not found'),
    });
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('throws 409 when memory is active (not deprecated)', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 1, node_uuid: 'u1', deprecated: false, migrated_to: null }] }); // SELECT

    await expect(permanentlyDeleteDeprecatedMemory(1)).rejects.toMatchObject({
      message: expect.stringContaining('active'),
    });
  });

  it('deletes memory and repairs migration chain', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 5, node_uuid: 'uuid-5', deprecated: true, migrated_to: 10 }] }) // SELECT memory
      .mockResolvedValueOnce({ rows: [] }) // UPDATE migrated_to chain
      .mockResolvedValueOnce({ rows: [] }) // DELETE memory
      .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // COUNT remaining memories for node
      .mockResolvedValueOnce({ rows: [] }) // DELETE glossary_keywords
      .mockResolvedValueOnce({ rows: [] }) // DELETE paths
      .mockResolvedValueOnce({ rows: [] }) // DELETE edges
      .mockResolvedValueOnce({ rows: [] }) // DELETE nodes
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const result = await permanentlyDeleteDeprecatedMemory(5);
    expect(result.deleted_memory_id).toBe(5);
    expect(result.chain_repaired_to).toBe(10);
    expect(mockLogMemoryEvent).toHaveBeenCalledOnce();
    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  it('skips node cascade when other memories share the same node_uuid', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 6, node_uuid: 'shared-uuid', deprecated: true, migrated_to: null }] })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE chain
      .mockResolvedValueOnce({ rows: [] }) // DELETE memory
      .mockResolvedValueOnce({ rows: [{ count: '2' }] }) // 2 remaining → don't cascade
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const result = await permanentlyDeleteDeprecatedMemory(6);
    expect(result.deleted_memory_id).toBe(6);
    // Should NOT have called DELETE FROM nodes
    const calls = mockClient.query.mock.calls.map(([q]) => q as string);
    expect(calls.some((q) => q.includes('DELETE FROM nodes'))).toBe(false);
  });

  it('rolls back and rethrows on error', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockRejectedValueOnce(new Error('DB crash')); // SELECT fails

    await expect(permanentlyDeleteDeprecatedMemory(1)).rejects.toThrow('DB crash');
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// resolveMigrationChain (via listOrphans side-effects)
// ---------------------------------------------------------------------------

describe('resolveMigrationChain (via listOrphans)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('follows chain of migrated_to pointers to the live memory', async () => {
    // listOrphans main query
    mockSql
      .mockResolvedValueOnce(makeResult([{
        id: 1,
        content: 'A',
        created_at: null,
        deprecated: true,
        migrated_to: 2,
      }]))
      // resolveMigrationChain: first hop → also deprecated, migrated_to: 3
      .mockResolvedValueOnce(makeResult([{
        id: 2,
        node_uuid: null,
        content: 'B',
        created_at: null,
        deprecated: true,
        migrated_to: 3,
      }]))
      // resolveMigrationChain: second hop → final live memory
      .mockResolvedValueOnce(makeResult([{
        id: 3,
        node_uuid: 'uuid-3',
        content: 'C',
        created_at: null,
        deprecated: false,
        migrated_to: null,
      }]))
      // paths for node uuid-3
      .mockResolvedValueOnce(makeResult([{ domain: 'core', path: 'final/destination' }]));

    const result = await listOrphans();
    expect(result[0].migration_target!.id).toBe(3);
    expect(result[0].migration_target!.paths).toContain('core://final/destination');
  });

  it('returns null migration_target when chain leads to deleted memory', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult([{
        id: 1,
        content: 'A',
        created_at: null,
        deprecated: true,
        migrated_to: 99,
      }]))
      // resolveMigrationChain: memory 99 not found
      .mockResolvedValueOnce(makeResult([]));

    const result = await listOrphans();
    expect(result[0].migration_target).toBeNull();
  });
});
