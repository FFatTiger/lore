import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { agyInstaller } from '../src/channels/agy.ts';
import type { ChannelContext } from '../src/channels/types.ts';
import type { ExecFn } from '../src/core/exec.ts';

async function fixture(t: test.TestContext) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-agy-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const loreHome = path.join(home, '.lore');
  const dest = path.join(loreHome, 'agy');
  const bin = path.join(home, 'bin');
  const config = path.join(home, '.gemini/config/mcp_config.json');
  await fs.mkdir(bin, { recursive: true });
  await fs.writeFile(path.join(bin, process.platform === 'win32' ? 'agy.cmd' : 'agy'), '', { mode: 0o755 });
  await fs.mkdir(path.dirname(config), { recursive: true });
  const calls: string[][] = [];
  const run: ExecFn = async (argv) => { calls.push(argv); return { code: 0, stdout: '', stderr: '' }; };
  const artifactRun: ExecFn = async (argv) => {
    if (argv[0] === 'unzip') await fs.writeFile(path.join(argv[argv.indexOf('-d') + 1], 'plugin.json'), '{"name":"lore"}');
    return { code: 0, stdout: '', stderr: '' };
  };
  const ctx: ChannelContext = { loreHome, homeDir: home, env: { PATH: bin, HOME: home, LORE_HOME: loreHome, XDG_CONFIG_HOME: home }, baseUrl: 'https://example.invalid', tokenAction: 'set', needInstall: 0, releaseVersion: 'v1.12.5', capabilities: { skills: true }, force: false, lang: 'en', run, artifactRun };
  return { home, loreHome, dest, config, ctx, calls, bin };
}

async function legacy(dest: string, config: string, modified = false) {
  const entry = { command: 'node', args: ['/legacy/lore-mcp.mjs'] };
  await fs.mkdir(dest, { recursive: true });
  await fs.writeFile(path.join(dest, 'receipt.json'), JSON.stringify({ version: 1, entry }));
  const value = { other: true, mcpServers: { other: { command: 'other' }, lore: modified ? { ...entry, command: 'custom' } : entry } };
  await fs.writeFile(config, JSON.stringify(value));
  return value;
}

test('install downloads plugin, removes owned legacy entry, and installs and enables in order', async t => {
  const { ctx, dest, config, calls } = await fixture(t);
  const value = await legacy(dest, config);
  const result = await agyInstaller.install(ctx);
  assert.equal(result.status, 'ok', result.message);
  assert.deepEqual(calls, [['agy', 'plugin', 'uninstall', 'lore'], ['agy', 'plugin', 'install', dest], ['agy', 'plugin', 'enable', 'lore']]);
  const actual = JSON.parse(await fs.readFile(config, 'utf8'));
  assert.deepEqual(actual, { other: value.other, mcpServers: { other: value.mcpServers.other } });
  await fs.access(path.join(dest, 'plugin.json'));
});

test('user-modified or unowned legacy entry is preserved', async t => {
  const { ctx, dest, config } = await fixture(t);
  const value = await legacy(dest, config, true);
  assert.equal((await agyInstaller.install(ctx)).status, 'ok');
  assert.deepEqual(JSON.parse(await fs.readFile(config, 'utf8')), value);
  assert.equal((await agyInstaller.uninstall(ctx)).status, 'ok');
  assert.deepEqual(JSON.parse(await fs.readFile(config, 'utf8')), value);
});

test('uninstall cleans owned legacy entry and cached artifact even when command fails', async t => {
  const { ctx, dest, config, bin } = await fixture(t);
  await legacy(dest, config);
  const original = process.env.PATH;
  process.env.PATH = bin;
  const calls: string[][] = [];
  try {
    const result = await agyInstaller.uninstall({ ...ctx, run: async argv => { calls.push(argv); throw new Error('not supported'); } });
    assert.equal(result.status, 'ok', result.message);
    assert.deepEqual(calls, [['agy', 'plugin', 'uninstall', 'lore']]);
    assert.equal(JSON.parse(await fs.readFile(config, 'utf8')).mcpServers.lore, undefined);
    await assert.rejects(fs.access(dest));
  } finally { process.env.PATH = original; }
});

test('status distinguishes missing, partial, installed; install skips absent executable', async t => {
  const { ctx, home, dest } = await fixture(t);
  assert.equal((await agyInstaller.status(ctx)).state, 'missing');
  await fs.mkdir(dest, { recursive: true });
  assert.equal((await agyInstaller.status(ctx)).state, 'partial');
  const installed = path.join(home, '.gemini/config/plugins/lore');
  await fs.mkdir(installed, { recursive: true });
  await fs.writeFile(path.join(installed, 'plugin.json'), '{}');
  assert.equal((await agyInstaller.status(ctx)).state, 'installed');
  assert.equal((await agyInstaller.install({ ...ctx, env: { PATH: '' } })).status, 'skipped');
});

test('install reports errors from required host commands without exposing token', async t => {
  const { ctx } = await fixture(t);
  const result = await agyInstaller.install({ ...ctx, apiToken: 'secret', run: async argv => ({ code: argv[2] === 'install' ? 1 : 0, stdout: '', stderr: 'secret' }) });
  assert.equal(result.status, 'failed');
  assert.doesNotMatch(result.message, /secret/);
});
