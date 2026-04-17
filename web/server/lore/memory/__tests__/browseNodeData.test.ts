import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db', () => ({ sql: vi.fn() }));
vi.mock('../browse', () => ({ ROOT_NODE_UUID: '00000000-0000-0000-0000-000000000000' }));

import { sql } from '../../../db';
import { ROOT_NODE_UUID } from '../browse';
import { getAliases, getGlossaryKeywords, getMemoryByPath } from '../browseNodeData';

const mockSql = vi.mocked(sql);

describe('browseNodeData helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns synthetic root memory for empty path', async () => {
    await expect(getMemoryByPath('core', '')).resolves.toEqual({
      id: 0,
      node_uuid: ROOT_NODE_UUID,
      content: '',
      priority: 0,
      disclosure: null,
      deprecated: false,
      created_at: null,
      domain: 'core',
      path: '',
      alias_count: 0,
    });
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('loads node memory and alias count by path', async () => {
    mockSql
      .mockResolvedValueOnce({
        rows: [{
          domain: 'core',
          path: 'animals/cat',
          node_uuid: 'uuid-cat',
          priority: 5,
          disclosure: null,
          id: 42,
          content: 'A furry animal',
          deprecated: false,
          created_at: '2025-01-01T00:00:00Z',
        }],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({ rows: [{ total_paths: '3' }], rowCount: 1 } as any);

    const result = await getMemoryByPath('core', 'animals/cat');
    expect(result).toEqual({
      id: 42,
      node_uuid: 'uuid-cat',
      content: 'A furry animal',
      priority: 5,
      disclosure: null,
      deprecated: false,
      created_at: new Date('2025-01-01T00:00:00Z').toISOString(),
      domain: 'core',
      path: 'animals/cat',
      alias_count: 2,
    });
  });

  it('filters self path from aliases', async () => {
    mockSql.mockResolvedValueOnce({
      rows: [
        { domain: 'core', path: 'cat' },
        { domain: 'animals', path: 'feline' },
        { domain: 'core', path: 'kitty' },
      ],
      rowCount: 3,
    } as any);

    const result = await getAliases('uuid-cat', 'core', 'cat');
    expect(result).toEqual(['animals://feline', 'core://kitty']);
  });

  it('returns no aliases for root uuid', async () => {
    await expect(getAliases(ROOT_NODE_UUID, 'core', '')).resolves.toEqual([]);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('returns glossary keywords ordered from db', async () => {
    mockSql.mockResolvedValueOnce({
      rows: [{ keyword: 'botany' }, { keyword: 'flora' }],
      rowCount: 2,
    } as any);

    await expect(getGlossaryKeywords('uuid-plants')).resolves.toEqual(['botany', 'flora']);
  });

  it('returns no glossary keywords for root uuid', async () => {
    await expect(getGlossaryKeywords(ROOT_NODE_UUID)).resolves.toEqual([]);
    expect(mockSql).not.toHaveBeenCalled();
  });
});
