import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../db', () => ({ sql: vi.fn(), getPool: vi.fn() }));
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    unlink: vi.fn(),
  },
}));

import { sql, getPool } from '../../../db';
import fs from 'fs/promises';
import {
  listReviewGroups,
  getReviewGroupDiff,
  approveReviewGroup,
  rollbackReviewGroup,
  clearAllReviewGroups,
  _makeRowKey,
  _rowsEqual,
  _getAllRows,
  _getChangedRows,
  _resolveNodeUuidSync,
  _extractTopTable,
  _getTableColumns,
  _getPkColumns,
} from '../review';

const mockSql = vi.mocked(sql);
const mockGetPool = vi.mocked(getPool);
const mockFs = vi.mocked(fs);

function makeResult(rows: Record<string, unknown>[] = [], rowCount = rows.length) {
  return { rows, rowCount } as ReturnType<typeof sql> extends Promise<infer R> ? R : never;
}

// ---------------------------------------------------------------------------
// Helper: build changeset JSON
// ---------------------------------------------------------------------------

function buildChangeset(rows: Record<string, { table: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }>): string {
  return JSON.stringify({ rows });
}

// ---------------------------------------------------------------------------
// _makeRowKey
// ---------------------------------------------------------------------------

describe('_makeRowKey', () => {
  it('uses single PK for nodes', () => {
    expect(_makeRowKey('nodes', { uuid: 'abc' })).toBe('nodes:abc');
  });

  it('uses single PK for memories', () => {
    expect(_makeRowKey('memories', { id: 42 })).toBe('memories:42');
  });

  it('uses composite PK for paths', () => {
    expect(_makeRowKey('paths', { domain: 'core', path: 'a/b' })).toBe('paths:core|a/b');
  });

  it('uses composite PK for glossary_keywords', () => {
    expect(_makeRowKey('glossary_keywords', { keyword: 'test', node_uuid: 'n1' })).toBe('glossary_keywords:test|n1');
  });
});

// ---------------------------------------------------------------------------
// _rowsEqual
// ---------------------------------------------------------------------------

describe('_rowsEqual', () => {
  it('returns true for two nulls', () => {
    expect(_rowsEqual('nodes', null, null)).toBe(true);
  });

  it('returns false when only one is null', () => {
    expect(_rowsEqual('nodes', null, { uuid: 'a' })).toBe(false);
  });

  it('returns true for identical objects', () => {
    const obj = { id: 1, content: 'hi' };
    expect(_rowsEqual('memories', obj, { ...obj })).toBe(true);
  });

  it('ignores id and created_at for glossary_keywords', () => {
    const a = { id: 1, keyword: 'test', node_uuid: 'n1', created_at: '2024-01-01' };
    const b = { id: 2, keyword: 'test', node_uuid: 'n1', created_at: '2024-06-01' };
    expect(_rowsEqual('glossary_keywords', a, b)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// _getAllRows / _getChangedRows
// ---------------------------------------------------------------------------

describe('_getAllRows / _getChangedRows', () => {
  it('returns all row values from changeset', () => {
    const data = { rows: { a: { table: 'nodes', before: { uuid: '1' }, after: { uuid: '1' } } } } as any;
    expect(_getAllRows(data)).toHaveLength(1);
  });

  it('getChangedRows filters out unchanged rows', () => {
    const data = {
      rows: {
        a: { table: 'nodes', before: { uuid: '1' }, after: { uuid: '1' } },
        b: { table: 'memories', before: { id: 1, content: 'old' }, after: { id: 1, content: 'new' } },
      },
    } as any;
    expect(_getChangedRows(data)).toHaveLength(1);
    expect(_getChangedRows(data)[0].table).toBe('memories');
  });
});

// ---------------------------------------------------------------------------
// _resolveNodeUuidSync
// ---------------------------------------------------------------------------

describe('_resolveNodeUuidSync', () => {
  it('returns uuid for nodes table', () => {
    const row = { table: 'nodes', before: null, after: { uuid: 'abc' } };
    expect(_resolveNodeUuidSync(row, [], {})).toBe('abc');
  });

  it('returns node_uuid for memories table', () => {
    const row = { table: 'memories', before: { id: 1, node_uuid: 'xyz' }, after: null };
    expect(_resolveNodeUuidSync(row, [], {})).toBe('xyz');
  });

  it('returns child_uuid for edges table', () => {
    const row = { table: 'edges', before: null, after: { id: 5, child_uuid: 'child1' } };
    expect(_resolveNodeUuidSync(row, [], {})).toBe('child1');
  });

  it('returns null when ref is null', () => {
    const row = { table: 'nodes', before: null, after: null };
    expect(_resolveNodeUuidSync(row, [], {})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// _extractTopTable
// ---------------------------------------------------------------------------

describe('_extractTopTable', () => {
  it('returns the highest-ranked table', () => {
    const rows = [{ table: 'paths' }, { table: 'nodes' }, { table: 'edges' }] as any[];
    expect(_extractTopTable(rows)).toBe('nodes');
  });

  it('returns glossary_keywords for single glossary row', () => {
    expect(_extractTopTable([{ table: 'glossary_keywords' }] as any[])).toBe('glossary_keywords');
  });
});

// ---------------------------------------------------------------------------
// _getTableColumns / _getPkColumns
// ---------------------------------------------------------------------------

describe('_getTableColumns / _getPkColumns', () => {
  it('returns correct columns for nodes', () => {
    expect(_getTableColumns('nodes')).toEqual(['uuid', 'created_at']);
  });

  it('returns pk array for paths', () => {
    expect(_getPkColumns('paths')).toEqual(['domain', 'path']);
  });

  it('returns singleton array for memories pk', () => {
    expect(_getPkColumns('memories')).toEqual(['id']);
  });
});

// ---------------------------------------------------------------------------
// listReviewGroups
// ---------------------------------------------------------------------------

describe('listReviewGroups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSql.mockResolvedValue(makeResult([]));
  });

  it('returns empty array when no changeset exists', async () => {
    mockFs.readFile.mockRejectedValue(new Error('ENOENT'));
    const result = await listReviewGroups();
    expect(result).toEqual([]);
  });

  it('groups changed rows by node_uuid', async () => {
    const changeset = buildChangeset({
      'nodes:uuid1': { table: 'nodes', before: null, after: { uuid: 'uuid1' } },
      'memories:1': { table: 'memories', before: null, after: { id: 1, node_uuid: 'uuid1', content: 'test' } },
    });
    mockFs.readFile.mockResolvedValue(changeset as any);

    const result = await listReviewGroups();
    expect(result).toHaveLength(1);
    expect(result[0].node_uuid).toBe('uuid1');
    expect(result[0].action).toBe('created');
    expect(result[0].row_count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// getReviewGroupDiff
// ---------------------------------------------------------------------------

describe('getReviewGroupDiff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSql.mockResolvedValue(makeResult([]));
  });

  it('throws 404 when node has no changes', async () => {
    mockFs.readFile.mockRejectedValue(new Error('ENOENT'));
    await expect(getReviewGroupDiff('nonexistent')).rejects.toThrow('No changes for node');
  });

  it('returns diff with before/after content', async () => {
    const changeset = buildChangeset({
      'memories:1': {
        table: 'memories',
        before: { id: 1, node_uuid: 'uuid1', content: 'old', deprecated: false },
        after: { id: 1, node_uuid: 'uuid1', content: 'new', deprecated: false },
      },
    });
    mockFs.readFile.mockResolvedValue(changeset as any);
    // sql calls: (no buildEdgeResolutionMap since no paths with edge_ids)
    // 1. active_paths, 2. before content (memoryId=1), 3. before edge meta, 4. after content (memoryId=1), 5. after edge meta
    mockSql
      .mockResolvedValueOnce(makeResult([]))  // active_paths
      .mockResolvedValueOnce(makeResult([{ content: 'old' }]))  // before content
      .mockResolvedValueOnce(makeResult([]))  // before edge meta
      .mockResolvedValueOnce(makeResult([{ content: 'new' }]))  // after content
      .mockResolvedValueOnce(makeResult([]));  // after edge meta

    const diff = await getReviewGroupDiff('uuid1');
    expect(diff.uri).toBe('uuid1');
    expect(diff.change_type).toBe('memories');
    expect(diff.action).toBe('modified');
    expect(diff.has_changes).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// approveReviewGroup
// ---------------------------------------------------------------------------

describe('approveReviewGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSql.mockResolvedValue(makeResult([]));
  });

  it('throws 404 when no changes for node', async () => {
    mockFs.readFile.mockRejectedValue(new Error('ENOENT'));
    await expect(approveReviewGroup('unknown')).rejects.toThrow("No changes for 'unknown'");
  });

  it('removes approved rows and deletes changeset when empty', async () => {
    const changeset = buildChangeset({
      'nodes:uuid1': { table: 'nodes', before: null, after: { uuid: 'uuid1' } },
    });
    mockFs.readFile.mockResolvedValue(changeset as any);
    mockFs.unlink.mockResolvedValue(undefined);

    const result = await approveReviewGroup('uuid1');
    expect(result.message).toContain('Approved');
    expect(result.message).toContain('uuid1');
    expect(mockFs.unlink).toHaveBeenCalled();
  });

  it('saves remaining changeset when other nodes exist', async () => {
    const changeset = buildChangeset({
      'nodes:uuid1': { table: 'nodes', before: null, after: { uuid: 'uuid1' } },
      'nodes:uuid2': { table: 'nodes', before: null, after: { uuid: 'uuid2' } },
    });
    mockFs.readFile.mockResolvedValue(changeset as any);
    mockFs.mkdir.mockResolvedValue(undefined as any);
    mockFs.writeFile.mockResolvedValue(undefined);

    await approveReviewGroup('uuid1');
    expect(mockFs.writeFile).toHaveBeenCalled();
    const saved = JSON.parse((mockFs.writeFile.mock.calls[0] as any[])[1]);
    expect(saved.rows['nodes:uuid1']).toBeUndefined();
    expect(saved.rows['nodes:uuid2']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// rollbackReviewGroup
// ---------------------------------------------------------------------------

describe('rollbackReviewGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSql.mockResolvedValue(makeResult([]));
  });

  it('throws 404 when no changes for node', async () => {
    mockFs.readFile.mockRejectedValue(new Error('ENOENT'));
    await expect(rollbackReviewGroup('unknown')).rejects.toThrow("No changes for 'unknown'");
  });

  it('uses a transaction for rollback operations', async () => {
    const changeset = buildChangeset({
      'nodes:uuid1': { table: 'nodes', before: null, after: { uuid: 'uuid1' } },
    });
    mockFs.readFile.mockResolvedValue(changeset as any);
    mockFs.unlink.mockResolvedValue(undefined);

    const mockClient = {
      query: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
    };
    mockGetPool.mockReturnValue({ connect: vi.fn().mockResolvedValue(mockClient) } as any);

    const result = await rollbackReviewGroup('uuid1');
    expect(result.success).toBe(true);
    expect(result.node_uuid).toBe('uuid1');
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// clearAllReviewGroups
// ---------------------------------------------------------------------------

describe('clearAllReviewGroups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws 404 when no pending changes', async () => {
    mockFs.readFile.mockRejectedValue(new Error('ENOENT'));
    await expect(clearAllReviewGroups()).rejects.toThrow('No pending changes');
  });

  it('removes changeset file and returns count', async () => {
    const changeset = buildChangeset({
      'nodes:uuid1': { table: 'nodes', before: null, after: { uuid: 'uuid1' } },
      'memories:1': { table: 'memories', before: { id: 1, content: 'old' }, after: { id: 1, content: 'new' } },
    });
    mockFs.readFile.mockResolvedValue(changeset as any);
    mockFs.unlink.mockResolvedValue(undefined);

    const result = await clearAllReviewGroups();
    expect(result.message).toContain('2 row changes cleared');
    expect(mockFs.unlink).toHaveBeenCalled();
  });
});
