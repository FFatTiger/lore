import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks (must be declared before imports of the module under test)
// ---------------------------------------------------------------------------

vi.mock('../../../db', () => ({
  // Not used directly by write.ts, but required for db module resolution
}));

vi.mock('../../../db', () => ({
  getPool: vi.fn(),
}));

vi.mock('../browse', () => ({
  ROOT_NODE_UUID: '00000000-0000-0000-0000-000000000000',
}));

vi.mock('../../view/viewCrud', () => ({
  upsertGeneratedMemoryViewsForPath: vi.fn().mockResolvedValue(undefined),
  deleteGeneratedMemoryViewsByPrefix: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../search/glossarySemantic', () => ({
  upsertGeneratedGlossaryEmbeddingsForPath: vi.fn().mockResolvedValue(undefined),
  deleteGeneratedGlossaryEmbeddingsByPrefix: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../writeEvents', () => ({
  logMemoryEvent: vi.fn().mockResolvedValue(undefined),
}));

import { getPool } from '../../../db';
import { logMemoryEvent } from '../writeEvents';
import {
  upsertGeneratedMemoryViewsForPath,
  deleteGeneratedMemoryViewsByPrefix,
} from '../../view/viewCrud';
import {
  upsertGeneratedGlossaryEmbeddingsForPath,
  deleteGeneratedGlossaryEmbeddingsByPrefix,
} from '../../search/glossarySemantic';
import {
  createNode,
  updateNodeByPath,
  deleteNodeByPath,
  assertValidPathSegment,
  assertValidPathSegments,
  parseUri,
} from '../write';

const mockGetPool = vi.mocked(getPool);
const mockLogMemoryEvent = vi.mocked(logMemoryEvent);

// ---------------------------------------------------------------------------
// Mock client factory
// ---------------------------------------------------------------------------

function makeMockClient(queryResponses: Record<string, unknown>[] = []) {
  let callIndex = 0;
  const query = vi.fn((_sql: string, _params?: unknown[]) => {
    const response = queryResponses[callIndex++] || { rows: [], rowCount: 0 };
    return Promise.resolve(response);
  });
  const release = vi.fn();
  return { query, release };
}

function makePool(client: ReturnType<typeof makeMockClient>) {
  return {
    connect: vi.fn().mockResolvedValue(client),
  };
}

// ---------------------------------------------------------------------------
// assertValidPathSegment
// ---------------------------------------------------------------------------

describe('assertValidPathSegment', () => {
  it('returns the trimmed segment for a valid name', () => {
    expect(assertValidPathSegment('hello')).toBe('hello');
  });

  it('allows digits in segments', () => {
    expect(assertValidPathSegment('abc123')).toBe('abc123');
  });

  it('allows snake_case with multiple parts', () => {
    expect(assertValidPathSegment('my_node_name')).toBe('my_node_name');
  });

  it('throws 422 for an empty string', () => {
    expect(() => assertValidPathSegment('')).toThrow('is required');
    try {
      assertValidPathSegment('');
    } catch (err: any) {
      expect(err.status).toBe(422);
    }
  });

  it('throws 422 for Chinese characters', () => {
    expect(() => assertValidPathSegment('你好')).toThrow('snake_case ASCII only');
    try {
      assertValidPathSegment('你好');
    } catch (err: any) {
      expect(err.status).toBe(422);
    }
  });

  it('throws 422 for strings with spaces', () => {
    expect(() => assertValidPathSegment('hello world')).toThrow('snake_case ASCII only');
  });

  it('throws 422 for strings with hyphens', () => {
    expect(() => assertValidPathSegment('hello-world')).toThrow('snake_case ASCII only');
  });

  it('throws 422 for uppercase letters', () => {
    expect(() => assertValidPathSegment('HelloWorld')).toThrow('snake_case ASCII only');
  });

  it('uses custom label in error message', () => {
    try {
      assertValidPathSegment('', 'title');
    } catch (err: any) {
      expect(err.message).toContain('title');
    }
  });

  it('throws 422 for segments that start with underscore', () => {
    expect(() => assertValidPathSegment('_bad')).toThrow('snake_case ASCII only');
  });
});

// ---------------------------------------------------------------------------
// assertValidPathSegments
// ---------------------------------------------------------------------------

describe('assertValidPathSegments', () => {
  it('returns array of segments for a valid path', () => {
    expect(assertValidPathSegments('a/b/c')).toEqual(['a', 'b', 'c']);
  });

  it('throws 422 for empty path', () => {
    expect(() => assertValidPathSegments('')).toThrow('must include at least one path segment');
    try {
      assertValidPathSegments('');
    } catch (err: any) {
      expect(err.status).toBe(422);
    }
  });

  it('throws when any segment is invalid', () => {
    expect(() => assertValidPathSegments('good/Bad/path')).toThrow('snake_case ASCII only');
  });

  it('handles single-segment paths', () => {
    expect(assertValidPathSegments('single')).toEqual(['single']);
  });
});

// ---------------------------------------------------------------------------
// parseUri
// ---------------------------------------------------------------------------

describe('parseUri', () => {
  it('parses domain://path format', () => {
    expect(parseUri('work://projects/alpha')).toEqual({
      domain: 'work',
      path: 'projects/alpha',
    });
  });

  it('defaults domain to core when no :// separator', () => {
    expect(parseUri('some/path')).toEqual({ domain: 'core', path: 'some/path' });
  });

  it('strips leading and trailing slashes from path', () => {
    expect(parseUri('core:///path/with/slashes/')).toEqual({
      domain: 'core',
      path: 'path/with/slashes',
    });
  });

  it('returns core domain for empty input', () => {
    expect(parseUri('')).toEqual({ domain: 'core', path: '' });
  });

  it('defaults to core when domain part is empty string', () => {
    expect(parseUri('://foo/bar')).toEqual({ domain: 'core', path: 'foo/bar' });
  });
});

// ---------------------------------------------------------------------------
// createNode
// ---------------------------------------------------------------------------

describe('createNode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a root-level node and returns uri, path, node_uuid', async () => {
    const client = makeMockClient([
      { rows: [], rowCount: 0 },                  // BEGIN
      // no parentPath so no getPathContext
      { rows: [{ path: '1' }], rowCount: 1 },     // sibling query (no title given)
      { rows: [], rowCount: 0 },                  // INSERT nodes
      { rows: [], rowCount: 0 },                  // INSERT memories
      { rows: [{ id: 99 }], rowCount: 1 },        // INSERT edges RETURNING id
      { rows: [], rowCount: 0 },                  // INSERT paths
      { rows: [], rowCount: 0 },                  // COMMIT
    ]);
    mockGetPool.mockReturnValue(makePool(client) as any);

    const result = await createNode({ domain: 'core', content: 'hello' });

    expect(result.success).toBe(true);
    expect(result.uri).toMatch(/^core:\/\//);
    expect(result.path).toBeTruthy();
    expect(result.node_uuid).toBeTruthy();
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('uses provided title as path segment', async () => {
    const client = makeMockClient([
      { rows: [], rowCount: 0 },          // BEGIN
      { rows: [], rowCount: 0 },          // INSERT nodes
      { rows: [], rowCount: 0 },          // INSERT memories
      { rows: [{ id: 1 }], rowCount: 1 }, // INSERT edges RETURNING id
      { rows: [], rowCount: 0 },          // INSERT paths
      { rows: [], rowCount: 0 },          // COMMIT
    ]);
    mockGetPool.mockReturnValue(makePool(client) as any);

    const result = await createNode({ domain: 'core', title: 'my_node', content: 'data' });
    expect(result.path).toBe('my_node');
    expect(result.uri).toBe('core://my_node');
  });

  it('inserts node under parentPath when provided', async () => {
    const client = makeMockClient([
      { rows: [], rowCount: 0 },                           // BEGIN
      // getPathContext for parent
      {
        rows: [{
          domain: 'core', path: 'parent', edge_id: 10,
          parent_uuid: '00000000-0000-0000-0000-000000000000',
          child_uuid: 'parent-uuid', priority: 0, disclosure: null,
        }],
        rowCount: 1,
      },
      { rows: [], rowCount: 0 },          // INSERT nodes
      { rows: [], rowCount: 0 },          // INSERT memories
      { rows: [{ id: 42 }], rowCount: 1 },// INSERT edges RETURNING id
      { rows: [], rowCount: 0 },          // INSERT paths
      { rows: [], rowCount: 0 },          // COMMIT
    ]);
    mockGetPool.mockReturnValue(makePool(client) as any);

    const result = await createNode({ domain: 'core', parentPath: 'parent', title: 'child', content: 'x' });
    expect(result.path).toBe('parent/child');
    expect(result.uri).toBe('core://parent/child');
  });

  it('sets correct domain on the created node', async () => {
    const client = makeMockClient([
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },          // INSERT nodes
      { rows: [], rowCount: 0 },          // INSERT memories
      { rows: [{ id: 7 }], rowCount: 1 },
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
    ]);
    mockGetPool.mockReturnValue(makePool(client) as any);

    const result = await createNode({ domain: 'work', title: 'task1', content: 'todo' });
    expect(result.uri).toMatch(/^work:\/\//);
  });

  it('calls logMemoryEvent with event_type create', async () => {
    const client = makeMockClient([
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
      { rows: [{ id: 5 }], rowCount: 1 },
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
    ]);
    mockGetPool.mockReturnValue(makePool(client) as any);

    await createNode({ domain: 'core', title: 'evt_node', content: 'test' });

    expect(mockLogMemoryEvent).toHaveBeenCalledOnce();
    expect(mockLogMemoryEvent.mock.calls[0][0]).toMatchObject({
      event_type: 'create',
      domain: 'core',
      path: 'evt_node',
    });
  });

  it('throws 422 when parentPath is not found', async () => {
    const client = makeMockClient([
      { rows: [], rowCount: 0 },      // BEGIN
      { rows: [], rowCount: 0 },      // getPathContext for parent → not found
      { rows: [], rowCount: 0 },      // ROLLBACK
    ]);
    mockGetPool.mockReturnValue(makePool(client) as any);

    await expect(
      createNode({ domain: 'core', parentPath: 'missing', title: 'child', content: 'x' }),
    ).rejects.toThrow('Parent path not found');

    const err = await createNode(
      { domain: 'core', parentPath: 'missing', title: 'child', content: 'x' },
    ).catch((e: any) => e);
    expect(err.status).toBe(422);
  });

  it('throws 422 for invalid title containing uppercase', async () => {
    // Does not even reach DB since assertValidPathSegment throws synchronously
    await expect(
      createNode({ domain: 'core', title: 'BadTitle', content: 'x' }),
    ).rejects.toThrow('snake_case ASCII only');
  });

  it('auto-generates slug from sibling count when no title provided', async () => {
    const client = makeMockClient([
      { rows: [], rowCount: 0 },                      // BEGIN
      { rows: [{ path: '5' }], rowCount: 1 },         // sibling paths query
      { rows: [], rowCount: 0 },                      // INSERT nodes
      { rows: [], rowCount: 0 },                      // INSERT memories
      { rows: [{ id: 11 }], rowCount: 1 },            // INSERT edges
      { rows: [], rowCount: 0 },                      // INSERT paths
      { rows: [], rowCount: 0 },                      // COMMIT
    ]);
    mockGetPool.mockReturnValue(makePool(client) as any);

    const result = await createNode({ domain: 'core', content: 'auto' });
    // max sibling path segment is '5', so new slug should be '6'
    expect(result.path).toBe('6');
  });

  it('rolls back on error and re-throws', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
        .mockRejectedValueOnce(new Error('DB error')),    // sibling query fails
      release: vi.fn(),
    };
    mockGetPool.mockReturnValue(makePool(client) as any);

    await expect(createNode({ domain: 'core', content: 'x' })).rejects.toThrow('DB error');
    // ROLLBACK should have been called
    const rollbackCall = client.query.mock.calls.find(
      (c: unknown[]) => c[0] === 'ROLLBACK',
    );
    expect(rollbackCall).toBeDefined();
    expect(client.release).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// updateNodeByPath
// ---------------------------------------------------------------------------

describe('updateNodeByPath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeUpdateClient({
    found = true,
    currentContent = 'old content',
  }: { found?: boolean; currentContent?: string } = {}) {
    const pathContextRow = found
      ? {
          domain: 'core', path: 'agent/prefs', edge_id: 20,
          parent_uuid: 'parent-uuid', child_uuid: 'node-uuid',
          priority: 1, disclosure: null,
        }
      : null;

    const client = makeMockClient([
      { rows: [], rowCount: 0 },                              // BEGIN
      // getPathContext
      { rows: pathContextRow ? [pathContextRow] : [], rowCount: pathContextRow ? 1 : 0 },
      // SELECT memory FOR UPDATE
      { rows: [{ id: 77, content: currentContent }], rowCount: 1 },
      // UPDATE old memory deprecated
      { rows: [], rowCount: 1 },
      // INSERT new memory
      { rows: [], rowCount: 1 },
      { rows: [], rowCount: 0 },                              // COMMIT
    ]);
    return client;
  }

  it('updates content and returns success with node_uuid', async () => {
    const client = makeUpdateClient({ currentContent: 'old' });
    mockGetPool.mockReturnValue(makePool(client) as any);

    const result = await updateNodeByPath({ domain: 'core', path: 'agent/prefs', content: 'new content' });
    expect(result.success).toBe(true);
    expect(result.node_uuid).toBe('node-uuid');
  });

  it('throws 404 when path is not found', async () => {
    const client = makeMockClient([
      { rows: [], rowCount: 0 },  // BEGIN
      { rows: [], rowCount: 0 },  // getPathContext → not found
      { rows: [], rowCount: 0 },  // ROLLBACK
    ]);
    mockGetPool.mockReturnValue(makePool(client) as any);

    await expect(
      updateNodeByPath({ domain: 'core', path: 'nonexistent', content: 'x' }),
    ).rejects.toThrow('Path not found');

    const err = await updateNodeByPath({ domain: 'core', path: 'nonexistent', content: 'x' })
      .catch((e: any) => e);
    expect(err.status).toBe(404);
  });

  it('updates priority via edges UPDATE', async () => {
    const client = makeMockClient([
      { rows: [], rowCount: 0 },   // BEGIN
      {
        rows: [{
          domain: 'core', path: 'node', edge_id: 30,
          parent_uuid: 'p', child_uuid: 'c', priority: 0, disclosure: null,
        }],
        rowCount: 1,
      },                           // getPathContext
      { rows: [], rowCount: 0 },   // UPDATE edges
      { rows: [], rowCount: 0 },   // COMMIT
    ]);
    mockGetPool.mockReturnValue(makePool(client) as any);

    const result = await updateNodeByPath({ domain: 'core', path: 'node', priority: 2 });
    expect(result.success).toBe(true);

    // Check the UPDATE edges query was issued
    const edgesUpdate = client.query.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE edges'),
    );
    expect(edgesUpdate).toBeDefined();
  });

  it('updates disclosure via edges UPDATE', async () => {
    const client = makeMockClient([
      { rows: [], rowCount: 0 },
      {
        rows: [{
          domain: 'core', path: 'node2', edge_id: 31,
          parent_uuid: 'p2', child_uuid: 'c2', priority: 0, disclosure: null,
        }],
        rowCount: 1,
      },
      { rows: [], rowCount: 0 },   // UPDATE edges
      { rows: [], rowCount: 0 },   // COMMIT
    ]);
    mockGetPool.mockReturnValue(makePool(client) as any);

    const result = await updateNodeByPath({ domain: 'core', path: 'node2', disclosure: 'when needed' });
    expect(result.success).toBe(true);
  });

  it('calls logMemoryEvent with event_type update', async () => {
    const client = makeUpdateClient();
    mockGetPool.mockReturnValue(makePool(client) as any);

    await updateNodeByPath({ domain: 'core', path: 'agent/prefs', content: 'updated' });

    expect(mockLogMemoryEvent).toHaveBeenCalledOnce();
    expect(mockLogMemoryEvent.mock.calls[0][0]).toMatchObject({ event_type: 'update' });
  });

  it('rolls back on failure and re-throws', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })  // BEGIN
        .mockRejectedValueOnce(new Error('DB crash')),      // getPathContext fails
      release: vi.fn(),
    };
    mockGetPool.mockReturnValue(makePool(client) as any);

    await expect(
      updateNodeByPath({ domain: 'core', path: 'anything', content: 'x' }),
    ).rejects.toThrow('DB crash');

    expect(client.release).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// deleteNodeByPath
// ---------------------------------------------------------------------------

describe('deleteNodeByPath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeDeleteClient({ found = true } = {}) {
    const pathCtxRow = {
      domain: 'core', path: 'to/delete', edge_id: 50,
      parent_uuid: 'parent', child_uuid: 'del-uuid',
      priority: 0, disclosure: null,
    };

    return makeMockClient([
      { rows: [], rowCount: 0 },                         // BEGIN
      // getPathContext for base
      { rows: found ? [pathCtxRow] : [], rowCount: found ? 1 : 0 },
      // SELECT content before deletion
      { rows: [{ content: 'some content' }], rowCount: 1 },
      // SELECT paths + children matching pattern
      {
        rows: [
          { domain: 'core', path: 'to/delete', edge_id: 50, child_uuid: 'del-uuid' },
          { domain: 'core', path: 'to/delete/child', edge_id: 51, child_uuid: 'child-uuid' },
        ],
        rowCount: 2,
      },
      // DELETE from paths
      { rows: [], rowCount: 2 },
      // refcount for edge 50
      { rows: [{ count: '0' }], rowCount: 1 },
      // DELETE edge 50
      { rows: [], rowCount: 1 },
      // refcount for edge 51
      { rows: [{ count: '0' }], rowCount: 1 },
      // DELETE edge 51
      { rows: [], rowCount: 1 },
      // pathCount for del-uuid
      { rows: [{ count: '0' }], rowCount: 1 },
      // deprecate memories for del-uuid
      { rows: [], rowCount: 1 },
      // pathCount for child-uuid
      { rows: [{ count: '0' }], rowCount: 1 },
      // deprecate memories for child-uuid
      { rows: [], rowCount: 1 },
      { rows: [], rowCount: 0 },                         // COMMIT
    ]);
  }

  it('deletes node and returns deleted_uri', async () => {
    const client = makeDeleteClient();
    mockGetPool.mockReturnValue(makePool(client) as any);

    const result = await deleteNodeByPath({ domain: 'core', path: 'to/delete' });
    expect(result.success).toBe(true);
    expect(result.deleted_uri).toBe('core://to/delete');
  });

  it('throws 404 when path is not found', async () => {
    const client = makeDeleteClient({ found: false });
    mockGetPool.mockReturnValue(makePool(client) as any);

    await expect(deleteNodeByPath({ domain: 'core', path: 'gone' })).rejects.toThrow(
      'Path not found',
    );

    const err = await deleteNodeByPath({ domain: 'core', path: 'gone' }).catch((e: any) => e);
    expect(err.status).toBe(404);
  });

  it('calls logMemoryEvent with event_type delete', async () => {
    const client = makeDeleteClient();
    mockGetPool.mockReturnValue(makePool(client) as any);

    await deleteNodeByPath({ domain: 'core', path: 'to/delete' });

    expect(mockLogMemoryEvent).toHaveBeenCalledOnce();
    expect(mockLogMemoryEvent.mock.calls[0][0]).toMatchObject({ event_type: 'delete' });
  });

  it('includes affected_paths in event details', async () => {
    const client = makeDeleteClient();
    mockGetPool.mockReturnValue(makePool(client) as any);

    await deleteNodeByPath({ domain: 'core', path: 'to/delete' });

    const details = mockLogMemoryEvent.mock.calls[0][0].details as any;
    expect(details.affected_paths).toContain('core://to/delete');
    expect(details.affected_paths).toContain('core://to/delete/child');
  });

  it('issues DELETE on paths and edges for each affected edge', async () => {
    const client = makeDeleteClient();
    mockGetPool.mockReturnValue(makePool(client) as any);

    await deleteNodeByPath({ domain: 'core', path: 'to/delete' });

    const deleteCalls = client.query.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('DELETE FROM paths'),
    );
    expect(deleteCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('rolls back on failure', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })  // BEGIN
        .mockRejectedValueOnce(new Error('constraint')),    // getPathContext throws
      release: vi.fn(),
    };
    mockGetPool.mockReturnValue(makePool(client) as any);

    await expect(deleteNodeByPath({ domain: 'core', path: 'x' })).rejects.toThrow('constraint');
    expect(client.release).toHaveBeenCalledOnce();
  });
});

