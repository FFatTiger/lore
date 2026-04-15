import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../db', () => ({ sql: vi.fn() }));
vi.mock('../../config/settings', () => ({
  getSettings: vi.fn(),
}));
vi.mock('../../memory/browse', () => ({
  getNodePayload: vi.fn(),
  listDomains: vi.fn(),
}));
vi.mock('../../search/search', () => ({
  searchMemories: vi.fn(),
}));
vi.mock('../../memory/write', () => ({
  createNode: vi.fn(),
  updateNodeByPath: vi.fn(),
  deleteNodeByPath: vi.fn(),
  moveNode: vi.fn(),
}));
vi.mock('../../search/glossary', () => ({
  addGlossaryKeyword: vi.fn(),
  removeGlossaryKeyword: vi.fn(),
  manageTriggers: vi.fn(),
}));
vi.mock('../../recall/recallAnalytics', () => ({
  getRecallStats: vi.fn(),
}));
vi.mock('../../memory/writeEvents', () => ({
  getNodeWriteHistory: vi.fn(),
}));
vi.mock('../../recall/feedbackAnalytics', () => ({
  getPathEffectiveness: vi.fn(),
}));
vi.mock('../../view/memoryViewQueries', () => ({
  listMemoryViewsByNode: vi.fn(),
}));
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(() => '# MCP Guidance\nlore_get_node is useful'),
}));

import { getSettings } from '../../config/settings';
import { getNodePayload, listDomains } from '../../memory/browse';
import { searchMemories } from '../../search/search';
import { createNode, updateNodeByPath, deleteNodeByPath, moveNode } from '../../memory/write';
import { addGlossaryKeyword, removeGlossaryKeyword, manageTriggers } from '../../search/glossary';
import { getRecallStats } from '../../recall/recallAnalytics';
import { getNodeWriteHistory } from '../../memory/writeEvents';
import { getPathEffectiveness } from '../../recall/feedbackAnalytics';
import { listMemoryViewsByNode } from '../../view/memoryViewQueries';
import {
  loadLlmConfig,
  chatWithTools,
  buildDreamTools,
  parseUri,
  executeDreamTool,
  loadGuidanceFile,
  buildDreamSystemPrompt,
  runDreamAgentLoop,
  DREAM_EVENT_CONTEXT,
  type LlmConfig,
  type HealthData,
} from '../dreamAgent';

const mockGetSettings = vi.mocked(getSettings);
const mockGetNodePayload = vi.mocked(getNodePayload);
const mockListDomains = vi.mocked(listDomains);
const mockSearchMemories = vi.mocked(searchMemories);
const mockCreateNode = vi.mocked(createNode);
const mockUpdateNodeByPath = vi.mocked(updateNodeByPath);
const mockDeleteNodeByPath = vi.mocked(deleteNodeByPath);
const mockMoveNode = vi.mocked(moveNode);
const mockAddGlossaryKeyword = vi.mocked(addGlossaryKeyword);
const mockRemoveGlossaryKeyword = vi.mocked(removeGlossaryKeyword);
const mockManageTriggers = vi.mocked(manageTriggers);
const mockGetRecallStats = vi.mocked(getRecallStats);
const mockGetNodeWriteHistory = vi.mocked(getNodeWriteHistory);
const mockGetPathEffectiveness = vi.mocked(getPathEffectiveness);
const mockListMemoryViewsByNode = vi.mocked(listMemoryViewsByNode);

function makeHealthData(overrides: Partial<HealthData> = {}): HealthData {
  return {
    health: { classification_summary: {}, nodes: [] },
    deadWrites: { dead_writes: [], total_dead_writes: 0 },
    pathEffectiveness: { recommendations: [], paths: [] },
    recallStats: { summary: {}, by_path: [], noisy_nodes: [], recent_queries: { items: [], total: 0, limit: 20, offset: 0, has_more: false } },
    writeStats: { summary: {}, hot_nodes: [] },
    orphanCount: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// DREAM_EVENT_CONTEXT
// ---------------------------------------------------------------------------

describe('DREAM_EVENT_CONTEXT', () => {
  it('has source "dream:auto"', () => {
    expect(DREAM_EVENT_CONTEXT).toEqual({ source: 'dream:auto' });
  });
});

// ---------------------------------------------------------------------------
// loadLlmConfig
// ---------------------------------------------------------------------------

describe('loadLlmConfig', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when base_url is missing', async () => {
    mockGetSettings.mockResolvedValue({
      'view_llm.base_url': '',
      'view_llm.model': 'gpt-4',
      'view_llm.temperature': 0.3,
      'view_llm.timeout_ms': 1800000,
    });
    const result = await loadLlmConfig();
    expect(result).toBeNull();
  });

  it('returns config when all fields present', async () => {
    const originalEnv = process.env.LORE_VIEW_LLM_API_KEY;
    process.env.LORE_VIEW_LLM_API_KEY = 'test-key';
    mockGetSettings.mockResolvedValue({
      'view_llm.base_url': 'http://localhost:1234/v1/',
      'view_llm.model': 'gpt-4',
      'view_llm.temperature': 0.5,
      'view_llm.timeout_ms': 1800000,
    });
    const result = await loadLlmConfig();
    expect(result).toEqual({
      base_url: 'http://localhost:1234/v1',
      api_key: 'test-key',
      model: 'gpt-4',
      timeout_ms: 1800000,
      temperature: 0.5,
    });
    process.env.LORE_VIEW_LLM_API_KEY = originalEnv;
  });
});

// ---------------------------------------------------------------------------
// buildDreamTools
// ---------------------------------------------------------------------------

describe('buildDreamTools', () => {
  it('returns an array of tool definitions', () => {
    const tools = buildDreamTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools[0].type).toBe('function');
    expect(tools[0].function.name).toBeDefined();
  });

  it('includes all expected tool names', () => {
    const tools = buildDreamTools();
    const names = tools.map((t) => t.function.name);
    expect(names).toContain('get_node');
    expect(names).toContain('search');
    expect(names).toContain('list_domains');
    expect(names).toContain('get_node_recall_detail');
    expect(names).toContain('get_query_recall_detail');
    expect(names).toContain('get_node_write_history');
    expect(names).toContain('get_path_effectiveness_detail');
    expect(names).toContain('inspect_neighbors');
    expect(names).toContain('inspect_views');
    expect(names).toContain('create_node');
    expect(names).toContain('update_node');
    expect(names).toContain('delete_node');
    expect(names).toContain('move_node');
    expect(names).toContain('add_glossary');
    expect(names).toContain('remove_glossary');
    expect(names).toContain('manage_triggers');
  });

  it('each tool has required parameters field', () => {
    const tools = buildDreamTools();
    for (const tool of tools) {
      expect(tool.function.parameters).toBeDefined();
      expect(tool.function.parameters.type).toBe('object');
    }
  });
});

// ---------------------------------------------------------------------------
// parseUri
// ---------------------------------------------------------------------------

describe('parseUri', () => {
  it('parses domain://path format', () => {
    expect(parseUri('core://agent/settings')).toEqual({ domain: 'core', path: 'agent/settings' });
  });

  it('defaults to core domain for bare path', () => {
    expect(parseUri('agent/settings')).toEqual({ domain: 'core', path: 'agent/settings' });
  });

  it('trims slashes', () => {
    expect(parseUri('core:///foo/')).toEqual({ domain: 'core', path: 'foo' });
  });

  it('handles empty string', () => {
    expect(parseUri('')).toEqual({ domain: 'core', path: '' });
  });
});

// ---------------------------------------------------------------------------
// executeDreamTool
// ---------------------------------------------------------------------------

describe('executeDreamTool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dispatches get_node to getNodePayload', async () => {
    mockGetNodePayload.mockResolvedValue({ domain: 'core', path: 'test' } as any);
    await executeDreamTool('get_node', { uri: 'core://test' });
    expect(mockGetNodePayload).toHaveBeenCalledWith({ domain: 'core', path: 'test' });
  });

  it('dispatches search to searchMemories', async () => {
    mockSearchMemories.mockResolvedValue([] as any);
    await executeDreamTool('search', { query: 'hello', limit: 5 });
    expect(mockSearchMemories).toHaveBeenCalledWith({ query: 'hello', limit: 5 });
  });

  it('dispatches list_domains', async () => {
    mockListDomains.mockResolvedValue(['core'] as any);
    await executeDreamTool('list_domains', {});
    expect(mockListDomains).toHaveBeenCalled();
  });

  it('dispatches get_node_recall_detail to getRecallStats with node filter', async () => {
    mockGetRecallStats.mockResolvedValue({ summary: { shown_count: 1 } } as any);
    await executeDreamTool('get_node_recall_detail', { uri: 'core://test', days: 14, limit: 6 });
    expect(mockGetRecallStats).toHaveBeenCalledWith({ nodeUri: 'core://test', days: 14, limit: 6 });
  });

  it('dispatches get_query_recall_detail to getRecallStats with query filters', async () => {
    mockGetRecallStats.mockResolvedValue({ summary: { query_count: 1 } } as any);
    await executeDreamTool('get_query_recall_detail', { query_id: 'q1', query_text: 'hello', days: 7, limit: 4 });
    expect(mockGetRecallStats).toHaveBeenCalledWith({ queryId: 'q1', queryText: 'hello', days: 7, limit: 4 });
  });

  it('dispatches get_node_write_history', async () => {
    mockGetNodeWriteHistory.mockResolvedValue({ events: [] } as any);
    await executeDreamTool('get_node_write_history', { uri: 'core://test', limit: 8 });
    expect(mockGetNodeWriteHistory).toHaveBeenCalledWith({ nodeUri: 'core://test', limit: 8 });
  });

  it('dispatches get_path_effectiveness_detail', async () => {
    mockGetPathEffectiveness.mockResolvedValue({ paths: [] } as any);
    await executeDreamTool('get_path_effectiveness_detail', { days: 5 });
    expect(mockGetPathEffectiveness).toHaveBeenCalledWith({ days: 5 });
  });

  it('dispatches inspect_neighbors and returns parent/siblings/children context', async () => {
    mockGetNodePayload
      .mockResolvedValueOnce({
        node: { uri: 'core://agent/settings', aliases: ['project://agent/settings'] },
        children: [{ uri: 'core://agent/settings/child' }],
        breadcrumbs: [{ path: '', label: 'root' }, { path: 'agent', label: 'agent' }, { path: 'agent/settings', label: 'settings' }],
      } as any)
      .mockResolvedValueOnce({
        node: { uri: 'core://agent', content: 'parent' },
        children: [
          { uri: 'core://agent/settings', priority: 1 },
          { uri: 'core://agent/profile', priority: 2 },
        ],
        breadcrumbs: [{ path: '', label: 'root' }, { path: 'agent', label: 'agent' }],
      } as any);

    const result = await executeDreamTool('inspect_neighbors', { uri: 'core://agent/settings' }) as Record<string, any>;
    expect(mockGetNodePayload).toHaveBeenNthCalledWith(1, { domain: 'core', path: 'agent/settings' });
    expect(mockGetNodePayload).toHaveBeenNthCalledWith(2, { domain: 'core', path: 'agent' });
    expect(result.parent?.uri).toBe('core://agent');
    expect(result.siblings).toEqual([{ uri: 'core://agent/profile', priority: 2 }]);
    expect(result.aliases).toEqual(['project://agent/settings']);
  });

  it('dispatches inspect_views', async () => {
    mockListMemoryViewsByNode.mockResolvedValue([{ view_type: 'gist' }] as any);
    await executeDreamTool('inspect_views', { uri: 'core://test', limit: 5 });
    expect(mockListMemoryViewsByNode).toHaveBeenCalledWith({ uri: 'core://test', limit: 5 });
  });

  it('dispatches create_node with parsed URI', async () => {
    mockCreateNode.mockResolvedValue({ uuid: 'new1' } as any);
    await executeDreamTool('create_node', { uri: 'core://parent/child', content: 'text', priority: 3 });
    expect(mockCreateNode).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'core', parentPath: 'parent', title: 'child', content: 'text', priority: 3 }),
      DREAM_EVENT_CONTEXT,
    );
  });

  it('dispatches update_node', async () => {
    mockUpdateNodeByPath.mockResolvedValue({ success: true } as any);
    await executeDreamTool('update_node', { uri: 'core://test', content: 'updated' });
    expect(mockUpdateNodeByPath).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'core', path: 'test', content: 'updated' }),
      DREAM_EVENT_CONTEXT,
    );
  });

  it('dispatches delete_node', async () => {
    mockDeleteNodeByPath.mockResolvedValue({ success: true } as any);
    await executeDreamTool('delete_node', { uri: 'core://test' });
    expect(mockDeleteNodeByPath).toHaveBeenCalledWith({ domain: 'core', path: 'test' }, DREAM_EVENT_CONTEXT);
  });

  it('dispatches move_node', async () => {
    mockMoveNode.mockResolvedValue({ success: true } as any);
    await executeDreamTool('move_node', { old_uri: 'core://old_path', new_uri: 'core://new_path' });
    expect(mockMoveNode).toHaveBeenCalledWith(
      expect.objectContaining({ old_uri: 'core://old_path', new_uri: 'core://new_path' }),
      DREAM_EVENT_CONTEXT,
    );
  });

  it('dispatches add_glossary', async () => {
    mockAddGlossaryKeyword.mockResolvedValue({ success: true } as any);
    await executeDreamTool('add_glossary', { keyword: 'test', node_uuid: 'n1' });
    expect(mockAddGlossaryKeyword).toHaveBeenCalledWith({ keyword: 'test', node_uuid: 'n1' }, DREAM_EVENT_CONTEXT);
  });

  it('dispatches remove_glossary', async () => {
    mockRemoveGlossaryKeyword.mockResolvedValue({ success: true } as any);
    await executeDreamTool('remove_glossary', { keyword: 'test', node_uuid: 'n1' });
    expect(mockRemoveGlossaryKeyword).toHaveBeenCalledWith({ keyword: 'test', node_uuid: 'n1' }, DREAM_EVENT_CONTEXT);
  });

  it('dispatches manage_triggers', async () => {
    mockManageTriggers.mockResolvedValue({ success: true } as any);
    await executeDreamTool('manage_triggers', { uri: 'core://test', add: ['a'], remove: ['b'] });
    expect(mockManageTriggers).toHaveBeenCalledWith({ uri: 'core://test', add: ['a'], remove: ['b'] }, DREAM_EVENT_CONTEXT);
  });

  it('returns error for unknown tool', async () => {
    const result = await executeDreamTool('nonexistent', {});
    expect(result).toEqual({ error: 'Unknown tool: nonexistent' });
  });

  it('catches errors and returns error object', async () => {
    mockGetNodePayload.mockRejectedValue(new Error('Not found'));
    const result = await executeDreamTool('get_node', { uri: 'core://missing' });
    expect(result).toEqual({ error: 'Not found' });
  });
});

// ---------------------------------------------------------------------------
// buildDreamSystemPrompt
// ---------------------------------------------------------------------------

describe('buildDreamSystemPrompt', () => {
  it('includes health report JSON', () => {
    const prompt = buildDreamSystemPrompt(makeHealthData());
    expect(prompt).toContain('健康报告');
    expect(prompt).toContain('health_summary');
  });

  it('includes read-before-write evidence rules for diagnosis tools', () => {
    const prompt = buildDreamSystemPrompt(makeHealthData());
    expect(prompt).toContain('诊断工具箱');
    expect(prompt).toContain('get_node_recall_detail');
    expect(prompt).toContain('inspect_neighbors');
    expect(prompt).toContain('任何写操作前');
  });

  it('reads recent_queries from the paginated stats block', () => {
    const prompt = buildDreamSystemPrompt(makeHealthData({
      recallStats: {
        summary: {},
        by_path: [],
        noisy_nodes: [],
        recent_queries: {
          items: [{ query_text: 'long query text', merged_count: 3, shown_count: 2, used_count: 1 }],
          total: 1,
          limit: 20,
          offset: 0,
          has_more: false,
        },
      } as any,
    }));
    expect(prompt).toContain('long query text');
    expect(prompt).toContain('"merged": 3');
  });

  it('tolerates missing recent_queries items', () => {
    const prompt = buildDreamSystemPrompt(makeHealthData({
      recallStats: {
        summary: {},
        by_path: [],
        noisy_nodes: [],
        recent_queries: {} as any,
      } as any,
    }));
    expect(prompt).toContain('"recent_queries": []');
  });

  it('includes recent diary section when provided', () => {
    const diaries = [{ started_at: '2024-01-01T00:00:00Z', status: 'completed', narrative: 'Test diary', tool_calls: [] }];
    const prompt = buildDreamSystemPrompt(makeHealthData(), diaries);
    expect(prompt).toContain('最近日记');
    expect(prompt).toContain('Test diary');
  });

  it('omits diary entries section when no diaries', () => {
    const prompt = buildDreamSystemPrompt(makeHealthData(), []);
    // The rules text mentions "最近日记" in passing, but the actual diary entries section
    // "最近日记（避免重复整理）" should not appear
    expect(prompt).not.toContain('最近日记（避免重复整理）');
  });

  it('includes the guidance file content (mocked)', () => {
    const prompt = buildDreamSystemPrompt(makeHealthData());
    // The mock returns '# MCP Guidance\nlore_get_node is useful'
    // lore_get_node gets remapped to get_node
    expect(prompt).toContain('get_node');
  });
});

// ---------------------------------------------------------------------------
// loadGuidanceFile
// ---------------------------------------------------------------------------

describe('loadGuidanceFile', () => {
  it('remaps lore_ prefixed tool names', () => {
    const content = loadGuidanceFile();
    expect(content).toContain('get_node');
    expect(content).not.toContain('lore_get_node');
  });
});
