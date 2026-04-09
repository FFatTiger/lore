import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pickPluginConfig, fetchJson, hasRecallConfig, textResult, buildApiUrl, authHeaders } from '../api';

describe('pickPluginConfig', () => {
  it('uses defaults when pluginConfig is empty', () => {
    const cfg = pickPluginConfig({});
    expect(cfg.baseUrl).toBe('http://127.0.0.1:18901');
    expect(cfg.defaultDomain).toBe('core');
    expect(cfg.timeoutMs).toBe(30000);
    expect(cfg.recallEnabled).toBe(true);
    expect(cfg.injectPromptGuidance).toBe(true);
    expect(cfg.startupHealthcheck).toBe(true);
  });

  it('picks values from pluginConfig', () => {
    const cfg = pickPluginConfig({
      pluginConfig: {
        baseUrl: 'http://custom:9000',
        defaultDomain: 'mydom',
        timeoutMs: 5000,
        recallEnabled: false,
        injectPromptGuidance: false,
        startupHealthcheck: false,
      },
    });
    expect(cfg.baseUrl).toBe('http://custom:9000');
    expect(cfg.defaultDomain).toBe('mydom');
    expect(cfg.timeoutMs).toBe(5000);
    expect(cfg.recallEnabled).toBe(false);
    expect(cfg.injectPromptGuidance).toBe(false);
    expect(cfg.startupHealthcheck).toBe(false);
  });

  it('strips trailing slash from baseUrl', () => {
    const cfg = pickPluginConfig({ pluginConfig: { baseUrl: 'http://host:1234/' } });
    expect(cfg.baseUrl).toBe('http://host:1234');
  });

  it('defaults readNodeDisplayMode to soft', () => {
    const cfg = pickPluginConfig({});
    expect(cfg.readNodeDisplayMode).toBe('soft');
  });

  it('sets readNodeDisplayMode to hard when configured', () => {
    const cfg = pickPluginConfig({ pluginConfig: { readNodeDisplayMode: 'hard' } });
    expect(cfg.readNodeDisplayMode).toBe('hard');
  });

  it('uses LORE_API_TOKEN env variable when no apiToken in config', () => {
    process.env.LORE_API_TOKEN = 'env-token-123';
    const cfg = pickPluginConfig({});
    expect(cfg.apiToken).toBe('env-token-123');
    delete process.env.LORE_API_TOKEN;
  });
});

describe('hasRecallConfig', () => {
  it('returns true when recallEnabled is true', () => {
    expect(hasRecallConfig({ recallEnabled: true })).toBe(true);
  });

  it('returns false when recallEnabled is false', () => {
    expect(hasRecallConfig({ recallEnabled: false })).toBe(false);
  });

  it('returns false for empty object', () => {
    expect(hasRecallConfig({})).toBe(false);
  });
});

describe('textResult', () => {
  it('wraps text in content array', () => {
    const result = textResult('hello world');
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toBe('hello world');
  });

  it('includes details when provided', () => {
    const result = textResult('msg', { ok: true });
    expect(result.details).toEqual({ ok: true });
  });

  it('details is undefined when not provided', () => {
    const result = textResult('msg');
    expect(result.details).toBeUndefined();
  });
});

describe('buildApiUrl', () => {
  it('prepends /api to the path', () => {
    expect(buildApiUrl({ baseUrl: 'http://host' }, '/health')).toBe('http://host/api/health');
  });

  it('handles path without leading slash', () => {
    expect(buildApiUrl({ baseUrl: 'http://host' }, 'health')).toBe('http://host/api/health');
  });
});

describe('fetchJson', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeResponse(body: any, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Bad Request',
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  }

  const cfg = { baseUrl: 'http://localhost:18901', apiToken: '', timeoutMs: 5000 };

  it('returns parsed JSON on success', async () => {
    (fetch as any).mockResolvedValue(makeResponse({ result: 'ok' }));
    const data = await fetchJson(cfg, '/health', { method: 'GET' });
    expect(data).toEqual({ result: 'ok' });
  });

  it('throws on non-ok response with detail message', async () => {
    (fetch as any).mockResolvedValue(makeResponse({ detail: 'not found' }, 404));
    await expect(fetchJson(cfg, '/missing', { method: 'GET' })).rejects.toThrow('not found');
  });

  it('throws on non-ok response with error field', async () => {
    (fetch as any).mockResolvedValue(makeResponse({ error: 'unauthorized' }, 401));
    await expect(fetchJson(cfg, '/protected', { method: 'GET' })).rejects.toThrow('unauthorized');
  });

  it('throws with status text when body has no detail/error', async () => {
    (fetch as any).mockResolvedValue(makeResponse('', 500));
    await expect(fetchJson(cfg, '/error', { method: 'GET' })).rejects.toThrow();
  });

  it('handles non-JSON text response gracefully', async () => {
    (fetch as any).mockResolvedValue(makeResponse('plain text', 200));
    const data = await fetchJson(cfg, '/text', { method: 'GET' });
    expect(data).toBe('plain text');
  });
});

describe('authHeaders', () => {
  it('includes content-type and authorization when token present', () => {
    const headers = authHeaders({ apiToken: 'tok123' });
    expect(headers['content-type']).toBe('application/json');
    expect(headers['authorization']).toBe('Bearer tok123');
  });

  it('excludes content-type when includeJson is false', () => {
    const headers = authHeaders({ apiToken: 'tok' }, false);
    expect(headers['content-type']).toBeUndefined();
    expect(headers['authorization']).toBe('Bearer tok');
  });

  it('excludes authorization when no token', () => {
    const headers = authHeaders({ apiToken: '' });
    expect(headers['authorization']).toBeUndefined();
  });
});
