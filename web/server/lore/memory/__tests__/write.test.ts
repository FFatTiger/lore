import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks (must be declared before imports of the module under test)
// ---------------------------------------------------------------------------

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

vi.mock('../boot', () => ({
  getBootNodeSpec: vi.fn(),
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
  moveNode,
  parseUri,
} from '../write';
import { assertValidPathSegment, assertValidPathSegments } from '../writePathValidation';
import { assertDeleteAllowed, assertMoveAllowed } from '../writeBootGuard';
import { buildWriteEventBase } from '../writeEventPayload';
import {
  scheduleWriteArtifactsAfterMove,
  scheduleWriteArtifactsDelete,
  scheduleWriteArtifactsRefresh,
} from '../writeArtifactScheduling';
import { getBootNodeSpec } from '../boot';

const mockGetPool = vi.mocked(getPool);
const mockLogMemoryEvent = vi.mocked(logMemoryEvent);
const mockGetBootNodeSpec = vi.mocked(getBootNodeSpec);

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
// writeEventPayload
// ---------------------------------------------------------------------------

describe('writeEventPayload', () => {
  it('builds event base with normalized defaults', () => {
    expect(buildWriteEventBase({
      node_uri: 'core://agent',
      node_uuid: 'node-1',
    })).toEqual({
      node_uri: 'core://agent',
      node_uuid: 'node-1',
      domain: 'core',
      path: '',
      source: 'unknown',
      session_id: null,
      client_type: null,
    });
  });

  it('preserves provided event context values', () => {
    expect(buildWriteEventBase({
      node_uri: 'core://agent/profile',
      node_uuid: 'node-2',
      domain: 'core',
      path: 'agent/profile',
      eventContext: {
        source: 'mcp:lore_update_node',
        session_id: 'session-1',
        client_type: 'claudecode',
      },
    })).toEqual({
      node_uri: 'core://agent/profile',
      node_uuid: 'node-2',
      domain: 'core',
      path: 'agent/profile',
      source: 'mcp:lore_update_node',
      session_id: 'session-1',
      client_type: 'claudecode',
    });
  });
});

// ---------------------------------------------------------------------------
// writeArtifactScheduling
// ---------------------------------------------------------------------------

describe('writeArtifactScheduling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('schedules refresh for a single write path', async () => {
    scheduleWriteArtifactsRefresh({ domain: 'core', path: 'agent/profile' });
    await Promise.resolve();

    expect(upsertGeneratedMemoryViewsForPath).toHaveBeenCalledWith({ domain: 'core', path: 'agent/profile' });
    expect(upsertGeneratedGlossaryEmbeddingsForPath).toHaveBeenCalledWith({ domain: 'core', path: 'agent/profile' });
  });

  it('schedules delete for a single write path', async () => {
    scheduleWriteArtifactsDelete({ domain: 'core', path: 'agent/profile' });
    await Promise.resolve();

    expect(deleteGeneratedMemoryViewsByPrefix).toHaveBeenCalledWith({ domain: 'core', path: 'agent/profile' });
    expect(deleteGeneratedGlossaryEmbeddingsByPrefix).toHaveBeenCalledWith({ domain: 'core', path: 'agent/profile' });
  });

  it('schedules delete and refresh after move', async () => {
    scheduleWriteArtifactsAfterMove(
      { domain: 'core', path: 'old/path' },
      { domain: 'work', path: 'new/path' },
      [{ path: 'new/path/child' }],
    );
    await Promise.resolve();

    expect(deleteGeneratedMemoryViewsByPrefix).toHaveBeenCalledWith({ domain: 'core', path: 'old/path' });
    expect(deleteGeneratedGlossaryEmbeddingsByPrefix).toHaveBeenCalledWith({ domain: 'core', path: 'old/path' });
    expect(upsertGeneratedMemoryViewsForPath).toHaveBeenNthCalledWith(1, { domain: 'work', path: 'new/path' });
    expect(upsertGeneratedMemoryViewsForPath).toHaveBeenNthCalledWith(2, { domain: 'work', path: 'new/path/child' });
    expect(upsertGeneratedGlossaryEmbeddingsForPath).toHaveBeenNthCalledWith(1, { domain: 'work', path: 'new/path' });
    expect(upsertGeneratedGlossaryEmbeddingsForPath).toHaveBeenNthCalledWith(2, { domain: 'work', path: 'new/path/child' });
  });
});

// ---------------------------------------------------------------------------
// writeBootGuard
// ---------------------------------------------------------------------------

describe('writeBootGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBootNodeSpec.mockReset();
    mockGetBootNodeSpec.mockReturnValue(null);
  });

  it('blocks deletion of fixed boot nodes outside rollback', () => {
    mockGetBootNodeSpec.mockReturnValue({
      uri: 'core://soul',
      role: 'soul',
      role_label: 'style / persona / self-definition',
      purpose: 'Agent style, persona, and self-cognition baseline.',
      dream_protection: 'protected',
    } as any);

    expect(() => assertDeleteAllowed('core', 'soul', {})).toThrow('Cannot delete fixed boot node core://soul');
    try {
      assertDeleteAllowed('core', 'soul', {});
    } catch (err: any) {
      expect(err.status).toBe(409);
      expect(err.code).toBe('protected_boot_path');
      expect(err.blocked_uri).toBe('core://soul');
      expect(err.boot_role).toBe('soul');
      expect(err.boot_role_label).toBe('style / persona / self-definition');
    }
  });

  it('allows rollback deletion of fixed boot nodes', () => {
    mockGetBootNodeSpec.mockReturnValue({
      uri: 'core://soul',
      role: 'soul',
      role_label: 'style / persona / self-definition',
      purpose: 'Agent style, persona, and self-cognition baseline.',
      dream_protection: 'protected',
    } as any);

    expect(() => assertDeleteAllowed('core', 'soul', { source: 'dream:rollback' })).not.toThrow();
  });

  it('blocks moving fixed boot nodes outside rollback', () => {
    mockGetBootNodeSpec.mockImplementation((uri: unknown) => String(uri) === 'core://soul'
      ? {
          uri: 'core://soul',
          role: 'soul',
          role_label: 'style / persona / self-definition',
          purpose: 'Agent style, persona, and self-cognition baseline.',
          dream_protection: 'protected',
        } as any
      : null);

    expect(() => assertMoveAllowed('core://soul', 'core://soul_archive', {})).toThrow('Cannot move fixed boot node core://soul');
  });

  it('blocks moving onto fixed boot paths outside rollback', () => {
    mockGetBootNodeSpec.mockImplementation((uri: unknown) => String(uri) === 'preferences://user'
      ? {
          uri: 'preferences://user',
          role: 'user',
          role_label: 'stable user definition',
          purpose: 'Stable user information, user preferences, and durable collaboration context.',
          dream_protection: 'protected',
        } as any
      : null);

    expect(() => assertMoveAllowed('core://old_path', 'preferences://user', {})).toThrow('Cannot move a node onto fixed boot path preferences://user');
  });

  it('allows rollback move of fixed boot nodes', () => {
    mockGetBootNodeSpec.mockImplementation((uri: unknown) => String(uri) === 'core://soul'
      ? {
          uri: 'core://soul',
          role: 'soul',
          role_label: 'style / persona / self-definition',
          purpose: 'Agent style, persona, and self-cognition baseline.',
          dream_protection: 'protected',
        } as any
      : null);

    expect(() => assertMoveAllowed('core://soul', 'core://soul_archive', { source: 'dream:rollback' })).not.toThrow();
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
    expect(result.operation).toBe('create');
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

  it('passes client_type through create events', async () => {
    const client = makeMockClient([
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
      { rows: [{ id: 5 }], rowCount: 1 },
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
    ]);
    mockGetPool.mockReturnValue(makePool(client) as any);

    await createNode({ domain: 'core', title: 'evt_node', content: 'test' }, { client_type: 'openclaw' });

    expect(mockLogMemoryEvent.mock.calls[0][0]).toMatchObject({ client_type: 'openclaw' });
  });

  it('throws 422 when parentPath is not found', async () => {
    const client = makeMockClient([
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
    ]);
    mockGetPool.mockReturnValue(makePool(client) as any);

    let err: any;
    try {
      await createNode({ domain: 'core', parentPath: 'missing', title: 'child', content: 'x' });
      expect.fail('should have thrown');
    } catch (error) {
      err = error;
    }

    expect(err.message).toContain('Parent path not found');
    expect(err.status).toBe(422);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('throws 422 for invalid title containing uppercase', async () => {
    // Does not even reach DB since assertValidPathSegment throws synchronously
    await expect(
      createNode({ domain: 'core', title: 'BadTitle', content: 'x' }),
    ).rejects.toThrow('snake_case ASCII only');
  });

  it('writes normalized glossary keywords inside the create transaction', async () => {
    const client = makeMockClient([
      { rows: [], rowCount: 0 },          // BEGIN
      { rows: [], rowCount: 0 },          // INSERT nodes
      { rows: [], rowCount: 0 },          // INSERT memories
      { rows: [{ id: 1 }], rowCount: 1 }, // INSERT edges RETURNING id
      { rows: [], rowCount: 0 },          // INSERT paths
      { rows: [{ keyword: 'alpha' }], rowCount: 1 },
      { rows: [{ keyword: 'beta' }], rowCount: 1 },
      { rows: [], rowCount: 0 },          // COMMIT
    ]);
    mockGetPool.mockReturnValue(makePool(client) as any);

    await createNode({
      domain: 'core',
      title: 'glossary_node',
      content: 'data',
      glossary: [' alpha ', '', 'beta', 'alpha'],
    });

    const glossaryCalls = client.query.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO glossary_keywords'),
    );
    expect(glossaryCalls).toHaveLength(2);
    expect(glossaryCalls[0][1]).toEqual(['alpha', expect.any(String)]);
    expect(glossaryCalls[1][1]).toEqual(['beta', expect.any(String)]);
    expect(mockLogMemoryEvent.mock.calls[0][0]).toMatchObject({
      after_snapshot: expect.objectContaining({ glossary_keywords: ['alpha', 'beta'] }),
      details: expect.objectContaining({ glossary_added: ['alpha', 'beta'], glossary_skipped: [] }),
    });
  });

  it('rolls back when glossary insertion fails', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockRejectedValueOnce(new Error('glossary insert failed')),
      release: vi.fn(),
    };
    mockGetPool.mockReturnValue(makePool(client) as any);

    await expect(createNode({
      domain: 'core',
      title: 'glossary_node',
      content: 'data',
      glossary: ['alpha'],
    })).rejects.toThrow('glossary insert failed');

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rolls back on create failure and re-throws', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
        .mockRejectedValueOnce(new Error('DB error')),    // sibling query fails
      release: vi.fn(),
    };
    mockGetPool.mockReturnValue(makePool(client) as any);

    await expect(createNode({ domain: 'core', content: 'x' })).rejects.toThrow('DB error');
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
    mockGetBootNodeSpec.mockReset();
    mockGetBootNodeSpec.mockReturnValue(null);
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
      // INSERT new memory (RETURNING id)
      { rows: [{ id: 99 }], rowCount: 1 },
      // UPDATE old memory deprecated + migrated_to
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
    expect(result.operation).toBe('update');
    expect(result.uri).toBe('core://agent/prefs');
    expect(result.path).toBe('agent/prefs');
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

  it('passes client_type through update events', async () => {
    const client = makeUpdateClient({ currentContent: 'old' });
    mockGetPool.mockReturnValue(makePool(client) as any);

    await updateNodeByPath(
      { domain: 'core', path: 'agent/prefs', content: 'updated' },
      { client_type: 'claudecode' },
    );

    expect(mockLogMemoryEvent.mock.calls[0][0]).toMatchObject({ client_type: 'claudecode' });
  });

  it('rolls back on failure and re-throws', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{
            domain: 'core',
            path: 'anything',
            edge_id: 20,
            parent_uuid: 'parent-uuid',
            child_uuid: 'node-uuid',
            priority: 1,
            disclosure: null,
          }],
          rowCount: 1,
        })
        .mockRejectedValueOnce(new Error('DB crash')),
      release: vi.fn(),
    };
    mockGetPool.mockReturnValue(makePool(client as any) as any);

    await expect(
      updateNodeByPath({ domain: 'core', path: 'anything', content: 'x' }),
    ).rejects.toThrow('DB crash');

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// deleteNodeByPath
// ---------------------------------------------------------------------------

describe('deleteNodeByPath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBootNodeSpec.mockReset();
    mockGetBootNodeSpec.mockReturnValue(null);
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
      // delete glossary rows for del-uuid
      { rows: [], rowCount: 1 },
      // delete glossary rows for child-uuid
      { rows: [], rowCount: 1 },
      { rows: [], rowCount: 0 },                         // COMMIT
    ]);
  }

  it('blocks deletion of fixed boot nodes outside rollback', async () => {
    mockGetBootNodeSpec.mockReturnValue({
      uri: 'core://soul',
      role: 'soul',
      role_label: 'style / persona / self-definition',
      purpose: 'Agent style, persona, and self-cognition baseline.',
      dream_protection: 'protected',
    } as any);

    const err = await deleteNodeByPath({ domain: 'core', path: 'soul' }).catch((e: any) => e);
    expect(err.message).toContain('Cannot delete fixed boot node core://soul');
    expect(err.status).toBe(409);
    expect(err.code).toBe('protected_boot_path');
    expect(mockGetPool).not.toHaveBeenCalled();
  });

  it('allows rollback to delete fixed boot nodes', async () => {
    mockGetBootNodeSpec.mockReturnValue({
      uri: 'core://soul',
      role: 'soul',
      role_label: 'style / persona / self-definition',
      purpose: 'Agent style, persona, and self-cognition baseline.',
      dream_protection: 'protected',
    } as any);
    const client = makeMockClient([
      { rows: [], rowCount: 0 },
      {
        rows: [{
          domain: 'core', path: 'soul', edge_id: 50,
          parent_uuid: 'parent', child_uuid: 'del-uuid',
          priority: 0, disclosure: null,
        }],
        rowCount: 1,
      },
      { rows: [{ content: 'some content' }], rowCount: 1 },
      {
        rows: [{ domain: 'core', path: 'soul', edge_id: 50, child_uuid: 'del-uuid' }],
        rowCount: 1,
      },
      { rows: [], rowCount: 1 },
      { rows: [{ count: '0' }], rowCount: 1 },
      { rows: [], rowCount: 1 },
      { rows: [{ count: '0' }], rowCount: 1 },
      { rows: [], rowCount: 1 },
      { rows: [], rowCount: 1 },
      { rows: [], rowCount: 0 },
    ]);
    mockGetPool.mockReturnValue(makePool(client) as any);

    const result = await deleteNodeByPath(
      { domain: 'core', path: 'soul' },
      { source: 'dream:rollback' },
    );

    expect(result.success).toBe(true);
    expect(result.deleted_uri).toBe('core://soul');
  });

  it('deletes node and returns deleted_uri', async () => {
    const client = makeDeleteClient();
    mockGetPool.mockReturnValue(makePool(client) as any);

    const result = await deleteNodeByPath({ domain: 'core', path: 'to/delete' });
    expect(result.success).toBe(true);
    expect(result.operation).toBe('delete');
    expect(result.uri).toBe('core://to/delete');
    expect(result.path).toBe('to/delete');
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

  it('removes glossary rows for every deleted node in the subtree', async () => {
    const client = makeDeleteClient();
    mockGetPool.mockReturnValue(makePool(client) as any);

    await deleteNodeByPath({ domain: 'core', path: 'to/delete' });

    const glossaryDeletes = client.query.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('DELETE FROM glossary_keywords'),
    );
    expect(glossaryDeletes).toEqual([
      ['DELETE FROM glossary_keywords WHERE node_uuid = $1', ['del-uuid']],
      ['DELETE FROM glossary_keywords WHERE node_uuid = $1', ['child-uuid']],
    ]);
  });

  it('passes client_type through delete events', async () => {
    const client = makeDeleteClient();
    mockGetPool.mockReturnValue(makePool(client) as any);

    await deleteNodeByPath({ domain: 'core', path: 'to/delete' }, { client_type: 'mcp' });

    expect(mockLogMemoryEvent.mock.calls[0][0]).toMatchObject({ client_type: 'mcp' });
  });

  it('rolls back on failure', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{
            domain: 'core',
            path: 'x',
            edge_id: 50,
            parent_uuid: 'parent',
            child_uuid: 'del-uuid',
            priority: 0,
            disclosure: null,
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [{ content: 'some content' }], rowCount: 1 })
        .mockRejectedValueOnce(new Error('constraint')),
      release: vi.fn(),
    };
    mockGetPool.mockReturnValue(makePool(client as any) as any);

    await expect(deleteNodeByPath({ domain: 'core', path: 'x' })).rejects.toThrow('constraint');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// moveNode
// ---------------------------------------------------------------------------

describe('moveNode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBootNodeSpec.mockReset();
    mockGetBootNodeSpec.mockReturnValue(null);
  });

  function makeMoveClient() {
    return makeMockClient([
      { rows: [], rowCount: 0 },
      {
        rows: [{
          domain: 'core',
          path: 'old/path',
          edge_id: 70,
          parent_uuid: 'parent',
          child_uuid: 'move-uuid',
          priority: 2,
          disclosure: null,
        }],
        rowCount: 1,
      },
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 1 },
      { rows: [], rowCount: 1 },
      { rows: [{ path: 'new/path/child' }], rowCount: 1 },
      { rows: [], rowCount: 0 },
    ]);
  }

  it('blocks moving fixed boot nodes outside rollback', async () => {
    mockGetBootNodeSpec.mockImplementation((uri: unknown) => String(uri) === 'core://soul'
      ? {
          uri: 'core://soul',
          role: 'soul',
          role_label: 'style / persona / self-definition',
          purpose: 'Agent style, persona, and self-cognition baseline.',
          dream_protection: 'protected',
        } as any
      : null);

    const err = await moveNode({ old_uri: 'core://soul', new_uri: 'core://soul_archive' }).catch((e: any) => e);
    expect(err.message).toContain('Cannot move fixed boot node core://soul');
    expect(err.status).toBe(409);
    expect(err.code).toBe('protected_boot_path');
    expect(mockGetPool).not.toHaveBeenCalled();
  });

  it('blocks moving nodes onto fixed boot paths outside rollback', async () => {
    mockGetBootNodeSpec.mockImplementation((uri: unknown) => String(uri) === 'preferences://user'
      ? {
          uri: 'preferences://user',
          role: 'user',
          role_label: 'stable user definition',
          purpose: 'Stable user information, user preferences, and durable collaboration context.',
          dream_protection: 'protected',
        } as any
      : null);

    const err = await moveNode({ old_uri: 'core://old_path', new_uri: 'preferences://user' }).catch((e: any) => e);
    expect(err.message).toContain('Cannot move a node onto fixed boot path preferences://user');
    expect(err.status).toBe(409);
    expect(err.code).toBe('protected_boot_path');
    expect(mockGetPool).not.toHaveBeenCalled();
  });

  it('allows rollback to move fixed boot nodes', async () => {
    mockGetBootNodeSpec.mockImplementation((uri: unknown) => String(uri) === 'core://soul'
      ? {
          uri: 'core://soul',
          role: 'soul',
          role_label: 'style / persona / self-definition',
          purpose: 'Agent style, persona, and self-cognition baseline.',
          dream_protection: 'protected',
        } as any
      : null);
    const client = makeMockClient([
      { rows: [], rowCount: 0 },
      {
        rows: [{
          domain: 'core',
          path: 'soul',
          edge_id: 70,
          parent_uuid: 'parent',
          child_uuid: 'move-uuid',
          priority: 2,
          disclosure: null,
        }],
        rowCount: 1,
      },
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 1 },
      { rows: [], rowCount: 1 },
      { rows: [{ path: 'soul_archive/child' }], rowCount: 1 },
      { rows: [], rowCount: 0 },
    ]);
    mockGetPool.mockReturnValue(makePool(client) as any);

    const result = await moveNode(
      { old_uri: 'core://soul', new_uri: 'core://soul_archive' },
      { source: 'dream:rollback' },
    );

    expect(result.success).toBe(true);
    expect(result.new_uri).toBe('core://soul_archive');
  });

  it('moves node and returns old/new uri with node_uuid', async () => {
    const client = makeMoveClient();
    mockGetPool.mockReturnValue(makePool(client) as any);

    const result = await moveNode({ old_uri: 'core://old/path', new_uri: 'core://new/path' });
    expect(result.success).toBe(true);
    expect(result.operation).toBe('move');
    expect(result.uri).toBe('core://new/path');
    expect(result.path).toBe('new/path');
    expect(result.old_uri).toBe('core://old/path');
    expect(result.new_uri).toBe('core://new/path');
    expect(result.node_uuid).toBe('move-uuid');
  });

  it('logs a move event', async () => {
    const client = makeMoveClient();
    mockGetPool.mockReturnValue(makePool(client) as any);

    await moveNode({ old_uri: 'core://old/path', new_uri: 'core://new/path' });

    expect(mockLogMemoryEvent).toHaveBeenCalledOnce();
    expect(mockLogMemoryEvent.mock.calls[0][0]).toMatchObject({
      event_type: 'move',
      node_uri: 'core://new/path',
      node_uuid: 'move-uuid',
      details: {
        old_uri: 'core://old/path',
        new_uri: 'core://new/path',
        operation: 'move',
      },
    });
  });

  it('passes client_type through move events', async () => {
    const client = makeMoveClient();
    mockGetPool.mockReturnValue(makePool(client) as any);

    await moveNode(
      { old_uri: 'core://old/path', new_uri: 'core://new/path' },
      { client_type: 'hermes' },
    );

    expect(mockLogMemoryEvent.mock.calls[0][0]).toMatchObject({ client_type: 'hermes' });
  });

  it('rolls back when target path already exists', async () => {
    const client = makeMockClient([
      { rows: [], rowCount: 0 },
      {
        rows: [{
          domain: 'core',
          path: 'old/path',
          edge_id: 70,
          parent_uuid: 'parent',
          child_uuid: 'move-uuid',
          priority: 2,
          disclosure: null,
        }],
        rowCount: 1,
      },
      { rows: [{ '?column?': 1 }], rowCount: 1 },
      { rows: [], rowCount: 0 },
    ]);
    mockGetPool.mockReturnValue(makePool(client) as any);

    await expect(
      moveNode({ old_uri: 'core://old/path', new_uri: 'core://new/path' }),
    ).rejects.toThrow('Target path already exists');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });
});

