import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

const bridgeScript = path.resolve(import.meta.dirname, '..', 'lore-mcp.mjs');
const temporaryHomes = [];

function runBridge(message, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bridgeScript], {
      env: { ...process.env, LORE_API_TOKEN: '', API_TOKEN: '', LORE_SKILLS_ENABLED: '', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`bridge timed out: ${stderr}`));
    }, 5000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      const newline = stdout.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timer);
      child.stdin.end();
      resolve({ payload: JSON.parse(stdout.slice(0, newline)), stderr });
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

async function withCore(handler) {
  const requests = [];
  const headers = [];
  const urls = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    requests.push(body);
    headers.push(req.headers);
    urls.push(req.url);
    const response = handler(body);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(response));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    requests,
    headers,
    urls,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

afterEach(() => {
  while (temporaryHomes.length) fs.rmSync(temporaryHomes.pop(), { recursive: true, force: true });
});

test('bridge forwards tool calls verbatim; skills need no local materialization', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-dsh-bridge-'));
  temporaryHomes.push(home);
  const core = await withCore((request) => ({
    jsonrpc: '2.0',
    id: request.id,
    result: { content: [{ type: 'text', text: 'raw skill payload' }] },
  }));
  try {
    const { payload, stderr } = await runBridge({
      jsonrpc: '2.0',
      id: 'get-1',
      method: 'tools/call',
      params: { name: 'lore_skill_list', arguments: {} },
    }, {
      LORE_HOME: home,
      LORE_BASE_URL: core.baseUrl,
      LORE_API_TOKEN: 'bridge-token',
      LORE_SKILLS_ENABLED: '1',
    });
    assert.equal(stderr, '');
    assert.equal(core.urls[0], '/api/mcp?client_type=dsh');
    assert.equal(core.headers[0].authorization, 'Bearer bridge-token');
    assert.deepEqual(payload.result.content, [{ type: 'text', text: 'raw skill payload' }]);
    // dsh discovers skills through its native skill system; the bridge never
    // writes skill work copies anymore.
    assert.equal(fs.existsSync(path.join(home, 'skills')), false);
  } finally {
    await core.close();
  }
});

test('bridge keeps Skill tools hidden unless the configured server advertises Skills', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-dsh-bridge-'));
  temporaryHomes.push(home);
  const core = await withCore((request) => ({
    jsonrpc: '2.0',
    id: request.id,
    result: { tools: [{ name: 'lore_search' }, { name: 'lore_skill_get' }, { name: 'lore_skill_list' }] },
  }));
  try {
    const list = await runBridge({ jsonrpc: '2.0', id: 'list-1', method: 'tools/list', params: {} }, {
      LORE_HOME: home,
      LORE_BASE_URL: core.baseUrl,
    });
    assert.deepEqual(list.payload.result.tools, [{ name: 'lore_search' }]);

    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
      base_url: core.baseUrl,
      server_profile: { base_url: core.baseUrl, capabilities: { skills: true } },
    }));
    const advertised = await runBridge({ jsonrpc: '2.0', id: 'list-2', method: 'tools/list', params: {} }, { LORE_HOME: home });
    assert.equal(advertised.payload.result.tools.length, 3);
  } finally {
    await core.close();
  }
});

test('bridge fails open with a JSON-RPC error when Lore is unreachable', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-dsh-bridge-'));
  temporaryHomes.push(home);
  const { payload } = await runBridge({ jsonrpc: '2.0', id: 'list-1', method: 'tools/list', params: {} }, {
    LORE_HOME: home,
    LORE_BASE_URL: 'http://127.0.0.1:9',
  });
  assert.equal(payload.id, 'list-1');
  assert.equal(payload.error.code, -32603);
  assert.match(payload.error.message, /fetch failed|ECONNREFUSED/i);
});
