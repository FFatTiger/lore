import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGenerateSdkText } = vi.hoisted(() => ({
  mockGenerateSdkText: vi.fn(),
}));

vi.mock('ai', () => ({
  generateText: mockGenerateSdkText,
  jsonSchema: vi.fn((schema) => schema),
  stepCountIs: vi.fn((count) => ({ count })),
  tool: vi.fn((definition) => definition),
}));

vi.mock('../config', () => ({
  createLanguageModel: vi.fn(() => ({ provider: 'mock-model' })),
}));

import { generateText, generateTextWithTools, type ProviderMessage } from '../provider';
import type { ResolvedViewLlmConfig } from '../config';

const config: ResolvedViewLlmConfig = {
  provider: 'openai_compatible',
  base_url: 'http://localhost:1234/v1',
  api_key: 'test-key',
  model: 'test-model',
  timeout_ms: 5000,
  temperature: 0.2,
  api_version: '',
};

const messages: ProviderMessage[] = [{ role: 'user', content: 'hello' }];

describe('provider LLM retries', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('retries text generation three times before succeeding', async () => {
    mockGenerateSdkText
      .mockRejectedValueOnce(new Error('temporary 1'))
      .mockRejectedValueOnce(new Error('temporary 2'))
      .mockRejectedValueOnce(new Error('temporary 3'))
      .mockResolvedValueOnce({ text: 'done', request: {}, response: {}, providerMetadata: {}, steps: [] });

    const result = await generateText(config, messages);

    expect(result.content).toBe('done');
    expect(mockGenerateSdkText).toHaveBeenCalledTimes(4);
  });

  it('retries empty text responses before succeeding', async () => {
    mockGenerateSdkText
      .mockResolvedValueOnce({ text: '', request: {}, response: {}, providerMetadata: {}, steps: [] })
      .mockResolvedValueOnce({ text: '  ', request: {}, response: {}, providerMetadata: {}, steps: [] })
      .mockResolvedValueOnce({ text: '\n', request: {}, response: {}, providerMetadata: {}, steps: [] })
      .mockResolvedValueOnce({ text: 'diary', request: {}, response: {}, providerMetadata: {}, steps: [] });

    const result = await generateText(config, messages);

    expect(result.content).toBe('diary');
    expect(mockGenerateSdkText).toHaveBeenCalledTimes(4);
  });

  it('omits tools and tool_choice when no tools are provided', async () => {
    mockGenerateSdkText.mockResolvedValueOnce({
      text: 'phase output',
      request: {},
      response: { messages: [] },
      providerMetadata: {},
      steps: [],
      toolCalls: [],
      toolResults: [],
    });

    await generateTextWithTools(config, messages, []);

    const request = mockGenerateSdkText.mock.calls[0][0];
    expect(request).not.toHaveProperty('tools');
    expect(request).not.toHaveProperty('toolChoice');
  });

  it('sends tools and tool_choice when tools are provided', async () => {
    mockGenerateSdkText.mockResolvedValueOnce({
      text: 'ok',
      request: {},
      response: { messages: [] },
      providerMetadata: {},
      steps: [],
      toolCalls: [],
      toolResults: [],
    });

    await generateTextWithTools(config, messages, [{
      name: 'get_node',
      description: 'read a node',
      parameters: { type: 'object', properties: {} },
    }]);

    const request = mockGenerateSdkText.mock.calls[0][0];
    expect(request.tools).toHaveProperty('get_node');
    expect(request.toolChoice).toBe('auto');
  });

  it.each([
    ['openai_compatible', 'http://localhost:1234/v1'],
    ['anthropic', 'http://localhost:1234'],
  ] as Array<[ResolvedViewLlmConfig['provider'], string]>)(
    'passes toolChoice none through with tools for %s',
    async (provider, baseUrl) => {
      mockGenerateSdkText.mockResolvedValueOnce({
        text: 'phase output',
        request: {},
        response: { messages: [] },
        providerMetadata: {},
        steps: [],
        toolCalls: [],
        toolResults: [],
      });

      await generateTextWithTools(
        { ...config, provider, base_url: baseUrl },
        messages,
        [{ name: 'get_node', description: 'read a node', parameters: { type: 'object', properties: {} } }],
        [],
        { toolChoice: 'none' },
      );

      const request = mockGenerateSdkText.mock.calls[0][0];
      expect(request.tools).toHaveProperty('get_node');
      expect(request.toolChoice).toBe('none');
    },
  );

  it('retries tool generation three times before succeeding', async () => {
    mockGenerateSdkText
      .mockRejectedValueOnce(new Error('temporary 1'))
      .mockRejectedValueOnce(new Error('temporary 2'))
      .mockRejectedValueOnce(new Error('temporary 3'))
      .mockResolvedValueOnce({
        text: 'ok',
        request: {},
        response: { messages: [] },
        providerMetadata: {},
        steps: [],
        toolCalls: [],
        toolResults: [],
      });

    const result = await generateTextWithTools(config, messages, []);

    expect(result.content).toBe('ok');
    expect(mockGenerateSdkText).toHaveBeenCalledTimes(4);
  });
});
