import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGenerateSdkText, mockCreateLanguageModel, mockResolveViewLlmConfig, mockResolveEmbeddingConfig } = vi.hoisted(() => ({
  mockGenerateSdkText: vi.fn(),
  mockCreateLanguageModel: vi.fn(() => ({ provider: 'mock-model' })),
  mockResolveViewLlmConfig: vi.fn(),
  mockResolveEmbeddingConfig: vi.fn(),
}));

vi.mock('ai', () => ({ generateText: mockGenerateSdkText }));
vi.mock('../config', () => ({
  createLanguageModel: mockCreateLanguageModel,
  resolveViewLlmConfig: mockResolveViewLlmConfig,
  resolveEmbeddingConfig: mockResolveEmbeddingConfig,
}));

import { testSettingsConnection } from '../connectionTest';

describe('testSettingsConnection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockResolveViewLlmConfig.mockResolvedValue({
      provider: 'anthropic',
      base_url: 'http://localhost:8090/v1',
      api_key: 'test-key',
      model: 'deepseek-v4-pro',
      timeout_ms: 15000,
      temperature: 0.2,
      api_version: '',
    });
    mockGenerateSdkText.mockResolvedValue({ text: 'OK' });
  });

  it('allocates enough output tokens for models that emit thinking before text', async () => {
    await testSettingsConnection('view_llm', {});

    expect(mockGenerateSdkText).toHaveBeenCalledWith(expect.objectContaining({
      maxOutputTokens: expect.any(Number),
    }));
    expect(mockGenerateSdkText.mock.calls[0][0].maxOutputTokens).toBeGreaterThanOrEqual(256);
  });
});
