import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authHeaders, buildApiUrl, fetchJson, hasRecallConfig, pickPluginConfig, textResult } from '../api';

let originalLoreBaseUrl: string | undefined;
let originalHome: string | undefined;
let tempHome: string;

function restoreEnvVar(name: 'LORE_BASE_URL' | 'LORE_API_TOKEN' | 'API_TOKEN', value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe('Pi extension API helpers', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    originalLoreBaseUrl = process.env.LORE_BASE_URL;
    originalHome = process.env.HOME;
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-pi-home-'));
    process.env.HOME = tempHome;
    delete process.env.LORE_BASE_URL;
    delete process.env.LORE_API_TOKEN;
    delete process.env.API_TOKEN;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    restoreEnvVar('LORE_BASE_URL', originalLoreBaseUrl);
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
    delete process.env.LORE_API_TOKEN;
    delete process.env.API_TOKEN;
  });

  function writeSharedConfig(config: Record<string, unknown>) {
    const loreDir = path.join(tempHome, '.lore');
    fs.mkdirSync(loreDir, { recursive: true });
    fs.writeFileSync(path.join(loreDir, 'config.json'), JSON.stringify(config), 'utf-8');
  }

  it('uses Pi defaults', () => {
    delete process.env.LORE_BASE_URL;

    const cfg = pickPluginConfig({});
    expect(cfg.baseUrl).toBe('http://127.0.0.1:18901');
    expect(cfg.defaultDomain).toBe('core');
    expect(cfg.timeoutMs).toBe(30000);
    expect(cfg.recallEnabled).toBe(true);
    expect(cfg.injectPromptGuidance).toBe(true);
    expect(cfg.startupHealthcheck).toBe(true);
  });

  it('falls back to LORE_BASE_URL when config omits it', () => {
    process.env.LORE_BASE_URL = 'http://192.168.31.69:18901/';

    expect(pickPluginConfig({}).baseUrl).toBe('http://192.168.31.69:18901');
  });

  it('loads api token from env when config omits it', () => {
    process.env.LORE_API_TOKEN = 'env-token';
    expect(pickPluginConfig({}).apiToken).toBe('env-token');
  });

  it('loads base URL and API token from shared Lore config', () => {
    writeSharedConfig({
      base_url: 'http://shared-lore:18901/',
      api_token: 'shared-token',
    });

    const cfg = pickPluginConfig({});

    expect(cfg.baseUrl).toBe('http://shared-lore:18901');
    expect(cfg.apiToken).toBe('shared-token');
  });

  it('prefers extension config over shared Lore config', () => {
    writeSharedConfig({
      base_url: 'http://shared-lore:18901',
      api_token: 'shared-token',
    });

    const cfg = pickPluginConfig({
      pluginConfig: {
        baseUrl: 'http://plugin-lore:18901',
        apiToken: 'plugin-token',
      },
    });

    expect(cfg.baseUrl).toBe('http://plugin-lore:18901');
    expect(cfg.apiToken).toBe('plugin-token');
  });

  it('prefers shared Lore config over legacy environment variables', () => {
    process.env.LORE_BASE_URL = 'http://env-lore:18901';
    process.env.LORE_API_TOKEN = 'env-token';
    writeSharedConfig({
      base_url: 'http://shared-lore:18901',
      api_token: 'shared-token',
    });

    const cfg = pickPluginConfig({});

    expect(cfg.baseUrl).toBe('http://shared-lore:18901');
    expect(cfg.apiToken).toBe('shared-token');
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
