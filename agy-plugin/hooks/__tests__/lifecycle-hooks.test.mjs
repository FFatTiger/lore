import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');
const home = mkdtempSync(path.join(tmpdir(), 'lore-agy-hook-'));
test.after(() => rmSync(home, { recursive: true, force: true }));

function runHook(event, input, baseUrl) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'hooks/lifecycle-hooks.mjs'), event], {
      cwd: root,
      env: { ...process.env, HOME: home, LORE_HOME: home, XDG_CONFIG_HOME: home, LORE_BASE_URL: baseUrl, LORE_API_TOKEN: '', API_TOKEN: '', LORE_SKILLS_ENABLED: '0' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
    child.stdin.end(typeof input === 'string' ? input : JSON.stringify(input));
  });
}

async function serverWith(output) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ host_output: output }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { requests, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

test('manifest and hooks declare the native plugin layout', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, 'plugin.json')));
  const hooks = JSON.parse(readFileSync(path.join(root, 'hooks.json')));
  const mcp = JSON.parse(readFileSync(path.join(root, 'mcp_config.json')));
  assert.equal(manifest.name, 'lore');
  assert.deepEqual(hooks.lore.SessionStart, [{ type: 'command', command: 'node ./hooks/lifecycle-hooks.mjs session-start', timeout: 10 }]);
  assert.deepEqual(hooks.lore.PreInvocation, [{ type: 'command', command: 'node ./hooks/lifecycle-hooks.mjs pre-invocation', timeout: 12 }]);
  assert.equal(mcp.mcpServers.lore.args[0], '${PLUGIN_ROOT}/mcp/lore-mcp.mjs');
});

test('session start passes boot JSON through and uses workspace directory', async () => {
  const value = { injectSteps: [{ systemMessage: { systemMessage: 'boot' } }] };
  const server = await serverWith({ mode: 'stdout_json', value });
  try {
    const result = await runHook('session-start', { conversationId: 'session', workspacePaths: ['/tmp/agy-project'], modelName: 'model', lastUserInput: 'secret' }, server.url);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), value);
    assert.equal(server.requests[0].project.dir_name, 'agy-project');
    assert.equal(server.requests[0].normalized.session_id, 'session');
    assert.equal(server.requests[0].runtime.runtime_family, 'agy');
    assert.equal(server.requests[0].runtime.plugin_version, JSON.parse(readFileSync(path.join(root, 'plugin.json'))).version);
    assert.equal(server.requests[0].event.name, 'session.start');
    assert.equal(server.requests[0].native_input_snapshot.lastUserInput, undefined);
  } finally { await server.close(); }
});

test('only the first invocation forwards non-empty prompts', async () => {
  const server = await serverWith({ mode: 'none' });
  try {
    const first = await runHook('pre-invocation', { invocationNum: 0, lastUserInput: 'hello', conversationId: 'c' }, server.url);
    const later = await runHook('pre-invocation', { invocationNum: 1, lastUserInput: 'hello' }, server.url);
    const blank = await runHook('pre-invocation', { invocationNum: 0, lastUserInput: '  ' }, server.url);
    assert.equal(first.stdout, '{}');
    assert.equal(later.stdout, '{}');
    assert.equal(blank.stdout, '{}');
    assert.equal(server.requests.length, 1);
    assert.deepEqual(server.requests[0].event, { name: 'prompt.submit', native_name: 'PreInvocation' });
    assert.equal(server.requests[0].normalized.prompt, 'hello');
  } finally { await server.close(); }
});

test('unreachable server and malformed input produce empty JSON', async () => {
  for (const input of [{ invocationNum: 0, lastUserInput: 'hello' }, '{bad']) {
    const result = await runHook('pre-invocation', input, 'http://127.0.0.1:1');
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, '{}');
  }
});
