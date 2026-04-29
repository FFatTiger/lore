import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db', () => ({ sql: vi.fn() }));
vi.mock('../../view/viewCrud', () => ({ listMemoryViewsByNode: vi.fn() }));

import { sql } from '../../../db';
import { listMemoryViewsByNode } from '../../view/viewCrud';
import { buildBreadcrumbs, pickBestPath } from '../browsePaths';
import {
  ROOT_NODE_UUID,
  listDomains,
  getNodePayload,
} from '../browse';

const mockSql = vi.mocked(sql);
const mockListViews = vi.mocked(listMemoryViewsByNode);

// ---------------------------------------------------------------------------
// ROOT_NODE_UUID re-export
// ---------------------------------------------------------------------------

describe('ROOT_NODE_UUID', () => {
  it('re-exports the canonical zero UUID', () => {
    expect(ROOT_NODE_UUID).toBe('00000000-0000-0000-0000-000000000000');
  });
});

// ---------------------------------------------------------------------------
// pickBestPath
// ---------------------------------------------------------------------------

describe('pickBestPath', () => {
  it('returns null for empty array', () => {
    expect(pickBestPath([], 'core', 'foo/')).toBeNull();
  });

  it('returns null for non-array input', () => {
    // @ts-expect-error testing invalid input
    expect(pickBestPath(null, 'core', 'foo/')).toBeNull();
  });

  it('returns the single element when only one path', () => {
    const paths = [{ domain: 'core', path: 'a/b' }];
    expect(pickBestPath(paths, 'core', 'a/')).toEqual({ domain: 'core', path: 'a/b' });
  });

  it('prefers path matching domain AND prefix (tier 1)', () => {
    const paths = [
      { domain: 'other', path: 'x/child' },
      { domain: 'core', path: 'foo/child' },
      { domain: 'core', path: 'bar/child' },
    ];
    expect(pickBestPath(paths, 'core', 'foo/')).toEqual({ domain: 'core', path: 'foo/child' });
  });

  it('falls back to domain match when no prefix match (tier 2)', () => {
    const paths = [
      { domain: 'other', path: 'x/child' },
      { domain: 'core', path: 'baz/child' },
    ];
    expect(pickBestPath(paths, 'core', 'nope/')).toEqual({ domain: 'core', path: 'baz/child' });
  });

  it('falls back to first element when no domain match', () => {
    const paths = [
      { domain: 'alpha', path: 'a/b' },
      { domain: 'beta', path: 'c/d' },
    ];
    expect(pickBestPath(paths, 'gamma', 'x/')).toEqual({ domain: 'alpha', path: 'a/b' });
  });

  it('returns first element when contextDomain is null', () => {
    const paths = [
      { domain: 'alpha', path: 'a/b' },
      { domain: 'beta', path: 'c/d' },
    ];
    expect(pickBestPath(paths, null, null)).toEqual({ domain: 'alpha', path: 'a/b' });
  });
});

// ---------------------------------------------------------------------------
// buildBreadcrumbs
// ---------------------------------------------------------------------------

describe('buildBreadcrumbs', () => {
  it('returns root-only crumb for empty path', () => {
    expect(buildBreadcrumbs('')).toEqual([{ path: '', label: 'root' }]);
  });

  it('returns root-only crumb for null/undefined', () => {
    expect(buildBreadcrumbs(null)).toEqual([{ path: '', label: 'root' }]);
    expect(buildBreadcrumbs(undefined)).toEqual([{ path: '', label: 'root' }]);
  });

  it('builds single-segment breadcrumb', () => {
    expect(buildBreadcrumbs('animals')).toEqual([
      { path: '', label: 'root' },
      { path: 'animals', label: 'animals' },
    ]);
  });

  it('builds multi-segment breadcrumbs with accumulated paths', () => {
    expect(buildBreadcrumbs('a/b/c')).toEqual([
      { path: '', label: 'root' },
      { path: 'a', label: 'a' },
      { path: 'a/b', label: 'b' },
      { path: 'a/b/c', label: 'c' },
    ]);
  });

  it('ignores leading/trailing slashes via filter', () => {
    // The function splits by '/' and filters(Boolean), so '/a/b/' → ['a','b']
    const crumbs = buildBreadcrumbs('/a/b/');
    expect(crumbs.length).toBe(3); // root + a + b
    expect(crumbs[1].label).toBe('a');
    expect(crumbs[2].label).toBe('b');
  });
});

// ---------------------------------------------------------------------------
// listDomains
// ---------------------------------------------------------------------------

describe('listDomains', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns domains with numeric root_count', async () => {
    mockSql.mockResolvedValueOnce({
      rows: [
        { domain: 'core', root_count: '5' },
        { domain: 'work', root_count: '2' },
      ],
      rowCount: 2,
    } as any);

    const result = await listDomains();
    expect(result).toEqual([
      { domain: 'core', root_count: 5 },
      { domain: 'work', root_count: 2 },
    ]);
  });

  it('returns empty array when db returns no rows', async () => {
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const result = await listDomains();
    expect(result).toEqual([]);
  });

  it('coerces null/missing root_count to 0', async () => {
    mockSql.mockResolvedValueOnce({
      rows: [{ domain: 'orphan', root_count: null }],
      rowCount: 1,
    } as any);

    const result = await listDomains();
    expect(result[0].root_count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getNodePayload
// ---------------------------------------------------------------------------

describe('getNodePayload', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockListViews.mockResolvedValue([]);
  });

  // Helper: set up a "normal" node at domain/path
  function setupNormalNode({
    domain = 'core',
    path = 'animals/cat',
    node_uuid = 'uuid-cat',
    content = 'A furry animal',
    priority = 5,
    disclosure = null as string | null,
    alias_total = 1,
    latestWriteRows = [] as Record<string, unknown>[],
    updaterSummaryRows = [] as Record<string, unknown>[],
  } = {}) {
    // getMemoryByPath → main SELECT
    mockSql.mockResolvedValueOnce({
      rows: [
        {
          domain,
          path,
          node_uuid,
          priority,
          disclosure,
          id: 42,
          content,
          deprecated: false,
          created_at: '2025-01-01T00:00:00Z',
        },
      ],
      rowCount: 1,
    } as any);
    // getMemoryByPath → alias count
    mockSql.mockResolvedValueOnce({
      rows: [{ total_paths: String(alias_total) }],
      rowCount: 1,
    } as any);
    // getAliases
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    // getGlossaryKeywords
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    // getChildren → edge query
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    // getLatestWriteMetaByNodeUuid for current node
    mockSql.mockResolvedValueOnce({ rows: latestWriteRows, rowCount: latestWriteRows.length } as any);
    // getUpdaterSummariesByNodeUuid for current node
    mockSql.mockResolvedValueOnce({ rows: updaterSummaryRows, rowCount: updaterSummaryRows.length } as any);
  }

  it('returns node with expected shape for a normal path', async () => {
    setupNormalNode();
    const result = await getNodePayload({ domain: 'core', path: 'animals/cat' });

    expect(result).toHaveProperty('node');
    expect(result).toHaveProperty('children');
    expect(result).toHaveProperty('breadcrumbs');
    expect(result.node.uri).toBe('core://animals/cat');
    expect(result.node.content).toBe('A furry animal');
    expect(result.node.is_virtual).toBe(false);
  });

  it('throws 404 error when path is not found', async () => {
    // getMemoryByPath returns no rows
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    await expect(getNodePayload({ domain: 'core', path: 'missing/path' })).rejects.toThrow(
      'Path not found: core://missing/path',
    );
  });

  it('thrown error has status 404', async () => {
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    try {
      await getNodePayload({ domain: 'core', path: 'nope' });
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.status).toBe(404);
    }
  });

  it('returns virtual root node for empty path', async () => {
    // Empty path → synthetic memory returned directly (no sql calls for path lookup)
    mockSql
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any) // getChildren → edge query (returns empty)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any) // getLatestWriteMetaByNodeUuid for current node
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any); // getUpdaterSummariesByNodeUuid for current node

    const result = await getNodePayload({ domain: 'core', path: '' });
    expect(result.node.is_virtual).toBe(true);
    expect(result.node.node_uuid).toBe(ROOT_NODE_UUID);
    expect(result.node.uri).toBe('core://');
  });

  it('builds correct breadcrumbs for nested path', async () => {
    setupNormalNode({ path: 'a/b/c', node_uuid: 'uuid-abc' });
    const result = await getNodePayload({ domain: 'core', path: 'a/b/c' });

    expect(result.breadcrumbs).toEqual([
      { path: '', label: 'root' },
      { path: 'a', label: 'a' },
      { path: 'a/b', label: 'b' },
      { path: 'a/b/c', label: 'c' },
    ]);
  });

  it('populates aliases from db', async () => {
    // getMemoryByPath main query
    mockSql.mockResolvedValueOnce({
      rows: [
        {
          domain: 'core',
          path: 'cat',
          node_uuid: 'uuid-cat',
          priority: 1,
          disclosure: null,
          id: 1,
          content: 'meow',
          deprecated: false,
          created_at: null,
        },
      ],
      rowCount: 1,
    } as any);
    // alias count
    mockSql.mockResolvedValueOnce({
      rows: [{ total_paths: '3' }],
      rowCount: 1,
    } as any);
    // getAliases result: two other paths for the same uuid
    mockSql.mockResolvedValueOnce({
      rows: [
        { domain: 'core', path: 'cat' },         // self — should be filtered out
        { domain: 'animals', path: 'feline' },
        { domain: 'core', path: 'kitty' },
      ],
      rowCount: 3,
    } as any);
    // getGlossaryKeywords
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    // getChildren
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    // getLatestWriteMetaByNodeUuid for current node
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    // getUpdaterSummariesByNodeUuid for current node
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const result = await getNodePayload({ domain: 'core', path: 'cat' });
    expect(result.node.aliases).toContain('animals://feline');
    expect(result.node.aliases).toContain('core://kitty');
    // self must NOT appear
    expect(result.node.aliases).not.toContain('core://cat');
  });

  it('populates glossary_keywords from db', async () => {
    mockSql
      .mockResolvedValueOnce({
        rows: [
          { domain: 'core', path: 'plants', node_uuid: 'uuid-plants', priority: 1, disclosure: null, id: 2, content: 'flora', deprecated: false, created_at: null },
        ],
        rowCount: 1,
      } as any)
      // alias count
      .mockResolvedValueOnce({ rows: [{ total_paths: '1' }], rowCount: 1 } as any)
      // aliases
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      // glossary keywords
      .mockResolvedValueOnce({
        rows: [{ keyword: 'botany' }, { keyword: 'flora' }],
        rowCount: 2,
      } as any)
      // children
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      // getLatestWriteMetaByNodeUuid for current node
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      // getUpdaterSummariesByNodeUuid for current node
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const result = await getNodePayload({ domain: 'core', path: 'plants' });
    expect(result.node.glossary_keywords).toEqual(['botany', 'flora']);
  });

  it('skips glossary fetch when navOnly=true', async () => {
    mockSql
      .mockResolvedValueOnce({
        rows: [
          { domain: 'core', path: 'navtest', node_uuid: 'uuid-nav', priority: 1, disclosure: null, id: 3, content: 'x', deprecated: false, created_at: null },
        ],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({ rows: [{ total_paths: '1' }], rowCount: 1 } as any)
      // getAliases
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      // getChildren (no glossary call expected)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      // getLatestWriteMetaByNodeUuid for current node
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      // getUpdaterSummariesByNodeUuid for current node
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const result = await getNodePayload({ domain: 'core', path: 'navtest', navOnly: true });
    expect(result.node.glossary_keywords).toEqual([]);
    expect(mockSql).toHaveBeenCalledTimes(6);
  });

  it('skips memoryViews fetch when navOnly=true', async () => {
    mockSql
      .mockResolvedValueOnce({
        rows: [
          { domain: 'core', path: 'viewtest', node_uuid: 'uuid-vt', priority: 1, disclosure: null, id: 4, content: 'y', deprecated: false, created_at: null },
        ],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({ rows: [{ total_paths: '1' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    await getNodePayload({ domain: 'core', path: 'viewtest', navOnly: true });
    expect(mockListViews).not.toHaveBeenCalled();
  });

  it('skips memoryViews fetch for ROOT node even without navOnly', async () => {
    // Empty path → ROOT_NODE_UUID virtual memory (no sql for path lookup)
    mockSql
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any) // getChildren → edge query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any) // getLatestWriteMetaByNodeUuid for current node
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any); // getUpdaterSummariesByNodeUuid for current node

    await getNodePayload({ domain: 'core', path: '' });
    expect(mockListViews).not.toHaveBeenCalled();
  });

  it('includes children with correct shape', async () => {
    // getMemoryByPath
    mockSql.mockResolvedValueOnce({
      rows: [
        { domain: 'core', path: 'parent', node_uuid: 'uuid-parent', priority: 1, disclosure: null, id: 10, content: 'parent content', deprecated: false, created_at: null },
      ],
      rowCount: 1,
    } as any);
    // alias count
    mockSql.mockResolvedValueOnce({ rows: [{ total_paths: '1' }], rowCount: 1 } as any);
    // getAliases
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    // getGlossaryKeywords
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    // getChildren → main edge query
    mockSql.mockResolvedValueOnce({
      rows: [
        { edge_id: 100, child_uuid: 'uuid-child1', priority: 1, disclosure: null, content: 'child content here' },
      ],
      rowCount: 1,
    } as any);
    // getLatestWriteMetaByNodeUuid for current node
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    // getUpdaterSummariesByNodeUuid for current node
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    // getLatestWriteMetaByNodeUuid for children
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    // getUpdaterSummariesByNodeUuid for children
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    // getChildren → child counts query
    mockSql.mockResolvedValueOnce({
      rows: [{ parent_uuid: 'uuid-child1', child_count: '3' }],
      rowCount: 1,
    } as any);
    // getChildren → paths query
    mockSql.mockResolvedValueOnce({
      rows: [{ edge_id: 100, domain: 'core', path: 'parent/child1' }],
      rowCount: 1,
    } as any);

    const result = await getNodePayload({ domain: 'core', path: 'parent' });
    expect(result.children).toHaveLength(1);
    const child = result.children[0];
    expect(child.node_uuid).toBe('uuid-child1');
    expect(child.domain).toBe('core');
    expect(child.path).toBe('parent/child1');
    expect(child.uri).toBe('core://parent/child1');
    expect(child.approx_children_count).toBe(3);
    expect(child.content_snippet).toBe('child content here');
  });

  it('truncates long content snippets to 100 chars + ellipsis', async () => {
    const longContent = 'x'.repeat(150);

    mockSql
      .mockResolvedValueOnce({
        rows: [{ domain: 'core', path: 'parent', node_uuid: 'uuid-p2', priority: 1, disclosure: null, id: 11, content: 'p', deprecated: false, created_at: null }],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({ rows: [{ total_paths: '1' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      // children edge query
      .mockResolvedValueOnce({
        rows: [{ edge_id: 200, child_uuid: 'uuid-long', priority: 1, disclosure: null, content: longContent }],
        rowCount: 1,
      } as any)
      // latest write meta for children
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      // updater summaries for children
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      // counts
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      // paths
      .mockResolvedValueOnce({ rows: [{ edge_id: 200, domain: 'core', path: 'parent/longchild' }], rowCount: 1 } as any)
      // latest write meta for current node
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      // updater summaries for current node
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const result = await getNodePayload({ domain: 'core', path: 'parent' });
    expect(result.children[0].content_snippet).toBe('x'.repeat(100) + '...');
  });

  it('returns null latest write metadata when no history exists', async () => {
    mockSql
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const result = await getNodePayload({ domain: 'core', path: '' });
    expect(result.node.last_updated_client_type).toBeNull();
    expect(result.node.last_updated_source).toBeNull();
    expect(result.node.last_updated_at).toBeNull();
  });

  it('includes latest write metadata for node and children', async () => {
    mockSql
      .mockResolvedValueOnce({
        rows: [
          {
            domain: 'core',
            path: 'parent',
            node_uuid: 'uuid-parent',
            priority: 1,
            disclosure: null,
            id: 10,
            content: 'parent content',
            deprecated: false,
            created_at: null,
          },
        ],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({ rows: [{ total_paths: '1' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({
        rows: [
          {
            edge_id: 100,
            child_uuid: 'uuid-child1',
            priority: 1,
            disclosure: null,
            content: 'child content here',
          },
        ],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({
        rows: [
          {
            node_uuid: 'uuid-parent',
            source: 'mcp:lore_update_node',
            client_type: 'openclaw',
            created_at: '2025-01-02T00:00:00Z',
            id: 10,
          },
        ],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({
        rows: [
          {
            node_uuid: 'uuid-child1',
            source: 'api:PUT /browse/node',
            client_type: 'hermes',
            created_at: '2025-01-03T00:00:00Z',
            id: 11,
          },
        ],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({
        rows: [{ parent_uuid: 'uuid-child1', child_count: '2' }],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({
        rows: [{ edge_id: 100, domain: 'core', path: 'parent/child1' }],
        rowCount: 1,
      } as any);

    const result = await getNodePayload({ domain: 'core', path: 'parent' });
    expect(result.node.last_updated_client_type).toBe('openclaw');
    expect(result.node.last_updated_source).toBe('mcp:lore_update_node');
    expect(result.node.last_updated_at).toBe(new Date('2025-01-02T00:00:00Z').toISOString());
    expect(result.children[0].last_updated_client_type).toBe('hermes');
    expect(result.children[0].last_updated_source).toBe('api:PUT /browse/node');
    expect(result.children[0].last_updated_at).toBe(new Date('2025-01-03T00:00:00Z').toISOString());
  });

  it('includes grouped updater summaries for node and children', async () => {
    mockSql
      .mockResolvedValueOnce({
        rows: [
          {
            domain: 'core',
            path: 'parent',
            node_uuid: 'uuid-parent',
            priority: 1,
            disclosure: null,
            id: 10,
            content: 'parent content',
            deprecated: false,
            created_at: null,
          },
        ],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({ rows: [{ total_paths: '1' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({
        rows: [
          {
            edge_id: 100,
            child_uuid: 'uuid-child1',
            priority: 1,
            disclosure: null,
            content: 'child content here',
          },
        ],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({
        rows: [
          {
            node_uuid: 'uuid-parent',
            client_type: 'openclaw',
            source: 'mcp:lore_update_node',
            updated_at: '2025-01-06T00:00:00Z',
            event_count: '3',
          },
          {
            node_uuid: 'uuid-parent',
            client_type: 'mcp',
            source: 'api:POST /browse/move',
            updated_at: '2025-01-05T00:00:00Z',
            event_count: '1',
          },
        ],
        rowCount: 2,
      } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({
        rows: [
          {
            node_uuid: 'uuid-child1',
            client_type: 'hermes',
            source: 'api:PUT /browse/node',
            updated_at: '2025-01-04T00:00:00Z',
            event_count: '2',
          },
          {
            node_uuid: 'uuid-child1',
            client_type: null,
            source: 'legacy:seed',
            updated_at: '2025-01-03T00:00:00Z',
            event_count: '1',
          },
        ],
        rowCount: 2,
      } as any)
      .mockResolvedValueOnce({
        rows: [{ parent_uuid: 'uuid-child1', child_count: '2' }],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({
        rows: [{ edge_id: 100, domain: 'core', path: 'parent/child1' }],
        rowCount: 1,
      } as any);

    const result = await getNodePayload({ domain: 'core', path: 'parent' });
    expect(result.node.updaters).toEqual([
      {
        client_type: 'openclaw',
        source: 'mcp:lore_update_node',
        updated_at: new Date('2025-01-06T00:00:00Z').toISOString(),
        event_count: 3,
      },
      {
        client_type: 'mcp',
        source: 'api:POST /browse/move',
        updated_at: new Date('2025-01-05T00:00:00Z').toISOString(),
        event_count: 1,
      },
    ]);
    expect(result.children[0].updaters).toEqual([
      {
        client_type: 'hermes',
        source: 'api:PUT /browse/node',
        updated_at: new Date('2025-01-04T00:00:00Z').toISOString(),
        event_count: 2,
      },
      {
        client_type: null,
        source: 'legacy:seed',
        updated_at: new Date('2025-01-03T00:00:00Z').toISOString(),
        event_count: 1,
      },
    ]);
  });

  it('queries updater summaries grouped by client_type and source', async () => {
    setupNormalNode({
      path: 'animals/cat',
      node_uuid: 'uuid-cat',
      updaterSummaryRows: [{
        node_uuid: 'uuid-cat',
        client_type: 'openclaw',
        source: 'mcp:lore_update_node',
        updated_at: '2025-01-04T00:00:00Z',
        event_count: '2',
      }],
    });

    const result = await getNodePayload({ domain: 'core', path: 'animals/cat' });
    const updaterSummaryQuery = mockSql.mock.calls.find((c) => String(c[0]).includes('COUNT(*) AS event_count'));
    expect(updaterSummaryQuery).toBeDefined();
    expect(String(updaterSummaryQuery![0])).toContain('COUNT(*) AS event_count');
    expect(String(updaterSummaryQuery![0])).toContain('GROUP BY node_uuid');
    expect(String(updaterSummaryQuery![0])).toContain("LOWER(BTRIM(COALESCE(details->>'client_type', ''))) IN ('claudecode', 'openclaw', 'hermes', 'codex', 'mcp', 'admin')");
    expect(String(updaterSummaryQuery![0])).toContain('ORDER BY node_uuid ASC, MAX(created_at) DESC, COUNT(*) DESC, source ASC');
    expect(result.node.updaters).toEqual([
      {
        client_type: 'openclaw',
        source: 'mcp:lore_update_node',
        updated_at: new Date('2025-01-04T00:00:00Z').toISOString(),
        event_count: 2,
      },
    ]);
  });


  it('returns null client_type when latest write is legacy', async () => {
    setupNormalNode({
      path: 'legacy/node',
      node_uuid: 'uuid-legacy',
      latestWriteRows: [{
        node_uuid: 'uuid-legacy',
        source: 'api:PUT /browse/node',
        client_type: null,
        created_at: '2025-01-05T00:00:00Z',
        id: 13,
      }],
    });

    const result = await getNodePayload({ domain: 'core', path: 'legacy/node' });
    expect(result.node.last_updated_client_type).toBeNull();
    expect(result.node.last_updated_source).toBe('api:PUT /browse/node');
    expect(result.node.last_updated_at).toBe(new Date('2025-01-05T00:00:00Z').toISOString());
  });

  it('returns top-level root children when edge ids come back as strings', async () => {
    mockSql
      .mockResolvedValueOnce({
        rows: [
          { edge_id: '100', child_uuid: 'uuid-agent', priority: 0, disclosure: null, content: 'agent content' },
          { edge_id: '101', child_uuid: 'uuid-soul', priority: 0, disclosure: null, content: 'soul content' },
        ],
        rowCount: 2,
      } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({
        rows: [
          { edge_id: 100, domain: 'core', path: 'agent' },
          { edge_id: 101, domain: 'core', path: 'soul' },
        ],
        rowCount: 2,
      } as any);

    const result = await getNodePayload({ domain: 'core', path: '' });
    expect(result.children).toEqual([
      expect.objectContaining({ uri: 'core://agent', path: 'agent', node_uuid: 'uuid-agent' }),
      expect.objectContaining({ uri: 'core://soul', path: 'soul', node_uuid: 'uuid-soul' }),
    ]);
  });

  it('uses default domain=core and path="" when no options provided', async () => {
    // empty path → virtual root, no sql for path lookup
    mockSql
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any) // getChildren → edge query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any) // getLatestWriteMetaByNodeUuid for current node
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any); // getUpdaterSummariesByNodeUuid for current node

    const result = await getNodePayload();
    expect(result.node.domain).toBe('core');
    expect(result.node.path).toBe('');
    expect(result.node.is_virtual).toBe(true);
  });
});
