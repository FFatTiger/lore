import { beforeEach, describe, expect, it, vi } from 'vitest';

const { capturedAnthropicOptions, mockCreateAnthropic, mockCreateOpenAI } = vi.hoisted(() => {
  const capturedAnthropicOptions: { current?: { fetch?: typeof globalThis.fetch } } = {};
  return {
    capturedAnthropicOptions,
    mockCreateAnthropic: vi.fn((options: { fetch?: typeof globalThis.fetch }) => {
      capturedAnthropicOptions.current = options;
      return { messages: vi.fn((model: string) => ({ provider: 'anthropic', model })) };
    }),
    mockCreateOpenAI: vi.fn(() => ({
      chat: vi.fn((model: string) => ({ provider: 'openai-chat', model })),
      responses: vi.fn((model: string) => ({ provider: 'openai-responses', model })),
      embedding: vi.fn((model: string) => ({ provider: 'openai-embedding', model })),
    })),
  };
});

vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic: mockCreateAnthropic }));
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: mockCreateOpenAI }));
vi.mock('../../config/settings', () => ({ getSettings: vi.fn() }));

import { createLanguageModel, type ResolvedViewLlmConfig } from '../config';

const deepseekAnthropicConfig: ResolvedViewLlmConfig = {
  provider: 'anthropic',
  base_url: 'http://example.test/v1',
  api_key: 'test-key',
  model: 'deepseek-v4-pro',
  timeout_ms: 5000,
  temperature: 0.2,
  api_version: '',
};

describe('createLanguageModel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    capturedAnthropicOptions.current = undefined;
  });

  it('does not wrap Anthropic fetch for DeepSeek-compatible models', () => {
    createLanguageModel(deepseekAnthropicConfig);

    expect(capturedAnthropicOptions.current?.fetch).toBe(globalThis.fetch);
  });
});
