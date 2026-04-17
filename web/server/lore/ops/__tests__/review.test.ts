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
vi.mock('../../config/settings', () => ({ getSetting: vi.fn() }));
vi.mock('../../../../server/auth', () => ({ requireBearerAuth: vi.fn() }));

import { sql, getPool } from '../../../db';
import fs from 'fs/promises';
import { getSetting } from '../../config/settings';
import { requireBearerAuth } from '../../../../server/auth';
import { extractContentAndMeta, listActivePaths } from '../reviewDiffState';
import {
  collectNodeRowKeys,
  collectReviewDiffChanges,
  determineReviewGroupAction,
  groupChangedRowsByNode,
} from '../reviewGroupHelpers';
import {
  buildEdgeResolutionMap,
  findDisplayUri,
  resolveNodeUuidSync,
} from '../reviewNodeResolution';
import {
  getPkColumns,
  getTableColumns,
  makeRowKey,
  rowsEqual,
  type ChangesetRow,
} from '../reviewRowHelpers';
import {
  deleteSnapshotRow,
  insertSnapshotRow,
  updateSnapshotRow,
} from '../reviewSnapshotRows';
import {
  clearAllReviewGroups,
  approveReviewGroup,
  rollbackReviewGroup,
  getReviewGroupDiff,
  listReviewGroups,
  _extractTopTable,
  _getAllRows,
  _getChangedRows,
  _getChangesetPath,
  _loadChangeset,
  _makeRowKey,
  _removeChangesetFile,
  _resolveNodeUuidSync,
  _rowsEqual,
  _saveChangeset,
} from '../review';
import * as reviewModule from '../review';
import * as reviewRoute from '../../../../app/api/review/route';
import * as reviewGroupsRoute from '../../../../app/api/review/groups/route';
import * as reviewGroupRoute from '../../../../app/api/review/groups/[nodeUuid]/route';
import * as reviewGroupDiffRoute from '../../../../app/api/review/groups/[nodeUuid]/diff/route';

const mockSql = vi.mocked(sql);
const mockGetPool = vi.mocked(getPool);
const mockFs = vi.mocked(fs);
const mockGetSetting = vi.mocked(getSetting);
const mockRequireBearerAuth = vi.mocked(requireBearerAuth);

function makeResult(rows: Record<string, unknown>[] = [], rowCount = rows.length) {
  return { rows, rowCount } as ReturnType<typeof sql> extends Promise<infer R> ? R : never;
}

// ---------------------------------------------------------------------------
// Helper: build changeset JSON
// ---------------------------------------------------------------------------

function buildChangeset(rows: Record<string, { table: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }>): string {
  return JSON.stringify({ rows });
}

describe('review route contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireBearerAuth.mockReturnValue(null);
  });

  it('returns canonical conflict errors from review groups list', async () => {
    vi.spyOn(reviewModule, 'listReviewGroups').mockRejectedValueOnce(Object.assign(new Error('Review list conflict'), { status: 409 }));

    const response = await reviewGroupsRoute.GET(new Request('http://localhost/api/review/groups') as any);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.detail).toBe('Review list conflict');
    expect(body.code).toBe('conflict');
  });

  it('returns canonical not_found errors from review diff route', async () => {
    vi.spyOn(reviewModule, 'getReviewGroupDiff').mockRejectedValueOnce(Object.assign(new Error('No changes for node'), { status: 404 }));

    const response = await reviewGroupDiffRoute.GET(new Request('http://localhost/api/review/groups/node-1/diff') as any, {
      params: { nodeUuid: 'node-1' },
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.detail).toBe('No changes for node');
    expect(body.code).toBe('not_found');
  });

  it('returns canonical conflict errors from approve review route', async () => {
    vi.spyOn(reviewModule, 'approveReviewGroup').mockRejectedValueOnce(Object.assign(new Error('Review approval conflict'), { status: 409 }));

    const response = await reviewGroupRoute.DELETE(new Request('http://localhost/api/review/groups/node-1', {
      method: 'DELETE',
    }) as any, {
      params: { nodeUuid: 'node-1' },
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.detail).toBe('Review approval conflict');
    expect(body.code).toBe('conflict');
  });

  it('returns canonical validation errors from rollback review route', async () => {
    vi.spyOn(reviewModule, 'rollbackReviewGroup').mockRejectedValueOnce(Object.assign(new Error('Rollback validation failed'), { status: 422 }));

    const response = await reviewGroupRoute.POST(new Request('http://localhost/api/review/groups/node-1', {
      method: 'POST',
    }) as any, {
      params: { nodeUuid: 'node-1' },
    });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.detail).toBe('Rollback validation failed');
    expect(body.code).toBe('validation_error');
  });

  it('returns canonical not_found errors from clear review route', async () => {
    vi.spyOn(reviewModule, 'clearAllReviewGroups').mockRejectedValueOnce(Object.assign(new Error('No pending changes'), { status: 404 }));

    const response = await reviewRoute.DELETE(new Request('http://localhost/api/review', {
      method: 'DELETE',
    }) as any);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.detail).toBe('No pending changes');
    expect(body.code).toBe('not_found');
  });
});

// ---------------------------------------------------------------------------
// changeset store helpers
// ---------------------------------------------------------------------------

describe('changeset store helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSetting.mockResolvedValue('/tmp/review');
  });

  it('resolves changeset.json under configured review path', async () => {
    await expect(_getChangesetPath()).resolves.toBe('/tmp/review/changeset.json');
  });

  it('throws when review local path is not configured', async () => {
    mockGetSetting.mockResolvedValue('');
    await expect(_getChangesetPath()).rejects.toThrow('Review local path is not configured.');
  });

  it('loads empty changeset when file does not exist', async () => {
    mockFs.readFile.mockRejectedValue(new Error('ENOENT'));
    await expect(_loadChangeset()).resolves.toEqual({ rows: {} });
  });

  it('saves changeset under configured directory', async () => {
    mockFs.mkdir.mockResolvedValue(undefined as any);
    mockFs.writeFile.mockResolvedValue(undefined);
    await _saveChangeset({ rows: { a: { table: 'nodes', before: null, after: { uuid: 'x' } } } } as any);
    expect(mockFs.mkdir).toHaveBeenCalledWith('/tmp/review', { recursive: true });
    expect(mockFs.writeFile).toHaveBeenCalledWith('/tmp/review/changeset.json', expect.any(String), 'utf8');
  });

  it('removes changeset file when present', async () => {
    mockFs.unlink.mockResolvedValue(undefined);
    await _removeChangesetFile();
    expect(mockFs.unlink).toHaveBeenCalledWith('/tmp/review/changeset.json');
  });
});

// ---------------------------------------------------------------------------
// _makeRowKey
// ---------------------------------------------------------------------------

describe('_makeRowKey', () => {
  it('uses single PK for nodes', () => {
    expect(makeRowKey('nodes', { uuid: 'abc' })).toBe('nodes:abc');
  });

  it('uses single PK for memories', () => {
    expect(makeRowKey('memories', { id: 42 })).toBe('memories:42');
  });

  it('uses composite PK for paths', () => {
    expect(makeRowKey('paths', { domain: 'core', path: 'a/b' })).toBe('paths:core|a/b');
  });

  it('uses composite PK for glossary_keywords', () => {
    expect(makeRowKey('glossary_keywords', { keyword: 'test', node_uuid: 'n1' })).toBe('glossary_keywords:test|n1');
  });

  it('matches the review facade re-export', () => {
    expect(_makeRowKey('paths', { domain: 'core', path: 'a/b' })).toBe(makeRowKey('paths', { domain: 'core', path: 'a/b' }));
  });
});

// ---------------------------------------------------------------------------
// _rowsEqual
// ---------------------------------------------------------------------------

describe('_rowsEqual', () => {
  it('returns true for two nulls', () => {
    expect(rowsEqual('nodes', null, null)).toBe(true);
  });

  it('returns false when only one is null', () => {
    expect(rowsEqual('nodes', null, { uuid: 'a' })).toBe(false);
  });

  it('returns true for identical objects', () => {
    const obj = { id: 1, content: 'hi' };
    expect(rowsEqual('memories', obj, { ...obj })).toBe(true);
  });

  it('ignores id and created_at for glossary_keywords', () => {
    const a = { id: 1, keyword: 'test', node_uuid: 'n1', created_at: '2024-01-01' };
    const b = { id: 2, keyword: 'test', node_uuid: 'n1', created_at: '2024-06-01' };
    expect(rowsEqual('glossary_keywords', a, b)).toBe(true);
  });

  it('matches the review facade re-export', () => {
    expect(_rowsEqual('nodes', { uuid: 'a' }, { uuid: 'a' })).toBe(rowsEqual('nodes', { uuid: 'a' }, { uuid: 'a' }));
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
    expect(resolveNodeUuidSync(row, [], {})).toBe('abc');
    expect(_resolveNodeUuidSync(row, [], {})).toBe('abc');
  });

  it('returns node_uuid for memories table', () => {
    const row = { table: 'memories', before: { id: 1, node_uuid: 'xyz' }, after: null };
    expect(resolveNodeUuidSync(row, [], {})).toBe('xyz');
  });

  it('returns child_uuid for edges table', () => {
    const row = { table: 'edges', before: null, after: { id: 5, child_uuid: 'child1' } };
    expect(resolveNodeUuidSync(row, [], {})).toBe('child1');
  });

  it('returns null when ref is null', () => {
    const row = { table: 'nodes', before: null, after: null };
    expect(resolveNodeUuidSync(row, [], {})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// node resolution helpers
// ---------------------------------------------------------------------------

describe('node resolution helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds edge resolution map from referenced path edges', async () => {
    const rows: ChangesetRow[] = [
      { table: 'paths', before: null, after: { domain: 'core', path: 'agent', edge_id: 7 } },
    ];
    mockSql.mockResolvedValueOnce(makeResult([{ id: 7, child_uuid: 'node-7' }]));
    await expect(buildEdgeResolutionMap(rows)).resolves.toEqual({ 7: 'node-7' });
    expect(mockSql).toHaveBeenCalledWith('SELECT id, child_uuid FROM edges WHERE id = ANY($1::int[])', [[7]]);
  });

  it('returns display uri from changed path rows before live fallback', async () => {
    const rows: ChangesetRow[] = [
      { table: 'paths', before: null, after: { domain: 'core', path: 'agent/profile', node_uuid: 'node-1' } },
    ];
    await expect(findDisplayUri('node-1', rows, {})).resolves.toBe('core://agent/profile');
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('falls back to live path lookup when no changed path row exists', async () => {
    mockSql.mockResolvedValueOnce(makeResult([{ domain: 'core', path: 'agent/live' }]));
    await expect(findDisplayUri('node-live', [], {})).resolves.toBe('core://agent/live');
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
    expect(getTableColumns('nodes')).toEqual(['uuid', 'created_at']);
  });

  it('returns pk array for paths', () => {
    expect(getPkColumns('paths')).toEqual(['domain', 'path']);
  });

  it('returns singleton array for memories pk', () => {
    expect(getPkColumns('memories')).toEqual(['id']);
  });
});

// ---------------------------------------------------------------------------
// snapshot row helpers
// ---------------------------------------------------------------------------

describe('snapshot row helpers', () => {
  it('inserts snapshot rows using known columns', async () => {
    const client = { query: vi.fn().mockResolvedValue(undefined) };
    await insertSnapshotRow(client, 'paths', { domain: 'core', path: 'agent', edge_id: 7, ignored: true });
    expect(client.query).toHaveBeenCalledWith(
      'INSERT INTO paths (domain, path, edge_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      ['core', 'agent', 7],
    );
  });

  it('deletes snapshot rows by primary key columns', async () => {
    const client = { query: vi.fn().mockResolvedValue(undefined) };
    await deleteSnapshotRow(client, 'paths', { domain: 'core', path: 'agent', edge_id: 7 });
    expect(client.query).toHaveBeenCalledWith('DELETE FROM paths WHERE domain = $1 AND path = $2', ['core', 'agent']);
  });

  it('updates snapshot rows using assignable columns and target primary key', async () => {
    const client = { query: vi.fn().mockResolvedValue(undefined) };
    await updateSnapshotRow(
      client,
      'memories',
      { id: 3, node_uuid: 'n1', content: 'old', deprecated: false },
      { id: 3, node_uuid: 'n1', content: 'new', deprecated: true },
    );
    expect(client.query).toHaveBeenCalledWith(
      'UPDATE memories SET node_uuid = $1, content = $2, deprecated = $3 WHERE id = $4',
      ['n1', 'old', false, 3],
    );
  });

  it('skips update when table has no assignable columns in before row', async () => {
    const client = { query: vi.fn().mockResolvedValue(undefined) };
    await updateSnapshotRow(client, 'nodes', { uuid: 'n1' }, { uuid: 'n1' });
    expect(client.query).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// diff state helpers
// ---------------------------------------------------------------------------

describe('diff state helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts content and meta from row snapshots and live fallbacks', async () => {
    const rows: ChangesetRow[] = [
      {
        table: 'memories',
        before: { id: 9, node_uuid: 'node-1', deprecated: false },
        after: { id: 10, node_uuid: 'node-1', deprecated: false },
      },
      {
        table: 'edges',
        before: { priority: 1, disclosure: 'old' },
        after: { priority: 2, disclosure: 'new' },
      },
    ];
    mockSql
      .mockResolvedValueOnce(makeResult([{ content: 'before-content' }]))
      .mockResolvedValueOnce(makeResult([{ content: 'after-content' }]));

    await expect(extractContentAndMeta(rows, 'before', 'node-1')).resolves.toEqual({
      content: 'before-content',
      meta: { priority: 1, disclosure: 'old' },
    });
    await expect(extractContentAndMeta(rows, 'after', 'node-1')).resolves.toEqual({
      content: 'after-content',
      meta: { priority: 2, disclosure: 'new' },
    });
  });

  it('lists active paths for a node', async () => {
    mockSql.mockResolvedValueOnce(makeResult([{ domain: 'core', path: 'agent/profile' }]));
    await expect(listActivePaths('node-1')).resolves.toEqual(['core://agent/profile']);
  });
});

// ---------------------------------------------------------------------------
// review group helpers
// ---------------------------------------------------------------------------

describe('review group helpers', () => {
  it('groups changed rows by resolved node uuid', () => {
    const changedRows: ChangesetRow[] = [
      { table: 'nodes', before: null, after: { uuid: 'node-1' } },
      { table: 'memories', before: null, after: { id: 5, node_uuid: 'node-1' } },
      { table: 'nodes', before: null, after: { uuid: 'node-2' } },
    ];
    const grouped = groupChangedRowsByNode(changedRows, changedRows, {});
    expect([...grouped.keys()]).toEqual(['node-1', 'node-2']);
    expect(grouped.get('node-1')).toHaveLength(2);
  });

  it('determines created, deleted, and modified actions', () => {
    expect(determineReviewGroupAction([{ table: 'nodes', before: null, after: { uuid: 'n1' } } as any])).toBe('created');
    expect(determineReviewGroupAction([{ table: 'nodes', before: { uuid: 'n1' }, after: null } as any])).toBe('deleted');
    expect(determineReviewGroupAction([{ table: 'nodes', before: { uuid: 'n1' }, after: { uuid: 'n1' } } as any])).toBe('modified');
  });

  it('collects review diff path and glossary changes', () => {
    const rows: ChangesetRow[] = [
      { table: 'paths', before: null, after: { domain: 'core', path: 'agent/profile' } },
      { table: 'glossary_keywords', before: { keyword: 'old' }, after: null },
    ];
    expect(collectReviewDiffChanges(rows)).toEqual({
      path_changes: [{ action: 'created', uri: 'core://agent/profile' }],
      glossary_changes: [{ action: 'deleted', keyword: 'old' }],
    });
  });

  it('collects row keys for one node across mixed rows', () => {
    const rows: ChangesetRow[] = [
      { table: 'nodes', before: null, after: { uuid: 'node-1' } },
      { table: 'memories', before: null, after: { id: 5, node_uuid: 'node-1' } },
      { table: 'nodes', before: null, after: { uuid: 'node-2' } },
    ];
    expect(collectNodeRowKeys(rows, {}, 'node-1')).toEqual(['nodes:node-1', 'memories:5']);
  });
});

// ---------------------------------------------------------------------------
// listReviewGroups
// ---------------------------------------------------------------------------

describe('listReviewGroups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSetting.mockResolvedValue('/tmp/review');
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
    mockGetSetting.mockResolvedValue('/tmp/review');
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
    mockGetSetting.mockResolvedValue('/tmp/review');
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

  it('reads and writes changeset.json under the configured review path', async () => {
    const changeset = buildChangeset({
      'nodes:uuid1': { table: 'nodes', before: null, after: { uuid: 'uuid1' } },
      'nodes:uuid2': { table: 'nodes', before: null, after: { uuid: 'uuid2' } },
    });
    mockFs.readFile.mockResolvedValue(changeset as any);
    mockFs.mkdir.mockResolvedValue(undefined as any);
    mockFs.writeFile.mockResolvedValue(undefined);

    await approveReviewGroup('uuid1');

    expect(mockFs.readFile).toHaveBeenCalledWith('/tmp/review/changeset.json', 'utf8');
    expect(mockFs.mkdir).toHaveBeenCalledWith('/tmp/review', { recursive: true });
    expect(mockFs.writeFile).toHaveBeenCalledWith('/tmp/review/changeset.json', expect.any(String), 'utf8');
  });

});

// ---------------------------------------------------------------------------
// rollbackReviewGroup
// ---------------------------------------------------------------------------

describe('rollbackReviewGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSetting.mockResolvedValue('/tmp/review');
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
    mockGetSetting.mockResolvedValue('/tmp/review');
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
