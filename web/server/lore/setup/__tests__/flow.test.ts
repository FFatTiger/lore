import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/settings', () => ({
  getSettings: vi.fn(),
}));
vi.mock('../../memory/boot', () => ({
  bootView: vi.fn(),
}));
vi.mock('../../llm/config', () => ({
  resolveViewLlmConfig: vi.fn(),
}));

import { getSettings } from '../../config/settings';
import { bootView } from '../../memory/boot';
import { resolveViewLlmConfig } from '../../llm/config';
import { buildSetupFlowStatus, getSetupFlowStatus } from '../flow';

const mockGetSettings = vi.mocked(getSettings);
const mockBootView = vi.mocked(bootView);
const mockResolveViewLlmConfig = vi.mocked(resolveViewLlmConfig);

const BASE_BOOT_VIEW = {
  loaded: 5,
  total: 5,
  failed: [],
  core_memories: [],
  recent_memories: [],
  nodes: [
    {
      id: 'agent',
      uri: 'core://agent',
      role: 'agent' as const,
      role_label: 'workflow constraints',
      purpose: 'Working rules, collaboration constraints, and execution protocol.',
      dream_protection: 'protected' as const,
      scope: 'global' as const,
      client_type: null,
      setup_slug: 'agent',
      setup_title: 'Agent boot memory',
      setup_description: 'Write the fixed workflow-constraints node that every Lore agent loads at startup.',
      state: 'initialized' as const,
      content: 'Agent memory',
      content_length: 12,
      priority: 0,
      disclosure: null,
      node_uuid: 'agent-uuid',
    },
    {
      id: 'soul',
      uri: 'core://soul',
      role: 'soul' as const,
      role_label: 'style / persona / self-definition',
      purpose: 'Agent style, persona, and self-cognition baseline.',
      dream_protection: 'protected' as const,
      scope: 'global' as const,
      client_type: null,
      setup_slug: 'soul',
      setup_title: 'Soul boot memory',
      setup_description: 'Write the fixed persona baseline that Lore carries into every session.',
      state: 'empty' as const,
      content: '',
      content_length: 0,
      priority: 0,
      disclosure: null,
      node_uuid: 'soul-uuid',
    },
    {
      id: 'user',
      uri: 'preferences://user',
      role: 'user' as const,
      role_label: 'stable user definition',
      purpose: 'Stable user information, user preferences, and durable collaboration context.',
      dream_protection: 'protected' as const,
      scope: 'global' as const,
      client_type: null,
      setup_slug: 'user',
      setup_title: 'User boot memory',
      setup_description: 'Write the stable user profile Lore should remember across future sessions.',
      state: 'missing' as const,
      content: '',
      content_length: 0,
      priority: null,
      disclosure: null,
      node_uuid: null,
    },
    {
      id: 'agent-openclaw',
      uri: 'core://agent/openclaw',
      role: 'agent' as const,
      role_label: 'openclaw runtime constraints',
      purpose: 'OpenClaw-specific tools, plugin behavior, and runtime workflow constraints.',
      dream_protection: 'protected' as const,
      scope: 'client' as const,
      client_type: 'openclaw' as const,
      setup_slug: 'agent-openclaw',
      setup_title: 'OpenClaw boot memory',
      setup_description: 'Write the OpenClaw-specific agent rules that load together with core://agent.',
      state: 'initialized' as const,
      content: 'OpenClaw memory',
      content_length: 15,
      priority: 1,
      disclosure: null,
      node_uuid: 'openclaw-uuid',
    },
    {
      id: 'agent-codex',
      uri: 'core://agent/codex',
      role: 'agent' as const,
      role_label: 'codex runtime constraints',
      purpose: 'Codex-specific plugins, hooks, MCP behavior, and runtime workflow constraints.',
      dream_protection: 'protected' as const,
      scope: 'client' as const,
      client_type: 'codex' as const,
      setup_slug: 'agent-codex',
      setup_title: 'Codex boot memory',
      setup_description: 'Write the Codex-specific agent rules that load together with core://agent.',
      state: 'initialized' as const,
      content: 'Codex memory',
      content_length: 12,
      priority: 1,
      disclosure: null,
      node_uuid: 'codex-uuid',
    },
  ],
  overall_state: 'partial' as const,
  remaining_count: 2,
  draft_generation_available: false,
  draft_generation_reason: 'View LLM API key is not configured.',
  selected_client_type: 'admin' as const,
  includes_all_clients: true,
};

describe('buildSetupFlowStatus', () => {
  it('marks steps complete in order and picks the first incomplete step', () => {
    const result = buildSetupFlowStatus({
      embedding: { configured: true, runtime_ready: true },
      llm: { configured: false, runtime_ready: false },
      boot: BASE_BOOT_VIEW,
    });

    expect(result.complete).toBe(false);
    expect(result.next_step).toBe('/setup/llm');
    expect(result.steps).toEqual([
      { id: 'embedding', path: '/setup/embedding', label: 'Embedding setup', complete: true },
      { id: 'llm', path: '/setup/llm', label: 'View LLM setup', complete: false },
      { id: 'boot:agent', path: '/setup/boot/agent', label: 'Agent boot memory', description: 'Write the fixed workflow-constraints node that every Lore agent loads at startup.', complete: true, role: 'agent', uri: 'core://agent', scope: 'global', client_type: null, setup_slug: 'agent' },
      { id: 'boot:soul', path: '/setup/boot/soul', label: 'Soul boot memory', description: 'Write the fixed persona baseline that Lore carries into every session.', complete: false, role: 'soul', uri: 'core://soul', scope: 'global', client_type: null, setup_slug: 'soul' },
      { id: 'boot:user', path: '/setup/boot/user', label: 'User boot memory', description: 'Write the stable user profile Lore should remember across future sessions.', complete: false, role: 'user', uri: 'preferences://user', scope: 'global', client_type: null, setup_slug: 'user' },
      { id: 'boot:agent-openclaw', path: '/setup/boot/agent-openclaw', label: 'OpenClaw boot memory', description: 'Write the OpenClaw-specific agent rules that load together with core://agent.', complete: true, role: 'agent', uri: 'core://agent/openclaw', scope: 'client', client_type: 'openclaw', setup_slug: 'agent-openclaw' },
      { id: 'boot:agent-codex', path: '/setup/boot/agent-codex', label: 'Codex boot memory', description: 'Write the Codex-specific agent rules that load together with core://agent.', complete: true, role: 'agent', uri: 'core://agent/codex', scope: 'client', client_type: 'codex', setup_slug: 'agent-codex' },
    ]);
  });

  it('marks setup complete when all steps are complete', () => {
    const result = buildSetupFlowStatus({
      embedding: { configured: true, runtime_ready: true },
      llm: { configured: true, runtime_ready: true },
      boot: {
        ...BASE_BOOT_VIEW,
        nodes: BASE_BOOT_VIEW.nodes.map((node) => ({ ...node, state: 'initialized' as const })),
        overall_state: 'complete',
        remaining_count: 0,
        draft_generation_available: true,
        draft_generation_reason: null,
      },
    });

    expect(result.complete).toBe(true);
    expect(result.next_step).toBeNull();
    expect(result.steps.every((step) => step.complete)).toBe(true);
  });
});

describe('getSetupFlowStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockResolvedValue({
      'embedding.base_url': 'http://embed:8080',
      'embedding.api_key': 'embed-key',
      'embedding.model': 'embed-model',
      'view_llm.base_url': 'http://llm:8080',
      'view_llm.api_key': 'llm-key',
      'view_llm.model': 'view-model',
    });
    mockBootView.mockResolvedValue(BASE_BOOT_VIEW as any);
    mockResolveViewLlmConfig.mockResolvedValue(null);
  });

  it('treats embedding as runtime-ready once settings are complete', async () => {
    const result = await getSetupFlowStatus();

    expect(result.embedding).toEqual({ configured: true, runtime_ready: true });
    expect(result.llm).toEqual({ configured: true, runtime_ready: false });
    expect(result.next_step).toBe('/setup/boot/soul');
    expect(mockBootView).toHaveBeenCalledWith({ client_type: 'admin' });
  });

  it('marks llm runtime ready when resolveViewLlmConfig succeeds', async () => {
    mockResolveViewLlmConfig.mockResolvedValue({
      provider: 'openai_compatible',
      base_url: 'http://llm:8080',
      api_key: 'key',
      model: 'view-model',
      timeout_ms: 5000,
      temperature: 0.2,
      api_version: '',
    });

    const result = await getSetupFlowStatus();

    expect(result.llm).toEqual({ configured: true, runtime_ready: true });
  });

  it('treats embedding and llm as incomplete when required settings fields are missing', async () => {
    mockGetSettings.mockResolvedValue({
      'embedding.base_url': 'http://embed:8080',
      'embedding.api_key': '',
      'embedding.model': 'embed-model',
      'view_llm.base_url': 'http://llm:8080',
      'view_llm.api_key': '',
      'view_llm.model': 'view-model',
    });

    const result = await getSetupFlowStatus();

    expect(result.embedding).toEqual({ configured: false, runtime_ready: false });
    expect(result.llm).toEqual({ configured: false, runtime_ready: false });
    expect(result.next_step).toBe('/setup/embedding');
  });
});
