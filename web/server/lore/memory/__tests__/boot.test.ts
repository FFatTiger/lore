import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db', () => ({ sql: vi.fn() }));
vi.mock('../../config/settings', () => ({ getSettings: vi.fn() }));
vi.mock('../../llm/config', () => ({ resolveViewLlmConfig: vi.fn() }));

import { sql } from '../../../db';
import { getSettings } from '../../config/settings';
import { resolveViewLlmConfig } from '../../llm/config';
import { bootView, getBootNodeSpec, getBootUris, getRuntimeBootUris, isBootUri } from '../boot';

const mockSql = vi.mocked(sql);
const mockGetSettings = vi.mocked(getSettings);
const mockResolveViewLlmConfig = vi.mocked(resolveViewLlmConfig);

const DEFAULT_VIEW_LLM_CONFIG = {
  provider: 'openai_compatible' as const,
  base_url: 'http://llm:8080',
  api_key: 'test-key',
  model: 'glm-5.1',
  timeout_ms: 5000,
  temperature: 0.2,
  api_version: '',
};

describe('boot helpers', () => {
  it('exposes fixed boot URIs in deterministic order', () => {
    expect(getBootUris()).toEqual([
      'core://agent',
      'core://soul',
      'preferences://user',
      'core://agent/claudecode',
      'core://agent/openclaw',
      'core://agent/hermes',
      'core://agent/codex',
    ]);
    expect(getRuntimeBootUris('codex')).toEqual([
      'core://agent',
      'core://soul',
      'preferences://user',
      'core://agent/codex',
    ]);
  });

  it('returns metadata for boot node lookups', () => {
    expect(getBootNodeSpec('CORE://SOUL')).toMatchObject({
      uri: 'core://soul',
      role: 'soul',
      role_label: 'style / persona / self-definition',
      dream_protection: 'protected',
    });
    expect(isBootUri('preferences://user')).toBe(true);
    expect(isBootUri('project://user')).toBe(false);
  });
});

describe('bootView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CORE_MEMORY_URIS;
    mockResolveViewLlmConfig.mockResolvedValue(DEFAULT_VIEW_LLM_CONFIG);
    mockGetSettings.mockResolvedValue({
      'view_llm.base_url': 'http://llm:8080',
      'view_llm.api_key': 'test-key',
      'view_llm.model': 'glm-5.1',
    });
  });

  it('returns object with core_memories, recent_memories, nodes, and draft status', async () => {
    mockSql
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'uuid-agent', priority: 5, disclosure: null, content: 'Agent rules' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'uuid-soul', priority: 1, disclosure: 'always', content: 'Soul baseline' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'uuid-user', priority: 2, disclosure: null, content: 'User profile' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const result = await bootView();
    expect(result).toHaveProperty('core_memories');
    expect(result).toHaveProperty('recent_memories');
    expect(result).toHaveProperty('nodes');
    expect(Array.isArray(result.core_memories)).toBe(true);
    expect(Array.isArray(result.recent_memories)).toBe(true);
    expect(Array.isArray(result.nodes)).toBe(true);
    expect(result.total).toBe(3);
    expect(result.loaded).toBe(3);
    expect(result.core_memories).toHaveLength(3);
    expect(result.nodes).toHaveLength(3);
    expect(result.overall_state).toBe('complete');
    expect(result.remaining_count).toBe(0);
    expect(result.draft_generation_available).toBe(true);
    expect(result.draft_generation_reason).toBeNull();
  });

  it('always uses the fixed boot manifest instead of CORE_MEMORY_URIS', async () => {
    process.env.CORE_MEMORY_URIS = 'core://env/node';
    mockSql
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'agent-uuid', priority: 0, disclosure: null, content: 'Agent content' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'soul-uuid', priority: 1, disclosure: null, content: 'Soul content' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'user-uuid', priority: 2, disclosure: null, content: 'User content' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const result = await bootView();
    expect(result.total).toBe(3);
    expect(result.core_memories.map((memory) => memory.uri)).toEqual(['core://agent', 'core://soul', 'preferences://user']);
  });

  it('reports missing fixed boot nodes and keeps total at manifest size', async () => {
    mockSql
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'soul-uuid', priority: 1, disclosure: null, content: 'Soul content' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const result = await bootView();
    expect(result.total).toBe(3);
    expect(result.loaded).toBe(1);
    expect(result.failed).toEqual([
      '- core://agent: not found',
      '- preferences://user: not found',
    ]);
    expect(result.overall_state).toBe('partial');
    expect(result.remaining_count).toBe(2);
  });

  it('classifies missing, empty, and initialized boot nodes', async () => {
    mockSql
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'soul-uuid', priority: 1, disclosure: null, content: '   ' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'user-uuid', priority: 2, disclosure: null, content: 'Stable user info' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const result = await bootView();
    expect(result.nodes).toEqual([
      expect.objectContaining({ uri: 'core://agent', state: 'missing', content_length: 0, node_uuid: null }),
      expect.objectContaining({ uri: 'core://soul', state: 'empty', content_length: 0, node_uuid: 'soul-uuid' }),
      expect.objectContaining({ uri: 'preferences://user', state: 'initialized', content_length: 'Stable user info'.length, node_uuid: 'user-uuid' }),
    ]);
    expect(result.overall_state).toBe('partial');
    expect(result.remaining_count).toBe(2);
  });

  it('returns uninitialized when nothing is actually initialized', async () => {
    mockSql
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'soul-uuid', priority: 1, disclosure: null, content: '' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'user-uuid', priority: 2, disclosure: null, content: '   ' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const result = await bootView();
    expect(result.overall_state).toBe('uninitialized');
    expect(result.remaining_count).toBe(3);
  });

  it('correctly populates core_memories fields and boot metadata', async () => {
    mockSql
      .mockResolvedValueOnce({
        rows: [{ node_uuid: 'agent-uuid', priority: 8, disclosure: 'when asked', content: 'Agent constitution' }],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({
        rows: [{ node_uuid: 'soul-uuid', priority: 3, disclosure: 'always', content: 'Soul definition' }],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({
        rows: [{ node_uuid: 'user-uuid', priority: 2, disclosure: null, content: 'Stable user info' }],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const result = await bootView();
    expect(result.core_memories[0]).toMatchObject({
      uri: 'core://agent',
      content: 'Agent constitution',
      priority: 8,
      disclosure: 'when asked',
      node_uuid: 'agent-uuid',
      boot_role: 'agent',
      boot_role_label: 'workflow constraints',
      boot_purpose: 'Working rules, collaboration constraints, and execution protocol.',
      scope: 'global',
      client_type: null,
      setup_slug: 'agent',
    });
    expect(result.core_memories[2]).toMatchObject({
      uri: 'preferences://user',
      boot_role: 'user',
      boot_role_label: 'stable user definition',
    });
  });

  it('correctly populates recent_memories fields', async () => {
    const ts = new Date('2025-06-15T12:00:00Z');
    mockSql
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({
        rows: [{ domain: 'core', path: 'recent/item', priority: 3, disclosure: null, created_at: ts }],
        rowCount: 1,
      } as any);

    const result = await bootView();
    expect(result.recent_memories[0]).toEqual({
      uri: 'core://recent/item',
      priority: 3,
      disclosure: null,
      created_at: ts.toISOString(),
    });
  });

  it('handles null created_at in recent memories', async () => {
    mockSql
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({
        rows: [{ domain: 'core', path: 'some/path', priority: 1, disclosure: null, created_at: null }],
        rowCount: 1,
      } as any);

    const result = await bootView();
    expect(result.recent_memories[0].created_at).toBeNull();
  });

  it('adds failed entries when SQL throws for a boot node', async () => {
    mockSql
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const result = await bootView();
    expect(result.failed).toContain('- core://agent: connection refused');
    expect(result.loaded).toBe(0);
    expect(result.total).toBe(3);
    expect(result.nodes[0]).toMatchObject({ uri: 'core://agent', state: 'missing' });
  });

  it('explains why draft generation is unavailable', async () => {
    mockResolveViewLlmConfig.mockResolvedValueOnce(null);
    mockGetSettings.mockResolvedValueOnce({
      'view_llm.base_url': '',
      'view_llm.api_key': '',
      'view_llm.model': 'glm-5.1',
    });
    mockSql
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const result = await bootView();
    expect(result.draft_generation_available).toBe(false);
    expect(result.draft_generation_reason).toBe('View LLM base URL is not configured.');
  });

  it('loads the client-specific agent boot node when client_type matches a runtime', async () => {
    mockSql
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'agent-uuid', priority: 0, disclosure: null, content: 'Agent rules' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'soul-uuid', priority: 1, disclosure: null, content: 'Soul baseline' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'user-uuid', priority: 2, disclosure: null, content: 'User profile' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'openclaw-uuid', priority: 1, disclosure: null, content: 'OpenClaw rules' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const result = await bootView({ client_type: 'openclaw' });

    expect(result.total).toBe(4);
    expect(result.loaded).toBe(4);
    expect(result.selected_client_type).toBe('openclaw');
    expect(result.includes_all_clients).toBe(false);
    expect(result.core_memories.map((memory) => memory.uri)).toEqual([
      'core://agent',
      'core://soul',
      'preferences://user',
      'core://agent/openclaw',
    ]);
    expect(result.nodes[3]).toMatchObject({
      uri: 'core://agent/openclaw',
      scope: 'client',
      client_type: 'openclaw',
      state: 'initialized',
    });
  });

  it('loads the Codex-specific agent boot node when client_type is codex', async () => {
    mockSql
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'agent-uuid', priority: 0, disclosure: null, content: 'Agent rules' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'soul-uuid', priority: 1, disclosure: null, content: 'Soul baseline' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'user-uuid', priority: 2, disclosure: null, content: 'User profile' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'codex-uuid', priority: 1, disclosure: null, content: 'Codex rules' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const result = await bootView({ client_type: 'codex' });

    expect(result.total).toBe(4);
    expect(result.loaded).toBe(4);
    expect(result.selected_client_type).toBe('codex');
    expect(result.includes_all_clients).toBe(false);
    expect(result.core_memories.map((memory) => memory.uri)).toEqual([
      'core://agent',
      'core://soul',
      'preferences://user',
      'core://agent/codex',
    ]);
    expect(result.nodes[3]).toMatchObject({
      uri: 'core://agent/codex',
      scope: 'client',
      client_type: 'codex',
      state: 'initialized',
    });
  });

  it('returns the full protected boot manifest for admin/setup views', async () => {
    mockSql
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'agent-uuid', priority: 0, disclosure: null, content: 'Agent rules' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'soul-uuid', priority: 1, disclosure: null, content: 'Soul baseline' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'user-uuid', priority: 2, disclosure: null, content: 'User profile' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'claudecode-uuid', priority: 1, disclosure: null, content: 'Claude rules' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'openclaw-uuid', priority: 1, disclosure: null, content: 'OpenClaw rules' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'hermes-uuid', priority: 1, disclosure: null, content: 'Hermes rules' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ node_uuid: 'codex-uuid', priority: 1, disclosure: null, content: 'Codex rules' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const result = await bootView({ client_type: 'admin' });

    expect(result.total).toBe(7);
    expect(result.loaded).toBe(7);
    expect(result.selected_client_type).toBe('admin');
    expect(result.includes_all_clients).toBe(true);
    expect(result.core_memories.map((memory) => memory.uri)).toEqual(getBootUris());
  });
});
