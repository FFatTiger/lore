import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db', () => ({ sql: vi.fn() }));
vi.mock('../browse', () => ({ ROOT_NODE_UUID: '00000000-0000-0000-0000-000000000000' }));
vi.mock('../browseActivity', () => ({
  emptyLatestWriteMeta: vi.fn(() => ({
    last_updated_client_type: null,
    last_updated_source: null,
    last_updated_at: null,
  })),
  emptyUpdaterSummaries: vi.fn(() => []),
  getLatestWriteMetaByNodeUuid: vi.fn(),
  getUpdaterSummariesByNodeUuid: vi.fn(),
}));

import { sql } from '../../../db';
import { getLatestWriteMetaByNodeUuid, getUpdaterSummariesByNodeUuid } from '../browseActivity';
import { getChildren } from '../browseChildren';

const mockSql = vi.mocked(sql);
const mockGetLatestWriteMetaByNodeUuid = vi.mocked(getLatestWriteMetaByNodeUuid);
const mockGetUpdaterSummariesByNodeUuid = vi.mocked(getUpdaterSummariesByNodeUuid);

describe('browseChildren helper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLatestWriteMetaByNodeUuid.mockResolvedValue(new Map());
    mockGetUpdaterSummariesByNodeUuid.mockResolvedValue(new Map());
  });

  it('returns children with selected path and child counts', async () => {
    mockSql
      .mockResolvedValueOnce({
        rows: [{ edge_id: 100, child_uuid: 'uuid-child1', priority: 1, disclosure: null, content: 'child content here' }],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({
        rows: [{ parent_uuid: 'uuid-child1', child_count: '3' }],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({
        rows: [{ edge_id: 100, domain: 'core', path: 'parent/child1' }],
        rowCount: 1,
      } as any);

    const result = await getChildren({ nodeUuid: 'uuid-parent', contextDomain: 'core', contextPath: 'parent' });
    expect(result).toEqual([
      expect.objectContaining({
        node_uuid: 'uuid-child1',
        domain: 'core',
        path: 'parent/child1',
        uri: 'core://parent/child1',
        approx_children_count: 3,
        content_snippet: 'child content here',
      }),
    ]);
  });

  it('keeps top-level root children when edge ids are strings', async () => {
    mockSql
      .mockResolvedValueOnce({
        rows: [
          { edge_id: '100', child_uuid: 'uuid-agent', priority: 0, disclosure: null, content: 'agent content' },
          { edge_id: '101', child_uuid: 'uuid-soul', priority: 0, disclosure: null, content: 'soul content' },
        ],
        rowCount: 2,
      } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({
        rows: [
          { edge_id: 100, domain: 'core', path: 'agent' },
          { edge_id: 101, domain: 'core', path: 'soul' },
        ],
        rowCount: 2,
      } as any);

    const result = await getChildren({ nodeUuid: '00000000-0000-0000-0000-000000000000', contextDomain: 'core', contextPath: '' });
    expect(result).toEqual([
      expect.objectContaining({ uri: 'core://agent', path: 'agent', node_uuid: 'uuid-agent' }),
      expect.objectContaining({ uri: 'core://soul', path: 'soul', node_uuid: 'uuid-soul' }),
    ]);
  });

  it('drops root children that have no path in the current domain', async () => {
    mockSql
      .mockResolvedValueOnce({
        rows: [{ edge_id: 100, child_uuid: 'uuid-child', priority: 0, disclosure: null, content: 'child content' }],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({
        rows: [{ edge_id: 100, domain: 'other', path: 'child' }],
        rowCount: 1,
      } as any);

    const result = await getChildren({ nodeUuid: '00000000-0000-0000-0000-000000000000', contextDomain: 'core', contextPath: '' });
    expect(result).toEqual([]);
  });
});
