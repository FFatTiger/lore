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
vi.mock('../../recall/recallAnalytics', () => ({ getRecallStats: vi.fn(), getDreamRecallReview: vi.fn() }));
vi.mock('../../memory/writeEvents', () => ({ getWriteEventStats: vi.fn() }));
vi.mock('../../memory/boot', () => ({ bootView: vi.fn() }));
vi.mock('../../memory/write', () => ({
  createNode: vi.fn(),
  updateNodeByPath: vi.fn(),
  deleteNodeByPath: vi.fn(),
  moveNode: vi.fn(),
}));
vi.mock('../../search/glossary', () => ({
  addGlossaryKeyword: vi.fn(),
  removeGlossaryKeyword: vi.fn(),
}));
vi.mock('../dreamAgent', () => ({
  loadLlmConfig: vi.fn(),
  loadGuidanceFile: vi.fn(() => '# guidance body'),
  runDreamAgentLoop: vi.fn(),
  rewriteDreamNarrative: vi.fn(),
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

vi.mock('../dreamWorkflow', () => ({
  appendDreamWorkflowEvent: vi.fn(),
  listDreamWorkflowEvents: vi.fn(),
}));

vi.mock('../../memory/structuralAudit', () => ({
  getPathQualitySummary: vi.fn(),
  getStructuralAudit: vi.fn(),
}));
vi.mock('../../memory/hygieneAudit', () => ({
  getHygieneAudit: vi.fn(),
}));
vi.mock('../dreamSessionFilter', () => ({
  loadDreamSessionFilter: vi.fn(async () => ({ patterns: [] })),
  collectExcludedDreamQueryIds: vi.fn(async () => new Set()),
  filterDreamRecallReview: vi.fn((review: Record<string, unknown>) => review),
}));

import { sql } from '../../../db';
import { getSettings, updateSettings } from '../../config/settings';
import { bootView } from '../../memory/boot';
import { deleteNodeByPath, updateNodeByPath, createNode, moveNode } from '../../memory/write';
import { addGlossaryKeyword, removeGlossaryKeyword } from '../../search/glossary';
import { appendDreamWorkflowEvent, listDreamWorkflowEvents } from '../dreamWorkflow';
import { getPathQualitySummary, getStructuralAudit } from '../../memory/structuralAudit';
import { getHygieneAudit } from '../../memory/hygieneAudit';
import { loadLlmConfig, rewriteDreamNarrative, runDreamAgentLoop } from '../dreamAgent';
import { ensureRecallIndex } from '../../recall/recall';
import {
  getDreamDiary,
  getDreamEntry,
  reviewDreamChange,
  rollbackDream,
  getDreamConfig,
  updateDreamConfig,
  runDream,
} from '../dreamDiary';

const mockSql = vi.mocked(sql);
const mockGetSettings = vi.mocked(getSettings);
const mockUpdateSettings = vi.mocked(updateSettings);
const mockBootView = vi.mocked(bootView);
const mockDeleteNodeByPath = vi.mocked(deleteNodeByPath);
const mockUpdateNodeByPath = vi.mocked(updateNodeByPath);
const mockCreateNode = vi.mocked(createNode);
const mockMoveNode = vi.mocked(moveNode);
const mockAddGlossaryKeyword = vi.mocked(addGlossaryKeyword);
const mockRemoveGlossaryKeyword = vi.mocked(removeGlossaryKeyword);
const mockListDreamWorkflowEvents = vi.mocked(listDreamWorkflowEvents);
const mockAppendDreamWorkflowEvent = vi.mocked(appendDreamWorkflowEvent);
const mockLoadLlmConfig = vi.mocked(loadLlmConfig);
const mockRunDreamAgentLoop = vi.mocked(runDreamAgentLoop);
const mockRewriteDreamNarrative = vi.mocked(rewriteDreamNarrative);

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
  beforeEach(() => {
    vi.clearAllMocks();
    mockListDreamWorkflowEvents.mockResolvedValue([] as any);
  });

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
      {
        id: 22,
        event_type: 'update',
        node_uri: 'core://test',
        before_snapshot: { content: 'old' },
        after_snapshot: { content: 'new' },
        details: { dream_review: { status: 'approved', reviewed_at: '2024-01-01T00:02:00Z' } },
        created_at: '2024-01-01T00:00:30Z',
      },
    ];
    mockListDreamWorkflowEvents.mockResolvedValue([{ id: 7, diary_id: 1, event_type: 'run_started', payload: {}, created_at: '2024-01-01T00:00:01Z' }] as any);
    mockSql
      .mockResolvedValueOnce(makeResult([diaryRow])) // SELECT * FROM dream_diary
      .mockResolvedValueOnce(makeResult(eventRows)); // memory_events

    const result = await getDreamEntry(1);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(1);
    expect(result!.narrative).toBe('Diary text');
    expect(result!.tool_calls).toHaveLength(1);
    expect(result!.workflow_events).toHaveLength(1);
    expect(result!.memory_changes).toHaveLength(1);
    expect(result!.memory_changes![0].id).toBe(22);
    expect(result!.memory_changes![0].type).toBe('update');
    expect(result!.memory_changes![0].review_status).toBe('approved');
    expect(result!.memory_changes![0].reviewed_at).toBe('2024-01-01T00:02:00.000Z');
  });

  it('exposes raw and poetic narratives while keeping narrative on the display version', async () => {
    mockSql.mockReset();
    const diaryRow = {
      id: 1, started_at: '2024-01-01T00:00:00Z', completed_at: '2024-01-01T00:01:00Z',
      duration_ms: 60000, status: 'completed', summary: {}, narrative: 'Poetic diary',
      raw_narrative: 'Raw audit diary', poetic_narrative: 'Poetic diary',
      error: null, tool_calls: [], details: {},
    };
    mockSql
      .mockResolvedValueOnce(makeResult([diaryRow]))
      .mockResolvedValueOnce(makeResult([]));

    const result = await getDreamEntry(1);

    expect(result).toMatchObject({
      narrative: 'Poetic diary',
      raw_narrative: 'Raw audit diary',
      poetic_narrative: 'Poetic diary',
    });
  });
});

describe('reviewDreamChange', () => {
  beforeEach(() => {
    mockSql.mockReset();
  });

  it('marks a dream memory event review status', async () => {
    mockSql.mockResolvedValueOnce(makeResult([{
      id: 22,
      details: { dream_review: { status: 'approved', reviewed_at: '2024-01-01T00:02:00Z', source: 'web' } },
    }]));

    const result = await reviewDreamChange({ eventId: 22, status: 'approved' });

    expect(result).toMatchObject({ event_id: 22, status: 'approved' });
    const updateCall = mockSql.mock.calls[0];
    expect(String(updateCall[0])).toContain('UPDATE memory_events');
    expect(String(updateCall[0])).toContain("source = 'dream:auto'");
    expect(updateCall[1]?.[0]).toBe(22);
    expect(JSON.parse(String(updateCall[1]?.[1]))).toMatchObject({
      status: 'approved',
      source: 'web',
    });
  });

  it('rejects unsupported dream review statuses', async () => {
    await expect(reviewDreamChange({ eventId: 22, status: 'bad' })).rejects.toThrow('Unsupported dream review status');
    expect(mockSql).not.toHaveBeenCalled();
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
    mockMoveNode.mockReset();
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

  it('reverses glossary_remove by adding the keyword back', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult([{ id: 1, status: 'completed', started_at: '2024-01-01', completed_at: '2024-01-02' }]))
      .mockResolvedValueOnce(makeResult([{
        id: 15, event_type: 'glossary_remove', node_uri: 'core://test', node_uuid: 'uuid1',
        domain: 'core', path: 'test', before_snapshot: { keyword: 'generic' }, after_snapshot: null, details: {},
      }]))
      .mockResolvedValueOnce(makeResult());

    mockAddGlossaryKeyword.mockResolvedValue({ success: true } as any);

    const result = await rollbackDream(1);
    expect(result.events_reversed).toBe(1);
    expect(mockAddGlossaryKeyword).toHaveBeenCalledWith(
      { keyword: 'generic', node_uuid: 'uuid1' },
      { source: 'dream:rollback' },
    );
  });

  it('reverses move events by moving the node back', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult([{ id: 1, status: 'completed', started_at: '2024-01-01', completed_at: '2024-01-02' }]))
      .mockResolvedValueOnce(makeResult([{
        id: 14, event_type: 'move', node_uri: 'core://renamed', node_uuid: 'uuid1',
        domain: 'core', path: 'renamed', before_snapshot: { uri: 'core://original' }, after_snapshot: { uri: 'core://renamed' }, details: {},
      }]))
      .mockResolvedValueOnce(makeResult());

    mockMoveNode.mockResolvedValue({ success: true } as any);

    const result = await rollbackDream(1);
    expect(result.events_reversed).toBe(1);
    expect(mockMoveNode).toHaveBeenCalledWith(
      { old_uri: 'core://renamed', new_uri: 'core://original' },
      { source: 'dream:rollback' },
    );
  });
});

describe('runDream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSql.mockReset();
    mockLoadLlmConfig.mockResolvedValue({
      provider: 'openai_compatible',
      base_url: 'http://localhost:1234/v1',
      api_key: 'test-key',
      model: 'gpt-4o-mini',
      timeout_ms: 5000,
      temperature: 0.3,
      api_version: '',
    } as any);
    mockRewriteDreamNarrative.mockResolvedValue('poetic done');
    mockRunDreamAgentLoop.mockResolvedValue({ narrative: 'done', toolCalls: [], turns: 1 } as any);
    mockAppendDreamWorkflowEvent.mockResolvedValue({ id: 1, diary_id: 1, event_type: 'event', payload: {}, created_at: '2024-01-01T00:00:00Z' } as any);
    vi.mocked(getPathQualitySummary).mockResolvedValue({ date_suffix_path_count: 1, recent_bad_creates: 0, top_nodes: [{ uri: 'project://lore/dream_2026_05_07', created_at: '2026-05-07T00:00:00.000Z', reason: 'ordinary_date_suffix' }] } as any);
    vi.mocked(getStructuralAudit).mockResolvedValue({
      counts: { date_suffix: 1, core_projects: 0, malformed_domains: 0, empty_content: 0 },
      date_suffix_paths: [{ uri: 'project://lore/dream_review_2026_05_07', category: 'date_suffix', reason: 'ordinary_date_suffix' }],
      total: 1,
      limit: 8,
      offset: 0,
      has_more: false,
    } as any);
    vi.mocked(getHygieneAudit).mockResolvedValue({ counts: { oversized: 0, glossary_bloat: 2, identifier_keywords: 1, shared_keywords: 0, placeholder_parents: 3, legacy_domains: 4 }, total: 10, limit: 5, offset: 0, has_more: false } as any);
    mockBootView.mockResolvedValue({
      core_memories: [
        { uri: 'core://agent', content: 'agent boot', boot_role: 'agent', boot_role_label: 'workflow constraints', boot_purpose: 'Working rules' },
        { uri: 'core://soul', content: 'soul boot', boot_role: 'soul', boot_role_label: 'style / persona / self-definition', boot_purpose: 'Persona baseline' },
        { uri: 'preferences://user', content: 'user boot', boot_role: 'user', boot_role_label: 'stable user definition', boot_purpose: 'User context' },
      ],
      nodes: [
        { uri: 'core://agent', role_label: 'workflow constraints', purpose: 'Working rules', state: 'initialized', content: 'agent boot' },
        { uri: 'core://soul', role_label: 'style / persona / self-definition', purpose: 'Persona baseline', state: 'initialized', content: 'soul boot' },
        { uri: 'preferences://user', role_label: 'stable user definition', purpose: 'User context', state: 'initialized', content: 'user boot' },
      ],
      recent_memories: [],
      failed: [],
      loaded: 3,
      total: 3,
      overall_state: 'complete',
      remaining_count: 0,
      draft_generation_available: true,
      draft_generation_reason: null,
    } as any);
    mockListDreamWorkflowEvents.mockResolvedValue([
      { id: 1, diary_id: 1, event_type: 'policy_validation_blocked', payload: {}, created_at: '2024-01-01T00:00:10Z' },
      { id: 2, diary_id: 1, event_type: 'policy_warning_emitted', payload: {}, created_at: '2024-01-01T00:00:11Z' },
      { id: 3, diary_id: 1, event_type: 'protected_node_blocked', payload: {}, created_at: '2024-01-01T00:00:12Z' },
    ] as any);
  });

  it('passes dream session context and compact initial context into the agent loop', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult([{ id: 1 }]))
      .mockResolvedValueOnce(makeResult([{ started_at: '2024-01-01T00:00:00Z', status: 'completed', narrative: 'old', tool_calls: [] }]))
      .mockResolvedValueOnce(makeResult([{ event_type: 'move', total: 2 }]))
      .mockResolvedValueOnce(makeResult());

    const recallStats = { summary: { merged_count: 4, query_count: 2 }, recent_queries: { items: [{ query_id: 'q-1', query_text: 'q1', merged_count: 3, shown_count: 1, used_count: 0 }], total: 1, limit: 20, offset: 0, has_more: false } };
    const recallReview = {
      date: '2026-05-07',
      limit: 100,
      offset: 0,
      summary: {
        returned_queries: 2,
        total_merged: 10,
        total_shown: 3,
        total_used: 1,
        truncated: false,
      },
      queries: [
        { query_id: 'q1', content: 'query one', content_full_chars: 9, session_id: 's1', client_type: 'codex', merged_count: 6, shown_count: 1, used_count: 0, created_at: '2026-05-07T01:00:00.000Z' },
        { query_id: 'q2', content: 'query two', content_full_chars: 9, session_id: 's1', client_type: 'codex', merged_count: 4, shown_count: 2, used_count: 1, created_at: '2026-05-07T02:00:00.000Z' },
      ],
    };
    const writeStats = { summary: { total_events: 7 }, hot_nodes: [{ node_uri: 'core://x', total: 2, creates: 1, updates: 1, deletes: 0 }], recent_events: [] };
    const recallAnalytics = await import('../../recall/recallAnalytics');
    const writeEvents = await import('../../memory/writeEvents');
    const recall = await import('../../recall/recall');
    vi.mocked(recall.ensureRecallIndex).mockResolvedValue({ source_count: 1, updated_count: 0, deleted_count: 0 } as any);
    vi.mocked(recallAnalytics.getRecallStats).mockResolvedValue(recallStats as any);
    vi.mocked(recallAnalytics.getDreamRecallReview).mockResolvedValue(recallReview as any);
    vi.mocked(writeEvents.getWriteEventStats).mockResolvedValue(writeStats as any);

    const result = await runDream();

    expect(ensureRecallIndex).not.toHaveBeenCalled();
    expect(result.status).toBe('completed');
    expect(result.narrative).toBe('poetic done');
    expect(mockRewriteDreamNarrative).toHaveBeenCalledWith(expect.anything(), 'done');
    expect(mockRunDreamAgentLoop).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        guidance: '# guidance body',
        recallReview: expect.objectContaining({ summary: recallReview.summary, queries: recallReview.queries }),
        recallStats: { summary: recallStats.summary },
        writeActivity: writeStats,
        recentDiaries: expect.any(Array),
        pathQuality: expect.objectContaining({ date_suffix_path_count: 1 }),
        structuralAudit: expect.objectContaining({
          counts: expect.objectContaining({ date_suffix: 1 }),
          date_suffix_paths: [expect.objectContaining({ uri: 'project://lore/dream_review_2026_05_07' })],
          note: expect.stringContaining('pagination'),
        }),
        hygieneAudit: expect.objectContaining({ counts: expect.objectContaining({ legacy_domains: 4 }) }),
        bootBaseline: [
          expect.objectContaining({ uri: 'core://agent', content: 'agent boot' }),
          expect.objectContaining({ uri: 'core://soul', content: 'soul boot' }),
          expect.objectContaining({ uri: 'preferences://user', content: 'user boot' }),
        ],
      }),
      expect.objectContaining({
        eventContext: { source: 'dream:auto', session_id: 'dream:1' },
      }),
    );
    expect(vi.mocked(recallAnalytics.getDreamRecallReview)).toHaveBeenCalledWith({ days: 1, limit: 100 });
    expect(mockSql.mock.calls.some((call) => String(call[0]).includes('ORDER BY started_at DESC LIMIT 5'))).toBe(true);
    const memoryChangeQuery = mockSql.mock.calls.find((call) => String(call[0]).includes('GROUP BY event_type'));
    expect(memoryChangeQuery?.[1]).toEqual([1, 'dream:1']);

    const updateCall = mockSql.mock.calls.find((call) => String(call[0]).includes('UPDATE dream_diary SET status = \'completed\''));
    expect(updateCall).toBeTruthy();
    const summary = JSON.parse(String(updateCall?.[1]?.[2]));
    expect(updateCall?.[1]?.[3]).toBe('poetic done');
    expect(updateCall?.[1]?.[4]).toBe('done');
    expect(updateCall?.[1]?.[5]).toBe('poetic done');
    const details = JSON.parse(String(updateCall?.[1]?.[7]));
    expect(summary).toEqual({
      recall_metadata: {
        returned_queries: 2,
        total_merged: 10,
        total_shown: 3,
        total_used: 1,
        truncated: false,
      },
      durable_extraction: {
        created: 0,
        enriched: 0,
      },
      maintenance: {
        events: 2,
      },
      structure: {
        moved: 2,
        protected_blocks: 1,
        policy_blocks: 1,
        policy_warnings: 1,
      },
      activity: {
        recall_events: 4,
        recall_queries: 2,
        metadata_queries: 2,
        write_events: 7,
      },
      agent: { tool_calls: 0, turns: 1 },
    });
    expect(summary).not.toHaveProperty('health');
    expect(summary).not.toHaveProperty('dead_writes');
    expect(summary).not.toHaveProperty('paths');
    expect(summary).not.toHaveProperty('orphans');
    expect(details).toMatchObject({
      initial_context: {
        guidance: '# guidance body',
        recallReview: expect.objectContaining({ summary: recallReview.summary, queries: recallReview.queries }),
        recallStats: { summary: recallStats.summary },
        writeActivity: writeStats,
      },
      recallReview,
      recall_metadata_queries: recallReview.queries,
      durable_extraction: { created: 0, enriched: 0 },
      maintenance: {
        protected_blocks: 1,
        policy_blocks: 1,
        policy_warnings: 1,
        moved: 2,
      },
    });
  });

  it('hands the agent a compact recall review and only the recall summary', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult([{ id: 10 }]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult());
    mockGetSettings.mockResolvedValue({});
    const recallAnalytics = await import('../../recall/recallAnalytics');
    const writeEvents = await import('../../memory/writeEvents');
    const queries = Array.from({ length: 20 }, (_, i) => ({
      query_id: `q${i}`,
      content: `query ${i}`,
      merged_count: 1,
      shown_count: 0,
      used_count: 0,
    }));
    vi.mocked(recallAnalytics.getRecallStats).mockResolvedValue({
      summary: { merged_count: 5, query_count: 20 },
      recent_queries: { items: [] },
    } as any);
    vi.mocked(recallAnalytics.getDreamRecallReview).mockResolvedValue({
      summary: { returned_queries: 20 },
      queries,
    } as any);
    vi.mocked(writeEvents.getWriteEventStats).mockResolvedValue({ summary: {}, hot_nodes: [], recent_events: [] } as any);

    await runDream();

    const agentContext = mockRunDreamAgentLoop.mock.calls[0][1];
    expect((agentContext.recallReview.queries as unknown[])).toHaveLength(12);
    expect(agentContext.recallStats).toEqual({ summary: { merged_count: 5, query_count: 20 } });
    const updateCall = mockSql.mock.calls.find((call) => String(call[0]).includes('UPDATE dream_diary SET status = \'completed\''));
    const details = JSON.parse(String(updateCall?.[1]?.[7]));
    expect(details.recall_metadata_queries).toHaveLength(20);
  });

  it('marks empty audit findings in the initial context', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult([{ id: 11 }]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult());
    mockGetSettings.mockResolvedValue({});
    const recallAnalytics = await import('../../recall/recallAnalytics');
    const writeEvents = await import('../../memory/writeEvents');
    vi.mocked(recallAnalytics.getRecallStats).mockResolvedValue({ summary: {} } as any);
    vi.mocked(recallAnalytics.getDreamRecallReview).mockResolvedValue({ summary: {}, queries: [] } as any);
    vi.mocked(writeEvents.getWriteEventStats).mockResolvedValue({ summary: {}, hot_nodes: [], recent_events: [] } as any);
    vi.mocked(getStructuralAudit).mockResolvedValue({
      counts: { date_suffix: 0, core_projects: 0, malformed_domains: 0, empty_content: 0 },
      total: 0,
    } as any);
    vi.mocked(getHygieneAudit).mockResolvedValue({
      counts: { oversized: 0, glossary_bloat: 0, identifier_keywords: 0, shared_keywords: 0, placeholder_parents: 0, legacy_domains: 0 },
      total: 0,
    } as any);

    await runDream();

    const agentContext = mockRunDreamAgentLoop.mock.calls[0][1];
    expect(agentContext.structuralAudit).toEqual({
      counts: { date_suffix: 0, core_projects: 0, malformed_domains: 0, empty_content: 0 },
      note: 'No structural issues found.',
    });
    expect(agentContext.hygieneAudit).toEqual({
      counts: { oversized: 0, glossary_bloat: 0, identifier_keywords: 0, shared_keywords: 0, placeholder_parents: 0, legacy_domains: 0 },
      note: 'No hygiene findings.',
    });
  });

  it('keeps excluded sessions out of the recall metadata Dream sees', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult([{ id: 9 }]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult());
    mockGetSettings.mockResolvedValue({});
    const recallAnalytics = await import('../../recall/recallAnalytics');
    const writeEvents = await import('../../memory/writeEvents');
    const sessionFilter = await import('../dreamSessionFilter');
    vi.mocked(recallAnalytics.getRecallStats).mockResolvedValue({ summary: {}, recent_queries: { items: [{ query_id: 'q1' }, { query_id: 'q2' }] } } as any);
    vi.mocked(recallAnalytics.getDreamRecallReview).mockResolvedValue({ summary: {}, queries: [{ query_id: 'q1' }, { query_id: 'q2' }] } as any);
    vi.mocked(writeEvents.getWriteEventStats).mockResolvedValue({ summary: {}, hot_nodes: [], recent_events: [] } as any);
    vi.mocked(sessionFilter.loadDreamSessionFilter).mockResolvedValue({ patterns: [/bot/] } as any);
    vi.mocked(sessionFilter.collectExcludedDreamQueryIds).mockResolvedValue(new Set(['q2']));
    vi.mocked(sessionFilter.filterDreamRecallReview).mockImplementation((review: Record<string, unknown>) => ({
      ...review,
      ...(Array.isArray(review.queries) ? { queries: (review.queries as Array<{ query_id: string }>).filter((item) => item.query_id !== 'q2') } : {}),
    }));

    await runDream();

    expect(sessionFilter.loadDreamSessionFilter).toHaveBeenCalled();
    expect(sessionFilter.collectExcludedDreamQueryIds).toHaveBeenCalled();
    const agentContext = mockRunDreamAgentLoop.mock.calls[0][1];
    expect((agentContext.recallReview.queries as Array<{ query_id: string }>).map((item) => item.query_id)).toEqual(['q1']);
  });

  it('keeps dream completed when poetic rewrite fails and records fallback', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult([{ id: 2 }]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult());
    mockGetSettings.mockResolvedValue({});
    mockRewriteDreamNarrative.mockRejectedValueOnce(new Error('rewrite down'));
    const recallAnalytics = await import('../../recall/recallAnalytics');
    const writeEvents = await import('../../memory/writeEvents');
    vi.mocked(recallAnalytics.getRecallStats).mockResolvedValue({ summary: { merged_count: 0, query_count: 0 } } as any);
    vi.mocked(recallAnalytics.getDreamRecallReview).mockResolvedValue({ summary: { returned_queries: 0, total_merged: 0, total_shown: 0, total_used: 0, truncated: false }, queries: [] } as any);
    vi.mocked(writeEvents.getWriteEventStats).mockResolvedValue({ summary: { total_events: 0 }, hot_nodes: [], recent_events: [] } as any);

    const result = await runDream();

    expect(result.status).toBe('completed');
    expect(result.narrative).toBe('done');
    expect(mockAppendDreamWorkflowEvent).toHaveBeenCalledWith(2, 'phase_completed', expect.objectContaining({
      phase: 'poetic_rewrite',
      label: 'Diary',
      summary: expect.objectContaining({ fallback: true, error: 'rewrite down' }),
    }));
  });

  it('records phase, provider, and model when dream run fails', async () => {
    mockSql
      .mockResolvedValueOnce(makeResult([{ id: 3 }]))
      .mockResolvedValueOnce(makeResult([]))
      .mockResolvedValueOnce(makeResult());
    mockGetSettings.mockResolvedValue({});
    mockRunDreamAgentLoop.mockRejectedValueOnce(new Error('agent down'));
    const recallAnalytics = await import('../../recall/recallAnalytics');
    const writeEvents = await import('../../memory/writeEvents');
    vi.mocked(recallAnalytics.getRecallStats).mockResolvedValue({ summary: { merged_count: 0, query_count: 0 } } as any);
    vi.mocked(recallAnalytics.getDreamRecallReview).mockResolvedValue({ summary: { returned_queries: 0, total_merged: 0, total_shown: 0, total_used: 0, truncated: false }, queries: [] } as any);
    vi.mocked(writeEvents.getWriteEventStats).mockResolvedValue({ summary: { total_events: 0 }, hot_nodes: [], recent_events: [] } as any);

    await expect(runDream()).rejects.toThrow('agent down');

    expect(mockAppendDreamWorkflowEvent).toHaveBeenCalledWith(3, 'run_failed', expect.objectContaining({
      phase: 'agent_loop',
      provider: 'openai_compatible',
      model: 'gpt-4o-mini',
      error: 'agent down',
    }));
  });
});


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
    expect(config.last_run_date).toBeNull();
  });

  it('reads last_run_date from app_settings', async () => {
    mockGetSettings.mockResolvedValue({ 'dream.enabled': true, 'dream.cron': '0 4 * * *' });
    mockSql.mockResolvedValueOnce(makeResult([{ value: { value: '2024-01-15' } }]));
    const config = await getDreamConfig();
    expect(config.schedule_hour).toBe(4);
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
    mockGetSettings.mockResolvedValue({ 'dream.enabled': false, 'dream.cron': '0 5 * * *' });
    mockSql.mockRejectedValueOnce(new Error('no table'));

    const config = await updateDreamConfig({ enabled: false, schedule_hour: 5 });
    expect(mockUpdateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ 'dream.enabled': false, 'dream.cron': '0 5 * * *' }),
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
