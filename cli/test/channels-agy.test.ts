import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getInstaller } from '../src/channels/registry.ts';
import { detectAgents } from '../src/core/detect.ts';
import { parseArgv } from '../src/core/args.ts';
import { runInstall, runUpdate } from '../src/commands/install.ts';
import type { ChannelContext } from '../src/channels/types.ts';

async function fixture(t: test.TestContext) {
  const homeDir = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'lore-agy-'));
  t.after(() => fs.rm(homeDir, { recursive: true, force: true }));
  const loreHome = path.join(homeDir, 'lore home');
  const bin = path.join(homeDir, 'bin');
  await fs.mkdir(bin);
  await fs.writeFile(path.join(bin, process.platform === 'win32' ? 'agy.cmd' : 'agy'), '', { mode: 0o755 });
  const env = { HOME: homeDir, LORE_HOME: loreHome, PATH: bin };
  const configFile = path.join(homeDir, '.gemini', 'config', 'mcp_config.json');
  await fs.mkdir(path.dirname(configFile), { recursive: true });
  const ctx: ChannelContext = { loreHome, homeDir, env, baseUrl: 'https://example.invalid', apiToken: 'synthetic-secret', tokenAction: 'set', needInstall: 0, capabilities: { skills: true }, force: false, lang: 'en' };
  return { ctx, env, configFile, dest: path.join(loreHome, 'agy') };
}
const quiet = { info() {}, ok() {}, warn() {}, err() {}, section() {} };
const fakeFetch: typeof fetch = async (url) => String(url).endsWith('/releases/latest')
  ? new Response(null, { status: 302, headers: { location: 'https://github.com/FFatTiger/lore/releases/tag/v1.12.5' } })
  : new Response(JSON.stringify({ capabilities: { skills: true } }), { status: 200 });

test('agy on PATH is included in default noninteractive install and explicit update', async (t) => {
  const { ctx, env, configFile } = await fixture(t);
  assert.equal((await detectAgents(undefined, env)).agy, true);
  const deps = { env, isTTY: false, fetchImpl: fakeFetch, log: quiet, artifactRun: async () => { throw new Error('agy must not download a ZIP'); } };
  assert.equal(await runInstall(parseArgv(['-y', '--base-url', 'https://example.invalid']), deps), 0);
  const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
  assert.equal(config.mcpServers.lore.command, process.execPath);
  assert.deepEqual(config.mcpServers.lore.env, { LORE_HOME: ctx.loreHome, LORE_SKILLS_ENABLED: '0' });
  assert.equal(await runUpdate(parseArgv(['update', '--channels', 'agy', '-y']), deps), 0);
  assert.equal((await getInstaller('agy').status(ctx)).state, 'installed');
});

test('agy initializes zero-byte config, preserves other fields, updates, and uninstalls idempotently without runtime', async (t) => {
  const { ctx, configFile, dest } = await fixture(t);
  const installer = getInstaller('agy');
  await fs.writeFile(configFile, '');
  assert.equal((await installer.install(ctx)).status, 'ok');
  let config = JSON.parse(await fs.readFile(configFile, 'utf8'));
  config.other = { keep: true };
  config.mcpServers.other = { command: 'other' };
  await fs.writeFile(configFile, JSON.stringify(config));
  assert.equal((await installer.install(ctx)).status, 'ok');
  assert.equal((await installer.status(ctx)).state, 'installed');
  assert.ok(!(await fs.readFile(configFile, 'utf8')).includes('synthetic-secret'));
  await fs.rm(ctx.env!.PATH!, { recursive: true });
  assert.equal((await installer.uninstall(ctx)).status, 'ok');
  assert.equal((await installer.uninstall(ctx)).status, 'ok');
  config = JSON.parse(await fs.readFile(configFile, 'utf8'));
  assert.deepEqual(config, { other: { keep: true }, mcpServers: { other: { command: 'other' } } });
  await assert.rejects(fs.access(dest));
  assert.equal((await installer.status(ctx)).state, 'missing');
});

test('agy never takes over a manual registration, even with force', async (t) => {
  const { ctx, configFile, dest } = await fixture(t);
  const text = JSON.stringify({ mcpServers: { lore: { command: 'manual' } } });
  await fs.writeFile(configFile, text);
  const installer = getInstaller('agy');
  assert.equal((await installer.install({ ...ctx, force: true })).status, 'failed');
  assert.equal((await installer.uninstall(ctx)).status, 'failed');
  assert.equal(await fs.readFile(configFile, 'utf8'), text);
  await assert.rejects(fs.access(dest));
});

test('agy preserves modified registration and its bridge files', async (t) => {
  const { ctx, configFile, dest } = await fixture(t);
  const installer = getInstaller('agy');
  assert.equal((await installer.install(ctx)).status, 'ok');
  const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
  config.mcpServers.lore.env.EXTRA = 'user change';
  const text = JSON.stringify(config);
  await fs.writeFile(configFile, text);
  assert.equal((await installer.status(ctx)).state, 'partial');
  assert.equal((await installer.install(ctx)).status, 'failed');
  assert.equal((await installer.uninstall(ctx)).status, 'failed');
  assert.equal(await fs.readFile(configFile, 'utf8'), text);
  await fs.access(path.join(dest, 'lore-mcp.mjs'));
});

for (const text of ['{bad', 'null', '[]', '{"mcpServers":[]}', '{"mcpServers":null}', '   ']) {
  test(`agy fails closed on malformed/wrong-shaped config ${text}`, async (t) => {
    const { ctx, configFile } = await fixture(t);
    await fs.writeFile(configFile, text);
    const installer = getInstaller('agy');
    assert.equal((await installer.install(ctx)).status, 'failed');
    assert.equal((await installer.uninstall(ctx)).status, 'failed');
    assert.equal((await installer.status(ctx)).state, 'unknown');
    assert.equal(await fs.readFile(configFile, 'utf8'), text);
  });
}

test('agy reports scaffold as partial, absent as missing, and skips absent runtime', async (t) => {
  const { ctx, dest } = await fixture(t);
  const installer = getInstaller('agy');
  assert.equal((await installer.status(ctx)).state, 'missing');
  await fs.mkdir(dest, { recursive: true });
  assert.equal((await installer.status(ctx)).state, 'partial');
  assert.equal((await installer.install({ ...ctx, env: { PATH: '' } })).status, 'skipped');
});

test('agy rejects symlink config and parent directory without changing targets', async (t) => {
  const { ctx, configFile } = await fixture(t);
  const target = path.join(ctx.homeDir!, 'target');
  await fs.writeFile(target, '{}');
  await fs.symlink(target, configFile);
  const installer = getInstaller('agy');
  assert.equal((await installer.install(ctx)).status, 'failed');
  assert.equal((await installer.uninstall(ctx)).status, 'failed');
  assert.equal((await installer.status(ctx)).state, 'unknown');
  assert.equal(await fs.readFile(target, 'utf8'), '{}');
  await fs.unlink(configFile);
  await fs.rm(path.dirname(configFile), { recursive: true });
  await fs.symlink(path.dirname(target), path.dirname(configFile));
  assert.equal((await installer.install(ctx)).status, 'failed');
});

test('agy refuses to write through a symlink ancestor of custom LORE_HOME', async (t) => {
  const { ctx, configFile } = await fixture(t);
  const target = path.join(ctx.homeDir!, 'target');
  const link = path.join(ctx.homeDir!, 'link');
  await fs.mkdir(target);
  await fs.symlink(target, link, 'dir');
  const installer = getInstaller('agy');
  assert.equal((await installer.install({ ...ctx, loreHome: path.join(link, 'custom', 'lore') })).status, 'failed');
  assert.deepEqual(await fs.readdir(target), []);
  await assert.rejects(fs.access(configFile));
});

test('agy retries interrupted registration intent and repairs missing or modified files', async (t) => {
  const { ctx, configFile, dest } = await fixture(t);
  const installer = getInstaller('agy');
  assert.equal((await installer.install(ctx)).status, 'ok');
  const receiptFile = path.join(dest, 'receipt.json');
  const receipt = JSON.parse(await fs.readFile(receiptFile, 'utf8'));
  await fs.writeFile(receiptFile, JSON.stringify({ ...receipt, pending: receipt.entry }));
  await fs.writeFile(configFile, '{}'); // interruption before first registration
  await fs.rm(path.join(dest, 'mcp-bridge', 'index.mjs'));
  assert.equal((await installer.status(ctx)).state, 'partial');
  assert.equal((await installer.install(ctx)).status, 'ok');
  await fs.writeFile(path.join(dest, 'lore-mcp.mjs'), '// broken');
  assert.equal((await installer.status(ctx)).state, 'partial');
  assert.equal((await installer.install(ctx)).status, 'ok');
  assert.equal((await installer.status(ctx)).state, 'installed');
  // Simulate interruption after the registration was written but before commit.
  await fs.writeFile(receiptFile, JSON.stringify({ ...receipt, pending: receipt.entry }));
  assert.equal((await installer.install(ctx)).status, 'ok');
  assert.equal((await installer.status(ctx)).state, 'installed');
});

test('agy rejects nonregular config, symlink bridge, and unreadable config', async (t) => {
  const { ctx, configFile, dest } = await fixture(t);
  const installer = getInstaller('agy');
  await fs.mkdir(configFile);
  assert.equal((await installer.install(ctx)).status, 'failed');
  await fs.rmdir(configFile);
  assert.equal((await installer.install(ctx)).status, 'ok');
  const bridge = path.join(dest, 'lore-mcp.mjs');
  await fs.unlink(bridge);
  await fs.symlink(configFile, bridge);
  const before = await fs.readFile(configFile, 'utf8');
  assert.equal((await installer.install(ctx)).status, 'failed');
  assert.equal(await fs.readFile(configFile, 'utf8'), before);
  if (process.platform !== 'win32' && process.getuid?.() !== 0) {
    await fs.chmod(configFile, 0);
    try {
      assert.equal((await installer.install(ctx)).status, 'failed');
      assert.equal((await installer.uninstall(ctx)).status, 'failed');
      assert.equal((await installer.status(ctx)).state, 'unknown');
    } finally { await fs.chmod(configFile, 0o600); }
  }
});

test('agy explicit status and uninstall command entry points use isolated HOME', async (t) => {
  const { runStatus } = await import('../src/commands/status.ts');
  const { runUninstall } = await import('../src/commands/uninstall.ts');
  const { ctx, env } = await fixture(t);
  assert.equal((await getInstaller('agy').install(ctx)).status, 'ok');
  const lines: string[] = [];
  assert.equal(await runStatus(parseArgv(['status', '--channels', 'agy']), { env, log: { ...quiet, info: (line) => lines.push(line) } }), 0);
  const channelLines = lines.filter((line) => /^(claudecode|codex|pi|openclaw|hermes|opencode|zcode|dsh|agy):/.test(line));
  assert.equal(channelLines.length, 2);
  assert.equal(channelLines[0], 'agy: yes');
  assert.match(channelLines[1], /^agy: installed/);
  assert.equal(await runUninstall(parseArgv(['uninstall', '--channels', 'agy', '-y']), { env, isTTY: false, log: quiet }), 0);
  assert.equal((await getInstaller('agy').status(ctx)).state, 'missing');
});

test('staged agy bridge uses shared config, MCP Accept, memory-only tools, and refuses redirects', async (t) => {
  const { createServer } = await import('node:http');
  const { spawn } = await import('node:child_process');
  const { ctx, configFile } = await fixture(t);
  const requests: { url: string; headers: import('node:http').IncomingHttpHeaders; body: any }[] = [];
  let redirect = false;
  let redirectedRequests = 0;
  const server = createServer(async (req, res) => {
    if (req.url === '/redirected') { redirectedRequests++; res.end('{}'); return; }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push({ url: req.url!, headers: req.headers, body });
    if (redirect) { res.writeHead(307, { location: '/redirected' }); res.end(); return; }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'lore_search' }, { name: 'lore_skill_get' }] } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address() as import('node:net').AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  assert.equal((await getInstaller('agy').install(ctx)).status, 'ok');
  await fs.writeFile(path.join(ctx.loreHome, 'config.json'), JSON.stringify({ base_url: baseUrl, api_token: 'synthetic-only', server_profile: { base_url: baseUrl, capabilities: { skills: true } } }));
  const registration = JSON.parse(await fs.readFile(configFile, 'utf8')).mcpServers.lore;
  async function rpc(message: object) {
    const child = spawn(registration.command, registration.args, { env: { HOME: ctx.homeDir, ...registration.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill(), 5000);
    let out = ''; let stderr = '';
    child.stdout.on('data', (data) => { out += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.stdin.end(`${JSON.stringify(message)}\n`);
    const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    clearTimeout(timer);
    assert.equal(code, 0, stderr);
    return JSON.parse(out.trim());
  }
  assert.deepEqual((await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools, [{ name: 'lore_search' }]);
  assert.equal(requests[0].url, '/api/mcp?client_type=mcp');
  assert.equal(requests[0].headers.accept, 'application/json, text/event-stream');
  assert.equal(requests[0].headers['content-type'], 'application/json');
  assert.equal(requests[0].headers.authorization, 'Bearer synthetic-only');
  assert.equal((await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'lore_skill_get' } })).result.isError, true);
  assert.equal(requests.length, 1, 'blocked skill calls must not reach server');
  redirect = true;
  assert.equal((await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' })).error.code, -32603);
  assert.equal(redirectedRequests, 0);
});
