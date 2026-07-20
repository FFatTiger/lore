import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { claudecodeInstaller } from '../src/channels/claudecode.ts';
import { codexInstaller } from '../src/channels/codex.ts';
import type { ChannelContext } from '../src/channels/types.ts';
import type { ExecFn } from '../src/core/exec.ts';

async function tempHome() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-cc-'));
  const loreHome = path.join(home, '.lore');
  await fs.mkdir(loreHome, { recursive: true });
  return { home, loreHome };
}

function ctx(p: Partial<ChannelContext> & { loreHome: string; homeDir: string }): ChannelContext {
  return {
    baseUrl: 'https://core.example',
    apiToken: 'lm_x',
    needInstall: 2,
    force: false,
    lang: 'en',
    releaseVersion: 'v1.3.15',
    ...p,
  };
}

async function withBin(home: string, name: string, fn: () => Promise<void>) {
  const bin = path.join(home, 'bin');
  await fs.mkdir(bin, { recursive: true });
  await fs.writeFile(path.join(bin, name), '#!/bin/bash\nexit 0\n');
  await fs.chmod(path.join(bin, name), 0o755);
  const orig = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${orig ?? ''}`;
  try {
    await fn();
  } finally {
    process.env.PATH = orig;
  }
}

test('claude install writes settings and mcp args', async () => {
  const { home, loreHome } = await tempHome();
  await fs.mkdir(path.join(loreHome, 'claudecode'), { recursive: true });
  const calls: string[] = [];
  const run: ExecFn = async (argv) => {
    calls.push(argv.join(' '));
    if (argv.join(' ') === 'claude plugin list') {
      return { code: 0, stdout: '', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };

  await withBin(home, 'claude', async () => {
    const result = await claudecodeInstaller.install(ctx({ loreHome, homeDir: home, run }));
    assert.equal(result.status, 'ok');
    assert.ok(calls.some((c) => c.includes('claude plugin marketplace add')));
    assert.ok(calls.some((c) => c.includes('claude mcp add') && c.includes('Authorization: Bearer lm_x')));
    const settings = JSON.parse(
      await fs.readFile(path.join(home, '.claude', 'settings.json'), 'utf8'),
    ) as { env: { LORE_BASE_URL: string; LORE_API_TOKEN: string } };
    assert.equal(settings.env.LORE_BASE_URL, 'https://core.example');
    assert.equal(settings.env.LORE_API_TOKEN, 'lm_x');
  });
});

test('codex install copies plugin and enables toml sections', async () => {
  const { home, loreHome } = await tempHome();
  const market = path.join(loreHome, 'codex', 'plugins', 'lore');
  await fs.mkdir(path.join(market, 'hooks'), { recursive: true });
  await fs.writeFile(
    path.join(market, 'hooks', 'hooks.json'),
    JSON.stringify({ root: '__LORE_CODEX_PLUGIN_ROOT__' }),
  );
  await fs.mkdir(path.join(home, '.codex'), { recursive: true });
  await fs.writeFile(path.join(home, '.codex', 'config.toml'), '');

  const run: ExecFn = async () => ({ code: 0, stdout: '', stderr: '' });

  await withBin(home, 'codex', async () => {
    const result = await codexInstaller.install(ctx({ loreHome, homeDir: home, run }));
    assert.equal(result.status, 'ok');
    const pluginRoot = path.join(home, '.codex', 'plugins', 'cache', 'lore', 'lore', 'local');
    const hooks = await fs.readFile(path.join(pluginRoot, 'hooks', 'hooks.json'), 'utf8');
    assert.ok(hooks.includes(pluginRoot));
    assert.ok(!hooks.includes('__LORE_CODEX_PLUGIN_ROOT__'));
    const cfg = await fs.readFile(path.join(home, '.codex', 'config.toml'), 'utf8');
    assert.match(cfg, /\[plugins\."lore@lore"\]/);
    assert.match(cfg, /\[mcp_servers\.lore\]/);
    assert.match(cfg, /hooks = true/);
  });
});
