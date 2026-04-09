import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../db', () => ({ sql: vi.fn() }));
vi.mock('../../config/settings', () => ({
  getSettings: vi.fn().mockResolvedValue({}),
}));

import { getSettings } from '../../config/settings';
import {
  resolveViewLlmConfig,
  extractJsonObject,
  chatCompletion,
  buildViewGenerationMessages,
  refineDocumentWithLlm,
  refineDocumentsWithLlm,
} from '../viewLlm';

const mockGetSettings = vi.mocked(getSettings);

// ---------------------------------------------------------------------------
// extractJsonObject
// ---------------------------------------------------------------------------

describe('extractJsonObject', () => {
  it('parses valid JSON directly', () => {
    const result = extractJsonObject('{"gist":"hello","question":["a","b","c"]}');
    expect(result).toEqual({ gist: 'hello', question: ['a', 'b', 'c'] });
  });

  it('extracts JSON embedded in text', () => {
    const result = extractJsonObject('Some preamble text {"key":"value"} trailing text');
    expect(result).toEqual({ key: 'value' });
  });

  it('returns null for empty input', () => {
    expect(extractJsonObject('')).toBeNull();
    expect(extractJsonObject(null)).toBeNull();
    expect(extractJsonObject(undefined)).toBeNull();
  });

  it('returns null for text with no JSON', () => {
    expect(extractJsonObject('hello world no json here')).toBeNull();
  });

  it('returns null for malformed JSON even with braces', () => {
    expect(extractJsonObject('{not valid json}')).toBeNull();
  });

  it('handles JSON with markdown fences', () => {
    const input = '```json\n{"gist":"test"}\n```';
    const result = extractJsonObject(input);
    expect(result).toEqual({ gist: 'test' });
  });
});

// ---------------------------------------------------------------------------
// resolveViewLlmConfig
// ---------------------------------------------------------------------------

describe('resolveViewLlmConfig', () => {
  const originalEnv = process.env.LORE_VIEW_LLM_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LORE_VIEW_LLM_API_KEY = 'test-key';
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.LORE_VIEW_LLM_API_KEY = originalEnv;
    } else {
      delete process.env.LORE_VIEW_LLM_API_KEY;
    }
  });

  it('returns config when all settings are present', async () => {
    mockGetSettings.mockResolvedValueOnce({
      'view_llm.base_url': 'http://llm:8080',
      'view_llm.model': 'test-model',
      'view_llm.temperature': 0.3,
      'view_llm.timeout_ms': 15000,
    });
    const config = await resolveViewLlmConfig();
    expect(config).toEqual({
      base_url: 'http://llm:8080',
      api_key: 'test-key',
      model: 'test-model',
      temperature: 0.3,
      timeout_ms: 15000,
    });
  });

  it('returns null when base_url is missing', async () => {
    mockGetSettings.mockResolvedValueOnce({
      'view_llm.base_url': '',
      'view_llm.model': 'model',
    });
    const config = await resolveViewLlmConfig();
    expect(config).toBeNull();
  });

  it('returns null when model is missing', async () => {
    mockGetSettings.mockResolvedValueOnce({
      'view_llm.base_url': 'http://llm',
      'view_llm.model': '',
    });
    const config = await resolveViewLlmConfig();
    expect(config).toBeNull();
  });

  it('returns null when api_key is missing', async () => {
    delete process.env.LORE_VIEW_LLM_API_KEY;
    mockGetSettings.mockResolvedValueOnce({
      'view_llm.base_url': 'http://llm',
      'view_llm.model': 'model',
    });
    const config = await resolveViewLlmConfig();
    expect(config).toBeNull();
  });

  it('falls back to embedding config for base_url and api_key', async () => {
    delete process.env.LORE_VIEW_LLM_API_KEY;
    mockGetSettings.mockResolvedValueOnce({
      'view_llm.base_url': '',
      'view_llm.model': 'model',
    });
    const config = await resolveViewLlmConfig({
      base_url: 'http://embed',
      api_key: 'embed-key',
      model: 'embed-model',
    });
    expect(config).toEqual({
      base_url: 'http://embed',
      api_key: 'embed-key',
      model: 'model',
      temperature: 0.2,
      timeout_ms: 30000,
    });
  });

  it('uses default temperature and timeout', async () => {
    mockGetSettings.mockResolvedValueOnce({
      'view_llm.base_url': 'http://llm',
      'view_llm.model': 'model',
      'view_llm.temperature': 0,
      'view_llm.timeout_ms': 0,
    });
    const config = await resolveViewLlmConfig();
    expect(config!.temperature).toBe(0.2);
    expect(config!.timeout_ms).toBe(30000);
  });
});

// ---------------------------------------------------------------------------
// chatCompletion
// ---------------------------------------------------------------------------

describe('chatCompletion', () => {
  beforeEach(() => vi.clearAllMocks());

  const config = {
    base_url: 'http://llm:8080',
    api_key: 'key',
    model: 'test',
    timeout_ms: 5000,
    temperature: 0.2,
  };

  it('returns content from successful response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '{"gist":"test"}' } }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await chatCompletion(config, [{ role: 'user', content: 'hello' }]);
    expect(result).toBe('{"gist":"test"}');

    vi.unstubAllGlobals();
  });

  it('throws on non-ok response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(chatCompletion(config, [])).rejects.toThrow('View LLM request failed: 500');

    vi.unstubAllGlobals();
  });

  it('handles array content format', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: [{ text: 'part1' }, { text: 'part2' }] } }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await chatCompletion(config, []);
    expect(result).toBe('part1\npart2');

    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// buildViewGenerationMessages
// ---------------------------------------------------------------------------

describe('buildViewGenerationMessages', () => {
  it('returns system and user messages', () => {
    const doc = {
      uri: 'core://test',
      path: 'test',
      priority: 5,
      disclosure: 'when testing',
      glossary_keywords: ['kw1'],
      body_preview: 'Some preview',
    };
    const messages = buildViewGenerationMessages(doc);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(messages[0].content).toContain('retrieval views');
    expect(messages[0].content).toContain('gist');
    expect(messages[0].content).toContain('question');
  });

  it('includes document fields in user message', () => {
    const doc = {
      uri: 'core://my/node',
      path: 'my/node',
      priority: 3,
      disclosure: 'test disclosure',
      glossary_keywords: ['keyword'],
      body_preview: 'Body text',
    };
    const messages = buildViewGenerationMessages(doc);
    const userContent = JSON.parse(messages[1].content);
    expect(userContent.uri).toBe('core://my/node');
    expect(userContent.path).toBe('my/node');
    expect(userContent.priority).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// refineDocumentsWithLlm
// ---------------------------------------------------------------------------

describe('refineDocumentsWithLlm', () => {
  it('returns original docs when config is null', async () => {
    const docs = [{ uri: 'core://test' }];
    const result = await refineDocumentsWithLlm(docs, null);
    expect(result).toBe(docs);
  });

  it('returns original docs when docs array is empty', async () => {
    const config = {
      base_url: 'http://llm', api_key: 'key', model: 'test',
      timeout_ms: 5000, temperature: 0.2,
    };
    const result = await refineDocumentsWithLlm([], config);
    expect(result).toEqual([]);
  });
});
