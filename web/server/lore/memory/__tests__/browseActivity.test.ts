import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db', () => ({ sql: vi.fn() }));
vi.mock('../../../auth', () => ({
  CLIENT_TYPES: ['claudecode', 'openclaw', 'hermes', 'mcp', 'admin'],
  normalizeClientType: vi.fn((value: string | null) => value || null),
}));

import { sql } from '../../../db';
import { normalizeClientType } from '../../../auth';
import {
  emptyLatestWriteMeta,
  emptyUpdaterSummaries,
  getLatestWriteMetaByNodeUuid,
  getUpdaterSummariesByNodeUuid,
} from '../browseActivity';

const mockSql = vi.mocked(sql);
const mockNormalizeClientType = vi.mocked(normalizeClientType);

describe('browseActivity helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNormalizeClientType.mockImplementation((value: string | null) => value || null);
  });

  it('returns empty latest write meta defaults', () => {
    expect(emptyLatestWriteMeta()).toEqual({
      last_updated_client_type: null,
      last_updated_source: null,
      last_updated_at: null,
    });
  });

  it('returns empty updater summaries defaults', () => {
    expect(emptyUpdaterSummaries()).toEqual([]);
  });

  it('returns empty map when latest write input is empty', async () => {
    await expect(getLatestWriteMetaByNodeUuid([])).resolves.toEqual(new Map());
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('formats latest write metadata with normalized client type', async () => {
    mockSql.mockResolvedValueOnce({
      rows: [{
        node_uuid: 'uuid-parent',
        source: 'mcp:lore_update_node',
        client_type: 'openclaw',
        created_at: '2025-01-02T00:00:00Z',
        id: 10,
      }],
      rowCount: 1,
    } as any);

    const result = await getLatestWriteMetaByNodeUuid(['uuid-parent']);
    expect(result.get('uuid-parent')).toEqual({
      last_updated_client_type: 'openclaw',
      last_updated_source: 'mcp:lore_update_node',
      last_updated_at: new Date('2025-01-02T00:00:00Z').toISOString(),
    });
  });

  it('formats grouped updater summaries and keeps query grouping semantics', async () => {
    mockSql.mockResolvedValueOnce({
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
          client_type: null,
          source: 'legacy:seed',
          updated_at: '2025-01-05T00:00:00Z',
          event_count: '1',
        },
      ],
      rowCount: 2,
    } as any);

    const result = await getUpdaterSummariesByNodeUuid(['uuid-parent']);
    expect(result.get('uuid-parent')).toEqual([
      {
        client_type: 'openclaw',
        source: 'mcp:lore_update_node',
        updated_at: new Date('2025-01-06T00:00:00Z').toISOString(),
        event_count: 3,
      },
      {
        client_type: null,
        source: 'legacy:seed',
        updated_at: new Date('2025-01-05T00:00:00Z').toISOString(),
        event_count: 1,
      },
    ]);

    const query = String(mockSql.mock.calls[0][0]);
    expect(query).toContain('COUNT(*) AS event_count');
    expect(query).toContain('GROUP BY node_uuid');
    expect(query).toContain("LOWER(BTRIM(COALESCE(details->>'client_type', ''))) IN ('claudecode', 'openclaw', 'hermes', 'mcp', 'admin')");
    expect(query).toContain('ORDER BY node_uuid ASC, MAX(created_at) DESC, COUNT(*) DESC, source ASC');
  });
});
