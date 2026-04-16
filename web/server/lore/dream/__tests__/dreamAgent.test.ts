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
vi.mock('../../memory/boot', () => ({
  getBootNodeSpec: vi.fn(),
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

vi.mock('../../llm/provider', () => ({
  generateTextWithTools: vi.fn(),
}));

import { getSettings } from '../../config/settings';
import { generateTextWithTools } from '../../llm/provider';
import { getNodePayload, listDomains } from '../../memory/browse';
import { searchMemories } from '../../search/search';
import { createNode, updateNodeByPath, deleteNodeByPath, moveNode } from '../../memory/write';
import { getBootNodeSpec } from '../../memory/boot';
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

const originalFetch = global.fetch;

const mockGetSettings = vi.mocked(getSettings);
const mockGenerateTextWithTools = vi.mocked(generateTextWithTools);
const mockGetNodePayload = vi.mocked(getNodePayload);
const mockListDomains = vi.mocked(listDomains);
const mockSearchMemories = vi.mocked(searchMemories);
const mockCreateNode = vi.mocked(createNode);
const mockUpdateNodeByPath = vi.mocked(updateNodeByPath);
const mockDeleteNodeByPath = vi.mocked(deleteNodeByPath);
const mockMoveNode = vi.mocked(moveNode);
const mockGetBootNodeSpec = vi.mocked(getBootNodeSpec);
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

function makeToolResponse(tool_calls: Array<{ id: string; function: { name: string; arguments: string } }>, content: string | null = null) {
  return { content, tool_calls, raw: {} };
}

function makeTextResponse(content: string) {
  return { content, tool_calls: [], raw: {} };
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
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = originalFetch;
  });

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
      provider: 'openai_compatible',
      base_url: 'http://localhost:1234/v1',
      api_key: 'test-key',
      model: 'gpt-4',
      timeout_ms: 1800000,
      temperature: 0.5,
      api_version: '',
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
    expect(tools[0].name).toBeDefined();
    expect(tools[0].parameters).toBeDefined();
  });

  it('includes all expected tool names', () => {
    const tools = buildDreamTools();
    const names = tools.map((t) => t.name);
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
      expect(tool.parameters).toBeDefined();
      expect(tool.parameters.type).toBe('object');
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
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBootNodeSpec.mockReturnValue(null);
  });

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

  it('blocks update_node on protected boot nodes', async () => {
    mockGetBootNodeSpec.mockReturnValue({
      uri: 'core://agent',
      role: 'agent',
      role_label: 'workflow constraints',
      purpose: 'Working rules',
      dream_protection: 'protected',
    });

    const result = await executeDreamTool('update_node', { uri: 'core://agent', content: 'updated' });
    expect(result).toEqual({
      error: 'dream:auto cannot update protected boot node core://agent (workflow constraints)',
      blocked: true,
      operation: 'update_node',
      blocked_uri: 'core://agent',
      boot_role: 'agent',
      boot_role_label: 'workflow constraints',
      dream_protection: 'protected',
      requested_old_uri: undefined,
      requested_new_uri: undefined,
    });
    expect(mockUpdateNodeByPath).not.toHaveBeenCalled();
  });

  it('blocks move_node when source is a protected boot node', async () => {
    mockGetBootNodeSpec.mockImplementation((uri) => {
      if (uri === 'core://soul') {
        return {
          uri: 'core://soul',
          role: 'soul',
          role_label: 'style / persona / self-definition',
          purpose: 'Persona baseline',
          dream_protection: 'protected',
        };
      }
      return null;
    });

    const result = await executeDreamTool('move_node', {
      old_uri: 'core://soul',
      new_uri: 'core://soul_archive',
    });
    expect(result).toEqual({
      error: 'dream:auto cannot move protected boot node core://soul (style / persona / self-definition)',
      blocked: true,
      operation: 'move_node',
      blocked_uri: 'core://soul',
      boot_role: 'soul',
      boot_role_label: 'style / persona / self-definition',
      dream_protection: 'protected',
      requested_old_uri: 'core://soul',
      requested_new_uri: 'core://soul_archive',
    });
    expect(mockMoveNode).not.toHaveBeenCalled();
  });

  it('blocks move_node when target is a protected boot path', async () => {
    mockGetBootNodeSpec.mockImplementation((uri) => {
      if (uri === 'preferences://user') {
        return {
          uri: 'preferences://user',
          role: 'user',
          role_label: 'stable user definition',
          purpose: 'Stable user context',
          dream_protection: 'protected',
        };
      }
      return null;
    });

    const result = await executeDreamTool('move_node', {
      old_uri: 'core://scratch/user_profile',
      new_uri: 'preferences://user',
    });
    expect(result).toEqual({
      error: 'dream:auto cannot move a node onto protected boot path preferences://user (stable user definition)',
      blocked: true,
      operation: 'move_node',
      blocked_uri: 'preferences://user',
      boot_role: 'user',
      boot_role_label: 'stable user definition',
      dream_protection: 'protected',
      requested_old_uri: 'core://scratch/user_profile',
      requested_new_uri: 'preferences://user',
    });
    expect(mockMoveNode).not.toHaveBeenCalled();
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

  it('mentions fixed boot protection in the system prompt', () => {
    const prompt = buildDreamSystemPrompt(makeHealthData());
    expect(prompt).toContain('固定启动基线');
    expect(prompt).toContain('core://agent');
    expect(prompt).toContain('不要 update / delete / move core://agent、core://soul、preferences://user');
    expect(prompt).toContain('优先处理路径分配、父子位置、拆分或迁移判断');
    expect(prompt).toContain('最终写给人看的日记尽量使用自然中文');
    expect(prompt).toContain('不要夹杂 query、path、view、split、move、content 这类内部英文术语');
  });
});

describe('runDreamAgentLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateTextWithTools.mockReset();
    mockListDomains.mockResolvedValue(['core'] as any);
    mockGetBootNodeSpec.mockReturnValue(null);
  });

  it('emits workflow events for turns, tool calls, and final note', async () => {
    mockGenerateTextWithTools
      .mockResolvedValueOnce(makeToolResponse([{ id: 'call-1', function: { name: 'list_domains', arguments: '{}' } }]))
      .mockResolvedValueOnce(makeTextResponse('Final narrative'));

    const events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    const config: LlmConfig = {
      provider: 'openai_compatible',
      base_url: 'http://localhost:1234/v1',
      api_key: 'test-key',
      model: 'gpt-4o-mini',
      timeout_ms: 5000,
      temperature: 0.3,
      api_version: '',
    };

    const result = await runDreamAgentLoop(config, makeHealthData(), [], {
      onEvent: async (type, payload) => {
        events.push({ type, payload });
      },
    });

    expect(result.narrative).toBe('Final narrative');
    expect(result.toolCalls).toHaveLength(1);
    expect(events.map((event) => event.type)).toEqual([
      'llm_turn_started',
      'tool_call_started',
      'tool_call_finished',
      'llm_turn_started',
      'assistant_note',
    ]);
    expect(events[1].payload).toMatchObject({ turn: 1, tool: 'list_domains' });
    expect(events[2].payload).toMatchObject({ turn: 1, tool: 'list_domains', ok: true });
    expect(events[4].payload).toMatchObject({ message: 'Final narrative' });
  });

  it('emits protected_node_blocked when a boot node write is blocked', async () => {
    mockGetBootNodeSpec.mockImplementation((uri) => {
      if (uri === 'core://agent') {
        return {
          uri: 'core://agent',
          role: 'agent',
          role_label: 'workflow constraints',
          purpose: 'Working rules',
          dream_protection: 'protected',
        };
      }
      return null;
    });
    mockGenerateTextWithTools
      .mockResolvedValueOnce(makeToolResponse([{ id: 'call-1', function: { name: 'update_node', arguments: '{"uri":"core://agent","content":"x"}' } }]))
      .mockResolvedValueOnce(makeTextResponse('Blocked and moved on'));

    const events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    const config: LlmConfig = {
      provider: 'openai_compatible',
      base_url: 'http://localhost:1234/v1',
      api_key: 'test-key',
      model: 'gpt-4o-mini',
      timeout_ms: 5000,
      temperature: 0.3,
      api_version: '',
    };

    const result = await runDreamAgentLoop(config, makeHealthData(), [], {
      onEvent: async (type, payload) => {
        events.push({ type, payload });
      },
    });

    expect(result.narrative).toBe('Blocked and moved on');
    expect(events.map((event) => event.type)).toEqual([
      'llm_turn_started',
      'tool_call_started',
      'protected_node_blocked',
      'tool_call_finished',
      'llm_turn_started',
      'assistant_note',
    ]);
    expect(events[2].payload).toMatchObject({
      tool: 'update_node',
      blocked_uri: 'core://agent',
      boot_role: 'agent',
      reason: 'dream:auto cannot update protected boot node core://agent (workflow constraints)',
    });
    expect(events[3].payload).toMatchObject({ tool: 'update_node', ok: false, blocked: true });
    expect(mockUpdateNodeByPath).not.toHaveBeenCalled();
  });

  it('supports anthropic tool use flow', async () => {
    mockGenerateTextWithTools
      .mockResolvedValueOnce(makeToolResponse([{ id: 'toolu_1', function: { name: 'list_domains', arguments: '{}' } }]))
      .mockResolvedValueOnce(makeTextResponse('Anthropic final narrative'));

    const config: LlmConfig = {
      provider: 'anthropic',
      base_url: 'http://localhost:1234',
      api_key: 'test-key',
      model: 'claude-sonnet-4-6',
      timeout_ms: 5000,
      temperature: 0.3,
      api_version: '2023-06-01',
    };

    const result = await runDreamAgentLoop(config, makeHealthData(), []);
    expect(result.narrative).toBe('Anthropic final narrative');
    expect(result.toolCalls).toHaveLength(1);
  });

  it('supports openai responses tool flow', async () => {
    mockGenerateTextWithTools
      .mockResolvedValueOnce(makeToolResponse([{ id: 'call-1', function: { name: 'list_domains', arguments: '{}' } }]))
      .mockResolvedValueOnce(makeTextResponse('Responses final narrative'));

    const config: LlmConfig = {
      provider: 'openai_responses',
      base_url: 'http://localhost:1234/v1',
      api_key: 'test-key',
      model: 'gpt-4.1',
      timeout_ms: 5000,
      temperature: 0.3,
      api_version: '',
    };

    const result = await runDreamAgentLoop(config, makeHealthData(), []);
    expect(result.narrative).toBe('Responses final narrative');
    expect(result.toolCalls).toHaveLength(1);
  });
});
