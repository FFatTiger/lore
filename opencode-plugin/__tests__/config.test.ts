import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadLorePluginConfig } from '../config.js';
import { buildLoreApiUrl } from '../api.js';

const roots: string[] = [];

function temporaryHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'lore-opencode-config-'));
  roots.push(home);
  return home;
}

function writeSharedConfig(home: string, value: unknown): void {
  const configDirectory = join(home, '.lore');
  mkdirSync(configDirectory, { recursive: true });
  writeFileSync(join(configDirectory, 'config.json'), JSON.stringify(value));
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('OpenCode plugin configuration', () => {
  it('prefers non-blank shared config values over environment values', () => {
    const home = temporaryHome();
    writeSharedConfig(home, {
      base_url: ' https://file.example/// ',
      api_token: ' file-token ',
    });

    const config = loadLorePluginConfig({
      LORE_BASE_URL: ' https://env.example/ ',
      LORE_API_TOKEN: ' env-token ',
    }, home);

    expect(config).toEqual({
      baseUrl: 'https://file.example',
      apiToken: 'file-token',
      startupTimeoutMs: 8_000,
      requestTimeoutMs: 30_000,
      defaultDomain: 'core',
    });
  });

  it('falls through blank or invalid shared values to Lore environment values', () => {
    const home = temporaryHome();
    writeSharedConfig(home, { base_url: '   ', api_token: '\n' });

    const config = loadLorePluginConfig({
      LORE_BASE_URL: ' https://env.example/// ',
      LORE_API_TOKEN: ' env-token ',
      API_TOKEN: 'must-not-be-used',
      LORE_DEFAULT_DOMAIN: ' project ',
    }, home);

    expect(config.baseUrl).toBe('https://env.example');
    expect(config.apiToken).toBe('env-token');
    expect(config.defaultDomain).toBe('project');
  });

  it('uses the local base URL and never falls back to API_TOKEN', () => {
    const config = loadLorePluginConfig({ API_TOKEN: 'legacy-secret' }, temporaryHome());

    expect(config.baseUrl).toBe('http://127.0.0.1:18901');
    expect(config.apiToken).toBe('');
  });
});

describe('OpenCode Lore API URL construction', () => {
  const config = {
    baseUrl: 'https://api.example.test',
    apiToken: '',
    startupTimeoutMs: 8_000,
    requestTimeoutMs: 30_000,
    defaultDomain: 'core',
  };

  it('normalizes browse routes under /api and adds OpenCode identity', () => {
    const url = buildLoreApiUrl(config, '/browse/node', new URLSearchParams({ domain: 'project' }));

    expect(url.pathname).toBe('/api/browse/node');
    expect(url.searchParams.get('domain')).toBe('project');
    expect(url.searchParams.get('client_type')).toBe('opencode');
  });

  it('does not duplicate an existing /api prefix', () => {
    expect(buildLoreApiUrl(config, '/api/browse/node').pathname).toBe('/api/browse/node');
  });

  it('omits client_type only from the exact health route', () => {
    const health = buildLoreApiUrl(config, '/health');
    const nested = buildLoreApiUrl(config, '/health/details');

    expect(health.pathname).toBe('/api/health');
    expect(health.searchParams.has('client_type')).toBe(false);
    expect(nested.searchParams.get('client_type')).toBe('opencode');
  });
});
