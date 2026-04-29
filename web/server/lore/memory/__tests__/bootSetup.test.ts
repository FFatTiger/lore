import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db', () => ({ sql: vi.fn() }));
vi.mock('../write', () => ({
  createNode: vi.fn(),
  updateNodeByPath: vi.fn(),
}));
vi.mock('../../llm/config', () => ({
  resolveViewLlmConfig: vi.fn(),
}));
vi.mock('../../llm/provider', () => ({
  generateText: vi.fn(),
}));

import { sql } from '../../../db';
import { createNode, updateNodeByPath } from '../write';
import { resolveViewLlmConfig } from '../../llm/config';
import { generateText } from '../../llm/provider';
import { generateBootDrafts, saveBootNodes } from '../bootSetup';

const mockSql = vi.mocked(sql);
const mockCreateNode = vi.mocked(createNode);
const mockUpdateNodeByPath = vi.mocked(updateNodeByPath);
const mockResolveViewLlmConfig = vi.mocked(resolveViewLlmConfig);
const mockGenerateText = vi.mocked(generateText);

const DEFAULT_VIEW_LLM_CONFIG = {
  provider: 'openai_compatible' as const,
  base_url: 'http://llm:8080',
  api_key: 'test-key',
  model: 'glm-5.1',
  timeout_ms: 5000,
  temperature: 0.2,
  api_version: '',
};

describe('saveBootNodes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a missing fixed boot node', async () => {
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    mockCreateNode.mockResolvedValueOnce({
      success: true,
      uri: 'core://agent',
      path: 'agent',
      node_uuid: 'new-agent-uuid',
    });

    const result = await saveBootNodes({
      nodes: { 'core://agent': 'Agent rules' },
    });

    expect(mockCreateNode).toHaveBeenCalledWith(
      {
        domain: 'core',
        parentPath: '',
        title: 'agent',
        content: 'Agent rules',
      },
      {},
    );
    expect(result).toEqual({
      results: [
        {
          uri: 'core://agent',
          status: 'created',
          node_uuid: 'new-agent-uuid',
          detail: null,
        },
      ],
    });
  });

  it('creates a nested client-specific boot node under the correct parent path', async () => {
    mockSql.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    mockCreateNode.mockResolvedValueOnce({
      success: true,
      uri: 'core://agent/openclaw',
      path: 'agent/openclaw',
      node_uuid: 'new-openclaw-uuid',
    });

    const result = await saveBootNodes({
      nodes: { 'core://agent/openclaw': 'OpenClaw rules' },
    });

    expect(mockCreateNode).toHaveBeenCalledWith(
      {
        domain: 'core',
        parentPath: 'agent',
        title: 'openclaw',
        content: 'OpenClaw rules',
      },
      {},
    );
    expect(result.results[0]).toMatchObject({
      uri: 'core://agent/openclaw',
      status: 'created',
      node_uuid: 'new-openclaw-uuid',
    });
  });

  it('updates an existing fixed boot node when content changes', async () => {
    mockSql.mockResolvedValueOnce({
      rows: [{ node_uuid: 'agent-uuid', priority: 0, disclosure: null, content: 'Old rules' }],
      rowCount: 1,
    } as any);
    mockUpdateNodeByPath.mockResolvedValueOnce({ success: true, node_uuid: 'agent-uuid' });

    const result = await saveBootNodes({
      nodes: { 'core://agent': 'New rules' },
    });

    expect(mockUpdateNodeByPath).toHaveBeenCalledWith(
      {
        domain: 'core',
        path: 'agent',
        content: 'New rules',
      },
      {},
    );
    expect(result.results[0]).toEqual({
      uri: 'core://agent',
      status: 'updated',
      node_uuid: 'agent-uuid',
      detail: null,
    });
  });

  it('returns unchanged when content matches the existing node', async () => {
    mockSql.mockResolvedValueOnce({
      rows: [{ node_uuid: 'agent-uuid', priority: 0, disclosure: null, content: 'Agent rules' }],
      rowCount: 1,
    } as any);

    const result = await saveBootNodes({
      nodes: { 'core://agent': 'Agent rules' },
    });

    expect(mockCreateNode).not.toHaveBeenCalled();
    expect(mockUpdateNodeByPath).not.toHaveBeenCalled();
    expect(result.results[0]).toEqual({
      uri: 'core://agent',
      status: 'unchanged',
      node_uuid: 'agent-uuid',
      detail: null,
    });
  });

  it('rejects unsupported URIs before writing', async () => {
    await expect(saveBootNodes({
      nodes: { 'project://alpha': 'bad' },
    })).rejects.toMatchObject({
      message: 'Unsupported boot URI: project://alpha',
      status: 422,
    });

    expect(mockCreateNode).not.toHaveBeenCalled();
    expect(mockUpdateNodeByPath).not.toHaveBeenCalled();
  });

  it('keeps processing other boot nodes after a single failure', async () => {
    mockSql
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    mockCreateNode
      .mockRejectedValueOnce(new Error('create failed'))
      .mockResolvedValueOnce({
        success: true,
        uri: 'core://soul',
        path: 'soul',
        node_uuid: 'new-soul-uuid',
      });

    const result = await saveBootNodes({
      nodes: {
        'core://agent': 'Agent rules',
        'core://soul': 'Soul baseline',
      },
    });

    expect(result).toEqual({
      results: [
        {
          uri: 'core://agent',
          status: 'failed',
          node_uuid: null,
          detail: 'create failed',
        },
        {
          uri: 'core://soul',
          status: 'created',
          node_uuid: 'new-soul-uuid',
          detail: null,
        },
      ],
    });
  });
});

describe('generateBootDrafts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveViewLlmConfig.mockResolvedValue(DEFAULT_VIEW_LLM_CONFIG);
  });

  it('rejects when View LLM is unavailable', async () => {
    mockResolveViewLlmConfig.mockResolvedValueOnce(null);

    await expect(generateBootDrafts({ uris: ['core://agent'] })).rejects.toMatchObject({
      message: 'View LLM draft generation is unavailable. Configure View LLM in /settings first.',
      status: 409,
    });
  });

  it('generates a draft for a requested fixed boot node', async () => {
    mockGenerateText.mockResolvedValueOnce({
      content: '{"uri":"core://agent","content":"你会直接执行，不绕弯。"}',
      raw: {},
    });

    const result = await generateBootDrafts({
      uris: ['core://agent'],
      shared_context: '这是一个偏工程执行的实例。',
      node_context: { 'core://agent': '强调执行边界。' },
    });

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    expect(mockGenerateText.mock.calls[0]?.[1]).toEqual([
      expect.objectContaining({ role: 'system' }),
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining('"uri": "core://agent"'),
      }),
    ]);
    expect(mockGenerateText.mock.calls[0]?.[1]?.[1]?.content).toContain('这是一个偏工程执行的实例。');
    expect(mockGenerateText.mock.calls[0]?.[1]?.[1]?.content).toContain('强调执行边界。');
    expect(result).toEqual({
      model: 'glm-5.1',
      results: [
        {
          uri: 'core://agent',
          status: 'generated',
          content: '你会直接执行，不绕弯。',
          detail: null,
        },
      ],
    });
  });

  it('includes client-specific draft instructions for runtime-specific agent nodes', async () => {
    mockGenerateText.mockResolvedValueOnce({
      content: '{"uri":"core://agent/openclaw","content":"使用 OpenClaw 特有的运行时规则。"}',
      raw: {},
    });

    await generateBootDrafts({
      uris: ['core://agent/openclaw'],
    });

    const systemPrompt = String(mockGenerateText.mock.calls[0]?.[1]?.[0]?.content || '');
    const userPrompt = String(mockGenerateText.mock.calls[0]?.[1]?.[1]?.content || '');
    expect(systemPrompt).toContain('This boot node is specific to the openclaw runtime.');
    expect(systemPrompt).toContain('OpenClaw-specific runtime defaults');
    expect(userPrompt).toContain('"uri": "core://agent/openclaw"');
    expect(userPrompt).toContain('"client_type": "openclaw"');
  });

  it('includes Codex-specific draft instructions for runtime-specific agent nodes', async () => {
    mockGenerateText.mockResolvedValueOnce({
      content: '{"uri":"core://agent/codex","content":"使用 Codex 特有的运行时规则。"}',
      raw: {},
    });

    await generateBootDrafts({
      uris: ['core://agent/codex'],
    });

    const systemPrompt = String(mockGenerateText.mock.calls[0]?.[1]?.[0]?.content || '');
    const userPrompt = String(mockGenerateText.mock.calls[0]?.[1]?.[1]?.content || '');
    expect(systemPrompt).toContain('This boot node is specific to the codex runtime.');
    expect(systemPrompt).toContain('Codex-specific runtime defaults');
    expect(userPrompt).toContain('"uri": "core://agent/codex"');
    expect(userPrompt).toContain('"client_type": "codex"');
  });

  it('includes Pi-specific draft instructions for runtime-specific agent nodes', async () => {
    mockGenerateText.mockResolvedValueOnce({
      content: '{"uri":"core://agent/pi","content":"使用 Pi 特有的扩展和 prompt 注入规则。"}',
      raw: {},
    });

    await generateBootDrafts({
      uris: ['core://agent/pi'],
    });

    const systemPrompt = String(mockGenerateText.mock.calls[0]?.[1]?.[0]?.content || '');
    const userPrompt = String(mockGenerateText.mock.calls[0]?.[1]?.[1]?.content || '');
    expect(systemPrompt).toContain('This boot node is specific to the pi runtime.');
    expect(systemPrompt).toContain('Pi-specific runtime defaults');
    expect(userPrompt).toContain('"uri": "core://agent/pi"');
    expect(userPrompt).toContain('"client_type": "pi"');
  });

  it('returns per-node failures without aborting the whole batch', async () => {
    mockGenerateText
      .mockResolvedValueOnce({ content: 'not json', raw: {} })
      .mockResolvedValueOnce({ content: '{"uri":"core://soul","content":"语气克制，表达清楚。"}', raw: {} });

    const result = await generateBootDrafts({
      uris: ['core://agent', 'core://soul'],
    });

    expect(result).toEqual({
      model: 'glm-5.1',
      results: [
        {
          uri: 'core://agent',
          status: 'failed',
          content: null,
          detail: 'Draft response did not include content.',
        },
        {
          uri: 'core://soul',
          status: 'generated',
          content: '语气克制，表达清楚。',
          detail: null,
        },
      ],
    });
  });

  it('rejects invalid boot URIs in the request', async () => {
    await expect(generateBootDrafts({ uris: ['project://alpha'] })).rejects.toMatchObject({
      message: 'Unsupported boot URI: project://alpha',
      status: 422,
    });
  });
});
