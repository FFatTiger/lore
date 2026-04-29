import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authHeaders, buildApiUrl, fetchJson, hasRecallConfig, pickPluginConfig, textResult } from '../api';

describe('Pi extension API helpers', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LORE_API_TOKEN;
    delete process.env.API_TOKEN;
  });

  it('uses Pi defaults', () => {
    const cfg = pickPluginConfig({});
    expect(cfg.baseUrl).toBe('http://127.0.0.1:18901');
    expect(cfg.defaultDomain).toBe('core');
    expect(cfg.timeoutMs).toBe(30000);
    expect(cfg.recallEnabled).toBe(true);
    expect(cfg.injectPromptGuidance).toBe(true);
    expect(cfg.startupHealthcheck).toBe(true);
  });

  it('loads api token from env when config omits it', () => {
    process.env.LORE_API_TOKEN = 'env-token';
    expect(pickPluginConfig({}).apiToken).toBe('env-token');
  });

  it('builds Lore API URLs with client_type=pi', () => {
    expect(buildApiUrl({ baseUrl: 'http://host' }, '/browse/boot')).toBe('http://host/api/browse/boot?client_type=pi');
    expect(buildApiUrl({ baseUrl: 'http://host' }, '/browse/search?query=x')).toBe('http://host/api/browse/search?query=x&client_type=pi');
  });

  it('wraps text tool results', () => {
    expect(textResult('hello', { ok: true })).toEqual({
      content: [{ type: 'text', text: 'hello' }],
      details: { ok: true },
    });
  });

  it('reports recall enabled only when configured', () => {
    expect(hasRecallConfig({ recallEnabled: true })).toBe(true);
    expect(hasRecallConfig({ recallEnabled: false })).toBe(false);
    expect(hasRecallConfig({})).toBe(false);
  });

  it('builds auth headers', () => {
    expect(authHeaders({ apiToken: 'tok' })).toMatchObject({
      'content-type': 'application/json',
      authorization: 'Bearer tok',
    });
    expect(authHeaders({ apiToken: 'tok' }, false)).toEqual({ authorization: 'Bearer tok' });
  });

  it('fetches and parses JSON', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ ok: true }),
    });

    await expect(fetchJson({ baseUrl: 'http://host', apiToken: '', timeoutMs: 1000 }, '/health', { method: 'GET' })).resolves.toEqual({ ok: true });
    expect((fetch as any).mock.calls[0][0]).toBe('http://host/api/health?client_type=pi');
  });
});
