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
vi.mock('../../recall/recallAnalytics', () => ({
  getRecallStats: vi.fn(),
  getDreamRecallReview: vi.fn(),
  getDreamQueryRecallDetail: vi.fn(),
  getDreamQueryCandidates: vi.fn(),
  getDreamQueryPathBreakdown: vi.fn(),
  getDreamQueryNodePaths: vi.fn(),
  getDreamQueryEventSamples: vi.fn(),
}));
vi.mock('../../memory/writeEvents', () => ({
  getNodeWriteHistory: vi.fn(),
  getDreamMemoryEventSummary: vi.fn(),
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
vi.mock('../../llm/provider', () => ({
  generateText: vi.fn(),
  generateTextWithTools: vi.fn(),
}));

import { getSettings } from '../../config/settings';
import { generateText, generateTextWithTools } from '../../llm/provider';
import { getNodePayload, listDomains } from '../../memory/browse';
import { searchMemories } from '../../search/search';
import { createNode, updateNodeByPath, deleteNodeByPath, moveNode } from '../../memory/write';
import { getBootNodeSpec } from '../../memory/boot';
import {
  getDreamRecallReview,
  getDreamQueryCandidates,
  getDreamQueryEventSamples,
  getDreamQueryNodePaths,
  getDreamQueryPathBreakdown,
  getDreamQueryRecallDetail,
  getRecallStats,
} from '../../recall/recallAnalytics';
import { getNodeWriteHistory, getDreamMemoryEventSummary } from '../../memory/writeEvents';
import { getPathEffectiveness } from '../../recall/feedbackAnalytics';
import { validateCreatePolicy, validateDeletePolicy, validateUpdatePolicy } from '../../ops/policy';
import { listMemoryViewsByNode } from '../../view/memoryViewQueries';
import {
  loadLlmConfig,
  chatWithTools,
  buildDreamTools,
  parseUri,
  executeDreamTool,
  loadGuidanceFile,
  buildDreamSystemPrompt,
  getDreamPhaseToolNames,
  parseDreamAuditJson,
  parseDreamPlanJson,
  rewriteDreamNarrative,
  runDreamAgentLoop,
  DREAM_EVENT_CONTEXT,
  type LlmConfig,
  type DreamInitialContext,
} from '../dreamAgent';
import { processDreamToolCalls } from '../dreamLoopToolCalls';

const originalFetch = global.fetch;

const mockGetSettings = vi.mocked(getSettings);
const mockGenerateText = vi.mocked(generateText);
const mockGenerateTextWithTools = vi.mocked(generateTextWithTools);
const mockGetNodePayload = vi.mocked(getNodePayload);
const mockListDomains = vi.mocked(listDomains);
const mockSearchMemories = vi.mocked(searchMemories);
const mockCreateNode = vi.mocked(createNode);
const mockUpdateNodeByPath = vi.mocked(updateNodeByPath);
const mockDeleteNodeByPath = vi.mocked(deleteNodeByPath);
const mockMoveNode = vi.mocked(moveNode);
const mockGetBootNodeSpec = vi.mocked(getBootNodeSpec);
const mockGetDreamRecallReview = vi.mocked(getDreamRecallReview);
const mockGetRecallStats = vi.mocked(getRecallStats);
const mockGetDreamQueryRecallDetail = vi.mocked(getDreamQueryRecallDetail);
const mockGetDreamQueryCandidates = vi.mocked(getDreamQueryCandidates);
const mockGetDreamQueryPathBreakdown = vi.mocked(getDreamQueryPathBreakdown);
const mockGetDreamQueryNodePaths = vi.mocked(getDreamQueryNodePaths);
const mockGetDreamQueryEventSamples = vi.mocked(getDreamQueryEventSamples);
const mockGetNodeWriteHistory = vi.mocked(getNodeWriteHistory);
const mockGetDreamMemoryEventSummary = vi.mocked(getDreamMemoryEventSummary);
const mockGetPathEffectiveness = vi.mocked(getPathEffectiveness);
const mockValidateCreatePolicy = vi.mocked(validateCreatePolicy);
const mockValidateUpdatePolicy = vi.mocked(validateUpdatePolicy);
const mockValidateDeletePolicy = vi.mocked(validateDeletePolicy);
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
    recallReview: { date: '2026-05-07', summary: {}, queries: [] },
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
    expect(names).toContain('get_recall_metadata');
    expect(names).not.toContain('get_node_recall_detail');
    expect(names).toContain('get_query_recall_detail');
    expect(names).toContain('get_query_candidates');
    expect(names).toContain('get_query_path_breakdown');
    expect(names).toContain('get_query_node_paths');
    expect(names).toContain('get_query_event_samples');
    expect(names).toContain('get_node_write_history');
    expect(names).toContain('get_memory_event_summary');
    expect(names).toContain('get_path_effectiveness_detail');
    expect(names).toContain('inspect_neighbors');
    expect(names).toContain('inspect_tree');
    expect(names).toContain('inspect_views');
    expect(names).toContain('refresh_or_inspect_views');
    expect(names).toContain('inspect_memory_node_for_dream');
    expect(names).toContain('validate_memory_change');
    expect(names).toContain('create_node');
    expect(names).toContain('update_node');
    expect(names).toContain('delete_node');
    expect(names).toContain('move_node');
    expect(names).not.toContain('add_glossary');
    expect(names).not.toContain('remove_glossary');
    expect(names).not.toContain('manage_triggers');
  });

  it('exposes glossary changes through update_node only', () => {
    const updateTool = buildDreamTools().find((tool) => tool.name === 'update_node');
    expect(updateTool?.parameters.properties).toMatchObject({
      glossary_add: { type: 'array', items: { type: 'string' } },
      glossary_remove: { type: 'array', items: { type: 'string' } },
    });
    expect(updateTool?.parameters.properties).not.toHaveProperty('glossary');
    expect(updateTool?.description).not.toContain('glossary fields');
  });

  it('each tool has required parameters field', () => {
    const tools = buildDreamTools();
    for (const tool of tools) {
      expect(tool.parameters).toBeDefined();
      expect(tool.parameters.type).toBe('object');
    }
  });
});

describe('Dream phase gates', () => {
  it('keeps mutation tools unavailable during diagnosis', () => {
    expect(getDreamPhaseToolNames('diagnose')).toEqual(expect.arrayContaining([
      'search',
      'get_node',
      'inspect_tree',
      'inspect_neighbors',
      'inspect_views',
      'refresh_or_inspect_views',
      'get_query_recall_detail',
      'get_query_candidates',
      'get_query_path_breakdown',
      'get_query_node_paths',
      'get_query_event_samples',
      'inspect_memory_node_for_dream',
    ]));
    expect(getDreamPhaseToolNames('diagnose')).not.toContain('create_node');
    expect(getDreamPhaseToolNames('diagnose')).not.toContain('update_node');
    expect(getDreamPhaseToolNames('diagnose')).not.toContain('delete_node');
    expect(getDreamPhaseToolNames('diagnose')).not.toContain('move_node');
  });

  it('parses structured plan and audit JSON', () => {
    expect(parseDreamPlanJson('{"tree_maintenance_candidates":[],"daily_memory_extraction_candidates":[],"recall_repair_candidates":[],"skip_reasons":["no evidence"]}')).toMatchObject({
      tree_maintenance_candidates: [],
      daily_memory_extraction_candidates: [],
      recall_repair_candidates: [],
      skip_reasons: ['no evidence'],
    });

    expect(parseDreamAuditJson('{"primary_focus":"no_change","changed_nodes":[],"evidence":[],"why_not_more_changes":"no strong evidence","expected_effect":"none","confidence":"high"}')).toMatchObject({
      primary_focus: 'no_change',
      why_not_more_changes: 'no strong evidence',
    });
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

  it('dispatches get_recall_metadata to raw recall metadata helper', async () => {
    mockGetDreamRecallReview.mockResolvedValue({ queries: [] } as any);
    await executeDreamTool('get_recall_metadata', { date: '2026-05-07', limit: 100, offset: 10 });
    expect(mockGetDreamRecallReview).toHaveBeenCalledWith({ date: '2026-05-07', days: 0, limit: 100, offset: 10 });
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

  it('dispatches get_memory_event_summary', async () => {
    mockGetDreamMemoryEventSummary.mockResolvedValue({ events: [] } as any);
    await executeDreamTool('get_memory_event_summary', {
      date: '2026-05-04',
      event_type: 'update',
      node_uri: 'core://test',
      limit: 12,
    });
    expect(mockGetDreamMemoryEventSummary).toHaveBeenCalledWith({
      date: '2026-05-04',
      eventType: 'update',
      nodeUri: 'core://test',
      limit: 12,
    });
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

  it('dispatches inspect_tree and returns bounded nested structure', async () => {
    mockGetNodePayload
      .mockResolvedValueOnce({
        node: {
          uri: 'core://project',
          node_uuid: 'root-1',
          priority: 2,
          disclosure: '当排查项目结构时',
          content: 'Project memory root with a longer body',
          memory_views: [
            { view_type: 'gist', text_content: 'Project gist from retrieval view' },
            { view_type: 'question', text_content: 'When should project be recalled?' },
          ],
        },
        children: [
          {
            uri: 'core://project/api',
            node_uuid: 'api-1',
            priority: 2,
            disclosure: '当排查 API 时',
            content_snippet: 'API child',
            approx_children_count: 1,
          },
        ],
        breadcrumbs: [],
      } as any)
      .mockResolvedValueOnce({
        node: {
          uri: 'core://project/api',
          node_uuid: 'api-1',
          priority: 2,
          disclosure: '当排查 API 时',
          content: 'API full content',
          memory_views: [
            { view_type: 'gist', text_content: 'API gist from retrieval view' },
          ],
        },
        children: [
          {
            uri: 'core://project/api/routes',
            node_uuid: 'routes-1',
            priority: 3,
            disclosure: null,
            content_snippet: 'Routes child',
            approx_children_count: 0,
          },
        ],
        breadcrumbs: [],
      } as any);

    const result = await executeDreamTool('inspect_tree', { uri: 'core://project', depth: 2, max_nodes: 10 }, { source: 'dream:auto', session_id: 'dream:42' }) as Record<string, any>;

    expect(mockGetNodePayload).toHaveBeenNthCalledWith(1, { domain: 'core', path: 'project' });
    expect(mockGetNodePayload).toHaveBeenNthCalledWith(2, { domain: 'core', path: 'project/api' });
    expect(result).toMatchObject({
      uri: 'core://project',
      depth: 2,
      max_nodes: 10,
      visited_nodes: 2,
      truncated: false,
      tree: {
        uri: 'core://project',
        content_snippet: 'Project gist from retrieval view',
        child_count: 1,
        children: [
          {
            uri: 'core://project/api',
            content_snippet: 'API gist from retrieval view',
            child_count: 1,
            children: [
              {
                uri: 'core://project/api/routes',
                child_count: 0,
                children: [],
              },
            ],
          },
        ],
      },
    });
  });

  it('dispatches inspect_views', async () => {
    mockListMemoryViewsByNode.mockResolvedValue([{ view_type: 'gist' }] as any);
    await executeDreamTool('inspect_views', { uri: 'core://test', limit: 5 });
    expect(mockListMemoryViewsByNode).toHaveBeenCalledWith({ uri: 'core://test', limit: 5 });
  });

  it('dispatches refresh_or_inspect_views as inspect-only view tool', async () => {
    mockListMemoryViewsByNode.mockResolvedValue([{ view_type: 'gist', text_content: 'view body', updated_at: '2026-05-07T00:00:00Z' }] as any);
    const result = await executeDreamTool('refresh_or_inspect_views', { uri: 'core://test', limit: 5 }) as Record<string, unknown>;
    expect(mockListMemoryViewsByNode).toHaveBeenCalledWith({ uri: 'core://test', limit: 5 });
    expect(result).toMatchObject({ uri: 'core://test', mode: 'inspect_only', refresh_supported: false });
    expect(result.json_size_chars).toEqual(expect.any(Number));
  });

  it('dispatches inspect_memory_node_for_dream with compact node context', async () => {
    mockGetNodePayload
      .mockResolvedValueOnce({
        node: {
          uri: 'project://lore/dream',
          node_uuid: 'node-1',
          priority: 2,
          disclosure: '当整理 dream 时',
          content: 'Dream node content',
          glossary_keywords: ['dream'],
          aliases: [],
        },
        children: [{ uri: 'project://lore/dream/child', priority: 3, disclosure: 'child', content_snippet: 'child body', approx_children_count: 0 }],
        breadcrumbs: [{ path: 'lore', label: 'lore' }],
      } as any)
      .mockResolvedValueOnce({
        node: { uri: 'project://lore', node_uuid: 'parent-1', priority: 2, disclosure: 'parent', content: 'Parent' },
        children: [
          { uri: 'project://lore/dream', priority: 2 },
          { uri: 'project://lore/runtime', priority: 2, disclosure: 'runtime', content_snippet: 'runtime body', approx_children_count: 0 },
        ],
        breadcrumbs: [],
      } as any);
    mockListMemoryViewsByNode.mockResolvedValue([{ view_type: 'gist', text_content: 'Dream gist', updated_at: '2026-05-07T00:00:00Z' }] as any);
    mockGetNodeWriteHistory.mockResolvedValue({ events: [] } as any);

    const result = await executeDreamTool('inspect_memory_node_for_dream', { uri: 'project://lore/dream', siblings_limit: 5, children_limit: 5, views_limit: 4, history_limit: 5 }) as Record<string, unknown>;

    expect(result).toMatchObject({
      uri: 'project://lore/dream',
      content_chars: 18,
      content_preview: 'Dream node content',
      disclosure: '当整理 dream 时',
      priority: 2,
      glossary: ['dream'],
      limits: { siblings: 5, children: 5, views: 4, history: 5 },
      json_size_chars: expect.any(Number),
    });
  });

  it('validates memory changes without mutating memory', async () => {
    const result = await executeDreamTool('validate_memory_change', { action: 'create', uri: 'project://foo', content: 'x', priority: 2 }) as Record<string, unknown>;
    expect(result).toMatchObject({
      action: 'create',
      uri: 'project://foo',
      blocked: false,
    });
    expect(result.warnings).toContain('disclosure is missing');
    expect(result.warnings).toContain('create target has little parent context and may create a horizontal island');
    expect(mockCreateNode).not.toHaveBeenCalled();
  });


  it('validates update_node policy without read-tracking session state', async () => {
    mockUpdateNodeByPath.mockResolvedValue({ success: true } as any);

    await executeDreamTool('update_node', { uri: 'core://test', content: 'updated' }, { source: 'dream:auto', session_id: 'dream:7' });

    expect(mockValidateUpdatePolicy).toHaveBeenCalledWith({
      domain: 'core',
      path: 'test',
      priority: undefined,
      disclosure: undefined,
    });
    expect(mockUpdateNodeByPath).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'core', path: 'test', content: 'updated' }),
      { source: 'dream:auto', session_id: 'dream:7' },
    );
  });

  it('returns canonical policy validation blocks for Dream writes', async () => {
    mockValidateUpdatePolicy.mockResolvedValue({
      errors: ['priority budget exceeded'],
      warnings: ['policy warning'],
    });

    const result = await executeDreamTool('update_node', { uri: 'core://test', content: 'updated' });

    expect(result).toEqual({
      error: 'priority budget exceeded',
      detail: 'priority budget exceeded',
      code: 'validation_error',
      warnings: ['policy warning'],
      policy_warnings: ['policy warning'],
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

  it('dispatches update_node with node-level glossary changes', async () => {
    mockUpdateNodeByPath.mockResolvedValue({ success: true } as any);
    await executeDreamTool('update_node', {
      uri: 'core://test',
      content: 'updated',
      glossary: ['alpha', 'beta'],
      glossary_add: ['gamma'],
      glossary_remove: ['old'],
    });
    expect(mockValidateUpdatePolicy).toHaveBeenCalledWith({
      domain: 'core',
      path: 'test',
      priority: undefined,
      disclosure: undefined,
    });
    expect(mockUpdateNodeByPath).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'core',
        path: 'test',
        content: 'updated',
        glossaryAdd: ['gamma'],
        glossaryRemove: ['old'],
      }),
      DREAM_EVENT_CONTEXT,
    );
  });

  it('dispatches delete_node', async () => {
    mockDeleteNodeByPath.mockResolvedValue({ success: true } as any);
    await executeDreamTool('delete_node', { uri: 'core://test' });
    expect(mockValidateDeletePolicy).toHaveBeenCalledWith({ domain: 'core', path: 'test' });
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
        result_size_chars: JSON.stringify({ items: ['core'] }).length,
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
        result_size_chars: JSON.stringify({
          blocked: true,
          code: 'protected_boot_path',
          blocked_uri: 'core://agent',
          boot_role: 'agent',
          detail: 'blocked by boot protection',
        }).length,
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
        warnings: ['policy warning'],
        policy_warnings: ['policy warning'],
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
          warnings: ['policy warning'],
          policy_warnings: ['policy warning'],
        },
      },
      {
        type: 'policy_warning_emitted',
        payload: {
          turn: 1,
          tool: 'update_node',
          warnings: ['policy warning'],
          policy_warnings: ['policy warning'],
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
          warnings: ['policy warning'],
          policy_warnings: ['policy warning'],
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
        result_size_chars: JSON.stringify({ ok: true }).length,
      },
    ]);
  });

});

describe('loadGuidanceFile', () => {
  it('loads guidance from server settings and remaps tool names to English placeholders', async () => {
    mockGetSettings.mockResolvedValueOnce({
      'lifecycle.guidance.enabled': true,
      'lifecycle.guidance.global': '# MCP Guidance\nlore_boot\nlore_guidance\nlore_get_node is useful',
      'lifecycle.boot.preamble': '',
      'lifecycle.startup_recall.preamble': '',
      'lifecycle.prompt_recall.preamble': '',
    });
    const prompt = await loadGuidanceFile();
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
  it('establishes memory digestion identity and priorities', () => {
    const prompt = buildDreamSystemPrompt(makeInitialContext());
    expect(prompt).toContain('你是 Lore 的夜间记忆消化系统');
    expect(prompt).toContain('Lore 是一棵会自我生长的语义记忆树');
    expect(prompt).toContain('概念更清晰、密度更高、边界更准');
    expect(prompt).toContain('第二目标是从今日用户内容中抽取值得长期保存的记忆');
    expect(prompt).toContain('第三目标是根据 recall metadata 发现 glossary / disclosure / view / priority 问题');
    expect(prompt).toContain('Agent boot body');
    expect(prompt).toContain('Soul boot body');
    expect(prompt).toContain('User boot body');
    expect(prompt).toContain('启动基线');
    expect(prompt).toContain('记忆写入规则');
  });

  it('provides structured decision framework for interventions', () => {
    const prompt = buildDreamSystemPrompt(makeInitialContext());
    expect(prompt).toContain('先看树，再考虑写');
    expect(prompt).toContain('写入是一种消化');
    expect(prompt).toContain('现有节点是优先滋养的概念容器');
    expect(prompt).toContain('新节点代表新的长期概念');
    expect(prompt).toContain('path 是概念在树中的位置');
    expect(prompt).toContain('父节点是抽象，不是目录');
    expect(prompt).toContain('日期描述事件发生时间');
    expect(prompt).toContain('树结构');
    expect(prompt).toContain('过长拆分');
    expect(prompt).toContain('三条以上相似记忆提炼');
    expect(prompt).toContain('disclosure / glossary');
    expect(prompt).toContain('受保护的启动基线节点');
    expect(prompt).toContain('当前数据');
  });

  it('filters out non-actionable changes with explicit guardrails', () => {
    const prompt = buildDreamSystemPrompt(makeInitialContext());
    expect(prompt).toContain('一次性操作请求当成短暂水流');
    expect(prompt).toContain('明确项目状态、偏好、架构决策、长期约束当成能滋养记忆树的养分');
    expect(prompt).toContain('能归入已有项目节点就更新已有节点');
    expect(prompt).toContain('新的长期概念出现时');
    expect(prompt).toContain('只总结 query_text 暴露出来的长期信息');
  });

  it('requires structured audit diary', () => {
    const prompt = buildDreamSystemPrompt(makeInitialContext());
    expect(prompt).toContain('primary_focus');
    expect(prompt).toContain('why_not_more_changes');
    expect(prompt).toContain('诗性日记只消费这个 audit');
  });

  it('uses today recall metadata as primary recall evidence', () => {
    const prompt = buildDreamSystemPrompt(makeInitialContext({
      recallReview: {
        date: '2026-05-07',
        summary: { returned_queries: 1, total_merged: 3, total_shown: 2, total_used: 1, truncated: false },
        queries: [{ query_id: 'q-1', content: 'long query text', merged_count: 3, shown_count: 2, used_count: 1, client_type: 'codex', session_id: 's1', created_at: '2026-05-07T00:00:00.000Z' }],
      } as any,
    }));
    expect(prompt).toContain('long query text');
    expect(prompt).toContain('今日 recall metadata');
    expect(prompt).not.toContain('近期查询概况');
    expect(prompt).not.toContain('待审查询');
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
        summary: { returned_queries: 1, total_merged: 6, total_shown: 1, total_used: 0 },
        queries: [{ query_id: 'q-1', content: 'why did boot not recall', merged_count: 6, shown_count: 1, used_count: 0 }],
      } as any,
    }));
    expect(prompt).toContain('why did boot not recall');
    expect(prompt).toContain('从今日 100 条 metadata 里挑可疑 query');
    expect(prompt).toContain('用 get_query_recall_detail 看 shown nodes');
    expect(prompt).toContain('用 get_query_candidates 看候选');
    expect(prompt).toContain('用 inspect_memory_node_for_dream 看相关节点');
    expect(prompt).toContain('glossary 缺词');
    expect(prompt).toContain('view 内容弱');
    expect(prompt).toContain('query 不值得处理');
    expect(prompt).toContain('只有证据足够才改');
    expect(prompt).not.toContain('high_merge_low_use');
    expect(prompt).not.toContain('zero_use');
  });

  it('uses Chinese throughout the prompt with action-first mindset', () => {
    const prompt = buildDreamSystemPrompt(makeInitialContext());
    expect(prompt).toContain('阶段流程');
    expect(prompt).toContain('结构化诊断');
    expect(prompt).toContain('记忆树消化');
    expect(prompt).not.toContain('Dream 的宪法层');
    expect(prompt).not.toContain('Lore guidance 与这三个固定节点一起构成 Dream 的 baseline calibration');
  });

  it('mentions fixed boot protection and ordered change priorities', () => {
    const prompt = buildDreamSystemPrompt(makeInitialContext());
    expect(prompt).toContain('受保护的启动基线节点');
    expect(prompt).toContain('只读参考，不可修改');
    expect(prompt).toContain('先滋养已有概念，再提炼 / 合并');
    expect(prompt).toContain('出现新的长期概念时 create_node');
  });
});

describe('rewriteDreamNarrative', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses a clean context with only the style prompt and raw diary content', async () => {
    mockGenerateText.mockResolvedValueOnce({ content: 'Poetic diary', raw: {} });
    const config: LlmConfig = {
      provider: 'anthropic',
      base_url: 'http://localhost:1234',
      api_key: 'test-key',
      model: 'claude-sonnet-4-6',
      timeout_ms: 5000,
      temperature: 0.3,
      api_version: '2023-06-01',
    };

    const result = await rewriteDreamNarrative(config, 'Raw audit diary');

    expect(result).toBe('Poetic diary');
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    const [, messages] = mockGenerateText.mock.calls[0];
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      role: 'system',
      content: expect.stringContaining('You are keeping a dream diary'),
    });
    expect(String(messages[0].content)).toContain('Write the diary in Simplified Chinese');
    expect(messages[1]).toEqual({
      role: 'user',
      content: 'Raw diary:\nRaw audit diary',
    });
  });
});

describe('runDreamAgentLoop', () => {
  function config(provider: LlmConfig['provider'] = 'openai_compatible'): LlmConfig {
    return {
      provider,
      base_url: provider === 'anthropic' ? 'http://localhost:1234' : 'http://localhost:1234/v1',
      api_key: 'test-key',
      model: provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o-mini',
      timeout_ms: 5000,
      temperature: 0.3,
      api_version: provider === 'anthropic' ? '2023-06-01' : '',
    };
  }

  it('runs hard phases and returns structured audit JSON as raw narrative', async () => {
    mockGenerateTextWithTools
      .mockResolvedValueOnce(makeTextResponse('{"diagnosis":"tree checked"}'))
      .mockResolvedValueOnce(makeTextResponse('{"tree_maintenance_candidates":[],"daily_memory_extraction_candidates":[],"recall_repair_candidates":[],"skip_reasons":["no evidence"]}'))
      .mockResolvedValueOnce(makeTextResponse('{"preflight":"none"}'))
      .mockResolvedValueOnce(makeTextResponse('{"applied":[]}'))
      .mockResolvedValueOnce(makeTextResponse('{"primary_focus":"no_change","changed_nodes":[],"evidence":[],"why_not_more_changes":"no strong evidence","expected_effect":"none","confidence":"high"}'));

    const events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    const result = await runDreamAgentLoop(config(), makeInitialContext(), {
      onEvent: async (type, payload) => events.push({ type, payload }),
      eventContext: { source: 'dream:auto', session_id: 'dream:99' },
    });

    expect(mockGenerateTextWithTools).toHaveBeenCalledTimes(5);
    const firstCallTools = mockGenerateTextWithTools.mock.calls[0][2].map((tool) => tool.name);
    expect(firstCallTools).toContain('inspect_tree');
    expect(firstCallTools).not.toContain('create_node');
    const applyCallTools = mockGenerateTextWithTools.mock.calls[3][2].map((tool) => tool.name);
    expect(applyCallTools).toContain('update_node');
    expect(result.narrative).toContain('"primary_focus": "no_change"');
    expect(result.turns).toBe(5);
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining([
      'phase_started',
      'phase_completed',
      'assistant_note',
    ]));
    expect(events.find((event) => event.type === 'phase_started' && event.payload?.phase === 'diagnose')).toBeTruthy();
    expect(events.find((event) => event.type === 'phase_completed' && event.payload?.phase === 'audit')).toBeTruthy();
  });

  it('does not report no_change when the apply phase already wrote memory but audit prose is not JSON', async () => {
    mockGenerateTextWithTools.mockReset();
    mockGenerateTextWithTools
      .mockResolvedValueOnce(makeTextResponse('{"diagnosis":"extract recall truncation decision"}'))
      .mockResolvedValueOnce(makeTextResponse('{"tree_maintenance_candidates":[],"daily_memory_extraction_candidates":[{"action":"create_node","uri":"project://lore_integration/recall_system/recall_query_text_truncation_strategy"}],"recall_repair_candidates":[],"skip_reasons":[]}'))
      .mockResolvedValueOnce(makeTextResponse('{"validated":["project://lore_integration/recall_system/recall_query_text_truncation_strategy"]}'))
      .mockResolvedValueOnce(makeToolResponse([
        { id: 'call-1', function: { name: 'create_node', arguments: '{"uri":"project://lore_integration/recall_system/recall_query_text_truncation_strategy","content":"decision","priority":2}' } },
      ]))
      .mockResolvedValueOnce(makeTextResponse('{"applied":["project://lore_integration/recall_system/recall_query_text_truncation_strategy"]}'))
      .mockResolvedValueOnce(makeTextResponse('Phase 6 audit complete. Single high-confidence write executed — `recall_query_text_truncation_strategy` created under `recall_system`.'));
    mockCreateNode.mockResolvedValue({
      success: true,
      operation: 'create',
      uri: 'project://lore_integration/recall_system/recall_query_text_truncation_strategy',
      path: 'lore_integration/recall_system/recall_query_text_truncation_strategy',
      node_uuid: 'new1',
    } as any);

    const result = await runDreamAgentLoop(config(), makeInitialContext());
    const audit = JSON.parse(result.narrative);

    expect(audit.primary_focus).not.toBe('no_change');
    expect(audit.changed_nodes).toEqual([
      {
        uri: 'project://lore_integration/recall_system/recall_query_text_truncation_strategy',
        action: 'create',
        result: 'success',
      },
    ]);
    expect(audit.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: expect.stringContaining('create_node succeeded') }),
    ]));
  });

  it('executes tools inside the phase that allows them', async () => {
    mockGenerateTextWithTools
      .mockResolvedValueOnce(makeToolResponse([{ id: 'call-1', function: { name: 'list_domains', arguments: '{}' } }]))
      .mockResolvedValueOnce(makeTextResponse('{"diagnosis":"done"}'))
      .mockResolvedValueOnce(makeTextResponse('{"tree_maintenance_candidates":[],"daily_memory_extraction_candidates":[],"recall_repair_candidates":[],"skip_reasons":[]}'))
      .mockResolvedValueOnce(makeTextResponse('{"preflight":"none"}'))
      .mockResolvedValueOnce(makeTextResponse('{"applied":[]}'))
      .mockResolvedValueOnce(makeTextResponse('{"primary_focus":"no_change","changed_nodes":[],"evidence":[],"why_not_more_changes":"","expected_effect":"","confidence":"medium"}'));

    mockListDomains.mockResolvedValue(['core'] as any);
    const events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    const result = await runDreamAgentLoop(config('anthropic'), makeInitialContext(), {
      onEvent: async (type, payload) => events.push({ type, payload }),
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({ tool: 'list_domains', result_size_chars: expect.any(Number) });
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(['tool_call_started', 'tool_call_finished']));
  });

  it('replays provider assistant content after tool calls', async () => {
    mockGenerateTextWithTools.mockReset();
    const assistantContent = [
      { type: 'reasoning', text: 'deepseek thinking', providerOptions: { anthropic: { signature: 'sig-1' } } },
      { type: 'text', text: 'calling list domains' },
    ];
    mockGenerateTextWithTools
      .mockResolvedValueOnce({
        content: null,
        assistant_content: assistantContent,
        tool_calls: [{ id: 'call-1', function: { name: 'list_domains', arguments: '{}' } }],
        raw: {},
      })
      .mockResolvedValueOnce(makeTextResponse('{"diagnosis":"done"}'))
      .mockResolvedValueOnce(makeTextResponse('{"tree_maintenance_candidates":[],"daily_memory_extraction_candidates":[],"recall_repair_candidates":[],"skip_reasons":[]}'))
      .mockResolvedValueOnce(makeTextResponse('{"preflight":"none"}'))
      .mockResolvedValueOnce(makeTextResponse('{"applied":[]}'))
      .mockResolvedValueOnce(makeTextResponse('{"primary_focus":"no_change","changed_nodes":[],"evidence":[],"why_not_more_changes":"","expected_effect":"","confidence":"medium"}'));

    mockListDomains.mockResolvedValue(['core'] as any);
    await runDreamAgentLoop(config('anthropic'), makeInitialContext());

    const secondCallMessages = mockGenerateTextWithTools.mock.calls[1][1];
    expect(secondCallMessages).toContainEqual({
      role: 'assistant',
      content: assistantContent,
      tool_calls: [{ id: 'call-1', function: { name: 'list_domains', arguments: '{}' } }],
    });
  });

  it('blocks writes after two successful apply mutations', async () => {
    mockGenerateTextWithTools
      .mockResolvedValueOnce(makeTextResponse('{"diagnosis":"done"}'))
      .mockResolvedValueOnce(makeTextResponse('{"tree_maintenance_candidates":[{"action":"update_node","uri":"core://a"}],"daily_memory_extraction_candidates":[],"recall_repair_candidates":[],"skip_reasons":[]}'))
      .mockResolvedValueOnce(makeTextResponse('{"preflight":"ok"}'))
      .mockResolvedValueOnce(makeToolResponse([
        { id: 'call-1', function: { name: 'update_node', arguments: '{"uri":"core://a","content":"a"}' } },
        { id: 'call-2', function: { name: 'update_node', arguments: '{"uri":"core://b","content":"b"}' } },
        { id: 'call-3', function: { name: 'update_node', arguments: '{"uri":"core://c","content":"c"}' } },
      ]))
      .mockResolvedValueOnce(makeTextResponse('{"applied":["a","b"]}'))
      .mockResolvedValueOnce(makeTextResponse('{"primary_focus":"tree_maintenance","changed_nodes":["core://a","core://b"],"evidence":[],"why_not_more_changes":"write cap","expected_effect":"cleaner tree","confidence":"medium"}'));
    mockUpdateNodeByPath.mockResolvedValue({ success: true } as any);

    const result = await runDreamAgentLoop(config(), makeInitialContext());

    expect(mockUpdateNodeByPath).toHaveBeenCalledTimes(2);
    expect(result.toolCalls).toHaveLength(3);
    expect(result.toolCalls[2].result_preview).toContain('dream_write_cap');
  });
});
