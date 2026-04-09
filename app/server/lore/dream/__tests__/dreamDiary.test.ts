import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../db', () => ({ sql: vi.fn() }));
vi.mock('../../config/settings', () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));
vi.mock('../../recall/recall', () => ({ ensureRecallIndex: vi.fn() }));
vi.mock('../../recall/feedbackAnalytics', () => ({
  getMemoryHealthReport: vi.fn(),
  getDeadWrites: vi.fn(),
  getPathEffectiveness: vi.fn(),
}));
vi.mock('../../recall/recallAnalytics', () => ({ getRecallStats: vi.fn() }));
vi.mock('../../memory/writeEvents', () => ({ getWriteEventStats: vi.fn() }));
vi.mock('../../ops/maintenance', () => ({ listOrphans: vi.fn() }));
vi.mock('../../memory/write', () => ({
  createNode: vi.fn(),
  updateNodeByPath: vi.fn(),
  deleteNodeByPath: vi.fn(),
}));
vi.mock('../../search/glossary', () => ({
  addGlossaryKeyword: vi.fn(),
  removeGlossaryKeyword: vi.fn(),
}));
vi.mock('../dreamAgent', () => ({
  loadLlmConfig: vi.fn(),
  runDreamAgentLoop: vi.fn(),
  parseUri: vi.fn((uri: string) => {
    const value = String(uri || '').trim();
    if (value.includes('://')) {
      const [d, p] = value.split('://', 2);
      return { domain: d.trim() || 'core', path: p.replace(/^\/+|\/+$/g, '') };
    }
    return { domain: 'core', path: value.replace(/^\/+|\/+$/g, '') };
  }),
  DREAM_EVENT_CONTEXT: { source: 'dream:auto' },
}));

import { sql } from '../../../db';
import { getSettings, updateSettings } from '../../config/settings';
import { deleteNodeByPath, updateNodeByPath, createNode } from '../../memory/write';
import { addGlossaryKeyword, removeGlossaryKeyword } from '../../search/glossary';
import {
  getDreamDiary,
  getDreamEntry,
  rollbackDream,
  getDreamConfig,
  updateDreamConfig,
} from '../dreamDiary';

const mockSql = vi.mocked(sql);
const mockGetSettings = vi.mocked(getSettings);
const mockUpdateSettings = vi.mocked(updateSettings);
const mockDeleteNodeByPath = vi.mocked(deleteNodeByPath);
const mockUpdateNodeByPath = vi.mocked(updateNodeByPath);
const mockCreateNode = vi.mocked(createNode);
const mockAddGlossaryKeyword = vi.mocked(addGlossaryKeyword);
const mockRemoveGlossaryKeyword = vi.mocked(removeGlossaryKeyword);

function makeResult(rows: Record<string, unknown>[] = [], rowCount = rows.length) {
  return { rows, rowCount } as any;
}

// ---------------------------------------------------------------------------
// getDreamDiary
// ---------------------------------------------------------------------------

describe('getDreamDiary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns paginated diary entries', async () => {
    const rows = [
      { id: 1, started_at: '2024-01-01T00:00:00Z', completed_at: '2024-01-01T00:01:00Z', duration_ms: 60000, status: 'completed', summary: {}, narrative: 'Test', error: null },
    ];
    // ensureDreamDiaryTable is cached after first test, so only entries + count
    mockSql
      .mockResolvedValueOnce(makeResult(rows)) // entries
      .mockResolvedValueOnce(makeResult([{ total: 1 }])); // count

    const result = await getDreamDiary({ limit: 10, offset: 0 });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].id).toBe(1);
    expect(result.entries[0].status).toBe('completed');
    expect(result.total).toBe(1);
  });

  it('clamps limit to valid range', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult([])) // entries
      .mockResolvedValueOnce(makeResult([{ total: 0 }])); // count

    const result = await getDreamDiary({ limit: 999, offset: 0 });
    expect(result.limit).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// getDreamEntry
// ---------------------------------------------------------------------------

describe('getDreamEntry', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when entry not found', async () => {
    mockSql.mockReset();
    mockSql.mockResolvedValueOnce(makeResult([]));
    const result = await getDreamEntry(999);
    expect(result).toBeNull();
  });

  it('returns formatted entry with memory_changes', async () => {
    mockSql.mockReset();
    const diaryRow = {
      id: 1, started_at: '2024-01-01T00:00:00Z', completed_at: '2024-01-01T00:01:00Z',
      duration_ms: 60000, status: 'completed', summary: {}, narrative: 'Diary text',
      error: null, tool_calls: [{ tool: 'get_node', args: {} }], details: {},
    };
    const eventRows = [
      { event_type: 'update', node_uri: 'core://test', before_snapshot: { content: 'old' }, after_snapshot: { content: 'new' }, created_at: '2024-01-01T00:00:30Z' },
    ];
    mockSql
      .mockResolvedValueOnce(makeResult([diaryRow])) // SELECT * FROM dream_diary
      .mockResolvedValueOnce(makeResult(eventRows)); // memory_events

    const result = await getDreamEntry(1);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(1);
    expect(result!.narrative).toBe('Diary text');
    expect(result!.tool_calls).toHaveLength(1);
    expect(result!.memory_changes).toHaveLength(1);
    expect(result!.memory_changes![0].type).toBe('update');
  });
});

// ---------------------------------------------------------------------------
// rollbackDream
// ---------------------------------------------------------------------------

describe('rollbackDream', () => {
  beforeEach(() => {
    mockSql.mockReset();
    mockDeleteNodeByPath.mockReset();
    mockUpdateNodeByPath.mockReset();
    mockCreateNode.mockReset();
    mockAddGlossaryKeyword.mockReset();
    mockRemoveGlossaryKeyword.mockReset();
  });

  it('throws 409 when entry is not the latest', async () => {
    mockSql.mockResolvedValueOnce(makeResult([{ id: 2, status: 'completed', started_at: '2024-01-01', completed_at: '2024-01-02' }]));
    await expect(rollbackDream(1)).rejects.toThrow('Only the most recent dream can be rolled back');
  });

  it('throws 409 when status is running', async () => {
    mockSql.mockResolvedValueOnce(makeResult([{ id: 1, status: 'running', started_at: '2024-01-01', completed_at: null }]));
    await expect(rollbackDream(1)).rejects.toThrow("Cannot rollback dream with status 'running'");
  });

  it('reverses create events by deleting', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult([{ id: 1, status: 'completed', started_at: '2024-01-01', completed_at: '2024-01-02' }])) // latest
      .mockResolvedValueOnce(makeResult([{
        id: 10, event_type: 'create', node_uri: 'core://new', node_uuid: 'uuid1',
        domain: 'core', path: 'new', before_snapshot: null, after_snapshot: { content: 'text' }, details: {},
      }])) // events
      .mockResolvedValueOnce(makeResult()); // UPDATE dream_diary

    mockDeleteNodeByPath.mockResolvedValue({ success: true } as any);

    const result = await rollbackDream(1);
    expect(result.status).toBe('rolled_back');
    expect(result.events_reversed).toBe(1);
    expect(mockDeleteNodeByPath).toHaveBeenCalledWith(
      { domain: 'core', path: 'new' },
      { source: 'dream:rollback' },
    );
  });

  it('reverses update events by restoring before_snapshot', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult([{ id: 1, status: 'completed', started_at: '2024-01-01', completed_at: '2024-01-02' }]))
      .mockResolvedValueOnce(makeResult([{
        id: 11, event_type: 'update', node_uri: 'core://test', node_uuid: 'uuid1',
        domain: 'core', path: 'test', before_snapshot: { content: 'original', priority: 2 }, after_snapshot: { content: 'changed' }, details: {},
      }]))
      .mockResolvedValueOnce(makeResult());

    mockUpdateNodeByPath.mockResolvedValue({ success: true } as any);

    const result = await rollbackDream(1);
    expect(result.events_reversed).toBe(1);
    expect(mockUpdateNodeByPath).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'core', path: 'test', content: 'original', priority: 2 }),
      { source: 'dream:rollback' },
    );
  });

  it('reverses delete events by recreating', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult([{ id: 1, status: 'completed', started_at: '2024-01-01', completed_at: '2024-01-02' }]))
      .mockResolvedValueOnce(makeResult([{
        id: 12, event_type: 'delete', node_uri: 'core://removed', node_uuid: 'uuid1',
        domain: 'core', path: 'parent/removed', before_snapshot: { content: 'old content', priority: 3 }, after_snapshot: null, details: {},
      }]))
      .mockResolvedValueOnce(makeResult());

    mockCreateNode.mockResolvedValue({ uuid: 'new-uuid' } as any);

    const result = await rollbackDream(1);
    expect(result.events_reversed).toBe(1);
    expect(mockCreateNode).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'core', parentPath: 'parent', title: 'removed', content: 'old content', priority: 3 }),
      { source: 'dream:rollback' },
    );
  });

  it('reverses glossary_add by removing keyword', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult([{ id: 1, status: 'completed', started_at: '2024-01-01', completed_at: '2024-01-02' }]))
      .mockResolvedValueOnce(makeResult([{
        id: 13, event_type: 'glossary_add', node_uri: 'core://test', node_uuid: 'uuid1',
        domain: 'core', path: 'test', before_snapshot: null, after_snapshot: { keyword: 'kw1' }, details: {},
      }]))
      .mockResolvedValueOnce(makeResult());

    mockRemoveGlossaryKeyword.mockResolvedValue({ success: true } as any);

    const result = await rollbackDream(1);
    expect(result.events_reversed).toBe(1);
    expect(mockRemoveGlossaryKeyword).toHaveBeenCalledWith(
      { keyword: 'kw1', node_uuid: 'uuid1' },
      { source: 'dream:rollback' },
    );
  });
});

// ---------------------------------------------------------------------------
// getDreamConfig / updateDreamConfig
// ---------------------------------------------------------------------------

describe('getDreamConfig', () => {
  beforeEach(() => {
    mockSql.mockReset();
    mockGetSettings.mockReset();
  });

  it('returns default config when settings are empty', async () => {
    mockGetSettings.mockResolvedValue({});
    mockSql.mockRejectedValueOnce(new Error('no table'));
    const config = await getDreamConfig();
    expect(config.enabled).toBe(true);
    expect(config.schedule_hour).toBe(3);
    expect(config.timezone).toBe('Asia/Shanghai');
    expect(config.last_run_date).toBeNull();
  });

  it('reads last_run_date from app_settings', async () => {
    mockGetSettings.mockResolvedValue({ 'dream.enabled': true, 'dream.schedule_hour': 4, 'dream.timezone': 'UTC' });
    mockSql.mockResolvedValueOnce(makeResult([{ value: { value: '2024-01-15' } }]));
    const config = await getDreamConfig();
    expect(config.schedule_hour).toBe(4);
    expect(config.timezone).toBe('UTC');
    expect(config.last_run_date).toBe('2024-01-15');
  });
});

describe('updateDreamConfig', () => {
  beforeEach(() => {
    mockSql.mockReset();
    mockGetSettings.mockReset();
    mockUpdateSettings.mockReset();
  });

  it('patches settings and returns updated config', async () => {
    mockUpdateSettings.mockResolvedValue({} as any);
    mockGetSettings.mockResolvedValue({ 'dream.enabled': false, 'dream.schedule_hour': 5 });
    mockSql.mockRejectedValueOnce(new Error('no table'));

    const config = await updateDreamConfig({ enabled: false, schedule_hour: 5 });
    expect(mockUpdateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ 'dream.enabled': false, 'dream.schedule_hour': 5 }),
    );
    expect(config.enabled).toBe(false);
    expect(config.schedule_hour).toBe(5);
  });

  it('skips updateSettings when no fields provided', async () => {
    mockGetSettings.mockResolvedValue({});
    mockSql.mockRejectedValueOnce(new Error('no table'));

    await updateDreamConfig({});
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });
});
