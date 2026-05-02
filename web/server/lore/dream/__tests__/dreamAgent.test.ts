import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => ({ messages: vi.fn() })),
}));
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => ({ chat: vi.fn(), responses: vi.fn(), embedding: vi.fn() })),
}));
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
  getDreamQueryRecallDetail: vi.fn(),
  getDreamQueryCandidates: vi.fn(),
  getDreamQueryPathBreakdown: vi.fn(),
  getDreamQueryNodePaths: vi.fn(),
  getDreamQueryEventSamples: vi.fn(),
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
vi.mock('../../ops/policy', () => ({
  validateCreatePolicy: vi.fn(),
  validateUpdatePolicy: vi.fn(),
  validateDeletePolicy: vi.fn(),
}));
vi.mock('../../memory/session', () => ({
  markSessionRead: vi.fn(),
}));
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(() => '# MCP Guidance\nlore_boot\nlore_guidance\nlore_get_node is useful'),
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
import {
  getDreamQueryCandidates,
  getDreamQueryEventSamples,
  getDreamQueryNodePaths,
  getDreamQueryPathBreakdown,
  getDreamQueryRecallDetail,
  getRecallStats,
} from '../../recall/recallAnalytics';
import { getNodeWriteHistory } from '../../memory/writeEvents';
import { getPathEffectiveness } from '../../recall/feedbackAnalytics';
import { validateCreatePolicy, validateDeletePolicy, validateUpdatePolicy } from '../../ops/policy';
import { markSessionRead } from '../../memory/session';
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
  type DreamInitialContext,
} from '../dreamAgent';
import { processDreamToolCalls } from '../dreamLoopToolCalls';

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
const mockGetDreamQueryRecallDetail = vi.mocked(getDreamQueryRecallDetail);
const mockGetDreamQueryCandidates = vi.mocked(getDreamQueryCandidates);
const mockGetDreamQueryPathBreakdown = vi.mocked(getDreamQueryPathBreakdown);
const mockGetDreamQueryNodePaths = vi.mocked(getDreamQueryNodePaths);
const mockGetDreamQueryEventSamples = vi.mocked(getDreamQueryEventSamples);
const mockGetNodeWriteHistory = vi.mocked(getNodeWriteHistory);
const mockGetPathEffectiveness = vi.mocked(getPathEffectiveness);
const mockValidateCreatePolicy = vi.mocked(validateCreatePolicy);
const mockValidateUpdatePolicy = vi.mocked(validateUpdatePolicy);
const mockValidateDeletePolicy = vi.mocked(validateDeletePolicy);
const mockMarkSessionRead = vi.mocked(markSessionRead);
const mockListMemoryViewsByNode = vi.mocked(listMemoryViewsByNode);

function makeInitialContext(overrides: Partial<DreamInitialContext> = {}): DreamInitialContext {
  return {
    bootBaseline: [
      {
        uri: 'core://agent',
        role_label: 'workflow constraints',
        purpose: 'Working rules, collaboration constraints, and execution protocol.',
        state: 'initialized',
        content: 'Agent boot body',
      },
      {
        uri: 'core://soul',
        role_label: 'style / persona / self-definition',
        purpose: 'Agent style, persona, and self-cognition baseline.',
        state: 'initialized',
        content: 'Soul boot body',
      },
      {
        uri: 'preferences://user',
        role_label: 'stable user definition',
        purpose: 'Stable user information, user preferences, and durable collaboration context.',
        state: 'initialized',
        content: 'User boot body',
      },
    ],
    guidance: '# MCP Guidance\npreloaded boot baseline\npreloaded guidance\nget_node is useful',
    recallStats: { summary: {}, by_path: [], noisy_nodes: [], recent_queries: { items: [], total: 0, limit: 20, offset: 0, has_more: false } },
    recallReview: { summary: {}, reviewed_queries: [], signal_coverage: {} },
    writeActivity: { summary: {}, hot_nodes: [], recent_events: [] },
    recentDiaries: [],
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
      'view_llm.api_key': 'test-key',
      'view_llm.model': 'gpt-4',
      'view_llm.temperature': 0.3,
      'view_llm.timeout_ms': 1800000,
    });
    const result = await loadLlmConfig();
    expect(result).toBeNull();
  });

  it('returns config when all fields present', async () => {
    mockGetSettings.mockResolvedValue({
      'view_llm.base_url': 'http://localhost:1234/v1/',
      'view_llm.api_key': 'test-key',
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
    expect(names).not.toContain('get_node_recall_detail');
    expect(names).toContain('get_query_recall_detail');
    expect(names).toContain('get_query_candidates');
    expect(names).toContain('get_query_path_breakdown');
    expect(names).toContain('get_query_node_paths');
    expect(names).toContain('get_query_event_samples');
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
    mockValidateCreatePolicy.mockResolvedValue({ errors: [], warnings: [] });
    mockValidateUpdatePolicy.mockResolvedValue({ errors: [], warnings: [] });
    mockValidateDeletePolicy.mockResolvedValue({ errors: [], warnings: [] });
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

  it('dispatches get_query_recall_detail to dream-focused query detail', async () => {
    mockGetDreamQueryRecallDetail.mockResolvedValue({ query_detail: { query_id: 'q1' } } as any);
    await executeDreamTool('get_query_recall_detail', { query_id: 'q1', query_text: 'hello', days: 7, limit: 4 });
    expect(mockGetDreamQueryRecallDetail).toHaveBeenCalledWith({ queryId: 'q1', queryText: 'hello', days: 7, limit: 4 });
    expect(mockGetRecallStats).not.toHaveBeenCalled();
  });

  it('dispatches query drilldown tools to focused analytics helpers', async () => {
    mockGetDreamQueryCandidates.mockResolvedValue({ candidates: [] } as any);
    mockGetDreamQueryPathBreakdown.mockResolvedValue({ paths: [] } as any);
    mockGetDreamQueryNodePaths.mockResolvedValue({ paths: [] } as any);
    mockGetDreamQueryEventSamples.mockResolvedValue({ events: [] } as any);

    await executeDreamTool('get_query_candidates', { query_id: 'q1', limit: 8, selected_only: true, used_only: false });
    await executeDreamTool('get_query_path_breakdown', { query_id: 'q1' });
    await executeDreamTool('get_query_node_paths', { query_id: 'q1', node_uri: 'core://a' });
    await executeDreamTool('get_query_event_samples', { query_id: 'q1', node_uri: 'core://a', retrieval_path: 'dense', limit: 3, include_metadata: true });

    expect(mockGetDreamQueryCandidates).toHaveBeenCalledWith({ queryId: 'q1', limit: 8, selectedOnly: true, usedOnly: false });
    expect(mockGetDreamQueryPathBreakdown).toHaveBeenCalledWith({ queryId: 'q1' });
    expect(mockGetDreamQueryNodePaths).toHaveBeenCalledWith({ queryId: 'q1', nodeUri: 'core://a' });
    expect(mockGetDreamQueryEventSamples).toHaveBeenCalledWith({ queryId: 'q1', nodeUri: 'core://a', retrievalPath: 'dense', limit: 3, includeMetadata: true });
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

  it('tracks session reads for get_node when session context is provided', async () => {
    mockGetNodePayload.mockResolvedValue({
      node: { uri: 'core://test', node_uuid: 'node-1' },
      children: [],
      breadcrumbs: [],
    } as any);

    await executeDreamTool('get_node', { uri: 'core://test' }, { source: 'dream:auto', session_id: 'dream:42' });

    expect(mockMarkSessionRead).toHaveBeenCalledWith({
      session_id: 'dream:42',
      uri: 'core://test',
      node_uuid: 'node-1',
      source: 'dream:auto:get_node',
    });
  });

  it('passes session context through to policy-aware update_node validation', async () => {
    mockUpdateNodeByPath.mockResolvedValue({ success: true } as any);

    await executeDreamTool('update_node', { uri: 'core://test', content: 'updated' }, { source: 'dream:auto', session_id: 'dream:7' });

    expect(mockValidateUpdatePolicy).toHaveBeenCalledWith({
      domain: 'core',
      path: 'test',
      priority: undefined,
      disclosure: undefined,
      sessionId: 'dream:7',
    });
    expect(mockUpdateNodeByPath).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'core', path: 'test', content: 'updated' }),
      { source: 'dream:auto', session_id: 'dream:7' },
    );
  });

  it('returns canonical policy validation blocks for Dream writes', async () => {
    mockValidateUpdatePolicy.mockResolvedValue({
      errors: ['priority budget exceeded'],
      warnings: ['read before modify first'],
    });

    const result = await executeDreamTool('update_node', { uri: 'core://test', content: 'updated' });

    expect(result).toEqual({
      error: 'priority budget exceeded',
      detail: 'priority budget exceeded',
      code: 'validation_error',
      warnings: ['read before modify first'],
      policy_warnings: ['read before modify first'],
      status: 422,
    });
    expect(mockUpdateNodeByPath).not.toHaveBeenCalled();
  });

  it('attaches policy warnings to successful Dream writes', async () => {
    mockValidateCreatePolicy.mockResolvedValue({ errors: [], warnings: ['disclosure is recommended'] });
    mockCreateNode.mockResolvedValue({ success: true, operation: 'create', uri: 'core://parent/child', path: 'parent/child', node_uuid: 'new1' } as any);

    const result = await executeDreamTool('create_node', { uri: 'core://parent/child', content: 'text', priority: 3 });

    expect(result).toEqual({
      success: true,
      operation: 'create',
      uri: 'core://parent/child',
      path: 'parent/child',
      node_uuid: 'new1',
      warnings: ['disclosure is recommended'],
      policy_warnings: ['disclosure is recommended'],
    });
  });

  it('dispatches create_node with parsed URI and glossary', async () => {
    mockCreateNode.mockResolvedValue({ uuid: 'new1' } as any);
    await executeDreamTool('create_node', { uri: 'core://parent/child', content: 'text', priority: 3, glossary: ['alpha', 'beta'] });
    expect(mockValidateCreatePolicy).toHaveBeenCalledWith({ priority: 3, disclosure: null });
    expect(mockCreateNode).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'core', parentPath: 'parent', title: 'child', content: 'text', priority: 3, glossary: ['alpha', 'beta'] }),
      DREAM_EVENT_CONTEXT,
    );
  });

  it('dispatches update_node', async () => {
    mockUpdateNodeByPath.mockResolvedValue({ success: true } as any);
    await executeDreamTool('update_node', { uri: 'core://test', content: 'updated' });
    expect(mockValidateUpdatePolicy).toHaveBeenCalledWith({
      domain: 'core',
      path: 'test',
      priority: undefined,
      disclosure: undefined,
      sessionId: null,
    });
    expect(mockUpdateNodeByPath).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'core', path: 'test', content: 'updated' }),
      DREAM_EVENT_CONTEXT,
    );
  });

  it('dispatches delete_node', async () => {
    mockDeleteNodeByPath.mockResolvedValue({ success: true } as any);
    await executeDreamTool('delete_node', { uri: 'core://test' });
    expect(mockValidateDeletePolicy).toHaveBeenCalledWith({ domain: 'core', path: 'test', sessionId: null });
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
      detail: 'dream:auto cannot update protected boot node core://agent (workflow constraints)',
      code: 'protected_boot_path',
      status: 409,
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
      detail: 'dream:auto cannot move protected boot node core://soul (style / persona / self-definition)',
      code: 'protected_boot_path',
      status: 409,
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
      detail: 'dream:auto cannot move a node onto protected boot path preferences://user (stable user definition)',
      code: 'protected_boot_path',
      status: 409,
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
    expect(result).toEqual({
      error: 'Unknown tool: nonexistent',
      detail: 'Unknown tool: nonexistent',
      code: 'unknown_tool',
      status: 404,
    });
  });

  it('catches errors and returns error object', async () => {
    mockGetNodePayload.mockRejectedValue(new Error('Not found'));
    const result = await executeDreamTool('get_node', { uri: 'core://missing' });
    expect(result).toEqual({ error: 'Not found', detail: 'Not found', status: 500 });
  });
});

describe('processDreamToolCalls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records tool execution, appends messages, and emits protected boot block events', async () => {
    const messages: Array<Record<string, unknown>> = [];
    const toolCalls: Array<Record<string, unknown>> = [];
    const events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    const executeTool = vi
      .fn()
      .mockResolvedValueOnce({ items: ['core'] })
      .mockResolvedValueOnce({
        blocked: true,
        code: 'protected_boot_path',
        blocked_uri: 'core://agent',
        boot_role: 'agent',
        detail: 'blocked by boot protection',
      });

    await processDreamToolCalls({
      turn: 2,
      content: 'thinking',
      rawToolCalls: [
        { id: 'call-1', function: { name: 'list_domains', arguments: '{}' } },
        { id: 'call-2', function: { name: 'update_node', arguments: '{"uri":"core://agent"}' } },
      ],
      messages: messages as any,
      toolCalls: toolCalls as any,
      onEvent: async (type, payload) => {
        events.push({ type, payload });
      },
      executeTool,
    });

    expect(messages).toEqual([
      {
        role: 'assistant',
        content: 'thinking',
        tool_calls: [
          { id: 'call-1', function: { name: 'list_domains', arguments: '{}' } },
          { id: 'call-2', function: { name: 'update_node', arguments: '{"uri":"core://agent"}' } },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call-1',
        content: JSON.stringify({ items: ['core'] }),
      },
      {
        role: 'tool',
        tool_call_id: 'call-2',
        content: JSON.stringify({
          blocked: true,
          code: 'protected_boot_path',
          blocked_uri: 'core://agent',
          boot_role: 'agent',
          detail: 'blocked by boot protection',
        }),
      },
    ]);
    expect(toolCalls).toEqual([
      {
        tool: 'list_domains',
        args: {},
        result_preview: JSON.stringify({ items: ['core'] }),
      },
      {
        tool: 'update_node',
        args: { uri: 'core://agent' },
        result_preview: JSON.stringify({
          blocked: true,
          code: 'protected_boot_path',
          blocked_uri: 'core://agent',
          boot_role: 'agent',
          detail: 'blocked by boot protection',
        }),
      },
    ]);
    expect(events).toEqual([
      { type: 'tool_call_started', payload: { turn: 2, tool: 'list_domains', args: {} } },
      {
        type: 'tool_call_finished',
        payload: {
          turn: 2,
          tool: 'list_domains',
          ok: true,
          blocked: false,
          protected_blocked: false,
          policy_blocked: false,
          warnings: [],
          policy_warnings: [],
        },
      },
      { type: 'tool_call_started', payload: { turn: 2, tool: 'update_node', args: { uri: 'core://agent' } } },
      {
        type: 'protected_node_blocked',
        payload: {
          turn: 2,
          tool: 'update_node',
          blocked_uri: 'core://agent',
          boot_role: 'agent',
          reason: 'blocked by boot protection',
        },
      },
      {
        type: 'tool_call_finished',
        payload: {
          turn: 2,
          tool: 'update_node',
          ok: false,
          blocked: true,
          protected_blocked: true,
          policy_blocked: false,
          warnings: [],
          policy_warnings: [],
        },
      },
    ]);
    expect(executeTool).toHaveBeenNthCalledWith(1, 'list_domains', {});
    expect(executeTool).toHaveBeenNthCalledWith(2, 'update_node', { uri: 'core://agent' });
  });

  it('emits policy block and warning workflow events when policy validation fails', async () => {
    const events: Array<{ type: string; payload?: Record<string, unknown> }> = [];

    await processDreamToolCalls({
      turn: 1,
      content: 'thinking',
      rawToolCalls: [{ id: 'call-1', function: { name: 'update_node', arguments: '{"uri":"core://test"}' } }],
      messages: [] as any,
      toolCalls: [] as any,
      onEvent: async (type, payload) => {
        events.push({ type, payload });
      },
      executeTool: vi.fn().mockResolvedValue({
        error: 'priority budget exceeded',
        detail: 'priority budget exceeded',
        code: 'validation_error',
        status: 422,
        warnings: ['read before modify first'],
        policy_warnings: ['read before modify first'],
      }),
    });

    expect(events).toEqual([
      { type: 'tool_call_started', payload: { turn: 1, tool: 'update_node', args: { uri: 'core://test' } } },
      {
        type: 'policy_validation_blocked',
        payload: {
          turn: 1,
          tool: 'update_node',
          reason: 'priority budget exceeded',
          warnings: ['read before modify first'],
          policy_warnings: ['read before modify first'],
        },
      },
      {
        type: 'policy_warning_emitted',
        payload: {
          turn: 1,
          tool: 'update_node',
          warnings: ['read before modify first'],
          policy_warnings: ['read before modify first'],
        },
      },
      {
        type: 'tool_call_finished',
        payload: {
          turn: 1,
          tool: 'update_node',
          ok: false,
          blocked: true,
          protected_blocked: false,
          policy_blocked: true,
          warnings: ['read before modify first'],
          policy_warnings: ['read before modify first'],
        },
      },
    ]);
  });

  it('emits policy warning workflow events for successful writes with warnings', async () => {
    const events: Array<{ type: string; payload?: Record<string, unknown> }> = [];

    await processDreamToolCalls({
      turn: 1,
      content: 'thinking',
      rawToolCalls: [{ id: 'call-1', function: { name: 'create_node', arguments: '{"content":"x","priority":2}' } }],
      messages: [] as any,
      toolCalls: [] as any,
      onEvent: async (type, payload) => {
        events.push({ type, payload });
      },
      executeTool: vi.fn().mockResolvedValue({
        success: true,
        operation: 'create',
        uri: 'core://1',
        path: '1',
        node_uuid: 'node-1',
        warnings: ['disclosure is recommended'],
        policy_warnings: ['disclosure is recommended'],
      }),
    });

    expect(events).toEqual([
      { type: 'tool_call_started', payload: { turn: 1, tool: 'create_node', args: { content: 'x', priority: 2 } } },
      {
        type: 'policy_warning_emitted',
        payload: {
          turn: 1,
          tool: 'create_node',
          warnings: ['disclosure is recommended'],
          policy_warnings: ['disclosure is recommended'],
        },
      },
      {
        type: 'tool_call_finished',
        payload: {
          turn: 1,
          tool: 'create_node',
          ok: true,
          blocked: false,
          protected_blocked: false,
          policy_blocked: false,
          warnings: ['disclosure is recommended'],
          policy_warnings: ['disclosure is recommended'],
        },
      },
    ]);
  });

  it('falls back to empty args when tool arguments are invalid JSON', async () => {
    const executeTool = vi.fn().mockResolvedValue({ ok: true });
    const messages: Array<Record<string, unknown>> = [];
    const toolCalls: Array<Record<string, unknown>> = [];

    await processDreamToolCalls({
      turn: 1,
      content: '',
      rawToolCalls: [{ id: 'call-1', function: { name: 'list_domains', arguments: '{bad json' } }],
      messages: messages as any,
      toolCalls: toolCalls as any,
      executeTool,
    });

    expect(executeTool).toHaveBeenCalledWith('list_domains', {});
    expect(toolCalls).toEqual([
      {
        tool: 'list_domains',
        args: {},
        result_preview: JSON.stringify({ ok: true }),
      },
    ]);
  });

});

describe('loadGuidanceFile', () => {
  it('loads guidance from the real lore guidance path and remaps tool names to English placeholders', () => {
    const prompt = loadGuidanceFile();
    expect(prompt).toContain('preloaded boot baseline');
    expect(prompt).toContain('preloaded guidance');
    expect(prompt).toContain('get_node');
    expect(prompt).not.toContain('做梦时不需要');
  });
});

// ---------------------------------------------------------------------------
// buildDreamSystemPrompt
// ---------------------------------------------------------------------------

describe('buildDreamSystemPrompt', () => {
  it('establishes auditor identity and diagnostic framework', () => {
    const prompt = buildDreamSystemPrompt(makeInitialContext());
    expect(prompt).toContain('你是 Lore 记忆系统的质检员');
    expect(prompt).toContain('至少有一类查询，在明天比今天更有可能召回正确的结果');
    expect(prompt).toContain('Agent boot body');
    expect(prompt).toContain('Soul boot body');
    expect(prompt).toContain('User boot body');
    expect(prompt).toContain('启动基线');
    expect(prompt).toContain('记忆写入规则');
  });

  it('provides structured decision framework for interventions', () => {
    const prompt = buildDreamSystemPrompt(makeInitialContext());
    expect(prompt).toContain('结构 / 边界');
    expect(prompt).toContain('disclosure / glossary');
    expect(prompt).toContain('最后才改内容');
    expect(prompt).toContain('不要润色');
    expect(prompt).toContain('受保护的启动基线节点');
    expect(prompt).toContain('当前数据');
  });

  it('filters out non-actionable changes with explicit guardrails', () => {
    const prompt = buildDreamSystemPrompt(makeInitialContext());
    expect(prompt).toContain('不为好看而改');
    expect(prompt).toContain('不确定就不做');
    expect(prompt).toContain('任何基于"可能是"');
  });

  it('replaces structured diary with decision record approach', () => {
    const prompt = buildDreamSystemPrompt(makeInitialContext());
    expect(prompt).toContain('决策记录');
    expect(prompt).toContain('需要固定章节');
    expect(prompt).not.toContain('Which recall requests you reviewed');
    expect(prompt).not.toContain('Maintenance-only changes');
  });

  it('downgrades diary from structured output to honest decision log', () => {
    const prompt = buildDreamSystemPrompt(makeInitialContext());
    expect(prompt).toContain('如果你什么都没改，一句话就够');
    expect(prompt).toContain('诚实比完整重要');
    expect(prompt).toContain('不需要固定章节');
  });

  it('uses reviewed queries as the primary recall evidence (no longer duplicates recent queries)', () => {
    const prompt = buildDreamSystemPrompt(makeInitialContext({
      recallReview: {
        summary: { reviewed_queries: 1, possible_missed_recalls: 1 },
        reviewed_queries: [{ query_id: 'q-1', query_text: 'long query text', merged_count: 3, shown_count: 2, used_count: 1, flags: [], selected_uris: [], used_uris: [], unrecalled_session_reads: [], unshown_session_reads: [], missed_recall_signals: [] }],
      } as any,
    }));
    expect(prompt).toContain('long query text');
    expect(prompt).toContain('"shown"');
    expect(prompt).not.toContain('近期查询概况');
  });

  it('includes recent diary section in today context when provided', () => {
    const prompt = buildDreamSystemPrompt(makeInitialContext({
      recentDiaries: [{ started_at: '2024-01-01T00:00:00Z', status: 'completed', narrative: 'Test diary', tool_calls: [] }],
    }));
    expect(prompt).toContain('Test diary');
  });

  it('includes query-level recall review and today-first mission', () => {
    const prompt = buildDreamSystemPrompt(makeInitialContext({
      recallReview: {
        summary: { reviewed_queries: 1, possible_missed_recalls: 2 },
        reviewed_queries: [
          {
            query_id: 'q-1',
            query_text: 'why did boot not recall',
            merged_count: 6,
            shown_count: 1,
            used_count: 0,
            flags: ['zero_use', 'high_merge_low_use'],
            selected_uris: ['core://agent'],
            used_uris: [],
            unrecalled_session_reads: ['core://soul'],
            unshown_session_reads: [],
            missed_recall_signals: [{ type: 'never_retrieved', uri: 'core://soul' }],
          },
        ],
      } as any,
    }));
    expect(prompt).toContain('why did boot not recall');
    expect(prompt).toContain('质检员');
    expect(prompt).toContain('high_merge_low_use');
  });

  it('uses Chinese throughout the prompt with action-first mindset', () => {
    const prompt = buildDreamSystemPrompt(makeInitialContext());
    expect(prompt).toContain('诊断框架');
    expect(prompt).toContain('决策记录');
    expect(prompt).toContain('至少有一类查询');
    expect(prompt).not.toContain('Dream 的宪法层');
    expect(prompt).not.toContain('Lore guidance 与这三个固定节点一起构成 Dream 的 baseline calibration');
  });

  it('mentions fixed boot protection and ordered change priorities', () => {
    const prompt = buildDreamSystemPrompt(makeInitialContext());
    expect(prompt).toContain('受保护的启动基线节点');
    expect(prompt).toContain('只读参考，不可修改');
    expect(prompt).toContain('结构 / 边界');
    expect(prompt).toContain('最后才改内容');
  });
});

describe('runDreamAgentLoop', () => {
  it('starts with a user kickoff message so providers do not receive an empty prompt', async () => {
    mockGenerateTextWithTools.mockResolvedValueOnce(makeTextResponse('Final narrative'));

    const config: LlmConfig = {
      provider: 'anthropic',
      base_url: 'http://localhost:1234',
      api_key: 'test-key',
      model: 'claude-sonnet-4-6',
      timeout_ms: 5000,
      temperature: 0.3,
      api_version: '2023-06-01',
    };

    await runDreamAgentLoop(config, makeInitialContext());

    expect(mockGenerateTextWithTools).toHaveBeenCalledTimes(1);
    const [, messages] = mockGenerateTextWithTools.mock.calls[0];
    expect(messages[0]).toMatchObject({ role: 'system' });
    expect(messages[1]).toMatchObject({ role: 'user' });
    expect(String((messages[1] as { content?: unknown }).content || '')).toContain('Begin the dream review');
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

    const result = await runDreamAgentLoop(config, makeInitialContext(), {
      onEvent: async (type, payload) => {
        events.push({ type, payload });
      },
      eventContext: { source: 'dream:auto', session_id: 'dream:99' },
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
    expect(events[2].payload).toMatchObject({
      turn: 1,
      tool: 'list_domains',
      ok: true,
      blocked: false,
      protected_blocked: false,
      policy_blocked: false,
      warnings: [],
      policy_warnings: [],
    });
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

    const result = await runDreamAgentLoop(config, makeInitialContext(), {
      onEvent: async (type, payload) => {
        events.push({ type, payload });
      },
      eventContext: { source: 'dream:auto', session_id: 'dream:11' },
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
    expect(events[3].payload).toMatchObject({
      tool: 'update_node',
      ok: false,
      blocked: true,
      protected_blocked: true,
      policy_blocked: false,
      warnings: [],
      policy_warnings: [],
    });
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

    const result = await runDreamAgentLoop(config, makeInitialContext());
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

    const result = await runDreamAgentLoop(config, makeInitialContext());
    expect(result.narrative).toBe('Responses final narrative');
    expect(result.toolCalls).toHaveLength(1);
  });
});
